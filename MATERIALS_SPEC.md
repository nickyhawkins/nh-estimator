# Materials Feature — Revised Spec (supersedes Phase 1/2/3 split in FEATURES.md)

## Why this revision

During Phase 1 setup we discovered two things that change the design:

1. **Defaults must be a product RANGE, not a specific tin.** Selecting a single tin size (e.g. "Optiva 5 5ltr") wrongly locks the calculation to that size. The app should know all available sizes for a range and choose the best fit. This pulls the old "Phase 3" tin optimisation forward — it belongs in the core, not deferred.

2. **Ranges have COLOUR BANDS priced differently.** Within one range (e.g. Tikkurila Optiva 5) there are colour bands — White, Magnolia, Colours — each a different price, each available in multiple tin sizes. Pricing the wrong band materially misprices the job.

## The real data hierarchy in Xero

Each Xero item is one specific tin. The name encodes the full path:

```
Tikkurila Optiva 5 - White 10ltr      £95.84   (TIK057)
Tikkurila Optiva 5 - White 3ltr       £33.15   (TIK058)
Tikkurila Optiva 5 - White 1ltr       £13.23   (TIK059)
Tikkurila Optiva 5 - Magnolia 10ltr   £101.82  (TIK060)
Tikkurila Optiva 5 - Colours 10ltr    £119.74  (TIK063)
... etc
```

Hierarchy: **Range** (`Tikkurila Optiva 5`) → **Colour band** (`White` / `Magnolia` / `Colours`) → **Tin size** (`1ltr` / `3ltr` / `5ltr` / `10ltr`).

Because item names are now consistently formatted, the app can parse this:
- **Range** = everything before the ` - ` separator
- **Colour band** = the word(s) after ` - ` and before the size (OPTIONAL — may be absent for unbanded products; treat as null/single band)
- **Tin size** = the trailing `Nltr` value
- **Price** = SalesUnitPrice from the item (sales account 202 — the price charged to the customer)

## Must work across ALL suppliers, not just Tikkurila

The grouping and parsing must be **supplier-agnostic**. Tikkurila is just the first supplier we tidied. Requirements:

- **Parse whatever consistent structure exists** for any supplier, not hardcoded to Tikkurila. The rules below (range before ` - `, band + size after) should apply generically based on the item name format, regardless of supplier prefix or item code prefix.

- **Colour bands are OPTIONAL.** Many products have no White/Magnolia/Colours band — they're just a product in various sizes (e.g. a primer or a trade white that isn't banded). The parser must handle both shapes:
  - `range -> band -> [sizes]` (banded, like Optiva 5)
  - `range -> [sizes]` (no band — treat as a single implicit band, or band = null)
  Do NOT assume every product has bands.

- **Size format tolerance.** Parse sizes robustly: `10ltr`, `3ltr`, `1ltr`, and also legacy formats that may still exist for un-tidied suppliers (`2.5 ltr`, `750ml`, `5L`). Normalise to litres for calculation. (ml → litres, e.g. 750ml = 0.75.) Flag or skip items whose size can't be parsed rather than guessing.

- **Depends on consistent naming.** Reliable grouping across suppliers depends on their item names following the same convention Tikkurila now uses. **Action required outside the app:** run the price-tidy script (in `scripts/`) across the other suppliers to standardise their naming (keep supplier prefix, `range - band size` structure, `ltr` units). Until a supplier is tidied, the parser should degrade gracefully — group what it can, flag what it can't — rather than break.

- **No hardcoded supplier or range names** in the grouping logic. It reads the data and derives ranges/bands/sizes from the names. Adding a new supplier or product should require no code change, only consistent naming.

## Revised approach

### Grouping (new — do this first)
Parse all account-202 (sales) Xero items into a structure (use SalesUnitPrice for pricing — 202 is the sales account, what the customer is charged; 311 is the purchases/cost account and is NOT used for quoting):
```
range -> colour band -> [ {size_litres, price, itemCode, isPerLitre}, ... ]
```
This gives the app, for any range + band, the full list of available tin sizes and prices to optimise over.

