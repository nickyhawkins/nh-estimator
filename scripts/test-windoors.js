#!/usr/bin/env node
'use strict';

// ── Windows and doors fixture (WINDOWS_DOORS_SPEC.md) ─────────────────────
//
// Holds the rules the spec calls settled, against the shipping module
// (public/windoors.js is required directly -- the app, the server and this
// test all run the same file):
//
//   · the quote is the floor: on-site work only ever adds, prep raised on
//     site prices as the difference and never below zero
//   · prep is a job default an opening can raise and never lower
//   · every mark belongs to a stage, and quote/variation money never mixes
//   · the pricing formula of section 5, to the minute
//   · the words: the auto label, the variation text, the item line
//   · the report shows only what was done, approved variations only, and
//     carries no prices
//
// Plus a static check that public/index.html feeds the fixture into every
// money path the spec names (Summary, client quote, snapshot, Xero quote,
// final invoice, variations), since a path that forgets it prices a job
// without its windows in silence.
//
// USAGE
//   node scripts/test-windoors.js
//   npm run test:windoors

const fs = require('fs');
const path = require('path');
const W = require('../public/windoors');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));
const near = (name, got, want) =>
  check(name, Math.abs(got - want) < 1e-6, 'got:  ' + got + '\n      want: ' + want);

const R = W.mergeRates({});

// ── Rates ──────────────────────────────────────────────────────────────────
eq('defaults fill an empty blob', R.winBase.medium, 40);
eq('a saved 0 is kept, not reset to the default', W.mergeRates({ perPane: 0 }).perPane, 0);
eq('an action added later still gets a default on an old blob',
  W.mergeRates({ actions: { reputty: { mins: 5 } } }).actions.splice.mins, 60);
eq('a partially saved action keeps its default cost', W.mergeRates({ actions: { replace_glass: { mins: 5 } } }).actions.replace_glass.cost, 25);

// ── Elements ───────────────────────────────────────────────────────────────
const sash = { id: 's', kind: 'window', type: 'sash', rows: 2, cols: 3, size_tier: 'large', side: 'front', floor: 1, position: 2 };
const els = W.openingElements(sash);
eq('a 6-over-6 sash has 12 panes', els.filter(e => e.kind === 'pane').length, 12);
check('sash panes are top-N / bottom-N', els.some(e => e.id === 'top-6') && els.some(e => e.id === 'bottom-1') && !els.some(e => e.id === 'pane-1'));
check('only a sash has a meeting rail', els.some(e => e.id === 'meeting_rail')
  && !W.openingElements({ kind: 'window', type: 'casement', rows: 1, cols: 2 }).some(e => e.id === 'meeting_rail'));
eq('casement frame parts', W.openingElements({ kind: 'window', type: 'casement', rows: 1, cols: 2 })
  .filter(e => e.kind === 'part').map(e => e.id).join(','), 'head,left_stile,right_stile,bottom_rail,cill');
const door = { id: 'd', kind: 'door', type: 'half_glazed', rows: 1, cols: 2, size_tier: 'standard', side: 'front', floor: 0, position: 1 };
eq('half-glazed door: glass counts as panes', W.paneCount(door), 2);
check('door glass takes pane actions, panels take part actions',
  W.elementKind(door, 'glass-1') === 'pane' && W.elementKind(door, 'panel-1') === 'part' && W.elementKind(door, 'threshold') === 'part');
check('ironmongery is a door action only',
  W.actionsFor(door, 'part').some(a => a.key === 'ironmongery') && !W.actionsFor(sash, 'part').some(a => a.key === 'ironmongery'));
check('pane actions never offered on parts', !W.actionsFor(sash, 'part').some(a => a.key === 'reputty'));
eq('french double counts both leaves', W.paneCount({ kind: 'door', type: 'french_double', rows: 3, cols: 1 }), 6);
eq('an unknown element has no kind', W.elementKind(sash, 'pane-1'), null);

