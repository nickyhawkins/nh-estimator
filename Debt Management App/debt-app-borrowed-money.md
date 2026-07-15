# Debt Plan App — Borrowed Money Tab

This document describes the Borrowed Money feature to be added to the debt plan app. Reference `claude-code-handoff.md` for the full app spec and `debt-app-roadmap.md` for the wider roadmap context.

---

## Overview

A simple standalone tab to track informal short-term borrowing — from people or from named savings pots (e.g. "Tax", "Emergency fund", "Holiday pot"). Shows active loans grouped by source with a total per source and a grand total. Ticking off a loan marks it as repaid and moves it to a hidden log.

**This tab is purely for notes. It has zero interaction with the debt snowball, pot balances, cashflow calculations, or any other part of the app.** Nothing written here affects any numbers elsewhere.

---

## Key design decisions

### Savings is a flag, not a fixed name
Any loan can be flagged as `is_savings: true` regardless of what the source is called. So "Tax", "Emergency fund", "Holiday pot" all display their actual name everywhere, but the savings badge and nudge behaviour applies to any that are flagged. There is no hardcoded "Savings" source.

### No maths with the rest of the app
The borrowed money tab does not read from or write to `debt_plan_cashflow`, `debt_plan_settings`, `debt_plan_debts`, or the income log. It is fully self-contained.

### Cash flow nudge
If any savings-flagged loans are active, a subtle nudge appears on the Cash Flow home screen below the pot cards — purely informational, no calculations.

---

## Database changes

### New table: `debt_plan_borrowed`

```sql
CREATE TABLE debt_plan_borrowed (
  id SERIAL PRIMARY KEY,
  source_name TEXT NOT NULL,        -- display name: 'Dave', 'Tax', 'Emergency fund' etc.
  is_savings BOOLEAN DEFAULT FALSE, -- true = savings pot, false = person
  amount NUMERIC NOT NULL,
  note TEXT,                        -- optional: what it was for
  borrowed_at DATE DEFAULT CURRENT_DATE,
  repaid BOOLEAN DEFAULT FALSE,
  repaid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Auto-update updated_at
CREATE TRIGGER debt_plan_borrowed_updated_at
  BEFORE UPDATE ON debt_plan_borrowed
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- Note: update_updated_at() function already exists from Feature 6
```

---

## API endpoints

### `GET /debt/api/borrowed`
Returns all borrowed records split into active and repaid.

```javascript
// Response shape
{
  active: [
    {
      id: 1,
      source_name: 'Dave',
      is_savings: false,
      amount: 150.00,
      note: 'Fuel money',
      borrowed_at: '2026-07-03'
    },
    {
      id: 2,
      source_name: 'Tax',
      is_savings: true,
      amount: 200.00,
      note: 'Van repair',
      borrowed_at: '2026-06-28'
    },
    {
      id: 3,
      source_name: 'Emergency fund',
      is_savings: true,
      amount: 100.00,
      note: 'Shopping gap',
      borrowed_at: '2026-07-01'
    }
  ],
  repaid: [
    {
      id: 4,
      source_name: 'Dave',
      is_savings: false,
      amount: 50.00,
      note: 'Lunch',
      borrowed_at: '2026-05-10',
      repaid_at: '2026-05-18'
    }
  ]
}
```

### `POST /debt/api/borrowed`
Add a new borrowed entry.

```javascript
// Request body
{
  source_name: 'Tax',        // display name exactly as user typed, title-cased on save
  is_savings: true,          // true or false
  amount: 200.00,
  note: 'Van repair',        // optional
  borrowed_at: '2026-06-28'  // optional, defaults to today
}
```

Normalise `source_name` to title case on save so grouping works correctly
(`dave` → `Dave`, `tax pot` → `Tax Pot`).

### `POST /debt/api/borrowed/:id/repay`
Mark a loan as repaid. Sets `repaid = true` and `repaid_at = NOW()`.

No request body needed. Returns the updated record.

### `DELETE /debt/api/borrowed/:id`
Hard delete — only for records added in error. Normal flow is the repay endpoint.

---

## Frontend — Borrowed tab

Add a **Borrowed** tab to the nav, positioned after **All Debts**:

```javascript
const tabs = [
  ['cashflow', 'Cash Flow'],
  ['whatif', 'What If?'],
  ['monthly', 'Schedule'],
  ['milestones', 'Milestones'],
  ['history', 'History'],
  ['borrowed', 'Borrowed'],
  ['edit', 'Edit Debts'],
  ['overview', 'All Debts']
];
```

### Grand total card

At the top, show the total of all active loans:

```
TOTAL BORROWED
£450.00
3 active loans across 3 sources
```

Same gradient card style as the bills pot (`linear-gradient(135deg, #1a2535, #141a2e)`).

If total is zero, show a green zero state instead:
```
Nothing outstanding ✓
Keep it that way.
```

### Active loans — grouped by source

Group active records by `source_name`. Sort order:
1. Savings-flagged sources first (to reinforce repaying your own pots first)
2. Within each category, sort alphabetically by source name

For each source group, show a header row with the source name, badge, and group total. Below it, each individual loan as a row.

```
● Tax                          SAVINGS    £200.00 total
───────────────────────────────────────────────────────
  Van repair        28 Jun              £200.00  [Repaid ✓]

● Emergency fund               SAVINGS    £100.00 total
───────────────────────────────────────────────────────
  Shopping gap      01 Jul              £100.00  [Repaid ✓]

● Dave                         PERSON     £150.00 total
───────────────────────────────────────────────────────
  Fuel money        03 Jul              £150.00  [Repaid ✓]
```

