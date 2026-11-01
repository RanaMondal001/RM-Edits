# RM-Edits portfolio

## Open the website and admin panel on Windows

1. In VS Code, open Terminal → Run Task… → Run RM-Edits website. You can also double-click `start-portfolio.bat`. The server uses Python 3; Node.js is not needed.
2. Keep the VS Code task terminal open while using the site.
3. Open `http://127.0.0.1:5500` for the portfolio or `http://127.0.0.1:5500/admin.html` for the admin panel.
4. The first admin visit asks you to create your own username and password. Use at least 12 characters. Save the password somewhere private; the website does not provide a password reset flow.

The admin panel saves public content in `site-content.json`. Your password hash and contact inquiries are stored in `private/`; do not publish or share that private folder. New inquiries appear in the Admin inbox, but the server does not email notifications. The server keeps login sessions in memory, so restarting it signs the admin out. Website files and local media now live in `public/`; the local server continues to open the site at the same address.

The login requires this Python server. Opening `index.html` directly or uploading only the HTML/CSS/JS files to a static-only host will not provide a working admin panel. It listens on your own computer by default; publishing it online needs a Python-capable host, HTTPS, and a deployment setup. Keep backups of `site-content.json` and the private folder.
