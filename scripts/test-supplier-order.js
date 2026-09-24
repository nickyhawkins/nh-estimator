#!/usr/bin/env node
'use strict';

// ── Send materials order to supplier ───────────────────────────────────────
//
// What is held here, end to end through the real screen:
//
//   1. Suppliers are added in Settings; name and email are required and a
//      bad email is refused before anything is written.
//   2. The order's lines are On Site's roll-up (one line per product+size),
//      merged across jobs on the same key with quantities summed.
//   3. The invoice's colour substitution: the band becomes the named colour,
//      all or nothing -- a line with a placeholder colour keeps its band and
//      is flagged, and the banner counts it. Two colours on one product are
//      split out for the merchant.
//   4. Delivery defaults: site for one job, home for more; home falls back to
//      the business address; collect uses the supplier's branch.
//   5. The email: subject, body layout, empty lines omitted, and a mailto:
//      with %0D%0A line breaks and %20 spaces.
//   6. "Did you send it?" -- No logs nothing; Yes logs the order (queued
//      offline by its own id), marks each source job's lines ordered, and
//      the next order starts those lines unticked with an "Ordered" label.
//   7. A line only some jobs have ordered starts ticked at the rest's
//      quantity.
//   8. "Add unordered to shopping list" adds only the unticked, not-yet-
//      ordered lines, tagged by source job.
//   9. Editing a quantity or an address on the order changes nothing on the
//      job or in Settings.
//  10. On Site shows the ordered label and the job's Orders history.
//
// Served off disk with no server, like test-onsite-shoplist.js, and every API
// call is cut off on the way out: reads fall back to this phone's copies and
// writes queue -- the offline path, which is the one that has to work on site.
//
// USAGE
//   node scripts/test-supplier-order.js
//   npm run test:supplier-order

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

