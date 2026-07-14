# Material Tracking — Spec (actuals vs estimate)

Scoped 2026-07-14. Supersedes the short "Material tracking" entry in FEATURES.md, which said only "scope carefully when reached — start simple". This is that scoping pass.

## What this is — and why it's bigger than a safety net

Everything in the app so far is **ESTIMATING** — what a job *should* cost. This is **ACTUALS** — what was really bought and used.

**The billing model is what makes this load-bearing:** materials go on the quote as an **ESTIMATE**. At invoicing, the client is billed **for what was actually used**. So actuals aren't a nice-to-have reconciliation — *they are the input to the invoice*. Labour is quoted and billed as quoted; materials are quoted as an estimate and billed as used.

This reframes the feature. It is not "flag the extras I forgot" — it's **"produce the materials list that gets invoiced"**. Every line's actual quantity is billable, not just the surprises.

Three purposes, all wanted, all served by one view:
1. **Invoice for what was used** — the primary output. Actual quantities × account-202 sale prices = the materials on the invoice.
2. **Live shopping list** — what's still to buy for this job.
3. **Margin / calibration** — what was billed vs what was paid, and whether the estimate model is right.

## Decisions taken

- **Input is QUANTITIES ONLY.** No typing prices, ever. Tick a line as bought, adjust the quantity if it differed, add anything the estimate missed. That is the whole interaction.
- **Money is DERIVED, never entered — all of it.** Confirmed account codes:
  - **202** — sales price. What the client is charged. Already cached per item.
  - **311** — purchase price, **paint**.
  - **314** — purchase price, **specific sundry items** (see below).

  All ride on the same `/Items` payload the app already fetches, so *every* money figure — billable value AND margin — is derivable from a typed quantity. Nothing needs manual pricing. Margin does not require a fallback to manual cost entry.
- **An item's cost is on 311 OR 314 — don't special-case it.** Sundry items aren't a separate category to model; they're just items whose purchase account differs. Read whichever the item carries. The distinction matters for bookkeeping, not for this feature's logic.
- **Start simple**, per the roadmap's warning against opening with full reconciliation.

## THE CRITICAL CONSTRAINT — read this first

**Actuals must NOT be stored on materials-snapshot lines.**

`recalculateMaterialsSnapshot()` is a deliberate full overwrite — its own comment says it "discards every prior edit, deletion, and custom line", and it regenerates `id: uid()` for every line on every run. So:

- Snapshot line **ids are not stable** across recalcs. Anything keyed on them orphans immediately.
- Recalculate is a **normal, expected action** (rooms changed → re-pull materials). If actuals hung off snapshot lines, one tap mid-job would **silently destroy every actual logged so far** — and under this billing model that's destroying the invoice, not just a note to self.

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
- Free-text entries (`item_code` NULL) can't join to an estimate line — correct, they're additions by definition. They also have no 202 price, so they need a manual value *to be invoiced* (the one place a price may have to be typed; prefer picking a real Xero item wherever possible).
- API: `GET/PUT/DELETE /api/actuals`, same job-scoped shape as `/api/materials`.

## The reconciliation view

Left-join the actuals list onto the current snapshot by `item_code`. Row states:

| State | Meaning | Use |
|---|---|---|
| On estimate, not bought | Still outstanding | The shopping list |
| On estimate, actual = estimate | Used what was quoted | Invoice as quoted |
| On estimate, actual ≠ estimate | Used more/fewer | **Invoice the actual**; variance is the calibration signal |
| Actual, no estimate line | Bought something unquoted | **Invoice it**; the case that loses money if missed |

One view, all three purposes: filter to "not bought" → shopping list; total actual × 202 → the invoice; actual vs estimate → calibration.

**Variance against the client's expectation matters.** The client was given a materials *estimate*. If actuals run well over it, the invoice exceeds what they were told — that's a conversation to have during the job, not a surprise at the end. The view should show the running actual total against the estimated total, so the gap is visible early. This is a client-relations feature, not just arithmetic.

## Phasing

**Phase 0 — FIX THE PICKER FIRST (small, and it blocks the main use case)**

`groupMaterialItems()` (routes/xero.js) drops any item whose name has no parseable size:

```js
const { range, band, sizeL, isPerLitre } = parseItemName(i.Name);
if (sizeL == null) return;   // <-- item silently discarded
```

Paint names carry a tin size ("… Tinted 2.5L"), so they survive. **Wallpaper paste and lining paper don't** — they're sold by roll, sachet or grade. So the very items 314 exists for are almost certainly missing from `materialGroupsCache` today, which means "+ Add a one-off specific item" can't offer them and you'd fall back to free text: no item code, no price, typed by hand, invisible to margin.

- **Verify against the live payload first** — this is read from the code, not observed. Check whether paste/lining paper actually parse.
- **The fix is small:** keep size-less items in a flat "no size" group instead of discarding them. They're not tin-optimised (there's no size to optimise), they're just item + quantity + price. Don't force them into the range/band/size hierarchy — that model doesn't fit them and shouldn't be bent to.
- Without this, free-text lines become the NORM for specific sundries rather than the exception, and the quantities-only promise quietly breaks for exactly the case Nicky named.

