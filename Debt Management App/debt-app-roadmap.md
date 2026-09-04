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

## Feature 9 — A plan that keeps itself up to date — BUILT (v2.48.0, arrears rule corrected v2.48.2)

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

**Two different numbers move at a close, and they are not the same thing** (corrected in v2.48.2 — the first cut had this backwards):

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


---

## Feature 10 — Arrears go to the smallest first — BUILT (v2.48.4)

Reported as "only one arrears is being allocated", and the allocation was in fact correct: budget £1,500 less £1,241.29 of minimums leaves **£258.71** spare, and the whole of it went into NatWest Loan's £2,662.97 — the largest overdue balance. There was nothing left for a second debt. The cascade in `simulate()` was working; it just never got past the first name.

The cost of that ordering was the real problem. Every strategy clears all arrears in **month 21** — the spare per month fixes the finish date, not the order — but:

| ordering | still in arrears after 6 months | Amex (£65.64) |
|---|---|---|
| largest first (was) | 5 of 5 | first penny at m21 |
| **smallest first (now)** | **2 of 5** | **cleared at m1** |
| spread pro-rata | 5 of 5 | cleared at m21 |

So the spare now funds the **smallest** arrears first: snowball logic, applied to arrears. Month 1 clears Amex (£65.64) and Bounce Back (£177.48) outright and puts the remaining £15.59 on Updraft — three creditors funded instead of one, two of them off the list immediately, and the same month-21 finish.

Changed in three places that must agree or the plan contradicts itself: the cascade in `simulate()`, `getCurrentTarget()` (which decides where a logged surplus goes), and `floorPriority()` (which decides the order floors get funded when income is short).

### The zero-minimum case

Brewers has no minimum (trade account, whole balance overdue), so it receives nothing except through the arrears queue — four months of £0 on these figures. That is the ordering working as intended, but the row rendered as a bare "—", which reads as "nothing to do" rather than "overdue and waiting its turn". A debt with outstanding arrears and no allocation this month now carries an **IN ARREARS** badge and an "£X overdue · waiting for budget" line. The money is unchanged; only the honesty of the row is.

---

## Feature 11 — Pay a different amount — BUILT (v2.49.0)

Asked as a question: *"a lump sum comes in and I want to clear an account's
arrears rather than spread it over multiple cycles — can I?"* The answer was
no. A cycle payment could only be one of two computed figures — the plan's
**target**, or the **floor** — and a lump sum is neither. The only routes to a
different amount were editing the balance by hand in Edit Debts (which debits
no pot, writes no ledger entry and never reaches History) or dragging the
budget slider, which raises the whole month for every debt: the spreading the
question was trying to avoid.

A payment can now be any amount. The row's **own amount** link opens a modal
that takes a figure, shows what it would do, and records it.

### Where the money goes

The same split `simulate()` makes, and the one `paid floor only` already used:
the **contractual minimum first** (that keeps the account current and so
clears no arrears), **everything above it onto the arrears**. Which is why
**Clear arrears** is `minimum + arrears`, not the arrears alone.

The modal offers the figures worth having as one-tap chips — **Plan target**,
**Floor**, **Clear arrears**, **Clear balance** — deduplicated, because a debt
whose plan payment already covers its arrears would otherwise show the same
number three times. Under the box it says what the amount does before it is
recorded: balance and arrears before → after, what leaves which pot, and a
warning for each of the three ways an amount can surprise you — over the
balance (capped, you can't pay more than is owed), over the pot (log the money
in first, or the pot bottoms out at zero), under the floor (that floor will
count as unmet and the shortfall goes on the catch-up ledger at close).

### A fifth payment state

`custom` joins unpaid / floor / paid / missed. It shares `paid_this_cycle`
with **paid** rather than owning a fourth list — the amount that makes it
custom is already in `applied_payments`, and there is no schema change here at
all. What made that safe is the second half of the feature:

