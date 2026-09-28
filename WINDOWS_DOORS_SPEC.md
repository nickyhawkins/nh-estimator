# Windows and Doors Fixture: Spec

NH Estimator. Handoff for Claude Code.

**Status: BUILT (v2.82.0).** See "Implementation notes" at the end for where each part lives and the calls made on the open questions.

## 1. Summary

Windows and doors move out of the general Exterior option into their own fixture, **Windows and doors**. Each job gets an illustrated house elevation per side (Front, Back, Left, Right). Windows and doors are set per floor, confirmed, then tapped to open a detail view where individual panes and frame parts can be marked for extra work.

Detail can be added at quote stage (obvious issues) or on site (issues found once work starts). On site additions become variations that go through the existing client approval flow. An automatic report shows what was done where, with diagrams.

Faces: **outside only**. Inside faces of windows and doors stay in the room measures.

## 2. Decisions (settled)

- The quote is the floor. Per-opening detail only adds cost, never lowers it.
- Prep level is set as a job default. An individual opening can go up from the default, never down.
- Every mark records the stage it was made in: `quote` or `variation`. Quote-stage marks are part of the quote. On site marks are variations.
- Individual detail (pane and frame marking) is a per-job toggle. New windows are straightforward; old windows are where unknowns arise.
- Multi-select: a selection is either all panes or all frame parts, never mixed. Tapping the other kind starts a fresh selection. Applying an action clears the selection.
- The report is generated automatically and shows only what was done. No per-opening prices. The invoice keeps a single total line for the fixture.
- The one existing job with windows in the Exterior section is converted by hand. No migration code. Hide the old exterior window option for new jobs; leave existing data untouched.

## 3. Data model

Add to `db/setup.sql`. Names are suggestions; follow existing conventions.

### `job_property`
One row per job that uses the fixture.

| Column | Type | Notes |
|---|---|---|
| job_id | FK | unique |
| style | text | `georgian`, `victorian`, `modern` |
| detail_enabled | bool | per-job toggle for pane/frame marking |
| default_prep | text | job default prep level |
| layout | jsonb | per side: array of floors, each `{windows: n, doors: n}`, plus `confirmed` flag per side |

### `job_openings`
One row per window or door.

| Column | Type | Notes |
|---|---|---|
| id | pk | |
| job_id | FK | |
| side | text | `front`, `back`, `left`, `right` |
| floor | int | 0 = ground |
| kind | text | `window`, `door` |
| position | int | 1-based, left to right as you face that side |
| nickname | text null | optional, e.g. "landing", "above porch" |
| type | text | windows: `casement`, `sash`, `fixed`. Doors: `panelled`, `flush`, `half_glazed`, `fully_glazed`, `stable`, `french_double` |
| size_tier | text | windows: `small`, `medium`, `large`, `xlarge`. Doors: `standard`, `oversized` |
| rows | int | pane rows (per sash for sash windows) |
| cols | int | pane columns |
| prep_level | text | defaults to job default, can only be raised |
| prep_stage | text | `quote` or `variation`, stage the prep was raised in |

Changing type, rows or cols clears that opening's marks (with a confirm prompt if marks exist).

### `opening_marks`
One row per marked element.

| Column | Type | Notes |
|---|---|---|
| id | pk | |
| opening_id | FK | |
| element_id | text | see element IDs below |
| action_key | text | FK to action on Rates page |
| stage | text | `quote` or `variation` |
| variation_id | FK null | set when stage is `variation` |
| created_at | timestamp | |

Element IDs:
- Window panes: `pane-N`, or `top-N` / `bottom-N` for sash
- Window frame parts: `head`, `left_stile`, `right_stile`, `bottom_rail`, `meeting_rail` (sash only), `cill`
- Door elements: `panel-N`, `glass-N`, `stile_left`, `stile_right`, `top_rail`, `bottom_rail`, `frame`, `threshold`

All three tables sync offline like the rest of the On Site data (sync-dot behaviour unchanged).

## 4. Rates page

All new constants go on the Rates page, not Settings.

