# Job spec sheet: per-job quick reference with ticks

**Status: BUILT, v2.71.0 (2026-09-19).** Design settled with Nicky on
2026-09-19; the decisions are recorded below so nothing needs re-asking. The
one open item at the end was built on its stated default.

A sheet per job that answers, without opening any room: what is being done in
each area, what colour each thing is going, and the stages from prep to
finish. Every row can be ticked off, Prep and then Painted, on the same logic
as the Snags list. It opens in the app, and it can be shared from the phone as
a PDF or as a live link that other people can tick from.

## Why it exists

On site the questions are small and constant: "which walls am I painting in
here", "what colour is the radiator going", "what have I still not touched".
Today the answers mean opening the room, or the Colours tab, or the materials
breakdown, then backing out and doing it again for the next room. The
information is all in the app, spread across screens built for entering data,
not for looking things up or working through.

## What it is (and is not)

- A **derived view plus a set of ticks**. The rows are rebuilt from the rooms,
  exterior items, kitchen, fitted units and custom items every time the sheet
  is opened, the same principle as `colourAreas()`, so they cannot drift from
  what is actually being painted. Only the **ticks** are stored.
- **Read-only apart from ticking.** No editing colours, coats or prep from the
  sheet. A second place to edit colours is what `COLOUR_HANDLING_SPEC.md` was
  written to get away from.
- **No money.** No prices, quantities, tins, markup or site notes anywhere on
  it, on screen, in the PDF or on the live page.
- **No calculation on the server.** The describing logic lives in
  `index.html` (see `CLIENT_APPROVAL_SPEC.md`, "Why the prices are published,
  not computed"). The live link publishes a finished model, it never computes.

## Decisions

| Question | Decision |
| --- | --- |
| Prep detail | Show recorded prep where a surface has one, otherwise a general prep line per surface. |
| Stage order | Ceiling, panelling, woodwork (radiators with it), walls, and the feature wall always last. |
| Radiators | Follow the woodwork colour unless the room sets their own. A specified radiator colour also shows on the client quote's colour schedule. |
| Prep line wording | Fixed built-in wording per surface. Draft below, Nicky will tweak it. |
| Variations and custom items | Both appear, tagged. Custom items show no price. |
| Sharing | PDF snapshot and a live link that always shows the current sheet. |
| Views | By Room and a By Stage toggle, like Snags. |
| Ticks | Two per row: Prep, then Painted. Same logic as Snags. |
| Ticking from the live link | Anyone with the link can tick. |

## Where it lives

On Site tab, next to Snags. It follows the Snags section's visibility rules
(below) and opens a full-screen sheet with a By Room / By Stage toggle at the
top, then `Fold all`, the filter box, and Share (PDF, link). It works offline
because everything it reads is job data already on the device.

## Rows and the stage order

Every sheet row is one **surface in one area**. Inside a room the rows follow
the working sequence:

1. **Ceiling** (and a papered ceiling)
2. **Panelling**
3. **Woodwork**, with its "including" list (skirtings, door frames, doors,
   window frames, sills), then **Radiators** as their own row directly under
   it
4. **Walls** (and papered walls)
5. **Feature wall**, always last

The order is one constant (`SPEC_STAGES`). Feature wall's rank is the highest
in it, so it is last in a room and last among the surface sections in By Stage.

Areas follow the job's own order: rooms, then exterior items, kitchen, fitted
units, then custom items under "Other work". Kitchen, fitted units and
exterior items use the same row shape through their existing describers, not a
new description function.

**Row anatomy**, top to bottom: the surface and its coat count, the
**colour** (largest, because it is the thing being looked up), the product,
the **Prep** line, then the two tick boxes: **Prep** and **Painted**. A
surface with no coats is not shown. A papered surface shows as its own row
with no colour and no prep line, and has a single **Done** tick. A custom item
has a single **Done** tick.

**One gate that is deliberately wider than `colourAreas()`.** Woodwork is
shown when `xc > 0` **or** doors or frames carry their own coats: doors and
frames have counts of their own and a room can legitimately have one without
the other. "No coats, no row" still holds — that is the principle the rule
comes from.

### Undecided colours

An area whose colour is not decided shows **To be confirmed**, the same rule
as the client quote's colour schedule (`colourScheduleLabel` and
`namedColourNames` in `COLOUR_HANDLING_SPEC.md`). Never print the area
placeholder in the colour slot: "Lounge Main Walls" under a room called Lounge
reads as a mistake.

