# NH Estimator — Feature Roadmap

This document captures planned features for the NH Estimator app, scoped and ready to build. Work through phases in order — each is independently useful and testable.

## Architecture reminder

- **Frontend:** `public/index.html` — single-file vanilla JS app
- **Backend:** `routes/xero.js` (OAuth + quote/contact/item endpoints), `routes/api.js` (rooms, exterior items, settings, HSL)
- **Database:** PostgreSQL on Render (rooms, exterior_items, settings, hsl_state tables)
- **Deploy:** push to GitHub `main` → Render auto-deploys
- **Xero:** connected with `accounting.contacts`, `accounting.settings.read`, `accounting.invoices` scopes

## Key gotchas learned during the build

- **Duplicate functions:** the app has had repeated bugs where an old version of a function survived alongside a new one, with the later definition silently overriding the earlier. When something doesn't behave as expected, grep for duplicate `function X` definitions first.
- **extItems vs old extCost:** exterior items use the `extItems` array + `calcExtItem()`, loaded from `/api/extitems`. Old code used `extCost`/`extTime` globals — make sure any new code (Xero quote, CSV) reads from `extItems`, not the old globals.
- **Data sync:** rooms and exterior items load from the server into memory on init. Render functions should read from the in-memory arrays. Avoid reintroducing localStorage as a competing source of truth.
- **Whole-tin rounding must happen at job level**, not per room, or multi-room jobs over-count tins.

---

## FEATURE: Automatic materials from Xero Items

Pull paint products from the user's Xero account, calculate quantities from the litres already computed per surface, cost them, and place them on the quote as real Xero line items. Feeds the job total and the deposit calculation.

### Xero data structure (confirmed)
- Items are quoted from the **sales account 202** using SalesUnitPrice (202 = sales/what the customer is charged; 311 = purchases/cost account, NOT used for quoting)
- Item example: code `DUL234`, name `Dulux Heritage Velvet Matt Tinted - Tinted 2.5L`, price £40.49 excl tax, No VAT
- **Tin size is in the item name** (e.g. `2.5L`, `5L`, `10L`) — parseable by regex
- Every product has all its tin sizes available as separate items in Xero
- Ceiling and woodwork paints also exist as **per-litre** line items in Xero

### Pricing model (how the user actually quotes)
- **Walls** — charged per tin. Buy/charge by whole tins.
- **Ceiling** — charged per litre. Standard product across jobs.
- **Woodwork topcoat** — charged per litre. Standard, but finish can change on request.
- **Woodwork primer** — charged per litre. Primer volume = topcoat volume × 0.8 (20% less).
- Quote layout: itemised labour sections → materials line break → materials list.

> **NOTE: The detailed materials build is specced in `MATERIALS_SPEC.md`, which SUPERSEDES the old Phase 1/2/3 split that used to live here.** That doc is the authoritative source: range → band → size grouping, supplier-agnostic parsing, per-room colour numbering + product overrides (all four roles, primer "None"), the fifth "mist coat" product, tin optimisation, and the Colours-tab-as-ordering-view. The summary below is kept only as high-level context.

High level: select default products by RANGE (not specific tin) for five roles — wall (per tin), ceiling, woodwork topcoat, woodwork primer, and mist coat (per litre). Parse range/band/size from the consistent Xero item names. Group by (range + band + colour number), tin-optimise per group, feed the total + deposit, and write real Xero item codes onto the quote. See MATERIALS_SPEC.md for the full build order and data model.

---

## FEATURE: Materials editing + sundries (BUILD BEFORE DEPOSIT)

Must come before the deposit feature: the deposit is based on the materials/total, so the total has to be final and adjustable *before* sending — no more editing in Xero after the fact.