- **Window base minutes by size tier** (Small, Medium, Large, X-Large). Show the area guide on each tier button: under 0.5m², 0.5 to 1m², 1 to 2m², over 2m².
- **Minutes per pane** (covers glazing bar cutting in).
- **Type adjustment** for sash and casement (sash has more parts to paint).
- **Door base minutes** by type and size tier.
- **Prep multipliers** per level (e.g. Light, Standard, Heavy, Restoration).
- **Actions**, each with minutes and an optional material cost:
  - Pane actions: Reputty, Replace glass (default glass cost per pane)
  - Frame actions: Filler, Resin repair, Splice timber
  - Door actions: same frame actions, plus Ironmongery off and on

## 5. Pricing

Per opening:

```
opening_minutes = (base_by_tier_and_type + panes × minutes_per_pane) × prep_multiplier
                + Σ mark action minutes
opening_materials = Σ mark material costs, with job markup % applied
```

- Minutes feed the job's labour time and convert through the day rate, the same way existing time constants (e.g. kitchen strip-coating minutes) do.
- Paint materials for the fixture follow existing product rates.
- **Variation value** = labour and materials from `variation` stage marks, plus any prep raised on site: `(opening base) × (new multiplier − previous multiplier)`. Nothing is ever subtracted.

## 6. UI

### Fixture: quote stage
1. Choose style: Georgian, Victorian, Modern (per job).
2. Pick a side. Set number of floors, then windows and doors per floor. Doors default to ground floor only but can be set on upper floors (balconies, Juliets).
3. Confirm layout. Openings become tappable.
4. Tap an opening to set type, size tier, pane layout and prep. If detail is enabled, panes and frame parts can be marked (stage = `quote`).
5. "Edit layout" unlocks the side again. Reducing a count removes the openings from the end of that floor, with a warning if they have marks.

### On Site tab
- Same elevation and detail views.
- New marks and prep increases are stage `variation`.
- Quote-stage marks are shown but locked.
- Variation marks collect into a draft "Windows and doors" variation until sent for approval. After sending, new marks start a new draft.
- The draft variation description is generated automatically from the marks and can be edited before sending, e.g. `Front, first floor, W2: reputty x4 panes, resin repair (cill).`

### Detail view
- Header: auto label ("Front, first floor, W2") plus nickname if set.
- Type segmented control, rows and columns steppers, size tier, prep selector (levels below the job default hidden).
- Tappable diagram: panes and frame parts. Tap toggles selection (tick shown). "Select all panes" and "Clear selection" buttons.
- Action buttons show only for the selected kind, plus "Remove work".
- Colours: glass replacement and other work shown differently. Quote-stage marks are solid; variation marks are outlined or dashed.
- Line list of added work for this opening underneath.

