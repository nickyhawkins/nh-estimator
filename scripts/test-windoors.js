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
// sash large: 55 × 1.3 = 71.5 base, + 12 panes × 4 = 119.5 painted, × 1.1
// first-floor access (2 coats = × 1), × 1.1 light
near('sash painted minutes', W.paintedMinutes(sash, R), 119.5);
const quoteOnly = W.priceJob({ property, openings: [sash], marks: [] }, R);
near('quote = painted × access × prep multiplier', quoteOnly.quote.mins, 119.5 * 1.1 * 1.1);
const withMarks = W.priceJob({ property, openings: [sash], marks: [
  { opening_id: 's', element_id: 'top-1', action_key: 'replace_glass', stage: 'quote' },
  { opening_id: 's', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: 'v1' },
] }, R);
near('quote marks add their minutes, not multiplied by prep or access', withMarks.quote.mins, 119.5 * 1.1 * 1.1 + 30);
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
near('the raise is priced as the difference, on the scaled figure', pr.variations.v2.mins, 119.5 * 1.1 * (1.75 - 1.1));
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
// The report shows only work ticked off as done (v2.86.0): these fixtures
// are ticked; the tick rule has its own checks further down.
const done = marks => marks.map(m => Object.assign({ done_at: '2026-09-21T09:00:00Z' }, m));
const unticked = W.reportModel(data, [{ id: 'v1', status: 'approved' }]);
check('nothing ticked off: nothing to report', unticked.sections.every(s => !s.quoted.some(t => /reputty|resin/i.test(t)) && !s.variations.length));
data.marks = done(data.marks);
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
  const a = W.normaliseAppearance({ period: 'victorian', finish: 'pink_brick', roof: 'front_gable', victorian: { sash: 'nope', bargeboards: true } });
  return a.finish === 'buff_brick' && a.roof === 'front_gable' && a.victorian.sash === '2_over_2' && a.victorian.bargeboards === true;
})());
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
// A two-storey bay's timber takes the first-floor uplift; its windows go by
// their own floors (ground, then first).
near('a bay = its base by shape and storeys + its windows as windows',
  bp.quote.mins, (160 * 1.1 + kids.reduce((t, k) => t + W.paintedMinutes(k, R) * (k.floor === 1 ? 1.1 : 1), 0)) * 1.1);
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
const bayReport = W.reportModel({ property, openings: [bay].concat(kids), marks: done([
  { opening_id: 'b', element_id: 'bay_cornice', action_key: 'filler', stage: 'quote' },
  { opening_id: 'k0left', element_id: 'top-1', action_key: 'reputty', stage: 'quote' }]) }, []);
eq('the report: a bay and its window', bayReport.sections.map(s => s.label + ' / ' + s.what).join(' | '),
  'Front, ground floor, B1 / Canted bay | Front, ground floor, B1 left / Sash window');
eq("...the bay's section carries its windows for its drawing", (bayReport.sections[0].children || []).length, 6);
check('the report html draws the bay view', W.reportHtml({ property, openings: [bay].concat(kids), marks: done([{ opening_id: 'b', element_id: 'bay_cornice', action_key: 'filler', stage: 'quote' }]) }, []).indexOf('canted bay, in plan') >= 0);

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

