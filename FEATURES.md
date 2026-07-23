# NH Estimator — Feature Roadmap

This document captures planned features for the NH Estimator app, scoped and ready to build. Work through phases in order — each is independently useful and testable.

## Status at a glance

Reconciled against the code on **2026-07-14**. Most of the original roadmap is now built — keep this index honest as things ship, it had drifted badly once already.

**Shipped:** **Backup system — export-all + additive import** (2026-07-15, commit `1b55df0`; this index wrongly said "not built" until 2026-07-22 — it had drifted again) · Automatic materials from Xero Items · Materials editing + sundries · Realistic time estimate · Deposit & staged payments · Colour reference library · Multiple saved jobs · Rename jobs · HSL alignment (both steps) · Exterior alignment · Wallpaper calculator · Wallpaper per-roll labour · Lining + finish on one job · Feature wall paint/wallpaper toggle · Colours tab evolution (paint/ordering view) · **Material tracking Phases 0, 1 and 2(a)** · **Navigation: hamburger for job admin** (2026-07-14) · **Spray walls toggle** (2026-07-21) · **Accepted/Declined syncs the quote status to Xero** (2026-07-22, `estimating-app-edits.md` #14 — quotes created before this never stored a quote ID, so they still need marking in Xero by hand)

**⚠️ Deploy step outstanding:** material tracking added the `material_actuals` table, and the labour log (2026-07-22) added `labour_log` — **`db/setup.sql` is not run automatically** (README: `psql $DATABASE_URL -f db/setup.sql`). Until it's run against the live database, the Materials and Invoice screens 500 on a missing relation (the Materials screen tolerates `labour_log` alone being missing — the Time on site card just can't save). Nothing else is affected. `IF NOT EXISTS` throughout, so re-running is safe.

**Still to build:**
- ~~**Material tracking (actuals vs estimate)** — not started~~ **Phases 0, 1 and 2(a) SHIPPED 2026-07-14** (`MATERIAL_TRACKING_SPEC.md`): the three-bucket item picker, the actuals log, and the materials list for the invoice. What remains there:
  - **Phase 3 — margin / calibration.** Cheap (311/314 purchase prices already ride on the `/Items` call and are thrown away), but **needs history to be worth building** — run Phase 1 on a few real jobs first.
  - ~~**Phase 2(b) — `POST /Invoices` from the app.**~~ **BUILT 2026-07-22** as the final-invoice builder (`FINAL_INVOICE_SPEC.md`, v1.10.0). `accounting.transactions` is now requested; **Xero must be reconnected once** before the first invoice write picks up the new scope.
