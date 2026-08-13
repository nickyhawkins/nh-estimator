# Product Coverage Rate Settings

**Status: BUILT 2026-08-13 (v2.19.0).** As-built notes follow the original spec below.

## Purpose

Replace the flat sqm rate per surface type (wall/woodwork/ceiling) with per-product
coverage rates, since products like Dulux Velvet Matt spread differently to Tikkurila
Optiva 5. Built to grow incrementally — Nicky adds a product's specs when he first
needs it on a job, not upfront.

## Settings: Coverage Rates list

New settings section, e.g. "Coverage Rates."

- A simple table of entries, each with:
  - Product (dropdown, sourced from the same Xero sales items list used by Price
    Lookup — not free text, so naming stays consistent and the item code is captured
    automatically)
  - Surface type (dropdown, reusing the existing categories: wall / woodwork /
    ceiling / etc.)
  - Coverage rate (sqm per litre — same unit the current flat-rate calc already uses)
  - Default number of coats (optional — jobs can still override coats manually as today)
- Add / edit / delete entries here at any time.
- No requirement to populate every product up front — the list only needs what's
  actually been used on a job so far.
- Because the product comes from the Xero list, a given Xero item code should only be
  linkable to one coverage rate per surface type — surface it clearly if Nicky tries
  to add a duplicate rather than silently creating a second entry.

## Quoting integration

- Wherever a surface type is currently chosen for a room/area, add a product dropdown
  populated from Coverage Rates entries matching that surface type, plus a
  "Standard / default" option.
- Product selected → use its coverage rate for the material quantity calculation, and
  since it's the real Xero item, its name/code carries through cleanly to the
  materials list and quote output.
- "Standard / default" or nothing selected → fall back to today's flat sqm rate for
  that surface type exactly as now. No regression for surfaces without a
  product-specific entry yet.
- Once a product's coverage rate is set up here, it's selectable and self-consistent
  on every future quote — no re-entering rates job to job.

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

---

## As built (v2.19.0)

### Data model

`settings.coverageRates` — an array on the existing settings blob (no DB changes),
each entry `{ id, itemCode, itemName, range, surface, rate, coats }`:

- **itemCode / itemName** — the real Xero sales item picked in Settings, verbatim.
- **range** — the item's parsed product range (looked up by code in
  `materialGroupsCache`, the `/auth/material-groups` grouping — no client-side name
  parsing). **Matching at calc time is by range**: every colour band and tin size of
  one product spreads the same, and the range is exactly the product identity the
  room's product pickers and `computeRoleGroups()` already deal in. This is what
  makes "its name/code carries through cleanly to the materials list and quote
  output" true for free — the litres feed the same range/band → tin-optimiser →
  Xero-line machinery as ever.
- **surface** — one per flat-rate category: `wall`, `wallSpray`, `ceiling`,
  `woodwork`, `mist`, `panel` (`COVERAGE_SURFACES`).
- **rate** — m² per litre. **coats** — optional default (null = none).

### Settings UI

Inside the existing Coverage Rates card (the flat fields stay and are labelled as
the Standard / default figures): a Per-Product Rates list with inline rate/coats
editing and ✕ delete, plus an add form — product search over `materialItemIndex`
(same account-202 items as Price Lookup, **minus sundries**, which have no
coverage), surface select, rate, optional coats. Duplicates per product+surface are
blocked **by item code and by range** with an alert naming the existing entry
(`addCoverageRate()`), never silently stacked.

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

Deliberate details:

- **Sprayed walls only match a `wallSpray` entry.** A rolled figure never leaks
  into a sprayed room (sprayed consumption is its own calibration); no entry falls
  back to the flat sprayed rate as always.
- **A primer product with its own entry replaces the 0.8 proxy.** The flat path
  guesses primer volume as 0.8 × the *topcoat's* coverage; a real primer rate is
  used directly (area ÷ rate).
- **Exterior and kitchen are untouched.** Exterior litres run on assumed-area
  calibrations with their own Settings rates (a different concern from measured-m²
  coverage), kitchens don't buy litres through the coverage formula at all.

### Tests (automated, Playwright against the served page — see spec Test section)

1. No coverage entries → `calcRoom` litres identical to flat-rate figures (walls,
   ceiling, woodwork, primer, mist) — no regression.
2. Wall entry for the room's product (override and Settings-default paths) →
   `wallL` moves to the product's rate; rooms on other products unchanged.
3. Woodwork entry → `glossL` moves accordingly.
4. Sprayed room ignores the rolled entry, uses `wallSpray` entry when present.
