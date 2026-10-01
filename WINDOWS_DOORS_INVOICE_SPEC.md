# Windows & Doors: Invoicing and Work Report

## Goal
Windows and doors jobs now generate a lot of per-opening detail (panes, frame parts, prep levels, repairs, glass, resin upgrades). None of that should reach the Xero invoice as line items. The invoice gets **one single total line** for all windows and doors work, and the per-opening detail goes into an auto-generated **PDF work report attached to the Xero invoice**.

Builds on WINDOWS_DOORS_SPEC.md (stage 1). Does not depend on stage 2 elevation styling, but the report should use whatever elevation drawing style is current.

## 1. Invoice: single total line

When an invoice is generated for a job with the Windows & Doors fixture:

- Collapse **all** windows and doors pricing into one Xero line item.
- Amount = quoted windows & doors price + every on-site addition recorded against openings (prep upgrades, repairs, glass replacement, resin size upgrades on openings). Quote remains the floor, so this can never be lower than the quoted figure.
- Auto-generated description, no manual typing. Format:

  `Exterior windows and doors: preparation and painting of outside faces, 14 windows and 3 doors. Full breakdown of work per opening in attached report.`

  - Counts pulled from the job's openings.
  - Omit "and 3 doors" / "14 windows and" when the count is zero.
  - If the job has named colours for windows/doors, append them: `Colours: Dead Salmon (frames), Off-Black (doors).`
- Quantity 1, unit amount = total. Same account code and tax type the windows & doors fixture currently uses.
- All other job line items (rooms, kitchen, materials, custom items) are unaffected.

### Interim / staged invoices
Must work with the existing staged invoicing feature:
- Interim invoice: same single line, amount = the stage's windows & doors share (per the stage % already chosen), description gets a suffix `(stage 2 of 3)`.
- On-site additions are billed on the **final** invoice unless already recorded before an interim invoice is raised; in that case include them in that interim's amount.
- Report is attached to the final invoice only (see open questions).

## 2. Work report PDF

Generated server-side from On Site data when the invoice is pushed to Xero. Also viewable/downloadable in-app from the job before pushing, so Nicky can check it first.

