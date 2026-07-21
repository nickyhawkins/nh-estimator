# App Efficiency & On-Site Workflow Review — 2026-07-21

> **Status update (same day):** every Part 1 finding is now APPLIED on this
> branch except finding 8 (the five parallel settings lists) — deferred
> deliberately: it's a maintainability refactor with per-field zero-vs-null
> merge semantics that deserves its own careful change, and the drifted
> server-branch copy is currently compensated by the patch blocks (now moved
> next to the settings fetch they belong to). Of the smaller items, the
> `getAccessToken` two-query tidy was also skipped (churn > benefit).
> Part 2 is now BUILT as well (five commits on this branch): PWA install +
> offline shell (A), sync status dot + menu row (B), duplicate room (C),
> room-form draft protection (D), and Quick add capture-first entry (E).
> Part 2 G (searchable Settings materials dropdown, colour pill clipping)
> stays with the existing edits list.

Full read-through of the estimator: `server.js`, `routes/api.js`, `routes/xero.js`,
`routes/debt.js`, `db/setup.sql`, and all 7,070 lines of `public/index.html`.
No code was changed — this is the findings list, ranked, with the safe fix for
each. Nothing here proposes a behaviour change; every fix preserves current
functionality.

**Headline:** the backend is in good shape (deliberate, well-documented
trade-offs throughout `api.js`/`xero.js`). The wins are almost all in how
`index.html` is delivered and how often it re-fetches/recomputes. The top two
fixes alone cut the page from ~610KB to roughly **90–110KB on the wire** with
zero code-behaviour change.

---

## Part 1 — Efficiency findings (ranked)

### 1. The same 72KB logo is embedded twice — 26% of the entire file is base64 images
`public/index.html` lines 166 and 759 each contain an identical 72,460-char
base64 `<img>` (the topbar logo, once on Home, once on Exterior). The decoded
PNG is **1336×1199px** for a logo rendered at ~40px. Line 10 adds a 16,651-char
base64 apple-touch-icon. Total: ~161KB (26%) of the file is images that can't
be cached separately.

**Fix:** save the logo once as `public/logo.png`, downscaled to 2× its display
size (likely <5KB), and reference `<img src="/logo.png">` in both places; same
for the touch icon. `express.static` already serves the directory. Saves
~160KB before compression even starts.

### 2. No gzip — the full 610KB ships on every cold load
`server.js` has no `compression` middleware and `express.static` runs with
defaults (maxAge 0). This is a phone-first tool used on mobile data; the file
is highly compressible text.

**Fix:** `npm i compression` and add `app.use(require('compression')())` near
the top of `server.js`. Expected: ~610KB → ~120–150KB, and ~90–110KB once
finding 1 is done too.

### 3. `renderSummary()` does a network GET on every render — and it renders constantly
`renderSummary` (line ~6549) unconditionally `await`s
`apiGet('/api/extitems?...')` before painting. It has **20 call sites**,
including every materials quantity change, line delete, chargeable toggle,
markup change, payment-plan change, and job status change. Consequences:

- Editing one materials quantity = 1 GET + 1 DELETE + N PUTs (finding 5) plus
  a full-screen innerHTML rebuild.
- The rebuild **wipes any half-typed input in the Add Material form** and drops
  keyboard focus (the form lives inside the rebuilt markup).
- Offline, every render blocks on a failing fetch before painting.

**Fix:** `extItems` is already kept in sync everywhere it changes. Move the
fresh fetch to tab entry only (inside `goTab('summary')`) and make the render
itself synchronous. Identical output.

### 4. Cold start and job switching are long serialized waterfalls
`initApp` (lines ~1696–1889) awaits ~10 fetches strictly one after another
(settings → jobs → rooms → extitems → colours → colour-library → materials →
actuals → Xero status → material-groups). `loadActiveJobData` does 5 sequential
fetches per job switch. Worse, `switchJob` first flushes **all four
collections of the outgoing job** via the delete-all-then-PUT-each pattern —
rewriting every row even when nothing changed.

