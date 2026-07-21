# Wallpaper — Wide Vinyl & Mural Types — Feature Spec (v1)

**Status: BUILT & COMMITTED** (2026-07-20, commit `a8e105d`, feature-wall-only per section 2's recommendation, confirmed by Nicky). Matches [estimating-app-edits.md](estimating-app-edits.md) item 13. Verified end-to-end in the static preview: linear-metre/area calc, £0-default Settings rates, £200 minimum floor still applies on top, save/edit round-trip all confirmed working.

**Update 2026-07-21:** Wide vinyl **labour** rate seeded per Nicky — **£18.60/linear m** (the constructionrates.co.uk £13.60/m² labour trade rate × 1.37m roll width; see section 6). `mergeSettings()` treats a saved £0 as "never calibrated" for this field so live installs pick the seed up too; a hand-entered non-zero rate always wins. Vinyl **material** stays £0 — Nicky said material rates aren't needed. Mural rates also remain £0 — he's still looking for a real rate for large digitally printed one-piece murals.

**For:** Nicky Hawkins Painter & Decorator estimating app
**Feature:** Commercial wallpaper types (Wide Vinyl, Mural) alongside the existing domestic roll-based wallpaper calculator.

---

## 1. Purpose

The app's existing wallpaper engine (`roomWallpaperRolls()`, `featureWallWallpaperRolls()`, `calcWallpaperRolls()` in `public/index.html`) assumes domestic rolls: ~10.05m × 0.53m, priced by **roll count** via `wallpaperLabourCost()` (rolls × £/roll rate, from `settings.wpLiningRate`/`wpFinishRate`). That model is wrong for two commercial coverings Nicky is occasionally asked to quote:

- **Wide Vinyl** — comes on wide continuous rolls (~137cm), sold and priced by the **linear metre**, not roll count.
- **Mural** — one-piece, digitally printed to exact wall dimensions. Priced by **area (m²)**, no roll/pattern-match math at all.

This spec adds both as alternate calculation paths, without touching the existing domestic roll engine.

---

## 2. Scope decision — needs Nicky's call before building

**Open question:** should "Wallpaper Type" be a per-room setting (governing every active wallpaper surface — walls, ceiling, feature wall) or a **feature-wall-only** option?

In practice, commercial vinyl/mural jobs are almost always a single feature wall (an office reception wall, a café accent wall) — not a whole room's walls-and-ceiling. Recommendation: scope this to **feature wall only** for v1 — reuses the existing feature-wall toggle/measurement fields, and skips having to reason about lining+finish mixed with vinyl/mural on the same room. Domestic rooms keep using the roll engine for walls/ceiling regardless of what the feature wall is doing (same independence the app already has between wall/ceiling/feature-wall wallpaper today).

If Nicky wants full walls+ceiling vinyl/mural coverage too (e.g. a commercial unit with vinyl on every wall), flag that back — it's a bigger change (the type selector would need to live per-surface, not just on the feature wall).

The rest of this spec assumes **feature-wall-only** scope.

---

## 3. Data model

### 3.1 Room fields (new, alongside existing `featureWallWidth`/`featureWallHeight`)

```
{
  fwWpCommercialType: "none" | "wideVinyl" | "mural",   // default "none" = existing roll behaviour
  fwVinylRollWidthCm: number,   // default 137, editable per-room (some suppliers run 122 or 150)
  fwMuralPriceMode: "perArea" | "flat"                  // only relevant when type === "mural"
}
```

When `fwWpCommercialType !== "none"`, it **replaces** the feature wall's existing `fwWpLining`/`fwWpFinish` roll calc (mutually exclusive — a feature wall is either domestic paper or a commercial type, never both).

### 3.2 New Settings fields (Settings screen, same `field-row` convention as existing wallpaper rates)

```
{
  wpVinylLabourRatePerM:   0,   // £/linear metre, labour only
  wpVinylMaterialRatePerM: 0,   // £/linear metre, material — kept separate so Nicky can update supplier cost without touching labour
  wpMuralLabourRatePerM2:  0,   // £/m², used when fwMuralPriceMode === "perArea"
  wpMuralMaterialRatePerM2:0,   // £/m²
  wpMuralFlatFee:          0    // £, used when fwMuralPriceMode === "flat" (labour+material combined — murals quoted flat don't split the two)
}
```

All default to `0` (same "starts blank, Nicky fills in real numbers" convention as the rest of Settings) rather than seeding the market-rate estimates from section 6 directly into the app.

---

## 4. Calculation logic

Mirrors the existing `wallpaperLabourCost()`/`featureWallWallpaperRolls()` pair — a dedicated function per type, called instead of the roll path when `fwWpCommercialType !== "none"`.

### 4.1 Wide Vinyl

```
function featureWallVinylMetres(r) {
  var w = +r.featureWallWidth || 0, h = +r.featureWallHeight || 0;
  var rollWidthM = (+r.fwVinylRollWidthCm || 137) / 100;
  var drops = Math.ceil(w / rollWidthM);       // same "drops across the width" logic as calcWallpaperRolls, just no pattern-repeat/waste term
  return drops * h;                             // linear metres needed
}

function vinylCost(r) {
  var metres = featureWallVinylMetres(r);
  var labour   = metres * (settings.wpVinylLabourRatePerM   || 0);
  var material = metres * (settings.wpVinylMaterialRatePerM || 0);
  return { metres: metres, labour: labour, material: material, cost: labour + material };
}
```

No pattern-match/waste allowance (vinyl feature walls are typically plain or non-repeating commercial patterns) — if Nicky needs pattern-match on vinyl later, this is the function to extend.

### 4.2 Mural

```
function featureWallMuralArea(r) {
  var w = +r.featureWallWidth || 0, h = +r.featureWallHeight || 0;
  return (w * h) / 1; // featureWallWidth/Height are already stored in metres elsewhere in the app — confirm units match existing feature-wall fields before wiring in
}

function muralCost(r) {
  if (r.fwMuralPriceMode === 'flat') {
    return { area: featureWallMuralArea(r), cost: settings.wpMuralFlatFee || 0 };
  }
  var area = featureWallMuralArea(r);
  var labour   = area * (settings.wpMuralLabourRatePerM2   || 0);
  var material = area * (settings.wpMuralMaterialRatePerM2 || 0);
  return { area: area, labour: labour, material: material, cost: labour + material };
}
```

### 4.3 Wiring into `calcRoom()`

At the point `calcRoom()` currently calls `wpSurfaceResult(...)` for the feature wall (around `public/index.html:2649-2656`), branch on `r.fwWpCommercialType`:

```
var fwResult = (r.fwWpCommercialType === 'wideVinyl') ? vinylCost(r)
             : (r.fwWpCommercialType === 'mural')     ? muralCost(r)
             : /* existing wpSurfaceResult(...) path, unchanged */;
```

The existing £200 wallpaper minimum floor (`wpMinFloor`, `public/index.html:2691-2694`) should still apply on top of whichever path ran — a small vinyl/mural feature wall shouldn't undercut the £200 floor either.

---

## 5. UI requirements

- Where the feature wall's wallpaper toggle currently lives, add a 3-way segmented control **"Wallpaper Type"**: Standard / Wide Vinyl / Mural — same `.seg`/`.seg-btn` markup pattern as `#seg-wpw`/`#seg-wpc`.
- Selecting **Wide Vinyl** shows: roll width input (default 137cm, editable) — reuses `featureWallWidth`/`featureWallHeight` already on screen, no new dimension inputs needed.
- Selecting **Mural** shows: a Standard/Flat toggle (`fwMuralPriceMode`) — reuses the same W×H fields, no pattern-repeat/roll-length/spare-roll rows (hide those, they're meaningless for a mural).
- Selecting **Standard** (default) shows exactly today's feature-wall lining/finish UI, unchanged.
- Settings screen: new field-rows for the five rates in section 3.2, grouped under the existing Wallpaper section, same `field-row`/`<small>` hint convention as `s-wpliningrate`/`s-wpfinishrate`.
- Summary/quote breakdown: show a "Feature wall (Wide Vinyl)" or "Feature wall (Mural)" line instead of "Feature wall wallpaper" when a commercial type is active, so Nicky can see at a glance which pricing path was used.

---

## 6. Reference pricing (starting point only — NOT to hardcode, Settings start at 0)

Carried over from the original edit-list draft, for Nicky's reference when filling in the Settings rates above — not wired into the app directly:

*Labour:* commercial wallcovering specialist rates in the UK run roughly £22–£26/hour. Wide vinyl hang time is slower per metre than standard paper (heavier/stiffer) — no reliable per-metre industry standard found; treat as ~1.5–2x standard paper's time-per-metre until timed on 1–2 real jobs. Murals: budget a largely fixed install time (3–5 hours for a typical single feature wall) rather than scaling per m².

*Materials:* printed vinyl wall graphics (laminate finish) roughly £36+/panel, a typical 3m×2.5m office feature wall running £150–£300 in material. Printed wallpaper murals start around £23, scaling steeply with size/resolution/finish. Wide vinyl £/metre material cost not reliably found — get a real quote from a UK trade supplier (Muraspec, Newmor, Omexco, or similar).

**Still to be defined before going live:** actual timed labour rate per metre (vinyl) and per mural, from Nicky's own jobs; real material £/metre from a trade supplier; final decision on section 2's scope question.

---

## 7. Integration notes for Claude Code

- Follow the existing feature-wall code path exactly — this is an alternate branch inside `calcRoom()`, not a new module (unlike Kitchen, which is its own tab/screen; this is closer in shape to how the sash-restoration path already branches inside the Exterior window calc).
- No hardcoded prices — every rate lives in Settings per section 3.2, defaulting to 0 like the rest of the app's not-yet-calibrated rates.
- Resolve section 2's open scope question with Nicky before writing any code.