// ── v2.86.0: Other items, sash and door actions, ticks, sides, red brick ──
{
  const other = { id: 'o1', side: 'front', floor: 0, level: 'standard', kind: 'other', position: 1, nickname: 'Garage door',
    type: 'door', size_tier: 'standard', rows: 1, cols: 1, other_mins: 120, other_cost: 15, other_m2: 5 };
  const od = { property, openings: [sash, door, other], marks: [] };
  const base = W.priceJob({ property, openings: [sash, door], marks: [] }, R).quote;
  const withO = W.priceJob(od, R).quote;
  eq('an Other item prices its own minutes at the job prep', Math.round((withO.mins - base.mins) * 100) / 100, Math.round(120 * R.prep[property.default_prep || 'light'] * 100) / 100);
  eq('...and its own materials', withO.materials - base.materials, 15);
  eq('...and counts as an opening', withO.count, base.count + 1);
  eq('its paint goes with the colour it is painted in', W.paintAreas({ openings: [other] }, R).door, 5);
  eq('...windows colour when set so', W.paintAreas({ openings: [Object.assign({}, other, { type: 'window' })] }, R).window, 5);
  eq('...and it is not counted as a door', W.paintAreas({ openings: [other] }, R).doors, 0);
  eq('it is labelled by its name', W.openingLabel(other), 'Front, O1 (Garage door)');
  eq('the item line names it', W.itemLineText({ openings: [door, other], marks: [] }), 'Exterior windows and doors (outside faces): 1 front door, garage door.');
  eq('...and counts repeats', W.itemLineText({ openings: [other, Object.assign({}, other, { id: 'o2', position: 2 })], marks: [] }), 'Exterior windows and doors (outside faces): 2 × garage door.');
  eq('it has a face and a frame to mark', W.openingElements(other).map(e => e.id).join(','), 'face,frame');
  eq('it takes the door actions', W.actionsFor(other, 'part').map(a => a.key).join(','), 'filler,resin,splice,ironmongery,ease');
  eq('it sorts after the floors', W.sortOpenings([other, door, sash]).map(o => o.id).join(','), 'd,s,o1');
  const osvg = W.elevationSvg({ property: { appearance: W.periodDefaults('georgian'), layout: { front: { floors: [{ windows: 1, doors: 1 }], confirmed: true } } }, openings: [other], marks: [] }, 'front', { interactive: true });
  check('it is drawn as a tappable tile under the house', osvg.indexOf('data-open-id="o1"') >= 0 && osvg.indexOf('>Garage door<') >= 0 && !/NaN/.test(osvg));
  check('its detail view has both parts', ['face', 'frame'].every(id => W.detailSvg(other, [], { interactive: true }).indexOf('data-el="' + id + '"') >= 0));
  const L = require('../lib/windoors');
  const ok = L.normaliseOpening({ side: 'back', kind: 'other', nickname: 'Porch', type: 'window', otherMins: 90, otherCost: 12.5, otherM2: 3, floor: 2 });
  eq('the server keeps its figures', [ok.other_mins, ok.other_cost, ok.other_m2, ok.floor, ok.type].join(','), '90,12.5,3,0,window');
  check('...refuses one with no name', !!L.normaliseOpening({ side: 'back', kind: 'other', nickname: ' ' }).error);
  eq('...paints an unknown colour as the doors', L.normaliseOpening({ side: 'back', kind: 'other', nickname: 'X', type: 'purple' }).type, 'door');
  eq('...and gives other kinds no figures', L.normaliseOpening({ side: 'front', kind: 'door', type: 'flush', sizeTier: 'standard', otherMins: 50 }).other_mins, null);

  // Sash and door actions
  eq('a sash frame part takes the sash actions', W.actionsFor(sash, 'part').map(a => a.key).join(','), 'filler,resin,splice,record,beads,overhaul');
  eq('a casement does not', W.actionsFor(Object.assign({}, sash, { type: 'casement' }), 'part').map(a => a.key).join(','), 'filler,resin,splice');
  eq('a door can be eased', W.actionsFor(door, 'part').map(a => a.key).join(','), 'filler,resin,splice,ironmongery,ease');
  eq('re-cording prices from the Rates card', W.priceJob({ property, openings: [sash], marks: [{ opening_id: 's', element_id: 'left_stile', action_key: 'record', stage: 'quote' }] }, R).quote.mins - W.priceJob({ property, openings: [sash], marks: [] }, R).quote.mins, R.actions.record.mins);
  eq('...and reads in words', W.marksClause(sash, [{ element_id: 'left_stile', action_key: 'record' }, { element_id: 'meeting_rail', action_key: 'overhaul' }]), 're-cord (left stile), ease and overhaul (meeting rail)');
  check('every action has default rates', W.ACTIONS.every(a => W.DEFAULT_RATES.actions[a.key]));

  // Ticks
  const tm = [{ id: 'a', opening_id: 's', element_id: 'cill', action_key: 'resin', stage: 'quote' },
    { id: 'b', opening_id: 's', element_id: 'top-1', action_key: 'reputty', stage: 'quote', done_at: '2026-09-22T10:00:00Z' },
    { id: 'c', opening_id: 's', element_id: 'top-2', action_key: 'reputty', stage: 'variation', variation_id: 'vx' },
    { id: 'e', opening_id: 's', element_id: 'top-3', action_key: 'reputty', stage: 'variation', variation_id: 'vp' }];
  const tv = [{ id: 'vx', status: 'approved' }, { id: 'vp', status: 'pending' }];
  const tr = W.reportModel({ property, openings: [sash], marks: tm }, tv);
  eq('the report shows only ticked work', tr.sections[0].quoted.join('|'), 'Reputty x1 pane');
  eq('...and draws only ticked marks', tr.marks.map(m => m.id).join(','), 'b');
  eq('unticked work the report would show: quote and approved only', W.untickedMarks({ property, openings: [sash], marks: tm }, tv).map(m => m.id).join(','), 'a,c');
  eq('ticks change no price', W.priceJob({ property, openings: [sash], marks: tm }, R).quote.mins, W.priceJob({ property, openings: [sash], marks: tm.map(m => Object.assign({}, m, { done_at: null })) }, R).quote.mins);
  eq('the server keeps a tick', !!L.normaliseMark({ openingId: 'x', elementId: 'cill', actionKey: 'resin', doneAt: '2026-09-22T10:00:00Z' }).done_at, true);
  eq('...and an untick', L.normaliseMark({ openingId: 'x', elementId: 'cill', actionKey: 'resin', doneAt: null }).done_at, null);

  // Per-side finish and roof, red brick
  const ga = W.periodDefaults('georgian');
  const sided = W.normaliseAppearance(Object.assign({}, ga, { sides: { back: { finish: 'red_brick', roof: 'gable' }, left: { finish: 'nonsense' } } }));
  eq('a side keeps its own finish and roof', JSON.stringify(sided.sides), '{"back":{"finish":"red_brick","roof":"gable"}}');
  eq("the side's roof wins", W.roofKindFor(sided, 'back'), 'gable');
  eq('...the others keep the house roof', W.roofKindFor(sided, 'front'), 'parapet');
  eq("the side draws in its own finish", W.sideAppearance(sided, 'back').finish, 'red_brick');
  eq('...the front in the house finish', W.sideAppearance(sided, 'front').finish, 'stucco');
  check('a side set on its own is a change from the period', !W.appearanceIsDefault(sided));
  check('a new period starts with no sides of its own', !Object.keys(W.periodDefaults('victorian').sides).length);
  const lay = { back: { floors: [{ windows: 2, doors: 1 }, { windows: 3, doors: 0 }], confirmed: true }, front: { floors: [{ windows: 2, doors: 1 }], confirmed: true } };
  const backSvg = W.elevationSvg({ property: { appearance: sided, layout: lay }, openings: [], marks: [] }, 'back');
  const frontSvg = W.elevationSvg({ property: { appearance: sided, layout: lay }, openings: [], marks: [] }, 'front');
  check('the back draws red brick', backSvg.indexOf('#b8674b') >= 0 && !/NaN/.test(backSvg));
  check('...and the front does not', frontSvg.indexOf('#b8674b') < 0);
  check('red brick is a finish', W.FINISHES.some(f => f.key === 'red_brick'));
  ['georgian', 'victorian', 'modern'].forEach(pd => ['front', 'left'].forEach(side => {
    const a = Object.assign(W.periodDefaults(pd), { finish: 'red_brick', form: 'detached' });
    check(pd + ' red brick ' + side + ' draws cleanly', !/NaN|undefined/.test(W.elevationSvg({ property: { appearance: a, layout: { [side]: { floors: [{ windows: 2, doors: 1 }], confirmed: true } } }, openings: [], marks: [] }, side)));
  }));
  eq('the server keeps the sides', JSON.stringify(L.normaliseProperty({ appearance: Object.assign({}, ga, { sides: { back: { finish: 'red_brick' } } }) }).appearance.sides), '{"back":{"finish":"red_brick"}}');
}

