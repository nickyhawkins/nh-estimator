#!/usr/bin/env node
'use strict';

// ── Regression test: the Xero quote's own total, and contact updates ───────
//
// Two things Nicky reported on 2026-09-01, both in routes/xero.js:
//
//   1. "Xero roundup adds an extra penny to the total on a quote." The app
//      quotes a deliberate, clean figure (roundUpToStep, £5 steps) and the
//      Xero document came out at that figure PLUS a penny. The cause was the
//      spread target: the client sent labourSpreadTarget, derived from the
//      labour figures alone, and the server then added sundries, custom and
//      materials lines that each round to the penny in their OWN right. Sum
//      of rounded is not rounded of sum, so the document drifted -- and on a
//      spray job or a fixed-£ markup it drifted further, because the server
//      derived the sundries amount and the markup multiplier slightly
//      differently from the app that had already quoted the client.
//
//      The fix: the client sends the clean grand total, and the labour lines
//      are made to carry TOTAL MINUS EVERYTHING ELSE ON THE DOCUMENT -- the
//      same subtraction buildClientQuoteModel() does for the app's own copy.
//      That is the property swept exhaustively below: however the other
//      lines round, the document adds up to the quoted total EXACTLY.
//
//   2. "Contacts can't be updated. Gives error that contact name already
//      exists." Xero's API splits its verbs -- PUT only ever creates, POST
//      creates or updates -- so pushing an edit through PUT asked Xero for a
//      SECOND contact with the same name, and it refused the lot with
//      "Contact Name must be unique across all active contacts". Asserted
//      here at the level the bug lived at: which verb and URL a payload
//      carrying a ContactID is written with.
//
// Runs the REAL server code against a faithful mirror of the client's own
// money model (computeDepositPlan in public/index.html). The two functions
// are extracted out of routes/xero.js by name and run in a vm -- the same
// shape as test-scope-text.js and test-material-split.js -- rather than
// require()d, so the test needs no node_modules, no database, no browser and
// no Xero connection.
//
// USAGE
//   node scripts/test-quote-total.js
//   npm run test:quote-total

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Extraction ─────────────────────────────────────────────────────────────
// Brace-matched, so a nested function or object literal can't end the slice
// early (same helper as test-material-split.js).
function sliceBalanced(src, startIdx, open, close) {
  const from = src.indexOf(open, startIdx);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('unbalanced ' + open + close + ' from index ' + startIdx);
}
function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('routes/xero.js no longer defines ' + name + '()');
  return sliceBalanced(src, at, '{', '}');
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'xero.js'), 'utf8');
const sandbox = { module: {}, XERO_API_URL: 'https://api.xero.com/api.xro/2.0' };
vm.createContext(sandbox);
vm.runInContext(
  extractFn(SRC, 'buildQuoteLineItems') + '\n' +
  extractFn(SRC, 'contactWriteRequest') + '\n' +
  'module.exports = { buildQuoteLineItems, contactWriteRequest };',
  sandbox);
const buildQuoteLineItems = sandbox.module.exports.buildQuoteLineItems;
const contactWriteRequest = sandbox.module.exports.contactWriteRequest;

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

const money = (n) => Math.round(n * 100) / 100;

// What Xero itself will total the document to: LineAmount = Quantity x
// UnitAmount to the penny, and a description-only divider row carries none.
const docTotal = (lines) => money(lines.reduce((sum, l) =>
  sum + (l.UnitAmount == null ? 0 : money((l.Quantity == null ? 1 : +l.Quantity) * +l.UnitAmount)), 0));

// ── The client's money model, mirrored ─────────────────────────────────────
// computeDepositPlan() + QUOTE_ROUNDING_STEP out of public/index.html, cut
// down to the figures that reach the Xero payload. Kept deliberately literal
// so a change to the app's pricing order shows up here as a failure rather
// than being quietly absorbed.
const QUOTE_ROUNDING_STEP = 5;
const roundUpToStep = (n, step) => Math.ceil(((+n || 0) / step) - 1e-9) * step;

