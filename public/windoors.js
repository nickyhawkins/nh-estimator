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
  var STYLES = [
    { key: 'georgian', label: 'Georgian' },
    { key: 'victorian', label: 'Victorian' },
    { key: 'modern', label: 'Modern' }
  ];
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
      doorFrame: 0.4
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
    var out = { winBase: {}, perPane: 0, typeAdj: {}, doorBase: {}, prep: {}, actions: {} };
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
    var t = findKey(o.kind === 'door' ? DOOR_TYPES : WINDOW_TYPES, o.type);
    return t ? t.label : '';
  }

  // ── Layout: the per-side floor counts ────────────────────────────────────
  // property.layout = { front: { floors: [{windows, doors}, ...], confirmed },
  // ... }. Floor 0 is the ground floor. A side nobody has set up yet reads as
  // one ground floor with nothing on it.
  function sideLayout(property, side) {
    var l = property && property.layout && property.layout[side];
    var floors = (l && Array.isArray(l.floors) && l.floors.length ? l.floors : [{ windows: 0, doors: 0 }])
      .map(function (f) { return { windows: Math.max(0, Math.floor(+(f && f.windows) || 0)), doors: Math.max(0, Math.floor(+(f && f.doors) || 0)) }; });
    return { floors: floors, confirmed: !!(l && l.confirmed) };
  }

  // Defaults for a new opening, by the house style. The pane layout is what a
  // real house of that style usually has, so a confirmed layout is right
  // straight away more often than not.
  function openingDefaults(style, kind, floor) {
    if (kind === 'door') {
      if (floor > 0) return { type: 'french_double', size_tier: 'standard', rows: 3, cols: 1 };
      if (style === 'georgian') return { type: 'panelled', size_tier: 'standard', rows: 3, cols: 2 };
      if (style === 'victorian') return { type: 'half_glazed', size_tier: 'standard', rows: 1, cols: 2 };
      return { type: 'flush', size_tier: 'standard', rows: 1, cols: 1 };
    }
    if (style === 'modern') return { type: 'casement', size_tier: 'medium', rows: 1, cols: 2 };
    if (style === 'victorian') return { type: 'sash', size_tier: 'medium', rows: 1, cols: 2 };
    // Georgian: 6-over-6, and the first floor (the piano nobile) is where the
    // tall windows are.
    return { type: 'sash', size_tier: floor === 1 ? 'large' : 'medium', rows: 2, cols: 3 };
  }

  // Which slots on a floor are doors, left to right. Doors sit centred and
  // evenly spread among the windows, deterministically, so the drawing and
  // the numbering never disagree about where D1 is.
  function floorSlots(windows, doors) {
    var n = windows + doors, kinds = [];
    for (var i = 0; i < n; i++) kinds.push('window');
    for (var d = 0; d < doors; d++) {
      var at = Math.min(n - 1, Math.max(0, Math.round((d + 0.5) * n / doors - 0.5)));
      while (kinds[at] === 'door') at = (at + 1) % n;
      kinds[at] = 'door';
    }
    return kinds;
  }

  // ── Elements: what can be tapped on an opening ───────────────────────────
  // `kind` is 'pane' or 'part' -- the two things a selection can be, never
  // both at once. Door glass counts as panes; door panels count as parts.
  function clampGrid(v, max) { return Math.max(1, Math.min(max || 8, Math.floor(+v || 1))); }

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
    if (o.kind === 'door') return doorGlass(o);
    var n = clampGrid(o.rows) * clampGrid(o.cols);
    return o.type === 'sash' ? 2 * n : n;
  }

  var PART_LABELS = {
    head: 'head', left_stile: 'left stile', right_stile: 'right stile', bottom_rail: 'bottom rail',
    meeting_rail: 'meeting rail', cill: 'cill', stile_left: 'left stile', stile_right: 'right stile',
    top_rail: 'top rail', frame: 'frame', threshold: 'threshold'
  };

  function openingElements(o) {
    var out = [];
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
      for (var t = 1; t <= n; t++) out.push({ id: 'top-' + t, kind: 'pane', label: 'top pane ' + t });
      for (var b = 1; b <= n; b++) out.push({ id: 'bottom-' + b, kind: 'pane', label: 'bottom pane ' + b });
    } else {
      for (var k = 1; k <= n; k++) out.push({ id: 'pane-' + k, kind: 'pane', label: 'pane ' + k });
    }
    var parts = o.type === 'sash'
      ? ['head', 'left_stile', 'right_stile', 'meeting_rail', 'bottom_rail', 'cill']
      : ['head', 'left_stile', 'right_stile', 'bottom_rail', 'cill'];
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
  function openingCode(o) { return (o.kind === 'door' ? 'D' : 'W') + (+o.position || 1); }
  // "Front, first floor, W2" -- the spec's auto label, nickname after it.
  function openingLabel(o, withNickname) {
    var s = sideLabel(o.side) + ', ' + floorLabel(o.floor) + ', ' + openingCode(o);
    if (withNickname !== false && o.nickname) s += ' (' + o.nickname + ')';
    return s;
  }
  function sortOpenings(list) {
    var sideRank = { front: 0, back: 1, left: 2, right: 3 };
    return list.slice().sort(function (a, b) {
      return (sideRank[a.side] - sideRank[b.side]) || ((+a.floor || 0) - (+b.floor || 0))
        || (a.kind === b.kind ? 0 : a.kind === 'window' ? -1 : 1) || ((+a.position || 0) - (+b.position || 0));
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
    if (o.kind === 'door') {
      var d = rates.doorBase[o.type] || rates.doorBase.panelled;
      return d[o.size_tier] != null ? d[o.size_tier] : d.standard;
    }
    var b = rates.winBase[o.size_tier] != null ? rates.winBase[o.size_tier] : rates.winBase.medium;
    var adj = rates.typeAdj[o.type] != null ? rates.typeAdj[o.type] : 1;
    return b * adj;
  }
  // The painted opening before prep: base by tier and type, plus the panes
  // (glazing-bar cutting in).
  function paintedMinutes(o, rates) {
    return baseMinutes(o, rates) + paneCount(o) * rates.perPane;
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
    var openings = (data && data.openings) || [];
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
    ((data && data.openings) || []).forEach(function (o) {
      var m2 = openingPaintM2(o, rates);
      if (o.kind === 'door') { out.door += m2; out.doors++; } else { out.window += m2; out.windows++; }
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
    var openings = sortOpenings((data && data.openings) || []);
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
    var openings = (data && data.openings) || [];
    var marks = (data && data.marks) || [];
    var counts = {}, order = [];
    var bump = function (k) { if (!counts[k]) { counts[k] = 0; order.push(k); } counts[k]++; };
    sortOpenings(openings).forEach(function (o) {
      if (o.kind === 'door') {
        var where = +o.floor > 0 ? 'balcony' : (o.side === 'front' ? 'front' : o.side === 'back' ? 'back' : 'side');
        bump(where + ' door');
      } else {
        bump((typeLabel(o) || 'window').toLowerCase() + ' window');
      }
    });
    var head = 'Exterior windows and doors (outside faces)';
    if (!order.length) return head + '.';
    // Windows before doors, whatever order the house was walked in.
    order.sort(function (a, b) { return (/door$/.test(a) ? 1 : 0) - (/door$/.test(b) ? 1 : 0); });
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
  var PAL = {
    accent: '#1e6497', glassWork: '#5fb3e6', work: '#f0a020', ink: '#1a1f2e',
    georgian: { wall: '#efe8d8', wallLine: '#d8cdb4', roof: '#59616b', trim: '#fbf8f1', frame: '#fbfbf8', door: '#1d1d1f' },
    victorian: { wall: '#d9c088', wallLine: '#c3a86c', roof: '#4f5660', trim: '#ece6d6', frame: '#f6f3ea', door: '#2f5d3a' },
    modern: { wall: '#f4f4f1', wallLine: '#dcdcd6', low: '#8b8e91', lowLine: '#777a7d', roof: '#77736e', trim: '#e9e9e6', frame: '#383e42', door: '#6b7075' }
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function r1(n) { return Math.round(n * 10) / 10; }

  // Nominal drawn size of an opening, in elevation units. Scales with tier.
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

  // The windows of a floor, drawn decoratively in the style. The real pane
  // layout lives in each opening's detail view -- this is recognisability.
  function drawWindowGlyph(x, y, w, h, o, style) {
    var p = PAL[style] || PAL.georgian;
    var s = '';
    var frame = p.frame, bar = style === 'modern' ? p.frame : '#ffffff';
    var glass = style === 'modern' ? '#9fb4c2' : '#8fa6b5';
    if (style === 'victorian') {
      // stone head with a keystone
      s += '<rect x="' + r1(x - 4) + '" y="' + r1(y - 9) + '" width="' + r1(w + 8) + '" height="8" fill="' + p.trim + '" stroke="#b9ae93" stroke-width="0.6"/>';
      s += '<rect x="' + r1(x + w / 2 - 3.5) + '" y="' + r1(y - 11) + '" width="7" height="11" fill="' + p.trim + '" stroke="#b9ae93" stroke-width="0.6"/>';
    }
    s += '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + frame + '" stroke="#555" stroke-width="0.8"/>';
    var inset = style === 'modern' ? 3.5 : 2.5;
    s += '<rect x="' + r1(x + inset) + '" y="' + r1(y + inset) + '" width="' + r1(w - 2 * inset) + '" height="' + r1(h - 2 * inset) + '" fill="' + glass + '"/>';
    var gx = x + inset, gy = y + inset, gw = w - 2 * inset, gh = h - 2 * inset;
    var line = function (x1, y1, x2, y2, sw) {
      s += '<line x1="' + r1(x1) + '" y1="' + r1(y1) + '" x2="' + r1(x2) + '" y2="' + r1(y2) + '" stroke="' + bar + '" stroke-width="' + (sw || 1.2) + '"/>';
    };
    if (o.type === 'sash') {
      line(gx, gy + gh / 2, gx + gw, gy + gh / 2, 2.2);
      var decoCols = style === 'georgian' ? 3 : 2, decoRows = style === 'georgian' ? 2 : 1;
      for (var half = 0; half < 2; half++) {
        var hy = gy + half * gh / 2;
        for (var c = 1; c < decoCols; c++) line(gx + c * gw / decoCols, hy, gx + c * gw / decoCols, hy + gh / 2);
        for (var rr = 1; rr < decoRows; rr++) line(gx, hy + rr * gh / 2 / decoRows, gx + gw, hy + rr * gh / 2 / decoRows);
      }
    } else if (o.type === 'casement') {
      line(gx + gw / 2, gy, gx + gw / 2, gy + gh, style === 'modern' ? 3 : 1.6);
      if (style !== 'modern') line(gx, gy + gh * 0.3, gx + gw, gy + gh * 0.3, 1.4);
    }
    // cill
    s += '<rect x="' + r1(x - 3) + '" y="' + r1(y + h) + '" width="' + r1(w + 6) + '" height="3" fill="' + p.trim + '" stroke="#999" stroke-width="0.5"/>';
    return s;
  }

  function drawDoorGlyph(x, y, w, h, o, style, floor) {
    var p = PAL[style] || PAL.georgian;
    var s = '';
    if (floor > 0) {
      // Upper-floor door: glazed doors onto a balcony (or a Juliet on modern).
      s += '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + (style === 'modern' ? p.frame : '#fbfbf8') + '" stroke="#555" stroke-width="0.8"/>';
      s += '<rect x="' + r1(x + 3) + '" y="' + r1(y + 3) + '" width="' + r1(w - 6) + '" height="' + r1(h - 6) + '" fill="#9fb4c2"/>';
      s += '<line x1="' + r1(x + w / 2) + '" y1="' + r1(y) + '" x2="' + r1(x + w / 2) + '" y2="' + r1(y + h) + '" stroke="' + (style === 'modern' ? p.frame : '#fff') + '" stroke-width="2.4"/>';
      if (style === 'modern') {
        s += '<rect x="' + r1(x - 4) + '" y="' + r1(y + h * 0.45) + '" width="' + r1(w + 8) + '" height="' + r1(h * 0.55) + '" fill="rgba(170,210,230,.45)" stroke="#6c8795" stroke-width="0.8"/>';
        s += '<line x1="' + r1(x - 4) + '" y1="' + r1(y + h * 0.45) + '" x2="' + r1(x + w + 4) + '" y2="' + r1(y + h * 0.45) + '" stroke="#4a5b64" stroke-width="1.6"/>';
      } else {
        // small railing across the bottom
        s += '<line x1="' + r1(x - 4) + '" y1="' + r1(y + h * 0.55) + '" x2="' + r1(x + w + 4) + '" y2="' + r1(y + h * 0.55) + '" stroke="#222" stroke-width="1.4"/>';
        for (var rx = x - 3; rx <= x + w + 3; rx += 4) s += '<line x1="' + r1(rx) + '" y1="' + r1(y + h * 0.55) + '" x2="' + r1(rx) + '" y2="' + r1(y + h) + '" stroke="#222" stroke-width="0.7"/>';
      }
      return s;
    }
    if (style === 'georgian') {
      // pilasters, pediment, fanlight
      s += '<rect x="' + r1(x - 9) + '" y="' + r1(y - 20) + '" width="7" height="' + r1(h + 20) + '" fill="' + p.trim + '" stroke="#b8ad95" stroke-width="0.6"/>';
      s += '<rect x="' + r1(x + w + 2) + '" y="' + r1(y - 20) + '" width="7" height="' + r1(h + 20) + '" fill="' + p.trim + '" stroke="#b8ad95" stroke-width="0.6"/>';
      s += '<polygon points="' + r1(x - 12) + ',' + r1(y - 20) + ' ' + r1(x + w / 2) + ',' + r1(y - 36) + ' ' + r1(x + w + 12) + ',' + r1(y - 20) + '" fill="' + p.trim + '" stroke="#b8ad95" stroke-width="0.8"/>';
      s += '<path d="M' + r1(x) + ',' + r1(y) + ' A' + r1(w / 2) + ',' + r1(w / 2) + ' 0 0 1 ' + r1(x + w) + ',' + r1(y) + ' Z" fill="#8fa6b5" stroke="#fff" stroke-width="1.2"/>';
      for (var f = 1; f < 5; f++) {
        var ang = Math.PI * f / 5;
        s += '<line x1="' + r1(x + w / 2) + '" y1="' + r1(y) + '" x2="' + r1(x + w / 2 - Math.cos(ang) * w / 2) + '" y2="' + r1(y - Math.sin(ang) * w / 2) + '" stroke="#fff" stroke-width="0.8"/>';
      }
    } else if (style === 'victorian') {
      s += '<path d="M' + r1(x - 6) + ',' + r1(y + 6) + ' L' + r1(x - 6) + ',' + r1(y - 6) + ' A' + r1(w / 2 + 6) + ',' + r1(w / 2 + 2) + ' 0 0 1 ' + r1(x + w + 6) + ',' + r1(y - 6) + ' L' + r1(x + w + 6) + ',' + r1(y + 6) + '" fill="' + p.trim + '" stroke="#b9ae93" stroke-width="0.8"/>';
      s += '<path d="M' + r1(x) + ',' + r1(y) + ' A' + r1(w / 2) + ',' + r1(w / 2 - 6) + ' 0 0 1 ' + r1(x + w) + ',' + r1(y) + ' Z" fill="#8fa6b5" stroke="#fff" stroke-width="1"/>';
    } else {
      // modern canopy
      s += '<rect x="' + r1(x - 10) + '" y="' + r1(y - 8) + '" width="' + r1(w + 20) + '" height="5" fill="#4a4f53"/>';
    }
    s += '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + p.door + '" stroke="#333" stroke-width="0.8"/>';
    // panels or glazing on the leaf, decorative
    var inset = 5, pw = (w - 3 * inset) / 2;
    if (o.type === 'fully_glazed' || o.type === 'french_double') {
      s += '<rect x="' + r1(x + inset) + '" y="' + r1(y + inset) + '" width="' + r1(w - 2 * inset) + '" height="' + r1(h - 2 * inset) + '" fill="#8fa6b5"/>';
      if (o.type === 'french_double') s += '<line x1="' + r1(x + w / 2) + '" y1="' + r1(y) + '" x2="' + r1(x + w / 2) + '" y2="' + r1(y + h) + '" stroke="' + p.door + '" stroke-width="3"/>';
    } else if (o.type === 'half_glazed' || style === 'victorian') {
      s += '<rect x="' + r1(x + inset) + '" y="' + r1(y + inset) + '" width="' + r1(pw) + '" height="' + r1(h * 0.4) + '" fill="#8fa6b5"/>';
      s += '<rect x="' + r1(x + 2 * inset + pw) + '" y="' + r1(y + inset) + '" width="' + r1(pw) + '" height="' + r1(h * 0.4) + '" fill="#8fa6b5"/>';
      s += '<rect x="' + r1(x + inset) + '" y="' + r1(y + h * 0.55) + '" width="' + r1(pw) + '" height="' + r1(h * 0.35) + '" fill="none" stroke="rgba(255,255,255,.35)"/>';
      s += '<rect x="' + r1(x + 2 * inset + pw) + '" y="' + r1(y + h * 0.55) + '" width="' + r1(pw) + '" height="' + r1(h * 0.35) + '" fill="none" stroke="rgba(255,255,255,.35)"/>';
    } else if (o.type !== 'flush') {
      for (var pr = 0; pr < 3; pr++) {
        var ph = (h - 4 * inset) / 3;
        s += '<rect x="' + r1(x + inset) + '" y="' + r1(y + inset + pr * (ph + inset)) + '" width="' + r1(pw) + '" height="' + r1(ph) + '" fill="none" stroke="rgba(255,255,255,.3)"/>';
        s += '<rect x="' + r1(x + 2 * inset + pw) + '" y="' + r1(y + inset + pr * (ph + inset)) + '" width="' + r1(pw) + '" height="' + r1(ph) + '" fill="none" stroke="rgba(255,255,255,.3)"/>';
      }
    } else if (style === 'modern') {
      s += '<rect x="' + r1(x + w * 0.62) + '" y="' + r1(y + 8) + '" width="' + r1(w * 0.14) + '" height="' + r1(h - 16) + '" fill="#9fb4c2"/>';
    }
    if (o.type === 'stable') s += '<line x1="' + r1(x) + '" y1="' + r1(y + h / 2) + '" x2="' + r1(x + w) + '" y2="' + r1(y + h / 2) + '" stroke="#111" stroke-width="1.4"/>';
    // handle
    s += '<circle cx="' + r1(x + w - 7) + '" cy="' + r1(y + h * 0.55) + '" r="1.6" fill="#c9a44a"/>';
    return s;
  }

  // Positions every opening on one side, floor by floor. Uses the saved rows
  // where they exist and the layout counts otherwise (an unconfirmed side is
  // drawn as a preview of what confirming will create).
  function sideGeometry(data, side) {
    var property = (data && data.property) || {};
    var style = property.style || 'georgian';
    var layout = sideLayout(property, side);
    var gable = side === 'left' || side === 'right';
    var rows = ((data && data.openings) || []).filter(function (o) { return o.side === side; });
    var floors = layout.floors.map(function (f, fi) {
      var slots = floorSlots(f.windows, f.doors);
      var wi = 0, di = 0;
      var items = slots.map(function (kind) {
        var pos = kind === 'door' ? ++di : ++wi;
        var real = null;
        for (var i = 0; i < rows.length; i++) {
          if (+rows[i].floor === fi && rows[i].kind === kind && +rows[i].position === pos) { real = rows[i]; break; }
        }
        var o = real || Object.assign({ id: null, side: side, floor: fi, kind: kind, position: pos, placeholder: true }, openingDefaults(style, kind, fi));
        return o;
      });
      return { items: items };
    });
    var widest = floors.reduce(function (m, f) {
      var w = f.items.reduce(function (t, o) { return t + drawnSize(o, style, +o.floor).w + 26; }, 0);
      return Math.max(m, w);
    }, 0);
    var W = Math.max(gable ? 200 : 260, widest + 60);
    var floorH = floors.map(function (f, fi) {
      var tallest = f.items.reduce(function (m, o) { return Math.max(m, drawnSize(o, style, fi).h); }, 50);
      return Math.max(78, tallest + (fi === 0 ? 40 : 34));
    });
    return { style: style, floors: floors, floorH: floorH, W: W, gable: gable, confirmed: layout.confirmed };
  }

  // The elevation of one side. opts:
  //   interactive   wrap each real opening in a data-open-id group (the app)
  //   highlight     { id: true } -- draw these strongly, fade the rest (report)
  //   markers       show the quote/variation work badges (default true)
  //   maxWidth      CSS max width in px
  function elevationSvg(data, side, opts) {
    opts = opts || {};
    var g = sideGeometry(data, side);
    var p = PAL[g.style] || PAL.georgian;
    var flags = opts.markers === false ? {} : workFlags(data);
    var W = g.W, pad = 20;
    var bodyH = g.floorH.reduce(function (t, h) { return t + h; }, 0);
    var roofH = g.gable ? Math.min(120, W * 0.42) : (g.style === 'georgian' ? 30 : g.style === 'victorian' ? 62 : 48);
    var parapet = g.style === 'georgian' && !g.gable ? 22 : 0;
    var chimH = g.style === 'modern' ? 0 : 30;
    var groundY = pad + chimH + roofH + parapet + bodyH;
    var H = groundY + (g.style === 'georgian' && side === 'front' ? 34 : 22);
    var x0 = 30, x1 = x0 + W;
    var s = '';
    // ground
    s += '<rect x="0" y="' + r1(groundY) + '" width="' + r1(W + 60) + '" height="' + r1(H - groundY) + '" fill="#cfd6cc"/>';
    // walls, floor by floor from the top down (floor 0 is the bottom band)
    var y = pad + chimH + roofH + parapet;
    var bandTop = [];
    for (var fi = g.floors.length - 1; fi >= 0; fi--) {
      bandTop[fi] = y;
      var fh = g.floorH[fi];
      var wallFill = p.wall, lineCol = p.wallLine;
      if (g.style === 'modern' && fi === 0) { wallFill = p.low; lineCol = p.lowLine; }
      s += '<rect x="' + x0 + '" y="' + r1(y) + '" width="' + W + '" height="' + r1(fh) + '" fill="' + wallFill + '"/>';
      if (g.style === 'georgian' && fi === 0) {
        for (var ry = y + 9; ry < y + fh; ry += 9) s += '<line x1="' + x0 + '" y1="' + r1(ry) + '" x2="' + x1 + '" y2="' + r1(ry) + '" stroke="' + lineCol + '" stroke-width="1"/>';
      } else if (g.style === 'victorian' || (g.style === 'modern' && fi === 0)) {
        for (var by = y + 5, row = 0; by < y + fh; by += 5, row++) {
          s += '<line x1="' + x0 + '" y1="' + r1(by) + '" x2="' + x1 + '" y2="' + r1(by) + '" stroke="' + lineCol + '" stroke-width="0.4"/>';
        }
      }
      if (g.style === 'georgian' && fi === 1) {
        // band course between ground and first
        s += '<rect x="' + x0 + '" y="' + r1(y + fh - 4) + '" width="' + W + '" height="4" fill="' + p.trim + '"/>';
      }
      y += fh;
    }
    var topY = pad + chimH + roofH + parapet;
    // roof
    if (g.gable) {
      s += '<polygon points="' + (x0 - 8) + ',' + r1(topY) + ' ' + r1(x0 + W / 2) + ',' + r1(topY - roofH) + ' ' + (x1 + 8) + ',' + r1(topY) + '" fill="' + p.wall + '" stroke="' + p.wallLine + '"/>';
      s += '<polyline points="' + (x0 - 10) + ',' + r1(topY + 2) + ' ' + r1(x0 + W / 2) + ',' + r1(topY - roofH - 2) + ' ' + (x1 + 10) + ',' + r1(topY + 2) + '" fill="none" stroke="' + p.roof + '" stroke-width="5"/>';
      if (chimH) s += '<rect x="' + r1(x0 + W / 2 - 12) + '" y="' + r1(topY - roofH - chimH + 4) + '" width="24" height="' + r1(chimH) + '" fill="' + (g.style === 'georgian' ? p.wall : '#b57a4f') + '" stroke="#8a7d68" stroke-width="0.8"/>';
    } else if (g.style === 'georgian') {
      s += '<rect x="' + (x0 - 4) + '" y="' + r1(topY - parapet) + '" width="' + (W + 8) + '" height="' + parapet + '" fill="' + p.wall + '" stroke="' + p.wallLine + '" stroke-width="0.8"/>';
      s += '<rect x="' + (x0 - 7) + '" y="' + r1(topY - 6) + '" width="' + (W + 14) + '" height="6" fill="' + p.trim + '" stroke="#b8ad95" stroke-width="0.8"/>';
      s += '<polygon points="' + (x0 + 10) + ',' + r1(topY - parapet) + ' ' + (x0 + 30) + ',' + r1(topY - parapet - roofH) + ' ' + (x1 - 30) + ',' + r1(topY - parapet - roofH) + ' ' + (x1 - 10) + ',' + r1(topY - parapet) + '" fill="' + p.roof + '"/>';
      [x0 + 6, x1 - 36].forEach(function (cx) {
        s += '<rect x="' + r1(cx) + '" y="' + r1(topY - parapet - roofH - chimH + 6) + '" width="30" height="' + r1(chimH + roofH - 6) + '" fill="' + p.wall + '" stroke="' + p.wallLine + '" stroke-width="0.8"/>';
        for (var pot = 0; pot < 3; pot++) s += '<rect x="' + r1(cx + 4 + pot * 8) + '" y="' + r1(topY - parapet - roofH - chimH) + '" width="5" height="7" fill="#b86a45"/>';
      });
    } else {
      s += '<polygon points="' + (x0 - 10) + ',' + r1(topY) + ' ' + (x0 + 30) + ',' + r1(topY - roofH) + ' ' + (x1 - 30) + ',' + r1(topY - roofH) + ' ' + (x1 + 10) + ',' + r1(topY) + '" fill="' + p.roof + '"/>';
      if (g.style === 'modern') {
        for (var ty = topY - roofH + 6; ty < topY; ty += 6) {
          var inset = 40 * (topY - ty) / roofH - 10; // follow the roof's slope
          s += '<line x1="' + r1(x0 + inset) + '" y1="' + r1(ty) + '" x2="' + r1(x1 - inset) + '" y2="' + r1(ty) + '" stroke="#68645f" stroke-width="0.6"/>';
        }
      }
      if (chimH) {
        [x0 + 40, x1 - 64].forEach(function (cx) {
          s += '<rect x="' + r1(cx) + '" y="' + r1(topY - roofH - chimH + 12) + '" width="24" height="' + r1(chimH + 12) + '" fill="#b57a4f" stroke="#8a5a3a" stroke-width="0.8"/>';
        });
      }
    }
    // openings
    var hl = opts.highlight || null;
    var openingsSvg = '';
    g.floors.forEach(function (f, fi) {
      var fh = g.floorH[fi], top = bandTop[fi];
      var total = f.items.reduce(function (t, o) { return t + drawnSize(o, g.style, fi).w; }, 0);
      var gap = (W - total) / (f.items.length + 1);
      var cx = x0 + gap;
      f.items.forEach(function (o) {
        var sz = drawnSize(o, g.style, fi);
        var oy = o.kind === 'door' && fi === 0 ? top + fh - sz.h : top + (fh - sz.h) / 2 + (fi === 0 ? -4 : 0);
        var glyph = o.kind === 'door' ? drawDoorGlyph(cx, oy, sz.w, sz.h, o, g.style, fi) : drawWindowGlyph(cx, oy, sz.w, sz.h, o, g.style);
        var faded = hl && !(o.id && hl[o.id]);
        var inner = '<g' + (faded ? ' opacity="0.35"' : '') + '>' + glyph + '</g>';
        if (hl && o.id && hl[o.id]) inner += '<rect x="' + r1(cx - 4) + '" y="' + r1(oy - 4) + '" width="' + r1(sz.w + 8) + '" height="' + r1(sz.h + 8) + '" fill="none" stroke="' + PAL.accent + '" stroke-width="2.2" rx="3"/>';
        if (opts.selected && o.id === opts.selected) inner += '<rect x="' + r1(cx - 4) + '" y="' + r1(oy - 4) + '" width="' + r1(sz.w + 8) + '" height="' + r1(sz.h + 8) + '" fill="none" stroke="' + PAL.accent + '" stroke-width="2.5" rx="3"/>';
        // number
        var code = openingCode(o);
        inner += '<text x="' + r1(cx + sz.w / 2) + '" y="' + r1(oy - (o.kind === 'door' && g.style === 'georgian' && fi === 0 ? 40 : 4)) + '" text-anchor="middle" font-family="Barlow, Arial, sans-serif" font-size="9" font-weight="700" fill="' + PAL.ink + '" paint-order="stroke" stroke="rgba(255,255,255,.85)" stroke-width="2.5">' + code + '</text>';
        // work markers
        var fl = o.id ? flags[o.id] : null;
        if (fl && (fl.quote || fl.variation)) {
          var bx = cx + sz.w - 2, byy = oy + 2;
          if (fl.quote) inner += '<circle cx="' + r1(bx) + '" cy="' + r1(byy) + '" r="5" fill="' + PAL.accent + '" stroke="#fff" stroke-width="1.2"/>';
          if (fl.variation) inner += '<circle cx="' + r1(bx - (fl.quote ? 11 : 0)) + '" cy="' + r1(byy) + '" r="5" fill="#fff" stroke="' + PAL.accent + '" stroke-width="1.6" stroke-dasharray="2 1.6"/>';
        }
        if (opts.interactive && o.id) {
          inner = '<g class="wd-open" data-open-id="' + esc(o.id) + '" style="cursor:pointer">' + inner
            + '<rect x="' + r1(cx - 6) + '" y="' + r1(oy - 12) + '" width="' + r1(sz.w + 12) + '" height="' + r1(sz.h + 18) + '" fill="transparent"/></g>';
        } else if (o.placeholder) {
          inner = '<g opacity="0.55">' + inner + '</g>';
        }
        openingsSvg += inner;
        cx += sz.w + gap;
      });
    });
    s += openingsSvg;
    // Georgian front railings
    if (g.style === 'georgian' && side === 'front') {
      var ry0 = groundY + 4;
      s += '<line x1="' + (x0 - 6) + '" y1="' + r1(ry0) + '" x2="' + (x1 + 6) + '" y2="' + r1(ry0) + '" stroke="#1d1d1f" stroke-width="1.6"/>';
      s += '<line x1="' + (x0 - 6) + '" y1="' + r1(ry0 + 24) + '" x2="' + (x1 + 6) + '" y2="' + r1(ry0 + 24) + '" stroke="#1d1d1f" stroke-width="1.2"/>';
      for (var rx = x0 - 4; rx <= x1 + 4; rx += 6) s += '<line x1="' + r1(rx) + '" y1="' + r1(ry0 - 4) + '" x2="' + r1(rx) + '" y2="' + r1(ry0 + 26) + '" stroke="#1d1d1f" stroke-width="0.9"/>';
    }
    var vbW = W + 60;
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

  // opts: { selected: {elementId: true}, interactive: true }
  function detailSvg(o, marks, opts) {
    opts = opts || {};
    var sel = opts.selected || {};
    var oMarks = (marks || []).filter(function (m) { return m.opening_id === o.id; });
    var s = '';
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
      W = 60 + colsW * 70; H = sash ? 70 + rowsW * 2 * 62 + 24 : 60 + rowsW * 70;
      W = Math.max(W, 200); H = Math.max(H, 180);
      var hd = 20, stw = 18, brw = 18, cill = 16, mr = 16;
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
        var paneGrid = function (prefix, gy, gh) {
          var out = '', n = 0, gap = 6;
          var cw = (aw - 12 - (colsW - 1) * gap) / colsW, rh = (gh - 12 - (rowsW - 1) * gap) / rowsW;
          for (var ri = 0; ri < rowsW; ri++) for (var ci = 0; ci < colsW; ci++) {
            n++;
            out += draw(prefix + '-' + n, R(ax + 6 + ci * (cw + gap), gy + 6 + ri * (rh + gap), cw, rh, glassFill));
          }
          return out;
        };
        s += '<rect x="' + r1(ax) + '" y="' + r1(hd) + '" width="' + r1(aw) + '" height="' + r1(halfH) + '" fill="#e9e6de" pointer-events="none"/>';
        s += '<rect x="' + r1(ax) + '" y="' + r1(hd + halfH + mr) + '" width="' + r1(aw) + '" height="' + r1(halfH) + '" fill="#e9e6de" pointer-events="none"/>';
        s += paneGrid('top', hd, halfH);
        s += paneGrid('bottom', hd + halfH + mr, halfH);
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
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-padX) + ' ' + (-padY) + ' ' + r1(W + 2 * padX) + ' ' + r1(H + 2 * padY) + '" width="100%" style="display:block;max-width:' + (opts.maxWidth || 320) + 'px;max-height:' + (opts.maxHeight || 420) + 'px;margin:0 auto;touch-action:manipulation" role="img" aria-label="' + esc(openingLabel(o)) + '">' + s + '</svg>';
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
    sortOpenings((data && data.openings) || []).forEach(function (o) {
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
      sections.push({ opening: o, label: openingLabel(o), type: typeLabel(o), quoted: quoted, variations: varied });
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
        out += '<div class="wdr-open"><div class="wdr-fig">' + detailSvg(sec.opening, model.marks, { maxWidth: 150, maxHeight: 220 }) + '</div>';
        out += '<div class="wdr-txt"><h4>' + esc(sec.label) + '</h4><div class="wdr-sub">' + esc(sec.type + (sec.opening.kind === 'door' ? ' door' : ' window')) + '</div>';
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
    SIDES: SIDES, STYLES: STYLES, WINDOW_TYPES: WINDOW_TYPES, DOOR_TYPES: DOOR_TYPES,
    WINDOW_TIERS: WINDOW_TIERS, DOOR_TIERS: DOOR_TIERS, PREP_LEVELS: PREP_LEVELS, ACTIONS: ACTIONS,
    DEFAULT_RATES: DEFAULT_RATES,
    mergeRates: mergeRates, actionDef: actionDef, prepRank: prepRank, prepLabel: prepLabel, maxPrep: maxPrep,
    floorLabel: floorLabel, sideLabel: sideLabel, typeLabel: typeLabel,
    sideLayout: sideLayout, openingDefaults: openingDefaults, floorSlots: floorSlots,
    openingElements: openingElements, elementKind: elementKind, actionsFor: actionsFor, paneCount: paneCount,
    openingCode: openingCode, openingLabel: openingLabel, sortOpenings: sortOpenings,
    effectivePrep: effectivePrep, quotePrep: quotePrep, baseMinutes: baseMinutes, paintedMinutes: paintedMinutes,
    priceJob: priceJob, openingPaintM2: openingPaintM2, paintAreas: paintAreas, marksClause: marksClause, describeVariation: describeVariation, itemLineText: itemLineText,
    workFlags: workFlags, elevationSvg: elevationSvg, detailSvg: detailSvg,
    reportModel: reportModel, reportHtml: reportHtml, fmtDate: fmtDate
  };
});
