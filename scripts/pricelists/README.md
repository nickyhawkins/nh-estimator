# Supplier price lists & inventory restoration

This directory holds the supplier ex-VAT price lists (as structured JSON) and
the tooling that uses them to keep Xero's `InventoryItems` export accurate:
restoring tin sizes that got lost to Xero's 50-character `ItemName` limit,
standardising naming across suppliers, and (via `scripts/update_supplier_prices.py`
one level up) applying price rises. All 9 suppliers — including Tikkurila —
go through the same `restore_inventory.py` pipeline; there's no special case
for any of them anymore.

## Background

Many Xero inventory items had their `ItemName` truncated at 50 characters,
which sometimes cut off the tin size (and occasionally the colour band) —
e.g. `Dulux Diamond Satinwood - Pure Brilliant Whi` with no size at all.
`PurchasesDescription`/`SalesDescription` kept the full text but were *also*
truncated at the same point, so they don't contain any information `ItemName`
doesn't have.

**The key relationship, verified exact across every supplier in this
dataset:** `PurchasesUnitPrice = price-list ex-VAT price × 1.20`. Given a
truncated item's buy price, dividing by 1.20 and matching against the
supplier's price list identifies the size (and disambiguates the colour band
when needed) with certainty — no guessing.

The full spec for the original restoration is [`INVENTORY_RESTORE_SPEC.md`](../../INVENTORY_RESTORE_SPEC.md)
at the repo root. The original supplier PDFs are in [`source_pdfs/`](source_pdfs/).
The CSVs and reports from that first run are in [`data/`](data/), kept as a
historical record and a worked example of the tools' output.

## Files in this directory

| File | Purpose |
|---|---|
| `dulux.json`, `johnstones.json`, `crown.json`, `zinsser.json`, `isomat.json`, `little_greene.json`, `farrow_ball.json`, `benjamin_moore.json`, `tikkurila.json` | One structured price-list lookup per supplier: `category → band → {size_in_litres: ex-VAT price}`. |
| `restore_inventory.py` | Restores truncated sizes and standardises naming across a Xero export, using the JSON lookups. Covers all 9 suppliers above. |
| `verify_pricelists.py` | Cross-checks the 8 Brewers-format lookups against a Xero export's non-truncated rows (items that already show an explicit size), to catch transcription errors in the JSON *before* trusting it for a restoration run. Tikkurila has its own equivalent check (see the Tikkurila section below) since its price list has a different table format. |
| `source_pdfs/` | The supplier price-list PDFs the JSON files were transcribed from. |
| `data/` | The CSVs and reports from the restoration runs (2026-07-09): input, output, verification report, flag list. |

## JSON lookup format

```json
{
  "supplier": "Dulux Trade",
  "source_file": "Dulux Trade - Coloured Terms - OR (5).pdf",
  "amended": "2026-03-01",
  "currency": "GBP",
  "vat": "excl",
  "products": {
    "Diamond Satinwood": {
      "Pure Brilliant White": { "5": 79.99, "2.5": 48.19, "1": 24.84 },
      "Colours": { "5": 109.44, "2.5": 63.88, "1": 31.98 }
    }
  }
}
```

- Keys under a band are **litre sizes**, not the price list's column headings.
  A few products are priced under a column that doesn't match their real pack
  size (e.g. Dulux's Ultra Grip Primer Base is priced under the "1LT" column
  but the actual pack is 0.8L) — always use the *actual* size as the key, and
  note the discrepancy in an `_irregular_sizes` block if you find one (see
  `dulux.json` for the pattern).
- Isomat also has an `_kg_products_leave_unchanged` block for its filler/primer
  lines sold in KG/G, which never get a litre size — see "What's deliberately
  left alone" below.
- Benjamin Moore's sizes are in **litres**, converted from the US units the
  price list actually uses (Gallon = 3.79L, Quart = 0.95L, Pint = 0.47L) —
  this was a deliberate choice made when this dataset was built, since BM's
  ItemNames were converted to the same `ltr` convention as everyone else. If
  Nicky ever wants BM back in US units, that's a `benjamin_moore.json` +
  `restore_inventory.py` (`US_TO_LITRE`, `US_UNIT_RE`) change, not just a data one.

### Tikkurila is a special case in one respect: price

