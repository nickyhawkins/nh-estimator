# Debt Plan App — Feature Roadmap

This document describes the next phase of features to be built into the debt plan app. Features are listed in build order — each one builds on or complements the previous. Reference the original handoff document (`claude-code-handoff.md`) for the full app spec, data schema, and existing architecture.

---

## Current state (baseline)

- Express server serving the debt app at `/debt`
- PostgreSQL database with tables: `debt_plan_debts`, `debt_plan_settings`, `debt_plan_cashflow`, `debt_plan_income_log`
- Full client-side simulation (simulate, getCyclePayments, getCurrentTarget, getMilestones)
- Cash flow cycle with business/personal pot split
- Two-phase payoff: arrears first (highest first), then snowball (smallest balance first)
- New cycle flow archives nothing currently — just clears income log and paid list
- HMRC sits outside the snowball as a reminder card with no minimum payment set

---

## Feature 1 — Payment history

### What it does
When a new cycle starts, instead of discarding the current cycle's data, archive it as a completed cycle record. Nothing ever gets deleted. A new History tab shows past cycles as a timeline of progress.

### Why first
The history table is the foundation for the annual summary (Feature 7). Build it now so data accumulates from day one.

### Database changes

```sql
CREATE TABLE debt_plan_cycle_history (
  id SERIAL PRIMARY KEY,
  cycle_number INTEGER,
  started_at TIMESTAMP,
  closed_at TIMESTAMP DEFAULT NOW(),
  total_income NUMERIC,
  total_paid NUMERIC,
  biz_pot_close NUMERIC,
  per_pot_close NUMERIC,
  debts_paid JSONB,        -- array of {id, name, amount} for debts ticked this cycle
  debt_snapshot JSONB,     -- full array of debt balances at cycle close
  notes TEXT
);
```

### API changes

**Modify `POST /debt/api/new-cycle`**
Before clearing the current cycle, write a record to `debt_plan_cycle_history`:
- `cycle_number` — increment from last record (or 1 if first)
- `started_at` — timestamp of when the current cycle began (add `cycle_started_at` to `debt_plan_settings`)
- `closed_at` — now
- `total_income` — sum of `debt_plan_income_log.amount`
- `total_paid` — sum of amounts for paid debt IDs from `debt_plan_cashflow.paid_this_cycle`
- `biz_pot_close` / `per_pot_close` — current pot balances
- `debts_paid` — array of paid debt details from current cycle
- `debt_snapshot` — current state of all debts (id, name, balance, arrears)

Also add `cycle_started_at TIMESTAMP` to `debt_plan_settings` and set it to `NOW()` each time a new cycle starts.

**Add `GET /debt/api/history`**
Returns all rows from `debt_plan_cycle_history` ordered by `closed_at DESC`.

### Frontend changes

**Modify new cycle flow**
The `confirmNewCycle()` function calls `POST /debt/api/new-cycle` which now handles archiving server-side before clearing.

**Add History tab**
Add a `history` tab between `milestones` and `edit`. Display:
- Each cycle as a card showing: cycle number, date range, total income, total paid, debt balance at close
- Progress bar showing how much total debt reduced cycle-on-cycle
- A "debts paid this cycle" list if any debts were fully cleared
- Running total at top: total paid across all cycles, total debt reduction

---

## Feature 2 — Debt-free countdown

### What it does
A prominent countdown on the Cash Flow home screen showing how many months remain until debt-free, based on the current simulation.

### Why here
Quick win. The simulation already returns the month count — this is purely a display change. Do it while history is settling.

### Frontend changes only

In the Cash Flow view, below the bills pot cards and above the cycle payments section, add:

```
DEBT-FREE IN
X months · Month Year
```

- Pull `totalMonths` from the existing `simulate(debts, budget)` call already running in `renderAll()`
- Convert to a human label using existing `getMonthLabel(totalMonths, false)`
- Style: subtle, not dominant — this is motivational context, not the primary action
- Update automatically whenever budget slider moves or debts are edited

No backend changes needed.

---

## Feature 3 — HMRC as a proper debt

### What it does
Once a Time to Pay arrangement is agreed with HMRC, update the HMRC record so it joins the payment cycle properly with a real minimum payment and due date. The reminder card in the UI retires automatically once a minimum payment is set.

### This is a data change, not a code change

