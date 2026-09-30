#!/usr/bin/env node
'use strict';

// ── Regression test: prep can come back down on site (Windows & Doors) ─────
//
// On Site, prep raised on a window or door is a variation. The picker used
// to hide every level below the CURRENT one, so a raise could never be
// brought back down -- tap Heavy by mistake, or find the timber better than
// feared once scraped, and the only way out was Measure. What is held here:
//
//   1. On site, a quoted opening with no raise offers only its own level and
//      up -- nothing below what the quote priced.
//   2. A raise is a variation: quote_prep_level stamped, draft created.
//   3. While that variation is unanswered, the picker offers every level
//      down to the QUOTE's level (not the job default below it).
//   4. Lowering to a level still above the quote keeps it a raise, in the
//      same variation, measured from the same quote level.
//   5. Lowering all the way to the quote's level dissolves the raise: the
//      opening reads exactly as it did before (stage quote, nothing stamped).
//   6. Nothing below the quote's level can be set, even by calling the
//      handler directly.
//   7. Once the variation is answered, the raise is locked: no level below
//      it is offered and a call to lower it does nothing.
//   8. An opening whose quoted level is above the job default still floors
//      at its quoted level, not the default.
//
// Driven in a real browser against the real public/index.html (served off
// disk, no server, no database -- writes 404 and queue, as offline on site).
//
// USAGE
//   node scripts/test-windoors-prep-lower.js
//   npm run test:windoors-prep-lower

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

const SEED = () => {
  jobs = [{ id: 'j1', name: 'Test Job', status: 'accepted', windoorsVariations: [] }];
  activeJobId = 'j1';
  windoors = {
    jobId: 'j1',
    property: { job_id: 'j1', style: 'georgian', detail_enabled: true, default_prep: 'light', layout: {}, coats: 2 },
    openings: [
      { id: 'w1', side: 'front', level: 'standard', floor: 0, position: 1, kind: 'window', type: 'sash', size_tier: 'medium', rows: 2, cols: 3,
        nickname: null, prep_level: null, prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null,
        bay_shape: null, bay_storeys: null, parent_opening_id: null, panes_set: false },
      { id: 'w2', side: 'front', level: 'standard', floor: 0, position: 2, kind: 'window', type: 'sash', size_tier: 'medium', rows: 2, cols: 3,
        nickname: null, prep_level: 'standard', prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null,
        bay_shape: null, bay_storeys: null, parent_opening_id: null, panes_set: false }
    ],
    marks: []
  };
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
  await page.evaluate(async () => { await openWindoors('site'); openWdDetail('w1'); });

  // The prep picker's buttons, read off the rendered sheet.
  const offered = () => page.evaluate(() => Array.from(document.querySelectorAll('#wd-sheet-body button'))
    .filter(b => /setWdPrep\(/.test(b.getAttribute('onclick') || ''))
    .map(b => (b.getAttribute('onclick').match(/'([^']+)'/) || [])[1] + (b.classList.contains('active') ? '*' : '')));
  const row = (id) => page.evaluate((i) => {
    const o = windoors.openings.find(x => x.id === i);
    return { prep_level: o.prep_level, prep_stage: o.prep_stage, quote_prep_level: o.quote_prep_level, hasVar: !!o.prep_variation_id };
  }, id);
  const tap = (level) => page.evaluate((l) => {
    const b = Array.from(document.querySelectorAll('#wd-sheet-body button')).find(x => (x.getAttribute('onclick') || '') === "setWdPrep('" + l + "')");
    if (!b) return false;
    b.click(); return true;
  }, level);

  // ── 1. No raise: nothing below the quote ─────────────────────────────────
  eq('1. a quoted opening offers its own level and up', await offered(), ['light*', 'standard', 'heavy', 'restoration']);

  // ── 2. Raise ─────────────────────────────────────────────────────────────
  check('2. tapped Heavy', await tap('heavy'));
  eq('2. raised as a variation from the quote\'s level', await row('w1'),
    { prep_level: 'heavy', prep_stage: 'variation', quote_prep_level: 'light', hasVar: true });
  const varId = await page.evaluate(() => windoors.openings.find(x => x.id === 'w1').prep_variation_id);

  // ── 3. Down to the quote, not just the current level ─────────────────────
  eq('3. an unanswered raise offers every level down to the quote\'s', await offered(), ['light', 'standard', 'heavy*', 'restoration']);

  // ── 4. Part way down ─────────────────────────────────────────────────────
  check('4. tapped Standard', await tap('standard'));
  eq('4. still a raise, from the same quote level', await row('w1'),
    { prep_level: 'standard', prep_stage: 'variation', quote_prep_level: 'light', hasVar: true });
  eq('4. in the same variation', await page.evaluate(() => windoors.openings.find(x => x.id === 'w1').prep_variation_id), varId);
  check('4. and the variation text says so', /prep raised to standard/.test(await page.evaluate((v) => Windoors.describeVariation(windoors, v), varId)));

  // ── 5. All the way back ──────────────────────────────────────────────────
  check('5. tapped Light', await tap('light'));
  eq('5. the raise dissolves: back to exactly as quoted', await row('w1'),
    { prep_level: null, prep_stage: 'quote', quote_prep_level: null, hasVar: false });
  eq('5. and the picker is back to the quote\'s level and up', await offered(), ['light*', 'standard', 'heavy', 'restoration']);

  // ── 6. Never below the quote ─────────────────────────────────────────────
  await page.evaluate(() => { openWdDetail('w2'); setWdPrep('light'); });
  eq('6. a direct call below the quote does nothing', await row('w2'),
    { prep_level: 'standard', prep_stage: 'quote', quote_prep_level: null, hasVar: false });

  // ── 8. Floors at the quoted level, not the default ───────────────────────
  eq('8. quoted at Standard: Standard and up only', await offered(), ['standard*', 'heavy', 'restoration']);
  await tap('restoration');
  eq('8. raised from Standard', await row('w2'),
    { prep_level: 'restoration', prep_stage: 'variation', quote_prep_level: 'standard', hasVar: true });
  eq('8. and can come back to Standard but not Light', await offered(), ['standard', 'heavy', 'restoration*']);
  await tap('standard');
  eq('8. back to Standard, as quoted', await row('w2'),
    { prep_level: 'standard', prep_stage: 'quote', quote_prep_level: null, hasVar: false });

  // ── 7. Answered: locked ──────────────────────────────────────────────────
  await tap('heavy');
  await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const v = activeJob().windoorsVariations.find(x => x.id === o.prep_variation_id);
    v.sentAt = new Date().toISOString(); v.variationStatus = 'approved';
    renderWdDetail();
  });
  eq('7. an answered raise offers nothing below it', await offered(), ['heavy*', 'restoration']);
  await page.evaluate(() => setWdPrep('standard'));
  eq('7. and a direct call to lower it does nothing', await row('w2'),
    { prep_level: 'heavy', prep_stage: 'variation', quote_prep_level: 'standard', hasVar: true });

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
