#!/usr/bin/env node
'use strict';

// ── Regression test: On Site materials reach the shopping list ─────────────
//
// Materials added by hand on On Site ("Add material the estimate missed")
// only ever exist on that screen -- they are actuals, not estimate lines, so
// they never appear on Summary's materials card, which is where the "🛒 Add
// to list" chip lived. That left the one material you are most likely to
// still need to BUY as the one with no route to the shopping list: you note
// the extra tin standing in the room, then have to remember it again at the
// merchant's.
//
// So a manual On Site row now carries the same chip. What is held here:
//
//   1. EVERY materials row on the screen has the chip -- the ones added by
//      hand and the ones pulled from the quote alike. This is the screen you
//      are standing in the room with, and an un-ticked quoted tin is just as
//      much a thing to pick up as a sundry the estimate missed.
//   2. A tap puts one line on the list carrying the row's description, its
//      item code, its price and the job's NAME as a tag, so the list says
//      why the tin is there.
//   3. The chip flips to "✓ On list" WITHOUT re-rendering the screen, so a
//      half-typed entry in the add form below it survives the tap.
//   4. A row with no real price goes on with no price rather than £0.00,
//      which at a till reads as free -- and neither does a PER-LITRE row,
//      whose unit amount is a price per litre rather than the price of a
//      thing you can pick up. That rule only reaches estimate-pulled rows.
//   5. Tapping twice does not duplicate, and the chip reads "✓ On list" from
//      the real list state on the next render.
//   6. Re-adding something already ticked off un-ticks it -- a fresh need for
//      the same item -- which is shopListAdd's rule, exercised through this
//      new entry point rather than trusted to stay true from the old one.
//   7. The same product needed by a second job is ONE line carrying both job
//      names, not two lines.
//   8. A coded row matches on code and a free-text one on name; neither is
//      mistaken for the other.
//   9. The same product tapped here and on Summary is ONE line: both entry
//      points funnel through shopListAdd, so they cannot disagree about what
//      is already on the list. A key matching no row does nothing.
//  10. A row already ticked as bought keeps its chip: "bought" means bought
//      once, and running out of it is exactly a shopping-list event.
//
// Driven in a real browser against the real public/index.html, because what
// is being tested is the rendered chip and the handler behind it, not a pure
// function. The app shell is served straight off disk -- no server, no
// database -- and the globals renderActuals() reads are set directly, which
// is the same fixture a job would produce. Writes go to a 404 and queue,
// exactly as they do offline on site; the in-memory list is the assertion.
//
// USAGE
//   node scripts/test-onsite-shoplist.js
//   npm run test:onsite-shoplist

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) {
  try { ({ chromium } = require('playwright')); }
  catch (e2) {
    console.error('This test needs Playwright (playwright-core is a devDependency).');
    process.exit(2);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const p = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch (e) { /* not installed under this name */ }
  }
  throw new Error('No Chrome/Chromium found. Install one, or point CHROME_PATH at the executable.');
}

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// The fixture: one estimate line, and three materials added by hand on On
// Site -- free text, coded, and one with no price typed.
const SEED = () => {
  jobs = [{ id: 'j1', name: 'Test Job', status: 'accepted' }, { id: 'j2', name: 'Second Job', status: 'accepted' }];
  activeJobId = 'j1';
  colours = [{ number: 1, name: 'White' }];
  materialsSnapshot = [
    { id: 'l1', itemCode: 'PAINT1', description: 'Dulux WS Gloss & UC 5ltr', quantity: 2, unitAmount: 78.07, isPerLitre: false, colourNumber: 1 },
    // Sold by the litre, so its unitAmount is £/litre -- never a till price.
    { id: 'l2', itemCode: 'PAINT2', description: 'Trade Vinyl Matt — White', quantity: 7.5, unitAmount: 6.2, isPerLitre: true, colourNumber: 1 }
  ];
  materialActuals = [
    { id: 'a1', itemCode: null, description: 'Extra roller sleeves', actualQuantity: 3, unitAmount: 4.5, bought: false, colourNumber: null },
    { id: 'a2', itemCode: 'SUN123', description: 'Masking tape 50m', actualQuantity: 2, unitAmount: 3.2, bought: false, colourNumber: null },
    { id: 'a3', itemCode: null, description: 'Dust sheets', actualQuantity: 1, unitAmount: 0, bought: false, colourNumber: null }
  ];
  shopList = [];
  goTab('actuals');
  renderActuals();
};

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(SEED);

  // Chips are keyed on render index; find a row's chip by its description so
  // the test doesn't encode the screen's ordering.
  const chip = (desc) => page.evaluate((d) => {
    const i = actualsRowsCache.findIndex(r => r.description === d);
    const el = i < 0 ? null : document.getElementById('act-shop-' + i);
    return el ? el.textContent : null;
  }, desc);
  const tap = (desc) => page.evaluate((d) => {
    const i = actualsRowsCache.findIndex(r => r.description === d);
    const el = i < 0 ? null : document.getElementById('act-shop-' + i);
    if (!el) return false;
    el.click();
    return true;
  }, desc);
  const list = () => page.evaluate(() => (shopList || []).map(i =>
    ({ name: i.name, code: i.code, price: i.price, ticked: i.ticked, jobTags: i.jobTags || [] })));

  // ── 1. Who gets a chip ───────────────────────────────────────────────────
  eq('1. an estimate-pulled row has one', await chip('Dulux WS Gloss & UC 5ltr'), '🛒 Add to list');
  eq('1. a manually-added free-text row has one', await chip('Extra roller sleeves'), '🛒 Add to list');
  eq('1. a manually-added coded row has one', await chip('Masking tape 50m'), '🛒 Add to list');
  eq('1. every row on the screen has one, none missed',
    await page.evaluate(() => [actualsRowsCache.length,
      document.querySelectorAll('[id^=act-shop-]').length]), [5, 5]);

  // ── 2/3. A tap, and what it disturbs ─────────────────────────────────────
  await page.evaluate(() => { document.getElementById('act-add-desc').value = 'half typed'; });
  check('2. the chip was tapped', await tap('Extra roller sleeves'));
  eq('2. one line, with the row\'s name, price and the job\'s name', await list(), [
    { name: 'Extra roller sleeves', code: '', price: 4.5, ticked: false, jobTags: ['Test Job'] }
  ]);
  eq('3. the chip says so straight away', await chip('Extra roller sleeves'), '✓ On list');
  eq('3. and a half-typed add form survived the tap',
    await page.evaluate(() => document.getElementById('act-add-desc').value), 'half typed');

  // ── 8. Coded rows carry their code ───────────────────────────────────────
  await tap('Masking tape 50m');
  eq('8. a coded row goes on with its item code',
    (await list()).find(i => i.name === 'Masking tape 50m'), { name: 'Masking tape 50m', code: 'SUN123', price: 3.2, ticked: false, jobTags: ['Test Job'] });

  // ── 4. No price is better than a wrong one ───────────────────────────────
  await tap('Dust sheets');
  eq('4. a row with no price typed goes on WITHOUT a price',
    ((await list()).find(i => i.name === 'Dust sheets') || { price: 'not on the list' }).price, null);
  await tap('Trade Vinyl Matt — White');
  eq('4. a per-litre row goes on WITHOUT its per-litre price',
    ((await list()).find(i => i.code === 'PAINT2') || { price: 'not on the list' }).price, null);
  eq('4. but it does go on, with its code and the job tag',
    ((await list()).find(i => i.code === 'PAINT2') || {}).jobTags, ['Test Job']);

  // ── 5. Twice is once ─────────────────────────────────────────────────────
  await tap('Extra roller sleeves');
  await tap('Extra roller sleeves');
  eq('5. tapping again never duplicates', (await list()).filter(i => i.name === 'Extra roller sleeves').length, 1);
  await page.evaluate(() => renderActuals());
  eq('5. and a re-render reads the state back off the real list', await chip('Extra roller sleeves'), '✓ On list');
  eq('5. every added row reads back the same way', await chip('Masking tape 50m'), '✓ On list');

  // ── 6. Ticked off, then needed again ─────────────────────────────────────
  await page.evaluate(() => {
    const it = shopList.find(i => i.name === 'Extra roller sleeves');
    if (it) it.ticked = true;
    renderActuals();
  });
  eq('6. a ticked-off line reads as not on the list', await chip('Extra roller sleeves'), '🛒 Add to list');
  await tap('Extra roller sleeves');
  eq('6. re-adding un-ticks it rather than adding a second line', await list(), [
    { name: 'Extra roller sleeves', code: '', price: 4.5, ticked: false, jobTags: ['Test Job'] },
    { name: 'Masking tape 50m', code: 'SUN123', price: 3.2, ticked: false, jobTags: ['Test Job'] },
    { name: 'Dust sheets', code: '', price: null, ticked: false, jobTags: ['Test Job'] },
    { name: 'Trade Vinyl Matt — White', code: 'PAINT2', price: null, ticked: false, jobTags: ['Test Job'] }
  ]);

  // ── 7. Two jobs, one line ────────────────────────────────────────────────
  await page.evaluate(() => {
    activeJobId = 'j2';
    materialActuals = [{ id: 'b1', itemCode: 'SUN123', description: 'Masking tape 50m', actualQuantity: 1, unitAmount: 3.2, bought: false, colourNumber: null }];
    materialsSnapshot = [];
    renderActuals();
  });
  eq('7. the second job sees it as not yet on ITS list', await chip('Masking tape 50m'), '🛒 Add to list');
  await tap('Masking tape 50m');
  eq('7. and adding gives one line carrying both job names',
    (await list()).filter(i => i.code === 'SUN123').map(i => i.jobTags), [['Test Job', 'Second Job']]);

  // ── 9/10. Agreeing with Summary, and a bought row ────────────────────────
  await page.evaluate(SEED);
  await page.evaluate(() => { shopList = []; renderActuals(); });
  // Summary's own chip on the SAME product, tapped first. The two entry
  // points must land on one line, and this screen must then read it as
  // already on the list -- otherwise the same tin gets bought twice.
  const crossed = await page.evaluate(() => {
    if (typeof addActualToShopList !== 'function') return 'addActualToShopList() is missing';
    addMaterialToShopList('l1');                 // Summary's snapshot line id
    addActualToShopList('code:PAINT1');          // the same product, here
    return shopList.filter(i => i.code === 'PAINT1').length;
  });
  eq('9. tapped on Summary and here, it is ONE line', crossed, 1);
  await page.evaluate(() => renderActuals());
  eq('9. and this screen reads Summary\'s add as already on the list',
    await chip('Dulux WS Gloss & UC 5ltr'), '✓ On list');
  eq('9. a key matching no row does nothing', await page.evaluate(() => {
    const before = shopList.length;
    addActualToShopList('desc:nothing like this');
    return shopList.length - before;
  }), 0);

  await page.evaluate(() => {
    materialActuals[0].bought = true;
    renderActuals();
  });
  eq('10. a row ticked as bought keeps its chip', await chip('Extra roller sleeves'), '🛒 Add to list');
  await tap('Extra roller sleeves');
  check('10. and can still be put back on the list',
    (await list()).some(i => i.name === 'Extra roller sleeves' && !i.ticked), await list());

  check('no page errors', errors.length === 0, errors);

  await browser.close();
  srv.close();

  console.log('\n' + pass.length + ' passed');
  pass.forEach(n => console.log('  ✓ ' + n));
  if (fail.length) {
    console.log('\n' + fail.length + ' FAILED');
    fail.forEach(n => console.log('  ✗ ' + n));
    process.exit(1);
  }
  console.log('\nAll good.');
})().catch((e) => { console.error(e); process.exit(1); });
