#!/usr/bin/env node
'use strict';

// ── Regression test: Price Lookup shows the till price, not the sell price ──
//
// Found in the shop buying Benjamin Moore Scuff-X. The screen is a till
// check, but it read each item's Xero SALES price and called it the inc-VAT
// till figure, with "÷ 1.2" as ex VAT. The sell price carries Nicky's
// markup, so neither figure matched anything real:
//
//   BM034 Scuff-X Matte 3.79ltr   price list ex VAT £72.96
//                                 till (Xero buy)   £87.55
//                                 screen showed     £100.68, "£83.90 ex"
//
// On a ×1.20-markup supplier (Dulux, Crown, Johnstone's...) the small "ex"
// figure happened to equal the real till price, which is why it went
// unnoticed; Benjamin Moore (×1.15) lined up with nothing.
//
// What is held here:
//   1. priceLookupItems() returns the BUY price (PurchaseDetails.UnitPrice)
//      for every supplier's markup, so ÷ 1.2 lands on the supplier's PDF.
//   2. An item with no buy price in Xero comes back null, never 0.
//   3. Only account-202 sales items, sorted by name -- unchanged.
//   4. The screen renders the buy price big and the PDF figure as "ex", and
//      "no buy price" rather than £0.00 when there isn't one.
//   5. + puts the till price on the shopping list, and no price at all for
//      an item without one.
//
// The fixture rows are real, from the 2026-09-15 Xero InventoryItems export.
//
// USAGE
//   node scripts/test-price-lookup.js
//   npm run test:price-lookup

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { priceLookupItems } = require('../routes/xero.js');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const item = (Code, Name, buy, sell, salesAccount = '202') => ({
  Code, Name,
  PurchaseDetails: buy == null ? {} : { UnitPrice: buy, AccountCode: '311' },
  SalesDetails: { UnitPrice: sell, AccountCode: salesAccount }
});
const XERO_ITEMS = [
  item('BM034', 'BM Ultra Spec SX Matte - Colours 3.79ltr', 87.55, 100.68),   // list 72.96, ×1.15
  item('BM036', 'BM Ultra Spec SX Eggshell - Colours 0.95ltr', 32.72, 37.63), // list 27.27
  item('FAR001', 'F&B Estate Emulsion - All Colours 5ltr', 90.00, 99.00),     // ×1.10
  item('DUL001', 'Dulux Diamond Satinwood - PBW 5ltr', 95.99, 115.19),        // list 79.99, ×1.20
  item('BED009', 'Bedec Aqua Advanced Primer UC (White) - 1 ltr', null, 27.89), // no buy price
  item('XXX999', 'Not a sales item', 10, 12, '200')
];

// ── 1–3. The server mapping ────────────────────────────────────────────────
const mapped = priceLookupItems(XERO_ITEMS);
const byCode = Object.fromEntries(mapped.map(i => [i.code, i]));
eq('1. Scuff-X Matte shows the till price, not the sell price', byCode.BM034.price, 87.55);
eq('1. whose ex VAT is the Benjamin Moore price list figure', Math.round(byCode.BM034.price / 1.2 * 100) / 100, 72.96);
eq('1. Scuff-X Eggshell quart ex VAT is the price list figure', Math.round(byCode.BM036.price / 1.2 * 100) / 100, 27.27);
eq('1. a ×1.10 supplier gets its buy price too', byCode.FAR001.price, 90);
eq('1. and a ×1.20 supplier, ex VAT = the Dulux price list', Math.round(byCode.DUL001.price / 1.2 * 100) / 100, 79.99);
eq('2. no buy price in Xero is null, never 0', byCode.BED009.price, null);
eq('3. only account-202 items', mapped.length, 5);
eq('3. sorted by name', mapped.map(i => i.code), ['BED009', 'BM036', 'BM034', 'DUL001', 'FAR001']);

// ── 4–5. The screen ────────────────────────────────────────────────────────
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

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  await page.evaluate((items) => {
    priceLookupItems = items;
    shopList = [];
    goTab('pricelookup');
    document.getElementById('pricelookup-search').value = '';
    filterPriceLookup();
  }, mapped);

  const row = (code) => page.evaluate((c) => {
    const idx = priceLookupMatches.findIndex(i => i.code === c);
    const btn = document.getElementById('pl-add-' + idx);
    return btn ? btn.parentElement.innerText.replace(/\s+/g, ' ').trim() : null;
  }, code);

  const bm = await row('BM034');
  check('4. Scuff-X row shows £87.55 big', /87\.55/.test(bm || ''), bm);
  check('4. and £72.96 ex — the price list figure', /72\.96 ex/.test(bm || ''), bm);
  check('4. and not the sell price anywhere', !/100\.68|83\.90/.test(bm || ''), bm);
  const bed = await row('BED009');
  check('4. no buy price says so', /no buy price/.test(bed || ''), bed);
  check('4. rather than £0.00', !/0\.00/.test(bed || ''), bed);

  await page.evaluate(() => {
    addShopFromLookup(priceLookupMatches.findIndex(i => i.code === 'BM034'));
    addShopFromLookup(priceLookupMatches.findIndex(i => i.code === 'BED009'));
  });
  const list = await page.evaluate(() => shopList.map(i => ({ code: i.code, price: i.price })));
  eq('5. + puts the till price on the shopping list', list.find(i => i.code === 'BM034'), { code: 'BM034', price: 87.55 });
  eq('5. and no price for an item without one', list.find(i => i.code === 'BED009'), { code: 'BED009', price: null });

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
