# Bulk room edit — Spec (change one thing across every room)

**Status: BUILT 2026-08-27 (v2.39.2), extended the same day (v2.39.5).** UI, guardrail,
preview and apply. No schema change and no deploy step — nothing here touches the
database beyond the room rows the single-room form already writes.

v2.39.5 added a product picker for **every** material role rather than walls alone, the
room's **prep level**, and a second guardrail for **staircase/HSL rooms** (§2.4) that
also fixes a v2.39.2 bug.

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
| Wall paint | `wallRangeOverride` + `wallBandOverride` | All seven pickers reuse the room form's own search picker and band resolution |
| Ceiling paint | `ceilingRangeOverride` + `ceilingBandOverride` | |
| Woodwork topcoat | `topcoatRangeOverride` + `topcoatBandOverride` | |
| Woodwork primer | `primerRangeOverride` + `primerBandOverride`, `primerNone` | Offers **None** as well, for a self-priming topcoat |
| Mist coat paint | `mistRangeOverride` + `mistBandOverride` | |
| Feature wall paint | `featurewallRangeOverride` + `featurewallBandOverride` | Lowercase `featurewall`, matching `computeRoleGroups()` |
| Panelling paint | `panelRangeOverride` + `panelBandOverride` | |
| Wall coats | `wc` | 0–3, the same range the form's segs offer |
| Ceiling coats | `cc` | |
| Woodwork coats | `xc` | Skirting, sills and windows |
| Door coats | `doorCoats` | Doors are an independent line item with their own coat count |
| Frame coats | `frameCoats` | So are frames |
| Mist coat — walls | `mistWall` | |
| Mist coat — ceiling | `mistCeil` | |
| Prep level | `prepPct` + `prepCustom` | Minimal / Standard / Heavy / Custom %, the same scale `setPrep()` uses |

The seven product rows are generated from `BULK_PRODUCT_ROLES` by
`buildBulkProductRows()` rather than hand-copied — each is two rows of near-identical
markup, and the room form already has one such set to keep in step.

**Deliberately not offered:** panelling prep (`panelPrepPct`) and door/frame prep
(`doorFramePrepPct`). Both are separate scales on the room form, kept separate on
purpose, and neither is a whole-job decision the way the room's own prep is.

**Product is a pair, not a value.** A range override with no colour band is refused
here for exactly the reason `saveRoom()` refuses it: band sets the price *and* doubles
as the finish/sheen pick, so it is never guessed. The check runs over every one of the
seven roles and names the offending one. Bulk cannot write a combination the
single-room form would have rejected.

**There is no woodwork mist coat.** The panel offers walls and ceiling because those
are the only surfaces a mist coat is priced for anywhere in this app — `mistWall` /
`mistCeil`, `settings.rMist`, the `mist` material role. Adding a third would be new
schema and new pricing, which is a different piece of work.

**Kitchen and fitted units are not rooms.** They are per-job forms of their own, not
entries in the room list, so they are outside a room-list bulk action by construction.

## 2. Four rules

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
- **mist coat** — a mist coat is actually switched on (`mistWall`/`mistCeil`), *or* is
  being switched on by this same bulk run, so setting the mist toggle and the mist
  product together reaches a room that has neither yet
- **painted feature wall** — a measured feature wall in `paint` mode; in wallpaper mode
  `calcRoom()` zeroes its litres, so a paint product there would buy nothing
- **panelling** — at least one panelling row with a real width and height

No surface, no write. "Three coats of woodwork" must not invent woodwork in a room that
has none; that room shows as `N/A — no woodwork on this room` in the diff and is left
exactly as it was.

### A staircase room's labour is frozen, so labour fields are skipped

A staircase/HSL room's price is baked into `totalOverride` at save time by
`computeHSLOverrides()`; `calcRoom()` reads that figure and never re-derives the labour.
So writing `wc`/`cc`/`xc`, a mist toggle or `prepPct` there would move the room's
**litres and its Summary breakdown while leaving its price stale** — a half-applied
change, which is worse than none. Coats, mist and prep are therefore skipped on any room
with `totalOverride` set (or `isHSL`), and the diff says why: *"a staircase room's labour
is set on the staircase form"*. Change them there and the override is rebuilt correctly.

Product overrides are the exception and still apply: they only ever affect litres, on
the same code path a normal room uses, so there is nothing to go stale.

**This also fixes a v2.39.2 bug** — that release wrote coats and mist to staircase rooms
without the check.

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
range stores its band as `undefined`, not `''`, and primer **None** sets `primerNone`
while clearing both the range and the band rather than leaving a stale pair underneath,
so a bulk-edited room is byte-identical to a hand-edited one. Then `saveRooms()`,
exactly as the single-room form does.

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

- The bulk product fields ride the shared override picker under their own `bulk*`
  roles, so they inherit the search dropdown, the coverage-rate annotations and the
  band rules for free. They are not room roles and never reach a room object under
  those names — `BULK_PRODUCT_ROLES` maps each to the `target` prefix it writes.
  `editRoom()` and the fresh-form reset both replace `roomOverrides` wholesale
  (dropping the `bulk*` roles along with the exterior ones), which is harmless because
  `openBulkPanel()` re-seeds every one of them on each open.
- The bulk picker has no "back to the Settings default" option — the empty state means
  "leave every room's wall product alone", and one control cannot mean both.
- Bulk mode drops the swipe-to-delete wrapper from the room rows. A horizontal drag
  that deletes a room is the last thing you want while ticking through a list.
