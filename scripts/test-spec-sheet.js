#!/usr/bin/env node
'use strict';

// ── Regression test: the job spec sheet ────────────────────────────────────
//
// JOB_SPEC_SHEET_SPEC.md. The sheet is a DERIVED view plus a set of ticks:
// the rows are rebuilt from the rooms every time it opens, and only the ticks
// are stored. That split is where the behaviour worth protecting lives, and
// all of it is here:
//
//   1. The rows a job produces, and the order they come in: ceiling,
//      panelling, woodwork, radiators, walls, feature wall -- with a papered
//      surface carrying a single Done tick and no colour, and a surface with
//      no coats producing no row at all.
//   2. Cleared-last at BOTH levels in BOTH views, with the feature wall last
//      within each band (its stage rank is the highest, and cleared-last
//      outranks stage order -- so an open feature wall sits above a ticked-off
//      ceiling, which is the same behaviour snags have).
//   3. PREP ALONE DOES NOT CLEAR A ROW. Only Painted does.
//   4. Fold defaults, including the "nothing open anywhere" case, and a tap
//      beating the default in both directions.
//   5. Key stability across a room RENAME -- keys are built from record ids,
//      which is the whole reason renaming a room keeps its ticks.
//   6. An orphaned tick (a row that no longer exists) is ignored and never
//      counted.
//   7. A refetch never swallows a tick that is still in the offline queue --
//      the link means other people's ticks arrive on a timer, and without
//      this rule that timer would undo the tick made in a cellar.
//   8. The public tick route's rule: a tick is accepted only for a key in
//      that job's published model, and only for a step that row actually has.
//
// Pure node against the real public/index.html and the real lib/specSheet.js:
// the spec-sheet section of the app's own script is evaluated in a vm with
// the handful of globals it reaches outside itself stubbed, so the code under
// test is the code that ships. No browser, no server, no database.
//
// USAGE
//   node scripts/test-spec-sheet.js
//   npm run test:spec

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const { tickAllowedByModel, normaliseSpecModel } = require(path.join(ROOT, 'lib', 'specSheet.js'));

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Lift the code out of index.html ────────────────────────────────────────
// By banner comments rather than line numbers, so the slices follow the code
// when it moves.
function slice(startMark, endMark, what) {
  const a = SRC.indexOf(startMark), b = SRC.indexOf(endMark);
  if (a < 0 || b < 0 || b < a) {
    console.error('Could not find the ' + what + ' section in public/index.html.');
    console.error('If its banner comments were renamed, update the marks here.');
    process.exit(2);
  }
  return SRC.slice(a, b);
}

const SPEC_SRC = slice(
  '// ── Job spec sheet (the per-job quick reference)',
  '// The reconciliation: estimate (rolled up) LEFT JOIN actuals',
  'spec sheet');
// scopeFacts comes along for real rather than being stubbed: which surfaces a
// room HAS is exactly the question the sheet's rows are an answer to, and a
// stub of it would be a test of the stub.
const SCOPE_SRC = slice(
  'function scopeFacts(liveRooms) {',
  '// The painted scope. Returns',
  'scopeFacts');

