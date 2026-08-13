# Product Coverage Rate Settings

**Status: BUILT 2026-08-13 (v2.19.0); revised 2026-08-13 (v2.22.0).** As-built notes
follow the spec below. The v2.22.0 revision changed where the Settings product
picker sources from: material **groups/ranges** directly (e.g. "Tikkurila Optiva 5"),
not individual Xero sales items — coverage per litre doesn't change between pack
sizes of the same product, so there was nothing for the item pick to add. The spec
text below is the revised version; matching, calc and spraying were already
group-level and are unchanged.

## Purpose

Replace the flat sqm rate per surface type (wall/woodwork/ceiling) with per-product
coverage rates, since products like Dulux Velvet Matt spread differently to Tikkurila
Optiva 5. Built to grow incrementally — Nicky adds a product's specs when he first
needs it on a job, not upfront.

## Settings: Coverage Rates list

New settings section, e.g. "Coverage Rates."

- A simple table of entries, each with:
  - Product (dropdown, sourced from material groups/ranges — the same range/band
    grouping already used for the materials list, e.g. "Tikkurila Optiva 5",
    "Dulux Velvet Matt" — not individual Xero SKUs, since coverage per litre doesn't
    change between pack sizes of the same product)
  - Surface type (dropdown, reusing the existing categories: wall / woodwork /
    ceiling / etc.)
  - Coverage rate (sqm per litre — same unit the current flat-rate calc already uses)
  - Default number of coats (optional — jobs can still override coats manually as today)
- Add / edit / delete entries here at any time.
- No requirement to populate every product up front — the list only needs what's
  actually been used on a job so far.
- A given material group should only be linkable to one coverage rate per surface
  type — surface it clearly if Nicky tries to add a duplicate rather than silently
  creating a second entry.

## Quoting integration

- Wherever a surface type is currently chosen for a room/area, add a product dropdown
  populated from Coverage Rates entries matching that surface type, plus a
  "Standard / default" option.
- Product group selected → use its coverage rate for the material quantity
  calculation. Actual pack size for purchasing/materials list stays governed by the
  existing size logic — the coverage rate itself just applies at the group level.
- "Standard / default" or nothing selected → fall back to today's flat sqm rate for
  that surface type exactly as now. No regression for surfaces without a
  product-specific entry yet.
- Once a product's coverage rate is set up here, it's selectable and self-consistent
  on every future quote — no re-entering rates job to job.

## Spraying toggle

Rather than tracking a separate spray-specific coverage rate per product (too fiddly
to keep accurate across products), add a simple **"Spraying"** toggle per
surface/area.

- When on, apply a flat +30% to material quantity on top of whatever coverage rate
  is already in play — default flat rate or a product-specific rate from the list
  above, whichever applies.
- Not exact, but a reasonable approximation that works across products without
  needing spray-specific data per item.
- No separate "spray rate" field anywhere in the Coverage Rates list — this stays a
  single global multiplier, not another per-product setting to maintain.
- Per-surface defaults (2026-08-13 follow-up): kitchens, ceilings and woodwork are
  sprayed by default; walls and fitted units are sometimes sprayed and sometimes
  not, so their toggles default off.

## Non-goals

- Not merged with the Xero price lookup/shopping list — coverage (how far it goes)
  and unit price (what it costs) are separate concerns, kept as separate lists.
- No bulk import or pre-population of a full product catalogue — additive only, as
  needed.

## Test

- No product selected on a wall → coverage matches the current flat sqm rate exactly
  (no regression).
- Add "Dulux Velvet Matt" as a wall product with a different coverage rate, select it
  on a room, confirm material quantity changes accordingly.
- Repeat for a woodwork product.
- Toggle Spraying on for a wall using the default rate → material quantity is 30%
  higher than with it off.
- Toggle Spraying on for a wall using a product-specific rate → the 30% applies on
  top of that product's rate, not the default.

---

## As built (v2.19.0)

### Data model

`settings.coverageRates` — an array on the existing settings blob (no DB changes),
each entry `{ id, range, surface, rate, coats }`:

- **range** — the material group picked in Settings, straight from
  `materialGroupsCache` (the `/auth/material-groups` grouping — the same range/band
  grouping the materials list and room pickers use). **Matching at calc time is by
  range**: every colour band and tin size of one product spreads the same, and the
  range is exactly the product identity the room's product pickers and
  `computeRoleGroups()` already deal in — the litres feed the same range/band →
  tin-optimiser → Xero-line machinery as ever, so pack size stays the existing size
  logic's job. (v2.19.0 originally had the picker choose a Xero sales item and
  derive its range; v2.22.0 removed the item step — entries saved by that form
  still carry `itemCode`/`itemName`, harmless and ignored.)
- **surface** — one per flat-rate category: `wall`, `ceiling`, `woodwork`, `mist`,
  `panel` (`COVERAGE_SURFACES`). **No sprayed variants by design** — spraying is
  the global uplift, never a second per-product figure.
- **rate** — m² per litre. **coats** — optional default (null = none).

### Settings UI