// ── Coats and access (v2.87.0) ─────────────────────────────────────────────
{
  // The spec's worked check: a medium 6-over-6 sash, Light prep, defaults.
  const med = { id: 'm', kind: 'window', type: 'sash', rows: 2, cols: 3, size_tier: 'medium', side: 'front', level: 'standard', floor: 0, position: 1 };
  const RA = Object.assign(W.mergeRates({}), { access: W.accessRates({ rAccessFirstPct: 10, rAccessLadderPct: 25 }) });
  const eaves = Object.assign(W.periodDefaults('georgian'), { roof: 'eaves_to_street', form: 'detached' });
  const q = (o, coats, rates) => W.priceJob({ property: { default_prep: 'light', coats, appearance: eaves }, openings: [o], marks: [] }, rates || RA).quote.mins;
  near('painted minutes of a medium 6-over-6 sash', W.paintedMinutes(med, RA), 100);
  near('worked check: ground, 2 coats = 110', q(med, 2), 110);
  near('worked check: first floor, 2 coats = 121', q(Object.assign({}, med, { floor: 1 }), 2), 121);
  near('worked check: second floor, 3 coats = 206.25', q(Object.assign({}, med, { floor: 2 }), 3), 206.25);

  // Coats: 0.5 / 1 / 1.5 on the painted minutes; actions flat.
  const acts = [{ opening_id: 'm', element_id: 'top-1', action_key: 'reputty', stage: 'quote' },
    { opening_id: 'm', element_id: 'cill', action_key: 'splice', stage: 'quote' }];
  const withActs = coats => W.priceJob({ property: { default_prep: 'light', coats }, openings: [med], marks: acts }, RA).quote.mins;
  near('1 coat = half the painted minutes', q(med, 1), 55);
  near('3 coats = one and a half', q(med, 3), 165);
  near('actions are not scaled by coats (1 coat)', withActs(1) - q(med, 1), 80);
  near('...(3 coats)', withActs(3) - q(med, 3), 80);
  eq('missing coats reads as 2', W.coatsFactor({}), 1);
  eq('invalid coats read as 2', [W.coatsFactor({ coats: 0 }), W.coatsFactor({ coats: 7 }), W.coatsFactor({ coats: 'x' }), W.coatsFactor(null)].join(','), '1,1,1,1');
  const doorQ = coats => q({ id: 'm', kind: 'door', type: 'panelled', size_tier: 'standard', side: 'front', floor: 0, rows: 3, cols: 2 }, coats);
  near('door minutes scale with coats too', doorQ(3) / doorQ(2), 1.5);
  const perM = W.priceJob({ property: { default_prep: 'light', coats: 3 }, openings: [Object.assign({}, med, { floor: 1 })], marks: [] }, RA).perOpening.m;
  check('perOpening carries scaled, coatsFactor and accessMult',
    perM.coatsFactor === 1.5 && Math.abs(perM.accessMult - 1.1) < 1e-9 && Math.abs(perM.scaled - 165) < 1e-9 && perM.access === 'firstFloor');
  const oth = { id: 'o', kind: 'other', side: 'front', floor: 0, position: 1, nickname: 'Garage door', type: 'door', size_tier: 'standard', rows: 1, cols: 1, other_mins: 120, access: 'ladderTower' };
  near("an Other item's own minutes take neither coats nor access", q(oth, 3), 120 * 1.1);

  // Access from where the opening sits.
  const at = extra => W.autoAccess(Object.assign({}, med, extra));
  eq('lower ground = ground', at({ level: 'lower_ground', floor: 0 }), 'ground');
  eq('ground floor = ground', at({ floor: 0 }), 'ground');
  eq('first floor = first floor', at({ floor: 1 }), 'firstFloor');
  eq('second floor = ladder/tower', at({ floor: 2 }), 'ladderTower');
  eq('third floor = ladder/tower', at({ floor: 3 }), 'ladderTower');
  eq('dormers = ladder/tower', at({ level: 'roof', floor: 0 }), 'ladderTower');
  near('a lower ground window prices at ground', q(Object.assign({}, med, { level: 'lower_ground' }), 2), 110);
  near('a dormer prices at the ladder uplift', q(Object.assign({}, med, { level: 'roof' }), 2), 100 * 1.25 * 1.1);
  const bay1 = { id: 'b1', kind: 'bay', side: 'front', level: 'standard', floor: 0, position: 1, bay_shape: 'canted', bay_storeys: 1, type: 'canted', size_tier: 'medium' };
  eq('a one-storey ground bay = ground', W.autoAccess(bay1), 'ground');
  eq('a two-storey ground bay = first floor', W.autoAccess(Object.assign({}, bay1, { bay_storeys: 2 })), 'firstFloor');
  eq('a first-floor bay = first floor', W.autoAccess(Object.assign({}, bay1, { floor: 1 })), 'firstFloor');
  eq('a two-storey first-floor bay = ladder/tower', W.autoAccess(Object.assign({}, bay1, { floor: 1, bay_storeys: 2 })), 'ladderTower');
  near('a two-storey bay timber takes the first-floor uplift', q(Object.assign({}, bay1, { bay_storeys: 2 }), 2), 160 * 1.1 * 1.1);
  const child = (floor) => Object.assign({}, med, { id: 'c' + floor, parent_opening_id: 'b1', floor, position: W.bayChildPosition(1, floor, 'front') });
  eq("a bay's ground window = ground", W.autoAccess(child(0)), 'ground');
  eq("a bay's upper window = first floor", W.autoAccess(child(1)), 'firstFloor');
  const bp2 = W.priceJob({ property: { default_prep: 'light', coats: 2 }, openings: [Object.assign({}, bay1, { bay_storeys: 2 }), child(0), child(1)], marks: [] }, RA).perOpening;
  check('...priced by their own floors', bp2.c0.accessMult === 1 && Math.abs(bp2.c1.accessMult - 1.1) < 1e-9 && Math.abs(bp2.b1.accessMult - 1.1) < 1e-9);

  // Override.
  eq('override beats Auto (scaffold up)', W.openingAccess(Object.assign({}, med, { floor: 2, access: 'ground' })), 'ground');
  eq('override beats Auto (basement well)', W.openingAccess(Object.assign({}, med, { access: 'ladderTower' })), 'ladderTower');
  eq('null reads as Auto', W.openingAccess(Object.assign({}, med, { floor: 1, access: null })), 'firstFloor');
  near('an override prices', q(Object.assign({}, med, { floor: 2, access: 'ground' }), 2), 110);
  const aMarks = [{ opening_id: 'm', element_id: 'cill', action_key: 'resin', stage: 'quote' }];
  near('actions take no access uplift', W.priceJob({ property: { default_prep: 'light' }, openings: [Object.assign({}, med, { floor: 2 })], marks: aMarks }, RA).quote.mins - q(Object.assign({}, med, { floor: 2 }), 2), 25);

  // The percentages come from settings, 10 / 25 when unset.
  const a0 = W.accessRates({});
  check('unset settings = 10 / 25', Math.abs(a0.firstFloor - 1.1) < 1e-9 && Math.abs(a0.ladderTower - 1.25) < 1e-9);
  const a1 = W.accessRates({ rAccessFirstPct: 20, rAccessLadderPct: 50 });
  check('set settings are used', Math.abs(a1.firstFloor - 1.2) < 1e-9 && Math.abs(a1.ladderTower - 1.5) < 1e-9);
  check('a saved 0% is kept', W.accessRates({ rAccessFirstPct: 0 }).firstFloor === 1);
  near('settings reach the price', q(Object.assign({}, med, { floor: 1 }), 2, Object.assign(W.mergeRates({}), { access: a1 })), 100 * 1.2 * 1.1);
  check('mergeRates defaults the access to 10 / 25', Math.abs(W.mergeRates({}).access.firstFloor - 1.1) < 1e-9 && Math.abs(W.mergeRates({}).access.ladderTower - 1.25) < 1e-9);
  const noAcc = W.mergeRates({}); delete noAcc.access;
  near('pre-merged rates with no access still price at 10 / 25', q(Object.assign({}, med, { floor: 1 }), 2, noAcc), 121);
  // The server's half requires the same module, so it prices identically.
  const L = require('../lib/windoors');
  const SW = require.cache[require.resolve('../public/windoors')].exports;
  check('the server runs the same module', SW === W && typeof L.normaliseOpening === 'function');

  // Prep raised on site: the extra is on the scaled figure.
  const rz = Object.assign({}, med, { floor: 2, prep_level: 'heavy', prep_stage: 'variation', quote_prep_level: 'light', prep_variation_id: 'vz' });
  const rzp = W.priceJob({ property: { default_prep: 'light', coats: 3 }, openings: [rz], marks: [] }, RA);
  near('prep-raise extra = scaled × (now − quote)', rzp.variations.vz.mins, 100 * 1.5 * 1.25 * (1.4 - 1.1));
  near('...and the quote keeps the scaled figure at its level', rzp.quote.mins, 206.25);

  // The server's gate.
  const base = { side: 'front', kind: 'window', type: 'sash', sizeTier: 'medium', floor: 1 };
  eq('no access = Auto (null)', L.normaliseOpening(base).access, null);
  eq('null access = Auto', L.normaliseOpening(Object.assign({}, base, { access: null })).access, null);
  ['ground', 'firstFloor', 'ladderTower'].forEach(k => eq('access ' + k + ' is kept', L.normaliseOpening(Object.assign({}, base, { access: k })).access, k));
  check('an unknown access is refused', !!L.normaliseOpening(Object.assign({}, base, { access: 'scaffold' })).error);
  check('...and so is a blank one', !!L.normaliseOpening(Object.assign({}, base, { access: '' })).error);
  eq('an Other item has no access', L.normaliseOpening({ side: 'front', kind: 'other', nickname: 'Porch', access: 'ground' }).access, null);
  eq('the row maps back', L.mapOpening({ id: 'x', access: 'ladderTower' }).access, 'ladderTower');
  eq('...NULL as Auto', L.mapOpening({ id: 'x', access: null }).access, null);

  // The elevation marks an override, in the app only.
  const ep = { appearance: W.periodDefaults('georgian'), layout: { front: { floors: [{ windows: 1, doors: 0 }], confirmed: true } } };
  const eo = Object.assign({}, med, { id: 'e1', access: 'ground' });
  check('an overridden opening has a dot on the elevation', W.elevationSvg({ property: ep, openings: [eo], marks: [] }, 'front', { interactive: true }).indexOf('wd-access-dot') >= 0);
  check('...an Auto one does not', W.elevationSvg({ property: ep, openings: [Object.assign({}, eo, { access: null })], marks: [] }, 'front', { interactive: true }).indexOf('wd-access-dot') < 0);
  check('...nor does the client report', W.elevationSvg({ property: ep, openings: [eo], marks: [] }, 'front', { markers: false }).indexOf('wd-access-dot') < 0);
}

