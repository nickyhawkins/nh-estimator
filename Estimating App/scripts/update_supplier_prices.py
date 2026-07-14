#!/usr/bin/env python3
"""
Apply a percentage price rise to one supplier's rows in a Xero
"InventoryItems" export CSV, and produce a new CSV ready for Xero import.

Usage:
    python3 scripts/update_supplier_prices.py INPUT.csv PREFIX PERCENT [-o OUTPUT.csv]

Example:
    python3 scripts/update_supplier_prices.py InventoryItems.csv TIK 5.5 -o InventoryItems_TIK_updated.csv

For rows whose ItemCode starts with PREFIX (case-insensitive):
  - PurchasesUnitPrice and SalesUnitPrice are raised by PERCENT and rounded to 2dp.
  - ItemCode, tax rates, account codes and the description fields are left untouched
    (descriptions keep the full, un-shortened product name on purpose).
  - ItemName is shortened using the Tikkurila-catalog conventions in shorten_item_name()
    below. These rules only match specific known phrasing (sheen words immediately
    before a trailing number, the Otex primer variants, doubled words) so they're a
    no-op on other suppliers' naming and safe to leave switched on for any prefix.

All other rows pass through unchanged.
"""
import argparse
import csv
import re
import sys
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

# Sheen/finish words that Tikkurila repeats in front of the sheen-level number
# that already appears in every one of these product lines (e.g. "Optiva Matt 5",
# "Optiva Ceramic S Matt 3", "Helmi Satin (30)"). The number is what actually
# distinguishes the products, so once the sheen word only *precedes* a trailing
# number, it's redundant and gets dropped -- but only in that exact position, so
# names with no trailing number (e.g. "Ultra Matt", "Unica Semi-Gloss Enamel")
# are left alone.
_SHEEN_RE = re.compile(
    r'\s+(?:Ceramic\s+S(?:uper)?\s+Matt|Semi[\s-]+Matt|Semi[\s-]+Gloss|Matt|Satin|Gloss)'
    r'\s*(\(?\d+(?:\.\d+)?\)?)$'
)

# Otex primer naming is inconsistent in the source data ("Adh Primer" on the Akva
# variant, "Adhesion Primer" on the plain one) -- collapse both spellings.
_OTEX_RULES = [
    (re.compile(r'\bOtex\s+Akva\s+(?:Adh|Adhesion)\s+Primer\b'), 'Otex Akva'),
    (re.compile(r'\bOtex\s+Adhesion\s+Primer\b'), 'Otex'),
]

# Trailing size unit, e.g. "10L" or "1L (per litre)" -> "10ltr" / "1ltr (per litre)".
# Anchored to end-of-string so it can only ever match the size segment, never a
# product code that happens to contain digits next to a letter (e.g. "Temalac ML90").
_SIZE_RE = re.compile(r'(\d+(?:\.\d+)?)\s*L(\s*\(per litre\))?$', re.IGNORECASE)


def _collapse_doubled_words(s):
    words = s.split(' ')
    out = []
    for w in words:
        if out and out[-1] == w:
            continue
        out.append(w)
    return ' '.join(out)


def shorten_item_name(name):
    """Shorten a Tikkurila ItemName; a no-op for names that don't match any rule."""
    if ' - ' in name:
        left, right = name.rsplit(' - ', 1)
    else:
        left, right = name, None

    left = _collapse_doubled_words(left)
    for pattern, replacement in _OTEX_RULES:
        left = pattern.sub(replacement, left)

    m = _SHEEN_RE.search(left)
    if m:
        num = m.group(1).strip('()')
        left = left[:m.start()] + ' ' + num

    if right is not None:
        m = _SIZE_RE.search(right)
        if m:
            num, per_litre = m.group(1), (m.group(2) or '')
            right = right[:m.start()] + num + 'ltr' + per_litre
        return f'{left} - {right}'
    return left


def apply_rise(price_str, percent):
    """Raise a price string by percent, rounded to 2dp. Blank prices pass through."""
    if price_str is None or not price_str.strip():
        return price_str
    try:
        price = Decimal(price_str)
    except InvalidOperation:
        return price_str
    factor = Decimal('1') + Decimal(str(percent)) / Decimal('100')
    new_price = (price * factor).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return str(new_price)


def process(input_path, prefix, percent, output_path):
    with open(input_path, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    code_field = '*ItemCode' if '*ItemCode' in fieldnames else 'ItemCode'
    prefix_upper = prefix.upper()

    matched = 0
    name_changed = 0
    samples = []
    for row in rows:
        code = row.get(code_field, '') or ''
        if not code.upper().startswith(prefix_upper):
            continue
        matched += 1

        old_name = row['ItemName']
        new_name = shorten_item_name(old_name)
        if new_name != old_name:
            name_changed += 1
            if len(samples) < 10:
                samples.append((old_name, new_name))
        row['ItemName'] = new_name

        row['PurchasesUnitPrice'] = apply_rise(row.get('PurchasesUnitPrice'), percent)
        row['SalesUnitPrice'] = apply_rise(row.get('SalesUnitPrice'), percent)

    with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f'{matched} row(s) matched prefix "{prefix}" out of {len(rows)} total.')
    print(f'{name_changed} ItemName value(s) shortened.')
    if samples:
        print('\nSample ItemName changes:')
        for old, new in samples:
            print(f'  {old!r} -> {new!r}')
    print(f'\nWrote {output_path}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('input_csv', help='Path to the Xero InventoryItems export CSV')
    parser.add_argument('prefix', help='ItemCode prefix identifying the supplier, e.g. TIK')
    parser.add_argument('percent', type=float, help='Percentage price rise to apply, e.g. 5.5')
    parser.add_argument('-o', '--output', help='Output CSV path (default: <input>_updated.csv)')
    args = parser.parse_args()

    output_path = args.output
    if not output_path:
        if args.input_csv.lower().endswith('.csv'):
            output_path = args.input_csv[:-4] + '_updated.csv'
        else:
            output_path = args.input_csv + '_updated.csv'

    process(args.input_csv, args.prefix, args.percent, output_path)


if __name__ == '__main__':
    sys.exit(main())
