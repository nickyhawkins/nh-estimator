#!/usr/bin/env python3
"""
Cross-checks every non-truncated (already-fully-sized) CSV row against the
supplier price-list JSON lookups in this directory, using the verified rule:
    PurchasesUnitPrice / 1.20 == price-list ex-VAT price for that size.

This catches transcription/column-assignment errors in the lookups *before*
they're used to restore truncated items. It does NOT modify anything.

Usage: python3 verify_pricelists.py <path-to-csv>
"""
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

SUPPLIER_FILES = {
    "DUL": "dulux.json",
    "JOH": "johnstones.json",
    "CRO": "crown.json",
    "ZIN": "zinsser.json",
    "ISO": "isomat.json",
    "LG": "little_greene.json",
    "FAR": "farrow_ball.json",
    "BM": "benjamin_moore.json",
}

# recognise a trailing, non-truncated size token
SIZE_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(LT|LTR|LITRE|L|ML|KG|G)\b\.?\s*$", re.IGNORECASE
)


def size_to_litres(value, unit):
    v = float(value)
    unit = unit.upper()
    if unit in ("LT", "LTR", "LITRE", "L"):
        return v
    if unit == "ML":
        return v / 1000.0
    return None  # KG/G not comparable to litre-keyed lookups


def flatten(lookup_products):
    """Yield (category, band, size_str, price) for every leaf entry, including the _kg_products_leave_unchanged block if present."""
    out = []
    for category, bands in lookup_products.items():
        if not isinstance(bands, dict):
            continue
        for band, sizes in bands.items():
            if not isinstance(sizes, dict):
                continue
            for size_str, price in sizes.items():
                out.append((category, band, size_str, price))
    return out


def main():
    if len(sys.argv) != 2:
        print("usage: verify_pricelists.py <csv-path>")
        sys.exit(1)

    csv_path = Path(sys.argv[1])
    lookups = {}
    flat = {}
    for prefix, fname in SUPPLIER_FILES.items():
        data = json.loads((HERE / fname).read_text())
        lookups[prefix] = data
        entries = flatten(data.get("products", {}))
        # also fold in kg-products-leave-unchanged for isomat (harmless elsewhere)
        kg_block = data.get("_kg_products_leave_unchanged")
        if kg_block:
            for category, bands in kg_block.items():
                if category == "_note" or not isinstance(bands, dict):
                    continue
                for band, sizes in bands.items():
                    if not isinstance(sizes, dict):
                        continue
                    for size_str, price in sizes.items():
                        entries.append((category, band, size_str, price))
        flat[prefix] = entries

    total_checked = 0
    ok = 0
    mismatches = []
    no_match = []

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row["*ItemCode"]
            name = row["ItemName"]
            prefix = re.match(r"[A-Z]+", code).group(0)
            if prefix not in SUPPLIER_FILES:
                continue
            m = SIZE_RE.search(name)
            if not m:
                continue
            litres = size_to_litres(m.group(1), m.group(2))
            if litres is None:
                continue  # KG/G item, not comparable
            try:
                buy_price = float(row["PurchasesUnitPrice"])
            except (KeyError, ValueError):
                continue
            if buy_price <= 0:
                continue
            expected = round(buy_price / 1.20, 2)

            total_checked += 1

            # does *any* entry in this supplier's flattened list have this size
            # (within 1% to tolerate 0.75 vs 0.750 float drift) and this price
            # (within 2p)?
            found_size_and_price = False
            found_size_diff_price = []
            for category, band, size_str, price in flat[prefix]:
                try:
                    size_val = float(size_str)
                except ValueError:
                    continue
                if abs(size_val - litres) < 0.005:
                    if abs(price - expected) < 0.02:
                        found_size_and_price = True
                        break
                    else:
                        found_size_diff_price.append((category, band, size_str, price))

            if found_size_and_price:
                ok += 1
            else:
                if found_size_diff_price:
                    mismatches.append(
                        (code, name, buy_price, expected, litres, found_size_diff_price)
                    )
                else:
                    no_match.append((code, name, buy_price, expected, litres))

    print(f"Checked {total_checked} non-truncated rows across 8 suppliers.")
    print(f"  OK (size+price matched somewhere in lookup): {ok}")
    print(f"  MISMATCH (size found but price differs):      {len(mismatches)}")
    print(f"  NO MATCH (size not found at that price at all): {len(no_match)}")

    if mismatches:
        print("\n=== MISMATCHES (likely column-assignment errors in the lookup) ===")
        for code, name, buy, expected, litres, alts in mismatches:
            print(f"  {code}  {name}")
            print(f"    buy={buy}  expected_list_price={expected}  size={litres}LT")
            for category, band, size_str, price in alts[:5]:
                print(f"    -> lookup has {category} / {band} @ {size_str}LT = {price}")

    if no_match:
        print("\n=== NO MATCH AT ALL (size/price pair absent from lookup) ===")
        for code, name, buy, expected, litres in no_match[:60]:
            print(f"  {code}  {name}  buy={buy}  expected={expected}  size={litres}LT")
        if len(no_match) > 60:
            print(f"  ... and {len(no_match) - 60} more")


if __name__ == "__main__":
    main()
