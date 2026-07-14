# Material Tracking — Spec (actuals vs estimate)

Scoped 2026-07-14. Supersedes the short "Material tracking" entry in FEATURES.md, which said only "scope carefully when reached — start simple". This is that scoping pass.

## What this is

Everything in the app so far is **ESTIMATING** — what a job *should* cost. This is **ACTUALS** — what was really bought and used, reconciled against the estimate. It's the first job-management feature rather than a quoting one.

Three purposes, all wanted:
1. **Catch chargeable extras** — bought something beyond the quoted scope? It should reach the invoice. Forgotten materials = lost money.
2. **Live shopping list** — what's still to buy for this job.
3. **Margin / calibration** — did the estimate match reality; calibrate coverage rates and assumed areas over time.

## Decisions taken

- **Input is QUANTITIES ONLY.** No typing prices, ever. Tick a line as bought, adjust the quantity if it differed, add anything the estimate missed. That's the whole interaction.
- **Money is DERIVED, never entered.** Purposes 1 and 2 need money but not *typed* money: every snapshot line already carries its account-202 `unitAmount`, and any Xero item's price is reachable from `materialGroupsCache`. Chargeable value = extra quantity × price the app already knows. Zero extra data entry.
- **Margin (purpose 3) is deferred to Phase 3** because it's the one thing genuinely not derivable — it needs COST prices, which the app doesn't hold (see "The money problem").
- **Start simple**, per the roadmap's own warning against opening with full reconciliation.

## THE CRITICAL CONSTRAINT — read this first

**Actuals must NOT be stored on materials-snapshot lines.**

`recalculateMaterialsSnapshot()` is a deliberate full overwrite — its own comment says it "discards every prior edit, deletion, and custom line", and it regenerates `id: uid()` for every line on every run. So:

- Snapshot line **ids are not stable** across recalcs. Anything keyed on them orphans immediately.
- Recalculate is a **normal, expected action** (rooms changed → re-pull materials). If actuals hung off snapshot lines, one tap mid-job would **silently destroy every actual logged so far** — exactly the class of data-loss bug the app has been bitten by before.

Therefore: **actuals are their own per-job list**, joined to the estimate for display only. The snapshot stays the estimate; actuals survive recalculation untouched. This is the load-bearing decision in this spec — don't "simplify" it later by folding actuals into the snapshot.

## Data model

New table, mirroring the existing per-job pattern (`job_id`, backfill, NOT NULL — same shape as `materials_snapshot`):