### Content
- Header: business branding (logo, steel blue #1e6497, Barlow), client name, job address, completion date, invoice number once known.
- Summary block: total windows, total doors, number of openings needing work beyond the quote.
- Per elevation (Front, Rear, Left, Right, as recorded): the elevation drawing with each opening numbered.
- Per opening:
  - Small diagram of the window/door with worked parts highlighted (reuse the tappable window rendering, static).
  - Label (e.g. "Front, First floor, Window 2").
  - Work done as a plain list: prep level, repairs (resin with size), glass replaced (which panes), coats applied, colour.
  - Items added on site (anything beyond the quoted spec) marked with a "Found on site" tag so the client can see why the total may exceed the quote.
- **No prices anywhere in the report.**
- Openings with nothing beyond standard work can be shown compactly (diagram + one line) to keep length down.

### Tech notes
- Render currently runs on Starter tier, so avoid headless Chrome (Puppeteer) if possible. Prefer a lightweight approach (e.g. pdfkit + svg-to-pdfkit for the existing SVG elevation/window drawings). Claude Code to choose and justify.
- Barlow font must be embedded in the PDF.
- Keep file size well under Xero's attachment limit; check the current limit in Xero docs.

## 3. Xero attachment

- After the invoice is created in Xero, upload the PDF via the Invoices Attachments endpoint with `IncludeOnline=true` so the client sees it on the online invoice and in the emailed invoice.
- File name: `Work-Report-{InvoiceNumber}.pdf`.
- **Requires the `accounting.attachments` OAuth scope.** Check whether the current Xero connection has it. If not, add it and handle the reconnect flow (existing tokens will not have the new scope). Show a clear prompt in Settings > Xero config if a reconnect is needed.
- Attachment upload failure must not fail the invoice push. Record attachment sync state separately (same pattern as deposit sync state) and offer a retry button on the job.
- Idempotency: don't upload a duplicate attachment on retry if one with the same file name already exists.

## Acceptance
- A windows & doors job with 20+ openings and on-site additions produces an invoice with exactly one windows & doors line, correct total, correct counts.
- PDF opens in Xero's online invoice view, shows every opening, contains no prices, and flags on-site additions.
- Existing converted window job (the one current windows job) invoices correctly.
- Jobs without the Windows & Doors fixture are completely unchanged.

## Open questions
- Should interim invoices also carry a partial report (work done so far), or final invoice only?
- If an invoice is edited and re-pushed, should the old attachment be left and a new versioned one added (Xero attachments can't simply be deleted via the API), or skip re-attaching?
- Resin repairs on non-window items (sills, fascias etc.): stay as their own lines or roll into existing exterior lines? This spec only rolls in resin recorded against openings.
- Materials used on windows & doors: currently separate materials lines, or already inside the fixture price? Confirm existing behaviour and keep it unchanged.

---

## Implementation notes (v2.94.0)

**Where it lives**
- `public/windoors.js` — `invoiceCounts(data, variations)`, `invoiceLineText(p)` (the line's words; `report: 'attached' | 'final' | false`, `stage`, `pct`) and `workReportModel(data, variations, {colours})` (every opening, each work item flagged `onSite`, `standard` for painting-only openings). Pure and price-free, like `reportModel`.
- `lib/workReportPdf.js` — the PDF. `lib/windoors.js` — `workReportInputs` / `buildWorkReport` (reads the rows, colours, job and settings), `workReportFileName`, the `invoice_attachments` table.
- `lib/xeroAttachments.js` — `attachPdfOnce` (list, skip a same-named file, upload with `IncludeOnline=true`), scope helpers. Pure apart from the injected http.
- `routes/xero.js` — `attachWorkReport()`; `/create-invoice` takes `jobId` + `attachWindoorsReport`; `POST|GET /invoice-attachment {jobId}`; `/status` adds `attachmentsRefused`.
- `routes/api.js` — `GET /api/windoors/work-report.pdf?job_id=` (the check-it-first download).
- `public/index.html` — the final invoice's single line (`buildFinalInvoiceModel`, `wdInvoiceText`, `wdInvoiceLineDetail`), the interim line (`interimWindoorsText`, `interimInvoiceLineItems`), the Windows & Doors screen's report/attach controls, the Settings › Xero prompt.

**Why pdfkit + svg-to-pdfkit.** Puppeteer on Render Starter means a ~150MB Chromium per render and a multi-second cold start on a 512MB instance. pdfkit is pure JS, embeds TrueType by subsetting (Barlow costs a few KB), and svg-to-pdfkit draws the module's own elevation and window SVGs as vectors (they use only rect/path/polygon/polyline/circle/line/g/text). A 22-opening, 4-side job renders in well under a second to ~75KB. The one gap — no `paint-order` for the opening numbers' white halo — is handled by splitting each label into halo then fill (`forPdf`). Barlow Regular/SemiBold/Bold are vendored in `assets/fonts/` (SIL OFL 1.1, from Google Fonts via `@expo-google-fonts/barlow`).

**Xero's limit.** The Attachments endpoint page says 10 attachments per document, each up to 10MB (the Invoices page says 25MB; the stricter one is planned for). The app refuses anything over 5MB and says so before Xero would.

**Calls made where the spec left room**
- **What counts as on site:** approved site variations (marks, prep changed, an opening added to the job) and resin repairs found bigger than quoted. The amount on the line also includes **pending** site variations, as the final invoice always has (with the same confirm before invoicing); declined ones are out. The report shows approved work only.
- **Sundries:** each site addition is billed at the figure the client was shown (its own sundries share and the variations markup, as `buildClientVariationLines` publishes), so it leaves the "Sundries — variations" base. The quoted line keeps its sundries in the quote's "Sundries & Consumables" line, as quoted.
- **The floor, and credits (decided 2026-10-01):** site additions can only add to the quote, except a credit the client was given on site (prep lowered, v2.91.0). Credits net against the other additions, and when they win the line goes below the quoted figure. The client's page already tells them a credit is "taken off your final invoice", so the invoice must do it. The builder shows the net under the line. (A line with nothing quoted that comes out negative goes to Xero as a −1 quantity, as variation credits always have.)
- **Counts:** windows (including bay and dormer windows) and doors in the job, plus any brought in on site that the client hasn't declined. Other items (a porch, a garage door) aren't counted.
- **Colours:** named with `colourLabelFor` (*Farrow & Ball No. 28 Dead Salmon*), as the rest of the invoice names colours. One colour for both reads *Colour: X (frames and doors).*
- **No stage picked on an interim:** the suffix is *(40% complete)*.
- **Only work ticked off** is in the report (the existing rule); the builder already warns about unticked work.
- **Report unticked on the final invoice:** the line drops its "attached report" sentence.

**Answers to the open questions**
- **Interim report:** final invoice only; the interim line says the breakdown comes with the final invoice.
- **Edited and re-pushed:** the app never edits an invoice in Xero — "re-push" is a new invoice with a new number, which gets its own `Work-Report-{number}.pdf`. On the same invoice a retry is skipped when the file is already there (no versioned copies). To replace a report that's already attached, swap it in Xero by hand.
- **Resin on non-window items:** unchanged — they stay on their own exterior lines; only work recorded against openings rolls in.
- **Materials:** unchanged. Windows and doors paint was already pooled into the Exterior Woodwork / Exterior Primer materials lines (billed as used), and marks' material £ was already inside the fixture price. Neither moves.