### Materials editing (trim the auto-calculations) — this quote only
- **Edit a calculated line's quantity** — override the auto quantity (e.g. 6 tins → 5 or 7 for access/wastage); cost and total follow the new quantity.
- **Delete a line** — remove a calculated material not wanted on this quote (client supplying, paint in stock, etc.); total recalculates without it.
- **Add a one-off specific item** — add a material the model didn't calculate (specialist product), pick the Xero item (or free-text) + quantity; joins the materials total and the Xero quote.
- **Scope: this quote only** — edits are a snapshot, they don't feed back into settings or defaults.
- **Recalculate-from-rooms button** — edits are a snapshot on top of the live calculation; if rooms change afterwards, a visible "recalculate" resets materials to freshly-calculated values (discarding manual edits). Keeps the model simple — no tracking overrides through every recalc.

### Sundries (% of labour)
- **A percentage set in Settings** (editable) applied to the **labour total BEFORE markup** — sundries scale with time on the job, not paint cost. Markup then applies to everything including sundries.
- Covers the general consumables: tape, filler, caulk, floor protection, sandpaper, dust sheets — the long tail Nicky doesn't itemise.
- Anything specific/expensive is still added as its own one-off material line (above), not absorbed into the %.
- **Shows as a labelled line** — e.g. "Sundries & consumables" or "Protection, masking & materials" (a plain "Sundries" with a big number invites client questions; a descriptive label reads as value). Consider showing it among the materials lines rather than standalone so it looks like a normal part of the job. Start visible; revisit if it draws questions on real quotes.
- Feeds the materials/total and therefore the deposit; goes onto the Xero quote as its own line.
- Typical decorating sundries land ~3–8% of labour, but Nicky sets the real figure in settings and calibrates.

### Calculation order (important)
labour (before markup) → sundries = labour × sundries% → materials (calculated, then edited/trimmed) → subtotal = labour + sundries + materials → markup applied → deposit calculated on the marked-up total. Get this order right so sundries is on raw labour and the deposit is on the true final figure.

## FEATURE: Realistic time estimate (scheduling — BUILD BEFORE DEPOSIT)

The app calculates **working time** (hands-on hours ÷ day length) — accurate for costing, but not calendar reality. A job at 2.85 working days actually spans more calendar days once drying, floor protection, setup, masking and clearing up are counted. Those non-productive elements are currently only in the markup (cost), not reflected in the *time*.

**This is NOT a costing change** — the quote total stays exactly as-is. It's a parallel "realistic duration" figure for scheduling, shown alongside working time:
- **Working time** — e.g. 2.85 days (drives labour/cost, unchanged)
- **Estimated on site** — e.g. ~4 days (what to block out in the diary)

### Approach — per-day overhead + optional buffer
- **Per-day overhead** (Settings, editable) — a fixed non-productive allowance per day on site (setup, protection, masking, cleanup — say 45–60 mins). Reduces effective productive hours/day, which stretches calendar days. Scales correctly: more days = more accumulated setup/cleanup.
- **Optional buffer multiplier** (Settings) — a modest × for drying/slippage on top, if wanted.
- Keep it to "realistic days on site" — don't try to model drying times precisely or manage the diary; that's calendar territory.

### Why it must come before the deposit feature (KEY LINK)
The staged-payment logic keys off job length — and it must use REALISTIC time, not working time. Example: 6.85 working days looks like just over one week, but realistically spans **two working weeks**, which is exactly when weekly staged payments apply. If the payment logic used raw working days it could treat a two-week job as single-week and miss the staging.

Chain for staged payments: working time → realistic time (× overhead/buffer) → working weeks (realistic days ÷ 5, or however weeks fall) → number of weekly payments.

### Client-facing (optional)
Having the realistic duration to hand is also better for telling the client "about a week" — the raw working time would sound too short and set wrong expectations.

## FEATURE: Deposit & staged payments

Depends on materials AND materials-editing/sundries above AND the realistic time estimate above, so the deposit is based on the true adjusted total, and the staged-payment schedule is based on realistic job length (not working days).

