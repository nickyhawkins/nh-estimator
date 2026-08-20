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
| Summary | Hero shows the agreed total, labelled "Accepted Quote"; an "Agreed figures — revision N" banner; an agreed line-items card straight from the snapshot; deposit/balance from the snapshot. The live recalculation is still shown, but only as a labelled aside ("Same job at today's rates: £X — not what was agreed") and only when it differs. |
| Room Breakdown | Stays live, relabelled *"live working at today's rates, not the accepted figures above"*. |
| Final invoice | Quoted-labour lines are replaced wholesale by the snapshot's work rows at the amounts it recorded. Still droppable — what's fixed is each line's price, not whether it's billed. Sundries are not re-derived (they're already one of the frozen rows). |
| Job profitability | `quotedTotal`, `quotedDays` and `quotedMaterials` come from the snapshot, so margin on finished work stops moving with the rates. |
| Xero re-send | Can't read the snapshot (the payload is raw line totals plus a markup instruction the server applies), so instead the drift is put on screen: "accepted at £X (revision N) — sending now builds the quote at today's rates: £Y. Send anyway?" Only when the two differ. Nothing about it writes a snapshot. |

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
