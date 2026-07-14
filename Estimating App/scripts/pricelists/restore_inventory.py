#!/usr/bin/env python3
"""
Inventory CSV Restoration & Tidy — per INVENTORY_RESTORE_SPEC.md

Restores tin sizes lost to Xero's 50-char ItemName truncation, by matching
PurchasesUnitPrice / 1.20 against the supplier price-list lookups in this
directory (the verified relationship: buy price = ex-VAT list price x 1.20).
Also standardises band-word naming (same conventions as the earlier
Tikkurila tidy) across all in-scope suppliers.

Leaves untouched: Tikkurila (TIK*), KG/G products, US-unit sundries not
covered here, and non-paint sundries (rollers, wallpaper paste/adhesive).
Never changes prices. Only ItemName is shortened/tidied; descriptions
keep their full text.

Usage:
    python3 restore_inventory.py <input-csv> <output-dir>

Writes to <output-dir>:
    InventoryItems-restored.csv   - full Xero-ready CSV, same row count/order
    verification_report.txt      - every changed row: old -> new + basis
    flag_list.txt                - anything not confidently restored
"""
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent

SUPPLIERS = {
    "DUL": {"file": "dulux.json", "brand_prefix": "Dulux"},
    "JOH": {"file": "johnstones.json", "brand_prefix": "JT"},
    "CRO": {"file": "crown.json", "brand_prefix": "Crown"},
    "ZIN": {"file": "zinsser.json", "brand_prefix": "Zinsser"},
    "ISO": {"file": "isomat.json", "brand_prefix": "Isomat"},
    "LG": {"file": "little_greene.json", "brand_prefix": "LG"},
    "FAR": {"file": "farrow_ball.json", "brand_prefix": "F&B"},
    "BM": {"file": "benjamin_moore.json", "brand_prefix": "BM"},
    "TIK": {"file": "tikkurila.json", "brand_prefix": "Tikkurila"},
}

SIZE_RE = re.compile(r"^(.*?)[\s]*(\d+(?:\.\d+)?)\s*(LT|LTR|LITRE|L|ML)\.?\s*$", re.IGNORECASE)
US_UNIT_RE = re.compile(r"^(.*?)\b(Gallon|Quart|Pint)s?\.?\s*$", re.IGNORECASE)
KG_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(KG|G)\.?\s*$", re.IGNORECASE)
TRAILING_NUM_RE = re.compile(r"\s*\d+(?:\.\d*)?\.?\s*$")
SUNDRY_RE = re.compile(
    r"\b(Roller Frame|Roller Sleeve|Wallpaper Paste|Wallpaper Adhesive)\b", re.IGNORECASE
)

US_TO_LITRE = {"gallon": 3.79, "quart": 0.95, "pint": 0.47}

# Band-word tidy: whole-word, case-sensitive-ish replacements applied to the
# band segment of ALREADY-complete (non-truncated) names, per spec step 3.
BAND_WORD_RULES = [
    (re.compile(r"\bColou\b"), "Colours"),
    (re.compile(r"\bColo\b"), "Colours"),
    (re.compile(r"\bCol\b"), "Colours"),
    (re.compile(r"\bBlac\b"), "Black"),
    (re.compile(r"\bBla\b"), "Black"),
    (re.compile(r"\bMagnol\b"), "Magnolia"),
    (re.compile(r"\bMagn\b"), "Magnolia"),
    (re.compile(r"\bWhi\b"), "White"),
    (re.compile(r"\bPastel\b"), "Pastels"),
]
# Brill/Bril + White -> Brilliant White (as a unit, avoids "Brilliant White White")
BRILL_WHITE_RE = re.compile(r"\bBrill?\s+White\b")
# standalone Brill/Bril (not immediately followed by White) -> Brilliant White
BRILL_RE = re.compile(r"\bBrill?\b(?!\s+White\b)")

