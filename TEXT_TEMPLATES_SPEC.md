# Quote & Invoice Text Templates — Spec

**Status: BUILT 2026-08-07 (same day as scoping), v2.3.0.** Not to be confused with
`JOB_TEMPLATES_SPEC.md`, which is job *duplication* — this is the 8 job-type
*text* blocks that lived in iOS text-replacement shortcuts (";;paint" etc.),
seeded verbatim from the reference copy Nicky supplied at build time.

**As built — deviations from the spec below, all deliberate:**

1. **Placeholders resolve BEFORE pairs**, not after. The seeded headers nest a
   placeholder inside a pair (`{Painting of {rooms}:|Painting — {rooms}}`);
   placeholder-first means the pair regex then sees no inner braces. The
   consequence is a rule for template authors: a placeholder that might not
   resolve must live on a plain/Q:/I: line, never inside a pair (an unresolved
   one leaves the whole pair raw) — which is why `{rooms}` ALWAYS resolves
   (job-name fallback) and the product/date placeholders sit on prefix lines
   in every seeded body.
2. **Live-until-edited, not persist-on-first-render.** An untouched job
   re-renders fresh on every view (tracks room/product changes with no
   Regenerate babysitting); the first edit persists to
   `job.data.quoteText`/`invoiceText` and sticks; "Reset to template" (null)
   is the way back; and a successful SEND stamps the exact text + templateId
   (the sent document is history — its wording stops tracking later edits).
3. **`{masonryProduct}` and `{extWoodProduct}` added** (settings roles
   masonry/extTopcoat, per-item override first) so the two exterior templates
   self-fill. Kitchen `[X] coats of [product] in [colour/finish]` stays a
   literal square-bracket marker — kitchen product/colour aren't tracked in
   the app (declined 2026-07-16) and square brackets pass through untouched
   as visible edit-me markers, same as today's manual habit.
4. **`openFinalInvoice()` now loads the labour log** alongside actuals
   (best-effort) — `{completedDate}` reads the last real on-site day, and the
   log was otherwise only loaded when the On Site screen opened.
5. **Server passthrough**: `/auth/create-quote` reads
   `room.description || room.name` (ditto exterior/kitchen) — the CLIENT
   composes first-line-block/"same as above" because only it knows which
   labour line is first across rooms/exterior/kitchen. Older clients
   unaffected. `templateId` joined `templateJobData()`'s keep-list;
   `textTemplates` joined `mergeSettings()`/`saveSettings()`'s carry-forwards
   (both are whitelists — omission there would have silently wiped it).

Verified: 97-check node harness on the extracted renderer (pair/prefix/
placeholder mechanics, gold renders of the Painting template against Nicky's
original quote AND invoice worked example, all 8 seeds × both modes clean,
value-building + suggestion scenarios) plus a stubbed-server Chromium smoke
run (quote payload first-line/same-as-above shape, stamp-on-send, invoice
builder prefill + create payload, Settings editor round-trip, saveSettings
carry-forward). Real-Xero caveat applies as ever: WATCH THE FIRST REAL ONE.

## Purpose

Today the app sends only the room name to Xero and Nicky types the full quote
description into the line item by hand, then separately remembers matching
invoice-version wording once the job is done. Move the text into the app, stored
ONCE per job type, render the quote version into the Xero quote and the invoice
version into the final-invoice builder — kill both the re-typing and the
keep-two-wordings-in-sync problem.

## Decisions already made (Nicky, 2026-08-07)

1. **Option A — single source per template.** One body per job type; where quote
   and invoice wording differ, inline `{quote|invoice}` pairs and `Q:`/`I:`
   line prefixes (below). NOT two stored texts (drifts), NOT automatic tense
   transformation (fragile — ruled out at scoping).
2. **The block goes on the FIRST labour line; every other labour line reads
   "{label} - same as above".** This is Nicky's existing manual convention in
   Xero, verbatim — the app reproduces it, not a new layout. Rendering is
   proven safe because the ;;paint shortcut already puts this exact text in
   this exact Xero field (LineItem.Description) via the UI; the API writes the
   same field, so the DOCX quote template renders it identically.

## Data model — no schema migration

- **`settings.data.textTemplates`** (global, like every other setting):
  `[{ id, name, body }]`. ~9 entries — Painting, Wallpapering, Kitchen Cabinet
  Spraying, Exterior Woodwork, Exterior Render, Painting & Papering, Fitted
  Units, Fire Doors, … Seeded by Nicky pasting each iOS shortcut in once and
  adding the pair syntax. Backup export/import already round-trips
  `settings.data` whole, so templates ride along for free.
- **`job.data.templateId`** — which template this job uses. Auto-suggested from
  job content (see below), changeable on Summary.
- **`job.data.quoteText`** — the rendered-then-possibly-edited quote block for
  THIS job. Snapshot semantics, same philosophy as `materials_snapshot`:
  generated lazily on first Summary render, edits stick, and a "Regenerate"
  action explicitly re-renders from the template + current room data (an edit
  must never be silently clobbered because a room changed).
- **`job.data.invoiceText`** — same, for the invoice version, generated when
  the final-invoice builder opens.

## Template syntax

Plain text plus three constructs, resolved by ONE shared render function
`renderTemplate(body, mode /* 'quote' | 'invoice' */, job)`:

1. **Inline pairs** `{quote wording|invoice wording}` — either side may be
   empty: `{will be|were}`, `{We look forward to working with you.|}`.
   Resolved FIRST (regex `\{([^{}|]*)\|([^{}]*)\}`), so a pair can't be
   mistaken for a placeholder: the `|` is the discriminator.