1. **Deposit calculation on summary:**
   - Default 25% (editable in settings)
   - **"25% of quote OR cost of materials/sundries, whichever is GREATER"** — this matches Nicky's existing Terms wording ("25% of quotation or cost of materials, sundries and equipment, whichever the greater"). So compute both 25% of the marked-up total AND the materials+sundries cost, and take the higher. Needs materials to feed the total (hence the dependency).
   - Show: Total, Deposit due on acceptance (and which basis applied), Balance

2. **Two job types:**
   - **Single payment** — deposit + balance on completion
   - **Multi-week** — the number of weeks is DERIVED from the realistic time estimate (realistic days ÷ working week), not entered blind or taken from working days. Split the balance (after deposit) evenly across weekly payments. Show deposit + N weekly instalments. User can override the auto-derived week count if needed.

3. **Optional** — write payment terms as a line into the Xero quote (terms/notes field). Actual weekly invoicing stays in Xero.

---

## FEATURE: Colour reference library (nice-to-have, low priority)

The Colours tab lets each colour number carry a name (e.g. colour 1 = "Dimity"). Enhancement: autofill colour names/codes as you type, to help with ordering (exact names and codes to hand for the merchant).

Approach — personal growing list, seeded with the two main brands:
- Store each colour as `{ name, brand, code }`.
- **SEED with Farrow & Ball and Little Greene full ranges** (name + code) — these cover ~90% of colours Nicky uses, are manageable in size (~130 each), and are the brands where exact name/code matters most for ordering.
- As you type a colour name on the Colours tab, autofill brand + code from the library.
- For colours not in the seed (the other ~10%), add on first use — the app remembers them, so the personal list grows over time. No need to source a full cross-brand database.
- Fallback: if a typed colour isn't known, accept it as free text and offer to save it (name/brand/code) for next time.

Data notes:
- Big trade brands (Dulux etc.) are usually colour-matched anyway, so not worth seeding wholesale — the personal-list approach handles them.
- Colour label is reference/ordering only; the colour NUMBER still drives the materials calculation (see MATERIALS_SPEC.md).

Priority: low. Build after materials + deposit are done. Genuinely useful for ordering, but not day-to-day critical.

## FEATURE: Multiple saved jobs (structural — build AFTER materials + deposit)

Right now the app holds ONE working job at a time (one set of rooms, exterior items, colours). Doing two surveys in a day means manually combining them into one session and separating later. This makes jobs first-class: save a job, start another, come back to either to tweak before committing to Xero.

### The core change
Everything that's currently "the current job" — rooms, exterior items, colours, sundries, materials edits, client/reference fields — becomes per-job. **Settings stay GLOBAL** (rates, coverage, product defaults, sundries % = business config, not per-job).

### What it needs
- **Jobs list screen** — list saved jobs (name, date, maybe client); open / create / delete.
- **Save & switch** — creating or switching persists the current job and loads the other.
- **Job identity** — each job has a name (client / address / reference) to tell them apart.
- **Everything scopes to the active job** — rooms, exterior, colours, materials all belong to the currently open job. The existing load-into-memory pattern becomes "load THIS job's rows into memory."
- **Send to Xero stays per-job** — commit whichever job is open.

### Database
Significant but not huge: add a `jobs` table, and a `job_id` column to rooms, exterior_items, colours (and any other per-job tables) so rows belong to a job. Settings table stays global (no job_id).

### Sequencing (important)
Build AFTER the current materials refinements and the deposit feature — get the single-job flow completely solid first. This is a structural change touching all data handling; doing it while materials logic is still settling risks tangling two big things at once (the cause of earlier bugs). It layers cleanly on top: once single-job is right, wrapping it in "which job am I working on" is additive, not a rewrite. Materials/colours/quote logic don't change — they just operate on the active job.

### Open design question
Are jobs fully separate (each its own everything, no overlap), or do you want to **duplicate a job as a template** to tweak? The second overlaps with the "Job templates" idea below (standard 3-bed repaint etc.) — if templates are wanted, multiple-jobs is the natural foundation for them (a template is just a job you copy). Decide before building: fully-separate is simpler; duplicate-to-template is a nice touch and reuses the same machinery.