// The globals the spec-sheet code reaches outside its own section. calcRoom
// is stubbed down to the one figure the sheet reads from it (does this room
// buy a primer), because the rest of a 350-line pricing function is not what
// is under test here.
const sandbox = {
  rooms: [],
  extItems: [],
  settings: { materials: { wall: { range: 'Trade Matt' }, ceiling: { range: 'Trade Matt' }, topcoat: { range: 'Satinwood' }, mist: { range: 'Contract Matt' }, primer: { range: 'Undercoat' } } },
  colours: [],
  activeJobId: 'job-1',
  activeJob: () => sandbox.job,
  job: { id: 'job-1', name: 'The Gables', contact: {}, kitchen: null, fittedUnits: [], customItems: [] },
  calcRoom: (r) => ({ primerL: +r._primerL || 0 }),
  calcKitchen: (k) => ({ total: k && k._total ? k._total : 0 }),
  ensureKitchenShape: (j) => j.kitchen,
  fittedUnitList: (j) => (j && j.fittedUnits) || [],
  fittedUnitName: (f) => (f && f.name) || 'Fitted Unit',
  calcFittedUnit: (f) => ({ total: +f._total || 0 }),
  jobCustomItems: (j) => (j && j.customItems) || [],
  extMasonryLitres: (it) => +it._masonryL || 0,
  extWoodworkLitres: (it) => +it._woodL || 0,
  extScopeFacts: () => ({ fascia: false, windows: false, sash: false, frames: false, doors: false, garage: false, porch: false, coats: { 2: true } }),
  legacyWindowList: () => [],
  extWindowCount: () => 0,
  variationStatusOf: (x) => (x && x.variationStatus) || 'pending',
  // Extra work inside an already-measured carrier (VARIATIONS_SPEC.md Part 2).
  // Stubbed to the shape variationDeltaOf() returns; what is under test is what
  // the sheet SAYS about it, not how the delta is priced.
  variationDeltaOf: (kind, obj) => (obj && obj._delta) || null,
  // The real ones: an undecided colour reads "To be confirmed", a decided one
  // reads its name.
  colourScheduleLabel: (num) => (sandbox.colourNames[num] || 'To be confirmed'),
  colourNames: {},
  englishJoin: (list) => {
    const l = (list || []).filter(Boolean);
    if (!l.length) return '';
    if (l.length === 1) return l[0];
    return l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
  },
  escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  invalidateColourPlaceholders() {},
  renderActuals() {}, renderSpecSheet() {},
  document: { getElementById: () => null },
  location: { origin: 'https://example.test' },
  navigator: {}, console,
  alert() {}, confirm: () => false,
  setTimeout, clearTimeout, setInterval, clearInterval,
  apiGet: async () => [], apiPutStrict: async () => ({}), apiDeleteStrict: async () => ({}),
  hasQueuedKey: () => false,
};
vm.createContext(sandbox);
vm.runInContext(SCOPE_SRC + '\n' + SPEC_SRC, sandbox, { filename: 'index.html (spec sheet)' });
// effectiveRoleRange lives in the pricing half of the file; the sheet only
// ever asks it for a product name, so the Settings default is answer enough.
vm.runInContext(`function effectiveRoleRange(r, role) {
  return (r && r[role + 'RangeOverride']) || (((settings.materials || {})[role]) || {}).range || '';
}`, sandbox);

// ── A test job ─────────────────────────────────────────────────────────────
// One room using every surface plus radiators, one walls-only room, a papered
// feature wall, an undecided colour, a mist coat, and a declined variation
// that must not appear at all.
function room(over) {
  return Object.assign({
    id: 'r0', name: 'Room', wc: 0, cc: 0, xc: 0, rads: 0, win: 0, sills: 0,
    doorQty: 0, frameQty: 0, doorCoats: 0, frameCoats: 0, panelItems: [],
    featureWallArea: 0, featureWallMode: 'paint',
    colourNumber: 1, ceilingColourNumber: 1, woodworkColourNumber: 1,
    featureWallColourNumber: 1, panelColourNumber: 1
  }, over || {});
}

sandbox.colourNames = { 1: 'All White', 2: 'Dead Salmon', 3: 'Card Room Green' };
sandbox.rooms = [
  room({
    id: 'ab12', name: 'Lounge', wc: 2, cc: 2, xc: 2, rads: 1.4, win: 2, sills: 1,
    doorQty: 1, doorCoats: 2, frameQty: 1, frameCoats: 2,
    panelItems: [{ width: 3, height: 1, coats: 2 }],
    featureWallArea: 6, featureWallMode: 'paint',
    colourNumber: 2, ceilingColourNumber: 1, woodworkColourNumber: 1,
    featureWallColourNumber: 3, panelColourNumber: 1, mistWall: true
  }),
  room({ id: 'cd34', name: 'Landing', wc: 2, colourNumber: 9 }),   // colour 9 undecided
  room({ id: 'ef56', name: 'Study', wc: 2, featureWallArea: 4, featureWallMode: 'wallpaper' }),
  room({ id: 'gh78', name: 'Declined Extension', wc: 2, isVariation: true, variationStatus: 'declined' }),
  room({ id: 'ij90', name: 'Pending Porch', wc: 2, isVariation: true, variationStatus: 'pending' })
];