function clientQuote(f) {
  const roomTotal = f.rooms.reduce((s, r) => s + r.total, 0);
  const extTotal = f.exterior.reduce((s, e) => s + e.total, 0);
  const fuTotal = f.fittedUnits.reduce((s, u) => s + u.total, 0);
  const tcS = roomTotal + extTotal + f.kitchen + fuTotal;

  const customMarked = f.custom.reduce((s, c) => s + (c.applyMarkup === false ? 0 : c.quantity * c.unitPrice), 0);
  const customFlat = f.custom.reduce((s, c) => s + (c.applyMarkup === false ? c.quantity * c.unitPrice : 0), 0);
  const materialsTotal = f.materials.reduce((s, m) => s + m.quantity * m.unitAmount, 0);

  // Sundries: a % of raw labour, PLUS the spray-masking % on the
  // spray-toggled rooms' labour only.
  const sundries = tcS * (f.sundriesPct / 100) + f.sprayLabour * (f.sundriesSprayPct / 100);

  // applyMarkupAmount(): commercial% first, then markup/discount on top --
  // a fixed-£ markup expressed as a ratio of the post-commercial base.
  const commercialMult = 1 + (f.commercial ? f.commercialPct / 100 : 0);
  const base = tcS + f.standaloneTopUp + sundries + customMarked;
  const afterCommercial = base * commercialMult;
  const ratio = f.markupType === 'fixed'
    ? (afterCommercial > 0 ? f.markup / afterCommercial : 0)
    : f.markup / 100;
  const labourTotal = afterCommercial * (1 + ratio);
  const lineMult = base > 0 ? labourTotal / base : 1;

  const rawTotal = labourTotal + customFlat + materialsTotal;
  const total = tcS > 0.005 ? roundUpToStep(rawTotal, QUOTE_ROUNDING_STEP) : rawTotal;
  const roundingDelta = money(total - rawTotal);
  const adjustmentPool = f.standaloneTopUp * lineMult + roundingDelta;

  return { tcS, sundries, lineMult, total, adjustmentPool };
}

// The payload createXeroQuote() posts, for a given fixture.
function payloadFor(f, opts) {
  const plan = clientQuote(f);
  const body = {
    rooms: f.rooms.map(r => ({ name: r.name, total: r.total })),
    exterior: { cost: f.exterior.reduce((s, e) => s + e.total, 0), items: f.exterior },
    kitchen: { cost: f.kitchen },
    fittedUnit: { cost: f.fittedUnits.reduce((s, u) => s + u.total, 0), items: f.fittedUnits },
    custom: { items: f.custom },
    materials: f.materials,
    settings: { sundriesPct: f.sundriesPct },
    markup: f.markup,
    markupType: f.markupType,
    commercial: f.commercial,
    commercialPct: f.commercialPct,
    standalone: f.standaloneTopUp > 0,
    standaloneTopUp: f.standaloneTopUp,
    standaloneCalcDays: f.standaloneTopUp > 0 ? 1.6 : 0,
    standaloneDiaryDays: f.standaloneTopUp > 0 ? 2 : 0,
    labourSpreadTarget: money(plan.tcS * plan.lineMult + plan.adjustmentPool),
    labourAdjustment: money(plan.adjustmentPool)
  };
  // The fields a current client sends. Left off to exercise the older-client
  // (cached PWA) fallback path, which is what the app used to do.
  if (!(opts && opts.legacyClient)) {
    body.quoteTotal = money(plan.total);
    body.lineMult = plan.lineMult;
    body.sundriesTotal = plan.sundries;
  }
  return { body, plan };
}

// ── Fixtures ───────────────────────────────────────────────────────────────
function fixture(over) {
  return Object.assign({
    rooms: [], exterior: [], kitchen: 0, fittedUnits: [], custom: [], materials: [],
    sundriesPct: 0, sundriesSprayPct: 0, sprayLabour: 0,
    markup: 0, markupType: 'percent', commercial: false, commercialPct: 10,
    standaloneTopUp: 0
  }, over);
}

// The shape of the job the penny was reported on: several rooms, a sundries
// %, real materials, and a clean-£5 round-up on top.
const REPORTED = fixture({
  rooms: [
    { name: 'Lounge', total: 1094.69 },
    { name: 'Hall, Stairs & Landing', total: 1370.64 },
    { name: 'Master Bedroom', total: 853.15 },
    { name: 'Bedroom 2', total: 1009.67 }
  ],
  materials: [
    { itemCode: 'DUL-VM-5', description: 'Vinyl Matt 5ltr', quantity: 3, unitAmount: 42.31 },
    { itemCode: 'DUL-DG-2.5', description: 'Diamond Eggshell 2.5ltr', quantity: 2, unitAmount: 38.77 }
  ],
  sundriesPct: 7,
  markup: 12
});

// Spray job: the sundries the client charges include a spray-masking % the
// server can't see, so its own derivation is short of the app's.
const SPRAY = fixture({
  rooms: [{ name: 'Kitchen/Diner', total: 980.5 }, { name: 'Utility', total: 312.25 }],
  kitchen: 1450,
  materials: [{ itemCode: 'TIK-2.5', description: 'Satin 2.5ltr', quantity: 4, unitAmount: 31.99 }],
  sundriesPct: 7, sundriesSprayPct: 9, sprayLabour: 1450,
  markup: 10
});

