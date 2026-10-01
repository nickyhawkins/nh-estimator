# The whole exterior on the drawing (Windows & Doors stage 3, and 4)

Status: **draft for Nicky's sign-off** (2026-10-01). Nothing here is built.

Builds on WINDOWS_DOORS_SPEC.md (stage 1), WINDOWS_DOORS_STAGE2_SPEC.md (the
house drawing) and WINDOWS_DOORS_INVOICE_SPEC.md (one invoice line + report).

## Goal

Price the outside of a house from one drawing. Windows and doors already work
this way. Bring in the rest of the exterior woodwork (fascias, soffits,
bargeboards) and the extras (gutters and the like), so they can be marked
where the work is, flagged "found on site", and shown in the work report.
Later (stage 4), bring the walls in too, so render and masonry are measured
from the same sides.

The Exterior form then shrinks to nothing on new jobs. Existing jobs keep
exactly what they have; no quote moves.

## What Nicky said (2026-10-01)

1. Not every house gets every element painted. Extras like gutters should be
   optional add-ons. Fascias and soffits are priced together 9 times in 10.
2. One length per side, plus an optional extra metres number for the odd bit.
3. Being able to mark *where* a repair is matters.
4. Render later: enter every side's measurements, include the windows and
   doors, mark them as not painted on a render-only job, and get a
   semi-accurate wall area.

---

## Step 1 — retire doors, frames, garage doors and porches from the Exterior form

The fixture already has all of these: doors by type and size, and garage
doors and porches as Other items. Hide them in the Exterior form on new jobs,
as was done for windows (v2.82.0). A job that already has them priced there
keeps them.

### The prices don't match today (checked 2026-10-01, default rates)

| Same door | Exterior form | Windows & doors fixture |
|---|---|---|
| Front door, outside face | 150 min, £107.14 | panelled 99 min, £70.71 (half-glazed £89.57) |
| Door + frame | 230 min, £164.29 | frame is included in the door |
| Garage door | 150 min, £107.14 | typed in by hand (Other item) |

Raw £ before markup, at £300/day, 7h, light prep. The fixture prices a
panelled front door about **35% cheaper** (57% cheaper if the frame was being
counted separately). Retiring the Exterior doors without fixing this would
quietly cut every new door quote.

**Decision needed before step 1:** which figure is right for a typical front
door, outside face and frame?
- **(a)** The Exterior form's (230 min with frame). Raise the fixture's door
  tier minutes on Rates to match.
- **(b)** The fixture's. Leave rates alone; new door quotes go down.
- **(c)** Somewhere between: give a number and the tiers get set to it.

Also: a Garage door preset for Other items (150 min to start, editable), so
it isn't typed from scratch each time.

---

## Step 2 — runs: fascia and soffit, bargeboards

A **run** is a new kind of element: woodwork measured in metres along a side.

### What there is
- **Fascia and soffit**, priced together as one run (Nicky: 9 in 10). A
  per-job switch splits them into two runs with their own rates for the odd
  job that needs it.
- **Bargeboards**, on a side whose roof shows as a gable.
- Each run belongs to a side, like the windows. On by default where the
  drawing shows one (eaves on the front and back, a gable's bargeboards); a
  side or a run can be switched off ("not painted on this house").

### Measuring
- **One length per side** in metres, typed in (the drawing isn't to scale).
- **+ extra metres**: one number per side for the odd bit (a bay roof, a
  porch fascia). Priced at the same rate, not drawn.

### Drawn and tappable
- The run is drawn along the eaves (or up the gable) of each side's elevation.
- It is split into **sections**, so a repair can be marked where it is. One
  section per metre, numbered from the left as you face the side (the
  windows' rule), shown as "F1, F2…". Up to 12 metres a section each; past
  that, sections of the length ÷ 12.
- Tap sections, pick an action: **resin repair** (with S/M/L/XL and count,
  as on windows), **splice timber**, **filler**, and for fascia/soffit **soffit
  board replace** (per section). Same quote/variation stages, same tick off
  as done, same "found on site" in the report.
- The label reads *Front, fascia & soffit, section 3 (of 9)*.

### Pricing
- Painting: **minutes per metre** on Rates (start at the Exterior form's
  current 16 min/m for fascia), times coats, access and prep — the windows'
  formula, so prep raised on site works the same.
- Access: a run is at the eaves, so it takes the **top floor's** access
  (usually ladder/tower). Settable per side.
- Paint: m² per metre on Rates (fascia + soffit board width), into Exterior
  Woodwork, in its own colour (a third colour on the Paint card: *fascias*).

---

## Step 3 — extras (optional, per job)

An **+ Extras** list on the house, off by default. Each one picked gets a
quantity per side (or for the house) and its own rate on Rates:

| Extra | Unit | Drawn |
|---|---|---|
| Gutters | m (per side) | yes, a line under the fascia |
| Downpipes | each, or m | yes, down the corner |
| Cladding / weatherboard | m² (per side) | as a hatched panel |
| Railings | m | the lower ground's railings already drawn |
| Meter box, vents, other | each | a tile, like Other items |

Gutters and downpipes take section marking like runs (*"downpipe 2, rusted
bracket"*). Anything not on this list stays an **Other item** (already built:
a name, minutes or a set price, materials).

---

## Step 4 (later) — walls: render and masonry

Designed for now, so steps 1–3 don't paint it into a corner.

### Measuring a side
- **Width** and **height to the eaves** in metres per side; a gable adds its
  triangle (apex height, or a pitch). A side that differs gets its own.
- **Gross wall area** = width × height (+ gable).
- **Openings come off**, painted or not: every window and door on the side,
  including those set to *Not in this job* — which is exactly the render-only
  job: the windows are drawn and counted for the area, but not priced for
  painting. Each opening's area comes from its **size tier** (a new *opening
  area* per tier on Rates, e.g. Medium window 1.2 m², standard door 1.9 m²),
  so the wall figure is semi-accurate without measuring every window.
- Lower ground and dormers come off their own walls; a bay adds its faces.

### Pricing
- The Exterior form's masonry rates move here: finish (smooth render,
  pebbledash, brick, stucco), m²/min, coats, access by storey, prep.
- Paint: the masonry product from Settings, as today.
- Then the Exterior form is hidden for new jobs altogether.

---

## Invoice and report

- **Invoice:** one line per area of work, worded from the job:
  *Exterior woodwork: preparation and painting of outside faces, 14 windows,
  3 doors, 24m fascia and soffit, 18m gutters…*; and later *Exterior walls:
  preparation and painting of 96m² render*. Site additions ride the line they
  belong to, as now. (Or everything on one *Exterior* line — question below.)
- **Report:** runs and extras get their own entries per side, sections with
  work drawn highlighted, "found on site" as for windows. Still no prices.

## Naming

Once it covers more than windows and doors, the screen becomes **Exterior**
(Measure › + › Exterior), and the old Exterior form becomes *Exterior (old)*
on the jobs that still have it.

## Open questions

1. **Door price (blocks step 1):** (a), (b) or (c) above?
2. **One invoice line or two** once walls arrive: *Exterior woodwork* +
   *Exterior walls*, or a single *Exterior* line?
3. **Fascia sections:** one per metre, or simpler — left / middle / right
   thirds per side?
4. **Extras list:** anything missing — sills (stone, painted), lintels,
   window boards, porch roofs, gates, fences?
5. **Render-only jobs:** should the windows' frames still be counted for
   masking/cutting-in time (a small per-opening allowance), or nothing?
