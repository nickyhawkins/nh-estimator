# The whole exterior on the drawing (Windows & Doors stage 3, and 4)

Status: **step 1 built (v2.96.0)**; steps 2–4 are a draft, not built.

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

Both figures are **totals for 2 coats**, not per coat. Per coat they are:

| Front door, outside face | Exterior form | Windows & doors fixture |
|---|---|---|
| Door leaf | 75 min per coat (Settings: exterior door) | — |
| Frame | 40 min per coat (Settings: exterior frame) | — |
| Door + frame | **115 min per coat → 230 min for 2** | panelled **45 min per coat → 90 min for 2** (the frame is part of the door) |
| Then prep | the item's prep % (0 by default) | × the prep level (Light ×1.10 → 99 min) |
| Raw £ at £300/day, 7h | £164.29 | £70.71 |

So for the same door and frame, before prep, the fixture allows **61% less
time**. These are the shipped defaults: if the live Settings or Rates have
been changed, the live figures differ, and should be checked the same way
before choosing.

**Decided 2026-10-01: (b), 90 min is the closer figure** — the fixture's
door rates stay as they are. For the door that takes longer, each window and
door now has a **time override** (below). A one-door job that would come to
£70 is covered by the existing **Standalone job** toggle, which rounds a small
job up to its diary days. The options were:
- **(a)** The Exterior form's (230 min). Raise the fixture's door tiers to
  match (panelled standard 90 → 230, the other types in proportion).
- **(b)** The fixture's (90 min). Leave rates alone; new door quotes go down.
- **(c)** Another figure: give the minutes and the tiers get set to it.

### Built in step 1 (v2.96.0)
- The Exterior form's *Exterior Doors*, *Garage Doors* and *Porch / Feature
  Door* sections are hidden on any job that doesn't already have doors,
  frames, garage doors or a porch priced there (`extItemHasLegacyDoors`),
  judged separately from the old windows sections. The pointer card names
  what moved.
- **Time override** on every window and door (`job_openings.time_override`,
  minutes for 2 coats before prep and access, NULL = Rates): replaces the
  size/type/panes figure in `Windoors.paintedMinutes`; `ratesMinutes` keeps
  the Rates figure to show beside it. Set from Measure only.
- An Other item named *garage…* starts at the Settings exterior garage
  minutes (150) and paint area (6 m²).

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
- It is split into **three sections — left, middle and right** as you face
  the side (decided 2026-10-01: keeps it simple), so a repair can be marked
  where it is.
- Tap sections, pick an action: **resin repair** (with S/M/L/XL and count,
  as on windows), **splice timber**, **filler**, and for fascia/soffit **soffit
  board replace** (per section). Same quote/variation stages, same tick off
  as done, same "found on site" in the report.
- The label reads *Front, fascia & soffit, left*.

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
| Stone sills (painted) | each, or m | on the windows they sit under |
| Lintels | each | over the windows |
| Window boards | each | — (listed per side) |
| Porch roofs | each | on the porch drawing |
| Gates | each | a tile |
| Fences | m | a tile |
| Meter box, vents, other | each | a tile, like Other items |

All of these confirmed as useful (2026-10-01). Gutters and fences take
left/middle/right marking like runs; downpipes are numbered (*"downpipe 2,
rusted bracket"*). Anything not on this list stays an **Other item** (already built:
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
- **Cutting in around openings is priced** (decided 2026-10-01: it's real
  work). Every opening on a painted wall adds cutting-in minutes by its size
  tier (Rates: e.g. Medium window 10 min, standard door 12 min, per coat),
  whether or not the opening itself is painted. On a render-only job that's
  the time spent working round the windows; on a whole-house job it's still
  there, because the walls and the joinery are separate jobs.

### Pricing
- The Exterior form's masonry rates move here: finish (smooth render,
  pebbledash, brick, stucco), m²/min, coats, access by storey, prep.
- Paint: the masonry product from Settings, as today.
- Then the Exterior form is hidden for new jobs altogether.

---

## Invoice and report

- **Invoice (decided 2026-10-01): walls and woodwork on separate lines by
  default, with a per-job choice made at the quote stage** (it carries
  through to the Xero quote, the client's page and the invoices):
  - **Woodwork and walls** (default): *Exterior woodwork: preparation and
    painting of outside faces, 14 windows, 3 doors, 24m fascia and soffit,
    18m gutters…* and *Exterior walls: preparation and painting of 96m²
    render*.
  - **Full breakdown**: one line per element type — windows, doors, fascia
    and soffit, gutters, each extra, walls — for clients who want to see what
    each part costs. Site additions go on the element's own line.
  - Site additions ride the line they belong to in every layout, and an
    agreed credit comes off it (as now).
- **Report:** runs and extras get their own entries per side, sections with
  work drawn highlighted, "found on site" as for windows. Still no prices.

## Naming

Once it covers more than windows and doors, the screen becomes **Exterior**
(Measure › + › Exterior), and the old Exterior form becomes *Exterior (old)*
on the jobs that still have it.

## Open questions

None at the moment. Answered 2026-10-01: door price (90 min, with a
per-opening override), invoice lines (separate, with a quote-stage choice of
full breakdown), interims on a full-breakdown job (each element line by its
own %), fascia sections (left/middle/right), the extras list (all of them),
cutting in on render jobs (priced, starting at 10 min per window and 12 per
door, per coat).