- **SAVINGS badge**: green (`#7db87d`, background `#0d1a0d`)
- **PERSON badge**: blue (`#5b8def`, background `#0a1228`)
- Each loan row: note (or "No note" in muted text), date borrowed, amount, repay button
- If a source has multiple active loans, all appear under the same group header
- When the last active loan in a group is repaid, the group disappears from the active list

### Repay button and confirmation modal

Small ghost button on each loan row — green border, green text, no fill:

```
[Repaid ✓]
```

Tapping opens an in-app modal (not native confirm()):

```
Mark as repaid?

£200.00 borrowed from Tax
Van repair · 28 Jun

[Yes, mark repaid]    [Cancel]
```

After confirming:
- Record moves to the repaid log
- Group total and grand total update instantly
- If group is now empty, group header disappears

### Add loan button

Prominent `+ Log a loan` button below the active list (or centred on screen if list is empty).

Opens a modal:

```
Log a loan

Source name:
[ input — e.g. Dave, Tax, Emergency fund ]

Type:  [Person]  [Savings pot]

Amount (£):
[ number input ]

What was it for? (optional):
[ text input ]

Date borrowed:
[ date input — defaults to today ]

[Save]  [Cancel]
```

- "Savings pot" toggle sets `is_savings: true`
- The source name field is always shown — user types whatever they want
- Amount must be > 0, show inline error if empty or zero on save attempt
- Source name is required, show inline error if empty

### Repaid log (collapsed)

Below the active list and add button, a collapsed section:

```
▶ Repaid (3)
```

Tapping expands to show all repaid records, most recent first. Each row:
- Source name + badge, note, amount (strikethrough), date borrowed, date repaid
- Muted styling: text `#555`, amount `text-decoration: line-through`
- Read only — no actions

---

## Frontend — Cash Flow nudge

In the Cash Flow tab, below the business/personal pot cards and above the cycle payments section, show a nudge if there are any active savings-flagged loans.

Fetch borrowed data on page load alongside the main state. Store in a variable:

```javascript
let borrowedActive = []; // loaded from GET /debt/api/borrowed on init
```

Nudge logic in `renderAll()`:

```javascript
const savingsLoans = borrowedActive.filter(b => b.is_savings);
if (savingsLoans.length > 0) {
  const total = savingsLoans.reduce((s, b) => s + parseFloat(b.amount), 0);
  const sources = [...new Set(savingsLoans.map(b => b.source_name))];

  if (sources.length === 1) {
    // Single source: "⚠ £200 borrowed from Tax — repay when you can"
    nudgeText = `⚠ ${fmt(total)} borrowed from ${sources[0]} — repay when you can`;
  } else {
    // Multiple sources: "⚠ £300 borrowed from savings pots (Tax, Emergency fund)"
    nudgeText = `⚠ ${fmt(total)} borrowed from savings pots (${sources.join(', ')})`;
  }

  html += `<div style="background:#2a1a0a;border:1px solid #4a3a1a;border-radius:8px;
    padding:10px 14px;margin-bottom:14px;font-size:13px;color:#e0923b;line-height:1.5">
    ${nudgeText}
  </div>`;
}
```

The nudge:
- Only appears when savings-flagged loans are active
- Disappears automatically when all savings loans are repaid
- Is purely informational — no button, no action, no interaction with any other numbers
- Styled amber to match the tight week tone (attention, not alarm)

Person-to-person loans do **not** appear in the nudge — only savings-flagged ones.

---

## State loading

Add borrowed data to the page load fetch:

```javascript
// On page init, alongside existing state load:
const borrowedRes = await fetch('/debt/api/borrowed');
const borrowedData = await borrowedRes.json();
borrowedActive = borrowedData.active || [];
```

After any repay or add action, re-fetch `/debt/api/borrowed` and update `borrowedActive`, then call `renderAll()` so the nudge on the Cash Flow tab updates without a page reload.

---

## Edge cases

- **Same source name, multiple loans** — group under same header, list individually
- **Same name used as both person and savings** — unlikely but handle gracefully: treat as separate groups if `is_savings` differs (e.g. someone named "Tax" who is also a person would show two groups — in practice this won't happen)
- **Source name casing** — normalise to title case on save server-side
- **Zero amount** — reject on both client and server
- **Empty source name** — reject on both client and server

---

## Build checklist for Claude Code

- [ ] Create `debt_plan_borrowed` table with `updated_at` trigger
- [ ] `GET /debt/api/borrowed` — returns `{ active, repaid }` split
- [ ] `POST /debt/api/borrowed` — add loan, title-case source_name, validate amount > 0 and source_name not empty
- [ ] `POST /debt/api/borrowed/:id/repay` — mark repaid, set repaid_at
- [ ] `DELETE /debt/api/borrowed/:id` — hard delete for errors only
- [ ] Load borrowed data on page init alongside main state
- [ ] Add Borrowed tab to nav
- [ ] Grand total card with zero state
- [ ] Active loans grouped by source, savings-flagged first, with SAVINGS/PERSON badges
- [ ] Repay confirmation modal (no native confirm())
- [ ] Add loan modal with source name field, savings toggle, amount, note, date
- [ ] Collapsed repaid log section (read only)
- [ ] Cash Flow nudge for active savings loans (single source vs multiple sources wording)
- [ ] Re-fetch borrowed data after any add or repay action so nudge updates live
- [ ] No interaction with any other app state or calculations