## FEATURE: HSL alignment with the room system

The HSL (halls / stairs / landings) system predates recent changes and has drifted out of step with how regular rooms now work. Two parts: fix a bug first, then align — as SEPARATE tasks (don't tangle them).

### Step 1 — Bug: stray staircase woodwork line (do first, contained)
A "staircase woodwork" line still shows as an extra line on the summary. Likely legacy code from before spindles/newels were rolled into the HSL total (same fingerprint as the old exterior migration — old code surviving alongside new).
- **Investigate before changing:** where is staircase woodwork calculated? Is its value ALREADY in the HSL/labour total, or ONLY in this separate line?
- If double-counted (in total AND separate line) → costing bug, remove the duplicate line.
- If only in the separate line → re-home it into the HSL breakdown.
- **Do NOT just delete the visible line** without confirming its value is accounted for elsewhere — could silently drop a real cost or leave a double-count.

### Step 2 — Bring HSL inline (its own task, after the bug)
Decide scope deliberately — a staircase isn't a room (own geometry: slope calcs, spindles, newels, strings), so full room-parity is NOT the goal. Target scope:
- **UI pattern** — collapsible sections + same visual style as the compacted room tab, so it feels consistent.
- **Trigger from the room add flow, not a separate button/tab.** Lose the dedicated HSL button; instead HSL options surface when adding a room. Two ways, decide when building: (a) a **"staircase / HSL" toggle** in the room form — RECOMMENDED, explicit and predictable, reveals the staircase inputs when on; or (b) a **keyword in the name** (typing "HSL") auto-reveals them — slicker but risks false triggers, so match a specific keyword like "HSL" only, never general words like "hall"/"stairs"/"landing". Prefer the toggle unless the typed-keyword magic is specifically wanted. Either way the staircase form is a DIFFERENT input set (slope/going/rise, spindles, newels, strings as counts), so it swaps in staircase inputs rather than just appending fields to a normal room.
- **Data pattern** — same server-load-into-memory approach, same persistence, no competing localStorage. (Check this — it may have drifted.)
- **Materials integration (the important bit)** — HSL surfaces (stair walls, spindles, newels, strings) must feed the materials calculation and colour grouping like rooms do, so HSL paint flows into the tin calculations, the Colours tab and the Xero quote. WITHOUT this, jobs with significant staircase work under-count paint — the same gap found with mist coats.
- **Stair-wall geometry fix (improves PAINT accuracy; also the geometry the wallpaper calculator reuses).** The real stair wall is an irregular polygon with a stepped bottom edge following the stairs — a full-height section plus a raking section, not a tidy triangle. The current calculation is wrong because it derives width partly from the landing length, which overlaps the stairwell void and double-counts. The fix is small because most inputs already exist — see "What actually changes" below. Reference diagram: `stair_wall_measurement_v2.png`.

  **The method — DERIVE the width, MEASURE the heights.** Width can't be measured across the bottom (stairs in the way) or the top (landing overlap). Instead derive it from floor-level pieces, and take laser height readings at the points the top edge changes. A stairwell is usually a SET of walls (large raking wall, opposite lower wall, narrow head wall) entered as a group. Note stairwell heights can be multi-storey (4m+) — don't assume standard ceiling heights; for wallpaper a 4m+ drop often yields only ONE usable drop per roll.

  **What actually changes (checked against the current app):**
  Already captured in the HSL block: Steps (e.g. 13), Tread (0.22 = the going), Wall height at bottom, plus hall width and landing height (hall/landing are HSL inputs — all local, no cross-room pulling). Landing height = the stair-wall's top/full height.
  - **ADD one input:** top step measurement (completes the width). The only genuinely missing measurement.
  - **CHANGE the width calc:** stair-wall width = hall width + (Steps × Tread) + top step. STOP using landing length for stair-wall width (that's the current double-count error). Landing length stays for the landing's own wall area only.
  - **REUSE:** Steps × Tread (horizontal run — already captured, just not yet wired into width); landing height (top height); hall width.
  - **LABEL clearly:** "stair width" (physical, 0.9m) vs derived "stair wall width".
  - **Build reconstructs** the stepped-bottom shape from derived width + height readings → area for paint (and drop lengths for wallpaper).

  **DELIBERATE SIMPLIFICATION — don't over-engineer.** Stop at full-height / rake / step. Do NOT model finer slope slivers (e.g. a small sloped bit above the first steps) — the difference is tiny and never changes the rounded result (paint rounds to whole tins; Nicky doesn't pay for wallpaper). Round generously instead. Conscious accuracy-vs-usability trade, not an oversight — don't "fix" it later by adding slope inputs.
- **NOT full parity** — HSL doesn't need every room option (probably doesn't need per-item colour numbers/product overrides unless wanted); stop short of replicating rooms wholesale.