**Every "is this covered?" test now asks the ledger what actually went out,
rather than which tick-list an id sits in** (`paidAmountOf()`, and the
matching helpers in `rollOnce()`). A tick is no longer a promise that the
commitment was met:

| paid | against | outcome |
|---|---|---|
| ≥ the floor | `floorDue` | floor met |
| < the floor | `floorDue` | floor unmet — shortfall on the catch-up ledger at close |
| ≥ the contractual minimum | `min` | nothing overdue added |
| < the contractual minimum | `min` | the uncovered part becomes arrears at close |
| ≥ the target | `target` | counts toward "target met" |

Ledger entries therefore carry the three figures the payment was **judged
against** — `target`, `floorDue`, `minAmt` — alongside what it did:

```json
{ "5": { "name": "Brewers", "nominal": 2200.89, "custom": true,
         "target": 349.76, "floorDue": null, "minAmt": 0,
         "amount": 2200.89, "arrearsAmt": 2200.89, "potAmt": 2200.89 } }
```

Without them, a £20 payment would redefine a £205 floor as £20 and call it
met — the floor cap is `min(floor, target)`, and after a payment is applied
the sim's target is gone (it is now working off the balance that payment
reduced).

**A tick with no ledger entry is still taken at its word.** A cycle that was
already open before `applied_payments` existed carries ids in the tick-lists
and nothing in the ledger; reading those as "paid nothing" would turn a
settled cycle into a pile of arrears on deploy. Both the client and
`rollOnce()` fall back to the old list semantics whenever the ledger is
silent, and `rollOnce()` only diverges from its previous behaviour for an
entry explicitly flagged `custom`.

### Debts with nothing planned this cycle

The case a lump sum most often lands on. Brewers has no contractual minimum,
so it receives money only through the arrears queue and in a tight month takes
no month-1 payment at all — no row, nothing to tap. **Pay another debt**, next
to Start new cycle, lists every live debt that isn't already on the checklist
(HMRC included) and pays it the same way. The payment then appears on the
checklist on the strength of the ledger alone, the way a debt cleared outright
mid-cycle already did.

Such a debt has no target to be over or under, so its ledger entry takes the
amount paid as its own target: it is not counted as an underpayment, and
`getCycleTotals()` caps every row's contribution at its target so a £2,200
lump sum doesn't leave the app insisting that account still needs £2,200.

### Tests

`npm run test:custom-payments` (`scripts/test-custom-payments.js`) — 42 checks,
no database, no browser, no server. The vm-with-stub-DOM harness Feature 8
introduced was factored out to `scripts/debt-app-sandbox.js` and is now shared
by both suites, so these drive the real modal: open it, type an amount,
confirm. Covered: the minimum/arrears split at four amounts, Clear arrears
leaving nothing overdue, **undo restoring balance, arrears and pot exactly
from any amount** (including re-entering an amount, and switching a custom
payment to missed or up to the full target — the pot must not be charged
twice), the five judgements in the table above, the balance cap, and the
ledger-less fallback. `npm run test:floors` 47 green alongside.


---

## Feature 12 — Every arrear accounted for — BUILT (v2.53.0)

Reported as *"not all the arrears are being taken into account"*, against a
plan carrying £7,639.12 of arrears across five creditors. The header total was
right. Everything under it was not: **This cycle's payments** showed one
ARREARS badge and never mentioned two of the five debts' overdue money at all.

Three separate causes, all of them in the cycle view rather than in the
allocation — the money each debt is offered has not changed by a penny.

### 1. A debt the budget never reached vanished

`getCyclePayments()` builds from month 1 of the sim and drops any row with
`p.total <= 0.005`. A debt with **no contractual minimum** — Brewers, whose
whole balance is overdue — takes nothing from the sim except through the
arrears queue, and in a tight month that queue runs out before reaching it.
Planned payment £0, so no row: All Debts said £1,700.89 in arrears and the
cycle it belongs to never mentioned it.

