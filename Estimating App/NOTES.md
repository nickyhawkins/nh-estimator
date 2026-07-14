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

## Gotcha: localStorage-vs-server sync

Client state (rooms, exterior items, staircase costs, settings) is cached
in `localStorage` and mirrored to Postgres so the estimate survives a
refresh and (loosely) syncs across devices. The pattern, spelled out at
`public/index.html:635`:

- **Reads**: `initApp()` loads from `localStorage` first (instant, works
  offline), renders, *then* fetches from `/api/*` in the background and
  overwrites local state — but only if the server actually has data
  (`if (serverRooms && serverRooms.length > 0)`, etc.). An empty server
  response never clears local state. This means a genuinely-cleared server
  won't propagate to a device that still has local data, and a brand new
  device/incognito session with an empty server will just show nothing
  even if another device has real data (no server truly means empty here,
  vs "haven't synced yet" — the two are indistinguishable).
- **Writes**: `saveRooms()` and friends write to `localStorage`
  synchronously, then fire-and-forget sync to the server via
  **delete-all-then-put-each** (`apiDelete('/api/rooms')` then a `PUT` per
  room). Not transactional — a failed request mid-loop can leave the
  server missing rooms until the next full save. There's no debounce on
  these calls either, so rapid edits mean rapid delete+put roundtrips.
- `serverAvailable` is set on every `apiPut`/`apiDelete` failure but very
  little in the UI actually branches on it today — mostly informational.

If you're debugging "my data didn't show up on another device," start
here, not in Postgres.

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
