#!/usr/bin/env node
'use strict';

// ── Found on site: windows and doors work without approval (v3.3.0) ───────
//
// Per Nicky, 2026-10-01: work found on the windows once the job is under way
// was agreed at the outset to be done as needed -- a rotten stile can't be
// found and then left -- so it isn't a variation to send and approve. What is
// held here:
//
//   1. A mark made on site goes straight onto the job's site record,
//      approved, with nothing to send.
//   2. It's billed per WINDOW: one line per opening with site work, all of
//      that window's work in it, the prep as the net change from the quote.
//   3. A job from before (batches of variations, approved or not, a raise
//      then a lowering on the same window) folds in: every batch is found
//      work, and the window's raise and lowering net out.
//   4. A declined old batch stays out.
//   5. The Variations card shows one block, a row per window, and no
//      approve/decline; the minus on a credit doesn't wrap.
//   6. The client page gets a 'windoorsfound' line per window, approved.
//   7. An interim that billed an old batch carries that billing onto its
//      windows, so the next interim doesn't bill it twice.
//   8. Price per window (v3.4.0): painting, quoted repairs and found work
//      per opening, adding up to the quote.
//   9. Estimates (v3.5.0): work priced before it's agreed, with carpenter
//      days, billed nowhere until Go ahead.
//
// Driven in a real browser against the real public/index.html (served off
// disk, no server, no database -- writes 404 and queue, as offline on site).
//
// USAGE
//   node scripts/test-windoors-found.js
//   npm run test:windoors-found

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

