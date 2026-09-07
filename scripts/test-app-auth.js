#!/usr/bin/env node
'use strict';

// ── Regression test: the app login gate ─────────────────────────────────────
//
// The gate decides whether one decorator's jobs, clients and prices are on the
// public internet, and it has failed silently before (v2.48.5: a missing
// `trust proxy` meant the session cookie was never sent, so a correct password
// looped back to the login page forever, with nothing logged). Silent failure
// is the risk this file exists to catch.
//
// It drives a REAL server against a REAL database, once per configuration,
// because the three states in lib/appAuth.js differ by environment and stored
// row — not by a branch a unit test could reach.
//
// PREREQUISITES
//   1. Postgres, and DATABASE_URL pointing at a SCRATCH database (this file
//      writes to app_auth and settings, and clears them between cases).
//   2. Nothing else; it starts and stops its own server on TEST_PORT.
//
// USAGE
//   DATABASE_URL=postgres://... node scripts/test-app-auth.js

const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL is required — point it at a scratch database, not production.');
  process.exit(2);
}
const PORT = Number(process.env.TEST_PORT || 3310);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');

const pass = [], fail = [];
const check = (name, ok, detail) => {
  (ok ? pass : fail).push(name + (detail ? ' — ' + detail : ''));
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ── helpers ────────────────────────────────────────────────────────────────

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, ...env, PORT: String(PORT), DATABASE_URL: DB },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    // The timer is cleared on success: an uncleared one keeps Node's event
    // loop alive after the last assertion, and a test suite that prints its
    // results and then hangs for a minute reads exactly like a broken test.
    const giveUp = setTimeout(() => reject(new Error('server did not start in time: ' + out)), 15000);
    const onData = (b) => {
      out += b.toString();
      if (out.includes('running on port')) { clearTimeout(giveUp); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => { out += b.toString(); });
    child.on('exit', (code) => { clearTimeout(giveUp); reject(new Error(`server exited early (${code}): ${out}`)); });
  });
}

// Safe to call twice on the same child, which the last case does (once at the
// end of its block, once in the finally). A child killed by a signal has
// exitCode === null and signalCode === 'SIGKILL' — checking only exitCode
// reads a dead process as live, kills it again, and waits forever for an
// 'exit' that already fired.
function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    child.removeAllListeners('exit');
    child.on('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

// A tiny cookie jar: enough for one session cookie, which is all the app sets.
function makeJar() {
  let cookie = null;
  return {
    capture(res) {
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
    },
    header() { return cookie ? { Cookie: cookie } : {}; },
    get value() { return cookie; },
    clear() { cookie = null; },
  };
}

async function req(method, urlPath, { jar, body, json, html } = {}) {
  const headers = { ...(jar ? jar.header() : {}) };
  let payload;
  if (json) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(json); }
  else if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  }
  if (html) headers['Accept'] = 'text/html';
  const res = await fetch(BASE + urlPath, { method, headers, body: payload, redirect: 'manual' });
  if (jar) jar.capture(res);
  return res;
}

async function resetAuthRow(db, patch = {}) {
  await db.query(`UPDATE app_auth SET password_hash=NULL, password_salt=NULL,
                    claim_token_hash=NULL, claim_expires_at=NULL, claimed_at=NULL WHERE id=1`);
  if (patch.sql) await db.query(patch.sql, patch.params || []);
}

