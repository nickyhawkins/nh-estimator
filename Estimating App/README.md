# Nicky Hawkins Estimator

Paint estimating web app with Xero integration.

See [NOTES.md](NOTES.md) for architecture notes and gotchas hit during development.

## Setup

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/nh-estimator.git
cd nh-estimator
npm install
```

### 2. Create your .env file
```bash
cp .env.example .env
```
Edit `.env` and fill in:
- `DATABASE_URL` — your PostgreSQL connection string (Render provides this)
- `SESSION_SECRET` — any long random string
- `XERO_CLIENT_ID` — from developer.xero.com
- `XERO_CLIENT_SECRET` — from developer.xero.com
- `XERO_REDIRECT_URI` — https://your-app-name.onrender.com/auth/xero/callback
- `APP_URL` — https://your-app-name.onrender.com

### 3. Set up the database
```bash
psql $DATABASE_URL -f db/setup.sql
```

### 4. Run locally
```bash
npm run dev
```
Visit http://localhost:3000

## Deploy to Render

1. Push to GitHub
2. Create a new **Web Service** on render.com
3. Connect your GitHub repo
4. Set environment variables (same as .env)
5. Create a **PostgreSQL** database on Render, copy the connection string to DATABASE_URL
6. Deploy — Render builds and starts automatically

## Xero Setup

1. Go to developer.xero.com
2. Create an app (Web App type)
3. Set redirect URI to: `https://your-app-name.onrender.com/auth/xero/callback`
4. Copy Client ID and Secret to your .env
5. In the app, go to Settings → Connect Xero
