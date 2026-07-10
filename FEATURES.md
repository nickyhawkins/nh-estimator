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

## FEATURE: Deposit & staged payments

Depends on materials (Phase 1) so the deposit is based on the true job total including materials.

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