// Like the job in Nicky's screenshot: four batches on the back, the first
// floor W1 in three of them -- reputty on one, prep raised to Heavy on
// another, lowered back to Standard (the quote) on a fourth.
const SEED = () => {
  const op = (id, side, floor, position, extra) => Object.assign({ id, side, level: 'standard', floor, position, kind: 'window', type: 'sash',
    size_tier: 'medium', rows: 2, cols: 3, nickname: null, prep_level: null, prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null,
    bay_shape: null, bay_storeys: null, parent_opening_id: null, panes_set: false }, extra || {});
  const mark = (id, opening_id, element_id, action_key, variation_id, at) => ({ id, opening_id, element_id, action_key, stage: 'variation', variation_id,
    created_at: at, size_tier: action_key === 'resin' ? 'medium' : undefined });
  jobs = [{ id: 'j1', name: 'Test Job', status: 'accepted', windoorsVariations: [
    { id: 'va', createdAt: '2026-09-28T09:00:00Z', sentAt: '2026-09-28T10:00:00Z', variationStatus: 'approved', variationApprovedAt: '2026-09-29T09:00:00Z' },
    { id: 'vb', createdAt: '2026-09-29T09:00:00Z', sentAt: '2026-09-29T10:00:00Z', variationStatus: 'approved', variationApprovedAt: '2026-09-29T11:00:00Z' },
    { id: 'vc', createdAt: '2026-09-29T12:00:00Z', sentAt: '2026-09-29T13:00:00Z', variationStatus: 'declined' },
    { id: 'vd', createdAt: '2026-09-30T09:00:00Z', sentAt: null, description: '' }] }];
  activeJobId = 'j1';
  rooms = []; extItems = [];
  windoors = {
    jobId: 'j1',
    property: { job_id: 'j1', style: 'georgian', detail_enabled: true, default_prep: 'light', layout: {}, coats: 2 },
    openings: [
      op('g1', 'back', 0, 1),
      op('f1', 'back', 1, 1, { prep_stage: 'variation', quote_prep_level: 'standard', prep_level: 'standard', prep_variation_id: 'vd',
                               prep_steps: [{ variation_id: 'vb', level: 'heavy' }] }),
      op('f2', 'back', 1, 2),
    ],
    marks: [
      mark('m1', 'g1', 'right_stile', 'resin', 'va', '2026-09-28T09:10:00Z'),
      mark('m2', 'f1', 'cill', 'resin', 'va', '2026-09-28T09:20:00Z'),
      mark('m3', 'f2', 'cill', 'resin', 'vb', '2026-09-29T09:10:00Z'),
      mark('m4', 'f2', 'left_stile', 'resin', 'vc', '2026-09-29T12:10:00Z'),
      mark('m5', 'f1', 'left_stile', 'filler', 'vd', '2026-09-30T09:10:00Z'),
    ],
  };
};

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(SEED);

  // ── 3/4. Folded in ───────────────────────────────────────────────────────
  const fold = await page.evaluate(() => {
    const n = wdFoldInVariations();
    return { n, again: wdFoldInVariations(), list: activeJob().windoorsVariations.map(v => [v.id, !!v.found, v.variationStatus || 'pending', !!v.sentAt]) };
  });
  eq('3. every batch not declined is folded in, once', [fold.n, fold.again], [3, 0]);
  eq('3. ...as found work, approved; the declined one left as it was', fold.list,
    [['va', true, 'approved', true], ['vb', true, 'approved', true], ['vc', false, 'declined', true], ['vd', true, 'approved', true]]);

  // ── 2. A line per window ─────────────────────────────────────────────────
  const lines = await page.evaluate(() => {
    const R = wdRates(), r = rpm();
    const res = (t) => { const a = Windoors.actionPrice(R, 'resin', t); return a.mins * r + a.cost; };
    const fil = Windoors.actionPrice(R, 'filler'); 
    return { lines: windoorsFoundLines().map(l => ({ id: l.id, kind: l.kind, status: l.status, name: l.name, raw: Math.round(l.raw * 100) / 100 })),
             resin: Math.round(res('medium') * 100) / 100, filler: fil ? Math.round((fil.mins * r + fil.cost) * 100) / 100 : null };
  });
  eq('2. one line per window with site work, in house order', lines.lines.map(l => l.id), ['g1', 'f1', 'f2']);
  check('2. each found on site and approved', lines.lines.every(l => l.kind === 'windoorsfound' && l.status === 'approved'));
  eq('2. named by the window, with all of its work',
    lines.lines.map(l => l.name),
    ['Windows and doors — Back, ground floor, W1: resin repair (right stile)',
     'Windows and doors — Back, first floor, W1: filler (left stile), resin repair (cill)',
     'Windows and doors — Back, first floor, W2: resin repair (cill)']);
  // 3. The raise and the lowering on first floor W1 net out: its figure is
  // the repair and the filler, nothing for prep.
  check('3. a window raised and lowered back costs only its other work', Math.abs(lines.lines[1].raw - (lines.resin + lines.filler)) < 0.02, [lines.lines[1].raw, lines.resin, lines.filler]);
  // 4. The declined batch's repair on W2 isn't there.
  check('4. a declined old batch is left out', Math.abs(lines.lines[2].raw - lines.resin) < 0.02, [lines.lines[2].raw, lines.resin]);

  // ── 1. A new mark: straight on, nothing to send ──────────────────────────
  const fresh = await page.evaluate(async () => {
    await openWindoors('site'); openWdDetail('g1');
    wdSel = { kind: 'part', ids: { cill: true } }; wdApplyAction('resin');
    const m = windoors.marks.find(x => x.opening_id === 'g1' && x.element_id === 'cill');
    const v = activeJob().windoorsVariations.find(x => x.id === m.variation_id);
    const sheet = document.getElementById('wd-sheet-body').textContent;
    closeWdDetail();
    return { onFound: !!(v && v.found && v.variationStatus === 'approved'), count: activeJob().windoorsVariations.length,
             line: windoorsFoundLines().find(l => l.id === 'g1').name,
             pending: computeVariationsView().pendingCount, sheet, banner: document.getElementById('wd-body').textContent };
  });
  check('1. a site mark goes on the found record, approved', fresh.onFound);
  eq('1. ...no new batch is started', fresh.count, 4);
  eq('1. ...and joins its window\'s line', fresh.line, 'Windows and doors — Back, ground floor, W1: resin repair (right stile, cill)');
  eq('1. nothing is pending', fresh.pending, 0);
  check('1. the sheet calls it found on site, not a variation', /found on site/.test(fresh.sheet) && !/variation ·|draft/.test(fresh.sheet), fresh.sheet.slice(0, 300));
  check('1. the banner says there is nothing to approve', /found on site/.test(fresh.banner) && /nothing to send for approval/.test(fresh.banner));

  // ── 5. The Variations card ───────────────────────────────────────────────
  const card = await page.evaluate(() => {
    const html = variationsCardHtml(computeVariationsView());
    const d = document.createElement('div'); d.innerHTML = html;
    return { text: d.textContent, signoff: /approveVariation\('windoorsfound'|declineVariation\('windoorsfound'/.test(html),
             rows: (html.match(/padding-left:28px/g) || []).length };
  });
  check('5. one block, headed found on site', /Windows and doors — found on site/.test(card.text) && /no approval/.test(card.text));
  eq('5. a row per window', card.rows, 3);
  check('5. no approve or decline on them', !card.signoff);
  check('5. no "reword" or "marked on site" batch lines', !/reword for the client|marked on site/.test(card.text));
  check('5. amounts never wrap', await page.evaluate(() => getComputedStyle(Object.assign(document.body.appendChild(document.createElement('span')), { className: 'breakdown-value' })).whiteSpace === 'nowrap'));

  // ── 6. The client page ───────────────────────────────────────────────────
  const cl = await page.evaluate(() => buildClientVariationLines().map(l => [l.kind, l.sourceId, l.status]));
  eq('6. the client page gets a line per window, approved', cl, [['windoorsfound', 'g1', 'approved'], ['windoorsfound', 'f1', 'approved'], ['windoorsfound', 'f2', 'approved']]);
  eq('6. ...and nothing for a variation quote', await page.evaluate(() => buildVariationQuoteLines().items.length), 0);

  // ── 7. An interim that billed an old batch ───────────────────────────────
  const carry = await page.evaluate(() => {
    const vb = Windoors.priceJob(windoors, wdRates()).variations.vb.byOpening;
    jobInvoicesJobId = 'j1';
    // Batch va billed in full (£ as it was then), vb at half.
    const cands0 = interimVariationCandidates(activeJob());
    const amt = {}; cands0.forEach(c => { amt[c.sourceId] = c.lineTotal; });
    jobInvoices = [{ id: 'i1', type: 'interim', sequence: 1, labourLines: [], materialLines: [],
      variationLines: [{ key: 'windoors:va', pct: 100, amount: 120, description: 'old' }, { key: 'windoors:vb', pct: 50, amount: 40, description: 'old' }] }];
    const so = interimBillingSoFar(activeJob());
    const cands = interimVariationCandidates(activeJob());
    const by = {}; cands.forEach(c => { by[c.sourceId] = { before: c.billedBefore, prev: c.prevPct, total: c.lineTotal }; });
    const vbShares = Object.keys(vb).filter(k => vb[k].mins * rpm() + vb[k].materials > 0);
    return { keys: cands.map(c => c.key), by, total: Object.keys(by).reduce((t, k) => t + by[k].before, 0), vbShares,
             desc: cands[0] && cands[0].description };
  });
  eq('7. the interim offers the windows, not the old batches', carry.keys, ['windoorsfound:g1', 'windoorsfound:f1', 'windoorsfound:f2']);
  check('7. found lines are described as found on site', /^Found on site: /.test(carry.desc), carry.desc);
  check('7. everything the old interim billed is carried, to the penny', Math.abs(carry.total - 160) < 0.02, carry);
  // va was g1 and f1's repairs; vb was f1's raise (now netted away -- its
  // positive share) and f2's cill. Nothing lands on a window the batch wasn't on.
  check('7. ...onto the windows the batches were for', carry.by.g1.before > 0 && carry.by.f1.before > 0 && carry.by.f2.before > 0, carry.by);
  check('7. ...with the % so far worked out from it', ['g1', 'f1', 'f2'].every(k => Math.abs(carry.by[k].prev - Math.min(100, Math.floor(carry.by[k].before / carry.by[k].total * 10000) / 100)) < 0.011), carry.by);

  // ── 8. Price per window (v3.4.0) ─────────────────────────────────────────
  const ppw = await page.evaluate(() => {
    jobInvoices = [];
    windoors.marks.push({ id: 'q1', opening_id: 'f2', element_id: 'bottom_rail', action_key: 'filler', stage: 'quote', variation_id: null, created_at: '2026-09-01T09:00:00Z' });
    windoors.property.making_good = 40;
    const m = wdPricePerWindow();
    const rows = [].concat.apply([], m.sides.map(sd => sd.rows));
    const want = applyMarkupAmount(calcWindoors().total);
    const fil = Windoors.actionPrice(wdRates(), 'filler');
    const mult = want / calcWindoors().total;
    openWdPriceSheet();
    const text = document.getElementById('schedule-sheet').textContent;
    closeScheduleSheet();
    windoors.marks = windoors.marks.filter(x => x.id !== 'q1'); windoors.property.making_good = 0;
    return { ids: rows.map(r => r.id), sum: m.quoted, want, f2rep: rows.find(r => r.id === 'f2').repairs, filler: (fil.mins * rpm() + fil.cost) * mult,
             paintAll: rows.every(r => r.paint > 0), found: m.found, foundLines: buildClientVariationLines().filter(l => l.kind === 'windoorsfound').reduce((t, l) => t + l.amount, 0),
             makingGood: m.makingGood, text };
  });
  eq('8. a row for every window in the job', ppw.ids, ['g1', 'f1', 'f2']);
  check('8. each has its painting', ppw.paintAll);
  check('8. the rows and making good add up to the exterior on the quote', Math.abs(ppw.sum - ppw.want) < 0.01, [ppw.sum, ppw.want]);
  check('8. a quoted repair is on its window, at the quote\'s markup', Math.abs(ppw.f2rep - ppw.filler) < 0.01, [ppw.f2rep, ppw.filler]);
  check('8. found work at the figure the client is shown', Math.abs(ppw.found - ppw.foundLines) < 0.02, [ppw.found, ppw.foundLines]);
  check('8. the sheet lists them, by side, with the totals', /Price per window/.test(ppw.text) && /Back/.test(ppw.text) && /First floor, W1/.test(ppw.text) && /As quoted/.test(ppw.text) && /Making good/.test(ppw.text) && /Now/.test(ppw.text));
  // Used by its own sheet and nothing else: no quote, invoice or client page.
  eq('8. it is nowhere a client sees', (fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').match(/wdPricePerWindow\(/g) || []).length, 2);

  // ── 9. Estimates (v3.5.0) ────────────────────────────────────────────────
  const est = await page.evaluate(async () => {
    const job = activeJob();
    job.customItems = [{ id: 'cj', type: 'customLineItem', description: 'Joinery Work @ Day Rate', quantity: 9, unitPrice: 250, total: 2250, applyMarkup: false }];
    const before = { found: windoorsFoundLines().map(l => [l.id, Math.round(l.raw * 100) / 100]), client: JSON.stringify(buildClientVariationLines()) };
    await openWindoors('site');
    setWdEstimating(true);
    openWdDetail('f2');
    wdSel = { kind: 'part', ids: { right_stile: true, top_rail: true } }; wdApplyAction('splice');
    wdSetCarpenterDays(0.5); wdSetCarpenterDays(0.5); wdSetCarpenterDays(0.5);
    const sheet = document.getElementById('wd-sheet-body').textContent;
    openWdDetail('g1');
    wdSel = { kind: 'part', ids: { top_rail: true } }; wdApplyAction('resin');
    const m = wdEstimateModel();
    const sp = Windoors.actionPrice(wdRates(), 'splice');
    const after = { found: windoorsFoundLines().map(l => [l.id, Math.round(l.raw * 100) / 100]), client: JSON.stringify(buildClientVariationLines()) };
    const card = document.getElementById('wd-body').textContent;
    const ppw = wdPricePerWindow();
    const todo = Windoors.reportModel(windoors, wdReportVariations(), { todo: true }).sections.some(sec => sec.variations.some(v => /splice/i.test(v.text)));
    const tickable = wdTickable(windoors.openings.find(o => o.id === 'f2'), windoors.marks.filter(mk => mk.opening_id === 'f2')).some(mk => mk.action_key === 'splice');
    // Prep can't be changed while estimating.
    openWdDetail('f2');
    const prepBefore = windoors.openings.find(o => o.id === 'f2').prep_level;
    setWdPrep('restoration');
    const prepAfter = windoors.openings.find(o => o.id === 'f2').prep_level;
    // Go ahead with f2 only; drop g1.
    window.confirm = () => true;
    wdEstimateGoAhead('f2');
    const ga = { found: windoorsFoundLines().find(l => l.id === 'f2'), qty: job.customItems[0].quantity, total: job.customItems[0].total,
                 left: wdEstimateModel().lines.map(l => l.id) };
    wdEstimateDrop('g1');
    const dropped = { est: !!wdEstimate(false), resin: windoors.marks.some(mk => mk.opening_id === 'g1' && mk.element_id === 'top_rail') };
    closeWdDetail(); goBack();
    return { m: { lines: m.lines.map(l => [l.id, l.days, Math.round(l.carpenterAmount * 100) / 100]), total: m.total, work: m.workAmount, carp: m.carpenterAmount },
             spliceRaw: (sp.mins * rpm() + sp.cost) * 2, f2work: m.lines.find(l => l.id === 'f2').workRaw,
             same: before.found.join() === after.found.join() && before.client === after.client, sheet, card,
             ppwEst: Math.round(ppw.estimate * 100) / 100, todo, tickable, prep: [prepBefore, prepAfter], ga, dropped, estimating: wdEstimating,
             foundBefore: before.found };
  });
  eq('9. an estimate holds a line per window, with its carpenter days', est.m.lines, [['g1', 0, 0], ['f2', 1.5, 375]]);
  check('9. its work is priced like found work', Math.abs(est.f2work - est.spliceRaw) < 0.02, [est.f2work, est.spliceRaw]);
  check('9. the total is the work as billed plus the carpenter days', Math.abs(est.m.total - (est.m.work + 375)) < 0.01, est.m);
  check('9. nothing estimated is found work or on the client page', est.same);
  check('9. ...nor on the work-to-do list, nor to tick off', !est.todo && !est.tickable);
  check('9. the sheet says it is an estimate, with the carpenter stepper', /estimate — not agreed yet/.test(est.sheet) && /Carpenter/.test(est.sheet) && /1½ days/.test(est.sheet), est.sheet.slice(0, 400));
  check('9. the screen shows the estimate card', /Estimate total/.test(est.card) && /Go ahead with all/.test(est.card) && /Joinery Work @ Day Rate, £250.00 a day/.test(est.card), est.card.slice(0, 600));
  check('9. price per window carries it', Math.abs(est.ppwEst - est.m.total) < 0.02, [est.ppwEst, est.m.total]);
  eq('9. prep can\'t be changed while estimating', est.prep[0], est.prep[1]);
  check('9. go ahead: the window\'s work is found on site', est.ga.found && Math.abs(est.ga.found.raw - (est.foundBefore.find(f => f[0] === 'f2')[1] + est.spliceRaw)) < 0.05, est.ga.found);
  eq('9. ...and its days go onto the carpenter\'s line', [est.ga.qty, est.ga.total], [10.5, 2625]);
  eq('9. ...leaving the rest of the estimate', est.ga.left, ['g1']);
  eq('9. drop: its marks come off, and an empty estimate goes', est.dropped, { est: false, resin: false });
  eq('9. leaving the screen ends estimating', est.estimating, false);

  if (process.env.SHOT_DIR) {
    await page.evaluate(() => {
      jobInvoices = [];
      const d = document.createElement('div');
      d.className = 'card'; d.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:9999;background:var(--bg);margin:0;border-radius:0';
      d.innerHTML = variationsCardHtml(computeVariationsView());
      document.body.appendChild(d);
    });
    await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'found-on-site.png') }).catch(() => {});
  }

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
