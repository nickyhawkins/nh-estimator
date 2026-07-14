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

Paint names carry a tin size ("… Tinted 2.5L"), so they survive. **Wallpaper paste and lining paper don't** — they're sold by roll, sachet or grade.

**VERIFIED against a live Xero export (2026-07-14), by running the real `parseItemName()` over all 1603 items.** The hypothesis holds. 54 items are dropped, and every paste and lining paper item is among them:

| Code | Name | Cost acct |
|---|---|---|
| FAR038 | F&B Wallpaper Paste - 5 Roll 5 Roll | 311 |
| LG038 / LG039 | LG Wallpaper Adhesive - All 5KG / 2.5KG | 311 |
| SUN002 | Wickes Ready Mixed Wallpaper Paste 10KG | 314 |
| WAL001 | Wallrock Fibreliner 50 Single | 311 |
| WAL002 | Wallrock Fibreliner 100 Double | 311 |

(Paste and Fibreliner are just the worked example — the mechanism is what matters. **Lining paper is called "Wallrock Fibreliner"**; nothing in Xero contains the word "lining". Grep for the product, not the category.)

**The fix: three buckets, decided by the item CODE, not by whether the name parsed.**

| Bucket | Rule | Model |
|---|---|---|
| Sundry | code starts `SUN` (see below re: `RPC`) | flat: item + qty + price, no size |
| Paint | anything else, **and** the name parses | range → band → size, tin-optimised |
| **Data error** | anything else that **doesn't** parse | surface it; offer it nowhere |

**Why not "no size = sundry"?** Because "didn't parse" is not a category, it's a bug bucket — and the live data proves it. Of the 28 non-`SUN`/`RPC` items that fail to parse today, most are **not sundries at all**:

- **8 are real Isomat paint tins** killed by a regex gap — `Isomat Flexcoat Masonry - Colours 3LT`, `Isomat Silicone Paint - White 10LT` and friends. `TIN_SIZE_RE` handles `L` and `ltr` but **not `LT`**: the `\b` can't fire between `L` and `T`. See the LT bug below.
- **2 are broken rows** — DUL231 and DUL232 are both `Dulux Heritage VM True White - True White`, duplicated, sizeless. Data to fix, not a product to sell.
- **2 are tools** — `F&B Roller Frame 9in - Each Each`, `F&B Roller Sleeve 9in - Each Each`.

If size-less items were swept into a flat sundries group, all of that would surface in the picker **as sundries**, and — worse — the LT bug would be permanently masked: the Isomat paint would appear as a pickable sundry rather than as a missing paint range, so nobody would ever notice four ranges are absent. **The parse-failure bucket must stay loud and empty, not become a category.**

**Why the code prefix works where a derived rule can't:** it's *declarative*. `SUN002` is a sundry because Nicky says so, not because a parser gave up. It cleanly separates *intentionally* sizeless (a sundry) from *accidentally* sizeless (a bug). It also happens to align exactly with the two data models the picker needs: branded paint has range/band/size and needs the hierarchy; sundries are flat and have no bands, no sizes, no tin optimisation. The prefix isn't a proxy for the distinction — it *is* the distinction.

**The double-charge risk is accepted and handled outside the app.** `SUN` currently mixes both kinds (SUN002 paste = itemise; SUN001/003–018 tape, masking, floor protection = the % covers them). **Nicky prunes the Xero list once the system is in place**, so `SUN` comes to mean "itemise this". The app does not second-guess it — no allowlist, no heuristics, no "are you sure?". Garbage in the picker is a data problem with a data fix. **But see the Status dependency below — pruning has a prerequisite.**

**~~BUG: the `LT` suffix doesn't parse~~ — FIXED (2026-07-14).** Unrelated to sundries, found while verifying the above. Recorded because it shows what the data-error bucket is *for*.

`TIN_SIZE_RE` was `l(?:tr)?\b`, which matched `3L` and `3ltr` but **not `3LT`** — the `\b` can't fire between `L` and `T`, and `tr` doesn't match `T`. Every Isomat item using the `LT` unit was silently discarded: ISO011/012 (`Premium Acryl`), ISO044/045 (`Silicone Paint`), ISO048–051 (`Flexcoat Masonry`) — **four paint ranges missing from the app**, including the exterior masonry the exterior engine needs.