Tikkurila's Xero buy prices are **already 5% higher than its own PDF price
list** — Nicky applied that rise separately at some point, so the verified
relationship for Tikkurila specifically is `PurchasesUnitPrice = PDF price ×
1.20 × 1.05`, not the plain `× 1.20` every other supplier uses. To keep
`restore_inventory.py`'s single `÷ 1.20` divisor working unchanged for every
supplier, `tikkurila.json` stores prices **already bumped by that 5%** — so
if you're updating it from a fresh Tikkurila PDF, multiply every new price by
1.05 before entering it (or apply the same % rise Nicky actually used, if it
changes). This is called out in the JSON's own `_note` field so it isn't lost.

Two other things specific to `tikkurila.json`:
- An `_unverified_sizing` block flags the Fillers/Solvents/Cleaners tail
  section (Presto range, Thinners, Colowood, etc.) — these don't size-match
  current Xero SKUs against the 2026-04-01 PDF at all (e.g. Xero has a
  "Presto LG 20ltr" that this PDF only prices at 10L), most likely because
  Tikkurila changed pack sizes between price-list versions. Left transcribed
  as printed (internally consistent) but not trustworthy for restoring a
  truncated item in that range without checking first.
- A handful of Xero SKUs (`TIK012`, `TIK123`, `TIK186` — all suffixed
  "(per litre)") price at a rate that doesn't match *any* size in the price
  list at all. These look like a bespoke small-quantity rate rather than a
  standard tin size and are simply not resolvable from this PDF — they'll
  always show up in the flag list if reprocessed, which is correct, not a bug.

## What's deliberately left alone

`restore_inventory.py` skips these rows entirely, untouched:

- **KG/G products** (Isomat fillers/primers, and anything else ending in a
  KG/G unit) — these don't take a litre size.
- **Sundries** — rollers, wallpaper paste/adhesive (matched by name keywords
  in `SUNDRY_RE`).
- Anything with an `*ItemCode` prefix not in the `SUPPLIERS` dict (other
  brands not covered by this tooling).

## How to use it

### 1. A supplier issues a new price list (no new products, just new prices)

1. Open the new PDF and update the ex-VAT prices in that supplier's JSON file
   — same category/band/size keys, just new numbers. Update `"amended"` to
   the new date.
2. Run the verifier against the most recent Xero export to make sure nothing
   was mistyped:
   ```
   python3 scripts/pricelists/verify_pricelists.py path/to/InventoryItems.csv
   ```
   This only checks non-truncated rows (ones that already show an explicit
   size in Xero) — it can't validate genuinely new prices Xero hasn't seen
   yet, but it will catch numbers you fat-fingered on lines that already
   match something in Xero.
3. If your Xero export still has any items with missing/truncated sizes,
   run `restore_inventory.py` (see step 3 below) so it picks up the new
   prices for those.

### 2. A supplier adds a new product line or pack size

1. Add the new `category`/`band`/`size` entries to that supplier's JSON,
   following the existing structure. Double-check the *actual* pack size
   against the PDF, not just the column it's printed under (see "Irregular
   sizes" above) — this is the single most common transcription mistake.
