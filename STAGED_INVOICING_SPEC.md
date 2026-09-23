# Staged invoicing (interim invoices): spec

**Status: BUILT 2026-09-23 (v2.74.0).** Nothing has been written to a real Xero org yet.
The first real interim should be watched in Xero the same way the first deposit was
(see `DEPOSITS_SPEC.md`).

This feature lets a job have one or more **interim invoices** while it is in progress. Each
one bills a share of the quoted labour and a share of the quoted materials. The existing
completion invoice becomes a **balancing final invoice** that deducts everything already
billed. **A job with no interims behaves exactly as it did before.** Its final invoice,
deposit handling and profitability card are all unchanged.

## Core principle: cumulative percentages

Each interim records a **cumulative** % complete for labour and for materials, and bills only
the difference from what was already billed:

```
labour_to_bill    = round2(quoted_labour    × new%) − round2(quoted_labour    × prev%)
materials_to_bill = round2(quoted_materials × new%) − round2(quoted_materials × prev%)
```

The two cumulative figures are rounded first and then subtracted, rather than rounding the
difference. That way, billing to 100% over any number of interims comes to exactly the quoted
figure, to the penny. `scripts/test-staged-invoicing.js` checks this with thirds of £1,000.01.
Percentages are capped at 100 and can never go down.

- **Quoted labour** comes from the latest accepted snapshot: `totals.labour + totals.importedBaseline`.
  On a Standalone Job the snapshot's work rows already include the diary-day upcharge, spread
  across them exactly as on the client's quote, so the "diary-day labour figure the quote used"
  is used automatically. Honoured jobs bill their honoured line the same way.
- **Quoted materials** is `totals.materials`, at quoted sell prices with markup included. Materials
  are always billed at the quoted price, pro rata, and never at actual cost.
- A job accepted before snapshots existed falls back to `acceptedSnapshot.estLabourTotal /
  estMaterialsTotal`. A job with neither can't have an interim, and the builder says why.

## Where the logic lives

| Piece | File |
|---|---|
| The maths, line text, validation and Xero payload | `lib/invoices.js` |
| Record / list / discard / record-final routes | `routes/api.js` (`/api/jobs/:id/invoices…`) |
| Send a recorded interim to Xero | `routes/xero.js` (`POST /auth/sync-invoice`) |
| Builder, Summary block, final-invoice deductions, Billing | `public/index.html` |
| Schema (documentation copy) | `db/setup.sql`. It is created lazily by `ensureInvoiceSchema()` |

`fmtInvoicePct`, `interimInvoiceMath` and `interimInvoiceLineItems` exist in **two copies**.
The browser copy previews the invoice offline, and the server copy decides what is recorded.
The test fails if the two copies are not identical character for character, so any edit has to
be made to both.

**The server decides the figures.** When an interim is issued, the server reads the previous
cumulative %, the variations already billed and the deposit already applied from the job's own
invoice rows. It does this inside a transaction that holds a lock on the job's row, so two
devices issuing at the same moment can't both bill the same 40%. The unique index on
`(job_id, sequence)` backs this up.

## Data model

A new `invoices` table. The columns are listed in `db/setup.sql`, and the main ones are:
`type` (interim|final), `sequence`, `labour_pct_cumulative`, `materials_pct_cumulative`,
the `*_amount` columns, `subtotal`, `deposit_applied`, `amount_due`, `stage_ref`,
`variation_lines` (what was billed in full), `line_items` (exactly what goes to Xero),
`xero_invoice_id/number`, `sync_state/synced_at/last_attempt_at/last_error`, and
`idempotency_key` (unique). `job_id` is a real foreign key with `ON DELETE CASCADE`, the same
as `job_variations`.

`job_variations` gets `invoiced_on_invoice_id`. **The app's own record of which extras have
been billed is `invoices.variation_lines`.** Many approved extras are never published to the
client page, so a column on `job_variations` alone could not answer the question. The column
is stamped on the published row where one exists, and cleared if the interim is discarded.

