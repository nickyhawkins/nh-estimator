# NH Estimator 2.0 — Ideas

Brainstorm, 2026-07-22. **Now the INDEX to the 2.0 specs** — all seven ideas were specced
same day (each has its own `*_SPEC.md`, linked per idea below). Still candidates, not
committed roadmap: building one starts by reading its spec, then it moves into `FEATURES.md`.

**Two corrections made while speccing (2026-07-22):**
- **The backup system is LIVE** — shipped 2026-07-15 (`1b55df0`), all seven tables incl.
  `material_actuals`, additive import, opt-in settings restore. FEATURES.md's "not built"
  was doc drift (now fixed there and in `BACKUP_SPEC.md`'s new status header). The
  sequencing note at the bottom of this file is therefore already satisfied.
- **Jobs DO have lifecycle state** — idea #2's premise was half-stale: edits #9/#14 shipped
  draft/accepted/declined/completed with timestamps and outward Xero quote-status sync.
  `JOB_PIPELINE_SPEC.md` extends that machine rather than inventing one.

| # | Idea | Spec |
|---|---|---|
| 1 | Calibration loop | `CALIBRATION_SPEC.md` (absorbs material tracking Phase 3) |
| 2 | Job pipeline | `JOB_PIPELINE_SPEC.md` |
| 3 | Scheduling | `SCHEDULING_SPEC.md` |
| 4 | Variations | `VARIATIONS_SPEC.md` |
| 5 | Final invoice builder | `FINAL_INVOICE_SPEC.md` (material tracking Phase 2(b)) |
| 6 | Job templates | `JOB_TEMPLATES_SPEC.md` |
| 7 | Photos & site notes | `SITE_NOTES_SPEC.md` (notes v1; photos gated on a storage decision) |

## The 2.0 theme

Everything shipped so far answers **"what should this job cost?"** — measuring, materials,
deposit, quote onto Xero. The day-to-day pain that's left isn't pricing, it's everything
around the job: chasing quotes, knowing what's booked when, catching extras mid-job,
getting the final invoice out, and knowing whether the numbers were actually right.

So the 2.0 shape is a loop:

**Win the job** (pipeline + chasing) → **Run the job** (day sheet, variations, schedule) →
**Close the job** (final invoice) → **Learn from the job** (calibration) → better quotes → repeat.

Material tracking Phases 0–2(a) already built the first piece of "run the job". These
ideas extend that direction rather than starting a new one.

---

## 1. The calibration loop — labour actuals + estimate-vs-actual per job

**The highest-leverage idea here, and the one the existing docs keep asking for without
providing a mechanism.** FEATURES.md currently lists at least six values flagged
"guessed — calibrate against real jobs": the sundries % (5), the spray sundries bump (3%),
sprayed wall coverage (`cwSpray` 9 m²/L), the whole exterior assumed-area set, the masonry
coverage 2×2, and `overheadMins`. Material tracking Phase 3 (margin) is explicitly parked
"needs history to be worth building". None of that history accumulates today, because only
material actuals are logged — **labour actuals don't exist anywhere**.

- **Log days/half-days on site per job.** Cheapest possible input: a tap at the end of the
  day ("on site today: full day"), or just a count typed at invoice time. No timesheets,
  no clock-in — this is one person calibrating their own model, not payroll.
- **Estimate-vs-actual screen per job** once a job is done: working days estimated vs days
  logged, `onSiteDays` vs calendar reality, materials estimated vs actuals (already
  logged), and — via the 311/314 purchase prices that already ride on the `/Items` call —
  real materials margin. This IS material tracking Phase 3, extended to labour.
- **Settings suggestions, not auto-tuning.** Across the last N finished jobs: "sprayed
  wall coverage averaged 7.6 m²/L against your 9 default" with a button to adopt the
  number into Settings. The app never silently changes its own config — same philosophy
  as the sundries judgement call ("the control is the judgement, not the code").

Why it elevates the app: every finished job becomes training data, and the quotes visibly
sharpen month by month. It also finally closes the long tail of "calibrate this" loose ends
in one structure instead of six ad-hoc reviews.

Depends on: nothing new — jobs, material actuals and the settings model all exist.

## 2. Job pipeline — Home becomes "what needs my attention"

Jobs currently have no lifecycle state; the only status anywhere is the Accepted/Declined
quote sync (shipped 2026-07-22). Extend that into a proper pipeline:

**Surveyed → Quoted → Accepted → Scheduled → In progress → Done → Invoiced → Paid**

- Jobs list groups by status instead of one flat list.
- A "needs attention" strip on Home: **quotes sent >N days ago with no answer** (chase —
  unchased quotes are lost jobs, the same "forgotten = lost money" logic that motivated
  material tracking), **accepted but not scheduled**, **done but not invoiced**.
- Quoted→Accepted/Declined can move automatically: the app stores the Xero quote ID now,
  and Xero's quote status is readable, so a poll on app-open could sync state inward —
  the reverse of the sync that just shipped. (Quotes from before 2026-07-22 have no stored
  ID and would need their status set by hand — known limitation, same as the outward sync.)
- Status changes are one tap, no ceremony — this must not become admin.

Depends on: nothing. Foundation for #3 and #5.

## 3. Scheduling from `onSiteDays` — "when can you start?"

The realistic-duration figure (`onSiteDays`) already exists per job and already drives the
staged-payment count. Use it to answer the question every client asks on the phone:

- Give an accepted job a **start date**; the app blocks out its `onSiteDays` from there.
- A simple week-strip view of booked days — NOT a calendar app. The deliberate scope line
  from the realistic-time feature still stands: "don't manage the diary".
- **"Next free slot"** computed from the booked strip — the actual thing needed mid-call.
- **ICS export/feed** so jobs land in the phone's real calendar, rather than building
  calendar UI. (Same instinct as quote templates living in iOS text replacement — lean on
  the platform.)
- Free byproduct: weekly staged-payment dates become real dates, which #5 can use.

Depends on: #2 (a job needs to be "accepted" before it's schedulable).

## 4. Variations / extras log — price the "while you're here…" properly

Classic mid-job leak: client adds "can you just do the landing ceiling too?", it's agreed
verbally, and it either gets forgotten at invoicing or priced by gut instead of by the
model. The edits doc already gestures at this from the materials side (item 3's manually
added materials with a Chargeable tickbox) — extend it to labour:

- **Add a variation to an in-progress job**: a labelled extra priced through the same
  engine (a small room entry, an exterior item, or a free-priced line with hours ×
  day-rate), kept **separate from the original quoted scope** rather than mutating it.
- The original quote stays frozen (same snapshot discipline as `materials_snapshot`);
  variations show as their own section on Summary and flow into the final invoice
  and into #1's actuals.
- Materials a variation needs ride the existing actuals/three-bucket flow unchanged.

Why it elevates: this is where real money is lost on real jobs, and it's the piece that
makes "the app runs the job" true rather than aspirational.

Depends on: #2 (needs "in progress" to exist). Feeds #5.

## 5. Final invoice builder — finish material tracking Phase 2(b)

Already on the roadmap as optional; 2.0 is where it earns its place. The last manual
re-keying step in the whole flow is assembling the final invoice in Xero by hand from the
2(a) materials list. Build the assembly:

- **quoted labour + variations (#4) + actual materials (2a) − deposit − staged payments
  already invoiced = final balance**, shown for review, then `POST /Invoices` to Xero.
- The known caveats from FEATURES.md stand: verify the `accounting.invoices` scope name
  is real (it's not a documented Xero scope) and expect a re-auth.
- Keep the 2(a) list output as the fallback path — the builder is a convenience on top,
  not a replacement, so a Xero API problem never blocks invoicing.

Depends on: #4 for variations lines (works without it, just less complete).

## 6. Job templates — duplicate a job as a starting point

Explicitly deferred when Multiple Saved Jobs shipped ("fully separate; templates layer on
from here"). The machinery is all in place: a template is just a job that gets copied with
fresh ids — which is **exactly the additive-import copy semantics `BACKUP_SPEC.md` already
defines**. A "standard 3-bed repaint" template turns a survey into adjust-and-confirm
instead of enter-from-scratch.

Cheap, contained, and probably best built **on top of the backup import code** so there's
one copy-a-job implementation, not two.

## 7. Photos & site notes per job

Survey photos (access problems, damage to note before starting, the bay window that's
hard to describe) and before/afters (disputes, and marketing later). Genuinely useful
day-to-day, but flagged with a caveat: **Render Postgres is the wrong home for image
blobs**. Needs object storage (e.g. R2/S3) or aggressive client-side compression, and
that's a new infrastructure dependency — cost it before committing. A notes-only version
(plain text per job) is nearly free and could ship first.

## Deliberately NOT 2.0

- **Client-facing portal / online quote acceptance** — Xero already sends, presents and
  accepts quotes. Duplicating it adds surface area for one person's workflow. The
  accepted-status sync already bridges the gap.
- **Full calendar/diary management, weather integration, route planning** — "realistic
  days on site" was deliberately scoped to stop short of diary territory; that line was
  right and stays.
- **Multi-user / team features** — the app's entire shape (one settings row, one person's
  judgement calls encoded as percentages) is single-operator. Don't drift.

## Sequencing note

~~**Ship the backup system first** (`BACKUP_SPEC.md`, scoped, not built).~~ **Already
shipped 2026-07-15 — see the correction at the top.** So sequencing starts clean: #1
Phase A (the labour log) and #2 Part 1 (statuses) are independent, tiny, and both start
accumulating value the day they land — they lead. #3/#4/#5 chain off #2; #5's Step 0
(the Xero scope verification) is worth doing early since it also derisks #2's inward
sync. One shared piece to build once: the `acceptedSnapshot` stamp (needed by #1's
comparison screen, #3's `scheduledDays`, and #4's frozen-quote semantics — each spec
points at the others).
