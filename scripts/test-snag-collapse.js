#!/usr/bin/env node
'use strict';

// ── Regression test: folding the snag list's groups ────────────────────────
//
// The snag list on a real job is long -- forty snags across ten rooms is an
// ordinary end-of-job list -- and on a phone that is a lot of scrolling to
// get to the room you are standing in. So every group heading folds.
//
// What is held here is the behaviour that makes folding safe to leave on:
//
//   1. An untapped group is open while it still has work in it, and folded
//      once it hasn't -- the same rule the section itself follows when the
//      last snag is ticked off.
//   2. Except on a job with nothing open anywhere: the cleared record is only
//      on screen because someone asked for it, so it opens in full.
//   3. A tap is remembered and beats the default in both directions.
//   4. The fold is per view: folding Landing under By room must not fold
//      anything under By phase, and the two views' keys cannot collide.
//   5. A folded group still says how much is in it -- the heading keeps its
//      "n open" / "all done ✓" count, so nothing goes missing by folding.
//   6. A group holding the open snag editor renders open regardless, because
//      folding a room out from under a half-typed edit reads as a lost edit.
//   7. Fold-all/open-all covers exactly the groups of the view on screen.
//
// Pure node against the real public/index.html: the snag section of the app's
// own script is evaluated in a vm with the handful of globals it reaches
// outside itself stubbed, so the code under test is the code that ships. No
// browser, no server, no database.
//
// USAGE
//   node scripts/test-snag-collapse.js
//   npm run test:snags

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Lift the snag section out of index.html ────────────────────────────────
// By its own banner comments rather than by line number, so the slice follows
// the code when it moves.
const START = "// ── Snags (the job's punch list)";
const END = '// ── Snags: the room-colour sheet';
const a = SRC.indexOf(START), b = SRC.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error('Could not find the snag section in public/index.html.');
  console.error('If its banner comments were renamed, update START/END here.');
  process.exit(2);
}
const SNAG_SRC = SRC.slice(a, b);

// The globals the snag code reaches outside its own section. Everything else
// it needs it defines itself.
const sandbox = {
  colours: [],            // no colour names: headings show none, which is fine here
  renderActuals() { sandbox.renders++; },
  renders: 0,
  escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  uid: () => 'x',
  alert() {}, confirm: () => false, console,
  apiGet: async () => [], apiPutStrict: async () => ({}), apiDeleteStrict: async () => ({}),
  activeJobId: 'job-1',
};
vm.createContext(sandbox);
vm.runInContext(SNAG_SRC, sandbox, { filename: 'index.html (snags)' });

// The rooms the job priced, in house order. Overridden wholesale rather than
// stubbing the twenty globals snagAreas() reads, none of which this is about.
const AREAS = [
  { name: 'Hallway', colour: '' },
  { name: 'Landing', colour: '' },
  { name: 'Master Bedroom', colour: '' },
];
vm.runInContext('snagAreas = function() { return ' + JSON.stringify(AREAS) + '; };', sandbox);

let nextId = 0;
const snag = (room, desc, phase, done) => ({
  id: 's' + (++nextId), roomLabel: room, description: desc,
  phase: phase || '', status: done ? 'done' : 'open',
  completedAt: done ? '2026-09-01T10:00:00Z' : null, sortOrder: nextId,
});

// The fixture: two rooms with work left, one finished with.
const setUp = list => {
  sandbox.snags = list;
  sandbox.snagCollapsed = {};
  sandbox.snagEditId = null;
  sandbox.snagView = 'rooms';
};
const LIVE = () => [
  snag('Hallway', 'Touch in behind the radiator', 'walls'),
  snag('Hallway', 'Scuff on the return wall', '', true),
  snag('Landing', 'Recoat the handrail', 'woodwork'),
  snag('Master Bedroom', 'Ceiling patch', 'ceiling', true),
  snag('Master Bedroom', 'Skirting nick', 'woodwork', true),
];

const groups = () => vm.runInContext('snagGroupsForView()', sandbox);
const groupFor = label => groups().find(g => g.label === label);
const collapsed = label => sandbox.snagGroupCollapsed(groupFor(label));
const html = () => vm.runInContext('snagListHtml()', sandbox);
const shows = (h, text) => h.indexOf(text) >= 0;

// ── 1/2. The default: folded once a group has nothing left open ────────────
setUp(LIVE());
eq('a room with work left is open by default', collapsed('Hallway'), false);
eq('a room with work left is open even with a done row in it', collapsed('Landing'), false);
eq('a room with nothing open folds by default', collapsed('Master Bedroom'), true);

