# Debt App Efficiency & Feature Review — 2026-07-22

> **Status update (same day):** Part 1 is APPLIED on this branch (four
> commits) except where noted:
> - Findings 1–5, 7 and most of 9 (save-failure banners, cron timezone,
>   income/loan failure surfacing, chart indexOf, icons) — all applied.
>   Finding 4 used the `Promise.all` version; folding the endpoints into
>   `/api/state` stays available if cold start ever needs more.
> - Finding 6 — no action by design (documented risk, nothing to change
>   yet).
> - Finding 8 (savings pot) — deferred to Part 2 E deliberately: the fix
>   worth doing is *wiring the pot into the UI*, which is a feature, not a
>   tidy-up. The dead functions stay until that decision is made.
> - Finding 9's `DEBTS_INITIAL`/Reset/History-baseline item — deferred: it
>   changes behaviour (retiring Reset, re-deriving the baseline) and
>   deserves its own change.
> - The icon item turned out bigger than written: the embedded icons were
>   NOT duplicates of `/icon-192.png` — that file is the *paint app's*
>   house icon, which the debt manifest and push notifications had been
>   using all along. Both now use the debt app's own £ icon, saved as
>   `debt-icon-192.png`/`debt-touch-icon.png`.
> - Bonus fix found while applying 2/3: the new-cycle flow used to make its
>   *own* follow-up save look stale (server-side timestamp bumps the client
>   never saw), triggering a false conflict banner on every balance sync.
>   `new-cycle` now returns the fresh timestamps and the client adopts
>   them.
>
> **Part 2 B is BUILT** (read-only scope, as agreed): `debt-sw.js` now
> caches the app shell (navigations network-first, cached shell as the
> no-signal fallback; API calls never intercepted), and `debt.html` keeps a
> localStorage snapshot of the last synced state — offline, the app opens
> showing real data with a "last synced" banner, saving disabled. The
> worker also registers where push isn't supported, so a plain Safari tab
> gets the offline shell too.

Full read-through of the debt app: `routes/debt.js`, `lib/debtNotify.js`,
`lib/debtPush.js`, `public/debt.html` (all 1,508 lines), `public/debt-sw.js`,
`public/debt-manifest.json`, the debt sections of `server.js` and
`db/setup.sql`, and the docs in `Debt Management App/`. Same format as the
estimator's `app-efficiency-review.md`: no code was changed — this is the
findings list, ranked, with the safe fix for each. Nothing here proposes a
behaviour change; every fix preserves current functionality.

**Headline:** the debt app is in far better delivery shape than the estimator
was — it's ~60KB, gzip is already on, `debt.html` and `debt-sw.js` both get
`no-cache` from the static middleware, and the push plumbing in
`lib/debtPush.js` is genuinely careful. The wins here are different in kind:
one data-loss trap around the hard-coded seed debts, a save pattern that
manufactures false "updated on another device" conflicts, a new-cycle endpoint
that isn't the transaction its comment claims, and a cold start that's four
serialized round trips when it could be one.

---

## Part 1 — Efficiency & reliability findings (ranked)

### 1. A failed load falls back to the July-2026 seed debts — and one slider touch persists them over the real data
`loadState()` (`debt.html` ~line 211) catches any fetch failure and sets
`debts = DEBTS_INITIAL` — the hard-coded launch balances. In that state
`debtsUpdatedAt` stays `null`, and the server's `isStale()` guard
(`routes/debt.js:13`) treats a missing `clientUpdatedAt` as *not stale*, so
the very next `persist()` — e.g. brushing the budget slider, which fires
`persist()` on every `input` event — **overwrites the live balances with the
seed data and the server accepts it**. Opening the app in a dead spot, or
during a server blip, is enough to trigger this.

**Fix (small):** set a `loadedFromServer` flag in `loadState()`; when it's
false, make `persistNow()` a no-op and show a "couldn't load — read-only"
banner. That closes the data-loss path in ~5 lines. (Part 2 B covers the
nicer version: cache last-good state locally so offline still shows real
numbers.)

### 2. Every save writes all three collections and rewrites all 10 debt rows — bumping `updated_at` everywhere and manufacturing phantom 409 conflicts
`persistNow()` always POSTs debts + settings + cashflow together, even when
one slider changed. The debts endpoint then runs **one sequential UPDATE per
debt row** (N+1, no transaction), and the Postgres trigger bumps
`updated_at` on every row *even when nothing changed*. Consequences:

