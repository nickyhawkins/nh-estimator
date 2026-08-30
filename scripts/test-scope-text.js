#!/usr/bin/env node
'use strict';

// ── Regression test: the measured-scope sentence ({surfaces}, {papered}) ────
//
// The scope sentence in a quote/invoice used to be hardcoded prose naming
// ceilings, walls and woodwork whatever the job actually was. It is now
// built from the live rooms, so this test exists to hold two things still:
//
//   1. THE NO-MOVEMENT PROPERTY. A room with walls, ceiling and woodwork all
//      measured must render the seeded sentence back character for
//      character, in BOTH tenses. Nicky's client-facing wording is not
//      allowed to drift because the mechanism behind it changed; detail may
//      only appear where something extra was actually measured.
//   2. That a surface appears if and only if calcRoom would price it --
//      windows and sills need woodwork coats, a painted feature wall needs
//      wall coats, a papered one is not painted at all.
//
// Pure node against the real source: the functions are extracted out of
// public/index.html by name and evaluated with stubs, the same shape as the
// renderer harness described in TEXT_TEMPLATES_SPEC.md. No database, no
// browser, no server.
//
// USAGE
//   node scripts/test-scope-text.js
//   npm run test:scope

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Extraction ─────────────────────────────────────────────────────────────
// Brace-matched so a nested function or object literal can't end the slice
// early. Deliberately naive about braces inside strings: none of the
// extracted declarations contain one, and a future edit that adds one will
// fail loudly here rather than silently test the wrong source.
function sliceBalanced(src, startIdx, open, close) {
  const from = src.indexOf(open, startIdx);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('unbalanced ' + open + ' from index ' + startIdx);
}

function extractFn(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '{', '}');
}

