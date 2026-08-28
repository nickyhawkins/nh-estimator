# Colour handling redesign

Shipped v2.42.0. Placeholder-first colour labelling, consolidated materials
on the Summary and the quote, and the invoice's colour-for-band substitution
extended to both.

## The problem

Colour handling was two disconnected steps: measure a room and pick a
numbered colour per surface, then separately visit the Colours tab to put a
name to any number that didn't have one. That works across one room. Across
six it turns the Colours tab into a queue of "Colour 3 — which one was
that?", and colours are usually only settled *after* the measure, often after
the job is accepted, so "decide later" is the normal case rather than the
exception.

Separately, Summary and the generated quote listed materials as repeated,
un-consolidated lines — two identical "Tikkurila Optiva 5 – Colours 3ltr"
rows back to back with nothing to tell them apart — while the On Site tab had
always shown one row per product with a breakdown underneath.

## 1. Placeholder-first colour labelling

Colour NUMBERS are unchanged underneath. They are still what buckets litres
into tins (`computeRoleGroups`), what materials tracking joins on, and what
every saved job holds. Nothing about tin sizes or quantities moves, and there
is no migration. What changed is what a number READS as, and how one gets
named.

- An **area** is one painted surface of one room / exterior item / kitchen /
  fitted unit — the smallest thing that can carry its own colour. The list is
  derived from the rooms and exterior items every time it is asked for
  (`colourAreas()`), never stored, so it cannot drift from what is actually
  being painted. A surface with no coats on it is not an area.
- A colour with **no name of its own reads as the areas it covers**
  (`colourPlaceholderFor`): "Lounge Feature Wall". Two areas are both named;
  beyond that it counts ("Lounge Main Walls + 4 more"). A colour on no area
  at all falls back to "Colour N", the old last resort.
- Every area's colour is **one free-text field** — on the room, exterior,
  kitchen and fitted-unit screens, and again on the Colours tab. Its ghost
  text is that area's own placeholder. The colour-library autocomplete sits
  behind it exactly as it did on the old Colours tab, so brand and code still
  fill themselves in.
- **Quick-pick chips** under the field offer every other colour on the job,
  one tap each — the convenience path for a colour repeated across rooms.
  Typing the same name again does the same thing.

### What typing a name does (`applyAreaColourName`)

| Typed | Result |
| --- | --- |
| blank | undecided again — the colour goes back to reading as its area |
| a name already on this job (case-insensitive) | the area **joins** that colour, so both places share a tin |
| anything else, and this area is the only one on its colour | **renamed in place** |
| anything else, and the colour is shared | **forked** onto a new colour for this area alone |

The fork rule is the important one: naming the lounge's feature wall must
never silently rename the hall's walls. The field says so underneath while
the colour is shared. A fork that leaves an unnamed colour with no areas
prunes it (`pruneOrphanColour`); a named one is kept, because it may have
been entered ahead of the measure.

`ensureDefaultColour()` still seeds colour 1 as "White" on a NEW job — it is
the base every unset surface falls back to, and on most jobs the ceilings and
woodwork really are white. It no longer BACKFILLS a colour 1 left blank:
clearing the name means "not decided yet", and re-stamping "White" over that
took the decision back off the user.

### The Colours tab

No longer a stop in the flow. It is the job-wide read/edit view — **Colours
by area**, every painted surface room by room with the same field and a
Named / To decide marker, plus a "N of M named" count — over the existing
**What to buy** ordering roll-up (which colour covers what, and the litres
and tins to buy for it), which is unchanged.

## 2. Materials consolidation (Summary + quote)

`consolidateMaterialLines()` groups the snapshot the same way
`rollUpEstimateByItem()` does for On Site: by item code (or description, for
a free-text line) plus the chargeable flag, since a tracking-only line is not
on the client's bill and must never merge into one that is. Used by Summary,
the client quote model, the accepted-quote snapshot's flat lines and the Xero
quote, so no two of them can describe the same materials differently.

The per-area breakdown under each line (`materialPartsDetail`) is the exact
function On Site uses: "Bedroom Main Walls · 1 · Lounge Main Walls · 1".

**The snapshot lines are still the record.** Consolidation is a view over
them, and every edit made on a group is written back:

- **quantity** — spread across the member lines in proportion to what each
  currently holds, remainder onto the largest, so the split between colours
  stays what the calculation worked out while the total is exactly what was
  typed. A one-line group is the old direct edit, unchanged.
- **delete** — removes the product, every colour of it, under one undo.
- **reset**, **Tracking only**, **Reorder** — all act on the whole group;
  reorder keeps a group's lines adjacent in the array.

## 3. Colour name substitution in product lines

`describeWithColours()` (split out of `materialDescriptionWithColour`, which
invoices have used since v2.38.5) now also runs on the consolidated Summary
rows, the client quote, the accepted snapshot and the Xero quote. The colour
replaces the generic colour BAND in place — "Optiva 5 – Colours 3ltr" becomes
"Optiva 5 – Farrow & Ball No. 28 Dead Salmon 3ltr" — because the band is a
price band covering dozens of colours and is noise at best on a client's copy.
`itemCode` is never touched: it is the inventory item and pricing runs off it.

## Decisions on the open questions

**Shared colours across rooms → one merged line.** It falls out of the model
rather than needing a rule: two rooms in the same colour already share one
colour number, so they already pool into one estimate line and one entry in
the breakdown. The consolidated row is one product, one quantity, with the
areas listed under it.

**Unnamed colours at quote time → the generic band wording, and the areas
underneath.** All-or-nothing (`namedColourNames`): if ANY colour on a line is
still undecided, the whole line keeps its generic band. Naming only the
decided half would claim something untrue about the other tins, and printing
a placeholder would put a location where a colour goes and read like a
mistake on the client's copy. Nothing is lost — the breakdown under the line
names the areas either way. The colour schedule follows the same rule with
"To be confirmed" (`colourScheduleLabel`), for the same reason: on the
client's quote, "Lounge — Walls: Lounge Main Walls" is the row talking to
itself.

**Data migration → none needed.** Colour numbers, the `colours` table, room
and exterior fields and every snapshot line are untouched. An old job's
unnamed "Colour 2" simply starts reading as the areas it covers, which is the
improvement. Old jobs already carry `White` on colour 1 from the previous
backfill, so their labels and pooling are identical to before.

## Out of scope, and honoured

- No change to how tin sizes or quantities are calculated.
- No materials-usage adjustment feature.
- No change to markup or pricing logic — labelling and display only.
- The itemised materials list stays: product, tin size, quantity and price
  all still print. This was a consolidation and formatting change, not a
  removal.