let model = sandbox.jobSpecModel();
const keys = model.rows.map(r => r.key);

// 1 · The rows, and the order within a room
eq('Lounge rows come in the working sequence',
  model.rows.filter(r => r.areaKey === 'room:ab12').map(r => r.label),
  ['Ceiling', 'Panelling', 'Woodwork', 'Radiators', 'Walls (excl. feature wall)', 'Feature wall']);
check('a room with only walls produces only a walls row',
  JSON.stringify(model.rows.filter(r => r.areaKey === 'room:cd34').map(r => r.label)) === '["Walls"]',
  JSON.stringify(model.rows.filter(r => r.areaKey === 'room:cd34').map(r => r.label)));
check('a declined variation is omitted entirely',
  !keys.some(k => k.indexOf('gh78') >= 0));
check('a pending variation is shown, and tagged as the warning',
  model.rows.filter(r => r.areaKey === 'room:ij90').every(r => r.tag === 'Variation, awaiting approval'));
eq('keys are built from the record id and the sheet role', keys[0], 'room:ab12:ceiling');
eq('radiators get a row of their own', keys[3], 'room:ab12:radiators');

const papered = model.rows.find(r => r.key === 'room:ef56:featurewallpaper');
check('a papered surface exists as its own row', !!papered);
eq('a papered surface has a single Done tick', papered.steps, ['done']);
eq('a papered surface has no colour', papered.colour, '');
eq('a papered surface has no prep line', papered.prep, '');

eq('an undecided colour reads "To be confirmed"',
  model.rows.find(r => r.key === 'room:cd34:wall').colour, 'To be confirmed');
check('the area placeholder is never printed in the colour slot',
  !model.rows.some(r => /Main Walls|Landing Walls/.test(r.colour)));

// 2 · Prep lines
eq('a recorded mist coat replaces the general wall prep',
  model.rows.find(r => r.key === 'room:ab12:wall').prep, 'Mist coat — Contract Matt');
eq('a surface with no recorded prep gets its general line',
  model.rows.find(r => r.key === 'room:ab12:ceiling').prep,
  'Fill and sand. Mask edges and fittings.');
eq('radiators get their own general prep line',
  model.rows.find(r => r.key === 'room:ab12:radiators').prep,
  'Clean and key. Mask the wall and pipework.');
sandbox.rooms[0]._primerL = 1.5;
eq('a room that buys a primer shows it on the woodwork row',
  sandbox.jobSpecModel().rows.find(r => r.key === 'room:ab12:woodwork').prep, 'Primer — Undercoat');
delete sandbox.rooms[0]._primerL;

// The woodwork "including" list is what was actually counted.
eq('woodwork names what it includes',
  model.rows.find(r => r.key === 'room:ab12:woodwork').includes,
  'skirtings, door frames, doors, window frames and sills');

// 3 · Radiators follow the woodwork until the room says otherwise
eq('radiators follow the woodwork colour by default',
  model.rows.find(r => r.key === 'room:ab12:radiators').colour, 'All White');
sandbox.rooms[0].radiatorColourNumber = 3;
eq('a radiator override shows on the radiator row',
  sandbox.jobSpecModel().rows.find(r => r.key === 'room:ab12:radiators').colour, 'Card Room Green');
delete sandbox.rooms[0].radiatorColourNumber;