Fixed on both sides, per Nicky's rule that **all paint items end `ltr` for uniformity**:
- **Read** (`routes/xero.js`): `l(?:tr?)?\b` — makes the `t` optional independently of the `r`. Tolerating the legacy form on read is deliberate (MATERIALS_SPEC.md "parse sizes robustly"); it is *not* a licence to write it.
- **Write** (`scripts/update_supplier_prices.py`): `_SIZE_RE` now normalises `10LT` → `10ltr` alongside `10L` → `10ltr`, so the tidy pass removes the legacy form from Xero for good. Verified: 8 names changed, 0 prices touched at 0%, 0 non-ISO rows touched, idempotent on re-run.

Verified against the live export: 8 items recovered, **0 regressions** among the 1,549 that already parsed, and the recovered items group correctly (`Isomat Flexcoat Masonry` → White/Colours × 3ltr/10ltr, so tin optimisation works). `scripts/check_item_parse.py` carries `3LT` and `10LT` as regression checks.

**DEPENDENCY: the app ignores `Status`, so pruning won't take effect.** `/material-groups` filters on `SalesDetails.AccountCode` only — it never checks whether an item is archived. TIK015 (`Tikkurila Anti Reflex 2 - Magnolia 3ltr`) and SUN016 (`Tesa Easy Cover…`) are **Archived in Xero and still offered as live options**. If the plan is to prune `SUN` by archiving the stock consumables, **the app must honour archive status first or the prune does nothing.**

- **Unverified:** the CSV export has a `Status` column, but whether the **Items API** exposes it is not confirmed — the code doesn't read it and this was checked against an export, not the live payload. Check the raw `/Items` JSON before designing around it. If the API doesn't expose archive status, pruning has to be deletion, or a different mechanism entirely. **Settle this before Phase 1** — it decides whether "prune in Xero" is a viable control at all.

**Also fix the millilitre false positives while you're in here** (verified, same run). Six items parse a tube size as a tin: `Isomat Isomastic-A Acrylic Caulk - All 280ML` → 0.28 L, plus the other Isomat sealants, `Quickgrip Adhesive (380ml tube)` and `Everbuild Stixall Adhesive (White) - 290ml`. Two consequences:

- `Quickgrip Adhesive (380ml tube)` yields a range named `Quickgrip Adhesive (` — trailing bracket and all, because the prefix is sliced at the digit. Since line descriptions are rebuilt from `range + band + sizeL` (`populateAddMaterialProductSelect()`, public/index.html), picking it puts `Quickgrip Adhesive ( 0.38ltr` on a **client-facing quote**.
- They clutter the range picker with fake sub-litre "tins".

The tin optimiser is **not** at risk — it only reads inside a range you've explicitly mapped to a role, and nobody maps a sealant as a paint range. So this is a correctness-of-labels bug, not a costing bug. Don't over-engineer it.

