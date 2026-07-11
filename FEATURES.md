# NH Estimator — Feature Roadmap

This document captures planned features for the NH Estimator app, scoped and ready to build. Work through phases in order — each is independently useful and testable.

## Architecture reminder

- **Frontend:** `public/index.html` — single-file vanilla JS app
- **Backend:** `routes/xero.js` (OAuth + quote/contact/item endpoints), `routes/api.js` (rooms, exterior items, settings, HSL)
- **Database:** PostgreSQL on Render (rooms, exterior_items, settings, hsl_state tables)
- **Deploy:** push to GitHub `main` → Render auto-deploys
- **Xero:** connected with `accounting.contacts`, `accounting.settings.read`, `accounting.invoices` scopes

## Key gotchas learned during the build

- **Duplicate functions:** the app has had repeated bugs where an old version of a function survived alongside a new one, with the later definition silently overriding the earlier. When something doesn't behave as expected, grep for duplicate `function X` definitions first.
- **extItems vs old extCost:** exterior items use the `extItems` array + `calcExtItem()`, loaded from `/api/extitems`. Old code used `extCost`/`extTime` globals — make sure any new code (Xero quote, CSV) reads from `extItems`, not the old globals.
- **Data sync:** rooms and exterior items load from the server into memory on init. Render functions should read from the in-memory arrays. Avoid reintroducing localStorage as a competing source of truth.
- **Whole-tin rounding must happen at job level**, not per room, or multi-room jobs over-count tins.

---

## FEATURE: Automatic materials from Xero Items

Pull paint products from the user's Xero account, calculate quantities from the litres already computed per surface, cost them, and place them on the quote as real Xero line items. Feeds the job total and the deposit calculation.

### Xero data structure (confirmed)
- Items are quoted from the **sales account 202** using SalesUnitPrice (202 = sales/what the customer is charged; 311 = purchases/cost account, NOT used for quoting)
- Item example: code `DUL234`, name `Dulux Heritage Velvet Matt Tinted - Tinted 2.5L`, price £40.49 excl tax, No VAT
- **Tin size is in the item name** (e.g. `2.5L`, `5L`, `10L`) — parseable by regex
- Every product has all its tin sizes available as separate items in Xero
- Ceiling and woodwork paints also exist as **per-litre** line items in Xero

### Pricing model (how the user actually quotes)
- **Walls** — charged per tin. Buy/charge by whole tins.
- **Ceiling** — charged per litre. Standard product across jobs.
- **Woodwork topcoat** — charged per litre. Standard, but finish can change on request.
- **Woodwork primer** — charged per litre. Primer volume = topcoat volume × 0.8 (20% less).
- Quote layout: itemised labour sections → materials line break → materials list.

> **NOTE: The detailed materials build is specced in `MATERIALS_SPEC.md`, which SUPERSEDES the old Phase 1/2/3 split that used to live here.** That doc is the authoritative source: range → band → size grouping, supplier-agnostic parsing, per-room colour numbering + product overrides (all four roles, primer "None"), the fifth "mist coat" product, tin optimisation, and the Colours-tab-as-ordering-view. The summary below is kept only as high-level context.

High level: select default products by RANGE (not specific tin) for five roles — wall (per tin), ceiling, woodwork topcoat, woodwork primer, and mist coat (per litre). Parse range/band/size from the consistent Xero item names. Group by (range + band + colour number), tin-optimise per group, feed the total + deposit, and write real Xero item codes onto the quote. See MATERIALS_SPEC.md for the full build order and data model.

---

## FEATURE: Materials editing + sundries (BUILD BEFORE DEPOSIT)

Must come before the deposit feature: the deposit is based on the materials/total, so the total has to be final and adjustable *before* sending — no more editing in Xero after the fact.

### Materials editing (trim the auto-calculations) — this quote only
- **Edit a calculated line's quantity** — override the auto quantity (e.g. 6 tins → 5 or 7 for access/wastage); cost and total follow the new quantity.
- **Delete a line** — remove a calculated material not wanted on this quote (client supplying, paint in stock, etc.); total recalculates without it.
- **Add a one-off specific item** — add a material the model didn't calculate (specialist product), pick the Xero item (or free-text) + quantity; joins the materials total and the Xero quote.
- **Scope: this quote only** — edits are a snapshot, they don't feed back into settings or defaults.
- **Recalculate-from-rooms button** — edits are a snapshot on top of the live calculation; if rooms change afterwards, a visible "recalculate" resets materials to freshly-calculated values (discarding manual edits). Keeps the model simple — no tracking overrides through every recalc.

