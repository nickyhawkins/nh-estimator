# Snags — the job's punch list (v2.50.0, colours v2.51.0, per-surface v2.52.0, cleared-last + PDF v2.58.0)

A per-job snag list on the On Site tab. Snags are grouped by room, entered
one at a time or pasted in bulk, sequenced by phase, and synced offline like
the rest of On Site.

Shipped in v2.50.0, with snag-room colours following in v2.51.0 and per-surface
colours in v2.52.0. This document is the spec as built, including the calls made
on the two questions the handoff brief left open.

---

## Why it exists

The end of a job is a list of small things: a scuff by the switch, a handle
to refit, a staircase that needs one more coat. That list arrives by text,
by email, or on a walk round with the client, and until now it lived in the
site-notes box or on a phone's notes app — where it can't be ticked off, can't
be ordered into a sensible working sequence, and doesn't survive the job.

Snags are job data captured on site, on patchy signal, exactly like material
actuals and the labour log. They get the same treatment: their own table,
one row per write, no bulk replace, and the offline queue behind every edit.

## Data model

`snags` (see `db/setup.sql` for the full commentary):

| column | notes |
| --- | --- |
| `id` | client-generated, the row's identity |
| `job_id` | job-scoped, no FK (same as every other job child table but `job_variations`) |
| `room_label` | **text, no foreign key to `rooms`** |
| `description` | the snag |
| `status` | `open` \| `done` |
| `phase` | `prep` \| `stain_block` \| `woodwork` \| `walls` \| `ceiling` \| `details` \| `final_access`, or `''` |
| `sort_order` | **entry** order within a room; the tiebreaker under phase order |
| `created_at` | |
| `completed_at` | nullable; set when ticked, cleared when un-ticked |
| `updated_at` | |

**`room_label` has no foreign key, and that is the point.** A snag can belong
to a space that was never a priced room — an airing cupboard, a garage step,
a bit of hall the quote folded into the landing. A list that could only name
rooms the estimate happened to contain would send those snags nowhere. The
label is matched case-insensitively against the job's room / exterior item /
kitchen / fitted-unit names for grouping and for showing that room's colours;
a label that matches nothing is simply a custom group with no colours to show.

A consequence worth stating: renaming a room does not move its snags. That is
correct — the snag was written about a place on site, not about a row in the
`rooms` table.

Columns rather than a `data JSONB` blob, for the same reason as
`material_actuals`: `status`, `phase` and `room_label` are all queried
(grouped, counted, ordered), and the count of *open* snags decides whether
the section renders at all.

The table is created lazily on first use (`ensureSnagSchema()` in
`routes/api.js`), like `quote_snapshots` and `job_variations` — `db/setup.sql`
is not run on deploy. No migration step is needed.

## API

```
GET    /api/snags?job_id=X     every snag for the job
PUT    /api/snags/:id          upsert one snag (id is the identity)
DELETE /api/snags/:id          remove one snag
```

One row per PUT, one row per DELETE, and **no collection-level replace-all** —
the same rule as `material_actuals` and `labour_log`, for the same reason:
this is history that regenerates from nothing, so a failure part-way through
a bulk rewrite would destroy it. A bulk paste of forty snags is forty PUTs,
which is what makes each one queue and replay independently when there's no
signal.

Unlike actuals (`job_id, item_code`) and labour (`job_id, work_date`), there
is **no natural key** to upsert on: two snags in one room can legitimately
read exactly the same ("touch in the corner", two different corners). The
client's row id is the identity and `ON CONFLICT` targets the primary key.

`completed_at` is derived from `status` server-side rather than trusted from
the body — "done" with no date, or a date left behind on a row ticked back to
open, are both states the UI would then have to explain. The client may send
its own stamp (it ticks offline, and the moment it was ticked is what the
record should say, not the moment the queue flushed); an unparseable or
missing one falls back to now.

`phase` and `status` are validated against their allowed sets. An unknown
phase would sort nowhere and quietly float to the bottom of a room group, so
it is coerced to `''` rather than stored.

