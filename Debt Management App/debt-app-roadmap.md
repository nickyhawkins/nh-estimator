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