£0 is the honest allocation. The silence was the bug. Such a debt now gets an
`unfunded` row on the checklist — the same honesty Feature 10 gave the
Schedule view's **IN ARREARS · waiting for budget** line, applied to the screen
the money is actually paid from:

- **!** in place of the tick box, because there is nothing to tick off.
- **ARREARS**, `waiting for budget`, and the amount overdue.
- **pay some of it**, which opens the ordinary own-amount modal preset to
  *Clear arrears*.
- The amount column reads **—**, not £0.00: nothing is being asked for.

It asks for nothing, so it moves nothing. The floors total, both pot needs,
the target total and the `n/m done` count are penny-identical to what they
were when the row was missing, and the tick is refused outright if it is ever
reached (`setPaymentState` turns a `paid` on a £0 row back into `unpaid`
rather than recording a payment of nothing and striking the debt through).

Being on the checklist, it drops off **Pay another debt** — which is where it
had to be paid from before, and still lists HMRC and anything else outside the
plan.

### 2. ARREARS meant the payment, not the debt

`p.arrears` was `arrearsPaid > 0.005` — *this month's payment contains arrears
catch-up*. So NatWest Loan, £3,751.74 overdue but affordable only to its
£520.01 minimum, showed **no arrears at all** on the row, while All Debts two
screens away badged it in red. The same flag drove the tight-week triage, so
that read the payment too.

The row now carries the **debt's** figures:

| field | meaning |
|---|---|
| `arrearsAmt` | the catch-up inside this month's payment — unchanged |
| `arrearsLeft` | what stays overdue once that payment has gone out |
| `arrears` | `arrearsLeft > 0.005` — i.e. this debt is overdue |

`ARREARS` therefore means on the checklist what it means everywhere else in
the app, and every row that carries it says **£X still overdue** beside the
floor. Updraft's £1,253.43 payment now reads "£528.51 still overdue" instead
of looking like the end of it.

### 3. A floor capped at the planned payment could be zeroed

`floorDue` was `min(floor, target)` — capped at the month's planned payment.
The comment said "you can't send more than is left", which is a cap at the
**balance**; the planned payment was standing in for it. They part company
twice, both times badly:

- A debt the budget never reached has a planned payment of £0, so a real
  commitment was rewritten as a floor of nothing and counted as met.
- A floor set **above** the minimum — the whole reason the field is editable —
  was quietly shrunk back to the minimum in any month with no spare. A £400
  floor against a £40.03 minimum read as £40.03 and passed on £40.03.

`floorDueOf(debt, paidOff)` caps at the balance instead, adding back what an
already-applied payment took off so the cap is measured against the balance as
the cycle opened. This is also the cap `rollOnce()` has always used
server-side, so the verdict the app shows and the one the close records can no
longer disagree — previously the app could say "floors met" and the cycle
close still put the shortfall on the catch-up ledger.

A floor agreed on an unfunded arrears debt is consequently a real commitment
again: it counts as unmet until paid and the pots are asked to cover it. That
is the one figure this feature does move, and it moves because a promise you
made should be funded whether or not the arrears queue got that far.

### Tests

`npm run test:arrears` (`scripts/test-arrears-visibility.js`) — 26 checks on
the reported plan itself, through the shared vm harness, no database, no
browser, no server. It pins the missing row, the badge meaning both ways round,
the "moves no money" guarantee measured against the same plan with the debt
removed, both halves of the floor cap, and the refusal to tick £0.
`npm run test:floors` 47 and `npm run test:custom-payments` 46 green alongside.

---

## Feature 13 — A month ahead: the buffer that can actually be spent — BUILT (v2.54.0)

Asked after Feature 12: *"what's the best way of building up a month ahead to
cover all payments and avoid arrears again?"* The mechanism already existed —
`bufferPot`, filled first out of every pay-in, ahead of floors, savings, sweep
and living money. It could not do the job:

- **The target slider stopped at £500.** A month of this plan's contractual
  minimums is £1,292.02. The number could not be entered.
