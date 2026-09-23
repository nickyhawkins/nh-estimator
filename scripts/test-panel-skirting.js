#!/usr/bin/env node
'use strict';

// ── Regression test: skirting painted with the panelling ───────────────────
//
// A panelling row flagged `skirting` takes its width off the room's skirting
// run (woodwork labour AND woodwork topcoat/primer litres) and prices
// width x SKIRTING_HEIGHT_M on the panelling instead, at that row's coats,
// the panelling rate and the panelling's own prep, out of the panel tin.
// Held here:
//
//   1. NO MOVEMENT for rooms saved before the flag existed -- a row with no
//      `skirting` prices byte-identically to before.
//   2. The skirting run shrinks by exactly the flagged widths, never below 0.
//   3. The panelling picks up exactly that skirting's m² at its own coats.
//   4. A half-filled row (no height) moves nothing, same "0 to skip" rule.
//   5. HSL rooms don't deduct twice (their woodwork overrides arrive net).
//
// Pure node against the real source: calcRoom() and its pricing helpers are
// extracted out of public/index.html by name; the wallpaper/coverage
// machinery this test isn't about is stubbed to "nothing".
//
// USAGE
//   node scripts/test-panel-skirting.js
//   npm run test:panel-skirting

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const near = (name, got, want) =>
  check(name, Math.abs(got - want) < 1e-9, 'got:  ' + got + '\n      want: ' + want);

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
function extractScalarVar(name) {
  const m = SRC.match(new RegExp('\\nvar ' + name + ' = [^;]+;'));
  if (!m) throw new Error('var ' + name + ' not found in public/index.html');
  return m[0];
}
function extractOneLiner(name) {
  const m = SRC.match(new RegExp('\\nfunction ' + name + '\\([^\\n]*'));
  if (!m) throw new Error('function ' + name + ' not found in public/index.html');
  return m[0];
}

const code = `
  var settings = { dr: 210, hpd: 7, rWall: 3, rCeil: 5, rSkirt: 4, rWin: 35, rRad: 15, rSill: 15,
    rMist: 2, rPanel: 6, cw: 13, cc: 17, cg: 9, cMist: 15, cPanel: 8, sprayUpliftPct: 30,
    rDoorPrep: 10, rDoorCoat: 10, rFramePrep: 5, rFrameCoat: 6,
    doorFaceAreaM2: 1.75, doorFrameAreaM2: 0.4, doorEdgeAreaM2: 0.3,
    fireDoorSurcharge: 10, ironmongeryRemovePrice: 8, ironmongeryMaskPrice: 4, wpMinPrice: 200 };
  function migrateWPFields() {}
  function migrateDoorFields() {}
  function effectiveRoleRange() { return ''; }
  function coverageRateFor() { return null; }
  function coverageSelfPrimingFor() { return null; }
  function wpSurfaceResult() { return { cost: 0, parts: [] }; }
  function roomWallpaperCount() { return { rolls: 0, drops: 0 }; }
  function featureWallWallpaperCount() { return { rolls: 0, drops: 0 }; }
  function sumWallpaperDrops() { return 0; }
  function vinylCost() { return { cost: 0, metres: 0 }; }
  function muralCost() { return { cost: 0, area: 0 }; }
  ${['rpm', 'wallMins', 'ceilMins', 'skirtMins', 'doorMins', 'frameMins', 'winMins', 'radMins', 'sillMins'].map(extractOneLiner).join('\n')}
  ${['doorFrameLabourCost', 'doorFrameAreaCoats', 'doorFrameExtrasCost',
     'roomShapePerimeter', 'roomShapeCeilArea', 'calcPanel', 'panelSkirtLM', 'calcRoom'].map(extractFn).join('\n')}
  ${extractScalarVar('SKIRTING_HEIGHT_M')}
  this.api = { calcRoom: calcRoom, rpm: rpm, settings: settings, SKIRTING_HEIGHT_M: SKIRTING_HEIGHT_M };
`;
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);
const { calcRoom, rpm, settings, SKIRTING_HEIGHT_M } = ctx.api;

// Annie's Room from the report: 3.67 x 3.34 x 2.4, walls/ceiling/woodwork
// 2 coats, minimal prep, panelling on two walls.
const base = () => ({
  l: 3.67, w: 3.34, h: 2.4, wc: 2, cc: 2, xc: 2, win: 0, rads: 0, sills: 0,
  prepPct: 10, panelPrepPct: 10, shapeMode: 'box'
});
const perim = (3.67 + 3.34) * 2;
const r2 = rpm();

near('SKIRTING_HEIGHT_M is the 0.15 the woodwork basis always assumed', SKIRTING_HEIGHT_M, 0.15);

