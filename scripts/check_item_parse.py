"""Health check: how does Xero's item list bucket, and has it drifted?

Faithful port of the bucketing in routes/xero.js (groupMaterialItems), run over
a Xero inventory CSV export (Xero > Products & Services > Export). Splits the
items three ways, exactly as the app does:

    sundry       -- item code starts SUN. Flat: item + qty + price, no size.
    paint        -- anything else whose name yields a tin size.
    unmodellable -- anything else. Surfaced here; offered in no picker.

Usage: python3 scripts/check_item_parse.py <InventoryItems.csv>
Exits non-zero if the unmodellable bucket has drifted from BASELINE below.

THE POINT OF THIS SCRIPT IS THE UNMODELLABLE BUCKET, and the check is "has this
list changed?", NOT "is it empty?". It will never be empty and expecting that
defeats it: 11 of its residents are legitimate products the app cannot model --
Isomat fillers, primers and renders sold by the KILO, correctly named, with no
litre size to parse because they don't have one. An empty-bucket expectation is
one that's never met, so it gets ignored, and the next LT-class bug then hides
among eleven expected entries -- the exact failure this bucket exists to catch.

What that class of bug looks like, and why it's worth a script: TIN_SIZE_RE was
once l(?:tr)?\\b, which matched "3L" and "3ltr" but not Isomat's "3LT" -- the \\b
can't fire between the L and the T. Eight real paint tins parsed as size-less
and were silently discarded, so FOUR PAINT RANGES were missing from the app,
including the exterior masonry the exterior engine needs. Nothing looked wrong
anywhere in the UI. It was obvious the instant a parse report listed the bucket.

Keep the regexes and the bucketing in sync with routes/xero.js by hand -- the
CHECKS below fail loudly if this port drifts from the JS.
"""
import csv, re, sys

# /(\d+(?:\.\d+)?)\s*l(?:tr?)?\b/i -- the "t" is optional independently of the
# "r" so Isomat's legacy "10LT" parses. See the LT note in the docstring.
TIN_SIZE_RE = re.compile(r'(\d+(?:\.\d+)?)\s*l(?:tr?)?\b', re.I)
# /(\d+(?:\.\d+)?)\s*ml\b/i
TIN_SIZE_ML_RE = re.compile(r'(\d+(?:\.\d+)?)\s*ml\b', re.I)
PER_LITRE_RE = re.compile(r'\(\s*per\s+litre\s*\)', re.I)
# /^SUN/i -- a sundry is DECLARED by its code, never derived from its name.
SUNDRY_CODE_RE = re.compile(r'^SUN', re.I)

# The unmodellable bucket's known, expected residents, verified against
# InventoryItems-20260714.csv (post-cleanup). All 11 are Isomat products sold
# by the kilo -- correctly named, genuinely unmodellable, permanent.
#
# An item ARRIVING here is the signal worth acting on: it usually means the
# parser stopped understanding a real paint name. An item LEAVING is normally
# fine (fixed or deleted in Xero) -- just update this list.
BASELINE = {
    'ISO065': 'Isomat Flex Primer - All 10KG',
    'ISO066': 'Isomat Flex Primer - All 5KG',
    'ISO067': 'Isomat Flex Primer - All 1KG',
    'ISO068': 'Isomat Silicone Primer - All 5KG',
    'ISO069': 'Isomat Acryl Stucco - All 800G',
    'ISO070': 'Isomat Stuccocret - All 4KG',
    'ISO071': 'Isomat GB-Cover - All 20KG',
    'ISO072': 'Isomat GB-Cover - All 7KG',
    'ISO073': 'Isomat Durocret-Plus FR Filler - All',
    'ISO074': 'Isomat Flex-Cover 2 Pack Filler - All 2.6K',
    'ISO075': 'Isomat Planfix-Fine White Powder Filler - All 5KG',
}


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


def bucket(items):
    """Mirrors groupMaterialItems(). Code prefix FIRST, size parse second."""
    sundries, paint, unmodellable = [], [], []
    for i in items:
        if SUNDRY_CODE_RE.match(i['Code'] or ''):
            sundries.append(i)
            continue
        p = parse_item_name(i['Name'])
        (paint if p['sizeL'] is not None else unmodellable).append(i)
    return sundries, paint, unmodellable


# Sanity checks against names whose expected parse is stated in MATERIALS_SPEC /
# the code comments -- if these fail, the port is wrong and nothing below counts.
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

