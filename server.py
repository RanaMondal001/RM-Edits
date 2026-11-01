"""Local, dependency-free server for the portfolio and its admin panel."""
from __future__ import annotations

import hashlib
import hmac
import base64
import binascii
import json
import os
import re
import secrets
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / "private"
USER_FILE = PRIVATE / "admin-user.json"
CONTENT_FILE = ROOT / "site-content.json"
INQUIRIES_FILE = PRIVATE / "inquiries.json"
PUBLIC_DIR = ROOT / "public"
MEDIA_DIR = PUBLIC_DIR / "media"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5500"))
SESSIONS: dict[str, float] = {}
LOGIN_ATTEMPTS: dict[str, tuple[int, float]] = {}
CONTACT_ATTEMPTS: dict[str, tuple[int, float]] = {}
INQUIRY_LOCK = threading.Lock()
STATIC_FILES = {"index.html", "admin.html", "admin.css", "admin.js", "styles.css", "tailwind.config.js", "script.js", "rm-edits-logo-blue.svg"}


def read_json(path: Path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + secrets.token_hex(6) + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def get_content():
    return read_json(CONTENT_FILE, {})


def save_showreel_upload(data: dict) -> None:
    data_url = data.pop("showreelUpload", "")
    remove_video = data.pop("removeShowreel", False)
    thumbnail_url = data.pop("showreelThumbnailUpload", "")
    remove_thumbnail = data.pop("removeShowreelThumbnail", False)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    paths = [MEDIA_DIR / "showreel.mp4", MEDIA_DIR / "showreel.webm"]
    thumbnail_paths = [MEDIA_DIR / f"showreel-thumbnail.{extension}" for extension in ("jpg", "png", "webp")]
    if remove_video:
        for path in paths:
            path.unlink(missing_ok=True)
        data["showreelVideo"] = ""
        remove_thumbnail = True
    elif data_url:
        match = re.fullmatch(r"data:(video/mp4|video/webm);base64,([A-Za-z0-9+/]+={0,2})", data_url) if isinstance(data_url, str) else None
        if not match:
            raise ValueError("Upload an MP4 or WebM showreel video.")
        mime, encoded = match.groups()
        try:
            video = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("The selected showreel video could not be decoded.") from error
        is_mp4 = mime == "video/mp4" and len(video) >= 12 and video[4:8] == b"ftyp"
        is_webm = mime == "video/webm" and video.startswith(b"\x1aE\xdf\xa3")
        if not video or len(video) > 50 * 1024 * 1024:
            raise ValueError("The showreel video must be no larger than 50 MB.")
        if not (is_mp4 or is_webm):
            raise ValueError("The video file contents do not match its type. Choose an MP4 or WebM video.")
        extension = "mp4" if is_mp4 else "webm"
        target = MEDIA_DIR / f"showreel.{extension}"
        for path in paths:
            if path != target:
                path.unlink(missing_ok=True)
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_bytes(video)
        temporary.replace(target)
        data["showreelVideo"] = f"/media/{target.name}"
    if remove_thumbnail:
        for path in thumbnail_paths:
            path.unlink(missing_ok=True)
        data["showreelThumbnail"] = ""
    elif thumbnail_url and not remove_video:
        match = re.fullmatch(r"data:(image/jpeg|image/png|image/webp);base64,([A-Za-z0-9+/]+={0,2})", thumbnail_url) if isinstance(thumbnail_url, str) else None
        if not match:
            raise ValueError("Upload a JPG, PNG, or WebP showreel thumbnail.")
        mime, encoded = match.groups()
        try:
            image_data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("The selected thumbnail could not be decoded.") from error
        valid_signatures = {"image/jpeg": ("jpg", image_data.startswith(b"\xff\xd8\xff")), "image/png": ("png", image_data.startswith(b"\x89PNG\r\n\x1a\n")), "image/webp": ("webp", image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP")}
        extension, valid_signature = valid_signatures[mime]
        if not image_data or len(image_data) > 10 * 1024 * 1024:
            raise ValueError("The showreel thumbnail must be no larger than 10 MB.")
        if not valid_signature:
            raise ValueError("The thumbnail image contents do not match its type.")
        target = MEDIA_DIR / f"showreel-thumbnail.{extension}"
        for path in thumbnail_paths:
            if path != target:
                path.unlink(missing_ok=True)
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_bytes(image_data)
        temporary.replace(target)
        data["showreelThumbnail"] = f"/media/{target.name}"


def video_url_ok(value: str) -> bool:
    if not value:
        return True
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com", "vimeo.com", "www.vimeo.com", "player.vimeo.com"} and len(value) <= 500


def youtube_video_id(value: str) -> str:
    try:
        parsed = urlparse(value)
    except ValueError:
        return ""
    if parsed.scheme != "https" or not parsed.hostname or len(value) > 500:
        return ""
    if parsed.hostname in {"youtu.be", "www.youtu.be"}:
        candidate = parsed.path.strip("/").split("/")[0]
    elif parsed.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}:
        candidate = (dict(part.split("=", 1) for part in parsed.query.split("&") if "=" in part)).get("v", "")
        if not candidate:
            match = re.match(r"^/(?:embed|shorts|live)/([\w-]+)", parsed.path)
            candidate = match.group(1) if match else ""
    else:
        return ""
    return candidate if re.fullmatch(r"[\w-]{11}", candidate) else ""


def vercel_blob_url_ok(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and bool(re.fullmatch(r"[a-z0-9-]+\.public\.blob\.vercel-storage\.com", parsed.hostname or ""))
        and not parsed.username
        and not parsed.password
        and len(value) <= 2000
    )


def portfolio_category_for_video(title: str, description: str, youtube_category_id: str = "") -> tuple[str, str]:
    text = f"{title} {description}".lower()
    if re.search(r"\b(wedding|bride|groom|marriage|ceremony|engagement)\b", text):
        return "wedding", "Wedding Film"
    if re.search(r"\b(commercial|brand|advert|advertisement|promo|product|campaign)\b", text):
        return "commercial", "Commercial"
    if youtube_category_id == "10" or re.search(r"\b(music video|song|lyrics|lyric video|official audio)\b", text):
        return "music", "Music Video"
    return "youtube", "YouTube Video"


def save_color_preview_uploads(preview: dict) -> None:
    uploads = preview.pop("uploads", {})
    removals = preview.pop("removeImages", [])
    if not isinstance(uploads, dict) or not isinstance(removals, list) or any(not isinstance(key, str) for key in removals):
        raise ValueError("Choose valid color preview images.")
    keys = {"before", "grade-1", "grade-2", "grade-3", "grade-4"}
    if set(uploads) - keys or set(removals) - keys:
        raise ValueError("Choose valid color preview images.")
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    extension_by_type = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
    for key in removals:
        property_name = "beforeImage" if key == "before" else "imageUrl"
        if key == "before":
            preview[property_name] = ""
        else:
            index = int(key.split("-")[1]) - 1
            preview["gradeOptions"][index][property_name] = ""
        for extension in extension_by_type.values():
            (MEDIA_DIR / f"color-preview-{key}.{extension}").unlink(missing_ok=True)
    for key, data_url in uploads.items():
        match = re.fullmatch(r"data:(image/jpeg|image/png|image/webp);base64,([A-Za-z0-9+/]+={0,2})", data_url) if isinstance(data_url, str) else None
        if not match:
            raise ValueError("Use JPG, PNG, or WebP images for the color preview.")
        mime, encoded = match.groups()
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("One of the selected images could not be decoded.") from error
        if not content or len(content) > 10 * 1024 * 1024:
            raise ValueError("Each color preview image must be 10 MB or smaller.")
        valid_signature = (mime == "image/jpeg" and content.startswith(b"\xff\xd8\xff")) or (mime == "image/png" and content.startswith(b"\x89PNG\r\n\x1a\n")) or (mime == "image/webp" and content.startswith(b"RIFF") and content[8:12] == b"WEBP")
        if not valid_signature:
            raise ValueError("The image file type did not match its contents.")
        extension = extension_by_type[mime]
        for old_extension in extension_by_type.values():
            old_path = MEDIA_DIR / f"color-preview-{key}.{old_extension}"
            if old_extension != extension:
                old_path.unlink(missing_ok=True)
        path = MEDIA_DIR / f"color-preview-{key}.{extension}"
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_bytes(content)
        temporary.replace(path)
        image_path = f"/media/{path.name}"
        if key == "before":
            preview["beforeImage"] = image_path
        else:
            index = int(key.split("-")[1]) - 1
            preview["gradeOptions"][index]["imageUrl"] = image_path


class Handler(BaseHTTPRequestHandler):
    server_version = "PortfolioServer"

    def log_message(self, fmt, *args):
        # Keep routine requests quiet; Python's default logs include client data.
        return

    def reply(self, status: int, body, content_type="application/json; charset=utf-8", headers=None):
        payload = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False))
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def body_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length > 145_000_000:
            raise ValueError("Request is too large.")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        expected_host = self.headers.get("Host", "").lower()
        return parsed.netloc.lower() == expected_host and parsed.scheme in ("http", "https")

    def session_token(self):
        for part in self.headers.get("Cookie", "").split(";"):
            key, _, value = part.strip().partition("=")
            if key == "rana_admin_session":
                return value
        return ""

    def authenticated(self):
        token = self.session_token()
        expiry = SESSIONS.get(token, 0)
        if not token or expiry <= time.time():
            SESSIONS.pop(token, None)
            return False
        SESSIONS[token] = time.time() + 8 * 60 * 60
        return True

    def cookie(self, token, age=28800):
        cipher = getattr(self.connection, "cipher", lambda: None)
        secure = cipher() is not None or self.headers.get("X-Forwarded-Proto") == "https"
        value = f"rana_admin_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}"
        return value + ("; Secure" if secure else "")

    def client_key(self):
        return self.client_address[0]

    def public_content(self):
        content = get_content()
        return {key: content.get(key) for key in (
            "brandName", "role", "availability", "heroTitle", "heroDescription", "email",
            "contactHeading", "contactIntro", "contactEyebrow", "contactDirectLabel", "copyEmailLabel",
            "contactWorkflowTitle", "contactWorkflowDetails", "contactFormTitle", "contactFormBadge",
            "contactSubmitLabel", "contactPrivacyNote", "servicesHeading", "servicesIntro", "services",
            "showreelVideo", "showreelThumbnail", "showreelYoutubeUrl", "pricingEnabled", "pricing", "projects", "colorPreview"
        )}

    def do_GET(self):
        route = urlparse(self.path).path
        if route.startswith("/media/"):
            media_name = route.removeprefix("/media/")
            if not re.fullmatch(r"(?:color-preview-(?:before|grade-[1-4])\.(?:jpg|png|webp)|showreel\.(?:mp4|webm)|showreel-thumbnail\.(?:jpg|png|webp))", media_name):
                return self.reply(404, "Not found.", "text/plain; charset=utf-8")
            media_path = MEDIA_DIR / media_name
            if not media_path.is_file():
                return self.reply(404, "Not found.", "text/plain; charset=utf-8")
            mime = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "mp4": "video/mp4", "webm": "video/webm"}[media_path.suffix[1:]]
            if media_path.suffix in {".mp4", ".webm"}:
                size = media_path.stat().st_size
                requested_range = self.headers.get("Range", "")
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested_range)
                if match:
                    start = int(match.group(1) or 0)
                    end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
                    if start >= size or end < start:
                        return self.reply(416, b"", "video/mp4", {"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes"})
                    payload = media_path.open("rb")
                    payload.seek(start)
                    chunk = payload.read(end - start + 1)
                    payload.close()
                    return self.reply(206, chunk, mime, {"Content-Range": f"bytes {start}-{start + len(chunk) - 1}/{size}", "Accept-Ranges": "bytes"})
                return self.reply(200, media_path.read_bytes(), mime, {"Accept-Ranges": "bytes"})
            return self.reply(200, media_path.read_bytes(), mime)
        if route == "/api/public/content":
            return self.reply(200, self.public_content())
        if route == "/api/admin/status":
            return self.reply(200, {"configured": USER_FILE.exists(), "authenticated": self.authenticated()})
        if route.startswith("/api/admin/"):
            if not self.authenticated():
                return self.reply(401, {"error": "Please log in again."})
            if route == "/api/admin/content":
                return self.reply(200, get_content())
            if route == "/api/admin/inquiries":
                return self.reply(200, read_json(INQUIRIES_FILE, []))
            return self.reply(404, {"error": "Not found."})

        if route == "/":
            name = "index.html"
        else:
            name = unquote(route.lstrip("/"))
        if name not in STATIC_FILES:
            return self.reply(404, "Not found.", "text/plain; charset=utf-8")
        file_path = PUBLIC_DIR / name
        if not file_path.is_file():
            return self.reply(404, "Not found.", "text/plain; charset=utf-8")
        mime = "image/svg+xml" if name.endswith(".svg") else "text/html; charset=utf-8" if name.endswith(".html") else "text/css; charset=utf-8" if name.endswith(".css") else "text/javascript; charset=utf-8"
        return self.reply(200, file_path.read_bytes(), mime)

    def do_POST(self):
        route = urlparse(self.path).path
        if route.startswith("/api/admin/") and not self.origin_ok():
            return self.reply(403, {"error": "Request origin was rejected."})
        if route == "/api/public/contact":
            if not self.origin_ok():
                return self.reply(403, {"error": "Request origin was rejected."})
            key = self.client_key()
            count, start = CONTACT_ATTEMPTS.get(key, (0, time.time()))
            if time.time() - start > 900:
                count, start = 0, time.time()
            if count >= 5:
                return self.reply(429, {"error": "Please wait a little while before sending another inquiry."})
            try:
                data = self.body_json()
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                return self.reply(400, {"error": "Please check the form and try again."})
            if data.get("website"):
                return self.reply(201, {"ok": True})
            name = str(data.get("name", "")).strip()
            email = str(data.get("email", "")).strip()
            message = str(data.get("message", "")).strip()
            project = str(data.get("project", "")).strip()
            budget = str(data.get("budget", "")).strip()
            reference = str(data.get("reference", "")).strip()
            if not name or len(name) > 120 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254 or not message or len(message) > 5000:
                return self.reply(400, {"error": "Enter a valid name, email, and project brief."})
            if len(project) > 120 or len(budget) > 120 or len(reference) > 500 or (reference and not reference.startswith("https://")):
                return self.reply(400, {"error": "Please check the project type, budget, or reference link."})
            with INQUIRY_LOCK:
                entries = read_json(INQUIRIES_FILE, [])
                entries.insert(0, {"id": secrets.token_hex(8), "name": name, "email": email, "project": project, "budget": budget or "Flexible", "reference": reference, "message": message, "createdAt": datetime.now(timezone.utc).isoformat()})
                write_json(INQUIRIES_FILE, entries[:1000])
            CONTACT_ATTEMPTS[key] = (count + 1, start)
            return self.reply(201, {"ok": True})
        if route == "/api/admin/video-metadata":
            if not self.authenticated():
                return self.reply(401, {"error": "Please log in again."})
            try:
                data = self.body_json()
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                return self.reply(400, {"error": "Invalid video link request."})
            video_url = data.get("videoUrl", "")
            if not isinstance(video_url, str) or not video_url or len(video_url) > 500 or not video_url_ok(video_url):
                return self.reply(400, {"error": "Paste a valid public YouTube or Vimeo link first."})
            video_host = (urlparse(video_url).hostname or "").lower()
            provider = "www.youtube.com" if "youtube" in video_host or video_host == "youtu.be" else "vimeo.com"
            metadata_url = f"https://{provider}/oembed?url={quote(video_url, safe='')}&format=json"
            try:
                request = Request(metadata_url, headers={"User-Agent": "RM-Edits portfolio editor/1.0", "Accept": "application/json"})
                with urlopen(request, timeout=8) as response:
                    metadata = json.loads(response.read(500_001).decode("utf-8"))
                title = metadata.get("title")
                if not isinstance(title, str) or not title.strip():
                    raise ValueError("No title was returned for this video.")
                category, category_label = portfolio_category_for_video(title, "")
                return self.reply(200, {"title": title[:300], "category": category, "categoryLabel": category_label, "message": "Project name and a suggested category filled from the video title. Enter duration and views manually."})
            except Exception:
                return self.reply(422, {"error": "Could not get details for this video. Check that the link is public and try again."})
        if route == "/api/admin/setup":
            if USER_FILE.exists():
                return self.reply(409, {"error": "Admin is already configured. Please log in."})
            try:
                data = self.body_json()
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                return self.reply(400, {"error": "Invalid request."})
            username, password = data.get("username"), data.get("password")
            if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", username):
                return self.reply(400, {"error": "Username must be 3–40 letters, numbers, dots, underscores, or hyphens."})
            if not isinstance(password, str) or not 12 <= len(password) <= 200:
                return self.reply(400, {"error": "Use a password with at least 12 characters."})
            salt = secrets.token_bytes(16)
            digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=64)
            PRIVATE.mkdir(parents=True, exist_ok=True)
            try:
                with USER_FILE.open("x", encoding="utf-8") as handle:
                    json.dump({"username": username, "salt": salt.hex(), "hash": digest.hex()}, handle)
            except FileExistsError:
                return self.reply(409, {"error": "Admin setup has already been completed."})
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = time.time() + 8 * 60 * 60
            return self.reply(201, {"ok": True}, headers={"Set-Cookie": self.cookie(token)})

        if route == "/api/admin/login":
            key = self.client_key()
            count, until = LOGIN_ATTEMPTS.get(key, (0, 0))
            if until > time.time():
                return self.reply(429, {"error": "Too many attempts. Wait a few minutes and try again."})
            try:
                data = self.body_json()
            except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
                return self.reply(400, {"error": "Invalid request."})
            user = read_json(USER_FILE, None)
            valid = False
            if user and isinstance(data.get("username"), str) and isinstance(data.get("password"), str):
                digest = hashlib.scrypt(data["password"].encode(), salt=bytes.fromhex(user["salt"]), n=2**14, r=8, p=1, dklen=64)
                valid = data["username"] == user["username"] and hmac.compare_digest(digest.hex(), user["hash"])
            if not valid:
                count += 1
                LOGIN_ATTEMPTS[key] = (0, time.time() + 300) if count >= 5 else (count, 0)
                return self.reply(401, {"error": "Username or password is incorrect."})
            LOGIN_ATTEMPTS.pop(key, None)
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = time.time() + 8 * 60 * 60
            return self.reply(200, {"ok": True}, headers={"Set-Cookie": self.cookie(token)})

        if route == "/api/admin/logout":
            SESSIONS.pop(self.session_token(), None)
            return self.reply(200, {"ok": True}, headers={"Set-Cookie": self.cookie("", 0)})

        return self.reply(404, {"error": "Not found."})

    def do_PUT(self):
        route = urlparse(self.path).path
        if route != "/api/admin/content":
            return self.reply(404, {"error": "Not found."})
        if not self.authenticated():
            return self.reply(401, {"error": "Please log in again."})
        if not self.origin_ok():
            return self.reply(403, {"error": "Request origin was rejected."})
        try:
            data = self.body_json()
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            return self.reply(400, {"error": "Invalid request."})
        error = self.validate_content(data)
        if error:
            return self.reply(400, {"error": error})
        try:
            save_showreel_upload(data)
            save_color_preview_uploads(data["colorPreview"])
        except (ValueError, OSError) as error:
            return self.reply(400, {"error": str(error)})
        write_json(CONTENT_FILE, data)
        return self.reply(200, {"ok": True})

    def do_DELETE(self):
        route = urlparse(self.path).path
        prefix = "/api/admin/inquiries/"
        if not route.startswith(prefix) or not self.authenticated():
            return self.reply(401, {"error": "Please log in again."})
        if not self.origin_ok():
            return self.reply(403, {"error": "Request origin was rejected."})
        inquiry_id = route[len(prefix):]
        if not re.fullmatch(r"[a-f0-9]{16}", inquiry_id):
            return self.reply(400, {"error": "Invalid inquiry."})
        with INQUIRY_LOCK:
            entries = read_json(INQUIRIES_FILE, [])
            updated = [entry for entry in entries if entry.get("id") != inquiry_id]
            write_json(INQUIRIES_FILE, updated)
        return self.reply(200, {"ok": True})

    @staticmethod
    def validate_content(data):
        required = ("brandName", "role", "availability", "heroTitle", "heroDescription", "email", "contactHeading", "contactIntro", "contactEyebrow", "contactDirectLabel", "copyEmailLabel", "contactWorkflowTitle", "contactWorkflowDetails", "contactFormTitle", "contactFormBadge", "contactSubmitLabel", "contactPrivacyNote", "servicesHeading", "servicesIntro")
        if not isinstance(data, dict) or not isinstance(data.get("projects"), list) or len(data["projects"]) > 60:
            return "Invalid portfolio data."
        for field in required:
            if not isinstance(data.get(field), str) or len(data[field]) > 1200:
                return f"Check the {field} field."
        showreel_video = data.get("showreelVideo", "")
        if showreel_video and (not isinstance(showreel_video, str) or not (re.fullmatch(r"/media/showreel\.(?:mp4|webm)", showreel_video) or vercel_blob_url_ok(showreel_video))):
            return "Choose a valid showreel video."
        showreel_youtube_url = data.get("showreelYoutubeUrl", "")
        if not isinstance(showreel_youtube_url, str) or (showreel_youtube_url and not youtube_video_id(showreel_youtube_url)):
            return "Enter a valid YouTube showreel link."
        showreel_thumbnail = data.get("showreelThumbnail", "")
        if showreel_thumbnail and (not isinstance(showreel_thumbnail, str) or not (re.fullmatch(r"/media/showreel-thumbnail\.(?:jpg|png|webp)", showreel_thumbnail) or vercel_blob_url_ok(showreel_thumbnail))):
            return "Choose a valid showreel thumbnail."
        if not isinstance(data.get("showreelUpload", ""), str) or not isinstance(data.get("removeShowreel", False), bool) or not isinstance(data.get("showreelThumbnailUpload", ""), str) or not isinstance(data.get("removeShowreelThumbnail", False), bool):
            return "Choose a valid showreel video file."
        if not isinstance(data.get("pricingEnabled"), bool):
            return "Check whether the quote calculator should be shown."
        preview = data.get("colorPreview", {})
        if not isinstance(preview, dict):
            return "Check the color preview settings."
        preview_fields = ("eyebrow", "title", "description", "beforeLabel", "afterLabel", "nodeTree")
        if any(not isinstance(preview.get(field, ""), str) or len(preview.get(field, "")) > 500 for field in preview_fields):
            return "Check the color preview text fields."
        if not isinstance(preview.get("split", 55), int) or not 0 <= preview.get("split", 55) <= 100:
            return "The color comparison split must be between 0 and 100."
        def valid_saved_image(path):
            return path == "" or (isinstance(path, str) and (bool(re.fullmatch(r"/media/color-preview-(?:before|grade-[1-4])\.(?:jpg|png|webp)", path)) or vercel_blob_url_ok(path)))
        if not valid_saved_image(preview.get("beforeImage", "")):
            return "Choose a valid before image."
        grade_options = preview.get("gradeOptions", [])
        if not isinstance(grade_options, list) or len(grade_options) != 4:
            return "Add all four graded image options."
        for option in grade_options:
            if not isinstance(option, dict) or not isinstance(option.get("label"), str) or not option["label"].strip() or len(option["label"]) > 60 or not valid_saved_image(option.get("imageUrl", "")):
                return "Check the name and image for each graded option."
        uploads = preview.get("uploads", {})
        removals = preview.get("removeImages", [])
        image_keys = {"before", "grade-1", "grade-2", "grade-3", "grade-4"}
        if not isinstance(uploads, dict) or set(uploads) - image_keys or any(not isinstance(value, str) for value in uploads.values()):
            return "Choose valid color preview image files."
        if not isinstance(removals, list) or any(not isinstance(key, str) for key in removals) or set(removals) - image_keys:
            return "Choose valid images to remove."
        if not isinstance(data.get("services"), list) or len(data["services"]) != 4:
            return "Please keep all four service cards and check their fields."
        for service in data["services"]:
            if not isinstance(service, dict) or any(not isinstance(service.get(field), str) or len(service[field]) > 1200 for field in ("title", "description", "buttonLabel")):
                return "Check each service card field."
        pricing = data.get("pricing")
        if not isinstance(pricing, dict) or not isinstance(pricing.get("baseRatesInr"), dict):
            return "Check your quote calculator prices."
        for value in [*pricing["baseRatesInr"].values(), *[pricing.get(key) for key in ("perMinuteInr", "motionInr", "colorInr", "soundInr", "rushInr", "usdRate")]]:
            if not isinstance(value, (int, float)) or value < 0 or value > 10000000:
                return "Quote calculator prices must be numbers from 0 to 10,000,000."
        if pricing.get("usdRate", 0) <= 0:
            return "The INR per USD display rate must be greater than zero."
        type_labels = pricing.get("typeLabels", {})
        allowed_types = {"youtube", "reels", "commercial", "music", "wedding"}
        if not isinstance(type_labels, dict) or any(
            key not in allowed_types or not isinstance(label, str) or not label.strip() or len(label) > 100
            for key, label in type_labels.items()
        ):
            return "Check the estimator option names."
        service_rates = pricing.get("serviceRates", {})
        if not isinstance(service_rates, dict) or any(key not in allowed_types for key in service_rates):
            return "Check the per-service estimator settings."
        for key, config in service_rates.items():
            if not isinstance(config, dict):
                return "Check the per-service estimator settings."
            label = config.get("label")
            if not isinstance(label, str) or not label.strip() or len(label) > 100:
                return "Each estimator service needs a name of 1 to 100 characters."
            if not isinstance(config.get("baseIncludes", ""), str) or len(config.get("baseIncludes", "")) > 1200:
                return "Describe the base project scope in 1,200 characters or fewer."
            if config.get("billingUnit") not in {"minute", "video"}:
                return "Choose whether each estimator service is charged per minute or per video."
            price_fields = ["rateInr", "motionInr", "colorInr", "soundInr", "rushInr"]
            if config.get("billingUnit") == "minute":
                price_fields.append("extraMinuteRateInr")
            for field in price_fields:
                value = config.get(field)
                if not isinstance(value, (int, float)) or value < 0 or value > 10000000:
                    return "Per-service prices must be numbers from 0 to 10,000,000."
            if config.get("billingUnit") == "video":
                quantity = config.get("defaultQuantity")
                if not isinstance(quantity, int) or isinstance(quantity, bool) or not 1 <= quantity <= 30:
                    return "Each video service default count must be between 1 and 30."
        for project in data["projects"]:
            if not isinstance(project, dict):
                return "Check each project."
            for field in ("id", "title", "category", "categoryLabel", "views", "duration", "tools", "accent", "desc", "videoUrl", "thumbnailUrl"):
                if not isinstance(project.get(field, ""), str) or len(project.get(field, "")) > 1200:
                    return "Check each project field."
            if project.get("category", "") not in {"", "commercial", "youtube", "music", "wedding"}:
                return "Choose a valid portfolio project category."
            if not video_url_ok(project.get("videoUrl", "")):
                return "Project video links must use https."
            thumbnail = project.get("thumbnailUrl", "")
            parsed_thumbnail = urlparse(thumbnail)
            secure_image_url = parsed_thumbnail.scheme == "https" and bool(parsed_thumbnail.hostname) and not parsed_thumbnail.username and not parsed_thumbnail.password and len(thumbnail) <= 1200
            local_image_path = thumbnail.startswith("/") and not thumbnail.startswith("//") and ".." not in thumbnail
            if thumbnail and not (secure_image_url or local_image_path):
                return "Project thumbnails must use an https image URL or a site-relative path."
            if project.get("accent") and not re.fullmatch(r"#[0-9a-fA-F]{6}", project["accent"]):
                return "Project accent colors must use a six-digit hex value, such as #f59e0b."
        return None


def main():
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    print(f"Portfolio running at http://{HOST}:{PORT} (admin: /admin.html)")
    main()
