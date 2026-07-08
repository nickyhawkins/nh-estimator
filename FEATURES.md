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

---

### PHASE 1 — Core materials (build first)

Simplifying assumption: one wall colour per job.

1. **New endpoint** `GET /auth/items` in `routes/xero.js`:
   - Fetch Xero Items (`GET /api.xro/2.0/Items`)
   - Filter to account code 202 (sales); read SalesUnitPrice
   - Return: code, name, unit price, parsed tin size (from name)
   - Reuse existing `getAccessToken()` helper

2. **Settings — map four default products** from fetched Xero items:
   - Wall paint (per tin — parse tin size from name)
   - Ceiling paint (per litre)
   - Woodwork topcoat (per litre)
   - Woodwork primer (per litre)
   - Store the mapping (item code + name + price + tin size) in settings

3. **Calculations** using litres already computed per surface in the summary:
   - **Walls:** total wall litres for job ÷ tin size, round UP to whole tins (at JOB level, not per room), × tin price
   - **Ceiling:** total ceiling litres × per-litre price
   - **Woodwork topcoat:** total woodwork litres × per-litre price
   - **Woodwork primer:** (total woodwork litres × 0.8) × per-litre price

4. **Materials list on summary** — consolidated across the whole job, shown under the labour breakdown (e.g. "6 × Dulux Heritage Velvet Matt 2.5L — £242.94", "12L ceiling paint — £X").

5. **Feed the total** — materials sum added to labour total for the true job value.

6. **On send to Xero** — add each material as a line item using the real Xero item code, account 202 (sales), No VAT, placed after the labour lines (materials break).

7. **Flag for multi-colour jobs** — until Phase 2, show a note: "Materials assume one wall colour; adjust in Xero for multi-colour jobs."

---

### PHASE 2 — Colour grouping

8. **Colour number per room** — each room gets a colour number (Room 1 = colour 1, Rooms 2 & 3 = colour 2, etc.)

9. **Optional colour label per number** — free-text note for the user's reference (e.g. colour 1 = "Farrow & Ball Hague Blue"). The NUMBER drives the calculation; the label is for reference only and can show on the quote/notes.

10. **Walls grouped by colour** — sum wall area within each colour group, calculate tins per group separately (a 25m² room in colour 2 needs its own tin(s) regardless of colour 1's usage). Whole-tin rounding happens per colour group.

---

### PHASE 3 — Cheapest tin combination

11. **Pull all tin sizes** for each wall product from Xero (all already exist as items).

12. **Optimise** — given litres needed for a colour group, find the cheapest combination of available tin sizes that covers it (e.g. 3.5L → 2.5L + 1L if cheaper than 2 × 2.5L). Small bin-packing / least-cost-fill problem.

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

## FEATURE ideas (not yet scoped)

- Quote status tracking (sent/accepted/declined) — note: overlaps with Xero, may not be worth it
- Photo attachments per room/item — needs external storage (Cloudinary/S3); parked for now
- Job templates (e.g. "standard 3-bed repaint") to load and tweak

## Quote description templates

Six templates are stored as iOS/Mac text replacements (`;;paint`, `;;paper`, etc.) and pasted into the Xero line item description fields directly (item selector overwrites price, so paste into description instead). Templates: Painting only, Wallpaper only, Combined, Exterior Render, Exterior Woodwork, Kitchen Cabinet Spraying. Follow-on rooms use "As above".
