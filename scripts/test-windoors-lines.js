#!/usr/bin/env node
'use strict';

// ── The exterior's lines on the quote and invoices (EXTERIOR_HOUSE_SPEC.md,
//    invoice layout) ─────────────────────────────────────────────────────────
//
//   1. quoteGroups splits the quoted money exactly, in every layout: one
//      line, woodwork and walls apart (the default), a full breakdown.
//   2. The client's quote and the accepted snapshot carry a row per line,
//      the first keyed 'windoors:windoors' as every quote before.
//   3. The final invoice -- from live figures and from the frozen snapshot
//      -- bills a line each, and puts each site addition on its opening's
//      line (filler on the wall to the walls, glass to the windows).
//   4. Interims: a Xero line per exterior line, site additions on the first.
//   5. The layout is chosen at the quote and fixed once it's accepted.
//
// USAGE
//   node scripts/test-windoors-lines.js
//   npm run test:windoors-lines

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

const W = require('../public/windoors');
const L = require('../lib/windoors');

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
const near = (name, got, want) => check(name, Math.abs(got - want) < 0.011, { got, want });
const { build } = require('./fixtures/windoors-job');
const { interimInvoiceLineItems, planInterimInvoice } = require('../lib/invoices');

(async () => {
  const fx = build();
  // The fixture house, with walls on the front, a roofline, gutters and
  // making good -- and a site variation on the wall.
  fx.data.openings.push(
    { id: 'wf', side: 'front', floor: 0, level: 'standard', kind: 'wall', position: 1, type: 'smooth', run_length: 9, run_extra: 6.5, prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' },
    { id: 'rf', side: 'front', floor: 0, level: 'standard', kind: 'run', position: 1, type: 'fascia_soffit', run_length: 9, prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' },
    { id: 'xg', side: 'back', floor: 0, level: 'standard', kind: 'extra', position: 1, type: 'gutters', run_length: 10, prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' });
  fx.data.property.making_good = 60;
  fx.data.marks.push({ id: 'wv', opening_id: 'wf', element_id: 'left', action_key: 'filler', stage: 'variation', variation_id: 'var-approved', created_at: '2026-09-10T09:00:00Z', done_at: '2026-09-10T09:00:00Z' });

  // ── 1. The split is exact ──────────────────────────────────────────────
  const R = W.mergeRates({});
  const tot = W.priceJob(fx.data, R).quote;
  ['single', 'split', 'breakdown'].forEach(l => {
    const gs = W.quoteGroups(fx.data, R, l);
    const sum = k => gs.reduce((t, g) => t + g[k], 0);
    check('1. ' + l + ': the lines add up to the quote, to the minute and penny',
      Math.abs(sum('mins') - tot.mins) < 1e-6 && Math.abs(sum('materials') - tot.materials) < 1e-6 && Math.abs(sum('fixed') - tot.fixed) < 1e-6);
    eq('1. ' + l + ': the first line keeps the old key', gs[0].key, 'windoors:windoors');
  });
  eq('1. split: woodwork, then walls', W.quoteGroups(fx.data, R, 'split').map(g => g.key), ['windoors:windoors', 'windoors:walls']);
  eq('1. breakdown: an element each, in a fixed order, making good its own', W.quoteGroups(fx.data, R, 'breakdown').map(g => g.key),
    ['windoors:windoors', 'windoors:doors', 'windoors:run:fascia_soffit', 'windoors:extra:gutters', 'windoors:walls', 'windoors:making_good']);
  eq('1. the default is split', W.lineLayout(undefined), 'split');

  // ── 2-5. In the app ────────────────────────────────────────────────────
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const app = await page.evaluate(async (fx) => {
    jobs = [{ id: 'j1', name: 'T', status: 'quoted', windoorsVariations: fx.variations.map(v => ({ id: v.id, sentAt: '2026-09-11T10:00:00Z', variationStatus: v.status, variationApprovedAt: v.approvedAt })) }];
    activeJobId = 'j1'; rooms = []; extItems = [];
    colours = [{ number: 1, label: 'White', brand: '', code: '' }];
    windoors = { jobId: 'j1', property: Object.assign({ job_id: 'j1' }, fx.data.property), openings: fx.data.openings, marks: fx.data.marks };
    const out = {};
    const total = calcWindoors().total;
    const lines = wdQuoteLines();
    out.split = lines.map(l => l.key);
    out.splitSum = Math.round((lines.reduce((t, l) => t + l.total, 0) - total) * 100) / 100;
    const snap = buildAcceptedQuoteSnapshot(activeJob());
    out.snapRows = snap.lines.work.filter(r => /^windoors:/.test(r.sourceKey)).map(r => [r.sourceKey, /^Exterior (woodwork|walls)/.test(r.description)]);
    // Breakdown, then back.
    setWdLineLayout('breakdown');
    out.breakdown = wdQuoteLines().map(l => l.key);
    setWdLineLayout('split');
    // Accepted: the layout is fixed.
    activeJob().status = 'accepted';
    setWdLineLayout('single');
    out.locked = wdLineLayout();
    // The final invoice, live figures.
    activeJob().status = 'completed';
    let m = buildFinalInvoiceModel();
    const wd = m.labour.filter(l => l.wd);
    out.inv = wd.map(l => ({ key: l.wdKey, quoted: Math.round(l.quoted * 100) / 100, site: Math.round(l.site.amount * 100) / 100, amount: l.amount }));
    out.invText = wd.map(l => wdLineInvoiceText(l.wdKey, { report: wdFirstLine(m) === l ? 'attached' : false }));
    // What the variation adds, all told, and the wall's share of it.
    const vars = windoorsVariationLines(activeJob());
    const sPct = (settings.sundriesPct || 0) / 100;
    const varMk = (1 + commercialRatio()) * (effectiveMarkupType() === 'fixed' ? 1 : 1 + effectiveMarkup() / 100);
    out.siteAll = Math.round(vars.filter(v => v.status !== 'declined').reduce((t, v) => t + v.raw, 0) * (1 + sPct) * varMk * 100) / 100
      + Math.round(wdAdjustments().raw * (1 + sPct) * varMk * 100) / 100;
    const by = Windoors.priceJob(windoors, wdRates()).variations['var-approved'].byOpening.wf;
    out.wallSite = Math.round((by.mins * rpm() + by.materials) * (1 + sPct) * varMk * 100) / 100;
    // ...and from the frozen snapshot.
    quoteSnapshotsJobId = 'j1'; quoteSnapshots = [{ version: 1, data: snap }];
    m = buildFinalInvoiceModel();
    out.frozen = m.labour.filter(l => l.wd).map(l => ({ key: l.wdKey, quoted: Math.round(l.quoted * 100) / 100, site: Math.round(l.site.amount * 100) / 100 }));
    out.frozenSnap = snap.lines.work.filter(r => /^windoors:/.test(r.sourceKey)).map(r => r.lineTotal);
    return out;
  }, fx);
  eq('2. by default the quote has the woodwork and the walls apart', app.split, ['windoors:windoors', 'windoors:walls']);
  eq('2. ...adding up to the whole exterior', app.splitSum, 0);
  eq('2. the accepted snapshot keeps a row each, worded for the client', app.snapRows, [['windoors:windoors', true], ['windoors:walls', true]]);
  check('2. a full breakdown gives a line per element', app.breakdown.length >= 5 && app.breakdown[0] === 'windoors:windoors' && app.breakdown.indexOf('windoors:walls') > 0, app.breakdown);
  eq('5. once accepted, the layout can\'t change', app.locked, 'split');
  eq('3. the final invoice bills the two lines', app.inv.map(l => l.key), ['windoors:windoors', 'windoors:walls']);
  check('3. the wall has site work to place', app.wallSite > 1, app.wallSite);
  near('3. the filler found on the wall goes on the walls line', app.inv[1].site, app.wallSite);
  near('3. ...the rest of the site work on the woodwork', app.inv[0].site + app.inv[1].site, app.siteAll);
  check('3. each line worded for itself; the report sentence on the first only',
    /^Exterior woodwork: /.test(app.invText[0]) && /attached report/.test(app.invText[0]) && /^Exterior walls: /.test(app.invText[1]) && !/report/.test(app.invText[1]), app.invText);
  eq('3. from the frozen quote: the same two lines', app.frozen.map(l => l.key), ['windoors:windoors', 'windoors:walls']);
  near('3. ...at the frozen figures', app.frozen[0].quoted + app.frozen[1].quoted, app.frozenSnap[0] + app.frozenSnap[1]);
  near('3. ...with the site work placed the same way', app.frozen[1].site, app.wallSite);

  // ── 4. Interims ────────────────────────────────────────────────────────
  const lab = [
    { key: 'windoors:windoors', description: 'Exterior woodwork', lineTotal: 2000, pct: 40, prevPct: 0, amount: 800 },
    { key: 'windoors:walls', description: 'Exterior walls', lineTotal: 1000, pct: 40, prevPct: 0, amount: 400 },
    { key: 'room:r1', description: 'Lounge', lineTotal: 500, pct: 40, prevPct: 0, amount: 200 }];
  const vr = [{ key: 'windoors:var-approved', description: 'Variation', lineTotal: 90, pct: 100, prevPct: 0, amount: 90 }];
  const li = interimInvoiceLineItems({ labour: lab, variations: vr, materials: [], windoors: { lines: { 'windoors:windoors': 'Exterior woodwork: … (stage 2 of 3)', 'windoors:walls': 'Exterior walls: … (stage 2 of 3)' } } });
  eq('4. an interim has a line per exterior line, site additions on the first',
    li.filter(l => /^Exterior/.test(l.description)).map(l => [l.description, l.unitAmount]),
    [['Exterior woodwork: … (stage 2 of 3)', 890], ['Exterior walls: … (stage 2 of 3)', 400]]);
  const plan = planInterimInvoice({ existing: [], depositTotal: 0, body: { idempotencyKey: 'lines-test-1',
    windoorsText: { 'windoors:windoors': 'Exterior woodwork: x', 'windoors:walls': 'Exterior walls: y', 'room:r1': 'nope' },
    labour: lab.slice(0, 2).map(l => Object.assign({ billedBefore: 0 }, l)) } });
  check('4. the server plans it', !plan.error, plan.error);
  if (!plan.error) eq('4. ...as two Xero lines, keeping only exterior keys', plan.row.lineItems.map(l => l.description), ['Exterior woodwork: x', 'Exterior walls: y']);
  const one = interimInvoiceLineItems({ labour: lab, variations: vr, materials: [], windoors: { description: 'All of it' } });
  eq('4. one description still makes one line, as before', one.filter(l => l.description === 'All of it').map(l => l.unitAmount), [1290]);

  // ── 6. A line that left the quote, carried to the one that replaced it ──
  const carry = await page.evaluate(() => {
    const job = activeJob(); job.status = 'accepted';
    const snapWd = latestQuoteSnapshot(job).data.lines.work.find(r => r.sourceKey === 'windoors:windoors');
    jobInvoicesJobId = job.id;
    jobInvoices = [{ id: 'i1', type: 'interim', sequence: 1, xeroInvoiceNumber: 'INV-0548', subtotal: 3270, labourAmount: 812.48, depositApplied: 0,
      labourLines: [{ key: 'exterior:old', description: 'Prepping and painting of windows', pct: 25, amount: 812.48 }], variationLines: [], materialLines: [] }];
    job.interimCarry = null; job.interimDraft = null;
    const out = {};
    let m = interimPreviewModel(job);
    out.orphans = m.orphans.map(o => [o.description, o.billed, o.invoices.join()]);
    out.before = m.labour.find(l => l.key === 'windoors:windoors').billedBefore;
    let el = document.getElementById('interiminvoice-body');
    if (!el) { el = document.createElement('div'); el.id = 'interiminvoice-body'; document.body.appendChild(el); }
    renderInterimInvoice();
    out.card = /Billed before, no longer on the quote/.test(el.textContent) && /Not taken off anything/.test(el.textContent);
    setInterimCarry('exterior:old', 'windoors:windoors');
    m = interimPreviewModel(job);
    const l = m.labour.find(x => x.key === 'windoors:windoors');
    out.after = [l.billedBefore, l.prevPct === Math.round(812.48 / snapWd.lineTotal * 10000) / 100];
    out.saved = job.interimCarry;
    out.cardAfter = !/Not taken off anything/.test(el.textContent) && el.querySelector('select[data-key="exterior:old"]').value;
    markInterimLineDone('labour', 'windoors:windoors');
    m = interimPreviewModel(job);
    out.bills = Math.round((m.math.labourLines[m.labour.indexOf(m.labour.find(x => x.key === 'windoors:windoors'))].amount) * 100) / 100;
    out.want = Math.round((snapWd.lineTotal - 812.48) * 100) / 100;
    setInterimCarry('exterior:old', '');
    out.cleared = [job.interimCarry, interimPreviewModel(job).labour.find(x => x.key === 'windoors:windoors').billedBefore];
    return out;
  });
  eq('6. a line billed before and since taken off the quote is found', carry.orphans, [['Prepping and painting of windows', 812.48, 'Interim 1 · INV-0548']]);
  eq('6. ...and until it\'s carried, nothing is taken off the new line', carry.before, 0);
  eq('6. the interim screen asks where it counts', carry.card, true);
  eq('6. carried to Windows & Doors: billed before, and that far through', carry.after, [812.48, true]);
  eq('6. the choice is kept on the job', carry.saved, { 'exterior:old': 'windoors:windoors' });
  eq('6. the card shows the choice', carry.cardAfter, 'windoors:windoors');
  eq('6. marked done, it bills its price less what the old line billed', carry.bills, carry.want);
  eq('6. un-carried, back as it was', carry.cleared, [null, 0]);

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
