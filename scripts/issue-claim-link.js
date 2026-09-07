#!/usr/bin/env node
'use strict';

// ── Issue a customer's setup link ───────────────────────────────────────────
//
//   DATABASE_URL='postgres://…' node scripts/issue-claim-link.js --app-url https://nh-estimator-smith.onrender.com
//
// Prints one link. The customer opens it, chooses their business name and
// their own password, and they are in — the owner never sets or sees it.
//
// Two occasions to run this:
//
//   1. A NEW INSTANCE, right after provision-customer.js. Until a link is
//      issued and used, the instance has no password at all — and lib/appAuth.js
//      treats an outstanding link as "gate on, nothing opens it but the link",
//      so a fresh instance is shut rather than sitting open while it waits.
//
//   2. SOMEONE LOCKED OUT. Issuing a new link does not disturb the running
//      instance: their old password keeps working, and their settings, jobs and
//      Xero connection are untouched, right up until they use the link and
//      choose a new password.
//
// The token is random, hashed before storage, single-use, and expires after a
// fortnight. It is printed once and cannot be recovered afterwards — issue
// another if it goes astray.
//
// WHERE DATABASE_URL COMES FROM: the customer's database in the Render
// dashboard → Connect → External Connection String. Use the EXTERNAL one; the
// internal address only resolves from inside Render's network.

const path = require('path');

function usage(msg) {
  if (msg) console.error('\n✗ ' + msg);
  console.error(`
Usage:
  DATABASE_URL='postgres://…' node scripts/issue-claim-link.js --app-url https://<service>.onrender.com [--days 14]

  --app-url   The instance's address, used to build the link. Required.
  --days      How long the link is good for. Default 14.
`);
  process.exit(2);
}

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
}

const appUrl = (flag('--app-url') || process.env.APP_URL || '').replace(/\/+$/, '');
const days = Number(flag('--days') || 14);

if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set — point it at the customer\'s database.');
if (!appUrl) usage('--app-url is required (or set APP_URL).');
if (!/^https?:\/\//.test(appUrl)) usage('--app-url must start with https://');
if (!Number.isFinite(days) || days < 1 || days > 90) usage('--days must be between 1 and 90.');

// Required after the argument checks: requiring ../db opens a pool against
// DATABASE_URL, and a usage error should not need a database to print.
const db = require(path.join('..', 'db'));
const appAuth = require(path.join('..', 'lib', 'appAuth'));

(async () => {
  const exists = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_auth'`
  );
  if (!exists.rowCount) {
    console.error(`
✗ This database has no app_auth table, so the instance has not finished its
  first deploy yet (npm run provision creates it). Wait for the deploy to go
  green and run this again.
`);
    process.exit(1);
  }

  const before = await db.query('SELECT password_hash, claimed_at FROM app_auth WHERE id = 1');
  const wasClaimed = !!(before.rows[0] && before.rows[0].password_hash);

  const { token, expiresInDays } = await appAuth.issueClaimToken(days);
  const link = `${appUrl}/claim/${token}`;

  console.log(`
${wasClaimed ? 'Reset link' : 'Setup link'} — send this to the customer
${'─'.repeat(58)}

  ${link}

Good for ${expiresInDays} days, and can only be used once.
`);

  if (wasClaimed) {
    console.log(`This instance already has a password, so this is a RESET. Their current
password keeps working until they open the link and choose a new one, and
nothing else about their instance changes.
`);
  } else {
    console.log(`This instance has no password yet. It is shut to everyone until this
link is used — nobody can reach the app in the meantime.
`);
  }

  console.log(`It is printed once and stored only as a hash, so it cannot be read back.
If it goes astray, run this again for a fresh one.
`);

  await db.pool.end();
})().catch(async (err) => {
  console.error('\n✗ ' + err.message + '\n');
  try { await db.pool.end(); } catch (e) { /* shutting down anyway */ }
  process.exit(1);
});