**Fix:** after `jobs` resolves, run the job-scoped GETs in a `Promise.all` and
render once at the end; add a simple dirty flag per collection so `switchJob`
only flushes collections actually modified. Preserves the existing ordering
guarantee (old-job flush completes before `activeJobId` changes).

### 5. Delete-all-then-rewrite on every edit (N+1 writes, and fragile)
`saveRooms`, `saveColours`, `saveExtItems`, `saveMaterialsSnapshot` each do
`DELETE` (whole collection) then one `PUT` per row — triggered by single-row
edits (a materials quantity change rewrites the whole snapshot). Besides the
request volume, `apiPut` swallows failures, so a DELETE that lands followed by
PUTs that drop leaves the server table empty until the next full save
(NOTES.md already flags this). On flaky site Wi-Fi this is the most likely
"my rooms vanished on the other device" cause.

**Fix (small server change):** add a bulk `PUT /api/rooms?job_id=…` (and
siblings) that accepts the whole array and writes it in one transaction —
client change confined to those four functions. Purely client-side
alternative: PUT only the changed row for single-row edits, keep
delete-rewrite for structural changes. (Material actuals are already exempt
by design — leave them exactly as they are.)

### 6. `computeMaterials` re-runs `calcRoom` ~10× per room, per render
Each of the 7 interior roles calls `calcRoom(r)` inside its callback, and
mist/featurewall/panel call it again in `skipRoom`; exterior woodwork runs
twice per item. `calcRoom` is not cheap — it includes the full wallpaper
roll machinery. `renderSummary` adds two more `calcRoom` calls per room, and a
Summary render happens on every materials edit (finding 3). A 15-room job with
wallpapered staircases ≈ **150 full `calcRoom` evaluations per render**.

**Fix:** at the top of `computeMaterials`, build
`const calcs = new Map(); rooms.forEach(r => calcs.set(r, calcRoom(r)))` and
have the role callbacks read from it. Same outputs, ~10× less work. Reuse the
same pass inside `renderSummary`.

### 7. Summary breakdown duplicates `calcRoom`'s formulas by hand
Lines ~6575–6608 re-implement wall/ceiling/wood/mist cost formulas inline —
the comment even says "must stay in sync with calcRoom". Exterior breakdown is
half-migrated (windows/sash read from `calcExtItem`; masonry/fascia/door/garage
are still recomputed). This is exactly the `extCost` drift-class bug NOTES.md
documents as the app's recurring failure mode.

**Fix:** have `calcRoom`/`calcExtItem` return the component costs they already
compute internally (`wallCost`, `ceilCost`, `woodCost`, …) and read them in
`renderSummary`. No numeric change, kills the drift risk permanently.

### 8. Settings defaults live in five parallel hand-written lists — one has already drifted
~60 fields duplicated in: module init, `initApp`'s localStorage branch,
`initApp`'s server branch (this copy **omits the rExt\*/ext\* fields**, patched
back by two follow-up blocks — the drift already happened), `loadSettings`,
and `saveSettings`. Every new setting must be added in 5 places plus the HTML.

**Fix:** one `SETTINGS_DEFAULTS` object + a `mergeSettings(raw)` helper used
by all three merge sites; drive `loadSettings`/`saveSettings` from a
field→input-id map. Keep the `dayRate`/`covWall` legacy aliases.

### 9. Smaller items (worth doing when passing through)
- **Debounce live previews:** ~40 `oninput="previewRoom()"`/`calcHSL()`
  handlers run full recalcs (incl. wallpaper roll loops) per keystroke. An
  ~80ms trailing debounce ends typing jank on older phones. The Xero contact
  search already does this correctly (300ms) — copy that pattern.
- **Recalculate button double-computes:** `recalculateMaterialsSnapshot()` runs
  `computeMaterials()`, then the chained `renderSummary()` runs it again. Pass
  the result through instead.
