# Estimating App — Edit Requests

## 1. Bug: Cannot delete all materials from summary
Deleting materials from the summary page fails when trying to clear the entire list (removing the last remaining item, or all items at once, doesn't work as expected). Needs investigation and fix.

## 2. Editable markup on summary page
- Markup should be editable directly on the summary page, allowing a per-quote override.
- The default markup percentage should remain configurable in the Settings page.
- Changing markup on the summary page for one quote should NOT change the global default in Settings.

## 3. Accepted job tracking
- Add ability to mark a quote as "Accepted" and convert/promote it into a tracked job.
- Reuse the existing quote materials list as the starting point for job management.
- Once colours/products are finalised, allow updating the materials list (products, quantities, costs) so it reflects real purchases.
- This running materials list should track actual spend against the original estimate, ready to inform final invoicing.

## 4. Searchable materials dropdown
- Replace the current long scrollable materials dropdown with a searchable/type-to-filter input.
- Should filter results as the user types, rather than requiring scrolling through the full list.

## 5. Remaining balance disclaimer note
Add a note (with asterisk) below the remaining balance total on the summary/invoice view:

> *Material costs are estimated and may vary based on final colour and product selection. Any adjustments will be reflected in your final invoice. Significant changes in cost will always be discussed and agreed with you in advance.

## 6. Bug: Colour note/product tag clipping on mobile
On the Colours page, the product note pill (e.g. brand/colour code, such as "Dulux Heritage · No. 1780058") overflows off the right edge of the card on mobile instead of wrapping or truncating cleanly. Needs responsive fix — either wrap onto a second line, shrink font, or truncate with ellipsis so it stays within the card bounds.

## 7. Future feature: Panelling quoting
Panelling is a popular request and needs its own quoting option within a room:
- Input per wall as Width x Height (W×H).
- Ability to add multiple walls of panelling within the same room.
- Coat count needs to be specified per panelling item (often up to 4 coats depending on materials used) — separate from the room's standard coat settings.
- Panelling needs its own prep multiplier, independent of the room's overall prep level — it should NOT be affected by or included in the regular job prep multiplier.
- Panelling needs its own material/colour selector, separate from the rest of the room, since panelling is often finished in a different colour or product.

## 8. Future feature: Kitchen Cabinet Spray Calculator

**Structure**
- New dedicated "Kitchen" module/tab, separate from Rooms/Exterior/Panelling.
- Item types split into two input models:
  - **Unit-count items** (priced and entered per piece): Doors, Drawer Fronts, End Panels, Fillers, Glazed/Curved premium tier. Each broken into 4 size tiers: Small / Medium / Large / X-Large.
  - **Linear-run items** (priced and entered per linear metre, not per piece, matching how these are commonly quoted on the trade): Plinths, Cornices. Input is total run length in metres rather than a quantity count.

**Carcass spraying (separate scope from doors/drawers)**
- Carcasses (the fixed cabinet frames/interior faces that can't be removed) are a distinct add-on, not included in the door/drawer/end panel pricing above.
- Add a toggle: "Spray carcasses" (interior and/or exterior faces) as its own line item.
- Carcass spraying should be priced either per carcass/cabinet unit, or as a % uplift on the door/drawer total — needs deciding once base door/drawer pricing is finalised.
- Carcass spraying needs its own prep multiplier, since in-situ masking of a full kitchen (walls, floors, worktops, appliances) is more labour-intensive than prepping and spraying removed doors off the cabinet.

**Coats**
- Coat count is set once per job (whole kitchen), selectable 1–4 coats — not per item type.
- Each size tier within each item type has its own base price AND its own per-coat £ increment (e.g. a Small door might be £X base + £2/coat, a Large door £Y base + £4/coat). Increments are NOT uniform across tiers — need to be set individually.
- Total item price = base price (for selected size tier) + (coat count × per-coat increment for that tier).

**On-site input workflow**
- Tap an item type (e.g. "Doors").
- Enter exact quantity for each size (Small/Medium/Large/X-Large) within that item type.
- App auto-calculates total cost per item type and rolls up into the kitchen job total.
- Coat count is set once at the kitchen/job level and applies across all item types and sizes.

**Still to be defined**
- Actual £ base prices and per-coat increments for each item type × size tier (pricing research needs to be redone from scratch, no prior data retained).
- Whether glazed/curved items get their own size tiers or a flat premium multiplier on top of standard tiers.

**Draft v1 pricing (based on UK market research, needs Nicky's review/adjustment before use)**

Base price = prep + 1st coat. Per-coat figure = £ added for each additional coat (2nd, 3rd, 4th).

Unit-count items (priced per piece):

| Item Type | Small (base/+coat) | Medium | Large | X-Large |
|---|---|---|---|---|
| Doors | £45 / £8 | £60 / £10 | £80 / £13 | £100 / £16 |
| Drawer Fronts | £20 / £4 | £28 / £5 | £35 / £6 | £45 / £8 |
| End Panels | £40 / £7 | £55 / £9 | £75 / £12 | £95 / £15 |
| Fillers | £10 / £2 | £15 / £3 | £20 / £4 | £25 / £5 |
| Glazed/Curved | +50% surcharge on base price of the matching item/size tier (extra masking and edge prep) |

Linear-run items (priced per metre, not per piece):

| Item Type | £ per metre (base/+per coat) |
|---|---|
| Cornices | £25 / £4 per metre |
| Plinths | £18 / £3 per metre |

Carcass spraying (separate add-on, not per door/drawer):
- Simplest approach, recommended: flat % uplift on the door/drawer/end panel subtotal (suggested starting point 25–35%, to be tuned against Nicky's own rates). No extra counting or measuring needed on-site — just a toggle plus a percentage.

Notes on the draft:
- Market rates for a standard door respray commonly sit around £60–£100 per door, with larder/oversized doors at the top end — used as the basis for the Medium/Large/X-Large door tiers.
- Drawer fronts are typically priced lower than doors — reflected as roughly 45–60% of the equivalent door tier.
- Plinths and cornices are commonly quoted as a lump sum per run rather than per-piece — the per-metre figures above are a starting estimate and should be checked against Nicky's own typical run lengths.
- These numbers do NOT include VAT, travel, or job-level prep multiplier — they're per-item/per-metre spray costs only. Carcass spraying is priced entirely separately and excluded from the door/drawer/panel totals.