// 4 · Ticks: Prep alone never clears a row
const tick = (key, step, status) => {
  sandbox.specTicks = sandbox.specTicks.filter(t => !(t.itemKey === key && t.step === step));
  sandbox.specTicks.push({ itemKey: key, step: step, status: status || 'done',
    completedAt: status === 'open' ? null : '2026-09-19T09:00:00.000Z', source: 'app' });
};
sandbox.specTicks = [];
model = sandbox.jobSpecModel();
const ceilingRow = model.rows.find(r => r.key === 'room:ab12:ceiling');
tick('room:ab12:ceiling', 'prep');
check('Prep alone does not clear a row', !sandbox.specRowCleared(ceilingRow));
eq('and the row still counts as open', sandbox.specCounts(model).open, model.rows.length);
tick('room:ab12:ceiling', 'done');
check('Painted clears the row', sandbox.specRowCleared(ceilingRow));
eq('un-ticking Painted puts it straight back',
  (tick('room:ab12:ceiling', 'done', 'open'), sandbox.specRowCleared(ceilingRow)), false);

// The counts line
sandbox.specTicks = [];
tick('room:ab12:ceiling', 'prep');
tick('room:ab12:wall', 'prep');
tick('room:ab12:wall', 'done');
const counts = sandbox.specCounts(model);
eq('counts read rows, not steps',
  [counts.open, counts.painted, counts.prepDone, counts.total],
  [model.rows.length - 1, 1, 2, model.rows.length]);

// 5 · Cleared-last, at row and group level, in both views
sandbox.specTicks = [];
tick('room:ab12:ceiling', 'done');   // the FIRST row in the room's sequence
let groups = sandbox.specGroups(model, 'room', '');
const lounge = groups.find(g => g.key === 'room:ab12');
eq('a cleared row sinks to the bottom of its group',
  lounge.rows[lounge.rows.length - 1].key, 'room:ab12:ceiling');
eq('an open feature wall sits ABOVE a ticked-off ceiling',
  lounge.rows.map(r => r.label).indexOf('Feature wall') < lounge.rows.length - 1, true);
eq('the feature wall is still last among the OPEN rows',
  lounge.rows.filter(r => !sandbox.specRowCleared(r)).slice(-1)[0].label, 'Feature wall');

// A whole room cleared sinks below every room that still has work in it.
sandbox.specTicks = [];
model.rows.filter(r => r.areaKey === 'room:cd34').forEach(r => tick(r.key, 'done'));
groups = sandbox.specGroups(model, 'room', '');
eq('a room with nothing left open sinks to the bottom',
  groups[groups.length - 1].key, 'room:cd34');
eq('house order is preserved within the open band',
  groups.slice(0, -1).map(g => g.key),
  ['room:ab12', 'room:ef56', 'room:ij90']);

// By Stage: same rules, regrouped.
groups = sandbox.specGroups(model, 'stage', '');
check('By Stage sections follow the stage sequence',
  JSON.stringify(groups.map(g => g.label)) ===
  JSON.stringify(['Ceilings', 'Panelling', 'Woodwork', 'Walls', 'Feature walls']),
  JSON.stringify(groups.map(g => g.label)));
eq('By Stage groups hold the same rows as By Room',
  groups.reduce((n, g) => n + g.rows.length, 0), model.rows.length);
sandbox.specTicks = [];
model.rows.filter(r => r.stage === 'ceiling').forEach(r => tick(r.key, 'done'));
groups = sandbox.specGroups(model, 'stage', '');
eq('a stage with nothing left open sinks below the ones that have',
  groups[groups.length - 1].label, 'Ceilings');

// 6 · Folding
sandbox.specTicks = [];
sandbox.specCollapsed = {};
sandbox.specView = 'room';
model.rows.filter(r => r.areaKey === 'room:cd34').forEach(r => tick(r.key, 'done'));
groups = sandbox.specGroups(model, 'room', '');
const anyOpen = () => model.rows.some(sandbox.specRowOpen);
check('a group with work in it defaults to open',
  !sandbox.specGroupCollapsed(groups.find(g => g.key === 'room:ab12'), anyOpen()));
check('a group with nothing left open defaults to folded',
  sandbox.specGroupCollapsed(groups.find(g => g.key === 'room:cd34'), anyOpen()));
