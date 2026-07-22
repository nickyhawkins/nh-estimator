# Architecture & gotchas

Working notes for picking this project back up cold — either as a human or
as Claude Code in a fresh session with no memory of prior conversations.

## Architecture

Single-page paint estimator (`public/index.html`, ~2300 lines — all markup,
CSS and JS inline, no build step) backed by a small Express server.

- `server.js` — mounts `routes/xero.js` at `/auth` and `routes/api.js` at
  `/api`, serves `public/` statically, catches all other routes to
  `index.html` (client-side routing).
- `routes/api.js` — CRUD over Postgres for rooms, exterior items, HSL
  (staircase) state, and settings. See `db/setup.sql` for the schema:
  `rooms`, `exterior_items`, `hsl_state`, `exterior_state`, `settings`
  (one row, id=1), plus a `session` table for `express-session` via
  `connect-pg-simple`.
- `routes/xero.js` — OAuth2 connect/callback/refresh, contact search +
  create, quote creation against Xero's Accounting API
  (`api.xro/2.0`). Tokens are stored in `settings.xero_token` (JSONB) and
  refreshed on demand in `getAccessToken()`.
- No frontend framework, no bundler. Functions and globals all live in one
  `<script>` block in `index.html`. Grep before adding a function — nothing
  stops you from redefining one (see gotcha below).

## localStorage-vs-server sync (hardened 2026-07)

Client state (rooms, exterior items, colours, materials snapshot,
settings, job rows) is cached in `localStorage` and mirrored to Postgres.
The sync layer now runs through a **persistent outbox** — see the
"Sync outbox" block in `public/index.html` (search for `pe-dirty`):

- **Reads**: `initApp()` loads from `localStorage` first (instant, works
  offline), renders, then fetches from `/api/*` in the background. A
  *successful* fetch is authoritative even when empty — EXCEPT for any
  collection still flagged in `pe-dirty`, whose local edits are newer and
  are pushed instead of overwritten. Before any fetch runs, `initApp()`
  awaits `flushDirty()`, which re-pushes everything a previous session
  failed to sync.
- **Writes**: `saveRooms()` and friends write to `localStorage`
  synchronously, then send ONE transactional replace-all request per
  collection (`replaceAllRows` in `routes/api.js`). Sends are serialized
  per collection (no out-of-order replace-alls) and coalesced (rapid edits
  collapse to at most one in-flight + one queued request carrying the
  newest state). `apiPut`/`apiDelete` return a boolean and treat a non-2xx
  as failure — a server 500 can no longer show a green "synced" dot.
- **Retry**: a failed write leaves its `pe-dirty` flag set (it survives
  restarts); `flushDirty()` re-pushes on reconnect (`online` event), on
  the app becoming visible again, on a 45s safety-net interval, at
  startup, and before a job switch. `switchJob()` refuses to leave a job
  whose collections are still dirty (the localStorage mirror only holds
  one job, so leaving would strand those edits) and refuses to switch
  while offline.
- **Job rows**: `persistJobData()` is dirty-tracked per job id and
  serialized per job. It always sends `name` plus every data field —
  `PUT /api/jobs/:id` replaces `data` wholesale, and a historical
  name-only PUT from `renameJob()` used to wipe the job's
  status/contact/markup/kitchen data on every rename.
- Material **actuals** keep their own stricter path (`apiPutStrict`) and
  are not in the outbox — see MATERIAL_TRACKING_SPEC.md.

If you're debugging "my data didn't show up on another device": check
`localStorage['pe-dirty']` on the *source* device first — a stuck flag
means the push never landed (and the sync row in the hamburger menu will
say so), then look at Postgres.

## Gotcha: extItems vs extCost (fixed in d6f6c09)

Exterior costs used to live in two places that fell out of sync: a
`calcExtItem()`-driven `extItems` array (the real per-item data, source of
truth for the UI) and stale `extCost`/`extTime` globals that
`createXeroQuote()` and `exportCSV()` read from directly. Nothing kept
`extCost` updated, so it silently sat at its default and both the Xero
quote and the CSV export dropped exterior costs entirely (or threw, on a
session that never touched those globals).

Fixed by making `createXeroQuote()` and `exportCSV()` compute totals from
`extItems` via `calcExtItem()`, the same function `renderSummary()`
already used — one source of truth instead of a derived global that
nothing kept current. **If exterior costs ever go missing from an export
again, check for a new derived global that isn't being fed by `extItems`
before assuming the math is wrong.**

## Gotcha: duplicate route file (fixed in 3598155)

There were two copies of the Xero routes: `routes/xero.js` (the one
actually `require()`'d by `server.js`) and a stale root-level `xero.js`
left over from an earlier restructure. Both defined the same routes;
only the `routes/` one was ever live. The dead copy wasn't causing runtime
bugs (Express only saw the mounted one), but it was a trap for editing —
fixing a bug in the wrong file would look correct in the diff and do
nothing at runtime. Deleted in 3598155. **Before editing any route file,
confirm it's the one `server.js` actually requires** — this codebase has a
history of stale duplicate files from "Add files via upload" commits.

## Gotcha: Xero API defaults to XML (fixed in dceaf8e)

Xero's `api.xro/2.0` endpoints (Contacts, Quotes — not the OAuth token
endpoint or the `/connections` identity endpoint, which are always JSON)
return XML unless the request sends `Accept: application/json`. Without
it, `response.data` is a raw XML string, so property access like
`contactRes.data.Contacts[0].ContactID` fails silently (reads as
`undefined`, no exception) rather than erroring loudly. This broke new
contact creation and the quote number/ID returned to the UI. Fixed by
adding the header to all three `api.xro/2.0` calls in `routes/xero.js`.
**Any new Xero Accounting API call needs this header too** — it's easy to
copy an existing `axios` call and miss it since nothing throws when you
do.

## Known-unverified

The Xero JSON fix above was verified by static code review only (no
Node.js or Postgres available in the environment it was reviewed in, and
no live Xero credentials). If something in Xero-land seems broken, check
the `Quote response:` / `Contacts search error:` console logs in
`routes/xero.js` first — they log the raw response, which will tell you
immediately if XML is leaking through again.