**Don't just drop every `ml` match** — `Bedec MSP (Gloss, Matt, Satin) - 750ml` is a genuine 750 ml paint tin, and that's exactly why `TIN_SIZE_ML_RE` exists. The tubes are distinguishable by unit-of-sale words in the name (`tube`, `Sealant`, `Caulk`, `Adhesive`), not by size.

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
- **The 202 filter is currently lossy.** `allItems.filter(i => i.SalesDetails?.AccountCode === '202')` throws away the purchase side of every item. Phase 3 needs that kept — a small change at the point of grouping, not a new integration. (Verified 2026-07-14: all 1603 inventory items sell on 202, so the filter excludes nothing among them. It may still exclude non-inventory item types, which an inventory export wouldn't show — so keep the filter, just stop discarding `PurchaseDetails`.)
- **The committed inventory CSV is stale.** `scripts/pricelists/data/InventoryItems-updated_1.csv` no longer matches Xero: 926 names differ (live has `BM Aura Matte - Colours 3.79ltr`, the repo copy still says `… Gallon`) and RepairCare's seven items have moved 311 → 314. The restore has gone further in Xero than the repo records — **pull a fresh export before trusting the committed one for anything.**
- **Sundry items on 314 are NOT the cost side of the sundries %.** Two different mechanisms that must not be conflated:
  - **The sundries %** (labour × %) covers the **long tail of stock consumables** — caulk, tape, filler, floor protection, dust sheets. Bought across many jobs, need paying for, not worth itemising every time. It stays a percentage. It is **never itemised and never tracked** — it isn't a material, it's a recovery mechanism. Exclude it from the tracking view entirely.
  - **Specific sundry items** are **job-specific consumables the % won't cover** — wallpaper paste, lining paper. They're real Xero items, added as one-off material lines, and tracked exactly like paint.
  - This matches the original sundries spec in FEATURES.md: "anything specific/expensive is still added as its own one-off material line, not absorbed into the %."

### Identifying specific sundries — by item code prefix — DECIDED

**`SUN*` is the sundries bucket.** Everything else is paint (or a data error — see Phase 0).

"Bought for THIS job" vs "stock kept across jobs" is Nicky's business rule. Xero records it nowhere, so it cannot be *derived* — not from the name, not from the size, not from the account. The item code is how it gets *declared*. **Nicky curates `SUN` in Xero so it means "itemise this"; the app trusts it and does not second-guess.** Data problem, data fix.

**Why the code and not account 314** — they're 1:1 today (every `SUN`/`RPC` item is 314, every other prefix is 311), so either could carry the flag. The code wins on three counts:

- **314 has another job.** It's a real cost account driving the P&L, where it means "sundries cost" — and that's precisely where the **stock** consumables the % recovers are supposed to sit. Curating 314 to mean "itemisable" would force tape and floor protection onto some other cost account purely to satisfy the app. **Don't let the app's needs reshape the accounts.** The code prefix has no second job, so it's free to carry this one.
- **It survives bookkeeping.** If the accountant re-codes accounts, the app doesn't silently change behaviour.
- **It's visible.** `SUN002` reads as a sundry in the picker, the export and Xero itself. An account code doesn't.

**Open question — `RPC` (RepairCare, 7 items).** Recently moved 311 → 314, so by account they're already sundries; by prefix they're not. Wood repair products are plausibly job-specific and itemisable. **Decide before Phase 1: fold `RPC` into the sundry rule, or re-code those items `SUN`.** Don't leave the two axes disagreeing.

**Caveat on re-coding.** If items under other prefixes should be itemisable (`FAR038` paste, `WAL001/2` Fibreliner, the Isomat kilo fillers), making them `SUN` means **changing the Xero item code — the key historical quotes and invoices reference.** Changing an account is routine; changing a code may not be. Check what Xero does to history before mass-recoding. If it's a problem, the sundry rule needs to accept a small set of prefixes (`SUN`, `RPC`, `WAL`…) rather than just one — cheap, and it keeps the codes stable.

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
- **Don't itemise anything the % already covers.** Caulk, tape, filler, floor protection and dust sheets are paid for by the sundries %. Adding one as a material line **charges the client twice**. The rule of thumb is the one Nicky uses: if it's stock kept across jobs, the % covers it; if it's bought for THIS job (paste, Wallrock Fibreliner), itemise it. **This judgement isn't derived, it's declared** — it lives in the `SUN` item code, curated in Xero, per "Identifying specific sundries" above. Until that prune happens the picker will offer things the % already covers, so don't be surprised by it — and don't "helpfully" add app-side guards against it either.
- **Whole-tin rounding is a job-level rule** (see FEATURES.md). Actuals are what was physically bought, so they're inherently whole tins for tin roles — don't re-apply estimate-side rounding to actuals.
- **Don't reintroduce localStorage as a competing source of truth.** Follow the `materials_snapshot` pattern: server authoritative, load into memory on init. (The colour library's localStorage use is a read-cache of a *global reference list* — not the precedent to copy here.)
- **Grep for duplicates before adding functions** — the app's recurring failure mode is an old function surviving alongside a new one, later definition silently winning.