```sql
CREATE TABLE IF NOT EXISTS material_actuals (
  id VARCHAR PRIMARY KEY,
  job_id VARCHAR NOT NULL,
  item_code VARCHAR,            -- Xero item code; NULL for free-text entries
  description VARCHAR NOT NULL, -- carried so free-text/delisted items still read properly
  actual_quantity NUMERIC NOT NULL DEFAULT 0,
  bought BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

- **Join key is `item_code`, not snapshot line id** — item codes are stable across recalcs; line ids are not.
- **`description` is denormalised on purpose** so a free-text entry, or an item later recoded in Xero, still displays. Mirrors why snapshot lines carry it.
- Free-text entries (`item_code` NULL) can't join to an estimate line, and that's correct — they're extras by definition.
- API: `GET/PUT/DELETE /api/actuals`, same job-scoped shape as `/api/materials`.

## The reconciliation view

Left-join the actuals list onto the current snapshot by `item_code`. Three row states fall out naturally:

| State | Meaning | Why it matters |
|---|---|---|
| On estimate + actual matches | Bought what was quoted | Nothing to do |
| On estimate + actual differs | Used more/fewer than quoted | Variance — calibration signal |
| **Actual with no estimate line** | **Bought something not quoted** | **Chargeable extra — the money-losing case** |
| On estimate, not bought | Still outstanding | The shopping list |

One view serves all three purposes: filter to "not bought" and it's the shopping list; filter to "no estimate line" and it's the chargeable extras.

## Phasing

**Phase 1 — the log (build this first)**
- `material_actuals` table + API.
- A per-job view listing snapshot lines with a tick and an editable actual quantity (defaulting to the estimated quantity, so the common "bought exactly what was quoted" case is one tap).
- "+ Add material the estimate missed" — reuses `populateAddMaterialProductSelect()` / `addMaterialProductOptions` wholesale, which already picks any real Xero item or free text. Don't build a second product picker.
- Outstanding count. No money shown yet.

**Phase 2 — chargeable extras**
- Derive value for rows with no estimate line: quantity × account-202 price (from the item cache; free-text rows have no price and need a manual value or stay informational).
- Surface the total at invoicing.
- **Open question for when this is reached:** the quote is a fixed price. Extras beyond scope aren't automatically billable — they're a *conversation*, not an auto-add. So Phase 2 should SURFACE extras for a decision, not silently push them onto the invoice. Confirm the real-world flow (variation? separate invoice? absorb?) before wiring anything to Xero.

**Phase 3 — margin / calibration**
- Needs cost prices — see below.
- Cross-job calibration (is wall coverage really 11 m²/L?) needs history across jobs, so it lands naturally after Phase 1 has run on a few real jobs. Don't build it before there's data to look at.

## The money problem (why margin is Phase 3)

The estimate is in **sale** prices: the snapshot holds account-202 `SalesUnitPrice` — what the client is charged. Margin needs what you **paid**, which is account 311 / `PurchaseDetails` — and the app deliberately filters those out (`routes/xero.js`: `allItems.filter(i => i.SalesDetails?.AccountCode === '202')`).

So "estimated vs actual cost" is apples-to-oranges today. Two ways forward when Phase 3 is reached:

- **Likely free:** the `/Items` call already returns `PurchaseDetails` alongside `SalesDetails` on the same objects — the app just discards it. Caching `PurchaseDetails.UnitPrice` would give cost prices with **no new Xero scope and no user typing**. Verify this against the live payload first; it's an assumption, not a confirmed fact.
- **Fallback:** manual cost entry, which breaks the quantities-only rule and should be a last resort.

**Not available:** real purchase records (bills/receipts) from Xero. Scopes are `accounting.contacts accounting.settings.read accounting.invoices` — no `accounting.transactions`. Pulling actual bills would need a new scope and re-authorisation. Out of scope; entry stays manual.

## Where it lives — OPEN, decide before building

The app's conceptual split is **Rooms = input the work · Summary = the price · Colours = what you buy and put where**. Tracking is a fourth thing: *what you actually bought*. Options:

- **Its own tab** — cleanest conceptually, but nav already has Rooms / Exterior / Colours / Summary, and a 5th item is real estate on a phone.
- **On the Colours tab** — it's already the ordering view and already rolls up tins per colour, so "bought/not bought" sits naturally there. Risk: Colours groups by *colour*, tracking is by *product line*; the two don't align cleanly for exterior masonry or woodwork shared across colours.
- **On Summary** — but Summary is "the price", and tracking isn't pricing.

Leaning towards its own tab, on the grounds that ticking off at the merchant and reviewing extras at invoicing are both distinct from estimating and want to be fast. Not decided.

## Gotchas

- **The baseline moves.** "Estimated" = the current snapshot. If rooms change and Recalculate runs *after* the quote was sent, the baseline shifts under the actuals and variances change meaning. Phase 1 accepts this (actuals survive, they just compare against a newer estimate). If it bites, capture a baseline snapshot at Xero-send time — don't bolt that on speculatively.
- **Per-litre vs per-tin.** Snapshot lines carry `isPerLitre`. Walls/masonry are whole tins; ceiling/woodwork/mist are litres. An "actual quantity" means different units per line — label it from the line, don't assume tins.
- **Don't reintroduce localStorage as a competing source of truth.** Follow the `materials_snapshot` pattern: server is authoritative, load into memory on init. (The colour library's localStorage use is a read-cache of a *global reference list* and is not the precedent to copy here.)
- **Grep for duplicates before adding functions** — the app's recurring failure mode is an old function surviving alongside a new one, later definition silently winning.
