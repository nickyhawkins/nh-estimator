# Inventory CSV Restoration & Tidy — Spec for Claude Code

## Purpose

Many Xero inventory items have been **truncated at a 50-character limit**, losing their tin size (and sometimes their colour band) from the end of the ItemName. This spec restores the correct sizes by cross-referencing the supplier price lists, and standardises naming. This feeds the automatic-materials feature, which parses `range → band → size` from item names, so accurate sizes are essential.

## Inputs

- The Xero inventory CSV (columns: `*ItemCode,ItemName,Quantity,PurchasesDescription,PurchasesUnitPrice,PurchasesAccount,PurchasesTaxRate,SalesDescription,SalesUnitPrice,SalesAccount,SalesTaxRate,...`)
- Supplier price list PDFs (Brewers Decorator Centres format + Tikkurila). Encode each as a structured lookup: `product → size → ex-VAT list price`.

## The key relationship (VERIFIED)

**Xero PurchasesUnitPrice = price-list (ex-VAT) price × 1.20**, exactly, across ALL suppliers. This is the reliable key for matching a truncated item to its correct size.

- To identify a truncated item's size: compute `PurchasesUnitPrice ÷ 1.20`, match against the product's sizes in the price list, the matching size is the item's size.
- Verified examples:
  - DUL111 buy 95.99 ÷ 1.2 = 79.99 → Diamond Satinwood 5LT ✓
  - DUL112 buy 57.83 ÷ 1.2 = 48.19 → 2.5LT ✓
  - DUL113 buy 29.81 ÷ 1.2 = 24.84 → 1LT ✓
  - Confirmed across Crown, Johnstone's, Zinsser too.
- Within a truncated group, item codes run **largest size to smallest** (e.g. code N=5L, N+1=2.5L, N+2=1L), which corroborates the price match. Use price match as primary; sequence as a sanity check.

## Tasks

### 1. Build price-list lookups
Encode each supplier's price list as structured data (product name → {size: listPrice}). Suppliers: Tikkurila, Dulux Trade, Johnstone's Trade, Crown Trade, Zinsser, Isomat, Little Greene, Farrow & Ball, Benjamin Moore. Save these as data files in the repo (e.g. `scripts/pricelists/`) so future price updates reuse them.

### 2. Restore truncated sizes
For each item whose ItemName has no parseable size (or a clearly truncated one like `...PBW 2.` or `...White 10` with no unit):
- Identify the product and (where present) colour band from the ItemName.
- Compute `PurchasesUnitPrice ÷ 1.20` and match to the price list to find the size.
- Restore the full ItemName as `<range> - <band> <size>ltr` using the standard format.
- If the price matches no list size within a small tolerance (say £0.05), DO NOT guess — flag it for manual review.

### 3. Standardise naming (same conventions as Tikkurila tidy)
- Keep the supplier/brand prefix (e.g. "Dulux", "Crown", "JT" for Johnstone's Trade).
- Size units → `ltr` (convert `LT`, `L`, `LTR`, `LITRE` → `ltr`; convert `ML` → litres, e.g. `500ML` → `0.5ltr`, `750ML` → `0.75ltr`).
- Expand truncated band words: `Whi`→`White`, `Colou`/`Colo`/`Col`→`Colours`, `Blac`/`Bla`→`Black`, `Magn`/`Magnol`→`Magnolia`, `Brill`/`Bril`→`Brilliant White` (context-dependent — see PBW rule), `Pastel`→`Pastels`.
- `Pure Brilliant White` (and truncations `Pure Brilliant Whi`, `- Pure`, `Brill White`, `Bri`) → **`PBW`**. PBW is shorter, which helps stay under the 50-char limit so the size fits.
- Keep full product name in `PurchasesDescription` and `SalesDescription` (don't shorten those — only the ItemName).
- Watch the 50-char limit on ItemName; PBW and dropping redundant words should keep restored names within it. Flag any that still exceed 50 chars.

### 4. Leave these UNCHANGED (no litre size needed)
- **KG products** (Isomat fillers/primers: 10KG, 5KG, 4KG, 1KG, 800G, etc.) — keep their KG/G units.
- **US-unit products** (Benjamin Moore: Gallon, Quart, Pint) — these use US sizes; leave as-is unless you (Nicky) decide to convert. Note: BM is likely not used for the core materials calc.
- **Sundries** (masking tape, rollers, paste, caulk, protector, boards, "per m", "per Roll", aerosols in ML that are genuinely aerosols) — no litre size; leave alone.
- Tikkurila (`TIK*`) is already tidied — leave unchanged.

### 5. Prices
- **Do NOT change any prices** in this task. Sizes and names only. (Tikkurila's 5% rise was already applied separately.)

## Output & verification

- Output a new Xero-ready CSV (same column structure).
- **Produce a verification report**: for every changed row, show ItemCode, old ItemName → new ItemName, and the size restoration basis (e.g. "buy 95.99 ÷ 1.2 = 79.99 → matched Diamond Satinwood 5LT"). This is essential — Nicky needs to spot-check.
- **Produce a flag list**: any items where the size couldn't be confidently restored (no price match, ambiguous match, still over 50 chars, or unrecognised product). These get fixed manually in Xero.
- Row count must be unchanged; no items added or removed.

## Reuse

Fold this into the `scripts/` tooling so that:
- The price-list lookups persist and can be updated when suppliers issue new lists.
- Future price rises (the existing price-update script) and size/name integrity can both be run from the same place.
- Adding a new supplier = add its price list to the lookup, no code rewrite.

## Gotchas
- The 1.20× markup is the source of truth for matching — trust it, it's verified exact.
- Never guess a size — flag instead. This feeds real customer quote prices.
- Only ItemName is shortened; descriptions keep full names.
- Consistent naming is what the materials parser depends on — keep the `range - band size` structure.