- **`renderActuals` rebuilds the whole screen** — including the add-item form —
  on every checkbox tick, wiping mid-entry input. Render rows into a child
  container and leave the form in static HTML.
- **`/auth/material-groups` hits Xero's Items API uncached** on every call. A
  ~5-minute in-memory cache server-side would speed up app start noticeably
  (it's on the `initApp` critical path).
- **`getAccessToken()` + a separate `SELECT xero_tenant_id`** run two queries
  where one `SELECT xero_token, xero_tenant_id` would do — repeated in every
  Xero route. Trivial tidy-up.
- **`DELETE /api/jobs/:id` and `/api/all`** run their per-table deletes
  sequentially; `Promise.all` (or one transaction) halves the latency. Minor.

### Verified non-problems (checked, don't chase)
- localStorage writes all hang off `onchange`/explicit saves — no per-keystroke
  serialization anywhere.
- No polling/`setInterval` loops.
- Numeric inputs already use `inputmode`/`type="number"` (123 of them) — mobile
  keypads are fine.
- The JS's heavy commentary compresses to near-nothing under gzip — not worth
  stripping.
- `material_actuals`' strict server-authoritative save path is deliberate
  (it's the invoice) — leave untouched.

---

## Part 2 — On-site workflow suggestions

Ordered by how much site-visit time each saves.

### A. Make it installable and offline-proof (PWA)
The localStorage-first design already means the app *mostly* works offline,
but there's no manifest or service worker — so a dead spot in a basement or a
new-build with no signal means the app may not even load, and `initApp`'s
fetch waterfall stalls the UI. Adding a `manifest.json` + a small service
worker that caches `index.html` gives you: an icon on the home screen, instant
open with no signal, and the existing background sync doing its thing when
signal returns. This is the single biggest on-site reliability win and needs
no change to app logic.

### B. Surface sync status before you leave site
`serverAvailable` is tracked but almost nothing in the UI shows it. On site
the question that actually matters is *"did today's measurements reach the
server before I drive off?"* A small indicator (e.g. in the topbar: "✓ synced"
/ "⏳ 3 changes waiting" / "⚠ offline — saved on this phone") turns a silent
failure mode into a visible one. Pairs naturally with the dirty flags from
finding 4/5.

### C. "Duplicate room" button
There's no way to copy a room. On site, bedrooms 2/3/4 are usually the same
room with different dimensions — measure one, duplicate, tweak two numbers.
Jobs are deliberately no-duplicate-as-template, but *rooms within a job* are a
different case and this is probably the biggest raw time-saver per visit.

### D. Protect a half-filled room form
The room form is explicit-save; a phone call or app switch mid-measure can
lose ~20 typed fields. The Kitchen tab already autosaves on every change —
either persist a draft of the room form (localStorage, restored on return) or
autosave the way Kitchen does. Related: fix the Add Material / actuals form
wipes (findings 3 and 9) — losing a half-typed line at the merchant's counter
is the same failure in miniature.

### E. Capture-first room entry
A common on-site pattern: walk the house once naming rooms ("Hall, Lounge,
Bed 1, Bed 2…"), then go round again with the laser measure. Right now each
room must be fully entered one at a time. A "quick add by name" that creates
empty named rooms (they'd naturally show as £0 until measured) would let the
app match how a walkthrough actually happens.

### F. Speed of first paint and job switching
Part 1 findings 1, 2, and 4 are workflow items in disguise: opening the app in
a client's hallway on 4G currently pulls 610KB + ~10 serialized round trips
before it's trustworthy, and switching jobs re-uploads everything. After those
fixes, cold open should feel near-instant.

### G. Already on your list — worth bumping up
From `estimating-app-edits.md`, two open items matter most on site and are
endorsed by what I found in the code:
- **#4 Searchable materials dropdown** — scrolling a long list on a phone at
  the merchant is slow; note the form-wipe fixes above are a prerequisite, or
  the search box will keep getting cleared by re-renders.
- **#6 Colour pill clipping on mobile** — small, but it's the tab you show
  clients.
