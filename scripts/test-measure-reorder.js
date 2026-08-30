#!/usr/bin/env node
'use strict';

// ── Regression test: reordering the Measure lists ───────────────────────────
//
// Drives the REAL app in a real browser against a real database, and proves
// the thing the feature exists for: the order rows are put into on Measure is
// the order they are stored in, come back in, and are read in downstream.
//
// Four lists reorder (rooms, exterior items, fitted units, custom lines) and
// each persists through a different path — two bulk-replace endpoints where
// the server re-stamps created_at, and two arrays riding job.data — so every
// one of them is moved here and then read back off the server, rather than
// trusting the list on screen. The mode's own rules are checked too: rows do
// not open or swipe while it is on, an end-of-list arrow does nothing, and
// Bulk edit and Reorder never run at the same time.
//
// PREREQUISITES — this is not part of `npm start` and needs three things:
//   1. A Postgres database and DATABASE_URL pointing at it (a scratch one:
//      the test writes a job, rooms and exterior items into it).
//   2. The app running against that database
//      (DATABASE_URL=... PORT=3199 npm start).
//   3. Playwright, which is not a project dependency:  npm i --no-save playwright
//
// USAGE
//   TEST_BASE_URL=http://localhost:3199 \
//     node scripts/test-measure-reorder.js
//
// It seeds its own fixture job ('reorder-test') and deletes it first, so it is
// safe to re-run and it never touches a real job.

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('This test needs Playwright, which is not a project dependency.');
  console.error('  npm i --no-save playwright');
  process.exit(2);
}

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3199';
// Playwright's bundled Chromium, or the one this environment already has.
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const JOB_ID = 'reorder-test';

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (await res.text()));
  return res.json();
}

// The fixture: an ordinary job with something in all four reorderable lists.
// The rooms carry only what calcRoom() needs to price them — this test is
// about order, and every figure on the row is incidental to it.
const room = (id, name, emoji) => ({
  id, name, emoji, l: 4, w: 3, h: 2.4, wc: 2, cc: 2, xc: 2,
  doors: 1, frames: 1, doorCoats: 2, frameCoats: 2, prepPct: 10, shapeMode: 'box'
});

async function seed() {
  try { await api('DELETE', '/api/jobs/' + JOB_ID); } catch (e) { /* first run */ }
  await api('POST', '/api/jobs', { id: JOB_ID, name: 'Reorder test' });
  await api('PUT', '/api/rooms?job_id=' + JOB_ID, { rooms: [
    room('rt1', 'Lounge', '🛋️'), room('rt2', 'Kitchen Diner', '🍽️'), room('rt3', 'Bedroom 1', '🛏️')
  ]});
  await api('PUT', '/api/extitems?job_id=' + JOB_ID, { items: [
    { id: 'et1', label: 'Front fascia', emoji: '🏡', type: 'fascia', lengthM: 8, coats: 2 },
    { id: 'et2', label: 'Garage door', emoji: '🚪', type: 'door', count: 1, coats: 2 }
  ]});
  await api('PUT', '/api/jobs/' + JOB_ID, {
    name: 'Reorder test',
    customItems: [
      { id: 'ct1', type: 'customLineItem', description: 'Scaffold hire', quantity: 1, unitPrice: 300, total: 300, applyMarkup: true },
      { id: 'ct2', type: 'customLineItem', description: 'Skip', quantity: 1, unitPrice: 220, total: 220, applyMarkup: true }
    ],
    fittedUnits: [
      { id: 'ft1', name: 'Alcove shelves', bayCount: 2, bayHeightM: 2, bayDepthM: 0.3, bayWidths: [1, 1], shelfCount: 4, doorCount: 2, doorSize: 'standard', prepLevel: 'bare', topcoatCoats: 2 },
      { id: 'ft2', name: 'Boot room bench', bayCount: 1, bayHeightM: 1, bayDepthM: 0.4, bayWidths: [1.5], shelfCount: 2, doorCount: 1, doorSize: 'standard', prepLevel: 'bare', topcoatCoats: 2 }
    ]
  });
}

