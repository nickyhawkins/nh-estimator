// ── Windows and doors fixture: the shared half ─────────────────────────────
// WINDOWS_DOORS_SPEC.md. One file, loaded three ways:
//   · by public/index.html (a plain <script>, exposes window.Windoors) -- the
//     app prices, draws and describes the fixture with it;
//   · by routes/publicQuote.js and routes/api.js (require) -- the client's
//     variation page and the PDF-ready report draw the SAME diagrams from the
//     same rows, with no calc engine of their own;
//   · by scripts/test-windoors.js (require) -- so the tests exercise the
//     shipping code rather than a copy of it.
//
// Everything here is PURE: rows in, numbers/strings out. No DOM, no fetch, no
// settings lookup -- the caller hands in the rates. That is what lets the
// server draw a report without the browser's calc engine, and it is why the
// report can promise it shows no prices: nothing in the drawing path ever
// sees one.
//
// Three rules from the spec are enforced HERE rather than in the UI, so no
// screen can get them wrong:
//   1. The quote is the floor. Per-opening detail only ever ADDS minutes --
//      there is no negative action, and prep can only go up (effectivePrep).
//   2. Prep is a job default an opening can raise, never lower.
//   3. Every mark belongs to a stage: 'quote' marks are the quote, 'variation'
//      marks are extras, and the two are never summed into the same figure.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Windoors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Vocabulary ───────────────────────────────────────────────────────────
  var SIDES = [
    { key: 'front', label: 'Front' },
    { key: 'back', label: 'Back' },
    { key: 'left', label: 'Left' },
    { key: 'right', label: 'Right' }
  ];
  // The house's period (stage 1 called it the style, and the column is still
  // job_property.style -- kept in step with appearance.period so an older app
  // shell still draws the right house). STYLES is the same list.
  var PERIODS = [
    { key: 'georgian', label: 'Georgian' },
    { key: 'victorian', label: 'Victorian' },
    { key: 'modern', label: 'Modern' }
  ];
  var STYLES = PERIODS;
  // Where on the side an opening is (stage 2). `standard` is the ordinary
  // floors, numbered by `floor` (0 = ground); the other two have no floor
  // number of their own.
  var LEVELS = [
    { key: 'lower_ground', label: 'Lower ground' },
    { key: 'standard', label: 'Floors' },
    { key: 'roof', label: 'Dormers' }
  ];
  var BAY_SHAPES = [
    { key: 'canted', label: 'Canted' },
    { key: 'square', label: 'Square' }
  ];
  // A bay's windows, left to right as you face it.
  var BAY_FACES = ['left', 'front', 'right'];
  var WINDOW_TYPES = [
    { key: 'casement', label: 'Casement' },
    { key: 'sash', label: 'Sash' },
    { key: 'fixed', label: 'Fixed' }
  ];
  var DOOR_TYPES = [
    { key: 'panelled', label: 'Panelled' },
    { key: 'flush', label: 'Flush' },
    { key: 'half_glazed', label: 'Half glazed' },
    { key: 'fully_glazed', label: 'Fully glazed' },
    { key: 'stable', label: 'Stable' },
    { key: 'french_double', label: 'French (double)' }
  ];
  // `guide` is the area hint the spec wants on each tier button.
  var WINDOW_TIERS = [
    { key: 'small', label: 'Small', guide: 'under 0.5m²' },
    { key: 'medium', label: 'Medium', guide: '0.5 to 1m²' },
    { key: 'large', label: 'Large', guide: '1 to 2m²' },
    { key: 'xlarge', label: 'X-Large', guide: 'over 2m²' }
  ];
  var DOOR_TIERS = [
    { key: 'standard', label: 'Standard', guide: 'single leaf' },
    { key: 'oversized', label: 'Oversized', guide: 'wide or tall' }
  ];
  // In order, lightest first: an opening's level is only ever compared by its
  // position in this list, which is what makes "can go up, never down" a
  // one-line rule.
  var PREP_LEVELS = [
    { key: 'light', label: 'Light' },
    { key: 'standard', label: 'Standard' },
    { key: 'heavy', label: 'Heavy' },
    { key: 'restoration', label: 'Restoration' }
  ];
  // `on` is the element kind an action applies to. For doors, glass takes the
  // pane actions and panels take the timber (part) actions -- a door panel is
  // timber, and filling or resin-repairing one is the same job as on a stile.
  // `doorOnly`: ironmongery has nothing to come off a window frame.
  var ACTIONS = [
    { key: 'reputty', label: 'Reputty', verb: 'reputty', on: 'pane' },
    { key: 'replace_glass', label: 'Replace glass', verb: 'replace glass', on: 'pane', glass: true },
    { key: 'filler', label: 'Filler', verb: 'filler', on: 'part' },
    { key: 'resin', label: 'Resin repair', verb: 'resin repair', on: 'part' },
    { key: 'splice', label: 'Splice timber', verb: 'splice timber', on: 'part' },
    { key: 'ironmongery', label: 'Ironmongery off & on', verb: 'ironmongery off and on', on: 'part', doorOnly: true }
  ];

  // ── Appearance (stage 2) ─────────────────────────────────────────────────
  // WINDOWS_DOORS_STAGE2_SPEC.md. The period is a starting point, not a lock:
  // picking one applies its defaults, and every option can then be changed
  // for the job. NONE of this is priced -- it is what the drawing looks like.
  // What IS priced (dormers, a lower ground floor, bays) lives in the layout
  // and the openings, never here.
  var FINISHES = [
    { key: 'stucco', label: 'Stucco' },
    { key: 'buff_brick', label: 'Buff brick' },
    { key: 'gault_brick', label: 'Gault brick' },
    { key: 'render', label: 'Render' },
    { key: 'painted_brick', label: 'Painted brick' }
  ];
  var FORMS = [
    { key: 'detached', label: 'Detached' },
    { key: 'semi', label: 'Semi' },
    { key: 'end_terrace', label: 'End terrace' },
    { key: 'mid_terrace', label: 'Mid terrace' }
  ];
  var EXPOSED_SIDES = [
    { key: 'left', label: 'Left' },
    { key: 'right', label: 'Right' }
  ];
  var ROOFS = [
    { key: 'parapet', label: 'Parapet' },
    { key: 'eaves_to_street', label: 'Eaves to street' },
    { key: 'front_gable', label: 'Front gable' }
  ];
  // The Details, per period. `bool` options are on/off; the rest pick one.
  var PERIOD_OPTIONS = {
    georgian: [
      { key: 'doorcase', label: 'Doorcase', options: [
        { key: 'pedimented_radial', label: 'Pediment, radial fanlight' },
        { key: 'plain_fanlight', label: 'Plain fanlight' },
        { key: 'portico', label: 'Portico' }] },
      { key: 'heads', label: 'Window heads', note: 'arches show on a brick finish', options: [
        { key: 'gauged_brick_arch', label: 'Gauged brick arches' },
        { key: 'plain', label: 'Plain' }] },
      { key: 'glazing', label: 'Glazing', note: 'new sashes start with it', options: [
        { key: '6_over_6', label: '6 over 6' },
        { key: '8_over_8', label: '8 over 8' }] },
      { key: 'band_courses', label: 'Band course', bool: true },
      { key: 'railings', label: 'Front railings', bool: true }
    ],
    victorian: [
      { key: 'sash', label: 'Sashes', note: 'new sashes start with it', options: [
        { key: '1_over_1', label: '1 over 1' },
        { key: '2_over_2', label: '2 over 2' },
        { key: 'margin_lights', label: 'Margin lights' }] },
      { key: 'heads', label: 'Window heads', options: [
        { key: 'stone_keystone', label: 'Stone, keystone' },
        { key: 'brick_arch', label: 'Brick arch' }] },
      { key: 'entrance', label: 'Entrance', options: [
        { key: 'recessed_arched_porch', label: 'Recessed arched porch' },
        { key: 'open_with_canopy', label: 'Open, with canopy' },
        { key: 'gabled_timber_porch', label: 'Gabled timber porch' }] },
      { key: 'bargeboards', label: 'Bargeboards', note: 'on a front gable', bool: true },
      { key: 'brick_detailing', label: 'Brick detailing', note: 'on a brick finish', options: [
        { key: 'plain', label: 'Plain' },
        { key: 'polychrome_bands', label: 'Polychrome bands' }] }
    ],
    modern: []
  };
  var PERIOD_DEFAULTS = {
    georgian: { finish: 'stucco', roof: 'parapet', form: 'mid_terrace' },
    victorian: { finish: 'buff_brick', roof: 'eaves_to_street', form: 'semi' },
    modern: { finish: 'render', roof: 'eaves_to_street', form: 'detached' }
  };
  var DETAIL_DEFAULTS = {
    georgian: { doorcase: 'pedimented_radial', heads: 'plain', glazing: '6_over_6', band_courses: true, railings: true },
    victorian: { sash: '2_over_2', heads: 'stone_keystone', entrance: 'recessed_arched_porch', bargeboards: false, brick_detailing: 'plain' }
  };
  var BRICK_FINISHES = { buff_brick: true, gault_brick: true, painted_brick: true };

  function inList(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return true;
    return false;
  }
  function periodKey(p) { return inList(PERIODS, p) ? p : 'georgian'; }

  // Everything a period starts with. Both periods' Details are always
  // present (a Victorian job keeps its Georgian options in the drawer, set to
  // their defaults) so a period switched and switched back loses nothing.
  function periodDefaults(period) {
    period = periodKey(period);
    var d = PERIOD_DEFAULTS[period];
    return {
      period: period, finish: d.finish, form: d.form, exposed_side: 'left', roof: d.roof,
      georgian: Object.assign({}, DETAIL_DEFAULTS.georgian),
      victorian: Object.assign({}, DETAIL_DEFAULTS.victorian)
    };
  }
  function normaliseDetails(period, raw) {
    var out = {};
    raw = raw && typeof raw === 'object' ? raw : {};
    PERIOD_OPTIONS[period].forEach(function (opt) {
      var v = raw[opt.key];
      if (opt.bool) out[opt.key] = typeof v === 'boolean' ? v : DETAIL_DEFAULTS[period][opt.key];
      else out[opt.key] = inList(opt.options, v) ? v : DETAIL_DEFAULTS[period][opt.key];
    });
    return out;
  }
  // A complete, valid appearance from whatever was saved: unknown values fall
  // back to the period's default one field at a time. The server runs the
  // same function before it stores one.
  function normaliseAppearance(raw, fallbackPeriod) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var d = periodDefaults(inList(PERIODS, raw.period) ? raw.period : fallbackPeriod);
    return {
      period: d.period,
      finish: inList(FINISHES, raw.finish) ? raw.finish : d.finish,
      form: inList(FORMS, raw.form) ? raw.form : d.form,
      exposed_side: inList(EXPOSED_SIDES, raw.exposed_side) ? raw.exposed_side : 'left',
      roof: inList(ROOFS, raw.roof) ? raw.roof : d.roof,
      georgian: normaliseDetails('georgian', raw.georgian),
      victorian: normaliseDetails('victorian', raw.victorian)
    };
  }
  // The job's appearance. A job saved before stage 2 has only a style: it
  // reads as that period's defaults, but DETACHED -- the stage 1 drawing had
  // every side available and no neighbours drawn, and the job's left and
  // right openings must not vanish behind a terrace it never chose.
  function appearanceOf(property) {
    var a = property && property.appearance;
    if (a && typeof a === 'object' && a.period) return normaliseAppearance(a);
    var legacy = periodDefaults(property && property.style);
    legacy.form = 'detached';
    return legacy;
  }
  // Has anything been changed from what the period starts with? (Changing
  // period asks first when it has.)
  function appearanceIsDefault(a) {
    a = normaliseAppearance(a);
    var d = periodDefaults(a.period);
    if (a.finish !== d.finish || a.roof !== d.roof || a.form !== d.form) return false;
    var mine = a[a.period] || {}, dd = DETAIL_DEFAULTS[a.period] || {};
    return Object.keys(dd).every(function (k) { return mine[k] === dd[k]; });
  }
  // The sides a house of this form has to paint. A semi or an end terrace
  // shows one side (the exposed one); a mid terrace none.
  function visibleSides(a) {
    a = normaliseAppearance(a);
    if (a.form === 'mid_terrace') return ['front', 'back'];
    if (a.form === 'semi' || a.form === 'end_terrace') return ['front', 'back', a.exposed_side];
    return ['front', 'back', 'left', 'right'];
  }
  // Which edges of this elevation have a neighbour against them, as you face
  // it. The house's left and right are named facing the front, so from the
  // back they swap.
  function attachedEdges(a, side) {
    a = normaliseAppearance(a);
    if (side !== 'front' && side !== 'back') return { left: false, right: false };
    if (a.form === 'mid_terrace') return { left: true, right: true };
    if (a.form === 'semi' || a.form === 'end_terrace') {
      var party = a.exposed_side === 'left' ? 'right' : 'left';
      if (side === 'back') party = party === 'left' ? 'right' : 'left';
      return { left: party === 'left', right: party === 'right' };
    }
    return { left: false, right: false };
  }
  // How the roof reads on this side: the front and back see the eaves, a
  // parapet or the gable; the ends of the house see the other one.
  function roofKindFor(a, side) {
    a = normaliseAppearance(a);
    var end = side === 'left' || side === 'right';
    if (a.roof === 'front_gable') return end ? 'eaves' : 'gable';
    if (end) return 'gable';
    return a.roof === 'parapet' ? 'parapet' : 'eaves';
  }

  // The Rates page's figures, as shipped. Minutes throughout, converted to £
  // at the day rate by the caller exactly like every other timed task in the
  // app. Seed values only -- every one is editable on the Rates page and none
  // is a market price.
  //
  // Prep multipliers mirror the exterior form's levels since v2.81.1 (Light
  // 10% / Standard 25% / Heavy 40%) so the two exterior paths agree about what
  // "Heavy" costs; Restoration is new and has no older figure to match.
  var DEFAULT_RATES = {
    winBase: { small: 30, medium: 40, large: 55, xlarge: 75 },
    perPane: 4,
    // Multiplies the tier's base minutes. Sash has more parts to paint (two
    // sashes, a meeting rail, the box), fixed lights fewer.
    typeAdj: { casement: 1, sash: 1.3, fixed: 0.8 },
    doorBase: {
      panelled: { standard: 90, oversized: 120 },
      flush: { standard: 60, oversized: 80 },
      half_glazed: { standard: 90, oversized: 120 },
      fully_glazed: { standard: 80, oversized: 110 },
      stable: { standard: 110, oversized: 145 },
      french_double: { standard: 150, oversized: 200 }
    },
    prep: { light: 1.1, standard: 1.25, heavy: 1.4, restoration: 1.75 },
    // A bay's own timber -- cornice, fascia and mullions -- by shape and
    // storeys, ON TOP of its windows, which price as ordinary windows. A
    // canted bay has two more angled joints than a square one.
    bayBase: { canted: { 1: 90, 2: 160 }, square: { 1: 70, 2: 125 } },
    // Per element marked. cost is a material £ per element (glass per pane),
    // before the job's markup.
    // Paint: the outside face's TIMBER, not the opening. Each opening is its
    // size tier's own area (the middle of the area guide on the tier button),
    // times the share of it that is timber rather than glass. More panes means
    // more glazing bars, so a little more timber per extra pane, capped.
    paint: {
      area: { small: 0.35, medium: 0.75, large: 1.5, xlarge: 2.5, standard: 1.75, oversized: 2.2 },
      timber: { casement: 0.35, sash: 0.4, fixed: 0.25 },
      perPane: 0.02,
      cap: 0.6,
      // Doors: share of the leaf that is timber (the rest is glass), plus the
      // frame per leaf in m².
      doorTimber: { panelled: 1, flush: 1, stable: 1, half_glazed: 0.75, fully_glazed: 0.45, french_double: 0.45 },
      doorFrame: 0.4,
      // A bay's cornice, fascia, mullions and cill, per storey (its windows
      // are counted as windows).
      bay: 1.2
    },
    actions: {
      reputty: { mins: 20, cost: 0 },
      replace_glass: { mins: 30, cost: 25 },
      filler: { mins: 10, cost: 0 },
      resin: { mins: 25, cost: 4 },
      splice: { mins: 60, cost: 8 },
      ironmongery: { mins: 20, cost: 0 }
    }
  };

  function num(v, d) { var n = +v; return isFinite(n) ? n : d; }

  // A complete rates object from whatever is saved, falling back per field --
  // a saved 0 is a real figure and is kept.
  function mergeRates(raw) {
    raw = raw || {};
    var out = { winBase: {}, perPane: 0, typeAdj: {}, doorBase: {}, prep: {}, bayBase: {}, actions: {} };
    WINDOW_TIERS.forEach(function (t) {
      out.winBase[t.key] = Math.max(0, num((raw.winBase || {})[t.key], DEFAULT_RATES.winBase[t.key]));
    });
    out.perPane = Math.max(0, num(raw.perPane, DEFAULT_RATES.perPane));
    WINDOW_TYPES.forEach(function (t) {
      out.typeAdj[t.key] = Math.max(0, num((raw.typeAdj || {})[t.key], DEFAULT_RATES.typeAdj[t.key]));
    });
    DOOR_TYPES.forEach(function (t) {
      var saved = (raw.doorBase || {})[t.key] || {};
      out.doorBase[t.key] = {};
      DOOR_TIERS.forEach(function (s) {
        out.doorBase[t.key][s.key] = Math.max(0, num(saved[s.key], DEFAULT_RATES.doorBase[t.key][s.key]));
      });
    });
    PREP_LEVELS.forEach(function (p) {
      out.prep[p.key] = Math.max(0, num((raw.prep || {})[p.key], DEFAULT_RATES.prep[p.key]));
    });
    BAY_SHAPES.forEach(function (b) {
      var saved = (raw.bayBase || {})[b.key] || {};
      out.bayBase[b.key] = {};
      [1, 2].forEach(function (n) {
        out.bayBase[b.key][n] = Math.max(0, num(saved[n], DEFAULT_RATES.bayBase[b.key][n]));
      });
    });
    var sp = raw.paint || {}, dp = DEFAULT_RATES.paint;
    out.paint = { area: {}, timber: {}, doorTimber: {} };
    WINDOW_TIERS.concat(DOOR_TIERS).forEach(function (t) {
      out.paint.area[t.key] = Math.max(0, num((sp.area || {})[t.key], dp.area[t.key]));
    });
    WINDOW_TYPES.forEach(function (t) {
      out.paint.timber[t.key] = Math.max(0, Math.min(1, num((sp.timber || {})[t.key], dp.timber[t.key])));
    });
    DOOR_TYPES.forEach(function (t) {
      out.paint.doorTimber[t.key] = Math.max(0, Math.min(1, num((sp.doorTimber || {})[t.key], dp.doorTimber[t.key])));
    });
    out.paint.perPane = Math.max(0, num(sp.perPane, dp.perPane));
    out.paint.cap = Math.max(0, Math.min(1, num(sp.cap, dp.cap)));
    out.paint.doorFrame = Math.max(0, num(sp.doorFrame, dp.doorFrame));
    out.paint.bay = Math.max(0, num(sp.bay, dp.bay));
    ACTIONS.forEach(function (a) {
      var saved = (raw.actions || {})[a.key] || {};
      out.actions[a.key] = {
        mins: Math.max(0, num(saved.mins, DEFAULT_RATES.actions[a.key].mins)),
        cost: Math.max(0, num(saved.cost, DEFAULT_RATES.actions[a.key].cost))
      };
    });
    return out;
  }

  function findKey(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function actionDef(key) { return findKey(ACTIONS, key); }
  function prepRank(key) {
    for (var i = 0; i < PREP_LEVELS.length; i++) if (PREP_LEVELS[i].key === key) return i;
    return -1;
  }
  function prepLabel(key) { var p = findKey(PREP_LEVELS, key); return p ? p.label : 'Light'; }
  // The higher of two levels. Unknown/absent reads as the lightest.
  function maxPrep(a, b) { return prepRank(a) >= prepRank(b) ? (prepRank(a) < 0 ? 'light' : a) : b; }

  function floorLabel(n) {
    n = +n || 0;
    return ['ground floor', 'first floor', 'second floor', 'third floor', 'fourth floor'][n] || (n + 'th floor');
  }
  function sideLabel(key) { var s = findKey(SIDES, key); return s ? s.label : key; }
  function typeLabel(o) {
    if (o.kind === 'bay') { var b = findKey(BAY_SHAPES, o.bay_shape); return b ? b.label : 'Canted'; }
    var t = findKey(o.kind === 'door' ? DOOR_TYPES : WINDOW_TYPES, o.type);
    return t ? t.label : '';
  }
  function levelOf(o) { return o && (o.level === 'lower_ground' || o.level === 'roof') ? o.level : 'standard'; }
  // "Sash window", "Canted bay", "Panelled door" -- what the thing is, for
  // the report and the detail sheet.
  function kindNoun(o) {
    if (o.kind === 'bay') return typeLabel(o) + ' bay';
    if (o.kind === 'door') return typeLabel(o) + ' door';
    return (levelOf(o) === 'roof' ? 'Dormer, ' + typeLabel(o).toLowerCase() : typeLabel(o)) + ' window';
  }

  // ── Layout: the per-side floor counts ────────────────────────────────────
  // property.layout = { front: { floors: [{windows, doors, bays}, ...],
  // lower_ground: {windows, doors} | null, roof: {windows} | null, confirmed },
  // ... }. Floor 0 is the ground floor. A side nobody has set up yet reads as
  // one ground floor with nothing on it. lower_ground and roof are stage 2:
  // null (or absent, on a stage 1 row) means the side has none.
  function count(v, max) { return Math.max(0, Math.min(max, Math.floor(+v || 0))); }
  function sideLayout(property, side) {
    var l = property && property.layout && property.layout[side];
    var floors = (l && Array.isArray(l.floors) && l.floors.length ? l.floors : [{ windows: 0, doors: 0 }])
      .map(function (f) { return { windows: count(f && f.windows, 99), doors: count(f && f.doors, 99), bays: count(f && f.bays, 99) }; });
    var lg = l && l.lower_ground, rf = l && l.roof;
    return {
      floors: floors, confirmed: !!(l && l.confirmed),
      lower_ground: lg && typeof lg === 'object' ? { windows: count(lg.windows, 99), doors: count(lg.doors, 99) } : null,
      roof: rf && typeof rf === 'object' ? { windows: count(rf.windows, 99) } : null
    };
  }

  // The sash grid a period starts with, per sash: 6-over-6 is 2 rows of 3.
  function periodSashGrid(a) {
    a = typeof a === 'string' ? periodDefaults(a) : normaliseAppearance(a);
    if (a.period === 'victorian') {
      return { '1_over_1': { rows: 1, cols: 1 }, margin_lights: { rows: 3, cols: 3 } }[a.victorian.sash] || { rows: 1, cols: 2 };
    }
    if (a.period === 'georgian') return a.georgian.glazing === '8_over_8' ? { rows: 2, cols: 4 } : { rows: 2, cols: 3 };
    return null;
  }

  // Defaults for a new opening, by the house's appearance (or, as stage 1
  // called it, a style string). The pane layout is what a real house of
  // that period usually has, so a confirmed layout is right straight away
  // more often than not.
  function openingDefaults(a, kind, floor, level) {
    a = typeof a === 'string' || !a ? periodDefaults(a) : normaliseAppearance(a);
    var style = a.period;
    level = level === 'lower_ground' || level === 'roof' ? level : 'standard';
    if (kind === 'door') {
      // Under the front steps: a plain working door.
      if (level === 'lower_ground') return style === 'modern' ? { type: 'flush', size_tier: 'standard', rows: 1, cols: 1 } : { type: 'panelled', size_tier: 'standard', rows: 2, cols: 2 };
      if (floor > 0) return { type: 'french_double', size_tier: 'standard', rows: 3, cols: 1 };
      if (style === 'georgian') return { type: 'panelled', size_tier: 'standard', rows: 3, cols: 2 };
      if (style === 'victorian') return { type: 'half_glazed', size_tier: 'standard', rows: 1, cols: 2 };
      return { type: 'flush', size_tier: 'standard', rows: 1, cols: 1 };
    }
    if (style === 'modern') return { type: 'casement', size_tier: level === 'roof' ? 'small' : 'medium', rows: 1, cols: 2 };
    var g = periodSashGrid(a);
    if (level === 'roof') {
      // A dormer's sash is a small one: on a Georgian house its top sash
      // loses a row (3-over-6 beside 6-over-6).
      return style === 'georgian'
        ? { type: 'sash', size_tier: 'small', rows: 1, rows_bottom: g.rows, cols: g.cols }
        : { type: 'sash', size_tier: 'small', rows: g.rows, cols: g.cols };
    }
    if (style === 'victorian') return { type: 'sash', size_tier: 'medium', rows: g.rows, cols: g.cols };
    // Georgian: the first floor (the piano nobile) is where the tall windows
    // are.
    return { type: 'sash', size_tier: floor === 1 && level === 'standard' ? 'large' : 'medium', rows: g.rows, cols: g.cols };
  }
  // A new bay: canted, and on a Victorian house a ground-floor bay runs up
  // through the first floor when there is one.
  function bayDefaults(a, floor, floorAbove) {
    a = typeof a === 'string' || !a ? periodDefaults(a) : normaliseAppearance(a);
    return { bay_shape: 'canted', bay_storeys: a.period === 'victorian' && floor === 0 && floorAbove ? 2 : 1 };
  }
  // A bay's window on one face: its front light is the floor's ordinary
  // window, the angled side lights a size smaller and a column narrower.
  function bayChildDefaults(a, floor, face) {
    var d = openingDefaults(a, 'window', floor, 'standard');
    if (face !== 'front') {
      d.size_tier = 'small';
      d.cols = Math.max(1, d.cols - 1);
    }
    return d;
  }

  // Which slots on a floor are doors (and bays), left to right. Doors sit
  // centred and evenly spread among the windows, deterministically, so the
  // drawing and the numbering never disagree about where D1 is; bays spread
  // the same way over what the doors left.
  function floorSlots(windows, doors, bays) {
    bays = bays || 0;
    var n = windows + doors + bays, kinds = [];
    for (var i = 0; i < n; i++) kinds.push('window');
    for (var d = 0; d < doors; d++) {
      var at = Math.min(n - 1, Math.max(0, Math.round((d + 0.5) * n / doors - 0.5)));
      while (kinds[at] === 'door') at = (at + 1) % n;
      kinds[at] = 'door';
    }
    for (var b = 0; b < bays; b++) {
      var bt = Math.min(n - 1, Math.max(0, Math.round((b + 0.5) * n / bays - 0.5)));
      while (kinds[bt] !== 'window') bt = (bt + 1) % n;
      kinds[bt] = 'bay';
    }
    return kinds;
  }

  // ── Bays: one opening holding windows ────────────────────────────────────
  // A bay is a row of kind 'bay' (its own painted timber) plus three child
  // window rows per storey, each with parent_opening_id set. A child's
  // position says which bay, storey and face it is -- 100 × the bay's
  // number + 10 × storey + face (1 left, 2 front, 3 right) -- so the row is
  // self-describing: "B1 front" can be labelled, sorted and upserted on its
  // slot without looking the bay up. An ordinary window is never numbered
  // past 99 on a floor, so the two can never share a slot.
  function isBayChild(o) { return !!(o && o.parent_opening_id); }
  function bayChildPosition(bayPosition, storey, face) {
    return (+bayPosition || 1) * 100 + (storey ? 10 : 0) + (BAY_FACES.indexOf(face) + 1);
  }
  function bayChildInfo(o) {
    var p = +o.position || 0;
    return { bay: Math.floor(p / 100), storey: Math.floor(p / 10) % 10, face: BAY_FACES[(p % 10) - 1] || 'front' };
  }
  function bayStoreys(o) { return +o.bay_storeys === 2 ? 2 : 1; }
  // The children of a bay, in the order the bay view lists them (storey by
  // storey, left to right).
  function bayChildren(bay, openings) {
    return (openings || []).filter(function (o) { return o.parent_opening_id && o.parent_opening_id === bay.id; })
      .sort(function (a, b) { return (+a.position || 0) - (+b.position || 0); });
  }

  // ── Elements: what can be tapped on an opening ───────────────────────────
  // `kind` is 'pane' or 'part' -- the two things a selection can be, never
  // both at once. Door glass counts as panes; door panels count as parts.
  function clampGrid(v, max) { return Math.max(1, Math.min(max || 8, Math.floor(+v || 1))); }
  // A sash's two grids. Both sashes share the columns; the bottom sash can
  // have rows of its own (rows_bottom) -- a 3-over-6 dormer is 1 row of 3
  // over 2 rows of 3. Unset (every row saved before it existed) = the same
  // as the top, so a 6-over-6 is still rows 2, cols 3.
  function sashRows(o) {
    var top = clampGrid(o.rows);
    return { top: top, bottom: o.rows_bottom == null ? top : clampGrid(o.rows_bottom) };
  }
  // "6 over 6", "3 over 6".
  function sashPattern(o) {
    var r = sashRows(o), c = clampGrid(o.cols);
    return (r.top * c) + ' over ' + (r.bottom * c);
  }

  function doorGlass(o) {
    var r = clampGrid(o.rows), c = clampGrid(o.cols);
    switch (o.type) {
      case 'half_glazed': return r * c;
      case 'fully_glazed': return r * c;
      case 'french_double': return 2 * r * c;
      default: return 0;
    }
  }
  function doorPanels(o) {
    var r = clampGrid(o.rows), c = clampGrid(o.cols);
    switch (o.type) {
      case 'panelled': return r * c;
      case 'stable': return r * c;
      case 'flush': return 1;
      case 'half_glazed': return 2; // the two lower panels below the glass
      default: return 0;
    }
  }

  function paneCount(o) {
    if (o.kind === 'bay') return 0;
    if (o.kind === 'door') return doorGlass(o);
    if (o.type === 'sash') { var sr = sashRows(o); return (sr.top + sr.bottom) * clampGrid(o.cols); }
    return clampGrid(o.rows) * clampGrid(o.cols);
  }

  var PART_LABELS = {
    head: 'head', left_stile: 'left stile', right_stile: 'right stile', bottom_rail: 'bottom rail',
    meeting_rail: 'meeting rail', cill: 'cill', stile_left: 'left stile', stile_right: 'right stile',
    top_rail: 'top rail', frame: 'frame', threshold: 'threshold',
    dormer_fascia: 'dormer fascia', dormer_cheek_left: 'left dormer cheek', dormer_cheek_right: 'right dormer cheek',
    bay_cornice: 'bay cornice', bay_fascia: 'bay fascia', bay_mullion_left: 'left mullion',
    bay_mullion_right: 'right mullion', bay_cill: 'bay cill'
  };
  var BAY_PARTS = ['bay_cornice', 'bay_fascia', 'bay_mullion_left', 'bay_mullion_right', 'bay_cill'];
  var DORMER_PARTS = ['dormer_fascia', 'dormer_cheek_left', 'dormer_cheek_right'];

  function openingElements(o) {
    var out = [];
    if (o.kind === 'bay') {
      BAY_PARTS.forEach(function (id) { out.push({ id: id, kind: 'part', label: PART_LABELS[id] }); });
      return out;
    }
    if (o.kind === 'door') {
      var g = doorGlass(o), p = doorPanels(o);
      for (var i = 1; i <= g; i++) out.push({ id: 'glass-' + i, kind: 'pane', label: 'glass ' + i });
      for (var j = 1; j <= p; j++) out.push({ id: 'panel-' + j, kind: 'part', label: 'panel ' + j });
      ['stile_left', 'stile_right', 'top_rail', 'bottom_rail', 'frame', 'threshold'].forEach(function (id) {
        out.push({ id: id, kind: 'part', label: PART_LABELS[id] });
      });
      return out;
    }
    var n = clampGrid(o.rows) * clampGrid(o.cols);
    if (o.type === 'sash') {
      var sr = sashRows(o), nc = clampGrid(o.cols);
      for (var t = 1; t <= sr.top * nc; t++) out.push({ id: 'top-' + t, kind: 'pane', label: 'top pane ' + t });
      for (var b = 1; b <= sr.bottom * nc; b++) out.push({ id: 'bottom-' + b, kind: 'pane', label: 'bottom pane ' + b });
    } else {
      for (var k = 1; k <= n; k++) out.push({ id: 'pane-' + k, kind: 'pane', label: 'pane ' + k });
    }
    var parts = o.type === 'sash'
      ? ['head', 'left_stile', 'right_stile', 'meeting_rail', 'bottom_rail', 'cill']
      : ['head', 'left_stile', 'right_stile', 'bottom_rail', 'cill'];
    // A dormer window has its surround to paint and mend as well.
    if (levelOf(o) === 'roof') parts = parts.concat(DORMER_PARTS);
    parts.forEach(function (id) { out.push({ id: id, kind: 'part', label: PART_LABELS[id] }); });
    return out;
  }
  function elementKind(o, elementId) {
    var els = openingElements(o);
    for (var i = 0; i < els.length; i++) if (els[i].id === elementId) return els[i].kind;
    return null;
  }
  // The actions that can go on a selection of this kind, for this opening.
  function actionsFor(o, kind) {
    return ACTIONS.filter(function (a) { return a.on === kind && (!a.doorOnly || o.kind === 'door'); });
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  function openingCode(o) {
    if (isBayChild(o)) { var c = bayChildInfo(o); return 'B' + c.bay + ' ' + c.face; }
    return (o.kind === 'door' ? 'D' : o.kind === 'bay' ? 'B' : 'W') + (+o.position || 1);
  }
  // Where on the side: "first floor", "lower ground", "dormer".
  function levelLabel(o) {
    var lv = levelOf(o);
    return lv === 'lower_ground' ? 'lower ground' : lv === 'roof' ? 'dormer' : floorLabel(o.floor);
  }
  // "Front, first floor, W2" -- the spec's auto label, nickname after it.
  // Stage 2: "Front, lower ground, W1", "Front, dormer, W2",
  // "Front, ground floor, B1 front".
  function openingLabel(o, withNickname) {
    var s = sideLabel(o.side) + ', ' + levelLabel(o) + ', ' + openingCode(o);
    if (withNickname !== false && o.nickname) s += ' (' + o.nickname + ')';
    return s;
  }
  // Side, then level (lower ground, the floors, the dormers), floor, then
  // windows, bays (each followed by its own windows), doors.
  function sortOpenings(list) {
    var sideRank = { front: 0, back: 1, left: 2, right: 3 };
    var levelRank = { lower_ground: 0, standard: 1, roof: 2 };
    var kindRank = function (o) { return isBayChild(o) || o.kind === 'bay' ? 1 : o.kind === 'door' ? 2 : 0; };
    var posKey = function (o) {
      if (o.kind === 'bay') return (+o.position || 0) * 100;
      if (isBayChild(o)) { var c = bayChildInfo(o); return c.bay * 100 + (+o.position % 10); }
      return +o.position || 0;
    };
    return list.slice().sort(function (a, b) {
      return (sideRank[a.side] - sideRank[b.side]) || (levelRank[levelOf(a)] - levelRank[levelOf(b)])
        || ((+a.floor || 0) - (+b.floor || 0)) || (kindRank(a) - kindRank(b)) || (posKey(a) - posKey(b));
    });
  }

  // ── Pricing ──────────────────────────────────────────────────────────────
  // The job default and the opening's own level, whichever is higher. An
  // opening that was set to Heavy keeps Heavy if the default later moves to
  // Standard; one left at the default follows it up.
  function effectivePrep(o, property) {
    var dflt = (property && property.default_prep) || 'light';
    return maxPrep(o.prep_level || dflt, dflt);
  }
  // The level the QUOTE priced. A level raised on site is a variation, and
  // the quote keeps the level that was in force before it (quote_prep_level,
  // stamped at the moment of the raise).
  function quotePrep(o, property) {
    var dflt = (property && property.default_prep) || 'light';
    if (o.prep_stage === 'variation') return maxPrep(o.quote_prep_level || dflt, dflt);
    return effectivePrep(o, property);
  }

  function baseMinutes(o, rates) {
    if (o.kind === 'bay') {
      var bb = rates.bayBase[o.bay_shape] || rates.bayBase.canted;
      return bb[bayStoreys(o)];
    }
    if (o.kind === 'door') {
      var d = rates.doorBase[o.type] || rates.doorBase.panelled;
      return d[o.size_tier] != null ? d[o.size_tier] : d.standard;
    }
    var b = rates.winBase[o.size_tier] != null ? rates.winBase[o.size_tier] : rates.winBase.medium;
    var adj = rates.typeAdj[o.type] != null ? rates.typeAdj[o.type] : 1;
    return b * adj;
  }
  // The painted opening before prep: base by tier and type, plus the panes
  // (glazing-bar cutting in). A bay's is its own timber only -- its windows
  // are openings of their own.
  function paintedMinutes(o, rates) {
    return baseMinutes(o, rates) + paneCount(o) * rates.perPane;
  }
  // The rows that exist as far as pricing, paint and words go. A bay's
  // window whose bay has gone (a delete racing an edit from a second phone)
  // is left out, the same way a mark on a deleted opening prices as nothing.
  function liveOpenings(openings) {
    var ids = {};
    (openings || []).forEach(function (o) { if (o.kind === 'bay') ids[o.id] = true; });
    return (openings || []).filter(function (o) { return !isBayChild(o) || ids[o.parent_opening_id]; });
  }

  // The whole fixture priced from its rows.
  //
  //   quote       minutes + materials the QUOTE carries: every opening at its
  //               quote prep level, plus every quote-stage mark
  //   variations  keyed by variation id: that draft/sent variation's marks,
  //               plus any prep raised on site into it (priced as the base at
  //               the new multiplier less the base at the old one -- never
  //               negative, the quote is the floor)
  //   perOpening  the same split per opening, for the detail view's line list
  //
  // Materials are the actions' £ before markup; the caller turns minutes into
  // £ at the day rate and the whole lot takes the job's markup like any line.
  function priceJob(data, rawRates) {
    var rates = rawRates && rawRates.winBase ? rawRates : mergeRates(rawRates);
    var property = (data && data.property) || {};
    var openings = liveOpenings(data && data.openings);
    var marks = (data && data.marks) || [];
    var out = { quote: { mins: 0, materials: 0, count: 0 }, variations: {}, perOpening: {} };
    var byId = {};
    var varBucket = function (id) {
      var k = id || 'unassigned';
      if (!out.variations[k]) out.variations[k] = { mins: 0, materials: 0, marks: 0, prepRaises: 0 };
      return out.variations[k];
    };
    openings.forEach(function (o) {
      byId[o.id] = o;
      var painted = paintedMinutes(o, rates);
      var qMult = rates.prep[quotePrep(o, property)] || 1;
      var per = { painted: painted, quoteMins: painted * qMult, quoteMaterials: 0, varMins: 0, varMaterials: 0 };
      out.perOpening[o.id] = per;
      out.quote.mins += per.quoteMins;
      out.quote.count++;
      if (o.prep_stage === 'variation') {
        var nowMult = rates.prep[effectivePrep(o, property)] || 1;
        var extra = Math.max(0, painted * (nowMult - qMult));
        if (extra > 0) {
          var vb = varBucket(o.prep_variation_id);
          vb.mins += extra; vb.prepRaises++;
          per.varMins += extra;
        }
      }
    });
    marks.forEach(function (m) {
      var o = byId[m.opening_id];
      if (!o) return;
      var a = rates.actions[m.action_key];
      if (!a) return;
      var per = out.perOpening[o.id];
      if (m.stage === 'variation') {
        var vb = varBucket(m.variation_id);
        vb.mins += a.mins; vb.materials += a.cost; vb.marks++;
        per.varMins += a.mins; per.varMaterials += a.cost;
      } else {
        out.quote.mins += a.mins; out.quote.materials += a.cost;
        per.quoteMins += a.mins; per.quoteMaterials += a.cost;
      }
    });
    return out;
  }

  // ── Paint: the outside-face area to buy paint for ────────────────────────
  // The TIMBER on the outside face, not the opening: a window is mostly
  // glass. Each opening starts from its own size -- the middle of its tier's
  // area guide (Medium is 0.5 to 1m², so 0.75) -- and takes the share of that
  // which is timber for its type, plus a little per extra pane for the
  // glazing bars, capped. A Medium 6-over-6 sash is 0.75 × 0.6 = 0.45m².
  // Doors take their leaf area times the timber share for their type (glass
  // is not painted) plus the frame, per leaf. All the figures are on the
  // Rates card; the caller turns m² × coats into litres at the exterior
  // woodwork coverage, exactly as the Exterior form's woodwork does.
  function openingPaintM2(o, rawRates) {
    var P = (rawRates && rawRates.paint && rawRates.paint.area ? rawRates : mergeRates(rawRates)).paint;
    if (o.kind === 'bay') return P.bay * bayStoreys(o);
    var area = P.area[o.size_tier] != null ? P.area[o.size_tier] : (o.kind === 'door' ? P.area.standard : P.area.medium);
    if (o.kind === 'door') {
      var leaves = o.type === 'french_double' ? 2 : 1;
      var share = P.doorTimber[o.type] != null ? P.doorTimber[o.type] : 1;
      // French doors' tier area is per leaf -- two of them.
      return (area * share + P.doorFrame) * leaves;
    }
    var base = P.timber[o.type] != null ? P.timber[o.type] : P.timber.casement;
    var timber = Math.min(P.cap, base + Math.max(0, paneCount(o) - 1) * P.perPane);
    return area * Math.max(base, timber);
  }
  // Totals by kind, because windows and doors can be different colours (the
  // white sashes and the black front door) and each colour is its own row of
  // tins.
  function paintAreas(data, rawRates) {
    var rates = rawRates && rawRates.paint && rawRates.paint.area ? rawRates : mergeRates(rawRates);
    var out = { window: 0, door: 0, windows: 0, doors: 0 };
    // A bay's own timber is painted with the windows (it is the window
    // joinery), but it is not a window to count.
    liveOpenings(data && data.openings).forEach(function (o) {
      var m2 = openingPaintM2(o, rates);
      if (o.kind === 'door') { out.door += m2; out.doors++; } else { out.window += m2; if (o.kind !== 'bay') out.windows++; }
    });
    return out;
  }

  // ── Words ────────────────────────────────────────────────────────────────
  // One opening's marks as a clause: "reputty x4 panes, resin repair (cill)".
  // Pane actions count panes (a client can count them); part actions name the
  // parts, because "resin repair x2" says nothing about where.
  function marksClause(o, marks) {
    var byAction = {}, order = [];
    var els = {};
    openingElements(o).forEach(function (e) { els[e.id] = e; });
    marks.forEach(function (m) {
      if (!byAction[m.action_key]) { byAction[m.action_key] = []; order.push(m.action_key); }
      byAction[m.action_key].push(m);
    });
    var actionOrder = ACTIONS.map(function (a) { return a.key; });
    order.sort(function (a, b) { return actionOrder.indexOf(a) - actionOrder.indexOf(b); });
    return order.map(function (k) {
      var a = actionDef(k);
      var list = byAction[k];
      if (!a) return '';
      if (a.on === 'pane') {
        var what = o.kind === 'door' ? (list.length === 1 ? 'glass panel' : 'glass panels') : (list.length === 1 ? 'pane' : 'panes');
        return a.verb + ' x' + list.length + ' ' + what;
      }
      var names = list.map(function (m) { return els[m.element_id] ? els[m.element_id].label : m.element_id; });
      return a.verb + ' (' + names.join(', ') + ')';
    }).filter(Boolean).join(', ');
  }

  // A variation's text, generated from its marks and prep raises, e.g.
  // "Front, first floor, W2: reputty x4 panes, resin repair (cill)."
  function describeVariation(data, variationId) {
    var openings = sortOpenings(liveOpenings(data && data.openings));
    var marks = (data && data.marks) || [];
    var property = (data && data.property) || {};
    var sentences = [];
    openings.forEach(function (o) {
      var mine = marks.filter(function (m) { return m.opening_id === o.id && m.stage === 'variation' && (m.variation_id || 'unassigned') === (variationId || 'unassigned'); });
      var bits = [];
      if (o.prep_stage === 'variation' && (o.prep_variation_id || 'unassigned') === (variationId || 'unassigned')
          && prepRank(effectivePrep(o, property)) > prepRank(quotePrep(o, property))) {
        bits.push('prep raised to ' + prepLabel(effectivePrep(o, property)).toLowerCase());
      }
      var clause = marksClause(o, mine);
      if (clause) bits.push(clause);
      if (bits.length) sentences.push(openingLabel(o) + ': ' + bits.join(', ') + '.');
    });
    return sentences.join(' ');
  }

  // The fixture's quote/invoice item line: what is included, in words, e.g.
  // "Exterior windows and doors (outside faces): 8 sash windows, 1 front door."
  // Quote-stage marked work is summarised briefly after it.
  function itemLineText(data) {
    var openings = liveOpenings(data && data.openings);
    var marks = (data && data.marks) || [];
    var counts = {}, order = [];
    var bump = function (k) { if (!counts[k]) { counts[k] = 0; order.push(k); } counts[k]++; };
    sortOpenings(openings).forEach(function (o) {
      if (o.kind === 'door') {
        var where = levelOf(o) === 'lower_ground' ? 'lower ground' : +o.floor > 0 ? 'balcony' : (o.side === 'front' ? 'front' : o.side === 'back' ? 'back' : 'side');
        bump(where + ' door');
      } else if (o.kind === 'bay') {
        bump(typeLabel(o).toLowerCase() + ' bay');
      } else if (levelOf(o) === 'roof') {
        bump('dormer window');
      } else {
        bump((typeLabel(o) || 'window').toLowerCase() + ' window');
      }
    });
    var head = 'Exterior windows and doors (outside faces)';
    if (!order.length) return head + '.';
    // Windows, then bays, then doors, whatever order the house was walked
    // in. (A bay's own windows are counted among the windows.)
    var rank = function (k) { return /door$/.test(k) ? 2 : /bay$/.test(k) ? 1 : 0; };
    order.sort(function (a, b) { return rank(a) - rank(b); });
    var text = head + ': ' + order.map(function (k) {
      return counts[k] + ' ' + k + (counts[k] === 1 ? '' : (/s$/.test(k) ? 'es' : 's'));
    }).join(', ') + '.';
    var qMarks = marks.filter(function (m) { return m.stage !== 'variation'; });
    if (qMarks.length) {
      var perAction = {}, aOrder = [];
      qMarks.forEach(function (m) { if (!perAction[m.action_key]) { perAction[m.action_key] = 0; aOrder.push(m.action_key); } perAction[m.action_key]++; });
      var keys = ACTIONS.map(function (a) { return a.key; }).filter(function (k) { return perAction[k]; });
      text += ' Includes ' + keys.map(function (k) { return actionDef(k).verb + ' x' + perAction[k]; }).join(', ') + '.';
    }
    return text;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  // Procedural SVG, drawn from the rows every time -- never stored. Plain
  // strings so the server can inline the very same markup into the report.
  //
  // Stage 2 draws from the job's APPEARANCE (appearanceOf) rather than a
  // fixed style: the period gives the joinery, doors and roof colours, the
  // finish the walls, the form the neighbours and which sides exist, the roof
  // its shape. A stage 1 job's appearance is its old style's defaults, which
  // draw the house it always drew.
  var PAL = {
    accent: '#1e6497', glassWork: '#5fb3e6', work: '#f0a020', ink: '#1a1f2e',
    georgian: { wall: '#efe8d8', wallLine: '#d8cdb4', roof: '#59616b', trim: '#fbf8f1', frame: '#fbfbf8', door: '#1d1d1f' },
    victorian: { wall: '#d9c088', wallLine: '#c3a86c', roof: '#4f5660', trim: '#ece6d6', frame: '#f6f3ea', door: '#2f5d3a' },
    modern: { wall: '#f4f4f1', wallLine: '#dcdcd6', low: '#8b8e91', lowLine: '#777a7d', roof: '#77736e', trim: '#e9e9e6', frame: '#383e42', door: '#6b7075' }
  };
  // Wall finishes. No red brick anywhere (the spec's rule): the gauged
  // arches and polychrome bands are a deeper buff, cream or grey.
  var FINISH_PAL = {
    stucco: { wall: '#efe8d8', line: '#d8cdb4', fine: '#e2d9c5', arch: '#d9cfb9' },
    buff_brick: { wall: '#d9c088', line: '#c3a86c', arch: '#c9a566', band: '#f0e7cf' },
    gault_brick: { wall: '#e2dcc5', line: '#cbc2a6', arch: '#d0c6a8', band: '#a5a39b' },
    render: { wall: '#f2ede1', line: null },
    painted_brick: { wall: '#f1efe9', line: '#dbd7cc', arch: '#e4e0d6', band: '#aeaca5' }
  };
  function finishPal(a) {
    // A Modern house's render is the white it has always been drawn in.
    if (a.finish === 'render' && a.period === 'modern') return { wall: PAL.modern.wall, line: null, stroke: PAL.modern.wallLine };
    var f = FINISH_PAL[a.finish] || FINISH_PAL.stucco;
    return { wall: f.wall, line: f.line, fine: f.fine, arch: f.arch, band: f.band, stroke: f.line || '#ddd6c6' };
  }
  function chimneyFill(a, fp) {
    // The stage 1 Victorian stacks; everything else in the wall's own finish.
    if (a.period === 'victorian' && a.finish === 'buff_brick') return '#b57a4f';
    return BRICK_FINISHES[a.finish] ? fp.line : fp.wall;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function rect(x, y, w, h, fill, extra) {
    return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '"' + (extra || '') + '/>';
  }
  function ln(x1, y1, x2, y2, stroke, sw) {
    return '<line x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
  }
  function poly(points, fill, extra) {
    return '<polygon points="' + points.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join(' ') + '" fill="' + fill + '"' + (extra || '') + '/>';
  }

  // Nominal drawn size of an opening, in elevation units. Scales with tier.
  // floor < 0 = not on a numbered floor (a dormer): no piano nobile.
  function drawnSize(o, style, floor) {
    if (o.kind === 'door') {
      var w = o.type === 'french_double' ? 64 : 40;
      if (o.size_tier === 'oversized') w *= 1.2;
      return { w: w, h: floor > 0 ? 76 : (o.size_tier === 'oversized' ? 88 : 80) };
    }
    var tw = { small: 26, medium: 34, large: 40, xlarge: 48 }[o.size_tier] || 34;
    var ratio = o.type === 'sash' ? 1.6 : o.type === 'fixed' ? 1.0 : 1.15;
    if (style === 'georgian' && floor === 1) ratio *= 1.15;
    if (style === 'georgian' && floor >= 2) ratio *= 0.8;
    return { w: tw, h: tw * ratio };
  }

  // What each opening's markers should say: quote work (solid badge) and/or
  // variation work (dashed badge). Raised prep counts as work at its stage.
  function workFlags(data) {
    var flags = {};
    var property = (data && data.property) || {};
    ((data && data.openings) || []).forEach(function (o) {
      var f = flags[o.id] = { quote: 0, variation: 0 };
      var dflt = property.default_prep || 'light';
      if (prepRank(quotePrep(o, property)) > prepRank(dflt)) f.quote++;
      if (o.prep_stage === 'variation' && prepRank(effectivePrep(o, property)) > prepRank(quotePrep(o, property))) f.variation++;
    });
    ((data && data.marks) || []).forEach(function (m) {
      var f = flags[m.opening_id];
      if (!f) return;
      if (m.stage === 'variation') f.variation++; else f.quote++;
    });
    return flags;
  }

  // The glazing an opening is DRAWN with. Once its pane layout has been set
  // in the detail view (panes_set), that layout; before then a sash shows the
  // period's glazing for where it is, so changing Georgian 6-over-6 to 8-over-8 redraws the
  // house without touching what anything is priced on. Placeholders (an
  // unconfirmed side) already carry the period's defaults.
  function drawnGrid(o, a) {
    var own = function () { var sr = sashRows(o); return { rows: sr.top, rowsBottom: o.type === 'sash' ? sr.bottom : sr.top, cols: clampGrid(o.cols) }; };
    if (o.panes_set || o.placeholder || o.type !== 'sash') return own();
    // What a new window in this spot starts as: a dormer's 3-over-6, a bay
    // side light's narrower grid, the floors' 6-over-6.
    var d = isBayChild(o) ? bayChildDefaults(a, +o.floor || 0, bayChildInfo(o).face) : openingDefaults(a, 'window', +o.floor || 0, levelOf(o));
    if (d.type !== 'sash') return own();
    return { rows: clampGrid(d.rows), rowsBottom: d.rows_bottom == null ? clampGrid(d.rows) : clampGrid(d.rows_bottom), cols: clampGrid(d.cols) };
  }

  // The head over a window: stone with a keystone or a brick arch
  // (Victorian), a flat gauged-brick arch (Georgian, brick finishes only).
  function headGlyph(x, y, w, a, p, fp) {
    var s = '';
    if (a.period === 'victorian') {
      if (a.victorian.heads === 'brick_arch') {
        var arch = fp.arch || '#c9a566';
        s += '<path d="M' + r1(x - 4) + ',' + r1(y) + ' Q' + r1(x + w / 2) + ',' + r1(y - 13) + ' ' + r1(x + w + 4) + ',' + r1(y)
          + ' L' + r1(x + w) + ',' + r1(y) + ' Q' + r1(x + w / 2) + ',' + r1(y - 7) + ' ' + r1(x) + ',' + r1(y) + ' Z" fill="' + arch + '" stroke="#9d8a5e" stroke-width="0.5"/>';
        for (var k = 1; k < 6; k++) {
          var t = k / 6, ox = x - 4 + t * (w + 8), ix = x + t * w;
          var oy = y - 13 * 2 * t * (1 - t) * 1, iy = y - 7 * 2 * t * (1 - t);
          s += ln(ox, oy, ix, iy, '#9d8a5e', 0.4);
        }
      } else {
        // stone head with a keystone
        s += rect(x - 4, y - 9, w + 8, 8, p.trim, ' stroke="#b9ae93" stroke-width="0.6"');
        s += rect(x + w / 2 - 3.5, y - 11, 7, 11, p.trim, ' stroke="#b9ae93" stroke-width="0.6"');
      }
    } else if (a.period === 'georgian' && a.georgian.heads === 'gauged_brick_arch' && BRICK_FINISHES[a.finish]) {
      // A flat arch: a fan of voussoirs, wider at the top, meeting at a point
      // below the window's centre.
      s += poly([[x - 5, y - 9], [x + w + 5, y - 9], [x + w + 1, y], [x - 1, y]], fp.arch, ' stroke="#9d8a5e" stroke-width="0.5"');
      var n = Math.max(5, Math.round(w / 4));
      for (var v = 1; v < n; v++) s += ln(x - 5 + v * (w + 10) / n, y - 9, x - 1 + v * (w + 2) / n, y, '#a8966b', 0.45);
    }
    return s;
  }

  // One window, in the house's joinery. opts: noHead / noCill (inside a
  // bay), narrow (a bay's foreshortened side light).
  function drawWindowGlyph(x, y, w, h, o, a, opts) {
    opts = opts || {};
    var style = a.period;
    var p = PAL[style] || PAL.georgian;
    var fp = finishPal(a);
    var s = '';
    var frame = p.frame, bar = style === 'modern' ? p.frame : '#ffffff';
    var glass = style === 'modern' ? '#9fb4c2' : '#8fa6b5';
    if (!opts.noHead) s += headGlyph(x, y, w, a, p, fp);
    s += rect(x, y, w, h, frame, ' stroke="#555" stroke-width="0.8"');
    var inset = opts.narrow ? 1.5 : style === 'modern' ? 3.5 : 2.5;
    s += rect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, glass);
    var gx = x + inset, gy = y + inset, gw = w - 2 * inset, gh = h - 2 * inset;
    var line = function (x1, y1, x2, y2, sw) { s += ln(x1, y1, x2, y2, bar, sw || 1.2); };
    var grid = drawnGrid(o, a);
    if (o.type === 'sash') {
      line(gx, gy + gh / 2, gx + gw, gy + gh / 2, 2.2);
      var margin = style === 'victorian' && a.victorian.sash === 'margin_lights' && grid.rows === 3 && grid.rowsBottom === 3 && grid.cols === 3;
      for (var half = 0; half < 2; half++) {
        var hy = gy + half * gh / 2;
        if (margin) {
          // Margin lights: one big pane, a narrow border of small ones.
          var m = Math.min(gw, gh / 2) * 0.16;
          line(gx + m, hy, gx + m, hy + gh / 2, 0.9); line(gx + gw - m, hy, gx + gw - m, hy + gh / 2, 0.9);
          line(gx, hy + m, gx + gw, hy + m, 0.9); line(gx, hy + gh / 2 - m, gx + gw, hy + gh / 2 - m, 0.9);
          continue;
        }
        for (var c = 1; c < grid.cols; c++) line(gx + c * gw / grid.cols, hy, gx + c * gw / grid.cols, hy + gh / 2);
        var hr = half ? grid.rowsBottom : grid.rows;
        for (var rr = 1; rr < hr; rr++) line(gx, hy + rr * gh / 2 / hr, gx + gw, hy + rr * gh / 2 / hr);
      }
      // Victorian sash horns: the upper sash's stiles run on past the
      // meeting rail, on 1-over-1 and 2-over-2.
      if (style === 'victorian' && !margin && grid.rows === 1 && grid.rowsBottom === 1 && grid.cols <= 2 && !opts.narrow) {
        var my = gy + gh / 2 + 1.1;
        s += poly([[gx, my], [gx + 2.4, my], [gx + 0.9, my + 3.6]], frame, ' stroke="#777" stroke-width="0.3"');
        s += poly([[gx + gw, my], [gx + gw - 2.4, my], [gx + gw - 0.9, my + 3.6]], frame, ' stroke="#777" stroke-width="0.3"');
      }
    } else if (o.type === 'casement' && !o.panes_set && !o.placeholder) {
      // Stage 1's casement, until its panes are set.
      line(gx + gw / 2, gy, gx + gw / 2, gy + gh, style === 'modern' ? 3 : 1.6);
      if (style !== 'modern') line(gx, gy + gh * 0.3, gx + gw, gy + gh * 0.3, 1.4);
    } else if (o.type !== 'fixed' || o.panes_set) {
      for (var cc = 1; cc < grid.cols; cc++) line(gx + cc * gw / grid.cols, gy, gx + cc * gw / grid.cols, gy + gh, style === 'modern' ? 3 : 1.6);
      for (var r2 = 1; r2 < grid.rows; r2++) line(gx, gy + r2 * gh / grid.rows, gx + gw, gy + r2 * gh / grid.rows, 1.4);
    }
    if (opts.narrow) s += rect(gx, gy, gw, gh, 'rgba(20,30,40,.18)');
    // cill
    if (!opts.noCill) s += rect(x - 3, y + h, w + 6, 3, p.trim, ' stroke="#999" stroke-width="0.5"');
    return s;
  }

  // The door leaf itself: panels or glazing, decorative.
  function doorLeaf(x, y, w, h, o, style, p) {
    var s = rect(x, y, w, h, p.door, ' stroke="#333" stroke-width="0.8"');
    var inset = 5, pw = (w - 3 * inset) / 2;
    if (o.type === 'fully_glazed' || o.type === 'french_double') {
      s += rect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, '#8fa6b5');
      if (o.type === 'french_double') s += ln(x + w / 2, y, x + w / 2, y + h, p.door, 3);
    } else if (o.type === 'half_glazed' || style === 'victorian') {
      s += rect(x + inset, y + inset, pw, h * 0.4, '#8fa6b5');
      s += rect(x + 2 * inset + pw, y + inset, pw, h * 0.4, '#8fa6b5');
      s += rect(x + inset, y + h * 0.55, pw, h * 0.35, 'none', ' stroke="rgba(255,255,255,.35)"');
      s += rect(x + 2 * inset + pw, y + h * 0.55, pw, h * 0.35, 'none', ' stroke="rgba(255,255,255,.35)"');
    } else if (o.type !== 'flush') {
      for (var pr = 0; pr < 3; pr++) {
        var ph = (h - 4 * inset) / 3;
        s += rect(x + inset, y + inset + pr * (ph + inset), pw, ph, 'none', ' stroke="rgba(255,255,255,.3)"');
        s += rect(x + 2 * inset + pw, y + inset + pr * (ph + inset), pw, ph, 'none', ' stroke="rgba(255,255,255,.3)"');
      }
    } else if (style === 'modern') {
      s += rect(x + w * 0.62, y + 8, w * 0.14, h - 16, '#9fb4c2');
    }
    if (o.type === 'stable') s += ln(x, y + h / 2, x + w, y + h / 2, '#111', 1.4);
    s += '<circle cx="' + r1(x + w - 7) + '" cy="' + r1(y + h * 0.55) + '" r="1.6" fill="#c9a44a"/>';
    return s;
  }
  // A semicircular fanlight with radiating bars, over x..x+w at y.
  function radialFanlight(x, y, w) {
    var s = '<path d="M' + r1(x) + ',' + r1(y) + ' A' + r1(w / 2) + ',' + r1(w / 2) + ' 0 0 1 ' + r1(x + w) + ',' + r1(y) + ' Z" fill="#8fa6b5" stroke="#fff" stroke-width="1.2"/>';
    for (var f = 1; f < 5; f++) {
      var ang = Math.PI * f / 5;
      s += ln(x + w / 2, y, x + w / 2 - Math.cos(ang) * w / 2, y - Math.sin(ang) * w / 2, '#fff', 0.8);
    }
    return s;
  }
  // How far above the leaf the door's surround reaches, for its number.
  function doorLift(a, floor, level) {
    if (level === 'lower_ground' || floor > 0) return 4;
    if (a.period === 'georgian') return a.georgian.doorcase === 'plain_fanlight' ? 22 : 40;
    if (a.period === 'victorian') return a.victorian.entrance === 'open_with_canopy' ? 20 : a.victorian.entrance === 'gabled_timber_porch' ? 40 : 30;
    return 12;
  }

  function drawDoorGlyph(x, y, w, h, o, a, floor, level) {
    var style = a.period;
    var p = PAL[style] || PAL.georgian;
    var s = '';
    if (level === 'lower_ground') {
      // Under the steps: the leaf and a plain frame, no doorcase.
      return rect(x - 3, y - 3, w + 6, h + 3, p.trim, ' stroke="#9d9582" stroke-width="0.6"') + doorLeaf(x, y, w, h, o, style, p);
    }
    if (floor > 0) {
      // Upper-floor door: glazed doors onto a balcony (or a Juliet on modern).
      s += rect(x, y, w, h, style === 'modern' ? p.frame : '#fbfbf8', ' stroke="#555" stroke-width="0.8"');
      s += rect(x + 3, y + 3, w - 6, h - 6, '#9fb4c2');
      s += ln(x + w / 2, y, x + w / 2, y + h, style === 'modern' ? p.frame : '#fff', 2.4);
      if (style === 'modern') {
        s += rect(x - 4, y + h * 0.45, w + 8, h * 0.55, 'rgba(170,210,230,.45)', ' stroke="#6c8795" stroke-width="0.8"');
        s += ln(x - 4, y + h * 0.45, x + w + 4, y + h * 0.45, '#4a5b64', 1.6);
      } else {
        // small railing across the bottom
        s += ln(x - 4, y + h * 0.55, x + w + 4, y + h * 0.55, '#222', 1.4);
        for (var rx = x - 3; rx <= x + w + 3; rx += 4) s += ln(rx, y + h * 0.55, rx, y + h, '#222', 0.7);
      }
      return s;
    }
    var edge = ' stroke="#b8ad95" stroke-width="0.6"';
    if (style === 'georgian') {
      var dc = a.georgian.doorcase;
      if (dc === 'plain_fanlight') {
        // A simple architrave round the door and a flat fanlight over it.
        s += rect(x - 6, y - 19, w + 12, h + 19, p.trim, edge);
        s += rect(x, y - 15, w, 13, '#8fa6b5', ' stroke="#fff" stroke-width="1"');
        for (var fb = 1; fb < 4; fb++) s += ln(x + fb * w / 4, y - 15, x + fb * w / 4, y - 2, '#fff', 0.8);
      } else if (dc === 'portico') {
        // Columns carrying an entablature, the fanlight between them.
        [x - 15, x + w + 7].forEach(function (cx) {
          s += rect(cx, y - 24, 8, h + 24, p.trim, edge);
          s += rect(cx - 2, y - 27, 12, 4, p.trim, edge);
          s += rect(cx - 2, y + h - 4, 12, 4, p.trim, edge);
        });
        s += rect(x - 20, y - 35, w + 40, 9, p.trim, edge);
        s += rect(x - 23, y - 38, w + 46, 3, p.trim, edge);
        s += radialFanlight(x, y, w);
      } else {
        // pilasters, pediment, fanlight
        s += rect(x - 9, y - 20, 7, h + 20, p.trim, edge);
        s += rect(x + w + 2, y - 20, 7, h + 20, p.trim, edge);
        s += poly([[x - 12, y - 20], [x + w / 2, y - 36], [x + w + 12, y - 20]], p.trim, ' stroke="#b8ad95" stroke-width="0.8"');
        s += radialFanlight(x, y, w);
      }
    } else if (style === 'victorian') {
      var en = a.victorian.entrance;
      if (en === 'open_with_canopy') {
        // A flat canopy on two brackets, a small top light.
        s += rect(x - 13, y - 17, w + 26, 5, p.roof);
        s += rect(x - 13, y - 12, w + 26, 2, p.trim);
        s += poly([[x - 11, y - 10], [x - 5, y - 10], [x - 11, y + 2]], p.trim, ' stroke="#b9ae93" stroke-width="0.5"');
        s += poly([[x + w + 11, y - 10], [x + w + 5, y - 10], [x + w + 11, y + 2]], p.trim, ' stroke="#b9ae93" stroke-width="0.5"');
        s += rect(x, y - 8, w, 7, '#8fa6b5', ' stroke="#fff" stroke-width="0.8"');
      } else if (en === 'gabled_timber_porch') {
        // Timber posts under a small gabled roof.
        s += rect(x - 13, y - 20, 4, h + 20, '#e9e2d0', ' stroke="#9d9582" stroke-width="0.5"');
        s += rect(x + w + 9, y - 20, 4, h + 20, '#e9e2d0', ' stroke="#9d9582" stroke-width="0.5"');
        s += poly([[x - 18, y - 19], [x + w / 2, y - 38], [x + w + 18, y - 19]], p.roof);
        s += '<polyline points="' + r1(x - 18) + ',' + r1(y - 18) + ' ' + r1(x + w / 2) + ',' + r1(y - 37) + ' ' + r1(x + w + 18) + ',' + r1(y - 18) + '" fill="none" stroke="' + p.trim + '" stroke-width="2"/>';
        s += rect(x, y - 8, w, 7, '#8fa6b5', ' stroke="#fff" stroke-width="0.8"');
      } else {
        s += '<path d="M' + r1(x - 6) + ',' + r1(y + 6) + ' L' + r1(x - 6) + ',' + r1(y - 6) + ' A' + r1(w / 2 + 6) + ',' + r1(w / 2 + 2) + ' 0 0 1 ' + r1(x + w + 6) + ',' + r1(y - 6) + ' L' + r1(x + w + 6) + ',' + r1(y + 6) + '" fill="' + p.trim + '" stroke="#b9ae93" stroke-width="0.8"/>';
        s += '<path d="M' + r1(x) + ',' + r1(y) + ' A' + r1(w / 2) + ',' + r1(w / 2 - 6) + ' 0 0 1 ' + r1(x + w) + ',' + r1(y) + ' Z" fill="#8fa6b5" stroke="#fff" stroke-width="1"/>';
      }
    } else {
      // modern canopy
      s += rect(x - 10, y - 8, w + 20, 5, '#4a4f53');
    }
    return s + doorLeaf(x, y, w, h, o, style, p);
  }

  // A bay on the elevation: its windows per storey (the side lights drawn
  // narrow, as seen at an angle), mullions, cornice and cill, and one roof
  // over the whole thing -- a small hipped roof on a canted bay, a flat lead
  // one on a square bay. regions: each storey's [y0, y1], bottom first.
  function drawBayGlyph(x, item, regions, a) {
    var style = a.period;
    var p = PAL[style] || PAL.georgian;
    var fp = finishPal(a);
    var box = item._box, bw = box.w, face = box.face, canted = item.bay_shape !== 'square';
    var top = regions[regions.length - 1][0], bottom = regions[0][1];
    var s = rect(x, top, bw, bottom - top, fp.wall, ' stroke="#9d9582" stroke-width="0.6"');
    if (fp.line && BRICK_FINISHES[a.finish]) for (var by = top + 5; by < bottom; by += 5) s += ln(x, by, x + bw, by, fp.line, 0.4);
    s += rect(x, top, face, bottom - top, 'rgba(0,0,0,.10)');
    s += rect(x + bw - face, top, face, bottom - top, 'rgba(0,0,0,.10)');
    regions.forEach(function (r, si) {
      var row = item._faces[si];
      var fl = item.floor + si;
      var fs = drawnSize(row.front, style, fl), ls = drawnSize(row.left, style, fl), rs = drawnSize(row.right, style, fl);
      var mid = (r[0] + r[1]) / 2 - (si === 0 && fl === 0 ? 3 : 0);
      var fx = x + face + (bw - 2 * face - fs.w) / 2;
      s += drawWindowGlyph(fx, mid - fs.h / 2, fs.w, fs.h, row.front, a, { noHead: true, noCill: true });
      var sw = canted ? Math.max(6, face - 7) : Math.max(3, face - 5);
      s += drawWindowGlyph(x + (face - sw) / 2, mid - ls.h / 2, sw, ls.h, row.left, a, { noHead: true, noCill: true, narrow: true });
      s += drawWindowGlyph(x + bw - face + (face - sw) / 2, mid - rs.h / 2, sw, rs.h, row.right, a, { noHead: true, noCill: true, narrow: true });
      var tallest = Math.max(fs.h, ls.h, rs.h);
      s += rect(x - 2, mid + tallest / 2, bw + 4, 3, p.trim, ' stroke="#999" stroke-width="0.5"');
      if (si > 0) s += rect(x - 2, r[1] - 2, bw + 4, 4, p.trim, ' stroke="#b9ae93" stroke-width="0.5"');
    });
    // mullions where the faces meet
    s += rect(x + face - 1.2, top, 2.4, bottom - top, p.trim, ' stroke="#b9ae93" stroke-width="0.4"');
    s += rect(x + bw - face - 1.2, top, 2.4, bottom - top, p.trim, ' stroke="#b9ae93" stroke-width="0.4"');
    // cornice and roof
    s += rect(x - 3, top - 5, bw + 6, 6, p.trim, ' stroke="#b8ad95" stroke-width="0.6"');
    if (canted) s += poly([[x - 4, top - 5], [x + bw + 4, top - 5], [x + bw - face, top - 17], [x + face, top - 17]], '#5f6770');
    else s += rect(x - 4, top - 9, bw + 8, 4, '#7b848c');
    if (item.floor === 0) s += rect(x - 2, bottom - 6, bw + 4, 6, '#cfc6b3');
    return s;
  }

  // A dormer on a pitched roof (or poking up behind a parapet): its cheeks,
  // the face round the window, and a small pitched top.
  function drawDormerGlyph(x, y, w, h, o, a) {
    var p = PAL[a.period] || PAL.georgian;
    var bx = x - 5, bw = w + 10, top = y - 7, bottom = y + h + 4;
    var s = rect(bx - 3, top, 3, bottom - top, '#838b94');
    s += rect(bx + bw, top, 3, bottom - top, '#838b94');
    s += rect(bx, top, bw, bottom - top, p.trim, ' stroke="#b8ad95" stroke-width="0.6"');
    s += poly([[bx - 6, top], [x + w / 2, top - 11], [bx + bw + 6, top]], p.roof);
    return s + drawWindowGlyph(x, y, w, h, o, a, { noHead: true });
  }

  // Lays a row of widths across x0..x0+W with equal gaps -- stage 1's rule --
  // around any spans already taken (the upper storey of a bay from the floor
  // below). Returns each item's left x.
  function placeRow(widths, x0, W, taken) {
    var n = widths.length, out = [];
    if (!n) return out;
    var sum = function (list) { return list.reduce(function (t, w) { return t + w; }, 0); };
    if (!taken || !taken.length) {
      var gap = (W - sum(widths)) / (n + 1), cx = x0 + gap;
      widths.forEach(function (w) { out.push(cx); cx += w + gap; });
      return out;
    }
    var segs = [], at = x0;
    taken.slice().sort(function (p, q) { return p.x - q.x; }).forEach(function (t) {
      if (t.x - 6 > at) segs.push([at, t.x - 6]);
      at = Math.max(at, t.x + t.w + 6);
    });
    if (x0 + W > at) segs.push([at, x0 + W]);
    if (!segs.length) segs.push([x0, x0 + W]);
    var free = sum(segs.map(function (g) { return g[1] - g[0]; }));
    var done = 0, share = 0;
    segs.forEach(function (g) {
      share += n * (g[1] - g[0]) / free;
      var upto = Math.min(n, Math.round(share));
      var mine = widths.slice(done, upto);
      var gg = (g[1] - g[0] - sum(mine)) / (mine.length + 1), cx = g[0] + gg;
      mine.forEach(function (w) { out.push(cx); cx += w + gg; });
      done = upto;
    });
    while (out.length < n) out.push(x0);
    return out;
  }

  // Positions every opening on one side, level by level. Uses the saved rows
  // where they exist and the layout counts otherwise (an unconfirmed side is
  // drawn as a preview of what confirming will create).
  function sideGeometry(data, side) {
    var property = (data && data.property) || {};
    var a = appearanceOf(property);
    var style = a.period;
    var layout = sideLayout(property, side);
    var end = side === 'left' || side === 'right';
    var rows = ((data && data.openings) || []).filter(function (o) { return o.side === side; });
    var find = function (level, fi, kind, pos) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (levelOf(r) === level && (level !== 'standard' || +r.floor === fi) && r.kind === kind && +r.position === pos && !isBayChild(r)) return r;
      }
      return null;
    };
    var make = function (level, fi, kind, pos) {
      return find(level, fi, kind, pos) || Object.assign({ id: null, side: side, level: level, floor: fi, kind: kind, position: pos, placeholder: true },
        kind === 'bay' ? bayDefaults(a, fi, fi + 1 < layout.floors.length) : openingDefaults(a, kind, fi, level));
    };
    var fillBay = function (bay, fi) {
      var storeys = Math.min(bayStoreys(bay), fi + 1 < layout.floors.length ? 2 : 1);
      var kids = bay.id ? rows.filter(function (r) { return r.parent_opening_id === bay.id; }) : [];
      var faces = [];
      for (var st = 0; st < storeys; st++) {
        var row = {};
        BAY_FACES.forEach(function (face) {
          var pos = bayChildPosition(bay.position, st, face), real = null;
          kids.forEach(function (k) { if (+k.position === pos) real = k; });
          row[face] = real || Object.assign({ id: null, side: side, level: 'standard', floor: fi + st, kind: 'window', position: pos,
            parent_opening_id: bay.id, placeholder: true }, bayChildDefaults(a, fi + st, face));
        });
        faces.push(row);
      }
      var it = Object.assign({}, bay, { _storeys: storeys, _faces: faces, _kids: kids });
      var frontW = 0, sideW = 0, storeyH = [];
      faces.forEach(function (row, si) {
        var f = drawnSize(row.front, style, fi + si), l = drawnSize(row.left, style, fi + si), r = drawnSize(row.right, style, fi + si);
        frontW = Math.max(frontW, f.w); sideW = Math.max(sideW, l.w, r.w);
        storeyH.push(Math.max(f.h, l.h, r.h));
      });
      var face = it.bay_shape === 'square' ? 9 : Math.max(14, sideW * 0.55 + 6);
      it._box = { w: frontW + 16 + 2 * face, face: face, storeyH: storeyH };
      return it;
    };
    var floors = layout.floors.map(function (f, fi) {
      var slots = floorSlots(f.windows, f.doors, f.bays);
      var n = { window: 0, door: 0, bay: 0 };
      var items = slots.map(function (kind) {
        var o = make('standard', fi, kind, ++n[kind]);
        return kind === 'bay' ? fillBay(o, fi) : o;
      });
      return { items: items, through: [] };
    });
    // A two-storey bay also stands on the floor above.
    floors.forEach(function (f, fi) {
      f.items.forEach(function (it) { if (it.kind === 'bay' && it._storeys === 2 && floors[fi + 1]) floors[fi + 1].through.push(it); });
    });
    var levelItems = function (level, windows, doors) {
      var n = { window: 0, door: 0 };
      return floorSlots(windows, doors, 0).map(function (kind) { return make(level, 0, kind, ++n[kind]); });
    };
    var lower = layout.lower_ground ? levelItems('lower_ground', layout.lower_ground.windows, layout.lower_ground.doors) : null;
    var roof = layout.roof ? levelItems('roof', layout.roof.windows, 0) : null;
    var itemW = function (o, fi) { return o.kind === 'bay' ? o._box.w : drawnSize(o, style, fi).w; };
    var rowW = function (list, fi) { return list.reduce(function (t, o) { return t + itemW(o, fi) + 26; }, 0); };
    var widest = floors.reduce(function (m, f, fi) { return Math.max(m, rowW(f.items, fi) + rowW(f.through, fi - 1)); }, 0);
    if (lower) widest = Math.max(widest, rowW(lower, 0));
    if (roof) widest = Math.max(widest, rowW(roof, -1) + 80);
    var W = Math.max(end ? 200 : 260, widest + 60);
    var floorH = floors.map(function (f, fi) {
      var tallest = f.items.reduce(function (m, o) {
        return Math.max(m, o.kind === 'bay' ? o._box.storeyH[0] + 22 : drawnSize(o, style, fi).h);
      }, 50);
      f.through.forEach(function (b) { tallest = Math.max(tallest, b._box.storeyH[1] + 22); });
      return Math.max(78, tallest + (fi === 0 ? 40 : 34));
    });
    var lowerH = lower ? Math.max(70, lower.reduce(function (m, o) { return Math.max(m, drawnSize(o, style, 0).h); }, 40) + 26) : 0;
    var roofKind = roofKindFor(a, side);
    var roofTall = roof ? roof.reduce(function (m, o) { return Math.max(m, drawnSize(o, style, -1).h); }, 0) : 0;
    var roofH = roofKind === 'gable' ? Math.min(120, W * 0.42) : roofKind === 'parapet' ? 30 : (style === 'victorian' ? 62 : style === 'georgian' ? 56 : 48);
    if (roof && roof.length) roofH = Math.max(roofH, roofTall + (roofKind === 'gable' ? 50 : 32));
    return { a: a, style: style, floors: floors, lower: lower, roof: roof, floorH: floorH, lowerH: lowerH, W: W,
             roofKind: roofKind, roofH: roofH, end: end, confirmed: layout.confirmed };
  }

  // The elevation of one side. opts:
  //   interactive   wrap each real opening in a data-open-id group (the app)
  //   highlight     { id: true } -- draw these strongly, fade the rest (report)
  //   markers       show the quote/variation work badges (default true)
  //   maxWidth      CSS max width in px
  function elevationSvg(data, side, opts) {
    opts = opts || {};
    var g = sideGeometry(data, side);
    var a = g.a, style = g.style;
    var p = PAL[style] || PAL.georgian;
    var fp = finishPal(a);
    var flags = opts.markers === false ? {} : workFlags(data);
    var edges = attachedEdges(a, side);
    var nbL = edges.left ? 46 : 0, nbR = edges.right ? 46 : 0;
    var W = g.W, pad = 20;
    var bodyH = g.floorH.reduce(function (t, h) { return t + h; }, 0);
    var rk = g.roofKind, roofH = g.roofH;
    var parapet = rk === 'parapet' ? 22 : 0;
    var chimH = style === 'modern' ? 0 : 30;
    var topY = pad + chimH + roofH + parapet;
    var groundY = topY + bodyH;
    var lowerH = g.lowerH;
    var frontRailings = style === 'georgian' && a.georgian.railings && side === 'front' && !g.lower;
    var H = groundY + lowerH + (frontRailings ? 34 : 22);
    var x0 = 30 + nbL, x1 = x0 + W, vbW = W + 60 + nbL + nbR;
    var s = '';
    // ground
    s += rect(0, groundY, vbW, H - groundY, '#cfd6cc');
    // A wall band in the finish. ground: the ground floor (a Georgian
    // stucco house rusticates it; a Modern one sits on a grey brick plinth).
    var wallBand = function (xa, xb, y, h, ground) {
      var out = '';
      if (style === 'modern' && a.finish === 'render' && ground) {
        out += rect(xa, y, xb - xa, h, p.low);
        for (var by = y + 5; by < y + h; by += 5) out += ln(xa, by, xb, by, p.lowLine, 0.4);
        return out;
      }
      out += rect(xa, y, xb - xa, h, fp.wall);
      if (a.finish === 'stucco') {
        if (style === 'georgian' && ground) {
          for (var ry = y + 9; ry < y + h; ry += 9) out += ln(xa, ry, xb, ry, fp.line, 1);
        } else {
          // fine ashlar lines: courses, and joints staggered course by course
          for (var ay = y + 11, row = 0; ay < y + h; ay += 11, row++) {
            out += ln(xa, ay, xb, ay, fp.fine, 0.35);
            for (var jx = xa + (row % 2 ? 14 : 28); jx < xb; jx += 28) out += ln(jx, ay - 11, jx, ay, fp.fine, 0.35);
          }
        }
      } else if (fp.line) {
        for (var ly = y + 5; ly < y + h; ly += 5) out += ln(xa, ly, xb, ly, fp.line, 0.4);
        if (style === 'victorian' && a.victorian.brick_detailing === 'polychrome_bands') {
          out += rect(xa, y + h * 0.16, xb - xa, 3, fp.band);
          out += rect(xa, y + h - 8, xb - xa, 3, fp.band);
        }
      }
      return out;
    };
    // The neighbours, faintly, at each edge that has one -- so a terrace
    // reads as a terrace. Drawn first so the house sits over them.
    var neighbour = function (xa, xb) {
      var out = '<g opacity="0.36">';
      var y = topY;
      for (var fi = g.floors.length - 1; fi >= 0; fi--) {
        out += wallBand(xa, xb, y, g.floorH[fi], fi === 0);
        var ph = Object.assign({ placeholder: true, kind: 'window' }, openingDefaults(a, 'window', fi, 'standard'));
        var sz = drawnSize(ph, style, fi);
        out += drawWindowGlyph((xa + xb) / 2 - sz.w / 2, y + (g.floorH[fi] - sz.h) / 2 + (fi === 0 ? -4 : 0), sz.w, sz.h, ph, a);
        y += g.floorH[fi];
      }
      if (g.lower) out += wallBand(xa, xb, groundY, lowerH, false) + rect(xa, groundY, xb - xa, lowerH, 'rgba(30,30,30,.16)');
      if (rk === 'parapet') {
        out += rect(xa, topY - parapet, xb - xa, parapet, fp.wall, ' stroke="' + fp.stroke + '" stroke-width="0.8"');
        out += rect(xa, topY - 6, xb - xa, 6, p.trim);
      } else if (rk === 'eaves') {
        out += rect(xa, topY - roofH, xb - xa, roofH, p.roof);
      } else {
        out += rect(xa, topY - 12, xb - xa, 12, p.roof);
      }
      return out + '</g>' + ln(xa === 0 ? xb : xa, topY - (rk === 'eaves' ? roofH : parapet), xa === 0 ? xb : xa, groundY + lowerH, '#8d8573', 0.8);
    };
    if (nbL) s += neighbour(0, x0);
    if (nbR) s += neighbour(x1, vbW);
    // walls, floor by floor from the top down (floor 0 is the bottom band)
    var y = topY;
    var bandTop = [];
    for (var fi = g.floors.length - 1; fi >= 0; fi--) {
      bandTop[fi] = y;
      var fh = g.floorH[fi];
      s += wallBand(x0, x1, y, fh, fi === 0);
      if (style === 'georgian' && a.georgian.band_courses && fi === 1) {
        // band course between ground and first
        s += rect(x0, y + fh - 4, W, 4, p.trim);
      }
      y += fh;
    }
    // The lower ground floor, below the pavement, in its light well.
    if (g.lower) {
      s += wallBand(x0, x1, groundY, lowerH, false);
      s += rect(x0, groundY, W, lowerH, 'rgba(30,30,30,.13)');
      s += rect(x0 - 8, groundY + lowerH - 3, W + 16, 3, '#a9aa9f');
    }
    // roof
    var chim = chimneyFill(a, fp);
    var roofSvg = '';
    if (rk === 'gable') {
      roofSvg += poly([[x0 - 8, topY], [x0 + W / 2, topY - roofH], [x1 + 8, topY]], fp.wall, ' stroke="' + fp.stroke + '"');
      roofSvg += '<polyline points="' + (x0 - 10) + ',' + r1(topY + 2) + ' ' + r1(x0 + W / 2) + ',' + r1(topY - roofH - 2) + ' ' + (x1 + 10) + ',' + r1(topY + 2) + '" fill="none" stroke="' + p.roof + '" stroke-width="5"/>';
      if (style === 'victorian' && a.victorian.bargeboards && !g.end) {
        // Bargeboards: a trim board under the verge, with drops, and a finial.
        var bb = function (xa, ya, xb, yb) {
          var out = ln(xa, ya, xb, yb, '#6d6552', 4.4) + ln(xa, ya, xb, yb, p.trim, 2.8);
          var n = Math.max(4, Math.round(Math.abs(xb - xa) / 9));
          for (var k = 1; k < n; k++) {
            var t = k / n, bx = xa + (xb - xa) * t, byy = ya + (yb - ya) * t;
            out += poly([[bx - 2.2, byy + 1], [bx + 2.2, byy + 1], [bx, byy + 6]], p.trim, ' stroke="#6d6552" stroke-width="0.5"');
          }
          return out;
        };
        roofSvg += bb(x0 - 6, topY + 5, x0 + W / 2, topY - roofH + 4) + bb(x0 + W / 2, topY - roofH + 4, x1 + 6, topY + 5);
        roofSvg += rect(x0 + W / 2 - 1.5, topY - roofH - 12, 3, 12, p.trim);
      }
      if (chimH) roofSvg += rect(x0 + W / 2 - 12, topY - roofH - chimH + 4, 24, chimH, chim, ' stroke="#8a7d68" stroke-width="0.8"');
    } else if (rk === 'parapet') {
      roofSvg += rect(x0 - 4, topY - parapet, W + 8, parapet, fp.wall, ' stroke="' + fp.stroke + '" stroke-width="0.8"');
      roofSvg += rect(x0 - 7, topY - 6, W + 14, 6, p.trim, ' stroke="#b8ad95" stroke-width="0.8"');
      roofSvg += poly([[nbL ? x0 - 4 : x0 + 10, topY - parapet], [nbL ? x0 - 4 : x0 + 30, topY - parapet - roofH], [nbR ? x1 + 4 : x1 - 30, topY - parapet - roofH], [nbR ? x1 + 4 : x1 - 10, topY - parapet]], p.roof);
      [x0 + 6, x1 - 36].forEach(function (cx) {
        roofSvg += rect(cx, topY - parapet - roofH - chimH + 6, 30, chimH + roofH - 6, chim, ' stroke="' + fp.stroke + '" stroke-width="0.8"');
        for (var pot = 0; pot < 3; pot++) roofSvg += rect(cx + 4 + pot * 8, topY - parapet - roofH - chimH, 5, 7, '#b86a45');
      });
    } else {
      var eL = nbL ? x0 : x0 - 10, rL = nbL ? x0 : x0 + 30, eR = nbR ? x1 : x1 + 10, rR = nbR ? x1 : x1 - 30;
      roofSvg += poly([[eL, topY], [rL, topY - roofH], [rR, topY - roofH], [eR, topY]], p.roof);
      if (style === 'modern') {
        for (var ty = topY - roofH + 6; ty < topY; ty += 6) {
          var k = (topY - ty) / roofH; // follow the roof's slope
          roofSvg += ln(eL + (rL - eL) * k, ty, eR + (rR - eR) * k, ty, '#68645f', 0.6);
        }
      }
      if (chimH) {
        [x0 + 40, x1 - 64].forEach(function (cx) {
          roofSvg += rect(cx, topY - roofH - chimH + 12, 24, chimH + 12, chim, ' stroke="#8a5a3a" stroke-width="0.8"');
        });
      }
    }
    s += roofSvg;

    // openings
    var hl = opts.highlight || null;
    var openingsSvg = '';
    // One drawn thing (an opening, or a bay with all its windows): fade or
    // pick it out, number it, badge it, and make it tappable. ids: every row
    // it stands for (a bay and its windows).
    var place = function (o, ids, glyph, box, labelY) {
      var real = ids.filter(Boolean);
      var lit = hl && real.some(function (id) { return hl[id]; });
      var inner = '<g' + (hl && !lit ? ' opacity="0.35"' : '') + '>' + glyph + '</g>';
      if (lit) inner += rect(box.x - 4, box.y - 4, box.w + 8, box.h + 8, 'none', ' stroke="' + PAL.accent + '" stroke-width="2.2" rx="3"');
      if (opts.selected && real.indexOf(opts.selected) >= 0) inner += rect(box.x - 4, box.y - 4, box.w + 8, box.h + 8, 'none', ' stroke="' + PAL.accent + '" stroke-width="2.5" rx="3"');
      inner += '<text x="' + r1(box.x + box.w / 2) + '" y="' + r1(labelY) + '" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-size="9" font-weight="700" fill="' + PAL.ink + '" paint-order="stroke" stroke="rgba(255,255,255,.85)" stroke-width="2.5">' + openingCode(o) + '</text>';
      var fl = { quote: 0, variation: 0 };
      real.forEach(function (id) { var f = flags[id]; if (f) { fl.quote += f.quote; fl.variation += f.variation; } });
      if (fl.quote || fl.variation) {
        var bx = box.x + box.w - 2, byy = box.y + 2;
        if (fl.quote) inner += '<circle cx="' + r1(bx) + '" cy="' + r1(byy) + '" r="5" fill="' + PAL.accent + '" stroke="#fff" stroke-width="1.2"/>';
        if (fl.variation) inner += '<circle cx="' + r1(bx - (fl.quote ? 11 : 0)) + '" cy="' + r1(byy) + '" r="5" fill="#fff" stroke="' + PAL.accent + '" stroke-width="1.6" stroke-dasharray="2 1.6"/>';
      }
      if (opts.interactive && o.id) {
        inner = '<g class="wd-open" data-open-id="' + esc(o.id) + '" style="cursor:pointer">' + inner
          + rect(box.x - 6, box.y - 12, box.w + 12, box.h + 18, 'transparent') + '</g>';
      } else if (o.placeholder) {
        inner = '<g opacity="0.55">' + inner + '</g>';
      }
      openingsSvg += inner;
    };
    var groundDoors = [];
    g.floors.forEach(function (f, fi) {
      var fh = g.floorH[fi], top = bandTop[fi];
      var widths = f.items.map(function (o) { return o.kind === 'bay' ? o._box.w : drawnSize(o, style, fi).w; });
      var xs = placeRow(widths, x0, W, f.through.map(function (b) { return { x: b._x, w: b._box.w }; }));
      f.items.forEach(function (o, i) {
        var cx = xs[i];
        if (o.kind === 'bay') {
          o._x = cx;
          var regions = [];
          for (var si = 0; si < o._storeys; si++) {
            var bt = bandTop[fi + si], bh = g.floorH[fi + si];
            regions.push([si === o._storeys - 1 ? bt + 14 : bt, fi + si === fi ? bt + bh - (fi > 0 ? 6 : 0) : bt + bh]);
          }
          var btop = regions[regions.length - 1][0] - 17, bbot = regions[0][1];
          var ids = [o.id].concat(o._kids.map(function (k) { return k.id; }));
          place(o, ids, drawBayGlyph(cx, o, regions, a), { x: cx, y: btop, w: o._box.w, h: bbot - btop }, btop - 4);
          return;
        }
        var sz = drawnSize(o, style, fi);
        var oy = o.kind === 'door' && fi === 0 ? top + fh - sz.h : top + (fh - sz.h) / 2 + (fi === 0 ? -4 : 0);
        var glyph = o.kind === 'door' ? drawDoorGlyph(cx, oy, sz.w, sz.h, o, a, fi, 'standard') : drawWindowGlyph(cx, oy, sz.w, sz.h, o, a);
        if (o.kind === 'door' && fi === 0) groundDoors.push([cx, sz.w]);
        place(o, [o.id], glyph, { x: cx, y: oy, w: sz.w, h: sz.h }, oy - (o.kind === 'door' ? doorLift(a, fi, 'standard') : 4));
      });
    });
    if (g.lower) {
      var lxs = placeRow(g.lower.map(function (o) { return drawnSize(o, style, 0).w; }), x0, W);
      g.lower.forEach(function (o, i) {
        var sz = drawnSize(o, style, 0), cx = lxs[i];
        var oy = o.kind === 'door' ? groundY + lowerH - 3 - sz.h : groundY + (lowerH - sz.h) / 2;
        var glyph = o.kind === 'door' ? drawDoorGlyph(cx, oy, sz.w, sz.h, o, a, 0, 'lower_ground') : drawWindowGlyph(cx, oy, sz.w, sz.h, o, a);
        place(o, [o.id], glyph, { x: cx, y: oy, w: sz.w, h: sz.h }, oy - 5);
      });
    }
    if (g.roof && g.roof.length) {
      var rws = g.roof.map(function (o) { return drawnSize(o, style, -1).w; });
      var rhs = g.roof.map(function (o) { return drawnSize(o, style, -1).h; });
      var rTall = Math.max.apply(null, rhs);
      var rxs, base;
      if (rk === 'gable') {
        // In the gable itself: attic windows, centred.
        base = topY - 14;
        var mid = base - rTall / 2, hw = (W / 2 + 8) * (mid - (topY - roofH)) / roofH;
        rxs = placeRow(rws, x0 + W / 2 - hw + 6, 2 * hw - 12);
      } else {
        base = rk === 'parapet' ? topY - parapet - 3 : topY - 9;
        rxs = placeRow(rws, x0 + 34, W - 68);
      }
      g.roof.forEach(function (o, i) {
        var w = rws[i], h = rhs[i], cx = rxs[i], oy = base - h;
        var glyph = rk === 'gable' ? drawWindowGlyph(cx, oy, w, h, o, a) : drawDormerGlyph(cx, oy, w, h, o, a);
        place(o, [o.id], glyph, { x: cx, y: oy, w: w, h: h }, oy - (rk === 'gable' ? 5 : 21));
      });
    }
    s += openingsSvg;
    // Railings: along the top of the light well, stepping round a bridge to
    // each ground-floor door; or a Georgian house's front railings.
    if (g.lower) {
      var top = groundY - 19;
      var gapAt = function (x) { return groundDoors.some(function (d) { return x > d[0] - 5 && x < d[0] + d[1] + 5; }); };
      var segs = [], cur = null;
      for (var rx = x0 - 4; rx <= x1 + 4; rx += 2) {
        if (gapAt(rx)) { if (cur) { segs.push(cur); cur = null; } continue; }
        if (!cur) cur = [rx, rx]; else cur[1] = rx;
      }
      if (cur) segs.push(cur);
      segs.forEach(function (sg) {
        s += ln(sg[0], top, sg[1], top, '#1d1d1f', 1.4) + ln(sg[0], groundY - 1, sg[1], groundY - 1, '#1d1d1f', 1);
        for (var bx = sg[0]; bx <= sg[1]; bx += 5) s += ln(bx, top - 3, bx, groundY, '#1d1d1f', 0.8);
      });
      groundDoors.forEach(function (d) { s += rect(d[0] - 5, groundY - 1, d[1] + 10, 6, '#d8d2c4', ' stroke="#a9a293" stroke-width="0.5"'); });
    } else if (frontRailings) {
      var ry0 = groundY + 4;
      s += ln(x0 - 6, ry0, x1 + 6, ry0, '#1d1d1f', 1.6);
      s += ln(x0 - 6, ry0 + 24, x1 + 6, ry0 + 24, '#1d1d1f', 1.2);
      for (var rx2 = x0 - 4; rx2 <= x1 + 4; rx2 += 6) s += ln(rx2, ry0 - 4, rx2, ry0 + 26, '#1d1d1f', 0.9);
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + r1(vbW) + ' ' + r1(H) + '" width="100%" style="display:block;max-width:' + (opts.maxWidth || 520) + 'px;margin:0 auto" role="img" aria-label="' + esc(sideLabel(side) + ' elevation') + '">' + s + '</svg>';
  }

  // ── Detail diagram: every pane and frame part, tappable ──────────────────
  // How an element looks, from its marks. Glass replacement and other work
  // read differently; quote-stage marks are solid, variation marks dashed.
  function elementStyle(elementId, oMarks, selected) {
    var mine = oMarks.filter(function (m) { return m.element_id === elementId; });
    var glass = mine.some(function (m) { var a = actionDef(m.action_key); return a && a.glass; });
    var quote = mine.some(function (m) { return m.stage !== 'variation'; });
    var variation = mine.some(function (m) { return m.stage === 'variation'; });
    var colour = glass ? PAL.glassWork : PAL.work;
    var st = { fill: null, stroke: null, dash: null, sw: null };
    if (quote) st.fill = colour;
    else if (variation) st.fill = glass ? 'rgba(95,179,230,.28)' : 'rgba(240,160,32,.25)';
    if (variation) { st.stroke = colour === PAL.glassWork ? '#1f7fbf' : '#c07a00'; st.dash = '4 3'; st.sw = 2.4; }
    if (selected) { st.stroke = PAL.accent; st.dash = null; st.sw = 3; }
    return st;
  }

  // opts: { selected: {elementId: true}, interactive: true }. A bay draws
  // its bay view instead (opts.children: its window rows).
  function detailSvg(o, marks, opts) {
    opts = opts || {};
    if (o.kind === 'bay') return bayDetailSvg(o, opts.children || [], marks, opts);
    var sel = opts.selected || {};
    var oMarks = (marks || []).filter(function (m) { return m.opening_id === o.id; });
    var s = '';
    var ext = { l: 0, t: 0, r: 0, b: 0 };
    var draw = function (id, c) {
      var st = elementStyle(id, oMarks, !!sel[id]);
      var paint = c.s.replace('%FILL%', st.fill || c.baseFill).replace('%STROKE%', st.stroke || '#555')
        .replace('%DASH%', st.dash ? ' stroke-dasharray="' + st.dash + '"' : '').replace('%SW%', st.sw || 1);
      var tick = '';
      if (sel[id]) {
        tick = '<circle cx="' + r1(c.cx) + '" cy="' + r1(c.cy) + '" r="8" fill="' + PAL.accent + '" stroke="#fff" stroke-width="1.5"/>'
          + '<path d="M' + r1(c.cx - 4) + ',' + r1(c.cy) + ' l3,3 l5,-6" stroke="#fff" stroke-width="2" fill="none"/>';
      }
      return '<g' + (opts.interactive ? ' class="wd-el" data-el="' + esc(id) + '" style="cursor:pointer"' : '') + '>' + paint + tick + '</g>';
    };
    var R = function (x, y, w, h, base) { return { s: '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="%FILL%" stroke="%STROKE%" stroke-width="%SW%"%DASH%/>', baseFill: base, cx: x + w / 2, cy: y + h / 2 }; };
    var P = function (pts, base, cx, cy) { return { s: '<polygon points="' + pts.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join(' ') + '" fill="%FILL%" stroke="%STROKE%" stroke-width="%SW%"%DASH%/>', baseFill: base, cx: cx, cy: cy }; };
    var timber = '#f7f5ef', glassFill = '#cfe3ee', panelFill = '#ece7da';
    var W, H;
    if (o.kind === 'door') {
      var rows = clampGrid(o.rows), cols = clampGrid(o.cols);
      var double = o.type === 'french_double';
      W = double ? 300 : 190; H = 330;
      var fr = 14, st = 20, tr = 22, br = 34, th = 10;
      s += draw('frame', R(0, 0, W, H - th, timber));
      s += draw('threshold', R(-8, H - th, W + 16, th, '#d9d4c7'));
      var lx = fr, ly = fr, lw = W - 2 * fr, lh = H - th - fr;
      s += draw('stile_left', R(lx, ly, st, lh, timber));
      s += draw('stile_right', R(lx + lw - st, ly, st, lh, timber));
      s += draw('top_rail', R(lx + st, ly, lw - 2 * st, tr, timber));
      s += draw('bottom_rail', R(lx + st, ly + lh - br, lw - 2 * st, br, timber));
      var ix = lx + st, iy = ly + tr, iw = lw - 2 * st, ih = lh - tr - br;
      var grid = function (prefix, gx, gy, gw, gh, r, c, fill, startAt) {
        var out = '', n = startAt || 0, gap = 8;
        var cw = (gw - (c - 1) * gap) / c, rh = (gh - (r - 1) * gap) / r;
        for (var ri = 0; ri < r; ri++) for (var ci = 0; ci < c; ci++) {
          n++;
          out += draw(prefix + '-' + n, R(gx + ci * (cw + gap), gy + ri * (rh + gap), cw, rh, fill));
        }
        return { svg: out, n: n };
      };
      if (o.type === 'flush') {
        s += draw('panel-1', R(ix, iy, iw, ih, panelFill));
      } else if (o.type === 'panelled') {
        s += grid('panel', ix + 6, iy + 6, iw - 12, ih - 12, rows, cols, panelFill).svg;
      } else if (o.type === 'stable') {
        var topRows = Math.max(1, Math.ceil(rows / 2)), botRows = Math.max(1, rows - topRows);
        var half = (ih - 14) / 2;
        var top = grid('panel', ix + 6, iy + 6, iw - 12, half - 6, topRows, cols, panelFill);
        s += top.svg;
        s += '<line x1="' + r1(ix - st) + '" y1="' + r1(iy + half + 4) + '" x2="' + r1(ix + iw + st) + '" y2="' + r1(iy + half + 4) + '" stroke="#333" stroke-width="3"/>';
        s += grid('panel', ix + 6, iy + half + 14, iw - 12, half - 6, rows - topRows > 0 ? botRows : 1, cols, panelFill, top.n).svg;
      } else if (o.type === 'half_glazed') {
        var gh = ih * 0.5;
        s += grid('glass', ix + 6, iy + 6, iw - 12, gh - 6, rows, cols, glassFill).svg;
        s += grid('panel', ix + 6, iy + gh + 10, iw - 12, ih - gh - 16, 1, 2, panelFill).svg;
      } else if (o.type === 'fully_glazed') {
        s += grid('glass', ix + 6, iy + 6, iw - 12, ih - 12, rows, cols, glassFill).svg;
      } else if (double) {
        var leafW = (iw - 10) / 2;
        var left = grid('glass', ix + 4, iy + 6, leafW - 4, ih - 12, rows, cols, glassFill);
        s += left.svg;
        s += '<rect x="' + r1(ix + leafW) + '" y="' + r1(iy) + '" width="10" height="' + r1(ih) + '" fill="#e2ddd0" stroke="#888" stroke-width="0.8"/>';
        s += grid('glass', ix + leafW + 14, iy + 6, leafW - 4, ih - 12, rows, cols, glassFill, left.n).svg;
      }
      s += '<circle cx="' + r1(lx + lw - st / 2) + '" cy="' + r1(ly + lh * 0.55) + '" r="4" fill="#c9a44a" pointer-events="none"/>';
    } else {
      var rowsW = clampGrid(o.rows), colsW = clampGrid(o.cols);
      var sash = o.type === 'sash';
      var sr = sashRows(o);
      W = 60 + colsW * 70; H = sash ? 70 + Math.max(sr.top, sr.bottom) * 2 * 62 + 24 : 60 + rowsW * 70;
      W = Math.max(W, 200); H = Math.max(H, 180);
      var hd = 20, stw = 18, brw = 18, cill = 16, mr = 16;
      if (levelOf(o) === 'roof') {
        // The dormer's surround, drawn first so the window sits in it: a
        // cheek either side, and the fascia over the head under its roof.
        s += draw('dormer_cheek_left', P([[-46, -30], [-6, -30], [-6, H - cill], [-12, H - cill]], '#d7dbe0', -24, H / 3));
        s += draw('dormer_cheek_right', P([[W + 6, -30], [W + 46, -30], [W + 12, H - cill], [W + 6, H - cill]], '#d7dbe0', W + 24, H / 3));
        s += draw('dormer_fascia', R(-52, -58, W + 104, 26, timber));
        s += '<polygon points="' + r1(-62) + ',-58 ' + r1(W / 2) + ',-108 ' + r1(W + 62) + ',-58" fill="#7c848d" pointer-events="none"/>';
        ext = { l: 64, t: 110, r: 64, b: 0 };
      }
      s += draw('head', R(0, 0, W, hd, timber));
      s += draw('left_stile', R(0, hd, stw, H - hd - cill, timber));
      s += draw('right_stile', R(W - stw, hd, stw, H - hd - cill, timber));
      s += draw('cill', R(-10, H - cill, W + 20, cill, '#e6e1d4'));
      var ax = stw, aw = W - 2 * stw;
      if (sash) {
        var areaH = H - hd - cill - brw - mr;
        var halfH = areaH / 2;
        s += draw('meeting_rail', R(ax, hd + halfH, aw, mr, timber));
        s += draw('bottom_rail', R(ax, H - cill - brw, aw, brw, timber));
        var paneGrid = function (prefix, gy, gh, nr) {
          var out = '', n = 0, gap = 6;
          var cw = (aw - 12 - (colsW - 1) * gap) / colsW, rh = (gh - 12 - (nr - 1) * gap) / nr;
          for (var ri = 0; ri < nr; ri++) for (var ci = 0; ci < colsW; ci++) {
            n++;
            out += draw(prefix + '-' + n, R(ax + 6 + ci * (cw + gap), gy + 6 + ri * (rh + gap), cw, rh, glassFill));
          }
          return out;
        };
        s += '<rect x="' + r1(ax) + '" y="' + r1(hd) + '" width="' + r1(aw) + '" height="' + r1(halfH) + '" fill="#e9e6de" pointer-events="none"/>';
        s += '<rect x="' + r1(ax) + '" y="' + r1(hd + halfH + mr) + '" width="' + r1(aw) + '" height="' + r1(halfH) + '" fill="#e9e6de" pointer-events="none"/>';
        s += paneGrid('top', hd, halfH, sr.top);
        s += paneGrid('bottom', hd + halfH + mr, halfH, sr.bottom);
      } else {
        var areaH2 = H - hd - cill - brw;
        s += draw('bottom_rail', R(ax, H - cill - brw, aw, brw, timber));
        s += '<rect x="' + r1(ax) + '" y="' + r1(hd) + '" width="' + r1(aw) + '" height="' + r1(areaH2) + '" fill="#e9e6de" pointer-events="none"/>';
        var n2 = 0, gap2 = 6;
        var cw2 = (aw - 12 - (colsW - 1) * gap2) / colsW, rh2 = (areaH2 - 12 - (rowsW - 1) * gap2) / rowsW;
        for (var r2 = 0; r2 < rowsW; r2++) for (var c2 = 0; c2 < colsW; c2++) {
          n2++;
          s += draw('pane-' + n2, R(ax + 6 + c2 * (cw2 + gap2), hd + 6 + r2 * (rh2 + gap2), cw2, rh2, glassFill));
        }
      }
    }
    var padX = 14, padY = 8;
    var vx = -padX - ext.l, vy = -padY - ext.t;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + r1(vx) + ' ' + r1(vy) + ' ' + r1(W + 2 * padX + ext.l + ext.r) + ' ' + r1(H + 2 * padY + ext.t + ext.b) + '" width="100%" style="display:block;max-width:' + (opts.maxWidth || 320) + 'px;max-height:' + (opts.maxHeight || 420) + 'px;margin:0 auto;touch-action:manipulation" role="img" aria-label="' + esc(openingLabel(o)) + '">' + s + '</svg>';
  }

  // ── The bay view ─────────────────────────────────────────────────────────
  // A plan-style strip: the bay's left, front and right windows storey by
  // storey (top storey at the top), between its own parts -- cornice and
  // fascia over, a mullion where each pair of faces meets, the cill under --
  // with a small plan of the bay's shape beneath. The parts take marks like
  // any frame part; each window is a way into its own detail view
  // (data-open-id), badged when it has work on it.
  function bayDetailSvg(bay, children, marks, opts) {
    opts = opts || {};
    var sel = opts.selected || {};
    var oMarks = (marks || []).filter(function (m) { return m.opening_id === bay.id; });
    var storeys = bayStoreys(bay);
    var canted = bay.bay_shape !== 'square';
    var timber = '#f7f5ef';
    var W = 330, sideW = canted ? 70 : 58, mull = 14, rowH = 128, top = 44;
    var frontW = W - 2 * (sideW + mull) - 8;
    var H = top + storeys * rowH;
    var s = '';
    var draw = function (id, x, y, w, h, base) {
      var st = elementStyle(id, oMarks, !!sel[id]);
      var tick = sel[id] ? '<circle cx="' + r1(x + w / 2) + '" cy="' + r1(y + h / 2) + '" r="8" fill="' + PAL.accent + '" stroke="#fff" stroke-width="1.5"/>'
        + '<path d="M' + r1(x + w / 2 - 4) + ',' + r1(y + h / 2) + ' l3,3 l5,-6" stroke="#fff" stroke-width="2" fill="none"/>' : '';
      return '<g' + (opts.interactive ? ' class="wd-el" data-el="' + esc(id) + '" style="cursor:pointer"' : '') + '>'
        + rect(x, y, w, h, st.fill || base, ' stroke="' + (st.stroke || '#555') + '" stroke-width="' + (st.sw || 1) + '"' + (st.dash ? ' stroke-dasharray="' + st.dash + '"' : '')) + tick + '</g>';
    };
    var flags = workFlags({ property: opts.property || {}, openings: children, marks: marks || [] });
    s += draw('bay_cornice', -6, 0, W + 12, 18, timber);
    s += draw('bay_fascia', 4, 20, W - 8, 16, timber);
    var cols = [[4, sideW, 'left'], [4 + sideW + mull, frontW, 'front'], [4 + sideW + mull + frontW + mull, sideW, 'right']];
    for (var si = storeys - 1; si >= 0; si--) {
      var y = top + (storeys - 1 - si) * rowH;
      cols.forEach(function (c) {
        var pos = bayChildPosition(bay.position, si, c[2]), kid = null;
        children.forEach(function (k) { if (+k.position === pos) kid = k; });
        var x = c[0], w = c[1], h = rowH - 34, wy = y + 8;
        var win = '<rect x="' + r1(x) + '" y="' + r1(wy) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + timber + '" stroke="#555" stroke-width="1"/>';
        var ksr = kid ? sashRows(kid) : { top: 1, bottom: 1 }, rows = ksr.top, ncol = kid ? clampGrid(kid.cols) : 1;
        var sash = !kid || kid.type === 'sash';
        var gx = x + 6, gw = w - 12, gy = wy + 6, gh = h - 12;
        win += rect(gx, gy, gw, gh, '#cfe3ee');
        var bars = function (y0, hh, nr) {
          var out = '', rows = nr || ksr.top;
          for (var cc = 1; cc < ncol; cc++) out += ln(gx + cc * gw / ncol, y0, gx + cc * gw / ncol, y0 + hh, timber, 3);
          for (var rr = 1; rr < rows; rr++) out += ln(gx, y0 + rr * hh / rows, gx + gw, y0 + rr * hh / rows, timber, 3);
          return out;
        };
        if (sash) { win += ln(gx, gy + gh / 2, gx + gw, gy + gh / 2, timber, 6) + bars(gy, gh / 2) + bars(gy + gh / 2, gh / 2, ksr.bottom); } else win += bars(gy, gh);
        if (canted && c[2] !== 'front') win += rect(gx, gy, gw, gh, 'rgba(20,30,40,.12)');
        var f = kid && flags[kid.id];
        if (f && (f.quote || f.variation)) {
          if (f.quote) win += '<circle cx="' + r1(x + w - 8) + '" cy="' + r1(wy + 8) + '" r="7" fill="' + PAL.accent + '" stroke="#fff" stroke-width="1.5"/>';
          if (f.variation) win += '<circle cx="' + r1(x + w - (f.quote ? 24 : 8)) + '" cy="' + r1(wy + 8) + '" r="7" fill="#fff" stroke="' + PAL.accent + '" stroke-width="2" stroke-dasharray="3 2"/>';
        }
        if (opts.selectedChild && kid && kid.id === opts.selectedChild) win += rect(x - 4, wy - 4, w + 8, h + 8, 'none', ' stroke="' + PAL.accent + '" stroke-width="3" rx="4"');
        win += '<text x="' + r1(x + w / 2) + '" y="' + r1(wy + h + 17) + '" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-size="13" font-weight="700" fill="' + PAL.ink + '">' + c[2] + (storeys > 1 && c[2] === 'front' ? (si ? ' · upper' : ' · lower') : '') + '</text>';
        s += opts.interactive && kid && kid.id ? '<g class="wd-bay-win" data-open-id="' + esc(kid.id) + '" style="cursor:pointer">' + win + rect(x - 2, wy - 2, w + 4, h + 24, 'transparent') + '</g>' : win;
      });
    }
    s += draw('bay_mullion_left', 4 + sideW, top, mull, H - top, timber);
    s += draw('bay_mullion_right', 4 + sideW + mull + frontW, top, mull, H - top, timber);
    s += draw('bay_cill', -6, H, W + 12, 16, '#e6e1d4');
    // The plan, for recognition only.
    var py = H + 36, pd = 30;
    var plan = canted
      ? [[20, py], [20 + sideW * 0.8, py + pd], [W - 20 - sideW * 0.8, py + pd], [W - 20, py]]
      : [[40, py], [40, py + pd], [W - 40, py + pd], [W - 40, py]];
    s += '<polyline points="' + plan.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join(' ') + '" fill="#eef1f4" stroke="#8a929b" stroke-width="3"/>';
    s += ln(0, py, W, py, '#8a929b', 1.5);
    s += '<text x="' + r1(W / 2) + '" y="' + r1(py + pd + 18) + '" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-size="12" fill="#5a6270">' + (canted ? 'canted' : 'square') + ' bay, in plan</text>';
    var vbH = py + pd + 26;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -8 ' + r1(W + 28) + ' ' + r1(vbH + 16) + '" width="100%" style="display:block;max-width:' + (opts.maxWidth || 320) + 'px;max-height:' + (opts.maxHeight || 460) + 'px;margin:0 auto;touch-action:manipulation" role="img" aria-label="' + esc(openingLabel(bay)) + '">' + s + '</svg>';
  }

  // ── Report ───────────────────────────────────────────────────────────────
  // What was done where, with diagrams, and no prices anywhere -- the thing
  // attached to the invoice and shown on the client's page. Built from the
  // rows alone, so the server can render it with no calc engine.
  //
  // variations: [{ id, status, approvedAt }] -- only APPROVED variation work
  // is reported; a draft, a pending ask or a declined one is not something
  // that was done.
  function reportModel(data, variations) {
    var property = (data && data.property) || {};
    var approved = {};
    (variations || []).forEach(function (v) { if (v && v.status === 'approved') approved[v.id] = v; });
    var marks = ((data && data.marks) || []).filter(function (m) {
      return m.stage !== 'variation' || approved[m.variation_id];
    });
    var sections = [];
    var openingsWithWork = {};
    var live = liveOpenings(data && data.openings);
    sortOpenings(live).forEach(function (o) {
      var mine = marks.filter(function (m) { return m.opening_id === o.id; });
      var quoteMarks = mine.filter(function (m) { return m.stage !== 'variation'; });
      var quoted = [], varied = [];
      var dflt = property.default_prep || 'light';
      if (prepRank(quotePrep(o, property)) > prepRank(dflt)) quoted.push('Prep: ' + prepLabel(quotePrep(o, property)).toLowerCase());
      var qc = marksClause(o, quoteMarks);
      if (qc) quoted.push(qc.charAt(0).toUpperCase() + qc.slice(1));
      var byVar = {};
      mine.filter(function (m) { return m.stage === 'variation'; }).forEach(function (m) {
        (byVar[m.variation_id] = byVar[m.variation_id] || []).push(m);
      });
      if (o.prep_stage === 'variation' && approved[o.prep_variation_id]
          && prepRank(effectivePrep(o, property)) > prepRank(quotePrep(o, property))) {
        byVar[o.prep_variation_id] = byVar[o.prep_variation_id] || [];
      }
      Object.keys(byVar).forEach(function (vid) {
        var v = approved[vid];
        if (!v) return;
        var parts = [];
        if (o.prep_stage === 'variation' && o.prep_variation_id === vid
            && prepRank(effectivePrep(o, property)) > prepRank(quotePrep(o, property))) {
          parts.push('prep raised to ' + prepLabel(effectivePrep(o, property)).toLowerCase());
        }
        var vc = marksClause(o, byVar[vid]);
        if (vc) parts.push(vc);
        if (parts.length) {
          var t = parts.join(', ');
          varied.push({ text: t.charAt(0).toUpperCase() + t.slice(1), approvedAt: v.approvedAt || null });
        }
      });
      if (!quoted.length && !varied.length) return;
      openingsWithWork[o.id] = true;
      sections.push({ opening: o, label: openingLabel(o), type: typeLabel(o), what: kindNoun(o), quoted: quoted, variations: varied,
                      children: o.kind === 'bay' ? bayChildren(o, live) : null });
    });
    var sides = SIDES.map(function (s) { return s.key; }).filter(function (side) {
      return sections.some(function (sec) { return sec.opening.side === side; });
    });
    return { sides: sides, sections: sections, highlight: openingsWithWork, marks: marks };
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  // The report as an HTML fragment (self-styled, class-prefixed wdr-). The
  // caller wraps it in a page: the client's variation page, or the printable
  // report the app turns into a PDF.
  function reportHtml(data, variations, opts) {
    opts = opts || {};
    var model = reportModel(data, variations);
    if (!model.sections.length) return '';
    var reportData = { property: data.property, openings: data.openings, marks: model.marks };
    var out = '<div class="wdr">';
    out += '<style>.wdr{font-family:Barlow,"DM Sans",Arial,sans-serif;color:#1a1f2e}.wdr h2{font-size:18px;margin:0 0 4px}'
      + '.wdr h3{font-size:15px;margin:18px 0 8px;color:#1e6497;text-transform:uppercase;letter-spacing:.04em}'
      + '.wdr .wdr-note{font-size:13px;color:#5a6270;margin:0 0 10px}'
      + '.wdr .wdr-side{margin:10px 0 18px;page-break-inside:avoid;break-inside:avoid}'
      + '.wdr .wdr-open{display:flex;gap:14px;align-items:flex-start;border-top:1px solid #dde2e8;padding:12px 0;page-break-inside:avoid;break-inside:avoid}'
      + '.wdr .wdr-open .wdr-fig{flex:0 0 150px}.wdr .wdr-open .wdr-txt{flex:1;min-width:0}'
      + '.wdr .wdr-open h4{margin:0 0 4px;font-size:15px}.wdr .wdr-sub{font-size:12px;color:#5a6270;margin-bottom:6px}'
      + '.wdr .wdr-k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6270;margin:6px 0 2px}'
      + '.wdr ul{margin:0;padding-left:18px;font-size:14px;line-height:1.45}'
      + '.wdr .wdr-key{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#5a6270;margin:6px 0 4px}'
      + '.wdr .wdr-key span{display:inline-flex;align-items:center;gap:5px}'
      + '.wdr .wdr-sw{display:inline-block;width:14px;height:10px;border:1px solid #555}'
      + '@media(max-width:520px){.wdr .wdr-open{flex-direction:column}.wdr .wdr-open .wdr-fig{flex:none;width:170px}}</style>';
    if (opts.title !== false) out += '<h2>' + esc(opts.title || 'Windows and doors: work report') + '</h2>';
    out += '<p class="wdr-note">Outside faces only. Openings are numbered left to right as you face each side of the house.</p>';
    out += '<div class="wdr-key"><span><i class="wdr-sw" style="background:' + PAL.work + '"></i>work</span>'
      + '<span><i class="wdr-sw" style="background:' + PAL.glassWork + '"></i>glass replaced</span>'
      + '<span><i class="wdr-sw" style="background:rgba(240,160,32,.25);border:2px dashed #c07a00"></i>agreed as a variation</span></div>';
    model.sides.forEach(function (side) {
      out += '<div class="wdr-side"><h3>' + esc(sideLabel(side)) + '</h3>';
      out += elevationSvg(reportData, side, { highlight: model.highlight, markers: false, maxWidth: 460 });
      model.sections.filter(function (sec) { return sec.opening.side === side; }).forEach(function (sec) {
        out += '<div class="wdr-open"><div class="wdr-fig">' + detailSvg(sec.opening, model.marks, { maxWidth: 150, maxHeight: 220, children: sec.children, property: data.property }) + '</div>';
        out += '<div class="wdr-txt"><h4>' + esc(sec.label) + '</h4><div class="wdr-sub">' + esc(sec.what) + '</div>';
        if (sec.quoted.length) {
          out += '<div class="wdr-k">Quoted work</div><ul>' + sec.quoted.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
        }
        if (sec.variations.length) {
          out += '<div class="wdr-k">Approved variations</div><ul>' + sec.variations.map(function (v) {
            return '<li>' + esc(v.text) + (v.approvedAt ? ' <span style="color:#5a6270">(approved ' + esc(fmtDate(v.approvedAt)) + ')</span>' : '') + '</li>';
          }).join('') + '</ul>';
        }
        out += '</div></div>';
      });
      out += '</div>';
    });
    out += '</div>';
    return out;
  }

  return {
    SIDES: SIDES, STYLES: STYLES, PERIODS: PERIODS, WINDOW_TYPES: WINDOW_TYPES, DOOR_TYPES: DOOR_TYPES,
    WINDOW_TIERS: WINDOW_TIERS, DOOR_TIERS: DOOR_TIERS, PREP_LEVELS: PREP_LEVELS, ACTIONS: ACTIONS,
    LEVELS: LEVELS, BAY_SHAPES: BAY_SHAPES, BAY_FACES: BAY_FACES,
    FINISHES: FINISHES, FORMS: FORMS, EXPOSED_SIDES: EXPOSED_SIDES, ROOFS: ROOFS, PERIOD_OPTIONS: PERIOD_OPTIONS,
    DEFAULT_RATES: DEFAULT_RATES,
    periodDefaults: periodDefaults, normaliseAppearance: normaliseAppearance, appearanceOf: appearanceOf,
    appearanceIsDefault: appearanceIsDefault, visibleSides: visibleSides, attachedEdges: attachedEdges, roofKindFor: roofKindFor,
    mergeRates: mergeRates, actionDef: actionDef, prepRank: prepRank, prepLabel: prepLabel, maxPrep: maxPrep,
    floorLabel: floorLabel, sideLabel: sideLabel, typeLabel: typeLabel, kindNoun: kindNoun, levelOf: levelOf, levelLabel: levelLabel,
    sideLayout: sideLayout, openingDefaults: openingDefaults, bayDefaults: bayDefaults, bayChildDefaults: bayChildDefaults, floorSlots: floorSlots,
    isBayChild: isBayChild, bayChildPosition: bayChildPosition, bayChildInfo: bayChildInfo, bayStoreys: bayStoreys, bayChildren: bayChildren,
    liveOpenings: liveOpenings, periodSashGrid: periodSashGrid, sashRows: sashRows, sashPattern: sashPattern,
    openingElements: openingElements, elementKind: elementKind, actionsFor: actionsFor, paneCount: paneCount,
    openingCode: openingCode, openingLabel: openingLabel, sortOpenings: sortOpenings,
    effectivePrep: effectivePrep, quotePrep: quotePrep, baseMinutes: baseMinutes, paintedMinutes: paintedMinutes,
    priceJob: priceJob, openingPaintM2: openingPaintM2, paintAreas: paintAreas, marksClause: marksClause, describeVariation: describeVariation, itemLineText: itemLineText,
    workFlags: workFlags, elevationSvg: elevationSvg, detailSvg: detailSvg,
    reportModel: reportModel, reportHtml: reportHtml, fmtDate: fmtDate
  };
});
