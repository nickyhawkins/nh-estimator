# Window Pricing Calculator — Feature Spec (v2, inflation-adjusted)

**Status: COMPLETE** — reviewed against the live app 2026-07-20, shipped in commit `bde9c43`. Decided NOT to adopt the full flat size-band/sides-multiplier rewrite below (would disconnect windows from the day-rate model that drives every other price in the app). Instead built two targeted gaps into the existing Exterior casement/sash engine: a per-window access multiplier (ground/1st floor/ladder-tower) and a fuller per-window repair set (resin, reglaze, draught-proofing, plus sash-only cords/staff beads/parting beads). Not built (explicitly declined, not a gap): the flat size-band pricing matrix, `sidesMultiplier`, or any interior-window pricing — out of scope, exterior day-rate model was kept as-is.

**For:** Nicky Hawkins Painter & Decorator estimating app
**Feature:** Window pricing module (interior/exterior, casement, sash — including restoration)
**Note:** Revises the original spec's reference pricing. The £130/sash figure sourced from a South West London decorator's site reads as legacy content republished under a 2026 date rather than current pricing — likely closer to 2018 vintage. Applied a ~38% uplift (UK CPI cumulative since 2018) to that and similar suspect figures below.

---

## 1. Purpose

Add a window pricing calculator to the estimating app, following the same pattern as the room and exterior calculators. Output is a per-window (or per-job total) price feeding into the overall job estimate.

---

## 2. Data model

### 2.1 Window entry (one per window/opening)

```
{
  id: string,
  label: string,
  windowType: "fixed" | "casement" | "sashSound" | "sashRestoration",
  sizeBand: "small" | "medium" | "large" | "xlarge",
  widthMm: number | null,
  heightMm: number | null,
  openingLights: number,
  totalPanes: number,
  condition: "sound" | "lightPrep" | "heavyPrep",
  sides: "interiorOnly" | "exteriorOnly" | "both",
  access: "ground" | "firstFloor" | "ladderTower",
  quantity: number
}
```

### 2.2 Pricing config (editable in Settings, not hardcoded)

```
{
  basePrices: {
    fixed:            { small: 0, medium: 0, large: 0, xlarge: 0 },
    casement:         { small: 0, medium: 0, large: 0, xlarge: 0 },
    sashSound:        { small: 0, medium: 0, large: 0, xlarge: 0 },
    sashRestoration:  { small: 0, medium: 0, large: 0, xlarge: 0 } // per sash box
  },
  conditionMultiplier: { sound: 1.0, lightPrep: 1.15, heavyPrep: 1.35 },
  sidesMultiplier:     { interiorOnly: 1.0, exteriorOnly: 1.1, both: 1.8 },
  accessMultiplier:    { ground: 1.0, firstFloor: 1.1, ladderTower: 1.25 },
  extraPaneRate: 0,
  includedPanesThreshold: 4,
  minimumJobCallout: 0
}
```

---

## 3. Calculation logic

### 3.1 Standard formula (fixed, casement, sash-sound)

```
extraPanes = max(0, totalPanes - includedPanesThreshold)

windowPrice = basePrice[windowType][sizeBand]
              × conditionMultiplier[condition]
              × sidesMultiplier[sides]
              × accessMultiplier[access]
              + (extraPanes × extraPaneRate)

lineTotal = windowPrice × quantity
```

### 3.2 Size band override

If `widthMm`/`heightMm` provided instead of a band: area (m²) = width × height / 1,000,000, mapped to a band (suggested thresholds: small <0.5m², medium 0.5–1.2m², large 1.2–2.2m², xlarge >2.2m² — editable).

### 3.3 Sash restoration — separate path

Priced per sash box, not through the multiplier formula — restoration scope (cords, weights, putty, beads) doesn't scale the same way as paint-only work.

```
sashRestorationPrice = basePrice.sashRestoration[sizeBand]
                       × sidesMultiplier[sides]
                       × accessMultiplier[access]
```

`conditionMultiplier` doesn't apply here — restoration scope is instead captured via add-on toggles (each a flat £, editable):
- Replace sash cords (per box)
- New putty/reglaze (per light or per box)
- Draught-proofing strip
- Repair/replace staff beads
- Repair/replace parting beads

### 3.4 Job-level rollup

```
jobWindowTotal = sum(lineTotal for standard windows)
               + sum(sashRestorationPrice + addOns for restoration windows)

if jobWindowTotal < minimumJobCallout: jobWindowTotal = minimumJobCallout
```

---

## 4. UI requirements

- Window entry form matches existing app patterns/styling (steel blue #1e6497, warm grey, white, Barlow/Barlow Condensed), mobile-friendly.
- "Add window" button; collapsible entries with a summary line (e.g. "Front bay — Casement — Large — £145 × 2").
- Running window subtotal visible at all times, feeding the main job total.
- Settings screen to edit all pricing config values — no code changes needed for rate updates.
- Sash restoration entries show add-on toggles inline once selected.
- Duplicate/quantity field for repeated identical windows.

---

## 5. Reference UK market pricing (2026, inflation-adjusted — sanity-check only, not to hardcode)

Two figures used in the original draft turned out to be stale. Reworked below using current 2026 sources plus an inflation correction where a source looked outdated:

| Type | Small | Medium | Large | XL |
|---|---|---|---|---|
| Fixed pane | £30–40 | £40–55 | £55–75 | £75–105 |
| Casement | £40–55 | £55–75 | £75–100 | £100–140 |
| Sash (sound, 3-coat paint only) | £75–105 | £105–145 | £145–180 | £180–250 |
| Sash (full restoration, per box — cords/putty/beads) | £350–500 | £500–650 | £650–800 | £800–1,000+ |

Notes on the changes from the original draft:
- **Sash sound/paint-only**: the old bottom-of-range figure (£55–75) was anchored to that stale £130 quote scaled down; current UK sources put a straightforward 3-coat sash repaint closer to **£75–130 even at the low end**, so the whole band has moved up.
- **Sash restoration**: this was the biggest miss last time (£150–220 low end). Multiple current 2026 sources converge on **£350–500 as a realistic low end** for a proper refurb (cords, putty, draught-proofing, beads), running up to £800–1,000+ for larger or more involved boxes. The add-on toggles in section 3.3 (cords, putty, draught-proofing, beads) let you build up to these totals rather than guessing one lump figure.
- **Fixed/casement**: nudged up modestly (~10–15%) in line with general 2026 trade day-rate inflation (£200–350/day typical, higher in the South East), rather than any specific stale source.
- Cambridgeshire sits close to the national average — below London/SE (+20–30%) but above the cheapest regions, so these ranges shouldn't need much regional adjustment for you.

---

## 6. Integration notes for Claude Code

- Follow existing file/component structure used for room and exterior calculators — reuse shared components (dropdown, multiplier logic, job total aggregator).
- Persist window entries using the app's existing job data storage pattern.
- Windows appear as their own section in the job summary/export, broken out from rooms and exterior render, with restoration add-ons itemised separately on the quote.
- No hardcoded prices — everything in section 2.2 lives in the same editable config/settings store as the rest of the app's rates.
- Since pricing benchmarks drift and web sources aren't always reliably dated, treat section 5 as a one-time seed only — don't wire the app to re-fetch "market rates" automatically; rates should always be Nicky's own numbers, manually reviewed periodically.