setUp(LIVE().map(s => ({ ...s, status: 'done', completedAt: '2026-09-01T10:00:00Z' })));
check('with nothing open anywhere, every group opens',
  groups().every(g => !sandbox.snagGroupCollapsed(g)),
  groups().map(g => g.label + '=' + sandbox.snagGroupCollapsed(g)).join(', '));

// ── 3. A tap beats the default, both ways ──────────────────────────────────
setUp(LIVE());
let i = groups().findIndex(g => g.label === 'Hallway');
html();                       // fills snagGroupsCache, which toggleSnagGroup reads
sandbox.toggleSnagGroup(i);
eq('tapping an open room folds it', collapsed('Hallway'), true);
eq('the fold repaints', sandbox.renders > 0, true);
sandbox.toggleSnagGroup(i);
eq('tapping it again opens it', collapsed('Hallway'), false);

i = groups().findIndex(g => g.label === 'Master Bedroom');
html();
sandbox.toggleSnagGroup(i);
eq('a finished room can be opened back up', collapsed('Master Bedroom'), false);
check('and it stays open across a repaint', !collapsed('Master Bedroom'));

// ── 4. The fold is per view, and the two views cannot collide ──────────────
setUp(LIVE());
html();
sandbox.toggleSnagGroup(groups().findIndex(g => g.label === 'Hallway'));
eq('folded under By room', collapsed('Hallway'), true);
sandbox.snagView = 'phases';
check('By phase is untouched by a fold made By room',
  groups().every(g => !sandbox.snagGroupCollapsed(g) || !g.items.some(sandbox.snagIsOpen)),
  groups().map(g => g.label + '=' + sandbox.snagGroupCollapsed(g)).join(', '));
sandbox.snagView = 'rooms';
eq('and the room fold survived the round trip', collapsed('Hallway'), true);

// A room called Walls and the Walls phase must not share a fold.
setUp([snag('Walls', 'Cupboard door', 'walls'), snag('Hallway', 'Radiator', 'walls')]);
html();
sandbox.toggleSnagGroup(groups().findIndex(g => g.label === 'Walls'));
sandbox.snagView = 'phases';
const wallsPhase = groups().find(g => g.key === 'walls');
check('a room named after a phase does not fold that phase',
  wallsPhase && !sandbox.snagGroupCollapsed(wallsPhase));

// ── 5. A folded heading still carries its count ────────────────────────────
setUp(LIVE());
let h = html();
check('a folded room keeps its heading', shows(h, 'Master Bedroom'));
check('a folded room says it is done', shows(h, 'all done ✓'));
check('a folded room hides its rows', !shows(h, 'Ceiling patch'));
check('an open room shows its rows', shows(h, 'Touch in behind the radiator'));
check('an open room heading counts what is left', shows(h, '1 open'));
check('every heading offers a chevron', (h.match(/sec-chev/g) || []).length === groups().length,
  'chevrons: ' + (h.match(/sec-chev/g) || []).length + ', groups: ' + groups().length);
check('an open heading chevron is turned', shows(h, 'sec-chev open'));

// The colour chip sits inside the heading's tap target, so its click must not
// reach the fold -- tapping "+ colour" is not tapping the room.
setUp([snag('Airing cupboard', 'Shelf edge', '')]);
h = html();
check('the colour chip stops the click reaching the fold',
  shows(h, 'event.stopPropagation();openSnagColourPanel('));

// ── 6. The open editor is never folded away ────────────────────────────────
setUp(LIVE());
sandbox.snagEditId = sandbox.snags.find(s => s.description === 'Ceiling patch').id;
h = html();
check('a folded room opens to hold the snag being edited', shows(h, 'snag-edit-desc'));

// ── 7. Fold all / open all, on the view in front of you ────────────────────
setUp(LIVE());
sandbox.setAllSnagGroups(true);
check('fold all folds every group', groups().every(g => sandbox.snagGroupCollapsed(g)));
sandbox.setAllSnagGroups(false);
check('open all opens every group', groups().every(g => !sandbox.snagGroupCollapsed(g)));
sandbox.snagView = 'phases';
sandbox.setAllSnagGroups(true);
sandbox.snagView = 'rooms';
check('folding every phase leaves the rooms as they were',
  groups().every(g => !sandbox.snagGroupCollapsed(g)));

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ✓ ' + n));
fail.forEach(n => console.log('  ✗ ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