- Changing the sweep % on the phone bumps every debt row's `updated_at`;
  the laptop's next legitimate save of anything then 409s "Updated on
  another device" and **discards its local changes** — the conflict guard
  (Feature 6) firing on conflicts that never happened.
- Each debounced save settles ~13 queries server-side for a one-field edit.
- A dropped connection mid-loop leaves the debts half-written (no
  transaction).

**Fix:** client side, keep a dirty flag per collection and POST only what
changed (the debounce plumbing already exists). Server side, write the debts
in one statement — `UPDATE debt_plan_debts d SET ... FROM
jsonb_to_recordset($1) AS j(...) WHERE d.id = j.id AND (d.*) IS DISTINCT
FROM ...` — or at minimum wrap the loop in a transaction and skip rows whose
values are unchanged so `updated_at` only moves when data does. Either half
alone removes most of the false-conflict surface; both together remove it
all.

### 3. `POST /api/new-cycle` isn't the transaction its comment says it is
The comment promises "all in one round trip so a page refresh mid-transition
can't leave things half-cleared" — but it's one *HTTP* round trip wrapping
**eight sequential queries with no BEGIN/COMMIT** (`routes/debt.js:181`). A
crash or deploy restart between the history INSERT and the income-log DELETE
double-counts this cycle's income into the *next* cycle's archive; dying
before the `cycle_started_at` update corrupts the next cycle's date range.
This is the app's most important write (the "nothing is ever deleted"
archive) and its only multi-statement one.

**Fix:** take a client from the pool, `BEGIN` … `COMMIT`/`ROLLBACK` around
the existing statements. No behaviour change, identical response shape.

### 4. Cold start is four serialized round trips
`loadState()` awaits `/api/state`, then `refreshHistory()`, then
`refreshCycleStatus()`, then `refreshBorrowed()` — one at a time — before the
first `renderAll()`. On 4G that's 4× RTT before anything paints, for four
endpoints that are each a single cheap query.

**Fix:** simplest — `Promise.all` the three follow-ups after `/api/state`
resolves (one line). Better — fold `history`, `cycleStatus`, and `borrowed`
into the `/api/state` response (the server already `Promise.all`s its
queries; three more joins the party) and keep the standalone endpoints for
their existing callers. One round trip, first paint on the heels of it.

### 5. `simulate()` runs 2–6+ times per render, and the budget slider triggers a full re-render per notch
The 360-month simulation is re-run from scratch all over the place:
`renderAll()` computes it, then `getCyclePayments()` (called by the Cash Flow
view, `getCycleTotals()`, `togglePaid()`, the archive snapshot…) computes it
again; the What If tab adds **four more** for the comparison table on every
render, `calcLump()` runs two per keystroke (the unchanged baseline is
recomputed each time), `calcExtraMonthly()` two per slider tick, and
`changeMonth()` simulates once just to clamp the month before `renderAll()`
simulates again. Meanwhile the budget slider fires `persist()` **and a full
`renderAll()`** — nav, chart, entire tab innerHTML — on every `input` event,
so dragging it is dozens of rebuild-plus-multi-simulate rounds. It's the
same shape as the estimator's `calcRoom`/`renderSummary` finding, just
smaller numbers.