Inside the existing Coverage Rates card (the flat fields stay and are labelled as
the Standard / default figures): a Per-Product Rates list with inline rate/coats
editing and ✕ delete, plus an add form — a product-range picker over
`Object.keys(materialGroupsCache)` (tap for the full group list, type to filter;
sundries never appear because they aren't ranges), surface select, rate, optional
coats. Duplicates per group+surface are blocked with an alert naming the existing
entry (`addCoverageRate()`), never silently stacked.

### The room "product dropdown" is the existing per-room product picker

Rooms already have a product picker per surface role with a "Use default
(Settings)" state — that IS the spec's dropdown + Standard/default option, so no
second picker was added (the repo's recurring failure mode is a duplicate picker
surviving alongside the original — see `onMaterialProductInput`'s comment).
Instead:

- The picker's options now float ranges with a coverage entry for that role's
  surface to the top, annotated "· N m²/L" (`roomRangeSearchOptions`).
- Picking a product whose entry carries default coats sets that surface's coats seg
  (wall→wc, ceiling→cc, topcoat→xc; `applyCoverageDefaultCoats`) — still tappable
  to override, per the spec.
- The **Settings Materials default product** counts as "product selected" too: once
  e.g. the default wall paint has a wall entry, every room on the default picks up
  its rate — self-consistent on every future quote with zero per-room clicks.

### Calc integration

`coverageRateFor(range, surface)` + `effectiveRoleRange(r, role)` (override, else
Settings default — mirroring `computeRoleGroups`' resolution, so litres and tins
always describe the same product). Entry found → its rate; none → the flat rate,
**byte-identical to pre-feature behaviour**. Wired into:

- `calcRoom()`: walls (`wall`/`wallSpray` by the room's Spray walls toggle),
  feature wall (its own effective product; falls back to the FLAT rate — never the
  wall product's rate — when its product has no entry), ceiling, woodwork topcoat,
  primer, mist.
- `calcPanel()` (rate resolved by the caller, passed in), `calcFittedUnit()`
  (unit's own range else Settings topcoat; primer follows Settings primer).

### Spraying = one global uplift, one toggle per surface

The **Spraying uplift %** is a single Settings field (`sprayUpliftPct`, default
**30**, in the Coverage Rates card); there is deliberately no sprayed surface in
the coverage list and the old **"Wall Emulsion — Sprayed"** flat rate (`cwSpray`)
is gone. A surface's toggle multiplies its litres by the uplift on top of
whichever rate applies, flat or per-product:

- **Spray walls** (per room, default **off**) — main + feature wall litres. Still
  the trigger for the spray *sundries* bump on labour (extra masking consumables),
  which is a separate, unchanged mechanism.
- **Spray ceiling** (per room, default **on**) — ceiling litres.
- **Spray woodwork** (per room, default **on**) — topcoat AND primer litres
  (primer goes on the same way the topcoat does).
- **Sprayed finish** (Fitted Unit form, default **off**) — the unit's topcoat and
  primer litres; the unit's labour rates already price the spray passes.
- **Kitchens: no toggle.** The kitchen module is already the cabinet *spray*
  calculator — flat per-piece pricing, no litres formula, spraying inherent.
- Exterior render keeps its own pre-existing Spray render / sprayed-masonry-rate
  model, untouched.

Missing fields on saved rooms read as the defaults (`!== false` for the two
default-on toggles), so old rooms mean "sprayed" without migration.

**One-time recalibration, handled automatically:** the flat Ceiling (13) and
Gloss/Satinwood (7) rates were calibrated as SPRAYED effective figures, but with
the default-on toggles they now mean the un-sprayed base. `mergeSettings()`
converts blobs saved before the uplift model (detected by the missing
`sprayUpliftPct`) ×1.3 once — 13→17, 7→9, rounded to the fields' 0.5 step — so
sprayed-by-default litres land exactly where those blobs' old figures put them.
Fresh-install defaults are the converted figures (17/9). Wall spraying itself
moves from the old 13→9 rate fork (≈+44%) to +30%, and `cwSpray` is dropped on
load.

Deliberate details:

- **A primer product with its own entry replaces the 0.8 proxy.** The flat path
  guesses primer volume as 0.8 × the *topcoat's* coverage; a real primer rate is
  used directly (area ÷ rate).
- **Exterior and kitchen are untouched.** Exterior litres run on assumed-area
  calibrations with their own Settings rates — including exterior masonry's own
  smooth/textured × rolled/sprayed rate grid, which predates this feature and
  stays as-is; kitchens don't buy litres through the coverage formula at all.

### Tests (automated — extracted-function harness over the real app script,
plus a Chromium DOM smoke test; see spec Test section)

1. No coverage entries → `calcRoom` litres identical to flat-rate figures (walls,
   ceiling, woodwork, primer, mist) — no regression.
2. Wall entry for the room's product (override and Settings-default paths) →
   `wallL` moves to the product's rate; rooms on other products unchanged.
3. Woodwork entry → `glossL` moves accordingly.
4. Spray on + default rate → litres = rolled figure × 1.3 (pre-rounding).
5. Spray on + product rate → ×1.3 on the product's rate, not the default's;
   uplift setting itself respected when changed.
6. Per-surface defaults: a room with no spray fields gets ×1.3 on ceiling,
   topcoat and primer litres but flat walls/mist; explicit off = flat; fitted
   unit off by default, ×1.3 on topcoat+primer when Sprayed finish is on.
7. Settings migration: pre-uplift blob {cc:13, cg:7} → 17/9; a blob carrying
   sprayUpliftPct is untouched; cw never converts.
