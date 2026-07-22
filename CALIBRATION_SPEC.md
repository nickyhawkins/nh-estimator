# Calibration Loop — Spec (labour actuals + estimate-vs-actual + settings suggestions)

**Status: Phase A BUILT 2026-07-22 (same day as scoping); Phases B and C not started.**
Idea #1 in `FEATURES_2.0_IDEAS.md`. This spec ABSORBS material tracking Phase 3
(`MATERIAL_TRACKING_SPEC.md`'s margin/calibration phase, parked "needs history") — when
B/C ship, Phase 3 is done and should be marked so there.

**Phase A as built:** `labour_log` table in `db/setup.sql` (**needs the manual
`psql … -f db/setup.sql` deploy step, same as `material_actuals` did**),
`GET/PUT/DELETE /api/labour` in `routes/api.js` (PUT upserts on `(job_id, work_date)`
with the same id-adoption contract as `/actuals`), backup export/import coverage
(`jobs[].labourLog`, additive on the v1 shape — old files stay importable), and a
"Time on site" card at the top of the Materials screen: per-day rows with editable
person-days, "+ Log today (full day)" one-tap (disabled once today is logged), and a
"Log a different day" date-picker row. Strict write helpers (`apiPutStrict`) per the
design principle — a failed save alerts, never silently drops a day. The shared
`acceptedSnapshot` stamp (build-order item 2) also shipped — see `JOB_PIPELINE_SPEC.md`'s
status note — so the card shows "N days logged · estimated ~M on site" for jobs accepted
from now on. Verified against the real routes with a stubbed db and the real UI against
a mock server (repo convention); the first live job is still the first live job.

## Purpose

FEATURES.md flags at least six settings as "guessed — calibrate against real jobs": the
sundries % (5), the spray sundries bump (3%), sprayed wall coverage (`cwSpray` 9 vs rolled 13),
the exterior assumed-area set, the masonry coverage 2×2, and `overheadMins` (45). Nothing in
the app accumulates the data to calibrate any of them. Material actuals exist per job;
**labour actuals exist nowhere**. This feature adds the missing half and the screen that
compares the two, so every completed job sharpens the model.

Three parts, buildable in order, each independently useful:

1. **Phase A — log days on site** (the data)
2. **Phase B — estimate-vs-actual per job** (the comparison, incl. materials margin)
3. **Phase C — settings suggestions across jobs** (the payoff)

## Design principles

- **Logging must cost one tap.** This is one person calibrating their own model, not
  timesheets. If it feels like admin it won't be done, and the whole loop dies at Phase A.
- **Suggestions, never auto-tuning.** The app shows what the data says next to the current
  setting, with a button to adopt. It never changes its own config — same philosophy as the
  sundries judgement call ("the control is the judgement, not the code").
- **Money derived, not typed** — same rule as material tracking. Margin comes from the
  311/314 purchase prices already riding the `/Items` payload.

## Phase A — labour log

### Data model

New table, columns not JSONB — it gets aggregated across jobs, same reasoning as
`material_actuals` (see that table's comment block; don't "fix" the inconsistency):

```sql
CREATE TABLE IF NOT EXISTS labour_log (
  id VARCHAR PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  work_date DATE NOT NULL,
  days NUMERIC NOT NULL DEFAULT 1,   -- 1 = full day, 0.5 = half day; nothing finer
  note VARCHAR NOT NULL DEFAULT '',  -- optional ("am only — rain", "2 of us")
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS labour_log_job_date ON labour_log (job_id, work_date);
CREATE INDEX IF NOT EXISTS labour_log_job ON labour_log (job_id);
```

- **One row per job per date** (the unique index). Logging the same day twice edits the
  existing row rather than erroring — upsert on `(job_id, work_date)`.
- `days NUMERIC` not hours: the app's whole labour model runs on `settings.dr`/`settings.hpd`
  day-rate maths. Full/half day is the resolution Nicky actually knows without a stopwatch.
  A "2 of us" day is `days: 2` — person-days, matching how `dr` prices work.
- **NOT deleted by Clear Rooms / recalculate anything** — it's actuals, same protection
  reasoning as `material_actuals`.
- API: `GET/PUT/DELETE /api/labour` following the `/actuals` route conventions in
  `routes/api.js` (job-scoped via the active job id, cast numerics at the boundary).
- **Backup:** add to `/backup/export` + import copy loop, keyed under each job. Bump nothing —
  additive field on the v1 shape (`jobs[].labourLog`), absent-tolerant on import, so old
  backup files stay importable.

### UI

- **A "Time on site" card on the Materials (tracking) screen** — that's the job-running
  surface today, already reached from the hamburger with the badge. Card shows: days logged
  so far vs estimate ("4 of ~5 days"), a **"+ Log today"** button (one tap: upserts
  `{work_date: today, days: 1}`), and a tap-to-edit list of logged days (switch to half day,
  fix a date, delete).
- "+ Log today" when today is already logged toggles nothing — it opens the existing row
  for edit. Never silently double-logs.
- No reminder/notification machinery in v1. If days turn out to get forgotten, the cheap
  fix later is a nudge on the attention strip (`JOB_PIPELINE_SPEC.md`), not push
  notifications.

## Phase B — estimate-vs-actual per job

A read-only comparison screen for a job, reachable from the Jobs list on any job with
status `completed` (and from the Materials screen once completed). Three sections:

### 1. Time

| | Estimated | Actual |
|---|---|---|
| Working days | from the engine (`ttS`-derived) | Σ `labour_log.days` |
| Days on site | `onSiteDays` (`realisticDays()`) | count of distinct logged dates |
| Calendar span | — | last log date − first log date |

- **Gotcha — estimates are computed from the ACTIVE job's in-memory arrays.** `calcRoom()`
  etc. read globals loaded by `loadActiveJobData()`. The comparison screen must therefore
  either (a) only open for the active job (switch first — acceptable v1), or (b) snapshot
  the estimate figures onto `jobs.data` when the job is marked accepted (better, and
  `SCHEDULING_SPEC.md` needs the same snapshot — build it once, see that spec's
  `job.scheduledDays`). **Do (b)**: on `setJobStatusById(id,'accepted')`, stash
  `{estWorkingDays, estOnSiteDays, estLabourS, estMaterialsTotal}` into `job.data.acceptedSnapshot`.
  This also freezes the "what was quoted" side against post-acceptance room edits, which
  would otherwise silently move the goalposts (and variations — see `VARIATIONS_SPEC.md` —
  are excluded from the snapshot by construction, which is exactly right: compare like
  with like, original estimate vs original scope... but note the actual labour log CAN'T
  split variation days out, so show a footnote line "includes N variation(s)" when the job
  has any, rather than pretending the comparison is clean).

### 2. Materials (quantities)

Per item code: estimated quantity (from `materials_snapshot`, rolled up by `item_code` —
same roll-up the actuals join already does) vs `actual_quantity`, with over/under highlighted.
Free-text actuals list at the bottom (no estimate to compare against).

### 3. Margin (this IS material tracking Phase 3)

- **Prerequisite plumbing:** `/material-groups` (`routes/xero.js:490`) filters on
  `SalesDetails` and throws `PurchaseDetails` away. Keep
  `purchasePrice: i.PurchaseDetails?.UnitPrice ?? null` and the purchase
  `AccountCode` on each item in the payload/cache. **Verify against the live payload
  first** — purchase prices have only ever been seen in the CSV export, never read from
  the API (same caveat class as the `TIK015` Status field note in FEATURES.md).
- Per actual row: billable = `actual_quantity` × 202 sales price; cost = `actual_quantity`
  × 311/314 purchase price; margin = difference. Job totals of each.
- **Free-text rows are excluded from margin** (no purchase price) — show them listed under
  the table with "not in margin" noted, never silently omitted.
- Labour margin is NOT computed. Labour is billed as quoted; the time section above already
  shows the real story (days over = margin eaten). Deriving a £ figure would double-report
  the same fact with false precision.

## Phase C — settings suggestions

A card on Settings (or a screen off it): each suggestion computed across the **last N
completed jobs that have labour logs** (N editable, default 8; a job with zero logged days
is excluded — no data, not "zero days").

What can honestly be computed, and only this in v1:

- **Days ratio** — Σ actual days / Σ estimated on-site days across included jobs. Shown
  against `overheadMins`/`bufferPct` with the implied buffer: "your last 8 jobs ran 12%
  over the on-site estimate → equivalent to bufferPct 12 (currently 0)". One-tap adopt
  writes `bufferPct`. (Adjusting `overheadMins` vs `bufferPct` is Nicky's call — the ratio
  can't tell which is wrong; say so on the card.)
- **Coverage per tin-role** — for roles whose actuals map cleanly to item codes (wall,
  masonry): Σ estimated tins vs Σ actual tins per role → "sprayed wall jobs used ~8% more
  wall paint than estimated → implied `cwSpray` ≈ 8.3 (currently 9)". Requires knowing
  which jobs were sprayed — the room flags are in the job's rooms data, available
  server-side. Start with wall/`cwSpray` only; extend role-by-role as data justifies.
- **NOT sundries.** The sundries % is deliberately untracked (`MATERIAL_TRACKING_SPEC.md`:
  "the % itself is never itemised, never tracked"), so there is no data to calibrate it
  from and this feature must not pretend otherwise. Calibrating it stays a judgement call
  from the margin numbers.
- **NOT exterior assumed areas** in v1 — the chain (assumed area → litres → tins) has two
  free variables (area and coverage); the data can't separate them. Revisit when there are
  enough exterior-only jobs to be worth it.

Every suggestion shows: the figure, the sample ("across 8 jobs, 41 estimated days"), the
current setting, and Adopt. **Adopt writes the setting and nothing else** — no cascade, no
recalcs of past jobs.

## Build order

1. Phase A table + API + card (small; starts accumulating value immediately — **ship this
   even if B/C wait**, history is the scarce resource, exactly the mistake Phase 3 parked on)
2. `acceptedSnapshot` stash on acceptance (shared with scheduling — coordinate)
3. Phase B screen (needs the purchase-price plumbing + live-payload verification)
4. Phase C suggestions (needs a few completed jobs' data before it shows anything — fine)

## Gotchas / for Nicky to confirm

- Person-days for "2 of us" days — right model, or should a helper's day count differently
  (different rate)? v1 assumes person-days at one rate.
- Jobs completed BEFORE Phase A ships have no logs and simply never appear in Phase C —
  no backfill UI in v1 (typing historic days from memory produces false data; if Nicky
  wants it anyway, the edit-a-date path technically allows it).
- The `material_actuals` deploy caveat applies here too: `db/setup.sql` must be run by hand
  against live (README step), or `/api/labour` 500s on a missing relation.