- **Nothing ever spent it.** `bufferPot` was only ever added to; the sole way
  out was retyping it in Adjust pots. In the short month it exists for, it sat
  there and the minimum went into arrears anyway.
- **One jar, two bank accounts.** A full personal cushion cannot pay a
  business minimum, and the Log-money-in transfer panel sent the whole buffer
  to the personal account regardless.

### The target is a month of MINIMUMS

`monthlyMinimums()` — the same "in the payment plan" rule as
`getCurrentTarget()` (a live balance and either a minimum or a due date), each
minimum capped at its balance, split by account. On the reported plan:
**£387.08 business + £904.94 personal = £1,292.02**.

Deliberately the minimums and not the floors (£1,241.29). Missing a floor
writes an inert entry on the catch-up ledger; missing a **minimum** is money
genuinely overdue, and that is the thing this feature exists to stop. The
Settings card says so, in those words, above the figure.

The slider is gone. In its place: **One month ahead** / **Half a month** /
**Off** as one-tap presets computed from the plan, and a typed field per
account for anything else. `setBufferTargetFor()` deliberately does NOT
re-render on each keystroke — that would rewrite the input mid-type and throw
the caret to the end, the same reason the debt edit fields don't.

### Two jars

`buffer_biz` / `buffer_per` and `buffer_target_biz` / `buffer_target_per`,
because `bizPot` and `perPot` are two real bank accounts and neither can
rescue the other. They fill **together, in proportion to what each still
needs**, so a light month cannot brim one while the other — the one with a
minimum falling due — stays empty.

The legacy single jar migrates entirely to the **personal** side, which is
where the money physically was: the transfer panel has always routed the
buffer to the personal account alongside savings and living money. That panel
is now correct too — the business share of a pay-in's buffer is transferred to
the **business** account, because that is the jar a business minimum is paid
from. `buffer_pot` and `buffer_target` are kept, unwritten, so the split can be
rolled back without losing the money; `buffer_amt` on the income log stays the
total of the two new columns.

### It can be spent

`bufferCover()` is the tap that was missing: per account, the smaller of what
that pot is short of this cycle's uncovered floors and what that jar holds.
The buffer strip grows a **Cover £X from the buffer** button whenever there is
something to move, and the modal names the two transfers before they happen —
`buffer £850 → £206 · pot £415 → £854` — plus what is still short when a jar
can't reach, which is never made up from the other account.

It is a **transfer, not a payment**: the money lands in the pot and the payment
is then ticked normally, so every ledger, undo and archive path is untouched.

### Cost, for the record

Diverting money to build the cushion pushes the arrears-clear date back by
**exactly one month, however it is spread** — £1,300 once, £650 × 2, £325 × 4
and £220 × 6 all land on the same month, because the spare per month fixes the
finish date and not the order. So the cheapest way to build it is slowly, and
cheaper still out of the `savingsPct` that already diverts 10% of every pay-in
away from the debt sweep.

### The transfer instruction (v2.54.1)

Asked as soon as the pots became real: *"does the app show me how much to
transfer to each buffer pot, like it already did for business and personal?"*
Half. The split was in the **Where it goes** breakdown, under the Buffer line;
the **Transfers to make** panel — the part you actually work from, standing in
your banking app — still showed two figures, one per bank account, with the
buffer folded silently inside them. With the buffer as a number in the app
that was fine. With it as a real savings space, "£490.59 to the personal
account" is not an instruction anyone can act on.

The panel now names every destination: the two bank totals stay as the
headline (they are what leaves for each bank, which still matters when the two
are different banks), and under each sits the pot-by-pot split —

```
Business account            £409.41
   Business pot               £0.00
   Business buffer          £409.41
Personal account            £490.59
   Personal pot               £0.00
   Personal buffer          £490.59
   Savings                    £0.00
   Keep for living            £0.00
```

Four destinations, four figures, and each headline is exactly its own rows
added up — which the tests assert rather than trust.

### Tests

