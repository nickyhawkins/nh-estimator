# Scheduling — Spec (start dates, week strip, next free slot, ICS)

**Status: SCOPED 2026-07-22, not built.** Idea #3 in `FEATURES_2.0_IDEAS.md`.
Depends on `JOB_PIPELINE_SPEC.md` Part 1 (schedules hang off accepted jobs).

## Purpose

`onSiteDays` (`realisticDays()`, `public/index.html:~3050`) already answers "how long will
this job take on site" — it exists to be scheduled with and currently only drives the
staged-payment count. This feature uses it to answer the phone-call question: **"when can
you start?"** Scope line inherited from the realistic-time feature and still binding:
*"don't manage the diary"*. This is booked-days arithmetic, not a calendar app.

## Data model — no new tables

All on `jobs.data`, written via existing `persistJobData()`:

```
{
  startDate: "2026-08-03",     // ISO date, null = unscheduled
  scheduledDays: 4,            // SNAPSHOT of ceil(onSiteDays) taken when scheduled
  workSaturdays: undefined     // job-level override of the setting, rarely used
}
```

**Why `scheduledDays` is a snapshot, not computed live — load-bearing gotcha.** The engine
computes `onSiteDays` from the ACTIVE job's in-memory rooms/extItems. The week strip needs
every scheduled job's length at once, and loading every job's rooms to get it would repeat
the exact architecture the app avoids. So the number is stamped at scheduling time.
`CALIBRATION_SPEC.md` needs the same stamp (`acceptedSnapshot` on acceptance) — **build one
mechanism**: acceptance stamps `acceptedSnapshot` (incl. `estOnSiteDays`), and scheduling
defaults `scheduledDays` from it, editable at the moment of scheduling ("blocks out N days
— change?"). Re-scheduling re-offers the current engine figure if the job is active.

New Settings: `workSaturdays` (default off — working days are Mon–Fri), `icsEnabled`
(default off, see ICS section).

## UI

### Scheduling a job

On an accepted job (Jobs list row + Summary): **"Schedule ›"** → a date picker prefilled
with the **next free slot** (below) + the days figure → save. That's the whole flow.
Unscheduling = clearing the date. The pipeline's attention strip drops its "not scheduled"
line the moment `startDate` lands.

### Week strip

A screen off the hamburger ("Schedule"). Vertical list of week rows (Mon–Fri/Sat), current
week first, scrolling forward ~12 weeks; each booked day is a colour block with the job
name. Tap a block → that job. Nothing draggable in v1 — rescheduling goes through the same
date picker. Jobs spanning weeks just continue on the next row.

- **Overlaps are allowed and shown stacked, with a soft warning at scheduling time**
  ("overlaps {job} by 2 days"). Real life has overlapping jobs (second coat drying at one,
  starting the next); a hard block would make the tool lie or get abandoned. The strip
  shows the truth and Nicky judges — same philosophy as the sundries control.
- Weekends render compressed/grey unless `workSaturdays`.
- Completed jobs drop off the strip; past weeks aren't rendered (history lives in the
  labour log, not here).

### Next free slot

`nextFreeSlot(requiredDays)`: walk working days from tomorrow, skipping days covered by any
scheduled job (`startDate` + `scheduledDays` working-day span), return the first gap ≥
`requiredDays`. Shown in three places: prefilling the date picker, a line on Summary for
accepted-unscheduled jobs ("could start Mon 3 Aug"), and on the strip header. It's an
answer, not an auto-booking.

### Staged-payment dates (free byproduct)

`computeDepositPlan()` derives N weekly instalments; once a start date exists, those
become real dates (`startDate + 7n`) — show them on the Summary payment schedule and in
`buildPaymentTermsText()` when scheduled ("balance in 2 weekly payments (w/c 10 Aug,
17 Aug)" instead of just "2 weekly payments"). Quote text only changes when a date exists
at send time — most quotes are sent before scheduling and stay as today.

## ICS feed — lean on the platform

Jobs should land in the phone's real calendar; the app should not grow calendar UI beyond
the strip. Two options, **build (a), skip (b)**:

- **(a) `GET /api/schedule.ics`** — server generates a VCALENDAR of one all-day multi-day
  VEVENT per scheduled job (name + client from the retained contact data, edits #12).
  Server reads `jobs.data` directly, which is exactly why `scheduledDays` had to live
  there. Subscribed once in iOS as a calendar URL → auto-refreshes; reschedules propagate.
  **Auth gotcha: iOS calendar subscription can't ride the app's session cookie.** The URL
  must carry its own token — `?key=<long random>` generated once, stored in settings,
  shown in Settings for the one-time subscribe. Off (`404`) until `icsEnabled` — don't
  ship an unauthenticated always-on endpoint by default.
- (b) per-job .ics file download — no auth problem but stale the moment anything moves;
  worse than (a) in every way that matters here. Not built.

## Build order

1. `acceptedSnapshot` stamp (shared with calibration — whoever builds first builds it)
2. startDate/scheduledDays + Schedule flow + next-free-slot + attention-strip hook
3. Week strip screen
4. Payment dates on Summary/terms text
5. ICS feed (isolated, any time after 2)

## Gotchas / for Nicky to confirm

- Working-day walk must share ONE helper (`addWorkingDays(date, n, workSaturdays)`) used by
  slot-finding, strip rendering, payment dates and ICS — four hand-rolled date loops is
  the duplicate-function failure mode this repo already knows.
- Bank holidays are ignored in v1 (a UK holiday table is a maintenance commitment; the
  strip being one day optimistic occasionally is acceptable). Confirm Nicky's fine with it.
- `scheduledDays` snapshot can drift from reality if rooms change substantially after
  scheduling — the Summary already shows live `onSiteDays`; when it differs from the
  stamped figure by ≥1 day, show "estimate now ~5 days, scheduled 4 — Reschedule?". Nudge,
  not auto-change.
- Multi-week jobs assume contiguous days. Deliberately: modelling "3 days this week, 2
  next" is diary territory. The overlap tolerance covers the practical cases.
