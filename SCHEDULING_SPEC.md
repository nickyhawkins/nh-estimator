# Scheduling — Spec (start dates, week strip, next free slot, ICS)

**Status: BUILT 2026-07-22 (same day as scoping), all five build-order items** (item 1,
the `acceptedSnapshot` stamp, had already shipped with pipeline Part 1). Idea #3 in
`FEATURES_2.0_IDEAS.md`. Depends on `JOB_PIPELINE_SPEC.md` Part 1 (schedules hang off
accepted jobs).

**As built:** one working-day walker (`isWorkingDay`/`workingDaySpan`) shared by
slot-finding, the strip, payment dates — and mirrored server-side for ICS
(`icsWorkingDaySpan` in `routes/api.js`, parity-tested against the client copy). The
Schedule flow lives in the Summary status card's accepted branch: "Not scheduled — could
start {slot} · Schedule ›" opens a date+days form (date prefilled from `nextFreeSlot`,
days from `acceptedSnapshot.estOnSiteDays`, live "overlaps {job} by N days" warning),
with Reschedule/Unschedule and the ≥1-day drift nudge once scheduled. The attention
strip's "Not scheduled" line landed with it; accepted Jobs-list rows show "Starts {date}
· Nd". The week strip is a "Schedule" screen off the hamburger: 12 week rows from the
current Monday, past days dimmed, today outlined, stacked colour blocks tap through to
the job, header shows the next free day. Weekly instalments show "w/c {date}" on Summary
and in the quote's Terms text — only when a start date exists at send time. ICS shipped
as option (a): `GET /api/schedule.ics?key=…`, 404 until the Settings "Calendar feed"
toggle generates the 128-bit key; one all-day multi-day VEVENT per scheduled accepted
job. Deliberate deviations: **Sundays are omitted from the strip entirely** (and
Saturdays only appear when Work Saturdays is on) rather than rendered compressed-grey —
same information, less noise on a phone; **job-level `workSaturdays` override is honoured
by all the maths but has no UI** (set it if the rare case ever arrives); **leaving
`accepted` keeps `startDate`/`scheduledDays` stored** — the job just stops occupying
days, and the schedule resurfaces if it's re-accepted. Verified in the 27-check Chromium
smoke run (schedule flow end-to-end, overlap warning, strip line clearing, ICS key/URL,
toggles) plus working-day-math harnesses incl. weekend spans and client/server parity.

**Addendum 2026-07-23 (v1.12.1) — weekend-aware slot suggestions:** `nextFreeSlot()`
now prefers starts that keep a job in one piece. A job that fits inside one working
week gets the earliest free start whose span doesn't cross a weekend (a 2-day job can
start Wednesday; a 4-day job waits for Monday); a job longer than a working week must
span weekends anyway, so it prefers a Monday start (whole weeks). If no preferred
start exists in the horizon, the earliest merely-free day is the fallback — it's a
suggestion, and the date stays editable. Same slice: Mark Completed joined the On
Site header (accepted jobs — the run-to-close arc without leaving the screen), and
On Site's Variations section moved below Materials to match the daily rhythm.

**Addendum 2026-07-23 (v1.16.0) — calendar-app parity (per Nicky, from her
calendar screenshots).** The Schedule screen is now a real calendar, three views
behind a topbar segment (List | Weeks | Month, choice remembered): List is the
chronological bookings (+ a "Not scheduled" section with could-start slots),
Weeks is the old 12-week strip, Month is a paged month grid (‹ › into past
months too — completed/invoiced jobs keep their stamped days and render as
greyed history bars; slot maths still ignores them). Jobs draw as CONTINUOUS
bars spanning their booked days (lane-stacked when overlapping, squared edges
where a job continues across a week boundary, stable per-job colour from an id
hash) instead of a chip repeated per cell. Rows are now full Mon–Sun with
weekends dimmed — supersedes the v1 "Sundays omitted entirely" deviation.
Interactions: tap a bar → bottom sheet (Open job / Move start date /
Unschedule); tap a day → day sheet (that day's jobs, plus "Start a job here"
listing accepted-unscheduled jobs, today-or-later only); Move is tap-to-move
(banner + tap the new start day), never drag — with the same overlap warning in
the confirm. A tapped Sat/Sun/holiday start rolls forward to the next working
day and the confirm says so. **Bank holidays are in** (supersedes the "ignored
in v1" gotcha): `GET /api/bank-holidays` proxies gov.uk's JSON (24h server
cache, trimmed to date+title per division), the client caches it in
localStorage and treats holidays as non-working days in THE one walker — so
spans, slot suggestions and the strip all skip them, and the server's ICS twin
skips the same dates from the same cache (parity-harness-checked). Region is a
Settings select (`bankHolidayRegion`, default `england-and-wales` — corrected
v1.16.1: v1.16.0 guessed N. Ireland from a Battle of the Boyne entry on
Nicky's phone, which turned out to be iOS's all-UK holiday calendar, and she's
in England; the default lives in BOTH client mergeSettings and the ICS route). If gov.uk is unreachable and no cache
exists, everything degrades to the pre-holiday behaviour — no error surfaces.
Verified by a 25-check Chromium smoke run (all three views, spanning/stacking,
past-month history, both sheets, tap-to-schedule, tap-to-move incl. weekend
roll-forward, region select) plus an 800-span client/server parity harness.

**Addendum 2026-07-22 (v1.9.1, revised v1.10.2):** the Schedule form gained an optional
**calendar title** (`job.scheduleTitle`) — job names are usually the client's name, so
the ICS feed's `name — client` events read as "Smith — Smith". Per Nicky the title
EXTENDS the name rather than replacing it: with a title, the event (and the week strip's
blocks) read **"job name — schedule title"**; with no title, the fallback dedupes
name-equals-client (case-insensitive) instead of repeating it.

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
