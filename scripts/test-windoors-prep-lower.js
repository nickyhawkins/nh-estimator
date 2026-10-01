#!/usr/bin/env node
'use strict';

// ── Regression test: prep can come back down on site (Windows & Doors) ─────
//
// On Site, prep raised on a window or door is a variation. The picker used
// to hide every level below the CURRENT one, so a raise could never be
// brought back down -- tap Heavy by mistake, or find the timber better than
// feared once scraped, and the only way out was Measure. What is held here:
//
// v2.91.0 then went further (Nicky: "sometimes it is better than expected,
// same as sometimes it's worse"): prep can go BELOW what the quote priced,
// and the difference is a credit on the variation.
//
//   1. On site, every level is offered.
//   2. A raise is a variation: quote_prep_level stamped, draft created.
//   3. While that variation is unanswered, every level is still offered.
//   4. Lowering to a level still above the quote keeps it a raise, in the
//      same variation, measured from the same quote level.
//   5. Lowering all the way to the quote's level dissolves the raise: the
//      opening reads exactly as it did before (stage quote, nothing stamped).
//   6. Below the quote's level -- even below the job default -- is a CREDIT:
//      a negative line for that window, worded "prep lowered to", shown to
//      the client as a negative line, netted against other work found on the
//      window, kept off interim invoices and carried by the final.
//   7. v3.3.0: work found on site is never "answered", so a change is just
//      a change. A job from before -- a raise approved on one variation,
//      lowered back on another -- folds in and nets to nothing.
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

  // ── 1. Every level on offer ──────────────────────────────────────────────
  eq('1. a quoted opening offers every level', await offered(), ['light*', 'standard', 'heavy', 'restoration']);

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
  eq('5. and the picker still offers every level', await offered(), ['light*', 'standard', 'heavy', 'restoration']);
  eq('5. and nothing is found on site', await page.evaluate(() => windoorsFoundLines().length), 0);

  // ── 6. Below the quote: a credit ─────────────────────────────────────────
  await page.evaluate(() => openWdDetail('w2'));
  eq('6. quoted at Standard (above the default): Light is offered too', await offered(), ['light', 'standard*', 'heavy', 'restoration']);
  check('6. tapped Light', await tap('light'));
  eq('6. lowered on site from the quote\'s level', await row('w2'),
    { prep_level: 'light', prep_stage: 'variation', quote_prep_level: 'standard', hasVar: true });
  const credit = await page.evaluate(() => {
    const per = Windoors.priceJob(windoors, wdRates()).perOpening.w2;
    const lines = windoorsFoundLines();
    return { lines: lines.map(l => ({ id: l.id, raw: Math.round(l.raw * 100) / 100, credit: l.credit, status: l.status })),
             expect: Math.round(per.scaled * (wdRates().prep.light - wdRates().prep.standard) * rpm() * 100) / 100,
             text: lines[0] && lines[0].name,
             client: buildClientVariationLines().filter(l => l.kind === 'windoorsfound').map(l => [l.status, l.amount < 0]) };
  });
  // v3.3.0: found on site, a line per WINDOW, approved -- nothing to ask.
  eq('6. one line, for the window, below zero, a credit, approved', credit.lines.map(l => [l.id, l.credit, l.status, l.raw < 0]), [['w2', true, 'approved', true]]);
  eq('6. priced as the scaled opening × (Light − Standard)', credit.lines[0].raw, credit.expect);
  check('6. and worded as lowered, under the window\'s name', /W2: prep lowered to light$/.test(credit.text), credit.text);
  eq('6. it is shown to the client as a negative line, nothing to answer', credit.client, [['approved', true]]);
  check('6. the sheet says it is a credit',
    /lowered on site from Standard \(the quote\) — a credit/.test(await page.evaluate(() => document.getElementById('wd-sheet-body').textContent)));
  check('6. the Variations card shows it as money off', await page.evaluate(() =>
    /−£/.test(fmtSigned(-12.5)) && fmtSigned(-12.5) === '−£12.50' && fmtSigned(12.5) === '£12.50'));

  // Netted against other work found on the same window.
  const netted = await page.evaluate(() => {
    const before = windoorsFoundLines()[0].raw;
    const d = wdDraft(false);
    windoors.marks.push({ id: 'm1', opening_id: 'w2', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: d.id });
    const after = windoorsFoundLines();
    // A resin repair with no size is a Medium (RESIN_REPAIR_TIERS_SPEC.md).
    const a = Windoors.actionPrice(wdRates(), 'resin', 'medium');
    const out = { n: after.length, delta: Math.round((after[0].raw - before) * 100) / 100, want: Math.round((a.mins * rpm() + a.cost) * 100) / 100 };
    windoors.marks = [];
    return out;
  });
  eq('6. other work on the window nets against the credit, on its one line', [netted.n, netted.delta], [1, netted.want]);

  const billed = await page.evaluate(() => {
    let interim = null, fin = null;
    try { interim = interimVariationCandidates(activeJob()).filter(l => l.kind === 'windoorsfound').length; } catch (e) { interim = 'error: ' + e.message; }
    try { fin = buildFinalInvoiceModel().labour.filter(l => l.wd).map(l => [l.site.amount < -0.005, Math.abs(l.amount - (l.quoted + l.site.amount)) < 0.005]); } catch (e) { fin = 'error: ' + e.message; }
    renderWdDetail();
    return { interim, fin };
  });
  eq('6. a credit is not billed on an interim (the final squares it)', billed.interim, 0);
  // WINDOWS_DOORS_INVOICE_SPEC.md: one windows and doors line, and the
  // credit comes off it -- below the quote when it outweighs the site work.
  eq('6. the final invoice takes the credit off the one windows and doors line', billed.fin, [[true, true]]);
  eq('6. every level is still offered', await offered(), ['light*', 'standard', 'heavy', 'restoration']);
  await page.evaluate(() => setWdPrep('heavy'));
  const afterCredit = await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const lines = windoorsFoundLines().map(l => ({ credit: l.credit, status: l.status }));
    return { steps: (o.prep_steps || []).length, level: o.prep_level, lines };
  });
  // Found work is never "answered", so a change is just a change.
  eq('6. raised again: the level simply moves, no step filed', [afterCredit.steps, afterCredit.level], [0, 'heavy']);
  eq('6. ...and the window is one line, now extra work', afterCredit.lines, [{ credit: false, status: 'approved' }]);

  // Reset w2 to exactly as quoted for the next section.
  await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    Object.assign(o, { prep_level: 'standard', prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null, prep_steps: [] });
    activeJob().windoorsVariations = [];
    wdSaveMirror();
    renderWdDetail();
  });

  // ── 7. Nicky's W1, from before v3.3.0: folded in ─────────────────────────
  // Raised to Heavy on one approved variation, lowered back to Standard (the
  // quote) on a second: a charge and a credit for nothing. Folded in, it nets.
  const w1 = await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    Object.assign(o, { prep_stage: 'variation', quote_prep_level: 'standard', prep_level: 'standard',
                       prep_variation_id: 'vdown', prep_steps: [{ variation_id: 'vup', level: 'heavy' }] });
    windoors.marks.push({ id: 'mr', opening_id: 'w2', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: 'vup' });
    activeJob().windoorsVariations = [
      { id: 'vup', sentAt: '2026-09-29T09:00:00Z', variationStatus: 'approved', variationApprovedAt: '2026-09-29T09:00:00Z' },
      { id: 'vdown', sentAt: null }];
    const folded = wdFoldInVariations();
    const lines = windoorsFoundLines();
    const a = Windoors.actionPrice(wdRates(), 'resin', 'medium');
    renderWdDetail();
    return { folded, all: activeJob().windoorsVariations.map(v => [v.found, v.variationStatus]),
             lines: lines.map(l => [l.id, Math.round(l.raw * 100) / 100, l.work]), want: Math.round((a.mins * rpm() + a.cost) * 100) / 100,
             note: document.getElementById('wd-sheet-body').textContent };
  });
  eq('7. both old variations are folded in, approved', [w1.folded, w1.all], [2, [[true, 'approved'], [true, 'approved']]]);
  eq('7. the window is one line: the repair, the prep netted to nothing', w1.lines, [['w2', w1.want, 'resin repair (cill)']]);
  check('7. and the sheet says nothing about prep', !/on site from/.test(w1.note));
  check('7. tapped Light, below the quote', await tap('light'));
  eq('7. it moves straight there, no new step', await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    return [o.prep_level, (o.prep_steps || []).length, windoorsFoundLines().length];
  }), ['light', 1, 1]);

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