// ── Sash drawing: the meeting rail follows the rows (v2.87.1) ──────────────
{
  near('a 6-over-6 splits at half', W.sashTopShare(2, 2), 0.5);
  near('a 3-over-6 top sash is a third', W.sashTopShare(1, 2), 1 / 3);
  near('unset rows read as 1', W.sashTopShare(undefined, 1), 0.5);
  // The detail view: every pane in a 3-over-6 is the same height.
  const d36 = { id: 'd36', kind: 'window', type: 'sash', rows: 1, rows_bottom: 2, cols: 3, size_tier: 'small', side: 'front', level: 'roof', floor: 0, position: 1 };
  const svg = W.detailSvg(d36, [], { interactive: true });
  const paneH = id => { const m = new RegExp('data-el="' + id + '"[^>]*>\\s*<rect[^>]*height="([0-9.]+)"').exec(svg); return m ? +m[1] : NaN; };
  const hs = ['top-1', 'bottom-1', 'bottom-4'].map(paneH);
  check('3-over-6 detail panes are all the same height', hs.every(h => isFinite(h) && Math.abs(h - hs[0]) < 1.5), hs.join(','));
  check('...and it still draws cleanly', !/NaN|undefined/.test(svg));
  const ep = { appearance: W.periodDefaults('georgian'), layout: { front: { floors: [{ windows: 1, doors: 0 }], roof: { windows: 1 }, confirmed: true } } };
  check('an elevation with a 3-over-6 dormer draws cleanly',
    !/NaN|undefined/.test(W.elevationSvg({ property: ep, openings: [Object.assign({}, d36, { panes_set: true })], marks: [] }, 'front', { interactive: true })));
}