### Sequencing
Fix Step 1 now (small). Step 2 is a proper alignment task — slot it in deliberately, not off the cuff, because the materials-integration part connects to everything recently built. Confirm the materials flow before/after so HSL paint is counted exactly once.

## FEATURE: Exterior alignment with the interior system ✅ MOSTLY SHIPPED

The exterior section had fallen behind — a long scroll of items, no materials, and some measurements that didn't capture the real work. Brought inline with interior across four parts. Parts 1–3 and the materials side of part 4 are **shipped**; one piece of part 4 (itemising exterior *labour* on the Xero quote) remains — see below.

### 1. Measurement tweaks — SHIPPED
- **Window panes:** panes-per-window input added (per-window `{panes}` records for both casement and sash). Labour scales on pane count via `extWindowMins()`, not just area — a 16-pane Georgian window now costs far more than a 2-pane one.

### 2. UI compaction — SHIPPED
- Exterior form now uses the same collapsible sections as the compacted room tab (`toggleFormSection()`/`resetExtFormSections()`), default open. Replaced the long-scroll list.

### 3. Exterior materials — SHIPPED (2026-07-14)
- REUSED the existing engine, not a new system: `computeRoleGroups`/`buildRoleRows` generalised to take an optional source list (default `rooms`), with exterior roles sourcing from `extItems`.
- **Three new roles:** `masonry` (tin-optimised, added to `TIN_ROLES` alongside `wall`), `extTopcoat` + `extPrimer` (per-litre; primer = topcoat × 0.8, same rule as interior). Default product ranges picked in Settings, same pattern as interior's five roles.
- **Litre estimation from assumed areas:** exterior items only carry counts/lengths, so litres come from an assumed paintable area per unit (new, editable Settings — window/sash/door/garage areas + fascia developed-width + masonry & woodwork coverage), run through the same area × coats ÷ coverage formula. Fascia is treated as woodwork.
- **Two exterior colour numbers per item:** `masonryColourNumber` + `extWoodworkColourNumber` (the latter shared across windows/doors/fascia/sash, mirroring interior's woodwork colour), picked via a "Paint Colours" chip section on the exterior form.

### 4. Integration parity — materials SHIPPED, labour outstanding
- ✅ Exterior materials feed the total, the deposit, the Colours tab (grouped by masonry vs exterior-woodwork colour), and the Xero quote (as real item lines via the materials snapshot) — counted exactly ONCE.
- ⬜ **Outstanding:** exterior *labour* still posts to Xero as a single lump `Exterior Works` line (`routes/xero.js`). Itemising it per surface (like interior rooms) is a separate, larger quote/UI change — not yet done.

### Notes / gotchas
- Part 3 was far smaller than it looked because the engine already existed — mostly wiring `extItems` in, no new calc logic. No duplicate functions or competing localStorage introduced (watched for the recurring extCost/extItems failure mode).
- **Assumed-area defaults are guesses** (masonry 6 m²/L, woodwork 12 m²/L, window 1.5 m², sash 2.5 m², door 2 m², garage 6 m², fascia 0.35 m developed width) — calibrate against real jobs, same as the sundries %.
- Exterior primer has no per-item "None" toggle: to skip it, leave the extPrimer product unmapped in Settings (shows as a £0 estimate row, same as any unmapped role).
- Built/verified via the client-only static preview with a faked Xero cache — not yet proven against live Xero/Postgres. Watch the first real exterior quote.

## FEATURE: Wallpaper calculator (rolls to order — reuses stair geometry)

A separate tool, triggered from a room being measured, that tells Nicky (and the client) how many rolls to ORDER. Nicky does NOT supply/order wallpaper — so this is NOT a material cost and does NOT feed the quote total. Purely a "how many rolls should the customer buy" figure. Common real request: measuring a room, client says they want wallpaper, Nicky selects wallpaper and needs to tell them rolls required. Depends on the stair-wall geometry from HSL alignment (build after that so it reuses it, not re-solving the raking wall).

### Trigger / flow
- When wallpaper is selected on a room being measured, reveal wallpaper inputs and calculate from the room's existing measurements (reuse them — don't re-enter dimensions). For a stair wall, reuse the derived stair-wall geometry from HSL alignment.

