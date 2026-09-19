// The colour field's blur behaviour, in a real browser against the real
// public/index.html -- served straight off disk with no server and no
// database, the way test-nav-pin.js and test-onsite-shoplist.js do it.
//
// What it holds: typing a BRAND into a colour field and tapping away must not
// leave the job carrying a colour called "Lick". Searching by brand (v2.69.1)
// made typing a brand a sensible thing to do, and the field commits whatever
// it holds when it loses focus -- so it did exactly that, on the quote, in the
// buy list, with a tin against it.
//
//   npm run test:colour-field
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
  const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    try {
      const p = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch (e) { /* not installed under this name */ }
  }
  throw new Error('No Chrome/Chromium found. Point CHROME_PATH at the executable.');
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
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port }));
  });
}

let failed = 0;
function check(description, ok, detail) {
  console.log((ok ? '  ok  ' : 'FAIL  ') + description + (ok ? '' : ' — ' + detail));
  if (!ok) failed++;
}

(async () => {
  const { srv, base } = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });

  // Stand a single colour slot up on its own. The app's own functions do the
  // work; only the state they read is supplied, so nothing here re-implements
  // the behaviour being tested.
  await page.evaluate(() => {
    window.colourLibrary = [
      { name: 'Grey 04', brand: 'Lick', code: '' },
      { name: 'Dead Salmon', brand: 'Farrow & Ball', code: '28' },
      { name: 'The Coal Drop', brand: 'COAT', code: 'Charcoal Grey' }
    ];
    window.colours = [{ number: 1, label: 'White', brand: '', code: '' }];
    window.committed = [];
    const host = document.createElement('div');
    host.id = 'test-host';
    document.body.appendChild(host);
    host.innerHTML = colourSlotHtml('t1', 1, 'Ceiling', null);
    registerColourSlot('t1', {
      apply: function (label, brand, code) { window.committed.push({ label: label, brand: brand, code: code }); },
      pick: function () {}
    });
  });

  const field = '#c-label-t1';

  // 1. The reported bug.
  await page.fill(field, 'Lick');
  await page.evaluate(() => { hideColourDropdown('t1'); commitColourSlotText('t1', document.getElementById('c-label-t1').value); });
  let committed = await page.evaluate(() => window.committed);
  check('typing a bare brand commits nothing', committed.length === 0, JSON.stringify(committed));
  check('the field reverts to the colour the area actually holds',
    (await page.inputValue(field)) === 'White', 'field reads ' + JSON.stringify(await page.inputValue(field)));
  const msg = await page.textContent('#colour-dd-t1');
  check('and it says why', /is a brand, not a colour/.test(msg || ''), JSON.stringify(msg));

  // 2. A real colour still lands, with its brand and code filled in.
  await page.evaluate(() => { window.committed = []; });
  await page.fill(field, 'Dead Salmon');
  await page.evaluate(() => { hideColourDropdown('t1'); commitColourSlotText('t1', document.getElementById('c-label-t1').value); });
  committed = await page.evaluate(() => window.committed);
  check('a real colour name still commits, brand and code filled in',
    committed.length === 1 && committed[0].label === 'Dead Salmon' && committed[0].brand === 'Farrow & Ball' && committed[0].code === '28',
    JSON.stringify(committed));

  // 3. Free text the library has never heard of is still allowed.
  await page.evaluate(() => { window.committed = []; });
  await page.fill(field, "Nicky's hallway white");
  await page.evaluate(() => { hideColourDropdown('t1'); commitColourSlotText('t1', document.getElementById('c-label-t1').value); });
  committed = await page.evaluate(() => window.committed);
  check('free text still commits as free text',
    committed.length === 1 && committed[0].label === "Nicky's hallway white" && committed[0].brand === '',
    JSON.stringify(committed));

  // 4. Clearing still clears -- the guard must not swallow the blank that puts
  //    an area back to undecided.
  await page.evaluate(() => { window.committed = []; });
  await page.fill(field, '');
  await page.evaluate(() => { hideColourDropdown('t1'); commitColourSlotText('t1', document.getElementById('c-label-t1').value); });
  committed = await page.evaluate(() => window.committed);
  check('clearing the field still commits a blank (back to undecided)',
    committed.length === 1 && committed[0].label === '', JSON.stringify(committed));

  // 5. Typing a name already on the job joins it, even if it looks like a brand.
  await page.evaluate(() => {
    window.committed = [];
    window.colours = [{ number: 1, label: 'Lick', brand: '', code: '' }];
  });
  await page.fill(field, 'Lick');
  await page.evaluate(() => { hideColourDropdown('t1'); commitColourSlotText('t1', document.getElementById('c-label-t1').value); });
  committed = await page.evaluate(() => window.committed);
  check('a colour already on the job by that name is still joined',
    committed.length === 1 && committed[0].label === 'Lick', JSON.stringify(committed));

  // 6. The dropdown still offers the brand's colours while typing -- declining
  //    the COMMIT must not break the SEARCH that made brands worth typing.
  await page.evaluate(() => { window.colours = [{ number: 1, label: 'White', brand: '', code: '' }]; });
  await page.fill(field, 'Lick');
  await page.evaluate(() => onColourLabelInput('t1', 'Lick'));
  const dd = await page.textContent('#colour-dd-t1');
  check('the dropdown still lists that brand while typing', /Grey 04/.test(dd || ''), JSON.stringify(dd));

  await browser.close();
  srv.close();
  console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
