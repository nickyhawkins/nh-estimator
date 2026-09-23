# Staged invoicing (interim invoices): spec

**Status: BUILT 2026-09-23 (v2.74.0).** Nothing has been written to a real Xero org yet.
The first real interim should be watched in Xero the same way the first deposit was
(see `DEPOSITS_SPEC.md`).

This feature lets a job have one or more **interim invoices** while it is in progress. Each
one bills the quote's labour room by room (each line complete, or a % of it), approved extras
the same way, and the materials bought so far, listed product by product. The existing completion invoice becomes a **balancing final invoice**. It lists only
the materials no interim has billed, and deducts the labour and variations the interims billed.
**A job with no interims behaves exactly as it did before.** Its final invoice, deposit handling and profitability card are all unchanged.

## Labour: line by line, each with its own cumulative %

**Changed from the original handoff on 2026-09-23, at Nicky's request.** The handoff billed one
cumulative % of the whole labour total. Instead, every labour line on the accepted quote carries
its own cumulative % complete, so a finished room can be invoiced in full and a half-done room at
50%.

```
line_to_bill = round2(line_total × new%) − £ already billed on that line
```

- **The lines** are the accepted snapshot's work rows (a room, an exterior item, the kitchen, a
  fitted unit, a custom line, the rounding-adjustment row if there is one) plus any Xero-imported
  baseline row. They're at the prices on the client's copy, so any Standalone diary-day upcharge
  and rounding are already spread through them. **"Sundries & Consumables" is left off interims
  entirely** (Nicky, 2026-09-23). It's a % of the whole job's labour and is billed in full on the
  final invoice.
- **Line identity** is the snapshot row's `sourceKey` (`room:<id>`, `custom:<id>`...), which
  survives an amendment. Rows from before `sourceKey` existed key on their description. Honoured
  jobs, and snapshots rebuilt from Xero totals alone, have a single labour line. Jobs accepted
  before snapshots existed have one line, "Labour as quoted" (`acceptedSnapshot.estLabourTotal`),
  which includes their sundries.
- **Billing against £ already billed**, rather than against the previous %, means a line comes to
  exactly its price at 100% however many invoices it took (tested with thirds of £1,000.01). If an
  amendment re-priced the line in between, the next invoice bills the new price less what was
  actually billed. A line re-priced *below* what was already billed is refused, and the
  difference is left for the final invoice.
- The % can't go down and can't go above 100. A line already at 100% shows "✓ invoiced in full".
- **Builder:** each line has a % box and a **Done** button (100%, or back again if tapped twice).
  **"Set every line to"** and **Match quote stage** (the quote's payment plan as a running % of
  the job total) set every line at once. They only ever *raise* a line, so a room already marked
  done isn't pulled back down.
- **Invoice text:** only lines that bill something appear. They read
  `Lounge — complete (previously invoiced 50%)` or `Hall, stairs & landing — 50% complete`, at 201.
- **A whole-job % prints as one line** (Nicky, 2026-09-23). When *every* labour line on the quote
  moves from the same % to the same % (Set every line to 40%, or a quote stage), labour is printed
  as a single `Labour: 40% of quoted works (previously invoiced 0%)` line for the lines' total.
  `labour_lines` still records each line, so a later invoice can go room by room and carry on
  from 40%. A one-line quote keeps its own wording. If any line differs (one room already Done, or
  set higher), the invoice lists room by room.