## Ticks

Same logic as Snags, adapted because the sheet's rows are derived, not stored.

**Two ticks per row.** **Prep** and **Painted**, left to right. They are
independent: Painted can be ticked without Prep (the prep was done last week,
or there was none), and Prep can be ticked alone. Nothing auto-ticks the other.
A row is **cleared when Painted (Done, on a single-tick row) is ticked**.
Ticking Prep strikes through and dims the Prep line. Ticking Painted strikes
through and dims the whole row. Each ticked step shows its date beside its
label, and un-ticking reverses it and puts the row straight back where it was.

**Rows stay.** A cleared row is struck through and dimmed but **left in the
list**, at the bottom of its group. On site the value of a cleared row is the
evidence it was cleared, and a row that vanishes takes that with it.

**Identity.** Each row has a stable key, `<kind>:<id>:<role>`, built from the
record's **id**, never its name (for example `room:ab12:ceiling`,
`room:ab12:radiators`, `unit:cd34:unit`, `custom:ef56:item`). Renaming a room
therefore keeps its ticks, which is the opposite of Snags, whose ticks belong
to a place on site (a text label) rather than to a database row. The sheet
roles are their own constant and do not depend on `colourAreas()` roles, so a
radiators row exists before any radiator colour override does.

**Storage.** Columns, not a JSON blob, for the reason Snags gave: status is
queried and counted. Created lazily by `ensureSpecSchema()` — in
`lib/specSheet.js` rather than in `routes/api.js`, because the public page
writes the same table from outside the login gate and two lazy creators for
one table would be two answers to one question (the same reason
`lib/clientQuote.js` exists). `db/setup.sql` is not run on deploy.

```
spec_ticks
  job_id        FK, ON DELETE CASCADE
  item_key      text, the row key above
  step          'prep' | 'done'
  status        'open' | 'done'
  completed_at  set from status server-side
  source        'app' | 'link'
  updated_at
  PRIMARY KEY (job_id, item_key, step)
```

One row **per row and per step** rather than one row per item with two
status columns, so a Prep tick and a Painted tick can never overwrite each
other. That matters now that two people can tick at once, one on the phone and
one on the link.

**API**, in the style of the Snags routes:

```
GET  /api/spec-ticks?job_id=X    every tick for the job
PUT  /api/spec-ticks             upsert one tick: jobId, itemKey, step, status, completedAt?
```

One row per PUT and **no collection-level replace-all**, so each tick queues
and replays independently with no signal. There is no natural id to upsert on
in the client, but here there is a natural key, so the upsert targets
`(job_id, item_key, step)`, the pattern `material_actuals` uses. Un-ticking is
a PUT with `status = open`, exactly as Snags does it. `completed_at` is derived
from `status` server-side, the client may send its own stamp (it ticks
offline, and the moment it was ticked is what the record should say), and an
unparseable or missing one falls back to now. `step` and `status` are
validated against their sets and `item_key` against a length cap.

**Every tick shares one path**, so the offline queue needed a dedupe key that
carries the row: `apiPutStrict` gained an optional `dedupeKey` (the queue
already supported one) and `hasQueuedKey()` asks the same question of it.
Without that, forty queued ticks would have looked like one and been deduped
down to one, which is data loss rather than deduplication.

