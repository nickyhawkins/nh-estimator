# Materials Feature — Revised Spec (supersedes Phase 1/2/3 split in FEATURES.md)

## Why this revision

During Phase 1 setup we discovered two things that change the design:

1. **Defaults must be a product RANGE, not a specific tin.** Selecting a single tin size (e.g. "Optiva 5 5ltr") wrongly locks the calculation to that size. The app should know all available sizes for a range and choose the best fit. This pulls the old "Phase 3" tin optimisation forward — it belongs in the core, not deferred.

2. **Ranges have COLOUR BANDS priced differently.** Within one range (e.g. Tikkurila Optiva 5) there are colour bands — White, Magnolia, Colours — each a different price, each available in multiple tin sizes. Pricing the wrong band materially misprices the job.

## The real data hierarchy in Xero

Each Xero item is one specific tin. The name encodes the full path:

```
Tikkurila Optiva 5 - White 10ltr      £95.84   (TIK057)
Tikkurila Optiva 5 - White 3ltr       £33.15   (TIK058)
Tikkurila Optiva 5 - White 1ltr       £13.23   (TIK059)
Tikkurila Optiva 5 - Magnolia 10ltr   £101.82  (TIK060)
Tikkurila Optiva 5 - Colours 10ltr    £119.74  (TIK063)
... etc
```

Hierarchy: **Range** (`Tikkurila Optiva 5`) → **Colour band** (`White` / `Magnolia` / `Colours`) → **Tin size** (`1ltr` / `3ltr` / `5ltr` / `10ltr`).

Because item names are now consistently formatted, the app can parse this:
- **Range** = everything before the ` - ` separator
- **Colour band** = the word(s) after ` - ` and before the size (OPTIONAL — may be absent for unbanded products; treat as null/single band)
- **Tin size** = the trailing `Nltr` value
- **Price** = SalesUnitPrice from the item (sales account 202 — the price charged to the customer)

## Must work across ALL suppliers, not just Tikkurila

The grouping and parsing must be **supplier-agnostic**. Tikkurila is just the first supplier we tidied. Requirements:

- **Parse whatever consistent structure exists** for any supplier, not hardcoded to Tikkurila. The rules below (range before ` - `, band + size after) should apply generically based on the item name format, regardless of supplier prefix or item code prefix.

- **Colour bands are OPTIONAL.** Many products have no White/Magnolia/Colours band — they're just a product in various sizes (e.g. a primer or a trade white that isn't banded). The parser must handle both shapes:
  - `range -> band -> [sizes]` (banded, like Optiva 5)
  - `range -> [sizes]` (no band — treat as a single implicit band, or band = null)
  Do NOT assume every product has bands.

- **Size format tolerance.** Parse sizes robustly: `10ltr`, `3ltr`, `1ltr`, and also legacy formats that may still exist for un-tidied suppliers (`2.5 ltr`, `750ml`, `5L`). Normalise to litres for calculation. (ml → litres, e.g. 750ml = 0.75.) Flag or skip items whose size can't be parsed rather than guessing.

- **Depends on consistent naming.** Reliable grouping across suppliers depends on their item names following the same convention Tikkurila now uses. **Action required outside the app:** run the price-tidy script (in `scripts/`) across the other suppliers to standardise their naming (keep supplier prefix, `range - band size` structure, `ltr` units). Until a supplier is tidied, the parser should degrade gracefully — group what it can, flag what it can't — rather than break.

- **No hardcoded supplier or range names** in the grouping logic. It reads the data and derives ranges/bands/sizes from the names. Adding a new supplier or product should require no code change, only consistent naming.

## Revised approach

### Grouping (new — do this first)
Parse all account-202 (sales) Xero items into a structure (use SalesUnitPrice for pricing — 202 is the sales account, what the customer is charged; 311 is the purchases/cost account and is NOT used for quoting):
```
range -> colour band -> [ {size_litres, price, itemCode}, ... ]
```
This gives the app, for any range + band, the full list of available tin sizes and prices to optimise over.

### Settings — default products by RANGE
User selects default **ranges** (not tins) for:
- Wall paint (e.g. "Tikkurila Optiva 5")
- Ceiling paint
- Woodwork topcoat
- Woodwork primer

Store the range identifier, not a specific item.

### Per-job / per-colour selections
- Wall product range and **colour band** can be set per colour group (ties into colour numbering).
  - A colour group needs: range (default or overridden) + colour band (White / Magnolia / Colours).
- Ceiling and woodwork: default range + band, overridable per job for different finishes.

### Calculations
- **Walls (per colour group):** litres needed for that group → choose cheapest combination of available tin sizes *within the selected range + band* that covers the litres → sum cost. (This is the tin optimisation — cheapest fill, e.g. 3.5ltr = 3ltr + ... whichever combo of that band's sizes is cheapest and sufficient.)
- **Ceiling / woodwork topcoat / primer:** these are charged per litre (user has per-litre line items). Use litres × per-litre price for the selected range + band. Primer litres = topcoat litres × 0.8.

### On the quote
Consolidated materials lines using the real Xero item codes chosen by the optimiser, account 202 (sales), No VAT, under the labour lines. For walls this may mean e.g. "1 × Optiva 5 Colours 3ltr" + "1 × Optiva 5 Colours 1ltr" if that's the cheapest fill.

## Build order (revised)

1. **Item grouping** — parse Xero items into range → band → sizes. Test it returns correct structure for Optiva 5 (3 bands, 3 sizes each).
2. **Settings** — select default ranges for the four product roles.
3. **Colour band selection** — per colour group (start simple: one band for the whole job, refine to per-group with colour numbering).
4. **Tin optimisation** — cheapest combination of sizes within a range+band to cover required litres.
5. **Per-litre products** — ceiling, topcoat, primer (primer = topcoat × 0.8).
6. **Materials on summary + total + Xero line items.**
7. **Then deposit feature** (25% of labour + materials, weekly split option).

## Gotchas (still apply)
- Whole-tin logic is per colour group, not per room and not per whole job.
- Watch for duplicate function definitions.
- Read from in-memory arrays; don't reintroduce localStorage as a competing source of truth.
- Item names are the source of truth for range/band/size parsing — depends on the consistent naming from the price-tidy script, so keep that naming convention when adding new products.
- Grouping MUST be supplier-agnostic and handle optional colour bands — see the cross-supplier section above. No hardcoded supplier/range names.
- Other suppliers still need the tidy-up script run over them to standardise naming; until then the parser should group what it can and flag the rest, not break.
