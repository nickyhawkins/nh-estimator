#!/usr/bin/env node
'use strict';

// ── Walls (EXTERIOR_HOUSE_SPEC.md step 4) ──────────────────────────────────
//
//   1. The area: width × height (+ the gable's triangle), less every window
//      and door on the side at its typical size -- painted or not -- and not
//      the lower ground or the dormers.
//   2. The price: m² at the finish's rate, cutting in round each opening per
//      coat, prep and coats on top; spray changes paint, not time.
//   3. Render only: windows left out of the job still come off the wall and
//      still take their cutting in, and aren't priced themselves.
//   4. Paint: the walls' own colour and coverage (textured / sprayed).
//   5. Words: "45m² of walls", "Exterior painting"; marked left/middle/right
//      with filler.
//   6. The server; the drawing (tap the wall).
//   7. In the app: measured from the side's Walls card, its sheet, the
//      masonry row on the materials list, the walls colour, the layout
//      guard, and the old Exterior form offered only where it's used.
//
// USAGE
//   node scripts/test-windoors-walls.js
//   npm run test:windoors-walls

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
  const op = (id, kind, floor, pos, tier, more) => Object.assign({ id, side: 'front', floor, level: 'standard', kind, position: pos, type: kind === 'door' ? 'panelled' : 'sash',
    size_tier: tier, rows: 2, cols: 3, prep_stage: 'quote' }, more || {});
  const opens = [op('w1', 'window', 0, 1, 'medium'), op('w2', 'window', 0, 2, 'medium'), op('d1', 'door', 0, 1, 'standard'),
                 op('w3', 'window', 1, 1, 'large'), op('w4', 'window', 1, 2, 'large'), op('w5', 'window', 1, 3, 'large'),
                 op('lg', 'window', 0, 1, 'small', { level: 'lower_ground' }), op('dm', 'window', 0, 1, 'small', { level: 'roof' })];
  const wall = (more) => Object.assign({ id: 'wf', side: 'front', floor: 0, level: 'standard', kind: 'wall', position: 1, type: 'smooth',
    run_length: 9, run_extra: 6.5, wall_gable: null, wall_spray: false, prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' }, more || {});

  // ── 1. The area ────────────────────────────────────────────────────────
  const g = W.wallGeometry(wall(), opens, R);
  near('1. gross: width × height', g.gross, 58.5);
  near('1. less each window and door at its size (2 medium, 3 large, a door)', g.openings, 2 * 1.2 + 3 * 2 + 1.9);
  near('1. net', g.net, 58.5 - 10.3);
  eq('1. the lower ground and the dormers aren\'t on this wall', [g.cutIn.windows, g.cutIn.doors], [5, 1]);
  near('1. a gable adds its triangle', W.wallGeometry(wall({ wall_gable: 3 }), opens, R).gross, 58.5 + 9 * 3 / 2);
  near('1. French doors count twice', W.wallGeometry(wall(), [op('fd', 'door', 0, 1, 'standard', { type: 'french_double' })], R).openings, 3.8);
  near('1. never below nothing', W.wallGeometry(wall({ run_length: 1, run_extra: 1 }), opens, R).net, 0);
  near('1. a saved opening area is used', W.wallGeometry(wall(), opens, W.mergeRates({ wall: { openingArea: { large: 2.5 } } })).openings, 2 * 1.2 + 3 * 2.5 + 1.9);

  // ── 2. The price ───────────────────────────────────────────────────────
  const price = (os) => W.priceJob({ property: prop, openings: os, marks: [] }, R).perOpening.wf.quoteMins;
  const cut = 2 * (5 * R.wall.cutIn.window + 1 * R.wall.cutIn.door);
  near('2. m² at the smooth rate + cutting in (a coat × 2), light prep on top', price(opens.concat([wall()])), (g.net * R.wall.mins.smooth + cut) * R.prep.light);
  near('2. textured at its own rate', price(opens.concat([wall({ type: 'textured' })])), (g.net * R.wall.mins.textured + cut) * R.prep.light);
  near('2. sprayed: same time', price(opens.concat([wall({ wall_spray: true })])), price(opens.concat([wall()])));
  eq('2. defaults: the Exterior form\'s 5 and 7 a coat; 10 and 12 min cutting in', [R.wall.mins.smooth, R.wall.mins.textured, R.wall.cutIn.window, R.wall.cutIn.door], [10, 14, 10, 12]);
  eq('2. a wall not in the job isn\'t priced', W.priceJob({ property: prop, openings: opens.concat([wall({ excluded: true })]), marks: [] }, R).perOpening.wf, undefined);

  // ── 3. Render only ─────────────────────────────────────────────────────
  const out = opens.map(o => Object.assign({}, o, { excluded: true }));
  const ro = W.priceJob({ property: prop, openings: out.concat([wall()]), marks: [] }, R);
  near('3. windows left out: the job is just the wall...', ro.quote.mins, (g.net * R.wall.mins.smooth + cut) * R.prep.light);
  near('3. ...still less their area, still with their cutting in', W.wallGeometry(wall(), out, R).net, g.net);

  // ── 4. Paint ───────────────────────────────────────────────────────────
  const pa = W.paintAreas({ property: prop, openings: opens.concat([wall({ type: 'textured', wall_spray: true })]), marks: [] }, R);
  eq('4. the wall is its own paint row, with its finish', pa.walls.map(w => [Math.round(w.m2 * 10) / 10, w.textured, w.spray]), [[48.2, true, true]]);
  near('4. not in the woodwork', pa.window, W.paintAreas({ property: prop, openings: opens, marks: [] }, R).window);

  // ── 5. Words, marking ──────────────────────────────────────────────────
  const d = { property: prop, openings: opens.concat([wall()]), marks: [] };
  check('5. the quote line, headed Exterior painting', /^Exterior painting \(outside faces\): .*48\.2m² walls\./.test(W.itemLineText(d)), W.itemLineText(d));
  check('5. the invoice line', / and 48\.2m² of walls\./.test(W.invoiceLineText(W.invoiceCounts(d))) && /^Exterior painting:/.test(W.invoiceLineText(W.invoiceCounts(d))), W.invoiceLineText(W.invoiceCounts(d)));
  eq('5. label', W.openingLabel(wall()), 'Front, walls');
  eq('5. marked in thirds, filler only', [W.openingElements(wall()).map(e => e.id), W.actionsFor(wall(), 'part').map(a => a.key)], [['left', 'middle', 'right'], ['filler']]);
  const rep = W.workReportModel(d, [], {});
  eq('5. in the work report', rep.sections.find(s => s.opening.id === 'wf').paint, 'Prepared (light) and painted, 2 coats, 48.2m², smooth render / masonry');

  // ── 6. Server, drawing ─────────────────────────────────────────────────
  const n = L.normaliseOpening({ side: 'front', kind: 'wall', type: 'nonsense', runLength: 9, runExtra: 6.5, wallGable: 3, wallSpray: true, position: 7 });
  eq('6. one per side, an unknown finish reads as smooth', [n.position, n.type, n.run_length, n.run_extra, n.wall_gable, n.wall_spray], [1, 'smooth', 9, 6.5, 3, true]);
  eq('6. read back', [L.mapOpening({ id: 'x', side: 'front', kind: 'wall', wall_gable: '3', wall_spray: true }).wall_gable, L.mapOpening({ id: 'x', side: 'front', kind: 'wall', wall_spray: true }).wall_spray], [3, true]);
  eq('6. the walls\' colour, and an older app\'s save leaves it alone', [L.normaliseProperty({ wallColour: 3 }).wall_colour, L.normaliseProperty({}).wall_colour], [3, undefined]);
  const elev = W.elevationSvg({ property: prop, openings: opens.concat([wall()]), marks: [{ id: 'm', opening_id: 'wf', element_id: 'middle', action_key: 'filler', stage: 'quote' }] }, 'front', { interactive: true });
  check('6. the wall is tappable, under the windows', elev.indexOf('data-open-id="wf"') >= 0 && elev.indexOf('data-open-id="wf"') < elev.indexOf('data-open-id="w1"'));
  check('6. a marked third is tinted', elev.indexOf('rgba(240,160,32,.22)') >= 0);

  // ── 7. In the app ──────────────────────────────────────────────────────
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (dd) => dd.accept().catch(() => {}));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const app = await page.evaluate(async (args) => {
    const [prop, opens] = args;
    jobs = [{ id: 'j1', name: 'T', status: 'quoted', windoorsVariations: [] }]; activeJobId = 'j1'; extItems = [];
    colours = [{ number: 1, label: 'White', brand: '', code: '' }, { number: 2, label: 'Cream', brand: '', code: '' }];
    windoors = { jobId: 'j1', property: Object.assign({ job_id: 'j1' }, prop), openings: opens.filter(o => o.level === 'standard'), marks: [] };
    await openWindoors('quote');
    wdSide = 'front'; renderWindoors();
    const out = {};
    out.card = /Measure the walls on this side/.test(document.getElementById('wd-body').textContent);
    let asks = ['9', '6.5'];
    window.prompt = () => asks.shift();
    addWdWall();
    const w = windoors.openings.find(o => o.kind === 'wall');
    out.added = w ? [w.run_length, w.run_extra, w.type, wdOpenId === w.id] : null;
    out.sheet = /Height to the eaves/.test(document.getElementById('wd-sheet-body').textContent) && /= 48\.2m²/.test(document.getElementById('wd-sheet-body').textContent.replace(/\s+/g, ' '));
    setWdWallFinish('textured'); setWdWallSpray('spray'); setWdWallFigure('wall_gable', '3');
    out.saved = [w.type, w.wall_spray, w.wall_gable];
    wdSel = { kind: 'part', ids: { right: true } }; wdApplyAction('filler');
    out.marked = windoors.marks.filter(m => m.opening_id === w.id).map(m => m.element_id + ':' + m.action_key);
    closeWdDetail();
    setWdColour('wall', 2);
    const mi = windoorsMasonryItems();
    out.masonry = mi.map(it => [it.label, it.masonryColourNumber, it.masonryL > 0]);
    out.masonryRows = (computeMaterials().masonryRows || []).length;
    out.colourCard = /Walls colour/.test(wdPaintCardHtml()) || /walls Cream/.test(wdPaintCardHtml());
    editWdLayout(); await confirmWdLayout();
    out.survives = windoors.openings.some(o => o.id === w.id);
    out.text = wdInvoiceText({ report: false });
    openAddChooser();
    out.oldFormHidden = document.getElementById('add-chooser-ext').style.display === 'none';
    extItems = [{ id: 'e1', label: 'Front', masonry: 20 }];
    openAddChooser();
    out.oldFormShown = document.getElementById('add-chooser-ext').style.display !== 'none';
    closeAddChooser();
    return out;
  }, [prop, opens]);
  eq('7. the side offers to measure its walls', app.card, true);
  eq('7. width and height asked, the sheet opens', app.added, [9, 6.5, 'smooth', true]);
  eq('7. the sheet shows the sum, openings off', app.sheet, true);
  eq('7. finish, spray and gable save', app.saved, ['textured', true, 3]);
  eq('7. marked in thirds', app.marked, ['right:filler']);
  eq('7. the paint: one masonry item, in the walls\' colour', app.masonry, [['Walls', 2, true]]);
  check('7. ...and a Masonry / Render row on the materials list', app.masonryRows >= 1, app.masonryRows);
  eq('7. the Paint card has a walls colour', app.colourCard, true);
  eq('7. confirming the layout keeps the wall', app.survives, true);
  check('7. the invoice line names the walls', /^Exterior painting: .*m² of walls\./.test(app.text), app.text);
  eq('7. the old Exterior form isn\'t offered on a new job...', app.oldFormHidden, true);
  eq('7. ...but is on one that already uses it', app.oldFormShown, true);
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