// ── Work to do (v2.88.0) ───────────────────────────────────────────────────
{
  const tp = { default_prep: 'light', coats: 2, appearance: Object.assign(W.periodDefaults('georgian'), { roof: 'eaves_to_street' }) };
  const a1 = { id: 'a1', kind: 'window', type: 'sash', rows: 2, cols: 3, size_tier: 'medium', side: 'front', level: 'standard', floor: 1, position: 1 };
  const a2 = Object.assign({}, a1, { id: 'a2', position: 2, floor: 0 });
  const dm = { id: 'dm2', kind: 'window', type: 'sash', rows: 1, rows_bottom: 2, cols: 3, size_tier: 'small', side: 'back', level: 'roof', floor: 0, position: 1 };
  const tm = [
    { id: 't1', opening_id: 'a1', element_id: 'top-1', action_key: 'reputty', stage: 'quote' },
    { id: 't2', opening_id: 'a1', element_id: 'top-2', action_key: 'reputty', stage: 'quote', done_at: '2026-09-20T10:00:00Z' },
    { id: 't3', opening_id: 'a1', element_id: 'cill', action_key: 'resin', stage: 'quote' },
    { id: 't4', opening_id: 'a2', element_id: 'cill', action_key: 'splice', stage: 'variation', variation_id: 'vok' },
    { id: 't5', opening_id: 'a2', element_id: 'head', action_key: 'filler', stage: 'variation', variation_id: 'vpend' },
  ];
  const vars = [{ id: 'vok', status: 'approved', approvedAt: '2026-09-21T09:00:00Z' }, { id: 'vpend', status: 'pending' }];
  const td = W.reportModel({ property: tp, openings: [a1, a2, dm], marks: tm }, vars, { todo: true });
  eq('every opening is on the to-do list, marked or not', td.sections.map(s => s.opening.id).join(','), 'a2,a1,dm2');
  eq('its painting is the first line', td.sections.find(s => s.opening.id === 'a1').quoted[0], 'Paint: light prep, 2 coats, first floor access');
  eq('...ground floor names no access', td.sections.find(s => s.opening.id === 'a2').quoted[0], 'Paint: light prep, 2 coats');
  eq('...a dormer is ladder/tower', td.sections.find(s => s.opening.id === 'dm2').quoted[0], 'Paint: light prep, 2 coats, ladder/tower access');
  eq('work already ticked off is left off, one line per action', td.sections.find(s => s.opening.id === 'a1').quoted.slice(1).join('|'), 'Reputty x1 pane|Resin repair (cill)');
  eq('a hand-set access is always named', W.reportModel({ property: tp, openings: [Object.assign({}, a1, { access: 'ground' })], marks: [] }, [], { todo: true }).sections[0].quoted[0], 'Paint: light prep, 2 coats, ground access (set by hand)');
  eq('an approved variation is on it', td.sections.find(s => s.opening.id === 'a2').variations.map(v => v.text).join('|'), 'Splice timber (cill)');
  check('a pending variation is not', !td.marks.some(m => m.id === 't5'));
  check('only openings with work get a drawing', td.sections.find(s => s.opening.id === 'a1').marked && td.sections.find(s => s.opening.id === 'a2').marked && !td.sections.find(s => s.opening.id === 'dm2').marked);
  eq('the totals count the work left', td.totals.map(t => t.text).join('; '), 'Reputty x1 pane; Resin repair x1 part; Splice timber x1 part');
  eq('3 coats say so', W.reportModel({ property: Object.assign({}, tp, { coats: 3 }), openings: [a2], marks: [] }, [], { todo: true }).sections[0].quoted[0], 'Paint: light prep, 3 coats');
  const done = W.reportModel({ property: tp, openings: [a1, a2, dm], marks: tm }, vars);
  eq('the work report is unchanged: done work only', done.sections.map(s => s.opening.id).join(',') + ' ' + done.marks.map(m => m.id).join(','), 'a1 t2');
  check('no prices anywhere on it', !/£|\d+\.\d\d/.test(JSON.stringify(td.sections.map(s => [s.quoted, s.variations]))));
}