- ~~**Navigation: hamburger for job admin**~~ **SHIPPED 2026-07-14** (see "Navigation — hamburger for job admin"): Jobs/Materials/Settings in one menu reached from every measuring screen, replacing the four separate ⚙️ buttons. The outstanding-count badge is live. "My Job ›" was removed then restored same day on Home's topbar — see that section for why.
- ~~**Backup: CSV import + full-data export**~~ **SHIPPED 2026-07-15** (see "Backup system" below) — JSON export-all + additive import per `BACKUP_SPEC.md`, `material_actuals` included.
- **2.0 candidates scoped 2026-07-22** — see `FEATURES_2.0_IDEAS.md` for the index and the individual `*_SPEC.md` docs (calibration, job pipeline, scheduling, variations, final invoice, job templates, site notes). **First slice BUILT same day:** the labour log (calibration Phase A — "Time on site" card on Materials), the extended status pipeline (`quoted`/`invoiced` + Jobs-list regrouping), and the shared `acceptedSnapshot` stamp. **Second slice BUILT same day (v1.7.0): the job pipeline is now COMPLETE** — the Needs-attention strip on Home (quotes to chase after `chaseDays`, completed-not-invoiced, backup age) and the inward Xero quote sync (`GET /auth/quote-statuses` + app-open poll; answers given in Xero land in the app, the app's own answer always wins). **Third slice BUILT same day (v1.8.0): Scheduling** (`SCHEDULING_SPEC.md`, complete) — Schedule flow on accepted jobs' Summary (next-free-slot prefill, overlap warning, drift nudge), the week-strip Schedule screen off the hamburger, "Not scheduled" attention line, w/c dates on weekly instalments (Summary + quote Terms when scheduled at send time), and the `?key`-authed ICS calendar feed behind the new Settings toggle. **Fourth slice BUILT same day (v1.9.0): Variations** (`VARIATIONS_SPEC.md`, complete) — mid-job extras flagged on ordinary rooms/exterior items (auto-on post-acceptance), free hours/flat lines, the Summary Variations card with original-vs-job totals, quote re-sends excluding flagged scope, VARIATION/+N chips. **Sixth slice BUILT 2026-07-23 (v1.12.0): Job templates + Site notes Part 1** (`JOB_TEMPLATES_SPEC.md` complete; `SITE_NOTES_SPEC.md` notes half — photos remain a storage decision) — ⧉ Duplicate on Jobs rows via the factored `copyJobRows()` (one copy-a-job implementation shared with backup import), and the Notes card on Home (`jobs.data.notes`, debounced autosave, 📝 chip). · **Layout pass 2026-07-23 (v1.11.0): the Materials screen became "On Site"** — the run-the-job home: job-context header (status · dates · Build final invoice when completed), Time on Site, the Variations card (moved from Summary, which keeps the money totals), materials actuals, → Invoice list. Summary is back to being the quote document. · **Fifth slice BUILT same day (v1.10.0): Final invoice builder** (`FINAL_INVOICE_SPEC.md`, material tracking Phase 2(b)) — review screen assembling labour-as-quoted + variations + actuals-as-used − deductions, one DRAFT invoice into Xero, status → invoiced. **⚠ Reconnect Xero once before the first invoice write** (new `accounting.transactions` scope). No DB changes in any slice. See the specs' status notes for the as-built detail.

**2026-07-23 (v1.13.0):** Internal **window sills** on the room form (count × `rSill` mins, for plastic windows with wooden sills — folds into Woodwork & extras, adds ~0.25 m²/sill of gloss litres). **Quotes can now be amended in place in Xero**: when a job's quote is still DRAFT/SENT, the send button becomes "Update quote Q-nnn in Xero" (same number, same document; "Send as a NEW quote instead" is the escape hatch; answered quotes always get a new one). And a real find: **the Settings "Room Rates" fields (wall/ceiling/skirting/door/window/radiator) had never been wired** — the calculator hardcoded their defaults. They now take effect; identical behaviour until edited, since the hardcoded numbers matched the defaults.

**Loose ends on otherwise-shipped features:**
- Confirm the wallpaper **staircase +25%** doesn't double-count difficulty already in markup/prep — the spec asked for this before shipping and it was never explicitly closed off.
- Feature wall never got its **own collapsible section** (cosmetic only).
- **Calibrate the guessed defaults against real jobs:** exterior assumed areas/coverage, and the sundries %. ~~The sundries % now has a second reason to move: its remit shrank when floor protection and filler became itemisable.~~ **Withdrawn 2026-07-14 — the remit never shrank.** The % still covers floor protection at the level a normal job uses it; the itemisable `SUN010`–`SUN012` lines are for the odd job needing extra on top. So the % needs calibrating for the ordinary reason (it was a guess), not for this one.
- **Exterior materials have not been proven against live Xero/Postgres** — built against a static preview with a faked Xero cache. Watch the first real exterior quote. **The same caveat applies to material tracking** (Phases 0–2a): verified against the real Xero export, the real routes with a stubbed db, and the real UI against a mock server — but there is no postgres on Nicky's Mac, so the first live job is still the first live job.
- **One archived Xero item is still offered as a live option** — `TIK015` (`Tikkurila Anti Reflex 2 - Magnolia 3ltr`). `/material-groups` filters on `SalesDetails.AccountCode` and never reads `Status`. Exactly one row out of ~1,576, so it's minor — but before fixing it, **confirm the Items API even exposes `Status`**: this was only ever checked against a CSV export, and the code has never read the live payload. Not a material-tracking dependency (that prune was done by deletion); it's a standalone picker bug.

## Architecture reminder

- **Frontend:** `public/index.html` — single-file vanilla JS app
- **Backend:** `routes/xero.js` (OAuth + quote/contact/item endpoints), `routes/api.js` (rooms, exterior items, settings, HSL)
- **Database:** PostgreSQL on Render (rooms, exterior_items, settings, hsl_state tables)
- **Deploy:** push to GitHub `main` → Render auto-deploys
- **Xero:** connects with `accounting.contacts`, `accounting.settings.read`, `accounting.invoices` scopes. **This app uses GRANULAR scopes** (see its developer-portal Authorisation list): `accounting.invoices` is the valid quotes+invoices scope here, and the coarse `accounting.transactions` is NOT permitted — requesting it fails the whole auth with `invalid_scope` (the 2026-07-22/23 reconnect saga, resolved v1.10.6). Old doubts about `accounting.invoices` being "not a documented scope" were wrong for this app type.

## Key gotchas learned during the build

- **Duplicate functions:** the app has had repeated bugs where an old version of a function survived alongside a new one, with the later definition silently overriding the earlier. When something doesn't behave as expected, grep for duplicate `function X` definitions first.
- **extItems vs old extCost:** exterior items use the `extItems` array + `calcExtItem()`, loaded from `/api/extitems`. Old code used `extCost`/`extTime` globals — make sure any new code (Xero quote, CSV) reads from `extItems`, not the old globals.
- **Data sync:** rooms and exterior items load from the server into memory on init. Render functions should read from the in-memory arrays. Avoid reintroducing localStorage as a competing source of truth.
- **Whole-tin rounding must happen at job level**, not per room, or multi-room jobs over-count tins.

---

## FEATURE: Automatic materials from Xero Items ✅ SHIPPED

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

**As built:** `ROLE_COLOUR_FIELD` maps each role to the colour-number field that groups it; `TIN_ROLES` marks the per-tin roles (`wall`, `masonry`) against the per-litre rest. `computeRoleGroups()` / `buildRoleRows()` are the shared engine — later generalised with an optional source list so exterior roles could reuse them (see "Exterior alignment"). Materials post to the quote as real Xero item lines from `routes/xero.js`. Nine roles now exist, not the original five: the interior five plus `featurewall`, `masonry`, `extTopcoat`, `extPrimer`.

---

## FEATURE: Materials editing + sundries ✅ SHIPPED

Built before the deposit, as sequenced: the deposit is based on the materials/total, so the total had to be final and adjustable *before* sending — no more editing in Xero after the fact.

**As built:** a job-scoped `materials_snapshot` table (`GET/PUT/DELETE /api/materials`), populated by `recalculateMaterialsSnapshot()` and then edited freely as a frozen snapshot. It is deliberately NOT kept in sync with rooms automatically — only an explicit Recalculate re-pulls, exactly as scoped below. Sundries % and deposit % both live in global Settings (`sundriesPct` default 5, `depositPct` default 25).

### Materials editing (trim the auto-calculations) — this quote only
- **Edit a calculated line's quantity** — override the auto quantity (e.g. 6 tins → 5 or 7 for access/wastage); cost and total follow the new quantity.
- **Delete a line** — remove a calculated material not wanted on this quote (client supplying, paint in stock, etc.); total recalculates without it.
- **Add a one-off specific item** — add a material the model didn't calculate (specialist product), pick the Xero item (or free-text) + quantity; joins the materials total and the Xero quote.
- **Scope: this quote only** — edits are a snapshot, they don't feed back into settings or defaults.
- **Recalculate-from-rooms button** — edits are a snapshot on top of the live calculation; if rooms change afterwards, a visible "recalculate" resets materials to freshly-calculated values (discarding manual edits). Keeps the model simple — no tracking overrides through every recalc.

### Sundries (% of labour)
- **A percentage set in Settings** (editable) applied to the **labour total BEFORE markup** — sundries scale with time on the job, not paint cost. Markup then applies to everything including sundries.
- Covers the general consumables: tape, filler, caulk, floor protection, sandpaper, dust sheets — the long tail Nicky doesn't itemise. **At normal usage**: the % is sized for what a typical job gets through.
- ~~**⚠️ This remit is now out of date and knowingly so.** Floor protection and filler became itemisable `SUN` items on 2026-07-14, so the % and the item list both charge for them... it must be resolved before material tracking Phase 2 ships, or every invoice double-charges.~~ **WITHDRAWN 2026-07-14 — the remit is not out of date, and this was never a Phase 2 blocker.** Floor protection being itemisable doesn't remove it from the %. The two cover different things: **the % pays for the normal protection on every job; an itemised `SUN010`–`SUN012` line pays for the unusual extra an odd job specifically needed.** Additive, not a double charge — in the normal case no line is added at all. Nicky: *"it's an odd case where extra is specifically needed so I want the option, it isn't the norm."*
- **The one thing to watch is behavioural**: if protection gets itemised *routinely* rather than exceptionally, the overlap becomes a real double charge. The control is the judgement, not the code — **don't add app-side guards**, since "was this extra beyond normal?" is not something the app can know.
- Anything specific/expensive is still added as its own one-off material line (above), not absorbed into the %.
- **Shows as a labelled line** — e.g. "Sundries & consumables" or "Protection, masking & materials" (a plain "Sundries" with a big number invites client questions; a descriptive label reads as value). Consider showing it among the materials lines rather than standalone so it looks like a normal part of the job. Start visible; revisit if it draws questions on real quotes.
- Feeds the materials/total and therefore the deposit; goes onto the Xero quote as its own line.
- Typical decorating sundries land ~3–8% of labour, but Nicky sets the real figure in settings and calibrates.

### Calculation order (important)
labour (before markup) → sundries = labour × sundries% → materials (calculated, then edited/trimmed) → subtotal = labour + sundries + materials → markup applied → deposit calculated on the marked-up total. Get this order right so sundries is on raw labour and the deposit is on the true final figure.

## FEATURE: Realistic time estimate (scheduling) ✅ SHIPPED

**As built:** Settings carry `overheadMins` (default 45 mins/day) and `bufferPct` (default 0), which feed an `onSiteDays` figure shown alongside working time. `onSiteDays` is what `computeDepositPlan()` derives the weekly instalment count from — the key link below, wired as specced. No costing change: the quote total is untouched.

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

## FEATURE: Deposit & staged payments ✅ SHIPPED

Built last of the four, as sequenced — on top of materials, materials-editing/sundries and the realistic time estimate, so the deposit is based on the true adjusted total and the staged-payment schedule on realistic job length (not working days).

**As built:** `computeDepositPlan(tcS, materialsTotal, onSiteDays)` implements the greater-of rule and derives the instalment count from `onSiteDays`. `buildPaymentTermsText()` / `buildPaymentSummaryText()` render it, and `routes/xero.js` writes the deposit/balance figures onto the quote separately from the Terms block. The Summary tab and the Xero quote read the SAME plan object, so they can't diverge.

1. **Deposit calculation on summary:**
   - Default 25% (editable in settings)
   - **"25% of quote OR cost of materials/sundries, whichever is GREATER"** — this matches Nicky's existing Terms wording ("25% of quotation or cost of materials, sundries and equipment, whichever the greater"). So compute both 25% of the marked-up total AND the materials+sundries cost, and take the higher. Needs materials to feed the total (hence the dependency).
   - Show: Total, Deposit due on acceptance (and which basis applied), Balance

2. **Two job types:**
   - **Single payment** — deposit + balance on completion
   - **Multi-week** — the number of weeks is DERIVED from the realistic time estimate (realistic days ÷ working week), not entered blind or taken from working days. Split the balance (after deposit) evenly across weekly payments. Show deposit + N weekly instalments. User can override the auto-derived week count if needed.

3. **Optional** — write payment terms as a line into the Xero quote (terms/notes field). Actual weekly invoicing stays in Xero.

---

## FEATURE: Colour reference library ✅ SHIPPED

The Colours tab lets each colour number carry a name (e.g. colour 1 = "Dimity"). Colour names/codes now autofill as you type, so exact names and codes are to hand for ordering from the merchant.

### What shipped
- **Data model** — each colour stored as `{ name, brand, code }` in a `colour_library` table. **Global and permanent**: NOT job-scoped, and deliberately untouched by Clear Rooms / Clear Everything (it's a reference list, not job data).
- **Seeded with Farrow & Ball + Little Greene** — 509 colours (301 F&B, 208 Little Greene) from `db/colour-library-seed.json`, loaded once via `db/seed-colour-library.js`. Notably larger than the ~130-each the plan assumed.
- **Autocomplete on the Colours tab** — typing 2+ characters filters the library and shows up to 8 matches (name, brand, code); picking one fills in brand + code. Mirrors the existing Xero contact autocomplete pattern (`onXeroClientInput`), but filters in memory rather than hitting a search endpoint — ~500 entries are cheap to filter on every keystroke.
- **Grows on first use** — an unknown colour offers "+ Save X to your colour library", which takes brand + code and POSTs to `/api/colour-library` (upsert on name+brand). The personal list grows over time; no cross-brand database needed.
- **Free-text fallback** — "Skip" still commits the typed name as a plain label with no brand/code, so an unknown colour never blocks the flow.
- **Same name across brands** (refinement, 2026-07-14) — **the library is keyed on name+brand, NOT name.** Colour names are not unique across brands (Chemise is both F&B 216 and Little Greene 139; trade brands colour-match each other freely), so:
  - The save option is **always** offered, even when the name already exists — it just reads "+ Add X under another brand" instead of "+ Save X to your colour library". Previously an existing name suppressed the option entirely, making a second brand's version of that name unaddable.
  - The save form lists what's **already filed under that name** ("Already in library as Farrow & Ball · No. 216; Little Greene · No. 139"), so it's obvious which brands are taken.
  - Autofill-on-blur only fires when the name resolves to exactly **ONE** entry. An ambiguous name commits the label with a BLANK brand/code rather than guessing — a blank chip reads as "unresolved", a wrong code goes to the merchant silently. Pick from the dropdown to resolve it.
- **API** — `GET/POST /api/colour-library` in `routes/api.js`.

### Notes / gotchas
- **Built earlier than planned.** The roadmap had this as low priority behind materials + deposit; it shipped ahead of the deposit feature.
- **localStorage IS used here, deliberately** — `pe-colour-library` caches the library client-side for instant autocomplete offline/on site. This is a READ CACHE of a global reference list, refreshed from the server on init — not a competing source of truth for job data. The "no localStorage" rule in the architecture notes still applies to rooms/exterior/colours.
- **Blur-commit is guarded** (`renameColour` returns early while a dropdown is open) — clicking from the label input into the save-form's own Brand/Code fields blurs the label input, and committing there would rebuild the card and destroy the form mid-entry. Watch this if the Colours tab render is refactored.
- **Brand casing: client matches case-INsensitively, Postgres does not.** `UNIQUE(name, brand)` is case-sensitive, so a typed "farrow & ball" would insert a SECOND row alongside "Farrow & Ball" while the local cache updated only one — the next reload would then show two near-identical brands with different codes. `confirmSaveColour` therefore snaps a re-save to the STORED name/brand spelling before POSTing. If brand ever becomes a free-text field elsewhere, it needs the same treatment (or a case-insensitive index).
- `#colours-cards` needs `overflow:visible` or the dropdown gets clipped by the card's rounded corners.
- Colour label stays reference/ordering only; the colour NUMBER still drives the materials calculation (see MATERIALS_SPEC.md).
- Big trade brands (Dulux etc.) are usually colour-matched anyway — the grow-on-use path handles them, no wholesale seeding.

## FEATURE: Multiple saved jobs ✅ SHIPPED

Was: the app held ONE working job at a time, so two surveys in a day meant manually combining and separating them. Jobs are now first-class — save a job, start another, come back to either before committing to Xero.

**As built:** a `jobs` table (`GET/POST/PUT/DELETE /api/jobs`) seeded with a `'default'` job named "My Job". `rooms`, `exterior_items`, `colours` and `materials_snapshot` each gained a `job_id`, backfilled to `'default'` then set NOT NULL — so existing data migrated into the default job rather than being orphaned. `settings` and `colour_library` stayed global, as scoped. `colours` needed a `colours_job_number_uniq` index on `(job_id, number)`, because colour numbers are unique per-job, not globally.

**Open design question — RESOLVED:** jobs are **fully separate**, no duplicate-as-template (recorded at the top of `db/setup.sql`). If templates are ever wanted, they layer on from here.

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

## FEATURE: HSL alignment with the room system ✅ SHIPPED (both steps)

The HSL (halls / stairs / landings) system had drifted out of step with how regular rooms work. Done as two separate tasks, as sequenced.

**Step 1 outcome — NOT a double-count.** Investigated before changing, as the spec insisted. The staircase woodwork value was only ever in the one place, so it was **re-homed into the HSL breakdown** rather than deleted: `hsl-r-wood-row` is now a breakdown row inside the HSL results card, shown only when there's woodwork to show. `calcWoodCost` lands in `totalCostDisp` exactly ONCE and the row itemises part of that total — it does not add to it. Staircase woodwork keeps its own coats count (`hslCoats.swc`), separate from the shared woodwork coats (`xc`, skirting/doors), since the two aren't always painted the same number of times.

**Step 2 outcome.** HSL now reuses the shared room fields and functions (`setSeg`/`setPrep`/`setWP`) via `setRoomStaircase()` + `computeHSLOverrides()` — it's triggered from the room flow, and the **toggle** approach won over the typed-keyword one, as recommended. The stair-wall geometry fix landed as specced: `stairWallWidth(startWidth, steps, tread, topStep)` builds the width UP from the bottom and **never** uses landing length (the old double-count). The stepped-bottom area is reconstructed from 3 flat regions, with the deliberate "don't model individual step slivers" simplification preserved and commented in the code so nobody "fixes" it later. `startWidth` is whatever the flight launches from — ground-floor hall for stair 1, the landing below for stair 2, NOT the arrival landing.

<details>
<summary>Original spec (kept for the reasoning)</summary>

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

</details>

## FEATURE: Exterior alignment with the interior system ✅ SHIPPED

The exterior section had fallen behind — a long scroll of items, no materials, and some measurements that didn't capture the real work. Brought inline with interior across four parts, all now **shipped**.

### 1. Measurement tweaks — SHIPPED
- **Window panes:** panes-per-window input added (per-window `{panes}` records for both casement and sash). Labour scales on pane count via `extWindowMins()`, not just area — a 16-pane Georgian window now costs far more than a 2-pane one.

### 2. UI compaction — SHIPPED
- Exterior form now uses the same collapsible sections as the compacted room tab (`toggleFormSection()`/`resetExtFormSections()`), default open. Replaced the long-scroll list.

### 3. Exterior materials — SHIPPED (2026-07-14)
- REUSED the existing engine, not a new system: `computeRoleGroups`/`buildRoleRows` generalised to take an optional source list (default `rooms`), with exterior roles sourcing from `extItems`.
- **Three new roles:** `masonry` (tin-optimised, added to `TIN_ROLES` alongside `wall`), `extTopcoat` + `extPrimer` (per-litre; primer = topcoat × 0.8, same rule as interior). Default product ranges picked in Settings, same pattern as interior's five roles.
- **Litre estimation from assumed areas:** exterior items only carry counts/lengths, so litres come from an assumed paintable area per unit (new, editable Settings — window/sash/door/garage areas + fascia developed-width + masonry & woodwork coverage), run through the same area × coats ÷ coverage formula. Fascia is treated as woodwork.
- **Two exterior colour numbers per item:** `masonryColourNumber` + `extWoodworkColourNumber` (the latter shared across windows/doors/fascia/sash, mirroring interior's woodwork colour), picked via a "Paint Colours" chip section on the exterior form.

### 4. Integration parity — SHIPPED
- ✅ Exterior materials feed the total, the deposit, the Colours tab (grouped by masonry vs exterior-woodwork colour), and the Xero quote (as real item lines via the materials snapshot) — counted exactly ONCE.
- ✅ Exterior *labour* is now itemised on the Xero quote: each exterior item posts as its own labelled line (its `label` + cost × markup), mirroring how each room is its own line — replacing the old single lump `Exterior Works` total. Client sends `exterior.items[]`; `routes/xero.js` falls back to the lump line only if an older client sends just `exterior.cost`. No costing change — the total is identical, just broken out.

### Notes / gotchas
- Part 3 was far smaller than it looked because the engine already existed — mostly wiring `extItems` in, no new calc logic. No duplicate functions or competing localStorage introduced (watched for the recurring extCost/extItems failure mode).
- **Assumed-area defaults are guesses** (masonry 6 m²/L, woodwork 12 m²/L, window 1.5 m², sash 2.5 m², door 2 m², garage 6 m², fascia 0.35 m developed width) — calibrate against real jobs, same as the sundries %.
- Exterior primer has no per-item "None" toggle: to skip it, leave the extPrimer product unmapped in Settings (shows as a £0 estimate row, same as any unmapped role).
- Built/verified via the client-only static preview with a faked Xero cache — not yet proven against live Xero/Postgres. Watch the first real exterior quote.

## FEATURE: Wallpaper calculator (rolls to order) ✅ SHIPPED

**As built:** `calcWallpaperRolls()` implements the drops-per-roll method; `packWallpaperRolls()` handles the packing; `stairWallDropLengths()` + `computeHSLWallpaperRolls()` reuse the derived stair geometry rather than re-solving the raking wall, as intended. `roomWallpaperRolls()` and `featureWallWallpaperRolls()` share that one implementation — whole-room and feature-wall wallpaper are not two versions.

**Per-roll labour SHIPPED too:** `wallpaperLabourCost(type, rolls, isCeil, isStaircase)` replaced the old `wpMins()` area × mins/m² path, which is now gone. That unblocked collapsing the lining/plain/patterned selector, as predicted — `wpNormalisePaperType()` now handles lining vs finish.

**Gotcha found in the field:** pattern repeat is entered in **cm, not mm** (`wpRepeatCmFromInput()`) — the field was originally mislabelled mm and corrected in commit 166eff6. The spec below still says mm; the code is right, the spec is stale.

<details>
<summary>Original spec (kept for the reasoning)</summary>

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

</details>

> **Outstanding on this feature:** the staircase-% double-count check above was never explicitly confirmed. Worth a look at the first real staircase wallpaper job — does +25% stair labour overlap difficulty already priced into markup/prep?

## FEATURE: Colours tab evolution (paint/ordering view) — SHIPPED

Beyond defining `{number, label}` colours, the Colours tab is now the job's paint/ordering screen, built on data the materials feature already calculates. Conceptual clarity: **Rooms = input the work, Summary = the price, Colours = what you actually buy and put where.**

### Priority additions — ✅ BOTH SHIPPED
1. ✅ **Rooms per colour** — `renderColours()` lists the rooms under each colour, split by surface (Walls / Ceiling / Woodwork / Feature wall) and, since the exterior work, by Masonry (ext) / Woodwork (ext) too.
2. ✅ **Paint quantity per colour** — the tab reads `computeMaterials()` and renders its role rows, so it shares ONE source of truth with the Summary by construction rather than by discipline. This is the ordering list: look at Colours, not Summary, when buying paint.

### Secondary polish
3. ✅ **Brand/code autofill** — SHIPPED, see "Colour reference library" above.
4. ✅ **Surfaces per colour** — `surfaceSummary()` renders a chip ("All surfaces", "Walls + Ceiling", …). Feature wall is treated as a carve-out of Walls, not a whole-room surface in its own right.
5. ✅ **Colour schedule output** — a Colour Schedule on the Summary tab, sharing its builder with the CSV export so the two can't diverge.

**Finish/sheen per colour — dropped 2026-07-14, not just deferred.** Was scoped to note matt/eggshell finish against a colour for ordering accuracy. Nicky: not needed. Removed from scope rather than left as a permanent "unbuilt" line — nothing in the app should imply it's still coming.

### Notes
- Leans on existing calculations — mostly surfacing data, not new logic.
- The colour NUMBER still drives the materials calculation; names/codes/finishes are reference only.
- **Watch when touching the tin roll-up:** a room with a product override under the same colour number is a DIFFERENT product — it must show as its own sub-grouping. Don't merge tins across different products under one colour heading.

## FEATURE: Rename jobs on the jobs list ✅ SHIPPED

`renameJob(id)` behind the ✎ control on each row of the jobs list, PUTting to `/api/jobs/:id`. Jobs get named fast on site (client/address), so the name can be tidied or corrected afterwards.

## FEATURE: Lining + finish paper on the same job ✅ SHIPPED

Was a gap: labour charges £30/roll lining or £40/roll finish, but one job often has BOTH (line out then finish, or lining some walls + finish elsewhere), and paper type was one choice per room/job.

**As built:** lining and finish are independent flags per surface, not a single either/or — `wpSurfaceResult(liningOn, finishOn, isCeil, isStaircase, rollsForType)` costs whatever combination is on, and the previews join them as "Lining X · Finish Y" via `joinWPParts()`. Labour sums across the mix.

## FEATURE: Feature wall — paint/wallpaper toggle ✅ SHIPPED

Built straight after lining+finish, as sequenced, reusing that mechanism.

**As built:** `featureWallMode` routes the wall's dimensions down either path — `'paint'` carves out of the main wall area and feeds materials via the `featurewall` role; wallpaper hands off to `featureWallWallpaperRolls()`, sharing the one wallpaper implementation rather than a second copy. The critical exclusion holds: `renderColours()` and the materials engine both filter feature walls on `(r.featureWallMode||'paint')==='paint'`, so a wallpapered feature wall drops out of paint entirely instead of being double-counted.

<details>
<summary>Original spec</summary>

Extends the feature-wall pricing (input dimensions → price the wall on its own). **Depends on and follows the "Lining + finish paper on the same job" work** — the wallpaper option reuses that lining+finish mechanism, so build lining/finish first, then this straight after (parked until then).

- **Paint/wallpaper toggle on the feature wall** routes its dimensions to EITHER path:
  - **Paint:** carves out of the main wall area, own colour/product, feeds materials (as already planned).
  - **Wallpaper:** the feature wall area is REMOVED from paint materials entirely and uses the wallpaper roll calc + per-roll labour. Include an **optional lining toggle** (lining + finish, each at their per-roll rate — same mechanism as lining+finish-on-one-job).
- **Critical:** a wallpapered feature wall must be EXCLUDED from paint (not just relabelled), and the rest of the room's walls still calculate paint normally. Avoid double-counting the area in both paint and wallpaper.
- **Reuse one wallpaper implementation** — whole-room wallpaper and feature-wall wallpaper should share the same logic, not two separate versions (same "solve it once" principle as the stair geometry).
- **Move the feature wall into its own collapsible section** in the room tab (occasional feature → collapsed by default), consistent with the compacted layout.
- Before wiring in, confirm how the feature-wall area flows in each case (paint vs wallpaper) so it's excluded from paint correctly when wallpaper is chosen.

</details>

> **Still outstanding:** the spec called for moving the feature wall into its own collapsible section (collapsed by default). The room form has collapsible sections and the exterior form uses them throughout, but there's no dedicated feature-wall section — cosmetic, not functional.

## FEATURE: Spray walls toggle ✅ SHIPPED (2026-07-21)

Per-room "Spray walls" toggle (its own collapsible card on the room form, after Mist Coat). **Materials-only** — labour deliberately stays on `wallMins()`, on the working assumption that spray application speed vs masking time is a wash on the rooms you'd actually choose to spray.

- **Only the wall rate forks.** Ceiling, woodwork and mist coverage rates were already calibrated assuming spraying, so they're untouched. A second coverage setting, **Wall Emulsion — Sprayed** (`cwSpray`, default 9 m²/L vs rolled 13), sits next to the rolled rate in Coverage Rates; `calcRoom()` picks one per room for `wallL` and `featureWallL`. Calibrate it against real sprayed jobs like the other rates — the default is a guess.
- **Spray sundries bump** (`sundriesSprayPct`, default 3%): sprayed rooms use extra masking film/tape/paper, so their labour carries an extra sundries % on top of the job-wide rate — sprayed rooms' labour only, not the whole job's. `calcRoom()` exposes `sprayLabour` per room and `computeDepositPlan()` takes the summed figure, so Summary and the Xero quote share one number (the usual drift-bug guard). This default is also a guess — calibrate.
- Room flag `sprayWalls` rides the standard lifecycle (temp var, `buildRoomFromForm()`, `editRoom()` restore, draft capture) and defaults off, so old rooms and quick-added rooms stay rolled. HSL rooms get it generically like mist.
- Litres flow into the existing tin optimiser/Xero pipeline unchanged — the toggle just changes the input litres.
- **Exterior render (added 2026-07-22):** same pattern on exterior items — per-item "Spray render" and "Textured render" toggles in the Masonry/Render card, forked inside `extMasonryLitres()` across a **2×2 of coverage settings** (smooth/textured × rolled/sprayed: `extMasonryCov` 6 · `extMasonryCovSpray` 4 · `extMasonryCovTex` 4 · `extMasonryCovTexSpray` 3 m²/L) — texture gets its own rolled/sprayed pair rather than a multiplier on the smooth rates, since it soaks up more paint however it's applied. The spray sundries bump extends to exteriors on the same `computeDepositPlan()` contract, with one deliberate difference: the basis is the **masonry labour share only** (incl. its prep), not the whole item — an exterior item can be dominated by window restoration that has nothing to do with spraying render, so whole-item labour would be the wrong masking proxy. `calcExtItem()` exposes `sprayLabour` on the same contract as `calcRoom()`. **Texture, unlike spray, DOES fork labour** — working paint into textured render is genuinely slower, so `extMasonryMins()` picks a textured mins/m² rate (`rExtMasonryTex`, default 7 vs smooth 5). One textured rate covers rolled and sprayed alike: spray never changes labour, texture always does. Texture never touches the sundries bump directly (masking doesn't care about texture), though a textured item's higher masonry labour does raise the bump's basis when it's also sprayed — intended, bigger labour = same % of more.

## FEATURE: Navigation — hamburger for job admin ✅ SHIPPED (2026-07-14)

Decided alongside material tracking (2026-07-14), built same day. Splits navigation **by activity** rather than spreading it across two bars with no clear logic.

- **Bottom bar = measuring** — Rooms · Exterior · Colours · Summary. Unchanged: used on site, one-handed, every tab one thumb-tap. No 5th item added; the bar was not replaced with a menu.
- **Hamburger = job admin** — Jobs · Materials · Settings, one shared overlay (`#nav-menu-panel`) reached identically from all 4 measuring topbars via a single `.nav-ham-btn`. Absorbed the four separate ⚙️ gear buttons that used to be scattered across the topbars, inconsistently (Home had "My Job ›" + gear; Exterior and Colours had only a gear; Summary had gear + a temporary "Materials ›" button). The active job's name also shows as a sub-line under "Jobs" in the menu (the only place it's visible on Exterior/Colours/Summary).
- **"My Job ›" itself was NOT absorbed — restored per Nicky (2026-07-14).** It was removed in the initial build (reasoning: the menu's Jobs row already showed it), then put back the same day on Home's topbar, because at-a-glance visibility of which job you're on, without opening the menu, was worth keeping. It's still there only on Home, not the other 3 measuring screens — that inconsistency stands, not yet asked to be fixed.
- **The badge is load-bearing, and it works.** `updateNavBadge()` shows the outstanding-materials count as a small red badge on the hamburger icon itself (visible without opening the menu) and as "N to buy" on the Materials row inside it. Loaded eagerly at `initApp()` and `loadActiveJobData()` — not just when Materials is first opened — so it's correct from the very first paint and updates on every job switch. Verified live: all 4 badge instances update in lock-step the instant a row is ticked on the Materials screen, with no navigation needed.
- Materials tracking's temporary "Materials ›" button on Summary is retired — the hamburger is now the only entry point, on every measuring screen, not just Summary.

### Build notes
- **Was mostly presentational, as predicted.** `goTab()` already handled `jobs`/`settings`/`actuals` as targets; the menu just calls the same functions. No navigation logic was rewired.
- Verified against the real UI (mock server, no postgres on this Mac): the menu opens/closes via both the hamburger and a tap on the backdrop, each of Jobs/Materials/Settings navigates and closes the menu, the badge is present and correct on all 4 measuring screens, and it lays out cleanly at 375px with no horizontal scroll.

## FEATURE: Material tracking (actuals vs estimate — job management) ⬜ NOT STARTED, SCOPED

DIFFERENT from everything else so far — everything to date is ESTIMATING (what a job should cost). This is ACTUALS: track what was really used/purchased against a job so nothing's missed at invoicing (forgotten materials = lost money). Turns the app from a quoting tool into a light job-management tool.

> **NOTE: now specced in `MATERIAL_TRACKING_SPEC.md`, which SUPERSEDES the "scope carefully when reached" note that used to live here.** That doc is authoritative: the quantities-only/derived-money decision, the `material_actuals` data model, the three-phase build order, and the open question of where it lives.

Headlines from the spec:
- **Materials are quoted as an ESTIMATE and invoiced as USED.** This is the billing model, and it makes tracking load-bearing rather than a safety net: actuals ARE the invoice's materials list, not just a note of what got forgotten. Labour is quoted and billed as quoted; only materials float.
- **Quantities only in, money derived out — all of it.** Account codes confirmed: **202** sales, **311** paint cost, **314** specific-sundry-item cost. All ride on the `/Items` payload the app already fetches, so billable value AND margin come from a typed quantity. No manual pricing anywhere.
- **314 is NOT the cost side of the sundries %.** The % (labour × %) covers stock consumables used across jobs — caulk, tape, filler, floor protection — at normal usage, and stays a percentage; the % itself is never itemised, never tracked. 314 is for job-specific consumables the % won't cover (wallpaper paste, lining paper), which are real Xero items tracked like paint. Itemising something the % already covers **as routine** charges the client twice — but **floor protection is a deliberate exception**: the % pays for the normal amount and an itemised line pays for the unusual extra a job needed, which is additive rather than a double charge. See the Gotchas in `MATERIAL_TRACKING_SPEC.md`.
- **A prerequisite surfaced (Phase 0):** `groupMaterialItems()` drops any item whose name has no parseable size, so paste/lining paper are probably absent from the picker today — the exact items the specific-sundries flow needs. Small fix, needs verifying against the live payload.
- **Actuals must NOT live on materials-snapshot lines.** `recalculateMaterialsSnapshot()` is a full overwrite that regenerates every line id, so actuals stored there would be silently destroyed by a normal mid-job Recalculate — destroying the invoice, under this billing model. They get their own `material_actuals` table, joined by `itemCode` (stable) rather than line id (not stable).
- **The app has no invoice path** — it only creates Quotes. Billing actuals means either outputting a list to enter in Xero (recommended start) or building `POST /Invoices`.
- **Xero can't supply purchases.** No `accounting.transactions` scope, so logging stays manual — fine, since only quantities are typed.
- Depends on Multiple saved jobs (tracking is per-job) — now shipped, so this is unblocked.

## FEATURE: Backup system (JSON export-all / import) ✅ SHIPPED (2026-07-15)

Built the same day it was scoped, per `BACKUP_SPEC.md` (commit `1b55df0`). **This index said "not built" for a week afterwards — corrected 2026-07-22.** The doc-drift failure mode struck the very entry warning about doc drift.

**As built:**
- `GET /api/backup/export` — one JSON file: settings, colour library, and every job with its rooms, exterior items, colours, materials snapshot AND `material_actuals` (the table with most to lose, as flagged). One query per table, bucketed by `job_id` in memory.
- `POST /api/backup/import` — **additive only**: every imported job and everything under it gets fresh ids, so importing can never overwrite or delete existing data; worst case of a double import is a duplicate-looking job. Name collisions get an "(imported)" suffix. Fails closed on anything that isn't a recognised v1 file.
- **Settings restore is opt-in** (a toggle on the import preview) — the one place import can overwrite something, per the spec's reasoning about live business rates.
- UI: Settings → Backup card — "Export everything" (Blob download, dated filename) and "Import backup" (file picker → preview of job names/counts → confirm).
- `hsl_state` is deliberately not exported — it has no references anywhere in the app anymore (legacy of pre-alignment HSL); confirmed dead 2026-07-22, not a coverage gap.

**Still on Nicky, not the app:** exporting regularly. The Settings card says so. If that discipline doesn't hold, a future nudge (e.g. "last export N weeks ago" on the attention strip — see `JOB_PIPELINE_SPEC.md`) is the cheap fix.

The old `exportCSV()` on Summary remains what it always was — a human-readable single-job summary, not a backup.

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
