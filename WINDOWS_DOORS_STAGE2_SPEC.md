# Windows and Doors Fixture: Stage 2 Spec

NH Estimator. Handoff for Claude Code. Builds on `WINDOWS_DOORS_SPEC.md` (stage 1, complete).

**Status: BUILT (v2.85.0).** See "Implementation notes" at the end for where each part lives and the calls made where the spec left room.

## 1. Summary

Stage 1 ties the elevation drawing to three fixed styles (Georgian, Victorian, Modern). Real houses mix features: a Georgian terrace in buff brick with dormers, a Victorian villa with bays and a front gable, and so on. Stage 2 makes the drawing configurable so it matches the actual house, and adds three things that affect what gets priced: **dormers**, **lower ground floors** and **bay windows**.

Principle: **period is a starting point, not a lock.** Picking a period applies sensible defaults; every option can then be changed per job.

Reference case: a late Georgian terrace in buff brick, visible pitched roof with a row of dormers, 6-over-6 sashes, pedimented doorcases with radial fanlights, front railings. It must be reproducible with: Georgian, buff brick, terraced, pitched roof, dormers on, pedimented doorcase.

## 2. What affects pricing vs what is cosmetic

| Change | Affects pricing? |
|---|---|
| Dormer windows | Yes, they are openings |
| Lower ground floor openings | Yes, they are openings |
| Bays | Yes, a bay contains several windows plus its own painted parts |
| Property form hiding sides | Indirectly, hidden sides have no openings |
| Wall finish, roof, doorcase, heads, glazing pattern, brick detailing | No, drawing only |

## 3. Appearance settings

Replace the single `style` value on `job_property` with an `appearance` jsonb. Keep `style` readable for existing jobs and map it on load:
`georgian` → period `georgian` with Georgian defaults, `victorian` → period `victorian` with Victorian defaults, `modern` → period `modern` with Modern defaults. Existing drawings must look unchanged after migration.

```json
{
  "period": "georgian | victorian | modern",
  "finish": "stucco | buff_brick | gault_brick | render | painted_brick",
  "form": "detached | semi | end_terrace | mid_terrace",
  "exposed_side": "left | right",
  "roof": "parapet | eaves_to_street | front_gable",
  "georgian": {
    "doorcase": "pedimented_radial | plain_fanlight | portico",
    "heads": "gauged_brick_arch | plain",
    "glazing": "6_over_6 | 8_over_8",
    "band_courses": true,
    "railings": true
  },
  "victorian": {
    "sash": "1_over_1 | 2_over_2 | margin_lights",
    "heads": "stone_keystone | brick_arch",
    "entrance": "recessed_arched_porch | open_with_canopy | gabled_timber_porch",
    "bargeboards": true,
    "brick_detailing": "plain | polychrome_bands"
  }
}
```

### Period defaults

| Setting | Georgian | Victorian | Modern |
|---|---|---|---|
| finish | stucco | buff_brick | render |
| roof | parapet | eaves_to_street | eaves_to_street |
| form | mid_terrace | semi | detached |
| period options | pedimented_radial, plain heads, 6_over_6, band courses, railings | 2_over_2, stone_keystone, recessed_arched_porch, no bargeboards, plain | none |

Changing period applies that period's defaults but asks first if any options were changed by hand.

### Wall finishes (drawing)

- **stucco:** cream with fine ashlar lines; rustication on the ground floor only when period is Georgian.
- **buff_brick:** the current stock brick pattern.
- **gault_brick:** paler, greyer buff than stock.
- **render:** plain cream, no lines.
- **painted_brick:** brick pattern in off-white.
- No red brick. Polychrome bands use cream or grey against buff, not red.

### Property form

- **detached:** all four sides available.
- **semi:** Front, Back and one side (`exposed_side`).
- **end_terrace:** Front, Back and one side (`exposed_side`).
- **mid_terrace:** Front and Back only. Neighbouring houses drawn faintly at each edge of the elevation so it reads as a terrace.
- Hidden sides are removed from the side selector. If a side being hidden has openings, warn and require confirmation; its openings and marks are deleted.

### Roof

- **parapet:** as stage 1 Georgian.
- **eaves_to_street:** pitched roof seen from the eaves side.
- **front_gable:** a gable facing the street on the Front elevation; bargeboards drawn if `victorian.bargeboards` is on.
- Chimneys: on for Georgian and Victorian, off for Modern. No separate setting in this stage.

## 4. New levels: dormers and lower ground

Per side, in the layout setup, two new toggles:
- **Dormers** (only when roof is not `parapet`): adds a roof level above the top floor with its own window count. Doors not allowed on this level.
- **Lower ground floor:** adds a level below Ground with its own window and door counts. Drawn below pavement level with a light well and railings along the top.

### Data model

Add a `level` column to `job_openings`: `lower_ground`, `standard`, `roof`. The existing `floor` int is used only for `standard` levels (0 = ground). Existing rows become `standard`.