- `labour_pct_cumulative` on the row is the overall % (labour £ billed to date against the
  labour lines' total). It's for display only.

**Approved variations** work the same way: each has a % and **Done**, and is billed as
`Variation: <description> — 50% complete`. The published client-facing row is stamped
`invoiced_on_invoice_id` by the invoice that takes it to 100%.

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

**The server decides the figures.** When an interim is issued, the server reads each labour
and variation line's % and £ already invoiced, the material quantities already invoiced and the
deposit already applied, all from the job's own invoice rows. Every line in the request states
what the builder believed was invoiced before. If that doesn't match, the request is a stale view
and gets a 409. It does this inside a
transaction that holds a lock on the job's row, so two devices issuing at the same moment can't
both bill the same 40% or the same tins. The unique index on
`(job_id, sequence)` backs this up.

## Data model

A new `invoices` table. The columns are listed in `db/setup.sql`, and the main ones are:
`type` (interim|final), `sequence`, `labour_pct_cumulative`, `quoted_labour`, the
`*_amount` columns, `subtotal`, `deposit_applied`, `amount_due`, `stage_ref`,
`labour_lines` and `variation_lines` (`[{key, description, lineTotal, pct, prevPct, amount}]`
for each line that billed something), `material_lines` (products and quantities billed),
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

1. **Builder (works offline).** Mark rooms **Done** or give them a % (or set every line at once /
   **Match quote stage**), check the list of bought-but-not-invoiced materials (all ticked;
   untick to hold one back), and set the approved extras the same way as rooms. The preview shows each line, the subtotal, "Less deposit"
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
- **Nicky chooses how much comes off each interim** (2026-09-23: "if there are more materials
  needed I tend to split the deposit between multiple invoices so there is a float"). The
  builder's **Deposit to take off** box defaults to all of what's left, capped at the invoice
  total, and can be lowered to keep a float. The rest carries forward, and the final takes any
  remainder. `deposit_applied` is tracked on each row. An invoice the deposit covers entirely
  (£0 due) is allowed, since it's a deliberate choice. The preview says exactly how much of the
  prepayment to allocate to the invoice in Xero, and how much stays unallocated.
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
  share and markup included), with the line text `Variation: <description> — N% complete`. On the final invoice, variations and their sundries are itemised
  separately (sundries at 202). The interim folds that sundries share into a 201 line, so the
  per-account net can differ by that share. The total is unaffected.
- The interim's Xero **Reference** is `<job ref> — interim N`.

## Xero status read-back, the client's page, and corrections

- **`POST /auth/invoice-statuses`** reads every Xero invoice on a job in one request
  (`GET /Invoices?IDs=`) and stores Xero's status, date, total, amount paid and amount due on the
  rows (`xero_status`, `xero_date`, `xero_total`, `xero_amount_paid`, `xero_amount_due`,
  `xero_checked_at`, added with `ALTER TABLE` since the table was already live). Summary asks at
  most every 15 minutes per job, only while an invoice could still change, silently and never
  offline. It works like the deposit read-back: Xero is the authority.
- **The client's page** (`routes/publicQuote.js`) gets an **Invoices so far** card: number, date,
  amount, and *Paid* / *£X paid · £Y to pay* / *Awaiting payment*, with *Invoiced so far £X of
  £Y* against the job's running total. **Only invoices Xero reports as AUTHORISED or PAID are
  shown** (Nicky, 2026-09-23: "hold it while it's in drafts"). A draft is still being checked and
  never reaches the client. The public page never calls Xero itself; it reads what the app last
  recorded, so an invoice appears once Summary has been opened after approving it in Xero. A
  voided invoice drops off.
- **Void & reissue** (Nicky, 2026-09-23). `POST /auth/void-invoice` takes the **latest** interim out
  of Xero. It is refused once a final invoice exists, since the final deducts interims by number.
  It reads Xero's live status first:
  - DRAFT/SUBMITTED → **DELETED**.
  - AUTHORISED with nothing paid or allocated → **VOIDED**, which keeps the record in Xero.
  - Anything with `AmountPaid` or `AmountCredited` > 0 (a payment, or the deposit prepayment
    allocated to it) → **refused**, with the amount named. Unwinding money stays a person's job in
    Xero.

  The app then discards its record (the DELETE route accepts a dead invoice) and opens the builder
  with a new draft pre-filled from the voided invoice: each labour and variation line's %, and its
  deposit share. Materials come back ticked, and a new idempotency key is issued. If the discard
  fails after Xero succeeded, Summary shows the invoice as voided with a **Discard** link, so
  nothing is lost.
- **Voiding directly in Xero** works too. Once the read-back sees VOIDED/DELETED, Summary flags it
  and **Discard** rolls its lines, materials and deposit share back. The final invoice won't build
  while an interim is voided but not yet discarded.

## Open questions

1. ~~**Deposit on the interim in Xero.**~~ Settled (Nicky, 2026-09-23): allocation stays manual in
   Xero. The app only says how much to allocate.
2. ~~**Match quote stage** — should it pre-fill materials % too?~~ Resolved: materials are
   itemised now, so there's no materials % to fill.
3. ~~**Void or edit an issued interim from the app.**~~ Built as void & reissue (see above): latest
   interim only, never once money is allocated to it, and never after the final invoice.
4. ~~**Client-facing variations page shows invoices?**~~ Built: yes, once approved in Xero.
5. ~~**Deposit vs the "amount due ≤ 0" guard.**~~ Resolved: the deposit share is chosen per
   invoice, and a fully covered (£0 due) invoice is allowed.
