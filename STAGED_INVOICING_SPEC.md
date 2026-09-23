# Staged invoicing (interim invoices): spec

**Status: BUILT 2026-09-23 (v2.74.0).** Nothing has been written to a real Xero org yet.
The first real interim should be watched in Xero the same way the first deposit was
(see `DEPOSITS_SPEC.md`).

This feature lets a job have one or more **interim invoices** while it is in progress. Each
one bills a share of the quoted labour, plus the materials bought so far, listed product by
product. The existing completion invoice becomes a **balancing final invoice**. It lists only
the materials no interim has billed, and deducts the labour and variations the interims billed.
**A job with no interims behaves exactly as it did before.** Its final invoice, deposit handling and profitability card are all unchanged.

## Labour: cumulative percentages

Each interim records a **cumulative** % complete for labour, and bills only the difference
from what was already billed:

```
labour_to_bill = round2(quoted_labour × new%) − round2(quoted_labour × prev%)
```

The two cumulative figures are rounded first and then subtracted, rather than rounding the
difference. That way, billing to 100% over any number of interims comes to exactly the quoted
labour, to the penny. `scripts/test-staged-invoicing.js` checks this with thirds of £1,000.01.
The percentage is capped at 100 and can never go down.

**Quoted labour** comes from the latest accepted snapshot: `totals.labour + totals.importedBaseline`.
On a Standalone Job the snapshot's work rows already include the diary-day upcharge, spread
across them exactly as on the client's quote, so the "diary-day labour figure the quote used" is
used automatically. Honoured jobs bill their honoured line the same way. A job accepted before
snapshots existed falls back to `acceptedSnapshot.estLabourTotal`. A job with neither can't have
an interim, and the builder says why.

## Materials: itemised, what has been bought

**Changed from the original handoff on 2026-09-23, at Nicky's request.** The handoff billed
materials as a cumulative % of the quoted materials. Instead, interims now itemise the materials
bought so far, which is how Nicky invoices by hand today.

- **The lines** are exactly the ones the final invoice would bill (`buildInvoiceList()`): On Site
  rows ticked as **bought**, with the colour on the description and live Xero **sell** prices.
  That means the materials markup is billed, not trade cost. Rows that aren't ticked as bought are
  counted and not included, the same as on the final invoice.
- **Billed quantities are recorded per product.** Each interim stores `material_lines`:
  `[{key, itemCode, description, quantity, unitAmount, amount}]`, where `key` is `materialKey()`
  (`code:<item>` or `desc:<text>`). The builder offers each product's quantity bought **minus the
  quantity already invoiced**. So if 2 tins were billed and a third was bought since, the next
  interim offers 1.
- **All lines are ticked by default.** Unticking one holds it back for a later invoice. The draft
  stores the *excluded* keys, so anything bought after the draft was started is included
  automatically.
- **Unpriced lines** (no Xero price, or free text with no price) are shown in red and can't be
  ticked. The server also refuses a zero price.
- **Layout on the invoice:** labour, then variations, then a description-only `MATERIALS` heading
  and one line per product (quantity × unit price, item code, account 202). This is the same
  layout as the final invoice.
- **Double-billing guard:** each material line sent to the server states `billedBefore`, the
  quantity the builder believed had already been invoiced. The server checks this against its own
  invoice rows while holding the job's row lock. If they don't match (another invoice landed in
  between), it returns **409** and the builder has to be reopened.

The **ceiling** used by the over-billing warning is still the quote plus approved variations. If
more materials are used than were quoted, billing can legitimately go over it; the warning is a
confirm step, not a block.

## Where the logic lives

| Piece | File |
|---|---|
| The maths, line layout, validation and Xero payload | `lib/invoices.js` |
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
invoice rows, along with the material quantities already invoiced. It does this inside a
transaction that holds a lock on the job's row, so two devices issuing at the same moment can't
both bill the same 40% or the same tins. The unique index on
`(job_id, sequence)` backs this up.

## Data model

A new `invoices` table. The columns are listed in `db/setup.sql`, and the main ones are:
`type` (interim|final), `sequence`, `labour_pct_cumulative`, `quoted_labour`, the
`*_amount` columns, `subtotal`, `deposit_applied`, `amount_due`, `stage_ref`,
`material_lines` (products and quantities billed), `variation_lines` (extras billed in full),
`line_items` (exactly what goes to Xero),
`xero_invoice_id/number`, `sync_state/synced_at/last_attempt_at/last_error`, and
`idempotency_key` (unique). `job_id` is a real foreign key with `ON DELETE CASCADE`, the same
as `job_variations`. The handoff's `materials_pct_cumulative` column is gone, because
materials are no longer a percentage.

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

1. **Builder (works offline).** Enter labour % (typed, or **Match quote stage**), check the list
   of bought-but-not-invoiced materials (all ticked; untick to hold one back), and tick approved
   extras that haven't been billed. The preview shows each line, the subtotal, "Less deposit"
   and the amount due, plus running totals (previously billed, this invoice, remaining). Every change saves to
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

- **Materials:** the final invoice lists only what no interim has billed. For each product, the
  quantity already invoiced comes off the line, and a line billed in full drops out. A part-billed
  line notes how many were already invoiced. If a product is now logged in a *smaller* quantity
  than was already billed (a tin returned after an interim), the line can't go negative. It is
  flagged instead, so the difference can be credited in Xero.
- **Labour and variations** are billed in full as before (quote lines, every approved variation
  including those an interim already billed, and sundries). They are followed by one
  **"Less: interim invoice INV-xxxx"** line per interim, for the labour and variations it billed
  (account 201, before deposit). An interim that billed only materials has no deduction line.
  Revenue therefore nets out of 201 and 202 correctly, with no split lines needed.
- The final invoice can't be built until every interim is in Xero, because it needs each
  interim's INV number.
- If the interims already add up to more than the final invoice's total, creation is blocked
  (Xero rejects negative invoices) and the message suggests a credit note instead.
- After the final is created, a `final` row is recorded (best-effort). `job.finalInvoiceTotal`
  is the **net** total that goes to Xero, so the interim subtotals plus the final total equal
  labour + variations + materials used.

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
- The interim's Xero **Reference** is `<job ref> — interim N`.

## Open questions (not resolved here)

1. **Deposit on the interim in Xero.** Is manual prepayment allocation, with no negative line,
   right? Or should the app try to allocate the prepayment to the first interim automatically?
   (Xero refuses to allocate against a DRAFT, and the app only ever creates drafts.)
2. ~~**Match quote stage** — should it pre-fill materials % too?~~ Resolved: materials are
   itemised now, so there's no materials % to fill.
3. **Void or edit an issued interim.** Not built. The app only discards an interim that never
   reached Xero. If voiding or editing is ever added, it has to roll back the cumulative %, the
   `variation_lines` and `deposit_applied`, and probably needs to be limited to the latest interim.
4. **Client-facing variations page.** Should it also show the invoices issued so far?
5. **Deposit vs the "amount due ≤ 0" guard.** Together these mean a deposit larger than the first
   interim blocks that interim, so the remainder rarely carries forward. Should an interim that
   the deposit fully covers be allowed (amount due £0)?
