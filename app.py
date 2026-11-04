"""Vercel-ready API and static-file application for RM-Edits."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import psycopg
from fastapi import FastAPI, HTTPException, Request as WebRequest, Response
from fastapi.responses import FileResponse, JSONResponse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from starlette.exceptions import HTTPException as StarletteHTTPException
from vercel import blob

from server import Handler, portfolio_category_for_video, send_inquiry_notification, vercel_blob_url_ok, video_url_ok, youtube_video_id

ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
MEDIA_DIR = PUBLIC_DIR / "media"
STATIC_FILES = {"index.html", "admin.html", "admin.css", "admin.js", "styles.css", "tailwind.config.js", "script.js", "rm-edits-logo-blue.svg", "robots.txt", "sitemap.xml"}
SESSION_COOKIE = "rana_admin_session"
SESSION_SECONDS = 8 * 60 * 60
MAX_UPLOAD_CHUNK = 4 * 1024 * 1024
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def add_security_headers(request: WebRequest, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(StarletteHTTPException)
async def api_error_response(_request: WebRequest, error: StarletteHTTPException):
    message = error.detail if isinstance(error.detail, str) else "The request could not be completed."
    return JSONResponse({"error": message}, status_code=error.status_code, headers=error.headers)


async def put_blob(pathname: str, body: bytes, **options):
    options = dict(options)
    multipart = options.pop("multipart", False)
    if multipart:
        part_size = 5 * 1024 * 1024
        async with blob.multipart_upload_blob(pathname, **options) as upload:
            for offset in range(0, len(body), part_size):
                await upload.upload_part(body[offset:offset + part_size])
        return upload.result
    return await blob.put_blob(pathname, body, **options)


async def delete_blobs(urls: list[str]) -> None:
    await blob.delete_blob(urls)


def database_connection():
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not dsn:
        raise HTTPException(503, "Connect a Postgres database and set DATABASE_URL in Vercel.")
    try:
        return psycopg.connect(dsn, row_factory=dict_row)
    except psycopg.Error as error:
        raise HTTPException(503, "The database is not available. Check the Vercel DATABASE_URL setting.") from error


def ensure_schema(connection) -> None:
    connection.execute("""
        CREATE TABLE IF NOT EXISTS rm_site_content (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            payload JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS rm_admin_user (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            username TEXT NOT NULL UNIQUE,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS rm_admin_sessions (
            token_hash TEXT PRIMARY KEY,
            expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rm_admin_login_attempts (
            client_key TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS rm_contact_attempts (
            client_key TEXT PRIMARY KEY,
            window_started_at TIMESTAMPTZ NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS rm_inquiries (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            project TEXT NOT NULL,
            budget TEXT NOT NULL,
            reference TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS rm_uploads (
            id TEXT PRIMARY KEY,
            asset_key TEXT NOT NULL,
            content_type TEXT NOT NULL,
            file_size BIGINT NOT NULL,
            chunk_count INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS rm_upload_chunks (
            upload_id TEXT NOT NULL REFERENCES rm_uploads(id) ON DELETE CASCADE,
            part_number INTEGER NOT NULL,
            blob_url TEXT NOT NULL,
            PRIMARY KEY (upload_id, part_number)
        );
        CREATE TABLE IF NOT EXISTS rm_uploaded_media (
            blob_url TEXT PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)


def ensure_default_content(connection) -> dict:
    row = connection.execute("SELECT payload FROM rm_site_content WHERE id = 1").fetchone()
    if row:
        return row["payload"]
    path = ROOT / "site-content.json"
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise HTTPException(500, "The starter portfolio content could not be loaded.") from error
    connection.execute(
        "INSERT INTO rm_site_content (id, payload) VALUES (1, %s) ON CONFLICT (id) DO NOTHING",
        (Jsonb(content),),
    )
    row = connection.execute("SELECT payload FROM rm_site_content WHERE id = 1").fetchone()
    return row["payload"]


def open_database():
    connection = database_connection()
    try:
        ensure_schema(connection)
        yield connection
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def public_content(content: dict) -> dict:
    fields = (
        "brandName", "role", "availability", "heroTitle", "heroDescription", "email",
        "contactHeading", "contactIntro", "contactEyebrow", "contactDirectLabel", "copyEmailLabel",
        "contactWorkflowTitle", "contactWorkflowDetails", "contactFormTitle", "contactFormBadge",
        "contactSubmitLabel", "contactPrivacyNote", "servicesHeading", "servicesIntro", "services",
        "showreelVideo", "showreelThumbnail", "showreelYoutubeUrl", "pricingEnabled", "pricing", "packageConfig", "projects", "colorPreview"
    )
    result = {key: content.get(key) for key in fields}
    # Older production database rows predate the editable package section. Keep
    # existing database settings authoritative, but serve the bundled defaults
    # until an admin saves package settings for the first time.
    if not isinstance(result.get("packageConfig"), dict):
        try:
            defaults = json.loads((ROOT / "site-content.json").read_text(encoding="utf-8"))
            result["packageConfig"] = defaults.get("packageConfig")
        except (OSError, json.JSONDecodeError):
            pass
    return result


def request_client_key(request: WebRequest, secret: str = "contact") -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    address = forwarded.split(",", 1)[0].strip() or (request.client.host if request.client else "unknown")
    return hashlib.sha256(f"{secret}:{address}".encode("utf-8")).hexdigest()


def session_token_hash(request: WebRequest) -> tuple[str, str]:
    token = request.cookies.get(SESSION_COOKIE, "")
    return token, hashlib.sha256(token.encode("utf-8")).hexdigest() if token else ""


def authenticated(connection, request: WebRequest, refresh: bool = True) -> bool:
    token, token_hash = session_token_hash(request)
    if not token:
        return False
    row = connection.execute(
        "SELECT expires_at FROM rm_admin_sessions WHERE token_hash = %s AND expires_at > now()",
        (token_hash,),
    ).fetchone()
    if not row:
        return False
    if refresh:
        connection.execute(
            "UPDATE rm_admin_sessions SET expires_at = now() + interval '8 hours' WHERE token_hash = %s",
            (token_hash,),
        )
    return True


def require_admin(connection, request: WebRequest) -> None:
    if not authenticated(connection, request):
        raise HTTPException(401, "Please log in again.")


def check_same_origin(request: WebRequest) -> None:
    origin = request.headers.get("origin")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if not origin or not host:
        raise HTTPException(403, "Request origin was rejected.")
    parsed = urlparse(origin)
    if parsed.netloc.lower() != host.split(",", 1)[0].strip().lower() or parsed.scheme not in {"https", "http"}:
        raise HTTPException(403, "Request origin was rejected.")


def set_session_cookie(response: Response, token: str, age: int = SESSION_SECONDS) -> None:
    response.set_cookie(SESSION_COOKIE, token, max_age=age, httponly=True, secure=True, samesite="strict", path="/")


def password_record(password: str) -> tuple[str, str]:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return salt.hex(), digest.hex()


def password_matches(password: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=64).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, hash_hex)


async def read_json_body(request: WebRequest, maximum: int = 1_000_000) -> dict:
    raw = await request.body()
    if len(raw) > maximum:
        raise HTTPException(413, "The request is too large.")
    try:
        data = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(400, "Invalid request.") from error
    if not isinstance(data, dict):
        raise HTTPException(400, "Invalid request.")
    return data


def collect_blob_urls(value) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for child in value.values():
            found.update(collect_blob_urls(child))
    elif isinstance(value, list):
        for child in value:
            found.update(collect_blob_urls(child))
    elif isinstance(value, str) and vercel_blob_url_ok(value):
        found.add(value)
    return found


def file_extension(content_type: str) -> str:
    return {"video/mp4": "mp4", "video/webm": "webm", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[content_type]


def validate_upload(asset_key: str, content_type: str, size: int) -> int:
    allowed = {
        "showreelVideo": {"video/mp4": 50 * 1024 * 1024, "video/webm": 50 * 1024 * 1024},
        "showreelThumbnail": {"image/jpeg": 10 * 1024 * 1024, "image/png": 10 * 1024 * 1024, "image/webp": 10 * 1024 * 1024},
        "colorPreview:before": {"image/jpeg": 10 * 1024 * 1024, "image/png": 10 * 1024 * 1024, "image/webp": 10 * 1024 * 1024},
        **{f"colorPreview:grade-{index}": {"image/jpeg": 10 * 1024 * 1024, "image/png": 10 * 1024 * 1024, "image/webp": 10 * 1024 * 1024} for index in range(1, 5)},
    }
    maximum = allowed.get(asset_key, {}).get(content_type)
    if maximum is None or not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= maximum:
        raise HTTPException(400, "Choose a supported image or video within its upload size limit.")
    return maximum


def upload_path(asset_key: str, upload_id: str, content_type: str) -> str:
    suffix = file_extension(content_type)
    basename = {
        "showreelVideo": "showreel",
        "showreelThumbnail": "showreel-thumbnail",
        "colorPreview:before": "color-preview-before",
        **{f"colorPreview:grade-{index}": f"color-preview-grade-{index}" for index in range(1, 5)},
    }[asset_key]
    return f"portfolio/{basename}-{upload_id}.{suffix}"


def media_type_from_signature(content_type: str, data: bytes) -> bool:
    return (
        (content_type == "video/mp4" and len(data) >= 12 and data[4:8] == b"ftyp")
        or (content_type == "video/webm" and data.startswith(b"\x1aE\xdf\xa3"))
        or (content_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"))
        or (content_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
        or (content_type == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP")
    )


@app.get("/api/public/content")
def get_public_content():
    with database_connection() as connection:
        ensure_schema(connection)
        content = ensure_default_content(connection)
    return public_content(content)


@app.get("/api/admin/status")
def get_admin_status(request: WebRequest):
    with database_connection() as connection:
        ensure_schema(connection)
        configured = connection.execute("SELECT 1 FROM rm_admin_user WHERE id = 1").fetchone() is not None
        is_authenticated = authenticated(connection, request)
    return {"configured": configured, "authenticated": is_authenticated, "storageMode": "vercel"}


@app.post("/api/admin/setup")
async def setup_admin(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request)
    setup_secret = os.environ.get("ADMIN_SETUP_SECRET", "")
    if len(setup_secret) < 24 or not hmac.compare_digest(str(data.get("setupKey", "")), setup_secret):
        raise HTTPException(403, "The one-time setup key is missing or incorrect. Set ADMIN_SETUP_SECRET in Vercel first.")
    username = data.get("username")
    password = data.get("password")
    if not isinstance(username, str) or not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", username):
        raise HTTPException(400, "Username must be 3–40 letters, numbers, dots, underscores, or hyphens.")
    if not isinstance(password, str) or not 12 <= len(password) <= 200:
        raise HTTPException(400, "Use a password with at least 12 characters.")
    salt, password_hash = password_record(password)
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with database_connection() as connection:
        ensure_schema(connection)
        if connection.execute("SELECT 1 FROM rm_admin_user WHERE id = 1").fetchone():
            raise HTTPException(409, "Admin setup has already been completed. Please log in.")
        connection.execute(
            "INSERT INTO rm_admin_user (id, username, salt, password_hash) VALUES (1, %s, %s, %s)",
            (username, salt, password_hash),
        )
        connection.execute(
            "INSERT INTO rm_admin_sessions (token_hash, expires_at) VALUES (%s, now() + interval '8 hours')",
            (token_hash,),
        )
        ensure_default_content(connection)
    response = JSONResponse({"ok": True})
    set_session_cookie(response, token)
    return response


@app.post("/api/admin/login")
async def login_admin(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request)
    username, password = data.get("username"), data.get("password")
    key = request_client_key(request, "admin-login")
    with database_connection() as connection:
        ensure_schema(connection)
        attempt = connection.execute("SELECT attempts, locked_until FROM rm_admin_login_attempts WHERE client_key = %s", (key,)).fetchone()
        if attempt and attempt["locked_until"] and attempt["locked_until"] > datetime.now(timezone.utc):
            raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
        user = connection.execute("SELECT username, salt, password_hash FROM rm_admin_user WHERE id = 1").fetchone()
        valid = bool(
            user
            and isinstance(username, str)
            and isinstance(password, str)
            and hmac.compare_digest(username, user["username"])
            and password_matches(password, user["salt"], user["password_hash"])
        )
        if not valid:
            tries = (attempt["attempts"] if attempt else 0) + 1
            locked_until = datetime.now(timezone.utc) + timedelta(minutes=5) if tries >= 5 else None
            connection.execute(
                "INSERT INTO rm_admin_login_attempts (client_key, attempts, locked_until) VALUES (%s, %s, %s) "
                "ON CONFLICT (client_key) DO UPDATE SET attempts = EXCLUDED.attempts, locked_until = EXCLUDED.locked_until",
                (key, tries, locked_until),
            )
            connection.commit()
            raise HTTPException(401, "Username or password is incorrect.")
        connection.execute("DELETE FROM rm_admin_login_attempts WHERE client_key = %s", (key,))
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        connection.execute("INSERT INTO rm_admin_sessions (token_hash, expires_at) VALUES (%s, now() + interval '8 hours')", (token_hash,))
    response = JSONResponse({"ok": True})
    set_session_cookie(response, token)
    return response


@app.post("/api/admin/logout")
def logout_admin(request: WebRequest):
    check_same_origin(request)
    _, token_hash = session_token_hash(request)
    if token_hash:
        with database_connection() as connection:
            ensure_schema(connection)
            connection.execute("DELETE FROM rm_admin_sessions WHERE token_hash = %s", (token_hash,))
    response = JSONResponse({"ok": True})
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    return response


@app.get("/api/admin/content")
def get_admin_content(request: WebRequest):
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        return ensure_default_content(connection)


@app.put("/api/admin/content")
async def update_admin_content(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request, maximum=2_000_000)
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        previous = ensure_default_content(connection)
        error = Handler.validate_content(data)
        if error:
            raise HTTPException(400, error)

        if data.pop("removeShowreel", False):
            data["showreelVideo"] = ""
            data["showreelThumbnail"] = ""
            data["removeShowreelThumbnail"] = True
        if data.pop("removeShowreelThumbnail", False):
            data["showreelThumbnail"] = ""
        preview = data.get("colorPreview", {})
        for key in preview.pop("removeImages", []):
            if key == "before":
                preview["beforeImage"] = ""
            elif re.fullmatch(r"grade-[1-4]", key):
                preview["gradeOptions"][int(key.split("-")[1]) - 1]["imageUrl"] = ""
        preview.pop("uploads", None)
        data.pop("showreelUpload", None)
        data.pop("showreelThumbnailUpload", None)
        data.pop("removeShowreelThumbnail", None)

        connection.execute(
            "UPDATE rm_site_content SET payload = %s, updated_at = now() WHERE id = 1",
            (Jsonb(data),),
        )
        current_urls = collect_blob_urls(data)
        old_urls = collect_blob_urls(previous)
        uploads = connection.execute("SELECT blob_url FROM rm_uploaded_media").fetchall()
        temporary_urls = {row["blob_url"] for row in uploads}
        retired_urls = (old_urls | temporary_urls) - current_urls
        connection.execute("DELETE FROM rm_uploaded_media")
        connection.commit()

    if retired_urls:
        try:
            await delete_blobs(list(retired_urls))
        except Exception:
            # Content updates should succeed even if Blob cleanup needs a retry.
            pass
    return {"ok": True}


@app.get("/api/admin/inquiries")
def get_admin_inquiries(request: WebRequest):
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        rows = connection.execute(
            "SELECT id, name, email, project, budget, reference, message, created_at FROM rm_inquiries ORDER BY created_at DESC LIMIT 1000"
        ).fetchall()
    return [{key: value for key, value in row.items() if key != "created_at"} | {"createdAt": row["created_at"].isoformat()} for row in rows]


@app.delete("/api/admin/inquiries/{inquiry_id}")
def delete_admin_inquiry(inquiry_id: str, request: WebRequest):
    check_same_origin(request)
    if not re.fullmatch(r"[a-f0-9]{16}", inquiry_id):
        raise HTTPException(400, "Invalid inquiry.")
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        connection.execute("DELETE FROM rm_inquiries WHERE id = %s", (inquiry_id,))
    return {"ok": True}


@app.post("/api/public/contact", status_code=201)
async def submit_contact(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request, maximum=20_000)
    if data.get("website"):
        return {"ok": True}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip()
    message = str(data.get("message", "")).strip()
    project = str(data.get("project", "")).strip()
    budget = str(data.get("budget", "")).strip() or "Flexible"
    reference = str(data.get("reference", "")).strip()
    if not name or len(name) > 120 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254 or not message or len(message) > 5000:
        raise HTTPException(400, "Enter a valid name, email, and project brief.")
    if len(project) > 120 or len(budget) > 120 or len(reference) > 500 or (reference and (not reference.startswith("https://") or urlparse(reference).hostname is None)):
        raise HTTPException(400, "Please check the project type, budget, or reference link.")
    key = request_client_key(request)
    inquiry_id = secrets.token_hex(8)
    with database_connection() as connection:
        ensure_schema(connection)
        row = connection.execute(
            "INSERT INTO rm_contact_attempts (client_key, window_started_at, attempts) VALUES (%s, now(), 1) "
            "ON CONFLICT (client_key) DO UPDATE SET "
            "attempts = CASE WHEN rm_contact_attempts.window_started_at < now() - interval '15 minutes' THEN 1 ELSE rm_contact_attempts.attempts + 1 END, "
            "window_started_at = CASE WHEN rm_contact_attempts.window_started_at < now() - interval '15 minutes' THEN now() ELSE rm_contact_attempts.window_started_at END "
            "RETURNING attempts",
            (key,),
        ).fetchone()
        if row["attempts"] > 5:
            raise HTTPException(429, "Please wait a little while before sending another inquiry.")
        connection.execute(
            "INSERT INTO rm_inquiries (id, name, email, project, budget, reference, message) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (inquiry_id, name, email, project, budget, reference, message),
        )
    await asyncio.to_thread(send_inquiry_notification, {
        "name": name, "email": email, "project": project, "budget": budget,
        "reference": reference, "message": message,
    })
    return {"ok": True}


@app.post("/api/admin/video-metadata")
async def get_video_metadata(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request)
    video_url = data.get("videoUrl", "")
    if not isinstance(video_url, str) or not video_url or len(video_url) > 500 or not video_url_ok(video_url):
        raise HTTPException(400, "Paste a valid public YouTube or Vimeo link first.")
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
    video_host = (urlparse(video_url).hostname or "").lower()
    provider = "www.youtube.com" if "youtube" in video_host or video_host == "youtu.be" else "vimeo.com"
    metadata_url = f"https://{provider}/oembed?url={quote(video_url, safe='')}&format=json"
    def fetch():
        req = Request(metadata_url, headers={"User-Agent": "RM-Edits portfolio editor/1.0", "Accept": "application/json"})
        with urlopen(req, timeout=8) as response:
            return json.loads(response.read(500_001).decode("utf-8"))
    try:
        metadata = await asyncio.to_thread(fetch)
        title = metadata.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Missing video title")
    except Exception as error:
        raise HTTPException(422, "Could not get details for this video. Check that the link is public and try again.") from error
    category, category_label = portfolio_category_for_video(title, "")
    return {"title": title[:300], "category": category, "categoryLabel": category_label,
            "message": "Project name and a suggested category filled from the video title. Enter duration and views manually."}


@app.post("/api/admin/uploads/start")
async def start_upload(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request, maximum=5000)
    asset_key, content_type, size = data.get("assetKey"), data.get("contentType"), data.get("size")
    if not isinstance(asset_key, str) or not isinstance(content_type, str):
        raise HTTPException(400, "Choose a supported file.")
    validate_upload(asset_key, content_type, size)
    chunk_count = (size + MAX_UPLOAD_CHUNK - 1) // MAX_UPLOAD_CHUNK
    upload_id = uuid.uuid4().hex
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        connection.execute("INSERT INTO rm_uploads (id, asset_key, content_type, file_size, chunk_count) VALUES (%s, %s, %s, %s, %s)",
                           (upload_id, asset_key, content_type, size, chunk_count))
    return {"uploadId": upload_id, "chunkSize": MAX_UPLOAD_CHUNK, "chunkCount": chunk_count}


@app.put("/api/admin/uploads/{upload_id}/{part_number}")
async def upload_part(upload_id: str, part_number: int, request: WebRequest):
    check_same_origin(request)
    raw = await request.body()
    if len(raw) > MAX_UPLOAD_CHUNK:
        raise HTTPException(413, "Upload part is too large.")
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        upload = connection.execute("SELECT * FROM rm_uploads WHERE id = %s", (upload_id,)).fetchone()
        if not upload or not 1 <= part_number <= upload["chunk_count"]:
            raise HTTPException(404, "Upload was not found.")
        expected = min(MAX_UPLOAD_CHUNK, upload["file_size"] - (part_number - 1) * MAX_UPLOAD_CHUNK)
        if len(raw) != expected:
            raise HTTPException(400, "Upload part size does not match.")
    try:
        blob = await put_blob(f"temporary/{upload_id}/{part_number}.part", raw, access="public", content_type="application/octet-stream", add_random_suffix=True)
    except Exception as error:
        raise HTTPException(502, "Could not save the upload part to Vercel Blob.") from error
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        connection.execute("INSERT INTO rm_upload_chunks (upload_id, part_number, blob_url) VALUES (%s, %s, %s) ON CONFLICT (upload_id, part_number) DO UPDATE SET blob_url = EXCLUDED.blob_url",
                           (upload_id, part_number, blob.url))
    return {"ok": True}


@app.post("/api/admin/uploads/complete")
async def complete_upload(request: WebRequest):
    check_same_origin(request)
    data = await read_json_body(request, maximum=2000)
    upload_id = data.get("uploadId")
    if not isinstance(upload_id, str) or not re.fullmatch(r"[a-f0-9]{32}", upload_id):
        raise HTTPException(400, "Upload was not found.")
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        upload = connection.execute("SELECT * FROM rm_uploads WHERE id = %s", (upload_id,)).fetchone()
        chunks = connection.execute("SELECT part_number, blob_url FROM rm_upload_chunks WHERE upload_id = %s ORDER BY part_number", (upload_id,)).fetchall()
        if not upload or len(chunks) != upload["chunk_count"]:
            raise HTTPException(400, "Some upload parts are missing. Please try again.")
    def fetch_chunk(url: str) -> bytes:
        if not vercel_blob_url_ok(url):
            raise ValueError("Invalid temporary upload URL")
        with urlopen(Request(url, headers={"User-Agent": "RM-Edits uploader/1.0"}), timeout=25) as response:
            return response.read(MAX_UPLOAD_CHUNK + 1)
    try:
        parts = await asyncio.gather(*(asyncio.to_thread(fetch_chunk, row["blob_url"]) for row in chunks))
        if any(len(part) > MAX_UPLOAD_CHUNK for part in parts):
            raise ValueError("Oversized chunk")
        combined = b"".join(parts)
        if len(combined) != upload["file_size"] or not media_type_from_signature(upload["content_type"], combined):
            raise ValueError("File content does not match its selected type")
        blob = await put_blob(upload_path(upload["asset_key"], upload_id, upload["content_type"]), combined,
                              access="public", content_type=upload["content_type"], add_random_suffix=True,
                              multipart=upload["file_size"] > 5 * 1024 * 1024)
    except Exception as error:
        raise HTTPException(422, "The selected file could not be assembled. Please upload it again.") from error
    chunk_urls = [row["blob_url"] for row in chunks]
    with database_connection() as connection:
        ensure_schema(connection)
        require_admin(connection, request)
        connection.execute("DELETE FROM rm_uploads WHERE id = %s", (upload_id,))
        connection.execute("INSERT INTO rm_uploaded_media (blob_url) VALUES (%s) ON CONFLICT DO NOTHING", (blob.url,))
    try:
        await delete_blobs(chunk_urls)
    except Exception:
        pass
    return {"url": blob.url}


@app.get("/media/{filename}")
def get_media(filename: str):
    if not re.fullmatch(r"(?:color-preview-(?:before|grade-[1-4])\.(?:jpg|png|webp)|showreel\.(?:mp4|webm)|showreel-thumbnail\.(?:jpg|png|webp))", filename):
        raise HTTPException(404, "Not found.")
    path = MEDIA_DIR / filename
    if not path.is_file():
        path = ROOT / "media" / filename
    if not path.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(path)


@app.get("/{asset_path:path}")
def get_static_file(asset_path: str):
    name = asset_path or "index.html"
    if name.startswith("public/"):
        name = name.removeprefix("public/")
    if name.rstrip("/") in {"home", "services", "pricing", "work", "color", "contact"}:
        name = "index.html"
    if name not in STATIC_FILES:
        raise HTTPException(404, "Not found.")
    path = PUBLIC_DIR / name
    if not path.is_file():
        path = ROOT / name
    if not path.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(path)
