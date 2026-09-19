# Variations — Spec (mid-job extras, priced properly)

**Status: BUILT 2026-07-22 (same day as scoping), all four build-order items.**
Idea #4 in `FEATURES_2.0_IDEAS.md`. Depends on `JOB_PIPELINE_SPEC.md` Part 1 (needs
"accepted" to mean something). Feeds `FINAL_INVOICE_SPEC.md` and `CALIBRATION_SPEC.md`.

**As built:** `isVariation` rides the full room AND exterior-item lifecycle (form
toggle-row auto-on for new items while accepted+, hidden pre-acceptance, restored on
edit, carried by the room-draft path via `buildRoomFromForm()`). Summary computes the
split exactly per the gotcha table: deposit/payment-plan/hero/Labour-stat read
original-only figures, live On-Site days and the scheduling drift-nudge include
variations, materials/colours/tins stay blind. The Variations card lists flagged items
and free lines with subtotal + "Job total incl. variations", and renders (with just the
add button) on any accepted+ job so the entry point exists the moment it's meaningful.
Free lines: 'hours' at day-rate/hours-per-day with markup+sundries, 'flat' verbatim.
`createXeroQuote()` filters flagged items out — a re-send can never absorb variations.
Badges: VARIATION chip on Home/Exterior rows, "+N" on Jobs-list rows (via a persisted
`variationCount` snapshot — other jobs' rooms aren't loaded, same reasoning as
`scheduledDays`). Deliberate deviations: (1) **the kitchen flag is manual** — kitchen is
one persistent per-job form, not an added list item, so there is no clean "added while
accepted" moment to auto-flag on; a toggle on the Kitchen tab covers it; (2) **fixed-£
markup mode adds NO markup to variations** — the fixed amount was the adjustment agreed
on the original quote, and spreading it thinner would silently change that quote's
total (percent mode marks variations up normally); (3) Home/Exterior list totals and
the CSV export stay blind to the flag (they're live working views). Verified in the
40-check Chromium smoke run: auto-flag default, original-scope Labour invariance,
quote-resend exclusion, free-line CRUD/persistence, chips, pre-acceptance hiding.

**Addendum 2026-08-10 (v2.13.0): the client-facing variation quote — the Xero
section's "plausible later" — is BUILT.** Trigger was a job imported from Xero
(`importAcceptedQuote()`): variations needing the client's yes, but no measured
rooms, so no quote document existed to show — and `createXeroQuote()` rightly
filters variations out of the main quote anyway. The Variations card (On Site)
now carries **"Send variation quote to Xero"** whenever Pending lines exist: a
small SEPARATE Xero DRAFT quote of *just the still-Pending lines* (approved =
already agreed, declined = dead; re-showing an approved line means tapping it
back to Pending first). Pricing is `buildVariationQuoteLines()` — per-line
`raw × varMk` / flat-verbatim plus the pending-scoped sundries line, the exact
composition `computeVariationsView()`/final invoice use. Transport rides
`/auth/create-quote`'s custom-items path (`applyMarkup:false` = lines go out
exactly as entered; a roomless payload means the server adds no lines of its
own); all lines land on account 201, accepted as cosmetic since the document is
never invoiced from Xero. The link lives in its own
`variationQuoteId/Number/Status` fields — `xeroQuoteId` (the accepted quote's
record) is never touched — with the same DRAFT/SENT amend-in-place rule as the
main quote, so pending-line changes update one document rather than minting
duplicates. The inward status poll (`syncQuoteAnswersFromXero`) watches it too:
an ACCEPTED answer given through Xero's portal shows on the card and *prompts*
the per-line ✓ taps — sign-off stays a deliberate act with note + timestamp,
never a silent flip. `/auth/accepted-quotes` filters variation quotes out of
the import list (an accepted one would otherwise offer to import as a "new
job"). Imported jobs' compact Summary gained a variations subtotal row (free
lines keep such jobs roomless, so the money was invisible outside On Site) and
its footer now points at the variation-quote + final-invoice path. Money flow
is unchanged: the variation quote is a display/approval vehicle only — billing
still happens on the final invoice.