// ── Labels ─────────────────────────────────────────────────────────────────
eq('the auto label', W.openingLabel(sash), 'Front, first floor, W2');
eq('nickname after it', W.openingLabel(Object.assign({}, sash, { nickname: 'landing' })), 'Front, first floor, W2 (landing)');
eq('doors are D-numbered', W.openingCode(door), 'D1');
eq('doors sit centred among the windows', W.floorSlots(2, 1).join(','), 'window,door,window');
eq('every slot is used exactly once', W.floorSlots(4, 2).length, 6);

// ── Pricing: section 5's formula ───────────────────────────────────────────
const property = { style: 'georgian', default_prep: 'light', layout: {} };
// sash large: 55 × 1.3 = 71.5 base, + 12 panes × 4 = 119.5 painted, × 1.1 light
near('sash painted minutes', W.paintedMinutes(sash, R), 119.5);
const quoteOnly = W.priceJob({ property, openings: [sash], marks: [] }, R);
near('quote = painted × prep multiplier', quoteOnly.quote.mins, 119.5 * 1.1);
const withMarks = W.priceJob({ property, openings: [sash], marks: [
  { opening_id: 's', element_id: 'top-1', action_key: 'replace_glass', stage: 'quote' },
  { opening_id: 's', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: 'v1' },
] }, R);
near('quote marks add their minutes, not multiplied by prep', withMarks.quote.mins, 119.5 * 1.1 + 30);
near('quote marks add their material £', withMarks.quote.materials, 25);
near('variation marks price into their own variation', withMarks.variations.v1.mins, 25);
near('...with their materials', withMarks.variations.v1.materials, 4);
near('...and never into the quote', withMarks.quote.mins, quoteOnly.quote.mins + 30);
check('a mark on a deleted opening prices as nothing',
  W.priceJob({ property, openings: [sash], marks: [{ opening_id: 'gone', element_id: 'cill', action_key: 'resin', stage: 'quote' }] }, R).quote.mins === quoteOnly.quote.mins);

// ── Prep: a default, raisable, never lowered ───────────────────────────────
eq('no level of its own = the job default', W.effectivePrep({}, { default_prep: 'standard' }), 'standard');
eq('an opening can sit above the default', W.effectivePrep({ prep_level: 'heavy' }, { default_prep: 'standard' }), 'heavy');
eq('...but never below it', W.effectivePrep({ prep_level: 'light' }, { default_prep: 'heavy' }), 'heavy');

// Prep raised on site: the quote keeps its level; the variation is
// base × (new − previous).
const raised = Object.assign({}, sash, { prep_level: 'restoration', prep_stage: 'variation', quote_prep_level: 'light', prep_variation_id: 'v2' });
const pr = W.priceJob({ property, openings: [raised], marks: [] }, R);
near('prep raised on site leaves the quote as it was', pr.quote.mins, quoteOnly.quote.mins);
near('the raise is priced as the difference', pr.variations.v2.mins, 119.5 * (1.75 - 1.1));
// A raise the default has since overtaken is worth nothing -- never negative.
const overtaken = W.priceJob({ property: { default_prep: 'restoration' },
  openings: [Object.assign({}, raised, { prep_level: 'standard', quote_prep_level: 'light' })], marks: [] }, R);
check('a raise is never negative', !overtaken.variations.v2 || overtaken.variations.v2.mins >= 0);
eq('the quote prices the level before the raise', W.quotePrep(raised, property), 'light');

// ── Words ──────────────────────────────────────────────────────────────────
const data = { property, openings: [sash, door], marks: [
  { opening_id: 's', element_id: 'top-1', action_key: 'reputty', stage: 'variation', variation_id: 'v1' },
  { opening_id: 's', element_id: 'top-2', action_key: 'reputty', stage: 'variation', variation_id: 'v1' },
  { opening_id: 's', element_id: 'top-3', action_key: 'reputty', stage: 'variation', variation_id: 'v1' },
  { opening_id: 's', element_id: 'bottom-1', action_key: 'reputty', stage: 'variation', variation_id: 'v1' },
  { opening_id: 's', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: 'v1' },
  { opening_id: 'd', element_id: 'frame', action_key: 'filler', stage: 'quote' },
] };
eq('the spec\'s own example variation text', W.describeVariation(data, 'v1'),
  'Front, first floor, W2: reputty x4 panes, resin repair (cill).');
