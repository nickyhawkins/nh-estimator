#!/usr/bin/env python3
"""Check a supplier JSON lookup against its price-list PDF by column position.

The Brewers "Coloured Terms" PDFs lay two product tables side by side under
one row of size headings (10LT / 5LT / 2.5LT / 1LT), and a product that isn't
sold in the biggest size simply leaves that column blank. Read as plain text,
the first price on such a row looks like it belongs to the first column, which
is how Dulux's Weathershield gloss lines ended up keyed 10/5/2.5 instead of
5/2.5/1 (and Xero's 1ltr tins got named 2.5ltr). Transcribing by eye goes
wrong the same way, so check by geometry instead: each price is assigned to
the heading its right edge lines up with, then every price in the JSON must
sit under the heading matching its size key (or its nominal column, for the
entries listed in `_irregular_sizes`), and every price in the PDF must be
used by the JSON.

    pip install pymupdf
    python3 scripts/pricelists/check_pdf_columns.py dulux.json

Exits 1 on any mismatch. Only prices are compared, not product names, so a
price shared by two rows in different columns is reported as ambiguous
rather than guessed at.

Only trusted on dulux.json (clean as of 2026-09-23). The other suppliers'
PDFs head their columns differently (ML packs, 15LT, 0.75LT under a "1LT"
heading, tables that don't line up with the page-top headings) and it
flags sizes there that were verified against Xero ground truth — see the
`_note` in crown.json — so its output for them is noise until it learns
each layout.
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent
HEAD_RE = re.compile(r'(\d+(?:\.\d+)?)LT')
PRICE_RE = re.compile(r'\d+\.\d\d')


def pdf_prices(path):
    """[(page, price, column_size)] for every price in the PDF."""
    out = []
    for pno, page in enumerate(pymupdf.open(path), 1):
        words = page.get_text('words')
        heads = [w for w in words if HEAD_RE.fullmatch(w[4])]
        if not heads:
            continue
        mid = page.rect.width / 2
        for w in words:
            if not PRICE_RE.fullmatch(w[4]):
                continue
            same_side = [h for h in heads if (h[0] < mid) == (w[0] < mid)] or heads
            h = min(same_side, key=lambda h: abs(h[2] - w[2]))  # right edges
            out.append((pno, float(w[4]), HEAD_RE.fullmatch(h[4]).group(1)))
    return out


def nominal_columns(lookup):
    """{(product, band): nominal column} from the `_irregular_sizes` notes."""
    cols = {}
    for key, note in lookup.get('_irregular_sizes', {}).items():
        m = re.search(r'nominal (\d+(?:\.\d+)?)LT', note)
        if m:
            product, _, band = key.rpartition('.')
            cols[(product, band)] = m.group(1)
    return cols


def main(json_name):
    lookup = json.loads((HERE / json_name).read_text())
    pdf = HERE / 'source_pdfs' / lookup['source_file']
    found = pdf_prices(pdf)
    by_price = {}
    for f in found:
        by_price.setdefault(f[1], []).append(f)
    nominal = nominal_columns(lookup)
    used, problems = set(), []
    for product, bands in lookup['products'].items():
        for band, sizes in bands.items():
            for size, price in sizes.items():
                want = nominal.get((product, band), size)
                hits = by_price.get(price, [])
                cols = sorted({h[2] for h in hits})
                used.update(hits)
                label = f'{product} / {band or "-"}: {size}L = {price:.2f}'
                if not hits:
                    problems.append(f'NOT IN PDF   {label}')
                elif want not in cols:
                    problems.append(f'WRONG COLUMN {label} — PDF has it under {"/".join(c + "LT" for c in cols)}')
                elif len(cols) > 1:
                    problems.append(f'AMBIGUOUS    {label} — price appears under {"/".join(c + "LT" for c in cols)}')
    for pno, price, col in found:
        if (pno, price, col) not in used:
            problems.append(f'UNUSED       p{pno} {price:.2f} under {col}LT is not in the JSON')
    for p in problems:
        print(p)
    print(f'{json_name}: {len(found)} PDF prices, {len(problems)} problem(s)')
    return 1 if problems else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
