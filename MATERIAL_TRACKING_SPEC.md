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

New table, following the per-job convention (`job_id`, backfill, NOT NULL). **Typed columns, NOT the `data JSONB` blob** the other job-scoped tables use — confirmed 2026-07-14.

> **Correction (2026-07-14):** this section used to say "same shape as `materials_snapshot`". It isn't, and never was — `materials_snapshot` is `id / data JSONB / created_at / updated_at` + `job_id`, exactly like `rooms` and `exterior_items`. The DDL below was always typed. The divergence is now **deliberate**: those tables are round-tripped whole (write the blob, read the blob), whereas this one gets **queried** — Phase 3 aggregates actual quantities and margin *across jobs*, which over JSONB means `(data->>'actual_quantity')::numeric` casts and no clean index on the join key. Don't "fix" the inconsistency by blob-ifying it.

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

-- ONE actual row per product per job. Partial (item_code IS NOT NULL) so
-- free-text rows, which have no code, can still be many per job. This is the
-- storage-level guarantee behind "a row is a product" -- see below.
CREATE UNIQUE INDEX IF NOT EXISTS material_actuals_job_item
  ON material_actuals (job_id, item_code) WHERE item_code IS NOT NULL;
```

- **Join key is `item_code`, not snapshot line id** — item codes are stable across recalcs; line ids are not. **But the estimate side must be rolled up by `item_code` before joining** — it is NOT one actual per snapshot line. See "The reconciliation view" below; this is the correction that makes the join well-defined.
- **`description` is denormalised on purpose** so a free-text entry, or an item later recoded in Xero, still displays. Mirrors why snapshot lines carry it.
- Free-text entries (`item_code` NULL) can't join to an estimate line — correct, they're additions by definition. They also have no 202 price, so they need a manual value *to be invoiced* (the one place a price may have to be typed; prefer picking a real Xero item wherever possible).
- API: `GET/PUT/DELETE /api/actuals`, job-scoped like `/api/materials` — **but do NOT copy `saveMaterialsSnapshot()`'s save strategy.** It does `apiDelete(whole job)` then re-`PUT`s every line, which is safe only because the snapshot is regenerable from rooms. Actuals are not regenerable — they're the invoice — so a failure between the DELETE and the re-PUTs would destroy them. **PUT one row at a time; never delete-all-then-rewrite.** This is the storage-layer twin of the critical constraint above. There is deliberately **no collection-level replace-all route**.
- **`apiPut`/`apiDelete` MUST NOT be used for actuals — this bit at build time.** Both swallow every failure: they don't check `response.ok` at all, so a 500 is indistinguishable from success, and on a network error they just set `serverAvailable = false` and let the app carry on from localStorage. That's *correct* for rooms/colours/the snapshot — all regenerable and locally mirrored, so a dropped write costs nothing a Recalculate can't rebuild. For actuals it means **a quantity that silently never gets billed**, which is the exact failure this feature exists to prevent. `apiPutStrict`/`apiDeleteStrict` throw on non-2xx *and* on network failure, and return the parsed body. Verified by asserting the old helper still swallows a 500 while the strict one doesn't.
- **`/api/actuals/:id` upserts on `(job_id, item_code)`, not the primary key** — so a client PUTting a fresh `uid()` for a product already logged updates that row instead of tripping the unique index. It returns the id the server actually holds, and the client adopts it; otherwise the next edit would PUT an id matching nothing. Free-text rows can't use that arbiter (the index is partial and excludes NULL codes, so there's nothing to conflict on and every PUT would insert a duplicate) — hence the separate `/api/actuals-freetext/:id`, which upserts on the primary key. `itemCode: ''` is coerced to NULL for the same reason: `''` is not NULL, so two free-text rows would collide as one product.
- **Actuals are server-only — no localStorage mirror.** The snapshot keeps one because it regenerates from rooms, so a stale cache is recoverable. A local copy of the invoice that silently diverges is worse than a save that visibly fails.
- **Job deletion and Clear Everything cascade to actuals; Clear Rooms does not.** Destroying the estimate must never destroy the invoice — only the two user-confirmed "delete the whole job / all of it" paths take the actuals with them.

## The reconciliation view

**A ROW IS A PRODUCT, NOT AN ESTIMATE LINE — DECIDED 2026-07-14.** Roll the snapshot up by `item_code` first, then left-join the actuals onto *that*.

**Why this isn't a cosmetic choice: `item_code` is not unique within the snapshot, so "one actual per snapshot line" and "join by `item_code`" cannot both be true.** Found while scoping Phase 1, by reading `computeRoleGroups()` rather than trusting this document:

- It buckets by `range + band + colourNumber`, so **each colour is its own line** — and **a band is a PRICE band covering many colours**. Two Pastels colours on the same range produce two estimate lines drawing from the same tins, i.e. **the same item codes**. This isn't an edge case; it's the normal shape of a multi-colour job.
- Same again across roles: wall and ceiling both mapped to one range+band yield one item code on two lines.

Left-joining actuals onto lines by `item_code` would therefore fan one actual out across three lines and compare it against each — triple-counting on screen, and a per-line variance that means nothing.

Rolling up by product resolves it, and matches the two things the view is actually for: **you shop per product** (the merchant doesn't care which room it's for) and **you invoice per product**. Per-colour detail is still worth showing as sub-detail on the row ("Colour 3 · 2 tins, Colour 5 · 1 tin") — it's just not where the actual quantity lives. The cost of the decision, stated plainly: **actuals are not attributable to a colour or a room.** That's accepted — nothing downstream needs it, and Phase 3's calibration is per-job, not per-colour.

Roll-up rules (all real cases in today's data, don't discover them at the keyboard):
- **Key by `item_code`; free-text/custom lines have none** — key those by description so they stay one row each rather than collapsing into a single blank-coded row.
- **Sum `quantity`.** Whole-tin rounding already happened per line, so the sum is what to buy. (It can exceed a single optimised buy — three colours × one 10ltr each is genuinely three tins.)
- **Price collision:** the same code can carry different `unitAmount` if a custom line was priced by hand. Prefer the non-custom line's price and don't silently average.
- **`isPerLitre` must agree** across lines sharing a code — if it ever doesn't, that's a bug, not a case to merge.

Row states:

| State | Meaning | Use |
|---|---|---|
| On estimate, not bought | Still outstanding | The shopping list |
| On estimate, actual = estimate | Used what was quoted | Invoice as quoted |
| On estimate, actual ≠ estimate | Used more/fewer | **Invoice the actual**; variance is the calibration signal |
| Actual, no estimate line | Bought something unquoted | **Invoice it**; the case that loses money if missed |

One view, all three purposes: filter to "not bought" → shopping list; total actual × 202 → the invoice; actual vs estimate → calibration.

**Variance against the client's expectation matters.** The client was given a materials *estimate*. If actuals run well over it, the invoice exceeds what they were told — that's a conversation to have during the job, not a surprise at the end. The view should show the running actual total against the estimated total, so the gap is visible early. This is a client-relations feature, not just arithmetic.

## Phasing

**Phase 0 — FIX THE PICKER FIRST — ~~next build~~ BUILT (2026-07-14)**

> **Shipped.** `groupMaterialItems()` now returns `{ paint, sundries, unmodellable }`, bucketing on the code prefix before the size parse; `/material-groups` serves that envelope and logs all three counts; the frontend unwraps `.paint` into `materialGroupsCache` and the new flat `materialSundriesCache` feeds `populateAddMaterialProductSelect()` alone; `scripts/check_item_parse.py` is now a baseline health check that exits non-zero on drift. Verified against the real export — see "Verified against…" below for the numbers, which **corrected the baseline from 15 to 11**. Everything the section predicted held, including the free description fix. Phase 1 is the next build.

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
| Sundry | code starts `SUN` | flat: item + qty + price, no size |
| Paint | anything else, **and** the name parses | range → band → size, tin-optimised |
| **Unmodellable** | anything else that **doesn't** parse | surface it; offer it nowhere |

**Bucket order matters, and it does more work than expected.** The prefix check must run **before** the size parse. Verified 2026-07-14 against the cleaned Xero data: doing it in that order means `SUN013 Quickgrip Adhesive (380ml tube)` and `SUN014 Everbuild Stixall … 290ml` are bucketed as sundries and never reach `parseItemName()` — which **fixes the client-facing description bug for free** (`Quickgrip Adhesive ( 0.38ltr` on a quote) with no regex change. `BED002 Bedec MSP … 750ml` stays in the paint bucket, correctly, as a genuine sub-litre tin.

**Residual ml false positives — accepted, do not fix.** `ISO076`–`ISO079` (Isomat caulks and PU sealants) still parse as 0.28–0.6L "tins". They stay: the optimiser only reads ranges explicitly mapped to a role and nobody maps a caulk as paint, so there's no costing exposure — and they can't be `SUN` either, because caulk is exactly what the sundries % recovers. They clutter the range picker with four fake sub-litre entries. That is the whole cost. Don't invent a fourth category for it.

**Why not "no size = sundry"?** Because "didn't parse" is not a category, it's a bug bucket — and the live data proves it. Of the 28 non-`SUN`/`RPC` items that fail to parse today, most are **not sundries at all**:

- **8 are real Isomat paint tins** killed by a regex gap — `Isomat Flexcoat Masonry - Colours 3LT`, `Isomat Silicone Paint - White 10LT` and friends. `TIN_SIZE_RE` handles `L` and `ltr` but **not `LT`**: the `\b` can't fire between `L` and `T`. See the LT bug below.
- **2 are broken rows** — DUL231 and DUL232 are both `Dulux Heritage VM True White - True White`, duplicated, sizeless. Data to fix, not a product to sell.
- **2 are tools** — `F&B Roller Frame 9in - Each Each`, `F&B Roller Sleeve 9in - Each Each`.

If size-less items were swept into a flat sundries group, all of that would surface in the picker **as sundries**, and — worse — the LT bug would be permanently masked: the Isomat paint would appear as a pickable sundry rather than as a missing paint range, so nobody would ever notice four ranges are absent. **The parse-failure bucket must stay loud, not become a category.**

**~~"loud and empty"~~ — CORRECTED (2026-07-14). It will never be empty, and expecting that defeats the point.** ~~Measured against the cleaned data: 15 items, of which only 4 are true errors (`DUL231`/`DUL232` duplicate rows, `FAR036`/`FAR037` roller tools).~~ **Re-measured at build time (2026-07-14): 11 items, and all 11 are legitimate** — Isomat fillers, primers and renders sold by the **kilo** (`ISO065`–`ISO075`), correctly named, with no litre size to parse because they don't have one. They are permanent residents.

The four "true errors" resolved themselves in Xero between the scoping pass and the build, in two different ways — worth distinguishing, because only one is deletion:
- `FAR036`/`FAR037` (roller frame/sleeve) — **deleted**. 1589 → 1587 items.
- `DUL231`/`DUL232` — **repaired, not deleted**. They're now `Dulux Heritage Velvet Matt - True White 5ltr`/`10ltr`, which parse cleanly, so they moved into **paint** (1555 → 1557), which is where they always belonged.

**This is the third time the data has moved ahead of the spec, and the second time it changed a number this document asserted.** The bucket is doing its job; the written baseline is what rots. That's precisely why the health check is a script with `BASELINE` in it, not a number in prose — prose can't fail a run.

So the bucket's real meaning is **"unmodellable"**, not "error", and the health check is **"has this list changed?"**, not **"is it empty?"**. This matters: an empty-bucket expectation is one that's never met, so it gets ignored, and the next `LT`-class bug hides among eleven expected entries — the exact failure the bucket exists to catch. Either give the kg-sold products a home, or **record the known baseline** and surface only departures from it.

**DONE — the baseline is recorded.** `scripts/check_item_parse.py` carries `BASELINE` (the 11 `ISO065`–`ISO075` kilo products), reports the three bucket counts, and **exits non-zero on any drift** — in three directions, all three verified to actually fire at build time by simulating them:
- **arrived** — an item the parser stopped understanding. The loud one: a synthetic `Tikkurila Optiva 5 - White 10 Litres` (i.e. an `LT`-class regression) is caught and named.
- **left** — a baseline item fixed or deleted in Xero. Expected drift; update the list.
- **renamed** — same code, different name. Catches a `TIK051`-style misnaming in place.

The kg-sold products still have no home, which is the accepted half of that either/or. If they ever need one, that's a unit model (kg/roll/sachet) — not a fourth bucket.

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

**Phase 1 — the log — ~~SCOPED, next build~~ BUILT (2026-07-14)**

> **Shipped.** `material_actuals` + partial unique index (`db/setup.sql`), `GET/PUT/DELETE /api/actuals` (+ `/api/actuals-freetext/:id`), `rollUpEstimateByItem()` / `buildActualsView()` / `actualsTotals()`, and the `screen-actuals` view with tick, editable quantity, add-missing and running totals — reached from a **Materials ›** button on Summary.
>
> **⚠️ `db/setup.sql` is NOT run automatically** (nothing in `server.js` or `db/index.js` touches it — the README's `psql $DATABASE_URL -f db/setup.sql` is a manual step). **Run it before using the view**, or every actuals call 500s on a missing relation. Both statements are `IF NOT EXISTS`, so re-running is idempotent.
>
> Two things the build changed from this scope, both recorded below in place: **`unit_amount` was added to the DDL** (free-text rows have no Xero item to price from, and this spec already said that's the one place a price gets typed), and **`apiPutStrict`/`apiDeleteStrict` had to be written** — see the API bullet. Phase 2 (invoicing from actuals) is next, behind its sundries-% gate.

Ships whole (table → API → view → add-missing → totals), reached from a **temporary entry point**. The hamburger nav is where this belongs and is decided, but it's nav-wide, tracked separately in FEATURES.md, and this feature doesn't depend on it — so it isn't a prerequisite. Don't let the nav refactor gate the thing it was designed to hold.

**1. `material_actuals` table + API.** DDL and the partial unique index are in "Data model" above. Two constraints repeated because they're the ones that lose the invoice if missed: actuals live in **their own table** (never on snapshot lines — recalc regenerates every line id), and the API **PUTs one row at a time** (never `saveMaterialsSnapshot()`'s delete-all-then-rewrite, which is only safe for regenerable data).

**2. The estimate roll-up.** A new pure function over `materialsSnapshot` — one entry per `item_code` (custom lines keyed by description), carrying summed quantity, description, `unitAmount`, `isPerLitre`, and the per-colour breakdown for sub-detail. Rules and collision cases are in "The reconciliation view". This is the join's left side and the one genuinely new piece of logic in the phase; **unit-test it against a multi-colour job with two colours in one band** — the case that motivated the whole decision.

**3. The view.** One row per product: tick + editable actual quantity, defaulting to the estimated quantity so "used exactly what was quoted" is one tap. Filter to un-ticked → the shopping list.

**4. "+ Add material the estimate missed."** Reuses `populateAddMaterialProductSelect()` / `addMaterialProductOptions` **wholesale** — Phase 0 taught it sundries, so paste and Fibreliner are already in it, and it already handles free text. **Don't build a second product picker** (this repo's recurring failure mode is a second copy of a function silently winning — grep first).

**5. Outstanding count + actual total vs estimated total.** 202 prices are already cached, so both totals are free arithmetic. Show the running actual against the estimate: the client was quoted an estimate, and if actuals run over it that's a conversation to have *during* the job. Client-relations feature, not arithmetic.

*Known gap to close while building #5:* pricing an actual that has **no estimate line** needs a lookup from `item_code` → price, across **both** `materialGroupsCache` and `materialSundriesCache`. **No such index exists today** — `addMaterialProductOptions` is a flat array built for the `<select>` and keyed by option index, not code. Build a proper `Map` and have the picker read from it too, rather than adding a second flattening pass.

*Unit labels:* per the Gotchas, an actual quantity means different things per row — litres (`isPerLitre`), tins (paint), or rolls/tubs/kilos (sundries, where the unit is already in the Xero name). Label from the row; never assume tins. Sundry lines only ever enter the snapshot as custom lines, so if the label needs to distinguish them, carry a flag from the picker rather than re-deriving the `SUN` rule in the frontend — the prefix rule lives in `routes/xero.js` and should stay there.

**Phase 2 — invoicing from actuals (the payoff) — option (a) BUILT (2026-07-14)**

> **Shipped.** `buildInvoiceList()` / `invoiceListAsText()` and a `screen-invoice` view — its own screen, reached from **Invoice ›** on Materials, because ticking things off happens at the merchant and invoicing happens at the desk. Materials only, with a note on screen saying so. **Copy** puts it on the clipboard as tab-separated text (falls back to a selectable textarea when the clipboard API refuses, as iOS Safari can).
>
> **THE TICK IS THE CONFIRMATION, AND IT DECIDES WHAT GETS BILLED — decided 2026-07-14.** Only rows ticked as bought reach the total. Everything else is listed under "Not confirmed — check before invoicing" and **never totalled**.
>
> This is a deliberate divergence from the tracking view, and the reason matters: `actualsRowQuantity()` falls back to the *estimate* for un-ticked rows, which is right for a "so far" figure mid-job and **wrong on an invoice** — billing an estimate nobody confirmed is charging for goods that may never have been delivered. Silently dropping them would under-bill instead. So they're surfaced and Nicky decides. Both failure modes are visible; neither is automatic.
>
> **Ticked at quantity 0 is a real state** — "confirmed, bought none" — and drops out of *both* lists rather than printing a £0.00 line or nagging as outstanding.
>
> **Tab-separated, not CSV**, because real product names contain commas (`Bedec MSP (Gloss, Matt, Satin)`) and TSV pastes into a spreadsheet or Xero's line grid with columns intact and no quoting rules.
>
> Option (b) (`POST /Invoices`) remains unbuilt and still needs its scope verified — see below. Phase 3 (margin/calibration) is next.

> **~~GATE — close the sundries-% overlap BEFORE this ships.~~ NOT A GATE — RESOLVED 2026-07-14, and it was the wrong question.** Phase 2 is not blocked by this.
>
> The gate assumed floor protection had *moved* from the % to itemisation, leaving the two overlapping. It hadn't. **The % still covers floor protection, and that's correct — it's the norm.** `SUN010`/`SUN011`/`SUN012` exist in the picker for the **exceptional job that needs protection beyond the normal amount**, which is genuinely extra work the % was never sized for. Nicky's words: *"it's an odd case where extra is specifically needed so I want the option, it isn't the norm."*
>
> So an itemised protection line is **additive, not duplicative**: the % pays for the normal protection, the line pays for the unusual extra on top. Nothing is billed twice, because in the normal case **no line is added at all**. The %'s remit doesn't shrink, and it doesn't need recalibrating on this account.
>
> **The residual risk is behavioural, not structural, and it's the thing to actually watch:** if protection ever gets itemised *routinely* — because it's in the picker and ticking it is easy — the overlap becomes a real double charge. The control is the judgement, not the code. **Don't add an app-side guard for it** (no warnings, no "are you sure?"): the rule is "is this extra beyond normal?", which the app cannot know, and a guard would only train the judgement out.

- Produce the materials list for the invoice: actual quantities × 202 prices. **Live 202 prices, not the ones frozen into the snapshot at Recalculate time** — same rule as the tracking view, so what you saw while shopping is what you bill.
- **The app has no invoice path today — it only creates Quotes** (`POST /Quotes`, routes/xero.js). Billing actuals means either:
  - **(a) Output a list** Nicky enters/checks in Xero himself — small, no new Xero surface, proves the model on real jobs first. ~~**Recommended start.**~~ **BUILT 2026-07-14 — see above.**
  - **(b) `POST /Invoices`** from the app, mirroring the existing quote builder. More work, and **the scope needs verifying**: the app currently requests `accounting.invoices`, which is not a documented Xero scope name — quotes work with it today, but don't assume invoices will until tested. Budget for a re-auth.
- Labour lines carry over from the quote unchanged (quoted = billed). Only materials come from actuals.

**Phase 3 — margin / calibration**
- Cache `PurchaseDetails.UnitPrice` for accounts **311** (paint) and **314** (sundries) from the `/Items` call the app already makes — currently discarded by the `SalesDetails.AccountCode === '202'` filter. No new scope, no new request, no typing.
- Margin per job = Σ(actual × 202) − Σ(actual × 311/314).
- Cross-job calibration (is wall coverage really 11 m²/L? are the exterior assumed areas right?) needs history, so it lands naturally once Phase 1 has run on a few real jobs. Don't build it before there's data to look at.

## Xero notes

- **Purchases can't be pulled.** Scopes are `accounting.contacts accounting.settings.read accounting.invoices` — no `accounting.transactions`, so real bills/receipts can't be read. Logging stays manual. (Not a problem: quantities are what's typed, and prices come from Items.)
- **The 202 filter is currently lossy.** `allItems.filter(i => i.SalesDetails?.AccountCode === '202')` throws away the purchase side of every item. Phase 3 needs that kept — a small change at the point of grouping, not a new integration. (Verified 2026-07-14: all 1603 inventory items sell on 202, so the filter excludes nothing among them. It may still exclude non-inventory item types, which an inventory export wouldn't show — so keep the filter, just stop discarding `PurchaseDetails`.)
- **Work from a dated export, and re-pull rather than trust an old one.** The previously committed `InventoryItems-updated_1.csv` had drifted badly from Xero (926 names differed) and has been removed, along with `InventoryItems-restored.csv` (regenerable output of `restore_inventory.py`). The current reference is `scripts/pricelists/data/InventoryItems-20260714.csv`. ~~It is already partly out of date by design — the `TIK051` rename, the `RPC` deletions and the 311 → 314 moves all happened in Xero after it was taken~~ — **corrected 2026-07-14: that described the FIRST export and was left pointing at its replacement.** The committed file is the *re-export taken after* that cleanup, and it was checked at build time: no `RPC*` rows, `TIK051` reading `Magnolia 10ltr`, Fibreliner at `SUN019`/`SUN020`. It was nonetheless still behind reality in two ways (the roller-tool deletions and the `DUL231`/`DUL232` repair), which is the point: **re-export before relying on it for anything, and verify the claim rather than the filename.** The lesson holds twice over — Xero moves ahead of the repo, an export is a snapshot rather than a source of truth, and *a note about an export goes stale faster than the export does.*
- **Sundry items on 314 are NOT the cost side of the sundries %.** Two different mechanisms that must not be conflated:
  - **The sundries %** (labour × %) covers the **long tail of stock consumables** — caulk, tape, filler, floor protection, dust sheets — at the level a normal job uses them. Bought across many jobs, need paying for, not worth itemising every time. It stays a percentage. **The % itself** is never itemised and never tracked — it isn't a material, it's a recovery mechanism. Exclude it from the tracking view entirely.
    - This does **not** mean the products it covers can never appear as a line. Floor protection is the standing exception: the % pays for the normal amount, and an itemised `SUN010`–`SUN012` line pays for the unusual extra a particular job needed. Two different things, both legitimate. See the Gotchas.
  - **Specific sundry items** are **job-specific consumables the % won't cover** — wallpaper paste, lining paper. They're real Xero items, added as one-off material lines, and tracked exactly like paint.
  - This matches the original sundries spec in FEATURES.md: "anything specific/expensive is still added as its own one-off material line, not absorbed into the %."

### Identifying specific sundries — by item code prefix — DECIDED

**`SUN*` is the sundries bucket.** Everything else is paint (or a data error — see Phase 0).

"Bought for THIS job" vs "stock kept across jobs" is Nicky's business rule. Xero records it nowhere, so it cannot be *derived* — not from the name, not from the size, not from the account. The item code is how it gets *declared*. **Nicky curates `SUN` in Xero so it means "itemise this"; the app trusts it and does not second-guess.** Data problem, data fix.

**Why the code and not account 314** — they're 1:1 today (every `SUN`/`RPC` item is 314, every other prefix is 311), so either could carry the flag. The code wins on three counts:

- **314 has another job.** It's a real cost account driving the P&L, where it means "sundries cost" — and that's precisely where the **stock** consumables the % recovers are supposed to sit. Curating 314 to mean "itemisable" would force tape and floor protection onto some other cost account purely to satisfy the app. **Don't let the app's needs reshape the accounts.** The code prefix has no second job, so it's free to carry this one.
- **It survives bookkeeping.** If the accountant re-codes accounts, the app doesn't silently change behaviour.
- **It's visible.** `SUN002` reads as a sundry in the picker, the export and Xero itself. An account code doesn't.

**~~Open question — `RPC`~~ — DECIDED (2026-07-14): re-code, don't widen the rule.** RepairCare now lives under `SUN001`–`SUN007`; `RPC001`–`RPC007` are to be deleted. The sundry rule stays a single prefix — `SUN` — with no allowlist of secondary prefixes. Xero permits deleting inventory items (verified: the old `SUN` consumables were deleted outright, 1603 → 1597 items), so the earlier worry about item codes being undeletable history keys did not materialise for these.

**Verified against `scripts/pricelists/data/InventoryItems-20260714.csv`, re-exported after cleanup (2026-07-14). The Xero data is clean: ~~1589 items bucketing 19 sundry / 1555 paint / 15 unmodellable~~ → re-measured by running the real `groupMaterialItems()` over the export at build time: 1587 items (all on account 202) bucketing 19 sundry / 1557 paint / 11 unmodellable.** The earlier figures predate `FAR036`/`FAR037` being deleted and `DUL231`/`DUL232` being repaired into real paint tins — see the corrected "loud and empty" note above. What the first export caught, and how each resolved:

- **RepairCare had been duplicated, not moved** — `RPC001`–`RPC007` were still Active alongside byte-identical `SUN001`–`SUN007`. Both sets would have been pickable, splitting margin and quote history across two codes for one product. **Resolved: `RPC*` deleted.** (Manual — nothing in this repo writes to live Xero; every script is CSV in, CSV out.)
- **The prune deliberately keeps floor protection** — `SUN010`/`SUN011`/`SUN012` and the `SUN015` filler stay in `SUN` so they *can* be itemised. `SUN008` (masking paper) was deleted and stays with the %. ~~**This changes what the sundries % is for — see the Phase 2 gate below.**~~ **It does not** (resolved 2026-07-14): the % still covers the normal protection on every job, and these exist for the odd job that needs extra beyond it. Being in `SUN` means "itemisable when it's genuinely extra", not "always itemised".
- **Lining paper had been missed.** The paste was re-coded but Wallrock Fibreliner was still `WAL001`/`WAL002` — not `SUN`, no parseable size — so it landed in the unmodellable bucket where the picker would never offer it, defeating one of the two products this flow exists to track. **Resolved: re-coded `SUN019`/`SUN020`.**
- **`TIK051` was a misnamed tin** — `Tikkurila Optiva 3 - Magnolia 1ltr` at £124.20 beside `TIK053` at £17.12 under the identical name. It was the 10ltr: White and Colours each carry 10/3/1, Magnolia had no 10ltr, and £124.20 sits between White 10ltr (£116.91) and Colours 10ltr (£146.07). Not a direct overcharge — `optimizeTinCombo()` minimises cost so it would never pick the £124.20 entry — but the Magnolia band had **no 10ltr available**, so large Magnolia jobs were costed as a stack of 3ltr tins and quoted high. **Resolved: renamed to `Magnolia 10ltr`.**

  **This is the case for the unmodellable bucket, and for actually reading it.** A duplicate name at an absurd price is invisible to the optimiser (which just routes around it) and invisible on the quote (the cheap tin gets picked) — but obvious the instant a parse report lists the range. The bug was silent, live, and cost real money on every Magnolia job.
- **Duplicate Tikkurila rows at identical prices** — eight Temaprime EE pairs, two Cleaning Agent pairs. Harmless to costing, but they double up in the band picker. Likely an inventory-restore artefact (see `INVENTORY_RESTORE_SPEC.md`).
- **The unmodellable bucket is healthy** — ~~17 items, all genuinely wrong or uncategorised (DUL231/232 duplicates, roller frames, Isomat kilo fillers, the Fibreliner)~~ **11 items at build time, all legitimate**: just the Isomat kilo products. The Fibreliner left it (re-coded `SUN019`/`SUN020`), the roller frames were deleted, the DUL duplicates were repaired into paint. No paint hiding in it now the `LT` fix has landed.
- **Archive status: no longer blocking.** Pruning was done by deletion, which works, so the app doesn't need to honour `Status` for the prune to take effect. One archived item (`TIK015`) is still offered by the picker — a real but minor correctness bug, now decoupled from this feature.

**`SUN` is no longer 1:1 with account 314** — as of the export, `SUN016`–`SUN018` sold on 311; Nicky has since moved them to 314. Either way the design is unchanged: **the code prefix stays the flag**, because 314 has its own P&L job. Watch that 314 doesn't drift into meaning "the app's itemisable flag" — if a stock consumable ever needs 314 for accounting reasons, the two meanings collide, which is exactly what "don't let the app's needs reshape the accounts" was guarding against.

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
- **Don't itemise anything the % already covers — *routinely*.** Caulk, tape, filler, floor protection and dust sheets are paid for by the sundries %, and adding one as a material line **as a matter of course charges the client twice**. The rule of thumb is the one Nicky uses: if it's stock kept across jobs, the % covers it; if it's bought for THIS job (paste, Wallrock Fibreliner), itemise it.
  - **Floor protection is the deliberate exception, and it's a third case, not a violation** (confirmed 2026-07-14). The % covers the **normal** protection on every job. `SUN010`/`SUN011`/`SUN012` are there for the **odd job needing extra beyond normal** — additive, not duplicative, because in the normal case the line simply isn't added. The picker offering them is the point, not an oversight. See the Phase 2 note above.
  - **This judgement isn't derived, it's declared** — it lives in the `SUN` item code, curated in Xero, per "Identifying specific sundries" above. The app has no way to know whether a given job's protection was "extra", so **don't add app-side guards** — no warnings, no "are you sure?". A guard can only get the exceptional case wrong, and would train the judgement out.
- **Whole-tin rounding is a job-level rule** (see FEATURES.md). Actuals are what was physically bought, so they're inherently whole tins for tin roles — don't re-apply estimate-side rounding to actuals.
- **Don't reintroduce localStorage as a competing source of truth.** Follow the `materials_snapshot` pattern: server authoritative, load into memory on init. (The colour library's localStorage use is a read-cache of a *global reference list* — not the precedent to copy here.)
- **Grep for duplicates before adding functions** — the app's recurring failure mode is an old function surviving alongside a new one, later definition silently winning.
