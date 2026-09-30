# NH Estimator — User Manual

*A pocket guide to the Nicky Hawkins paint-estimating app, from first measure to final invoice.*

NH Estimator is a phone-first web app for pricing decorating work. You walk round the property measuring up, and the app turns those measurements into a fully priced quote — labour, materials, markup, deposit and payment plan — which you can send straight into Xero. Once a quote is accepted, the same app schedules the job, tracks the materials and time you actually use on site, and builds the final invoice back into Xero when you're done.

This manual follows the life of a job in order: **set up → measure → quote → schedule → on site → invoice**. If you're brand new, read [Getting started](#1-getting-started) and [Measuring up](#3-measuring-up) first — the rest will make sense as you need it.

---

## Contents

1. [Getting started](#1-getting-started)
2. [Finding your way around](#2-finding-your-way-around)
3. [Measuring up](#3-measuring-up)
4. [Kitchen cabinet respray](#4-kitchen-cabinet-respray)
5. [Fitted units](#5-fitted-units)
6. [Custom line items](#6-custom-line-items)
7. [Colours](#7-colours)
8. [Price Lookup & Shopping List](#8-price-lookup--shopping-list)
9. [The quote (Summary)](#9-the-quote-summary)
10. [Jobs](#10-jobs)
11. [Schedule](#11-schedule)
12. [On Site — running the job](#12-on-site--running-the-job)
13. [The final invoice](#13-the-final-invoice)
14. [Rates](#14-rates)
15. [Settings](#15-settings)
16. [Backups](#16-backups)
17. [Tips & troubleshooting](#17-tips--troubleshooting)

---

## 1. Getting started

> **Your first half hour**, in order: [install it on your phone](#install-it-on-your-phone)
> → [put your own name on it](#make-it-yours) → [connect Xero](#connect-xero-one-off)
> → [check your rates](#check-your-rates) → [start your first job](#your-first-job).
> That's the whole setup. Everything after section 1 you can read as you need it.

### Install it on your phone

The app lives at its own web address — if someone set this copy up for you, that
link is the one they sent you. It's designed to be **installed to your home
screen** so it opens full-screen like a normal app:

- **iPhone:** open the app in Safari → tap the Share button → **Add to Home Screen**.
- **Android:** open it in Chrome → menu (⋮) → **Add to Home screen** / **Install app**.

If your copy of the app has a password set, you'll be asked for it the first time you open the app on a device — **once per phone, and then not again**. The sign-in refreshes itself every time you use the app, so it only ever comes back if you go a full month without opening it, get a new phone, or clear the browser's data. Let your phone save the password to iCloud Keychain (or your password manager) on that first login and even those rare times are a Face ID tap rather than typing.

Setting a password is worth doing now that you can send clients an approval link: the link points at the same web address the app runs on, so a client who trimmed it back to the domain would otherwise land on your jobs. With a password set they get a sign-in screen and nothing else. If there's no password on your instance, guard the web address like you would any private page.

![Sign-in screen](images/16-login.png)

### Make it yours

**Do this before you send anything to a client.** Until you enter your own
details the app falls back to the name and logo it was built with, so a quote, a
snag-list PDF or even your sign-in screen could go to a client with somebody
else's business on it.

Menu (☰) → **Settings** → **Business**:

- **Business name** — replaces that fallback everywhere it appears.
- **Logo** — optional, and shown *instead of* the name in the header when you
  set one. Leave it empty and your business name is used on its own.

Between them they carry through to the app header, the sign-in screen, the top
of every quote you send and its PDF, the snag-list PDF and your calendar feed.
To check it landed, open any job and tap **Quote ⤴** — what you see there is
what the client sees.

### Connect Xero (one-off)

Almost everything works without Xero, but quoting and invoicing shine with it connected:

1. Open the menu (☰) → **Settings**.
2. Scroll to **Xero Integration** → tap **Connect Xero** and sign in.
3. Back in Settings, under **Materials (Xero Items)**, tap **Refresh from Xero** to pull in your paint products, then pick your default products (wall paint, ceiling, woodwork, primer, mist coat, masonry…). Every new room starts with these defaults, so set them once and forget them.
4. If you plan to record deposits through the app (see [Recording a deposit](#recording-a-deposit)), also pick a bank account under **Settings → Deposits (Xero)**.

### Check your rates

The app ships with sensible defaults (day rate £300, 20% markup, 25% deposit, standard coverage rates), split across two screens off the menu: **Rates** holds the calculation tables, **Settings** holds everything else. Skim through both once and adjust anything that doesn't match how you price — every figure in a quote comes from these numbers.

### Your first job

There's nothing to create before you can start measuring: the app opens on a
starter job called **My Job**, and Measure, On Site and Summary are already
pointed at it. Give it the real name before you go any further, though — a job's
name is what you'll be searching for months later.

Menu (☰) → **Jobs** → tap the **✎** on *My Job* and type the client's address or
job name over it. From then on **`+`** on that same screen starts each new job.
The one you're working on is marked **CURRENT**; Rates and Settings are global
and apply to every job. There's more on all of it in [Jobs](#10-jobs).

Then open **📐 Measure** and put a room in it — [Measuring up](#3-measuring-up)
picks up from there.

---

## 2. Finding your way around

![Home screen](images/01-home.png)

The **Home** screen is your morning glance: the current job and its status, a **Materials to buy** count, **Next on site** — the client you're due at next and the date — and shortcut links. The **`+`** button in the bottom corner starts a new job, the same as the one on the Jobs screen: type a name and you land back on Home with the new job as current. When something needs chasing — a quote that's gone unanswered too long, a finished job you haven't invoiced — it appears at the top of Home as an attention strip.

The **bottom bar** is always visible and follows the life of a job, left to right:

| Tab | What it's for |
|---|---|
| 🏠 **Home** | Dashboard and reminders |
| 📐 **Measure** | Everything measured for the current job — rooms, exterior items, kitchen, fitted units and custom lines |
| 🛠 **On Site** | Time, materials and variations while the job runs |
| 📋 **Summary** | The priced quote, Xero, and job status |

![Menu](images/02-menu.png)

The **menu (☰)**, top right on most screens, holds every other screen:

| Item | What it's for |
|---|---|
| **Jobs** | Switch jobs, start a new one, import a pre-app Xero quote |
| **Colours** | Every surface's colour, decided or not, and paint-ordering quantities |
| **🔍 Price Lookup** | A till-check: search any Xero sales item for its price |
| **🛒 Shopping List** | A running pick-up list, separate from any one job |
| **Schedule** | The job calendar |
| **Rates** | Every number behind a calculated price |
| **Settings** | Business details, Xero, backup, appearance |

Below those, **↩ Undo** appears whenever there's a recent change on the current job you can undo (see [Materials & Undo](#materials--undo)), followed by the sync line — "All changes synced ✓" means everything you've entered is safely on the server — and the build number, so you can confirm a deploy has actually reached your phone. Everything saves automatically as you type; there is no save button to forget.

---

## 3. Measuring up

Open **📐 Measure**. This screen lists everything measured for the current job — **Interior** rooms, **Exterior** items, the **Kitchen**, **Fitted Units** and **Custom Lines** — each showing its cost and estimated days at a glance. The figures on this screen are your *labour cost before markup* (the banner at the top says so); the chip in the top bar shows the customer-facing quote total, and Summary has the full customer-facing breakdown.

![Measure screen](images/03-measure.png)

Tap the **`+` button** (bottom right) and choose what you're adding:

![Add chooser](images/03b-add-chooser.png)

> **Quick add:** walking a big house? Tap **Quick add** instead and just type the room names one after another — Living Room, Hall, Bedroom 1… — then go back round measuring each one on a second pass. Much faster than filling in a full form in every doorway.

### Bulk edit

Once there's more than one room, **Bulk edit** appears on the Interior header. Tap it and every room gets a tick box — pick the ones you want (or **Select all**), then **Edit N rooms**:

![Selecting rooms for a bulk edit](images/22-bulk-select.png)

The panel that opens covers the fields worth doing in one go: a product and colour band for each of the seven paint roles (walls, ceiling, woodwork topcoat, woodwork primer — with a **None** option for a self-priming topcoat — mist coat, feature wall and panelling), coat counts for walls/ceiling/woodwork/doors/frames, a mist coat toggle for walls and ceiling, and the room's prep level (which covers doors and frames too):

![Bulk edit panel — product pickers](images/22b-bulk-panel-top.png)

![Bulk edit panel — coats, mist coat and prep](images/22c-bulk-panel-prep.png)

**Every field starts on "No change" and stays there unless you set it** — nothing carries over from the last time you used it, and a field you don't touch is left alone on every room. Two rules worth knowing: it **never invents a surface a room hasn't got** (ask for woodwork coats and a room with no woodwork is skipped, marked N/A in the preview), and **mist coat only ever adds** — ticking a surface turns it on where it's off, but leaving it unticked never turns an existing mist coat off. Coats work the other way and the form says so: the number you type is the exact coat count, not an increase.

Tap **Preview changes** to see exactly what would move, room by room, `old → new`, before anything is written:

![Reviewing a bulk edit before applying](images/22d-bulk-preview.png)

Nothing is saved until you tap **Apply**; **Back** returns to the panel with every field still set. Afterwards the rooms are ordinary rooms — open any one and edit it as normal, nothing is locked. Staircase/HSL rooms take part too, but only for the fields that actually move their price: door coats, frame coats and every product override apply normally, while wall/ceiling/woodwork coats, the mist toggles and the prep level are skipped (a staircase room's total is worked out and frozen when you save the staircase form itself — change those on the staircase form instead).

Rooms and fitted units can also be **duplicated** — tap the ⧉ icon on their card in the Measure list. Everything copies: dimensions, coats, prep, colours and products, dropped in right below the original as "(copy)". This is the fast way to do bedrooms 2/3/4, or two matching alcove units either side of a chimney breast — measure one, copy it, change a couple of numbers. A copy always starts its own client sign-off from Pending (it never inherits the original's ✓), and on an accepted job it arrives flagged as a variation, same as anything else added after acceptance.

### Putting the list in order

You measure in the order you walk the house, and the room you remembered on the way out lands at the bottom of the list. **Reorder** — on the **Interior**, **Exterior**, **Fitted Units** and **Custom Lines** headers, once that section has more than one row — walks them into the order you actually want:

![Reordering the Measure list](images/03d-measure-reorder.png)

Tap it and every row swaps its cost for **▲▼** arrows; tap those to walk a row up or down. It's one mode for the whole screen — every section's link reads **Done** while it's on, and any of them turns it back off. A row only ever moves **within its own section** (a room never walks into the exterior list), and the sections themselves keep their order. While you're reordering, rows don't open when tapped and can't be swiped away, so nothing gets deleted or edited by a stray finger — and the arrow at the top of a list is greyed out because there's nothing above it.

**The order you set is the order everything downstream reads:** the Summary breakdown, the client-facing Quote view, the Xero quote, the CSV export and the final invoice. Each move saves as you make it, like any other change (offline included, queued until you're back in signal). Bulk edit and Reorder are one at a time — turning either on takes the other's link off the header until you're done.

### Adding a room

![Add Room form](images/04-add-room.png)

The form is in two halves, and it follows how you actually work: **walk the room** first — every card that asks you to look at something and count it — then **decide the scheme** once at the end, in the last three cards. Nothing makes you jump back and forth between measuring and pricing while you're stood there with a tape.

**Every card is collapsed when the form opens**, so what you see first is a short index of the room rather than a page to scroll past — tap a heading to open that card, tap it again to fold it away. The two exceptions are at the top: **Room Details** (the room name, the Staircase / HSL toggle, and — once the quote is accepted — the **Variation** toggle) is always on screen, since you touch them on every room, and **Dimensions** starts open because you fill it in every time. Dimensions is still an ordinary section, so once you've measured you can collapse it too and keep the rest of the form in view.

Only the top matters for a basic room:

1. **Room Name** — e.g. "Living Room".
2. **Dimensions** — pick the **Room shape** first:
   - **Standard** — length × width × height, for a plain rectangular room (the default).
   - **Perimeter** — type the wall perimeter and ceiling height directly, plus the ceiling area, when the footprint doesn't reduce to L×W.
   - **Segments** — build the room from rectangular zones (each L×W) that sum into the wall run and ceiling area — made for L-shapes and rooms with big alcoves.

   In any mode, the **Bay Window & Alcove/Dormer** add-ons cover the common awkward bits: bay window extra perimeter, alcove/dormer wall and ceiling area, and a sloped-ceiling toggle (type the measured ceiling area directly, since a slope makes length × width wrong). So loft rooms and bays no longer need fudged numbers. (The **Staircase / HSL** toggle above swaps this card for staircase geometry — see [Staircases](#staircases-hall-stairs--landing) below.)

   ![Segments mode — building an L-shaped room from zones](images/04b-room-shape.png)

#### Walk the room

The rest of the measuring cards follow in the order you'd meet them moving round the room — all optional, all collapsed until you tap them, and you skip whatever the room hasn't got:

- **Doors & Frames** — doors and their frames are priced as separate line items, each with its own quantity and coats:

  ![Doors & Frames card](images/04d-doors-frames.png)

  Leave a Door or Frame's quantity at 0 to price just the other one. Their prep comes from the room's **Preparation** card — there's one prep decision per room, not a separate one here. Per line you'll also find **Fire door** (an FD30/FD60 intumescent-compatible surcharge, edges included in the coverage calc), **ironmongery** (remove-and-refit, or mask-in-place — mutually exclusive), and **Both sides** (price the whole leaf as one line instead of just the face seen from this room — handy for a door between two painted rooms, split one face each). **Self-priming** for doors and frames is not here — it's with the rest of the woodwork's priming, under **Paint & Colour › Woodwork Primer** ([below](#decide-the-scheme)), and the row here just says so.
- **Extras** — windows (m²), window sills and radiators. Each adds its own time and paint. Putting a figure in **Radiators** also brings up the **Radiators** colour row in Paint & Colour below — see [Radiator colours](#radiator-colours).
- **Feature Wall** — one wall in a different finish: paint, or wallpaper (standard, wide vinyl or mural).
- **Wallpaper** — lining and finish paper for walls or ceiling, priced per roll with an automatic **rolls-to-order** count, plus a free-text note for the paper itself. **Finish paper takes that surface out of the paint** — no emulsion bought, no painting time charged, whatever the Coats card says. Lining on its own still paints (it's hung *to be* painted over). Covered in detail in [Wallpaper](#wallpaper--rolls-to-order) below.
- **Excluded Walls** — walls you're *not* painting (a tiled wall, wallpaper that's staying). Add its width × height and it's deducted.
- **Panelling** — wall panelling by area with its own coats (up to 4), prep and colour, independent of the room's own settings. Leave a wall's **−m²** chip on when the panelling sits on the room's own walls: its area comes off the painted walls *and* the wallpapered walls, so you can paper a room and paint its panelling without paying for either twice. For half-height panelling enter just the panelled part — the wall above keeps its paint or paper.

  ![Panelling walls with the −m² and Skirt chips](images/04f-panelling-skirting.png)

  The **Skirt** chip is for skirting painted in the panelling's paint and colour, which it usually is. With it on, that wall's skirting comes off the room's woodwork (both the time and the woodwork paint) and is priced as part of the panelling instead: the wall's width × a 0.15 m skirting board, at the panelling's coats, time rate and prep, out of the panelling tin. **Skirting painted with panelling** under the rows shows how many metres have moved, and on Summary the room's line reads **Panelling (incl. skirting)**. Both chips start on for a new wall; tap **Skirt** off where the skirting is a different colour and it stays with the rest of the woodwork. Rooms saved before this chip existed keep their skirting as woodwork until you tap it on. It works on staircase rooms too.
- **Mist Coat** — for fresh plaster; tick walls and/or ceiling, with a manual area override for "only part of it is new plaster".
- **Wallpaper Stripping** — paper coming off before you paint. Tick **Walls** and **Ceiling** separately (a room papered on the walls with a painted ceiling is the usual case), and give each surface its own **paper type**:

  ![Wallpaper Stripping card](images/04i-wallpaper-stripping.png)

  The four types are **Lining** (a single skim of lining paper), **Standard** (ordinary patterned or vinyl), **Textured** (woodchip, blown vinyl, heavy embossed) and **Layers** (papered over more than once — a steamer job). Each carries its own minutes per m², set once on [Rates › Wallpaper Stripping](#14-rates). The room's walls and ceiling are already measured for the paint, so there's nothing extra to measure: the time is *that surface's m² × its type's minutes per m²*, and the line under the toggles shows the sum it just priced. Walls you've put in **Excluded Walls** aren't stripped either — paper that's staying isn't work.

  The time joins the room's labour like any other prep step, so it lifts the room's price *and* its days on the Schedule.

  **On the client's copy it gets a line of its own** — *"Wallpaper Stripping — Back Bedroom"*, with the paper type underneath. That's the point of it: on a strip-out, or a strip-and-repaper, a room line reading *"Back Bedroom £480"* with nothing painted looks like a mistake rather than a day with a steamer. The money is **carved out** of the room's line, never added on top, so the total is exactly what it was — and a room that's *only* being stripped shows the one line rather than a £0.00 paint line beside it. Summary still counts it inside the room (that's the view that feeds the diary and the spec sheet) and marks the row *own quote line* so the two reconcile.

  **It's named in the [quote description](#the-quote-description) too**, beside the mist coat: *"Existing wallpaper will be stripped from the walls prior to decoration."* (past tense on the invoice). It says the surfaces, not the paper type — the type is on the priced line, where it's what explains the figure. A job where **nothing is being painted** now reads properly as well: the description describes the stripping instead of leaving the painting paragraph empty.

  > **Set the rates before you use it.** The four minutes-per-m² figures ship at **0** — they're yours to calibrate, and the app won't guess a number for work it has never watched you do. With a type still at 0 the card says so in orange rather than quietly pricing the strip at nothing.

#### Decide the scheme

Once you've stopped measuring, the last three cards are the pricing decisions — made once, with the room already captured:

- **Coats** — walls, ceiling and woodwork each default to 2. Set any of them to 0 to skip that surface entirely (e.g. ceiling not being painted). Below the coat counts sit three independent **spray toggles** — one per surface:

  ![Coats card with the three spray toggles](images/04c-coats-spray.png)

  **Spray walls** is off by default (also adds the spray sundries bump for the extra masking); **Spray ceiling** and **Spray woodwork** are on by default, since ceilings and woodwork are normally sprayed. A surface's toggle adds the Rates spraying uplift % to its litres on top of the standard or per-product rate — labour time is unchanged either way.
- **Preparation** — Minimal / Standard / Heavy, or a custom percentage. This scales labour across the whole room, doors and frames included. **Making Good** adds a fixed £ amount for repairs.
- **Paint & Colour** — each surface takes your default product from Settings; override the product or colour band here when a room is different. The **colour** itself is a free-text box per surface (walls, ceiling, woodwork, and again on Feature Wall and Panelling), pre-filled with where it goes — leave it as it is and decide later. See [Colours](#7-colours). A room with radiators measured also gets a **Radiators** colour row here — see [Radiator colours](#radiator-colours).

  **Self-priming lives on this card**, under **Woodwork Primer** — both toggles, together, rather than one in Doors & Frames and the other in Preparation:

  ![Self-priming under Woodwork Primer](images/04g-self-priming.png)

  **Self-priming — doors & frames** and **Self-priming — other woodwork** (skirting, sills, windows) each skip the primer coat on their woodwork and add one extra topcoat in its place. Sitting them under the primer product is the point: with a toggle on, that primer isn't bought for that woodwork. The **Woodwork Topcoat** product a couple of rows above can take the decision off you entirely — give that paint a Coverage Rates entry in Rates with **Self-priming** set, and both toggles are replaced by a note reading *On — ⟨product⟩*, because the product has decided. Clear the entry and your toggles come back exactly as you left them.

Two cards at the bottom sum up what you've entered:

- **Preview** — the live estimated cost and time, updating as you type.
- **Paint Needed** — how many litres this room takes, per surface, at your coverage rates (with each surface's spray uplift already included, rounded up to the half litre):

  ![Paint Needed card](images/04e-paint-needed.png)

  These are the same figures Summary's materials list buys from — a feature wall in the room's own colour and product folds into the Walls line rather than getting its own row, since that's one tin of paint bought once.

### Staircases (Hall, Stairs & Landing)

Stairwells are the hardest thing to measure by hand — big raking walls you can't get a tape across, hall and landing running into each other. The app does the geometry for you. Flick the **Staircase / HSL** toggle at the top of the room form and the Dimensions card is replaced with staircase geometry:

![Staircase / HSL form](images/14-hsl-form.png)

Work down the cards:

1. **Number of Floors** — 1, 2 or 3 including the ground floor. A typical two-storey house is **2**: ground-floor hall, one staircase, first-floor landing. Choose 3 and a second staircase and landing appear.
2. **Ground Floor Hall** — plain length × width × height, like any room.
3. **Staircase 1** — this is where the app earns its keep:

![Staircase details](images/14b-hsl-stairs.png)

- **Stair walls** — how many sides of the staircase get painted (1 or 2).
- **Steps** — count them as you go up.
- **Stair width** — the physical width of the stairs.
- **Wall height at bottom** — floor to ceiling at the foot of the stairs.
- **Riser** and **Tread** — pre-filled with the standard 220 mm; only touch these on an unusual staircase.
- **Top step** — the one measurement people get wrong, so it has its own diagram:

![How the stair wall is measured](images/15-stair-wall-diagram.png)

The trick, as the diagram shows, is that the big raking stair wall's width is **derived, never measured**: hall width + (steps × going) + top step. Measuring across the top instead double-counts the stairwell void; measuring along the bottom is impossible because the stairs are in the way. You measure only the easy things — heights straight up with a laser — and the app builds the wall from the step geometry.

4. **1st Floor Landing** (and 2nd, for three floors) — plain length × width × height again.
5. **Staircase Details** — spindles, newel posts and their woodwork coats. These are priced per piece, with their own timings editable under Rates → Time Rates.

The **Staircase Areas** card at the bottom shows its working — so you can see exactly what you're pricing and sanity-check it against the space you're standing in:

![Staircase areas breakdown](images/14c-hsl-areas.png)

Here the derived stair wall width is 5.01 m (1.9 m hall + 13 steps × 0.22 m + 0.25 m top step), giving 13.23 m² of raking stair wall on top of the hall's 29.28 m² and the landing's 23.52 m² — a 66 m² job in total, priced at 2.74 days, without a tape measure going anywhere near the stairwell.

### Wallpaper & rolls to order

Any room (including a staircase) can have wallpaper on the walls, the ceiling, or both. Open the **Wallpaper** section of the room form:

![Wallpaper section with rolls-to-order](images/13-wallpaper.png)

- **Pattern / product note** — free text at the top of the card, for whatever you'll want to know later: the pattern name, the supplier, "paste-the-wall", "heavy vinyl, needs a seam roller". Write it while you're stood in the room looking at the paper, and it's there when you come to order or come back to the job. It's **your note, not the client's** — it never appears on the client quote, the Xero quote or the Colours screen, and it doesn't affect a single figure. Optional; leave it blank if the paper is unremarkable.
- **Lining / Finish** — tap either or both. Both on means "line out, then hang finish paper", and each is priced separately per roll (rates in Rates → Wallpaper Rates). The labour appears immediately.
- **Roll length / Roll width** — pre-filled with the standard 10.05 m × 0.53 m; check the label of the actual paper and adjust.
- **Pattern match** — *No match* (lining papers, plains), *Straight* or *Offset*. A pattern match wastes paper, and the calculation accounts for it.
- **Pattern repeat** — in cm, straight off the roll label.
- **Spare roll** — adds one extra to the order, just in case.

Below the inputs the app shows its working, batch-book style: the **drop length** (wall height plus trim allowance, lengthened to allow for the pattern repeat when there's a match), **drops per roll / drops needed**, and the bottom line — **Rolls to order**. Read that to the client off your phone.

![Rolls to order, and the cards that follow it](images/13b-wallpaper-rolls.png)

**The drops-needed figure now writes itself onto the quote.** The Wallpapering and Painting & Papering templates open their wallpapering paragraph with *"[X] lengths of [paper name/supplier] to be hung to…"* — that `[X]` used to be yours to type, and is now filled in. It's the **lengths** (strips hung, added up across the whole job), not the rolls: rolls are what you order, and they're the figure above. A wall that's lined *and* papered counts **once** — how many strips go round a wall doesn't change with the paper, and the lining is already described as prep a paragraph earlier. A wide-vinyl feature wall counts (still hung in drops); a mural doesn't (one printed piece). The paper name is still yours to fill in.

Two things worth knowing:

**Papering a surface stops it being painted.** Measure a room the ordinary way — coats default to 2 — then tick **Finish** on the walls, and the wall emulsion and the wall painting time both come off: the paper is going over them. A note on the card says so, because the Coats card still reads 2 and the Paint Needed card just quietly drops a row. **Lining alone changes nothing** — lining is hung to be painted over, so a lined wall keeps its coats, its litres and its time. Setting coats to 0 by hand is still how you say "don't paint this" for anything else. A **painted feature wall** in a papered room keeps its paint and picks up its own labour line.

- The rolls figure is a **buying guide, not a charge** — the labour feeds the quote; the client buys the paper — and the app deliberately doesn't supply it.
- On a staircase/HSL room, wallpaper labour automatically picks up the **staircase multiplier**. Ceilings get their own multiplier the same way.
- **Panelling comes off the paper.** Any Panelling wall with its **−m²** chip on is taken out of the wall paper: a full-height panelled wall loses its drops altogether, and half-height panelling (wainscoting) leaves shorter drops above it, which the count cuts from the offcuts left on your rolls. Turn the chip off for panelling that isn't on the papered walls (a bath panel, boxing-in). Staircase rooms don't do this yet — their paper is still worked out from the full stair walls.

Besides the standard roll calculation above, two other wallpaper types are available (feature wall only, under Rates → Wallpaper Rates for pricing): **Wide Vinyl** (commercial 137 cm material, priced per metre/area) and **Mural** (printed to the wall size, priced per m² or a flat fee).

### Adding an exterior item

![Add Exterior form](images/05-add-exterior.png)

Exterior work is priced per *item* — typically one per elevation ("Front elevation", "Rear + gable") or per job type ("Fascias all round"). Each item is a menu of exterior work; fill in only what applies:

- **Masonry / Render** — area in m² and coats, with toggles for **textured render** (more paint, more time) and **spray render**.
- **Fascias & Soffits** — linear metres and coats.
- **Exterior Doors & Frames** — same fire-door/ironmongery/self-priming options as interior doors, split the same way.
- **Garage Doors**, **Porch / Feature Door** — priced in days.
- **Windows** — now priced in their own fixture, [Windows and doors](#windows-and-doors) below, with a drawing of each side of the house. The form's old *Exterior Windows* and *Sash Window Restoration* sections only appear on a job that already has windows priced that way, so nothing you quoted before changes.
- **Preparation** — Light (10%), Standard (25%) or Heavy (40%), or a custom percentage, on the item's labour. New items start on Light. An older item saved at 0% prep opens as **Custom** 0%, so its price stays the same. **Making Good** adds a fixed £ amount, as on rooms.
- **Paint Colours** — one masonry colour and one exterior woodwork colour per item, in the same free-text boxes the rooms use.

Access uplifts for 1st floor and 2nd floor+ work are applied per item automatically; the percentages live in Rates. Exterior paint litres are estimated from assumed areas per unit (window, sash, door, garage, fascia width) — calibrate these in **Rates → Exterior Paint Coverage & Areas** as real jobs prove them out.

### Windows and doors

**+ → Windows and doors** on Measure. The outside faces of every window and door on the house, set up on a drawing of each side. (Inside faces stay in the room measures.)

**1. The house.** The **House** card sets up the drawing so it looks like the actual house. None of it changes the price; it's what the drawing looks like, and what each new window or door starts as.

- **Period** — Georgian, Victorian or Modern. This is just a starting point. Picking one fills in everything below with that period's usual choices: a Georgian house starts as a stucco mid terrace behind a parapet, with 6-over-6 sashes and a pedimented door; a Victorian one as a buff-brick semi with a pitched roof and 2-over-2 sashes; a Modern one as a rendered detached house with casements. Change any of it afterwards. If you've already changed something and then pick a different period, it asks before putting everything back to that period's defaults.
- **Finish** — stucco, buff brick, gault brick (paler and greyer), red brick, render or painted brick.
- **Form** — detached, semi, end terrace or mid terrace. This decides which sides there are to paint: a detached house has all four, a semi or end terrace has the front, the back and its **open side** (left or right, as you face the front), and a mid terrace just the front and back. Neighbours are drawn faintly against a terraced or semi house so it reads as one.
- **Roof** — a **parapet**, a pitched roof with its **eaves to the street**, or a **front gable**.
- **Sides that differ** (tap to open) — for a side that doesn't match the rest of the house: a red-brick back behind a stucco front, or a gable at one end. Each side has its own **finish** and **roof** (*parapet*, *eaves* or *gable*: what that side shows). Leave it on **Same** to follow the house. Dormers follow that side's roof, so a side set to a parapet can't have them. Picking a new period puts every side back to **Same**.
- **Details** (tap to open) — the period's finer points. Georgian: the doorcase (pediment with a radial fanlight, plain fanlight, or portico), window heads (plain, or gauged brick arches on a brick finish), glazing (6 or 8 over 8), the band course and the front railings. Victorian: the sashes (1 or 2 over 2, or margin lights), heads (stone with a keystone, or brick arches), the entrance (recessed arched porch, open with a canopy, or gabled timber porch), bargeboards on a front gable, and plain or polychrome brick bands.

![The House card: period, finish, form and roof](images/26l-windoors-house.png)

![The Victorian details](images/26m-windoors-details.png)

![Sides that differ: the back in red brick](images/26s-windoors-sides.png)

![The back drawn in red brick, the rest of the house in stucco](images/26t-windoors-red-brick-back.png)

Every change redraws the house straight away, and applies to every side (except anything set under *Sides that differ*). If a change would hide a side that has windows or doors on it (a detached house changed to a mid terrace, say), or would remove dormers (changing the roof to a parapet), it says which ones it will hide and asks first. **Nothing is deleted.** While hidden, those windows and doors and any work marked on them are left off the price, the quote wording, the paint and the reports. Change the house back and they return exactly as they were, work included. So it's safe to try a different house type to show someone. (Before v2.88.2 this deleted them. If that happened on a job, they can be put back from a database backup; ask for the Windows and doors restore.)

Once any side's layout is confirmed, the House card folds down to one line (*Georgian · stucco · mid terrace · parapet · light prep · individual detail*) to save space, and so does the Paint card (*2 coats · windows White · doors Black*). Tap either one, or **Edit**, to open it again, and **Hide** to fold it.

![The House and Paint cards folded once the house is set up](images/26x-windoors-house-folded.png)

In the House card, set the **Default prep** for the job; every opening starts there. Leave **Individual detail** on for old windows, where you'll want to mark single panes and frame parts; turn it off for a job of new windows where that's never needed.

**2. Each side.** Tap a side — only the sides this house has are offered. Set the floors and how many windows (**W**) and doors (**D**) are on each — the drawing updates as you go. Doors start on the ground floor only; add one upstairs for a balcony or Juliet. The ends of the house draw as gables (or, under a front gable, as the eaves).

![Setting the layout of one side, with dormers and a lower ground floor](images/26a-windoors-layout.png)

Two more levels can be switched on for each side, and both are priced like any other windows and doors:

- **Dormers** — windows in the roof, above the top floor (not with a parapet roof). Windows only. On a side where the roof shows as a gable, these are drawn as windows in the gable itself. A dormer window's detail view also has its **dormer fascia** and **left and right cheeks** to mark, alongside the window's own parts.
- **Lower ground floor** — a floor below the pavement, with its own windows and doors, drawn in its light well with railings along the top and a bridge across to the front door.

They're labelled *Front, dormer, W2* and *Front, lower ground, W1*.

![A Georgian terrace in buff brick, with dormers and a lower ground floor](images/26n-windoors-terrace.png)

On a Georgian house a new dormer starts as a **3-over-6** sash, one row fewer on top than the 6-over-6 windows below it (4-over-8 beside 8-over-8). Dormers added before v2.85.1 started as 3-over-3: open each one and set **Bottom sash rows** to 2. A sash with more rows in one half than the other is drawn with its meeting rail where the rows put it: a 3-over-6's top sash is a third of the window, so every pane is the same size, as on the real thing.

![A 3-over-6 dormer window: its fascia and cheeks can be marked too](images/26o-windoors-dormer.png)

**3. Confirm layout.** The windows and doors become real and tappable, numbered left to right as you face that side — W1, W2… and D1, D2… counted separately on each floor. **Edit layout** unlocks the side again; taking a count down removes openings from the end of that floor, and warns you first if any of them has work marked on it.

![The front elevation — solid badges mark quoted work](images/26b-windoors-elevation.png)

**4. Tap a window or door** to open its detail. Its label reads like *Front, first floor, W2*; add a **nickname** ("landing", "above porch") if that's how you'd say it on site.

- **Type** — casement, sash or fixed; or for doors panelled, flush, half glazed, fully glazed, stable or French (double).
- **Pane rows and columns** — on a sash window, the **top sash rows** and **bottom sash rows** are set separately, with the columns shared, so a 3-over-6 is 1 row over 2 rows of 3 columns. The line under them spells it out (*3 over 6 · 9 panes*). For doors these are the panel or glass grid.
- **Size** — each button shows the area it covers (Small is under 0.5m², Medium 0.5 to 1m², Large 1 to 2m², X-Large over 2m²).
- **Prep** — only levels at or above the job's default are offered. An opening can go up, never down.
- **Access** — how you reach it. **Auto** (the default) works it out from where the opening sits: the lower ground and ground floor are **Ground**, the first floor is **First floor**, and the second floor up and every dormer are **Ladder/tower**. The Auto button names what it picked, e.g. *Auto (First floor)*. Set it by hand when the house says otherwise — **Ground** when the scaffold is already up, **Ladder/tower** for a ground-floor window over a basement well. An opening set by hand shows a small dark dot at the bottom corner on the house drawing. Access is set at quoting; on site the sheet just says what was priced.
- **Marking work** (with Individual detail on) — tap panes, or tap frame parts (head, stiles, rails, cill; for doors the panels, frame and threshold). A tick shows what's selected. You select one kind at a time: tapping a frame part while panes are selected starts a fresh selection. **Select all panes** and **Clear selection** do what they say. Then tap the work — **Reputty** or **Replace glass** for panes; **Filler**, **Resin repair** or **Splice timber** for parts, plus **Ironmongery off & on** and **Ease** on doors, and **Re-cord**, **Replace beads** and **Ease & overhaul** on a sash window's parts — or **Remove work**. The selection clears after each one. On a sash, each mark is for that part: re-cording the left stile is the cords on that side, so mark both stiles for a full re-cord.

![Marking panes and parts on one window](images/26c-windoors-detail.png)

**Resin repairs have a size.** A nail-hole fill and a rebuilt sill nose aren't the same job, so each resin repair gets a size under **Repair size** on the window's sheet: **S** (nail hole to thumb-sized), **M** (up to palm-sized), **L** (a rail end or a cill corner) or **XL** (a sill nose or a rail rebuilt). A new repair starts at the size you last picked on the job, or Medium. The list under the diagram says it, *Resin repair (cill, L)*. The price is a fixed part for any size (setting up, consolidating, the wait for it to cure, coming back to it) plus the size's own time and resin, from **Rates → Windows & Doors**. Repairs marked before sizes existed are Medium, which is exactly what they cost before, so no quote moves. Until the quote is accepted you can change a size up or down freely; it's just quoting.

**Two repairs on the same part**, such as a small patch at each end of a cill: mark the cill with **Resin repair** once, pick the size, then set **Repairs on this part** to **2**. The label reads *Resin repair (cill ×2, S)*. The base (setting up, the cure wait, coming back) is charged **once for the part**, and the size's time and resin once for each repair. Tapping Resin repair on the cill again doesn't add a second one; it reminds you to use the count. If the two patches are different sizes, pick the size that covers the bigger one, or split the difference. The count can be changed until the quote is accepted.

![Two small resin repairs on one cill](images/26zh-windoors-two-repairs.png)

Orange is work, blue is glass being replaced. Work marked here is **quoted** work and shows solid; work added on site shows dashed. Changing the type or the pane grid clears that opening's marks, so it asks first if there are any. The list under the diagram says, in words, everything on this opening. The first line is the painting itself, with what it was priced on: *Paint, outside face · light prep · 2 coats · first floor access* (with *(set by hand)* when you chose the access).

![First floor W2's access set to Ground by hand (scaffold already up): the dark dot at its bottom corner](images/26y-windoors-access-dot.png)

**Coats and access change the price.** Painting minutes are set for 2 coats, so **1 coat** in the Paint card halves them (a maintenance coat) and **3 coats** adds half again. Access adds the same uplift as the Exterior form: first floor +10% and ladder/tower +25% to start (**Rates → Exterior Rates → Access**). Both apply to the painting only. Marked work like reputty, glass, filler, resin and splice is a one-off job and stays the same price whatever the coats or the height. A medium 6-over-6 sash at Light prep is 110 min on the ground floor at 2 coats, 121 min on the first floor, and 206 min on the second floor at 3 coats.

Until you set a window's panes here, the house drawing shows it with the period's glazing (change Georgian 6-over-6 to 8-over-8 in Details and the drawing follows). Once you've set its type, rows or columns, the drawing shows the panes you set. The price always uses the panes set here.

**Bays.** Each floor in the layout also has a **B** count for bay windows. It's shown straight away on a Victorian house; on a Georgian or Modern house, tap **+ Bays** first. A bay is counted once, on the floor where it starts. On a Victorian house, a bay on the ground floor starts as a **two-storey** bay running up through the first floor, and the windows above are laid out around it.

![A two-storey canted bay beside the front door](images/26p-windoors-bay.png)

Tap a bay on the drawing to open the **bay view**. Set its **shape** (**canted**, with angled sides, or **square**), its **storeys** (one or two — two needs a floor above), and its prep. The strip shows its left, front and right windows, storey by storey. Tap any of them to open that window's normal detail view (**‹ B1, the whole bay** takes you back). Each window has its own type, size, panes and prep, and is labelled like *Front, ground floor, B1 front*. The bay's own timber — the **cornice**, **fascia**, left and right **mullions** and the **cill** — can be tapped and marked like a window's frame parts. A badge on a window in the strip means it has work marked on it.

![The bay view: its windows and its own parts](images/26q-windoors-bay-view.png)

A bay's price is its own **bay base minutes** (Rates, by shape and storeys, covering the cornice, fascia and mullions) plus each of its windows priced as a window. Each window takes the access for its own floor. The bay's own timber goes by its top storey, so a two-storey bay from the ground takes the first-floor uplift. The bay view has its own **Access** control for that timber. Making a two-storey bay single-storey removes the upper windows, asking first if any have work on them.

**Not in this job.** A door you painted last time, or a window someone else is replacing, still belongs on the drawing — the house doesn't look right without it. Open it and set **In this job** to **Not in this job**. It stays on the drawing (faded in the app, with a grey **–** badge where the work badge would be; drawn normally on the client's copy of the report), but it's left out of everything else: no price, no paint, not counted in the openings, not named on the quote's line, not on the work-to-do list, and it can't have work marked on it. You can still set its type and panes so it's drawn right. Any work already marked on it is cleared, and it asks first. Set it back to **In the job** to price it again. Leaving a **bay** out leaves its windows out too.

![Front D1 not in this job: drawn, faded, not priced](images/26za-windoors-not-in-job.png)

If it turns out on site that it does need doing after all, open it on **On Site** and tap **Add to this job — as a variation** (see [Windows and doors on site](#windows-and-doors-on-site)).

**Other items.** Garage doors, fanlights, porches, porticos and lean-tos don't sit on a floor. Under each side's drawing, **+ Add other item** asks what it is, then opens it. Choose how it's **Priced**:

- **By time** — how long it takes to do, before prep, as you'll actually do it (it isn't scaled by coats or access). Pick **Minutes**, **Hours** or **Days** and type the figure: *1.5 days* for a portico. A day is your **hours per day** from Settings, and the time goes into the job's days like any other labour.
- **Set price** — a £ figure for the labour, e.g. **£300**. It goes into the Windows & Doors total as it is and takes your markup like everything else. Prep and access don't change it (so there's no prep to pick), and it adds no days to the job.

Either way, add any **materials £** it needs beyond paint, and a **paint area** in m² (0 if you're not buying paint for it). **Painted in** sets whether it uses the doors' colour or the windows' colour. The list under the house shows each one's figure (*O1 Portico · 1.5 days*, or *£300 set price*), and the card under the sides shows how much of the total is set prices.

![A portico as an other item at a set price](images/26zb-windoors-other-set-price.png)

This is the place for a porch or portico rather than a separate Exterior item, so it sits with the rest of the joinery and on the same quote line.

**Drawing a porch over the door.** An other item is drawn as a tile under the house unless you say otherwise. Under **Drawn as** on its sheet, pick a porch style instead and it's drawn over a ground-floor door on that side:

- **Flat canopy** — a flat hood on two brackets.
- **Arched hood** — a shell hood on carved brackets.
- **Portico** — columns carrying a flat entablature, with a fanlight.
- **Portico, pediment** — columns and a pediment on top.
- **Gabled timber** — timber posts and rails under a small gabled roof.
- **Enclosed porch** — a lean-to porch built out in front, in the house's wall finish, with a glazed light either side.

Each button shows a small picture of the style in your house's colours. If the side has more than one ground-floor door, **Over** picks which (D1, D2…). The door's own doorcase (the one set in the House card's Details) gives way to the porch, and the drawing labels it **O1 D1** over the top. Tap the porch's roof to open the porch, or the door to open the door. The list under the house says *O1 Portico over D1*.

It's drawing only: the porch is still priced from its own time or set price, and it can still have its face and frame marked. If you add an item called "portico", "porch", "canopy" or "hood" on a side with a ground-floor door, it starts as a porch in a matching style; anything else starts as a tile. A side with no ground-floor door (or a door that already has a porch) shows it as a tile.

![A pedimented portico drawn over the front door](images/26zc-windoors-porch-drawn.png)

![Drawn as: a tile, or one of six porch styles](images/26zd-windoors-porch-styles.png) It's drawn as a tile under the house, numbered **O1, O2…** and labelled *Front, O1 (Garage door)*. You can mark its **face** and **frame** like a door's parts (filler, resin, splice, ironmongery, ease). Changing a side's layout never touches its other items; **Remove this item** at the bottom of its sheet does. On the quote it's named in the fixture's line: *…1 front door, garage door.*

![A garage door as an other item, under the house](images/26u-windoors-other-items.png)

![An other item's own figures](images/26v-windoors-other-sheet.png)

**Paint.** The **Paint** card under the house settings sets the **coats** (2 to start), and a **product** and **colour** for the windows and for the doors — the satin on the sashes and the gloss on the black front door. The product pickers work like a room's: search the ranges, pick a colour band where the range has more than one, or leave it on *Use default (Settings)* for the exterior woodwork topcoat. The colours are the app's ordinary colour fields — type-ahead from the colour library, one-tap picks from colours already on the job — and they show on the Colours tab as *Exterior Windows* and *Exterior Doors*, beside every other area. Primer always follows the exterior primer in Settings.

![The Paint card: coats, and a product and colour each for the windows and the doors](images/26i-windoors-paint.png)

The litres are for the **timber only** — a window is mostly glass. Each window starts from its own size (the middle of its size button's range: a Medium window is 0.75 m²) and takes the share of that which is timber: 35% for a casement, 40% for a sash, 25% for a fixed light, plus 2% for each extra pane's glazing bars, up to 60%. So a Medium 6-over-6 sash is 0.45 m² of paint, and a Large one 0.9 m². A door is its leaf less any glass, plus the frame. A bay adds 1.2 m² of its own timber per storey, painted with the windows. That's times the coats, at the exterior woodwork coverage, plus primer. Every figure is under **Rates → Windows & Doors → Paint areas**.

![Rates — Windows & Doors paint areas](images/26j-windoors-paint-rates.png)
 The paint goes on Summary in the same **Exterior Woodwork** and **Exterior Primer** rows as any exterior item, using the exterior woodwork product from Settings, so windows and a fascia in the same colour are one lot of tins. It's also on the job spec sheet as its own rows. On a job whose materials list was already made, tap **Recalculate** on Summary to bring it in.

**On the quote** the whole fixture is **one line**, worded from what's in it — *Exterior windows and doors (outside faces): 5 sash windows, 1 front door. Includes reputty x3, resin repair x1.* (or, with the newer pieces, *…10 sash windows, 3 dormer windows, 1 canted bay, 1 lower ground door, 1 front door.*) — through Summary, the client's quote and Xero. On the final invoice it becomes one line worded for the client, with everything added on site included (see [Windows and doors on the invoice](#windows-and-doors-on-the-invoice)). The minutes behind it (see [Rates](#14-rates)) go into the job's time like any other labour.

The work report — what was done where, with the drawings — is covered under [On Site](#windows-and-doors-on-site).

### Site notes

Tap the **📝 button** (bottom left of Measure) any time to jot job notes — access arrangements, things agreed on the doorstep, snags you spotted. Notes save automatically and stay with the job.

![Site notes](images/03c-site-notes.png)

---

## 4. Kitchen cabinet respray

On **Measure**, tap **`+` → Kitchen** to open the dedicated cabinet-spray calculator — one kitchen per job, saved automatically. Once it has anything in it, the kitchen appears as its own priced line in the Measure list and the quote.

![Kitchen screen](images/06-kitchen.png)

- **Coat count** (1–4) applies to every item below.
- Tap open **Doors, Drawer Fronts, End Panels** and **Fillers** and enter how many of each size (Small / Medium / Large / X-Large). Each size has its own base price and per-coat price — tune them in Rates → Kitchen Rates. Each card shows its piece count on the header once collapsed, so you can shut them all and tally the kitchen at a glance.
- **Linear items** — cornices and plinths are priced per metre.
- **Carcass spraying** — toggle on to add a percentage uplift for spraying the cabinet interiors/carcasses.
- **Colour & Product** — pick the paint for the quote and materials list.

Two cards sit above the item counts and apply across everything below them:

![Faces and Strip original coating cards](images/06b-kitchen-faces.png)

- **Outside faces only** — for jobs where only the fronts are being sprayed. Turn it on and doors, drawer fronts, end panels and fillers are all priced at **half** — the per-piece prices in Rates are whole-piece, both-faces figures, so half is one face. Carcass spraying, cornices/plinths and stripping deliberately stay at full price (the carcasses are the same surface either way; trim has one face to begin with), and the client's quote line reads "outside faces only" so the scope limit is on their copy too. Off by default, so nothing you've already quoted changes.
- **Strip original coating** — for spraying over melamine. Adds stripping time to every piece counted, at your day rate, worked out from the counts already entered — the line beneath the toggle shows the sum it priced so you can check it before it lands in the total. Off by default and the minutes-per-size are editable under Rates → Kitchen Rates.

---

## 5. Fitted units

**+ → Fitted Unit** on Measure — for bespoke built-ins: a bookcase or media unit with open shelving above and cabinet doors below. You can add several to one job, each auto-named "Fitted Unit N" (rename it — "Left alcove", "Media wall unit" — so multiple units read apart on the quote, materials and client view).

![Fitted Unit form](images/19-fitted-unit.png)

Unlike the kitchen calculator's flat £ pricing, a fitted unit is priced in **minutes**, like rooms and doors, so it stacks properly into the day-rate maths:

- **Bays, Height per bay, Depth** — one shared height and depth for the whole unit (fitted units are near-always a consistent height); a width input appears per bay, so uneven layouts (a wide TV recess between narrower shelf bays) are no problem.
- **Shelves** — total across all bays, priced as a fixed spray time each (top, underside and front edge in one unit).
- **Cabinet doors** — priced at the interior door rate, **one face** by default (a built-in is normally painted from the front only). **Door size** scales this for cupboard-size (½) or wardrobe-size (1½×) doors, and **Both sides** prices the whole leaf — doubling that unit's door labour and litres — for units sprayed inside and out. Shelves and bay carcasses are unaffected by either.
- **Prep Level** — Bare/Primed (full prime + 2 coats) or Existing painted (light key-sand + topcoat, no primer bought).
- **Sprayed finish** — off by default; adds the Rates spraying uplift to the litres.
- **Complexity/Masking** — None / +10% / +20%, for recessed lighting, tight bays or electrics to mask off. Stacks on labour time before markup, same shape as the Commercial toggle.
- **Colour & Product** — defaults to your Settings woodwork topcoat.

The **Breakdown** card shows the priced result before markup, same as a room's Preview.

---

## 6. Custom line items

**+ → Custom line** on Measure — for one-off items that don't fit any pricing model: "Install panelling — £450", or "Extra sheet of ply — £40 × 2".

![Custom line form](images/20-custom-line.png)

Type a **Description**, a **Unit price** (ex VAT) and an optional **Quantity** (default 1). The **Apply markup** toggle decides how it behaves on the quote: on (the default) joins the commercial/markup calculation like any other line; off, the price goes onto the quote *exactly* as entered — for ad-hoc prices that already have your margin baked in. Custom lines sit in their own section on Measure with a MANUAL tag so they never read as a calculation, are fully editable and swipe-deletable, and flow through to the Summary breakdown, the client-facing Quote view, the Xero quote and the final invoice. No sundries % is added to them either way.

---

## 7. Colours

**You never have to decide a colour to finish a measure.** Every painted surface starts out named after where it is — "Lounge Feature Wall", "Bedroom 1 Main Walls" — so a colour you haven't discussed yet still reads as something you recognise weeks later, instead of as "Colour 3". When the client makes their mind up, you type the real name over the top. Same box, same place, whenever it happens.

Each surface's colour is one free-text field, on the room form under **Paint & Colour** and again on this screen. Type into it and the built-in library of nearly 3,400 colours (Farrow & Ball, Little Greene, Dulux, Dulux Heritage, Paint & Paper Library, RAL Classic, Lick, COAT and Valspar) autocompletes as you go, filling in the brand and code the merchant needs. The search reads the **brand** as well as the name, so typing "lick", "coat" or "valspar" shows you what they do; for the brands whose colours are described rather than numbered it reads the description too, so "charcoal" brings up COAT's The Coal Drop and "anthracite" brings up RAL 7016. Eight matches show at a time, best first. Under each name you get the brand, plus its **No.** where the brand issues one (Farrow & Ball No. 28) or the shade in words where it doesn't (COAT · Charcoal Grey). **Valspar carries the name only** — B&Q tints to the colour's name at the counter, and Valspar's own chart codes come in four formats that don't agree with each other, so a code on the quote would be something nobody can order from. A colour that isn't in the library is fine as free text, and can be saved to the library for next time — including the same name under a second brand. Typing just a **brand** ("lick", "coat") is a way to browse what it does, so the field won't take a bare brand name as a colour — tap one of its colours from the list instead, or type a bit more.

Under the field are **quick-pick chips**: every other colour already on this job, one tap each. That's how a colour used in two places gets shared, so the job buys one tin between them rather than two. Typing the same name twice does the same thing — the second one joins the first rather than making a duplicate.

Menu (☰) → **Colours** is the job-wide view of all of it:

![Colours screen](images/11-colours.png)

**Colours by area** lists every painted surface in the job, room by room, each with the same editable field and marked **Named** or **To decide** — so you can see at a glance what's still open and settle any of it from one screen. It's somewhere to look, not a step you have to complete.

Below that, **What to buy** is the ordering view, unchanged: each colour, the rooms and surfaces it covers, and **how much paint to order** — the same calculation Summary uses, so the two can never disagree. Look here, not at Summary, when you're actually buying paint.

> **Naming a shared colour only changes the one you're on.** If six surfaces are all on the same undecided colour and you name one of them, that surface gets a colour of its own and the other five stay as they were — the field says so underneath while it's shared. To put them all on it, tap its quick-pick chip on each, or just type the name again.

---

## 8. Price Lookup & Shopping List

Two small tools off the menu, independent of any one job.

**🔍 Price Lookup** searches every sales item in your Xero account by name or code and shows what it actually costs at the till — your **buy** price from Xero, inc VAT, with the ex-VAT figure underneath, which is the number printed on the supplier's price list. It is not your sell price: that has your markup on it, and belongs on quotes, not at the counter. An item with no buy price in Xero says **no buy price** rather than showing £0.00. It's a read-only till check, not tied to any quote:

![Price Lookup screen](images/17-pricelookup.png)

Tap the **+** on a result to add it straight to your Shopping List.

**🛒 Shopping List** is a persistent, global pick-up list — not scoped to any one job, so a shop run can buy for whatever's on:

![Shopping List screen](images/18-shoplist.png)

Items arrive from Price Lookup, or type one straight in ("masking tape") for anything that isn't a Xero item. They can also come off a job: tap **🛒 Add to list** on any materials row on **On Site**, or on a materials row on **Summary** — see [Putting materials on the shopping list](#putting-materials-on-the-shopping-list). Tick items off as you buy them and **Clear ticked** to reset for next time; items added from a job's materials carry that job's name as a tag, so the list says why something's on it.

---

## 9. The quote (Summary)

Open **📋 Summary** and the job becomes a priced quote:

![Summary screen](images/07-summary.png)

The hero card shows the **total quote**, days on site, and the markup applied. Below it:

- **Labour** (before markup) and **On Site days** at a glance.
- **Imported from Xero (pre-app quote)** — a toggle for jobs originally agreed directly in Xero before this app existed. Turn it on to honour that agreed labour figure as-is instead of the app's own room calculation; materials still come from Measure as normal. It only applies to a handful of jobs, so it isn't shown on every one: it appears automatically on any job already using it and on any job brought in by **Import an accepted quote from Xero**. On an ordinary job you'll see a single line, **"Labour agreed in a pre-app Xero quote?"**, in its place — tap that and the toggle appears. Leave it off for anything measured and priced in the app.
- **Commercial job** — a toggle that adds a percentage uplift (default 10%) before markup, for commercial rather than domestic work.
- **Standalone job** — for a job booked on its own, where 1.6 calculated days still blocks out 2 diary days: this toggle charges labour at whole diary days × your day rate (rounding up to a full or half day, per the setting in Rates). It never discounts — if the calculated labour already beats the rounded figure, nothing changes. Both figures stay visible on the quote maths, and the top-up flows through markup, deposit, Xero and the final invoice like any other labour. A job can be commercial, standalone, both or neither.
- **Markup / Discount** — this quote can override your default markup; enter a negative number for a discount.

Scroll further for the full breakdown — every room, exterior item, kitchen, fitted unit and custom line priced, labour subtotal, sundries, markup — followed by the **Materials** list: each paint totalled in litres and converted into tins to buy.

Materials list **one line per product and tin size**, the way On Site has always shown them, with the surfaces that line's tins are for underneath it: *"Lounge Main Walls · 2 · Bedroom 1 Main Walls · 1"*. The same paint in two rooms is one line of three tins, not two lines you can't tell apart. Once every colour on a line has a real name, the name replaces the generic colour band inside the product itself — *"Tikkurila Optiva 5 – Colours 3ltr"* becomes *"Tikkurila Optiva 5 – Farrow & Ball No. 28 Dead Salmon 3ltr"* — on Summary, on the client's quote and in Xero, exactly as it already reads on an invoice. Until then the line keeps the generic wording and the surfaces underneath say what it's for. Editing a quantity on one of these rows takes the change off the **largest colour first**, and never leaves a colour holding no paint at all — a wall missing off the shopping list costs you a second trip, a spare tin doesn't. When the colour you wanted cut isn't the one it chose, **tap the surfaces line** under the product (it reads *▸ … · set each*) to open a **box per colour** and set them yourself; the row also opens itself straight after you type a total, so you can always see which colours it landed on. Type a total lower than the number of colours on the row and it holds at one each and says so, rather than deciding for you which wall goes unpainted — put **0** in a colour's own box to go below that. Deleting a row deletes that product, every colour of it.

![Summary breakdown](images/07b-summary-breakdown.png)

### Materials & Undo

Materials are quoted as an estimate and — once the job runs — invoiced as used, so the list on Summary and On Site is the same list throughout a job's life. **Add Material** searches your Xero items (or free-text) for anything the calculation missed — an exterior plastic door, a kitchen, anything you've deleted the calculated line for and are entering by hand. Manually-added lines carry a **Chargeable** switch which is **on by default**, so what you add is on the quote, in the Materials subtotal and in the deposit like any other material. Turn it **off** to keep a line as tracking-only: it stays on your shopping list but is left out of the total, and the card then says how much is sitting there — *"Tracking only — not on the quote"* under the subtotal — so nothing is ever quietly missing off a price. A row you've already added shows **Chargeable** or **Tracking only** as a tag; tap the tag to switch it. **Recalculate** re-pulls the calculated lines from the rooms without throwing away your own additions: anything you added yourself is kept and tagged **"added by you"**, a quantity you've typed over is kept and tagged **"edited"** (with a **reset to N** link if you want the calculation's figure back), and if recalculating would drop something you edited by hand, you're asked first, by name.

Because the materials are an estimate, any quote with chargeable materials carries a note, asterisked against the balance: *"Material costs are estimated and may vary based on final colour and product selection. Any adjustments will be reflected in your final invoice. Significant changes in cost will always be discussed and agreed with you in advance."* It prints under the payment card on the client's quote and its PDF, under the balance on Summary, and at the end of the payment terms on the Xero quote. A labour-only quote doesn't get it.

**Primer and topcoat in the same paint.** If the woodwork primer in Settings (or a room's own primer pick) is the same product as the topcoat — a self-priming paint used for both — the app buys it once: one extra topcoat coat instead of a separate primer allocation of the same tins. The same goes for exterior woodwork and the windows and doors. The room form's self-priming rows say *primer is the same paint* when that's what decided it.

Almost anything you do to the materials list — recalculating, deleting a line, changing a quantity, adding a line — can be undone. Look for an **UNDO** button on the confirmation message right after the change, **↩ Undo** at the top of the Materials list, or **↩ Undo** in the ☰ menu if you missed the moment. It remembers the last 10 changes on the current job; switching job or closing the app starts it fresh.

### Once a quote is accepted, its figures freeze

Everything in this app is calculated from your current Rates and Settings — right up until a client says yes. The moment a quote is **Accepted**, the app takes one snapshot of every figure — every room's price, the materials, the totals — and from then on the client-facing views read that frozen record, not a fresh recalculation. So nudging a coverage rate or a day rate next month can't silently move the price on a job someone already agreed to.

Because of that, an accepted job's Summary shows **one set of money**: the agreed one. The total at the top, then the **Accepted quote — Revision N** card underneath it with every line the client agreed, the materials, the deposit and balance **as agreed**, and the two things you can do to it — **Amend** and **History**.

![An accepted job's Summary — one set of figures, the agreed ones](images/07c-accepted-working-figures.png)

Below that card is the working side of the job: the **Room Breakdown** (where a room's days and per-surface detail live), the **Materials** shopping list, and the colours. Those are today's maths on the same job — you buy paint at today's prices — and a line above them says so.

**What's no longer there, and why.** Summary used to print today's price of the job beside the agreed one — *"Same job priced today: £X"* — with a rule across the screen marking where the agreed figures stopped, and the pricing controls greyed out with a strip explaining why. All of that has gone. Showing the live figure was how you *detected* a quote silently re-pricing itself, back before the snapshot existed to stop it happening; now that the agreed figures physically can't move, a second total on the same screen was just something to mistake for the first. Today's price is still worth seeing at the one moment it matters — when you're about to re-price the job — and that's where it now lives.

### Amending an accepted quote

If the job genuinely needs to change after acceptance, **Amend → revision N+1** on the accepted-quote card opens a sheet showing what the change would mean *before* you commit to it:

![The amend sheet — what the job costs now, and where the difference came from](images/07d-quote-drift.png)

At the top: the revision you agreed, and the same job priced now, with the difference between them. Under it, **Where the £X difference is** — labour agreed → today, materials agreed → today, the £5 rounding on its own line, and then **which lines moved**, room by room, biggest mover first.

Underneath that it says whether the Rates page had anything to do with it. Only the settings that actually price a job are checked (the rates, the coverage table, the kitchen rates, the product choices), so exporting a backup or changing a payment plan never reads as a rate change. It also checks **the app's own version**: the rates are only half of what prices a job, and an update that changes how a room is costed will move the figure with nothing on the job touched. Where the build has changed since you accepted, it names both versions — so an unexplained few pounds has an explanation instead of looking like the app inventing money.

The **Commercial job**, **Standalone job** and **Markup / Discount** controls are in this sheet too, because this is the one place they still do anything on an accepted job: they price the revision you're about to write, and the two figures at the top move as you change them. (On a job still being quoted they're where they always were, on Summary.)

Last, a box to say **what changed**, which goes on the revision and is what History shows you later. Nothing is written until you tap **Amend**. The old revision stays on record; nothing is overwritten. Once there's more than one, **History (N revisions)** lists every revision with its date, its total and what each amendment added or took off.

If the amend would absorb extras you'd already flagged as variations, the sheet says so before you commit — see [extra work in a room you already measured](#extra-work-in-a-room-you-already-measured).

### Client-facing quote view

**Quote ⤴** (top bar, next to Export ↓) opens a branded, read-only one-page quote at customer-facing prices — room by room, colour schedule, payment terms and total, with your logo and business colours. It opens inside the app; tap **Save PDF** and it builds a real PDF file (as many pages as it needs) and hands it to your phone's share sheet — save it, email it straight to the client, or send it to a printer. It works with no signal, so you can produce a quote PDF standing in a house with no bars. It's regenerated live every time you open it, so it never shows stale figures, and doesn't touch Xero at all.

Mostly it's one line per room. The exception is [wallpaper stripping](#walk-the-room), which gets a line of its own — *"Wallpaper Stripping — Back Bedroom"* with the paper type underneath — so the client can see what the labour is for. It's carved out of that room's line rather than added to it, so the total doesn't move, and the same split reaches the Xero quote and the final invoice. Everything else the room needs doing to it (mist coat, prep level, making good) stays inside the room's own price as it always has.

### Recording a deposit

Once the job is **Accepted**, the status card carries the deposit line — unless you've turned off **Deposit required** (its own toggle, default on, for jobs that don't want one: a client who always pays, work squeezed in around a bigger job).

![Deposit recording, and the accepted-quote revision card](images/21-deposit-record.png)

1. **Record deposit ›** — the amount is pre-filled from the quote's deposit figure; correct it to what was really paid, set the date the money arrived (matching your bank feed), add a note if you like, **Save deposit**.
2. **Sync to Xero** — creates it in Xero as Receive Money → Received as Prepayment, against the bank account chosen in Settings. **Don't also enter it in Xero yourself** — doing both double-counts the money against your bank feed.
3. **Apply it to the invoice in Xero** when you raise the invoice, exactly as before — the app can't do this step, since Xero won't let a payment be applied to a still-draft invoice.

The line then shows where things stand — *not in Xero yet*, *in Xero · unallocated*, or *in Xero · allocated ✓* — read back from Xero, which stays the boss: void or delete the deposit there and the app notices and stops saying it's synced. A failed sync loses nothing — the deposit stays recorded, the line turns red with the reason, and **Try again** is safe. Fixing a mistake (a typo, a refund) is done in Xero, not here — the app never edits or deletes a deposit that's already landed.

### The quote description

Under the breakdown sits the **Quote description** — the wording that rides the
**first line item** on the Xero quote, and describes that line. It's written for you from the job: the app picks the wording template
that fits the work (Painting, Wallpapering, Kitchen Cabinet Spraying and so on —
all editable in **Settings → Quote & Invoice Text**), fills in your products and
coats, and puts it in future tense for a quote and past tense for the final
invoice.

A job with **both rooms and exterior items** gets the **Interior & Exterior**
template, which has an INSIDE half and an OUTSIDE half — so a client reads the
promise about their furniture and flooring *and* the one about their windows,
doors and landscaping, instead of only the indoor one.

**It says what you actually measured.** Quote only the walls and it won't promise
ceilings and woodwork. Measure a feature wall, panelling, radiators, window sills
or a mist coat on new plaster and each one gets named — with its own product if
you gave it one:

> *Ceilings finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5, the
> feature wall in Farrow & Ball Estate Emulsion, and all woodwork including
> skirtings, window sills and radiators in Tikkurila Helmi 30, each applied in 2
> coats. Existing wallpaper will be stripped from the walls prior to decoration.
> Newly plastered walls will be mist coated prior to finishing.*

The two prep sentences at the end appear only where you ticked them, and in the
order the work happens — [strip](#walk-the-room) first, then the mist coat.

A papered feature wall isn't listed as painted — it moves to the wallpapering
line instead, which names what's being papered.

**A job with no painting at all still gets described.** Strip a room out and
paint nothing, and the description is the stripping — not an empty paragraph
under a heading about painting.

**The number of lengths fills itself in too.** The wallpapering paragraph's
`[X]` is now `{lengths}` — the strips being hung across the job. See
[Wallpaper](#wallpaper--rolls-to-order). With no paper measured it goes back to
`[X]` for you to fill in, exactly as before.

> **If you've edited your templates**, two placeholders are new and your copy
> won't have them — `settings.textTemplates` takes a copy of the whole set the
> first time you edit any of it, and never re-reads the built-in ones.
>
> - **`{stripped}`** — the wallpaper-stripping sentence. It rides `{surfaces}`
>   in every template that has one, so those pick it up with no work from you.
>   The **Wallpapering** template is the exception (no `{surfaces}`, because
>   nothing is painted), so it carries `{stripped}` on its own line under
>   PROTECTION & PREPARATION. **Don't put `{stripped}` in a template that
>   already has `{surfaces}`** — the quote would say it twice.
> - **`{lengths}`** — the number of lengths, in **Wallpapering** and
>   **Painting & Papering**: replace the `[X]` in *"[X] lengths of [paper
>   name/supplier]"* with `{lengths}`.
>
> Add whichever you want by hand, or use **Reset all** to take the new
> defaults (which loses your other edits). Leave them out and nothing breaks —
> you just keep typing those bits yourself, as you do now.

**It never states a paint the job doesn't use.** It's a whole-job sentence, so
woodwork measured in one room puts woodwork in the wording for the job — and
where the rooms use *different* paints on the same surface, every one of them is
named rather than whichever room came first:

> *Ceilings finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5 and
> Dulux Diamond Matt, and all woodwork including skirtings in Tikkurila Helmi 30,
> each applied in 2 coats.*

Only rooms that actually paint a surface get a say — an old product left on a
room with no wall coats doesn't count as a second paint — and a surface no room
paints at all keeps your Settings default. Coats work differently, because
there's nothing to list: where the surfaces disagree, no coat figure is stated
rather than a wrong one. Type the detail into the box yourself whenever you'd
rather spell out which room gets which.

**It describes one line, and every other line says what *it* is having.** Each
Xero line carries its own price, so the block opens *"Painting of Lounge:"* and
describes the Lounge — not a list of every room in the job on a line priced for
one of them. The protection and completion paragraphs are true of every room, so
they appear once and the later lines just point back at them. Here are the Xero
line descriptions the app writes, one after the other:

```
Painting of Lounge:
[protection · the Lounge's scope · completion]

Kitchen - same as above

Bedroom 1 - same as above

Bathroom
Ceilings finished in Tikkurila Anti Reflex 2 and walls in
Tikkurila Optiva 5, each applied in 2 coats.
Preparation and completion as above.

W.C.
Walls in Tikkurila Optiva 5, applied in 2 coats.
Preparation and completion as above.
```

**The first line isn't labelled twice.** The block already opens by naming the
room it sits on, so the room name is no longer put above it as well — that line
used to read *"Lounge"*, then *"Painting of Lounge:"* one line below it. The
label is still added wherever the block *doesn't* name the line: your own edited
wording that never mentions the room, an exterior template with a fixed heading,
or a line the block has moved onto because you dropped the room it was written
for.

**"Same as above" now means exactly that** — same as the first line. A room
matching it collapses, so identical bedrooms stay tidy and the detail appears
only where a room genuinely differs. Your own client quote view gets the short
version under each room name: *"ceiling, walls and woodwork"*, *"walls"*.

The box is editable: type in it and your version sticks from then on (**↺ Reset
to template** goes back). **Editing it also turns the per-room lines off** — once
the wording is yours, the app stops adding sentences underneath it that you
didn't write and can't edit; every other line goes back to "same as above".
Sending stamps the exact wording onto the quote, so a document you've already
sent never changes underneath you. Sending doesn't count as editing, though —
**Update quote in Xero** keeps each room's own lines exactly as the first send
wrote them.

**Exterior items get the same treatment**, from what you measured on them —
render (textured or not), fascias and soffits, windows, sash windows, doors,
garage doors, a porch — with repairs and restoration noted where you've logged
any. Each exterior line compares against the other *exterior* lines, so it only
carries text where it genuinely differs from them.

**Fitted units** describe themselves too — *"Fitted units including 3 bays, 9
shelves and 4 doors painted both sides in Tikkurila Helmi 30, applied in 2
coats. Bare surfaces will be primed first."* — with the product coming from the
unit's own picker (or your Settings woodwork topcoat) and the priming note
following each unit's **Bare / Already painted** setting. The **kitchen** fills
in its coat count; its product and colour aren't tracked in the app, so those
stay as `[product]` and `[colour/finish]` markers for you to type over, along
with the fitted units' `[spray/brush]` and the wallpaper templates'
`[paper name/supplier]`.

On the Xero quote, the kitchen and fitted-unit *lines* still read "same as
above" under the block — only rooms and exterior items get a per-line scope
sentence.

> **If you've edited your templates in Settings**, your saved copies keep whatever
> wording you gave them. To pick this up, put **`{surfaces}`** where the scope
> sentence should go (and **`{papered}`** where a wallpapering line names what's
> being papered) — or use **Reset to defaults** to take the supplied templates
> back.

### Sending to Xero

Expand the **client panel** at the top of Summary:

1. **Client name** — start typing and existing Xero contacts autocomplete; picking one fills phone, email and address into blank fields only (anything you've already typed wins). **Sync to Xero** pushes the app's details the other way.
2. **Street address** autocompletes as you type; picking a suggestion fills street, town and postcode.
3. Add a **Reference** if you use them.
4. Tap **Send to Xero**. The quote is created in Xero, ready to send to the client from there, and the job's status becomes **Quoted**.

If you edit the job afterwards, the button becomes **"Update quote Q-nnn in Xero"** so re-sending updates the *same* quote — with a "Send as a NEW quote instead" option when you genuinely want a second version. Answers given in Xero flow back into the app when you next open it; an answer given in the app always wins.

### When the client answers

- **Mark Accepted** — the job moves to Accepted (synced to Xero), its figures freeze (see above), and scheduling and On Site tracking unlock.
- **Mark Declined** — the job files itself away under Declined.

Quotes that sit unanswered longer than your "chase quotes after" setting (default 14 days) pop up on Home so nothing slips.

---

## 10. Jobs

Menu (☰) → **Jobs**. The app holds any number of jobs; the one you're working on is marked **CURRENT**, and everything on Measure, Kitchen, Summary and On Site belongs to it. Tap another job to switch. Rates and Settings are global — they apply to every job.

![Jobs screen](images/08-jobs.png)

- **The client's name is the top line** of each row, with the job name and its status underneath — job names repeat ("Bedrooms" three times over), people don't. A job with no client saved shows its name on top instead; the client comes from the **Client** details on Summary's Xero panel.
- **Search** (top of the screen) filters every group as you type: client name, job name, calendar title, or a Xero quote/invoice number off a piece of paper. Several words all have to match, but not in the same field — "priya bedrooms" finds it. A count and a **Clear** link sit under the box, and the search resets each time you open the screen.

![Searching the jobs list](images/08b-jobs-search.png)

- Jobs group by status: **Draft → Quoted → Accepted / Declined → Completed → Invoiced**.
- **Recently invoiced** sits just above the Invoiced group: up to three jobs invoiced in the last 60 days, each with what was invoiced, whether it came in on, under or over its quoted days, and the markup banked on materials. Tap one to open its Summary and the full **Job Profitability** card. It's hidden while you're searching.
- **`+`** starts a new job. **✎** renames one. **⧉** duplicates a job as a quick template (notes aren't copied). Each job is fully separate — its own rooms, kitchen, colours and materials.
- **Import an accepted quote from Xero** — took the job on before the app existed? Import the Xero quote and it becomes a job here, with the agreed price as the record (adjustable via the **Agreed figures** card, or the **Imported from Xero** toggle on Summary — see [The quote](#9-the-quote-summary)). If a listed quote actually belongs to a job already in the app, use **"Already a job in the app? Link it ›"** instead of importing a duplicate.

---

## 11. Schedule

Menu (☰) → **Schedule** — or tap **Schedule ›** on an accepted job's Summary, which offers the next free slot automatically.

![Schedule screen](images/09-schedule.png)

- Switch between **List**, **Weeks** and **Month** views. Jobs appear as coloured bars across their booked days; UK bank holidays are marked, and weekends are greyed out unless you've turned on **Work Saturdays** in Rates → Scheduling.
- **Tap a job's bar** → Open job, **Move start date** (then tap the new day), or Unschedule.
- **Tap an empty day** → start a job there, or **block days** for holidays and time off.
- The header tells you your **next free day** at all times.
- **What a job is called on the calendar:** entries read **client — job name — calendar title**, skipping anything the others already say. So a Kitchen job for Lauren Lowe reads "Lauren Lowe — Kitchen" whether or not you typed a calendar title, and an older job still named "Lauren Lowe - Kitchen" doesn't say her name twice. The client comes from the job's **Client** details (Xero panel on Summary) — if a job has no client saved, the entry is just the job name.

### Blocking days off

Holidays, a day at the dentist, a week's decorating on your own house — tap the
day and the sheet opens with the day's own actions first:

![Tapping a day on the calendar](images/09b-schedule-day.png)

- **Block day(s)…** is offered on **every day from today onwards** — including
  Saturdays, Sundays and bank holidays. Your usual week may have those off,
  but a job set to *+ Saturdays* or *Every day* works them, and a block is the
  one thing that override never beats. The picture above is exactly that: a
  Saturday in the middle of a whole-house job.
- It takes a range: the day you tapped → an end date (the same day, for a
  single day off), plus an optional label such as *Holiday*. The day you
  tapped is always blocked. Days merely swept up in between are blocked only
  if you'd have been working them anyway — a weekend in the middle of a
  fortnight off is already off, so it isn't cluttered with a chip, unless a
  job was booked across it.
- Blocked days draw as a dashed grey bar across the calendar, are never
  offered as a start date, and booked jobs stretch **around** them. Your phone
  calendar feed agrees, so a blocked fortnight is a gap there too.
- Tap a blocked day for **Unblock this day**, or **Unblock all N days** to
  clear the whole run in one go.
- **Start a job here** lists the accepted jobs still waiting for a date, four
  at a time — tap **N more waiting…** for the rest. Blocking stays at the top
  of the sheet however many are waiting.

**A one-off day out of the ordinary**, without changing anything globally: tap the day itself → **start a job here** (or move a job there), and the confirm tells you what switches on — a Saturday turns on "Saturdays for this job only", a Sunday or bank holiday turns on "Every day for this job only". From an accepted job's own **Schedule ›** form, the same idea is the **Days worked** picker (Usual / + Saturdays / Every day), which switches itself if you pick such a start date. Automatic slot suggestions still only ever offer your usual working days, and your own blocked days always win.

**See jobs in your phone calendar:** Rates → Scheduling → turn on **Calendar feed**, then tap the link to copy it and subscribe in your calendar app. Booked jobs then appear alongside everything else in your life.

---

## 12. On Site — running the job

Once a job is accepted, the **🛠 On Site** tab is your day-to-day companion:

![On Site screen](images/10-onsite.png)

- **Estimated vs Actual** — the card at the top tracks what the materials are really costing against what you quoted, with the variance.
- **Time on Site** — tap **+ Log today (full day)** at the end of each day (or *Log a different day* to back-fill). This builds the true labour record for the job.
- **Materials** — the quote's materials list becomes a shopping list. Tick items off as you buy them, and correct quantities/prices to what you actually paid — see [Materials & Undo](#materials--undo) for how edits and Recalculate interact, and Undo if something goes wrong. Any row here can also go on your **Shopping List**, or the whole list can go to your merchant with **✉ Send to supplier** — see below.
- **Add material the estimate missed** — extra sundries or a forgotten tin: search the product, set the price, done.
- **Variations** — the client asks for "just one more room" mid-job? Add the room (or exterior item, fitted unit) on Measure and flick its **Variation** toggle, in the **Room Details** card at the top of the form, with the room's name (it only appears once the quote has been accepted, and on a new room added after that it starts **on** — turn it off if the room is a correction to the original quote rather than extra work):

  ![The Variation toggle in Room Details](images/04h-variation.png)

  It's priced with the same engine but kept separate from the accepted quote, and appears in its own Variations card here. Each variation carries a status — tap **✓ Approved by client** to record their yes (with an optional note; the date is stamped automatically), or mark one Declined to drop it from the totals and the final invoice while keeping the record. Anything still Pending gets called out before the final invoice will let it through. For extra work added *inside* a room you already measured, see [below](#extra-work-in-a-room-you-already-measured).
- **Spec sheet** — what's being done in every area, what colour each thing is going, and how far through it is. Tick Prep and Painted off as you go. See below.
- **Snags** — the punch list for the job, above everything else once there's something on it. See below.
- **Invoice ›** (top right) shows the materials list formatted for invoicing, with a **Copy** button.

#### Putting materials on the shopping list

This is the screen you have open standing in the room, so it's the one that answers *"do I still need to buy this?"* — and every materials row carries a **🛒 Add to list** chip, the quoted tins as well as the sundries you added yourself. Tap it and the product goes on your [Shopping List](#8-price-lookup--shopping-list) with its price and this job's name, and the chip changes to **✓ On list**:

![Adding On Site materials to the shopping list](images/10g-onsite-shoplist.png)

It's per row and never automatic — plenty of what's on a job is already in the van. Summary's materials list has the same chip on the quoted lines, and either route lands on the same list: one line per product, no duplicates however many times you tap, and both job names on it if two jobs need the same thing. Paint sold by the litre goes on **without a price**, because the figure on the row is a price per litre, not what a tin costs at the till. Ticked something off in the shop and then ran out? Tap the chip again and it goes back on the list.

### Sending a materials order to your supplier

When you'd rather the merchant delivered (or had it ready to collect) than go round the shop yourself, tap **✉ Send to supplier** at the top of the On Site materials list. It builds an order from the job's calculated materials and opens it as a ready-written email in your phone's mail app. This is separate from the [Shopping List](#8-price-lookup--shopping-list), which is for when you're standing in the shop — and there are **no prices anywhere on it**.

![Building a supplier order](images/10m-send-to-supplier.png)

- **Jobs** — the job you came from is ticked. Tick any other accepted job to put its materials on the same order: the same product and size on two jobs becomes one line with the quantities added together, exactly as On Site groups them.
- **The lines** — every line is ticked to start with. Paint reads with its **real colour in place of the colour band** (*Optiva 5 - Dead Salmon 3ltr*, not *Optiva 5 - Colours 3ltr*), the same as your invoices. A product covering two colours gets the split in brackets in the email, so the merchant knows how many to tint of each. Use **− / +** to change a quantity for this order only — the job's own materials don't change.
- **⚠ no colour set** — a line whose colour is still just a room name (nobody has picked the colour yet) is flagged, and a banner above the Send button counts them. It won't stop you sending; the email just shows the colour band for that line.
- **Extra item** — anything the calculator doesn't produce (caulk, tape, filler): type it, set a quantity, **Add**. Extras belong to this order only.
- **Already ordered** — a line you've ordered before starts **unticked** and says so: *Ordered · Brewers · 24 Sept*. Tick it again if you really do want more. If only one of the jobs on the order has had it, it starts ticked at the other job's quantity.
- **Needs more since you ordered** — add a room after ordering and the job may now need more than you sent. That line says so — *Ordered 3 · now needs 5 · Brewers · 24 Sept* — and starts **ticked at just the difference** (2), so the next order tops it up. Ordering more than the calculation (spares) never gets flagged.

Then choose the **supplier** and how it's arriving:

![Supplier and delivery](images/10n-supplier-delivery.png)

- **Collect** — no delivery address; the email names the supplier's branch and its address from Settings.
- **To site** — fills in the job's address. With more than one job on the order, pick which job's address it goes to.
- **To home** — fills in your home delivery address from Settings (or your business address if that's blank).

It starts on **To site** for one job and **To home** for several. The address box is editable for this order only — nothing you type there changes the job or Settings. **Delivery notes** (where to leave it, a gate code) and **Required by** are optional; anything left empty is simply left off the email.

Tap **✉ Send to [supplier]** and your mail app opens with the email ready — subject *Order: [business name] (Acc [account number])*, the lines, your account number, the job names as the reference, the delivery details, and your name, business name and phone to sign it off. Check it and send it from there. No mail app on this device? **Copy order text** copies the email so you can paste it anywhere.

The app can't see whether you actually pressed Send in your mail app, so when you come back it asks:

![Did you send it?](images/10o-supplier-confirm.png)

**Yes, mark as ordered** logs the order and marks its lines as ordered on each job it covered. **No** logs nothing. After a Yes, if you left any lines unticked that still haven't been ordered, you're offered **🛒 Add unordered to shopping list** — one tap puts them on your Shopping List with each job's name on them, or close the card to skip it:

![Logged, with the shopping list offer](images/10p-supplier-logged.png)

Every order a job was part of is listed under **Orders** on its On Site screen — supplier, date, how it's arriving and how many items. Tap one to read the email exactly as it went. Orders can't be edited or re-sent from there. Ordered rows on On Site also carry the *Ordered · supplier · date* label (or *Ordered 3 · now needs 5* if the job has grown since).

Tapped **Yes, mark as ordered** by mistake? Open the order under **Orders** and tap **Delete this order**. Its lines go back to not ordered — on every job the order covered — so the next order includes them again. It only removes the app's record; the email itself is still in your mail app's Sent folder.

Works without signal: the order is saved on the phone and syncs when you're back online (the order shows *waiting to sync* until it has). Another job's materials can only be added offline if that job has been opened on this phone before.

### The spec sheet — what's going where, and how far through

On site the questions are small and constant: *which walls am I painting in
here*, *what colour is the radiator going*, *what have I still not touched*.
All of it was already in the app — just spread across the room screen, the
Colours tab and the materials list, which are screens for putting numbers in,
not for looking things up with a brush in your hand.

The **Spec sheet** puts the answers on one screen, and lets you tick them off.
It sits on On Site next to Snags, headed with how much is still outstanding:

![The spec sheet entry on On Site](images/10h-spec-sheet-entry.png)

Tap **Open** and you get the whole job, area by area:

![The spec sheet, by room](images/10h-spec-sheet.png)

Every row is one surface in one area, in the order you'd actually work a room
— **ceiling, panelling, woodwork** (with what it includes, and **radiators**
right under it), **walls**, and the **feature wall last**. The colour is the
biggest thing on the row, because it's the thing you came to look up. Under it
sits the product and the prep, and under that the two boxes.

**It's built from the job, not typed twice.** The rows come from your rooms,
exterior items, kitchen, fitted units and custom lines every time you open it,
so they can't drift from what you've actually measured. Rename a colour on the
Colours tab and the sheet says the new name straight away. A surface with no
coats on it simply isn't there. Nothing on this screen can be edited except the
ticks — colours, coats and prep are changed where they live, so there's only
ever one place to change them.

**No prices anywhere on it** — not on the screen, not in the PDF, not on the
shared link. It's a working document, not a quote.

#### Ticking it off

Two boxes per row: **Prep**, then **Painted**. They're independent — tick
Painted without Prep if the prep was done last week or there wasn't any, or
tick Prep on its own. Each one keeps the date you ticked it.

- **Prep** strikes through the prep line. The row is still open — half done is
  not done.
- **Painted** clears the row: struck through, dimmed, and dropped to the bottom
  of its area. It stays on the list, because at the end of the job the list
  *is* the record of what got done. Untick anything and it goes straight back
  where it was.

Cleared rows sink to the bottom of their area and cleared areas sink to the
bottom of the sheet, exactly like snags — so three weeks in, what's left is at
the top. One thing worth knowing: that beats the working order, so a feature
wall you haven't touched sits *above* a ceiling you've finished. It's last in
the room's sequence, not last on the screen.

**Papered surfaces and custom lines get one box, Done** — there's no separate
prep step to a roll of wallpaper or to a line you typed in yourself.

#### By room, by stage, and finding things

**By stage** flattens the whole house: every ceiling in the job together, then
all the panelling, then the woodwork, and so on, with the room name on every
row. Use it to do one thing everywhere in one pass. Kitchen, fitted units,
exterior items and custom lines stay as their own blocks at the end — there's
nothing to batch between a kitchen and a garage door.

![The spec sheet, by stage](images/10i-spec-sheet-stage.png)

**Every heading folds**, same as the snag list: tap it and its rows fold away,
leaving the name and the count. An area you've finished with is folded to start
with, so a big house opens as the rooms that still have work in them — unless
*everything* is done, in which case it all opens, because you only opened it to
read the record. **Fold all** does the lot and turns into **Open all**.

**The find box** matches the surface, the colour, the room and the product, and
works in both views:

![Finding every radiator row](images/10j-spec-sheet-find.png)

Type *radiator* and you get every room's radiator row with its colour. Type a
colour name and you get everywhere that colour is used. Clear it and the whole
sheet comes back.

#### The prep lines

Each row carries a prep line. Where the job records prep for that surface, that
wins — **Mist coat** with its product on new plaster, **Primer** with its
product where the room actually buys one, the fitted unit's prep level, the
kitchen's **Strip original coating**. Everything else gets the built-in line
for that surface ("*Fill and sand. Tape switches, sockets and edges.*"). The
Prep box belongs to whichever line is showing.

#### Variations on the sheet

Extras show up with everything else, tagged. An approved one reads **Variation
✓**; one still waiting reads **Variation, awaiting approval** — shown on
purpose, and tagged so it can't be read as a go-ahead. You *can* tick it; the
tag is the warning. A declined variation isn't on the sheet at all.

**Extra work added inside a room you already measured** is different, because
the app knows the room has grown but not *which* surface grew — so there's
nothing to tag, and putting "Variation" on all five of that room's rows would
say something untrue about four of them. The room's heading says it instead:
*Landing — includes extra work, awaiting approval*, or *✓* once it's approved,
or **includes extra work the client declined**. That last one is the one to
read: the work is still typed into the room, so it's still on the sheet with a
box beside it, and this is the only thing on the screen telling you not to
paint it. (See [Extra work in a room you already
measured](#extra-work-in-a-room-you-already-measured).) The heading carries it
in **By room**, and on the kitchen, unit and exterior blocks in By stage — a
By stage section covering ceilings across the whole house belongs to no one
room, so it doesn't claim to.

#### Sharing it: PDF

**Share PDF** at the foot of the sheet builds a one-file copy and hands it to
your phone's share sheet (on a computer it downloads). It's named for the job
and the day you exported it — *NH-Spec-12-Ermine-Street-2026-09-19.pdf* — and
stamped **Correct as of** the date and time, because a spec sheet moves.

It prints **the view you're looking at, in the order you're looking at it**, so
you can check the file against the screen: your business band at the top, the
job and the address, then how many are outstanding and how many done, then each
area with two boxes per row — empty for what's left, filled and dated for
what's done. It builds from what's on your phone, so a row you ticked in a
cellar with no bars is already ticked in the file. The client's name, phone and
email are not on it.

#### Sharing it: a live link anyone can tick

**Share link** creates a private web page for this job and hands you the URL.
Whoever you send it to opens it on their phone — no login, no app — and sees
the same sheet, with the same By room / By stage toggle, the same find box and
the same two boxes per row. **They can tick things off**, and their ticks show
up on your phone within about half a minute. Yours show up on their page the
same way.

![The shared spec sheet, opened on someone else's phone](images/10l-spec-sheet-link.png)

- **It's a different link from the client approval one.** That page has Approve
  and Decline buttons on it; this one doesn't, and handing a helper the wrong
  link would hand them those buttons. Either can be stopped without touching
  the other.
- **The rows are as of your phone's last sync.** The page says **Updated** and
  when. Edit a room, change a colour, and the page catches up within a couple
  of seconds if you've got signal — and when you haven't, it keeps showing the
  last version and its timestamp says how old that is.
- **The ticks are live either way.** They're not part of what gets published,
  so a tick never waits for a sync and never triggers one.
- **You can see which ticks came from the link.** Any step ticked from the page
  is marked *via link* on your phone, and you can untick anything.
- **Anyone with the link can tick.** That's the point of it, and it's worth
  knowing: forward it on and whoever holds it can tick rows. There are no
  prices and no client contact details on it, so what's exposed is progress.
  **Stop sharing** kills the link for everyone — and **leaves every tick where
  it is**, because the work happened whether or not anybody's still allowed to
  look at the page.

#### Radiator colours

Radiators normally go out in the woodwork colour, and that's what the sheet
shows. When a room wants something else, the room screen has a **Radiators**
row under the colours on the **Paint & Colour** card — **Same as woodwork** is
on by default, and switching it off gives you the ordinary colour field:

![Setting a radiator colour on a room](images/10k-radiator-colour.png)

The row appears **once the room has radiators measured** — put the figure in
**Extras › Radiators** and it's there; a room with no radiators doesn't carry a
radiator colour to decide.

The field works exactly like every other colour field: type and your library
offers matches with brand and number, the colours already on this job are one
tap each underneath, and leaving it blank means *not decided yet* — which is a
different thing from *same as the woodwork*, so the chip and the blank field
don't mean the same. Set one and it shows on the spec sheet, on the Colours tab
as an area in its own right, and on the client's colour schedule
(*Woodwork/Radiators: Wimborne White* where they match, on their own line where
they don't). **It never changes what you buy** — radiators are priced as labour
and use no paint of their own, so a colour that's only on a radiator never
turns up as a tin on the list.

#### The spec sheet and signal

Same as everything else on On Site: tick things off in a house with no bars and
every tick queues on the phone and goes up when you're back in signal. The
sheet opens offline, the PDF generates offline with your queued ticks in it,
and a tick that hasn't synced yet is never overwritten by what the server still
thinks.

### Snags — the punch list

The last few days of a job are a list of small things: a scuff by the switch, a handle to refit, a staircase that wants one more coat. That list goes here, and On Site puts it above everything else while anything on it is still open.

![The Snags section on On Site](images/10b-snags.png)

- **The section only shows up when there's something to show.** No snags yet, and there's just a quiet **+ Start a snag list** at the bottom of the screen. Tick the last one off and it drops back down there too, collapsed to **All n cleared ✓** — tap it to reopen the record.
- **Grouped by room**, with that room's colours next to its name, read straight from the Colours tab — each surface named where they differ (*Walls Dead Salmon · Ceiling All White*), or just the colour where the whole room is one. So you don't have to leave the screen to find out what to open. Rooms the quote never priced — the airing cupboard, the garage step — can have snags too, and you can give those a colour by hand (see below).
- **Ticking one off doesn't remove it — it drops to the bottom.** The row goes struck through with the date you cleared it and stays on the list, which is the point: at the end of the job the list *is* the evidence of what got done. But it moves below everything still open in that room, so three weeks in, with thirty things ticked off, the handful you've still got to do are the ones at the top rather than scattered through them. A room where everything's cleared drops below the rooms that still have work in them, and the same rule applies in the **By phase** view. Untick anything you tick by mistake and it goes straight back up where it was.
- **Phase** on each row (the little dropdown) is the pass it belongs to — Prep, Stain block, Woodwork, Walls, Ceiling, Details, Final access. Set it and the room re-sorts itself into working order, with anything that blocks the space once it's done (floor cleans, stair recoats) last. Snags with no phase yet sit at the top of their room so they're not forgotten.
- **By room / By phase.** The toggle flattens the whole house into phase order instead — every stain-block job in the building together, so you get the stain block out once. Room order is what it opens on.
- **Every group folds.** Tap a room heading (or a phase heading in the other view) and its snags fold away, leaving the heading, its colours and its count — *2 open*, or *all done ✓*. Tap it again to open it back up. A room you've finished with is folded to start with, so a forty-snag house opens as the rooms that still have work in them. Once you've tapped a heading yourself your choice sticks for the rest of the visit — the app won't fold a room back up under you when you tick its last snag off. **Fold all** (beside the toggle) folds the lot in one go and turns into **Open all**. Folding rooms doesn't touch the **By phase** view, or the other way round, and none of it is remembered between visits.
- **PDF** (next to **+ Add snag**) saves the list as it stands right now — see below.

![Three rooms folded down to their headings, the room in hand left open](images/10b2-snags-folded.png)

#### The snag list as a PDF

**PDF** at the top of the Snags section builds a one-file copy of the list and
hands it to your phone's share sheet, so it can go straight to the client, to
whoever's working with you, or into an email as a record. On a computer it
downloads instead. It's named for the job and the day you exported it
(*NH-Snags-12-Ermine-Street-2026-09-04.pdf*), because a snag list moves —
two exports a week apart *should* be two different files.

What's in it: your business name and logo at the top, the job, the client and
the address, then **how many are outstanding and how many are cleared**, then
the list room by room in the same order the screen is showing it — colours
beside each room name, the phase against each snag, an empty box for anything
still to do and a filled one, struck through and dated, for anything cleared.

It builds from what's on your phone, not from what's reached the server, so a
snag you ticked in a cellar with no bars is already ticked in the file. It
works with no signal at all. Once everything's cleared, **Export PDF** sits
under the reopened list at the bottom of the screen — that copy is the
completed punch list, which is the one worth sending on.

#### Adding snags

**+ Add snag** opens a sheet with two ways in.

**One snag** — pick the room (or **Custom…** and type a name), type the snag, set the phase if you know it. The sheet stays open on the same room afterwards, because snags come in runs.

**Paste a list** — for the list the client emails you, or the notes off your own phone. Paste it as it came: a line on its own is a room, and lines starting `-`, `*` or `1.` are the snags under it. `- [ ]` and `- [x]` checkboxes are fine — **both come in as still to do**, because on someone else's list a tick means "I've flagged this", not "you've fixed it".

![Reviewing a pasted snag list before it's added](images/10c-snags-paste.png)

Nothing is written until you've looked at it. The review sheet shows exactly what it made of the paste, and everything on it is editable: room names, the snags themselves, and the phase on each one (pasted snags start with none — the app never guesses a phase from the wording, because it would guess wrong). If a stray sentence got read as a room heading, **↑ item** folds it back into the room above; **✕** drops a line. Then **Add n snags**.

#### Colours on rooms you never measured

On a job that came in from Xero there are no measured rooms at all, so there's
nothing for the snag headings to read a colour from. Any room heading with no
measured room behind it gets a **+ colour** tap instead:

![Snag rooms with and without a colour](images/10d-snag-room-colours.png)

Tap it and you get the same colour field as everywhere else in the app: start
typing and your colour library offers matches with their brand and number, so
"dead sal" finds Farrow & Ball No. 28 Dead Salmon and fills the rest in for you.

![Looking a colour up for a snag room](images/10e-snag-colour-sheet.png)

Under the field, the colours already on this job are one tap each. A name the
library has never heard of is fine too — type it and it's yours; the dropdown
also offers to **save it to your colour library** with a brand and code, so
it's there for the next job. **Clear colour** puts a room back to undecided
without losing the colour itself.

**Rooms that aren't one colour.** Most rooms aren't — the walls one thing, the
ceiling another, the woodwork a third. Switch the sheet to **By surface** and
you get a field each for walls, ceiling, woodwork, feature wall and panelling:

![Setting a colour per surface](images/10f-snag-colour-by-surface.png)

The heading then names each one — *Master Bedroom — Walls Dead Salmon · Ceiling
All White · Woodwork Wimborne White* — and each surface shows up on the Colours
tab in its own right, exactly as a measured room's would. **Whole room** and
**By surface** are either/or: setting one clears the other, so a room only ever
has one answer. Measured rooms already worked this way; this just brings the
ones you never measured into line.

Once a room has a colour it shows on the heading (**Landing — Dead Salmon**)
and joins the **Colours** tab alongside everything else, marked *from the snag
list* so you can tell it apart from a room you measured. Rooms still waiting
on one are listed there too, under **Snag rooms — no colour yet**, so you can
work through them from either screen.

A room you *did* measure works the other way round, unchanged: its colour comes
from the Colours tab and the snag heading just shows it. There's only ever one
place a given room's colour is set.

#### Snags and signal

Snags sync exactly like the rest of On Site — tick things off in a house with no bars and every change queues on the phone and goes up when you're back in signal, same as your materials and your logged days. The sync dot in the corner counts them with everything else.

### Extra work in a room you already measured

The bullet above covers the client asking for *another room*. This covers the commoner one: **"while you're here, can you do the radiators in these two?"** — extra work inside rooms you measured and quoted months ago.

Just add it where it belongs. Open the room on **Measure**, put the radiators in, and save it as you normally would. The app does the noticing:

![The app asks whether a change is extra work or a correction](images/07e-scope-changed.png)

It knows because, at the moment the quote was accepted, it froze a copy of **what every room was measured as** — not just what the job was worth. So when you save a room that's grown past that, it can price exactly the difference, name the field that changed, and ask the only question it can't answer for you:

- **Extra work — bill it.** The difference becomes a variation line, *Lounge — extra work*, priced through the same engine as everything else and sitting on the Variations card with the rest. Pending until the client says yes, exactly like any other variation.
- **A correction to the quote.** Nothing is billed — you mismeasured, or forgot a wall, and the room's agreed scope becomes what it is now. Recorded with a date so it's a decision, not a gap.
- **Decide later.** It stays on the Variations card as an open question, billed nowhere until you answer it.

![An extra priced from the change, on the Variations card](images/24b-extra-work-variation.png)

Whichever you pick, **the agreed quote does not move**. The room still bills at what was agreed; the extra bills separately, or not at all. Three things worth knowing:

- **Small changes don't interrupt you.** Under £5 and it goes straight onto the Variations card as an open question rather than throwing a sheet at you on site — but it's never silently swallowed, because that's the money this exists to stop losing.
- **A rate change is never mistaken for extra work.** The difference is worked out by pricing the old scope and the new scope *at the same rates*, so putting your day rate up next month doesn't make every room on every accepted job look like it grew.
- **The kitchen and fitted units ask when you leave the screen** rather than on save, because those forms save as you type.
- **Less work than quoted?** It'll tell you, but a reduction is a credit, not a variation — so the only real answer is **A correction**, and a genuine credit is agreed by amending the quote.

On Measure, a room carrying an extra is chipped **+ EXTRA**; one with a change nobody's ruled on yet is chipped **SCOPE ?**.

**If the frozen scope ever goes missing.** That copy of what a room was measured as is saved with the room, and the room is saved separately from the job itself — so in rare cases (a save lost in a dead spot, a job opened on a second device before it had synced, a restore) a room can come back without it. Without the copy there is nothing to compare against, so the app can't work out what the extra was worth. It says so rather than going quiet: the room is chipped **EXTRA ?** in red on Measure, and the Variations card carries a red row at the top naming it, with the figure the client approved for it if they'd already said yes. **Put this right** gives you two answers — put the agreed figure back as a priced line (prefilled with what they approved), or write it off, which re-agrees the room as it now stands and bills nothing. It deliberately doesn't put the money back on its own: with the frozen copy gone, the room's own line on the final invoice still has that extra work inside it, so adding a variation line automatically would bill the same work twice.

**If you edit that room again afterwards** — a fourth radiator, say — the extra re-prices itself. If the client had already approved it, the card says so: *"Changed since sign-off — £22.63 agreed, £29.47 now."* It doesn't quietly throw away their answer; it tells you the figure moved so you can go back to them or leave it.

**Jobs accepted before this existed** get their frozen scope the first time you open them, taken from the job as it stands that day — so anything already typed in is treated as agreed, and it's changes from then on that get tracked.

### Let the client approve extras themselves

Under the Variations card, **Send for approval** creates a private web page for this job and puts the link on your clipboard — text it, WhatsApp it, or email it to the client.

![The Variations card with the client approval link](images/24-variation-approval-card.png)

They open it on their phone. No login, no app to install:

![The client's approval page](images/23-client-approval.png)

The page shows **the original quote as a single total** (never the itemised breakdown — they've already had that document), then every extra since, with **Approve** and **Decline** buttons on the ones still waiting. The total at the bottom is the original quote plus the extras they've said yes to — pending ones aren't in it, so the figure is never a bill for work they haven't agreed to.

A few things worth knowing:

- **Their answer comes back to you.** Tap **Check answers** on the card, or just reopen the job — the app pulls their taps in and sets the line's status for you, with a note saying it came from the link. If *you* already recorded an answer by hand, yours stands: the person who was there wins.
- **Nothing goes to Xero.** This is entirely separate from **Send variation quote to Xero** below it. Approved extras still reach Xero the usual way — as lines on the final invoice.
- **Prices are frozen once they answer.** Re-measure a room after the client approved that extra and the page keeps the figure they agreed to. Tapping **Send for approval** again updates the same page — it never creates a second link — and refreshes the prices only on the extras still awaiting an answer.
- **Withdrawing an extra.** Remove or unflag a variation and it disappears from their page next time you send — unless they'd already answered it, in which case it stays as the record.
- **The link is the password.** Anyone with it can see this job's totals and answer its extras, so treat it like the quote itself. It's specific to one job and doesn't expire.
- **What the client can reach.** The link only opens that one job's page. But it's the same web address the app runs on, so if someone trims the link back to the domain they land on the app's front door — which is why setting the app password matters (see [Getting started](#1-getting-started)): with it set they get a sign-in screen and nothing else, and it costs you one login per phone, not one per opening. A custom domain makes the link read as your business rather than as a hosting provider, but it doesn't change what's behind the front door — the password does.

### Windows and doors on site

Old windows are where the surprises are. On a job with [Windows and doors](#windows-and-doors) set up, On Site has a **🪟 Windows & doors** card near the top. It opens the same drawings and the same detail view, with two differences:

- **Anything you add here is a variation.** New marks, and prep raised on an opening, are extra work on top of the quote. They show dashed on the diagram and as a dashed badge on the elevation.
- **Prep can go down as well as up.** If a window turns out better than expected once you've scraped it, tap a lower prep level. Below what was quoted, it's a **credit**: money off, on the same draft variation as everything else you've marked. Tapping the quoted level again undoes the change. You can move it freely while the variation is a draft or waiting for an answer. Once the client has answered, that change stays exactly as agreed, but you can still change the level. For example, if they approved a raise to Heavy and the window turns out better once scraped, tap Standard. The approved raise stays on its variation, and the drop is a credit on your new draft, worked out from Heavy. The sheet says *lowered on site from Heavy (agreed)*. Tapping Heavy again takes the new change back off.
- **Bays, dormers and lower ground windows work the same way** — open a bay and tap one of its windows to mark it, or mark the bay's own parts.
- **The quote's own work is locked.** It's shown, solid, so you can see what was already allowed for, but you can't take it off here — and type, size and pane layout are as quoted. The quote is the floor: nothing done on site ever takes money off it.
- **A window or door that was left out of the job** can be brought in. Its sheet says *Not in this job* with an **Add to this job — as a variation** button. Tapping it puts the whole opening — its prep and painting — on the draft variation (*Front, ground floor, D1: added to the job, light prep and paint.*), shown with a dashed badge. You can then mark work on it like any other. While the variation is still a draft or waiting for an answer, you can set its prep freely, and **Take it back out** undoes it (clearing any work you marked on it). Once approved, its painting is on the work-to-do list.

![On site: prep raised and glass marked for replacing, added as a variation](images/26d-windoors-onsite-detail.png)

**Tick off as done.** On site, each window's sheet ends with a **Tick off as done** list: every piece of work on it, quoted or added on site, one line each (*Reputty · top pane 3*). Tap a line as you finish it, or **tick all**. Ticks don't change the price. They decide what the work report shows, because the report lists only what was done. The On Site card counts how many are ticked off. Work on a variation the client declined isn't listed.

![Ticking the work off](images/26w-windoors-tick-off.png)

**A resin repair turns out bigger once it's cut out.** Open the window and tap the bigger size under **Repair size**. That's all: there's no variation and nothing to send, because the quote terms already say repairs are priced on their estimated size and may go up once exposed. A badge shows the change (*M → L*); tap the agreed size again to undo it. Sizes **below** what the client agreed are greyed out. A repair that turns out smaller stays at its quoted price.

- The size a repair was quoted at is locked when the job is **accepted**. A repair added on site (a variation) is locked at the size it was **sent** to the client at; while its variation is still a draft you can change it either way.
- The extra is a **repair size adjustment**, kept apart from everything else. The accepted quote doesn't change, and it isn't a variation. It shows as **Repair size adjustments +£X** under the Windows & Doors total on Summary, on the On Site card and at the top of the On Site windows screen. Tap it for the list: *Front, ground floor, W1: resin repair (cill) M → L, +£18.54*. The figure includes sundries and markup, as the invoice bills it.
- It's billed on the invoice as part of the **one Windows and doors line** (see [Windows and doors on the invoice](#windows-and-doors-on-the-invoice)), not a line of its own. An interim invoice raised after the upgrade includes it; otherwise it's on the final invoice.
- The **client's approval page** shows it as its own line, *Repair size adjustments (per quote terms)*, with no Approve button, so the total they see matches what they'll be invoiced. It updates each time you send or update that page.
- The **work report** shows the size each repair ended up at: *resin repair (cill, large)*.
- **Amending** the accepted quote takes each repair's current size into the new revision, so the upgrade becomes part of the quote.
- **Another patch found on a part that already has a quoted repair** (a second soft spot on the cill): select the cill and tap **Resin repair**. It goes on the draft variation as a repair of its own, with its own size, for the client to approve like any other extra. It's charged its size only, because the cill's base is already in the quote. An upgrade to a repair counted ×2 is charged twice, once for each repair.

![Upgrading a resin repair on site: M → L](images/26ze-windoors-repair-size.png)

![Repair size adjustments: the list behind the Summary line](images/26zf-windoors-repair-adjustments.png)

Everything you mark collects into one **draft** variation, worded for you from the marks — *Front, first floor, W2: reputty x4 panes, resin repair (cill).* — and shown at the top of the screen. It sits on the Variations card like any other extra; **reword for the client** changes what they'll read. Prep raised on site is charged as the difference between the old prep level and the new one. Prep lowered is taken off the same way, so a draft with W2 raised and W4 lowered comes to the difference between the two (*Front, ground floor, W4: prep lowered to light.*).

**When a variation comes out as money off.** If the credits in a draft are worth more than the extras, the whole variation is a credit and shows as **−£** on the Variations card. **Send for approval** puts it on the client's page as *Credit — taken off your final invoice*, with no Approve or Decline buttons, and it counts in their running total straight away. It isn't billed on an interim invoice. On the final invoice it's netted against everything else added on site on the one Windows and doors line, but that line **never goes below the quoted figure**: a credit bigger than the site extras isn't taken off, and the invoice builder says so beside the line so you can adjust it in Xero if you've promised the client money off. A credit isn't sent on a Xero variation quote, because there's nothing for the client to agree to.

![The draft on the Variations card](images/26f-windoors-variation-card.png)

**Send for approval** puts the draft on the client's page like any other extra. Once it's sent — or you've recorded their answer by hand — the draft is closed, and the next thing you mark starts a new one. Work on a variation the client has already answered is locked too.

**Variations that went missing before v2.88.1.** Before v2.88.1 the Windows and doors variations were only kept on the phone, so reloading the app could lose them. The work marked on the windows stayed, but it was left out of the Variations card and billed nowhere. They now save with the job. When the app loads a job with any of that orphaned work, it puts each lost variation back on the Variations card as a **draft**, with a message saying how many it recovered. Any answer the client had already given went with the lost copy, so check each recovered one: send it for approval again, or record the client's answer with **Approved by client**.

#### Work to do

**📋 Work to do (PDF)** is on the Windows & Doors screen from Measure and from On Site, as soon as the job has any windows or doors. It's the list of what's still to be done, built on the phone with no signal needed and handed to the share sheet.

- **At the top, *In all*:** how many openings there are to paint, and the marked work counted up (*Reputty x14 panes, Replace glass x3 panes, Resin repair x5 repairs*).
- **Then each side**, with its drawing, and **every opening on it**, each with a box to tick on paper for each job: the painting first (*Paint: light prep, 2 coats, first floor access*), then one line per kind of repair (*Reputty x2 panes*, *Replace glass x1 pane*, *Resin repair (cill)*). An access you set by hand is always named (*ground access (set by hand)*), so the team knows the scaffold should be up.
- **Openings with repairs get their drawing** with the panes and parts marked. Openings that are only being painted get just their lines, to keep it short.
- **Approved variations are on it**, under their own heading. Drafts and variations still waiting for the client aren't: they haven't been agreed.
- **Work already ticked off as done is left off**, so printing it again mid-job gives what's left. The painting has no tick of its own, so every opening's painting stays on the list.

Like the work report, it has **no prices on it**. From Measure it's the schedule of work behind a quote, to send with it or to talk a client through what they're paying for; on site it's the list to hand the team.

![The two PDFs on the Windows & Doors screen](images/26z-windoors-work-to-do.png)

#### The work report

The **work report** is what goes to the client with the final invoice: every window and door on the house, and the work done to each, with the drawings. **There are no prices anywhere on it.** **📄 Work report (PDF)** on the Windows & Doors screen (Measure or On Site) opens it, exactly as Xero will get it, so you can check it before invoicing. The app builds it on the server from what's saved, so it needs a signal; it waits for any changes still saving from your phone first. (The same work, as a web page, is on the client's approval page under their extras.)

![The work report: header, summary and the first elevation](images/26zm-windoors-work-report-pdf.png)

- **The header** has your logo and business name, the client's name and address, the date the job was completed, and the invoice number once there is one.
- **The summary** counts the windows and the doors, and how many openings had **work found on site**.
- **Each side** has its elevation, with every opening numbered (W1, W2… D1…) and the ones with work beyond the painting picked out.
- **Each opening with work** gets its own drawing with the worked panes and parts coloured in, its label (*Back, first floor, W3*), and a list of what was done: prep, repairs with their size, glass replaced, and the painting (*Prepared (light) and painted, 2 coats in Dead Salmon*).
- **Anything that wasn't in the quote** is tagged **FOUND ON SITE**, with an orange bar down the side of that opening, so the client can see why the invoice is above the quote. That's approved site variations (work marked on site, prep changed on site, an opening added to the job) and resin repairs found bigger than quoted.
- **Openings that only had their painting done** get one compact line each, with a small drawing, to keep the report short.

![Found on site: tagged, with an orange bar](images/26zn-windoors-work-report-found-on-site.png)

Only work **ticked off as done** is listed, and variation work only once the client has approved it. Variations still waiting for an answer, or declined, aren't on it. Openings left out of the job aren't on it or counted.

**Work to do (PDF)**, the list for the team, is different: it's still built on the phone and works with no signal (see [Work to do](#work-to-do)).

#### Windows and doors on the invoice

**The invoice has one line for all the windows and doors work.** Not a line per variation, not a line for repair sizes: one line, for the quoted price **plus everything added on site** (approved variations, repair size upgrades, prep changes, openings added to the job), each at the figure the client was shown. It never comes to less than the quoted figure. Its wording is generated from the job, so there's nothing to type:

*Exterior windows and doors: preparation and painting of outside faces, 19 windows and 3 doors. Full breakdown of work per opening in attached report. Colours: Farrow & Ball No. 28 Dead Salmon (frames), Farrow & Ball No. 57 Off-Black (doors).*

A count of zero is left out (*…outside faces, 14 windows.*), and the colours are only named once you've named them on the Paint card. Under the line, the builder shows what makes it up: the quoted figure, what was added on site, and how many of those variations are still **PENDING** (the app asks before invoicing a pending one, as for any variation). Everything else on the invoice (rooms, kitchen, materials, custom lines, sundries) is exactly as before.

![One line for all the windows and doors work](images/26k-windoors-invoice-attach.png)

**The report goes on the invoice.** Below the totals, **Attach the windows & doors work report** is ticked whenever the job has windows and doors; **Check the report** opens it first. When you create the invoice, the app attaches the report to it in Xero as **Work-Report-INV-0421.pdf** (with the invoice's own number), set to show on the online invoice, so the client can open it from the invoice Xero emails them. Untick it to leave it off; the line then doesn't mention a report. If some quoted or approved work isn't ticked off yet, a red warning says so, because the report would leave it out.

![Attaching the report, and checking it first](images/26zj-windoors-invoice-report-tick.png)

**If the report doesn't attach**, the invoice is still created; the message says the report wasn't attached and why. The Windows & Doors screen then shows **↻ Try attaching the report again** with the reason underneath. Trying again is safe: if Xero already has the report on that invoice, it isn't added a second time. Once it's on, the screen says **✓ Attached to invoice INV-… as Work-Report-INV-….pdf**. Xero doesn't let an app remove an attachment, so a report that's already attached isn't replaced; if you need to change it after that, open it from the Windows & Doors screen and swap it in Xero by hand.

![The retry, with the reason it didn't attach](images/26zk-windoors-report-attach-retry.png)

**Xero needs one reconnect for this.** Attaching files needs a permission that older Xero connections weren't given. Until you reconnect, **Settings → Xero Integration** shows **Reconnect Xero to attach work reports** with a **Reconnect Xero** button. Quotes and invoices keep working either way; only the attachment waits. (If Xero ever refuses this app the permission, the note says so instead, and the report has to be added in Xero by hand.)

![Settings: reconnect once to allow attachments](images/26zl-xero-reconnect-attachments.png)

**Interim invoices** carry the same single line: the fixture's share for that invoice plus anything added on site so far, which is billed on that interim in full. It says which stage it is, *(stage 2 of 3)*, when you picked a stage from the quote's payment plan, or how far through it is, *(40% complete)*. The report is attached to the **final** invoice only, and the interim's line says so.

![The report on the client's page](images/26g-windoors-report.png)

When the work's done, tap **Mark Completed** — the job moves on, and Home reminds you it needs invoicing until you do.

---

## 13. The final invoice

On a **Completed** job, On Site shows **Build final invoice**. The builder assembles the whole money story in one list:

- labour **as quoted** (the frozen accepted figure, not the hours it took),
- plus **approved variations** (including the ones the client approved on their own link),
- with **all the windows and doors work as one line**, the quote plus everything added on site, and the work report attached (see [Windows and doors on the invoice](#windows-and-doors-on-the-invoice)),
- plus the **actual materials** used (from your ticked-off list),
- minus any **deposit already recorded and synced to Xero**.

The invoice's lines are worded the same way the quote's are (see §9): the
invoice version of your template block rides the **first work line**, and the
work lines after it read *"Bedroom - same as above"* or carry their own scope
where they differ. **Lines that aren't measured work are left to speak for
themselves** — *Sundries & Consumables*, a custom line you typed a price into,
and the diary-day/price rounding line. They're a percentage or a price of their
own, not painting, so they never get the block and never read "same as above".

Review the lines, adjust anything, then send — the app writes **one draft invoice into Xero** and marks the job **Invoiced**. You approve and send the invoice from Xero as usual, so nothing goes to the client without your say-so. Applying the recorded deposit to this invoice, once it exists in Xero, is still done in Xero.

### Billing part way through: interim invoices

On a long job you don't have to wait until the end to invoice. While a job is **Accepted**, the Summary status card has an **Invoices** line with **Interim invoice ›**. Each interim bills the rooms (or parts of rooms) finished so far, plus the materials you've bought. The final invoice then bills only what's left.

![The interim invoice builder](images/25a-interim-invoice-builder.png)

- **Labour is billed room by room.** Every line from the accepted quote (each room, exterior item, fitted unit or custom line) has its own % box and a **Done** button.
  - Tap **Done** when a room is finished, and the whole of its quoted price goes on this invoice.
  - Type a % when it's part-done, e.g. **50** when half the room is painted.
  - The % is **cumulative**: how far through that room is **in total**. If the Hall went on the last invoice at 50% and you now tap Done, this invoice bills the other 50% and reads *"Hall — complete (previously invoiced 50%)"*.
  - A room already invoiced in full shows **✓ invoiced in full**. A % can't go down or above 100.
  - **Set every line to** sets all rooms to the same % in one go, handy for "40% of everything". **Match quote stage** does the same using a stage from the quote's payment plan (deposit, weekly instalments, balance). Neither pulls down a room you've already set higher.
  - When every room is at the same %, the invoice shows **one labour line**, *"Labour: 40% of quoted works (previously invoiced 0%)"*, rather than a row per room. The app still tracks each room behind the scenes, so on a later invoice you can switch to marking rooms Done and it carries on from 40% correctly.
  - **Sundries & Consumables** aren't on interims. They're billed in full on the final invoice.
- **Materials are itemised.** Every product you've ticked as **bought** on the On Site list and haven't invoiced yet is listed, with its quantity and price. These are the same lines and prices the final invoice uses. They're all ticked to start with; untick anything you'd rather hold back until later. If you bought 2 tins, invoiced them, then bought a third, the next interim offers just the one. A product with no price is shown in red and can't be billed until you set its price on the On Site screen.
- **Approved variations** work the same way as rooms: a % box and **Done** for each one, so you can bill half an extra now and the rest later.
- **Windows and doors** are one line, the fixture's % plus everything added on site so far (those start at 100%). See [Windows and doors on the invoice](#windows-and-doors-on-the-invoice).

![Preview, running totals and Issue](images/25c-interim-invoice-preview.png)

- **Deposit to take off.** While some of the deposit hasn't been set against an invoice yet, a **Deposit** box appears. It starts at all of what's left, up to the invoice total. Lower it to keep a float for materials on the next invoice. For example, take £600 of a £1,250 deposit now, and the other £650 is offered on the next invoice. Whatever's still unused comes off the final invoice. If the deposit covers the whole invoice, that's allowed; there's just nothing for the client to pay on it.

![Taking part of the deposit, and the preview](images/25d-interim-deposit-split.png)

The **Preview** shows the invoice line by line (each room that bills something, e.g. *"Lounge — complete"* or *"Hall, stairs & landing — 50% complete"*, then variations, then a **MATERIALS** heading with each product, just as the final invoice lays them out), then **Less deposit** and the **Amount due**.

**The total is always a clean £5**, like the quote. If the lines come to £2,797.60, the invoice is £2,795.00. Only the labour of rooms that are **part-done** on this invoice is trimmed. A room you've marked **Done** bills its exact price, pennies and all, and materials stay at their real prices. It's always rounded **down**, so an interim never asks for more than the work done. If every room on the invoice is being completed, nothing is trimmed and the total is exact. The few pounds or pennies trimmed aren't lost: the next invoice that bills that room picks them up, and whatever's left at the end goes on the final invoice, which is exact to the penny. The preview tells you how much was held over.

Underneath, it tells you exactly how much of the deposit prepayment to allocate to this invoice in Xero, and how much stays unallocated. Below that are the running totals: already billed, this invoice, and what's left to bill against the quote plus approved variations. The app warns you before issuing an invoice that would take billing past the quote.

You can fill the builder in with no signal; it saves as you go. **Issue interim invoice** needs a connection. It records the invoice, then creates it in Xero as a **draft** with its own number, the same contact and the same accounts as the final invoice. The deposit is **not** a line on the Xero invoice, because it's already in Xero as a prepayment. Allocate the prepayment to the first interim in Xero, as you would for the final invoice.

![Invoices so far, on the Summary status card](images/25b-interim-invoices-summary.png)

Each invoice then appears on the status card with its Xero state, which the app reads back from Xero whenever you open Summary:

- *in Xero (draft)*: not on the client's page yet.
- *approved in Xero · awaiting payment*: now on the client's page.
- *paid ✓*.
- *voided in Xero*.

If the send to Xero failed, you'll see the reason in red, and **Try again** is safe: it can never create the invoice twice. **Discard** removes the most recent interim if it never reached Xero.

**Correcting an interim that's already in Xero:** tap **Void & reissue** on the most recent interim.
- If it's still a draft in Xero, it's deleted. If it's been approved, it's marked **VOID**, so it stays in Xero as a record and drops off the client's page.
- The builder then opens with that invoice's figures already filled in (each room's %, the extras, the deposit share), so you only change what was wrong and issue it again. The corrected invoice gets a new number.
- If a payment or the deposit has been allocated to the invoice in Xero, the app won't void it. Remove the payment or allocation in Xero first, then try again. The app never unwinds money.
- It only works on the **most recent** interim, and not once the final invoice exists, because later invoices refer back to it.

If you void an invoice directly in Xero instead, open Summary and tap **Discard** on it. That has the same effect, without the pre-filled builder.

**The client sees what's been invoiced.** Once an interim (or the final invoice) is **approved in Xero**, it appears on the client's link under **Invoices so far**, with its number, date, amount, and whether it's paid. There's also a running *"Invoiced so far"* against the job total. Drafts are never shown, so nothing reaches the client's page before you've checked and sent it.

![What the client sees on their link](images/25e-client-invoices.png)

**The final invoice with interims.** When the job is completed, the final invoice is built as before, with two differences:

- **Materials already invoiced are left off.** The final lists only what no interim has billed. A product that was part-billed shows just the remainder, with a note of how many were already invoiced. Materials are never billed twice and never need a deduction line.
- **Labour and variations are billed in full, then each interim's share comes off.** Every quote line, the sundries and every approved variation appear as usual. Then comes one **"Less: interim invoice INV-…"** line per interim, for the labour and variations it billed. An interim that only billed materials has no deduction line. What's left to pay is the rooms that weren't invoiced, the unbilled parts of the rest, and the sundries.

If you've since returned a tin that an interim already billed, the final invoice flags it so you can credit the difference in Xero. The deposit box now shows only the part of the deposit that hasn't already been set against an interim. The final invoice can't be created until every interim is in Xero.

Once a job is Invoiced, Summary shows a read-only **Job Profitability** card telling three separate stories: **Billing** (quoted vs invoiced, with a note if they differ), **Schedule** (days quoted vs days actually logged), and **Materials** (quoted materials vs the real trade cost of what was used, with your markup on materials banked as its own figure). On a job billed in stages, the **Billing** section shows the quoted total (including approved variations), what has been invoiced to date across the interim and final invoices, what's left to bill, and each invoice listed underneath. It's reference only — nothing here feeds back into pricing.

---

## 14. Rates

Menu (☰) → **Rates** — every number the calculator uses, grouped by what it prices. A change here applies to every future calculation, and reprices any open (un-accepted) draft immediately — accepted quotes are unaffected, since [their figures are already frozen](#once-a-quote-is-accepted-its-figures-freeze).

![Rates screen](images/12-rates.png)

| Section | Card | What's in it |
|---|---|---|
| Paint Coverage | **Coverage Rates** | Standard m²/litre per surface, the spraying uplift %, and per-product rates that beat the standard figure for a specific paint range |
| Paint Coverage | **Exterior Paint Coverage & Areas** | Assumed areas and coverages behind exterior litres |
| Labour Times | **Time Rates** | Minutes per m² (or per item) for every surface, doors/frames, sills, mist, panelling, staircase parts |
| Labour Times | **Wallpaper Stripping** | Minutes per m² to strip paper off, one figure per difficulty — lining, standard/vinyl, textured/woodchip, multiple layers. **These ship at 0 and are yours to fill in** — see [Walk the room](#walk-the-room) |
| Labour Times | **Exterior Rates** | Minutes per coat for masonry, fascias, windows, doors, garage, sash extras, access uplifts |
| Item & Job-Type | **Doors & Frames** | Paintable areas per face, fire-door surcharge, ironmongery prices |
| Item & Job-Type | **Wallpaper Rates** | Per-roll rates, ceiling/staircase multipliers, minimum price, wide vinyl & mural rates |
| Item & Job-Type | **Kitchen Rates** | The full price matrix per item type × size, linear rates, carcass %, strip-original-coating minutes |
| Item & Job-Type | **Fitted Unit / Shelving** | Shelf and bay spray times, fallback areas behind fitted-unit litres |
| Item & Job-Type | **Windows & Doors** | Window base minutes per size tier, minutes per pane, sash/casement/fixed adjustment, door base minutes per type and size, bay base minutes per shape and storeys, prep multipliers, each marked-work action's minutes and material £, and the paint areas (each size's m², the timber share per type, door leaf and frame, bay timber per storey) |
| Scheduling | **Scheduling** | Daily overhead, schedule buffer, Work Saturdays, bank-holiday region, calendar feed |

**Windows & Doors** prices each opening as *(base minutes for its size and type + panes × minutes per pane) × coats × access × its prep multiplier*, plus the minutes of any work marked on it — all at your day rate, like every other timed task. The prep multipliers start at Light ×1.10, Standard ×1.25, Heavy ×1.40 and Restoration ×1.75; the material £ (glass is £25 a pane to start) is per pane or part marked, before markup. The sash actions start at Re-cord 40 min and £6, Replace beads 20 min and £4, and Ease & overhaul 45 min and £3, each per part; a door's Ease starts at 30 min. Other items aren't on Rates: each has its own minutes and £. Every figure is a starting guess to calibrate.

The window, pane, door and bay minutes are **for 2 coats**, and scale with the job's coats setting (1 coat is half, 3 coats one and a half), as the card's note says. Access isn't a figure of this card: it uses the **Access — 1st floor** and **Access — 2nd floor +** percentages on the Exterior Rates card, so a first-floor window costs the same uplift in both places. Marked work takes neither.

![Rates — Windows & Doors](images/26h-windoors-rates.png)

**Bay base minutes** are a bay's own cornice, fascia and mullions, by shape and storeys — canted 90 minutes for one storey and 160 for two, square 70 and 125 to start. They're on top of the bay's windows, which are priced as windows, and the bay's prep multiplies them. A dormer's fascia and cheeks have no minutes of their own; work marked on them uses the frame actions' minutes.

![Rates — bay base minutes](images/26r-windoors-bay-rates.png)

**Resin repair** is priced by size. **Resin repair base** is the part every repair takes whatever its size (15 minutes to start: setting up, consolidating, the cure wait and coming back). Each size then adds its own minutes and £ of resin: Small 5 min / £2, Medium 10 / £4, Large 25 / £8, X-Large 45 / £15. Medium (15 + 10 = 25 minutes, £4) is exactly what the single resin figure was before, and if you'd changed that figure, Medium takes your figure. These are starting points: adjust them to match your own jobs.

![Rates — resin repair, base and sizes](images/26zg-windoors-resin-rates.png)

> **Calibrate as you go:** after a few jobs, compare the logged time and actual materials on On Site with what was estimated, and nudge the time and coverage rates here. The estimates get sharper with every job.

---

## 15. Settings

Menu (☰) → **Settings**. Everything that isn't a calculation rate lives here: your business identity, pricing defaults, Xero, and backup.

![Settings screen](images/12b-settings.png)

| Section | What's in it |
|---|---|
| **Business** | Your business name and logo — shown in the app header, on the sign-in screen, at the top of every quote you send and its PDF, and in the calendar feed. Also your name, business phone, business address and home delivery address, used on [supplier orders](#sending-a-materials-order-to-your-supplier) |
| **Suppliers** | The merchants you order materials from — name, email, and optionally your account number, branch name and branch address (the branch is used when you Collect). Add, edit (✎) or delete (✕); deleting one doesn't remove orders already sent to them |
| **Pricing** | Day rate, hours per day, markup %, sundries %, spray sundries bump, deposit %, commercial job adjustment, standalone-job rounding (full or half days), and how many days before an unanswered quote gets flagged |
| **Deposits (Xero)** | The bank account a recorded deposit lands in, and the account code it posts to |
| **Xero Integration** | Connect / disconnect |
| **Materials (Xero Items)** | Refresh your product list from Xero and set the default product for each role |
| **Quote & Invoice Text** | The per-job-type wording templates for quotes and final invoices |
| **Calibration** | What your finished jobs say about two of your settings — see below |
| **Appearance** | Light / Dark / Auto theme (this device only) |
| **Backup** | Export and import everything — see below |

![Business details and Suppliers](images/12c-settings-suppliers.png)

### Calibration — let finished jobs correct your settings

Some of the figures behind your prices started life as sensible guesses. This card
compares them against what actually happened on your last few finished jobs.

![Calibration card](images/23-calibration.png)

**Days on site** adds up the days you logged on *On Site → Time on site* and compares
them with the days those jobs were quoted for. If you're consistently running over, the
percentage is the **Schedule buffer** you should probably be padding quotes with.

**Sprayed wall paint** does the same for tins: on jobs where at least one room had
**Spray walls** on, it compares the wall paint the estimate asked for against what you
logged as used, and turns the difference into a **Spraying uplift** figure.

Three things worth knowing:

- **Jobs with nothing logged are left out completely** — not counted as zero. A job you
  never logged days for says nothing about how long jobs take, so it isn't allowed to.
  The card tells you when it has left jobs out, and why.
- **Nothing changes until you tap Adopt.** Adopting sets that one setting for quotes from
  now on. No quote, invoice or finished job is re-priced — accepted quotes are frozen
  anyway.
- **Change "Jobs to look at"** to widen or narrow the sample. Eight is a reasonable
  default; drop it to 3 if you've recently changed how you work.

If a suggestion says *"not enough data yet"*, it's telling you what's missing — usually
that no sprayed job in the sample has its materials logged. It'll appear on its own once
the data does.

The sundries % and the exterior assumed areas aren't offered here, and that's deliberate:
nothing in the app tracks what you actually spend on sundries, and an exterior paint
overrun could be the assumed area or the coverage rate — there's no way to tell which.
Those stay your judgement call.

---

## 16. Backups

Settings → **Backup**:

- **Export everything** downloads a single JSON file containing every job, room, setting and colour — and your suppliers and supplier order history. Do this regularly — Home will nag you when the last backup is getting old.
- **Import backup** restores from a file, adding to what's already there — imported jobs get fresh identities, so it can never overwrite existing data. Restoring settings is a separate opt-in on the import preview, since it's the one thing an import *can* overwrite. Suppliers come back too (one you already have is left as it is), and each imported job brings its supplier orders with it, so its lines still read *Ordered* and the next order won't repeat them. The shopping list isn't in the backup — it's a pick-up list, not a record. Backup files up to 64MB are accepted, which is far more than a full job history comes to; if anything is ever wrong with a file, the app now tells you what in plain English rather than showing a syntax error.

---

## 17. Tips & troubleshooting

**The dot** in the top bar is your sync status: green = everything saved to the server, amber = saving now, red = offline. If you lose signal mid-measure, keep working — changes are kept on your phone ("Offline — N changes queued on this phone") and pushed up when the connection returns; the menu's sync line confirms with "All changes synced ✓".

**Opening the app with no signal.** The app keeps a copy of itself on the phone, so it opens in a dead spot exactly as it does anywhere else — everything you've measured is on the phone, not fetched from the server. It has to have been opened *once* somewhere with signal first, to save that copy; if it hasn't, you'll get a short page saying so rather than the browser's "no internet" screen.

If you've had launches that hung on a blank screen in a dead spot, that's fixed as of v2.61.0. The cause was a phone showing a bar of signal with nothing actually getting through — not the same as being cleanly offline, and the app used to sit waiting on it. It now gives the network a few seconds and then opens from the phone's own copy. The same deadline applies to saving: a change made where the signal is dead is queued on the phone within seconds instead of hanging, so the dot goes red and tells you what's waiting rather than sitting on amber.

**Starting a job with no signal.** You can now do this too — pull up outside a house with no bars, add the job, and measure straight into it. The job is created on the phone and appears on the server when you're next in signal, along with everything you put in it. (Before v2.61.0 nothing happened when you tapped it.)

**Switching jobs with no signal.** A job is kept on the phone once you've opened it in signal, so you can switch between the jobs you've been working on with no bars at all and each one comes back with its own rooms, colours and materials. The last dozen jobs you've opened are kept; older ones drop off and reload the next time you open them in signal.

If you try to switch to a job this phone hasn't got a copy of, it now tells you so and stays where it is — rather than opening the job looking empty. That matters: before v2.62.0 it opened with every room gone, and anything you then measured would have replaced that job's real rooms on the server when the signal came back. If you see that message, the job is fine — the phone just hasn't downloaded it yet.

**A price looks wrong?** Work backwards: room Preview → Summary breakdown → Rates. The calculation is always *areas × time rates × day rate*, plus *areas ÷ coverage = litres → tins*, plus sundries and markup. One of those numbers will be the culprit — usually a coverage or time rate that doesn't match how you actually work. If the job is already **Accepted**, remember its figures are frozen — a rate change won't move it; you'd need **Amend → revision N+1** on Summary.

**Xero button not working?** Tokens occasionally expire for good if the app hasn't talked to Xero in a long while. Settings → Disconnect Xero → Connect Xero puts it right in under a minute.

**Sent a quote, then client wants changes?** Just edit the rooms and hit **Update quote Q-nnn in Xero** on Summary — same quote number, new figures.

**Materials you added by hand not in the total?** Check the row's tag on Summary's materials list. A line tagged **Tracking only** is deliberately left off the quote — tap the tag to make it **Chargeable** and it joins the subtotal, the Xero quote and the deposit straight away. The card also prints *"Tracking only — not on the quote"* with a figure whenever anything on the list isn't being billed, so you can see at a glance whether money is sitting outside the price. (Lines added before September 2026 may have been saved as tracking-only by default — one tap each puts them on.)

**Extra work mid-job?** Always add it as a **Variation** rather than editing the accepted rooms — the original quote stays honest, and the extra shows separately on the final invoice where the client expects to see it.

**Recording a deposit but the option's greyed out?** A linked Xero contact is required before you can sync to Xero — the app will point you at Sync to Xero on the client details. You can still record the deposit locally in the meantime.

**The build number** at the bottom of the ☰ menu is how you check a new version has actually reached your phone after a deploy.

---

*Manual for NH Estimator v2.94.0. Screenshots taken from the app with example data.*

*Keeping this manual up to date: edit this file, then run `npm run build:manual` to regenerate the PDF edition ([NH-Estimator-User-Manual.pdf](NH-Estimator-User-Manual.pdf)) and commit both together. The cover picks up the app version and date automatically.*