Snags are included in **backup export/import** (`jobs[].snags`, additive on
the v1 shape — a restore that brought back a job's rooms but not the list of
what was still wrong in them would lose the only record of it) and are
deleted with `DELETE /jobs/:id` and `DELETE /all`. They are **not** copied by
`POST /jobs/:id/duplicate`, like actuals and the labour log: a template copy
is a fresh draft, and inheriting another house's snags would be worse than
useless.

## The On Site section

**Visibility is conditional, in three states.**

1. **No snags at all** — no section. Most of a job's run there is nothing to
   clear, and a permanently empty card on the busiest screen in the app is
   clutter. A quiet `+ Start a snag list` link at the bottom of the screen is
   the way in.
2. **Something still open** — the section renders **above the materials
   section**, immediately under the job header. Heading is `Snags (n)` where
   *n* is the count of **open** snags.
3. **Everything done** — treated as case 1 for prominence. The section drops
   to a single collapsed `All n cleared ✓` card at the bottom of the screen,
   expandable to the full struck-through list.

**Rows.** Each snag is a checkbox row. Ticking sets `status = done`, stamps
`completed_at`, strikes the row through and dims it — but **leaves it in the
list**, at the bottom of its group (see **Ordering**). On site the value of a
cleared snag is the evidence it was cleared, and a row that vanishes takes that
with it. The date it was cleared shows under the description. Un-ticking
reverses both, and puts the row straight back where it was.

Each row carries its phase as an inline dropdown, so re-sequencing after a
paste import is one tap per snag rather than opening an editor. `✎` opens a
full editor (description, room, phase); `✕` deletes with a confirm.

**Colours.** Where a snag's `room_label` matches one of the job's real areas,
that area's recorded colours show beside the room heading — read-only, pulled
from the Colours data, which is still the only place they can be edited.

Where it matches nothing — a custom label, or *every* group on a job with no
measured rooms at all — the heading carries a tappable `+ colour` chip
instead. See **Snag-room colours** below.

