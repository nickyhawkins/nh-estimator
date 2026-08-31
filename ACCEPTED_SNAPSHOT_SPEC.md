# Accepted-quote snapshots — Spec (stop agreed figures moving)

**Status: BUILT 2026-08-20 (v2.38.0).** Data model, acceptance capture, frozen render
paths, amend-as-revision, all three guardrails, and the one-off Xero reconciliation
migration. New `quote_snapshots` table — **run `db/setup.sql` on deploy** (it is also
created lazily on first use, so the app will not 500 if the deploy step is missed).

---

## The bug

Every figure in this app is **derived**. Rooms store dimensions, not prices. The
materials snapshot stores quantities, not coverage rates. Labour lives on the Rates
page as minutes-per-m². Opening a quote re-runs `calcRoom()`, `computeMaterials()` and
`computeDepositPlan()` over whatever those constants say **right now**.

That is exactly right for a draft, and silently destructive the moment a client says
yes. Nudge a coverage rate, recalibrate the day rate, change a markup default — and
every accepted quote in the app re-prices itself. No edit, no audit trail, nothing on
screen to say the number moved. Invoiced jobs included: the final invoice billed
"labour as quoted" by *re-running the quote's own maths*, so a client could be invoiced
for labour they never agreed to.

Nobody could see it happening, which is the worst property a bug of this kind can have.

## The fix, in one line

At acceptance the calc pipeline runs **once**; its whole output is serialised into an
append-only table; from then on the client-facing views read that record and never call
a calc function for an accepted job's agreed figures again.

---

## 1. Data model

`quote_snapshots` (see `db/setup.sql` for the full commentary):

| column | meaning |
| --- | --- |
| `id` | uuid |
| `job_id` | the job this belongs to |
| `version` | revision number, 1-based, derived server-side |
| `accepted_at` | when the client agreed |
| `reconciliation_level` | `full` \| `xero_lines` \| `totals_only` |
| `note` | why this revision exists ("accepted", "amended: added the study") |
| `data` | the serialised quote (below) |

Three properties, none decorative:

1. **Append-only.** There is no UPDATE and no DELETE path anywhere in the app —
   `routes/api.js` exposes `GET` and `POST` and nothing else, and the POST is a bare
   INSERT. Amending appends `version + 1`; the superseded row stays exactly as written.
   Rows leave only via `DELETE /jobs/:id`, which removes the whole job.
2. **A table, not another key on `jobs.data`.** That blob is PUT-merged whole on every
   status change, note edit and schedule tweak — a snapshot living there would be one
   careless spread away from being overwritten by a caller that had no idea it was
   carrying it. Separate rows can only be written by the one route that writes them.
3. **Self-contained.** `data` holds finished line items, prices and totals, *not* ids
   pointing at rooms or materials lines that will be edited, recalculated or deleted
   later. A snapshot must still render correctly after the job it came from has been
   rebuilt.

### What `data` holds (`buildAcceptedQuoteSnapshot`)

- `quote` — the client-facing model `buildClientQuoteHtml()`/`buildClientQuotePdf()`
  render, so a frozen quote reopens as the exact page the client was shown.
- `lines.work` / `lines.imported` / `lines.materials` — flat line items:
  description, quantity, unit price, line total.
- `materials.lines` (as billed), `materials.trackingOnly`, and `materials.working` —
  the calc's own reasoning: litres needed per role, the product/band it resolved to,
  and the tin combination bought. This is what lets "we bought three 5L tins" still be
  checked against the quote a year later.
- `labour` — `mode` (`calculated-days` / `standalone-diary-days` / `honoured`), day
  rate, hours per day, calculated days, diary days, on-site days, raw labour, sundries
  (with the percentages), the standalone top-up, and the labour total. All three
  pricing modes are recorded, not just the winner, so the frozen figure can be
  re-derived by hand from the snapshot alone.
- `markup` — type, value, resolved effective %, commercial flag and %, standalone flag
  and rounding granularity.