**When the arrangement is agreed:**
1. Go to Edit Debts tab in the app
2. Update HMRC (id=11):
   - Set `min` to the agreed monthly payment amount
   - Set `due` to the agreed payment date (day of month)
   - Update `note` to something like "Time to Pay — agreed [date]"
3. Save

**The app will automatically:**
- Include HMRC in the cycle payment tick-list
- Include it in the pot split calculations (business pot, since `account=business`)
- Show it in the snowball schedule once arrears phase ends
- Retire the yellow reminder card (it only shows when `min === 0`)

**One small code change needed:**
The surplus logic in `getCurrentTarget()` currently excludes HMRC (`d.id !== 11`). Once HMRC has a real minimum payment, remove this exclusion so surplus can be applied to it during the snowball phase. Add a comment in the code flagging this so it's easy to find:

```javascript
// TODO: remove HMRC exclusion (id 11) once Time to Pay is set up
const active = debts.filter(d => d.balance > 0.005 && d.id !== 11);
```

---

## Feature 4 — Push notifications

### What it does
Daily server-side check: for each debt with a due date that hasn't been ticked in the current cycle, if it's due within 3 days, fire a push notification to the user's phone.

### Service: ntfy.sh
- Free, no account needed for basic use
- iPhone app available (App Store: "ntfy")
- User subscribes to a private topic (a random string they choose, e.g. `nicky-debt-plan-a7x3k`)
- Server POSTs to `https://ntfy.sh/{topic}` to send a notification
- No API key needed for public topics (the random string is the security)

### Setup steps for user
1. Install ntfy app on iPhone
2. Subscribe to your private topic (e.g. `nicky-debt-plan-a7x3k` — use something random)
3. Add the topic string to Render environment variables as `NTFY_TOPIC`
4. Add `NTFY_BASE_URL=https://ntfy.sh` to Render environment variables

### Database changes

```sql
-- Add to debt_plan_settings
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS notify_days_before INTEGER DEFAULT 3;
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
```

### API changes

**Add `POST /debt/api/notify-test`**
Sends a test notification immediately so the user can verify setup before the cron runs.

```javascript
// Test endpoint
app.post('/debt/api/notify-test', async (req, res) => {
  await fetch(`${process.env.NTFY_BASE_URL}/${process.env.NTFY_TOPIC}`, {
    method: 'POST',
    body: 'Test notification from your debt plan app ✓',
    headers: { 'Title': 'Debt Plan — test', 'Priority': 'default' }
  });
  res.json({ ok: true });
});
```

**Add the notification logic (called by cron)**

```javascript
async function sendDueNotifications() {
  const settings = await getSettings();
  if (!settings.notifications_enabled) return;

  const debts = await getDebts();
  const cashflow = await getCashflow();
  const paidIds = cashflow.paid_this_cycle || [];
  const today = new Date().getDate();
  const daysAhead = settings.notify_days_before || 3;

  for (const debt of debts) {
    if (!debt.due || debt.min <= 0) continue;
    if (paidIds.includes(debt.id)) continue; // already paid this cycle

    const daysUntilDue = ((debt.due - today + 31) % 31);
    if (daysUntilDue <= daysAhead && daysUntilDue >= 0) {
      const urgency = daysUntilDue === 0 ? 'DUE TODAY' : `due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`;
      const body = `${debt.name} — £${debt.min.toFixed(2)} ${urgency}`;
      const priority = daysUntilDue === 0 ? 'high' : daysUntilDue === 1 ? 'high' : 'default';

      await fetch(`${process.env.NTFY_BASE_URL}/${process.env.NTFY_TOPIC}`, {
        method: 'POST',
        body,
        headers: {
          'Title': 'Debt Plan — payment due',
          'Priority': priority,
          'Tags': daysUntilDue === 0 ? 'warning' : 'calendar'
        }
      });
    }
  }
}
```

### Render cron job

In `render.yaml` or via the Render dashboard, add a cron job:
- Command: `node scripts/notify.js` (or inline if using a single server file)
- Schedule: `0 8 * * *` (8am every day)

Alternatively, use `node-cron` inside the Express server if a separate cron service isn't preferred:

```javascript
import cron from 'node-cron';
cron.schedule('0 8 * * *', sendDueNotifications);
```

### Frontend changes