// Fixed-£ markup: the server's ratio base leaves the sundries out, the
// client's puts them in, so the two multipliers differ.
const FIXED_MARKUP = fixture({
  rooms: [{ name: 'Bedroom 1', total: 430.66 }, { name: 'Bedroom 2', total: 398.12 }],
  custom: [{ description: 'Scaffold tower hire', quantity: 3, unitPrice: 45, applyMarkup: false }],
  materials: [{ itemCode: 'M1', description: 'Undercoat 5ltr', quantity: 1, unitAmount: 54.5 }],
  sundriesPct: 6,
  markup: 250, markupType: 'fixed'
});

// Standalone diary-day rounding + commercial% + a marked-up custom line: the
// adjustment pool and every multiplier in play at once.
const EVERYTHING = fixture({
  rooms: [{ name: 'Office', total: 655.4 }],
  exterior: [{ label: 'Fascias & soffits', total: 480.15 }, { label: 'Front door', total: 0 }],
  fittedUnits: [{ name: 'Alcove shelving', total: 265.8 }],
  custom: [
    { description: 'Wallpaper hanging', quantity: 2.5, unitPrice: 88, applyMarkup: true },
    { description: 'Skip hire', quantity: 1, unitPrice: 220, applyMarkup: false }
  ],
  materials: [{ itemCode: 'M2', description: 'Masonry paint 10ltr', quantity: 1.5, unitAmount: 67.83 }],
  sundriesPct: 7, sundriesSprayPct: 9, sprayLabour: 265.8,
  markup: 15, commercial: true, commercialPct: 12,
  standaloneTopUp: 186.4
});

// Materials-only job: no labour to round onto, so the app quotes the exact
// figure and the document must not grow one.
const MATERIALS_ONLY = fixture({
  materials: [{ itemCode: 'M3', description: 'Trade emulsion 10ltr', quantity: 2, unitAmount: 48.6 }]
});

const NAMED = [
  ['reported job (rooms + sundries + materials + £5 round-up)', REPORTED],
  ['spray job (sundries carry a spray-masking % the server cannot derive)', SPRAY],
  ['fixed-£ markup (client and server derive different ratios)', FIXED_MARKUP],
  ['standalone + commercial% + custom lines + fitted unit', EVERYTHING],
  ['materials-only job (nothing to round)', MATERIALS_ONLY]
];

// ── 1. The document totals the app's own quoted figure, exactly ────────────
NAMED.forEach(([name, f]) => {
  const { body, plan } = payloadFor(f);
  const lines = buildQuoteLineItems(body);
  eq('total is exactly as quoted — ' + name, docTotal(lines), money(plan.total));
});

// ── 2. The reported symptom, pinned as a regression ───────────────────────
// The old target (labour figures only) is still in the payload, so the drift
// the bug rested on can be measured directly rather than described: the
// document used to come out ABOVE the clean figure. If this ever stops
// drifting the fixture has drifted, not the bug.
{
  const { body, plan } = payloadFor(REPORTED, { legacyClient: true });
  const oldTotal = docTotal(buildQuoteLineItems(body));
  check('the old labour-only target really did miss the quoted total',
    oldTotal !== money(plan.total),
    'old total ' + oldTotal.toFixed(2) + ' vs quoted ' + money(plan.total).toFixed(2));
  check('...and it missed it by a penny, upwards, exactly as reported',
    money(oldTotal - plan.total) === 0.01,
    'drift ' + money(oldTotal - plan.total).toFixed(2));
}

// ── 3. The spray-sundries gap is closed, not just the penny ───────────────
{
  const { body, plan } = payloadFor(SPRAY, { legacyClient: true });
  const oldTotal = docTotal(buildQuoteLineItems(body));
  check('a spray job used to bill UNDER the quoted total',
    oldTotal < money(plan.total) - 0.5,
    'old total ' + oldTotal.toFixed(2) + ' vs quoted ' + money(plan.total).toFixed(2));
  const now = docTotal(buildQuoteLineItems(payloadFor(SPRAY).body));
  eq('...and now bills exactly it', now, money(plan.total));
}

// ── 4. Nothing lands on a line the client can check ───────────────────────
// The spread may only move the engine-priced labour lines. Materials keep
// their real Xero sell price, custom lines the price that was typed, and the
// sundries line the app's own figure -- a client who checks any of those
// against the app must find the same number.
{
  const { body, plan } = payloadFor(EVERYTHING);
  const lines = buildQuoteLineItems(body);
  const mat = lines.find(l => l.ItemCode === 'M2');
  eq('materials keep their Xero sell price', mat.UnitAmount, 67.83);
  eq('materials keep their quantity', mat.Quantity, 1.5);
  const flat = lines.find(l => l.Description === 'Skip hire');
  eq('a markup-off custom line goes out exactly as entered', flat.UnitAmount, 220);
  const sund = lines.find(l => l.Description === 'Sundries & Consumables');
  eq('the sundries line is the app\'s own figure', sund.UnitAmount, money(plan.sundries * plan.lineMult));
  check('a zero-total exterior item gets no line at all',
    !lines.some(l => l.Description === 'Front door'));
}

