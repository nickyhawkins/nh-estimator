#!/usr/bin/env node
'use strict';

// ── Extras and making good (EXTERIOR_HOUSE_SPEC.md step 3) ─────────────────
//
//   1. Each extra prices by its own unit (metres, m², each) at its Rates
//      figure, prep and coats on top, no access uplift unless set by hand.
//   2. Metres and m² are marked left / middle / right; counted ones as a whole.
//   3. Words: "18m of gutters", "3 downpipes", "20m² of other walls"; the
//      line's head follows what's in it (woodwork, or painting with masonry).
//   4. Paint: wood and metal with the windows, walls and stone as masonry.
//   5. Making good: a fixed £ in the quote, kept by an old app's save.
//   6. The server: one of each per side, quantities capped, names kept.
//   7. Drawn: gutters and downpipes on the house, tappable.
//   8. In the app: added from the side's Extras card, measured, marked;
//      making good on the totals card; the masonry joins the materials;
//      confirming a layout never deletes an extra.
//
// USAGE
//   node scripts/test-windoors-extras.js
//   npm run test:windoors-extras

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
                 layout: { back: { floors: [{ windows: 2, doors: 1 }, { windows: 3, doors: 0 }], confirmed: true } } };
  const x = (type, q, more) => Object.assign({ id: type, side: 'back', floor: 0, level: 'standard', kind: 'extra', type, position: W.extraType({ type }).position,
                                                run_length: q, prep_stage: 'quote', rows: 1, cols: 1, size_tier: 'standard' }, more || {});
  const mins = (os, p, marks) => W.priceJob({ property: p || prop, openings: os, marks: marks || [] }, R).quote;

  // ── 1. Pricing ─────────────────────────────────────────────────────────
  eq('1. all thirteen extras (Tudor framing last, at a set price), each with a unit and a paint', W.EXTRA_TYPES.map(t => t.key + ':' + t.unit + ':' + t.paint).length, 13);
  near('1. metres', mins([x('gutters', 18)]).mins, 18 * R.extra.gutters.mins * R.prep.light);
  near('1. counted', mins([x('downpipes', 3)]).mins, 3 * R.extra.downpipes.mins * R.prep.light);
  near('1. m², at the Exterior form\'s masonry rate (5 a coat)', mins([x('other_walls', 20)]).mins, 20 * 10 * R.prep.light);
  near('1. coats', mins([x('fences', 10)], Object.assign({}, prop, { coats: 1 })).mins, 10 * R.extra.fences.mins * 0.5 * R.prep.light);
  near('1. no access uplift on Auto', mins([x('gutters', 18)]).mins, mins([x('gutters', 18, { access: null })]).mins);
  near('1. a tower set by hand does', mins([x('gutters', 18, { access: 'ladderTower' })]).mins, 18 * R.extra.gutters.mins * R.prep.light * R.access.ladderTower);
  eq('1. a saved rate is kept', W.mergeRates({ extra: { gutters: { mins: 11 } } }).extra.gutters.mins, 11);
  near('1. not in this job: nothing', mins([x('gates', 2, { excluded: true })]).mins, 0);

  // ── 2. Marking ─────────────────────────────────────────────────────────
  eq('2. metres in three sections', W.openingElements(x('gutters', 18)).map(e => e.id), ['left', 'middle', 'right']);
  eq('2. m² too', W.openingElements(x('cladding', 12)).map(e => e.id), ['left', 'middle', 'right']);
  eq('2. a counted extra as a whole, named', W.openingElements(x('downpipes', 3)).map(e => e.id + ':' + e.label), ['item:downpipe']);
  eq('2. part actions only', W.actionsFor(x('gates', 1), 'part').map(a => a.key), ['filler', 'resin', 'splice']);
  const m = { id: 'm1', opening_id: 'gutters', element_id: 'right', action_key: 'filler', stage: 'quote', created_at: 'a', done_at: 'x' };
  near('2. a mark prices like any', mins([x('gutters', 18)], prop, [m]).mins - mins([x('gutters', 18)]).mins, R.actions.filler.mins);

  // ── 3. Words ───────────────────────────────────────────────────────────
  eq('3. labels', [W.openingLabel(x('gutters', 18)), W.openingLabel(x('other_walls', 20, { nickname: 'Garden wall' }))], ['Back, gutters', 'Back, other walls (Garden wall)']);
  eq('3. amounts', [W.extraAmount(x('gutters', 18)), W.extraAmount(x('downpipes', 1)), W.extraAmount(x('downpipes', 3)), W.extraAmount(x('cladding', 12.5))],
    ['18m gutters', '1 downpipe', '3 downpipes', '12.5m² cladding']);
  const wood = { property: prop, openings: [x('gutters', 18), x('downpipes', 3)], marks: [] };
  eq('3. wood and metal extras head the line "Exterior woodwork"', W.invoiceLineText(Object.assign({ report: false }, W.invoiceCounts(wood))),
    'Exterior woodwork: preparation and painting of outside faces, 18m of gutters and 3 downpipes.');
  const withWalls = { property: prop, openings: [x('gutters', 18), x('other_walls', 20, { nickname: 'Garden wall' })], marks: [] };
  eq('3. masonry in it: "Exterior painting"', W.itemLineText(withWalls), 'Exterior painting (outside faces): 18m gutters, 20m² other walls.');
  check('3. the invoice line too', /^Exterior painting: .*18m of gutters and 20m² of other walls\./.test(W.invoiceLineText(W.invoiceCounts(withWalls))));
  const rep = W.workReportModel({ property: prop, openings: [x('downpipes', 3)], marks: [] }, [], {});
  eq('3. in the work report', [rep.sections[0].label, rep.sections[0].paint], ['Back, downpipes', 'Prepared (light) and painted, 2 coats, 3 downpipes']);

  // ── 4. Paint ───────────────────────────────────────────────────────────
  const pa = W.paintAreas({ property: prop, openings: [x('gutters', 10), x('other_walls', 20), x('stone_sills', 4)], marks: [] }, R);
  near('4. wood and metal with the windows', pa.window, 10 * R.extra.gutters.m2);
  near('4. walls and stone as masonry', pa.masonry, 20 * R.extra.other_walls.m2 + 4 * R.extra.stone_sills.m2);
  eq('4. none counted as windows', pa.windows, 0);

  // ── 5. Making good ─────────────────────────────────────────────────────
  near('5. a fixed £ in the quote', mins([x('gutters', 10)], Object.assign({}, prop, { making_good: 45 })).fixed, 45);
  near('5. ...and nothing without it', mins([x('gutters', 10)]).fixed, 0);
  eq('5. the server keeps it, and an old app\'s save leaves it alone', [L.normaliseProperty({ makingGood: 45 }).making_good, L.normaliseProperty({}).making_good], [45, null]);
  eq('5. read back', L.mapProperty({ style: 'georgian', making_good: '45' }).making_good, 45);

  // ── 6. The server ──────────────────────────────────────────────────────
  const n = L.normaliseOpening({ side: 'back', kind: 'extra', type: 'other_walls', runLength: 20, nickname: 'Garden wall', position: 99, floor: 3 });
  eq('6. one of each per side, named', [n.position, n.floor, n.run_length, n.nickname], [12, 0, 20, 'Garden wall']);
  eq('6. capped', L.normaliseOpening({ side: 'back', kind: 'extra', type: 'fences', runLength: 99999 }).run_length, W.EXTRA_MAX);
  check('6. an unknown extra is refused', !!L.normaliseOpening({ side: 'back', kind: 'extra', type: 'swimming_pool' }).error);

  // ── 7. Drawn ───────────────────────────────────────────────────────────
  const elev = W.elevationSvg({ property: prop, openings: [x('gutters', 18), x('downpipes', 2), x('fences', 10)], marks: [m] }, 'back', { interactive: true });
  check('7. gutters and downpipes are on the house, tappable', elev.indexOf('data-open-id="gutters"') >= 0 && elev.indexOf('data-open-id="downpipes"') >= 0);
  check('7. the rest are listed, not drawn', elev.indexOf('data-open-id="fences"') < 0);
  check('7. a marked gutter section shows as work', elev.indexOf('#f0a020') >= 0);

  // ── 8. In the app ──────────────────────────────────────────────────────
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const app = await page.evaluate(async (prop) => {
    jobs = [{ id: 'j1', name: 'T', status: 'quoted', windoorsVariations: [] }]; activeJobId = 'j1';
    windoors = { jobId: 'j1', property: Object.assign({ job_id: 'j1' }, prop), openings: [
      { id: 'w1', side: 'back', floor: 0, level: 'standard', kind: 'window', position: 1, type: 'sash', size_tier: 'medium', rows: 2, cols: 3, prep_stage: 'quote' }], marks: [] };
    await openWindoors('quote');
    wdSide = 'back'; renderWindoors();
    const out = {};
    const body = () => document.getElementById('wd-body').textContent;
    out.card = /Extras/.test(body()) && /\+ Add an extra/.test(body());
    window.prompt = () => '18';
    addWdExtra('gutters');
    const g = windoors.openings.find(o => o.kind === 'extra');
    out.added = g ? [g.type, g.run_length, g.position, wdOpenId === g.id] : null;
    out.sheet = /Length, metres/.test(document.getElementById('wd-sheet-body').textContent);
    wdSel = { kind: 'part', ids: { left: true } }; wdApplyAction('resin');
    out.marked = windoors.marks.filter(m => m.opening_id === g.id).map(m => m.element_id + ':' + m.action_key);
    closeWdDetail();
    // A wall that isn't the house's, named.
    let asks = ['Garden wall', '20'];
    window.prompt = () => asks.shift();
    addWdExtra('other_walls'); closeWdDetail();
    const w = windoors.openings.find(o => o.type === 'other_walls');
    out.walls = w ? [w.nickname, w.run_length] : null;
    window.prompt = () => '3';
    addWdExtra('downpipes'); closeWdDetail();
    out.notOfferedTwice = !Array.from(document.querySelectorAll('#wd-body option')).some(o => o.value === 'gutters');
    // Making good.
    setWdMakingGood('45');
    out.makingGood = [windoors.property.making_good, Math.round(calcWindoors().fixed * 100) / 100];
    // The masonry joins the materials.
    out.masonry = windoorsMasonryItems().map(it => [it.label, Math.round(it.masonryL * 100) / 100]);
    const mat = computeMaterials();
    out.masonryRows = (mat.masonryRows || []).length;
    // Confirming the layout keeps them all.
    editWdLayout(); await confirmWdLayout();
    out.survive = windoors.openings.filter(o => o.kind === 'extra').length;
    out.text = wdInvoiceText({ report: false });
    return out;
  }, prop);
  eq('8. the side shows an Extras card to add from', app.card, true);
  eq('8. adding gutters asks the metres and opens it', app.added, ['gutters', 18, 1, true]);
  eq('8. its sheet has the length', app.sheet, true);
  eq('8. a section is marked', app.marked, ['left:resin']);
  eq('8. other walls are named', app.walls, ['Garden wall', 20]);
  eq('8. one of each per side: gutters aren\'t offered again', app.notOfferedTwice, true);
  eq('8. making good saves and goes in the price', app.makingGood, [45, 45]);
  check('8. the walls\' paint joins the masonry rows', app.masonry.length === 1 && app.masonry[0][1] > 0, app.masonry);
  check('8. ...and the materials list has a Masonry / Render row for it', app.masonryRows >= 1, app.masonryRows);
  eq('8. confirming the layout keeps every extra (downpipes sit at position 2, gutters 1, walls 12)', app.survive, 3);
  check('8. the invoice line names them', /^Exterior painting: .*18m of gutters, 3 downpipes and 20m² of other walls\./.test(app.text), app.text);
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