**Fix:** memoize one level — `let simCache={key:null,months:null}` keyed on
`(debts reference, budget)`; `debts` is replaced by reference on every real
change (`debts=debts.map(...)` everywhere), so reference equality is a
correct cache key. Have `getCyclePayments`/`changeMonth`/what-if baselines
read through it. For the slider, update the label immediately and defer the
full re-render behind a ~80ms trailing debounce or `requestAnimationFrame`
(the estimator's preview-debounce pattern). Identical output, ~10× less work
during drags.

### 6. `renderAll()` rebuilds nav + chart + the whole tab for every interaction
Ticking one payment checkbox, dismissing a banner, toggling the repaid log —
each rebuilds the entire tab's innerHTML. At 1,500 lines this is *currently*
tolerable (unlike the estimator's 7,000), and no rendered form yet holds
transient input at re-render time, so nothing is being wiped today. Flagging
it because it's the exact pattern that produced the estimator's
form-wipe/focus-loss bugs (its findings 3 and 9): the first future feature
that puts an input inside a re-rendering view inherits the bug. No action
now beyond the slider debounce in finding 5 — just don't add inline forms to
re-rendering views without a child-container render.

### 7. User text is interpolated into innerHTML and attribute values unescaped
Debt notes, loan source names, and loan notes go straight into template
literals — including `value="${ev.note}"` in the Edit tab. A note containing
a double quote silently truncates the input's value (and the rest of the
attribute leaks into the markup); a `<` breaks the row. Single-user app, so
XSS isn't the concern — self-inflicted markup breakage is, and "O'Brien
said "pay Friday"" is a realistic note.

**Fix:** a 3-line `esc()` helper (`&`, `<`, `"` replacements) used at the
dozen interpolation sites that carry free text. Behaviour identical for all
current data.

### 8. Dead UI code, and a savings pot that's invisible
`openSavingsAdjust()`, `confirmSavings()`, and `setSavingsPct()`
(`debt.html:1381–1394`) are referenced by **no rendered markup** — they're
unreachable. Which reveals the real gap: the savings pot accumulates on
every income log (and is stored/synced), but its balance is never displayed
anywhere and can't be adjusted or its % changed from the UI. Either wire the
modal in (Part 2 E) or delete the dead functions; leaving both halves is the
worst of the options.

### 9. Smaller items (worth doing when passing through)
- **Every save failure is silent.** All the `catch(err){console.error(...)}`
  blocks — `persistNow`, `confirmLog`, `confirmAddLoan`, `confirmSync` —
  leave the user believing the save landed. The conflict banner
  infrastructure already exists; reuse it for "⚠ couldn't save — check
  signal". This is the estimator review's "sync status" lesson in
  miniature, and it compounds finding 1.
- **`DEBTS_INITIAL` is a second hand-written copy of the seed** in
  `db/setup.sql` — the estimator's parallel-lists disease (its finding 8).
  It feeds "Reset all figures" (which restores July-2026 balances — an
  increasingly dangerous button as months pass) and the History tab's
  baseline, so "Total debt reduction" silently lies once real data diverges
  from the seed. Prefer deriving the baseline from the oldest
  `debt_snapshot` in cycle history, and consider retiring Reset outright.
- **The 8am cron is 8am server time** — UTC on Render, so reminders arrive
  at 9am through British Summer Time and shift an hour twice a year. Pass
  `{ timezone: 'Europe/London' }` to `cron.schedule` (node-cron supports
  it).
- **`confirmLog()` keeps the entry locally even when the POST fails** — it
  shows in the list with no `id`, can't be deleted server-side, and
  vanishes on next reload. Tie it to the save-failure banner above.
- **`chartData.indexOf(m)` inside the x-label map is O(n²)** — the filter
  callback already has the index. Trivial.
- **Two base64 icons (~7.6KB) in `debt.html`'s head** duplicate
  `/icon-192.png` and `/apple-touch-icon.png`, which exist as cacheable
  files. Tiny compared to the estimator's 161KB version of this, but free
  to fix when passing.

### Verified non-problems (checked, don't chase)
- **Delivery is already right:** gzip is on globally; `debt.html` and
  `debt-sw.js` both match the static middleware's `no-cache` suffix checks
  (`.html`, `sw.js`); icons referenced by the manifest and service worker
  all exist in `public/`. The estimator's top two findings don't apply here.
- `GET /api/state` runs its four queries in `Promise.all` — good.
- `lib/debtPush.js` is careful and correct: lazy init with rejection reset,
  the two-instance VAPID keypair race handled via ON CONFLICT + re-read,
  dead subscriptions pruned on 404/410. Leave untouched.
- `sendToAll`'s sequential send loop is fine at 1–3 devices.
- The push-only service worker with deliberately no fetch handler is a
  documented design choice (it keeps `/debt` online behaviour identical to
  no-SW) — offline support is a feature decision (Part 2 B), not a bug.
- The Edit tab doesn't re-render on keystrokes (`updateDraft` mutates the
  draft only), so it dodges the form-wipe class today.
- The `(due - today + 31) % 31` wrap matches the roadmap spec.

---

## Part 2 — Suggested feature improvements