eq('a variation with nothing in it says nothing', W.describeVariation(data, 'nope'), '');
eq('the item line: windows before doors, then quoted work',
  W.itemLineText(data), 'Exterior windows and doors (outside faces): 1 sash window, 1 front door. Includes filler x1.');
eq('item line pluralises', W.itemLineText({ openings: [sash, Object.assign({}, sash, { id: 't', position: 3 })], marks: [] }),
  'Exterior windows and doors (outside faces): 2 sash windows.');
eq('an upstairs door reads as a balcony door',
  W.itemLineText({ openings: [Object.assign({}, door, { floor: 1 })], marks: [] }), 'Exterior windows and doors (outside faces): 1 balcony door.');

// ── Paint areas ────────────────────────────────────────────────────────────
// The TIMBER on the outside face, not the opening: a window is mostly glass.
// Its own size tier's area × its type's timber share (+ glazing bars per
// extra pane, capped); a door's leaf × its timber share + the frame.
const win = (type, tier, rows, cols) => ({ kind: 'window', type, size_tier: tier, rows, cols });
near('a Medium 6-over-6 sash is 0.75m² × the capped 0.6 share', W.openingPaintM2(win('sash', 'medium', 2, 3), R), 0.45);
near('a Large one is twice that', W.openingPaintM2(win('sash', 'large', 2, 3), R), 0.9);
near('a 2-over-2 sash: fewer bars, less timber', W.openingPaintM2(win('sash', 'medium', 1, 2), R), 0.75 * (0.4 + 3 * 0.02));
near('a single-pane fixed light is its base share', W.openingPaintM2(win('fixed', 'medium', 1, 1), R), 0.75 * 0.25);
check('no window paints more than its whole outline',
  ['small', 'medium', 'large', 'xlarge'].every(t => ['casement', 'sash', 'fixed'].every(ty =>
    W.openingPaintM2(win(ty, t, 8, 8), R) <= R.paint.area[t] + 1e-9)));
near('a panelled door is leaf + frame', W.openingPaintM2({ kind: 'door', type: 'panelled', size_tier: 'standard' }, R), 1.75 + 0.4);
check('a glazed door paints less than a panelled one',
  W.openingPaintM2({ kind: 'door', type: 'fully_glazed', size_tier: 'standard' }, R) < 2.15);
near('french doors are two leaves', W.openingPaintM2({ kind: 'door', type: 'french_double', size_tier: 'standard' }, R), (1.75 * 0.45 + 0.4) * 2);
near('the shares are Rates figures', W.openingPaintM2(win('sash', 'medium', 2, 3), W.mergeRates({ paint: { cap: 0.5 } })), 0.375);
const pa = W.paintAreas({ openings: [sash, door] }, R);
check('windows and doors are totalled apart (two colours)',
  Math.abs(pa.window - 0.9) < 1e-9 && Math.abs(pa.door - (1.75 * 0.75 + 0.4)) < 1e-9 && pa.windows === 1 && pa.doors === 1);

// ── Drawings ───────────────────────────────────────────────────────────────
const layoutData = { property: { style: 'victorian', default_prep: 'light', layout: { front: { floors: [{ windows: 2, doors: 1 }, { windows: 3, doors: 0 }], confirmed: true } } },
  openings: [sash, door], marks: data.marks };
['georgian', 'victorian', 'modern'].forEach(style => ['front', 'left'].forEach(side => {
  const svg = W.elevationSvg(Object.assign({}, layoutData, { property: Object.assign({}, layoutData.property, { style }) }), side, { interactive: true });
  check(style + ' ' + side + ' elevation is an svg', /^<svg[\s\S]*<\/svg>$/.test(svg));
}));
const elev = W.elevationSvg(layoutData, 'front', { interactive: true });
check('real openings are tappable by id', elev.indexOf('data-open-id="s"') >= 0 && elev.indexOf('data-open-id="d"') >= 0);
check('quote work gets a solid badge and variation work a dashed one', /stroke-dasharray="2 1.6"/.test(elev));
const det = W.detailSvg(sash, data.marks, { interactive: true, selected: { 'top-5': true } });
check('every element is tappable in the detail view', W.openingElements(sash).every(e => det.indexOf('data-el="' + e.id + '"') >= 0));
check('variation marks draw dashed', /stroke-dasharray="4 3"/.test(det));

