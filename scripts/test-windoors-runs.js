#!/usr/bin/env node
'use strict';

// ── The roofline: fascia and soffit, bargeboards (EXTERIOR_HOUSE_SPEC.md
//    step 2) ──────────────────────────────────────────────────────────────
//
//   1. A run prices by the metre (length + the extra), at the Rates figure,
//      with prep and coats on top and no access uplift unless set by hand.
//   2. Marked left / middle / right, like a window's parts; resin with sizes.
//   3. Its words: "Front, fascia & soffit", "10.5m of fascia and soffit", the
//      line's head becomes "Exterior woodwork".
//   4. Paint with the windows' colour; not counted as a window.
//   5. The server's validation: one of each type per side, metres capped.
//   6. Drawn on the elevation, tappable; in the work report.
//   7. In the app: added from the side's Roofline card, measured, marked;
//      confirming a layout never deletes it; the invoice line names it.
//
// USAGE
//   node scripts/test-windoors-runs.js
//   npm run test:windoors-runs

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
  const prop = { style: 'georgian', appearance: Object.assign(W.periodDefaults('georgian'), { form: 'detached' }), default_prep: 'light', coats: 2,
                 layout: { front: { floors: [{ windows: 2, doors: 1 }, { windows: 3, doors: 0 }], confirmed: true } } };
  const run = (extra) => Object.assign({ id: 'r1', side: 'front', floor: 0, level: 'standard', kind: 'run', position: 1, type: 'fascia_soffit',
                                         run_length: 9, run_extra: null, prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' }, extra || {});
  const mins = (o, p, marks) => W.priceJob({ property: p || prop, openings: [o], marks: marks || [] }, R).quote.mins;

  // ── 1. Pricing ─────────────────────────────────────────────────────────
  eq('1. defaults: fascia and soffit 16 min a metre (the Exterior form\'s 8 a coat), 0.35 m²', [R.run.fascia_soffit.mins, R.run.fascia_soffit.m2], [16, 0.35]);
  near('1. by the metre, light prep on top', mins(run()), 9 * 16 * R.prep.light);
  near('1. the extra metres are priced too', mins(run({ run_extra: 1.5 })), 10.5 * 16 * R.prep.light);
  near('1. coats scale it', mins(run(), Object.assign({}, prop, { coats: 3 })), 9 * 16 * 1.5 * R.prep.light);
  near('1. no access uplift on Auto (the rate allows for ladders)', mins(run()), mins(run({ access: null })));
  near('1. a tower set by hand takes its uplift', mins(run({ access: 'ladderTower' })), 9 * 16 * R.prep.light * R.access.ladderTower);
  near('1. each type at its own rate', mins(run({ type: 'bargeboard', position: 4 })), 9 * R.run.bargeboard.mins * R.prep.light);
  eq('1. a saved rate is kept', W.mergeRates({ run: { fascia_soffit: { mins: 20 } } }).run.fascia_soffit.mins, 20);
  near('1. not painted: nothing', mins(run({ excluded: true })), 0);

  // ── 2. Marking ─────────────────────────────────────────────────────────
  eq('2. three sections', W.openingElements(run()).map(e => e.id + ':' + e.kind), ['left:part', 'middle:part', 'right:part']);
  eq('2. part actions only, no sash or door ones', W.actionsFor(run(), 'part').map(a => a.key), ['filler', 'resin', 'splice']);
  eq('2. no panes', W.paneCount(run()), 0);
  const resin = { id: 'm1', opening_id: 'r1', element_id: 'left', action_key: 'resin', stage: 'quote', size_tier: 'large', created_at: 'a' };
  near('2. a resin repair on a section prices like any', mins(run(), prop, [resin]) - mins(run()), R.actions.resin.baseMins + R.actions.resin.tiers.large.mins);
  eq('2. its clause names the section', W.marksClause(run(), [resin], { tiers: 'long' }), 'resin repair (left section, large)');

  // ── 3. Words ───────────────────────────────────────────────────────────
  eq('3. the label', W.openingLabel(run()), 'Front, fascia & soffit');
  eq('3. what it is', W.kindNoun(run({ run_extra: 1.5 })), 'Fascia & soffit, 10.5m');
  const data = { property: prop, openings: [run({ run_extra: 1.5 }), run({ id: 'r2', type: 'bargeboard', position: 4, run_length: 8 }),
    { id: 'w1', side: 'front', floor: 0, level: 'standard', kind: 'window', position: 1, type: 'sash', size_tier: 'medium', rows: 2, cols: 3, prep_stage: 'quote' }], marks: [] };
  eq('3. the quote line, in metres, as exterior woodwork', W.itemLineText(data), 'Exterior woodwork (outside faces): 1 sash window, 10.5m fascia and soffit, 8m bargeboards.');
  const c = W.invoiceCounts(data);
  eq('3. the invoice counts carry the metres', [c.windows, c.runs], [1, { fascia_soffit: 10.5, bargeboard: 8 }]);
  eq('3. the invoice line', W.invoiceLineText(Object.assign({ report: 'attached' }, c)),
    'Exterior woodwork: preparation and painting of outside faces, 1 window, 10.5m of fascia and soffit and 8m of bargeboards. Full breakdown of work per opening in attached report.');
  check('3. with no runs the line is as it was', /^Exterior windows and doors: /.test(W.invoiceLineText({ windows: 2, doors: 1 })));
  eq('3. a variation names it', W.describeVariation({ property: prop, openings: [run()], marks: [Object.assign({}, resin, { stage: 'variation', variation_id: 'v1' })] }, 'v1'),
    'Front, fascia & soffit: resin repair (left section).');

  // ── 4. Paint ───────────────────────────────────────────────────────────
  near('4. paint area by the metre', W.openingPaintM2(run({ run_extra: 1 }), R), 10 * 0.35);
  const pa = W.paintAreas(data, R);
  check('4. the roofline\'s own paint area, apart from the windows, and not counted as one', Math.abs(pa.fascia - (10.5 * 0.35 + 8 * R.run.bargeboard.m2)) < 1e-9 && Math.abs(pa.window - W.openingPaintM2(data.openings[2], R)) < 1e-9 && pa.windows === 1, pa);
  check('4. a roofline colour of its own is named on the line', /Black \(fascia and soffit\)/.test(W.invoiceLineText(Object.assign({}, c, { colours: { frames: 'White', fascia: 'Black' } }))), W.invoiceLineText(Object.assign({}, c, { colours: { frames: 'White', fascia: 'Black' } })));
  check('4. ...and not when it\'s the windows\' own', !/fascia and soffit\)/.test(W.invoiceLineText(Object.assign({}, c, { colours: { frames: 'White', fascia: 'White' } }))));

  // ── 5. The server ──────────────────────────────────────────────────────
  const n = L.normaliseOpening({ side: 'front', kind: 'run', type: 'bargeboard', runLength: 8.25, runExtra: 0, position: 9, floor: 2 });
  eq('5. a run\'s slot is its type\'s', [n.position, n.floor, n.level], [4, 0, 'standard']);
  eq('5. metres kept, a zero extra stored as NULL', [n.run_length, n.run_extra], [8.25, null]);
  eq('5. the roofline colour and the switch, and an older app\'s save leaves them alone', [L.normaliseProperty({ fasciaColour: 4, runsSplit: true }).fascia_colour, L.normaliseProperty({ runsSplit: true }).runs_split, L.normaliseProperty({}).fascia_colour, L.normaliseProperty({}).runs_split], [4, true, undefined, undefined]);
  eq('5. capped', L.normaliseOpening({ side: 'front', kind: 'run', type: 'fascia', runLength: 5000 }).run_length, W.RUN_MAX_M);
  check('5. an unknown type is refused', !!L.normaliseOpening({ side: 'front', kind: 'run', type: 'gutter' }).error);
  check('5. not on a level', !!L.normaliseOpening({ side: 'front', kind: 'run', type: 'fascia', level: 'roof' }).error);
  eq('5. read back', [L.mapOpening({ id: 'x', side: 'front', kind: 'run', run_length: '9', run_extra: '1.5' }).run_length, L.mapOpening({ id: 'x', side: 'front', kind: 'run', run_length: '9', run_extra: '1.5' }).run_extra], [9, 1.5]);

  // ── 6. Drawing and report ──────────────────────────────────────────────
  const elev = W.elevationSvg(Object.assign({}, data, { marks: [resin] }), 'front', { interactive: true });
  check('6. the runs are tappable on the elevation', elev.indexOf('data-open-id="r1"') >= 0 && elev.indexOf('data-open-id="r2"') >= 0);
  check('6. a marked section is coloured as work', elev.indexOf('#f0a020') >= 0);
  check('6. a run not painted isn\'t drawn', W.elevationSvg({ property: prop, openings: [run({ excluded: true })], marks: [] }, 'front', { interactive: true }).indexOf('data-open-id="r1"') < 0);
  const det = W.detailSvg(run(), [resin], { interactive: true });
  check('6. its sheet draws the three sections', ['left', 'middle', 'right'].every(id => det.indexOf('data-el="' + id + '"') >= 0));
  check('6. the bargeboards too', ['left', 'middle', 'right'].every(id => W.detailSvg(run({ type: 'bargeboard' }), [], { interactive: true }).indexOf('data-el="' + id + '"') >= 0));
  const rep = W.workReportModel({ property: prop, openings: data.openings, marks: [Object.assign({ done_at: 'x' }, resin)] }, [], {});
  const sec = rep.sections.find(x => x.opening.id === 'r1');
  eq('6. in the work report, with its metres and its work', [sec.label, sec.paint, sec.items.map(i => i.text)],
    ['Front, fascia & soffit', 'Prepared (light) and painted, 2 coats, 10.5m', ['Resin repair (left section, large)']]);

  // ── 7. In the app ──────────────────────────────────────────────────────
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Say yes to every confirm: a layout change that would delete the run has
  // to be stopped by the code, not by a dismissed dialog.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const app = await page.evaluate(async (prop) => {
    jobs = [{ id: 'j1', name: 'T', status: 'quoted', windoorsVariations: [] }]; activeJobId = 'j1';
    windoors = { jobId: 'j1', property: Object.assign({ job_id: 'j1' }, prop), openings: [
      { id: 'w1', side: 'front', floor: 0, level: 'standard', kind: 'window', position: 1, type: 'sash', size_tier: 'medium', rows: 2, cols: 3, prep_stage: 'quote' }], marks: [] };
    await openWindoors('quote');
    wdSide = 'front'; renderWindoors();
    const out = {};
    out.card = /Roofline/.test(document.getElementById('wd-body').textContent) && /\+ Fascia & soffit/.test(document.getElementById('wd-body').textContent);
    window.prompt = () => '9';
    addWdRun('fascia_soffit');
    const r = windoors.openings.find(o => o.kind === 'run');
    out.added = r ? [r.type, r.run_length, r.position, wdOpenId === r.id] : null;
    out.sheet = /Length, metres/.test(document.getElementById('wd-sheet-body').textContent) && /Auto \(in the rate\)/.test(document.getElementById('wd-sheet-body').textContent);
    setWdRunFigure('run_extra', '1.5');
    out.extra = r.run_extra;
    wdSel = { kind: 'part', ids: { middle: true } }; wdApplyAction('filler');
    out.marked = windoors.marks.filter(m => m.opening_id === r.id).map(m => m.element_id + ':' + m.action_key);
    out.price = Math.round(calcWindoors().mins * 100) / 100;
    closeWdDetail();
    out.noSeparate = !/\+ Fascia\b(?! &)|\+ Soffit/.test(document.getElementById('wd-body').textContent) && !!document.getElementById('wd-runs-split');
    // The roofline paints in the windows' colour until given its own.
    const paintNames = () => windoorsPaintItems().map(i => i.wdPaint + ':' + i.extWoodworkColourNumber).join(',');
    out.paintBefore = paintNames();
    setWdColour('fascia', 3);
    out.paintAfter = paintNames();
    out.colourArea = colourAreas().some(a => a.key === 'wdfascia' || a.area === 'wdfascia' || JSON.stringify(a).indexOf('wdfascia') >= 0);
    // Confirming the layout again must not take the runs with it --
    // bargeboards sit at position 4, past this floor's two windows.
    window.prompt = () => '8';
    addWdRun('bargeboard'); closeWdDetail();
    const bb = windoors.openings.find(o => o.kind === 'run' && o.type === 'bargeboard');
    editWdLayout(); await confirmWdLayout();
    out.survives = windoors.openings.some(o => o.id === r.id) && !!bb && windoors.openings.some(o => o.id === bb.id);
    out.text = wdInvoiceText({ report: 'attached' });
    out.measureRow = /18\.5m roofline/.test(windoorsMeasureRowHtml());
    // The switch: apart, the fascia-and-soffit run becomes a fascia and a
    // soffit of the same length, its marked work on both; and back.
    setWdRunsSplit(true);
    const runs = () => windoors.openings.filter(o => o.kind === 'run').map(o => o.type + ':' + o.run_length + '+' + (o.run_extra || 0)).sort();
    out.split = [windoors.property.runs_split, runs(), windoors.marks.filter(m => m.action_key === 'filler').length];
    out.splitText = wdInvoiceText({ report: 'attached' });
    setWdRunsSplit(false);
    out.merged = [windoors.property.runs_split, runs(), windoors.marks.filter(m => m.action_key === 'filler').length];
    jobs[0].status = 'accepted';
    setWdRunsSplit(true);
    out.locked = windoors.property.runs_split;
    jobs[0].status = 'quoted';
    return out;
  }, prop);
  eq('7. the side shows a Roofline card to add from', app.card, true);
  eq('7. + Fascia & soffit adds one, at the metres typed, and opens it', app.added, ['fascia_soffit', 9, 1, true]);
  eq('7. its sheet has the length, and access in the rate', app.sheet, true);
  eq('7. the extra metres save', app.extra, 1.5);
  eq('7. a section is marked like a part', app.marked, ['middle:filler']);
  check('7. ...and priced', app.price > 0);
  eq('7. a fascia or soffit alone isn\'t offered until the switch is on', app.noSeparate, true);
  check('7. the roofline paints in the windows\' colour until it has its own', /fascia:1/.test(app.paintBefore) && /fascia:3/.test(app.paintAfter), [app.paintBefore, app.paintAfter]);
  eq('7. the roofline has its own colour area', app.colourArea, true);
  eq('7. switched apart: a fascia and a soffit at the same metres, the marked work on both', app.split, [true, ['bargeboard:8+0', 'fascia:9+1.5', 'soffit:9+1.5'], 2]);
  check('7. ...named apart on the invoice line', /fascia/.test(app.splitText) && /soffit/.test(app.splitText) && !/fascia and soffit/.test(app.splitText), app.splitText);
  eq('7. switched back: one run again, its work once', app.merged, [false, ['bargeboard:8+0', 'fascia_soffit:9+1.5'], 1]);
  eq('7. the switch is set once the job is accepted', app.locked, false);
  eq('7. confirming the layout keeps it', app.survives, true);
  check('7. the invoice line names it', /^Exterior woodwork: .*10\.5m of fascia and soffit/.test(app.text), app.text);
  eq('7. the Measure row counts the roofline', app.measureRow, true);
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