// ── The app ────────────────────────────────────────────────────────────────
check('openings are saved with their level, bay and pane flag', /level: Windoors\.levelOf\(o\)/.test(body('wdPutOpening')) && /parentOpeningId/.test(body('wdPutOpening')) && /panesSet/.test(body('wdPutOpening')));
check("a sash's bottom rows are saved", /rowsBottom/.test(body('wdPutOpening')));
check('an adopted bay re-points its windows', /x\.parent_opening_id === old/.test(body('wdPutOpening')));
check('confirming a layout makes bays with their windows', /wdEnsureBayChildren\(have\)/.test(body('confirmWdLayout')));
// v2.88.2: changing the house type hides, never deletes.
check('a house-type change asks before it hides openings', /confirm\(/.test(body('wdApplyAppearance')) && /Nothing is deleted/.test(body('wdApplyAppearance')));
check('...and deletes nothing', !/wdRemoveOpenings\(|wdDeleteOpening\(|delete L\[/.test(body('wdApplyAppearance')));
check('editing a side under a parapet keeps its dormers and their count', /roofHidden && \(!rf/.test(body('confirmWdLayout')) && /keptRoof/.test(body('confirmWdLayout')));
{
  const base = Object.assign(W.periodDefaults('georgian'), { form: 'detached', roof: 'eaves_to_street' });
  const p0 = { default_prep: 'light', coats: 2, appearance: base };
  const win = (id, side, extra) => Object.assign({ id, side, level: 'standard', floor: 0, kind: 'window', position: 1, type: 'sash', size_tier: 'medium', rows: 2, cols: 3 }, extra || {});
  const ops = [win('f', 'front'), win('l', 'left'), win('r', 'right', { position: 1 }), win('d', 'front', { level: 'roof', position: 1 }),
    { id: 'bl', side: 'left', level: 'standard', floor: 0, kind: 'bay', position: 2, bay_shape: 'canted', bay_storeys: 1, type: 'canted', size_tier: 'medium' },
    win('blk', 'left', { position: W.bayChildPosition(2, 0, 'front'), parent_opening_id: 'bl' }),
    { id: 'ol', side: 'left', level: 'standard', floor: 0, kind: 'other', position: 1, nickname: 'Porch', type: 'door', size_tier: 'standard', other_mins: 60 }];
  const marks = [{ opening_id: 'l', element_id: 'cill', action_key: 'resin', stage: 'variation', variation_id: 'vv' }];
  const at = a => ({ property: Object.assign({}, p0, { appearance: Object.assign({}, base, a) }), openings: ops, marks });
  const ids = d => W.liveOpenings(d.openings, d.property).map(o => o.id).sort().join(',');
  eq('detached with eaves: everything is on the house', ids(at({})), 'bl,blk,d,f,l,ol,r');
  eq('a mid terrace hides the ends -- windows, bays and their windows, other items', ids(at({ form: 'mid_terrace' })), 'd,f');
  eq('a parapet hides the dormers', ids(at({ roof: 'parapet' })), 'bl,blk,f,l,ol,r');
  eq("a side's own roof decides its dormers", ids(at({ roof: 'parapet', sides: { front: { roof: 'gable' } } })), 'bl,blk,d,f,l,ol,r');
  const full = W.priceJob(at({}), R), mid = W.priceJob(at({ form: 'mid_terrace' }), R);
  check('hidden openings come off the price', mid.quote.mins < full.quote.mins && mid.quote.count === 2);
  check("...and their variation work with them", !mid.variations.vv && full.variations.vv.mins > 0);
  eq('switching back restores the same figure', W.priceJob(at({ form: 'detached' }), R).quote.mins, full.quote.mins);
  eq('a job saved before house types reads as detached: nothing hidden', W.liveOpenings(ops.filter(o => o.level !== 'roof'), { default_prep: 'light' }).length, 6);
  check('hidden openings are off the item line', !/Porch|porch/.test(W.itemLineText(at({ form: 'mid_terrace' }))));
  eq('...and off the work to do', W.reportModel(at({ form: 'mid_terrace' }), [], { todo: true }).sections.map(x => x.opening.id).join(','), 'f,d');
  check('...and the paint', W.paintAreas(at({ form: 'mid_terrace' }), R).windows === 2);
}
check('changing period asks first only when something was changed by hand', /appearanceIsDefault/.test(body('setWdPeriod')));
check('the side selector offers only the sides the house has', /wdVisibleSides\(\)/.test(body('renderWindoors')));
check('the report PDF draws a bay with its windows', /children: mine\[k\]\.children/.test(body('buildWindoorsReportPdf')));
check('Other item figures are saved', /otherMins/.test(body('wdPutOpening')) && /otherCost/.test(body('wdPutOpening')) && /otherM2/.test(body('wdPutOpening')));
check('a tick is saved', /doneAt/.test(body('wdPutMark')));

// Variations persist, and orphans come back (v2.88.1). The carriers were
// never sent to the server, so a reload dropped them and left their marks
// priced into a variation billed nowhere.
check('the variation carriers are saved with the job', /windoorsVariations: Array\.isArray\(job\.windoorsVariations\)/.test(body('persistJobData')));
check('loading the fixture recovers orphaned variations', /wdRecoverVariations\(\)/.test(body('loadWindoors')));
{
  const recover = new Function('ctx', 'with (ctx) { return (' + body('wdRecoverVariations').trim() + ')(); }');
  const make = (list, marks, openings) => {
    const job = { id: 'j', windoorsVariations: list };
    const ctx = {
      windoors: { jobId: 'j', marks, openings: openings || [] }, activeJobId: 'j', jobs: [job],
      activeJob: () => job, wdVariationList: j => (j && Array.isArray(j.windoorsVariations)) ? j.windoorsVariations : [],
      localStorage: { setItem() {} }, persisted: 0, toasts: [], JSON, Date,
    };
    ctx.persistJobData = () => { ctx.persisted++; };
    ctx.toast = m => ctx.toasts.push(m);
    return { job, ctx };
  };
  const t1 = make([{ id: 'kept', sentAt: null }], [
    { opening_id: 'a', stage: 'variation', variation_id: 'kept', created_at: '2026-09-20T09:00:00Z' },
    { opening_id: 'a', stage: 'variation', variation_id: 'lost1', created_at: '2026-09-21T09:00:00Z' },
    { opening_id: 'b', stage: 'variation', variation_id: 'lost1', created_at: '2026-09-19T09:00:00Z' },
    { opening_id: 'b', stage: 'quote', variation_id: null },
  ], [{ id: 'c', prep_stage: 'variation', prep_variation_id: 'lost2' }]);
  eq('orphaned variation ids get their carrier back', recover(t1.ctx), 2);
  eq('...after the ones already there, so new marks still join the open draft', t1.job.windoorsVariations.map(v => v.id).join(','), 'kept,lost1,lost2');
  eq('...dated from their earliest mark', t1.job.windoorsVariations[1].createdAt, '2026-09-19T09:00:00Z');
  check('...as unanswered drafts', t1.job.windoorsVariations.slice(1).every(v => v.sentAt === null && !v.variationStatus && v.recoveredAt));
  check('...saved to the server, and said so', t1.ctx.persisted === 1 && /Recovered 2/.test(t1.ctx.toasts[0]));
  eq('running it again finds nothing', recover(t1.ctx), 0);
  const t2 = make(undefined, [{ opening_id: 'a', stage: 'quote' }]);
  check('nothing orphaned: nothing written', recover(t2.ctx) === 0 && t2.ctx.persisted === 0 && t2.job.windoorsVariations === undefined);
}
check('the work-to-do PDF is offered whenever there are openings', /saveWindoorsReportPdf\(true\)/.test(body('renderWindoors')) && /wdInUse\(\)/.test(body('renderWindoors')));
check('...and builds from the todo model', /todo: true/.test(body('wdTodoModelNow')) && /wdTodoModelNow\(\)/.test(body('buildWindoorsReportPdf')));
check('confirming a layout never removes an Other item', /o\.kind === 'other'/.test(body('confirmWdLayout')));
check('the invoice screen warns about unticked work', /wdUntickedCount\(\)/.test(body('renderFinalInvoice')));
check('dormers follow a side\'s own roof', /wdDormersAllowed\(a, wdSide\)/.test(body('confirmWdLayout')));
check('the Paint card folds too', /wdCardIsOpen\('paint'\)/.test(body('wdPaintCardHtml')));
check('the House card folds once a side is confirmed', /confirmed/.test(body('wdCardIsOpen')) && /wdCardIsOpen\('house'\)/.test(body('wdHouseIsOpen')) && /wdHouseIsOpen\(\)/.test(body('renderWindoors')) && /wdHouseSummary\(\)/.test(body('renderWindoors')));
check('access is saved with an opening', /access: o\.access/.test(body('wdPutOpening')));
check('the app prices with the Exterior access settings', /accessRates\(settings\)/.test(body('wdRates')));
check('the access figures are not stored as a second copy in windoorsRates', /delete R\.access/.test(body('readWindoorsRates')));
check('the detail sheet has an Access control', /wdAccessHtml\(o\)/.test(body('renderWdDetail')) && /wdAccessHtml\(o\)/.test(body('renderWdBay')));
check('the line list names the access', /openingAccess\(o\)/.test(body('wdWorkListHtml')));
check('the Rates card has the bay base minutes', /s-wd-bay-/.test(body('populateWindoorsRates')) && /s-wd-bay-/.test(body('readWindoorsRates')));

// ── v2.89.0: not in this job; Other items by time or at a set price ───────
{
  const pr = { default_prep: 'light', coats: 2 };
  const win = { id: 'w', side: 'front', floor: 0, level: 'standard', kind: 'window', type: 'sash', size_tier: 'medium', rows: 2, cols: 3, position: 1 };
  const dr = { id: 'd', side: 'front', floor: 0, level: 'standard', kind: 'door', type: 'panelled', size_tier: 'standard', rows: 3, cols: 2, position: 1 };
  const out = Object.assign({}, dr, { excluded: true });
  const only = W.priceJob({ property: pr, openings: [win], marks: [] }, R);
  const withOut = W.priceJob({ property: pr, openings: [win, out], marks: [{ opening_id: 'd', element_id: 'threshold', action_key: 'filler', stage: 'quote' }] }, R);
  near('a door not in this job prices as nothing', withOut.quote.mins, only.quote.mins);
  eq('...takes no materials, even with a stray mark', withOut.quote.materials, only.quote.materials);
  eq('...is not counted as an opening', withOut.quote.count, 1);
  eq('...but is counted as left out', withOut.excluded, 1);
  eq('...buys no paint', W.paintAreas({ openings: [win, out] }, R).door, 0);
  eq('...is left off the item line', W.itemLineText({ openings: [win, out], marks: [] }), 'Exterior windows and doors (outside faces): 1 sash window.');
  const svgOut = W.elevationSvg({ property: { appearance: W.periodDefaults('georgian'), layout: { front: { floors: [{ windows: 1, doors: 1 }], confirmed: true } } }, openings: [win, out], marks: [] }, 'front', { interactive: true });
  check('...is still drawn, faded with a grey dash in the app', svgOut.indexOf('data-open-id="d"') >= 0 && svgOut.indexOf('wd-excluded') >= 0 && !/NaN/.test(svgOut));
  const svgReport = W.elevationSvg({ property: { appearance: W.periodDefaults('georgian'), layout: { front: { floors: [{ windows: 1, doors: 1 }], confirmed: true } } }, openings: [win, out], marks: [] }, 'front', {});
  check('...and drawn plainly on the client\'s copy', svgReport.indexOf('wd-excluded') < 0);
  eq('...and is not on the work-to-do list', W.reportModel({ property: pr, openings: [win, out], marks: [] }, [], { todo: true }).sections.map(x => x.opening.id).join(','), 'w');

  // A bay out of the job takes its windows with it.
  const bay = { id: 'b', side: 'front', floor: 0, level: 'standard', kind: 'bay', type: 'canted', bay_shape: 'canted', bay_storeys: 1, size_tier: 'medium', rows: 1, cols: 1, position: 1, excluded: true };
  const kid = Object.assign({}, win, { id: 'k', position: W.bayChildPosition(1, 0, 'centre'), parent_opening_id: 'b' });
  eq('a bay\'s windows follow their bay out', W.priceJob({ property: pr, openings: [bay, kid], marks: [] }, R).quote.count, 0);

  // Brought in on site: a variation, the whole opening at its prep.
  const added = Object.assign({}, dr, { excluded: false, include_variation_id: 'v1' });
  const pa = W.priceJob({ property: pr, openings: [win, added], marks: [] }, R);
  near('added on site: nothing on the quote', pa.quote.mins, only.quote.mins);
  near('...all of it on the variation', pa.variations.v1.mins, W.paintedMinutes(dr, R) * R.prep.light);
  eq('...counted as an include', pa.variations.v1.includes, 1);
  check('...and worded', /D1: added to the job, light prep and paint\./.test(W.describeVariation({ property: pr, openings: [win, added], marks: [] }, 'v1')));
  eq('...its painting on the to-do list once approved', W.reportModel({ property: pr, openings: [added], marks: [] }, [{ id: 'v1', status: 'approved' }], { todo: true }).sections[0].variations.length, 1);
  eq('...and not before', W.reportModel({ property: pr, openings: [added], marks: [] }, [], { todo: true }).sections.length, 0);

  // Other items: time in any unit is stored as minutes; a set price is £.
  const oth = { id: 'o', side: 'front', floor: 0, level: 'standard', kind: 'other', position: 1, nickname: 'Portico', type: 'door', size_tier: 'standard', rows: 1, cols: 1,
    other_mins: 1260, other_cost: 20, other_m2: 3, other_unit: 'days' };
  near('a portico by time: 3 days of 7 hrs, at the job prep', W.priceJob({ property: pr, openings: [oth], marks: [] }, R).quote.mins, 1260 * R.prep.light);
  const fixedP = W.priceJob({ property: pr, openings: [Object.assign({}, oth, { other_pricing: 'price', other_price: 300 })], marks: [] }, R).quote;
  eq('at a set price: no minutes', fixedP.mins, 0);
  eq('...the price as it is, prep and all', fixedP.fixed, 300);
  eq('...and its materials still', fixedP.materials, 20);
  eq('by time carries no set price', W.priceJob({ property: pr, openings: [Object.assign({}, oth, { other_price: 300 })], marks: [] }, R).quote.fixed, 0);
  eq('its paint still counts at a set price', W.paintAreas({ openings: [Object.assign({}, oth, { other_pricing: 'price' })] }, R).door, 3);

  const L = require('../lib/windoors');
  const o1 = { side: 'front', kind: 'other', nickname: 'Porch', otherMins: 50000, otherPricing: 'price', otherPrice: 300, otherUnit: 'days' };
  eq('the server keeps longer times now', L.normaliseOpening(o1).other_mins, 50000);
  eq('...the pricing', L.normaliseOpening(o1).other_pricing, 'price');
  eq('...the price', L.normaliseOpening(o1).other_price, 300);
  eq('...the unit', L.normaliseOpening(o1).other_unit, 'days');
  eq('...an unknown unit reads as minutes', L.normaliseOpening(Object.assign({}, o1, { otherUnit: 'weeks' })).other_unit, 'mins');
  eq('...never leaves an Other item out', L.normaliseOpening(Object.assign({}, o1, { excluded: true })).excluded, false);
  const d1 = { side: 'front', kind: 'door', type: 'panelled', sizeTier: 'standard', excluded: true, includeVariationId: 'v1' };
  eq('a door can be left out', L.normaliseOpening(d1).excluded, true);
  eq('...and a left-out one is in no variation', L.normaliseOpening(d1).include_variation_id, null);
  eq('...brought in on site keeps its variation', L.normaliseOpening(Object.assign({}, d1, { excluded: false })).include_variation_id, 'v1');
}
check('the set price is in the fixture total', /quote\.fixed/.test(body('calcWindoors')));
check('left-out and set-price fields are saved', /excluded: !!o\.excluded/.test(body('wdPutOpening')) && /otherPrice/.test(body('wdPutOpening')));
check('the detail sheets have the In this job control', /wdScopeHtml\(o\)/.test(body('renderWdDetail')) && /wdScopeHtml\(o\)/.test(body('renderWdBay')));
check('a left-out opening takes no marks', /excluded\) return/.test(body('wdToggleElement')));

// ── v2.90.0: an Other item drawn as a porch over a door ────────────────────
{
  const a = W.periodDefaults('georgian');
  const door = { id: 'd', side: 'front', floor: 0, level: 'standard', kind: 'door', type: 'panelled', size_tier: 'standard', rows: 3, cols: 2, position: 1 };
  const win = { id: 'w', side: 'front', floor: 0, level: 'standard', kind: 'window', type: 'sash', size_tier: 'medium', rows: 2, cols: 3, position: 1 };
  const porch = { id: 'o', side: 'front', floor: 0, level: 'standard', kind: 'other', position: 1, nickname: 'Portico', type: 'door', other_draw: 'pediment', other_door: 1, other_mins: 60 };
  const prop = { appearance: a, layout: { front: { floors: [{ windows: 1, doors: 1 }], confirmed: true } } };
  const g = W.sideGeometry({ property: prop, openings: [win, door, porch], marks: [] }, 'front');
  eq('a porch over D1 goes over the door', g.porches[1] && g.porches[1].id, 'o');
  eq('...not in the tile strip', g.others.length, 0);
  W.PORCH_STYLES.forEach(ps => {
    const svg = W.elevationSvg({ property: prop, openings: [win, door, Object.assign({}, porch, { other_draw: ps.key })], marks: [] }, 'front', { interactive: true });
    check('the ' + ps.key + ' porch draws, tappable, with no bad numbers', svg.indexOf('data-open-id="o"') >= 0 && !/NaN|undefined/.test(svg));
    check('...and has a preview', /<svg/.test(W.porchPreviewSvg(ps.key, a)) && !/NaN|undefined/.test(W.porchPreviewSvg(ps.key, a)));
  });
  eq('with no such door it is a tile', W.sideGeometry({ property: prop, openings: [win, door, Object.assign({}, porch, { other_door: 2 })], marks: [] }, 'front').others.length, 1);
  eq('a second porch on the same door is a tile', W.sideGeometry({ property: prop, openings: [win, door, porch, Object.assign({}, porch, { id: 'o2', position: 2 })], marks: [] }, 'front').others.map(o => o.id).join(','), 'o2');
  eq('an unknown style reads as a tile', W.otherDraw(Object.assign({}, porch, { other_draw: 'spaceship' })), 'tile');
  near('drawing it as a porch changes no price', W.priceJob({ property: { default_prep: 'light' }, openings: [door, porch], marks: [] }, R).quote.mins,
    W.priceJob({ property: { default_prep: 'light' }, openings: [door, Object.assign({}, porch, { other_draw: null })], marks: [] }, R).quote.mins);
  eq('"portico" on a Georgian house picks the pediment', W.porchStyleFor('Front portico', 'georgian'), 'pediment');
  eq('"canopy" picks the canopy', W.porchStyleFor('Door canopy', 'victorian'), 'canopy');
  eq('"garage door" is no porch', W.porchStyleFor('Garage door', 'victorian'), null);
  const L = require('../lib/windoors');
  const n = L.normaliseOpening({ side: 'front', kind: 'other', nickname: 'Porch', otherDraw: 'hood', otherDoor: 2 });
  eq('the server keeps the style', n.other_draw, 'hood');
  eq('...and the door', n.other_door, 2);
  eq('...drops an unknown style', L.normaliseOpening({ side: 'front', kind: 'other', nickname: 'Porch', otherDraw: 'x', otherDoor: 2 }).other_draw, null);
}
check('the porch style is saved', /otherDraw: o\.other_draw/.test(body('wdPutOpening')));
check('the Other sheet has the Drawn as picker', /wdOtherDrawHtml\(o\)/.test(body('renderWdDetail')));

console.log(pass.length + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  ✗ ' + f));
process.exit(fail.length ? 1 : 0);