The layout jsonb per side gains:
```json
{ "lower_ground": { "windows": 2, "doors": 1 } | null,
  "roof": { "windows": 3 } | null }
```

### Labels

- `Front, lower ground, W1`
- `Front, dormer, W2`

### Dormer elements

Dormer windows use the normal window detail view. Add frame elements for the dormer surround: `dormer_fascia`, `dormer_cheek_left`, `dormer_cheek_right`. Actions as for window frame parts.

## 5. Bays

A bay is a new opening kind that contains child windows.

### Data model

On `job_openings`:
- `kind` gains `bay`.
- New columns: `bay_shape` (`canted`, `square`), `bay_storeys` (1 or 2), `parent_opening_id` (FK, null for normal openings).

Creating a bay creates child window rows: 3 per storey (left, front, right), each with `parent_opening_id` set and its own type, size, panes and prep. A two-storey bay is created on its ground floor position and also occupies the same position on the floor above. The layout counts it once, on the floor where it starts.

### UI

- In layout setup, each floor gets a **Bays** count alongside Windows and Doors (Victorian default: visible; Georgian and Modern: available but collapsed).
- Tapping a bay on the elevation opens a **bay view**: a plan-style strip showing its left, front and right windows per storey, plus the bay's own parts. Tapping a window there opens the normal detail view.
- Labels: `Front, ground floor, B1 front`, `Front, ground floor, B1 left`.

### Bay elements and pricing

- Bay-level frame elements: `bay_cornice`, `bay_fascia`, `bay_mullion_left`, `bay_mullion_right`, `bay_cill`. Actions as for window frame parts.
- Rates page: **bay base minutes** by shape and storeys (covers cornice, fascia and mullions), on top of the child windows' own pricing.

### Drawing

- **canted:** angled side windows drawn foreshortened, with a small hipped roof (slate or lead-coloured) on top.
- **square:** flat-fronted box with short return sides.
- Two-storey bays run through both floors with a single roof on top.

## 6. Drawing improvements

- **Actual pane layouts on the elevation:** once an opening has rows and columns set in its detail, the elevation draws that layout. Openings without detail keep the period default glazing.
- **Georgian gauged brick arches:** drawn as a flat fan of voussoirs above the window when `heads` is `gauged_brick_arch` and the finish is brick.
- **Victorian sash horns:** drawn on the upper sash for 1-over-1 and 2-over-2.
- **Margin lights:** a large central pane with narrow panes around the edge.
- **Doorcases:** pedimented with radial fanlight (stage 1 Georgian), plain fanlight with a simple architrave, and a portico with columns and entablature.
- **Victorian entrances:** recessed arched porch, open doorway with a bracketed canopy, gabled timber porch.
- The report uses the same drawing, so it automatically picks up the job's appearance.

## 7. UI: property panel

Above the side selector in the fixture:
1. **Period**: Georgian, Victorian, Modern.
2. **Finish**, **Form** (with exposed side when relevant), **Roof**.
3. **Details** (collapsed by default): period-specific options from section 3.

Changes redraw the elevation live. Settings apply to every side of the job in this stage.

## 8. Rates page additions

- Bay base minutes by shape and storeys.
- Dormer surround: uses existing frame action minutes; no new constants unless testing shows a need.

## 9. Out of scope for this stage

- Per-side appearance overrides (see open questions).
- Photos on openings.
- Red brick finishes.

## 10. Open questions

- **Per-side overrides:** backs of houses are often plainer or in a different finish. Allow finish and roof to be overridden per side?
- **Oriel windows:** bays on upper floors only, with no ground floor support. Same `bay` kind with a `start_floor`, or skip?
- **Dormer styles:** gabled, hipped or flat-roofed dormers drawn differently, or one generic dormer?
- **Front gable window:** a gable often has a small attic window in it. Treat as a dormer-level window on gable roofs?
- **Lower ground doors:** often under the front steps. Any need to draw the steps over them?
- **Georgian glazing on upper floors:** top floors often have 3-over-6. Allow glazing per level, or leave it to the per-opening detail?
- **Changing period on a job with marks:** purely cosmetic, so no warning needed unless bays are removed. Confirm.

---

## Implementation notes (v2.85.0)

**Where it lives** — the same three places as stage 1:
- `public/windoors.js` — the appearance vocabulary and defaults (`PERIOD_OPTIONS`, `periodDefaults`, `normaliseAppearance`, `appearanceOf`, `appearanceIsDefault`, `visibleSides`, `attachedEdges`, `roofKindFor`); levels and bays in the layout (`sideLayout`, `floorSlots(windows, doors, bays)`, `bayDefaults`, `bayChildDefaults`, `bayChildPosition`/`bayChildInfo`); the element model (bay parts, dormer surround); pricing (`baseMinutes` for a bay, `liveOpenings`); the words; and the drawings — `elevationSvg` rewritten around the appearance, `detailSvg` gains the dormer surround and the bay view (`bayDetailSvg`). Still pure, still shared by the app, the server and the tests.
- `lib/windoors.js` — lazy schema (`job_property.appearance`; `job_openings.level`, `bay_shape`, `bay_storeys`, `parent_opening_id`, `panes_set`; the slot index now includes `level`), validation, mapping.
- `routes/api.js` — the opening upsert on the new slot; a bay window's parent resolved server-side; delete cascades to a bay's windows; backup export/import and job duplicate carry everything (a bay's windows re-pointed at their bay's new id).
- `public/index.html` — the House card (property panel), the layout editor (Bays per floor, Dormers and Lower ground toggles), the bay view, side hiding, the Rates card's bay minutes and bay paint area, the report PDF.

