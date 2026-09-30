#!/usr/bin/env node
'use strict';

// ── Resin repairs: size tiers and on-site upgrades (RESIN_REPAIR_TIERS_SPEC.md)
//
// Driven in a real browser against the real public/index.html (served off
// disk, no server, no database -- writes 404 and queue, as offline on site):
//
//   1. Quoting: a repair has a size, an old one reads as Medium, and before
//      acceptance the size moves the quote either way.
//   2. Acceptance locks it: sizes below the agreed one are off.
//   3. Upgraded on site: the quote doesn't move, no variation is made, the
//      difference is an adjustment -- badged, listed, on the On Site card,
//      and on the client's page as one line with nothing to answer.
//   4. Back down to the agreed size undoes it.
//   5. A repair found on site is a variation (at the last size used); its
//      size moves the draft freely, and once sent an upgrade is an adjustment.
//   6. The final invoice bills adjustments as their own line.
//   7. Amending the quote re-agrees its repairs at today's size.
//
// USAGE
//   node scripts/test-windoors-resin-tiers.js
//   npm run test:windoors-resin-tiers

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

const near = (name, got, want) => check(name, Math.abs(got - want) < 0.005, { got, want });
const SEED = () => {
  jobs = [{ id: 'j1', name: 'Test Job', status: 'quoted', windoorsVariations: [] }];
  activeJobId = 'j1';
  windoors = {
    jobId: 'j1',
    property: { job_id: 'j1', style: 'georgian', detail_enabled: true, default_prep: 'light', layout: {}, coats: 2 },
    openings: [
      { id: 'w1', side: 'front', level: 'standard', floor: 0, position: 1, kind: 'window', type: 'sash', size_tier: 'medium', rows: 2, cols: 3,
        nickname: null, prep_level: null, prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null,
        bay_shape: null, bay_storeys: null, parent_opening_id: null, panes_set: false }
    ],
    // A resin repair from before tiers: no size at all.
    marks: [{ id: 'r1', opening_id: 'w1', element_id: 'cill', action_key: 'resin', stage: 'quote', variation_id: null, created_at: '2026-09-01T09:00:00Z' }]
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
  await page.evaluate(async () => { await openWindoors('quote'); openWdDetail('w1'); });

  // The size buttons for a mark, read off the rendered sheet: key, * active, ! disabled.
  const offered = (id) => page.evaluate((i) => Array.from(document.querySelectorAll('#wd-sheet-body button'))
    .filter(b => (b.getAttribute('onclick') || '').indexOf("setWdMarkTier.bind(null,'" + i + "')") === 0)
    .map(b => (b.getAttribute('onclick').match(/\('([a-z]+)'\)$/) || [])[1] + (b.classList.contains('active') ? '*' : '') + (b.disabled ? '!' : '')), id);
  const tap = (id, tier) => page.evaluate(([i, t]) => {
    const b = Array.from(document.querySelectorAll('#wd-sheet-body button')).find(x => (x.getAttribute('onclick') || '') === "setWdMarkTier.bind(null,'" + i + "')('" + t + "')");
    if (!b || b.disabled) return false;
    b.click(); return true;
  }, [id, tier]);
  const state = () => page.evaluate(() => {
    const p = Windoors.priceJob(windoors, wdRates());
    return { quoteMins: Math.round(p.quote.mins * 100) / 100, adj: wdAdjustments(), vars: windoorsVariationLines().map(l => Math.round(l.raw * 100) / 100),
             marks: windoors.marks.map(m => ({ id: m.id, size: m.size_tier || null, agreed: m.agreed_size_tier || null, up: !!m.upgraded_at })) };
  });
  const R = await page.evaluate(() => wdRates().actions.resin);
  const tm = t => R.baseMins + R.tiers[t].mins;

  // ── Quoting: a size on the repair, freely either way ─────────────────────
  eq('1. an old repair reads as Medium, every size offered', await offered('r1'), ['small', 'medium*', 'large', 'xlarge']);
  check('1. the label names the size', /Resin repair \(cill, M\)/.test(await page.evaluate(() => document.getElementById('wd-sheet-body').textContent)));
  const q0 = await state();
  check('1. tapped L', await tap('r1', 'large'));
  const q1 = await state();
  near('1. before acceptance a size change moves the quote', q1.quoteMins - q0.quoteMins, tm('large') - tm('medium'));
  eq('1. ...and nothing is an adjustment', q1.adj.items.length, 0);
  check('1. tapped S (down is fine while quoting)', await tap('r1', 'small'));
  near('1. ...the quote follows', (await state()).quoteMins - q0.quoteMins, tm('small') - tm('medium'));
  check('1. back to L', await tap('r1', 'large'));

  // ── Accepted: the quoted size is the floor ───────────────────────────────
  await page.evaluate(() => { activeJob().status = 'accepted'; wdStampTiers(); });
  eq('2. acceptance locks the repair at its size', (await state()).marks[0], { id: 'r1', size: 'large', agreed: 'large', up: false });
  await page.evaluate(async () => { closeWdDetail(); await openWindoors('site'); openWdDetail('w1'); });
  eq('2. on site, sizes below the agreed one are off', await offered('r1'), ['small!', 'medium!', 'large*', 'xlarge']);
  check('2. S cannot be tapped', !(await tap('r1', 'small')));
  await page.evaluate(() => setWdMarkTier('r1', 'small'));
  eq('2. ...nor set behind the button\'s back', (await state()).marks[0].size, 'large');

  // ── Upgrade on site ──────────────────────────────────────────────────────
  check('3. tapped XL', await tap('r1', 'xlarge'));
  const s3 = await state();
  near('3. the quote does not move', s3.quoteMins, q1.quoteMins);
  eq('3. no variation is made', s3.vars, []);
  eq('3. no draft was opened', await page.evaluate(() => wdVariationList().length), 0);
  eq('3. the repair is upgraded', s3.marks[0], { id: 'r1', size: 'xlarge', agreed: 'large', up: true });
  const rpm = await page.evaluate(() => rpm());
  near('3. the adjustment is the tier difference', s3.adj.raw, (R.tiers.xlarge.mins - R.tiers.large.mins) * rpm + (R.tiers.xlarge.cost - R.tiers.large.cost));
  const sheet3 = await page.evaluate(() => document.getElementById('wd-sheet-body').textContent);
  check('3. the badge says L → XL', /L → XL/.test(sheet3), sheet3.slice(0, 400));
  check('3. the work list shows the size adjustment', /size adjustment/.test(sheet3));
  const listText = await page.evaluate(() => { openWdAdjustmentsSheet(); const t = document.getElementById('schedule-sheet').textContent; closeScheduleSheet(); return t; });
  check('3. the list names the repair', /Front, ground floor, W1: resin repair \(cill\) L\s→\sXL/.test(listText), listText);
  check('3. the On Site card carries the line', /Repair size adjustments/.test(await page.evaluate(() => windoorsOnSiteCardHtml())));
  const cl = await page.evaluate(() => buildClientVariationLines());
  eq('3. the client page gets one adjustments line, approved, nothing to answer', cl.map(l => [l.kind, l.status]), [['windoorsadj', 'approved']]);
  near('3. ...at the invoiced figure', cl[0].amount, Math.round(s3.adj.amount * 100) / 100);
  await page.screenshot({ path: process.env.SHOT_DIR ? path.join(process.env.SHOT_DIR, 'resin-upgrade.png') : '/dev/null' }).catch(() => {});

  check('4. tapped L, the agreed size', await tap('r1', 'large'));
  const s4 = await state();
  eq('4. the upgrade is undone', s4.marks[0], { id: 'r1', size: 'large', agreed: 'large', up: false });
  eq('4. ...and so is the adjustment', s4.adj.items.length, 0);
  check('4. tapped XL again', await tap('r1', 'xlarge'));

  // ── A repair found on site: a variation, then an upgrade once sent ───────
  await page.evaluate(() => { wdSel = { kind: 'part', ids: { left_stile: true } }; wdApplyAction('resin'); });
  const vm = await page.evaluate(() => windoors.marks.find(m => m.element_id === 'left_stile'));
  eq('5. a new repair starts at the last size used', vm.size_tier, 'xlarge');
  eq('5. ...as a variation', vm.stage, 'variation');
  const d0 = (await state()).vars[0];
  check('5. tapped M on the draft', await tap(vm.id, 'medium'));
  const s5 = await state();
  near('5. a draft\'s size edits move the variation', s5.vars[0] - d0, -((R.tiers.xlarge.mins - R.tiers.medium.mins) * rpm + (R.tiers.xlarge.cost - R.tiers.medium.cost)));
  eq('5. ...not the adjustments (only the quote repair\'s)', s5.adj.items.map(i => i.mark_id), ['r1']);
  await page.evaluate(() => wdCloseDraftsSent([{ kind: 'windoors', sourceId: wdVariationList()[0].id }]));
  eq('5. sending it locks its repair', (await state()).marks.find(m => m.id === vm.id).agreed, 'medium');
  await page.evaluate(() => renderWdDetail());
  eq('5. ...so below it is off', await offered(vm.id), ['small!', 'medium*', 'large', 'xlarge']);
  check('5. tapped L on the sent repair', await tap(vm.id, 'large'));
  const s6 = await state();
  near('5. the sent variation holds its price', s6.vars[0], s5.vars[0]);
  eq('5. the upgrade is an adjustment', s6.adj.items.map(i => i.mark_id).sort(), ['r1', vm.id].sort());
  await page.evaluate((id) => { const v = wdVariationList()[0]; v.variationStatus = 'declined'; }, vm.id);
  eq('5. a declined variation\'s upgrade is not billed', (await state()).adj.items.map(i => i.mark_id), ['r1']);
  await page.evaluate(() => { const v = wdVariationList()[0]; v.variationStatus = 'approved'; });

  // ── The final invoice: its own line, not the quote's ─────────────────────
  const inv = await page.evaluate(() => { try { const m = buildFinalInvoiceModel(); return { v: m.variations.filter(l => l.id === 'wdadj'), labour: m.labour.map(l => l.desc) }; } catch (e) { return { error: e.message }; } });
  check('6. the final invoice builds', !inv.error, inv.error);
  if (!inv.error) {
    eq('6. one adjustments line, needing no sign-off', inv.v.map(l => [l.signoff, l.dropped]), [['adjustment', false]]);
    near('6. ...at the same figure the client sees', inv.v[0].amount, (await state()).adj.amount);
  }

  // ── Amending re-agrees the repairs ───────────────────────────────────────
  await page.evaluate(() => wdStampTiers({ restamp: true }));
  eq('7. amending folds the quote repair\'s upgrade into the quote', (await state()).adj.items.map(i => i.mark_id), [vm.id]);

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