2. **Version-only lines** — a line starting `Q: ` appears only on the quote
   (the "high standard / professional techniques" closers); `I: ` only on the
   invoice ("Completed on {completedDate}."). Prefix stripped on output.
3. **Placeholders** `{name}`, filled from live job data — the values already
   exist from estimating, so a non-default room needs no extra typing:

   | Placeholder | Source |
   |---|---|
   | `{rooms}` | comma list of non-variation room names |
   | `{wallProduct}` / `{ceilingProduct}` / `{woodProduct}` | first room's `*RangeOverride` (+ band), else the settings role default — the Anti Reflex / Optiva 5 / Helmi 30 defaults come from settings, not hard-coded here |
   | `{wallCoats}` / `{ceilingCoats}` / `{woodCoats}` | first room's `wc` / `cc` / `xc` |
   | `{completedDate}` | latest `labour_log.work_date` for the job, falling back to `job.completedAt` — the last day actually on site beats the day the button was tapped |

   An unresolvable placeholder renders as `{name}` UNCHANGED and the preview
   highlights it — visible-and-editable beats silently blank on a client
   document. Start with this table only; add placeholders when a template
   actually needs one, not speculatively.

## Quote flow

- `createXeroQuote()` (`public/index.html`) currently maps every room to
  `{ name, total }` and `routes/xero.js` writes `Description: room.name`. New
  behaviour: the FIRST non-variation labour line's description becomes
  `"{label}\n\n{job.data.quoteText}"`; every subsequent labour line (rooms,
  exterior items, Kitchen Cabinet Spraying alike) becomes
  `"{label} - same as above"`. "First" = first in the order the payload already
  sends. The server keeps passing descriptions through untouched — the change
  is client-side string building; `/auth/create-quote`'s shape, account codes,
  markup maths, amend-in-place path and the "MATERIALS" divider convention are
  all unaffected.
- **Preview on Summary**: the rendered block shows above the Send to Xero
  button, tap to edit (persists to `job.data.quoteText`), with Regenerate.
  This is an approval step the quote flow currently lacks; the Xero DRAFT
  status remains the final backstop as ever.
- **4,000-char guard**: Xero caps a Description at 4000 chars. Block the send
  with a loud message if the composed first-line description exceeds it —
  never truncate silently, and never let Xero be the thing that reports it.

## Invoice flow

No new trigger point. The final-invoice builder (`FINAL_INVOICE_SPEC.md`,
`screen-finalinvoice`) already opens on a `completed` job, assembles the labour
lines, and posts client-supplied descriptions through `/auth/create-invoice`.
Add: on open, render `mode: 'invoice'` into `job.data.invoiceText` (if not
already edited), prefill the first labour line's description with it and the
rest with "- same as above", editable in the review screen like every other
line. The builder's existing gates (unpriced-row blocking, zero-actuals
warning, always-DRAFT) don't change.

## Template auto-suggestion

On first Summary render with no `templateId` set, suggest from content:
kitchen config → Kitchen Cabinet Spraying; any wallpapered room + any painted
room → Painting & Papering; wallpaper only → Wallpapering; exterior items only
→ Exterior Woodwork (or Render — see gotcha below); default → Painting.
A suggestion, not a lock: shown as a picker on Summary, and a wrong guess costs
one tap. Never re-suggest once set (including on jobs duplicated via
`JOB_TEMPLATES_SPEC.md` flow — `templateId` should COPY with the job, since a
"TEMPLATE — 3-bed repaint" job's whole point is carrying its setup).

## Settings UI

New Settings section "Quote & invoice text": list of templates, each with name
+ body textarea, add/rename/delete, plus a live side-by-side (or toggled)
preview of quote vs invoice rendering with sample data — the pair syntax is
easy to typo on a phone, and the preview is where a typo gets caught before it
reaches a client document.

## Build order

1. Renderer + syntax (pure function, testable in node — see
   `project_local_verification_limits`), settings storage + editor UI.
2. Quote side: templateId suggestion, Summary preview/edit, wire into
   `createXeroQuote()` with the 4000 guard.
3. Invoice side: prefill in the final-invoice builder.
4. WATCH THE FIRST REAL ONE of each — the repo-wide rule for anything that
   writes a client-facing Xero document.

## Gotchas

- **Product/coats placeholders read the FIRST room.** Rooms can differ; the
  block describes the job's headline spec and per-room deviations are what the
  edit step is for. Don't build per-room placeholder resolution in v1 — "same
  as above" is the convention precisely because Nicky's clients read one block.
- **Mixed jobs**: a rooms+kitchen job puts "Kitchen Cabinet Spraying - same as
  above" under a Painting block. Combination templates (Painting & Papering)
  plus per-line editing in the preview cover this; if a real quote reads
  wrongly, the fix is a new combination template, not per-line template logic.
- **Reordering/deleting the first room** moves the block to the new first line
  on the next send. Harmless for a fresh quote; for amend-in-place the whole
  line set is rewritten anyway, so no stale-text risk.
- **Accepted-quotes import and the labour/materials split** parse AccountCode
  201/202, never descriptions — long descriptions break nothing there.
- **Variation rooms never carry the block** — they're already filtered out of
  the quote (`VARIATIONS_SPEC.md`), and on the final invoice a variation line's
  description stays its agreed short label, not "same as above" (a variation
  was priced as its own mini-agreement and should read as one).
- **The `Q:`/`I:` prefix check must be line-anchored** (`/^[QI]: /` after
  trimming leading whitespace only) — "Q: " mid-sentence is real text.
- Pairs and placeholders are the ONLY syntax. No conditionals, no loops — the
  moment a template needs an if, the answer is a second template. Nine texts
  is the budget that keeps this maintainable from a phone.
