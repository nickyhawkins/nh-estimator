# Estimating App — Edit Requests

## 1. Bug: Cannot delete all materials from summary — FIXED
Deleting materials from the summary page fails when trying to clear the entire list (removing the last remaining item, or all items at once, doesn't work as expected). Needs investigation and fix.

Root cause (reproduced with an automated two-browser-context test): initApp()'s
server sync only accepted the server's materials list when it was NON-empty, so
any browser context with a stale localStorage copy (a second device, or iOS
Safari vs the installed home-screen app — separate storage) resurrected the
deleted lines on screen and re-saved them to the server on the next edit. The
same guard existed for rooms/exterior items/colours. Fixed by treating a
successful server response as authoritative even when empty (matching what
loadActiveJobData() already did on every job switch); a FAILED fetch still
falls back to the local cache. The delete → re-render → reload path itself was
already sound via the materialsSeeded flag (2026-07-15 fix).

## 2. Editable markup on summary page
- Markup should be editable directly on the summary page, allowing a per-quote override.
- The default markup percentage should remain configurable in the Settings page.
- Changing markup on the summary page for one quote should NOT change the global default in Settings.
- The markup field should also work as a discount: allow negative values (e.g. -10%) to apply a discount instead of a markup, using the same field rather than a separate one.
- User should be able to choose whether the value entered is a % or a fixed £ amount (toggle between the two), applying to both positive (markup) and negative (discount) values.

## 3. Accepted job tracking
- Add ability to mark a quote as "Accepted" and convert/promote it into a tracked job.
- Reuse the existing quote materials list as the starting point for job management.
- Once colours/products are finalised, allow updating the materials list (products, quantities, costs) so it reflects real purchases.
- This running materials list should track actual spend against the original estimate, ready to inform final invoicing.
- **Manually added materials**: allow adding extra materials to a job's materials list beyond what's auto-calculated from Rooms/Exterior/Kitchen/Panelling (e.g. sundries, top-up tins, extra consumables bought on the day).
  - Each manually added item has a **"Chargeable" tickbox, defaulting to OFF**.
  - When OFF: item shows on the materials/shopping list for tracking purposes only — does NOT affect the job/quote total.
  - When ON: item's cost is added to the job's chargeable total, same as calculated items.
  - This keeps the existing calculated pricing logic (Rooms/Kitchen/Panelling) untouched — manually added items are purely additive and never alter or recalculate the existing price breakdown.
  - Goal: materials list works as a genuine shopping/usage list regardless of chargeable status, without complicating the underlying calculations.

## 4. Searchable materials dropdown — BUILT
- Replace the current long scrollable materials dropdown with a searchable/type-to-filter input.
- Should filter results as the user types, rather than requiring scrolling through the full list.
- Built everywhere it's used on site: room-form product overrides (all seven roles), the Kitchen range picker, and both Add Material pickers (Summary + Materials tracking) are search-as-you-type. Deliberately still plain selects: colour band pickers (short lists, explicit pick forced on purpose) and the Settings role-mapping dropdowns (set-once config, not an on-site surface).

## 5. Remaining balance disclaimer note
Add a note (with asterisk) below the remaining balance total on the summary/invoice view:

> *Material costs are estimated and may vary based on final colour and product selection. Any adjustments will be reflected in your final invoice. Significant changes in cost will always be discussed and agreed with you in advance.

## 6. Bug: Colour note/product tag clipping on mobile — FIXED
On the Colours page, the product note pill (e.g. brand/colour code, such as "Dulux Heritage · No. 1780058") overflows off the right edge of the card on mobile instead of wrapping or truncating cleanly. Needs responsive fix — either wrap onto a second line, shrink font, or truncate with ellipsis so it stays within the card bounds.
Fixed in renderColours(): the brand chip renders with min-width:0 / white-space:normal / word-break:break-word, so long pills wrap inside the card instead of spilling off the right edge.

## 7. Panelling quoting — BUILT
Panelling is a popular request and needs its own quoting option within a room:
- Input per wall as Width x Height (W×H).
- Ability to add multiple walls of panelling within the same room.
- Coat count needs to be specified per panelling item (often up to 4 coats depending on materials used) — separate from the room's standard coat settings.
- Panelling needs its own prep multiplier, independent of the room's overall prep level — it should NOT be affected by or included in the regular job prep multiplier.
- Panelling needs its own material/colour selector, separate from the rest of the room, since panelling is often finished in a different colour or product.

## 8. Kitchen Cabinet Spray Calculator — BUILT

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

## 9. Job status: Mark as Completed — BUILT
- Add ability to mark an accepted job as "Completed" from the Jobs list.
- Completed jobs should move to their own "Completed" section/heading, positioned above "Declined".
- Completed jobs should display greyed out with strikethrough text to visually distinguish them from active/accepted jobs.

## 10. Bug: Wallpaper roll calculation missing for feature wall only — FIXED
When a job includes wallpaper for a feature wall only (not the whole room), the roll calculation isn't showing/calculating. Needs fix so feature-wall-only wallpaper jobs still trigger the roll quantity calculation.

## 11. Wallpaper minimum price — BUILT
Wallpaper jobs should have a minimum price floor of £200 — if the calculated cost comes out below this, the quote should default to charging £200 instead.

## 12. Retain contact data locally before pushing to Xero — BUILT
- Contact data entered into the app (client name, address, phone, email etc.) should be saved and retained within the app itself, independent of Xero.
- This data should NOT be lost when switching between jobs — currently entered/in-progress contact details need to persist per job even if not yet sent to Xero.
- Add ability to manually push/sync saved contact data to Xero later, rather than requiring it to be entered directly in Xero or lost if the job is switched away from before syncing.
- When syncing, the saved address must populate Xero's **billing address** field, NOT the delivery address field.

## 13. Commercial wallpaper types: Wide Vinyl and Mural — BUILT

Add a "Wallpaper Type" selector to the wallpaper section: Standard Roll (existing calculation) / Wide Vinyl / Mural. Each type needs its own calculation logic — they don't fit the existing domestic roll-count model.

Wide Vinyl

Standard commercial vinyl width is 137cm (54"), versus ~53cm for standard domestic rolls — using the domestic roll-width assumption would badly under- or over-order material.
Input: wall Width × Height (area in m²) rather than linear roll metres — the sourced UK trade rate (below) prices wide vinyl per m² of wall area for supply & hang, so area-based input matches how it's actually priced and keeps this consistent with the Mural input method.
Small areas (0.5m² or under) are priced per item (Nr) rather than per m², reflecting a fixed minimum setup cost for small patches — the app should switch to a flat per-item rate below this threshold rather than scaling the m² rate down.
Material is heavier/stiffer to hang than standard paper — reflected in the higher £/m² rate below versus standard lining paper.

Mural (one-piece / digitally printed)

No roll or pattern-repeat calculation needed — it's printed to the exact wall dimensions.
Input: wall Width × Height only → calculates area in m².
Priced per m² (or as a flat one-off, if preferred) rather than by roll/linear metre.
No pattern-matching waste allowance needed, since it's printed to fit exactly.
Install time is typically closer to fixed per mural (a few hours) rather than scaling directly with size the way multi-drop pattern-matched paper does — worth a flatter labour model than linear-with-area.

Sourced pricing (from constructionrates.co.uk UK trade rate book — real data, not a placeholder)

Wide Vinyl — Supply & Hang, PC Sum £4.00/m² material:

Walls/columns, area over 0.5m²: £17.60/m² all-in (≈£13.60/m² labour once £4.00/m² material PC is stripped out)
Walls/columns, area 0.5m² or under: £12.90 per item (Nr) — priced per small section rather than per m², reflecting the fixed setup cost of a small patch
Ceilings/beams, area over 0.5m²: £18.90/m² all-in (≈£14.90/m² labour)
Ceilings/beams, area 0.5m² or under: £13.50 per item (Nr)
General surfaces of plasterboard (prep/sizing only, before hanging): £2.80/m²

For comparison — standard lining paper and woodchip prep rates from the same source, useful context for where wide vinyl sits relative to standard prep:

Medium grade lining paper, walls >0.5m²: £6.80/m² — woodchip: £7.90/m²
Medium grade lining paper, ceilings >0.5m²: £7.50/m² — woodchip: £8.50/m²
Lining paper material PC: £2.00 per standard roll

Decorative paper-backed vinyl wallpaper (standard domestic-style, supply & hang, PC £12.50/roll):

Plaster walls/columns over 300mm girth: £5.00/m²

These are generic UK trade book rates rather than Nicky's own pricing, so should be used as a sense-check/starting benchmark — Nicky's actual rate may sit above or below these depending on region, complexity, and material choice, but this replaces guesswork with a real published reference point.

Mural — still needs real data: No equivalent trade-book rate found for one-piece printed murals specifically (they're a newer product category than standard wallcovering, so most trade rate books don't cover them yet). Budget a largely fixed install time (e.g. 3–5 hours for a typical single feature wall mural) rather than scaling linearly with m², and get pricing from timing 1–2 real jobs.



## 14. Marking a quote Accepted/Declined also updates the quote in Xero — BUILT
- Marking a quote as Accepted (or Declined) in the app should also flag the quote as accepted/declined in Xero, instead of it needing to be updated in both places.
- Built: `POST /auth/update-quote-status` (routes/xero.js) reads the quote's current status from Xero and walks its status machine — Xero only reaches ACCEPTED/DECLINED via SENT, so a still-DRAFT quote gets the SENT hop written first; a quote already sent (or already at the target) skips it. INVOICED/DELETED quotes refuse with a clear error.
- The app stores the Xero quote ID on the job when "Send to Xero" creates the quote (`job.xeroQuoteId`; re-sending re-links to the newest quote). Mark Accepted/Declined then pushes the matching Xero status best-effort: the in-app status saves first and never blocks on Xero; a failed push alerts so it can be fixed in Xero by hand. Summary shows "Xero ✓" beside Accepted/Declined once the push lands. Move to Draft reverts a previously synced ACCEPTED/DECLINED back to SENT in Xero.
- Only quotes created after this shipped can sync (older jobs never stored a quote ID — mark those in Xero by hand).
- Verified against the real route with axios/db stubbed (per this repo's convention); not yet proven against live Xero — watch the first real acceptance.
