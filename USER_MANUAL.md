# NH Estimator — User Manual

**For build v2.11.0** (7 August 2026). The build number you're running is shown at the bottom of the ☰ menu — if it doesn't match, the deploy hasn't landed yet.

This is the how-to-use-it guide. For the developer changelog and feature history, see `FEATURES.md`.

---

## What's new in this build

- **Materials cost is now real, not assumed (v2.11.0).** The profitability card's "Actual materials cost" and "Markup banked" figures now use each product's real trade (purchase) price from Xero, instead of assuming everything carries a 20% markup. This matters most on premium-paint jobs: Little Greene and Farrow & Ball are on 10% markup and Benjamin Moore on 15%, so the old assumption overstated the materials profit on those jobs by roughly double. Nothing to do on your side — the prices come along with the same Xero item refresh as always. If a line has no purchase price in Xero the card says so and falls back to the old 20% assumption for that line; free-text lines (typed price, no Xero item) are counted at face value with no markup claimed.
- **Job Profitability reworked (v2.10.0).** The card on an Invoiced job's Summary no longer shows one blended "Margin" figure — that maths treated your day rate as a cost, so a job that ran exactly to schedule looked barely profitable. It now tells three separate stories: **Billing** (quoted vs invoiced, with a note when they differ — e.g. "Invoiced £200 less than quoted — materials saving passed to client" — an honesty check, not a profit figure), **Schedule** (the days the quote was priced on vs the days logged in Time on site, with the day variance: on schedule = full day-rate profit realised, finished early = bonus margin, ran over = those days' rate absorbed), and **Materials** (quoted materials vs the trade cost of what was actually used, with the 20% markup banked shown as its own figure — that markup is yours even when the saving on unused materials was passed on). Home's "Recently invoiced" glance shows the day variance and markup banked instead of the old margin (older invoiced jobs update the moment their Summary is next opened). Still reference only — nothing feeds back into pricing.
- **Custom line items (v2.8.0).** The Measure **+** chooser has a new **Custom line** option for one-off items that don't fit any pricing model — "Install panelling — £450" as just a description and a price you type in, with an optional quantity (so "Extra sheet of ply — £40 × 2" works). Custom lines sit in their own section on Measure with a MANUAL tag so they never read as a calculation, are fully editable and swipe-deletable, and feed the quote total like any other line. Each line has an **Apply markup** toggle (on by default): on, the price joins the commercial/markup calculation like everything else; off, the price goes on the quote *exactly* as entered — for ad-hoc prices with the margin already baked in (a NO MARKUP tag shows on the line). They flow through to the Summary breakdown, the client-facing Quote ⤴ view, the Xero quote and the final invoice. No sundries % is added to them either way.
- **Variation sign-off (v2.5.0).** Every variation on the On Site Variations card now carries a status — Pending, Approved or Declined. Tap **✓ Approved by client** to record the client's yes (with an optional note like "agreed via text 14 Aug" — the date is stamped automatically). Declined variations stay listed as a record but drop out of the totals and the final invoice. The invoice builder calls out anything still Pending before it's allowed on. VARIATION chips show the state at a glance: outlined = pending, filled = approved.
- **Job profitability (v2.5.0).** Once a job is Invoiced, the Summary shows a read-only profitability card: what was quoted, what was invoiced, and the real cost — your Day Rate × the days actually logged in Time on site, plus materials as used — with the margin in £ and %. Recently invoiced jobs also show their margin on Home. Reference only; it changes nothing about pricing.
- **Works properly offline (v2.5.0).** In a dead spot, edits (rooms, coats, colours, notes, On Site days and materials) queue on the phone — the sync dot goes red and says how many changes are waiting — and send themselves when signal returns. If the job was meanwhile edited from another device, the server's copy is kept and the app tells you, rather than leaving it to be discovered. Send to Xero, Sync to Xero and Build final invoice need a live connection and simply say so when offline.
- **Repeat client history (v2.5.0).** Picking or typing a client you've worked for before shows their previous jobs (tap to open), the colours used on them, and any access notes (📝) from earlier jobs at the same address, right on the Summary client panel.
- **Client-facing quote view (v2.5.0).** A new **Quote ⤴** button on Summary (next to Export ↓) opens a branded, read-only one-page quote at customer prices — room by room, colour schedule, payment terms and total — for showing a client on site or saving/sending as a PDF before the official Xero quote goes out. It's rebuilt live each time, so it never shows stale figures.
- **Standalone toggle now saves (v2.4.2).** The Standalone job toggle was switching itself off on the next app open — it was only ever saved on the device, never to the server, so the next sync wiped it (on any job, accepted or not). It now persists like every other job setting.
- **Standalone rounding fix (v2.4.1).** The diary-day top-up now lands the labour charge exactly on diary days × day rate (a 1.6-day job rounding to 2 days at £300/day charges £600) — previously it could over-charge when the labour subtotal included cost with no time behind it, like the wallpaper minimum charge.
- **Standalone job rounding (v2.4.0).** A new **Standalone Job** toggle on the Summary charges labour on full (or half) diary days instead of fractional calculated days — see [Standalone Job](#commercial-job--standalone-job) below.
- **Odd-shaped rooms (v2.3.0).** The room form's Dimensions card now has a **room shape** choice — Standard, Perimeter, or Segments — plus bay window, alcove/dormer and sloped-ceiling add-ons, so L-shaped rooms, loft rooms and bays no longer need fudged L×W numbers.
- **Bottom bar fix (v2.3.1).** The bottom navigation no longer floats mid-screen after the keyboard has been used.
- **RAL Classic colours (v2.2.1–2.2.2).** All 213 RAL Classic colours are in the colour library, labelled by RAL number (typing the descriptive name, e.g. "anthracite", still finds them).

---

## 1. Getting around

The app is a web app installed on your phone's home screen (PWA). Everything you enter saves to the server automatically — the **sync dot** in the top bar (and the sync line inside the ☰ menu) tells you whether today's measurements have reached the server before you drive off.

**Bottom bar** — the four screens you live in:

| Tab | What it's for |
|---|---|
| 🏠 **Home** | Job at a glance, the "Needs attention" strip, quick links |
| 📐 **Measure** | Add and edit rooms, exterior items and the kitchen |
| 🛠️ **On Site** | Running the job: days on site, variations, materials used, invoice |
| 📋 **Summary** | The quote: totals, markup, payment plan, send to Xero |

**☰ menu** (top-right on every screen): **Jobs** (with the active job's name shown under it), **Colours**, **Schedule**, **Settings**, plus the sync status and build number. The red badge on the ☰ icon is the count of materials still to buy for the current job.

**Home** shows the attention strip — quotes to chase (after the "Chase quotes after" number of days in Settings), accepted jobs not yet scheduled, completed jobs not yet invoiced, and a nudge when your last backup is getting old.

**Site notes**: the 📝 button (bottom-left on Measure) opens a per-job notepad — access arrangements, agreements, snags. It saves automatically as you type; a dot on the button means the job has notes.

## 2. Jobs

Open **☰ → Jobs**. Each job holds its own rooms, exterior items, kitchen, colours, materials and client details. Settings (your rates) are global.

- **+** creates a new job. **✎** renames, **⧉** duplicates (a quick way to reuse a similar job as a template — notes are not copied), swipe/delete removes.
- **Job status** drives everything: **Draft → Quoted** (set automatically when a quote is sent to Xero) **→ Accepted / Declined → Completed → Invoiced**. Change it from the Summary's status card or the Jobs list. Marking Accepted/Declined also updates the quote's status in Xero automatically (quotes sent before mid-July 2026 never stored a quote link, so mark those in Xero by hand).
- **⬇ Import an accepted quote from Xero** (bottom of the Jobs list) adopts jobs you quoted directly in Xero before the app existed, so they can be scheduled and have days logged. The agreed money comes across as the record; the **Agreed figures** card on their Summary lets you adjust it. If a listed quote actually belongs to a job already in the app, use **"Already a job in the app? Link it ›"** instead of importing a duplicate.

## 3. Measuring a job

On **Measure**, tap **+** and choose **Room**, **Exterior item**, **Kitchen**, **Fitted Unit** or **Custom line**. You can add several fitted units to one job — each gets an auto-numbered name ("Fitted Unit 1", "Fitted Unit 2") you can rename (e.g. "Left alcove", "Media wall unit") so they read apart on the quote, materials and client view. **Quick add** lets you name every room first and measure on a second pass. The costs shown on Measure are your labour cost *before* markup — the customer-facing figure is on Summary.

### The room form

Cards top to bottom (some are collapsed — tap to open):

- **Room Details** — name the room.
- **Dimensions** — Length × Width × Height, and the **room shape**:
  - **Standard** — the default; nothing changed for ordinary rectangular rooms.
  - **Perimeter** — type the wall perimeter directly (walk the skirting with a laser); ceiling area is typed separately.
  - **Segments** — build the room from rectangular zones (L×W each) that sum to the wall run and ceiling area — for L-shapes and rooms with big alcoves.
- **Bay Window & Alcove/Dormer** — add-ons in any shape mode: extra bay perimeter (joins the wall run, so skirting and wallpaper pick it up too), extra wall/ceiling m² for alcoves and dormers, and a **sloped ceiling** toggle that swaps the ceiling from calculated to a measured figure.
- **Staircase / HSL toggle** — turns the room into a hall/stairs/landing job; see [Staircases](#4-staircases-hsl).
- **Coats** — wall, ceiling and woodwork coat counts, plus a spray toggle per surface: **Spray walls** (off by default — also adds the spray sundries bump for the extra masking), **Spray ceiling** and **Spray woodwork** (both on by default — ceilings and woodwork are normally sprayed). A surface's toggle adds the Settings spraying uplift % to its litres, on top of the standard or per-product rate; labour time is unchanged. The Fitted Unit form has its own **Sprayed finish** toggle (off by default); kitchens are always priced as sprayed — that's what the kitchen calculator is.
- **Feature Wall** — price one wall separately, in **paint** (own colour/product, carved out of the main walls) or **wallpaper** (excluded from paint entirely, priced by the roll).
- **Excluded Walls** — width × height rows for walls you're not painting (wallpaper staying up, etc.); the area comes off everything downstream.
- **Doors & Frames** — doors and frames are separate line items, each with its own quantity, coats and prep. Per line: **Fire door** (FD30/FD60 surcharge, edges included in the paint calc), **ironmongery** (remove & refit, or mask in place), **Self-priming paint** (swaps the primer coat for an extra topcoat in the litres calc — once the room's woodwork paint has a Coverage Rates entry in Settings, that entry's Self-priming flag takes over and the manual toggle is replaced by a note), and **Both sides** (price the whole leaf as one line). A door between two rooms is normally priced once per room — one face each.
- **Extras** — windows, radiators, and internal **window sills** (plastic windows with wooden sills).
- **Wallpaper** — see [Wallpaper](#5-wallpaper) below.
- **Mist Coat** — for new plaster; the **Manual area override** covers the "only part of it is new plaster" case.
- **Panelling** — per-wall W×H rows, own coats (up to 4), own prep and own colour/product, independent of the room's settings. If the panel product has a Coverage Rates entry with Self-priming unticked, panel primer is bought automatically (joining the room's primer line); self-priming products and products without an entry buy none. Each row's **−m² chip** (on by default for new walls) takes that wall's area off the room's wall area so it isn't also priced as wall paint — for half-height panelling enter just the panelled portion and the wall above stays in the room colour. Tap it off for panelling that isn't on a measured room wall (bath panel, under-stairs).
- **Preparation** — the room's prep level; scales labour.
- **Paint & Colour** — colour numbers per surface (walls / ceiling / woodwork / feature wall) and per-room **product overrides** for any of the roles when a room needs something other than your Settings defaults (primer can be set to "None").
- **Preview** — the live estimated cost and time, updating as you type. It also shows for door/frame-only and feature-wall-only entries with no room dimensions.

### 4. Staircases (HSL)

Toggle **Staircase / HSL** on the room form. Choose the number of floors, then fill in the Ground Floor Hall, Staircase(s) and Landing(s) cards. The app derives the true stair-wall shape (the raking wall with its stepped bottom) from steps × tread, the hall width and the top step — you measure heights, it derives widths. Spindles, newels, strings and handrails are counted, with their per-item timings editable under **Settings → Time Rates**. Staircase wallpaper reuses the same geometry to work out drop lengths.

### 5. Wallpaper

Wallpaper is measured per room (or on the feature wall alone). Nicky doesn't supply paper — the app tells you (and the client) **how many rolls to order**, and charges **labour per roll**: lining £30 / finish £40 per roll hung (editable), +15% on ceilings, +25% on staircases, with a **£200 minimum** per room's wallpaper labour. Lining and finish can both be on in one room — labour sums across the mix.

- Roll size defaults to the UK standard (10.05m × 0.53m), editable per job. Pattern repeat is entered in **cm**. Match type (none / straight / offset) drives the waste allowance.
- **Wallpaper types**: **Standard Roll** (the roll calculation above), **Wide Vinyl** (commercial 137cm material, priced per metre/area — feature wall only) and **Mural** (printed to the wall size, priced per m² or a flat fee — feature wall only). Rates for all of these live under **Settings → Wallpaper Rates**.
- The roll count errs generous — an extra roll is the client's cost; running short mid-job is yours.

### 6. Exterior items

**+ → Exterior item.** Each item (e.g. "Front of house") has collapsible sections: **Masonry / Render** (with **Spray render** and **Textured render** toggles — texture is slower and drinks more paint), **Fascias & Soffits**, **Exterior Windows** (one row per matching group, with panes-per-window and an S/M/L size band), **Exterior Doors** (same fire-door/ironmongery/self-priming options as interior), **Garage Doors**, **Porch / Feature Door**, **Sash Window Restoration** (prime & paint plus resin repairs, reglazing, draught-proofing, cords and beads), **Preparation**, **Paint Colours** (one masonry colour + one exterior woodwork colour per item) and **Paint Products**. Access uplifts for 1st floor and 2nd floor+ are applied per item; the percentages are in Settings.

Exterior paint litres are estimated from assumed areas per unit (window, sash, door, garage, fascia width) — the defaults are educated guesses, so calibrate them in **Settings → Exterior Paint Coverage & Areas** as real jobs prove them out.

### 7. Kitchen (cabinet spraying)

**+ → Kitchen.** One kitchen per job, edited in place (no Save button). Set the coat count once (1–4), then enter quantities per size tier (Small/Medium/Large/X-Large) for Doors, Drawer Fronts, End Panels and Fillers, run lengths in metres for Plinths and Cornices, the **Glazed/Curved** premium where it applies, and the **Spray carcasses** toggle (a % uplift on doors + drawers + end panels). Every price and increment is editable under **Settings → Kitchen Rates** — the shipped figures are draft market-research numbers, so check them against your own pricing.

Each of the four item sections shows its **piece count** on the header once collapsed (13 doors, 4 drawer fronts, and so on), so you can shut them all and tally the kitchen at a glance before leaving site. Glazed/curved pieces are counted once, not twice — they're part of the quantity beside them, not extra.

## 8. Colours

**☰ → Colours** is the job's paint and ordering screen: each colour number shows which rooms and surfaces use it and **how much paint to order** (same calculation the Summary uses, so they can never disagree). Look here, not at Summary, when buying paint.

Typing a colour name autocompletes from your colour library — 1,200+ colours across Farrow & Ball, Little Greene, Dulux, Dulux Heritage, Paint & Paper Library and RAL Classic — filling in brand and code for the merchant. Unknown colours can be saved to the library ("+ Save … to your colour library"), including the same name under a second brand. Skip just keeps the typed name as a plain label. The library is permanent and global — Clear Rooms / Clear Everything never touches it.

## 9. Summary — the quote

The Summary is the customer-facing document:

- **Room Breakdown** — each room/exterior item/kitchen itemised, with prep, doors/frames, panelling etc. broken out.
- **Cost Summary** — whole-job labour before materials.
- **Materials** — the calculated list (whole tins are optimised across the *job*, not per room). Edit a line's quantity, delete lines, **Add Material** (search your Xero items or free-text), and **Reorder** to keep paints grouped your way — the Xero quote follows your order. Edits are a snapshot: the **Recalculate** button re-pulls from the rooms and *discards* manual edits. **Sundries & consumables** is a % of labour added automatically.
- **Markup / Discount** — per-quote override of the default markup, as % or a fixed £, negative for a discount. Changing it here never changes the Settings default.

### Commercial Job / Standalone Job

- **Commercial Job** — adds the commercial % (default +10%) *before* markup, stacking with it.
- **Standalone Job** *(new in v2.4.0)* — for jobs booked on their own, where a 1.6-day calculation still blocks out 2 diary days. With the toggle on, labour is charged at the diary days × your day rate, with the calculated days rounded **up** to the next full day — or half day, per the "Standalone job rounding" setting under Your Rates (a 1.6-day job at a £300 day rate charges 2 × £300 = £600; if the calculated labour already exceeds the full-day price, nothing is added — the rounding never discounts). Both figures stay visible (e.g. *Calculated labour 1.6 days / Diary days charged 2 days*), and the top-up flows through commercial %, markup, the deposit plan, the Xero quote and the final invoice like any other labour. A job can be commercial, standalone, both or neither; existing quotes are untouched (default off).

- **Payment** — deposit is **25% of the quote or the materials+sundries cost, whichever is greater** (the % is in Settings). Jobs longer than a week get weekly instalments, derived from the *realistic* on-site days (working time plus the daily overhead and buffer from Settings → Scheduling), with week-commencing dates once the job is scheduled. The payment terms go onto the Xero quote.
- **Colour Schedule** — the per-room colour listing, shared with the CSV export.
- **Export ↓** (top bar) — a human-readable CSV summary of the job. This is *not* a backup — see [Backup](#13-backup).

## 10. Client details & sending to Xero

Connect Xero once in **Settings → Xero Integration**, and pick your default paint products per role under **Materials (Xero Items)** (Refresh from Xero, then choose a range and colour band for each role). Until ranges are picked, the Summary shows estimated litres instead of real prices.

On the Summary's client panel:

- **Client name** autocompletes from your Xero contacts. Picking one pulls their phone, email and address — but **only into blank fields**; anything you've already typed wins (your info may be newer). **Sync to Xero** pushes the app's details the other way, into the contact's billing address, with first/last name derived automatically.
- **Street address** autocompletes as you type (Google-powered, GB only); picking a suggestion fills street, town and postcode.
- **Send to Xero** creates the quote: labour itemised per room/exterior item, then the materials list as real Xero item lines, sundries, and the deposit/payment terms. The job's status becomes **Quoted**.
- While the quote is still DRAFT/SENT in Xero, the button becomes **"Update quote Q-nnn in Xero"** — same quote number, amended in place. **"Send as a NEW quote instead"** is the escape hatch; answered quotes always get a new one.
- Client answers given *in* Xero flow back into the app when you open it; an answer given in the app always wins.
- After the quote is out, the panel collapses to a one-line status — tap **Details ›** to expand it for edits or re-sends.

## 11. Schedule

**☰ → Schedule** (accepted jobs get a **Schedule ›** flow on their Summary, pre-filled with the next free slot). Three views: **List**, **Weeks** (12-week strip) and **Month**. Jobs draw as continuous coloured bars across their booked days; tap a bar for **Open / Move / Unschedule**, tap a day to peek or **start a job here**. Overlaps warn but don't block.

- **Blocked days**: tap a day → "Block day(s)…" — from that day to an end date, one label (e.g. "Holiday"). Blocked days, weekends (unless **Work Saturdays** is on) and **UK bank holidays** (region set in Settings) don't count as working days anywhere — slot suggestions skip them and job bars stretch around them.
- **One-off job on any day**: you can put a single job on a Saturday, Sunday or bank holiday without changing the global **Work Saturdays** setting. Tap the day → **start a job here** (or move a job there) — the confirm tells you what switches on: a Saturday turns on "Saturdays for this job only", a Sunday or bank holiday turns on "Every day for this job only" (that job's dates then run through weekends and bank holidays). In the Summary **Schedule ›** form the same thing is the **Days worked** picker (Usual / + Saturdays / Every day), which switches itself if you pick such a start date. Automatic slot suggestions still only ever offer your usual working days, and your own **blocked days** always win — a job never lands on one.
- **Calendar feed**: toggle on in Settings → Scheduling, then subscribe your phone's calendar to the link (iOS: Settings → Calendar → Accounts → Add Subscribed Calendar). Jobs appear in your real calendar and update when they move; jobs split around days off show as separate events. One-way, app → phone.

## 12. On Site — running the job

The **On Site** tab is the job-management home once a quote is accepted:

- **Job header** — status, dates, and **Build final invoice** once the job is completed.
- **Time on site** — log the actual days worked, against the estimate, for under/over tracking and calibrating your rates.
- **Variations** — mid-job extras. Rooms/items added after acceptance are flagged automatically (the flag can be toggled), and free-typed hours or flat-£ lines can be added. The Variations card shows original vs current totals; variations settle on the final invoice, not the deposit. VARIATION/+N chips mark them everywhere.
- **Materials** — the buy/used list. Tick things off as bought (the ☰ badge counts what's left), adjust quantities to what was *actually* used, and add anything the estimate missed. Manually-added lines have a **Chargeable** tickbox (off = tracking only; on = joins the invoice). Materials are **quoted as an estimate, invoiced as used** — this list *is* the invoice's materials list, so keep it honest.
- **→ Invoice** — the list to invoice, with anything unconfirmed called out for checking first.

## 13. Final invoice

From On Site (on a completed job), **Build final invoice** assembles: labour as quoted + variations + materials as actually used − deposits/instalments already received (applied in Xero). Any line can be dropped before sending. One tap creates a **DRAFT invoice in Xero** for final checking there; the job's status becomes **Invoiced**. Imported-from-Xero jobs keep their invoicing in Xero while they have no measured rooms.

## 14. Settings reference

| Card | What's in it |
|---|---|
| **Your Rates** | Day rate, hours/day, default markup %, commercial %, standalone rounding (full/half day), sundries %, spray sundries bump, deposit %, chase-quotes-after days |
| **Scheduling** | Daily overhead mins, schedule buffer %, Work Saturdays, bank-holiday region, calendar feed |
| **Coverage Rates** | Standard m²/litre per surface (walls, ceiling, gloss, mist, panelling — all **un-sprayed base figures**) and the **spraying uplift %** (one global figure — extra litres when a surface's Spray toggle is on, applied on top of whichever rate is in play; ceilings & woodwork spray by default, walls and fitted units per job), plus **per-product rates**: pick a product range (the same group list the room product pickers use — one rate covers every colour and tin size of the product), a surface and its true m²/litre (and an optional default coat count) — any room using that product (picked on the room or as the Materials default) then calculates litres from the product's own rate; products without an entry keep the standard rate. Woodwork and panelling entries also carry a **Self-priming** flag: on woodwork, ticked means rooms and fitted units on that product skip the separate primer (one extra topcoat coat instead) and unticked means primer is added automatically — either way the product decides, and the rooms' manual self-priming toggles only apply while the paint has no entry here; on panelling, unticked adds a panel primer (panelling never bought one before) and ticked or no entry keeps it primer-free |
| **Time Rates** | mins/m² (or per item) for every surface, doors/frames, sills, mist, panelling, staircase parts |
| **Doors & Frames** | Paintable areas per face, fire-door edge area & surcharge, ironmongery prices |
| **Wallpaper Rates** | Per-roll rates, ceiling/staircase multipliers, trim allowance, minimum price, wide vinyl & mural rates |
| **Exterior Rates** | mins per coat for masonry (smooth/textured), fascias, windows (base/per-pane/size ×), doors, garage, sash extras, access uplifts |
| **Exterior Paint Coverage & Areas** | The assumed areas and coverages behind exterior litres — calibrate against real jobs |
| **Kitchen Rates** | The full price matrix per item type × size, linear rates, glazed/curved %, carcass % |
| **Xero Integration** | Connect / disconnect |
| **Materials (Xero Items)** | Default product range + colour band per role |
| **Appearance** | Light/dark/auto theme (this phone only) |
| **Backup** | Export / import — see below |

Rates take effect immediately on every open (un-accepted) quote — editing a Time Rate reprices live drafts on the spot.

## 15. Backup

**Settings → Backup → Export everything** downloads one JSON file with every job, room, colour, material, actual and your settings. **There is no automatic backup — export regularly**, especially before anything risky; Home's attention strip nudges you when the last export is getting old.

**Import backup** is additive only: imported jobs get fresh identities, so it can never overwrite existing data (worst case is a duplicate-looking job, and name clashes get an "(imported)" suffix). Restoring settings is a separate opt-in toggle on the import preview, since it's the one thing an import *can* overwrite.

## 16. Tips & gotchas

- **Tins are optimised across the whole job**, not per room — that's why a room's litres don't map neatly onto its own tins.
- **Recalculate on the Summary's Materials card discards your manual edits** — it re-pulls from the rooms. Edit after you've finished measuring.
- Measure-tab prices are **your cost before markup**; quote the Summary figure.
- The **colour number** is what drives paint grouping and quantities; names/brands/codes are reference for ordering.
- Two devices? The server copy wins — give the sync dot a second before closing on site.
- The **build number** at the bottom of the ☰ menu is how you check a new version has actually arrived on your phone.