Add a small Notifications section to the sweep settings card at the bottom of the Cash Flow tab:
- Toggle to enable/disable notifications
- "Days before" selector (1, 2, or 3)
- "Send test notification" button → calls `POST /debt/api/notify-test`

---

## Feature 5 — Recurring cycle auto-reset prompt

### What it does
The server detects when it's been more than 28 days since the last cycle started and either sends a push notification or shows a banner in the app prompting the user to start a new cycle.

### Depends on
Feature 4 (push notifications) and the `cycle_started_at` timestamp added in Feature 1.

### Server-side addition

Add to the daily cron job (runs alongside due date notifications):

```javascript
async function checkCycleReset() {
  const settings = await getSettings();
  if (!settings.cycle_started_at) return;

  const daysSinceStart = Math.floor(
    (Date.now() - new Date(settings.cycle_started_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceStart >= 28) {
    await fetch(`${process.env.NTFY_BASE_URL}/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      body: `Your payment cycle is ${daysSinceStart} days old — time to start a new one and sync your balances.`,
      headers: {
        'Title': 'Debt Plan — new cycle due',
        'Priority': 'default',
        'Tags': 'recycle'
      }
    });
  }
}
```

### Frontend changes

**Add `GET /debt/api/cycle-status`** endpoint that returns:
```json
{ "days_since_start": 31, "prompt_reset": true }
```

On page load, if `prompt_reset` is true, show a banner above the cycle payments card:

```
📅 Your cycle is 31 days old — ready to start a new one?
[Start new cycle]
```

Style it subtly — amber border, not alarming. The user can dismiss it and it won't reappear until the next page load.

---

## Feature 6 — Multi-device conflict handling

### What it does
Prevents one device silently overwriting data saved on another. Uses timestamps to detect stale writes and notifies the user rather than silently losing data.

### Database changes

Add `updated_at TIMESTAMP DEFAULT NOW()` to all main tables if not already present:

```sql
ALTER TABLE debt_plan_debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE debt_plan_cashflow ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE debt_plan_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
```

Add a trigger to auto-update `updated_at` on each table:

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER debt_plan_debts_updated_at
  BEFORE UPDATE ON debt_plan_debts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Repeat for cashflow and settings tables
```

### API changes

All write endpoints (`POST /debt/api/debts`, `POST /debt/api/cashflow`, `POST /debt/api/settings`) now accept an optional `client_updated_at` timestamp in the request body.

If `client_updated_at` is provided and is older than the server's `updated_at`, reject the write:

```javascript
app.post('/debt/api/cashflow', async (req, res) => {
  const { client_updated_at, ...data } = req.body;

  if (client_updated_at) {
    const current = await db.query('SELECT updated_at FROM debt_plan_cashflow LIMIT 1');
    const serverTime = new Date(current.rows[0]?.updated_at);
    const clientTime = new Date(client_updated_at);

    if (clientTime < serverTime) {
      const fresh = await getCashflow();
      return res.status(409).json({
        conflict: true,
        message: 'Updated on another device',
        current: fresh
      });
    }
  }

  // proceed with write
});
```

### Frontend changes

When any API save call returns a 409 conflict:
- Show a banner: "Updated on another device — your changes weren't saved. Refreshed to latest."
- Hydrate state from the `current` data returned in the 409 response
- Call `renderAll()` to reflect the fresh data

The frontend should send `client_updated_at` (stored in a local variable, set when state is loaded from the API) with every write request.

In practice this will almost never fire for a single user, but it prevents the one scenario where a phone and laptop are both open simultaneously.

---

## Feature 7 — Annual summary / tax year view

### What it does
Groups completed cycle history by UK tax year (6 April to 5 April) and shows a clean annual summary: income logged, paid to debts, estimated interest paid, savings swept, and debt balance reduction.

### Depends on
Feature 1 (payment history table must have data).

### No new database tables needed
All data comes from `debt_plan_cycle_history`.

### API changes

**Add `GET /debt/api/summary/annual`**

