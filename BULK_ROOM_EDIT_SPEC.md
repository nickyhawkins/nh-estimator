# Bulk room edit — Spec (change one thing across every room)

**Status: BUILT 2026-08-27 (v2.39.2).** UI, guardrail, preview and apply. No schema
change and no deploy step — nothing here touches the database beyond the room rows the
single-room form already writes.

---

## The problem

Rooms are edited one at a time, which is right almost always. It stops being right at
the end of building a quote, when the decision that has just been made applies to the
whole house: the client picked a different wall paint, or the walls are bare plaster
and every room needs a mist coat, or the spec moved to three coats throughout. That is
one decision and ten to twenty identical form visits, each one a chance to miss a room
and not notice until the materials list looks wrong.

## The fix

A **Bulk edit** toggle on the Measure screen's Interior header. Rooms grow checkboxes,
a select-all bar appears, and picking rooms opens a panel of the handful of fields
worth batching. You review a per-room diff and confirm before anything is written.

Deliberately narrow. This is not a second room editor — it is the three or four fields
that genuinely move together across a whole job.

---

## 1. What it can set

| Field | Room key(s) | Notes |
| --- | --- | --- |
| Wall paint product | `wallRangeOverride` + `wallBandOverride` | Reuses the room form's own search picker and band resolution |
| Wall coats | `wc` | 0–3, the same range the form's segs offer |
| Ceiling coats | `cc` | |
| Woodwork coats | `xc` | Skirting, sills and windows |
| Door coats | `doorCoats` | Doors are an independent line item with their own coat count |
| Frame coats | `frameCoats` | So are frames |
| Mist coat — walls | `mistWall` | |
| Mist coat — ceiling | `mistCeil` | |

**Product is a pair, not a value.** A range override with no colour band is refused
here for exactly the reason `saveRoom()` refuses it: band sets the price *and* doubles
as the finish/sheen pick, so it is never guessed. Bulk cannot write a combination the
single-room form would have rejected.

**There is no woodwork mist coat.** The panel offers walls and ceiling because those
are the only surfaces a mist coat is priced for anywhere in this app — `mistWall` /
`mistCeil`, `settings.rMist`, the `mist` material role. Adding a third would be new
schema and new pricing, which is a different piece of work.

**Kitchen and fitted units are not rooms.** They are per-job forms of their own, not
entries in the room list, so they are outside a room-list bulk action by construction.

## 2. Three rules

### Every field defaults to "No change"

A field left alone does not touch that value on any room. A blank coat box is absent
from the change set entirely — it is never read as a 0. Only what is actively set gets
written, and the panel opens blank every time: nothing is remembered between runs, mist
coat least of all, because a remembered tick would land on a set of rooms it was never
chosen for.

### A surface a room hasn't got is skipped, never created

`bulkSurfacesOf()` is the guardrail. It asks whether a room *has* each surface on
exactly the basis `calcRoom()` prices it:

- **walls** — `calcRoom().wallArea > 0`, or a measured feature wall (which can exist
  with no general wall area behind it, and falls back to the room's wall product)
- **ceiling** — `calcRoom().ceilArea > 0`
- **woodwork** — `calcRoom()`'s own woodwork paint basis: skirting run + sills +
  windows, or `woodAreaOverride` outright for staircase/HSL rooms
- **doors** / **frames** — their own quantities

No surface, no write. "Three coats of woodwork" must not invent woodwork in a room that
has none; that room shows as `N/A — no woodwork on this room` in the diff and is left
exactly as it was.

### Mist coat is additive only

Ticking a surface turns its mist coat **on** where it is off. Leaving a surface
unticked never turns an existing mist coat off — the panel is "add this", not "set all
rooms to this". Coats are the opposite and say so on the form: an exact count, not an
increase.

## 3. Preview and confirm

Nothing is written until Apply. The review sheet lists **every selected room**, changed
or not — silently dropping a room you ticked is the one thing a confirm step must not
do. Each changing field reads `old value → new value`; each skipped field gets its own
`N/A` line naming the surface the room hasn't got; a room with nothing to do reads
`Unaffected`. Back returns to the panel with every field still set and no room touched.

The diff and the apply are built from the same `bulkBuildDiff()` result, so what is
shown and what lands cannot drift apart.

## 4. Apply

Writes the same keys `buildRoomFromForm()` writes, in the same shapes — an unbanded
range stores `wallBandOverride` as `undefined`, not `''`, so a bulk-edited room is
byte-identical to a hand-edited one. Then `saveRooms()`, exactly as the single-room
form does.

There is **no new schema, no "bulk applied" marker and no lock**. After applying, rooms
are fully editable one-by-one exactly as before, with nothing carried over from having
been bulk-edited.

## 5. Accepted quotes

**Not restricted** (confirmed with Nicky 2026-08-27). This matches the rest of the
editing surface rather than inventing a rule for bulk alone: the room inputs already
stay live on an accepted job — that is how one gets amended into a revision — and the
agreed figures are protected by the `quote_snapshots` freeze, not by locking the
editor. See `ACCEPTED_SNAPSHOT_SPEC.md`, "Inputs stay separate and unchanged".

## 6. Notes for later

- The bulk wall-product field rides the shared override picker under its own
  `bulkwall` role, so it inherits the search dropdown, the coverage-rate annotations
  and the band rules for free. It is not a room role and never reaches a room object
  under that name. `editRoom()` and the fresh-form reset both replace `roomOverrides`
  wholesale (dropping `bulkwall` along with the exterior roles), which is harmless
  because `openBulkPanel()` re-seeds it on every open.
- The bulk picker has no "back to the Settings default" option — the empty state means
  "leave every room's wall product alone", and one control cannot mean both.
- Bulk mode drops the swipe-to-delete wrapper from the room rows. A horizontal drag
  that deletes a room is the last thing you want while ticking through a list.