- `totals` — labour, materials, imported baseline, `exVat` / `vat` / `incVat`, deposit,
  deposit basis, balance.
- `rates` — **the whole Rates page, verbatim**, as it stood. ~90 numbers plus the
  coverage-rate table; a couple of KB against a permanent record of *why* the figures
  came out as they did. This is the field that makes a drift question answerable
  instead of arguable.

**VAT.** The business is not VAT registered — every Xero document this app writes goes
out `LineAmountTypes: 'NoTax'`. The three fields are recorded anyway, with
`vatRegistered: false` and `vatRate: 0`, so a snapshot taken before registration stays
unambiguous rather than being silently reinterpreted afterwards. If registration
happens, this is the one field to revisit.

**Penny reconciliation.** Live views round only at display time, so their lines and
totals may disagree in the third decimal and nobody ever sees it. A snapshot cannot
afford that: its lines become invoice lines and its total becomes the agreed total,
read side by side. Lines are therefore rounded **once**, and every total is the sum of
the rounded lines — the quote model's own subtotals are corrected to match. The
document, Summary, and the final invoice tie out exactly, forever.

### Inputs stay separate and unchanged

`rooms`, `exterior_items`, `materials_snapshot`, kitchen/fitted-unit config are
untouched and stay editable — that is how an accepted job gets amended into a new
revision. They are never used to re-derive an accepted figure.

### Home and Summary read different sources, and must still agree