// A tap beats the default, in both directions.
sandbox.specCollapsed['room:room:cd34'] = false;
check('a tap opens a group the default would fold',
  !sandbox.specGroupCollapsed(groups.find(g => g.key === 'room:cd34'), anyOpen()));
sandbox.specCollapsed['room:room:ab12'] = true;
check('a tap folds a group the default would open',
  sandbox.specGroupCollapsed(groups.find(g => g.key === 'room:ab12'), anyOpen()));
// Nothing open anywhere: the whole sheet opens.
sandbox.specCollapsed = {};
model.rows.forEach(r => tick(r.key, 'done'));
groups = sandbox.specGroups(model, 'room', '');
check('with nothing open anywhere every group opens',
  groups.every(g => !sandbox.specGroupCollapsed(g, anyOpen())));
// The fold map is keyed by view, so folding a room cannot fold a stage.
sandbox.specCollapsed = {};
sandbox.specView = 'room';
sandbox.specCollapsed[sandbox.specGroupStateKey({ key: 'room:ab12' })] = true;
sandbox.specView = 'stage';
check('the fold map cannot collide across views',
  !Object.prototype.hasOwnProperty.call(sandbox.specCollapsed,
    sandbox.specGroupStateKey({ key: 'room:ab12' })));
sandbox.specView = 'room';

// 7 · Keys survive a rename; orphans are ignored
sandbox.specTicks = [];
tick('room:ab12:ceiling', 'done');
sandbox.rooms[0].name = 'Sitting Room';
const renamed = sandbox.jobSpecModel();
eq('renaming a room does not change its keys',
  renamed.rows.filter(r => r.areaKey === 'room:ab12').map(r => r.key).join(','),
  keys.filter(k => k.indexOf('ab12') >= 0).join(','));
check('and the tick made before the rename is still on the row',
  sandbox.specRowCleared(renamed.rows.find(r => r.key === 'room:ab12:ceiling')));
eq('the group heading follows the new name',
  sandbox.specGroups(renamed, 'room', '').find(g => g.key === 'room:ab12').label, 'Sitting Room');

tick('room:LONG-GONE:ceiling', 'done');
eq('an orphaned tick is never counted', sandbox.specCounts(renamed).painted, 1);
check('and never produces a row',
  !sandbox.specGroups(renamed, 'room', '').some(g => g.rows.some(r => /LONG-GONE/.test(r.key))));

// 8 · Quick find
sandbox.specTicks = [];
eq('"radiator" finds every radiator row',
  sandbox.specGroups(renamed, 'room', 'radiator').reduce((n, g) => n + g.rows.length, 0), 1);
eq('a colour name finds everywhere it is used',
  sandbox.specGroups(renamed, 'room', 'dead salmon').reduce((n, g) => n + g.rows.length, 0), 1);
eq('clearing the box restores the full sheet',
  sandbox.specGroups(renamed, 'room', '').reduce((n, g) => n + g.rows.length, 0), renamed.rows.length);

// 9 · Other areas: kitchen, fitted units, exterior and custom lines
// They use the same row shape through the same describers, and in By Stage
// they keep their areas as blocks rather than being batched together --
// a kitchen and a garage door have nothing to do in one pass.
sandbox.specTicks = [];
sandbox.job.kitchen = { _total: 900, coats: 2, colourNumber: 2, range: 'Helmi 30', stripCoating: true };
sandbox.job.fittedUnits = [{ id: 'u1', name: 'Alcove Shelving', _total: 300, colourNumber: 1, prepLevel: 'bare' }];
sandbox.job.customItems = [{ id: 'c1', description: 'Make good the garage lintel', unitPrice: 120 }];
sandbox.extItems = [{ id: 'x1', label: 'Front Elevation', _masonryL: 12, _woodL: 4,
  coats: { 'ex-masonry': 2 }, masonryColourNumber: 1, extWoodworkColourNumber: 3 }];