`npm run test:buffer` (`scripts/test-buffer-month-ahead.js`) — 33 checks
through the shared vm harness, no database, no browser, no server. Covers the
minimums split (including a minimum capped at its balance and a debt outside
the plan contributing nothing), the presets, proportional filling with a full
jar and an over-target pay-in, "nothing lost or invented" across the whole
allocation, the cover capped per account and never crossing between them, the
corrected transfer panel, and an income delete reversing both jars — including
a pre-split entry, whose buffer was personal money; and the transfers panel
driven through the real modal — every destination named, each headline the sum
of its own rows, and the four accounting for the whole pay-in. `test:arrears` 26,
`test:floors` 47 and `test:custom-payments` 46 green alongside.

**Deploy:** new columns are applied lazily by `routes/debt.js`'s
`ensureSchema()` on the first API request, as with every debt-app migration —
no manual step.

---

## Feature 14 — Spending the month ahead — BUILT (v2.55.0)

Feature 13 built the cushion and could move money out of it, but only as a
rescue: the button appeared when the pots were already short. Three questions
about what happens after the buffer fills turned out to have three different
answers, one of them a bug.

### The bug: funded on floors, sized on minimums

`bufferCover()` measured what to move against `getFloorStatus()`'s outstanding
**floors**. The buffer is sized on contractual **minimums**, and deliberately
so — a missed floor writes an inert catch-up entry, a missed minimum becomes
arrears. Where a floor sits BELOW its minimum the two disagree, and the buffer
would sit full while arrears grew on the difference. On the reported plan that
is Currys: floor £50.73 against a £101.46 minimum, so funding the floors moved
£854.21 to the personal pot when £904.94 was owed and let £50.73 go overdue.

`cycleCommitments()` replaces it: per debt still owing, the **higher** of its
floor and its contractual minimum, less what has already gone out; missed
debts excluded, exactly as the pots exclude them. On that plan it comes to
£387.08 business + £904.94 personal — the buffer target to the penny, which is
the point. The seeded plan hides this entirely (every seeded floor equals its
minimum), so the suite now carries a floor-below-minimum case of its own.

### Fund the month up front, don't wait to be rescued

Asked as *"a button to transfer the buffer to the main pot… then as the month
goes on the buffer is refilled while all the minimums are already funded, the
whole point of being a month ahead."* That is what the action always computed
at the start of a cycle — with nothing paid and the pots empty, the gap IS the
whole month — but it was labelled and framed as a shortfall rescue. It now
reads **Fund this month — move £X across**, and says what it buys: every floor
and minimum still owing in the pots up front, income then refilling the buffer
instead of paying the bills.

Nothing else had to change for that to work. `allocateIncome()` already fills
the buffer first and already counts pot balances toward the floors before new
money does, so a pot funded from the buffer takes no second helping: income
goes buffer → savings → sweep, and the float rolls forward month on month.

### The close warns, and never spends it

A cycle can close with minimums going into arrears while the cushion held to
prevent exactly that sits untouched — the close cannot move money between real
bank accounts, so it must not pretend to. `renderBufferRescue()` says so
instead, on the renewal banner and inside the Start-a-new-cycle modal: what is
unfunded, how much of it the buffer holds, and the transfer button. The test
asserts both that the warning appears and that closing moves nothing by itself.

### The target is a snapshot, and now admits it

`setBufferPreset()` stores numbers; `monthlyMinimums()` is computed live. Clear
two debts and the stored target is over-held; let a minimum rise and "a month
ahead ✓" is quietly false. `bufferDrift()` compares the two and the strip says
which way it has gone, with a one-tap re-set, whenever they differ by more
than a pound.

### Regression fixed on the way

The surplus prompt ("All bills are paid and you've got £X left over") gated on
`activeCycle.every(paid)`. Feature 12's `unfunded` arrears rows are in
`activeCycle`, ask for £0 and refuse the tick by design — so on any plan
carrying a debt the budget can't reach (Brewers), that prompt would never have
appeared again. It gates on `plannedCycle` now, like the n/m done counter.

