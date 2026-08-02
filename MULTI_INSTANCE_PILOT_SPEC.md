# Multi-Instance Pilot Spec

Share the app with 2–3 trusted decorators, each on their **own Render web
service + own Postgres database**, all deploying from this private repo.
Customers get a URL to install on their phone — they never receive code.
Each instance connects its own Xero, holds its own settings and data, and
is isolated from every other instance.

Why per-instance rather than multi-tenant SaaS: the app today is
single-user to its core (no login, one global settings row, no tenant
column anywhere). Per-instance hosting gets real users onto it with days
of work rather than a rewrite, keeps every customer's client data in its
own database, and leaves the SaaS option open if the pilot proves demand.

Estimated prep: ~4–5 focused days. Per-customer setup thereafter: ~30 min.

Build order: WS1 → WS2 → WS4 → WS3 → WS5. WS1 and WS2 are hard blockers —
nobody else gets a URL before both are done.

---

## WS1 — Login / access control (~1 day)  **[BLOCKER]**

The app has zero access control; anyone with the URL has full use of it.

- `APP_PASSWORD` env var per instance. **Unset ⇒ no gate** (today's
  behaviour, so Nicky's instance is unaffected until she opts in).
- Minimal login page at `/login` (standalone, matches app styling), POST
  to `/auth/login`, sets `req.session.authed`. Sessions already persist in
  Postgres via connect-pg-simple with a 30-day cookie — one login per
  phone, then it behaves like an installed app.
- `requireAuth` middleware in front of the SPA catch-all, `/api/*` and
  `/auth/*` (Xero). Exemptions: `/login`, `/auth/login`, static assets,
  and `/api/schedule.ics` which keeps its own `?key=` token auth (phone
  calendars can't hold a session).
- Service worker: the app shell is cached for offline, so a logged-out
  phone still renders the UI from cache. Handle it client-side: the API
  helpers treat a 401 as "session gone" and redirect to `/login`.
- Simple in-memory throttle on failed login attempts.

## WS2 — Strip the personal Debt app (~½ day)  **[BLOCKER]**

The personal debt tracker is mounted at `/debt` on the same server, with
its own 08:00 cron and `debt_*` tables. It must be invisible on customer
instances.

- `DEBT_APP_ENABLED` env flag, default **off**: gates the `/debt` route
  mount, the daily cron, and the debt static files/manifest/service
  worker. Nicky's instance sets it on. One codebase, no fork.
- `debt_*` tables in `db/setup.sql` are harmless if unused; optionally
  split into `db/setup-debt.sql` so customer databases never have them.

## WS3 — White-labelling (~1 day)

Quotes and invoices are **already white-label**: the app creates them in
each customer's own Xero, which renders them with that customer's
branding themes and templates. What's hard-coded is only in-app cosmetics:

- Logo (`public/logo.png` + "Nicky Hawkins" alt) in the two topbars —
  becomes a Settings "Business name" field + logo upload, text fallback.
- PWA name in `public/manifest.json` ("NH Estimator") and home-screen
  icons — generic defaults for the pilot; per-customer icons later.
- Calendar feed name (`X-WR-CALNAME:NH Jobs` in `routes/api.js`) —
  derive from business name.

## WS4 — Per-instance provisioning (~1 day)

- `render.yaml` blueprint (web service + Postgres) so a new instance is
  "New → Blueprint → fill in env vars".
- First-boot provision step that applies `db/setup.sql` and the colour
  seed automatically (both are idempotent) — no manual `psql` per
  customer.
- Create the missing `.env.example` (README references it; it doesn't
  exist).
- New-customer checklist: create services from blueprint; set
  `APP_PASSWORD`, `APP_URL`, Xero vars; add the instance's callback URL to
  the Xero developer app's redirect list; customer connects Xero, sets
  day rate/markup, installs to home screen.
- Xero limit: an uncertified Xero app connects max **25 organisations** —
  fine for the pilot; App Store certification only if this scales.

## WS5 — Release discipline (~½ day)

- Customer instances auto-deploy from a **`stable`** branch; `main`
  deploys only Nicky's instance. Merge main → stable when a change has
  survived real use.
- Turn on Render daily Postgres backups per instance (paid tier — the
  free Postgres tier expires after 90 days and is not suitable for
  customers). The in-app JSON export stays as a user-level backup only.

## Non-goals for the pilot

- Multi-tenant accounts, sign-up flows, billing — only if the pilot
  proves demand.
- Front-end minification/obfuscation. The pricing logic ships to the
  browser like any web app; trusted pilot users don't justify the build
  step. Revisit before wider release.
- Per-customer feature flags beyond `DEBT_APP_ENABLED`.

## Commercials & small print (owner's checklist, not code)

- Hosting floor ≈ £12–15/customer/month on Render starter tiers — price
  above this.
- One-page agreement per pilot customer: you host it, they own their
  data, and on leaving they get their JSON export (and on request a full
  database dump).

## Status

- [x] Spec agreed
- [x] WS1 login (`routes/appLogin.js`, `public/login.html`; APP_PASSWORD env var)
- [x] WS2 debt-app flag (`DEBT_APP_ENABLED`, default off; debt tables + personal seed split into `db/setup-debt.sql`)
- [x] WS3 white-label (Settings → Business card: name + logo; header, login page, PWA manifest name, ICS calendar name)
- [x] WS4 provisioning (`render.yaml`, `npm run provision`, `/healthz`, `docs/NEW_INSTANCE.md`)
- [x] WS5 release discipline (`stable` branch created; blueprint pins it; promote via `git push origin main:stable` — see docs/NEW_INSTANCE.md "Releases")