**`isPerLitre`**: some items are a dedicated "sell any fractional quantity at this rate" SKU, e.g. `Tikkurila Anti Reflex 2 - White 1ltr (per litre)` — priced at essentially the range's bulk (10L) per-litre rate, not a small-tin markup. Confirmed in real data: `£56.78 / 10 = £5.678 ≈ £5.69` (the per-litre price). These get `isPerLitre: true` (matched on `(per litre)` in the name) and stay in the same sizes array as real tins, but are a different kind of thing: the tin optimiser (step 4) must never pick one as a combinable tin; the per-litre calc (step 5) should use one directly (litres × price, no rounding) when the selected band has one.

Currently only 3 Tikkurila SKUs carry this flag (Anti Reflex 2, Otex Akva, Helmi 30 — all White band, 1ltr) — likely the actual ceiling/topcoat/primer products in practice. Colours/Pastels bands on the same ranges have no per-litre item, only discrete tins.

### Settings — default products by RANGE
User selects default **ranges** (not tins) for:
- Wall paint (e.g. "Tikkurila Optiva 5")
- Ceiling paint
- Woodwork topcoat
- Woodwork primer

Store the range identifier, not a specific item.

### Per-job / per-colour selections
- Wall product range and **colour band** can be set per colour group (ties into colour numbering).
  - A colour group needs: range (default or overridden) + colour band (White / Magnolia / Colours).
- Ceiling and woodwork: default range + band, overridable per job for different finishes.