Summary reads the snapshot. Home, the Jobs list and the attention strip read
`acceptedSnapshot`'s cached headline, because they render jobs whose snapshots are not
loaded (only the active job's are). That is fine while the cache tracks the snapshot —
and `captureQuoteSnapshot()` keeps it in step for acceptances made in the app. A snapshot
written any *other* way (the Xero reconciliation, another device) left it stale, and the
same job then showed two different totals on two screens.

Two changes close it. `jobHeadlineTotal()` states the order of authority once — frozen
snapshot when loaded, then the cache, then the live figure — and Home reads through it,
so the active job can never show a stale number. And `syncAcceptedSnapshotHeadline()`
reconciles the cache the moment a job's snapshots load, so the mismatch heals by opening
the job rather than needing a migration re-run. The snapshot itself is never touched;
this only ever writes the cache that reads from it.

A frozen job with **no measured scope** also no longer falls into Summary's "no rooms
yet" empty state — a reconciled job may never have been measured in the app, and hiding
the one figure that is certain about it was the wrong answer. It renders the frozen
record instead, same shape as the imported-job branch.

### Relationship to the existing `acceptedSnapshot`

`jobs.data.acceptedSnapshot` is a *different thing* and stays: a handful of comparison
figures (working days, on-site days, totals) that the Jobs list, the attention strip
and the scheduler read **without loading the job**. It is kept in step with the current
revision (merged, never replaced — `importedFromXero` and the hand-edited figures an
imported job carries live on the same object) so the list can't quote revision 1 while
the job is on revision 2.

## 2. Acceptance

`setJobStatusById(..., 'accepted')` calls `captureQuoteSnapshot(job, 'accepted')`.
Three conditions, all necessary:

- **not an un-complete** — undoing a mis-tapped Mark Completed returns to the *same*
  acceptance; re-freezing there would append a spurious revision at today's rates.
- **the active job** — the calc only runs over the loaded job's rooms.
- **no snapshot yet** — re-entering `accepted` from `quoted` after a bounce shouldn't
  stack revisions. Amending is an explicit action with its own button.

**Accepted from Xero.** `syncQuoteAnswersFromXero()` can accept a job that isn't open,
where nothing can be captured. That job gets `snapshotOwed`, and `captureSnapshotIfOwed()`
takes the capture the first time it is opened, flagged *"captured late"* in the history.
Drift in that window is normally hours; the alternative is unbounded. Jobs accepted
*before this shipped* are deliberately **not** self-healed — they may be months old and
today's rates say nothing about what was agreed. Those are the migration's job.

**Offline.** Acceptance happens on site, which is where there is no signal. Captures
queue in `pendingQuoteSnapshots` (localStorage), render immediately as the live
revision, and flush on reconnect and at startup. The generic offline queue can't carry
them: it dedupes by `(method, path)` and every capture posts to the same path, so two
jobs accepted offline would collapse into one.

**Concurrency.** `version` is derived *inside* the INSERT (`COALESCE(MAX(version),0)+1`),
so two devices accepting at once can only both compute the same MAX — and
`quote_snapshots_job_version` turns that into a unique violation for the loser, which
409s and retries. Never a silent overwrite. (Verified: 8 concurrent POSTs → 7 rows at
7 distinct versions, 1 × 409.)

## 3. Rendering

`jobQuoteIsFrozen(job)` — status in `accepted`/`completed`/`invoiced` **and** a snapshot
exists — is the one predicate every path branches on. Both halves matter: a snapshot
left behind by an un-accept must not freeze the resulting draft, and an accepted job
with no snapshot must fall back to live rather than render blank.

| Path | Frozen behaviour |
| --- | --- |
| Client quote preview + PDF (`openClientQuote`) | Returns from the snapshot **before a single calc call**. Prints "revision N", and the footer says the figures don't change with later price revisions. PDF filename is `…-accepted-revN.pdf` — dated by the agreement, not the export. |
| Summary | Hero shows the agreed total, labelled "Accepted Quote"; an "Agreed figures — revision N" banner; an agreed line-items card straight from the snapshot; deposit/balance from the snapshot. The Labour stat tile and the status card's deposit nag read the snapshot too, so every figure above the working divider is agreed money. The live recalculation is still shown, but only as a labelled aside ("Same job at today's rates: £X — not what was agreed") and only when it differs. |
| Pricing controls | Commercial / Standalone / Markup are read-only, under one strip saying so, with **Unlock for amending** to open them (§3.1). |
| Room Breakdown | Stays live, below the working divider (§3.1) rather than carrying a note of its own — it is where a variation added after acceptance shows as a priced row, and it holds the days and per-surface detail the snapshot does not. |
| Cost Summary | **Not rendered.** It is the pre-markup working of a superseded quote, and under the accepted total it read as that total's breakdown (§3.1). |
| Final invoice | Quoted-labour lines are replaced wholesale by the snapshot's work rows at the amounts it recorded. Still droppable — what's fixed is each line's price, not whether it's billed. Sundries are not re-derived (they're already one of the frozen rows). |
| Job profitability | `quotedTotal`, `quotedDays` and `quotedMaterials` come from the snapshot, so margin on finished work stops moving with the rates. |
| Xero re-send | Can't read the snapshot (the payload is raw line totals plus a markup instruction the server applies), so instead the drift is put on screen: "accepted at £X (revision N) — sending now builds the quote at today's rates: £Y. Send anyway?" Only when the two differ. Nothing about it writes a snapshot. |

### 3.2 The drift aside names the difference, not a cause

The aside under the hero used to read *"Same job at today's rates: £X — not what was
agreed"*. It names a **cause**, and usually the wrong one: every input feeds that figure —
scope, the materials list, the job's own flags — and the rates are the one thing that
most often has *not* moved. Someone reading it goes to the Rates page, finds nothing
changed, and is left with a number they cannot account for.

It now states the fact (*"Same job priced today: £X — £Y more, broken down below"*) and
`quoteDriftCardHtml()` attributes it, from the snapshot alone:

- **Labour** and **Materials**, agreed → today, each marked unchanged or moved. The
  adjustment pool (the standalone upcharge and the round-up to the next £5) is spread
  across the labour lines, so it is pulled out into its own row — otherwise an extra tin
  of paint, which changes where the total lands against the next £5, reads as labour
  having moved.
- **Whether the Rates page is any part of it.** `rates` holds the whole settings blob as
  it stood, so the scalars are diffed by name (using the Rates page's own labels, read off
  the inputs it already renders) and the entire blob is compared besides. Only when every
  key matches does the card say so — *"No rate or setting has changed since acceptance —
  the difference is in the job itself"* — which is the sentence that actually answers the
  question. A snapshot rebuilt from a Xero total has no `rates`, and says that instead of
  guessing.

The card renders only when the two figures differ, and reading it writes nothing.

### 3.1 One boundary, not five hints

An accepted job's Summary carries both worlds, so the screen has to say where one
ends. It used to say it once, on the Room Breakdown header — while **Cost Summary**
and **Materials**, directly underneath and equally live, said nothing. Cost Summary
was the worst of them: "Labour subtotal / + markup / Price rounding" reads as the
breakdown of the accepted total two screens above it.

`workingFiguresDividerHtml()` draws one rule after the Payment card instead —
*"Working figures — today's rates. Everything below this line is the live
calculation, not what the client agreed."* — and the per-card notes come off. A
boundary in the same place every time is learnable; five differently worded hints
are not.

That makes a claim about everything **above** the line, which had to be made true:
the Labour stat tile and the deposit nag both printed live figures next to the
agreed total and now read the snapshot. On Site stays live — days are booked in a
diary, not agreed in a quote.

**Cost Summary is dropped entirely on a frozen job.** Of the three live sections
it was the only one with nothing left to do. The room breakdown earns its place
twice over — a variation agreed after acceptance is priced at today's rates and
shows there and nowhere else, and the per-element working (prep, walls, ceiling,
woodwork, days) is detail the snapshot does not hold. Materials is the shopping
list, bought at today's prices. Cost Summary is the pre-markup working of the
quote itself — labour subtotal, sundries %, markup, the £5 round-up — and once a
snapshot governs, that quote is superseded. Drift is already stated at the top by
the hero's "same job at today's rates" aside, and the one use left, previewing
what an amendment would come to, `amendAcceptedQuote()` covers itself: it prompts
with revision N, revision N+1 and the delta before writing anything.

The three pricing controls are locked there (`acceptedPricingLocked()`), the way
the deposit toggle already was: nudging markup on an accepted job moves every
working figure while the headline stays put, which is precisely the confusion the
divider exists to end. Locked, not removed — `amendAcceptedQuote()` re-runs the
calc over the job's *current* settings, so they still price the next revision.
**Unlock for amending** opens them, per job id (a session flag would survive a job
switch and there would be a reset to forget). Nothing here reads or writes a
snapshot.

**What stays live, deliberately:** drafts and quoted jobs; material actuals, the labour
log, variations and scheduling (none of those are the agreed quote — they're what's
really happening on site); the Measure tab's own breakdowns (they're the inputs).
Variations are priced at today's rates *because that's when they were agreed*, and they
settle on the final invoice.

**An accepted job with no snapshot** gets a red banner saying so in as many words:
*"These figures are live, not frozen… priced at TODAY's rates — not necessarily what
the client agreed."* That state was previously invisible, which is the whole problem.

## 4. Amending

Never an edit — the snapshot is immutable and there is no endpoint that could change it
even if this wanted to. `amendAcceptedQuote()` re-runs the calc over the job's *current*
inputs, shows the before/after totals and the delta, asks what changed, and appends the
result as the next revision. Earlier revisions stay exactly as written and are viewable
via `openSnapshotHistory()` (revision, date, level, note, total and the delta against
the one before). Client-facing views default to the latest.

**Un-accepting does not delete the snapshot.** The job stops being accepted, so the app
renders live again — correct, it's a draft once more — while the record that these
figures were once agreed survives. Re-accepting appends a fresh revision.

## 5. Guardrails

Three, in decreasing order of how hard they are to bypass:

1. **Structural.** No UPDATE or DELETE endpoint exists. A render path that wanted to
   "correct" a stale snapshot has nothing to call.
2. **Runtime.** `deepFreezeSnapshot()` freezes every snapshot before a render path sees
   it, so a caller that treats one like a live model throws instead of silently
   rewriting agreed figures in memory.
3. **Static — `npm run check:snapshots`.** Catches the failure the other two can't: not
   a write, but a *read that stops happening* — an accepted-render path quietly going
   back to the live calc. Asserts the server surface stays GET+POST with the version
   derived in the INSERT, that the frozen renderers call none of the twelve live calc
   functions, that `openClientQuote()` branches before any calc runs, that snapshots are
   written only through `captureQuoteSnapshot()`/`flushPendingSnapshots()`, and that
   loaded snapshots are deep-frozen. Comments and string literals are blanked before
   scanning, so the check can document itself without tripping over its own prose.

`npm run test:snapshots` is the behavioural counterpart — see below.

## 6. The one-off migration

`npm run migrate:accepted-snapshots` (`scripts/migrate-accepted-snapshots.js`). Dry run
by default; `--apply` writes. It does **not** recompute anything — recomputing is the
bug. Figures come from Xero, where the documents the client actually received have been
sitting unchanged the whole time.

**Quotes only.** An invoice is the *bill* — variations and materials-as-used are inside
it — so reconciling an accepted quote from one records a number the client never agreed
to as though they had. `--include-invoices` opts in for jobs whose quote genuinely isn't
in Xero, where a caveated invoice figure beats a figure that keeps drifting, but it is
not something to hit by accident.

Match order:

1. `xeroQuoteId` / `xeroQuoteNumber` → the accepted quote. Itemised, exact →
   `xero_lines`.
2. Contact name, reference and date, for jobs whose link was never recorded. Listed as
   **NEEDS A HUMAN** and never applied without `--allow-fuzzy`; two candidates within
   0.5 of each other are reported as ambiguous rather than picked.
3. No match → left alone and listed, with whatever figure the app is currently showing,
   so it's obvious which jobs still need a decision. `--explain` prints the closest
   Xero documents with their name/reference/date scores, so "but it *is* in Xero" always
   has a visible answer.
4. `--include-invoices` only: `xeroInvoiceId` / `xeroInvoiceNumber`, with an explicit
   caveat stored in the snapshot.

### One Xero quote belongs to one job

Every exact link in the run is resolved **before** any fuzzy guess is allowed to claim a
document, and a matched document is then out of the pool. Without that ordering a job
processed early takes, on a name match, the very quote a later job is explicitly linked
to — and the same agreed figures get written onto two jobs. It happened on the first
real run: two "Beryl Parsons" jobs both landed on £1,210.33.

### The headline cache must be kept in step

`acceptedSnapshot.estQuoteTotal` is a **derived cache** of the current revision. Home,
the Jobs list and the attention strip read it directly, because they render jobs whose
snapshots aren't loaded — only the active job's are. `captureQuoteSnapshot()` updates it
on every capture; the migration originally did not, so a reconciled job showed the
reconciled figure on Summary and the old acceptance stamp on Home for the same job.

The migration now updates it on every write, and repairs any job where the two have
already diverged — reported as `WOULD REPAIR` / `REPAIRED`. Syncing a cache to its
source is not a mutation of the record: the snapshot itself is never touched, and the
merge preserves `importedFromXero`, the hand-edited figures and the day estimates a Xero
quote can't supply.

### Correcting a wrong reconciliation

A job that already has a snapshot is skipped — **unless** it is explicitly `--pick`ed.
That is the correction path for a job frozen against the wrong quote (early runs let
`--allow-fuzzy` settle ambiguous matches, which it no longer does). The pick appends a
**corrective revision**; the wrong one is neither deleted nor edited — it cannot be — and
stays in the history where an audit can see what happened. The app reads the latest
revision, so the corrected figure is the one that shows.

### Jobs imported from Xero are skipped

`importAcceptedQuote()` creates a job from an already-accepted Xero quote and stamps the
agreed total onto `acceptedSnapshot.estQuoteTotal`. That is a **stored constant** —
Summary renders it directly via `importedJobSummaryHtml()`, no calc function involved —
so these jobs were never drifting, which is the entire problem this migration repairs.
Reconciling them gains nothing at best.

At worst it destroys information. Once such a job is **amended** here — rooms added to
work originally agreed in Xero — the app prices it as the frozen imported baseline *plus*
the added scope. The Xero quote is then only part of the agreed money, and writing it as
the whole snapshot would silently drop everything agreed since.

The same applies to a job flagged `isXeroImported` with a `honouredLabourAmount`: its
agreed total is that honoured figure plus materials as measured, which no single Xero
quote states. Reconciling one from Xero under-records it by the whole materials side.

They are therefore skipped and listed in their own section, never silently swallowed. The
amended and honoured ones need a snapshot taken **in the app** (open the job, Amend) —
the only place that can see every part of what was agreed at once. `--include-imported`
overrides, and the report says so.

### Quote status is the term that removes the ambiguity

An ACCEPTED quote is not a slightly better candidate than a DRAFT for the same client —
it is *the document*, and the draft is a discarded attempt. Scoring ignored status
entirely at first, so a client with one accepted quote and three superseded drafts
produced "4 equally good matches", and the run could pick a draft. Status is now weighted
(ACCEPTED/INVOICED +6, SENT +1, DRAFT −3, DECLINED/DELETED −6), which collapses almost
every ambiguity to a single obvious answer. Non-accepted quotes still score, because a
job accepted in the app may never have been flipped in Xero; they simply can't outrank an
accepted quote for the same client.

Snapshots written before this was weighted may point at a draft. The migration audits
already-frozen jobs against the current best candidate and reports **FROZEN AGAINST THE
WRONG QUOTE** with the exact `--pick` to correct it. It cannot and does not rewrite them.

### `--allow-fuzzy` accepts a guess; it does not resolve an ambiguity

Two different situations, and conflating them was dangerous. `--allow-fuzzy` accepts a
*confident* name match — one plausible quote, sensible date. It deliberately will **not**
accept:

- **an ambiguous match** — several candidates scoring within 0.5 of each other. What the
  client agreed to pay is not something a blanket flag gets to decide.
- **a match outside the date window** — it may have been the only candidate, but the only
  candidate can still be the wrong one. On the first real run this path proposed a
  **2020** quote for a 2026 job, and `--allow-fuzzy` would have written it.

Both go to **NEEDS YOUR DECISION**, which lists every candidate with its number, amount,
date and contact, and prints the `--pick` line to paste.

`--pick "<job name or id>"=QU-0287` (repeatable) settles one job by naming its quote.
A pick naming a quote another job already holds is refused. It accepts the job **name**
as well as the id, because names are what the report shows.

### The report ends with what to do

Each section is an *ask*, so the closing block turns them into numbered, pasteable
commands in the order they should be run — apply the ready ones, `--pick` the undecided
ones, `--explain` the unmatched ones — and states that nothing has been written and every
command is safe to re-run.

### Reading the report

`acceptedSnapshot.estQuoteTotal` is the **acceptance stamp** — the figure the app froze
onto the job when it was marked accepted. It is *not* "what the app is showing", which
is the live recalculation this script deliberately never runs. A gap between stamp and
Xero quote means the app's own record and the Xero document disagree about that job
(quote amended in Xero after acceptance, or the job edited here between sending and
accepting) — not a measure of rate drift. Differences of a penny or two are this script
summing rounded Xero lines against a figure the app rounded once, and are reported
quietly; anything larger is flagged and summarised, because the Xero document wins and
it is worth knowing which jobs are about to move.

### Three things that made real matches disappear

Worth stating, because each read on screen as "no matching Xero document" when the
document was sitting in Xero the whole time:

- **Xero pages at 100 records and gives no more-pages flag** — a short page *is* the
  end marker. Fetching `/Quotes` without a `page` parameter returns the first hundred
  and nothing else, so on any real history most quotes were never loaded. The fetch now
  pages until a short page comes back.
- **Names were compared for exact equality after normalisation**, so "Mrs J Patel" and
  "J Patel", "D & S Hall" and "D and S Hall", "Blake Ltd" and "Blake Limited" were all
  different people. Matching is now token containment with titles and company suffixes
  treated as noise, and both `xeroClient` and the job name are tried against both the
  Xero contact and the reference — a job named for its address often matches the
  reference, not the contact.
- **The date window was a veto**, discarding a perfect name match on a quote written
  more than `--fuzzy-days` before acceptance, and scoring nothing at all for a job with
  no `acceptedAt`. It is now a tiebreaker: a far-off date costs points and earns a
  warning on the line rather than deleting the candidate.

A document with no priced lines becomes `totals_only`: one honest lump. The agreed money
is right and the breakdown is genuinely unknown — inventing a plausible split would be
worse, because a plausible split gets believed. `rates` is `null` and the `labour`
fields are `null` for the same reason.

Line classification is by account code (201 labour, 202 materials — the convention every
app-made quote uses), falling back to the description; description-only £0 divider rows
are dropped.

**The lock** the brief asks for is simply the snapshot's existence: with a row present
the app reads the agreed figures and never the live calc, so no future rate change can
reach the job. Job status is deliberately *not* rewritten — these jobs are already
accepted/completed/invoiced, and touching a lifecycle field to "lock" something already
locked would only risk moving a job backwards in the pipeline.

**Safe to re-run**: a job that already has a snapshot is skipped, and the script has no
way to overwrite one.

`--file <export.json>` takes a Xero export (a Quotes or Invoices API response body, or
an array of either) for running without a live connection.

**npm swallows flags.** `npm run migrate:accepted-snapshots --apply` runs a dry run and
says nothing about it — the flag never reaches the script. The bare `--` separator is
required: `npm run migrate:accepted-snapshots -- --apply`.

The report names the drift it finds, e.g.:

```
RECONCILED — 3 jobs
  Ermine Street          £4,380.00   xero_lines   · linked xeroQuoteId  (app was showing £4,100.00 — out by £280.00)
  Church Lane            £2,755.00   totals_only  · linked quote number QU-0107  (app was showing £2,600.00 — out by £155.00)
                                     ⚠ No line detail in the Xero export — the total is exact, the breakdown is not available.
```

## 7. Verification

`npm run test:snapshots` (`scripts/test-accepted-snapshots.js`) drives the real app in
Chromium against a real database — 38 checks. The central one doubles the day rate,
halves wall coverage and adds 25 markup points, then asserts the **live** figure moves
(£1,367.51 → £2,823.87, so the test is exercising something real) while every **agreed**
figure — Summary hero, client quote model, PDF, final-invoice labour — stays at
£1,367.51. It also covers: snapshot contents (line items, materials working, labour
mode, rates, VAT triple), penny-exact ties between lines and totals, amend appending a
revision while revision 1 stays readable, latest-revision defaulting, in-memory
immutability, un-accept resuming live pricing without destroying the record, and the
accepted-with-no-snapshot warning.

It needs a scratch `DATABASE_URL`, the app running against it, and
`npm i --no-save playwright` (not a project dependency). It seeds and clears its own
fixture job, so it is safe to re-run.

## Gotchas found while building

- **`$2` used as both an INSERT value and a WHERE predicate** makes Postgres refuse to
  infer a type at all (`inconsistent types deduced for parameter $2`) rather than
  guessing. Cast it: `$2::varchar`.
- **`materialRow()` returned only rendered HTML**, so the tin/coverage detail existed
  only inside a string. It now also returns `label`/`detail` as plain fields — additive,
  same pattern as `colourNumber`/`role` on `roleRowsFromGroups()`.
- The frozen final-invoice rows must **suppress the honoured-labour and
  imported-baseline branches**: `buildClientQuoteModel()` already folds both into the
  work rows, so letting those branches also run bills the same money twice.