ABBREVIATIONS = [
    (re.compile(r"\bPU\b"), "Primer Undercoat"),
    (re.compile(r"\bU/C\b"), "Undercoat"),
    (re.compile(r"\bWB\b"), "Water Based"),
    (re.compile(r"\bQD\b"), "Quick Dry"),
    (re.compile(r"\bSB\b"), "Solvent Based"),
    (re.compile(r"\bHB\b"), "High Build"),
    (re.compile(r"\bZP\b"), "Zinc Phosphate"),
    (re.compile(r"\bSol\b"), "Solvent"),
    (re.compile(r"\bSil\b"), "Silicate"),
    (re.compile(r"\bHH\b"), "High-Hiding"),
    (re.compile(r"\bSX\b"), "Scuff-X"),
    (re.compile(r"\bExt\b"), "Exterior"),
    (re.compile(r"\bInt\b"), "Interior"),
    (re.compile(r"\bDur\b"), "Durable"),
    (re.compile(r"\bG&S\b"), "Gloss & Satin"),
    (re.compile(r"\bGen\b"), "Generation"),
    (re.compile(r"\bPS\b"), "Primer Sealer"),
]


def expand_abbreviations(text):
    t = text
    for pat, repl in ABBREVIATIONS:
        t = pat.sub(repl, t)
    return t

# Patterns meaning "Pure Brilliant White" for ANY supplier (the phrase is unambiguous)
PBW_PATTERNS_UNIVERSAL = [
    re.compile(r"^Pure Brilliant White$", re.IGNORECASE),
    re.compile(r"^Pure Brilliant Whi\w*$", re.IGNORECASE),
    re.compile(r"^-?\s*Pure$", re.IGNORECASE),
]
# Patterns that ONLY mean "Pure Brilliant White" for Dulux (whose full band name IS
# "Pure Brilliant White") - for every other supplier in this dataset, "Brill White"/
# "Bri" is genuinely just short for "Brilliant White" (no Pure variant exists), verified
# against each supplier's price list.
PBW_PATTERNS_DULUX_ONLY = [
    re.compile(r"^Brill?\s+White$", re.IGNORECASE),
    re.compile(r"^Bri$", re.IGNORECASE),
]


def is_pbw_text(text, prefix):
    t = text.strip()
    patterns = PBW_PATTERNS_UNIVERSAL + (PBW_PATTERNS_DULUX_ONLY if prefix == "DUL" else [])
    for pat in patterns:
        if pat.match(t):
            return True
    return False


