#!/usr/bin/env node
'use strict';

// ── Regression test: finish paper takes the surface out of the paint ───────
//
// Reported 2026-09-05: "Calculating wall paint on a room that's papered
// gives materials that aren't needed."
//
// A room is measured the ordinary way -- coats default to 2 -- and then
// papered. Nothing anywhere told the calc that the walls it was pricing
// paint for were about to disappear under wallpaper, so the job bought wall
// emulsion it would never open AND charged the client for painting walls
// nobody was going to paint. A papered FEATURE wall had been carved out of
// the paint since the feature-wall toggle shipped; the room's own walls and
// ceiling never were.
//
// The rule this test holds still:
//
//   FINISH paper on a surface  -> no paint litres, no paint labour.
//   LINING paper on its own    -> nothing changes. Lining is hung to BE
//                                 painted over ("line out, then hang
//                                 finish" is both toggles on), so a lined
//                                 wall keeps its coats, litres and labour.
//                                 Setting the coats to 0 is still how you
//                                 say "don't paint this" by hand.
//
// And the property that matters just as much: a room with NO wallpaper on
// it must price byte-for-byte as it did before, since every ordinary job is
// one of those.
//
// Pure node against the real source: calcRoom() and its whole dependency
// closure are extracted out of public/index.html by brace matching and
// evaluated with a real settings object (built by the app's own
// mergeSettings over SETTINGS_FIELDS). No database, no browser, no server.
//
// USAGE
//   node scripts/test-papered-paint.js
//   npm run test:papered

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Extraction ─────────────────────────────────────────────────────────────
// Brace-matched, same helper as test-scope-text.js.
function sliceBalanced(src, startIdx, open, close) {
  const from = src.indexOf(open, startIdx);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(startIdx, i + 1);
  }
  throw new Error('unbalanced ' + open + ' from index ' + startIdx);
}
function fnBody(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('function ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, '{', '}');
}
function varBody(name, open, close) {
  const at = SRC.indexOf('\nvar ' + name + ' = ');
  if (at < 0) throw new Error('var ' + name + ' not found in public/index.html');
  return sliceBalanced(SRC, at + 1, open, close) + ';';
}

// Every top-level function public/index.html declares -- the vocabulary the
// closure walk below recognises.
const DECLARED = new Set();
{
  const re = /\nfunction ([A-Za-z0-9_$]+)\s*\(/g;
  let m; while ((m = re.exec(SRC))) DECLARED.add(m[1]);
}

// calcRoom's dependency closure, walked rather than hand-listed: the calc
// engine gets refactored constantly and a hand-listed set goes stale
// silently (a missing name is a ReferenceError, but a name that MOVED into
// a new helper is a test quietly running against less than it thinks).
// Comments are stripped first -- this file's comments name functions with
// their parens, and counting those pulls in half the app.
function closureFrom(root) {
  const strip = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const seen = new Set(), order = [];
  (function walk(name) {
    if (seen.has(name)) return;
    seen.add(name); order.push(name);
    const body = strip(fnBody(name));
    // Whole-word, not "name(" -- a helper can be PASSED rather than called
    // (doorFrameLabourCost picks doorMins vs an inline function by kind),
    // and a closure that only follows call sites misses those entirely.
    const re = /[A-Za-z0-9_$]+/g;
    let m; while ((m = re.exec(body))) if (DECLARED.has(m[0]) && m[0] !== name) walk(m[0]);
  })(root);
  return order;
}

const api = {};
new Function('exports', [
  varBody('SETTINGS_FIELDS', '[', ']'),
  varBody('KITCHEN_RATE_DEFAULTS', '{', '}'),
  fnBody('mergeSettings'),
  'var settings = mergeSettings(null);',
  ...closureFrom('calcRoom').map(fnBody),
  'exports.calcRoom = calcRoom;',
  'exports.settings = settings;'
].join('\n'))(api);

const calc = r => api.calcRoom(Object.assign({}, r));

// ── The fixture ────────────────────────────────────────────────────────────
// An ordinary 4 x 3 x 2.4 room, measured the way every room is: walls,
// ceiling and woodwork at 2 coats. The wallpaper fields below are added to
// THIS, never instead of it -- the whole bug is that a room gets papered
// without anyone going back to zero the coats.
const ROOM = { l: 4, w: 3, h: 2.4, wc: 2, cc: 2, xc: 2, shapeMode: 'box' };
const WP = { wpRollLen: 10.05, wpRollWidth: 0.53, wpMatch: 'none' };
const room = extra => Object.assign({}, ROOM, WP, extra);

const plain = calc(room({}));
check('the fixture is a room with real paint on it',
  plain.wallL > 0 && plain.ceilL > 0 && plain.wallCost > 0 && plain.ceilCost > 0,
  JSON.stringify({ wallL: plain.wallL, ceilL: plain.ceilL }));

// ── 1. Finish paper: no litres, no labour ──────────────────────────────────
const paperedWalls = calc(room({ wpWallFinish: true }));
eq('finish paper on the walls buys no wall emulsion', paperedWalls.wallL, 0);
eq('and charges no wall painting labour', paperedWalls.wallCost, 0);
check('but the papering itself is still priced', paperedWalls.wpwCost > 0, paperedWalls.wpwCost);
eq('the ceiling above papered walls is untouched', paperedWalls.ceilL, plain.ceilL);
eq('and so is the woodwork', paperedWalls.glossL, plain.glossL);

const paperedCeiling = calc(room({ wpCeilFinish: true }));
eq('finish paper on the ceiling buys no ceiling emulsion', paperedCeiling.ceilL, 0);
eq('and charges no ceiling painting labour', paperedCeiling.ceilCost, 0);
eq('the walls under a papered ceiling are untouched', paperedCeiling.wallL, plain.wallL);

const paperedBoth = calc(room({ wpWallFinish: true, wpCeilFinish: true }));
eq('walls and ceiling both papered — no wall emulsion', paperedBoth.wallL, 0);
eq('walls and ceiling both papered — no ceiling emulsion', paperedBoth.ceilL, 0);

// ── 2. Lining paper is hung to be painted over ─────────────────────────────
const lined = calc(room({ wpWallLining: true }));
eq('lining alone keeps the wall emulsion', lined.wallL, plain.wallL);
eq('lining alone keeps the wall painting labour', lined.wallCost, plain.wallCost);
const linedThenPapered = calc(room({ wpWallLining: true, wpWallFinish: true }));
eq('line out THEN hang finish — the finish still wins, no emulsion', linedThenPapered.wallL, 0);
eq('line out THEN hang finish — and no wall labour', linedThenPapered.wallCost, 0);
const linedCeiling = calc(room({ wpCeilLining: true }));
eq('a lined ceiling keeps its emulsion', linedCeiling.ceilL, plain.ceilL);

// ── 3. Coats 0 still works, and still means the same thing ─────────────────
eq('zero wall coats buys nothing, papered or not', calc(room({ wc: 0 })).wallL, 0);
eq('zero wall coats charges nothing either', calc(room({ wc: 0 })).wallCost, 0);

// ── 4. A painted feature wall inside a papered room ────────────────────────
// The feature wall is its own measured wall with its own paint. The room's
// walls losing theirs must not take it down too -- and since the room's
// general wall labour is now zero, the feature wall needs the same own-line
// treatment a feature-wall-only room has always had, or it would be
// painted, described and never charged for.
const FW = { featureWallArea: 8.4, featureWallWidth: 3.5, featureWallHeight: 2.4 };
const fwInPapered = calc(room(Object.assign({ wpWallFinish: true }, FW)));
check('a painted feature wall in a papered room still buys its paint',
  fwInPapered.featureWallL > 0, fwInPapered.featureWallL);
check('and still earns labour, since the room-wide wall labour is gone',
  fwInPapered.wallCost === 0 && fwInPapered.total > paperedWalls.total,
  JSON.stringify({ wallCost: fwInPapered.wallCost, total: fwInPapered.total, papered: paperedWalls.total }));
eq('the papered walls around it still buy nothing', fwInPapered.wallL, 0);
// wallLCombined is the same-paint bucket computeMaterials() buys from when
// the feature wall shares the walls' paint: with the walls papered it must
// be the feature wall alone, not the whole room's area.
eq('the combined same-paint bucket holds the feature wall alone',
  fwInPapered.wallLCombined, fwInPapered.featureWallL);
// A PAPERED feature wall in a papered room: nothing painted anywhere.
const allPapered = calc(room(Object.assign({ wpWallFinish: true, featureWallMode: 'wallpaper',
                                             fwWpFinish: true }, FW)));
eq('everything papered — no wall paint at all', allPapered.wallL, 0);
eq('everything papered — no feature wall paint either', allPapered.featureWallL, 0);
eq('everything papered — and no wall labour', allPapered.wallCost, 0);

// ── 5. The no-movement property ────────────────────────────────────────────
// Every ordinary job is a room with no wallpaper on it, and none of them
// may move by a penny or a half-litre.
const NO_PAPER_CASES = {
  'bare room': {},
  'walls only': { cc: 0, xc: 0 },
  'three coats': { wc: 3, cc: 3, xc: 3 },
  'painted feature wall': FW,
  'feature wall in its own paint': Object.assign({ featurewallRangeOverride: 'F&B Estate' }, FW),
  'feature-wall-only room': Object.assign({ l: 0, w: 0, h: 0 }, FW),
  'sprayed walls': { sprayWalls: true },
  'mist coat on new plaster': { mistWall: true, mistCeil: true },
  'doors and frames': { doorQty: 2, doorCoats: 2, frameQty: 2, frameCoats: 2 },
  'panelling': { panelItems: [{ width: 3, height: 1.2, coats: 2 }] },
  'excluded wall': { excludedWalls: [{ width: 2, height: 2.4 }] },
  'segments shape': { shapeMode: 'segments', segments: [{ l: 4, w: 3 }, { l: 2, w: 1.5 }] },
  'a total override': { totalOverride: 1234 }
};
// [total, wall litres, ceiling litres] as the calc engine gave them BEFORE
// this rule existed, captured off the previous commit's public/index.html.
// Real golden figures, not a same-source comparison: the point of a
// no-movement test is that it fails when the live code drifts, and figures
// derived from the live code can't do that. Recompute them deliberately (and
// say why in the commit) if a rate default or a coverage figure legitimately
// changes; never to make a red test go green.
const BEFORE = {
  'bare room':                     [309.714286, 5.5, 2],
  'walls only':                    [144,        5.5, 0],
  'three coats':                   [464.571429, 8,   3],
  'painted feature wall':          [309.714286, 4,   2],
  'feature wall in its own paint': [309.714286, 4,   2],
  'feature-wall-only room':        [36,         0,   0],
  'sprayed walls':                 [309.714286, 7,   2],
  'mist coat on new plaster':      [374.857143, 5.5, 2],
  'doors and frames':              [361.428571, 5,   2],
  'panelling':                     [340.571429, 5.5, 2],
  'excluded wall':                 [289.142857, 4.5, 2],
  'segments shape':                [443.142857, 8,   2.5],
  'a total override':              [1234,       5.5, 2]
};
Object.keys(NO_PAPER_CASES).forEach(function(name) {
  const want = BEFORE[name];
  // Both shapes a room without wallpaper can arrive in: no wallpaper fields
  // at all, and an inert set of them (roll spec typed, no surface toggled).
  [['', api.calcRoom(Object.assign({}, ROOM, NO_PAPER_CASES[name]))],
   [' with an inert roll spec', calc(room(NO_PAPER_CASES[name]))]].forEach(function(pair) {
    const got = pair[1];
    eq('no movement — ' + name + pair[0] + ' (total)', +got.total.toFixed(6), want[0]);
    eq('no movement — ' + name + pair[0] + ' (wall litres)', got.wallL, want[1]);
    eq('no movement — ' + name + pair[0] + ' (ceiling litres)', got.ceilL, want[2]);
  });
});

// Lining paper is the other half of "nothing moves": it was priced as
// paint-plus-papering before this change and must still be.
eq('lining alone prices exactly as it did before the rule existed',
  +lined.total.toFixed(6), 519.714286);

// ── Report ─────────────────────────────────────────────────────────────────
pass.forEach(n => console.log('  ok   ' + n));
fail.forEach(n => console.log('  FAIL ' + n));
console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
