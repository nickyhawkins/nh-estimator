# Job Pipeline — Spec (lifecycle statuses + attention strip + inward Xero sync)

**Status: SCOPED 2026-07-22, not built.** Idea #2 in `FEATURES_2.0_IDEAS.md`.

## What already exists — build on it, don't replace it

The 2.0 ideas doc originally said "jobs have no lifecycle state". **Wrong — half of this
feature shipped as edits #9 and #14.** `setJobStatusById()` (`public/index.html:2202`)
already implements a single-status machine on `job.status`:

- `null` (draft) / `'accepted'` / `'declined'` / `'completed'`, with
  `acceptedAt`/`declinedAt`/`completedAt` timestamps, persisted in `jobs.data` JSONB via
  `persistJobData()` and mirrored to `localStorage['pe-jobs']`.
- `'completed'` is only reachable from `'accepted'` and preserves `acceptedAt`.
- Accepted/Declined pushes to the Xero quote best-effort (`syncQuoteStatusToXero()`,
  `POST /auth/update-quote-status`), never blocking the in-app change; "move to draft"
  reverts a synced answer to SENT.
- The Jobs list already groups: Completed (greyed/strikethrough) above Declined.
- `job.xeroQuoteId` is stored when Send to Xero creates the quote (re-send re-links).

This spec extends that machine and puts it to work. Three parts:

1. **Part 1 — two new statuses** (`quoted`, `invoiced`)
2. **Part 2 — the attention strip** on Home
3. **Part 3 — inward Xero sync** (quote answers arrive without being typed)

## Part 1 — extend the status machine

Full lifecycle after this spec:

```
draft (null) ──send to Xero──▶ quoted ──▶ accepted ──▶ completed ──▶ invoiced
                                 │                                      (paid: see below)
                                 └──────▶ declined
```

- **`'quoted'` — set automatically** when Send to Xero succeeds (the same code path that
  stores `job.xeroQuoteId`), with `quotedAt`. Manual set also possible from the Jobs list
  for the rare quote produced outside the app. Re-sending an already-quoted job just
  refreshes `quotedAt`. Draft⇄quoted is freely reversible.
- **`'invoiced'` — manual** in v1 (one tap from the Jobs list on a completed job), with
  `invoicedAt`. When `FINAL_INVOICE_SPEC.md` ships, its successful `POST /Invoices` sets
  it automatically — same pattern as quoted.
- **`'scheduled'` and `'in progress'` are deliberately NOT statuses.** Scheduled-ness is
  `job.startDate != null` (see `SCHEDULING_SPEC.md`) and in-progress-ness is "accepted with
  labour days logged" (`CALIBRATION_SPEC.md`) — both are **derived facts, shown as chips**
  on an accepted job, not states to maintain by hand. Fewer manual transitions = the
  machine stays true. (This also keeps `setJobStatusById()`'s invariant simple: one linear
  path plus the declined branch.)
- **'paid' — decide before building, recommendation: leave it out.** Payment truth lives in
  Xero (part-payments, staged invoices, bank feeds); mirroring it manually invites drift,
  and the reliable read (Xero invoice status) belongs to the final-invoice feature. v1
  ends at `invoiced`; revisit only if end-of-pipeline tracking is genuinely missed.
- Status transitions stay ONE tap, no forms. All new timestamps ride `jobs.data` like the
  existing ones — **no schema change in this whole spec.**
- `setJobStatusById()` grows the new cases; the existing accepted/declined/completed logic
  (incl. Xero push and the completed-keeps-acceptedAt rule) is untouched. Add `quotedAt`
  to the "which timestamps clear on transition" table with the same care — moving a quoted
  job back to draft keeps its `xeroQuoteId` (the quote still exists in Xero) but a fresh
  Send re-links, as today.

### Jobs list

Group by status, collapsible headers, order: **Needs attention** (see Part 2, same rules) ·
**In progress** (accepted, derived chips shown) · **Quoted** · **Draft** · **Completed** ·
**Invoiced** · **Declined**. Counts on headers. Default-collapse Invoiced and Declined —
they're archive, not work.

## Part 2 — attention strip (Home)

A card at the top of Home, only rendered when non-empty — silence is the success state.
Each line is tappable → opens/switches to that job. Rules, all cheap derivations over the
already-loaded `jobs` array:

| Trigger | Line | Why |
|---|---|---|
| `quoted` and `now − quotedAt > chaseDays` (Setting, default 14) and no Xero answer | "Quote to chase — {name}, sent N days ago" | unchased quotes are lost jobs |
| `accepted` and no `startDate` (once scheduling ships) | "Not scheduled — {name}" | booked work with no date slips |
| `completed` and `now − completedAt > 3 days` and not `invoiced` | "Not invoiced — {name}, finished N days ago" | forgotten invoice = lost money, the app's founding motivation |
| last backup export > 28 days ago | "No backup for N weeks" | see `BACKUP_SPEC.md` — export discipline is on Nicky; record `lastBackupExportAt` in settings when `exportBackup()` succeeds |

- No dismissal mechanism in v1 — lines clear by doing the thing (chase → tap the line,
  which offers "mark declined / remind me again in 7 days"? **No — keep v1 dumber**: the
  line just persists until status changes; a `chaseSnoozedUntil` per job is the v1.5 if
  it nags wrongly).
- Not push notifications, not emails — a strip on a screen already opened daily. The app
  stays a tool, not a boss.

## Part 3 — inward Xero sync

Item 14 built the outward half (app → Xero). Clients accept quotes through Xero's own
portal/email too — today that answer must be re-typed into the app. Close the loop:

- **New endpoint `GET /auth/quote-statuses?ids=…`** in `routes/xero.js`: batch-reads the
  quotes (reuse the `GET /Quotes/{id}` pattern from `update-quote-status`, or one
  `GET /Quotes` filtered call if the id list is long) and returns `{quoteId, status}` pairs.
- **Client polls on app open** (`initApp()`, after jobs load, fire-and-forget like the
  outward sync) for jobs in `quoted` with an `xeroQuoteId`:
  - Xero `ACCEPTED` → `setJobStatusById(id,'accepted')` — **suppressing the outward push**
    (it would write ACCEPTED back at Xero pointlessly; add a `skipXeroSync` arg).
  - Xero `DECLINED` → same, to declined.
  - Xero `INVOICED` → job was accepted and invoiced entirely in Xero; move to `accepted`
    and surface a chip ("invoiced in Xero") rather than jumping the app's own
    completed/invoiced steps — the app's completed means *work finished*, which Xero can't
    know.
  - Xero `DELETED` → clear `xeroQuoteId` and show un-synced state; don't change status.
- **Conflict rule: the app's answer wins.** If the app already says accepted/declined
  (Nicky tapped it), inward sync never overrides it — inward only ever advances a `quoted`
  job. This keeps the existing "app is the source of truth" contract from item 14 intact
  in both directions.
- Jobs from before item 14 have no `xeroQuoteId` — skipped, as with outward sync.
- Failures are silent (it's a poll, next open retries) — unlike outward, nothing was lost.

## Build order

1. Part 1 statuses + Jobs list grouping (pure client + existing persistence; smallest)
2. Part 2 strip (needs Part 1's `quotedAt`; backup line needs the settings stamp — trivial)
3. Part 3 inward sync (server endpoint + poll; verify against live Xero like item 14 —
   same "watch the first real one" caveat)

## Gotchas

- **`pe-jobs` localStorage sync**: every new field rides the existing save points
  (`persistJobData` + the localStorage write in `setJobStatusById`) — grep for both, the
  dual-write is easy to half-miss (the recurring failure mode: two sources of truth).
- The multi-device resurrect bug (edits #1) was fixed by trusting server responses even
  when empty — status fields live in `jobs.data`, which that fix already covers. Don't
  add any status caching outside `pe-jobs`.
- `renderSummary()` shows status controls (`index.html:7245`) — new statuses need the
  Summary card kept coherent (a quoted job shows "quote sent N days ago", an invoiced one
  goes read-only-ish). Sweep every `job.status` read; grep, don't assume the three call
  sites currently known are all of them.
- Inward sync + outward sync must not ping-pong: the `skipXeroSync` arg on
  `setJobStatusById` is load-bearing, and `xeroQuoteStatus` must be updated by inward
  sync too so the outward "skip repeat pushes" guard sees the truth.