### Elevation drawing
Drawn procedurally as SVG from the layout. Reference: the chat mockups.
- **Georgian:** stucco, rusticated ground floor, parapet and cornice over a low slate roof, end chimney stacks, 6-over-6 sashes, tallest windows on the first floor, black panelled door with fanlight, pilasters and pediment, front railings.
- **Victorian:** yellow stock brick, pitched slate roof with chimneys, 2-over-2 sashes with stone heads and keystones, green door with glazed upper panels under an arched surround.
- **Modern:** white render over a grey brick ground floor, anthracite casements, grey composite door with canopy, glass Juliet balcony for upper doors, concrete tiled roof, no chimneys.
- Left and Right sides draw as a gable end.
- Glazing on the elevation is decorative only. The real pane layout comes from each opening's detail.
- Openings scale with size tier.
- Markers on each opening: solid badge = quote-stage work, dashed badge = variation.
- Openings numbered left to right as you face that side (W1, W2 and D1, D2 counted separately per floor).
- Use the app palette (steel blue #1e6497 accents, Barlow) for UI chrome around the drawing.

## 7. Report

- Generated automatically for any job using the fixture that has marks or raised prep.
- Contents:
  - Elevation diagram for each side with work, highlighting the affected openings.
  - Detail diagram for each opening with work, showing marked panes and parts. Openings with no work are left out.
  - For each opening, a list of the work, split into quoted work and approved variations (with approval date).
- No prices anywhere in the report.
- Shown on the client-facing variation page and available as a PDF export for attaching to the Xero invoice.
- Invoice keeps a single total line for the Windows and doors fixture.

## 8. Quote and invoice text

The fixture's item line text should reflect what's included (ties into the existing spec for detailed item text), e.g. `Exterior windows and doors (outside faces): 8 sash windows, 1 front door.` Quote-stage marked work can be summarised briefly in the description.

## 9. Open questions

- **Bays:** Victorian bay windows don't fit a flat elevation. A dedicated `bay` opening type drawn as a canted bay?
- **Lower ground floor:** add a "Lower ground" floor below Ground for Georgian terraces with basements?
- **Misc slot per side** for garage doors, fanlights, porches and lean-tos that don't sit on a floor?
- **Roof style:** per-job gable or hipped setting, separate from style?
- **Sash-specific elements:** cords, beads, pulley stiles, ironmongery as tappable elements or actions?
- **Door extras:** easing or rehang as an action?
- **Ticking off on site:** should marks be tickable as done (like snags) and feed the report only when done?
- **Numbering on the back elevation:** left to right facing the back reads reversed from inside. Keep as is or flip?
- **Report PDF:** attach to the Xero invoice automatically, or only when chosen at invoicing?
- **Prep levels:** confirm the list (Light, Standard, Heavy, Restoration) and default multipliers.

---

## Implementation notes (v2.82.0)

**Where it lives**
- `public/windoors.js` — the shared module: vocabulary, rate defaults, element model, pricing (`priceJob`), words (labels, variation text, item line), the SVG elevation and detail drawings, and the report. Loaded by the app (`<script>`), required by the server and by `scripts/test-windoors.js`. Pure — no DOM, no prices in the drawing or report path.
- `lib/windoors.js` — lazy schema, validation, the per-job read and the report loader. `db/setup.sql` carries the documentation copy.
- `routes/api.js` — `GET /api/windoors`, `PUT /api/windoors/property`, `PUT|DELETE /api/windoors/openings/:id`, `PUT|DELETE /api/windoors/marks/:id`, `GET /api/jobs/:id/windoors-report` (printable page — the PDF comes from the phone's print/share sheet). Job delete, Clear All, backup export/import and job duplicate all cover the three tables (duplicate copies the quote stage only).
- `routes/publicQuote.js` — the report card on the client's variation page.
- `public/index.html` — the Windows & Doors screen (Measure › + › Windows and doors, and On Site › Windows & doors), the detail sheet, the Rates card, and the wiring into Summary, the client quote, the accepted snapshot, the Xero quote (as one exterior line), the final invoice, and every variation path (kind `windoors`).

**Schema additions beyond the spec's tables**
- `job_openings.quote_prep_level` and `prep_variation_id`: the level the quote priced before an on-site raise, and the draft the raise belongs to — needed to price "new − previous" and to attribute it.
- `opening_marks.job_id`: per-job reads and cleanup without a join, same as every other table.
- No foreign keys (the snags convention): a stray mark on a deleted opening prices as nothing rather than failing an offline replay. Openings upsert on their slot `(job, side, floor, kind, position)` so two phones confirming the same side converge on one W2.

**Variations.** Each draft lives on `jobs.data.windoorsVariations` as a carrier with the standard sign-off fields; marks and prep raises point at it by id. It publishes as kind `windoors`, priced like measured labour (sundries share + markup). Sending for approval, or answering by hand/on the link, closes the draft; the next site mark starts a new one. Marks on an answered variation are locked. Variation money is never inside the fixture's quote total, so it is never subtracted from original scope.

**Calls made where the spec left room**
- Prep multipliers default to Light ×1.10, Standard ×1.25, Heavy ×1.40 (matching the exterior form's v2.81.1 levels) and Restoration ×1.75. Still an open question to confirm.
- Material £ on marks joins the fixture's raw total, so it takes the job's markup through the same line multiplier as the labour (and, like everything else in that base, the sundries %).
- On site, type/size/pane layout are read-only: changing them could lower the quote, which is the floor.
- Door glass counts as panes (pane actions, per-pane minutes); door panels count as parts (frame actions). Ironmongery is a door-only part action.
- The old Exterior window/sash sections are hidden on any job that doesn't already have windows priced there; a pointer to the fixture shows instead.
- Paint materials (v2.83.0): coats + a windows colour and a doors colour on `job_property`; litres from the TIMBER only (v2.83.1): the tier's own area × a timber share per type (+ per extra pane, capped), doors leaf × timber share + frame — all on the Rates card — × coats ÷ exterior woodwork coverage, primer at 0.8 — pooled into the Exterior Woodwork / Exterior Primer rows. Product follows the Settings exterior woodwork default.
- Open questions 1–10 are not built; the elevation numbering on the back is left to right facing the back, as specified.