**Data model calls**
- **A bay window's position says which bay, storey and face it is**: `100 × bay number + 10 × storey + face` (1 left, 2 front, 3 right) — B1's lower front light is 102, its upper right 113. The row labels, sorts and upserts on its slot without looking the bay up, and can never share a slot with an ordinary window (those stop at 20). The upper storey's windows carry the floor above as their `floor`, so they label as *Front, first floor, B1 front*.
- **The slot index** is now `(job, side, level, floor, kind, position)` — lower ground W1 and ground floor W1 are both floor 0. `floor` is 0 on the lower ground and the roof.
- **Two phones making the same bay**: the second phone's bay adopts the first's id (the stage 1 contract); its windows arrive naming a bay id that no longer holds a row, so the server resolves their parent from their position instead. A bay window whose bay has gone prices, paints and reports as nothing (`liveOpenings`), as a mark on a deleted opening does.
- **`panes_set`** marks an opening whose pane layout was set by hand in its detail view (type, rows or columns changed). Until then the elevation draws the period's glazing (so switching Georgian 6-over-6 to 8-over-8 redraws the house) while pricing stays on the opening's own rows and columns — glazing is drawing only, per section 2. New openings take the period's glazing as their rows and columns, so the two agree from the start.
- **`style` is kept** and written as `appearance.period`, so an app shell from before the deploy still draws the right period. A PUT with no `appearance` (such a shell) leaves the stored one alone.

**Drawing calls**
- **Existing jobs** (a `style`, no `appearance`) read as that period's defaults **but detached**: stage 1 offered all four sides and drew no neighbours, and a Georgian job's left and right openings must not vanish behind a terrace it never chose. Checked side by side against the stage 1 module: the houses draw the same. Visible differences are the ones the spec asks for (stucco's fine ashlar lines, sash horns on Victorian 1-over-1 and 2-over-2) plus door numbers lifted clear of their surrounds.
- **Roof by side**: eaves-to-street and parapet roofs show gable ends on Left and Right, as stage 1 did; a front gable shows gables to the front and back and eaves on the sides.
- **Terraces**: neighbours are drawn faintly, one window per floor, with the roof squared off against them. A semi or end terrace's party wall is opposite its open side as you face the front, so from the back it swaps.
- **Chimneys** keep stage 1's colours (Victorian buff-brick stacks as before); everything else is drawn in the wall's finish. No red anywhere: gauged arches and brick arches are a deeper shade of the finish, polychrome bands cream on buff and grey on gault or painted brick.
- **Lower ground**: below the pavement line, shaded as a light well, with railings along the top and a stone bridge across the well to each ground-floor door.

**Pricing calls**
- **Bay base minutes** default canted 90 / 160 (one / two storeys), square 70 / 125, on Rates; × the bay's own prep, like any painted opening. The bay's windows are ordinary windows with their own type, size, panes and prep.
- **Bay paint**: 1.2 m² of timber per storey (Rates › Paint areas › Bay timber), painted with the windows' product and colour. It's not in the spec — without it a bay's cornice, fascia and mullions would buy no paint.
- **Dormer surround**: no new constants, as the spec says; its three parts take the frame actions.

**Answers to the open questions, as built**
- **Per-side overrides:** not built. Appearance applies to every side.
- **Oriel windows:** bays can be added on any floor. One that starts on an upper floor is drawn standing on the band below it, with no ground support. No `start_floor` column is needed, since `floor` already is one.
- **Dormer styles:** one generic dormer (cheeks, face, small pitched top).
- **Front gable window:** yes. On a side whose roof reads as a gable, the Dormers toggle adds windows drawn in the gable itself (attic windows) rather than dormers. They're the same `roof` level with the same elements.
- **Lower ground doors:** drawn plain, under the bridge across the well; no steps drawn over them.
- **Georgian glazing on upper floors:** left to the per-opening detail (a dormer starts one row per sash — 3-over-3 beside 6-over-6).
- **Changing period on a job with marks:** no warning over marks — it never touches openings. It asks only when options were changed by hand (the spec's rule), and separately when the new period's form would hide a side that has openings. Declining that second question keeps the house's current form and roof but still changes the period.

**Tests:** `npm run test:windoors` (179: stage 2 adds appearance and legacy mapping, levels, bays, pricing, every period × roof × finish drawing cleanly, the bay view, the report, the server's gate, and static checks on the app).