### Where money goes once the buffer is full — no change needed

The third question was whether a full buffer should start pushing extra money
at the pots. It already does, and there was nothing to build: with the buffer
full it takes nothing off the top, and the pots fill toward this cycle's
targets up to `sweepPct`. Measured on the reported plan at a full buffer, a
£3,000 pay-in splits £471.04 business + £1,028.96 personal (£1,500 — exactly
the 50% sweep), £300 savings, £1,200 living. The plan's targets already carry
the arrears catch-up, so pot money above the minimums IS the overpayment, and
the existing surplus prompt spends what is left at the end of a cycle. The
lever for wanting more of it is `sweepPct`, one slider away — inventing a
second mechanism beside it would have been two controls fighting over one
number.

### Tests

`npm run test:buffer` grows to 48: the floor-below-minimum funding case, a
payment already made dropping out of what must still be funded, a missed debt
funded not at all, the close warning appearing and the close spending nothing,
and drift in both directions with the re-set clearing it. `test:arrears` 29
(two new, holding the surplus-prompt gate), `test:floors` 47 and
`test:custom-payments` 46 green alongside.

---

## Feature 15 — This month first, then the buffer — BUILT (v2.56.0)

Asked plainly: *"should the buffer fill before the actual month where it's
needed? Shouldn't it be the other way around?"* Yes, and it was a real fault,
introduced by me in Feature 13 rather than inherited.

`allocateIncome()` filled the buffer off the top, ahead of everything. That
was right when the buffer was the £200 cushion it was designed as, and wrong
the moment it became a month-ahead float. On a light month the whole pay-in
vanished into next month's safety while this month's minimums went into
arrears — the cushion built out of the very thing it exists to prevent.
Measured on the reported plan, target £1,292.02 and nothing paid:

| in | old: buffer | old: pots | old: still unfunded |
|---|---|---|---|
| £600 | £600.00 | £0.00 | £1,292.02 |
| £1,200 | £1,200.00 | £0.00 | £1,292.02 |

The order is now **this month → buffer → savings → sweep → living**. Same
figures:

| in | new: buffer | new: pots | new: still unfunded |
|---|---|---|---|
| £600 | £0.00 | £600.00 | £692.02 |
| £1,200 | £0.00 | £1,200.00 | £92.02 |

"This month" is `commitmentQueue()` — `cycleCommitments()` itemised and in the
existing funding order (arrears first, then earliest due), so a pay-in that
cannot cover everything covers what hurts most. Pot balances still count
before any new money does.

**It costs the buffer nothing in the steady state.** Once you are a month
ahead and have funded the cycle from the buffer on day one, the pots already
cover this month's commitments, the first step takes nothing, and income flows
straight back into refilling the jars. The float rolls forward month on month
— which is the whole mechanic, and it only works in this order.

The buffer still sits AHEAD of savings and the target sweep: a month ahead is
worth more than either, and behind them it would never fill while there were
arrears to chase. Commitment money still comes OUT OF the sweep rather than on
top of it, so a month whose commitments are already covered splits exactly as
it did before any of this existed.

`floorBiz`/`floorPer`/`floorFunded` are still returned under those names
alongside the clearer `dueBiz`/`duePer`/`dueFunded` — it is the same money,
and the floors-covered note and the floors suite both read it.

The Log-money-in modal's "Where it goes" list was reordered to match, and the
Buffer line now reads "after this month" rather than "taken first", because
that is no longer true.

### Tests

`test:buffer` 51 and `test:floors` 48. Seven checks across the two suites
asserted the old order outright ("buffer is filled before anything else") and
now pin the new one from both sides: a light month funding the month and not
the buffer, a pay-in bigger than the month funding the month first and the
buffer with the remainder, and — with the pots already covering the cycle, the
steady state — the buffer refilling ahead of savings and the sweep exactly as
before. `test:arrears` 29 and `test:custom-payments` 46 green alongside.

---

## Feature 16 — Floors retired — BUILT (v2.57.0)