### Inputs
- Roll dimensions: **length and width, with sensible UK defaults pre-filled** (~10.05m × 0.53m), editable per job (paper varies, usually client-supplied).
- **Paper type: lining vs finish paper.** REPLACES the old lining/plain/patterned three-way selector. Now SAFE to remove: the only thing that depended on plain-vs-patterned was wallpaper labour timing (`wpMins()`, 8 vs 10 mins/m²), and the new per-roll labour model (see below) removes that dependency. Lining vs finish also picks the £30 vs £40 per-roll rate.
- **Match type selector: no match / straight match / offset (drop) match** — affects waste and drops per roll. (For a plain paper choose no match; this now carries what "plain vs patterned" used to on the materials side.)
- **Pattern repeat** (mm) — drives the match allowance in the drop-length calc.
- Optional spare-roll toggle.

### Calculation (drops-per-roll method, not raw area)
- Drop length = wall height + pattern-repeat/match allowance + trim allowance.
- Drops per roll = roll length ÷ drop length, rounded DOWN.
- Drops needed = wall width ÷ roll width, rounded UP.
- Rolls = drops needed ÷ drops per roll, rounded UP.
- **Staircase walls:** use the derived stair geometry — drops get progressively longer/shorter across the rake; calculate each drop's length, then rolls as above. Multi-storey drops (4m+) often give only ONE drop per roll.

### Output
- **Number of rolls to order**, plus **notes the drops required** (show the working so Nicky can sanity-check and explain to the client).
- No cost line — doesn't feed the quote total (client buys the paper).

### Design bias
- Since Nicky doesn't pay for the paper, **err toward not running short** — round generously; an extra roll isn't Nicky's cost, running out mid-job is the real problem.
- Lining paper: calculations don't matter much (leftovers go to stock), so the tool is mainly for finish/patterned papers where the client orders exact quantities.

### Wallpaper LABOUR — per-roll model (replaces area × mins/m²)
**This change also unblocks removing the old lining/plain/patterned selector.** Claude Code confirmed `wpMins()` used plain-vs-patterned for hanging time (8 vs 10 mins/m²), which blocked simplifying the selector. Switching labour to per-roll removes that dependency — the roll count already captures the extra work of patterned paper (more match waste → more rolls → more labour automatically), so plain-vs-patterned is no longer needed for labour timing.

**Model:**
- **Lining paper: £30/roll**; **Finish paper: £40/roll** — both editable in Settings.
- **Ceiling multiplier: +15%.** **Staircase multiplier: +25%.** Editable in Settings.
- **Wallpaper labour = rolls × per-roll rate × (1 + applicable multiplier).**
- Multipliers apply to LABOUR only, NOT the roll count — a staircase needs 25% more labour to hang the same rolls (access/long drops), not 25% more rolls. Roll count stays driven by geometry/area.
- Multipliers apply to different surfaces (a wall vs a ceiling), so they generally don't stack on the same rolls — but define behaviour explicitly if both are ever flagged for one surface.