// ── the cases ──────────────────────────────────────────────────────────────

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();

  // The schema must already be there; provision is the thing that puts it there.
  const has = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_auth'`
  );
  if (!has.rowCount) {
    console.error('app_auth table missing — run `npm run provision` against this database first.');
    process.exit(2);
  }

  let server;
  try {
    // ── 1. No password anywhere: the app's historical behaviour, no gate ────
    console.log('\nNo password set, no APP_PASSWORD — the gate should be off:');
    await resetAuthRow(db);
    server = await startServer({ APP_PASSWORD: '' });
    {
      const res = await req('GET', '/', { html: true });
      check('the app opens with no login at all', res.status === 200, 'status ' + res.status);
      const api = await req('GET', '/api/jobs');
      check('...and the API answers too', api.status === 200, 'status ' + api.status);
    }
    await stopServer(server);

    // ── 2. Legacy APP_PASSWORD still works, untouched ───────────────────────
    console.log('\nAPP_PASSWORD set and no stored password — the WS1 path must still work:');
    await resetAuthRow(db);
    server = await startServer({ APP_PASSWORD: 'legacy-pw-value' });
    {
      const jar = makeJar();
      const shut = await req('GET', '/', { html: true });
      check('logged out, the app redirects to the login page',
        shut.status === 302 && (shut.headers.get('location') || '').includes('/login'),
        'status ' + shut.status);

      const wrong = await req('POST', '/auth/login', { jar, body: { password: 'nope' } });
      check('a wrong password is refused',
        (wrong.headers.get('location') || '').includes('error=1'));

      const right = await req('POST', '/auth/login', { jar, body: { password: 'legacy-pw-value' } });
      check('the env password signs in',
        right.status === 302 && right.headers.get('location') === '/',
        'went to ' + right.headers.get('location'));
      check('...and a session cookie is actually set', !!jar.value);

      const inApp = await req('GET', '/', { jar, html: true });
      check('...which then opens the app', inApp.status === 200, 'status ' + inApp.status);
    }
    await stopServer(server);

    // ── 3. A provisioned-but-unclaimed instance is CLOSED ───────────────────
    console.log('\nA setup link issued and not yet used — the instance must be shut, not open:');
    await resetAuthRow(db, {
      sql: `UPDATE app_auth SET claim_token_hash = encode(sha256('tok-abc'::bytea),'hex'),
              claim_expires_at = NOW() + interval '14 days' WHERE id = 1`,
    });
    server = await startServer({ APP_PASSWORD: '' });
    {
      const res = await req('GET', '/', { html: true });
      check('the app is gated even with no password anywhere',
        res.status === 302 && (res.headers.get('location') || '').includes('/login'),
        'status ' + res.status);

      const api = await req('GET', '/api/jobs');
      check('...the API is shut too', api.status === 401, 'status ' + api.status);

      const empty = await req('POST', '/auth/login', { body: { password: '' } });
      check('an empty password does NOT get in',
        (empty.headers.get('location') || '').includes('error=1'));

      const state = await req('GET', '/auth/state');
      const body = await state.json();
      check('the login page is told it is awaiting setup', body.awaitingClaim === true);

      const status = await req('GET', '/auth/claim-status/tok-abc');
      check('a good token reports valid', (await status.json()).valid === true);
      const bad = await req('GET', '/auth/claim-status/tok-wrong');
      check('a wrong token reports invalid', (await bad.json()).valid === false);
    }
    await stopServer(server);

    // ── 4. Claiming: the whole point ────────────────────────────────────────
    console.log('\nRedeeming the setup link:');
    server = await startServer({ APP_PASSWORD: '' });
    {
      const jar = makeJar();
      const short = await req('POST', '/auth/claim', {
        json: { token: 'tok-abc', password: 'short', businessName: 'Smith Decorating' },
      });
      check('a too-short password is refused', short.status === 400, 'status ' + short.status);

      const wrongTok = await req('POST', '/auth/claim', {
        json: { token: 'tok-nope', password: 'a-good-password', businessName: 'Nope Ltd' },
      });
      check('a wrong token is refused', wrongTok.status === 400);

      const good = await req('POST', '/auth/claim', {
        jar,
        json: { token: 'tok-abc', password: 'their-own-password', businessName: 'Smith Decorating' },
      });
      const goodBody = await good.json();
      check('the real link is accepted', good.status === 200 && goodBody.ok === true,
        'status ' + good.status);
      check('...and signs them straight in', goodBody.signedIn === true);
      check('...with a session cookie', !!jar.value);

      const settings = await db.query(`SELECT data->>'businessName' AS n FROM settings WHERE id=1`);
      check('...and their business name is saved, not the app author\'s',
        settings.rows[0].n === 'Smith Decorating', 'got ' + settings.rows[0].n);

      const row = await db.query(`SELECT password_hash, claim_token_hash, claimed_at FROM app_auth WHERE id=1`);
      check('...a password hash is stored', !!row.rows[0].password_hash);
      check('...the token is burned', row.rows[0].claim_token_hash === null);
      check('...and the claim is dated', !!row.rows[0].claimed_at);

      const reuse = await req('POST', '/auth/claim', {
        json: { token: 'tok-abc', password: 'someone-elses-password' },
      });
      check('the same link cannot be used twice', reuse.status === 400, 'status ' + reuse.status);

      const inApp = await req('GET', '/', { jar, html: true });
      check('the claimed session opens the app', inApp.status === 200, 'status ' + inApp.status);
    }
    await stopServer(server);

    // ── 5. The stored password now rules, and can be changed ────────────────
    console.log('\nAfter setup, the password they chose is the one that works:');
    server = await startServer({ APP_PASSWORD: 'legacy-pw-value' });
    {
      const jar = makeJar();
      const legacy = await req('POST', '/auth/login', { body: { password: 'legacy-pw-value' } });
      check('the old env password no longer gets in once they own it',
        (legacy.headers.get('location') || '').includes('error=1'),
        'went to ' + legacy.headers.get('location'));

      const theirs = await req('POST', '/auth/login', { jar, body: { password: 'their-own-password' } });
      check('their chosen password does', theirs.headers.get('location') === '/',
        'went to ' + theirs.headers.get('location'));

      const wrongCur = await req('POST', '/auth/change-password', {
        jar, json: { currentPassword: 'not-it', newPassword: 'a-brand-new-password' },
      });
      check('changing it needs the current one', wrongCur.status === 400, 'status ' + wrongCur.status);

      const changed = await req('POST', '/auth/change-password', {
        jar, json: { currentPassword: 'their-own-password', newPassword: 'a-brand-new-password' },
      });
      check('with the current one, it changes', changed.status === 200, 'status ' + changed.status);

      const jar2 = makeJar();
      const old = await req('POST', '/auth/login', { jar: jar2, body: { password: 'their-own-password' } });
      check('the old password stops working',
        (old.headers.get('location') || '').includes('error=1'));
      const neu = await req('POST', '/auth/login', { jar: jar2, body: { password: 'a-brand-new-password' } });
      check('the new one works', neu.headers.get('location') === '/');

      const anon = await req('POST', '/auth/change-password', {
        json: { currentPassword: 'a-brand-new-password', newPassword: 'yet-another-password' },
      });
      check('a stranger with no session cannot change it', anon.status === 401, 'status ' + anon.status);
    }
    await stopServer(server);

    // ── 6. A reset link does not disturb a working instance ─────────────────
    console.log('\nIssuing a reset link for someone locked out:');
    await db.query(`UPDATE app_auth SET claim_token_hash = encode(sha256('reset-tok'::bytea),'hex'),
                      claim_expires_at = NOW() + interval '14 days' WHERE id = 1`);
    server = await startServer({ APP_PASSWORD: '' });
    {
      const jar = makeJar();
      const still = await req('POST', '/auth/login', { jar, body: { password: 'a-brand-new-password' } });
      check('the existing password still works while a reset link is outstanding',
        still.headers.get('location') === '/', 'went to ' + still.headers.get('location'));

      const settingsBefore = await db.query(`SELECT data->>'businessName' AS n FROM settings WHERE id=1`);
      const redeemed = await req('POST', '/auth/claim', {
        json: { token: 'reset-tok', password: 'recovered-password' },
      });
      check('the reset link sets a new password', redeemed.status === 200, 'status ' + redeemed.status);

      const settingsAfter = await db.query(`SELECT data->>'businessName' AS n FROM settings WHERE id=1`);
      check('...and does NOT wipe their settings',
        settingsAfter.rows[0].n === settingsBefore.rows[0].n,
        settingsBefore.rows[0].n + ' -> ' + settingsAfter.rows[0].n);

      const jar3 = makeJar();
      const rec = await req('POST', '/auth/login', { jar: jar3, body: { password: 'recovered-password' } });
      check('the recovered password signs in', rec.headers.get('location') === '/');
    }
    await stopServer(server);

    // ── 7. An expired link is dead ──────────────────────────────────────────
    console.log('\nAn expired setup link:');
    await resetAuthRow(db, {
      sql: `UPDATE app_auth SET claim_token_hash = encode(sha256('old-tok'::bytea),'hex'),
              claim_expires_at = NOW() - interval '1 day' WHERE id = 1`,
    });
    server = await startServer({ APP_PASSWORD: 'fallback-pw' });
    {
      const status = await req('GET', '/auth/claim-status/old-tok');
      check('reports itself invalid', (await status.json()).valid === false);
      const used = await req('POST', '/auth/claim', {
        json: { token: 'old-tok', password: 'trying-it-anyway' },
      });
      check('and cannot be redeemed', used.status === 400, 'status ' + used.status);
      const fell = await req('POST', '/auth/login', { body: { password: 'fallback-pw' } });
      check('the instance falls back to its env password, not to being open',
        fell.headers.get('location') === '/', 'went to ' + fell.headers.get('location'));
    }
    await stopServer(server);

    // Leave the scratch database as we found it.
    await resetAuthRow(db);
  } finally {
    await stopServer(server);
    await db.end().catch(() => {});
  }

  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  if (fail.length) {
    console.log('\nFailed:');
    fail.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  // Explicit: the killed child servers leave their stdio pipes referenced for
  // a moment, and this file has nothing left to do once the tally is printed.
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
