#!/usr/bin/env node
'use strict';

// ── Tudor framing (v3.2.0) ────────────────────────────────────────────────
//
//   1. An extra at a set price for the side: £, no minutes, no paint; coats
//      and prep leave it alone; brought in on site, its price is the
//      variation's. Work marked on it is priced on top.
//   2. Its words: the quote and invoice lines, the work report (stained).
//   3. The server keeps its price and where it is.
//   4. Drawn on the house -- upper floor, whole side or gable -- under the
//      windows, tappable, coloured where work is marked.
//   5. In the app: added from + Add an extra, its price and place on the
//      sheet, on the Extras card, priced, on the invoice line.
//
// USAGE
//   node scripts/test-windoors-tudor.js
//   npm run test:windoors-tudor

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
const near = (name, got, want) => check(name, Math.abs(got - want) < 0.005, { got, want });

(async () => {
  const R = W.mergeRates({});
  const prop = { style: 'modern', appearance: Object.assign(W.periodDefaults('modern'), { form: 'detached', roof: 'front_gable' }), default_prep: 'light', coats: 2,
                 layout: { front: { floors: [{ windows: 2, doors: 1 }, { windows: 3, doors: 0 }], confirmed: true } } };
  const tudor = (extra) => Object.assign({ id: 't1', side: 'front', floor: 0, level: 'standard', kind: 'extra', position: W.extraType({ type: 'tudor' }).position, type: 'tudor',
    run_length: 1, other_pricing: 'price', other_price: 450, other_draw: 'upper', prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' }, extra || {});
  const win = { id: 'w1', side: 'front', floor: 1, level: 'standard', kind: 'window', position: 1, type: 'casement', size_tier: 'medium', rows: 1, cols: 2, prep_stage: 'quote' };
  const price = (openings, marks) => W.priceJob({ property: prop, openings, marks: marks || [] }, R);

  // ── 1. Pricing ─────────────────────────────────────────────────────────
  const p1 = price([tudor()]);
  eq('1. a set price, in £: no minutes, no materials', [p1.quote.fixed, p1.quote.mins, p1.quote.materials], [450, 0, 0]);
  eq('1. coats and prep don\'t touch it', price([tudor({ prep_level: 'heavy', quote_prep_level: 'heavy' })]).quote.fixed, 450);
  eq('1. not counted as an opening', p1.quote.count, 0);
  eq('1. not in this job: nothing', price([tudor({ excluded: true })]).quote.fixed, 0);
  const pv = price([tudor({ include_variation_id: 'v1' })]);
  eq('1. brought in on site: its price goes on that variation', [pv.quote.fixed, pv.variations.v1 && pv.variations.v1.materials], [0, 450]);
  const filler = { id: 'm1', opening_id: 't1', element_id: 'left', action_key: 'filler', stage: 'quote', created_at: 'a' };
  check('1. work marked on it is priced on top', price([tudor()], [filler]).quote.mins > 0);
  eq('1. no paint is worked out for it', W.openingPaintM2(tudor(), R), 0);
  check('1. Rates have nothing to set for it', R.extra.tudor.mins === 0 && R.extra.tudor.m2 === 0);
  eq('1. it goes last in the extras (rows already saved keep their places)', W.EXTRA_TYPES[W.EXTRA_TYPES.length - 1].key, 'tudor');

  // ── 2. Words ───────────────────────────────────────────────────────────
  eq('2. the label', W.openingLabel(tudor()), 'Front, Tudor framing');
  eq('2. what it is, with where', W.kindNoun(tudor({ other_draw: 'gable' })), 'Tudor framing, gable only');
  const data = { property: prop, openings: [win, tudor()], marks: [] };
  eq('2. the quote line', W.itemLineText(data), 'Exterior woodwork (outside faces): 1 casement window, Tudor framing.');
  const c = W.invoiceCounts(data);
  eq('2. the invoice line', W.invoiceLineText(Object.assign({ report: 'attached' }, c)),
    'Exterior woodwork: preparation and painting of outside faces, 1 window and Tudor framing. Full breakdown of work per opening in attached report.');
  const two = W.invoiceCounts({ property: prop, openings: [win, tudor(), tudor({ id: 't2', side: 'back' })], marks: [] });
  check('2. on two sides, said once', /Tudor framing \(2 sides\)/.test(W.invoiceLineText(two)), W.invoiceLineText(two));
  const rep = W.workReportModel({ property: prop, openings: data.openings, marks: [Object.assign({ done_at: 'x' }, filler)] }, [], { colours: { frames: 'White' } });
  const sec = rep.sections.find(x => x.opening.id === 't1');
  eq('2. in the work report: stained, where, and its work', [sec.paint, sec.items.map(i => i.text)], ['Prepared and stained, upper floor', ['Filler (left section)']]);
  const g = W.quoteGroups(data, W.priceJob(data, R), 'breakdown');
  check('2. on a full breakdown, a line of its own', g.some(x => x.key === 'windoors:extra:tudor' && Math.abs(x.fixed - 450) < 0.005), g.map(x => x.key + ':' + x.fixed));

  // ── 3. The server ──────────────────────────────────────────────────────
  const n = L.normaliseOpening({ side: 'front', kind: 'extra', type: 'tudor', otherPrice: 525.5, otherDraw: 'whole', runLength: 7 });
  eq('3. saved as one lot, at its price, where it is', [n.run_length, n.other_pricing, n.other_price, n.other_draw, n.position], [1, 'price', 525.5, 'whole', W.extraType({ type: 'tudor' }).position]);
  eq('3. an unknown place is the upper floor', L.normaliseOpening({ side: 'front', kind: 'extra', type: 'tudor', otherPrice: 100, otherDraw: 'roof' }).other_draw, 'upper');
  eq('3. another extra keeps no price', L.normaliseOpening({ side: 'front', kind: 'extra', type: 'gates', runLength: 2, otherPrice: 100 }).other_price, null);

  // ── 4. Drawn ───────────────────────────────────────────────────────────
  const svg = (o, marks) => W.elevationSvg({ property: prop, openings: [win, o], marks: marks || [] }, 'front', { interactive: true });
  const up = svg(tudor());
  check('4. drawn on the house, tappable', /class="wd-open wd-tudor" data-open-id="t1"/.test(up));
  check('4. black timbers', up.indexOf('#2b2522') >= 0);
  check('4. under the windows, so they sit in it', up.indexOf('wd-tudor') < up.indexOf('data-open-id="w1"'));
  check('4. a marked section is coloured as work', svg(tudor(), [filler]).indexOf('#f0a020') >= 0);
  check('4. not in this job: not drawn', svg(tudor({ excluded: true })).indexOf('wd-tudor') < 0);
  const count = (s) => (s.match(/wd-tudor/g) || []).length;
  eq('4. upper floor: the floor and the gable over it', count(up), 2);
  eq('4. gable only: just the gable', count(svg(tudor({ other_draw: 'gable' }))), 1);
  const noGable = W.elevationSvg({ property: Object.assign({}, prop, { appearance: Object.assign({}, prop.appearance, { roof: 'hipped' }) }), openings: [win, tudor({ other_draw: 'gable' })], marks: [] }, 'front', { interactive: true });
  eq('4. gable only on a side with no gable: drawn on the upper floor', count(noGable), 1);
  check('4. its sheet has three sections', ['left', 'middle', 'right'].every(id => W.detailSvg(tudor(), [], { interactive: true }).indexOf('data-el="' + id + '"') >= 0));

  // ── 5. In the app ──────────────────────────────────────────────────────
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const app = await page.evaluate(async (args) => {
    const [prop, win] = args;
    jobs = [{ id: 'j1', name: 'T', status: 'quoted', windoorsVariations: [] }]; activeJobId = 'j1';
    windoors = { jobId: 'j1', property: Object.assign({ job_id: 'j1' }, prop), openings: [win], marks: [] };
    await openWindoors('quote');
    wdSide = 'front'; renderWindoors();
    const out = {};
    out.offered = /Tudor framing \(set price\)/.test(document.getElementById('wd-body').innerHTML);
    window.prompt = () => '£480';
    addWdExtra('tudor');
    const t = windoors.openings.find(o => o.type === 'tudor');
    out.added = t ? [t.kind, t.run_length, t.other_price, t.other_draw, wdOpenId === t.id] : null;
    const sheet = () => document.getElementById('wd-sheet-body').textContent;
    out.sheet = /Set price, £/.test(sheet()) && /Where it is/.test(sheet()) && /Upper floor/.test(sheet()) && /Gable only/.test(sheet());
    out.noPrepAccess = !/\bPREP\b|Prep/.test(Array.from(document.querySelectorAll('#wd-sheet-body .subsection-label')).map(x => x.textContent).join('|')) && !/Ladder\/tower/.test(sheet());
    out.workLine = /Stain · £480(\.00)? set price · upper floor/.test(sheet());
    setWdTudorCover('whole');
    setWdTudorPrice('520');
    out.after = [t.other_draw, t.other_price];
    const before = calcWindoors().total;
    out.total = Math.round(before * 100) / 100;
    closeWdDetail();
    out.row = /£520(\.00)? set price · whole side/.test(document.getElementById('wd-body').textContent);
    out.drawn = !!document.querySelector('#wd-elev .wd-tudor, .wd-tudor');
    out.text = wdInvoiceText({ report: 'attached' });
    out.notTwice = !/Tudor framing \(set price\)/.test(document.getElementById('wd-body').innerHTML);
    return out;
  }, [prop, win]);
  eq('5. offered under + Add an extra, as a set price', app.offered, true);
  eq('5. added at the price typed (a £ sign is fine), on the upper floor, and opened', app.added, ['extra', 1, 480, 'upper', true]);
  eq('5. its sheet: set price and where it is', app.sheet, true);
  eq('5. no prep or access to pick: the price is the price', app.noPrepAccess, true);
  eq('5. its work line: stain, at its price', app.workLine, true);
  eq('5. both change from the sheet', app.after, ['whole', 520]);
  check('5. priced into the total', app.total >= 520, app.total);
  eq('5. the Extras card shows the price and where', app.row, true);
  eq('5. drawn on the house', app.drawn, true);
  check('5. the invoice line names it', /Tudor framing/.test(app.text), app.text);
  eq('5. one per side', app.notTwice, true);
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
