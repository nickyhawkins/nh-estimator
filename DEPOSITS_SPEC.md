# Deposits → Xero prepayments — Spec

**Status: BUILT 2026-08-19 (v2.32.0), scope gate passed and VERIFIED LIVE the same day.**
Deposits recorded in the app now create the matching **prepayment in Xero** instead of
being re-keyed by hand. Discussed and agreed before any code was written; this doc is the
agreement plus the as-built detail.

**First real one, confirmed in Xero (Prepayment INV-0526, £347.16):** right contact with
its address, **dated 27 Jul — the date received, not the 19 Aug it was created**, paid
into the chosen bank account, line reading "Deposit — <job>", **posted to `Prepayments`
(620), which Xero accepted without complaint on a prepayment line**, No VAT, sitting as
Total Credit awaiting allocation. The two things no harness could prove — whether 620 is
valid here, and whether the job name survives given Xero drops `Reference` on prepayments
— are now both answered yes. **The allocation read-back is confirmed live too:** allocating
the prepayment in Xero flips the app's chip to "allocated ✓" on the next Summary open, so
`RemainingCredit` is being read the way this doc assumes and the one-way reporting model
works end to end. Note Xero numbers the prepayment itself (`INV-0526`) out of
the invoice sequence; that number comes back on the read-back as `invoiceNumber` and is
not currently shown in the app.

**⚠ Two deploy steps, both one-off:**
1. **Reconnect Xero once** (Summary → Connect Xero) — `SCOPES` gained
   `accounting.banktransactions` and `accounting.payments`, and scopes are granted at
   auth time. Until then the first deposit write 403s (and says exactly that).
2. **Choose the deposit bank account** in Settings → Deposits (Xero). Until then deposits
   record in the app but can't be sent.

No DB migration: `job.deposit` rides `jobs.data`, the settings ride `settings.data`.

## What this replaces

The app never recorded a deposit. `computeDepositPlan()` **forecasts** one (25% of quote,
or materials + sundries, whichever is greater) and the final-invoice screen takes a
**reference-only** figure that changes nothing (`FINAL_INVOICE_SPEC.md`, the 2026-07-22
decision: invoices go out at the full amount and payments are applied in Xero). Meanwhile
the real deposit was being entered in Xero by hand, via Receive Money → "Received as
Prepayment".

So this feature is two things, and the first is worth having on its own:
1. **`job.deposit` — a record of money actually received** (amount, date, note).
2. **The push to Xero**, as a RECEIVE-PREPAYMENT bank transaction.

## The workflow change — say it out loud

**Once this ships, the deposit must NOT also be entered in Xero by hand.** The app's
transaction IS that entry; doing both double-counts against the bank feed. This is a habit
change, not just a feature, so it's stated in the sync confirm dialog every single time
(not just on first use) and in the Settings card's note.

## Xero mechanics (verified against the API spec, 2026-08-19)

- **A prepayment cannot be POSTed.** `/Prepayments` is read-only. A prepayment is born as
  a **BankTransaction of `Type: RECEIVE-PREPAYMENT`**, and Xero returns its `PrepaymentID`
  on the created transaction — so one write gets both ids and there's no matching step to
  drift.
- **Allocation** is `PUT /Prepayments/{id}/Allocations` (`{Amount, Invoice, Date}`), and is
  reversible since Xero added `DELETE /Prepayments/{id}/Allocations/{AllocationID}`.
  **Not used here** — see "deliberately not built".
- **Xero refuses to allocate against a DRAFT invoice.** The invoice builder only ever
  creates drafts, on purpose. Auto-allocating at invoice-creation time is therefore
  impossible by construction, not merely unbuilt.
- **`Idempotency-Key` is supported on POST/PUT** (128 chars) — this is what makes a retry
  safe.
- **`Reference` does not stick on a prepayment.** Xero only supports it on SPEND/RECEIVE
  bank transactions, and `Prepayment.Reference` is read-only (it returns the invoice
  number). Setting it would look right and silently vanish, so **the job name rides the
  line description** instead.
- **`RemainingCredit`** on the prepayment is the whole allocation story: equal to the total
  means nothing applied, zero means fully applied.

### Scopes — the gate that had to pass first

`accounting.transactions` is NOT permitted for this app (the 2026-07-22/23 saga). Under
**granular** scopes it is split, and the two needed here are `accounting.banktransactions`
(create the transaction) and `accounting.payments` (read the prepayment back). Both were
**proved permitted before being added** to `SCOPES`, via `GET /auth/scope-check` — the
server-side bisect added for exactly this: controls healthy, every variant ACCEPTED.
`GET /Accounts` (the bank-account picker) needs no new scope — it was already covered by
`accounting.settings.read`.

## Agreed decisions

| Question | Decision |
|---|---|
| VAT | Not registered → `LineAmountTypes: 'NoTax'`, no tax-point complexity |
| Payment methods | No card payments taken → recorded amount always equals amount banked; no net-of-fees handling, no per-payment account picker |
| Bank account | One fixed account, set in Settings |
| Posting account | **620 Prepayments** — a setting, changeable without a code change |
| Deposits per job | Exactly one. Staged payments are invoiced separately |
| Timing | Always taken *before* the invoice exists → one code path, no branching |
| Contact | A linked Xero contact is required to **sync**; recording locally is always allowed |
| Allocation | Manual, in Xero, by Nicky — as now |
| Corrections | In Xero. The app never voids or edits a synced prepayment |
| Read-back | One-way, status only. Xero is the source of truth |
| Reconciliation | The accountant's job. The app's responsibility ends at a correct prepayment |