**Phase 1 — the log**
- `material_actuals` table + API.
- A per-job view listing snapshot lines with a tick and an editable actual quantity, defaulting to the estimated quantity — so the common "used exactly what was quoted" case is one tap.
- "+ Add material the estimate missed" — reuses `populateAddMaterialProductSelect()` / `addMaterialProductOptions` wholesale, which already picks any real Xero item or free text. Don't build a second product picker. (Depends on Phase 0 to be useful for sundries.)
- Show outstanding count, and actual total vs estimated total (202 prices, already held — free).

**Phase 2 — invoicing from actuals (the payoff)**
- Produce the materials list for the invoice: actual quantities × 202 prices.
- **The app has no invoice path today — it only creates Quotes** (`POST /Quotes`, routes/xero.js). Billing actuals means either:
  - **(a) Output a list** Nicky enters/checks in Xero himself — small, no new Xero surface, proves the model on real jobs first. **Recommended start.**
  - **(b) `POST /Invoices`** from the app, mirroring the existing quote builder. More work, and **the scope needs verifying**: the app currently requests `accounting.invoices`, which is not a documented Xero scope name — quotes work with it today, but don't assume invoices will until tested. Budget for a re-auth.
- Labour lines carry over from the quote unchanged (quoted = billed). Only materials come from actuals.

**Phase 3 — margin / calibration**
- Cache `PurchaseDetails.UnitPrice` for accounts **311** (paint) and **314** (sundries) from the `/Items` call the app already makes — currently discarded by the `SalesDetails.AccountCode === '202'` filter. No new scope, no new request, no typing.
- Margin per job = Σ(actual × 202) − Σ(actual × 311/314).
- Cross-job calibration (is wall coverage really 11 m²/L? are the exterior assumed areas right?) needs history, so it lands naturally once Phase 1 has run on a few real jobs. Don't build it before there's data to look at.

## Xero notes

- **Purchases can't be pulled.** Scopes are `accounting.contacts accounting.settings.read accounting.invoices` — no `accounting.transactions`, so real bills/receipts can't be read. Logging stays manual. (Not a problem: quantities are what's typed, and prices come from Items.)
- **The 202 filter is currently lossy.** `allItems.filter(i => i.SalesDetails?.AccountCode === '202')` throws away the purchase side of every item. Phase 3 needs that kept — a small change at the point of grouping, not a new integration.
- **Sundry items on 314 are NOT the cost side of the sundries %.** Two different mechanisms that must not be conflated:
  - **The sundries %** (labour × %) covers the **long tail of stock consumables** — caulk, tape, filler, floor protection, dust sheets. Bought across many jobs, need paying for, not worth itemising every time. It stays a percentage. It is **never itemised and never tracked** — it isn't a material, it's a recovery mechanism. Exclude it from the tracking view entirely.
  - **Specific sundry items** (account 314) are **job-specific consumables the % won't cover** — wallpaper paste, lining paper. They're real Xero items, added as one-off material lines, and tracked exactly like paint. The only difference from paint is which account their cost sits on.
  - This matches the original sundries spec in FEATURES.md: "anything specific/expensive is still added as its own one-off material line, not absorbed into the %."

## Where it lives — DECIDED

Its own destination, reached from a **hamburger menu**, NOT a fifth bottom tab.

The split is by activity, and it's a real distinction rather than a cosmetic one:
- **Bottom bar = measuring** (Rooms · Exterior · Colours · Summary) — used on site, one-handed, must stay one thumb-tap.
- **Hamburger = job admin** (Jobs · Materials tracking · Settings) — used at the merchant and at invoicing, not while measuring. Also absorbs the "My Job ›" and ⚙️ controls currently cluttering the top bar.

**The badge is load-bearing, not decoration.** A hamburger's real cost is hiding things; an outstanding count on the menu ("Materials · 4 to buy") is what keeps tracking from being out of sight and out of mind. Build the badge with the menu, not as polish afterwards.

The nav refactor itself is tracked separately in FEATURES.md — it's nav-wide and not part of this feature. Materials tracking doesn't depend on it (it can be reached however, initially), but they were decided together.

## Gotchas

- **The baseline moves.** "Estimated" = the current snapshot. If rooms change and Recalculate runs *after* the quote was sent, the baseline shifts under the actuals. Phase 1 accepts this (actuals survive; they just compare against a newer estimate). If it bites, capture a baseline snapshot at Xero-send time — don't bolt that on speculatively.
- **Per-litre vs per-tin — and now per-roll/per-tub.** Snapshot lines carry `isPerLitre`. Walls/masonry are whole tins; ceiling/woodwork/mist are litres; specific sundries are rolls, tubs and sachets. An "actual quantity" means different units per line — label it from the line, never assume tins.
- **Don't itemise anything the % already covers.** Caulk, tape, filler, floor protection and dust sheets are paid for by the sundries %. Adding one as a material line **charges the client twice**. The rule of thumb is the one Nicky uses: if it's stock kept across jobs, the % covers it; if it's bought for THIS job (paste, lining paper), itemise it. Worth a note in the UI next to "add material" if this ever bites.
- **Whole-tin rounding is a job-level rule** (see FEATURES.md). Actuals are what was physically bought, so they're inherently whole tins for tin roles — don't re-apply estimate-side rounding to actuals.
- **Don't reintroduce localStorage as a competing source of truth.** Follow the `materials_snapshot` pattern: server authoritative, load into memory on init. (The colour library's localStorage use is a read-cache of a *global reference list* — not the precedent to copy here.)
- **Grep for duplicates before adding functions** — the app's recurring failure mode is an old function surviving alongside a new one, later definition silently winning.