# Bucket-order checks. The code prefix MUST be tested before the size parse:
# these two tube adhesives parse as 0.28-0.38L "tins" and used to invent the
# range "Quickgrip Adhesive (" -- which put "Quickgrip Adhesive ( 0.38ltr" on
# client-facing quotes. Bucketing on the code first means they never reach the
# parser. BED002 is the control: a genuine sub-litre tin, not SUN, stays paint.
BUCKET_CHECKS = [
    ('SUN013', 'Quickgrip Adhesive (380ml tube)', 'sundry'),
    ('SUN014', 'Everbuild Stixall Adhesive (White) - 290ml', 'sundry'),
    ('SUN019', 'Wallrock Fibreliner 50 Single', 'sundry'),
    ('BED002', 'Bedec MSP (Gloss, Matt, Satin) - 750ml', 'paint'),
    ('TIK051', 'Tikkurila Optiva 3 - Magnolia 10ltr', 'paint'),
    ('ISO065', 'Isomat Flex Primer - All 10KG', 'unmodellable'),
]
for code, name, expected in BUCKET_CHECKS:
    s, p, u = bucket([{'Code': code, 'Name': name}])
    got = 'sundry' if s else ('paint' if p else 'unmodellable')
    assert got == expected, f'BUCKET CHECK FAILED: {code} {name!r} -> {got}, expected {expected}'
print('port sanity checks: all passed')
print('bucket order checks: all passed\n')

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
sundries, paint, unmodellable = bucket(sales202)

print(f"total items: {len(items)} | sales account 202: {len(sales202)}")
print(f"buckets: {len(sundries)} sundry / {len(paint)} paint / {len(unmodellable)} unmodellable")

print('\n=== SUNDRY BUCKET (flat: item + qty + price) ===')
# NB account 314 is NOT the sundry flag -- the code prefix is. They drift: the
# SUN016-SUN018 pastes sold on 311 at one point. 314 has its own P&L job.
# See "Identifying specific sundries" in MATERIAL_TRACKING_SPEC.md.
for i in sorted(sundries, key=lambda x: x['Code']):
    print(f"  {i['Code']:<8} purch={i['purch']:<4} {i['Name']}")
off314 = [i for i in sundries if i['purch'] != '314']
if off314:
    print(f"  note: {len(off314)} sundry item(s) not on purchase account 314 "
          f"({', '.join(i['Code'] for i in off314)}) -- fine, the code is the flag, "
          f"but Phase 3 reads the purchase price off whichever account the item carries.")

print('\n=== UNMODELLABLE BUCKET vs BASELINE ===')
found = {i['Code']: i['Name'] for i in unmodellable}
arrived = sorted(set(found) - set(BASELINE))
left = sorted(set(BASELINE) - set(found))
renamed = sorted(c for c in set(found) & set(BASELINE) if found[c] != BASELINE[c])

for code in sorted(found):
    mark = 'NEW ' if code in arrived else '    '
    print(f"  {mark}{code:<8} {found[code]}")

status = 0
if arrived:
    print(f"\n  !! {len(arrived)} ITEM(S) ARRIVED IN THE UNMODELLABLE BUCKET:")
    for c in arrived:
        print(f"       {c:<8} {found[c]!r}")
    print("     If any of these is real paint, the parser has a gap and those")
    print("     ranges are now MISSING FROM THE APP -- silently. Check the size")
    print("     suffix against TIN_SIZE_RE before assuming it's just a new tool.")
    print("     If they're genuinely unmodellable, add them to BASELINE.")
    status = 1
if left:
    print(f"\n  -- {len(left)} baseline item(s) no longer present (fixed or deleted in Xero):")
    for c in left:
        print(f"       {c:<8} {BASELINE[c]!r}")
    print("     Expected drift -- update BASELINE to match.")
    status = 1
if renamed:
    print(f"\n  -- {len(renamed)} baseline item(s) renamed:")
    for c in renamed:
        print(f"       {c:<8} {BASELINE[c]!r} -> {found[c]!r}")
    status = 1
if not (arrived or left or renamed):
    print(f"\n  OK: unmodellable bucket matches the {len(BASELINE)}-item baseline exactly.")

print('\n=== PASTE / ADHESIVE / LINING (any account) ===')
# Lining paper is called "Wallrock Fibreliner" -- nothing in Xero contains the
# word "lining". Grep for the product, not the category.
#
# \bpaste\b, not paste: unanchored, "paste" matches inside "PASTELS" and drags
# in 60+ Tikkurila colour-band tins, burying the eight items this section is
# actually about.
for i in items:
    if re.search(r'\bpaste\b|\badhesive\b|\blining\b|\bfibreliner\b', i['Name'], re.I):
        s, p, u = bucket([i])
        b = 'sundry ' if s else ('paint  ' if p else 'UNMODEL')
        print(f"  {b} {i['Code']:<8} sales={i['sales']:<4} purch={i['purch']:<4} {i['Name']!r}")

sys.exit(status)
