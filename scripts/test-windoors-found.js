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
