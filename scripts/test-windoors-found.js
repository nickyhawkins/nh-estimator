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
//  10. Forecast (v3.6.0): the windows not opened up yet, from what was
//      found on the ones that have, as a range.
//  11. Where we are (v3.7.0): the page for the client, adding it all up.
//  12. Where the carpenter's days went (v3.7.1), and the days beyond the
//      accepted quote billed on the final invoice.
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
  // Used by its own sheet and the forecast (v3.6.0), nothing else: no quote,
  // invoice or client page.
  eq('8. it is nowhere a client sees', (fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').match(/wdPricePerWindow\(/g) || []).length, 3);

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

  // ── 10. Forecast (v3.6.0) ────────────────────────────────────────────────
  const fc = await page.evaluate(async () => {
    const job = activeJob();
    job.customItems = [{ id: 'cj', type: 'customLineItem', description: 'Joinery Work @ Day Rate', quantity: 6, unitPrice: 250, total: 1500, applyMarkup: false }];
    job.carpenterPlaced = {}; // section 9's Go ahead placed some; this is the rough forecast
    const base = windoors.openings[0];
    const add = (id, side, floor, pos) => windoors.openings.push(Object.assign({}, base, { id, side, floor, position: pos, prep_stage: 'quote', prep_level: null, quote_prep_level: null, prep_variation_id: null, prep_steps: [], painted_at: null }));
    add('u1', 'front', 0, 1); add('u2', 'front', 0, 2); add('u3', 'front', 1, 1);
    const f0 = wdForecastModel();
    // g1, f1, f2 have found work: opened. u1-u3 aren't.
    const opened = f0.opened.map(w => w.id), toOpen = f0.toOpen.map(w => w.id);
    // The ratios: found ÷ painting, per opened window.
    const ratios = f0.opened.map(w => w.found / w.paint).sort((a, b) => a - b);
    const mean = ratios.reduce((t, x) => t + x, 0) / ratios.length;
    const likelyWant = f0.toOpen.reduce((t, w) => t + w.paint * mean, 0);
    // Mark u1 opened by hand, with nothing found: a 0 in the sample.
    await openWindoors('site'); openWdDetail('u1');
    const sheet = document.getElementById('wd-sheet-body').textContent;
    setWdOpened('yes');
    const f1 = wdForecastModel();
    // An estimate on u2 takes it out of the forecast.
    setWdEstimating(true); openWdDetail('u2'); wdSel = { kind: 'part', ids: { cill: true } }; wdApplyAction('resin');
    const f2 = wdForecastModel();
    window.confirm = () => true; wdEstimateDrop(null); setWdEstimating(false);
    openWdDetail('u1'); setWdOpened('auto');
    const f3 = wdForecastModel();
    const card = document.getElementById('wd-body').textContent;
    openWdForecastSheet(); const fsheet = document.getElementById('schedule-sheet').textContent; closeScheduleSheet();
    closeWdDetail(); goBack();
    return { opened, toOpen, likely: f0.likely, likelyWant, low: f0.low, high: f0.high, ready: f0.ready,
             carp: f0.carpenter && [f0.carpenter.days, f0.carpenter.likely, f0.carpenter.low, f0.carpenter.high],
             sheet, f1: [f1.opened.length, f1.toOpen.length, f1.likely < f0.likely], f2: [f2.estimated, f2.toOpen.map(w => w.id)],
             back: [f3.opened.length, f3.toOpen.length], card, fsheet };
  });
  eq('10. windows with found work count as opened up', fc.opened, ['g1', 'f1', 'f2']);
  eq('10. ...the rest are still to open', fc.toOpen, ['u1', 'u2', 'u3']);
  check('10. likely = each one\'s painting × the average found-to-painting ratio', Math.abs(fc.likely - fc.likelyWant) < 0.02, [fc.likely, fc.likelyWant]);
  check('10. a range around it, low below and high above', fc.low <= fc.likely && fc.likely <= fc.high && fc.low < fc.high, [fc.low, fc.likely, fc.high]);
  check('10. three opened is enough to call it ready', fc.ready);
  eq('10. the carpenter, roughly: 6 days over 3 windows → 6 more likely for 3 (3 to 9)', fc.carp, [6, 6, 3, 9]);
  check('10. the window\'s sheet has the opened-up setting', /Opened up/.test(fc.sheet) && /Automatic/.test(fc.sheet));
  eq('10. opened by hand with nothing found: a sample, a 0, pulling the forecast down', fc.f1, [4, 2, true]);
  eq('10. a window in the estimate is neither', fc.f2, [1, ['u3']]);
  eq('10. back to automatic', fc.back, [3, 3]);
  check('10. the card shows it', /Forecast/.test(fc.card) && /3 of 6 windows and doors opened up/.test(fc.card) && /Likely still to come/.test(fc.card), fc.card.slice(fc.card.indexOf('Forecast'), fc.card.indexOf('Forecast') + 400));
  check('10. window by window', /Still to open/.test(fc.fsheet) && /Front, ground floor, W1/.test(fc.fsheet));

  // ── 11. Where we are (v3.7.0) ────────────────────────────────────────────
  const wh = await page.evaluate(async () => {
    const job = activeJob();
    job.customItems = [{ id: 'cj', type: 'customLineItem', description: 'Joinery Work @ Day Rate', quantity: 9, unitPrice: 250, total: 2250, applyMarkup: false }];
    quoteSnapshotsJobId = 'j1';
    quoteSnapshots = [{ version: 10, data: { totals: { incVat: 4500 }, lines: { work: [{ sourceKey: 'custom:cj', description: 'Joinery', lineTotal: 2000 }] } } }];
    await openWindoors('site');
    setWdEstimating(true); openWdDetail('u3'); wdSel = { kind: 'part', ids: { cill: true } }; wdApplyAction('splice'); wdSetCarpenterDays(1); setWdEstimating(false); closeWdDetail();
    window.prompt = () => '5,000'; setWdClientFigure();
    jobInvoicesJobId = 'j1';
    jobInvoices = [{ id: 'i1', type: 'interim', sequence: 1, subtotal: 2400, xeroTotal: 2400, xeroStatus: 'AUTHORISED', labourLines: [], variationLines: [], materialLines: [] },
                   { id: 'i2', type: 'interim', sequence: 2, subtotal: 999, xeroStatus: 'VOIDED', labourLines: [], variationLines: [], materialLines: [] }];
    renderWindoors();
    const m = wdWhereModel();
    const card = document.getElementById('wd-body').textContent;
    const pdf = new TextDecoder('latin1').decode(buildWdWherePdf());
    window.prompt = () => ''; setWdClientFigure();
    const cleared = activeJob().clientFigure;
    window.confirm = () => true; wdEstimateDrop(null);
    jobInvoices = [];
    goBack();
    const foundSum = windoorsFoundLines().reduce((t, l) => t + variationDeltaAmount({ raw: l.raw, spray: 0 }), 0);
    return { planned: m.planned, plannedWork: m.plannedWork, invoiced: m.invoiced, carp: m.carpenter, foundTotal: m.foundTotal, foundSum, adj: m.adjustments, soFar: m.soFar, est: m.estimate.total,
             likely: m.likely, low: m.low, high: m.high, fLikely: m.fLikely, client: m.clientFigure, cleared, card, pdf };
  });
  eq('11. starts from the accepted quote', wh.planned, 4500);
  eq('11. the carpenter as one line: 9 days, 8 planned and 1 more', [wh.carp.days, wh.carp.plannedDays, wh.carp.extraDays, wh.carp.amount, wh.carp.extraAmount], [9, 8, 1, 2250, 250]);
  eq('11. ...taken out of the planned figure', wh.plannedWork, 2500);
  eq('11. already invoiced: the live invoices, not a voided one', wh.invoiced, 2400);
  check('11. found so far is the found lines as billed', Math.abs(wh.foundTotal - wh.foundSum - wh.adj) < 0.01, [wh.foundTotal, wh.foundSum]);
  check('11. so far = planned + found + carpenter', Math.abs(wh.soFar - (4500 + wh.foundTotal + 250)) < 0.01);
  check('11. heading = so far + the estimate + the likely allowance', Math.abs(wh.likely - (wh.soFar + wh.est + wh.fLikely)) < 0.01, wh);
  check('11. with a range either side', wh.low <= wh.likely && wh.likely <= wh.high);
  eq('11. the figure given before starting is kept, and can be cleared', [wh.client, wh.cleared], [5000, null]);
  check('11. the card shows it', /Where we are/.test(wh.card) && /Where it's heading/.test(wh.card) && /Figure given before starting: £5,000.00/.test(wh.card)
    && /Carpenter so far/.test(wh.card) && /9 days \(8 planned, 1 more\)/.test(wh.card) && /Already invoiced/.test(wh.card), wh.card.slice(wh.card.indexOf('Where we are'), wh.card.indexOf('Where we are') + 600));
  check('11. the PDF has the sections, and the figure only for comparison', /Where we are: windows and doors/.test(wh.pdf) && /SO FAR/.test(wh.pdf) && /NEEDED NOW/.test(wh.pdf)
    && /Likely total/.test(wh.pdf) && /figure given before the work started was/.test(wh.pdf)
    && /Painting and repairs, as planned/.test(wh.pdf) && /Already invoiced/.test(wh.pdf) && /Likely still to come/.test(wh.pdf));

  // ── 12. Where the carpenter's days went, and billing the days beyond the
  //        accepted quote (v3.7.1) ──────────────────────────────────────────
  const cp = await page.evaluate(async () => {
    const job = activeJob();
    job.status = 'accepted';
    job.customItems = [{ id: 'cj', type: 'customLineItem', description: 'Joinery Work @ Day Rate', quantity: 9, unitPrice: 250, total: 2250, applyMarkup: false }];
    quoteSnapshotsJobId = 'j1';
    quoteSnapshots = [{ version: 10, data: { totals: { incVat: 4500 }, lines: { work: [
      { sourceKey: 'windoors:windoors', description: 'Exterior windows and doors', lineTotal: 2430 },
      { sourceKey: 'custom:cj', description: 'Joinery Work @ Day Rate', lineTotal: 2000 }] } } }];
    jobInvoicesJobId = 'j1'; jobInvoices = [];
    job.carpenterPlaced = {};
    const inv0 = buildFinalInvoiceModel().labour.filter(l => /Joinery/.test(l.desc)).map(l => [l.desc, l.amount]);
    await openWindoors('site');
    openWdDetail('f1');
    const sheet = document.getElementById('wd-sheet-body').textContent;
    wdSetCarpenterPlaced(1); wdSetCarpenterPlaced(1); wdSetCarpenterPlaced(1);
    openWdDetail('g1'); wdSetCarpenterPlaced(1); wdSetCarpenterPlaced(1);
    // Can't place more than the line has.
    openWdDetail('f2'); for (let i = 0; i < 12; i++) wdSetCarpenterPlaced(0.5);
    const placed = Object.keys(job.carpenterPlaced).sort().map(k => [k, job.carpenterPlaced[k]]);
    const placedText = wdCarpenterPlacedText();
    const inv1 = buildFinalInvoiceModel().labour.filter(l => /Joinery/.test(l.desc)).map(l => [l.desc, l.amount, l.scope || '']);
    // Forecast from where the days went.
    const base = windoors.openings[0];
    windoors.openings.push(Object.assign({}, base, { id: 'q1', side: 'back', floor: 0, position: 3, prep_stage: 'quote', prep_level: null, quote_prep_level: null, prep_variation_id: null, prep_steps: [] }));
    const fcst = wdForecastModel();
    // Go ahead on an estimate with carpenter days places them.
    setWdEstimating(true); openWdDetail('q1'); wdSel = { kind: 'part', ids: { cill: true } }; wdApplyAction('splice'); wdSetCarpenterDays(1);
    window.confirm = () => true; wdEstimateGoAhead('q1');
    const afterGo = { qty: job.customItems[0].quantity, q1: job.carpenterPlaced.q1 };
    const pdf = new TextDecoder('latin1').decode(buildWdWherePdf());
    windoors.openings = windoors.openings.filter(o => o.id !== 'q1');
    closeWdDetail(); goBack();
    return { inv0, inv1, sheet, placed, placedText, carp: fcst.carpenter, toOpen: fcst.toOpen.length, mean: fcst.opened.reduce((t, w) => t + (job.carpenterPlaced[w.id] || 0), 0) / fcst.opened.length, opened: fcst.opened.map(w => w.id), afterGo, pdf };
  });
  eq('12. the accepted 8 days and the 9th billed as its own line, at the flat rate', cp.inv0,
    [['Joinery Work @ Day Rate', 2000], ['Joinery Work @ Day Rate: additional days, 1 × £250.00', 250]]);
  check('12. the window sheet asks for carpenter days here, recorded not charged', /Carpenter days here/.test(cp.sheet) && /not charged again/.test(cp.sheet) && /9 days on the line not placed yet/.test(cp.sheet), cp.sheet.slice(cp.sheet.indexOf('Carpenter days'), cp.sheet.indexOf('Carpenter days') + 200));
  eq('12. placed, and never more than the line has', cp.placed, [['f1', 3], ['f2', 4], ['g1', 2]]);
  eq('12. worded in house order, with what\'s left', cp.placedText, 'Where the days went: Back, ground floor, W1 2 days; Back, first floor, W1 3 days; Back, first floor, W2 4 days.');
  check('12. ...under the joinery line on the final invoice, the money unchanged', cp.inv1[0][1] === 2000 && cp.inv1[0][2] === cp.placedText && cp.inv1[1][1] === 250, cp.inv1);
  check('12. the forecast\'s carpenter comes from where the days went', cp.carp && cp.carp.placed && cp.carp.likely === Math.round(cp.mean * cp.toOpen * 2) / 2, [cp.carp, cp.mean, cp.toOpen]);
  eq('12. go ahead adds the days to the line and places them on the window', cp.afterGo, { qty: 10, q1: 1 });
  check('12. Where we are lists where the days went', /Where the days went/.test(cp.pdf) && /in the carpenter line above/.test(cp.pdf));

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