Ordered by how much they'd actually change day-to-day use. A–C are the ones
I'd do first; D and I are roadmap items worth bumping.

### A. You can't add or remove a debt
The debt list is permanently the 10 seeded rows: `POST /api/debts` only
UPDATEs existing ids, and there's no add/remove UI or endpoint. A new credit
line, a debt that gets split or consolidated, or simply wanting a cleared
debt gone from the Edit tab all require SQL on the live database. This is
the app's biggest functional gap. Add "+ Add debt" on the Edit tab (server
assigns the id) and an "archive" action for cleared debts (keep the row —
history snapshots reference it — just flag it out of the views). While
there, make `getCurrentTarget()`'s HMRC exclusion data-driven (exclude while
`min === 0 && !due` rather than `id !== 11`) so new debts behave sensibly
and the Feature-3 TODO resolves itself.

### B. Offline snapshot + visible sync state
The service worker deliberately has no offline layer, and state lives only
server-side — so no signal means no numbers (or, per finding 1, *wrong*
numbers). The estimator got a PWA shell + sync dot in its Part 2; the debt
app equivalent is smaller: cache the last-good `/api/state` payload in
localStorage and hydrate from it read-only when the fetch fails, add an
app-shell cache to `debt-sw.js`, and put a small sync indicator near the nav
("✓ saved" / "⚠ couldn't save — on this phone only"). Pairs with findings
1 and 9; between them the "did my edit reach the server?" question always
has a visible answer.

### C. Actual-vs-plan chart from cycle history
`debt_plan_cycle_history` already stores a full `debt_snapshot` every cycle
— the data for the most motivating chart the app could have: the *real*
total-balance line plotted over the simulation's projection on the header
chart. Pure frontend; the endpoint exists; the data's been accumulating
since Feature 1 shipped. This turns the header chart from "the plan" into
"the plan vs what's actually happening", which is the entire emotional point
of a payoff app.

### D. Annual summary (roadmap Feature 7) — build it now, and expose cycle notes
It's the last unbuilt roadmap feature, it's small, and history data now
exists to feed it. While in there: `debt_plan_cycle_history.notes` has been
in the schema from day one and nothing writes it — add an optional "anything
to note about this cycle?" field to the new-cycle modal. Future-you reading
the History tab will thank present-you.

### E. Make the savings pot real (finish finding 8)
Show the savings balance as a third card next to Business/Personal, wire up
the already-written adjust modal, and add a savings-% control next to the
sweep slider (`setSavingsPct` is sitting there unused). Right now money
flows into a pot no screen displays — it works, but only if you trust it
blind.

### F. Let a borrowed-money entry be deleted (or edited)
`DELETE /debt/api/borrowed/:id` exists server-side with **no UI caller** — a
fat-fingered amount or duplicate entry is permanent as far as the app shows.
Add a small "delete" option inside the existing repay modal (it already
confirms, so the destructive-action guard is free), and optionally
edit-amount. Tiny change, closes a real annoyance.

### G. Show interest, not just months
`simulate()` computes monthly interest internally and throws it away. Sum it
into the result and surface: "interest you'll pay on this plan" on the
header, and "interest saved" alongside "months saved" in the What If tab.
For high-APR debts (Currys at 39.9%) "this lump sum saves £X in interest" is
often more motivating than "2 months sooner" — and it's a ~10-line change to
a function that already does the work.

### H. Give the debt data a backup story
`BACKUP_SPEC.md` explicitly scopes the `debt_plan_*` tables **out** of the
estimator's backup ("its own roadmap, not this one") — so the cycle history
that "is never deleted" is also never backed up. Cheapest fix: a
`GET /debt/api/export` returning one JSON dump of all `debt_plan_*` tables,
plus a "Download backup" row in settings — that's an afternoon, and puts a
copy of everything on the phone. The fuller option is extending the
estimator's backup job to include these tables.

### I. HMRC Time to Pay (roadmap Feature 3) — still waiting on the phone call
Unchanged from the roadmap: once the arrangement is agreed it's a data
change in Edit Debts (set `min`, `due`, update the note) and the reminder
card retires itself. The one code change it needs — removing the
`id !== 11` exclusion — disappears entirely if suggestion A's data-driven
exclusion lands first. £31,510 is 34% of the total debt sitting outside the
plan; this remains the highest-value non-code action available.