```javascript
app.get('/debt/api/summary/annual', async (req, res) => {
  const history = await db.query(
    'SELECT * FROM debt_plan_cycle_history ORDER BY closed_at ASC'
  );

  // Group by UK tax year
  const byYear = {};
  for (const cycle of history.rows) {
    const d = new Date(cycle.closed_at);
    const taxYear = d.getMonth() < 3 || (d.getMonth() === 3 && d.getDate() <= 5)
      ? `${d.getFullYear() - 1}/${d.getFullYear()}`
      : `${d.getFullYear()}/${d.getFullYear() + 1}`;

    if (!byYear[taxYear]) byYear[taxYear] = {
      tax_year: taxYear,
      cycles: 0,
      total_income: 0,
      total_paid: 0,
      debt_start: null,
      debt_end: null
    };

    byYear[taxYear].cycles++;
    byYear[taxYear].total_income += parseFloat(cycle.total_income || 0);
    byYear[taxYear].total_paid += parseFloat(cycle.total_paid || 0);

    // Track debt balance at start and end of year
    const snapshot = cycle.debt_snapshot;
    if (snapshot) {
      const total = snapshot.reduce((s, d) => s + parseFloat(d.balance || 0), 0);
      if (!byYear[taxYear].debt_start) byYear[taxYear].debt_start = total;
      byYear[taxYear].debt_end = total;
    }
  }

  res.json(Object.values(byYear).reverse()); // most recent first
});
```

### Frontend changes

Add an **Annual Summary** section to the History tab (built in Feature 1), shown above the cycle-by-cycle list.

For each tax year, show a summary card:

```
2026/2027
─────────────────────────────
Income logged       £xx,xxx
Paid to debts       £xx,xxx
Debt reduction      £xx,xxx
Cycles completed    X
```

- Debt reduction = `debt_start - debt_end` (how much the total balance actually fell)
- If current tax year is in progress, label it "2026/2027 (in progress)" and include completed cycles so far
- Style consistently with existing cards: dark background, subtle border

---

## Build order summary

| # | Feature | Depends on | Effort |
|---|---------|------------|--------|
| 1 | Payment history | Nothing | Medium |
| 2 | Debt-free countdown | Nothing | Small |
| 3 | HMRC as proper debt | Nothing | Data change only |
| 4 | Push notifications | Nothing | Medium |
| 5 | Cycle auto-reset prompt | Features 1 + 4 | Small |
| 6 | Multi-device conflict handling | Nothing | Medium |
| 7 | Annual summary | Feature 1 | Small |

Suggested grouping for Claude Code sessions:
- **Session 1:** Features 1 + 2 (history foundation + quick countdown win)
- **Session 2:** Features 4 + 5 (notifications + auto-reset, do together as they share the cron job)
- **Session 3:** Feature 6 (conflict handling, self-contained)
- **Session 4:** Feature 7 (annual summary, needs history data to have accumulated)
- **Feature 3** (HMRC): do yourself in the app once you've called HMRC — no code needed

---

## Environment variables needed (add to Render)

```
NTFY_TOPIC=your-private-random-topic-string   # choose something unguessable
NTFY_BASE_URL=https://ntfy.sh
```

---

## Notes for Claude Code

- All new tables should use the `debt_plan_` prefix to avoid clashing with the paint estimator app
- The simulation logic (simulate, getCyclePayments, getCurrentTarget, getMilestones, getMonthLabel) is client-side only — do not move it to the backend
- The app is single-user — no authentication is required
- Mobile-first: any new UI must work on iPhone Safari in standalone PWA mode
- Existing colour palette: bg `#0f1117`, cards `#1a1d2e`, blue `#5b8def`, green `#7db87d`, orange `#e0923b`, red `#e05c5c`
- When in doubt, match the existing UI patterns exactly rather than introducing new components

---

## Feature 4b — Web Push to the installed PWA (extension of Feature 4) — BUILT

Native Web Push (iOS 16.4+ Home Screen web apps, plus desktop/Android browsers) as a second delivery transport alongside ntfy. No third-party app or relay needed — notifications go straight to the installed debt app, encrypted to the device, and tapping one opens the app.