### Calculations
- **Walls (per colour group):** litres needed for that group → choose cheapest combination of available tin sizes *within the selected range + band* that covers the litres → sum cost. (This is the tin optimisation — cheapest fill, e.g. 3.5ltr = 3ltr + ... whichever combo of that band's sizes is cheapest and sufficient.)
- **Ceiling / woodwork topcoat / primer:** these are charged per litre. If the selected range + band has an `isPerLitre` item, use litres × its price directly (no rounding). **If it doesn't** (e.g. a Colours/Pastels band with only discrete tins), fall back to the same tin-optimisation logic as walls for that band, rather than restricting these roles to White-only — confirmed with the user since these three roles aren't guaranteed to stay on White forever. Primer litres = topcoat litres × 0.8.

### On the quote
Consolidated materials lines using the real Xero item codes chosen by the optimiser, account 202 (sales), No VAT, under the labour lines. For walls this may mean e.g. "1 × Optiva 5 Colours 3ltr" + "1 × Optiva 5 Colours 1ltr" if that's the cheapest fill.

## PHASE 2 — Per-room colour numbering AND product override

These two belong together — colour number and product override are both optional per-room attributes resolved the same way (fall back to the job/settings default when unset), so build them as one coherent piece rather than colour now / product later, even though colour *definition* lives on its own tab (see below) rather than on the room screen itself.

### Real-world switching logic (why this is needed)
Nicky's per-room changes follow predictable patterns:
- **Most common:** client wants a specific colour → Nicky colour-matches in the default product (e.g. Tikkurila). This is just a colour number + optional label on the default range. No product change.
- **Client wants a specific brand** (e.g. Farrow & Ball rather than a colour match) → product/range override for that room.
- **Room type demands a different product** (e.g. bathroom → moisture-resistant range) → product/range override.
- **Tin-size economics** (e.g. needs ~5ltr, so switch to Dulux/Crown which sell 5ltr tins where Tikkurila jumps 3ltr→10ltr) → product/range override. NOTE: this overlaps with tin optimisation — a future enhancement could *flag* when another supplier's tin sizes would be more economical for the required litres, but for now Nicky makes this call manually.

### Colours as their own tab (not inline per-room fields)

Real workflow: Nicky walks the job room-by-room capturing dimensions/requirements first, and discusses colours afterward as a separate pass — occasionally a colour comes up mid-walkthrough, and switching tabs briefly for that is fine. This means colour *definition* and room *walkthrough* are different moments, so they get different screens:

- **New "Colours" tab** — a list screen like Exterior's, where colours are defined: `{ number, label }` entries (add / rename / remove). This is where "Colour 2 = Farrow & Ball Hague Blue" actually gets typed in, once, in one place — not retyped per room.
- **Room edit screen** — gets a colour dropdown referencing whatever's defined on the Colours tab, defaulting to unassigned (= colour 1, so untouched rooms need no action). The dropdown also gets a **"+ New colour"** inline option, so the rare mid-walkthrough mention doesn't force a tab switch — it adds to the same shared list the Colours tab manages.
- The room edit screen separately gets the **product/range override** control (per room, optional, falls back to the settings default when unset) — this is unrelated to colour number and stays on the room screen since it's a per-room product decision, not a colour concept.

### What Phase 2 adds
1. **Colours tab** — list of `{ number, label }` entries, persisted with the same lifecycle as rooms/exterior items (loads into memory on init, clears on Clear Rooms / Clear Everything — colours belong to the current job, not permanent settings).
2. **Colour number on each room** — optional, defaults to unassigned/colour 1. Picked via dropdown on the room screen (referencing the Colours tab list), with inline "+ New colour". Groups rooms sharing a colour so wall tins are calculated per colour group.
3. **Product/range override** (optional, per room) — switches the wall product range+band for that room away from the settings default (brand requests, bathroom products, tin-size economics). Falls back to the default when not set.
4. **Ceiling/topcoat/primer override — per room, same pattern as wall** (revised from the original job-wide-only plan: a specific room's woodwork genuinely can need a different topcoat, and whether primer is needed at all depends on which topcoat that room uses, so this has to be settable at the same level as the wall override, not just once for the whole job). Each of the three gets its own "Use default (Settings)" + product/band picker on the room screen, exactly mirroring wall.
5. **Primer "None"** — some topcoats are self-priming and need no primer at all. A room's primer picker gets a third state alongside "Use default" and a real product: **None**, stored as a dedicated `primerNone` flag (not a fake range name) so it's unambiguous. A None room contributes **no primer row and no cost at all** for that room — not even the old litres-guess placeholder, since None is a deliberate decision, not an unconfigured default.

### Data model
- A room carries: `{ colourNumber?, wallRangeOverride?, wallBandOverride?, ceilingRangeOverride?, ceilingBandOverride?, topcoatRangeOverride?, topcoatBandOverride?, primerRangeOverride?, primerBandOverride?, primerNone? }`. All optional. `colourNumber` unset means colour 1 (unassigned/default); an unset `<role>RangeOverride` means "use `settings.materials.<role>`"; `primerNone: true` means skip primer for this room regardless of any override/default.
- A new job-scoped `colours` list: `[{ number, label }]`, managed on the Colours tab.
- The calculation resolves each room's effective product for role X as `room[X+'RangeOverride'] ? {range: room[X+'RangeOverride'], band: room[X+'BandOverride']} : settings.materials[X]`, and groups by (effective range + band + colourNumber) so tins/litres are aggregated within each genuine group — same grouping logic for all four roles now, not just wall. Primer litres are `topcoat litres × 0.8` computed per room (not job-wide), since topcoat itself can now vary room to room; rooms with `primerNone` are excluded from primer grouping entirely.

### Calculation impact
Whole-tin optimisation (or per-litre pricing) runs per (effective range + band + colour group), for all four roles — a room overridden to a different product is its own group and gets its own tins/litres, never shared with a room on the default product. This applies uniformly whether the role is mapped or not — an unmapped group still falls back to the old litres-guess display, just per group instead of job-wide.

### On the quote
Each distinct product/band/colour group produces its own consolidated wall-material line(s) with the correct Xero item codes. A job with two colour groups on the default product plus one room overridden to a different brand shows three separate wall-paint groupings. The now-inaccurate "Materials assume one wall colour; adjust in Xero for multi-colour jobs" banner comes out once this ships.

## MIST COAT — fifth material product (gap found in testing)

Mist coats currently add application TIME but no PAINT — the mist coat is a distinct product that isn't costed anywhere. Fix: treat mist coat as a fifth material product alongside wall/ceiling/topcoat/primer.

- **Product:** a fifth default mapping in Settings — "Mist coat / contract matt" (a distinct product, NOT the default wall paint — mist coats use a contract matt or specific mist product, thinned). Per-room override should follow the same pattern as the other roles (optional, falls back to the settings default).
- **Coverage:** its own coverage rate in Settings — thinned paint on porous new plaster covers differently, so don't reuse the wall rate. Calibratable like the others.
- **Area basis:** the room already has a mist-coat surface selector (walls / ceiling / both). Use the selected surface area(s) for the mist litres. ADD an optional manual area (m²) input in the mist coat section for when only part of the room is new plaster — if entered, use it instead of the full surface area; if blank, default to the toggle-selected surface area(s).
- **Calculation:** mist area ÷ mist coverage rate = litres → cost from the mapped product. Charged per litre by default (like ceiling/woodwork); switch to per-tin rounding if Nicky buys/charges mist coat in whole tins.
- Feeds the materials total, the deposit calc, and the Xero quote as its own line item, grouped the same way as the other roles (per effective range + band + colour group).

**Shipped.** Implementation notes:
- Colour grouping: mist coat shares the **wall** colour number (`ROLE_COLOUR_FIELD.mist = 'colourNumber'`), not a dedicated one — it's prep for whichever colour goes on the walls, and in practice is one generic product regardless of the final decorative colour, so a fourth colour picker would be UI for a distinction that rarely matters. Confirmed with the user before building.
- Coverage rate lives in Settings as `settings.cMist` (m²/litre), default 15, alongside `cw`/`cc`/`cg` — distinct from the pre-existing `rMist` (mins/m², a TIME rate, unrelated to paint quantity).
- Data model additions: `mistRangeOverride?`, `mistBandOverride?` (per-room product override, same pattern as the other four roles), `mistAreaOverride?` (optional manual m² — see Area basis above). Litres = `(mistAreaOverride if set and >0, else mistWall?wallArea:0 + mistCeil?ceilArea:0) / cMist`, rounded to 0.1L.
- The manual area override affects **litres only**, not the existing time-cost calculation (`mistWCost`/`mistCCost`), which stays on the full toggle-selected area(s) — prepping/accessing the room still takes roughly as long regardless of how much of it is actually new plaster.
- Rooms with mist coat off (the default) are excluded from grouping entirely via `skipRoom`, same as `primerNone` — an unused product renders no row, not a "0.0L" one.
- Deposit calc doesn't exist yet (see Build order) — mist coat flows into `materialsTotal` like the other four roles, so it'll be included automatically whenever that feature lands.

## COLOURS TAB — evolution into the paint/ordering view

Beyond defining `{number, label}` colours (Phase 2), the Colours tab can become the job's paint/ordering screen using data the materials feature already calculates. Conceptual clarity: **Rooms = input the work, Summary = the price, Colours = what you actually buy and put where.**

### Priority additions (the big win — surface existing data)
1. **Rooms per colour** — under each colour show the rooms assigned to it (e.g. "Colour 1 — Dimity — Lounge, Hall, Landing"). Turns the tab into a colour schedule at a glance. Data already exists (rooms carry colour number).
2. **Paint quantity per colour** — roll up the litres/tins for each colour group (e.g. "Colour 1 — Dimity — 12ltr · 2 × 5ltr + 1 × 2ltr"). This is the ordering list — look at Colours, not Summary, when buying paint. Uses the per-colour-group tin calculation already built for materials.

**Shipped.** Implementation notes:
- Since wall/ceiling/woodwork can each land a room in a *different* colour number (the colour-grouping fix), "rooms per colour" is broken out by role — Walls / Ceiling / Woodwork, each its own line, only shown when non-empty. Gated on the room actually having that role's coats > 0 (a room with `wc: 0` doesn't get listed under Walls for any colour, even one it's nominally assigned to) — this surfaced and fixed a latent bug in `computeRoleGroups()`: a room contributing zero litres to a bucket it's otherwise alone in used to leave a phantom "0.0L" row; groups are now filtered to `litres > 0` before being returned, which benefits Summary and the Xero quote too, not just this tab.
- The paint-quantity roll-up reuses `buildRoleRows()`'s already-computed rows directly (each row gained a `colourNumber` and `role` field, purely additive — existing consumers only ever read `.html`/`.cost`/`.lineItems`) rather than recomputing anything, so the numbers can't drift from what Summary/Xero show. Filtering `mats.wallRows.concat(...).filter(r => r.colourNumber === N)` per colour gives exactly the right rows, including the case where one colour number spans two different product groups (e.g. some rooms on the default range, one room in the same colour overridden to a different brand) — both rows show up under that colour, correctly.
- UI reuses the existing `room-breakdown`/`room-chevron-icon`/`toggleRoomBd()` collapse pattern already used on the Summary tab's room list, rather than inventing a new one.

### Secondary polish (later)
3. **Brand/code autofill** — see "Colour reference library" in FEATURES.md (seed Farrow & Ball + Little Greene, which cover ~90% of colours Nicky uses; personal list for the rest).
4. **Finish/sheen per colour** — same colour can go on in different finishes (matt walls, eggshell woodwork); note against the colour for ordering accuracy.
5. **Surfaces per colour** — which surfaces each colour covers (walls only vs walls+ceiling), so a feature-wall colour is distinguished from a whole-room one.
6. **Colour schedule output** — a tidy "Colour Schedule" (room, colour, finish) on the quote or as a shareable summary. Professional touch; doubles as Nicky's own worksheet on the job.

### Notes
- Leans on existing calculations — mostly surfacing data, not new logic.
- The colour NUMBER still drives the materials calculation; names/codes/finishes are reference only.
- Build after core materials + per-room overrides are solid.

## Build order (revised)

1. **Item grouping** — parse Xero items into range → band → sizes. Test it returns correct structure for Optiva 5 (3 bands, 3 sizes each).
2. **Settings** — select default ranges for the four product roles.
3. **Colour band selection** — per colour group (start simple: one band for the whole job, refine to per-group with colour numbering).
4. **Tin optimisation** — cheapest combination of sizes within a range+band to cover required litres.
5. **Per-litre products** — ceiling, topcoat, primer (primer = topcoat × 0.8), and mist coat (fifth product — see Mist Coat section; area from the room's surface toggle or optional manual m² override ÷ its own coverage rate).
6. **Materials on summary + total + Xero line items.**
7. **Phase 2 step A — Colours tab + room colour dropdown.** New tab: list of `{number, label}` colours (add/rename/remove), persisted with the rooms/exterior lifecycle. Room screen: colour dropdown (default unassigned) + inline "+ New colour". No calculation change yet — still one pooled wall total. Test: colours persist correctly, existing jobs unaffected until a room is actually assigned a non-default colour.
8. **Phase 2 step B — wall grouping by colour number.** Restructure the wall calc to bucket by `(range, band, colourNumber)` and tin-optimise per group, still only the default range/band. Test: a 2-colour-number job on the default product produces two independently-rounded tin totals instead of one pooled total.
9. **Phase 2 step C — per-room product override.** Room screen gets the range/band override control; rooms with it set use their own product within their group.
10. **Phase 2 step D — per-room ceiling/topcoat/primer override, primer "None".** Room screen gets the same override control for all three roles as wall already has; primer additionally gets a None option that excludes that room from primer entirely (no row, no cost). Revised from job-wide-only after building — a room's topcoat and whether it needs primer are both genuinely per-room decisions.
11. **Phase 2 step E — Xero quote + cleanup.** Per-group wall material line sets; remove the now-obsolete multi-colour banner. End-to-end test with a real multi-colour job sent to Xero.
12. **Then deposit feature** (25% of labour + materials, weekly split option).

## Gotchas (still apply)
- Whole-tin logic is per colour group, not per room and not per whole job.
- Watch for duplicate function definitions.
- Read from in-memory arrays; don't reintroduce localStorage as a competing source of truth.
- Item names are the source of truth for range/band/size parsing — depends on the consistent naming from the price-tidy script, so keep that naming convention when adding new products.
- Grouping MUST be supplier-agnostic and handle optional colour bands — see the cross-supplier section above. No hardcoded supplier/range names.
- Other suppliers still need the tidy-up script run over them to standardise naming; until then the parser should group what it can and flag the rest, not break.