**What this removes:**
- `wpMins()` / the area × mins/m² wallpaper labour path → replaced by the per-roll calc.
- The lining/plain/patterned three-way selector → collapses to **lining vs finish paper** (needed anyway to pick £30 vs £40).

**What stays (roll-count / materials side, unchanged):** roll dimensions, match type (no/straight/offset), pattern repeat — these still drive the rolls-to-order calculation.

### FOLLOW-ON note (superseded by the per-roll model above)
The earlier "check whether per-roll matches Nicky's pricing" question is now answered — per-roll IS the chosen model (£30 lining / £40 finish, +15% ceiling / +25% stair). Still confirm the staircase % doesn't double-count difficulty already in general markups/prep before shipping.

## FEATURE: Colours tab evolution (paint/ordering view)

Beyond defining `{number, label}` colours, the Colours tab can become the job's paint/ordering screen using data the materials feature already calculates. Conceptual clarity: **Rooms = input the work, Summary = the price, Colours = what you actually buy and put where.**

### Priority additions (the big win — surface existing data)
1. **Rooms per colour** — under each colour show the rooms assigned to it (e.g. "Colour 1 — Dimity — Lounge, Hall, Landing"). Turns the tab into a colour schedule at a glance. Data already exists (rooms carry colour number).
2. **Paint quantity per colour** — roll up the litres/tins for each colour group (e.g. "Colour 1 — Dimity — 12ltr · 2 × 5ltr + 1 × 2ltr"). This is the ordering list — look at Colours, not Summary, when buying paint. Uses the per-colour-group tin calculation already built. Must read from the SAME calculation as the summary (one source of truth — don't diverge). Watch: a room with a product override under the same colour number is a different product → show as its own sub-grouping, don't merge tins across different products under one colour heading.

### Secondary polish (later)
3. **Brand/code autofill** — see "Colour reference library" (seed F&B + Little Greene).
4. **Finish/sheen per colour** — same colour can go on in different finishes (matt walls, eggshell woodwork); note against the colour for ordering accuracy.
5. **Surfaces per colour** — which surfaces each colour covers (walls only vs walls+ceiling), so a feature-wall colour is distinguished from a whole-room one.
6. **Colour schedule output** — a tidy "Colour Schedule" (room, colour, finish) on the quote or as a shareable summary. Professional touch; doubles as Nicky's own worksheet.

### Notes
- Leans on existing calculations — mostly surfacing data, not new logic.
- The colour NUMBER still drives the materials calculation; names/codes/finishes are reference only.
- Build after core materials + per-room overrides are solid.

## FEATURE: Rename jobs on the jobs list

Small, self-contained. Jobs get named fast on site (client/address); allow editing the name from the jobs list afterwards to tidy or correct. Natural follow-on to Multiple saved jobs (depends on it).

## FEATURE: Lining + finish paper on the same job (wallpaper refinement)

Gap in the current wallpaper build: labour charges £30/roll lining or £40/roll finish, but one job often has BOTH (line out then finish, or lining some walls + finish elsewhere). Paper type currently seems to be one choice per room/job — needs to allow both in one job. The calc already knows both rates; the change is letting paper type be per-wall/per-area rather than a single setting, and summing labour across the mix. Refinement to the wallpaper feature, not a new system.

## FEATURE: Feature wall — paint/wallpaper toggle (follows lining+finish; build straight after)

Extends the feature-wall pricing (input dimensions → price the wall on its own). **Depends on and follows the "Lining + finish paper on the same job" work** — the wallpaper option reuses that lining+finish mechanism, so build lining/finish first, then this straight after (parked until then).

- **Paint/wallpaper toggle on the feature wall** routes its dimensions to EITHER path:
  - **Paint:** carves out of the main wall area, own colour/product, feeds materials (as already planned).
  - **Wallpaper:** the feature wall area is REMOVED from paint materials entirely and uses the wallpaper roll calc + per-roll labour. Include an **optional lining toggle** (lining + finish, each at their per-roll rate — same mechanism as lining+finish-on-one-job).
- **Critical:** a wallpapered feature wall must be EXCLUDED from paint (not just relabelled), and the rest of the room's walls still calculate paint normally. Avoid double-counting the area in both paint and wallpaper.
- **Reuse one wallpaper implementation** — whole-room wallpaper and feature-wall wallpaper should share the same logic, not two separate versions (same "solve it once" principle as the stair geometry).
- **Move the feature wall into its own collapsible section** in the room tab (occasional feature → collapsed by default), consistent with the compacted layout.
- Before wiring in, confirm how the feature-wall area flows in each case (paint vs wallpaper) so it's excluded from paint correctly when wallpaper is chosen.

## FEATURE: Material tracking (actuals vs estimate — job management)

DIFFERENT from everything else so far — everything to date is ESTIMATING (what a job should cost). This is ACTUALS: track what was really used/purchased against a job so nothing's missed at invoicing (forgotten materials = lost money). Turns the app from a quoting tool into a light job-management tool.
- A place per job to log materials purchased/used, reconciled against the estimate (estimated vs actual, what's outstanding).
- Bigger conceptual piece than a calculation tweak; depends on Multiple saved jobs (tracking is per-job).
- Scope carefully when reached — could be as simple as a checklist/log per job, or as involved as full reconciliation. Start simple.

## FEATURE: Backup system (CSV export / import)

The app now holds real job data on Render Postgres — a DB problem would lose everything with no backup. Add export-all-to-CSV and import-from-CSV as a safety net and for portability.
- Synergy: the same export/import can underpin backup AND moving/archiving jobs between devices.
- Overlaps with the Multiple saved jobs data model — build after that's settled, since the jobs structure defines what's being exported.
- Reuse the CSV tooling patterns already in `scripts/` where sensible.

## Quote description templates

Six templates are stored as iOS/Mac text replacements (`;;paint`, `;;paper`, etc.) and pasted into the Xero line item description fields directly (item selector overwrites price, so paste into description instead). Templates: Painting only, Wallpaper only, Combined, Exterior Render, Exterior Woodwork, Kitchen Cabinet Spraying. Follow-on rooms use "As above".

## Xero quote PDF templates (custom DOCX)

The Xero quote branding uses **custom DOCX templates** (downloaded from Xero → Settings → branding themes). These are editable via Claude Code (docx skill), unlike Xero's built-in theme editor. Use this to make the growing quote — materials line items, sundries line, deposit/payment terms — display cleanly, especially a long itemised materials list that looks cramped in the default layout.

**How they work:** Word documents with Xero **merge fields** (e.g. `«LineDescription»`, `«LineAmount»`, `«Total»`) that Xero swaps for real data at generation time. Claude Code can restyle/rearrange layout, spacing, columns, fonts and the arrangement of merge fields.

**Constraints / cautions:**
- Can only use merge fields Xero actually supports, named EXACTLY — can't invent new ones. If you want data shown (e.g. deposit amount), there must be a Xero merge field for it, or it comes through as a line item / terms text.
- A branding theme can have separate templates (quote, invoice, etc.) — be explicit which one is being edited. The quote has multiple pages (cover letter, itemised quote, terms, cancellation) — specify which.
- **BACK UP the working template before editing.** A renamed field or broken structure can make quotes generate wrong or fail to populate. Edit a copy, keep the original safe.
- **Test on a real draft quote in Xero before going live** — merge-field templates can look right in Word but only prove out when Xero renders them with real data. Check branding, materials flow, totals and terms all populate.

**Process:** download current template from Xero → give the DOCX to Claude Code → tell it what's being added and how it should look → it edits keeping branding + merge fields intact → re-upload to Xero → test on a draft.