// Two accepted jobs and a quoted one. j1 is open. Its snapshot has the same
// Optiva tin in two rooms (one colour, named), a Helmi band tin covering two
// named colours, a primer still on a placeholder colour, and a sundry. j2 is
// only on this phone as an offline copy (the per-job mirror), and orders the
// same Optiva tin in its own colour numbering.
const SEED = () => {
  localStorage.clear();
  offlineQueue = []; persistOfflineQueue();
  supplierOrdersByJob = {}; persistSupplierOrdersLocal();
  suppliers = []; persistSuppliersLocal();
  jobs = [
    { id: 'j1', name: 'Ermine Street', status: 'accepted', contact: { street: '12 Ermine Street', town: 'Huntingdon', postcode: 'PE29 1AA' } },
    { id: 'j2', name: 'Mill Lane', status: 'accepted', contact: { street: '3 Mill Lane', town: 'St Ives', postcode: 'PE27 2BB' } },
    { id: 'j3', name: 'Old Quote', status: 'quoted' }
  ];
  activeJobId = 'j1';
  settings.businessName = 'Nicky Hawkins Painter & Decorator';
  settings.ownerName = 'Nicky Hawkins';
  settings.businessPhone = '07700 900123';
  settings.businessAddress = '1 Yard Road, Huntingdon';
  settings.homeDeliveryAddress = '';
  colours = [
    { number: 1, label: 'Dead Salmon', brand: '', code: '' },
    { number: 2, label: 'Pointing', brand: '', code: '' },
    { number: 3, label: 'Lichen', brand: '', code: '' },
    { number: 4, label: '', brand: '', code: '' }
  ];
  rooms = [];
  materialsSnapshot = [
    { id: 'm1', itemCode: 'OPT5-C3', description: 'Tikkurila Optiva 5 - Colours 3ltr', quantity: 2, unitAmount: 60, isPerLitre: false, colourNumber: 1, role: 'wall' },
    { id: 'm2', itemCode: 'OPT5-C3', description: 'Tikkurila Optiva 5 - Colours 3ltr', quantity: 1, unitAmount: 60, isPerLitre: false, colourNumber: 1, role: 'wall' },
    { id: 'm3', itemCode: 'HEL10-P3', description: 'Tikkurila Helmi 10 - Pastels 3ltr', quantity: 2, unitAmount: 50, isPerLitre: false, colourNumber: 2, role: 'wood' },
    { id: 'm4', itemCode: 'HEL10-P3', description: 'Tikkurila Helmi 10 - Pastels 3ltr', quantity: 1, unitAmount: 50, isPerLitre: false, colourNumber: 3, role: 'wood' },
    { id: 'm5', itemCode: 'PRIM-C1', description: 'Bedec Primer - Colours 1ltr', quantity: 1, unitAmount: 20, isPerLitre: false, colourNumber: 4, role: 'wood' },
    { id: 'm6', itemCode: 'SUN001', description: 'Masking tape 50m', quantity: 4, unitAmount: 3, isPerLitre: false, colourNumber: null }
  ];
  materialActuals = [];
  writeJobMirror('materials', 'j2', [
    { id: 'n1', itemCode: 'OPT5-C3', description: 'Tikkurila Optiva 5 - Colours 3ltr', quantity: 3, unitAmount: 60, isPerLitre: false, colourNumber: 1, role: 'wall' },
    { id: 'n2', itemCode: 'SUN001', description: 'Masking tape 50m', quantity: 1, unitAmount: 3, isPerLitre: false, colourNumber: null }
  ]);
  writeJobMirror('colours', 'j2', [{ number: 1, label: 'Dead Salmon', brand: '', code: '' }]);
  shopList = [];
  window.__mailto = [];
  openMailto = function(url) { window.__mailto.push(url); };
  // The order's own save goes to a server that isn't there -- let it queue.
};

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  // No signal: every API call dies on the way out, so reads fall back to the
  // phone's copies and writes queue -- exactly as on site in a dead spot.
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));

  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate(SEED);

  // ── 1. Suppliers in Settings ─────────────────────────────────────────────
  await page.evaluate(() => { goTab('settings'); loadSettings(); editSupplier(-1); });
  await page.fill('#sup-name', 'Brewers');
  await page.fill('#sup-email', 'not an email');
  await page.evaluate(() => saveSupplierForm());
  eq('1. a bad email is refused, nothing saved', await page.evaluate(() => [suppliers.length,
    document.getElementById('sup-form-error').textContent]), [0, 'That email address doesn\'t look right.']);
  await page.fill('#sup-email', 'orders@brewers.example');
  await page.fill('#sup-account', 'NH4471');
  await page.fill('#sup-branch', 'Cambridge');
  await page.fill('#sup-branch-address', 'Units 1-2, Cambridge Road');
  await page.evaluate(() => saveSupplierForm());
  eq('1. saved with its fields', await page.evaluate(() => suppliers.map(s => [s.name, s.email, s.accountNumber, s.branchName, s.branchAddress])),
    [['Brewers', 'orders@brewers.example', 'NH4471', 'Cambridge', 'Units 1-2, Cambridge Road']]);
  check('1. the write is queued for the server (offline)', await page.evaluate(() =>
    hasQueuedWrite('PUT', '/api/suppliers/' + suppliers[0].id)));
  check('1. and mirrored on the phone', await page.evaluate(() => JSON.parse(localStorage.getItem('pe-suppliers')).length === 1));
  eq('1. the list shows it', await page.evaluate(() => document.getElementById('suppliers-body').textContent.includes('Brewers')), true);

  // ── 2/3. One job: roll-up and colour ─────────────────────────────────────
  await page.evaluate(() => { openSupplierOrder(); });
  await page.waitForTimeout(100);
  const lines = () => page.evaluate(() => sordLines().map(l => ({ d: l.display, q: l.quantity, send: l.sendQty, inc: l.included, ph: l.placeholder })));
  eq('2/3. On Site roll-up with colour substituted', await lines(), [
    { d: 'Tikkurila Optiva 5 - Dead Salmon 3ltr', q: 3, send: 3, inc: true, ph: false },
    { d: 'Tikkurila Helmi 10 - Pointing / Lichen 3ltr', q: 3, send: 3, inc: true, ph: false },
    { d: 'Bedec Primer - Colours 1ltr', q: 1, send: 1, inc: true, ph: true },
    { d: 'Masking tape 50m', q: 4, send: 4, inc: true, ph: false }
  ]);
  eq('3. the only supplier is preselected', await page.evaluate(() => sord.supplierId === suppliers[0].id), true);
  const html = () => page.evaluate(() => document.getElementById('supplierorder-body').innerText);
  check('3. placeholder line carries a warning badge', (await html()).includes('⚠ no colour set'));
  check('3. and the banner counts it', (await html()).includes('1 line has no colour set'));
  eq('4. one job defaults to Deliver to site with its address', await page.evaluate(() => [sordMethod(), sordAddress()]),
    ['site', '12 Ermine Street, Huntingdon, PE29 1AA']);

  // ── 5. The email ─────────────────────────────────────────────────────────
  await page.evaluate(() => { setSupplierOrderNotes('Leave in the porch, gate code 1234'); setSupplierOrderRequiredBy('2026-10-02'); renderSupplierOrder(); });
  await page.fill('#sord-extra-desc', 'Decorators caulk');
  await page.fill('#sord-extra-qty', '3');
  await page.evaluate(() => addSupplierOrderExtra());
  const email = await page.evaluate(() => sordCompose().email);
  eq('5. subject', email.subject, 'Order: Nicky Hawkins Painter & Decorator (Acc NH4471)');
  eq('5. body', email.body.split('\r\n'), [
    'Hi Brewers,',
    '',
    'Please could you supply the following:',
    '',
    '3 x Tikkurila Optiva 5 - Dead Salmon 3ltr',
    '3 x Tikkurila Helmi 10 - Pointing / Lichen 3ltr (Pointing: 2, Lichen: 1)',
    '1 x Bedec Primer - Colours 1ltr',
    '4 x Masking tape 50m',
    '3 x Decorators caulk',
    '',
    'Account: NH4471',
    'Job ref: Ermine Street',
    'Delivery: Deliver to site',
    'Address: 12 Ermine Street, Huntingdon, PE29 1AA',
    'Delivery notes: Leave in the porch, gate code 1234',
    'Required by: Fri 2 Oct 2026',
    '',
    'Thanks,',
    'Nicky Hawkins',
    'Nicky Hawkins Painter & Decorator',
    '07700 900123'
  ]);

  // ── 9. Quantity and address edits stay on the order ──────────────────────
  await page.evaluate(() => {
    const i = sord._lines.findIndex(l => l.key === 'code:SUN001');
    stepSupplierOrderQty(i, 1);
    setSupplierOrderAddress('Round the back, 12 Ermine Street');
  });
  eq('9. the stepper edits the order quantity', await page.evaluate(() => sordLines().find(l => l.key === 'code:SUN001').sendQty), 5);
  eq('9. and the job\'s materials are untouched', await page.evaluate(() => materialsSnapshot.find(l => l.id === 'm6').quantity), 4);
  eq('9. and the job\'s address is untouched', await page.evaluate(() => jobs[0].contact.street), '12 Ermine Street');

  // Untick the primer: it becomes the shopping-list leftover later.
  await page.evaluate(() => toggleSupplierOrderLine(sord._lines.findIndex(l => l.key === 'code:PRIM-C1')));
  eq('3. an unticked placeholder no longer counts toward the banner',
    (await html()).includes('no colour set —'), false);

  // ── 5. Send, and the mailto: ─────────────────────────────────────────────
  await page.evaluate(() => sendSupplierOrder());
  const url = await page.evaluate(() => window.__mailto[0]);
  check('5. mailto: to the supplier', url && url.startsWith('mailto:orders@brewers.example?subject='), url);
  check('5. CRLF line breaks are %0D%0A', url && url.includes('%0D%0A') && !url.replace(/%0D%0A/g, '').includes('%0A'), url);
  check('5. spaces are %20, never +', url && !url.includes('+') && url.includes('Hi%20Brewers'), url);
  check('5. & in the business name is encoded', url && url.includes('Painter%20%26%20Decorator'), url);
  eq('5. the email decodes back to itself', await page.evaluate((u) => {
    const q = u.split('?')[1].split('&').map(p => p.split('='));
    return decodeURIComponent(q.find(p => p[0] === 'body')[1]) === sordCompose().email.body;
  }, url), true);
  check('6. asks whether it was sent', (await html()).includes('Did you send the order to Brewers?'));

  // ── 6. No logs nothing ───────────────────────────────────────────────────
  await page.evaluate(() => confirmSupplierOrder(false));
  eq('6. No logs nothing', await page.evaluate(() => ordersForJob('j1').length), 0);

  await page.evaluate(() => sendSupplierOrder());
  await page.evaluate(() => confirmSupplierOrder(true));
  const logged = await page.evaluate(() => ordersForJob('j1')[0]);
  eq('6. Yes logs the order with its delivery details', logged && [logged.supplierName, logged.deliveryMethod, logged.deliveryAddress, logged.deliveryNotes, logged.requiredBy],
    ['Brewers', 'site', 'Round the back, 12 Ermine Street', 'Leave in the porch, gate code 1234', '2026-10-02']);
  eq('6. its lines: per job, product key, as sent', logged && logged.lines.map(l => [l.lineNo, l.productKey, l.jobId, l.description, l.quantity, l.isExtra]), [
    [0, 'code:OPT5-C3', 'j1', 'Tikkurila Optiva 5 - Dead Salmon 3ltr', 3, false],
    [1, 'code:HEL10-P3', 'j1', 'Tikkurila Helmi 10 - Pointing / Lichen 3ltr (Pointing: 2, Lichen: 1)', 3, false],
    [2, 'code:SUN001', 'j1', 'Masking tape 50m', 5, false],
    [3, null, null, 'Decorators caulk', 3, true]
  ]);
  check('6. the body text is the email as sent', logged && logged.bodyText.includes('5 x Masking tape 50m') && logged.bodyText.includes('3 x Decorators caulk'));
  check('6. queued to sync by its own id', await page.evaluate((id) => hasQueuedWrite('PUT', '/api/supplier-orders/' + id), logged.id));
  eq('6. the ordered lines now start unticked; the unordered one ticked', await page.evaluate(() =>
    sordLines().map(l => [l.key, l.included, !!l.ordered])), [
    ['code:OPT5-C3', false, true], ['code:HEL10-P3', false, true], ['code:PRIM-C1', true, false], ['code:SUN001', false, true]
  ]);
  check('6. with the label', /Ordered · Brewers · \d+ \w+/.test(await html()));

  // ── 8. Shopping list offer ───────────────────────────────────────────────
  check('8. offers the shopping list for what was left', (await html()).includes('Add unordered to shopping list'));
  await page.evaluate(() => addUnorderedToShopList());
  await page.waitForTimeout(50);
  eq('8. only the unticked, unordered line, tagged by job', await page.evaluate(() =>
    shopList.map(i => [i.name, i.code, i.jobTags])), [['Bedec Primer - Colours 1ltr', 'PRIM-C1', ['Ermine Street']]]);

  // ── 4/7. Two jobs ────────────────────────────────────────────────────────
  await page.evaluate(() => { openSupplierOrder(); });
  eq('4. the candidate jobs are this one plus accepted ones',
    await page.evaluate(() => supplierOrderCandidateJobs().map(j => j.id)), ['j1', 'j2']);
  await page.evaluate(() => toggleSupplierOrderJob('j2'));
  await page.waitForTimeout(150);
  eq('4. two jobs default to Deliver to home, falling back to the business address',
    await page.evaluate(() => [sordMethod(), sordAddress()]), ['home', '1 Yard Road, Huntingdon']);
  eq('2. merged across jobs, quantities summed', await page.evaluate(() =>
    sordLines().filter(l => l.key === 'code:OPT5-C3' || l.key === 'code:SUN001').map(l => [l.display, l.quantity, l.jobs.map(j => j.jobId + ':' + j.quantity)])), [
    ['Tikkurila Optiva 5 - Dead Salmon 3ltr', 6, ['j1:3', 'j2:3']],
    ['Masking tape 50m', 5, ['j1:4', 'j2:1']]
  ]);
  eq('7. part-ordered lines start ticked at the other job\'s quantity', await page.evaluate(() =>
    sordLines().filter(l => l.key === 'code:OPT5-C3' || l.key === 'code:SUN001').map(l => [l.included, l.sendQty, l.fullyOrdered])), [
    [true, 3, false], [true, 1, false]
  ]);
  check('7. and say who it was ordered for', (await html()).includes('Ordered for Ermine Street · Brewers'));
  await page.evaluate(() => setSupplierOrderMethod('site'));
  eq('4. to site with two jobs offers each job\'s address', await page.evaluate(() =>
    document.querySelectorAll('input[name=sord-site]').length), 2);
  await page.evaluate(() => setSupplierOrderSiteJob('j2'));
  eq('4. and picks the one chosen', await page.evaluate(() => sordAddress()), '3 Mill Lane, St Ives, PE27 2BB');
  await page.evaluate(() => setSupplierOrderMethod('collect'));
  const collect = await page.evaluate(() => sordCompose().email.body);
  check('4. collect names the branch and its address', collect.includes('Delivery: Collect from Cambridge') && collect.includes('Address: Units 1-2, Cambridge Road'), collect);
  check('5. job ref lists both jobs', collect.includes('Job ref: Ermine Street, Mill Lane'), collect);

  // Log it: j2's share of the merged lines is recorded against j2 only.
  await page.evaluate(() => { sendSupplierOrder(); confirmSupplierOrder(true); });
  const second = await page.evaluate(() => ordersForJob('j2')[0]);
  eq('7. the part-ordered lines log only for the job that hadn\'t ordered', second.lines.map(l => [l.productKey, l.jobId, l.quantity]), [
    ['code:OPT5-C3', 'j2', 3], ['code:PRIM-C1', 'j1', 1], ['code:SUN001', 'j2', 1]
  ]);
  eq('6. the order shows under both jobs', await page.evaluate((id) => [ordersForJob('j1')[0].id === id, ordersForJob('j2')[0].id === id], second.id), [true, true]);
  eq('5. collect stores no address', second.deliveryAddress, '');

  // ── 9. Settings untouched by any of it ───────────────────────────────────
  eq('9. Settings\' addresses untouched', await page.evaluate(() => [settings.homeDeliveryAddress, settings.businessAddress]), ['', '1 Yard Road, Huntingdon']);

  // ── 10. On Site ──────────────────────────────────────────────────────────
  await page.evaluate(() => { goTab('actuals'); renderActuals(); });
  const onsite = await page.evaluate(() => document.getElementById('actuals-body').innerText);
  check('10. On Site has the Send to supplier button', onsite.includes('Send to supplier'));
  check('10. and labels ordered rows', /Ordered · Brewers/.test(onsite));
  check('10. and lists the job\'s orders', onsite.includes('ORDERS') || onsite.includes('Orders'));
  await page.evaluate(() => toggleSupplierOrderHistory(1));
  check('10. tapping an order shows the email as sent', (await page.evaluate(() => document.getElementById('act-orders').innerText)).includes('Please could you supply the following:'));
  eq('10. item count is lines, not per-job rows', await page.evaluate(() => /4 items/.test(document.getElementById('act-orders').innerText)), true);

  // ── Offline copies survive a reload ──────────────────────────────────────
  const orderCount = await page.evaluate(() => JSON.parse(localStorage.getItem('pe-supplier-orders')).j1.length);
  eq('orders are kept on the phone for offline', orderCount, 2);

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
