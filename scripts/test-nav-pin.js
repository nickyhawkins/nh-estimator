#!/usr/bin/env node
'use strict';

// ── Regression test: the bottom bar stays on the bottom edge ───────────────
//
// Reported twice from a phone, most recently with a screenshot of the On Site
// screen: the Home/Measure/On Site/Summary bar rendered roughly half way up
// the screen, with the materials form still scrolling underneath it.
//
// v2.31.1 had already moved the bar from position:sticky to position:fixed,
// which made it independent of --vh and of scroll momentum -- and that cured
// the drift-while-scrolling report. It did not cure this one, because a fixed
// element is pinned to the LAYOUT viewport, and on iOS the layout viewport is
// itself a thing WebKit gets wrong: in a standalone PWA the on-screen
// keyboard resizes it, and WebKit does not reliably resize it back when the
// keyboard goes. The bar is left correctly pinned to the bottom of a viewport
// that no longer matches the screen.
//
// So what is held here is that the bar's position is driven by what is
// VISIBLE (visualViewport), not by what the layout viewport claims:
//
//   1. At rest the bar sits exactly on the visible bottom edge, and is not
//      translated for the sake of it -- zero drift, no transform.
//   2. A layout viewport left short of the real visible area -- the reported
//      bug, in the one form a desktop browser can be made to reproduce -- is
//      corrected: the bar is pushed back down onto the visible bottom edge
//      instead of floating up the screen.
//   3. While the keyboard is up the bar gets out of the way entirely. Riding
//      above the keyboard would park it over the field being typed into.
//   4. Dismissing the keyboard brings it back onto the bottom edge EVEN IF
//      WebKit never restored the viewport -- that is the actual reported
//      sequence, and the one a bar that merely hides would still fail.
//   5. A viewport change too small to be a keyboard (a collapsing browser
//      toolbar) never hides the bar, so a tapped field on desktop, or with a
//      hardware keyboard, doesn't make the navigation vanish.
//   6. Correcting is idempotent: repeated pins settle rather than walking the
//      bar off the screen a gap at a time.
//   7. No visualViewport at all (an older browser) still lands the bar on the
//      bottom edge, and throws nothing on the way.
//   8. Scrolling leaves it on the bottom edge.
//
// The app shell is served straight off disk -- no server, no database, no job
// data -- because none of this depends on any of that. window.visualViewport
// is replaced with a stub before the page's own scripts run, which is what
// lets a desktop Chromium be told the visible area is not the layout
// viewport, the way iOS tells the app exactly that.
//
// USAGE
//   node scripts/test-nav-pin.js
//   npm run test:nav-pin

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

// Static file server over public/ -- enough to boot the shell. Anything the
// app asks the real server for (/api/...) 404s, which is the same thing it
// sees offline and already copes with.
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
const near = (name, got, want, tol) =>
  check(name, Math.abs(got - want) <= (tol === undefined ? 1 : tol), { got, want });