- **Server:** `lib/debtPush.js` — VAPID keypair auto-generated on first use and persisted in `debt_push_vapid` (env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` override if ever needed — no Render config required otherwise). Subscriptions live in `debt_push_subscriptions`, one row per device, upserted by endpoint; dead subscriptions (404/410 from the push service) are pruned on send. Both tables are created lazily, so no manual `psql` run is needed before this works.
- **Delivery:** `lib/debtNotify.js`'s `broadcast()` fans each message out to ntfy (if `NTFY_TOPIC` is set) and every Web Push subscription; a failure in one transport never blocks the other. Due-date pushes carry a stable per-debt `tag` so the daily re-reminder replaces yesterday's banner instead of stacking. The 8am cron is now always scheduled (subscriptions appear at runtime, so there's no startup env check that can rule notifications out).
- **Frontend:** `public/debt-sw.js` (push-only service worker, scope `/debt` — deliberately no fetch handler, so online behaviour is unchanged) + `public/debt-manifest.json`. The Notifications card gains a "Push to this device" row: Enable asks permission → subscribes → saves; states cover enabled/disabled/blocked, and an iOS Safari tab shows "add to Home Screen first" since Apple only exposes push to installed web apps. "Send test notification" now exercises both transports and only errors if neither is set up.
- **iOS setup:** the app must be added to the Home Screen (it already is, in Nicky's case — but push must be ENABLED from inside the installed app, not from a Safari tab). If the home-screen copy predates this feature, remove and re-add it once so it picks up the service worker.

---

## Feature 8 — Floor & target payments — BUILT

Every debt now carries **two** numbers instead of one:

- **Floor** — the minimum committed payment, sized to a worst-case income
  month. This is the figure a creditor is told and held to.
- **Target** — the planned payment in an average month. This is what the
  existing budget-driven plan already produced; nothing about the payoff
  simulation changed.

A cycle is judged on both, separately. Meeting every floor is "on track"
even when targets slip, which removes the all-or-nothing month that made
catching up feel impossible on irregular income.

### Data model

| Where | Column | Notes |
|---|---|---|
| `debt_plan_debts` | `floor_payment NUMERIC` | **Nullable on purpose.** `NULL` = no floor agreed yet (Brewers' arrears-only trade account, HMRC pre-Time-to-Pay); a floor of `0` would read as a commitment to pay nothing and count as met every cycle. Backfilled once from `min`. |
| `debt_plan_settings` | `buffer_target NUMERIC DEFAULT 0` | `0` = buffer off, and off is the default — filling it diverts real money, so it is opted into rather than guessed at. |
| `debt_plan_cashflow` | `buffer_pot NUMERIC` | Cash cushion. Survives a cycle close, like a savings balance. |
| `debt_plan_cashflow` | `floor_shortfalls JSONB` | Running per-debt ledger `[{id,name,amount,since}]`. Written at cycle close, cleared only by an explicit user action. |
| `debt_plan_cashflow` | `floor_paid_this_cycle JSONB` | Debts where the floor went out but the target didn't. |
| `debt_plan_income_log` | `buffer_amt NUMERIC` | So deleting an income entry reverses its buffer top-up too. |

The floor backfill (`floor_payment = min`) sits inside a not-exists guard in
both `db/setup-debt.sql` and `ensureSchema()` in `routes/debt.js`, so it runs
exactly once. Without that guard, clearing a floor back to "not set" in the
app would be undone by the next restart.

### The third payment state

A cycle payment used to be paid, missed, or neither. It now has a fourth
state — **floor paid** — and that state is the only reason the two verdicts
can ever differ: with a binary tick, "floors met, target missed" is
unreachable, because paying a debt at all means paying it in full.
`setPaymentState()` is the single place an id moves between the three lists,
so the pot is refunded for whatever the old state took and charged for
whatever the new one takes.

Most debts' target *is* their floor (the plan pays their contractual minimum
and no more), so the flex zone is the surplus above the minimums — roughly
£260/month at the current figures, exactly as the spec estimated. The debt
receiving the arrears or snowball money is the one with real room between
the two numbers.

### Allocation order (`allocateIncome()` in `public/debt.html`)

1. **Buffer** — up to `bufferTarget`, if not already full.
2. **Floors** — the uncovered floor need, arrears first (highest arrears
   first, matching `simulate()`), into the business/personal pot each debt
   is paid from. Pot balances count toward the floors before new money does.
3. **Savings** — `savingsPct` of gross, but never out of the floor money.
4. **Targets** — the rest of the ordinary sweep, split by remaining need.
5. **Living** — the remainder.

Floors come **out of** the sweep, not on top of it, so a month whose floors
are already covered splits exactly as it did before this feature existed.
Only a light month escalates, pushing more of the income at the floors.

### Behind tracking

When a cycle closes with a floor unmet, the shortfall is recorded per debt in
`floor_shortfalls` and shown in a "Behind on floors" panel. It is **inert**:
nothing is added to what the plan asks for next cycle. The only route back
into the plan is the explicit **Catch up** button, which adds the shortfall to
that debt's arrears (putting it back at the front of the arrears-first order)
and says so first, including the warning about double-counting when the next
statement will already show it. **Clear** drops the entry without touching the
plan. Automatic compounding is the pressure this feature exists to remove.

The closing cycle's verdict (`floorsMet` / `targetMet`) and the shortfalls it
recorded are archived into `debt_plan_cycle_history.notes` as JSON alongside
the existing `missed` ids, and shown as badges on the History tab. Cycles
closed before this feature have no verdict and render without them.

### Tests

`npm run test:floors` (`scripts/test-floor-payments.js`) — no database, no
browser, no server. It extracts the real script block out of `public/debt.html`
and runs it in a vm with a stub DOM, so it exercises the functions the phone
runs. 46 checks covering: null floor ≠ zero floor, the two verdicts diverging,
the four payment states and their pot arithmetic, allocation order and
conservation, floors coming out of the sweep, and — the promise the whole
feature rests on — that a carried shortfall does not increase the next cycle's
required payment.

### Deliberately left open (see the spec's open questions)

These were **not** resolved in code, and the defaults chosen are editable
rather than decisions:

- **Van** keeps a floor seeded from its £400 minimum like any other debt, and
  is not special-cased out of the floor system. Clearing the floor in Edit
  Debts takes it out of the floors verdict if that's the answer.
- **HMRC** has no minimum, so it starts with no floor and sits outside the
  floors verdict until a Time to Pay arrangement gives it one — the same
  data-driven route by which it already joins the payment plan.
- **Surplus above floors** follows the existing strict arrears-first/snowball
  order rather than splitting proportionally.
- **`bufferTarget` is a fixed amount**, not a percentage of the floor total.

---

## Feature 9 — A plan that keeps itself up to date — BUILT (v2.48.0, arrears rule corrected v2.48.1)

The app had stalled: balances and arrears frozen for weeks, and every forecast still counting from July 2026. Three separate causes.

### 9a. The calendar follows the live cycle

`getMonthLabel()` was anchored to a literal `new Date(2026,6,1)`, and the header said "Starting July 2026" in plain HTML. Month 1 is now the month the **current cycle** opened, read from `debt_plan_settings.cycle_started_at` via `GET /debt/api/cycle-status`, which now returns `cycleStartedAt`, `nextRollAt`, `daysSinceStart` and `daysToRoll`. The header line renders live: *"August 2026 cycle · day 6 · renews 26 Sep"*. With no cycle loaded (offline, fresh install) it falls back to today's month, never to a hardcoded date.

### 9b. Ticking a payment moves the money

`setPaymentState()` debited a pot and moved an id between the three tick-lists — it never touched the balance or the arrears, so nothing could move between manual balance syncs. It now applies the payment as well:

- **paid** → balance down by the full payment, arrears down by the arrears portion.
- **floor** → balance down by `floorDue`, and arrears down only by `floorDue - minAmt`. Paying the contractual minimum clears no arrears; the arrears catch-up is the discretionary part on top, and that part wasn't paid.
- **missed / untick** → exact reversal.

Reversal has to be exact, and the applied figures are not simply "the payment" (arrears clamp to the balance; a short pot only gives what it holds), so each tick writes a ledger entry to the new `debt_plan_cashflow.applied_payments` JSONB column:

```json
{ "9": { "name": "NatWest Loan", "nominal": 778.72, "snowball": false,
         "amount": 778.72, "arrearsAmt": 258.71, "potAmt": 778.72 } }
```

`nominal` is what the row displays and what History archives; the other three are what an un-tick puts back. Applied lazily by `routes/debt.js` like `floor_shortfalls`, so no manual `psql` run.

Two consequences worth knowing:
- A **ticked** row keeps showing what was actually paid. Re-running the sim would quote a different figure, because it is now working off the balance the payment already reduced.
- An **unticked** row re-plans against the new balances. That is the point: clear one debt's arrears and the leftover budget visibly moves onto the next.

`openSyncBalances()` had to learn this too — for a debt already ticked it seeds current balance + a month's interest, because the sim's month-1 remaining would subtract the same payment twice.

### 9c. The cycle closes itself — `lib/debtCycle.js`

A calendar month after it opened (`addMonths`, which clamps 31 Jan → 28 Feb rather than overflowing into March), a cycle closes on its own, in one transaction under `SELECT ... FOR UPDATE` on the settings row.

**The governing rule: an automatic close does exactly what the manual close does, and nothing more.** It is the button pressing itself, not a second policy. Same history row, same `floorsMet`/`targetMet` verdict, same floor-shortfall merge, same arrears roll, same things left alone — pots and buffer carry over, `floor_shortfalls` accumulates rather than resetting.

**Two different numbers move at a close, and they are not the same thing** (corrected in v2.48.1 — the first cut had this backwards):

- The **minimum** (`debt_plan_debts.min`) is contractual. Whatever of it goes unpaid is genuinely overdue, so it is added to arrears, capped at the balance. That is simply true, and the plan should say so.
- The **floor** (`floor_payment`) is discretionary — what Nicky has chosen to aim for, which may sit above or below the minimum. Missing it is not a debt to anyone, so it goes on the floor-shortfall ledger instead: recorded, visible, and inert until Catch up is tapped (Feature 8's whole point).

A floor set **below** the minimum therefore does both: paying it settles the floor (nothing on the ledger) and still leaves contractual ground uncovered. A floor of £120 against a minimum of £205 puts £85 into arrears.

The roll lives in `getUnpaidMinimums()` / `applyUnpaidMinimums()` on the client and the matching block in `rollOnce()`, and both close paths call it — a manual close and an automatic one leave the arrears figures in exactly the same place. `confirmNewCycle` now sends `debts` with its POST for this reason; previously it sent only the archive payload, and the roll would have been lost on the next load.

The one thing it cannot borrow from the manual path is the payoff simulation, which is client-side only. Everything it needs comes from stored state instead: `floor_payment` per debt, the three tick-lists, and `applied_payments`. Two small consequences: the floor cap is the **balance** rather than the sim's planned payment (both say "you can't owe more than is left"), and `targetMet` is computed as "every debt in the plan paid in full" rather than "every row in the sim's month 1".

`cycle_started_at` advances to *the boundary it crossed*, not `NOW()`, or every late rollover would push the next one further out and the cycle would drift off its day of the month. Months offline produce one history row per month, not one giant gap (capped at 12).

It runs from two places: the 8am cron (`server.js`, inside the `DEBT_APP_ENABLED` gate, which then pushes "Cycle N closed…"), and the `/debt/api` middleware, throttled to one check per five minutes across all requests via a shared in-flight promise — so opening the app catches up instantly instead of waiting for the morning.

**First-run grace.** The first time the roller ever runs against a database, `debt_plan_settings.auto_roll_started_at` is NULL. It stamps that column, adopts today as the start of the first auto-managed cycle, and closes nothing. This matters on deploy: the cycle open at that moment is months overdue *because nothing existed to close it*, and its balances and arrears had just been reconciled by hand. Closing it retroactively would have logged a month of unmet floors against figures that were already correct. The column is applied lazily by `lib/debtCycle.js` itself rather than `routes/debt.js`'s `ensureSchema`, because the cron can roll before any API request has been served.

### 9d. Telling you what it did

`notes` gains `autoRolled: true` alongside the verdict keys the manual close already writes. The Cash Flow tab reads it back as a banner naming the cycle, its floors verdict, and every shortfall that went onto the ledger, with an **Update my balances** button. That opens the sync modal in a new `'balances'` mode: it seeds the *current* balances (not a projection of the cycle that just began) and saves without archiving a second, empty cycle. Dismissal is stored per cycle number in `localStorage`, so the next rollover speaks up again. History marks auto-closed cycles with an `AUTO` badge.

The 28-day nudge (banner and push) is reworded to match: it warns that the cycle renews and that unmet floors will go onto the catch-up ledger, rather than asking you to press a button.

### 9e. Staying fresh without a reload

`visibilitychange`, `focus` and a 5-minute poll re-run `loadState()`, so a server-side rollover or an edit from another device appears when you come back to the tab. Suppressed whenever a reload would discard local work: unsaved changes, a save still in flight (`persistInFlight`), an open modal, or a half-typed row in Edit Debts.

### Known trade-off

If you pay a debt outside the app and never tick it, the close counts its minimum as unpaid and adds it to arrears. That is why the banner names every debt and amount it moved and points at Edit Debts — visible and reversible, not silent.
