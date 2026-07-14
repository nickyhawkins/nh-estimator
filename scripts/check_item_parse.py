"""Which Xero items survive groupMaterialItems()?

Faithful port of the parser in routes/xero.js, run over a Xero inventory CSV
export (Xero > Products & Services > Export). Answers the Phase 0 question in
MATERIAL_TRACKING_SPEC.md: paste, lining paper and kilo-sold fillers have no
parseable size, so they are silently discarded and the picker cannot offer them.

Usage: python3 scripts/check_item_parse.py <InventoryItems.csv>

Keep the regexes and parse_item_name() in sync with routes/xero.js by hand --
the CHECKS below fail loudly if this port drifts from the JS.
"""
import csv, re, sys

# /(\d+(?:\.\d+)?)\s*l(?:tr?)?\b/i
TIN_SIZE_RE = re.compile(r'(\d+(?:\.\d+)?)\s*l(?:tr?)?\b', re.I)
# /(\d+(?:\.\d+)?)\s*ml\b/i
TIN_SIZE_ML_RE = re.compile(r'(\d+(?:\.\d+)?)\s*ml\b', re.I)
PER_LITRE_RE = re.compile(r'\(\s*per\s+litre\s*\)', re.I)


def parse_size(name):
    m = TIN_SIZE_RE.search(name)
    if m:
        return {'sizeL': float(m.group(1)), 'start': m.start(), 'end': m.end()}
    m = TIN_SIZE_ML_RE.search(name)
    if m:
        return {'sizeL': float(m.group(1)) / 1000, 'start': m.start(), 'end': m.end()}
    return None


def parse_item_name(name):
    size = parse_size(name)
    is_per_litre = bool(PER_LITRE_RE.search(name))
    if not size:
        return {'range': name, 'band': None, 'sizeL': None, 'isPerLitre': is_per_litre}
    prefix = name[:size['start']].strip()
    if prefix.endswith('-'):
        return {'range': prefix[:-1].strip(), 'band': '', 'sizeL': size['sizeL'], 'isPerLitre': is_per_litre}
    sep = prefix.rfind(' - ')
    if sep == -1:
        return {'range': prefix, 'band': '', 'sizeL': size['sizeL'], 'isPerLitre': is_per_litre}
    return {'range': prefix[:sep], 'band': prefix[sep + 3:].strip(), 'sizeL': size['sizeL'], 'isPerLitre': is_per_litre}


# Sanity checks against names whose expected parse is stated in MATERIALS_SPEC /
# the code comments — if these fail, the port is wrong and nothing below counts.
CHECKS = [
    ('Tikkurila Optiva Matt 5 - Pastels 10ltr', 10.0),
    ('Johnstone\'s Professional Gloss - Brilliant White 2.5L', 2.5),
    ('Tikkurila Anti Reflex 2 - White 1ltr (per litre)', 1.0),
    ('Some Product 750ml', 0.75),
    ('No Size Here', None),
    # Isomat's legacy "LT" unit -- the \b can't fire between L and T, so these
    # parsed as size-less until TIN_SIZE_RE made the "t" independently optional.
    ('Isomat Flexcoat Masonry - Colours 3LT', 3.0),
    ('Isomat Silicone Paint - White 10LT', 10.0),
    # ...but "Litre" spelt out is still not a size, and "ml" still wins as ml.
    ('Dulux 5 Litre Tin', None),
    ('Everbuild Stixall Adhesive (White) - 290ml', 0.29),
]
for name, expected in CHECKS:
    got = parse_item_name(name)['sizeL']
    assert got == expected, f'PORT CHECK FAILED: {name!r} -> {got}, expected {expected}'
print('port sanity checks: all passed\n')

if len(sys.argv) < 2:
    sys.exit(__doc__)
rows = list(csv.DictReader(open(sys.argv[1])))
key = lambda r, k: r.get(k) or r.get('*' + k) or ''

items = [{
    'Name': key(r, 'ItemName'),
    'Code': key(r, 'ItemCode'),
    'Status': r.get('Status', ''),
    'sales': r.get('SalesAccount', ''),
    'purch': r.get('PurchasesAccount', ''),
} for r in rows]

# Mirrors /material-groups: allItems.filter(i => i.SalesDetails?.AccountCode === '202')
sales202 = [i for i in items if i['sales'] == '202']
sun314 = [i for i in sales202 if i['purch'] == '314']

print(f"total items: {len(items)} | sales account 202: {len(sales202)}")
# NB 314 is NOT "the specific sundries" -- it's the generic-sundries supplier
# families (SUN + RPC). Paste is split 311/314 and Wallrock Fibreliner is 311.
# See "Identifying specific sundries" in MATERIAL_TRACKING_SPEC.md.
print(f"of those, purchase account 314: {len(sun314)}")

print('\n=== EVERY 314 ITEM THROUGH parseItemName() ===')
kept = dropped = 0
for i in sorted(sun314, key=lambda x: x['Code']):
    p = parse_item_name(i['Name'])
    if p['sizeL'] is None:
        dropped += 1
        print(f"  DROPPED  {i['Code']:<7} {i['Name']}")
    else:
        kept += 1
        print(f"  kept     {i['Code']:<7} {i['Name']!r:<50} sizeL={p['sizeL']:<6} range={p['range']!r}")
print(f"\n314 summary: {kept} kept, {dropped} DROPPED (invisible to the picker)")

print('\n=== PASTE / ADHESIVE / LINING (any account) ===')
for i in items:
    if re.search(r'paste|adhesive|lining', i['Name'], re.I):
        p = parse_item_name(i['Name'])
        v = 'DROPPED' if p['sizeL'] is None else 'kept   '
        print(f"  {v} {i['Code']:<7} sales={i['sales']:<4} purch={i['purch']:<4} {i['Name']!r} -> sizeL={p['sizeL']}")

print('\nitems matching /lining/i anywhere in the export:',
      len([i for i in items if re.search(r'lining', i['Name'], re.I)]))
