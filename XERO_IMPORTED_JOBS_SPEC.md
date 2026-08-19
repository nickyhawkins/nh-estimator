# Xero-imported jobs — honoured pre-app quote — Spec

**Status: BUILT 2026-08-19.** No DB migration: both fields ride `jobs.data` (JSONB),
like every other job-level flag.

## The problem

A batch of jobs was quoted and agreed **in Xero, before the app ever priced them**. They
already exist in the app — they came in through the Xero quote importer
(`importAcceptedQuote()`), which creates a roomless job carrying the agreed total on
`acceptedSnapshot.estQuoteTotal`.

Those jobs are being **honoured at the agreed figure**, but they still want measuring out
here — rooms, materials, day rate — so the app's own numbers can be calibrated against
real work. That gives two totals per job, and the app previously had nowhere to keep
them apart: the agreed one the client pays, and the calculated one that is purely
internal.

## The two fields

Both on the job record (`jobs.data`, persisted via `persistJobData()`):

| Field | Type | Default | Written by |
|---|---|---|---|
| `isXeroImported` | boolean | `false` | the toggle on Summary |
| `honouredQuoteAmount` | number, nullable | `null` | the amount field on Summary |

`honouredQuoteAmount` is **entered once and never recalculated by anything in the app**.
Re-measuring the job, adding a variation or editing materials can never move the figure
the client was promised.

Flipping the toggle **on** seeds it from `acceptedSnapshot.estQuoteTotal` — the agreed
total the importer already stamped on the job — so retro-flagging the batch is a tap per
job rather than re-typing a figure the app is already holding. That is a **seed, not a
recalculation**: it fires only when there is no amount yet, so it can never overwrite a
figure typed or corrected by hand, including across a toggle off/on round trip. Only
`importedFromXero` snapshots are a seed source; an engine-quoted job's snapshot is not.

Three helpers gate everything (all in `public/index.html`):

- `jobIsXeroImported(job)` — the flag.
- `jobHonouredQuote(job)` — the amount, or `null`. **Blank and zero both read as "not
  entered"**: a £0 agreement is never real, and treating one as real would blank the
  quote on a job whose amount simply hasn't been typed in yet.
- `jobShowsHonouredQuote(job)` — **both** of the above. Every display override keys on
  this one, so a half-set job (flagged, no amount yet) behaves completely normally
  instead of showing a blank or £0.00 quote.

## What changes, and what deliberately doesn't

**Nothing about pricing.** Rates, per-product coverage and day-rate calculations are
untouched. Rooms, materials and the engine total calculate on a flagged job exactly as
they do on any other. The flag only changes **which figure is displayed as the quote**
and **what the profitability card compares**.

### 1. Job edit/detail view — the toggle

`xeroImportedCardHtml(job)` renders the card: **"Imported from Xero (pre-app quote)"**,
and, once on, a **Honoured quote £** field.

It sits on **Summary**, which is this app's job edit/detail view — the same place the
`Commercial job` and `Standalone job` flags live, on the same job record. Deliberately
**not** in the creation flow: these jobs already exist, and the toggle is there to
retro-flag the existing batch.

The card renders on **both** Summary bodies:

- the full quote view (`renderSummary`), and
- the compact imported-job view (`importedJobSummaryHtml`), which is the **only** Summary
  a roomless imported job renders — i.e. exactly the jobs being retro-flagged, before
  anyone measures them.

### 2. Measure tab — no changes

Rooms, materials and the day rate all work as normal, producing the existing calculated
total. That total **is** the "internal estimate" — conceptually only, no new field: it is
just relabelled where it's displayed for flagged jobs.

### 3. Summary / Quote screen

With the flag on and a usable amount:

- The hero reads **"Quote (honoured)"** and shows `honouredQuoteAmount`.
- A secondary line underneath reads **"Internal estimate £X — reference only"**, carrying
  the app's calculated total.
- Variations still stack **on top of** the honoured figure, exactly as they stack on top
  of a calculated one.

**No double-counting.** For a job that came in through the importer,
`acceptedSnapshot.estQuoteTotal` holds the same agreed money `honouredQuoteAmount` does.
The honoured amount therefore **supersedes** that baseline (`importedBaseline` goes to 0)
rather than stacking on it.

### 4. Client-facing quote view + PDF

The honoured figure is the total on both. The internal breakdown behind it — the work
card, the materials card, the payment plan and the terms — is **left off entirely**: the
client agreed that price against a Xero quote, not against anything measured here, and
printing rows that sum to a different number than the total would read as an error on
the client's copy. The app's calculated total never appears on the client document at
all; it's reference-only by definition.

The colour schedule and any variations still print — neither is priced off the internal
estimate.

### 5. Job Profitability

A flagged job gets one extra section, **first on the card** (it's the headline on these
jobs):

```
XERO-IMPORTED JOB
Honoured quote (Xero)            agreed before the app — what the client pays
Internal estimate (app)          rooms, materials and day rate as measured here
Actual (days + materials used)   days logged × day rate, plus materials as used
Honoured vs actual               ± the difference
```

Plus a note when the honoured figure and the internal estimate disagree.

"Actual" values the days logged at the day rate and adds the materials actually used at
sell — the same two figures the Schedule and Materials sections already show, added up so
the third column is like-for-like with the other two.

**The existing billing / schedule / days variance logic is unchanged**, on flagged and
non-flagged jobs alike. On a non-flagged job every field feeding this section is
`null`/`false` and the card renders exactly as it did before.

## Known gap — final invoice

`buildFinalInvoiceModel()` (the "Original quote … — from Xero" line) still reads
`acceptedSnapshot.estQuoteTotal` and is **not** aware of `honouredQuoteAmount`. On a
flagged job that has since been measured, the final invoice will therefore offer both
that line **and** the calculated room lines. Each line is droppable in the builder, so
it's visible rather than silent — but whether a final invoice should bill the honoured
quote or the measured work is a **product decision that hasn't been made**, so nothing
was guessed here.

## Cleanup — a future prompt, NOT part of this build

Once every `isXeroImported` job is complete, the feature can simply be **left dormant**:
the toggle just won't be used on new jobs, and nothing else changes.

If full removal is wanted later, that is its own separate piece of work:

1. Delete `isXeroImported` and `honouredQuoteAmount` from the job record (including the
   `persistJobData()` field list).
2. Remove the toggle card from the job edit screen (`xeroImportedCardHtml` and both call
   sites).
3. Remove the "Internal estimate" secondary line from Summary, and restore the plain
   `Total Quote` hero.
4. Remove the extra comparison row from Job Profitability.
5. Restore the client quote view/PDF to always render the work/materials/payment cards.

Do not attempt any of that until it's explicitly asked for.
