// Windows and doors: the painting ticked off on site (v3.2.5).
//
// Nicky, with the work-to-do PDF and a dormer whose six repairs were all
// ticked: "Still shows needs painting but no way to tick that off as done."
// Every opening's painting stayed on the list for good. Now:
//   1. On site, the sheet's Tick off as done list has the painting first,
//      on an opening with no repairs too.
//   2. Ticking it stamps painted_at and saves it with the opening.
//   3. The work-to-do list drops the painting line, and the opening once
//      nothing else is left; the totals stop counting it.
//   4. Tick all ticks the painting too; tapping again unticks it.
//
// USAGE
//   node scripts/test-windoors-paint-tick.js
//   npm run test:windoors-paint-tick

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
  const win = (id, position) => ({ id, side: 'back', level: 'standard', floor: 0, position, kind: 'window', type: 'sash', size_tier: 'medium', rows: 2, cols: 3,
    nickname: null, prep_level: null, prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null,
    bay_shape: null, bay_storeys: null, parent_opening_id: null, panes_set: false });
  windoors = {
    jobId: 'j1',
    property: { job_id: 'j1', style: 'georgian', detail_enabled: true, default_prep: 'light', layout: {}, coats: 2 },
    openings: [win('w1', 1), win('w2', 2)],
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
  // What the phone sends when it saves an opening.
  const puts = [];
  await page.route('**/api/windoors/openings/**', (route) => {
    const req = route.request();
    if (req.method() === 'PUT') puts.push({ url: req.url(), body: JSON.parse(req.postData() || '{}') });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(SEED);
  await page.evaluate(async () => { await openWindoors('site'); openWdDetail('w2'); });

  const sheet = () => page.evaluate(() => document.getElementById('wd-sheet-body').textContent);
  const todo = () => page.evaluate(() => wdTodoModelNow().sections.map(s => s.opening.id + ':' + s.quoted.join('|')));

  const t1 = await sheet();
  check('1. an opening with no repairs has a tick list', /Tick off as done/.test(t1) && /Paint · outside face/.test(t1), t1.slice(-300));
  check('1. ...0 of 1 done', /0 of 1 done/.test(t1));
  eq('1. both openings are on the to-do list', (await todo()).length, 2);

  await page.evaluate(() => document.querySelector('#wd-sheet-body [onclick="wdTogglePainted()"]').click());
  await page.waitForTimeout(200);
  check('2. ticking stamps painted_at', await page.evaluate(() => !!windoors.openings.find(o => o.id === 'w2').painted_at));
  const last = puts.filter(p => /\/w2/.test(p.url)).pop();
  check('2. ...and saves it with the opening', !!(last && last.body.paintedAt), puts);
  check('2. ...shown ticked', /1 of 1 done/.test(await sheet()));
  await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: false }).catch(() => {});

  eq('3. the painted opening is off the to-do list', (await todo()).map(s => s.split(':')[0]), ['w1']);
  check('3. ...and not counted as one to paint', await page.evaluate(() => wdTodoModelNow().sections.filter(s => s.toPaint).length === 1));

  await page.evaluate(() => { closeWdDetail(); openWdDetail('w1'); });
  check('4. painting first, then the repair, on an opening with both', /Paint · outside face[\s\S]*Resin repair · /.test(await sheet()));
  await page.evaluate(() => wdTickAll());
  check('4. tick all ticks the painting too', await page.evaluate(() => !!windoors.openings.find(o => o.id === 'w1').painted_at && windoors.marks[0].done_at));
  eq('4. ...nothing left to do', (await todo()).length, 0);
  await page.evaluate(() => { closeWdDetail(); openWdDetail('w2'); document.querySelector('#wd-sheet-body [onclick="wdTogglePainted()"]').click(); });
  check('4. tapping again unticks it', await page.evaluate(() => !windoors.openings.find(o => o.id === 'w2').painted_at));
  eq('4. ...and it is back on the list', (await todo()).map(s => s.split(':')[0]), ['w2']);

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