def alnum(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def load_lookups():
    lookups = {}
    flat = {}
    for prefix, cfg in SUPPLIERS.items():
        data = json.loads((HERE / cfg["file"]).read_text())
        lookups[prefix] = data
        entries = []
        for category, bands in data.get("products", {}).items():
            for band, sizes in bands.items():
                if band == "_note" or not isinstance(sizes, dict):
                    continue
                for size_str, price in sizes.items():
                    entries.append((category, band, size_str, price))
        flat[prefix] = entries
    return lookups, flat


def fmt_size(size_val):
    if size_val == int(size_val):
        return str(int(size_val))
    s = f"{size_val:.2f}".rstrip("0").rstrip(".")
    return s


# Applied ONLY when a restored/tidied name still exceeds 50 chars, in this
# order, one substitution at a time, re-checking length after each — so a
# name only loses as much information as it actually needs to in order to
# fit. Never applied to names that already fit.
SHORTEN_RULES = [
    (re.compile(r"\bWeathershield\b"), "WS"),
    (re.compile(r"\bPrimer Undercoat\b"), "Primer"),
    (re.compile(r"\bQuick Dry\b"), "QD"),
    (re.compile(r"\bPolyurethane\b"), "PU"),
    (re.compile(r"\s*\(Undercoat Only\)"), ""),
    (re.compile(r"\bUndercoat\b"), "UC"),
    (re.compile(r"\bExterior\b"), "Ext"),
    (re.compile(r"\bAll Seasons\b"), "AS"),
    (re.compile(r"\s*\bFungicidal\b"), ""),
    (re.compile(r"\s*\bDurable\b"), ""),
    (re.compile(r"\s*\bTextured\b"), ""),
    (re.compile(r"\s*\bContract\b"), ""),
    (re.compile(r"\bBrilliant White & Magnolia\b"), "White & Magnolia"),
    (re.compile(r"\bColours\s*-?\s*Ready Mixed\b"), "Ready Mixed"),
    (re.compile(r"\bColours\s*-?\s*Tinted\b"), "Tinted"),
    (re.compile(r"\bAll Colours\b"), "Colours"),
    (re.compile(r"\bHigh Performance\b"), "High Perf"),
    (re.compile(r"\bLight & Space\b"), "L&S"),
    (re.compile(r"\s*\(Satin Only\)"), ""),
    (re.compile(r"& Cleaner\b"), ""),
    (re.compile(r"\bBlack & Charcoal\b"), "Black/Charcoal"),
    (re.compile(r"\bBlack/Charcoal\b"), "Black"),
    (re.compile(r"\s*\bAcrylic\b"), ""),
    (re.compile(r"\bDiamond Glaze Varnish Gloss & Satin\b"), "Diamond Glaze"),
    (re.compile(r"\bClear/\s+Colours\b"), "Clear/Colours"),
    (re.compile(r"\bLacquer\b"), "Laq"),
    (re.compile(r"\bMetal Primer\b"), "Primer"),
    (re.compile(r"\s*\b\d+/\d+/\d+\b"), ""),
]


def shrink_to_fit(name, limit=50):
    """Apply SHORTEN_RULES one at a time until name fits, or rules run out."""
    if len(name) <= limit:
        return name, []
    applied = []
    current = name
    for pat, repl in SHORTEN_RULES:
        new_current = pat.sub(repl, current, count=1)
        new_current = re.sub(r"\s{2,}", " ", new_current).strip()
        if new_current != current:
            current = new_current
            applied.append(pat.pattern)
            if len(current) <= limit:
                break
    return current, applied


def tidy_band_text(text, prefix):
    """Apply band-word expansion + PBW rule to an ALREADY-COMPLETE band string."""
    t = text.strip()
    if not t:
        return t
    if is_pbw_text(t, prefix):
        return "PBW"
    for pat, repl in BAND_WORD_RULES:
        t = pat.sub(repl, t)
    # Brill/Bril + White -> Brilliant White (as a unit, no duplicate "White")
    t = BRILL_WHITE_RE.sub("Brilliant White", t)
    # standalone Brill/Bril -> Brilliant White
    t = BRILL_RE.sub("Brilliant White", t)
    return t


PURE_BRILLIANT_WHITE_RE = re.compile(r"Pure Brilliant White", re.IGNORECASE)


def pbw_aware_json_band(band_text):
    """Convert a JSON lookup band string to its display form: PBW substitution
    (as a whole-phrase replace, so it also fires inside longer bands like
    "Pure Brilliant White & Magnolia"), and drop the internal " - " some
    band strings carry (e.g. "Colours - Tinted") since the output naming
    convention is a single "range - band size" dash, not two dashes."""
    if not band_text:
        return band_text
    t = PURE_BRILLIANT_WHITE_RE.sub("PBW", band_text)
    t = t.replace(" - ", " ")
    return t


def strip_trailing_size(name):
    """Return (stem_before_dash_or_whole, remainder_after_dash_or_None, size_litres_or_None, is_us_unit)."""
    m = SIZE_RE.match(name)
    if m:
        base, num, unit = m.groups()
        val = float(num)
        if unit.upper() == "ML":
            val = val / 1000.0
        return base.rstrip(), val, False
    m = US_UNIT_RE.match(name)
    if m:
        base, unit = m.groups()
        val = US_TO_LITRE[unit.lower()]
        return base.rstrip(), val, True
    return name, None, False


def split_stem_remainder(base):
    idx = base.rfind(" - ")
    if idx != -1:
        return base[:idx], base[idx + 3:]
    # handle a dash right at the end with nothing after it, e.g. "... Primer -"
    stripped = base.rstrip()
    if stripped.endswith(" -"):
        return stripped[:-2].rstrip(), ""
    if stripped.endswith("-"):
        return stripped[:-1].rstrip(), ""
    return base, None


def find_price_matches(flat_entries, target, tolerance=0.02):
    return [e for e in flat_entries if abs(e[3] - target) <= tolerance]


def disambiguate(candidates, stem_text, remainder_text):
    stem_expanded = expand_abbreviations(stem_text)
    stem_norm = alnum(stem_expanded)
    stem_tokens = set(re.findall(r"[a-z]+", stem_expanded.lower()))

    remainder_clean = TRAILING_NUM_RE.sub("", remainder_text or "")
    remainder_norm = alnum(remainder_clean)

    scored = []
    for category, band, size_str, price in candidates:
        cat_norm = alnum(category)
        score = 0
        if cat_norm and (cat_norm in stem_norm or stem_norm.endswith(cat_norm[: max(4, len(cat_norm) // 2)])):
            score += 3
        cat_tokens = set(re.findall(r"[a-z]+", category.lower()))
        score += len(cat_tokens & stem_tokens)

        band_norm = alnum(band)
        if remainder_norm and band_norm:
            if band_norm.startswith(remainder_norm) or remainder_norm.startswith(band_norm):
                score += 3
        elif not remainder_norm and not band_norm:
            score += 1  # both empty bands, consistent

        scored.append((score, category, band, size_str, price))
    scored.sort(key=lambda x: -x[0])
    if scored[0][0] == 0:
        return None  # no signal at all, ambiguous
    if len(scored) >= 2 and scored[0][0] == scored[1][0]:
        return None  # tie, ambiguous
    return scored[0][1:]


def is_kg_scope_skip(prefix, item_name, lookups):
    """Isomat KG/filler products with no unit suffix at all (e.g. Durocret-Plus)."""
    if prefix != "ISO":
        return False
    kg_block = lookups["ISO"].get("_kg_products_leave_unchanged", {})
    name_norm = alnum(item_name)
    for category in kg_block:
        if category == "_note":
            continue
        # loose match: first significant word of the category name (e.g. "Durocret-Plus")
        first_word = alnum(category.split()[0]) if category.split() else ""
        if first_word and len(first_word) >= 4 and first_word in name_norm:
            return True
    return False


def process(csv_path, out_dir):
    lookups, flat = load_lookups()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    fieldnames = None
    changes = []
    flags = []

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(row)

    # Pass 1: work out stem/band/size for every in-scope row, WITHOUT yet
    # deciding on any shortening. Rows needing shortening are grouped into
    # "families" (same stem + same band) so that every pack size of the same
    # product/colour gets the exact same shortened text — otherwise a 2.5ltr
    # pack could end up abbreviated while its 1ltr sibling isn't, just
    # because the size suffix happened to tip one over 50 and not the other.
    pending = []  # dicts: row, code, name, stem, band_final, size_str_fmt, basis

    for row in rows:
        code = row["*ItemCode"]
        name = row["ItemName"]
        m = re.match(r"[A-Z]+", code)
        prefix = m.group(0) if m else ""

        if prefix not in SUPPLIERS:
            continue  # leave completely unchanged
        if KG_RE.search(name):
            continue  # KG/G product, leave unchanged
        if SUNDRY_RE.search(name):
            continue  # sundry, leave unchanged
        if is_kg_scope_skip(prefix, name, lookups):
            continue  # e.g. Isomat filler with no unit suffix

        try:
            buy_price = float(row["PurchasesUnitPrice"])
        except (KeyError, ValueError):
            continue

        base, size_litres, is_us = strip_trailing_size(name)
        stem, remainder = split_stem_remainder(base)

        basis = None
        band_final = None

        if size_litres is not None:
            # already has a clean size -> tidy band text only
            if remainder is not None:
                band_final = tidy_band_text(remainder, prefix)
            else:
                band_final = None
            new_size = size_litres
        else:
            # needs restoration via price match
            if buy_price <= 0:
                flags.append((code, name, "no/zero PurchasesUnitPrice, cannot compute size"))
                continue
            target = round(buy_price / 1.20, 2)
            candidates = find_price_matches(flat[prefix], target)
            if not candidates:
                flags.append(
                    (code, name, f"no price match: buy={buy_price} -> target={target}, nothing in {prefix} lookup matches")
                )
                continue
            if len(candidates) == 1:
                category, band, size_str, price = candidates[0]
            else:
                result = disambiguate(candidates, stem, remainder)
                if result is None:
                    cand_str = "; ".join(f"{c}/{b}@{s}={p}" for c, b, s, p in candidates)
                    flags.append(
                        (code, name, f"ambiguous price match: buy={buy_price} target={target} candidates=[{cand_str}]")
                    )
                    continue
                category, band, size_str, price = result
            new_size = float(size_str)
            band_final = pbw_aware_json_band(band)
            if band_final and alnum(band_final) and alnum(band_final) in alnum(stem):
                band_final = None  # already represented in the stem, don't repeat it
            basis = f"buy {buy_price} / 1.2 = {target} -> matched {category} / {band or '(no band)'} @ {size_str}LT = {price}"

        size_str_fmt = fmt_size(new_size)
        pending.append(
            {
                "row": row,
                "code": code,
                "name": name,
                "stem": stem,
                "band_final": band_final,
                "size_str_fmt": size_str_fmt,
                "basis": basis,
            }
        )

    # Pass 2: group by (stem, band) family, decide shortening ONCE per family
    # using the family's longest size suffix as the worst case, then apply
    # that same descriptor to every member.
    families = {}
    for item in pending:
        key = (item["stem"], item["band_final"])
        families.setdefault(key, []).append(item)

    for (stem, band_final), members in families.items():
        worst_size_str = max((m["size_str_fmt"] for m in members), key=len)
        if band_final:
            worst_name = f"{stem} - {band_final} {worst_size_str}ltr"
        else:
            worst_name = f"{stem} {worst_size_str}ltr"

        descriptor_overflows = len(worst_name) > 50
        shrunk_name, applied_rules = shrink_to_fit(worst_name) if descriptor_overflows else (worst_name, [])

        if len(shrunk_name) > 50:
            for m in members:
                flags.append(
                    (m["code"], m["name"], f"restored name exceeds 50 chars even after shortening ({len(shrunk_name)}): '{shrunk_name}'")
                )
            continue

        size_suffix = f" {worst_size_str}ltr"
        descriptor = shrunk_name[: -len(size_suffix)] if shrunk_name.endswith(size_suffix) else shrunk_name

        for m in members:
            new_name = f"{descriptor} {m['size_str_fmt']}ltr"
            basis = m["basis"]
            if applied_rules:
                original_full = f"{stem} - {band_final} {m['size_str_fmt']}ltr" if band_final else f"{stem} {m['size_str_fmt']}ltr"
                basis = (basis or "naming tidy only") + f" [shortened: {original_full} -> {new_name}]"
            if new_name != m["name"]:
                m["row"]["ItemName"] = new_name
                changes.append((m["code"], m["name"], new_name, basis))

    # write output CSV
    out_csv = out_dir / "InventoryItems-restored.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    # verification report
    with open(out_dir / "verification_report.txt", "w", encoding="utf-8") as f:
        f.write(f"Verification report — {len(changes)} ItemName changes\n")
        f.write("=" * 70 + "\n\n")
        for code, old, new, basis in changes:
            f.write(f"{code}\n")
            f.write(f"  old: {old}\n")
            f.write(f"  new: {new}\n")
            if basis:
                f.write(f"  basis: {basis}\n")
            else:
                f.write(f"  basis: naming tidy only (size already present)\n")
            f.write("\n")

    # flag list
    with open(out_dir / "flag_list.txt", "w", encoding="utf-8") as f:
        f.write(f"Flag list — {len(flags)} items needing manual review\n")
        f.write("=" * 70 + "\n\n")
        for code, name, reason in flags:
            f.write(f"{code}  {name}\n  reason: {reason}\n\n")

    print(f"Rows processed: {len(rows)}")
    print(f"Changes: {len(changes)}")
    print(f"Flags: {len(flags)}")
    print(f"Output: {out_csv}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: restore_inventory.py <input-csv> <output-dir>")
        sys.exit(1)
    process(sys.argv[1], sys.argv[2])
