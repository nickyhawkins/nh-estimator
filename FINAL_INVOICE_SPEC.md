# Final Invoice Builder — Spec (material tracking Phase 2(b), done properly)

**Status: SCOPED 2026-07-22, not built.** Idea #5 in `FEATURES_2.0_IDEAS.md`. This is
`MATERIAL_TRACKING_SPEC.md` Phase 2(b) — that doc said "optional, prove the model with the
2(a) list first"; 2(a) has been the manual re-keying step since, and this closes it.

## Purpose

The last hand-copied step in the whole flow: assembling the final invoice in Xero from the
2(a) materials list, the quoted labour, any variations, and the payments story. The app
knows every one of those numbers. Build the assembly and a `POST /Invoices`.

**The billing model (restated from `MATERIAL_TRACKING_SPEC.md`, it governs everything
here):** labour is billed AS QUOTED; materials are quoted as an estimate and billed AS
USED (`material_actuals` IS the invoice's materials list).

## The assembled invoice

```
Labour lines        — from the accepted quote, as quoted
Variation lines     — each variation at its agreed price (VARIATIONS_SPEC.md)
Materials lines     — from material_actuals: real items at qty × 202 sales price,
                      free-text rows at qty × their stored unit_amount
Sundries line       — as quoted (it's % of labour: quoted labour → quoted sundries)
────────────────────
minus: Deposit received
minus: staged instalments already invoiced
────────────────────
Balance due
```

- **Labour/sundries source: the app's own figures, not a re-read of the Xero quote.** The
  Summary already computes them and the quote was written FROM them; reading the quote
  back introduces a second source of truth that's only ever equal or stale. (If the quote
  was hand-edited in Xero afterwards, Nicky is choosing to invoice the app's numbers —
  the review step below is where that's caught.)
- **Deposit/instalments: typed at build time in v1, prefilled with the plan's figures**
  (`computeDepositPlan()` says what SHOULD have been invoiced; Xero knows what WAS).
  Auto-reading actual paid-to-date from Xero invoices/payments is more scope
  (`Payments`/`Invoices` reads, part-payment edge cases) — v1 shows the plan figures,
  Nicky corrects against reality, done. Revisit only if the correction step proves
  error-prone.
- Deducted amounts go on as **negative-quantity line items** ("Less: deposit received,
  inv INV-0123"), not Xero credit notes/payments — dead simple, shows plainly on the PDF,
  and matches how the deposit was itself invoiced (as its own invoice). **Confirm with
  Nicky this matches how the accountant wants it** — the alternative (invoice the full
  amount, apply payments in Xero) is tidier ledger-wise but re-opens the manual step.

## Flow

On a `completed` job: **"Build final invoice ›"** (Summary + Jobs list) → a review screen
showing the assembly above, each section editable-lightly (drop a line, adjust the
deducted figures) → **"Create draft invoice in Xero"** → `POST /Invoices` with
`Status: DRAFT` → link/number shown, `job.xeroInvoiceId` stored on `jobs.data`, and job
status → `invoiced` (the pipeline hook, `JOB_PIPELINE_SPEC.md`).

- **Always DRAFT, never AUTHORISED.** Nicky reviews and sends from Xero — the app
  assembles, Xero remains the invoicing system. This also keeps the blast radius of any
  bug at "a wrong draft", which is deletable.
- **The 2(a) list stays.** If Xero is disconnected/erroring, the materials list view is
  the fallback path, permanently — the builder is a convenience on top, not a
  replacement. A Xero failure alerts and leaves everything as it was (same best-effort
  contract as `syncQuoteStatusToXero()`).
- Rebuilding after a failed/deleted draft: the button stays available while status is
  `completed`; a second successful build re-links `xeroInvoiceId` to the newest draft
  (same re-link semantics as re-sending a quote).

## The scope problem — resolve FIRST, it gates everything

`FEATURES.md` has flagged this since Phase 2 shipped: the app requests
`accounting.invoices`, **which is not a documented Xero scope name** — quotes have
evidently worked regardless, but `POST /Invoices` needs the real
`accounting.transactions` scope. **Step 0 of the build:** confirm the current token's
granted scopes, add `accounting.transactions` to the OAuth request if needed
(`routes/xero.js` connect URL), and walk through the re-auth. If Xero refuses the scope
for this app type, the whole feature falls back to 2(a)-list-only and this spec gets
marked accordingly — find out before writing any invoice code.

## Line-item mechanics (mirrors quote creation in `routes/xero.js`)

- Real items: `ItemCode` + quantity → Xero prices from the item (202), same as quote
  lines. Free-text actuals: description + qty × stored `unit_amount`, `AccountCode: '202'`
  explicitly since there's no item to carry it.
- Labour lines reuse the same description conventions the quote uses (room/exterior item
  labels; the `;;paint`-style template text stays a Xero-side paste, unchanged).
- Tax: same treatment as the quote path (No VAT / as configured) — copy what
  `POST /create-quote` does rather than re-deciding.
- `Reference`: the job name; `Contact`: the job's stored contact (edits #12) resolved the
  same way the quote resolves it.

## Build order

0. Scope verification + re-auth (gates all else; do it standalone, it also derisks the
   inward-sync endpoint in `JOB_PIPELINE_SPEC.md` touching quote reads)
1. Assembly + review screen, ending at the 2(a)-style list (no Xero write yet) — already
   useful: one screen with the complete final-invoice story to copy from
2. `POST /Invoices` (DRAFT) + `xeroInvoiceId` + pipeline hook
3. (later, if wanted) read-back of deposit/instalment invoices actually paid

## Gotchas

- **Verified-against-stubs caveat applies double here.** Like every Xero feature in this
  repo: build against stubbed axios/db, then WATCH THE FIRST REAL ONE. An invoice is the
  most consequential document the app will ever write — the DRAFT-only rule is the
  safety net, say so in the UI ("created as a draft — review in Xero before sending").
- Free-text actuals with `unit_amount` null (never priced) must be caught at review time
  — shown red, invoice blocked until priced or dropped. Silently £0 lines on a real
  invoice are exactly the "lost money" this app exists to prevent.
- A completed job with zero actuals logged should warn loudly at build time ("no materials
  were logged — invoice will bill labour only") — a forgotten actuals log is the likeliest
  operator error under this billing model.
- Don't touch `material_actuals` on build (no "invoiced" flag on rows in v1) — the job's
  `invoiced` status is the record. Row-level invoice tracking only matters for interim
  invoicing, which doesn't exist here.