Said plainly while working through the buffer: *"I'm not really seeing a
benefit of the floor payment, it seems to be complicating things."* Correct,
and the live data was blunt about it. Across the whole plan:

| | count |
|---|---|
| floor identical to the contractual minimum | **7 of 8** |
| floor below the minimum | 0 |
| floor above the minimum | **0** |
| no floor set | 1 (Brewers, which has no minimum either) |

The one apparent exception — Currys at £50.73 against a £101.46 minimum — was
my own bad inference from a screenshot. Its minimum IS £50.73. So the floor
field, in the entire history of the plan, never once expressed anything `min`
did not already say, and the only configuration where it could have (a floor
ABOVE the minimum) was never used.

For that it cost a second verdict, a fifth payment state, a priority order, a
nullable column, a running catch-up ledger with its own panel and two actions,
and 326 lines across four files.

**The deeper reason it had stopped earning its place:** floors were a
*bookkeeping* answer to irregular income — relabel a light month so it doesn't
read as failure. The month-ahead buffer (Features 13–15) is a *cash* answer to
the same problem. Once a light month is genuinely rescued with money, the
relabelling is redundant.

### What went

- `floor_payment` and the Floor field in Edit Debts and Add Debt.
- `floorOf()`, `floorDueOf()`, `getFloorStatus()`, `floorPriority()`,
  `renderFloorIndicators()`.
- The **Behind on floors** ledger entirely — panel, Catch up, Clear,
  `floor_shortfalls`, and the shortfall merge in both close paths. It existed
  only because a floor was a discretionary promise rather than a debt. An
  uncovered *minimum* is a real debt and already goes where real debts go.

### What stayed

- **"Paid the minimum only"** (◐), re-anchored on `min`. Pay what the
  agreement requires, skip the arrears catch-up. The state is `min` now;
  it still shares `paid_this_cycle`'s sibling column `floor_paid_this_cycle`,
  which is left named as it is — renaming a column to rename a concept is not
  worth a migration.
- **Two chips, both honest**: *Minimums met* — the verdict, meaning nothing
  new went overdue — and *Target*, which is progress, not a pass/fail. An
  unmet minimum with the pots short now reads **Arrears risk**, which is what
  it is.
- Everything the buffer does. `cycleCommitments()` and `commitmentQueue()`
  simply lost their `max(floor, min)` and read `min` directly.

### The nullable-column trick that turned out to be unnecessary

`floor_payment` was deliberately NULLABLE so that "no commitment agreed"
(Brewers, HMRC) could be told apart from "committed to £0", which would count
as met every cycle by paying nothing. `min` encodes exactly the same thing as
**0**, and always did. `minDueOf()` returns 0 there and `getCycleStatus()`
leaves those debts out of the verdict — same behaviour, one fewer column and
no null-handling anywhere.

### Data

Discarded on the user's instruction: no floor values are migrated to anything
and no catch-up ledger entries are converted to arrears. `floor_payment` and
`floor_shortfalls` are LEFT IN PLACE in the schema, unwritten, so the change is
reversible and nothing is destroyed. History rows are permanent, so
`renderArchivedVerdict()` reads `minsMet` **or** the older `floorsMet`, and a
row carrying a floor-shortfall list still renders it — labelled as retired,
with "nothing is owed on this".

### Tests

`npm run test:floors` becomes **`npm run test:minimums`**
(`scripts/test-minimums.js`, 47 checks): the minimum as the only commitment
and 0 meaning there isn't one, both caps (balance, and the balance before an
applied payment took its bite), the two verdicts judged separately, pot
arithmetic across all five payment states, allocation order and conservation,
and an uncovered minimum becoming arrears — capped at the balance, applied
once, with the archive asserted to carry no floor ledger at all.
`test:arrears` 29, `test:custom-payments` 46 and `test:buffer` 51 green
alongside; every one of them lost its floor scaffolding on the way.

**Deploy:** no migration. The retired columns are simply no longer read.