2. If you have any non-truncated Xero rows for the new product already (e.g.
   Nicky's added it manually with a full name), run `verify_pricelists.py`
   to confirm your entry matches.
3. Re-run `restore_inventory.py` if there are truncated rows that should now
   resolve against the new entry.

### 3. Restoring sizes / tidying names on a fresh Xero export

```
python3 scripts/pricelists/restore_inventory.py <input.csv> <output-dir>
```

Writes three files to `<output-dir>`:
- `InventoryItems-restored.csv` — same row count and column structure as the
  input, only `ItemName` changed on the rows that needed it.
- `verification_report.txt` — every changed row, old → new, with the
  price-match basis (or "naming tidy only" if the row already had a clean
  size and just got the unit/band-word standardisation).
- `flag_list.txt` — anything that couldn't be confidently resolved: no price
  match found (the product might not be in this price list at all — check
  you're not missing a supplier range), an ambiguous match, or a name that
  still exceeds 50 characters after every shortening rule has been tried.
  **Never guesses** — always review this list and fix flagged rows manually
  in Xero.

Always spot-check the verification report before importing into Xero, and
diff row counts / non-`ItemName` columns against the input to confirm nothing
else moved (prices, descriptions, tax rates, accounts should never change).

If Xero's import still rejects rows for exceeding 50 characters after this,
it's worth checking whether they're pre-existing rows the script correctly
left alone (e.g. anything with a prefix not in `SUPPLIERS`, or a KG/sundry
row) rather than a bug — that's exactly what happened with 7 old Tikkurila
rows in the 2026-07-09 run, from back when Tikkurila wasn't yet part of this
pipeline. They were fixed by hand at the time (see `data/verification_report.txt`
history / git log for that commit); Tikkurila now goes through
`restore_inventory.py` like everyone else, so a fresh export shouldn't
reproduce that particular problem.

### 4. A generic price rise (e.g. "Dulux is putting prices up 5%")

This is a different concern from the size/naming tools here — use the
sibling script:

```
python3 scripts/update_supplier_prices.py InventoryItems.csv DUL 5 -o InventoryItems_DUL_updated.csv
```

This raises `PurchasesUnitPrice` and `SalesUnitPrice` by the given percentage
for every row whose `*ItemCode` starts with the given prefix, rounds to 2dp,
and works across any supplier prefix, including `TIK`. It also carries its
own (Tikkurila-specific) `ItemName` tidy-up for a few known phrasing quirks,
which is a no-op on every other supplier's naming.

**Important — keep the JSON lookup in sync.** The verified `× 1.20` rule only
holds if the JSON price list and Xero's buy price move together. If the
percentage rise reflects the *supplier's actual list price* going up (the
normal case), apply the same percentage to every price **currently in that
supplier's JSON file** too (for Tikkurila, that means multiplying the
already-5%-bumped numbers by the new rise, not recomputing from the raw PDF —
see the Tikkurila section above), so `restore_inventory.py` keeps working
correctly for any future truncated items. If instead it's a pure margin
change (Nicky charging customers more without the supplier's cost changing),
only `SalesUnitPrice` should move — don't use this script for that; it moves
both prices by the
same percentage. In that case just adjust `SalesUnitPrice` directly, or ask
for the script to be extended with a sales-only flag if this comes up often.

### 5. Adding a brand-new supplier

1. Read the price-list PDF and transcribe it into a new
   `scripts/pricelists/<supplier>.json` following the format above.
2. Cross-check every entry you can against non-truncated Xero rows for that
   supplier (grep the export for the `*ItemCode` prefix) before trusting the
   transcription — column positions in these PDFs are *not* reliably
   consistent row-to-row (see the `_note` fields in `crown.json` and
   `isomat.json` for real examples this caught), so ground-truth verification
   against known-good Xero rows is essential, not optional.
3. Add the supplier to `SUPPLIERS` in `restore_inventory.py`:
   ```python
   "XXX": {"file": "supplier.json", "brand_prefix": "Xxx"},
   ```
   `brand_prefix` is whatever short prefix that supplier's Xero `ItemName`
   values actually use (e.g. `JT` for Johnstone's Trade, not "Johnstones").
4. Run `restore_inventory.py` and review the verification report and flag
   list as normal.

## Naming conventions `restore_inventory.py` enforces

- Sizes are written as `Nltr` (`5ltr`, `2.5ltr`, `0.75ltr`) — `LT`/`L`/`LTR`/
  `LITRE`/`ML` are all normalised to this.
- `Pure Brilliant White` (and its truncations) → `PBW`, but **only for
  Dulux** — other suppliers' "Brill White"/"Bri" genuinely mean "Brilliant
  White" with no "Pure" variant, verified against their price lists.
- Truncated band words are expanded to their full form (`Colo`/`Colou`/`Col`
  → `Colours`, `Bla`/`Blac` → `Black`, `Magn`/`Magnol` → `Magnolia`, `Whi` →
  `White`, `Brill`/`Bril` → `Brilliant White`).
- If the restored/tidied name would exceed 50 characters, `SHORTEN_RULES` in
  `restore_inventory.py` applies a prioritised list of abbreviations (least
  lossy first — e.g. `Weathershield` → `WS`, `Primer Undercoat` → `Primer`,
  `Quick Dry` → `QD`) one at a time until it fits, or flags the row if it
  still doesn't. These only ever fire on names that would otherwise overflow
  — a name that already fits keeps its full wording. All pack sizes of the
  same product/colour are shortened identically (grouped before shortening
  decisions are made), so you never get a 5ltr tin worded differently from
  its 1ltr sibling.
- `PurchasesDescription`/`SalesDescription` are never touched — only
  `ItemName` is shortened.