`job.interimDraft` (on `jobs.data`, in `persistJobData`'s list) holds the builder's
saved-as-you-go draft, including its idempotency key.

**Backfill: none.** Jobs invoiced before this release keep their history on `jobs.data`
(`xeroInvoiceNumber`, `finalInvoiceTotal`), exactly as before. A `final` row is only written
for a job that has interims to deduct. Rebuilding old final rows from `jobs.data` would add
rows that nothing reads, and would give the table two different meanings.

## Flow

1. **Builder (works offline).** Enter labour % (typed, or **Match quote stage**), materials %
   (typed, or tap the **Purchases logged** hint), and tick approved extras that haven't been
   billed. The preview shows each line, the subtotal, "Less deposit" and the amount due, plus
   running totals (previously billed, this invoice, remaining). Every change saves to
   `job.interimDraft`.
2. **Issue (needs a connection, blocked offline and never queued).** `POST
   /api/jobs/:id/invoices/interim` records the row using the draft's key. If the same key is
   sent again, the server returns the row that key already created (`replayed: true`) and does
   not create another.
3. **Send.** `POST /auth/sync-invoice` reads the row and PUTs one ACCREC **DRAFT** invoice to
   Xero with `Idempotency-Key` set to the row's key. It then stores the invoice id and number,
   or `failed` plus the real Xero error message. **Try again** reuses the same key. This sync
   state is separate from the app's offline sync-dot.
4. **Discard** is only allowed for an interim that never reached Xero, and only for the most
   recent one. That way the cumulative % on every later invoice stays correct.

"Queued issue attempts reuse the same idempotency key": the draft holds the key from the
moment the builder opens until the invoice is recorded. So a retry after a lost reply, a second
tap, or a retry from another session all send the same key. Following the deposit rule, a Xero
write never fires later from the offline queue without someone watching.

### Guards
- Issuing is blocked when the amount due is ≤ 0. This covers nothing to bill, and a deposit
  that covers the whole invoice.
- A warning (a confirm step, not a block) appears if billing would go above the quote plus all
  approved variations.
- The builder is only offered, and the server only accepts an interim, while the job is `accepted`.

## Deposit

- The deposit used is **the deposit actually received** (`job.deposit.amount`). It is never the
  plan's forecast.
- It is taken off the first interim. If it is larger than that interim's subtotal, only the
  subtotal is used and the rest carries forward (`deposit_applied` is tracked on each row).
  **Note:** with the "block if amount due ≤ 0" guard, the first interim can only be issued once
  it is larger than the deposit. So in practice any remainder only carries forward if the deposit
  is recorded or increased after an interim has been issued. See open questions.
- **Xero:** there is no negative deposit line on the interim invoice. The deposit is already a
  RECEIVE-PREPAYMENT and is allocated by hand in Xero. "Less deposit" only appears in the
  in-app preview and Summary.
- On the final invoice, the reference-only deposit box is pre-filled with only the part of the
  deposit that the interims have not used (usually £0).

## Final invoice with interims

The itemised invoice is unchanged: quote lines, materials as used, every approved variation
(including those an interim already billed, which the interim deduction covers), sundries and
the invoice text. After those lines comes a **"Less: interim invoice INV-xxxx"** line for each
interim's subtotal (before deposit):

- **Deviation from the handoff, flagged:** if an interim billed both work and materials, it gets
  **two** negative lines. One is at 201 for labour and variations, and one at 202 for materials,
  labelled `… (materials)`. One line can only carry one account code, and the handoff also asked
  for revenue to net out of the same accounts the positive lines used. An interim that billed
  only one kind of thing still gets a single line.
- The final invoice can't be built until every interim is in Xero, because it needs each
  interim's INV number.
- If the interims already add up to more than the final invoice's total, creation is blocked
  (Xero rejects negative invoices) and the message suggests a credit note instead.
- After the final is created, a `final` row is recorded (best-effort). `job.finalInvoiceTotal`
  is the **net** total that goes to Xero.

## Profitability (Billing)

On a job with interims: the quoted total (including approved variations), invoiced to date
(interim plus final), remaining to bill, and a line for each invoice. Revenue is
`finalInvoiceTotal + Σ interim subtotals`. On a job without interims, this card is unchanged.
While the job is in progress, the Summary status card shows the same running totals.

## Deliberate choices worth knowing

- **Variations** use the price published to the client (`buildClientVariationLines`, sundries
  share and markup included), with the line text `Variation: <description>`, which matches the
  final invoice's wording. On the final invoice, variations and their sundries are itemised
  separately (sundries at 202). The interim folds that sundries share into a 201 line, so the
  per-account net can differ by that share. The total is unaffected.
- **Purchases logged** values the bought-ticked rows at the same **sell** prices the quote used,
  so that the % compares like with like. The handoff mentioned "actual purchase cost". Comparing
  cost against a sell-price quote would always read about 20% behind.
- The interim's Xero **Reference** is `<job ref> — interim N`.

## Open questions (not resolved here)

1. **Deposit on the interim in Xero.** Is manual prepayment allocation, with no negative line,
   right? Or should the app try to allocate the prepayment to the first interim automatically?
   (Xero refuses to allocate against a DRAFT, and the app only ever creates drafts.)
2. **Match quote stage.** Stages are a % of the whole job. Should picking a stage also pre-fill
   materials %? At the moment it only fills labour.
3. **Void or edit an issued interim.** Not built. The app only discards an interim that never
   reached Xero. If voiding or editing is ever added, it has to roll back the cumulative %, the
   `variation_lines` and `deposit_applied`, and probably needs to be limited to the latest interim.
4. **Client-facing variations page.** Should it also show the invoices issued so far?
5. **Deposit vs the "amount due ≤ 0" guard.** Together these mean a deposit larger than the first
   interim blocks that interim, so the remainder rarely carries forward. Should an interim that
   the deposit fully covers be allowed (amount due £0)?
