# Quote & Invoice Text Templates — Spec

**Status: BUILT 2026-08-07 (same day as scoping), v2.9.0 — landed on top of v2.8.0 after a 27-commit catch-up merge.** Not to be confused with
`JOB_TEMPLATES_SPEC.md`, which is job *duplication* — this is the 8 job-type
*text* blocks that lived in iOS text-replacement shortcuts (";;paint" etc.),
seeded verbatim from the reference copy Nicky supplied at build time.

**Extended 2026-08-30, v2.44.0 — the scope sentence is measured, not
hardcoded.** The seeded bodies named ceilings, walls and woodwork in fixed
prose with only the *products* as placeholders, so a walls-only job promised
a client two surfaces nobody was painting, and a measured feature wall,
panelling, radiator, sill or mist coat was never mentioned at all. Two
placeholders now build it from the live rooms:

- **`{surfaces}`** — the painted scope. Gates **mirror `calcRoom()`'s**: a
  surface appears only where it is actually priced (windows and sills need
  woodwork coats; a painted feature wall needs wall coats; a papered one is
  carved out of the paint entirely; panelling, doors and frames each need
  their own count *and* coats). Read-only against the calc engine. The
  woodwork clause names only the pieces counted; a product shared with the
  walls or woodwork isn't named twice; a papered feature wall makes the
  painted ones *"remaining walls"*. Coats are stated only where every
  measured surface agrees — the old sentence always printed the first room's
  wall coats, wrong the moment a ceiling took three.
- **A surface names EVERY paint it uses**, not the first room's.
  `roleProduct()` collects the distinct products across the rooms that paint
  the surface: *"walls in Tikkurila Optiva 5 and Dulux Diamond Matt"*. Only
  rooms that actually paint it are consulted (a stale override on a room with
  0 wall coats is not a second paint), and a surface no room paints keeps the
  Settings default, so an edited template that mentions it still resolves.
  The same values reach the standalone `{wallProduct}` / `{ceilingProduct}` /
  `{woodProduct}`, and exterior items get it keyed off the override alone.
  **Naming none was tried first (2026-08-30) and is wrong**: a bare clause in
  an English list reads as sharing the next clause's paint, so *"walls, and
  all woodwork including skirtings in Helmi 30"* asserts that the walls are
  in the woodwork paint — a worse claim than the guess it replaced. Hence the
  standing rule: **a clause may go bare only where that sharing is true** —
  the feature wall in the wall paint, panelling in the woodwork paint — and
  never otherwise. A clause that spends its "and" listing two paints also
  forces the sentence's Oxford-comma join, so *"in A and B and walls in C"*
  cannot happen.
- **`{papered}`** — what is being papered, for the "hung to …" line. Falls
  back to the seeded `[feature wall/walls]` marker.
- **Every later ROOM line carries its own scope** instead of a bare
  "{name} - same as above" (`roomScopeSentence()` — the same builder over a
  one-room list, so a per-room sentence and the job-wide one can never
  resolve a product differently). Point 2 of the original build put the
  block on line one and "same as above" on the rest, which was honest while
  that block was generic boilerplate and stopped being honest the moment it
  enumerated a scope: every Xero line carries a price, so a walls-only
  bathroom reading "same as above" bills a client beside a claim of
  ceilings and woodwork. The block still appears once — protection, prep
  and completion genuinely are shared, hence the trailing "Preparation and
  completion as above." Two rules keep it quiet: a room whose sentence
  MATCHES the block's own job-wide one goes back to a plain "same as
  above", and once the description has been **hand-edited** nothing is
  generated at all (the block is then Nicky's wording, and a generated
  sentence under it would be text he did not write and cannot edit). The
  final invoice mirrors this exactly, in past tense, off `l.scope` stamped
  on each labour line as it is built. Kitchen and fitted-unit lines keep the
  bare "same as above" — there is no scope builder for them, and inventing
  prose for a client document that nothing tests is how the interior
  problem started.