(async () => {
  await seed();

  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
  // A phone, since this is a phone-first screen and the arrows are thumb
  // targets. The fixture job is selected before the app boots -- activeJobId
  // is read out of localStorage at module init.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((id) => { localStorage.setItem('pe-active-job-id', id); }, JOB_ID);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));

  const openMeasure = async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.click('#nav-home');       // the app lands on the dashboard
    await page.waitForTimeout(400);
  };
  await openMeasure();

  const namesIn = (sel) => page.$$eval(sel + ' .room-name', els => els.map(e => e.textContent.replace(/\s*MANUAL.*/, '').trim()));
  const rooms = () => namesIn('#room-cards');
  const exts = () => namesIn('#ext-cards');
  const units = () => namesIn('#fu-section-cards');
  const customs = () => namesIn('#custom-cards');
  const shown = (sel) => page.$eval(sel, e => getComputedStyle(e).display !== 'none');
  const label = (sel) => page.$eval(sel, e => e.textContent.trim());
  const count = async (sel) => (await page.$$(sel)).length;
  // Nth row of a list, counted 1-based as the rows read on screen -- not as
  // nth-child, since outside reorder mode each row sits inside its own
  // swipe-delete wrapper.
  const row = (sel, n) => page.locator(sel + ' .room-item').nth(n - 1);
  // Rows are only tapped through their name, never their arrows.
  const tapRow = (sel, n) => row(sel, n).locator('.room-name').click();
  const move = async (sel, n, dir) => {
    await row(sel, n).locator('.move-arrows > *').nth(dir < 0 ? 0 : 1).click();
    await page.waitForTimeout(250);
  };

  // ── The list before the mode is touched ──────────────────────────────────
  check('the fixture job is on screen', same(await rooms(), ['Lounge', 'Kitchen Diner', 'Bedroom 1']), await rooms());
  check('all four lists render', (await exts()).length === 2 && (await units()).length === 2 && (await customs()).length === 2);
  check('a Reorder link on every list of more than one', await shown('#rooms-reorder-toggle') && await shown('#ext-reorder-toggle')
    && await shown('#fu-reorder-toggle') && await shown('#custom-reorder-toggle'));
  check('no arrows until the mode is on', (await count('.move-arrow')) === 0);
  check('rows are swipe-wrapped', (await count('#room-cards .swipe-wrap')) === 3);

  // ── Entering the mode ────────────────────────────────────────────────────
  await page.click('#rooms-reorder-toggle');
  await page.waitForTimeout(300);
  check('one mode: every list says Done', (await label('#rooms-reorder-toggle')) === 'Done' && (await label('#ext-reorder-toggle')) === 'Done'
    && (await label('#fu-reorder-toggle')) === 'Done' && (await label('#custom-reorder-toggle')) === 'Done');
  check('an arrow pair on all nine reorderable rows', (await count('.move-arrows')) === 9, await count('.move-arrows'));
  check('the swipe wrapper is gone', (await count('#room-cards .swipe-wrap')) === 0);
  check('the cost gives its space to the arrows', (await count('#room-cards .room-cost')) === 0);
  check('the top row cannot go up', await page.$eval('#room-cards .room-item .move-arrow', e => e.classList.contains('off')));
  check('the bottom row cannot go down', await page.$eval('#room-cards .room-item:last-child .move-arrows > :last-child', e => e.classList.contains('off')));

  await tapRow('#room-cards', 1);
  await page.waitForTimeout(200);
  check('a row does not open its editor while reordering', await page.$eval('#screen-room', e => !e.classList.contains('active')));

  // ── Moving rows in all four lists ────────────────────────────────────────
  await move('#room-cards', 1, +1);
  check('a room moves down', same(await rooms(), ['Kitchen Diner', 'Lounge', 'Bedroom 1']), await rooms());
  await move('#room-cards', 3, -1);
  await move('#room-cards', 2, -1);
  check('a room walks to the top', same(await rooms(), ['Bedroom 1', 'Kitchen Diner', 'Lounge']), await rooms());
  await move('#room-cards', 1, -1);
  check('the disabled end arrow does nothing', same(await rooms(), ['Bedroom 1', 'Kitchen Diner', 'Lounge']), await rooms());

  await move('#ext-cards', 1, +1);
  check('an exterior item moves', same(await exts(), ['Garage door', 'Front fascia']), await exts());
  await move('#fu-section-cards', 2, -1);
  check('a fitted unit moves', same(await units(), ['Boot room bench', 'Alcove shelves']), await units());
  await move('#custom-cards', 1, +1);
  check('a custom line moves', same(await customs(), ['Skip', 'Scaffold hire']), await customs());

  // ── The new order is the stored order ────────────────────────────────────
  await page.waitForTimeout(800);   // let the saves land
  const srvRooms = (await api('GET', '/api/rooms?job_id=' + JOB_ID)).map(r => r.name);
  check('rooms come back off the server in the new order', same(srvRooms, ['Bedroom 1', 'Kitchen Diner', 'Lounge']), srvRooms);
  const srvExt = (await api('GET', '/api/extitems?job_id=' + JOB_ID)).map(r => r.label);
  check('exterior items come back in the new order', same(srvExt, ['Garage door', 'Front fascia']), srvExt);
  const job = (await api('GET', '/api/jobs')).find(j => j.id === JOB_ID);
  check('fitted units come back in the new order', same((job.fittedUnits || []).map(f => f.name), ['Boot room bench', 'Alcove shelves']), job.fittedUnits);
  check('custom lines come back in the new order', same((job.customItems || []).map(c => c.description), ['Skip', 'Scaffold hire']), job.customItems);

  // ── What the quote reads ─────────────────────────────────────────────────
  await page.click('#nav-summary');
  await page.waitForTimeout(700);
  const want = ['Bedroom 1', 'Kitchen Diner', 'Lounge', 'Boot room bench', 'Alcove shelves', 'Skip', 'Scaffold hire'];
  const breakdown = (await namesIn('#sum-data')).filter(n => want.indexOf(n) >= 0);
  check('the Summary breakdown follows the measure order', same(breakdown, want), breakdown);
  await page.click('#nav-home');
  await page.waitForTimeout(400);

  // ── Leaving the mode ─────────────────────────────────────────────────────
  check('the mode survives leaving and returning to the tab', (await label('#rooms-reorder-toggle')) === 'Done');
  await page.click('#ext-reorder-toggle');     // any list's Done ends it
  await page.waitForTimeout(300);
  check('every link is back to Reorder', (await label('#rooms-reorder-toggle')) === 'Reorder' && (await label('#custom-reorder-toggle')) === 'Reorder');
  check('the arrows are gone', (await count('.move-arrow')) === 0);
  check('costs and swipe wrappers are back', (await count('#room-cards .room-cost')) === 3 && (await count('#room-cards .swipe-wrap')) === 3);
  await tapRow('#room-cards', 1);
  await page.waitForTimeout(400);
  check('a row opens its editor again', await page.$eval('#screen-room', e => e.classList.contains('active')));
  check('...and it is the row that was tapped', (await page.$eval('#r-name', e => e.value)) === 'Bedroom 1');
  await page.evaluate(() => goBack());
  await page.waitForTimeout(400);

  // ── One mode at a time ───────────────────────────────────────────────────
  await page.click('#rooms-reorder-toggle');
  await page.waitForTimeout(250);
  check('Bulk edit is not offered while reordering', !(await shown('#bulk-edit-toggle')));
  // The guard behind the hidden link: bulk edit reached any other way still
  // ends reorder rather than stacking two modes over the same rows.
  await page.evaluate(() => toggleBulkEdit());
  await page.waitForTimeout(250);
  check('entering bulk edit ends reorder', (await count('.move-arrow')) === 0 && (await count('#room-cards .bulk-check')) === 3);
  check('Reorder is not offered while bulk editing', !(await shown('#rooms-reorder-toggle')) && !(await shown('#ext-reorder-toggle')));
  await page.click('#bulk-edit-toggle');
  await page.waitForTimeout(250);
  check('Reorder is back once bulk edit ends', await shown('#rooms-reorder-toggle') && await shown('#ext-reorder-toggle'));

  // ── A list with nothing to order ─────────────────────────────────────────
  await api('PUT', '/api/rooms?job_id=' + JOB_ID, { rooms: [room('rt9', 'Only Room', '🛋️')] });
  await api('PUT', '/api/extitems?job_id=' + JOB_ID, { items: [] });
  await openMeasure();
  check('one room offers no Reorder link', !(await shown('#rooms-reorder-toggle')));
  check('...while a list that still has two keeps its own', await shown('#custom-reorder-toggle'));
  check('the one room still lists normally', same(await rooms(), ['Only Room']), await rooms());

  check('no page errors', errors.length === 0, errors.slice(0, 3));
  await browser.close();
  try { await api('DELETE', '/api/jobs/' + JOB_ID); } catch (e) { /* leave it for inspection */ }

  pass.forEach(n => console.log('  ✓ ' + n));
  fail.forEach(n => console.log('  ✗ ' + n));
  console.log('\n' + (fail.length ? fail.length + ' of ' + (pass.length + fail.length) + ' Measure reorder checks FAILED.'
                                  : 'All ' + pass.length + ' Measure reorder checks passed.'));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('E2E harness error:', e); process.exit(2); });