A room is rarely one colour, and the heading says so: walls, ceiling,
woodwork, feature wall and panelling each appear with their surface named when
they differ ("Walls Dead Salmon · Ceiling All White · Woodwork Wimborne
White"), and collapse to the bare name only when the room genuinely is one
colour throughout. **Collapsing requires every surface to be named**, not just
the named ones to match — the earlier rule printed "Study — Card Room Green" on
a room whose ceiling and woodwork nobody had chosen yet, which says the ceiling
is Card Room Green.

The colour line is deliberately **not** `roomColourSchedule()` /
`colourLabelFor()`. Those spell a colour out in full ("Farrow & Ball No. 28
Dead Salmon") because they print on documents the client reads; three of
those on one heading buries the snags underneath. On site the name alone is
what gets said out loud, so that is all this shows — "Master Bedroom — Dead
Salmon", or "Walls Dead Salmon · Ceiling All White · Woodwork Wimborne White"
where the surfaces differ. An undecided colour shows nothing at all rather
than "To be confirmed", which on a working list is noise.

## Adding snags

Both paths live behind `+ Add snag`, in a bottom sheet with a
**One snag / Paste a list** toggle.

**One snag.** Room dropdown of the job's areas plus `Custom…`, which reveals
a free-text field; description; optional phase. The sheet stays open on the
same room after each add — snags come in runs, and closing after each one
would mean reopening it four times for one wall.

**Paste a list.** A textarea, then a preview you have to confirm.

The parser:

- A line on its own is a **room heading**. Markdown heading marks, bold
  markers and a trailing colon are stripped as decoration.
- A line starting `-`, `*`, `•`, an en/em dash, or `1.` / `1)` is an **item**
  under the current heading, with an optional `[ ]` / `[x]` checkbox.
  Numbered items count because a ten-item numbered list read as ten room
  headings would be a uselessly bad parse.
- Blank lines are ignored.
- **Checked items import as `open`.** In a list someone has emailed over, a
  tick means "I've flagged this", not "this has been fixed on your job" —
  importing them as done would silently hide work.
- **A heading with nothing under it is kept, not dropped.** An empty group is
  precisely the stray-sentence mis-parse the preview exists to catch, and a
  line that vanished between the paste and the preview is a line nobody gets
  the chance to fix. The import is blocked until each one is either folded
  into the room above (`↑ item`) or dismissed (`✕`).

The preview is fully editable: room names (with type-ahead over the job's own
areas), item text, per-item phase, delete item, delete group, and `↑ item` to
demote a mis-parsed heading into the previous room. Nothing is written until
`Add n snags` is tapped.

On commit, a room label that matches a job area case-insensitively is stored
with the **job's** spelling, so the heading, the colour lookup and the room
dropdown all agree from then on. Everything else is stored as typed.

**No phase is guessed from wording, ever.** Snag phrasing varies far too much
across the people who write these lists ("scuff by the switch" could be
walls, details or prep depending on the house), and a wrong auto-tag silently
reorders someone's working day. Pasted items arrive with no phase and are
assigned by hand in the preview.

## Snag-room colours (v2.51.0)

A job imported from Xero and priced outside the app has no rooms, no exterior
items, no kitchen and no fitted units. Every colour in this app hangs off one
of those four carriers — `setAreaColourNumber()` writes to a room record, and
the Colours tab builds its area list by walking the same four — so such a job
had nothing to hang a colour on, its Colours tab said "Measure a room…", and
every snag heading on it read blank. The snag list was usable; the colour half
of it was not.

`snag_rooms` is the missing carrier and nothing more: one row per snag room
label per job, holding a colour **number** (never a second copy of a name),
unique on `(job_id, lower(room_label))` so the label is the identity and one
room can't end up with two colours.

```
GET    /api/snag-rooms?job_id=X
PUT    /api/snag-rooms/:id        upsert on (job_id, lower(room_label))
DELETE /api/snag-rooms/:id
```

The PUT upserts on the **label**, not the row id: the client mints a fresh
`uid()` the first time it colours a room, and must not create a second row for
a label another device already coloured. It reports the id that actually holds
the row, the same id-adoption contract `/actuals` and `/labour` use.

**A snag room is coloured by exactly the same machinery as everything else.**
A room that has been given a colour joins `colourAreas()` as an area with
`ref: {kind:'snag'}`, so it appears in the Colours tab's "Colours by area" list
beside real rooms (marked *from the snag list*, so it doesn't read as a room
somebody forgot to price), `applyAreaColourName()`'s rename-vs-fork rule
applies to it, and the colour library fills in brand and code. There is no
second colour vocabulary.

**Precedence.** A label that matches a measured area never gets a row here —
that room already has a carrier and the Colours tab already owns its colour, so
a row would be a second answer to one question. `snagGroupColour()` checks for
a measured area first and only falls through to the carrier when there isn't
one.

**Undecided is genuinely colourless, not colour 1.** This is the one place a
snag room deliberately departs from how a measured room behaves. Colour 1 is
seeded `"White"` on purpose (see `ensureDefaultColour`) because a measured
room's ceilings and woodwork usually are white — that is a decision, not a
guess. A snag-list heading makes no such claim: it exists because somebody
wrote a snag against a room name. So an uncoloured snag room resolves to
`null`, reads as blank, and is **excluded from `colourAreas()`** — otherwise it
would claim colour 1, be counted towards colour 1's usage in the
rename-vs-fork rule, and print "White" beside a room nobody had said anything
about. Uncoloured rooms are offered for naming by their own card on the Colours
tab ("Snag rooms — no colour yet") instead, which renders only when there are
some.

For the same reason, naming a colour on an *undecided* room never routes
through `applyAreaColourName(1, …)`: passing colour 1 as the current would let
it rename the job's default colour out from under every surface that really
does use it. It reuses a colour already carrying that name, or mints one.

### One colour, or one per surface

A measured room has always carried a colour per surface. An unmeasured one had
exactly one, which made it the only kind of room in the app that could not say
"walls Dead Salmon, ceiling All White". So a `snag_rooms` row is now one
**(room, role)** pair:

- `all` — one colour for the whole room. The default, the common case, and what
  every row written before per-surface colours existed means, so old data
  migrates by standing still.
- `wall` · `ceiling` · `woodwork` · `featurewall` · `panel` — the **same role
  keys a measured room uses**. That is what lets these rows drop into
  `colourAreas()` as ordinary areas: `areaPlaceholder()`/`AREA_ROLE_WORDS` name
  them ("Hallway Ceiling"), the Colours tab renders them with no special case,
  and the rename-vs-fork rule counts them.

The two are **exclusive**: writing a whole-room colour clears the surfaces and
vice versa, because a room that is both "all Dead Salmon" and "ceiling All
White" has no single true heading. The client enforces it on write
(`setSnagRoomColour`); should both ever coexist anyway — a stale offline write,
a hand-edited row — the display has a defined precedence rather than undefined
behaviour: **surfaces win over `all`**.

Per-surface entry always prints the surface names, even where they happen to
match. Someone who filled the surfaces in separately is telling you they
differ, and collapsing "Walls Dead Salmon · Ceiling Dead Salmon" to one name
would throw away the only thing they took the trouble to say. One colour for
the whole room is what the "Whole room" field is for.

The sheet opens on whichever mode the room is already in, so a per-surface room
never greets you with a single field that would wipe its surfaces. Switching
mode only changes what is *shown* — nothing is cleared until a colour is
actually written — so tapping across to look costs nothing. **Clear colour**
wipes every role at once, pruning after all of them are cleared rather than as
it goes (two surfaces can share a colour, and pruning on the first would still
see the second holding it).

The sheet is refused outright for a label that matches a measured room: that
room has a carrier already and the heading would ignore anything written here.

**The sheet uses the app's ordinary colour field**, not one of its own:
`colourSlotHtml()` / `registerColourSlot()`, the same widget behind every area
field on the room, exterior, kitchen and Colours screens. So a snag room gets
the colour-library lookup as you type (matching on name *and* code, so RAL
numbers stay findable), the brand and code filled in from the library entry
rather than guessed, one-tap chips for colours already on the job, the
save-an-unknown-name-to-the-library flow, and commit-on-blur with no Save
button — all of it for free, and none of it able to drift from the rest of the
app. The only additions are a **Clear colour** button (a measured area can't be
undecided once it exists, so no other slot needs one) and the undecided
carve-out above.

Both entry points — the `+ colour` chip on an On Site heading and the Colours
tab card — open the same sheet, so there is one way to colour a snag room.
Snag-room colours are in backup export/import, are deleted with the job and by
Clear Everything, and are not copied by job duplicate (they travel with the
snags).

## Ordering

Display order within a room is **phase order** — the list above, prep first,
`final_access` last — with `sort_order` (entry/paste order) as the tiebreaker
underneath, and the row id under that so the sort is total.

`details` covers small hardware and edge work (handles, door edges);
`final_access` covers anything that blocks movement through the space once
it's been done (floor cleans, staircase recoats), which is why it sorts last.

**Un-phased snags sort first, not last.** They are the ones still needing a
decision, and burying them under a sequenced list is how they stay
un-sequenced. It also keeps the rule that `final_access` is genuinely the
last thing in a room.

`sort_order` stays **entry** order in the database rather than being
recomputed from phase on every change: it is what makes a pasted list keep
the order it was pasted in until phases are assigned, and what keeps two
same-phase snags from shuffling against each other on every render.

### Cleared last (v2.58.0)

Above phase, and above everything else, sits one more key: **a cleared snag
sorts below every open one**. It still stays in the list — the evidence it was
dealt with is the whole reason a done row is kept — it just stops sitting in
the middle of the outstanding work. Three weeks into a job with thirty rows
ticked off, the handful still open were scattered through them and the screen
had to be read rather than glanced at.

The rule is applied at both levels, in **both views**, and nothing else about
the order changes — within the open band and within the cleared band, phase and
entry order are exactly what they were before:

- **Rows.** `snagSorted()` (room view) and the per-phase sort (phase view)
  compare `done` first, then phase, then `sort_order`, then id.
- **Groups.** A room with nothing left open sinks below every room that still
  has work in it, house order preserved within each band. A phase with nothing
  left open does the same, phase sequence preserved within each band — the
  point of the batching view is what there is still to batch.

Un-ticking is the exact inverse: the row is open again, so it sorts back to
where it was, and a room re-joins the live band. No state is stored for any of
this — it is one comparison key, derived from `status`.

## Export to PDF (v2.58.0)

`PDF` beside `+ Add snag` (and `Export PDF` under the reopened list once
everything is cleared) builds the punch list as a real PDF and hands it to the
OS share sheet, falling back to a download on desktop — the same three-visible-
outcomes flow as `saveQuotePdf()`, and the same hand-rolled writer
(`pdfDoc()` / `pdfSerialise()`), so it needs no library and works with no
signal. Filename: `NH-Snags-<Job>-<yyyy-mm-dd>.pdf`.

Unlike the quote's, the file is **dated by the day it was exported**. A quote
PDF is dated by the agreement so re-saving one accepted quote twice can't
produce two differently-named files of identical content; a snag list is a
snapshot of a moving list, so two exports a week apart *should* be two files.

**It renders the in-memory list and deliberately does not re-fetch first.**
`snags` is the freshest copy there is: it carries every tick made on this
phone including the ones still sitting in the offline queue, and a GET at that
moment would replace those with the server's older answer. "Up to date" on a
snag list means "including the one I ticked thirty seconds ago in a cellar",
which is exactly the tick a re-fetch would lose.

Layout: the quote's header band (business name, logo), then job / client /
address / date, then the counts spelled out ("3 outstanding · 5 cleared"),
then the **room-grouped view in the order the screen is showing it** —
cleared rows at the bottom of their room, cleared rooms at the bottom of the
list. Each room heading carries its colour line, exactly as
`snagGroupColour()` gives it to the screen; each snag carries its phase in a
right-hand column, an outlined box if it's open and a filled one if it's
cleared, with a rule drawn through the text and the cleared date underneath.
Boxes rather than a `✓`: the standard-14 WinAnsi fonts have no tick glyph
(`pdfSanitise()` drops it), and filled-vs-outlined survives a photocopy.

The phase view is not offered as a second document. One export, matching the
working view, is what makes the file checkable against the screen.

### A shared bug this shook out

`pdfSanitise()` was not idempotent, and every layout in the file calls it
twice — once to measure and wrap a string, then again on each wrapped line
inside `d.text()`. The codes `PDF_UNI` maps to (`\x97` em dash, `\x85`
ellipsis, `\x93`/`\x94` smart quotes) all sit below `0xA1`, so the second
pass dropped them: "Hallway — Card Room Green" printed as "Hallway Card Room
Green". It now passes through exactly the `PDF_EXTRA` codes, which are by
construction the ones the mapper emits and the widths table knows. **This
fixes the client quote PDF too**, where em dashes had been quietly vanishing
since it was written.

### Open question, resolved: the flatten toggle

The brief left this open — room-grouped only, or also a phase-grouped view
across the whole house. **Both shipped**, as a two-button segmented control
under the section heading:

- **By room** (default, and the working view) — the spec's room-grouped view
  with phase ordering inside each room.
- **By phase** — every snag in the house at the same phase, together, each
  row labelled with the room it's in. This is the batching view: get the
  stain block out once and do every stain-block job in the building.

The toggle is per visit, not stored. Room-grouped is what the screen opens on
every time.

## Sync

Every write goes through `apiPutStrict` / `apiDeleteStrict` — the same
helpers material actuals use. A **network** failure queues the write in the
offline queue (persisted in localStorage, replayed in order on reconnect) and
reports success; a reachable server that **rejects** a write still throws and
alerts. The sync dot and the "n changes queued on this phone" line in the
menu already cover snags with no extra work, since they count the same queue.

There is no localStorage mirror of the snag list itself, by design — same as
actuals and the labour log. Snags load on `openActuals()` and on every job
switch, and are cleared on a job switch so another house's punch list can
never appear on this job's screen.

## Out of scope for this build

- **Photo attachments on snag items** — revisit alongside the still-undecided
  site-photos feature.
- **A snag count on the On Site nav badge** — that badge is the outstanding
  *materials* count and is load-bearing for the shopping run; overloading it
  with a second meaning would make it mean neither.