function extractVar(name) {
  const at = SRC.indexOf('\nvar ' + name + ' = ');
  if (at < 0) throw new Error('var ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '[', ']') + ';';
}

// ── Sandbox ────────────────────────────────────────────────────────────────
// effectiveRoleRange is the calc engine's, reproduced here as the two-line
// fallback chain it actually is (own override → the wall product for a
// feature wall → the Settings default for the role). Everything else the
// extracted functions touch is passed in.
// NOTE the roles present here: Settings carries a job-wide default for
// wall/ceiling/topcoat/primer/mist/masonry/extTopcoat/extPrimer and NOT for
// panel or featurewall -- those two are per-room pickers only (the room
// form says "no default -- choose explicitly" over the panelling one), and
// a feature wall with no product of its own falls back to the room's wall
// product. Adding a panel default here would make the fixture able to test
// a state the app cannot reach.
const sandbox = `
  var settings = { materials: {
    wall:    { range: 'Tikkurila Optiva 5' },
    ceiling: { range: 'Tikkurila Anti Reflex 2' },
    topcoat: { range: 'Tikkurila Helmi 30' },
    masonry: { range: 'Dulux Weathershield' },
    extTopcoat: { range: 'Weathershield Gloss' }
  } };
  function effectiveRoleRange(r, role) {
    var override = r[role + 'RangeOverride'];
    if (override) return override;
    if (role === 'featurewall') return r.wallRangeOverride || (settings.materials.wall || {}).range || '';
    return (settings.materials[role] || {}).range || '';
  }
  // The globals buildTemplateValues reads, so the product resolution can be
  // driven for real rather than hand-fed a values object.
  // Calc-engine helpers extScopeFacts reads, reproduced as they are.
  function extWindowQty(w) { return Math.max(1, +w.qty || 1); }
  function extWindowCount(list) { return list.reduce(function(s, w) { return s + extWindowQty(w); }, 0); }
  function legacyWindowList(qty) { return (+qty || 0) > 0 ? [{ panes: 2, qty: +qty }] : []; }
  var rooms = [], extItems = [], labourLog = [];
  function activeJob() { return JOB; }
  var JOB = { name: 'Test Job' };
  function fittedUnitList(job) { return (job && job.fittedUnits) || []; }
`;

const api = {};
new Function('exports', sandbox + [
  extractFn('englishJoin'),
  extractFn('scopeFacts'),
  extractFn('buildScopeSentence'),
  extractFn('buildPaperedPhrase'),
  extractFn('scopeProductValues'),
  extractFn('roomScopeSentence'),
  extractFn('roomScopeShort'),
  extractFn('extScopeFacts'),
  extractFn('buildExtScopeSentence'),
  extractFn('extItemScopeSentence'),
  extractFn('extScopeShort'),
  extractFn('fuScopeFacts'),
  extractFn('buildFuScopeSentence'),
  extractFn('renderTemplateText'),
  extractFn('formatLongDate'),
  extractFn('buildTemplateValues'),
  extractVar('LONG_MONTHS'),
  extractVar('DEFAULT_TEXT_TEMPLATES'),
  'exports.buildScopeSentence = buildScopeSentence;',
  'exports.buildPaperedPhrase = buildPaperedPhrase;',
  'exports.renderTemplateText = renderTemplateText;',
  'exports.scopeFacts = scopeFacts;',
  'exports.DEFAULT_TEXT_TEMPLATES = DEFAULT_TEXT_TEMPLATES;',
  'exports.roomScopeSentence = roomScopeSentence;',
  'exports.roomScopeShort = roomScopeShort;',
  'exports.buildExtScopeSentence = buildExtScopeSentence;',
  'exports.extItemScopeSentence = extItemScopeSentence;',
  'exports.extScopeShort = extScopeShort;',
  'exports.buildFuScopeSentence = buildFuScopeSentence;',
  'exports.scopeProductValues = scopeProductValues;',
  // Drives the REAL product resolution: set the room list, get the values
  // object a render would actually be given.
  'exports.valuesFor = function(mode, rs, xs, job) { rooms = rs || []; extItems = xs || []; JOB = job || { name: "Test Job" }; return buildTemplateValues(mode); };'
].join('\n'))(api);

// An exterior item measured the ordinary way: render, fascias, windows and
// a front door, all at the coats calcExtItem defaults to.
const EXT_PRODUCTS = { masonryProduct: 'Dulux Weathershield', extWoodProduct: 'Weathershield Gloss' };
const EXT_FULL = { label: 'Front Elevation', masonry: 60, fascia: 12,
                   windows: [{ qty: 4 }], doorQty: 1 };
// A fitted unit measured the ordinary way: bays, shelves and doors, bare.
const FU_FULL = { bayCount: 3, shelfCount: 9, doorCount: 4, prepLevel: 'bare' };

const PRODUCTS = {
  wallProduct: 'Tikkurila Optiva 5',
  ceilingProduct: 'Tikkurila Anti Reflex 2',
  woodProduct: 'Tikkurila Helmi 30'
};
const scope = (mode, rooms) => api.buildScopeSentence(mode, rooms, PRODUCTS);

// A room measured the ordinary way: walls, ceiling and woodwork at 2 coats,
// with the doors and frames the seeded sentence has always claimed.
const FULL = { name: 'Living Room', wc: 2, cc: 2, xc: 2, doorQty: 2, doorCoats: 2, frameQty: 2, frameCoats: 2 };

// ── 1. The no-movement property ────────────────────────────────────────────
// These two strings are the seeded wording, pasted from the template bodies
// as they stood before {surfaces} existed. They are the contract.
eq('full room, quote — seeded wording reproduced exactly',
  scope('quote', [FULL]),
  'Ceilings finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5, and all woodwork including skirtings, door frames and doors in Tikkurila Helmi 30, each applied in 2 coats.');
eq('full room, invoice — seeded wording reproduced exactly',
  scope('invoice', [FULL]),
  'Ceiling finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5, woodwork including skirtings, door frames and doors in Tikkurila Helmi 30, 2 coats throughout.');

// ── 2. Only what was measured ──────────────────────────────────────────────
eq('walls only — no ceiling, no woodwork promised',
  scope('quote', [{ name: 'Hall', wc: 2 }]),
  'Walls in Tikkurila Optiva 5, applied in 2 coats.');
eq('walls only, invoice tense',
  scope('invoice', [{ name: 'Hall', wc: 2 }]),
  'Walls in Tikkurila Optiva 5, 2 coats throughout.');
eq('ceiling only',
  scope('quote', [{ name: 'Hall', cc: 2 }]),
  'Ceilings finished in Tikkurila Anti Reflex 2, applied in 2 coats.');
eq('walls and ceiling, no woodwork — two parts joined with a bare "and"',
  scope('quote', [{ name: 'Hall', wc: 2, cc: 2 }]),
  'Ceilings finished in Tikkurila Anti Reflex 2 and walls in Tikkurila Optiva 5, each applied in 2 coats.');
eq('nothing measured — empty, never a literal token',
  scope('quote', [{ name: 'Hall' }]), '');
eq('no rooms at all — empty',
  scope('quote', []), '');

// ── 3. Woodwork names only the pieces that were counted ────────────────────
eq('woodwork with no doors or frames counted',
  scope('quote', [{ name: 'Hall', xc: 2 }]),
  'All woodwork including skirtings in Tikkurila Helmi 30, applied in 2 coats.');
eq('doors counted, frames not',
  scope('quote', [{ name: 'Hall', xc: 2, doorQty: 3, doorCoats: 2 }]),
  'All woodwork including skirtings and doors in Tikkurila Helmi 30, applied in 2 coats.');
eq('doors with zero coats are not painted, so not claimed',
  scope('quote', [{ name: 'Hall', xc: 2, doorQty: 3, doorCoats: 0 }]),
  'All woodwork including skirtings in Tikkurila Helmi 30, applied in 2 coats.');
eq('doors and frames but no skirting coats — no "all woodwork" umbrella',
  scope('quote', [{ name: 'Hall', doorQty: 2, doorCoats: 2, frameQty: 2, frameCoats: 2 }]),
  'Door frames and doors in Tikkurila Helmi 30, applied in 2 coats.');

// ── 4. The extras that were never mentioned before ─────────────────────────
eq('radiators, windows and sills join the woodwork list',
  scope('quote', [{ name: 'Hall', xc: 2, win: 3.2, sills: 4, rads: 2 }]),
  'All woodwork including skirtings, window frames, window sills and radiators in Tikkurila Helmi 30, applied in 2 coats.');
eq('windows and sills need woodwork coats — calcRoom gates them, so this does too',
  scope('quote', [{ name: 'Hall', wc: 2, win: 3.2, sills: 4 }]),
  'Walls in Tikkurila Optiva 5, applied in 2 coats.');
eq('radiators alone, no woodwork coats — still painted, still mentioned',
  scope('quote', [{ name: 'Hall', wc: 2, rads: 3 }]),
  'Walls in Tikkurila Optiva 5 and radiators in Tikkurila Helmi 30, each applied in 2 coats.');
eq('painted feature wall in the wall product — named, not re-priced with a repeat product',
  scope('quote', [{ name: 'Lounge', wc: 2, featureWallArea: 8.4 }]),
  'Walls in Tikkurila Optiva 5 and the feature wall, each applied in 2 coats.');
eq('painted feature wall in its own product — that product named',
  scope('quote', [{ name: 'Lounge', wc: 2, featureWallArea: 8.4, featurewallRangeOverride: 'Farrow & Ball Estate' }]),
  'Walls in Tikkurila Optiva 5 and the feature wall in Farrow & Ball Estate, each applied in 2 coats.');
eq('papered feature wall is not painted — absent from the painted scope',
  scope('quote', [{ name: 'Lounge', wc: 2, cc: 2, featureWallArea: 8.4, featureWallMode: 'wallpaper' }]),
  'Ceilings finished in Tikkurila Anti Reflex 2 and remaining walls in Tikkurila Optiva 5, each applied in 2 coats.');
eq('feature wall with no wall coats is not priced, so not claimed',
  scope('quote', [{ name: 'Lounge', cc: 2, featureWallArea: 8.4 }]),
  'Ceilings finished in Tikkurila Anti Reflex 2, applied in 2 coats.');
// Panelling is normally a DIFFERENT paint from the rest of the woodwork,
// which is the whole reason it has its own per-room product picker. All
// three states it can be in:
const PANEL = [{ width: 3, height: 1.2, coats: 2 }];
eq('panelling in a product of its own — that product named',
  scope('quote', [{ name: 'Hall', wc: 2, xc: 2, panelItems: PANEL, panelRangeOverride: 'Little Greene Intelligent Eggshell' }]),
  'Walls in Tikkurila Optiva 5, wall panelling in Little Greene Intelligent Eggshell, and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');
eq('panelling deliberately set to the same paint as the woodwork — not named twice',
  scope('quote', [{ name: 'Hall', wc: 2, xc: 2, panelItems: PANEL, panelRangeOverride: 'Tikkurila Helmi 30' }]),
  'Walls in Tikkurila Optiva 5, wall panelling, and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');
eq('panelling with no product chosen — mentioned, but claims no paint (there is no Settings default for panel)',
  scope('quote', [{ name: 'Hall', wc: 2, xc: 2, panelItems: PANEL }]),
  'Walls in Tikkurila Optiva 5, wall panelling, and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');
eq('panelling in its own paint on a job with no other woodwork',
  scope('invoice', [{ name: 'Hall', wc: 2, panelItems: PANEL, panelRangeOverride: 'Little Greene Intelligent Eggshell' }]),
  'Walls in Tikkurila Optiva 5, wall panelling in Little Greene Intelligent Eggshell, 2 coats throughout.');
eq('papered feature wall makes the painted walls the "remaining" ones',
  scope('quote', [{ name: 'Lounge', wc: 2, featureWallArea: 8.4, featureWallMode: 'wallpaper' }]),
  'Remaining walls in Tikkurila Optiva 5, applied in 2 coats.');
eq('panelling with no coats is not priced, so not claimed',
  scope('quote', [{ name: 'Hall', wc: 2, panelItems: [{ width: 3, height: 1.2, coats: 0 }] }]),
  'Walls in Tikkurila Optiva 5, applied in 2 coats.');
eq('mist coat on new plaster, quote tense',
  scope('quote', [{ name: 'Hall', wc: 2, mistWall: true }]),
  'Walls in Tikkurila Optiva 5, applied in 2 coats. Newly plastered walls will be mist coated prior to finishing.');
// Invoice tense joins with plain commas and never an "and" -- that is the
// seeded invoice line's own punctuation, held still by the tests above.
eq('mist coat on walls and ceilings, invoice tense',
  scope('invoice', [{ name: 'Hall', wc: 2, cc: 2, mistWall: true, mistCeil: true }]),
  'Ceiling finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5, 2 coats throughout. Newly plastered walls and ceilings were mist coated prior to finishing.');

// ── 5. Coats ───────────────────────────────────────────────────────────────
eq('coats disagree across surfaces — no figure stated rather than a wrong one',
  scope('quote', [{ name: 'Hall', wc: 2, cc: 3 }]),
  'Ceilings finished in Tikkurila Anti Reflex 2 and walls in Tikkurila Optiva 5.');
eq('coats agree across rooms — one figure',
  scope('quote', [{ name: 'Hall', wc: 3 }, { name: 'Landing', wc: 3 }]),
  'Walls in Tikkurila Optiva 5, applied in 3 coats.');

// ── 5b. Every paint a surface uses, not the first room's ───────────────────
// Driven through the real buildTemplateValues, so this covers the
// resolution itself and not just the sentence that reads it.
const vf = (mode, rs) => api.valuesFor(mode, rs);
const sentenceFor = (mode, rs) => vf(mode, rs).surfaces;

eq('two wall paints across rooms — both named, bound to the walls',
  sentenceFor('quote', [
    { name: 'Lounge', wc: 2, wallRangeOverride: 'Tikkurila Optiva 5' },
    { name: 'Hall',   wc: 2, wallRangeOverride: 'Dulux Diamond Matt' }
  ]),
  'Walls in Tikkurila Optiva 5 and Dulux Diamond Matt, applied in 2 coats.');
eq('one room overridden, the rest on the Settings default — still two paints',
  sentenceFor('quote', [
    { name: 'Lounge', wc: 2, wallRangeOverride: 'Dulux Diamond Matt' },
    { name: 'Hall',   wc: 2 }
  ]),
  'Walls in Dulux Diamond Matt and Tikkurila Optiva 5, applied in 2 coats.');
eq('three wall paints — all three named',
  sentenceFor('quote', [
    { name: 'A', wc: 2, wallRangeOverride: 'P1' },
    { name: 'B', wc: 2, wallRangeOverride: 'P2' },
    { name: 'C', wc: 2, wallRangeOverride: 'P3' }
  ]),
  'Walls in P1, P2 and P3, applied in 2 coats.');
eq('rooms agreeing via an override that matches the default — one paint, named',
  sentenceFor('quote', [
    { name: 'Lounge', wc: 2, wallRangeOverride: 'Tikkurila Optiva 5' },
    { name: 'Hall',   wc: 2 }
  ]),
  'Walls in Tikkurila Optiva 5, applied in 2 coats.');
eq('a stale override on a room that paints no walls is not a disagreement',
  sentenceFor('quote', [
    { name: 'Lounge', wc: 2 },
    { name: 'Hall',   cc: 2, wallRangeOverride: 'Dulux Diamond Matt' }
  ]),
  'Ceilings finished in Tikkurila Anti Reflex 2 and walls in Tikkurila Optiva 5, each applied in 2 coats.');
eq('two wall paints leave the other surfaces naming their own',
  sentenceFor('quote', [
    { name: 'Lounge', wc: 2, cc: 2, xc: 2, wallRangeOverride: 'Tikkurila Optiva 5' },
    { name: 'Hall',   wc: 2, cc: 2, xc: 2, wallRangeOverride: 'Dulux Diamond Matt' }
  ]),
  'Ceilings finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5 and Dulux Diamond Matt, and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');
eq('two ceiling paints — the lead clause lists both',
  sentenceFor('quote', [
    { name: 'Lounge', cc: 2, wc: 2, ceilingRangeOverride: 'Dulux Trade Matt' },
    { name: 'Hall',   cc: 2, wc: 2 }
  ]),
  'Ceilings finished in Dulux Trade Matt and Tikkurila Anti Reflex 2, and walls in Tikkurila Optiva 5, each applied in 2 coats.');
eq('two woodwork paints, invoice tense',
  sentenceFor('invoice', [
    { name: 'Lounge', xc: 2, topcoatRangeOverride: 'Tikkurila Helmi 30' },
    { name: 'Hall',   xc: 2, topcoatRangeOverride: 'Dulux Satinwood' }
  ]),
  'Woodwork including skirtings in Tikkurila Helmi 30 and Dulux Satinwood, 2 coats throughout.');
eq('two rooms panelled in different paints — both named, never left bare beside the woodwork',
  sentenceFor('quote', [
    { name: 'Lounge', wc: 2, xc: 2, panelItems: PANEL, panelRangeOverride: 'Little Greene Intelligent Eggshell' },
    { name: 'Hall',   wc: 2, xc: 2, panelItems: PANEL, panelRangeOverride: 'Dulux Satinwood' }
  ]),
  'Walls in Tikkurila Optiva 5, wall panelling in Little Greene Intelligent Eggshell and Dulux Satinwood, and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');
eq('two feature walls in different paints — both named, never left bare beside the walls',
  sentenceFor('quote', [
    { name: 'Lounge',  wc: 2, featureWallArea: 8, featurewallRangeOverride: 'Farrow & Ball Estate' },
    { name: 'Bedroom', wc: 2, featureWallArea: 6, featurewallRangeOverride: 'Little Greene Absolute Matt' }
  ]),
  'Walls in Tikkurila Optiva 5, and the feature wall in Farrow & Ball Estate and Little Greene Absolute Matt, each applied in 2 coats.');

// Two clauses normally join with a bare "and". A clause that has spent one
// listing its own paints must not, or the reader has to work out which
// "and" is which -- "in A and B and walls in C".
check('two parts join with a bare "and" while no clause lists two paints',
  sentenceFor('quote', [{ wc: 2, cc: 2 }]).indexOf('Anti Reflex 2 and walls') > 0,
  sentenceFor('quote', [{ wc: 2, cc: 2 }]));
check('two parts take the comma form once a clause lists two paints',
  sentenceFor('quote', [{ wc: 2, cc: 2, wallRangeOverride: 'A' }, { wc: 2, cc: 2, wallRangeOverride: 'B' }])
    .indexOf('Anti Reflex 2, and walls in A and B') > 0,
  sentenceFor('quote', [{ wc: 2, cc: 2, wallRangeOverride: 'A' }, { wc: 2, cc: 2, wallRangeOverride: 'B' }]));

// The standalone placeholders resolve the same way, so a hand-edited
// template that still writes "{wallProduct}" cannot state a paint the job
// does not agree on -- it falls to the visible fill-me-in token instead.
check('{wallProduct} lists every paint the rooms use, never just the first',
  vf('quote', [{ wc: 2, wallRangeOverride: 'A' }, { wc: 2, wallRangeOverride: 'B' }]).wallProduct === 'A and B');
check('{wallProduct} keeps the Settings default when no room paints walls',
  vf('quote', [{ cc: 2 }]).wallProduct === 'Tikkurila Optiva 5');
check('a single room still resolves its own override',
  vf('quote', [{ wc: 2, wallRangeOverride: 'Dulux Diamond Matt' }]).wallProduct === 'Dulux Diamond Matt');
check('radiators count as woodwork users when collecting paints',
  vf('quote', [{ rads: 2, topcoatRangeOverride: 'A' }, { xc: 2, topcoatRangeOverride: 'B' }]).woodProduct === 'A and B');

// ── 6. Job-level union across rooms ────────────────────────────────────────
eq('one room with woodwork puts woodwork in the sentence for the job',
  scope('quote', [{ name: 'Hall', wc: 2 }, { name: 'Landing', wc: 2, xc: 2 }]),
  'Walls in Tikkurila Optiva 5 and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');

// ── 7. Unresolved products stay as literal tokens ──────────────────────────
// The existing preview warning reads leftover {tokens}; a product with no
// value must still reach it rather than vanishing mid-sentence.
eq('missing wall product surfaces as its literal token',
  api.buildScopeSentence('quote', [{ name: 'Hall', wc: 2 }], {}),
  'Walls in {wallProduct}, applied in 2 coats.');

// ── 8. {papered} ───────────────────────────────────────────────────────────
eq('papered feature wall', api.buildPaperedPhrase([{ featureWallArea: 8.4, featureWallMode: 'wallpaper' }]), 'the feature wall');
eq('papered room walls', api.buildPaperedPhrase([{ wpWallFinish: true }]), 'the walls');
eq('papered walls and ceiling', api.buildPaperedPhrase([{ wpWallFinish: true, wpCeilLining: true }]), 'the walls and the ceiling');
eq('feature wall and walls across two rooms',
  api.buildPaperedPhrase([{ featureWallArea: 8.4, featureWallMode: 'wallpaper' }, { wpWallFinish: true }]),
  'the feature wall and the walls');
eq('nothing papered — falls back to the seeded edit-me marker',
  api.buildPaperedPhrase([{ wc: 2 }]), '[feature wall/walls]');

// ── 9. End to end through the real templates ───────────────────────────────
const tpl = id => api.DEFAULT_TEXT_TEMPLATES.find(t => t.id === id);
const values = rooms => Object.assign({
  rooms: 'Living Room',
  masonryProduct: 'Dulux Weathershield', extWoodProduct: 'Dulux Weathershield Gloss'
}, PRODUCTS, { surfaces: scope('quote', rooms), papered: api.buildPaperedPhrase(rooms),
   extSurfaces: api.buildExtScopeSentence('quote', [EXT_FULL], EXT_PRODUCTS),
   unitSurfaces: api.buildFuScopeSentence('quote', [FU_FULL], PRODUCTS), kitchenCoats: 2 });
const wallsOnly = api.renderTemplateText(tpl('painting').body, 'quote', values([{ name: 'Living Room', wc: 2 }]));
check('painting template, walls-only job never says "ceiling"', !/ceiling/i.test(wallsOnly), wallsOnly);
check('painting template, walls-only job never says "woodwork"', !/woodwork/i.test(wallsOnly), wallsOnly);
check('painting template, walls-only job still carries the standard tail',
  wallsOnly.includes('All work carried out to a high standard'), wallsOnly);
check('painting template leaves no unresolved token',
  !/\{[a-zA-Z]/.test(wallsOnly), wallsOnly);

const papered = [{ name: 'Lounge', wc: 2, cc: 2, featureWallArea: 8.4, featureWallMode: 'wallpaper' }];
const featured = api.renderTemplateText(tpl('paint-paper').body, 'quote', values(papered));
check('paint & paper template names the papered feature wall',
  featured.includes('hung to the feature wall'), featured);
// Asserted against the painted sentence itself, not the whole render: the
// papering line legitimately says "the feature wall" a few lines further on.
check('paint & paper template does not also paint the papered feature wall',
  !/feature wall/.test(scope('quote', papered)), scope('quote', papered));

// Both tenses of all eight seeded templates still render without leaving a
// stray token behind -- {surfaces}/{papered} resolve to '' or a marker, so
// a template that mentions neither must be unaffected either way.
api.DEFAULT_TEXT_TEMPLATES.forEach(t => {
  ['quote', 'invoice'].forEach(mode => {
    const out = api.renderTemplateText(t.body, mode, Object.assign({ completedDate: '7 August 2026' },
      values([FULL]), { surfaces: scope(mode, [FULL]),
        extSurfaces: api.buildExtScopeSentence(mode, [EXT_FULL], EXT_PRODUCTS),
        unitSurfaces: api.buildFuScopeSentence(mode, [FU_FULL], PRODUCTS), kitchenCoats: 2 }));
    check(t.id + ' / ' + mode + ' — no unresolved placeholder',
      !/\{[a-zA-Z][a-zA-Z0-9]*\}/.test(out), out);
    check(t.id + ' / ' + mode + ' — no blank line left where a value was dropped',
      !/\n{3,}/.test(out), JSON.stringify(out));
  });
});

// ── 10. Per-room scope, and when a line collapses to "same as above" ───────
// The rule the quote and invoice builders both apply: a later room's line
// carries its OWN scope unless that matches the block's job-wide sentence,
// in which case the bare "same as above" is accurate and is kept.
const jobScopeOf = (mode, rs) => api.buildScopeSentence(mode, rs, api.scopeProductValues(rs));
const lineFor = (mode, rs, i) => {
  const own = api.roomScopeSentence(mode, rs[i]);
  const jobScope = jobScopeOf(mode, rs);
  return (!own || own === jobScope) ? rs[i].name + ' - same as above'
    : rs[i].name + '\n\n' + own + '\n\nPreparation and completion as above.';
};

const MIXED = [
  { name: 'Living Room', wc: 2, cc: 2, xc: 2 },
  { name: 'Bathroom',    wc: 2 },
  { name: 'Landing',     wc: 2, cc: 2, xc: 2 }
];
eq('a walls-only room states its own scope instead of inheriting the job block',
  lineFor('quote', MIXED, 1),
  'Bathroom\n\nWalls in Tikkurila Optiva 5, applied in 2 coats.\n\nPreparation and completion as above.');
eq('a room matching the job scope keeps the bare "same as above"',
  lineFor('quote', MIXED, 2), 'Landing - same as above');
eq('every room identical — no line gains any text',
  lineFor('quote', [FULL, Object.assign({}, FULL, { name: 'Bedroom 1' })], 1),
  'Bedroom 1 - same as above');
eq('invoice tense on a per-room line',
  lineFor('invoice', MIXED, 1),
  'Bathroom\n\nWalls in Tikkurila Optiva 5, 2 coats throughout.\n\nPreparation and completion as above.');
// A room priced for something the scope sentence can't describe (a papered
// feature wall alone, say) has no sentence of its own, and must fall back
// rather than emit an empty block.
eq('a room with no describable painted scope falls back to "same as above"',
  lineFor('quote', [FULL, { name: 'Snug', featureWallArea: 6, featureWallMode: 'wallpaper' }], 1),
  'Snug - same as above');

// The job-wide sentence is the union, so it is what a fully-scoped room
// matches against — proving the collapse is comparing like with like.
eq('the job block still reads as the union across every room',
  jobScopeOf('quote', MIXED),
  'Ceilings finished in Tikkurila Anti Reflex 2, walls in Tikkurila Optiva 5, and all woodwork including skirtings in Tikkurila Helmi 30, each applied in 2 coats.');

// ── 11. The short scope note for the client quote view ─────────────────────
const shortOf = r => api.roomScopeShort(r);
eq('short note: a full room', shortOf(FULL), 'ceiling, walls and woodwork');
eq('short note: walls only', shortOf({ wc: 2 }), 'walls');
eq('short note: a feature wall and panelling',
  shortOf({ wc: 2, xc: 2, featureWallArea: 6, panelItems: [{ width: 3, height: 1, coats: 2 }] }),
  'walls, feature wall, panelling and woodwork');
eq('short note: radiators with no skirtings are named, not called woodwork',
  shortOf({ wc: 2, rads: 3 }), 'walls and radiators');
eq('short note: a papered feature wall', shortOf({ wc: 2, featureWallArea: 6, featureWallMode: 'wallpaper' }),
  'walls and papered feature wall');
eq('short note: nothing measured', shortOf({}), '');

// ── 12. Exterior scope ─────────────────────────────────────────────────────
const ext = (mode, items) => api.buildExtScopeSentence(mode, items, EXT_PRODUCTS);
eq('a full exterior item, quote',
  ext('quote', [EXT_FULL]),
  'Rendered surfaces in Dulux Weathershield, exterior woodwork including fascias and soffits, window frames and doors in Weathershield Gloss, each applied in 2 coats.');
eq('a full exterior item, invoice',
  ext('invoice', [EXT_FULL]),
  'Rendered surfaces in Dulux Weathershield, exterior woodwork including fascias and soffits, window frames and doors in Weathershield Gloss, 2 coats throughout.');
eq('render only — no woodwork promised',
  ext('quote', [{ masonry: 60 }]),
  'Rendered surfaces in Dulux Weathershield, applied in 2 coats.');
eq('textured render is named as such',
  ext('quote', [{ masonry: 60, texturedRender: true }]),
  'Textured rendered surfaces in Dulux Weathershield, applied in 2 coats.');
eq('windows only, with no render',
  ext('quote', [{ windows: [{ qty: 3 }] }]),
  'Exterior woodwork including window frames in Weathershield Gloss, applied in 2 coats.');
eq('coats read from the item, not assumed',
  ext('quote', [{ masonry: 60, coats: { 'ex-masonry': 3 } }]),
  'Rendered surfaces in Dulux Weathershield, applied in 3 coats.');
eq('elements disagreeing on coats state none',
  ext('quote', [{ masonry: 60, fascia: 10, coats: { 'ex-masonry': 3, 'ex-fascia': 2 } }]),
  'Rendered surfaces in Dulux Weathershield, exterior woodwork including fascias and soffits in Weathershield Gloss.');
eq('sash windows bring the restoration note, and never a coats figure of their own',
  ext('quote', [{ sashWindows: [{ qty: 2 }] }]),
  'Exterior woodwork including sash windows in Weathershield Gloss. Restoration and repairs will be carried out where necessary.');
eq('per-window repairs bring the note too, invoice tense',
  ext('invoice', [{ windows: [{ qty: 2, resin: 1 }] }]),
  'Exterior woodwork including window frames in Weathershield Gloss, 2 coats throughout. Restoration and repairs were carried out where necessary.');
eq('legacy flat window count still counts',
  ext('quote', [{ wins: 3 }]),
  'Exterior woodwork including window frames in Weathershield Gloss, applied in 2 coats.');
eq('garage and porch', ext('quote', [{ garage: 1, porch: 2, coats: {} }]),
  'Exterior woodwork including garage doors and porch in Weathershield Gloss.');
eq('nothing measured — empty, never a literal token', ext('quote', [{}]), '');
// Union across items, the same way the room block unions across rooms.
eq('two items union into the block sentence',
  ext('quote', [{ masonry: 60 }, { windows: [{ qty: 2 }] }]),
  'Rendered surfaces in Dulux Weathershield, exterior woodwork including window frames in Weathershield Gloss, each applied in 2 coats.');

// An exterior line compares against the EXTERIOR union, never the rooms' —
// comparing across the two would print scope on every line.
const extLine = (mode, items, i) => {
  const own = api.extItemScopeSentence(mode, items[i], EXT_PRODUCTS);
  const jobWide = ext(mode, items);
  const label = items[i].label || 'Exterior';
  return (!own || own === jobWide) ? label + ' - same as above'
    : label + '\n\n' + own + '\n\nPreparation and completion as above.';
};
const EXTS = [{ label: 'Front Elevation', masonry: 60 }, { label: 'Rear Windows', windows: [{ qty: 4 }] }];
eq('an exterior item differing from the exterior union states its own scope',
  extLine('quote', EXTS, 1),
  'Rear Windows\n\nExterior woodwork including window frames in Weathershield Gloss, applied in 2 coats.\n\nPreparation and completion as above.');
eq('a lone exterior item matches the union and collapses',
  extLine('quote', [EXT_FULL], 0), 'Front Elevation - same as above');

eq('short exterior note for the client view', api.extScopeShort(EXT_FULL),
  'exterior — render, fascias and soffits, windows and doors');
eq('short exterior note falls back to the old bare label', api.extScopeShort({}), 'exterior');

// ── 13. The Interior & Exterior template ───────────────────────────────────
const intExt = api.DEFAULT_TEXT_TEMPLATES.find(t => t.id === 'int-ext');
check('the ninth template exists', !!intExt);
['quote', 'invoice'].forEach(mode => {
  const out = api.renderTemplateText(intExt.body, mode, Object.assign(
    { rooms: 'Living Room and Front Elevation', completedDate: '7 August 2026' },
    PRODUCTS, EXT_PRODUCTS,
    { surfaces: scope(mode, [FULL]), extSurfaces: ext(mode, [EXT_FULL]) }));
  check('int-ext / ' + mode + ' — carries the interior scope', out.includes('Tikkurila Helmi 30'), out);
  check('int-ext / ' + mode + ' — carries the exterior scope', out.includes('Dulux Weathershield'), out);
  check('int-ext / ' + mode + ' — no unresolved placeholder', !/\{[a-zA-Z][a-zA-Z0-9]*\}/.test(out), out);
});
const intExtQ = api.renderTemplateText(intExt.body, 'quote', Object.assign(
  { rooms: 'x', completedDate: 'x' }, PRODUCTS, EXT_PRODUCTS,
  { surfaces: scope('quote', [FULL]), extSurfaces: ext('quote', [EXT_FULL]) }));
// The preamble is the point of the template: the interior promise about
// furniture and flooring must not be the only one a mixed job makes.
check('int-ext quote keeps the interior protection promise',
  intExtQ.includes('All furniture and flooring will be fully protected'), intExtQ);
check('int-ext quote adds the exterior one',
  intExtQ.includes('windows, doors and landscaping will be fully protected'), intExtQ);
check('int-ext quote labels which half is which',
  intExtQ.includes('INSIDE') && intExtQ.includes('OUTSIDE'), intExtQ);

// ── 14. The exterior templates use the exterior scope ──────────────────────
// {extSurfaces} exists, so neither exterior template should still be asking
// for its scope and coats to be typed in by hand.
['ext-woodwork', 'ext-render'].forEach(id => {
  const t = api.DEFAULT_TEXT_TEMPLATES.find(x => x.id === id);
  check(id + ' — uses {extSurfaces}', t.body.includes('{extSurfaces}'), t.body);
  check(id + ' — no hand-typed coats marker left', !/\[X\] coats/.test(t.body), t.body);
  ['quote', 'invoice'].forEach(mode => {
    const out = api.renderTemplateText(t.body, mode, Object.assign(
      { rooms: 'x', completedDate: '7 August 2026' }, EXT_PRODUCTS,
      { extSurfaces: ext(mode, [EXT_FULL]) }));
    check(id + ' / ' + mode + ' — scope reaches the render',
      out.includes('Dulux Weathershield'), out);
    check(id + ' / ' + mode + ' — no unresolved placeholder',
      !/\{[a-zA-Z][a-zA-Z0-9]*\}/.test(out), out);
  });
});
// The render template's own wording either side of the placeholder survives.
const renderQ = api.renderTemplateText(
  api.DEFAULT_TEXT_TEMPLATES.find(x => x.id === 'ext-render').body, 'quote',
  Object.assign({ rooms: 'x', completedDate: 'x' }, EXT_PRODUCTS,
    { extSurfaces: ext('quote', [{ masonry: 60 }]) }));
check('ext-render keeps its brush/roller/spray sentence',
  renderQ.includes('Brush, roller or airless spray as appropriate'), renderQ);
// The scope sentence already ends "...applied in 2 coats", so the wording
// after it must not open with "Applied" again.
check('ext-render does not say "applied" twice in a row',
  !/applied in \d coats\. Applied/.test(renderQ), renderQ);

// ── 15. Fitted units ───────────────────────────────────────────────────────
const fu = (mode, units) => api.buildFuScopeSentence(mode, units, PRODUCTS);
eq('a bare unit, quote', fu('quote', [FU_FULL]),
  'Fitted units including 3 bays, 9 shelves and 4 doors in Tikkurila Helmi 30, applied in 2 coats. Bare surfaces will be primed first.');
eq('a bare unit, invoice', fu('invoice', [FU_FULL]),
  'Fitted units including 3 bays, 9 shelves and 4 doors in Tikkurila Helmi 30, 2 coats throughout. Bare surfaces were primed first.');
eq('an already-painted unit gets the key-and-sand note, not the primer one',
  fu('quote', [{ bayCount: 2, shelfCount: 4, prepLevel: 'painted' }]),
  'Fitted units including 2 bays and 4 shelves in Tikkurila Helmi 30, applied in 2 coats. Existing paintwork will be keyed and sanded first.');
eq('one bay, one shelf, one door — singulars',
  fu('quote', [{ bayCount: 1, shelfCount: 1, doorCount: 1, prepLevel: 'painted' }]),
  'Fitted units including 1 bay, 1 shelf and 1 door in Tikkurila Helmi 30, applied in 2 coats. Existing paintwork will be keyed and sanded first.');
eq('doors painted both sides is said, since it doubles the work',
  fu('quote', [{ doorCount: 4, doorBothSides: true, prepLevel: 'painted' }]),
  'Fitted units including 4 doors painted both sides in Tikkurila Helmi 30, applied in 2 coats. Existing paintwork will be keyed and sanded first.');
eq('both sides ignored where there are no doors',
  fu('quote', [{ shelfCount: 3, doorBothSides: true, prepLevel: 'painted' }]),
  'Fitted units including 3 shelves in Tikkurila Helmi 30, applied in 2 coats. Existing paintwork will be keyed and sanded first.');
eq('counts sum across units, and both prep levels are said',
  fu('quote', [{ bayCount: 2, prepLevel: 'bare' }, { bayCount: 3, shelfCount: 6, prepLevel: 'painted' }]),
  'Fitted units including 5 bays and 6 shelves in Tikkurila Helmi 30, applied in 2 coats. Bare surfaces will be primed and existing paintwork keyed and sanded first.');
eq("the unit's own product wins over the Settings woodwork topcoat",
  fu('quote', [{ bayCount: 2, range: 'Little Greene Intelligent Eggshell', prepLevel: 'painted' }]),
  'Fitted units including 2 bays in Little Greene Intelligent Eggshell, applied in 2 coats. Existing paintwork will be keyed and sanded first.');
eq('two units in different products name both',
  fu('quote', [{ bayCount: 1, range: 'A', prepLevel: 'painted' }, { bayCount: 1, range: 'B', prepLevel: 'painted' }]),
  'Fitted units including 2 bays in A and B, applied in 2 coats. Existing paintwork will be keyed and sanded first.');
eq('nothing counted — empty, never a literal token', fu('quote', [{ prepLevel: 'bare' }]), '');
check('complexity uplift is a pricing figure and never reaches the text',
  !/uplift|complexity/i.test(fu('quote', [{ bayCount: 2, complexityUplift: 25, prepLevel: 'bare' }])));

const fuTpl = api.DEFAULT_TEXT_TEMPLATES.find(t => t.id === 'fitted-units');
check('fitted-units template uses {unitSurfaces}', fuTpl.body.includes('{unitSurfaces}'), fuTpl.body);
check('fitted-units template has no hand-typed coats or product marker left',
  !/\[X\] coats/.test(fuTpl.body) && !/\[product\]/.test(fuTpl.body), fuTpl.body);
check('fitted-units template keeps its spray/brush marker, which is not tracked',
  fuTpl.body.includes('[spray/brush]'), fuTpl.body);
// {unitSurfaces} now says exactly when priming happens, so the prep line
// above it no longer claims it vaguely as well.
check('fitted-units prep line no longer duplicates the priming statement',
  !/sanding and priming/.test(fuTpl.body), fuTpl.body);

// ── 16. Kitchen coats ──────────────────────────────────────────────────────
const kTpl = api.DEFAULT_TEXT_TEMPLATES.find(t => t.id === 'kitchen-spray');
check('kitchen template fills its coat count', kTpl.body.includes('{kitchenCoats}'), kTpl.body);
check('kitchen template has no [X] coats marker left', !/\[X\] coats/.test(kTpl.body), kTpl.body);
// The product and colour are NOT tracked in the app and must stay markers.
check('kitchen product stays a hand-typed marker', kTpl.body.includes('[product]'), kTpl.body);
check('kitchen colour stays a hand-typed marker', kTpl.body.includes('[colour/finish]'), kTpl.body);
['quote', 'invoice'].forEach(mode => {
  const out = api.renderTemplateText(kTpl.body, mode,
    { rooms: 'x', completedDate: '7 August 2026', kitchenCoats: 3 });
  check('kitchen / ' + mode + ' — the real coat count reaches the render',
    out.includes('3 coats'), out);
});

// Every template's coats now come from the job, so no seeded body should
// still be asking for a coat count to be typed in.
api.DEFAULT_TEXT_TEMPLATES.forEach(t => {
  if (t.id === 'fire-doors') return;  // manual-only choice; its doors are measured on rooms
  check(t.id + ' — no hand-typed coats marker', !/\[X\] coats/.test(t.body), t.body);
});

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