- **`{extSurfaces}` does all of the above for EXTERIOR items**
  (`buildExtScopeSentence()`), gated the way `calcExtItem` gates each
  element: render (textured or not), fascias and soffits, windows, sash
  windows, doors, frames, garage doors, porch. Masonry names
  `{masonryProduct}` and the woodwork clause `{extWoodProduct}`, so neither
  can borrow the other's paint; coats come per element (defaulting to the 2
  the calc defaults to) and are stated only where they agree; sash work
  contributes a clause but never a coats figure, having no coats control of
  its own. Sash work or per-window repairs add a "restoration and repairs"
  sentence in the seeded Exterior Woodwork body's own words. Exterior lines
  compare against the EXTERIOR union, never the rooms' — comparing across
  the two would mark every line a deviation.
- **`{rooms}` includes exterior item labels.** A mixed job's header read
  "Painting of Living Room and Bathroom" while also painting the front
  elevation, silently omitting half the work it headed.
- **A ninth seeded template, `int-ext` "Interior & Exterior"**, suggested by
  `suggestTemplateId()` when a job has interior paint AND exterior items and
  no wallpaper (wallpaper still wins: paint-paper/wallpapering carry hanging
  wording int-ext has no equivalent for, and the exterior detail still
  reaches the client on the exterior lines' own scope). Before it, such a
  job got the plain Painting template, whose prep paragraph promises a
  client that "all furniture and flooring will be fully protected" and says
  nothing about the outside of their house. **Every sentence in it is
  lifted verbatim from the seeded Painting / Exterior Woodwork / Exterior
  Render bodies** — the two halves keep wording Nicky already uses, under
  INSIDE and OUTSIDE headings, rather than a preamble written for him.
- **The exterior templates use it too.** `ext-woodwork` was still asking for
  "[doors / windows / fascias / soffits]" and "[X] coats" by hand, and
  `ext-render` for its coats — all measured. Their own wording either side
  of the placeholder is untouched (the render template's brush/roller/spray
  sentence was re-opened so it does not read "applied in 2 coats. Applied
  by…"). **Still deliberately hand-typed markers**: the wallpaper paper
  name/supplier (`wpNote` is personal reference, never client-facing — see
  v2.39.8) and Kitchen's product/colour (untracked, declined 2026-07-16).
  Fitted Units and Fire Doors keep theirs; the fitted-unit product and
  counts ARE tracked, but that one was left alone by request.
- **`roomScopeShort()`** puts the same scope in a few words —
  *"ceiling, walls and woodwork"* — on the client quote view's `sub` line,
  which for rooms was empty (`extScopeShort()` does the same for exterior items, replacing the bare "exterior"). Surfaces only, no products or coats: the
  register is the kitchen's existing "outside faces only", a note rather
  than a paragraph. It rides `quoteModel` so it reaches the accepted-quote
  snapshot's `note` as well.

`{surfaces}` in the BLOCK is a **job-level union**, matching what the block
is — the one text on the first Xero line, standing for the whole job — and
the same whole-job resolution the product placeholders already used. The
per-room lines below it are where a single room's own scope is stated.
`{surfaces}`
resolves to `''` rather than a literal token when nothing is painted — the
one deliberate exception to the "unresolved stays visible" rule in point 1
below, since a papering-only job must not leave `{surfaces}` on a client
document; an unresolved *product* inside the sentence still surfaces in the
preview warning. **The no-movement property is the contract**: a job with
walls, ceiling and woodwork all measured renders the seeded sentence back
character for character in both tenses. Templates already edited in Settings
keep their own wording (`settings.textTemplates` is copy-on-write) — paste
the placeholder in, or Reset to defaults. Verified by `npm run test:scope`,
147 checks, pure node against the real source.

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
   `room.description || room.name` (ditto exterior/kitchen/fitted unit) —
   the CLIENT composes first-line-block/"same as above" because only it
   knows which labour line is first across rooms/exterior/kitchen/fitted
   unit. Older clients unaffected. `templateId` joined `templateJobData()`'s
   keep-list; `textTemplates` joined `mergeSettings()`/`saveSettings()`'s
   carry-forwards (both are whitelists — omission there would have silently
   wiped it).
6. **v2.8.0-era lines** (from the catch-up merge): the Fitted Unit /
   Shelving line joined the same-as-above chain (after kitchen, matching
   the server's push order) and a fitted-unit-only job suggests the Fitted
   Units template. Custom line items and the standalone diary-rounding
   top-up are deliberately NOT in the chain — a custom item's description
   IS its own text, and the top-up is a pricing note, not scope. A quote
   with ONLY custom/standalone lines gets no block at all.

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
