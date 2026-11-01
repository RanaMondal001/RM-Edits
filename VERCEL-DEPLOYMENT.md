# Put RM-Edits online with Vercel

The project now has a Vercel-compatible Python backend. Your existing `start-portfolio.bat` and local Python server remain available for local work. Vercel needs its own database and file storage because its server cannot keep changes in the project files between visits.

## Do these steps in order

1. **Put the project in a private GitHub repository.** In VS Code, open Source Control, initialize the folder as a Git repository if prompted, then publish it to GitHub. Keep `private/`, passwords, and `.env` files out of GitHub; the updated `.gitignore` excludes them.
2. **Import that repository into Vercel.** Create a Vercel account, choose **Add New → Project**, and import the RM-Edits repository. Let Vercel detect the FastAPI app. The project entry point is `app.py`.
3. **Add a Postgres database.** In the Vercel project's **Storage** area, create or connect a Postgres database. Make sure its environment variables include `DATABASE_URL` or `POSTGRES_URL` for Production and Preview.
4. **Add a public Blob store.** In **Storage**, create a Vercel Blob store with **Public** access and connect it to this project for Production and Preview. Vercel provides `BLOB_READ_WRITE_TOKEN` to the app. The portfolio's uploaded video and images are public so site visitors can view them.
5. **Set the one-time setup secret.** In **Project → Settings → Environment Variables**, add `ADMIN_SETUP_SECRET` for Production and Preview. Use a randomly generated secret with at least 24 characters. Keep it private; enter it once in the admin page to create your own username and password. After the first admin account is created, you can remove this environment variable and redeploy.
6. **Deploy.** Click **Deploy**. When it finishes, open the Vercel address and `/admin.html`. On the first visit, enter the setup secret and create your admin login. The site content and inbox will then be saved in the database, while new media uploads go to Blob storage.
7. **Check the live site.** Open the homepage, test the quote calculator and contact form, sign in at `/admin.html`, and save a small edit. Then reload the site to confirm the change stayed saved.

## Notes

- Vercel uses the new `app.py` backend; local use continues to use `server.py`.
- Keep the database and Blob store connected to every deployment environment you use. Preview deployments have separate environment settings, so add the stores to Preview as well if you plan to test there.
- Existing local content in `site-content.json` becomes the initial content the first time the online database is created. Website files and the existing `public/media/` assets are served as static files; newly uploaded files are stored in Blob.
- If the project is already on GitHub, step 1 is complete. After changing files locally, commit and push those changes to trigger a new Vercel deployment.