// ── Report ─────────────────────────────────────────────────────────────────
const noApproval = W.reportModel(data, []);
eq('an unapproved variation is not in the report', noApproval.sections.filter(s => s.variations.length).length, 0);
eq('...but quoted work is', noApproval.sections.map(s => s.label).join('|'), 'Front, ground floor, D1');
const approved = W.reportModel(data, [{ id: 'v1', status: 'approved', approvedAt: '2026-09-20T10:00:00Z' }]);
eq('an approved variation is', approved.sections.length, 2);
eq('...with what was done', approved.sections.find(s => s.opening.id === 's').variations[0].text, 'Reputty x4 panes, resin repair (cill)');
const html = W.reportHtml(data, [{ id: 'v1', status: 'approved', approvedAt: '2026-09-20T10:00:00Z' }]);
check('the report carries no prices', !/£|\d+\.\d\d\b/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '')));
check('the report dates the approval', html.indexOf('approved 20 Sep 2026') >= 0);
check('openings with no work are left out',
  W.reportModel({ property, openings: [sash, door], marks: [] }, []).sections.length === 0);
eq('an empty report is an empty string', W.reportHtml({ property, openings: [sash], marks: [] }, []), '');

// ── The app feeds the fixture into every money path ────────────────────────
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const body = name => {
  let at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) return '';
  const next = SRC.slice(at + 10).search(/\n(async )?function /) + at + 10;
  return SRC.slice(at, next);
};
[
  ['renderSummary', 'calcWindoors()'],
  ['buildClientQuoteModel', 'calcWindoors()'],
  ['buildAcceptedQuoteSnapshot', 'calcWindoors()'],
  ['buildFinalInvoiceModel', 'calcWindoors()'],
  ['buildFinalInvoiceModel', 'windoorsVariationLines('],
  ['computeVariationsView', 'windoorsVariationLines('],
  ['buildClientVariationLines', 'windoorsVariationLines('],
  ['buildVariationQuoteLines', 'windoorsVariationLines('],
  ['findVariationEntry', "kind === 'windoors'"],
  ['variationRawOf', "'windoors'"],
  ['loadActiveJobData', 'loadWindoors('],
  // Paint: joins the exterior woodwork rows, is an area on the Colours tab,
  // and can be coloured from there.
  ['computeMaterials', 'windoorsPaintItems()'],
  ['colourAreas', 'windoorsPaintItems()'],
  ['setAreaColourNumber', "ref.kind === 'windoors'"],
].forEach(([fn, needle]) => check(fn + ' includes the windows and doors fixture', body(fn).indexOf(needle) >= 0));
check('the Xero quote carries it as a line', /exteriorData\.push\(\{ label: windoorsLineText\(\)/.test(SRC));
check('the shell loads the shared module', SRC.indexOf('<script src="/windoors.js"></script>') >= 0);
check('the server accepts the windoors variation kind', require('../lib/clientQuote').VARIATION_KINDS.has('windoors'));
check('the service worker precaches the module',
  /CORE = \[[^\]]*'\/windoors\.js'/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8')));

// Variations must not be subtracted from original scope: they were never in
// it. computeVariationsView's *All accumulators are what Summary takes off.
const cvv = body('computeVariationsView');
const wdPart = cvv.slice(cvv.indexOf('windoorsVariationLines('), cvv.indexOf('// ── Extra work inside'));
check('windoors variations stay out of the original-scope subtraction', wdPart && !/varLabourAll|varTimeAll/.test(wdPart));

console.log(pass.length + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  ✗ ' + f));
process.exit(fail.length ? 1 : 0);