The in-app **Quote ⤴ page** (openClientQuote, v2.5.0) joined in the same
build: it used to mirror createXeroQuote's variation filter wholesale and
refused to open on roomless imported jobs ("add rooms first") — the exact
on-site "show the client the costs" moment this whole addendum exists for. It
now renders a separated "Variations — extras beyond the original quote" card
(pending flagged *awaiting approval*, approved flagged ✓, declined omitted —
client-facing page, internal record stays internal) priced by
computeVariationsView(), a gold "Job total incl. variations" bar under the
total (Summary's hero-sub rule), and on imported jobs an "Original quote — as
agreed" line in place of the work card, with the £0 payment/terms cards hidden
(that money's collection lives in Xero). The original-scope cards still mirror
createXeroQuote() exactly.

**Addendum 2026-08-28 (v2.41.0): the client answers for themselves.** The Xero
variation quote above solved "show the client the extras" for the case with signal,
a Xero connection and an email address. `CLIENT_APPROVAL_SPEC.md` solves the case
this app actually lives in: a phone, mid-job, one bar. **Send for approval** on the
Variations card mints a private link (`/quote/:jobId/:token`, mounted ahead of the
login gate — the client has no account and never will) and copies it ready to text.
The page shows the original quote as ONE total, every extra since with its status
and date, Approve/Decline on the pending ones, and a running total of original +
approved. No Xero anywhere in the flow. The prices are **published from the browser**
into the new `job_variations` table rather than computed server-side — the calc
engine is `index.html`, and a published price has to freeze the way an accepted
quote does — with each line carrying its own folded share of sundries, which changes
no total. The client's answer is **pulled back** (with the job's data, or via *Check
answers*) and adopted onto the `isVariation` carrier, **but only where the internal
status is still Pending**: an answer recorded by hand always wins, because the person
who was there knows what was agreed. That is a deliberate relaxation of the Xero
poll's prompt-don't-flip rule, valid only because an Approve on this page is per-line
and unambiguous where a whole-quote ACCEPTED is not.

**Addendum 2026-09-19 (BUILT, v2.70.0): extra work added INSIDE an
already-measured room.** The flag is per-carrier, never per-field, so radiators typed
into an accepted job's existing room produce no variation, no chip and no money — the
work gets done and never billed. Part 2 at the end of this file specs the fix: a frozen
copy of each carrier's inputs at acceptance, and the extra priced as the difference
between the engine run over the live inputs and over that baseline, both at today's
rates. Read it before touching any room-form save path.

**Addendum 2026-07-23 (v1.11.0, per Nicky's layout review):** the Variations card
moved from Summary to the renamed **On Site** screen (was "Materials") — extras get
agreed on site, in the same moment days are logged. Summary keeps the money (the
"+£X variations → job total" hero line and the totals split) and now badges flagged
rooms/exteriors in its per-item breakdown; the card's add/manage UI lives On Site.
Both render from ONE shared `computeVariationsView()` so the screens can never
disagree. On Site also gained a job-context header (name · status · scheduled dates,
with Build final invoice › when completed).

## Purpose

The classic mid-job leak: *"while you're here, can you just do the landing ceiling?"* —
agreed verbally, then either forgotten at invoicing or priced by gut instead of by the
model. Edits #3 already gestures at the materials side (manually added items with a
Chargeable tickbox); this is the labour side. A variation is **extra scope added to an
accepted job, priced through the same engine, kept visibly separate from what was quoted.**

## Core design decision — variations ARE ordinary items, flagged

No parallel entry system. A variation is a normal room / exterior item / kitchen or
panelling entry with `isVariation: true` on it, riding the entire existing lifecycle
(entry forms, `buildRoomFromForm()`, persistence, `calcRoom()`, materials flow, colour
numbers) untouched. What the flag changes is **presentation and totalling** — nothing in
the calculation engine forks on it.

Plus one genuinely new lightweight type for the odd job that isn't worth measuring:

```
// jobs.data.freeVariations: []
{ id, label, mode: 'hours'|'flat', hours, amount, createdAt }
// 'hours' prices as hours × (settings.dr / settings.hpd); 'flat' is a straight £.
```

### The flag's rules

- **Auto-on** (`variationDefaultsOn()`): any room/ext/fitted-unit/panelling item added
  while `job.status` is `accepted` (or later) defaults `isVariation: true`, with a visible
  chip on the form so it's never silent. Toggleable off at entry — "I forgot to measure the
  utility room before quoting" is a correction to original scope, not a variation, and the
  person on site knows which it is. The app defaults; Nicky decides. (Same
  control-is-the-judgement philosophy as sundries.) The kitchen is the one exception, see
  the deviations above.

  `variationDefaultsOn()` is deliberately **separate from `variationApplies()`**, which
  only answers "does the concept apply at all" and still governs whether the toggle row is
  visible. Two fixes on 2026-08-19 (v2.34.1), both found from one live job:

  - **Fitted units never took the default at all.** `newFittedUnit()` created the unit
    without the flag, so on the same measure-out a room and a fitted unit behaved
    differently. `addFittedUnit()` re-applies the default when it reuses a **blank**
    leftover unit, so one created before acceptance can't come back with a stale flag; a
    unit with real bays/shelves/doors is never re-flagged, so a deliberate toggle-off on
    priced work stands.

  - **The default INVERTS on a Xero-imported job** (`XERO_IMPORTED_JOBS_SPEC.md`). Those
    jobs are imported **already-accepted and roomless**, then measured out precisely so the
    materials and the internal estimate are real. Every room added during that measure-out
    is the ORIGINAL scope being written down late, not extra work — so auto-on flagged the
    entire retro-measure as variations, and on a honoured job **variations stack on top of
    the agreed labour**, i.e. it silently billed the client again for work the agreed price
    already covered. On those jobs the default is OFF and the toggle stays visible: the
    retro-measure is the normal case, a genuine extra agreed after the Xero quote is the
    exception and gets flagged by hand. Both signals count — the `isXeroImported` flag, and
    an importer-created job not yet flagged (its rooms are necessarily the retro-measure).
    The Summary toggle card says this out loud, since it reverses what every other accepted
    job does.

  **Items saved before these fixes keep whatever flag they were given** — the toggle on the
  item's own form is the fix for those.
- Items added pre-acceptance can't be flagged — the concept doesn't exist yet, the chip
  doesn't render.
- Editing a pre-acceptance room after acceptance does NOT flag it — edits to original
  scope are corrections. The frozen comparison point is `acceptedSnapshot`
  (`CALIBRATION_SPEC.md`), not a lock on the data. **The app never locks rooms**; it
  records what the estimate was at acceptance and shows drift.

## Totalling and money

- **Summary gains a "Variations" section**: each variation line (flagged items by name,
  free lines by label) with its engine price, and a variations subtotal. The main
  labour/section totals EXCLUDE flagged items, so "Original quote" remains recognisable
  against the Xero quote, and: `job total = original total + variations total`.
- **"Flagged" means flagged, whatever the client said.** The exclusion above is by the
  `isVariation` flag alone — never by approval status. `computeVariationsView()` keeps two
  sets of sums for exactly this reason: `varLabour`/`varTime`/`varSpray` count only
  non-declined items (what the variations are *worth* — a declined one is worth nothing),
  and `varLabourAll`/`varTimeAll`/`varSprayAll` count every flagged item (what is *not
  part of the original quote* — a declined variation still isn't). Summary subtracts the
  second to get `tcOrig`/`ttOrig`/`sprayOrig`.

  Subtracting the first, as it did until v2.47.0, left a **declined** variation's labour
  and time sitting inside the quote-facing total — money the client had turned down,
  added to the headline figure, the deposit and the payment plan, while the variations
  line beside it read "+ £0.00". The client quote, the Xero quote, the final invoice and
  the accepted-quote snapshot all filter on `isVariation` alone, so Summary was the only
  reader that disagreed with the document being sent. On an accepted job it surfaced as
  phantom drift against the frozen figures with nothing having changed.
- **Markup**: flagged items get the same markup treatment as everything else (incl. the
  per-job override from edits #2) — a variation is normal work at normal rates. Free
  `'flat'` lines are NOT marked up (the typed figure is the agreed price); `'hours'` lines
  are (they're priced from raw rate).
- **Deposit is untouched.** The deposit was taken against the accepted quote;
  `computeDepositPlan()` keeps reading the original total. Variations are settled on the
  final invoice.
- **Sundries %** applies to variation labour like any labour (it's more time on the job,
  consuming the same consumables). It lands inside the variations subtotal, not the
  original's.
- **Materials**: flagged rooms feed `computeRoleGroups()` normally, so Recalculate pulls
  their paint into the snapshot and the three-bucket tracking picker — which is correct,
  because materials are billed as ACTUALS (`MATERIAL_TRACKING_SPEC.md`); the estimate
  split between original/variation materials doesn't matter to the invoice. No materials
  forking needed at all. (This is the payoff of the flag-not-fork design.)

## Xero

- **v1: variations do NOT touch the quote.** The accepted quote is a record of what was
  agreed then; re-sending would overwrite it. Variations reach Xero on the final invoice
  (`FINAL_INVOICE_SPEC.md` adds "Variation: {label}" lines) or, until that ships, they're
  on the Summary to copy across by hand — same interim answer as material actuals had.
- A client-facing "variation confirmation" (small quote for just the extra) is plausible
  later; out of scope now.

## Where it shows

- Summary: Variations section + subtotal (only when non-empty).
- Jobs list: a small "+N" chip on accepted jobs with variations.
- Estimate-vs-actual (`CALIBRATION_SPEC.md`): comparison footnote "includes N variations"
  — actual days can't be split between original and variation work, so the screen says so
  instead of faking precision.

## Build order

1. `isVariation` flag through the room/ext/kitchen/panelling lifecycle (temp var,
   `buildRoomFromForm()`, `editRoom()` restore, draft capture — the full checklist the
   spray flag just walked, `FEATURES.md` "Spray walls toggle" is the template)
2. Summary split + totals
3. Free variations (`jobs.data`, no schema change)
4. Chips/badges

## Gotchas

- **Totalling exclusions are the risk area.** Every place that sums rooms/extItems must
  decide: include flagged items or not? Summary main total: NO. Variations subtotal: YES.
  Materials/colours/tins: YES (blind to the flag). `onSiteDays`/deposit: original only
  (frozen behaviour) — but the LIVE time shown on Summary should include variations (it's
  real days on site; this is also what the scheduling drift-nudge should compare against).
  Grep every consumer of the room list; the duplicate-function history says don't trust
  memory of where they all are.
- Old jobs / jobs from backup import have no flags — absent means `false`, everything
  behaves as today.
- `acceptedSnapshot` must be stamped BEFORE the first variation can exist (it's stamped at
  acceptance; variations require accepted) — ordering is safe by construction, but a job
  accepted before that snapshot code ships will lack it: comparison screens must tolerate
  a missing snapshot.

**Bugfix (2026-07-24): two Summary display bugs, caught before merge on a job whose only
room was a variation.** (1) The "Labour subtotal" row in Room Breakdown used `tcS` (every
room, including flagged ones) while the Sundries/Markup rows directly beneath it already
used `tcOrig` per the totalling-exclusions rule above — so a variation-only job showed a
non-zero subtotal sitting on top of a £0.00 markup, looking broken even though each row
was individually "correct" for its own (mismatched) scope. Now all three rows read
`tcOrig`. (2) The "+ £X variations → £Y job total" hero-sub line (the one place the
combined total is meant to surface, per "Totalling and money" above) WAS being computed
correctly the whole time, but rendered `color:var(--accent)` — and the hero card's
background is a fixed dark navy in both themes while `--accent` in light theme
(`#1a5276`) is the *same colour* as that background, making the line invisible. Fixed to
a fixed gold (`#ffd166`) that reads on the fixed dark background regardless of theme,
matching how every other hero-sub colour is hardcoded rather than theme-reactive. Net
effect: the money was never missing, just unreadable — worth remembering next time a
"total isn't there" report comes in against a hero-style dark card.

---

# Part 2 — Extra work inside an already-measured room

**Status: BUILT 2026-09-19 (v2.70.0), all five build-order items.** Held by
`npm run test:room-variations` (38 assertions against the real app in a real
browser), which pins the two properties easiest to break by accident: a rate
change must not look like extra work, and the agreed figure must not move
whether the extra is unclassified, classified or declined.

**Deviations from this spec, both deliberate:** (1) a delta whose price moves
after sign-off is REPORTED on the card, not auto-reset to pending — flipping an
approved line back on its own discards the client's answer with nobody seeing
it, and sign-off in this app is always a deliberate act (the Xero poll follows
the same prompt-don't-flip rule); the server agrees, its publish upsert carrying
`WHERE status = 'pending'`. (2) The calibration footnote needed no change: no
such footnote exists in the code, and every count there derives from
`computeVariationsView()`, which now carries delta lines.

**Found while building:** `saveRoom()`/`saveExtItem()` rebuild the stored object
from the form, so an APPROVED variation's sign-off was silently reset to Pending
every time its room was opened and saved, losing the client's note and the date.
`carryVariationState()` fixes it and carries the baseline with it.

**Found in review, after the first pass was written** (all fixed, all now held by
the test):

- `lib/clientQuote.js`'s `VARIATION_KINDS` was never extended, and the publish
  route rejects the WHOLE payload on an unknown kind — so "Send for approval"
  was broken end to end for any job with a classified extra, taking that job's
  other variation lines down with it. The in-memory test passed anyway; there is
  now a real round trip through the server and a check on the stored row.
- **Un-accepting cleared the baselines but not the snapshot.** Re-accepting then
  captured no new revision (one already existed) yet re-baselined every carrier
  at today's scope, absorbing classified extras into original scope with none of
  the warning amending gives. Baselines now survive un-accept exactly as the
  snapshot does, and the acceptance stamp is guarded like the capture beside it.
  This spec's "jobs moved back to draft drop their baselines with their snapshot"
  was wrong on its premise: the snapshot is not dropped.
- A re-classified carrier inherited an old `approved` sign-off, so brand-new
  money could be published and invoiced as client-agreed without the client
  being asked. Classification and correction now both reset the sign-off.
- A classified extra whose carrier later **shrank below** its baseline vanished
  from every list while `originalScopeCarrier()` still priced it at the baseline
  — billing work no longer measured. A classified delta now means a *positive*
  one; if it goes non-positive it returns to being an open question.
- The classification sheet and the nag row omitted the spray-sundries component
  that the published line and the invoice charge. One `variationDeltaAmount()`
  now composes the figure for all of them.
- The drift-card exclusion was keyed on `carrierName()`, which never matches the
  kitchen's quote row label — so a classified kitchen extra still showed as the
  biggest unexplained mover directly under the warning saying it was absorbed.
  Keyed on `sourceKey` now, with the label as a fallback for older snapshots.
- `variationBaselinesAt`/`variationBaselinesLate` were missing from
  `persistJobData()`'s field list, so they never reached the server and the
  "already baselined" guard failed on every fresh load. `variationBaselinesLate`
  was also written and never read — the notice it promised now renders on
  Summary with a Got it to dismiss it.

Raised from a live job: quote accepted, client then asked for three radiators painting across two
rooms already measured. Opening each room and typing the radiators into the Extras
field produced **no variation, no chip, no money** — and, worse, no sign that anything
had been added at all beyond a line on the drift card.

## The hole

`isVariation` is a flag on a **whole carrier** — a room, an exterior item, the kitchen,
a fitted unit, a free line. It is never a flag on a field inside one. Part 1's
core design decision ("variations ARE ordinary items, flagged") is still right, but it
only covers extras that arrive as a *new* item. An extra that lands *inside an existing
item* has nowhere to be.

The rule that makes this invisible rather than merely unsupported is Part 1's own:

> Editing a pre-acceptance room after acceptance does NOT flag it — edits to original
> scope are corrections.

That rule exists for a good reason ("I mismeasured the landing" must not become
billable), and it is correct for the case it was written for. It just also swallows the
opposite case, silently, with no way to tell the two apart. What actually happens today
when radiators go into an accepted job's measured room:

- `calcRoom()` prices the room higher. Nothing forks on any flag, so nothing else moves.
- On a frozen job (`ACCEPTED_SNAPSHOT_SPEC.md`) every client-facing figure reads the
  snapshot, so the hero, the client quote, the Xero quote and the final invoice are all
  unmoved. The final invoice bills *frozen original + variations*, and the radiators are
  in neither.
- The only trace is the "Where the £X difference is" card, which reports the room as
  having **moved** — indistinguishable from a rate change, and phrased as drift to be
  explained rather than work to be billed.
- On an accepted job with **no** snapshot (accepted before v2.38.0), it is worse: the
  extra silently inflates the "original quote" total, i.e. it moves a figure that is
  supposed to be a record of what the client agreed.

Net effect: work gets done and never billed. That is the exact leak Part 1 exists to
close, arriving through the one door Part 1 left open.

## Why not just "flag the room"

Because the room isn't a variation — most of it was quoted and agreed. Flagging the
whole Lounge would pull the *entire* Lounge out of original scope and into the
variations subtotal, so the client's original quote would lose a room and the
variations line would bill one. The totals would still add up; every document would be
wrong.

What is extra is the **difference**, not the item. So that is what gets flagged.

## Core design decision — price the delta with the same engine, twice

A carrier keeps a **baseline**: a frozen copy of its own inputs as they were when the
quote was agreed. The extra is priced by running the existing calc over both:

```
deltaRaw   = calcRoom(live).total       − calcRoom(baseline.room).total
deltaTime  = calcRoom(live).time        − calcRoom(baseline.room).time
deltaSpray = calcRoom(live).sprayLabour − calcRoom(baseline.room).sprayLabour
```

Both sides run at **today's** rates, so the difference isolates the scope change and
cancels rate drift exactly. No new pricing path, no fork in the engine, no second
copy of any formula — the same "flag-not-fork" payoff Part 1 banked, applied one level
down. It also means the delta stays **live**: change the radiator figure again and the
variation re-prices itself, which a frozen £ line could never do.

### Why a full input copy, not a field list or a stored £

- **Not a stored £ baseline.** A day-rate change moves every room's raw labour, so a
  money baseline would report a scope change on every room the moment a rate moved.
  That is the bug the drift card already exists to explain; this feature must not
  re-create it one screen over.
- **Not a hand-picked list of pricing fields.** This file's recurring failure is a
  second copy of something getting out of step with the first (see NOTES.md's `extCost`
  gotcha, and Part 1's own "the duplicate-function history says don't trust memory of
  where they all are"). A field list would have to be updated every time a new toggle is
  added to a room form, and the failure mode when someone forgets is a silent unbilled
  extra — the worst class of bug this app has.
- **The whole room object, minus its own baseline**, is drift-proof by construction:
  whatever prices a room today is in there, because it is the room.

### Data model

No schema change. `rooms.data`, `exterior_items.data` and `jobs.data` are all JSONB, and
rooms/exterior items are saved with a transactional replace-all PUT, so this rides the
existing save paths exactly as `isVariation` does.

```
// on any non-flagged room / exterior item / kitchen / fitted unit
variationBaseline: {
  at:   ISO timestamp,        // when this baseline was agreed
  rev:  <quote_snapshots version at the time, or null>,
  room: { …deep copy of the carrier, with variationBaseline itself stripped… }
}
variationDelta: true|false    // this carrier's growth above baseline is EXTRA WORK
variationBaselineCorrectedAt: ISO|null   // last time a delta was ruled a correction
```

`variationBaseline.room` must have `variationBaseline` stripped before storing, or each
re-stamp nests the previous copy inside the new one and the room object grows without
bound.

A carrier is never both: `isVariation: true` means the whole thing is extra and it gets
no baseline at all. So `variationStatus` / `variationApprovedAt` /
`variationApprovalNote` can be reused for the delta's sign-off with no collision — one
carrier, at most one variation line, either way.

### When the baseline is stamped

1. **At acceptance**, for every carrier not flagged `isVariation`, alongside
   `captureQuoteSnapshot()` in `setJobStatusById()`. Ordering is safe by construction:
   a variation needs an accepted job, and the baseline is written in the same step that
   makes the job accepted.
2. **On amend** (`amendAcceptedQuote()`), for every carrier. Revision N+1 re-agrees the
   current scope, so every baseline re-stamps and every `variationDelta` clears — the
   extras are *absorbed into* the new agreed scope. This is the correct behaviour (that
   is what amending means) but it is not obvious, so **the amend confirm must say how
   many classified extras it is about to absorb, and their total**, before it writes.
3. **Lazily, on first open of an accepted job that has none** — the same
   `captureSnapshotIfOwed()` pattern, for jobs accepted before this ships. Honest but
   blunt: it takes the room *as it stands today*, so any extra already typed into a
   measured room becomes part of its baseline and is forgiven. That has to be said out
   loud once, on Summary, rather than happening quietly: *"Scope baselines set from this
   job as it stands today — changes from here are tracked."*

Jobs moved back to draft/quoted/declined drop their baselines with their snapshot, same
rule as `acceptedSnapshot`.

## The classification moment

A delta is detected, but the app never decides what it means — same
control-is-the-judgement rule as the auto-on flag and sundries. *The app notices; Nicky
decides.*

**Where:** on Save of a room/exterior item/kitchen/fitted unit, when the job is
accepted+, the carrier is not flagged, it has a baseline, and `deltaRaw > £5`. That is
the moment the person who was there knows which it is. A sheet
(`openScheduleSheet()`, the existing pattern), not a `confirm()` — three outcomes,
not two:

> **Lounge is now £48.20 more than the agreed quote.**
> Radiators 0 → 1.5m².
> *[Extra work — bill it]  [Correction to the quote]  [Decide later]*

- **Extra work** → `variationDelta = true`, `variationStatus = 'pending'`. The room
  stays original scope **at its baseline**; the delta becomes a variation line named
  `"<Room> — extra work"`, and rides the whole existing sign-off / approval /
  invoice machinery from there.
- **Correction** → re-stamp `variationBaseline` from the current carrier, stamp
  `variationBaselineCorrectedAt`. Nothing is billed. The timestamp exists so a
  correction is a recorded decision rather than an absence of one.
- **Decide later** → nothing is written; the delta stays **unclassified** and nags (below).

**The £5 floor** is on the *interrupting sheet only*, never on detection. A £0.40 delta
must not throw a sheet on a phone on site, and must not be silently absorbed either —
silently absorbing money is the whole bug. Below the floor it goes straight to the nag
list.

### Unclassified deltas nag

Any carrier with a non-zero unclassified delta gets:

- a **"+£X unclassified"** row on the Variations card (On Site), tapping through to the
  same sheet;
- a plain count on Summary beside the variations line;
- counted in `variationPendingCount` so the Jobs-list chip renders outlined — an
  unclassified extra is as unfinished as an unsigned one.

An unclassified delta is **billed nowhere and excluded nowhere**: original scope reads
the baseline (so the agreed figure is never quietly inflated), and the variations
subtotal does not count it (nothing has been agreed to bill). It shows as a question,
which is what it is.

### Negative deltas are out of scope for v1

Scope that *shrank* (the client dropped a ceiling) is a credit, not a variation, and
nothing in the app takes a negative variation today —
`confirmAddFreeVariation()` rejects `value <= 0`, and `buildClientVariationLines()`
drops anything not `> 0.005`. A negative delta therefore offers **Correction** or
**Decide later** only, and the sheet says plainly that credits are recorded by amending
the quote. Pretending to price a credit through a pipeline that filters negatives out is
worse than declining to.

## Totalling — every consumer, listed

Part 1's gotcha stands and is the risk area again: *"Grep every consumer of the room
list; the duplicate-function history says don't trust memory of where they all are."*
One rule governs all of them:

> **A carrier with a classified delta prices at its BASELINE everywhere original scope
> is summed, and its delta prices separately as a variation.**

| Consumer | Change |
| --- | --- |
| `computeVariationsView()` | Emit a delta line per classified carrier. Feeds `varLabourAll`/`varTimeAll`/`varSprayAll` always, and `varLabour`/`varTime`/`varSpray` only when not declined — the **same two-accumulator rule** Part 1's v2.47.0 fix established, for the same reason. |
| Summary `tcOrig`/`ttOrig`/`sprayOrig` | Already `tcS − varLabourAll`; correct unchanged, because the delta now rides `varLabourAll`. Verify, don't assume. |
| `createXeroQuote()` | Filters on `isVariation`, so a delta room currently goes out at its **live** total. Must price non-flagged carriers at baseline. |
| `buildAcceptedQuoteSnapshot()` / `buildClientQuoteModel()` | Same: original-scope lines are baseline-priced. (On a frozen job these are read from the snapshot anyway; this matters for jobs with no snapshot, and for the amend re-capture.) |
| Final invoice (`variations[]`) | One `Variation: <Room> — extra work` line per classified delta, same `varMk`, same declined-starts-dropped rule. |
| In-app Quote ⤴ (`openClientQuote`) | Delta lines join the "Variations — extras beyond the original quote" card. |
| `buildClientVariationLines()` / `job_variations` | New `source_kind` values: **`roomdelta`**, `extdelta`, `kitchendelta`, `fittedunitdelta`. `source_kind` is a free VARCHAR so no migration — but the kinds must be distinct from `room`/`ext`/… or the `(job_id, source_kind, source_id)` unique index would collide a delta with a whole-item variation on the same carrier. `findVariationEntry()` and `adoptClientVariationAnswers()` must learn them. |
| `buildVariationQuoteLines()` (Xero variation quote) | Rides the above; verify pending-scoping still holds. |
| `variationCount` / `variationPendingCount` | Count delta lines; unclassified deltas count as pending. |
| Home / Exterior row chips | A classified delta room gets a distinct **`+ EXTRA`** chip, not `VARIATION` — the room itself is not a variation and must not read as one. |
| `quoteLineDrift()` / the drift card | A classified delta is no longer unexplained drift. Exclude it from the "which lines moved" list and say so instead: *"Lounge — £48.20 of this is a variation, see On Site."* |
| Calibration footnote | Include delta lines in "includes N variations". |
| Materials / colours / tins | **Unchanged — stay blind to the flag**, per Part 1. The paint for a delta is bought and billed as an actual like all materials. Note the consequence: a *declined* delta's paint still lands in the materials list, exactly as a declined variation room's does today. Accepted, not fixed here. |

## Gotchas

- **`calcRoom()` mutates its argument.** It calls `migrateWPFields(r)` and
  `migrateDoorFields(r)` on entry, which write normalised fields back onto the object
  passed in. Pricing the baseline must therefore run over a **throwaway deep copy**, or
  every render quietly rewrites the stored baseline it is supposed to be comparing
  against. The migrations are idempotent so the *values* would survive, but a baseline
  that the act of reading it can edit is not a baseline. `calcExtItem()` and
  `calcFittedUnit()` need the same check before they are trusted here.

- **The delta is live, the sign-off is not.** Approving a £48.20 delta and then editing
  the room again changes what was approved. Treat it as the published-price rule already
  does: a delta whose priced amount moves after approval re-publishes as pending, and
  the Variations card says the figure changed since sign-off. (The existing `WHERE
  job_variations.status = 'pending'` clause on the publish upsert already refuses to
  overwrite an answered line — so this needs an explicit check, not silence.)
- **A room can gain scope AND the rates can move.** The two-calc delta handles this
  correctly by construction, but the drift card and the delta will both have something
  to say about the same room. They must not each claim the whole difference.
- **Fitted units and the kitchen benefit most.** The kitchen is one persistent per-job
  form with no "added while accepted" moment at all, which is why its flag is manual
  (Part 1, deviation 1). A baseline gives it the moment it never had: adding six doors
  to an accepted kitchen becomes a priced, signed-off extra instead of a manual toggle
  on the whole thing.
- **Xero-imported jobs.** `variationDefaultsOn()` is OFF there because the retro-measure
  *is* the original scope. Baselines must therefore be stamped **after** the
  retro-measure, not at import — a job imported already-accepted and roomless has
  nothing to baseline, and stamping empty would make the entire measure-out one enormous
  delta. Stamp lazily on first open **only when the job has measured scope**, and treat
  a roomless imported job as having no baselines until it does.

## Build order

1. Baseline stamp + the two-calc delta (`variationDeltaOf(carrier)`), no UI. Verifiable
   against a job by console alone.
2. Classification sheet on Save + the three outcomes.
3. `computeVariationsView()` delta lines → Summary/On Site money, chips, counts.
4. Every other consumer in the table above, in one pass, with the grep the gotcha asks
   for.
5. Publish/approval kinds + the re-publish-on-change rule.