const wide = sandbox.jobSpecModel();
check('the kitchen, a unit, an exterior item and a custom line all appear',
  ['kitchen:kitchen:kitchen', 'unit:u1:unit', 'custom:c1:item', 'ext:x1:masonry', 'ext:x1:woodwork']
    .every(k => wide.rows.some(r => r.key === k)));
eq('recorded kitchen prep wins, and says the state not the minutes',
  wide.rows.find(r => r.key === 'kitchen:kitchen:kitchen').prep, 'Strip original coating');
eq("a fitted unit's prep level always wins",
  wide.rows.find(r => r.key === 'unit:u1:unit').prep, 'Bare / Primed — full prime, then 2 coats');
const custom = wide.rows.find(r => r.key === 'custom:c1:item');
eq('a custom line has a single Done tick', custom.steps, ['done']);
eq('a custom line shows its description only', custom.label, 'Make good the garage lintel');
check('and never its price', !/120/.test(JSON.stringify(custom)));
eq('custom lines group under "Other work"', custom.area, 'Other work');
const stageGroups = sandbox.specGroups(wide, 'stage', '');
eq('By Stage keeps the other areas as blocks, last',
  stageGroups.slice(-4).map(g => g.label),
  ['Front Elevation', 'Kitchen Cabinets', 'Alcove Shelving', 'Other work']);
sandbox.job.kitchen = null; sandbox.job.fittedUnits = []; sandbox.job.customItems = []; sandbox.extItems = [];