// Replaces window.visualViewport with something the test drives. Mirrors the
// real API's shape: height/offsetTop, addEventListener, and events that fire
// on the object itself.
const STUB = () => {
  const listeners = {};
  // height tracks the real window until a test overrides it, so "no override"
  // is genuinely the honest viewport rather than whatever innerHeight happened
  // to be at document-start, before the emulated phone viewport was applied.
  let over = null;
  const vv = {
    get height() { return over === null ? window.innerHeight : over; },
    get width() { return window.innerWidth; },
    offsetTop: 0,
    offsetLeft: 0,
    pageTop: 0,
    pageLeft: 0,
    scale: 1,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
  };
  window.__vv = {
    set(props) {
      if ('height' in props) { over = props.height; delete props.height; }
      Object.assign(vv, props);
      (listeners.resize || []).forEach(fn => fn({ target: vv }));
      (listeners.scroll || []).forEach(fn => fn({ target: vv }));
    },
    // Drops visualViewport entirely, for the no-support path.
    remove() { Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true }); },
  };
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
};

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.navbar');
  await page.waitForTimeout(1300);   // past the boot re-poll schedule
  // Settings, because the reported screen was a form and the keyboard rules
  // below need a real focusable field on a screen long enough to scroll. With
  // no job data the dashboard the app lands on has neither.
  await page.evaluate(() => goTab('settings'));
  await page.waitForSelector('#s-business-name');
  await page.waitForTimeout(300);

  const H = await page.evaluate(() => window.innerHeight);

  // Where the bar's bottom edge is, and where the visible bottom edge is, in
  // the one coordinate space both are expressed in.
  const bar = () => page.evaluate(() => {
    const n = document.querySelector('.navbar');
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    const vv = window.visualViewport;
    return {
      bottom: r.bottom,
      height: r.height,
      display: cs.display,
      transform: cs.transform,
      hidden: n.classList.contains('nav-kb-hidden'),
      target: vv ? vv.offsetTop + vv.height : window.innerHeight,
    };
  });
  const setVv = (props) => page.evaluate((p) => window.__vv.set(p), props);
  const settle = () => page.waitForTimeout(750);   // past pinNavSoon's 600ms tail

  // ── 1. At rest ───────────────────────────────────────────────────────────
  let b = await bar();
  near('1. at rest the bar sits on the visible bottom edge', b.bottom, H);
  check('1. at rest the bar is not translated', b.transform === 'none' || b.transform === 'matrix(1, 0, 0, 1, 0, 0)', b.transform);
  check('1. at rest the bar is visible', b.display !== 'none' && b.height > 0, b);

  // ── 2. A layout viewport left short of the visible area ──────────────────
  // The reported bug: bottom:0 lands 300px above what the user can see.
  await setVv({ height: H + 300 });
  await settle();
  b = await bar();
  near('2. a stale short layout viewport is corrected, not obeyed', b.bottom, H + 300);
  check('2. the correction is a translate on the bar', /matrix\(1, 0, 0, 1, 0, (29\d|300)/.test(b.transform), b.transform);
  await setVv({ height: H });
  await settle();
  near('2. and it lets go again when the viewport comes back', (await bar()).bottom, H);

  // ── 3. Keyboard up ───────────────────────────────────────────────────────
  // Focus first, then shrink: that is the order the events arrive in on a
  // phone, and the rule only reads as a keyboard when a field has focus.
  const focusField = () => page.evaluate(() => {
    const el = document.getElementById('s-business-name');
    el.focus();
    return document.activeElement === el;
  });
  check('3. the test actually focused a field', await focusField());
  await setVv({ height: H - 340 });          // ~an iPhone keyboard
  await settle();
  b = await bar();
  check('3. the bar hides while the keyboard is up', b.hidden && b.display === 'none', b);

  // ── 4. Keyboard dismissed onto a viewport WebKit never restored ──────────
  // The actual reported sequence. The bar coming back is not enough: it has
  // to come back in the right place.
  await page.evaluate(() => document.activeElement.blur());
  await setVv({ height: H + 300 });
  await settle();
  b = await bar();
  check('4. the bar comes back after the keyboard', !b.hidden && b.display !== 'none', b);
  near('4. and lands on the bottom edge, not where WebKit left it', b.bottom, H + 300);
  await setVv({ height: H });
  await settle();

  // ── 5. A change too small to be a keyboard ───────────────────────────────
  check('5. the test actually focused a field', await focusField());
  await setVv({ height: H - 60 });           // a collapsing browser toolbar
  await settle();
  b = await bar();
  check('5. a 60px viewport change never hides the bar', !b.hidden && b.display !== 'none', b);
  await page.evaluate(() => document.activeElement.blur());
  await setVv({ height: H });
  await settle();

  // ── 6. Idempotent ────────────────────────────────────────────────────────
  await setVv({ height: H + 120 });
  await settle();
  const once = (await bar()).bottom;
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.pinNav && window.pinNav(); });
  const many = (await bar()).bottom;
  near('6. twenty pins in a row settle where one did', many, once, 0.5);
  near('6. and that is still the visible bottom edge', many, H + 120);
  await setVv({ height: H });
  await settle();

  // ── 8. Scrolled ──────────────────────────────────────────────────────────
  // (7 is last, since it takes visualViewport away for good.)
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(400);
  near('8. scrolled 400px down, the bar is still on the bottom edge', (await bar()).bottom, H);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // ── 7. No visualViewport ─────────────────────────────────────────────────
  const threw = await page.evaluate(() => {
    window.__vv.remove();
    if (typeof window.pinNav !== 'function') return 'pinNav() is missing';
    try { window.pinNav(); return null; } catch (e) { return e.message; }
  });
  check('7. no visualViewport: pinNav throws nothing', threw === null, threw);
  near('7. no visualViewport: the bar is still on the bottom edge', (await bar()).bottom, H);

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