// 1. No movement: rows without the flag price as before.
const legacyRoom = Object.assign(base(), { panelItems: [
  { width: 3.67, height: 1.2, coats: 2, deduct: true },
  { width: 3.34, height: 1.2, coats: 2, deduct: true }
]});
const legacy = calcRoom(legacyRoom);
near('unflagged: woodwork labour is the full perimeter at the skirting rate', legacy.woodCost, perim * 4 * 2 * r2);
near('unflagged: panelling labour is just the panels', legacy.panelRawCost, (3.67 + 3.34) * 1.2 * 2 * 6 * r2);
near('unflagged: no skirting on the panelling', legacy.panelSkirtLM, 0);
near('unflagged: woodwork litres off the full perimeter', legacy.glossL, Math.ceil(perim * 0.15 * 2 / 9 * 1.3 * 2) / 2);

// 2 + 3. Flag both walls.
const flaggedRoom = Object.assign(base(), { panelItems: [
  { width: 3.67, height: 1.2, coats: 2, deduct: true, skirting: true },
  { width: 3.34, height: 1.2, coats: 2, deduct: true, skirting: true }
]});
const flagged = calcRoom(flaggedRoom);
const netPerim = perim - (3.67 + 3.34);
near('flagged: skirting run loses exactly the flagged widths', flagged.woodCost, netPerim * 4 * 2 * r2);
near('flagged: panelling reports the skirting it took on', flagged.panelSkirtLM, 3.67 + 3.34);
near('flagged: panelling area gains width x 0.15 per flagged wall', flagged.panelArea, (3.67 + 3.34) * 1.2 + (3.67 + 3.34) * 0.15);
near('flagged: panelling labour at its own coats and rate', flagged.panelRawCost, (3.67 + 3.34) * (1.2 + 0.15) * 2 * 6 * r2);
near('flagged: panelling prep applies to the skirting too', flagged.panelCost, flagged.panelRawCost * 1.1);
near('flagged: woodwork litres off the net perimeter', flagged.glossL, Math.ceil(netPerim * 0.15 * 2 / 9 * 1.3 * 2) / 2);
near('flagged: panel litres include the skirting', flagged.panelL, Math.ceil((3.67 + 3.34) * 1.35 * 2 / 8 * 2) / 2);
near('flagged: wall area deduction untouched by the skirting flag', flagged.wallArea, legacy.wallArea);
check('flagged: the room comes out cheaper', flagged.total < legacy.total,
  'legacy ' + legacy.total.toFixed(2) + ', flagged ' + flagged.total.toFixed(2));

// Skirting at 4 mins/lm/coat vs 0.15 m² at 6 mins/m²/coat: the saving is
// exactly (4 - 0.9 x 1.1 prep) mins per lm per coat less the room prep on the
// skirting's old share. Just print it for the record.
console.log('  Annie\'s Room, both walls panelled: £' + legacy.total.toFixed(2) + ' → £' + flagged.total.toFixed(2) +
  ' (raw, before markup)');

// 2. Never below zero.
const huge = calcRoom(Object.assign(base(), { panelItems: [{ width: 40, height: 1, coats: 2, skirting: true }] }));
near('flagged widths beyond the perimeter floor the skirting at 0', huge.woodCost, 0);
near('...and the woodwork litres at 0', huge.glossL, 0);

// 4. Half-filled row moves nothing.
const half = calcRoom(Object.assign(base(), { panelItems: [{ width: 3.67, height: 0, coats: 2, skirting: true }] }));
near('a row with no height yet leaves the skirting alone', half.woodCost, perim * 4 * 2 * r2);
near('...and adds nothing to the panelling', half.panelRawCost, 0);

// Mixed: only the flagged wall's skirting moves.
const mixed = calcRoom(Object.assign(base(), { panelItems: [
  { width: 3.67, height: 1.2, coats: 2, deduct: true, skirting: true },
  { width: 3.34, height: 1.2, coats: 2, deduct: true }
]}));
near('mixed: only the flagged wall comes off the skirting', mixed.woodCost, (perim - 3.67) * 4 * 2 * r2);
near('mixed: only the flagged wall adds skirting to the panelling', mixed.panelSkirtLM, 3.67);

// 5. HSL rooms carry net overrides -- calcRoom must not deduct again.
const hsl = calcRoom(Object.assign(base(), { isHSL: true, l: 1, w: 1, h: 1,
  woodCostOverride: 50, woodAreaOverride: 2, wallAreaOverride: 20,
  panelItems: [{ width: 3, height: 1, coats: 2, skirting: true }] }));
near('HSL: woodwork cost override used as-is', hsl.woodCost, 50);
near('HSL: woodwork litres from the override area as-is', hsl.glossL, Math.ceil(2 * 2 / 9 * 1.3 * 2) / 2);
near('HSL: panelling still gains the skirting', hsl.panelSkirtLM, 3);

console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
fail.forEach((f) => console.log('  ✗ ' + f));
if (fail.length) process.exit(1);