### Sundries (% of labour)
- **A percentage set in Settings** (editable) applied to the **labour total BEFORE markup** — sundries scale with time on the job, not paint cost. Markup then applies to everything including sundries.
- Covers the general consumables: tape, filler, caulk, floor protection, sandpaper, dust sheets — the long tail Nicky doesn't itemise.
- Anything specific/expensive is still added as its own one-off material line (above), not absorbed into the %.
- **Shows as a labelled line** — e.g. "Sundries & consumables" or "Protection, masking & materials" (a plain "Sundries" with a big number invites client questions; a descriptive label reads as value). Consider showing it among the materials lines rather than standalone so it looks like a normal part of the job. Start visible; revisit if it draws questions on real quotes.
- Feeds the materials/total and therefore the deposit; goes onto the Xero quote as its own line.
- Typical decorating sundries land ~3–8% of labour, but Nicky sets the real figure in settings and calibrates.

### Calculation order (important)
labour (before markup) → sundries = labour × sundries% → (labour + sundries) × markup → + materials (calculated, then edited/trimmed, NOT marked up — corrected during build: materials are priced at Xero's own sell price, which already IS the customer price, so re-applying markup would double it) → total → deposit calculated on that total. Get this order right so sundries is on raw labour, materials never get marked up twice, and the deposit is on the true final figure.

**Shipped**, in three steps:
1. **Materials editing** — a new job-scoped `materialsSnapshot` (same lifecycle as rooms/colours/extItems, its own DB table + `/api/materials` routes). Only mapped roles (real Xero product picked) feed it, since editing only makes sense where there's a real quantity/price. `recalculateMaterialsSnapshot()` builds it from the live calculation and is the only thing that ever discards edits — genuinely a full overwrite, not a merge, exactly as scoped. Quantity edits and deletes operate on snapshot entries directly; a one-off line (product-picked or free-text) pushes a `custom: true` entry into the same array, so it edits/deletes/gets-wiped-by-recalculate identically to a calculated line.
2. **Sundries %** — `settings.sundriesPct` (a genuine setting, unlike the per-quote snapshot), computed on raw labour before markup, folded into the same marked-up figure as labour (`labourTotal = (tcS + sundries) × (1 + mu)`). Displayed as its own row inside the Materials card (per the "reads like a normal part of the job" preference above) even though it's calculated from labour — purely a presentation choice, not double-counted since it's never added to `materialsTotal`.
3. **Xero quote** — sends whatever's in the snapshot (not a fresh live recalculation) as the materials line items, plus a separate Sundries & Consumables line computed server-side the same way, on account 202 (booked as consumables, not labour) but WITH markup applied (the one 202 line that gets it, since materials proper don't).

## FEATURE: Deposit & staged payments

Depends on materials AND materials-editing/sundries above, so the deposit is based on the true, adjusted job total (labour + sundries + edited materials, marked up).

1. **Deposit calculation on summary:**
   - Default 25% (editable in settings)
   - Calculated on labour + materials total
   - Show: Total, Deposit (25%) due on acceptance, Balance

2. **Two job types:**
   - **Single payment** — deposit + balance on completion
   - **Multi-week** — enter number of weeks; split the balance (after deposit) evenly across weekly payments. Show deposit + N weekly instalments.

3. **Optional** — write payment terms as a line into the Xero quote (terms/notes field). Actual weekly invoicing stays in Xero.

---

## FEATURE: Colour reference library (nice-to-have, low priority)

The Colours tab lets each colour number carry a name (e.g. colour 1 = "Dimity"). Enhancement: autofill colour names/codes as you type, to help with ordering (exact names and codes to hand for the merchant).

Approach — personal growing list, seeded with the two main brands:
- Store each colour as `{ name, brand, code }`.
- **SEED with Farrow & Ball and Little Greene full ranges** (name + code) — these cover ~90% of colours Nicky uses, are manageable in size (~130 each), and are the brands where exact name/code matters most for ordering.
- As you type a colour name on the Colours tab, autofill brand + code from the library.
- For colours not in the seed (the other ~10%), add on first use — the app remembers them, so the personal list grows over time. No need to source a full cross-brand database.
- Fallback: if a typed colour isn't known, accept it as free text and offer to save it (name/brand/code) for next time.

Data notes:
- Big trade brands (Dulux etc.) are usually colour-matched anyway, so not worth seeding wholesale — the personal-list approach handles them.
- Colour label is reference/ordering only; the colour NUMBER still drives the materials calculation (see MATERIALS_SPEC.md).

Priority: low. Build after materials + deposit are done. Genuinely useful for ordering, but not day-to-day critical.

## FEATURE ideas (not yet scoped)

- Quote status tracking (sent/accepted/declined) — note: overlaps with Xero, may not be worth it
- Photo attachments per room/item — needs external storage (Cloudinary/S3); parked for now
- Job templates (e.g. "standard 3-bed repaint") to load and tweak

## Quote description templates

Six templates are stored as iOS/Mac text replacements (`;;paint`, `;;paper`, etc.) and pasted into the Xero line item description fields directly (item selector overwrites price, so paste into description instead). Templates: Painting only, Wallpaper only, Combined, Exterior Render, Exterior Woodwork, Kitchen Cabinet Spraying. Follow-on rooms use "As above".
