# Xero-imported jobs — honoured pre-app labour — Spec

**Status: BUILT 2026-08-19.** No DB migration: both fields ride `jobs.data` (JSONB),
like every other job-level flag.

## The problem

A batch of jobs was quoted and agreed **in Xero, before the app ever priced them**. They
already exist in the app — they came in through the Xero quote importer
(`importAcceptedQuote()`), which creates a roomless job carrying the agreed total on
`acceptedSnapshot.estQuoteTotal`.

Those jobs are being **honoured at the agreed price**, but they still want measuring out
here — rooms, materials, day rate — for two reasons: the **material estimates are real
and needed** (buying, tracking, the final invoice), and the app's own numbers want
calibrating against real work.

That gives two totals per job, and the app previously had nowhere to keep them apart: the
agreed one the client pays, and the calculated one that is purely internal.

## What gets frozen: labour, not the total

**The billing model governs this, and it is the same one every other job follows**
(`MATERIAL_TRACKING_SPEC.md`, restated in `FINAL_INVOICE_SPEC.md`):

> labour is billed **AS QUOTED**; materials are quoted as an estimate and billed
> **AS USED** (`material_actuals` IS the invoice's materials list)

The materials figure inside a pre-app Xero quote was an estimate exactly like any other.
So freezing the whole agreed total would quietly break that rule — measure £1,400 of
materials against a quote that estimated £1,250 and the client would still be shown the
old number.

**So the labour is what's honoured and frozen. Materials come live from the room measure
and settle as used, same as always:**

```
quote figure = honoured labour + materials as measured here
```

The honoured labour **replaces the app's whole calculated labour side** — engine labour,
sundries, standalone top-up, markup and custom lines included — so nothing is counted
twice. Anything genuinely extra agreed after the fact belongs on **Variations**, which
already stack on top of the quote; the toggle card says so when a flagged job has custom
line items.

## The two fields

Both on the job record (`jobs.data`, persisted via `persistJobData()`):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `isXeroImported` | boolean | `false` | the flag |
| `honouredLabourAmount` | number, nullable | `null` | the **labour** half of the agreed price, in £ |

`honouredLabourAmount` is **entered once and never recalculated by anything in the app**.
`setJobHonouredLabour()` is its only writer — re-measuring the job, adding a variation or
editing materials can never move the labour figure the client was promised.

Helpers (all in `public/index.html`):

- `jobIsXeroImported(job)` — the flag.
- `jobHonouredLabour(job)` — the figure, or `null`. **Blank and zero both read as "not
  entered"**: a £0 labour agreement is never real, and treating one as real would strip
  the labour out of the quote on a job whose figure simply hasn't been typed in yet.
- `jobShowsHonouredQuote(job)` — **both** of the above. Every display override keys on
  this one, so a half-set job behaves completely normally instead of quoting materials
  with no labour.
- `importedQuoteSplit(job)` / `importedHonouredLabourSeed(job)` — the prefill, below.

### Prefill

Flipping the toggle **on** seeds the labour figure from the imported quote's own split, so
retro-flagging the batch is a tap per job. Two ways to know it and **no third guess**:

1. `acceptedSnapshot.estLabourTotal` — the quote's Xero **201 (labour)** lines.
2. `estQuoteTotal − estMaterialsTotal` — total minus the **202 (materials)** lines.
3. Otherwise **nothing is seeded**, and the card says why. Seeding the whole total would
   silently treat the materials estimate as labour and then add measured materials on top
   of it, inflating the quote.

The split comes from account codes in `/auth/accepted-quotes`, so it's there when the
quote was coded that way and zero when it wasn't — hence the degrade rather than a guess.

It's a **seed, not a recalculation**: it fires only when there is no figure yet, so it can
never overwrite one typed or corrected by hand, including across a toggle off/on round
trip. Only `importedFromXero` snapshots are a seed source; an engine-quoted job's snapshot
is not.

## What changes, and what deliberately doesn't

**Nothing about pricing.** Rates, per-product coverage and day-rate calculations are
untouched. Rooms, materials and the engine total calculate on a flagged job exactly as
they do on any other. The flag only changes **which figures are displayed** and **what the
profitability card compares**.

### 1. Job edit/detail view — the toggle

`xeroImportedCardHtml(job)` renders **"Imported from Xero (pre-app quote)"** and, once on,
a **Honoured labour £** field. It shows the imported quote's split back as the evidence
for the figure in the field — which is also how a mis-coded 201/202 quote gets spotted.

It sits on **Summary**, this app's job edit/detail view — the same place the `Commercial
job` and `Standalone job` flags live, on the same job record. Deliberately **not** in the
creation flow: these jobs already exist, and the toggle is there to retro-flag them.

The card renders on **both** Summary bodies: the full quote view (`renderSummary`) and the
compact imported-job view (`importedJobSummaryHtml`), which is the **only** Summary a
roomless imported job renders — i.e. exactly the jobs being retro-flagged.

#### Where it is offered (v2.45.3)

It originally rendered on **every** job. It only ever applies to the handful whose labour
was agreed outside this app, so on an ordinary job it was a standing invitation to flip a
flag that throws the app's whole labour side away. Both call sites now go through
`xeroImportedSectionHtml(job)`, which renders the card when it can be meant and otherwise
a single line — *"Labour agreed in a pre-app Xero quote?"* — that reveals it in place:

| Case | Test | Why |
|---|---|---|
| already flagged | `jobIsXeroImported` | a flag that is ON is never hidden, nor is the figure feeding the quote |
| came in through the importer | `importedQuoteSplit(job) != null` (an `importedFromXero` snapshot) | exactly the jobs the card exists to retro-flag — and the compact Summary is the only one they render, so the card is always on it |
| revealed by hand | `job.id === xeroImportedRevealJobId` | below |

The reveal is **session-only and per-job**, deliberately: there is nothing here worth
persisting, and flipping the toggle on hands the job to case 1 from then on. It is **not**
cleared when the toggle goes back off, so the card cannot vanish under the finger that just
used it.

Case 3 exists because case 2 cannot see every job that needs the flag. `linkQuoteToJob()`
ties an existing app job to its accepted Xero quote but writes **no** `importedFromXero`
snapshot, and a job typed in by hand against a quote agreed in Xero has no snapshot either.

**This is visibility only.** Every field, helper and downstream branch is untouched, flagged
jobs behave exactly as before, and the cleanup list at the end of this spec is still a
separate future job that is still not this.

### 2. Measure tab — no changes to pricing, one changed default

Rooms, materials and the day rate all work as normal. That calculated total **is** the
"internal estimate" — conceptually only, no new field: it is just relabelled where it's
displayed for flagged jobs (the hero strap-line and the Labour stat card).

**The variation auto-on default is OFF on these jobs** (`variationDefaultsOn()`, v2.34.1 —
see `VARIATIONS_SPEC.md`). Every other accepted job pre-flags a newly added room as a
variation, on the reasoning that anything added after acceptance must be extra. That
reasoning inverts here: these jobs are imported already-accepted and roomless, and the
whole point of measuring them out is to write down the scope the agreed price already
covers. Left auto-on, the entire retro-measure arrived flagged — and since variations
stack **on top of** the honoured labour, that billed the client a second time for work the
agreed price included.

So on a flagged job (and on an importer-created job not yet flagged) new rooms, exterior
items and fitted units default to **original scope**, with the toggle still visible so a
genuine extra agreed after the Xero quote can be flagged by hand. The toggle card says so,
because it reverses the behaviour everywhere else.

### 3. Summary / Quote screen

With the flag on and a usable figure:

- Hero reads **"Quote (honoured labour)"** and shows `honoured labour + measured materials`.
- Strap-line spells out the two halves: *"£3,000.00 labour as agreed + £480.00 materials
  as measured"*. The markup strap-line is **dropped** on these jobs — the app's markup
  didn't price this labour, so quoting it would misstate where the number came from.
- Below that: **"Internal estimate £X — reference only"**, the app's own calculated total.
- Variations still stack **on top**, exactly as they do on a calculated quote.

**No double-counting.** For a job that came in through the importer,
`acceptedSnapshot.estQuoteTotal` holds the same agreed money the honoured labour is drawn
from, so the honoured figure **supersedes** that baseline (`importedBaseline` → 0).

### 4. Client-facing quote view + PDF

The work card prints **one honoured labour line** ("Labour — as agreed (QU-nnnn)") instead
of the engine's room lines: the client agreed a labour price, not a room-by-room breakdown
this app produced afterwards, and printing rooms that sum to a different number than the
labour subtotal would read as an error on their copy.

**Materials are untouched** — itemised as always, with the same *"estimated here and billed
as actually used"* note the client already gets. Colour schedule prints as normal.

The payment plan is the one casualty: it derives from `computeDepositPlan()` over engine
labour, so its instalments wouldn't sum to the honoured total. Payment card and terms are
suppressed on flagged jobs (same treatment imported jobs already got). The app's own
calculated total never appears on the client document at all.

### 5. Job Profitability

A flagged job gets one extra section, **first on the card**:

```
XERO-IMPORTED JOB
Honoured quote (Xero)            honoured labour + materials as measured
Internal estimate (app)          rooms, materials and day rate as measured here
Actual (days + materials used)   days logged × day rate, plus materials as used
Honoured vs actual               ± the difference        (only once days are logged)
Labour: honoured vs estimate     ± the difference        (the whole story, see below)
```

Materials bill as used on the honoured and calculated sides alike, so **every penny of
difference between them is labour** — said explicitly on the card, because a total-level
gap on these jobs invites being read as a materials problem when it never is.

The **actual** row is gated on **logged days**, not on the actual total being non-zero:
`actualsTotals()` falls back to each row's *estimated* quantity until something is logged
(`actualsRowQuantity`), so `actualMaterials` is already non-zero the moment a snapshot
exists. With no days behind it, "actual" would be a materials estimate plus £0 of labour —
printing that, and a variance off it, would flatter every un-logged job by the entire
labour figure. So it shows `—` until days exist.

**The existing billing / schedule / days variance logic is unchanged**, on flagged and
non-flagged jobs alike. On a non-flagged job every field feeding this section is
`null`/`false` and the card renders exactly as it did before.

### 6. Final invoice

`buildFinalInvoiceModel()` bills the same composition as the quote:

```
honoured labour (one line, account 201)
+ materials AS USED (the 2(a) bought-confirmed lines, account 202)
+ variations at their agreed prices
```

Every engine labour line assembled for the job is **discarded** on a flagged job — rooms,
exterior, kitchen, fitted units, the standalone diary-day top-up and custom lines. All of
those were priced by this app *after* the client had already agreed a labour price, so
billing them alongside it would charge the same work twice. The imported
`acceptedSnapshot.estQuoteTotal` lump is discarded for the same reason (it's an `else if`
— never both).

**Sundries are zero** on a flagged job. They're a percentage of *this app's* labour, and
the agreed Xero price already covered whatever consumables it covered; charging the app's %
on top would add money the client never agreed to. Zero rather than *dropped*, because a
dropped row offers a `↩` restore that would silently inflate the invoice.

Variations keep their own sundries and their own prices — the app did price those, and they
stack on top exactly as on any other job.

The honoured line goes out on **account 201**, so the invoice's own 201/202 split stays
correct — which matters, since that's the same split `/auth/accepted-quotes` reads.

The review screen never labels this "as quoted": the section reads **"Labour — as agreed
(pre-app quote)"**, the line detail reads *"agreed before this job was measured here"*, and
a note says what is deliberately not billed and that extras belong on Variations.

**One thing left as-is:** the deposit/instalment prefills come from `computeDepositPlan()`
over engine labour, so on a flagged job they forecast against the internal estimate rather
than the honoured total. They are reference-only and hand-corrected by design
(`FINAL_INVOICE_SPEC.md`: the invoice goes out at the full amount, payments are applied in
Xero), so this changes no money — it just means the prefill is a worse first guess on these
jobs than on others.

## Cleanup — a future prompt, NOT part of this build

Once every `isXeroImported` job is complete, the feature can simply be **left dormant**:
the toggle just won't be used on new jobs, and nothing else changes.

If full removal is wanted later, that is its own separate piece of work:

1. Delete `isXeroImported` and `honouredLabourAmount` from the job record (including the
   `persistJobData()` field list) and the four helpers plus the prefill pair.
2. Remove the toggle card from the job edit screen (`xeroImportedCardHtml` and both call
   sites).
3. Restore Summary's plain `Total Quote` hero, its markup strap-line and the plain Labour
   stat sub-label; drop the "Internal estimate" line and `quoteTotal`/`internalEstimate`.
4. Remove the extra comparison section from Job Profitability, and the fields feeding it
   through `computeProfitability`.
5. Restore the client quote view/PDF to always build the work card from engine rows, and
   to always render payment/terms.
6. In `buildFinalInvoiceModel()`, drop the honoured branch so the imported lump becomes a
   plain `if` again, restore the unconditional sundries calculation, and remove the
   `honouredLabour` field plus the review screen's wording branches.

Do not attempt any of that until it's explicitly asked for.