Ticks are included in **backup export and import** (`jobs[].specTicks`,
additive on the v1 shape), are deleted with `DELETE /jobs/:id` (by the
foreign key's cascade, like `job_variations`) and `DELETE /all` (by hand,
because that route clears a job's data without deleting the job), and are
**not** copied by `POST /jobs/:id/duplicate`. A copy is a fresh draft, and
inheriting another house's progress would be worse than useless.

**Orphans.** A tick whose row no longer exists on the sheet (room deleted,
surface's coats set to zero, variation declined) is ignored and never counted.
No cleanup is needed. Known edge, accepted: if that surface comes back, its
old tick comes back with it.

**Sync.** Writes go through `apiPutStrict`, the same helper Snags and actuals
use: a network failure queues the write in the offline queue and reports
success, a reachable server that rejects it still throws. The sync dot and the
"n changes queued" line cover it with no extra work. There is no localStorage
mirror of the ticks. They load when the sheet opens and on every job switch,
and are cleared on a job switch.

**Other people's ticks reach the phone.** Because the link lets others tick,
the phone refetches while the sheet is open (on open, on returning to the
app, and about every 30 seconds while visible). **A fetch never replaces a key
that still has a queued local write** — `loadSpecTicks()` keeps any key
`hasQueuedKey()` still answers for — or it would swallow the tick made thirty
seconds ago in a cellar, which is the same trap the Snags PDF avoids by not
re-fetching.

## Ordering: cleared last

Applied at both levels, in both views, exactly as Snags v2.58.0 does:

- **Rows.** Compare cleared first (a cleared row sorts below every open one),
  then stage rank, then sheet order, then key so the sort is total. A row with
  only Prep ticked is still open.
- **Groups.** A room with nothing left open sinks below every room that still
  has work in it, job order preserved within each band. In By Stage, a section
  with nothing left open does the same, stage sequence preserved within each
  band.

No state is stored for this, it is one comparison key derived from the ticks.

**A consequence to know about.** Cleared-last outranks stage order, so a
feature wall that is still open sits **above** a ticked-off ceiling. The
feature wall is last in the room's sequence, not last on the screen once
other rows are cleared. That is the same behaviour Snags has and it is what
"same logic" means.

## Folding

Identical to Snags v2.63.0. Every group heading (a room in By Room, a stage in
By Stage) is a tap target that folds its rows, with a chevron on the right. A
folded group keeps its label and its count (`2 open`, or `all done ✓`). The
count is of **rows**, so a row with Prep ticked and Painted not is still
open.

The default follows the visibility rule: a group with nothing left open is
folded, a group with work in it is open, and a job with **nothing** open
anywhere opens every group. A tap is remembered and beats the default in both
directions, so ticking a room's last row cannot fold it out from under the
person who opened it. `Fold all` becomes `Open all` once everything is
folded. State lives in `specCollapsed`, keyed by **view and group key**, is
per visit and never stored, and is cleared on a job switch. While the filter
box has something in it every group renders open: folding a group the reader
has just searched into would hide the answer they asked for.

## On Site entry: visibility

Mirrors Snags, with one deliberate difference.

1. **Snags has "no snags, no section". The sheet has no such state**, because
   the sheet exists whenever the job has any rows. A job with no rows shows no
   entry at all, never an empty card.
2. **Something still open:** the entry renders next to Snags, above the
   materials section, headed `Spec sheet (n)` where *n* is the count of
   **open rows**, with `Prep 9/14 · Painted 6/14` under it.
3. **Everything done:** it drops to a single collapsed `All n done ✓` card at
   the bottom of the screen, expandable to the full struck-through sheet.

## By Room view

One block per area, rows in the stage order above, cleared rows at the bottom
of their block, cleared areas at the bottom of the list.

## By Stage view

The job flattened by stage, like the Snags By Phase view. Sections in this
order, each listing every matching row across all rooms with the **room name
alongside**:

1. Ceilings
2. Panelling
3. Woodwork (radiators included, each with its colour)
4. Walls
5. Feature walls
6. Other areas (kitchen, fitted units, exterior, custom items), grouped by
   area in By Room format

Use it to batch a task across the whole job in one pass. Same rows, ticks,
tags and filter as By Room, just regrouped. Ticking here is the same tick as
in By Room.

## Prep lines

Rule, per surface: **if the surface has a recorded prep step, show that.
Otherwise show its general prep line.** Recorded prep replaces the general
line for that surface, it does not sit beside it. The Prep tick belongs to
whichever line is showing.

Recorded prep that exists today:

- **Mist coat** on new plaster (`mistWall` / `mistCeil`) shows "Mist coat"
  with its product, on that surface only.
- **Primer**, where the room uses one, shows "Primer" with its product. The
  gate is `calcRoom(r).primerL > 0` — the figure the room actually buys, not a
  re-reading of the toggles behind it, because self-priming products,
  `primerNone` and the door/frame flags all feed it and guessing at them is how
  the sheet would start promising a primer coat the job never bought.
- **Fitted unit prep level** (bare or painted) is always set, so it always
  wins on a fitted unit, in the wording the fitted unit screen already uses.
- **Kitchen Strip Original Coating**, when switched on, shows "Strip original
  coating". Show the state, never the minutes.

General prep lines, built in as one constant (`SPEC_PREP_LINES`). **This
wording is a draft for Nicky to edit**, not settled copy:

| Surface | General prep line (draft) |
| --- | --- |
| Ceiling | Fill and sand. Mask edges and fittings. |
| Panelling | Fill and sand. Caulk joints. Mask adjoining surfaces. |
| Woodwork | Sand and key. Fill and caulk. Mask adjoining surfaces. |
| Radiators | Clean and key. Mask the wall and pipework. |
| Walls and feature wall | Fill and sand. Tape switches, sockets and edges. |
| Kitchen | Degrease, sand and key. Mask hardware and walls. |
| Fitted unit | Degrease, sand and key. Mask adjoining surfaces. |
| Exterior masonry | Wash down and treat. Mask adjoining surfaces. |
| Exterior woodwork | Scrape and sand back. Fill and prime bare timber. |

## Radiators and their colour

**Today:** radiators are priced as labour only (`rRad` minutes each) and add
no paint litres. They ride the woodwork colour, and `colourAreas()` had no
radiator role.

**Built:** a radiator row shows the woodwork colour by default. A room can
set its own radiator colour when needed, and **when it does, that colour
shows** on the sheet, the Colours tab and the client quote's colour schedule.
The sheet works fully without the override.

The override:

- On the room screen, when radiators is above zero, a **Radiators** row with a
  chip **Same as woodwork**, on by default. Switching it off reveals the
  standard area colour field (free text, quick-pick chips, library
  autocomplete), with the existing `applyAreaColourName` rules unchanged
  (rename in place, join, fork).
- "Same as woodwork" is a **different state from "undecided"**. The chip is
  `radiatorColourNumber === null`; undecided is a NUMBER pointing at an
  unnamed colour, which switching the chip off mints. The placeholder-first
  blank rule is deliberately not reused for it.
- Stored on the room as its own colour number, null meaning follows woodwork.
  Old jobs have no override and need no migration.
- `colourAreas()` gains a `radiator` role **only when an override is on**, so
  no room gets a new "to decide" item unless it asked for one.
- **Does not change tins or "What to buy".** Radiators carry no litres, so a
  colour whose only area is a radiator produces no buy line and does not move
  `computeRoleGroups`, which has no radiator role and must not gain one.
- **Client quote colour schedule.** `roomColourSchedule(r)` adds a
  `Radiators` part **only when the override is on and `rads > 0`**, using the
  radiator colour number. Its existing merge logic does the rest: a radiator
  colour identical to the woodwork colour reads "Woodwork/Radiators: X", and a
  room where every part is the same still collapses to one label. An override
  not yet decided reads "Radiators: To be confirmed", which is correct. That
  one function feeds every schedule, so the change is there and nowhere else.
  The scope sentence is unchanged, radiators already ride the woodwork clause
  and the sentence names paint, not colour.
- Snag headings keep their own rule and are untouched: `snagAreas()` builds
  its own per-surface parts list and never reads `colourAreas()`, so the new
  radiator area cannot break its "collapse to one name" test.

## Variations and custom items

Both appear, tagged, using the convention the client Quote page already uses
(`VARIATIONS_SPEC.md`), read from `variationStatusOf()`:

- Pending variation: tagged **Variation, awaiting approval**.
- Approved variation: tagged **Variation ✓**.
- Declined variation: omitted.
- Custom line items (`jobCustomItems()`, `customItemsSplit()`) appear under
  "Other work" with their description only, **never the price**, tagged the
  same way if they are variations.

Pending variations are shown on purpose, and tagged so they cannot be read as
a go-ahead: Nicky's rule is that approval comes before starting the work. They
can still be ticked, the tag is the warning.

Watch out: `scopeFacts()` and the quote builders filter with `!isVariation`
because they describe the original quote. The sheet does **not** inherit that
filter. It needs the variation work too.

### Extra work added inside an already-measured area

`VARIATIONS_SPEC.md` Part 2 (v2.71.0) landed after this spec was written, and
it is the one case the tag vocabulary above cannot express. That flag is
per-**carrier** and never per-field: the job knows a room has grown beyond the
scope that was agreed, but not which surface it grew on. There is no row to
tag, and tagging all five of a room's rows "Variation" would be a worse lie
than saying nothing.

So it is said once against the **area** instead — `specAreaNote()`, rendered on
the group heading in both the app and on the live page, in the same one
constant as the row tags:

- classified and still pending: *includes extra work, awaiting approval*
- approved: *includes extra work ✓*
- declined: *includes extra work the client declined*

The **declined** case is what earns it its place. That work is still measured
on the job — the radiators are typed into the room, which is why the delta
exists at all — so its row is still on the sheet to be painted, and nothing
else on this screen would say the client has refused to pay for it. The rows
stay either way: the sheet describes what is measured, and taking work off it
is done by re-measuring the room, not by the client's answer.

A carrier whose classified extra has since shrunk back below its baseline
carries no note, which is `variationDeltaScan()`'s own rule.

**Known limit.** A group only carries the note when the group IS one area, so
it shows throughout By Room and on By Stage's per-area blocks, and is dropped
on a stage section spanning several rooms. There is nowhere honest to put it
there: the section is a list of ceilings across the house, and the note belongs
to one of the rooms in it.

## Quick find

A filter box, instant as you type, in the pattern of the price lookup tool. It
matches row label, colour name, room name and product, and shows matching rows
with their room alongside. It works in both views, on the phone and on the
live page.

- "radiator" lists every room's radiator row with its colour.
- A colour name lists everywhere that colour is used.
- Clearing the box restores the full sheet.

## Sharing: PDF

A PDF built **on the device** through the same pipeline as `saveSnagPdf()`:
the hand-rolled `pdfDoc()` / `pdfSerialise()` writer, share sheet first,
download as the fallback, no library, works with no signal. Filename follows
the snag convention (`NH-Spec-<Job>-<yyyy-mm-dd>.pdf`), dated by the day it is
exported.

Like the Snags PDF it **renders the in-memory state and does not re-fetch
first**, so it includes every tick made on this phone including the ones still
in the offline queue. Header: the business band, job name, address and
**"Correct as of <date and time>"**, then the counts spelled out ("8
outstanding, 6 done. Prep 9 of 14"). The client's name, phone and email are
not on it.

It prints **the view the screen is showing**, in the order the screen is
showing it: cleared rows at the bottom of their room, cleared rooms at the
bottom of the list. Each row carries two boxes, **Prep** and **Painted**,
outlined if open and filled if ticked, with a rule drawn through the text of a
cleared row and its date beside its label. Boxes rather than a tick glyph,
because the standard-14 fonts have no tick glyph and filled against outlined
survives a photocopy. One export, matching the working view, so the file is
checkable against the screen.

## Sharing: live link

A link that always shows the current sheet, for a helper or a client, and
that **anyone holding it can tick things off on**.

**Its own token.** Not `jobs.client_token`. That token opens the client's
variation page, which has Approve and Decline buttons, and handing it to a
helper hands them those buttons. A separate `spec_token` is minted, and each
link can be revoked without touching the other.

**Two kinds of data on the page, published differently:**

- **The rows** (structure, colours, products, prep lines, tags) come from a
  **published model**. The server has no calc engine, so the phone publishes
  the finished model and the server stores and serves it. This part is
  current as of the phone's last sync, and the page says so.
- **The ticks** are **not** part of the model. They live in `spec_ticks`, the
  one table both the app and the page write to, and the page reads them fresh
  on every load. So a tick from either side shows on the other without a
  republish, and ticking never triggers one.

**Tables and routes**, in the style of the client-variations routes:

- `jobs.spec_token` (unique partial index like `jobs_client_token`) and a
  table `job_spec_sheets` (job_id primary key, model JSONB, published_at). The
  model is plain strings and structure only. Each row in it carries its `key`
  and its `steps` (`['prep','done']` or `['done']`), and the model carries its
  own ordered `stages` list — so the public page needs no stage order of its
  own and still computes nothing.
- `GET /api/jobs/:id/spec-sheet` returns the link and last published time.
  `PUT /api/jobs/:id/spec-sheet` publishes or refreshes, mints the token on
  first use, and replaces the whole model. `DELETE /api/jobs/:id/spec-sheet`
  is Stop sharing: it clears the token and the model. **It leaves the ticks
  alone**, they belong to the job.
- Public page, following `routes/publicQuote.js` and `lib/clientQuote.js`:
  `GET /s/:token`, plus `GET /s/:token/ticks` for the poll. Token compared in
  constant time, a bad token and a missing sheet give the same generic 404,
  `no-store`, noindex. The token is the whole credential. Server-rendered,
  phone first, with the same By Room / By Stage toggle, filter, folding and
  cleared-last ordering, and an **"Updated <date and time>"** line for the
  model.
- **One renderer.** `specSheetHtml()` and the pure functions around it in
  `routes/publicSpec.js` are serialised into the page's own script, so the
  first paint the server sends and every repaint the page makes afterwards
  come from the same code. A second implementation of the ordering would show
  up as the page quietly re-sorting itself the first time anything was tapped.

**Ticking from the page.** `POST /s/:token/tick` with `item_key`, `step` and
`status`. This is a public write, so:

- The job is resolved **from the token only**, never from the body.
- The server accepts a tick only if `item_key` is a row in **that job's
  published model** and `step` is one of that row's `steps`
  (`tickAllowedByModel()`, pure and shared with its test). Anything else is
  rejected. That is what stops the table being filled with junk.
- `completed_at` is the server's now, `source` is `link`.
- Same abuse limits as the Approve and Decline route on the client page: 20
  misses per IP, then a 10-minute lockout, in memory, cleared on restart.
- The page updates optimistically and **has no offline queue**. A tick that
  cannot be sent reverts and says "No signal, try again". The offline queue
  is the phone app's job.
- The page refetches ticks on focus and about every 30 seconds while visible.

**What anyone-with-the-link means.** The token is the only gate, so a
forwarded link lets whoever has it tick rows. The sheet has no prices or
client contact details, so the exposure is limited to progress state, but it
is worth knowing. Two safeguards follow from it: the app shows a small
"via link" marker on any step whose `source` is `link`, and Nicky can un-tick
anything in the app. Stop sharing revokes access at any time.

**Publishing.** While a job has a link, the phone republishes the model after
any edit that changes it: debounced (about 2 seconds), skipped when the
model's hash has not changed (the hash excludes ticks), and sent through the
same offline queue as other On Site writes. Hooked into `saveRooms()`,
`saveColours()`, `saveExtItems()`, `saveKitchenJob()`, `saveFittedUnitJob()`
and `saveCustomItems()` — the six writes the model reads from. Last write
wins and a PUT replaces the whole model, so retries are safe. Offline, the
page keeps showing the last published model and its own timestamp says how
old it is.

**The Share row** on the sheet: **Share PDF**, **Share link** (mints and
publishes on first use, then hands the URL to the share sheet), and **Stop
sharing** when a link exists.

Deleting the job deletes its sheet and ticks, through the same foreign-key
cascade `client_token`'s lines use. A duplicated job never inherits a live
link, and a restored one mints a fresh link on its next Share: the published
model is deliberately not exported, for the reason `client_token` isn't.

Server-side, the model's shape is validated and its size capped
(`normaliseSpecModel()` rebuilds it as a whitelist of plain strings, dropping
every key it does not know), and everything is escaped on render. The model is
data the page displays, never markup.

## Build order (as built)

1. `jobSpecModel()` with stable keys, the By Room and By Stage screens, the
   filter, prep lines and tags. Read-only, radiators show the woodwork colour.
2. Ticks: `spec_ticks`, the API, the offline queue, cleared-last ordering,
   folding, the On Site entry and its visibility states, refetch while open.
3. PDF export with the two-box layout.
4. Live link: token, publish, public page, the public tick route, polling,
   Stop sharing, the "via link" marker.
5. Radiator colour override on the room screen and `colourAreas()`, and the
   `roomColourSchedule()` change.

## Build notes

- One `jobSpecModel()` returning plain data (like `snagPdfModel()`). The
  screen, the PDF and the published live model all come from it, so they
  cannot disagree about a colour or a row.
- **Reuse, do not re-implement.** `colourAreas()`'s gates and
  `areaPlaceholder()` for areas, `effectiveRoleRange()` for the product per
  role, `colourScheduleLabel` for undecided colours, `scopeFacts()` for what a
  room's surfaces include, and the Snags sort, fold and PDF code for ordering,
  folding and the boxes.
- `scopeFacts()` is a **job-level union** by design (see its header comment).
  The sheet needs facts **per room**, so it is called with a single room, as
  `roomScopeSentence()` does.
- Stage order, prep wording and tag wording each live in one constant, so a
  change is a one-line edit.

## Verification

- `npm run test:spec` — 75 cases on the real `jobSpecModel()` and the real
  `lib/specSheet.js`: the rows a job produces and their order, papered
  surfaces and their single Done tick, Prep alone not clearing a row,
  cleared-last at row and group level in both views (feature wall still last
  within each band), fold defaults including "nothing open anywhere", key
  stability across a room rename, orphaned ticks ignored, the other-areas
  block, a refetch never swallowing a tick still in the offline queue, extra
  work inside a measured area being noted against the area and never as a row
  tag (the declined case included), and the public tick route rejecting keys
  and steps that are not in the published model.
- `npm run test:radiator` — the override's blast radius, in a real browser
  against the real `computeMaterials()`: **the tins do not move**, before or
  after switching it on and whichever colour it is switched to; the area
  appears only while it is on; `roomColourSchedule()` names the radiators and
  merges them with the woodwork where the colours match; the Colours tab
  renders the new area without erroring on a colour that covers no litres; and
  switching it back off restores every one of those exactly.
- Documented in `docs/user-manual/README.md` with fresh screenshots, PDF
  rebuilt, `FEATURES.md` updated, version bumped.

## Explicitly out of scope

- Editing colours, coats or prep from the sheet.
- Prices, quantities, tins, markup, site notes, client contact details.
- Snags (they keep their own list and PDF).
- Photos (dropped, see `SITE_NOTES_SPEC.md`).
- Editable prep wording (fixed built-in for now, by decision).
- Knowing who ticked beyond app or link.
- Ticking offline from the live page.
- A notification when someone ticks from the link.

## Open item (built on its default)

1. **Ticking a pending variation.** Pending variation rows can be ticked,
   tagged "awaiting approval" as the warning. Should ticking be blocked until
   approved instead? **Built as: allowed**, the stated default. One line to
   change if Nicky wants it blocked.