// The rest needs await (loadSpecTicks is async), so it runs in a main().
(async () => {
  // 10 · A refetch never swallows a tick that is still queued
  // The link means other people's ticks arrive while the sheet is open, so it
  // refetches on a timer. Without this rule that timer would quietly undo the
  // tick made thirty seconds ago in a cellar -- which is the whole reason the
  // snag PDF refuses to re-fetch at all.
  sandbox.specTicks = [
    // Ticked on this phone, still sitting in the offline queue.
    { itemKey: 'room:ab12:wall', step: 'done', status: 'done', completedAt: '2026-09-19T09:00:00.000Z', source: 'app' },
    // Ticked on this phone earlier, already sent.
    { itemKey: 'room:ab12:ceiling', step: 'prep', status: 'done', completedAt: '2026-09-18T09:00:00.000Z', source: 'app' }
  ];
  sandbox.hasQueuedKey = (key) => key === 'PUT /api/spec-ticks room:ab12:wall|done';
  // What the server still believes: it has never heard of the queued tick, and
  // it has a tick of its own that this phone has not seen.
  sandbox.apiGet = async () => ([
    { itemKey: 'room:ab12:ceiling', step: 'prep', status: 'done', completedAt: '2026-09-18T09:00:00.000Z', source: 'app' },
    { itemKey: 'room:ab12:radiators', step: 'prep', status: 'done', completedAt: '2026-09-19T10:00:00.000Z', source: 'link' }
  ]);
  await sandbox.loadSpecTicks();
  const afterFetch = sandbox.specTicks.map(t => t.itemKey + '|' + t.step).sort();
  eq('a refetch keeps the queued tick and takes everything else from the server',
    afterFetch, ['room:ab12:ceiling|prep', 'room:ab12:radiators|prep', 'room:ab12:wall|done']);
  check("and the queued tick's own stamp survives",
    sandbox.specTickFor('room:ab12:wall', 'done').completedAt === '2026-09-19T09:00:00.000Z');
  check("somebody else's tick arrives with its via-link marker",
    sandbox.specViaLink('room:ab12:radiators', 'prep'));
  // With nothing queued, the server's answer simply wins.
  sandbox.hasQueuedKey = () => false;
  await sandbox.loadSpecTicks();
  eq('with nothing queued the server is simply believed',
    sandbox.specTicks.map(t => t.itemKey + '|' + t.step).sort(),
    ['room:ab12:ceiling|prep', 'room:ab12:radiators|prep']);
  sandbox.specTicks = [];

  // 11 · Extra work added INSIDE an already-measured room
  // The flag is per-carrier and never names a surface, so there is no row to
  // tag -- it is said once against the AREA. The declined case is the one that
  // earns it: that work is still measured on the job, so its row is still on
  // the sheet to be painted, and nothing else here would say the client has
  // refused to pay for it.
  sandbox.specTicks = [];
  sandbox.rooms[1].variationDelta = true;
  sandbox.rooms[1]._delta = { raw: 48, classified: true };
  let delta = sandbox.jobSpecModel();
  const landing = () => sandbox.specGroups(delta, 'room', '').find(g => g.key === 'room:cd34');
  eq('a pending extra is noted against the area',
    landing().note, 'includes extra work, awaiting approval');
  check('and never as a row tag',
    delta.rows.filter(r => r.areaKey === 'room:cd34').every(r => r.tag === ''));
  sandbox.rooms[1].variationStatus = 'declined';
  delta = sandbox.jobSpecModel();
  eq('a DECLINED extra says so, and the rows stay on the sheet',
    landing().note, 'includes extra work the client declined');
  check('the room is still painted -- the work is measured on the job',
    delta.rows.some(r => r.areaKey === 'room:cd34'));
  sandbox.rooms[1].variationStatus = 'approved';
  eq('an approved extra reads as agreed',
    (delta = sandbox.jobSpecModel(), landing().note), 'includes extra work ✓');
  // A classified extra whose carrier has since shrunk back below its baseline
  // is not extra work any more -- variationDeltaScan()'s own rule.
  sandbox.rooms[1]._delta = { raw: -12, classified: true };
  eq('an extra that has shrunk back below its baseline says nothing',
    (delta = sandbox.jobSpecModel(), landing().note), '');
  // A stage section spanning the house is not one area, so it carries none.
  sandbox.rooms[1]._delta = { raw: 48, classified: true };
  delta = sandbox.jobSpecModel();
  const wallsSection = sandbox.specGroups(delta, 'stage', '').find(g => g.key === 'stage:wall');
  check('a stage section spanning several rooms carries no area note',
    wallsSection.rows.length > 1 && wallsSection.note === '');
  delete sandbox.rooms[1].variationDelta;
  delete sandbox.rooms[1]._delta;
  delete sandbox.rooms[1].variationStatus;

  // 12 · The published model, and the public tick route's rule
  const published = normaliseSpecModel(renamed);
  check('the model survives the server-side whitelist', !!published);
  check('the published model carries no money', !/price|amount|£|markup/i.test(JSON.stringify(published)));
  check('a tick for a real row and a real step is allowed',
    tickAllowedByModel(published, 'room:ab12:ceiling', 'prep'));
  check('a tick for a key that is not in the model is rejected',
    !tickAllowedByModel(published, 'room:NOPE:ceiling', 'prep'));
  check('a tick for a step that row does not have is rejected',
    !tickAllowedByModel(published, 'room:ef56:featurewallpaper', 'prep'));
  check('and that row still accepts its own single step',
    tickAllowedByModel(published, 'room:ef56:featurewallpaper', 'done'));
  check('an unknown step is rejected',
    !tickAllowedByModel(published, 'room:ab12:ceiling', 'sanded'));
  check('an over-long key is rejected',
    !tickAllowedByModel(published, 'room:' + 'x'.repeat(400) + ':ceiling', 'prep'));
  check('a model with no rows is refused outright',
    normaliseSpecModel({ jobName: 'x', stages: renamed.stages, rows: [] }) === null);
  check('a row naming a stage the model does not declare is dropped',
    normaliseSpecModel({ jobName: 'x', stages: [{ key: 'wall', label: 'Walls' }],
      rows: [{ key: 'a', stage: 'nope', steps: ['done'] }] }) === null);

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('\nJob spec sheet\n');
  pass.forEach(n => console.log('  ✓ ' + n));
  fail.forEach(n => console.log('  ✗ ' + n));
  console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed\n');
  process.exit(fail.length ? 1 : 0);
})();
