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
    topcoat: { range: 'Tikkurila Helmi 30' }
  } };
  function effectiveRoleRange(r, role) {
    var override = r[role + 'RangeOverride'];
    if (override) return override;
    if (role === 'featurewall') return r.wallRangeOverride || (settings.materials.wall || {}).range || '';
    return (settings.materials[role] || {}).range || '';
  }
  // The globals buildTemplateValues reads, so the product resolution can be
  // driven for real rather than hand-fed a values object.
  var rooms = [], extItems = [], labourLog = [];
  function activeJob() { return { name: 'Test Job' }; }
`;

const api = {};
new Function('exports', sandbox + [
  extractFn('englishJoin'),
  extractFn('scopeFacts'),
  extractFn('buildScopeSentence'),
  extractFn('buildPaperedPhrase'),
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
  // Drives the REAL product resolution: set the room list, get the values
  // object a render would actually be given.
  'exports.valuesFor = function(mode, rs, xs) { rooms = rs || []; extItems = xs || []; return buildTemplateValues(mode); };'
].join('\n'))(api);

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
}, PRODUCTS, { surfaces: scope('quote', rooms), papered: api.buildPaperedPhrase(rooms) });
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
      values([FULL]), { surfaces: scope(mode, [FULL]) }));
    check(t.id + ' / ' + mode + ' — no unresolved placeholder',
      !/\{[a-zA-Z][a-zA-Z0-9]*\}/.test(out), out);
    check(t.id + ' / ' + mode + ' — no blank line left where a value was dropped',
      !/\n{3,}/.test(out), JSON.stringify(out));
  });
});

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
