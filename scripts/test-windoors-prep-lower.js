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
//      a negative variation line, worded "prep lowered to", published to the
//      client as a negative line, netted against extra work in the same
//      draft, kept off interim invoices and carried by the final.
//   7. v2.91.1 (Nicky's W1): an ANSWERED change is never rewritten. Lowering
//      a raise the client approved files the raise as agreed (prep_steps)
//      and puts the drop on a new variation as a credit from the agreed
//      level; going back to the agreed level removes the new step. Raising
//      an agreed credit works the same way the other way round.
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
  eq('5. and the draft has nothing left in it', await page.evaluate(() => windoorsVariationLines().length), 0);

  // ── 6. Below the quote: a credit ─────────────────────────────────────────
  await page.evaluate(() => openWdDetail('w2'));
  eq('6. quoted at Standard (above the default): Light is offered too', await offered(), ['light', 'standard*', 'heavy', 'restoration']);
  check('6. tapped Light', await tap('light'));
  eq('6. lowered as a variation from the quote\'s level', await row('w2'),
    { prep_level: 'light', prep_stage: 'variation', quote_prep_level: 'standard', hasVar: true });
  const credit = await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const per = Windoors.priceJob(windoors, wdRates()).perOpening.w2;
    const lines = windoorsVariationLines();
    return { lines: lines.map(l => ({ raw: Math.round(l.raw * 100) / 100, credit: l.credit, status: l.status })),
             expect: Math.round(per.scaled * (wdRates().prep.light - wdRates().prep.standard) * rpm() * 100) / 100,
             text: Windoors.describeVariation(windoors, o.prep_variation_id),
             client: buildClientVariationLines().filter(l => l.kind === 'windoors').map(l => l.amount < 0) };
  });
  eq('6. the draft is one line, below zero, marked a credit', credit.lines.map(l => [l.credit, l.status, l.raw < 0]), [[true, 'pending', true]]);
  eq('6. priced as the scaled opening × (Light − Standard)', credit.lines[0].raw, credit.expect);
  check('6. and worded as lowered', /W2: prep lowered to light\./.test(credit.text), credit.text);
  eq('6. it is published to the client as a negative line', credit.client, [true]);
  check('6. the sheet says it is a credit',
    /lowered on site from Standard — a credit/.test(await page.evaluate(() => document.getElementById('wd-sheet-body').textContent)));
  check('6. the Variations card shows it as money off', await page.evaluate(() =>
    /−£/.test(fmtSigned(-12.5)) && fmtSigned(-12.5) === '−£12.50' && fmtSigned(12.5) === '£12.50'));

  // Netted against extra work in the same draft.
  const netted = await page.evaluate(() => {
    const before = windoorsVariationLines()[0].raw;
    const d = wdDraft(false);
    windoors.marks.push({ id: 'm1', opening_id: 'w2', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: d.id });
    const after = windoorsVariationLines();
    // A resin repair with no size is a Medium (RESIN_REPAIR_TIERS_SPEC.md).
    const a = Windoors.actionPrice(wdRates(), 'resin', 'medium');
    const out = { n: after.length, delta: Math.round((after[0].raw - before) * 100) / 100, want: Math.round((a.mins * rpm() + a.cost) * 100) / 100 };
    windoors.marks = [];
    return out;
  });
  eq('6. extra work in the same draft nets against the credit, on one line', [netted.n, netted.delta], [1, netted.want]);

  // Answered: approved like any variation, then on the invoices.
  const billed = await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const v = activeJob().windoorsVariations.find(x => x.id === o.prep_variation_id);
    v.sentAt = new Date().toISOString(); v.variationStatus = 'approved';
    let interim = null, fin = null;
    try { interim = interimVariationCandidates(activeJob()).filter(l => l.kind === 'windoors').length; } catch (e) { interim = 'error: ' + e.message; }
    try { fin = buildFinalInvoiceModel().labour.filter(l => l.wd).map(l => [Math.abs(l.amount - l.quoted) < 0.005, l.site.credit > 0.005]); } catch (e) { fin = 'error: ' + e.message; }
    renderWdDetail();
    return { interim, fin };
  });
  eq('6. an approved credit is not billed on an interim (the final squares it)', billed.interim, 0);
  // WINDOWS_DOORS_INVOICE_SPEC.md: one windows and doors line, and the quote
  // is its floor -- a net credit is shown in the builder, not taken off.
  eq('6. the final invoice holds the one line at the quote, the credit shown not taken', billed.fin, [[true, true]]);
  eq('6. once answered, every level is still offered', await offered(), ['light*', 'standard', 'heavy', 'restoration']);
  await page.evaluate(() => setWdPrep('heavy'));
  const afterCredit = await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const lines = windoorsVariationLines().map(l => ({ credit: l.credit, status: l.status }));
    return { steps: (o.prep_steps || []).map(st => st.level), level: o.prep_level, lines };
  });
  eq('6. raising an agreed credit files it as agreed and starts a new step',
    [afterCredit.steps, afterCredit.level], [['light'], 'heavy']);
  eq('6. ...so the approved credit stays on its variation, and the raise is a new pending one',
    afterCredit.lines, [{ credit: true, status: 'approved' }, { credit: false, status: 'pending' }]);

  // Reset w2 to exactly as quoted for the next section.
  await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    Object.assign(o, { prep_level: 'standard', prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null, prep_steps: [] });
    activeJob().windoorsVariations = [];
    wdSaveMirror();
    renderWdDetail();
  });

  // ── 7. Nicky's W1: an APPROVED raise, then found better (v2.91.1) ────────
  await tap('heavy');
  const vA = await page.evaluate(() => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const v = activeJob().windoorsVariations.find(x => x.id === o.prep_variation_id);
    v.sentAt = new Date().toISOString(); v.variationStatus = 'approved';
    renderWdDetail();
    return v.id;
  });
  const approvedRaw = await page.evaluate((id) => windoorsVariationLines().find(l => l.id === id).raw, vA);
  eq('7. an approved raise offers every level, below it too', await offered(), ['light', 'standard', 'heavy*', 'restoration']);
  check('7. tapped Standard', await tap('standard'));
  const w1 = await page.evaluate((id) => {
    const o = windoors.openings.find(x => x.id === 'w2');
    const lines = windoorsVariationLines();
    return { level: o.prep_level, steps: o.prep_steps, sameVar: o.prep_variation_id === id,
             approved: lines.find(l => l.id === id), draft: lines.find(l => l.id !== id),
             note: document.getElementById('wd-sheet-body').textContent };
  }, vA);
  eq('7. the approved raise is filed as agreed', w1.steps, [{ variation_id: vA, level: 'heavy' }]);
  check('7. the drop is on a new variation', !w1.sameVar && w1.level === 'standard');
  check('7. the approved raise keeps its agreed price', w1.approved && Math.abs(w1.approved.raw - approvedRaw) < 0.005, w1.approved);
  check('7. the drop is a credit of the same size on the new draft', w1.draft && w1.draft.credit && w1.draft.status === 'pending'
    && Math.abs(w1.draft.raw + approvedRaw) < 0.005, w1.draft);
  check('7. the sheet says where it came from', /lowered on site from Heavy \(agreed\) — a credit/.test(w1.note));
  check('7. tapped Light, below the quote', await tap('light'));
  eq('7. the credit now runs from Heavy down to Light', await page.evaluate(() => windoors.openings.find(x => x.id === 'w2').prep_level), 'light');
  check('7. tapped Heavy again', await tap('heavy'));
  eq('7. back at the agreed level: the new step is gone, the agreed one is live again', await page.evaluate((id) => {
    const o = windoors.openings.find(x => x.id === 'w2');
    return [o.prep_level, (o.prep_steps || []).length, o.prep_variation_id === id, windoorsVariationLines().length];
  }, vA), ['heavy', 0, true, 1]);
  check('7. and the sheet says a change from here is new', /Heavy agreed on site — a change from here is a new variation/.test(
    await page.evaluate(() => document.getElementById('wd-sheet-body').textContent)));

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
