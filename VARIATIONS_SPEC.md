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

- **Auto-on**: any room/ext/kitchen/panelling item added while `job.status` is `accepted`
  (or later) defaults `isVariation: true`, with a visible chip on the form so it's never
  silent. Toggleable off at entry — "I forgot to measure the utility room before quoting"
  is a correction to original scope, not a variation, and the person on site knows which
  it is. The app defaults; Nicky decides. (Same control-is-the-judgement philosophy as
  sundries.)
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
