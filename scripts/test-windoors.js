#!/usr/bin/env node
'use strict';

// ── Windows and doors fixture (WINDOWS_DOORS_SPEC.md, and stage 2:
//    WINDOWS_DOORS_STAGE2_SPEC.md -- appearance, dormers, lower ground, bays)
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
// ── The report PDF ─────────────────────────────────────────────────────────
// The PDF writer now carries more than one image (the report's drawings, as
// JPEG). Run the real writer out of index.html: the logo-only call the quote
// and the snag list make must serialise exactly as before, and extra images
// must each become their own XObject the pages can name.
{
  const vm = require('vm');
  const grab = (name) => {
    const at = SRC.indexOf('\nfunction ' + name + '(');
    let depth = 0, i = SRC.indexOf('{', at);
    for (; i < SRC.length; i++) { if (SRC[i] === '{') depth++; else if (SRC[i] === '}' && --depth === 0) break; }
    return SRC.slice(at, i + 1);
  };
  const consts = SRC.match(/\nvar PDF_[A-Z_]+ += [^\n]*;/g).join('\n')
    + '\n' + SRC.slice(SRC.indexOf('\nvar PDF_WIDTHS = {'), SRC.indexOf('};', SRC.indexOf('\nvar PDF_WIDTHS = {')) + 2);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(consts + ['pdfSanitise', 'pdfEscape', 'pdfTextWidth', 'pdfWrap', 'pdfDoc', 'pdfLatin1', 'pdfSerialise'].map(grab).join('\n'), ctx);
  const pdf = (bytes) => Buffer.from(bytes).toString('latin1');
  const logoOnly = pdf(vm.runInContext("var d = pdfDoc(); d.text('Hi', 40, 700); d.image(40, 600, 10, 10); pdfSerialise(d, {w:1,h:1,data:new Uint8Array([1,2,3])})", ctx));
  check('the logo-only PDF still names its image Im1 as object 5', /\/XObject << \/Im1 5 0 R >>/.test(logoOnly) && /6 0 obj\n<< \/Type \/Page /.test(logoOnly));
  const report = pdf(vm.runInContext("var d = pdfDoc(); d.image(40, 600, 10, 10, 'Im2'); d.image(40, 500, 10, 10, 'Im3');"
    + " pdfSerialise(d, null, [{w:2,h:2,data:new Uint8Array([255,216,255]),filter:'DCTDecode'},{w:3,h:3,data:new Uint8Array([255,216,255]),filter:'DCTDecode'}])", ctx));
  check('extra images are Im2, Im3… with the JPEG filter', /\/Im2 5 0 R \/Im3 6 0 R/.test(report) && (report.match(/\/Filter \/DCTDecode/g) || []).length === 2);
  check('and the pages draw them by name', /\/Im2 Do Q/.test(report) && /\/Im3 Do Q/.test(report));
  const xrefCount = +(/xref\n0 (\d+)/.exec(report) || [])[1];
  check('the xref table counts every object', xrefCount === (report.match(/\d+ 0 obj\n/g) || []).length + 1);
}
check('the final invoice attaches the report when ticked',
  /s\.attachWindoorsReport !== false && result\.invoiceId/.test(body('createFinalInvoice')) && body('createFinalInvoice').indexOf('attachWindoorsReportToInvoice(') >= 0);