// ── 5. The older-client fallback still works ─────────────────────────────
// A phone running a cached PWA sends no quoteTotal. It must still get the
// document it always got: labour lines summing to labourSpreadTarget.
{
  const { body } = payloadFor(EVERYTHING, { legacyClient: true });
  const lines = buildQuoteLineItems(body);
  const labour = lines.filter(l => l.AccountCode === '201' && l.Description !== 'Wallpaper hanging' && l.Description !== 'Skip hire');
  eq('an older client still spreads onto its own target',
    money(labour.reduce((s, l) => s + l.UnitAmount, 0)), body.labourSpreadTarget);
}

// ── 6. Swept exhaustively ────────────────────────────────────────────────
// The property is what matters, not the five fixtures above: whatever the
// mix of rooms, materials, custom lines, markup mode, commercial%, spray
// sundries and standalone top-up, the Xero document adds up to the figure
// the app quoted. A pseudo-random sweep with a fixed seed, so a failure is
// reproducible.
{
  let seed = 20260901;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  let worst = 0, worstCase = null;
  for (let i = 0; i < 4000; i++) {
    const rooms = [];
    for (let r = 0, n = 1 + Math.floor(rnd() * 5); r < n; r++) rooms.push({ name: 'Room ' + r, total: pick(40, 1600) });
    const materials = [];
    for (let m = 0, n = Math.floor(rnd() * 4); m < n; m++) {
      materials.push({ itemCode: 'M' + m, description: 'Paint ' + m, quantity: 1 + Math.floor(rnd() * 4), unitAmount: pick(9, 90) });
    }
    const custom = [];
    for (let c = 0, n = Math.floor(rnd() * 3); c < n; c++) {
      custom.push({ description: 'Custom ' + c, quantity: rnd() < 0.4 ? pick(1.5, 4) : 1, unitPrice: pick(20, 400), applyMarkup: rnd() < 0.5 });
    }
    const sprayLabour = rnd() < 0.4 ? pick(100, 900) : 0;
    const f = fixture({
      rooms, materials, custom,
      exterior: rnd() < 0.4 ? [{ label: 'Exterior', total: pick(100, 2000) }] : [],
      kitchen: rnd() < 0.3 ? pick(400, 3000) : 0,
      fittedUnits: rnd() < 0.3 ? [{ name: 'Unit', total: pick(100, 700) }] : [],
      sundriesPct: rnd() < 0.8 ? 7 : 0,
      sundriesSprayPct: sprayLabour > 0 ? 9 : 0,
      sprayLabour,
      markup: rnd() < 0.5 ? pick(-10, 25) : pick(-300, 800),
      markupType: rnd() < 0.5 ? 'percent' : 'fixed',
      commercial: rnd() < 0.3, commercialPct: 12,
      standaloneTopUp: rnd() < 0.3 ? pick(30, 400) : 0
    });
    // A fixed-£ markup and a percentage aren't interchangeable numbers; keep
    // the sweep to plausible ones for each mode.
    if (f.markupType === 'percent' && Math.abs(f.markup) > 40) f.markup = 15;
    const { body, plan } = payloadFor(f);
    const drift = Math.abs(docTotal(buildQuoteLineItems(body)) - money(plan.total));
    if (drift > worst) { worst = drift; worstCase = JSON.stringify(f).slice(0, 400); }
  }
  check('4,000 random jobs all total exactly as quoted', worst === 0,
    'worst drift £' + worst.toFixed(2) + '\n      ' + worstCase);
}

// ── 7. Contacts: an update is written as an update ───────────────────────
{
  const create = contactWriteRequest({ Name: 'Jane Smith' });
  eq('a new contact is created with PUT', create.method, 'put');
  check('...at the collection URL', /\/Contacts$/.test(create.url), create.url);

  const id = '3f7a2b10-0000-4a2b-9c1d-abcdef123456';
  const update = contactWriteRequest({ ContactID: id, Name: 'Jane Smith' });
  // The regression itself: PUT here made Xero try to CREATE a second Jane
  // Smith and reject the call with "Contact Name must be unique across all
  // active contacts", which is what the app showed for every contact edit.
  eq('an existing contact is updated with POST, not PUT', update.method, 'post');
  check('...at that contact\'s own URL', update.url.endsWith('/Contacts/' + id), update.url);
}

// ── Report ────────────────────────────────────────────────────────────────
console.log('\n  Xero quote total & contact writes\n');
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log('\n  ' + pass.length + ' passed, ' + fail.length + ' failed\n');
process.exit(fail.length ? 1 : 0);
