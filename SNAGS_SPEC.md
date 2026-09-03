# Snags — the job's punch list (v2.50.0)

A per-job snag list on the On Site tab. Snags are grouped by room, entered
one at a time or pasted in bulk, sequenced by phase, and synced offline like
the rest of On Site.

Shipped in v2.50.0. This document is the spec as built, including the calls
made on the two questions the handoff brief left open.

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
list**. On site the value of a cleared snag is the evidence it was cleared,
and a row that vanishes takes that with it. The date it was cleared shows
under the description. Un-ticking reverses both.

Each row carries its phase as an inline dropdown, so re-sequencing after a
paste import is one tap per snag rather than opening an editor. `✎` opens a
full editor (description, room, phase); `✕` deletes with a confirm.

**Colours.** Where a snag's `room_label` matches one of the job's real areas,
that area's recorded colours show beside the room heading — read-only, pulled
from the Colours data, which is still the only place they can be edited.
Custom-labelled groups show nothing.

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