check('a failed attach never un-creates the invoice (it is reported beside the success)',
  body('attachWindoorsReportToInvoice').indexOf('never throws') >= 0 || /catch \(err\) \{\n\s*return \{ ok: false/.test(body('attachWindoorsReportToInvoice')));
check('the windows and doors paint carries its own product', /extTopcoatRangeOverride: prod \? prod\.range/.test(body('windoorsPaintItems')));
check('the product picker treats windows and doors as roles', /role === 'wdwindow' \|\| role === 'wddoor'/.test(body('overrideState')));

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

// ══ Stage 2 (WINDOWS_DOORS_STAGE2_SPEC.md) ══════════════════════════════════

// ── Appearance ─────────────────────────────────────────────────────────────
const gd = W.periodDefaults('georgian');
check('Georgian defaults: stucco, parapet, mid terrace, pediment, 6 over 6, railings',
  gd.finish === 'stucco' && gd.roof === 'parapet' && gd.form === 'mid_terrace' && gd.georgian.doorcase === 'pedimented_radial'
  && gd.georgian.heads === 'plain' && gd.georgian.glazing === '6_over_6' && gd.georgian.band_courses && gd.georgian.railings);
const vd = W.periodDefaults('victorian');
check('Victorian defaults: buff brick, eaves, semi, 2 over 2, keystones, arched porch, no bargeboards, plain',
  vd.finish === 'buff_brick' && vd.roof === 'eaves_to_street' && vd.form === 'semi' && vd.victorian.sash === '2_over_2'
  && vd.victorian.heads === 'stone_keystone' && vd.victorian.entrance === 'recessed_arched_porch' && !vd.victorian.bargeboards && vd.victorian.brick_detailing === 'plain');
const md = W.periodDefaults('modern');
check('Modern defaults: render, eaves, detached', md.finish === 'render' && md.roof === 'eaves_to_street' && md.form === 'detached');
// A job saved before stage 2 has only a style: its period's defaults, but
// detached -- its sides must not vanish, and no neighbours appear.
['georgian', 'victorian', 'modern'].forEach(style => {
  const a = W.appearanceOf({ style });
  check('a stage 1 ' + style + ' job reads as its period, detached', a.period === style && a.form === 'detached'
    && a.finish === W.periodDefaults(style).finish && a.roof === W.periodDefaults(style).roof);
});
eq('an appearance, once saved, wins over the style', W.appearanceOf({ style: 'georgian', appearance: { period: 'victorian' } }).period, 'victorian');
check('bad values fall back one field at a time', (() => {
  const a = W.normaliseAppearance({ period: 'victorian', finish: 'red_brick', roof: 'front_gable', victorian: { sash: 'nope', bargeboards: true } });
  return a.finish === 'buff_brick' && a.roof === 'front_gable' && a.victorian.sash === '2_over_2' && a.victorian.bargeboards === true;
})());
check('no red brick finish', !W.FINISHES.some(f => /red/.test(f.key)));
check('defaults are defaults', W.appearanceIsDefault(W.periodDefaults('victorian')));
check('a hand-changed option is noticed', !W.appearanceIsDefault(Object.assign(W.periodDefaults('victorian'), { finish: 'gault_brick' }))
  && !W.appearanceIsDefault(Object.assign(W.periodDefaults('georgian'), { georgian: Object.assign({}, gd.georgian, { railings: false }) })));
eq('detached: four sides', W.visibleSides(Object.assign({}, md)).join(','), 'front,back,left,right');
eq('semi open to the right: front, back, right', W.visibleSides(Object.assign({}, vd, { exposed_side: 'right' })).join(','), 'front,back,right');
eq('end terrace: same', W.visibleSides(Object.assign({}, vd, { form: 'end_terrace' })).join(','), 'front,back,left');
eq('mid terrace: front and back only', W.visibleSides(gd).join(','), 'front,back');
check('mid terrace: neighbours both edges', W.attachedEdges(gd, 'front').left && W.attachedEdges(gd, 'front').right);
check('semi open to the left: neighbour on the right from the front, on the left from the back',
  W.attachedEdges(vd, 'front').right && !W.attachedEdges(vd, 'front').left && W.attachedEdges(vd, 'back').left && !W.attachedEdges(vd, 'back').right);
check('ends never have neighbours', !W.attachedEdges(vd, 'left').left && !W.attachedEdges(vd, 'left').right);
eq('front gable: gable on the front', W.roofKindFor(Object.assign({}, vd, { roof: 'front_gable' }), 'front'), 'gable');
eq('front gable: eaves on the ends', W.roofKindFor(Object.assign({}, vd, { roof: 'front_gable' }), 'left'), 'eaves');
eq('eaves to street: gable ends', W.roofKindFor(vd, 'right'), 'gable');

// ── Defaults follow the appearance ─────────────────────────────────────────
const g8 = Object.assign(W.periodDefaults('georgian'), { georgian: Object.assign({}, gd.georgian, { glazing: '8_over_8' }) });
check('8 over 8 starts new sashes at 2 rows of 4', W.openingDefaults(g8, 'window', 0).rows === 2 && W.openingDefaults(g8, 'window', 0).cols === 4);
check('margin lights start 3 × 3', W.openingDefaults(Object.assign({}, vd, { victorian: Object.assign({}, vd.victorian, { sash: 'margin_lights' }) }), 'window', 0).cols === 3);
check('a style string still works (stage 1 callers)', W.openingDefaults('georgian', 'window', 1).size_tier === 'large');
check('a dormer is a small window', W.openingDefaults(gd, 'window', 0, 'roof').size_tier === 'small');
eq('a lower ground door is a plain panelled one', W.openingDefaults(gd, 'door', 0, 'lower_ground').type, 'panelled');
eq('bays spread among the slots, off the door', W.floorSlots(0, 1, 1).join(','), 'bay,door');
eq('every slot is used once with bays', W.floorSlots(2, 1, 2).length, 5);
check('a Victorian ground-floor bay runs up two storeys when it can', W.bayDefaults(vd, 0, true).bay_storeys === 2 && W.bayDefaults(vd, 0, false).bay_storeys === 1 && W.bayDefaults(gd, 0, true).bay_storeys === 1);

// ── Levels, bays: labels and elements ──────────────────────────────────────
const lgW = { id: 'lg', side: 'front', level: 'lower_ground', floor: 0, kind: 'window', position: 1, type: 'sash', size_tier: 'medium', rows: 2, cols: 3 };
const dorm = { id: 'dm', side: 'front', level: 'roof', floor: 0, kind: 'window', position: 2, type: 'sash', size_tier: 'small', rows: 1, cols: 3 };
eq('lower ground label', W.openingLabel(lgW), 'Front, lower ground, W1');
eq('dormer label', W.openingLabel(dorm), 'Front, dormer, W2');
const bay = { id: 'b', side: 'front', level: 'standard', floor: 0, kind: 'bay', position: 1, bay_shape: 'canted', bay_storeys: 2, type: 'canted', size_tier: 'medium', rows: 1, cols: 1 };
const kid = (storey, face, extra) => Object.assign({ id: 'k' + storey + face, side: 'front', level: 'standard', floor: storey, kind: 'window',
  position: W.bayChildPosition(1, storey, face), parent_opening_id: 'b', type: 'sash', size_tier: 'medium', rows: 1, cols: 2 }, extra || {});
const kids = [];
[0, 1].forEach(st => W.BAY_FACES.forEach(f => kids.push(kid(st, f))));
eq('a bay is B1', W.openingLabel(bay), 'Front, ground floor, B1');
eq("a bay's window", W.openingLabel(kids[1]), 'Front, ground floor, B1 front');
eq('...and its left light', W.openingLabel(kids[0]), 'Front, ground floor, B1 left');
eq('...upstairs', W.openingLabel(kids[4]), 'Front, first floor, B1 front');
check("a bay's windows never share a slot number with a window", W.bayChildPosition(1, 0, 'left') > 99);
eq('dormer surround parts', W.openingElements(dorm).filter(e => /^dormer_/.test(e.id)).map(e => e.id).join(','), 'dormer_fascia,dormer_cheek_left,dormer_cheek_right');
check('only a dormer has them', !W.openingElements(lgW).some(e => /^dormer_/.test(e.id)));
eq('bay parts', W.openingElements(bay).map(e => e.id).join(','), 'bay_cornice,bay_fascia,bay_mullion_left,bay_mullion_right,bay_cill');
check('bay parts take the frame actions', W.actionsFor(bay, 'part').map(a => a.key).join(',') === 'filler,resin,splice');
eq('the sort: lower ground, floors (window, bay + its windows, door), dormers',
  W.sortOpenings([dorm, door, kids[1], bay, sash, lgW, kids[0]]).map(o => o.id).join(','), 'lg,b,k0left,k0front,d,s,dm');

// ── Pricing: bays, and the cosmetic settings price nothing ─────────────────
const bayData = { property, openings: [bay].concat(kids), marks: [] };
const bp = W.priceJob(bayData, R);
near('a bay = its base by shape and storeys + its windows as windows',
  bp.quote.mins, (160 + kids.reduce((t, k) => t + W.paintedMinutes(k, R), 0)) * 1.1);
near('square one-storey base', W.baseMinutes(Object.assign({}, bay, { bay_shape: 'square', bay_storeys: 1 }), R), 70);
eq('the bay base is a Rates figure', W.mergeRates({ bayBase: { canted: { 2: 200 } } }).bayBase.canted[2], 200);
eq('...kept per field', W.mergeRates({ bayBase: { canted: { 2: 200 } } }).bayBase.canted[1], 90);
near('a bay window whose bay has gone prices as nothing',
  W.priceJob({ property, openings: kids.slice(0, 1), marks: [] }, R).quote.mins, 0);
const bayMarks = W.priceJob(Object.assign({}, bayData, { marks: [{ opening_id: 'b', element_id: 'bay_cill', action_key: 'resin', stage: 'quote' }] }), R);
near('a mark on a bay part prices like a frame part', bayMarks.quote.mins - bp.quote.mins, 25);
const cosmetic = (appearance) => W.priceJob({ property: Object.assign({}, property, { appearance }), openings: [sash, door, bay].concat(kids), marks: [] }, R).quote.mins;
check('finish, roof, form and details price nothing', [W.periodDefaults('victorian'), g8, Object.assign(W.periodDefaults('modern'), { roof: 'front_gable', finish: 'gault_brick' })]
  .every(a => Math.abs(cosmetic(a) - cosmetic(W.periodDefaults('georgian'))) < 1e-9));
near('bay timber is window paint, per storey', W.paintAreas({ openings: [bay] }, R).window, 2.4);
eq('...but not a window to count', W.paintAreas({ openings: [bay] }, R).windows, 0);
eq('the item line counts bays and dormers',
  W.itemLineText({ openings: [bay].concat(kids, [dorm, Object.assign({}, lgW, { kind: 'door', type: 'panelled', size_tier: 'standard' })]), marks: [] }),
  'Exterior windows and doors (outside faces): 6 sash windows, 1 dormer window, 1 canted bay, 1 lower ground door.');
eq('variation text on a bay window', W.describeVariation({ property, openings: [bay].concat(kids),
  marks: [{ opening_id: 'k0front', element_id: 'cill', action_key: 'splice', stage: 'variation', variation_id: 'v9' }] }, 'v9'),
  'Front, ground floor, B1 front: splice timber (cill).');

// ── Drawing ────────────────────────────────────────────────────────────────
const refProp = { appearance: Object.assign(W.periodDefaults('georgian'), { finish: 'buff_brick', roof: 'eaves_to_street' }), default_prep: 'light',
  layout: { front: { floors: [{ windows: 2, doors: 1 }, { windows: 3, doors: 0 }], roof: { windows: 3 }, lower_ground: { windows: 2, doors: 1 }, confirmed: false } } };
const ref = W.elevationSvg({ property: refProp, openings: [], marks: [] }, 'front');
check('the reference terrace draws (dormers, lower ground, neighbours)', /^<svg[\s\S]*<\/svg>$/.test(ref) && ref.indexOf('<g opacity="0.36">') >= 0
  && (ref.match(/>W[123]</g) || []).length >= 10);
check('a detached house has no neighbours', W.elevationSvg({ property: Object.assign({}, refProp, { appearance: Object.assign({}, refProp.appearance, { form: 'detached' }) }), openings: [], marks: [] }, 'front').indexOf('<g opacity="0.36">') < 0);
check('a stage 1 house has no neighbours either', W.elevationSvg({ property: { style: 'georgian', layout: refProp.layout }, openings: [], marks: [] }, 'front').indexOf('<g opacity="0.36">') < 0);
['georgian', 'victorian', 'modern'].forEach(period => W.ROOFS.forEach(roof => W.FINISHES.forEach(finish => {
  const a = Object.assign(W.periodDefaults(period), { roof, finish, form: 'detached' });
  ['front', 'left'].forEach(side => {
    const svg = W.elevationSvg({ property: { appearance: a, layout: { [side]: { floors: [{ windows: 1, doors: 1, bays: 1 }, { windows: 2, doors: 0 }], roof: { windows: 2 }, lower_ground: { windows: 1, doors: 1 } } } }, openings: [], marks: [] }, side);
    if (!/^<svg[\s\S]*<\/svg>$/.test(svg) || /NaN|undefined/.test(svg)) check(period + ' ' + roof + ' ' + finish + ' ' + side + ' draws cleanly', false, svg.slice(0, 200));
  });
})));
check('every period × roof × finish draws cleanly', true);
['pedimented_radial', 'plain_fanlight', 'portico'].forEach(dc => check('doorcase ' + dc + ' draws', !/NaN/.test(W.elevationSvg({ property: { appearance: Object.assign(W.periodDefaults('georgian'), { georgian: Object.assign({}, gd.georgian, { doorcase: dc }) }), layout: refProp.layout }, openings: [], marks: [] }, 'front'))));
const bayLayout = { front: { floors: [{ windows: 0, doors: 1, bays: 1 }, { windows: 1, doors: 0 }], confirmed: true } };
const bayElev = W.elevationSvg({ property: { appearance: vd, layout: bayLayout, default_prep: 'light' }, openings: [bay].concat(kids),
  marks: [{ opening_id: 'k1front', element_id: 'cill', action_key: 'resin', stage: 'quote' }] }, 'front', { interactive: true });
check('a bay is one tappable thing on the elevation', bayElev.indexOf('data-open-id="b"') >= 0 && bayElev.indexOf('data-open-id="k0front"') < 0);
check("work on a bay's window badges the bay", /<circle[^>]*fill="#1e6497"/.test(bayElev));
const hlElev = W.elevationSvg({ property: { appearance: vd, layout: bayLayout }, openings: [bay].concat(kids), marks: [] }, 'front', { highlight: { k1front: true } });
check("the report lights up a bay when one of its windows had work", /stroke="#1e6497" stroke-width="2.2"/.test(hlElev));
const drawnPanes = (o, a) => (W.elevationSvg({ property: { appearance: Object.assign({}, a, { form: 'detached' }), layout: { front: { floors: [{ windows: 1, doors: 0 }], confirmed: true } } }, openings: [o], marks: [] }, 'front').match(/stroke="#ffffff" stroke-width="1.2"/g) || []).length;
const plainSash = { id: 'p', side: 'front', floor: 0, kind: 'window', position: 1, type: 'sash', size_tier: 'medium', rows: 2, cols: 3 };
check('a sash whose panes were never set draws the period glazing', drawnPanes(plainSash, g8) > drawnPanes(plainSash, gd));
check('...and one set by hand draws its own', drawnPanes(Object.assign({}, plainSash, { panes_set: true }), g8) === drawnPanes(Object.assign({}, plainSash, { panes_set: true }), gd));
const dormDetail = W.detailSvg(dorm, [], { interactive: true });
check('the dormer detail has its surround to tap', ['dormer_fascia', 'dormer_cheek_left', 'dormer_cheek_right', 'head', 'top-1'].every(id => dormDetail.indexOf('data-el="' + id + '"') >= 0));
const bayView = W.detailSvg(bay, [], { interactive: true, children: kids });
check('the bay view: its parts to mark', W.openingElements(bay).every(e => bayView.indexOf('data-el="' + e.id + '"') >= 0));
check('...and each of its windows to open', kids.every(k => bayView.indexOf('data-open-id="' + k.id + '"') >= 0));

// ── Report ─────────────────────────────────────────────────────────────────
const bayReport = W.reportModel({ property, openings: [bay].concat(kids), marks: [
  { opening_id: 'b', element_id: 'bay_cornice', action_key: 'filler', stage: 'quote' },
  { opening_id: 'k0left', element_id: 'top-1', action_key: 'reputty', stage: 'quote' }] }, []);
eq('the report: a bay and its window', bayReport.sections.map(s => s.label + ' / ' + s.what).join(' | '),
  'Front, ground floor, B1 / Canted bay | Front, ground floor, B1 left / Sash window');
eq("...the bay's section carries its windows for its drawing", (bayReport.sections[0].children || []).length, 6);
check('the report html draws the bay view', W.reportHtml({ property, openings: [bay].concat(kids), marks: [{ opening_id: 'b', element_id: 'bay_cornice', action_key: 'filler', stage: 'quote' }] }, []).indexOf('canted bay, in plan') >= 0);

// ── The server's gate ──────────────────────────────────────────────────────
{
  const L = require('../lib/windoors');
  eq('a door in the roof is refused', L.normaliseOpening({ side: 'front', level: 'roof', kind: 'door', type: 'panelled', sizeTier: 'standard' }).error, 'only windows go in the roof');
  check('a bay needs no type or size of its own', !L.normaliseOpening({ side: 'front', kind: 'bay', bayShape: 'square', bayStoreys: 2 }).error
    && L.normaliseOpening({ side: 'front', kind: 'bay', bayShape: 'square', bayStoreys: 2 }).type === 'square');
  eq('the lower ground and roof have no floor number', L.normaliseOpening({ side: 'front', level: 'lower_ground', floor: 3, kind: 'window', type: 'sash', sizeTier: 'small' }).floor, 0);
  eq('a row from an old app is standard', L.normaliseOpening({ side: 'front', kind: 'window', type: 'sash', sizeTier: 'small' }).level, 'standard');
  eq('an old app shell leaves the stored appearance alone', L.normaliseProperty({ style: 'victorian', layout: {} }).appearance, null);
  const np = L.normaliseProperty({ appearance: { period: 'victorian', finish: 'gault_brick' }, layout: { front: { floors: [{ windows: 1, doors: 1, bays: 9 }], roof: { windows: 2 }, lower_ground: null } } });
  check('the stored appearance is normalised and the style follows the period', np.style === 'victorian' && np.appearance.finish === 'gault_brick' && np.appearance.victorian.sash === '2_over_2');
  check('the layout keeps bays (capped), dormers and lower ground', np.layout.front.floors[0].bays === 4 && np.layout.front.roof.windows === 2 && np.layout.front.lower_ground === null);
}

// ── Sashes with different grids: 3-over-6 ──────────────────────────────────
const s36 = { id: 's36', side: 'front', level: 'roof', floor: 0, kind: 'window', position: 1, type: 'sash', size_tier: 'small', rows: 1, rows_bottom: 2, cols: 3, panes_set: true };
eq('a 3-over-6 is 9 panes', W.paneCount(s36), 9);
eq('...said as such', W.sashPattern(s36), '3 over 6');
check('...with 3 top panes and 6 bottom ones to mark',
  W.openingElements(s36).filter(e => /^top-/.test(e.id)).length === 3 && W.openingElements(s36).filter(e => /^bottom-/.test(e.id)).length === 6);
near('...priced on 9 panes', W.paintedMinutes(s36, R), 30 * 1.3 + 9 * 4);
eq('no bottom rows saved = same as the top', W.paneCount(sash), 12);
check('the detail draws 9 tappable panes', ['top-3', 'bottom-6'].every(id => W.detailSvg(s36, [], { interactive: true }).indexOf('data-el="' + id + '"') >= 0)
  && W.detailSvg(s36, [], { interactive: true }).indexOf('data-el="top-4"') < 0);
const unsetDormer = Object.assign({}, s36, { id: 'ud', rows: 1, rows_bottom: null, panes_set: false });
const dormerBars = (o) => (W.elevationSvg({ property: { appearance: Object.assign({}, gd, { roof: 'eaves_to_street', form: 'detached' }), layout: { front: { floors: [{ windows: 0, doors: 0 }], roof: { windows: 1 }, confirmed: true } } }, openings: [o], marks: [] }, 'front').match(/stroke="#ffffff" stroke-width="1.2"/g) || []).length;
eq("a dormer whose panes were never set draws the period's dormer glazing (3-over-6), not the floors' 6-over-6",
  dormerBars(unsetDormer), dormerBars(s36));
eq('a Georgian dormer starts 3-over-6', W.sashPattern(W.openingDefaults(gd, 'window', 0, 'roof')), '3 over 6');
eq('...4-over-8 beside 8-over-8', W.sashPattern(W.openingDefaults(g8, 'window', 0, 'roof')), '4 over 8');
{
  const L = require('../lib/windoors');
  const base = { side: 'front', level: 'roof', kind: 'window', type: 'sash', sizeTier: 'small', rows: 1, cols: 3 };
  eq('the server keeps a different bottom', L.normaliseOpening(Object.assign({}, base, { rowsBottom: 2 })).rows_bottom, 2);
  eq('...stores a matching one as "same"', L.normaliseOpening(Object.assign({}, base, { rowsBottom: 1 })).rows_bottom, null);
  eq('...and none on a casement', L.normaliseOpening(Object.assign({}, base, { type: 'casement', rowsBottom: 2 })).rows_bottom, null);
}

// ── The app ────────────────────────────────────────────────────────────────
check('openings are saved with their level, bay and pane flag', /level: Windoors\.levelOf\(o\)/.test(body('wdPutOpening')) && /parentOpeningId/.test(body('wdPutOpening')) && /panesSet/.test(body('wdPutOpening')));
check("a sash's bottom rows are saved", /rowsBottom/.test(body('wdPutOpening')));
check('an adopted bay re-points its windows', /x\.parent_opening_id === old/.test(body('wdPutOpening')));
check('confirming a layout makes bays with their windows', /wdEnsureBayChildren\(have\)/.test(body('confirmWdLayout')));
check('a form that hides a side warns before its openings go', /confirm\(/.test(body('wdApplyAppearance')) && /wdRemoveOpenings\(/.test(body('wdApplyAppearance')));
check('changing period asks first only when something was changed by hand', /appearanceIsDefault/.test(body('setWdPeriod')));
check('the side selector offers only the sides the house has', /wdVisibleSides\(\)/.test(body('renderWindoors')));
check('the report PDF draws a bay with its windows', /children: mine\[k\]\.children/.test(body('buildWindoorsReportPdf')));
check('the Rates card has the bay base minutes', /s-wd-bay-/.test(body('populateWindoorsRates')) && /s-wd-bay-/.test(body('readWindoorsRates')));

console.log(pass.length + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  ✗ ' + f));
process.exit(fail.length ? 1 : 0);