## Data model

`job.deposit` (one object, on `jobs.data`; add to `persistJobData`'s field list or it
silently never persists — the v2.4.2 `standalone` bug):

```
amount, date, note, recordedAt          the record — never recalculates
xeroPrepaymentId, xeroBankTransactionId Xero identity
idempotencyKey                          stored, reused on retry (see below)
syncState  notSynced | synced | failed
syncedAt, lastAttemptAt, lastError
xeroStatus, remainingCredit, xeroTotal, checkedAt   read-back cache, display only
```

Nested rather than flat keys, matching `acceptedSnapshot` / `profitSnapshot`. If "one
deposit per job" ever stops being true, this becomes a list the way `fittedUnit` became
`fittedUnits`.

Settings: `depositBankAccountId`, `depositBankAccountName` (display cache for when Xero
can't be reached), `depositAccountCode` (default `'620'`). **Not** `SETTINGS_FIELDS` rows —
that table coerces every row with `+value` and these are a GUID and a code; they're
carried forward in `saveSettings`/`mergeSettings` like `bankHolidayRegion`.

### The idempotency key is the anti-duplicate mechanism

Generated **once per deposit** and reused for every retry, so Xero replays the original
result instead of writing a second prepayment. It is regenerated in exactly two cases:
the amount or date changed before the deposit ever landed (it's a different deposit now),
or the prepayment was voided/deleted in Xero and is being re-created (a new transaction —
reusing the key would replay the dead one).

**Known limit:** Xero retains keys for about a day, so this protects same-session retries,
not a retry next week. A retry that old should be checked against Xero first.

## UI

- **Settings → Deposits (Xero)**: bank account picker (fetched on demand; falls back to the
  remembered name offline so it never looks like the setting was lost) + posting account
  code + the don't-also-do-it-by-hand note.
- **Summary status card, from `accepted` onward**: the deposit block, mirroring
  `scheduleBlockHtml` — inline form when open, one state line when closed:
  - not recorded → "No deposit recorded — plan says £X" + **Record deposit ›**
  - recorded → "£500 · received 18 Aug" + state: *not in Xero yet* / *in Xero ·
    unallocated|allocated ✓|part-allocated* / *sync failed — <the real Xero message>* /
    *voided in Xero*, plus **Sync to Xero** / **Try again** / **Re-create in Xero**
  - **scope-change flag** when the plan has since moved: "plan now £550 — £150 more than
    was taken". Deliberately job-local and NOT an attention-strip line: every job with a
    variation would trip it, and a strip that cries wolf stops being read.
- **Home attention strip**: "Deposit not in Xero" (failed/voided at once; merely unsent
  after a day's grace, so recording one in a dead spot doesn't nag immediately) and
  "£500 deposit held, no invoice" after 30 days.

## Error handling

- Xero actions are **blocked offline, never queued** (`blockIfOffline`) — same rule as
  Send to Xero and Build final invoice. The offline queue is for the app's own database; a
  queued financial write firing later unattended is not something to want.
- A failure sets `syncState: 'failed'` + the real Xero message (`xeroErrorMessage`, so
  validation errors surface instead of "status code 400") and changes nothing else. The
  local record always survives.
- 401/403 says "Xero needs reconnecting once", because that's what it almost always means
  after this release.
- The posting account is pre-flighted, but **only a positive "Xero says 620 is missing or
  archived" blocks the write** — if the lookup itself fails, the real call is the judge.
  Refusing to record a deposit over a failed diagnostic would be worse than the thing it
  diagnoses.
- If Xero creates the transaction but returns no `PrepaymentID`, that reports as a
  **success with a warning**, never an error: an error would invite a retry, and a retry
  would be a second deposit.

## Deliberately NOT built

- **Allocation from the app.** Impossible against drafts, and a few taps in Xero where
  it's already being done. Revisit only if the manual step proves error-prone.
- **Void / delete / edit of a synced prepayment.** The app creates and reports; Xero
  corrects. Unwinding financial records from a phone is how audit trails get lost.
- **Multiple deposits, split allocations, card-fee handling** — no such jobs exist.

## Gotchas

- **The first real one was watched, and passed** — see the status note above. The
  extracted-function checks (39 assertions over the payload builder and the card's states)
  stand as the regression net; the live run is what proved 620 and the description.
- **Job names show as-is in Xero.** The line reads `Deposit — ` + the job's Xero reference
  or name, which for a job named after its client reads "Deposit — Laura Holmes". Two jobs
  for the same client would produce two indistinguishable prepayment lines; name the second
  one for the work if that ever comes up.
- **620 is a current asset in Xero's default UK chart** ("Prepayments" = money *paid* in
  advance), whereas a customer deposit you're holding is arguably a liability. This is
  Nicky's established practice and the app follows it — but it's on record here as a
  decision rather than an inheritance, and it's one settings field to change.
- **The date is the date received, not today** — the bank feed has to match it.
- Recording a deposit with no linked Xero contact is allowed; **syncing it isn't**. A
  prepayment against a by-name contact can land on a second Xero contact of the same name,
  and then it can never be allocated to the invoice.
