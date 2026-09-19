// The job spec sheet's live link (JOB_SPEC_SHEET_SPEC.md).
//
// PUBLIC. Every route here is reachable with no session, which is the whole
// point: the reader is a helper on site or a client, holding a link that was
// texted to them, and asking them to make an account to tick off a ceiling
// would defeat the feature. So this router is mounted in server.js BEFORE the
// app's login gate, and the same three rules hold as on the client quote page:
//
//   1. The token IS the credential. It is 192 bits, compared in constant time
//      (lib/specSheet.js), and a job with no published sheet can never be
//      opened. It is the job's OWN spec token, never jobs.client_token --
//      that one carries Approve and Decline buttons, and handing it to a
//      helper hands them those buttons.
//   2. A bad token and a missing sheet give the SAME generic 404 page.
//   3. There is no money on it. No prices, quantities, tins, markup, site
//      notes or client contact details -- see what the app publishes in
//      jobSpecModel(). What is exposed by a forwarded link is progress state,
//      which is worth knowing but is not the client's bill.
//
// TWO KINDS OF DATA, PUBLISHED DIFFERENTLY. The ROWS come from a published
// model: the server has no calc engine, so the phone publishes the finished
// model and this serves it, current as of the phone's last sync (the page
// says so). The TICKS are not part of the model -- they live in spec_ticks,
// the one table both the app and this page write to, and are read fresh on
// every load. So a tick from either side shows on the other without a
// republish, and ticking never triggers one.
//
// ONE RENDERER. specSheetHtml() below and the handful of pure functions round
// it are serialised into the page's own script (PAGE_FUNCS), so the first
// paint the server sends and every repaint the page makes afterwards -- a
// view switch, a keystroke in the filter, a tick -- come from the same code.
// A second implementation of the ordering would be the duplicate-describing-
// function failure this repo keeps writing specs about, and it would show up
// as the page quietly re-sorting itself the first time anything was tapped.
// Everything in that block must therefore stay self-contained: no module
// scope, no closures, no requires.

const express = require('express');
const {
  ensureSpecSchema, loadSpecSheet, writeSpecTick, tickAllowedByModel,
  SPEC_TICK_STATUSES,
} = require('../lib/specSheet');

const router = express.Router();

// ── Abuse throttle ─────────────────────────────────────────────────────────
// Deliberately the same numbers as routes/publicQuote.js, and there for the
// same reason: not a security control (a 192-bit token is not brute-forceable
// and this would not save it if it were), but so a script hammering /s/... or
// its tick route can't spend the single Render instance's database
// connections while Nicky is trying to use the app.
const MAX_MISSES = 20;
const LOCKOUT_MS = 10 * 60 * 1000;
const misses = new Map(); // ip -> { count, lockedUntil }

function throttled(ip) {
  const m = misses.get(ip);
  return !!(m && m.lockedUntil && m.lockedUntil > Date.now());
}
function recordMiss(ip) {
  const m = misses.get(ip) || { count: 0, lockedUntil: 0 };
  m.count++;
  if (m.count >= MAX_MISSES) { m.lockedUntil = Date.now() + LOCKOUT_MS; m.count = 0; }
  misses.set(ip, m);
}

// ── The shared renderer ────────────────────────────────────────────────────
// Read the banner above before touching any of these: they are stringified
// into the page.

function specEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// 'key|step' -> the tick on it. One flat map, because every ordering and
// counting question below is "is this row's Painted step done".
function specTickMap(ticks) {
  var map = {};
  (ticks || []).forEach(function (t) {
    if (t && t.itemKey && t.step) map[t.itemKey + '|' + t.step] = t;
  });
  return map;
}

function specStepDone(tmap, key, step) {
  var t = tmap[key + '|' + step];
  return !!(t && t.status === 'done');
}

// A row is CLEARED when its last step is ticked -- Painted on a two-step row,
// Done on a single-step one. Prep alone never clears a row: it is half the
// work, and a list read for what is still outstanding must still be showing it.
function specRowCleared(row, tmap) {
  return specStepDone(tmap, row.key, row.steps[row.steps.length - 1]);
}

// "cleared Wed, 3 Sept", the same phrasing the snag list uses. Falls back to a
// bare "done" for a stamp that didn't survive a restore, rather than printing
// "Invalid Date" beside it.
function specWhen(tmap, key, step) {
  var t = tmap[key + '|' + step];
  if (!t || t.status !== 'done' || !t.completedAt) return '';
  var d = new Date(t.completedAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Cleared last, then stage, then sheet order, then key so the sort is total
// and two renders can never shuffle the same pair against each other. The
// consequence to know about: cleared-last outranks stage order, so a feature
// wall still open sits ABOVE a ticked-off ceiling. That is the same behaviour
// the snag list has and it is what "same logic" means.
function specSortRows(rows, tmap, stageRank, order) {
  return rows.slice().sort(function (a, b) {
    var da = specRowCleared(a, tmap) ? 1 : 0, dbv = specRowCleared(b, tmap) ? 1 : 0;
    if (da !== dbv) return da - dbv;
    var sa = stageRank[a.stage], sb = stageRank[b.stage];
    if (sa !== sb) return sa - sb;
    if (order[a.key] !== order[b.key]) return order[a.key] - order[b.key];
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// Does this row answer the filter box? Row label, colour name and area name --
// so "radiator" lists every room's radiator row with its colour, and a colour
// name lists everywhere that colour is used.
function specRowMatches(row, needle) {
  if (!needle) return true;
  return (row.label + ' ' + row.colour + ' ' + row.area + ' ' + row.product)
    .toLowerCase().indexOf(needle) >= 0;
}

// The groups for a view. By Room: one block per area, in the job's own order.
// By Stage: the job flattened, one section per stage with the room name
// alongside every row -- except the last stage ('other'), which keeps its
// areas as blocks because a kitchen and an exterior item have nothing to
// batch together.
//
// A group with nothing left open sinks below every group that still has work
// in it, job order preserved within each band -- the same rule as the rows.
function specGroups(model, tmap, view, needle) {
  var stageRank = {}, order = {};
  model.stages.forEach(function (s, i) { stageRank[s.key] = i; });
  model.rows.forEach(function (r, i) { order[r.key] = i; });

  var rows = model.rows.filter(function (r) { return specRowMatches(r, needle); });
  var groups = [], byKey = {};
  var push = function (key, label, row) {
    if (!byKey[key]) { byKey[key] = { key: key, label: label, rows: [] }; groups.push(byKey[key]); }
    byKey[key].rows.push(row);
  };

  if (view === 'stage') {
    var last = model.stages[model.stages.length - 1];
    var otherKey = last ? last.key : '';
    model.stages.forEach(function (s) {
      rows.forEach(function (r) {
        if (r.stage !== s.key) return;
        if (s.key === otherKey) push('other:' + r.areaKey, r.area, r);
        else push('stage:' + s.key, s.label, r);
      });
    });
  } else {
    rows.forEach(function (r) { push(r.areaKey, r.area, r); });
  }

  groups.forEach(function (g) {
    g.rows = specSortRows(g.rows, tmap, stageRank, order);
    g.open = g.rows.filter(function (r) { return !specRowCleared(r, tmap); }).length;
    // The note belongs to an AREA, so a group only carries it when the group
    // IS one area -- always true By Room and in By Stage's per-area blocks,
    // never true of a stage section spanning the house.
    var one = g.rows.every(function (r) { return r.areaKey === g.rows[0].areaKey; });
    g.note = one ? (g.rows[0].areaNote || '') : '';
  });
  var live = groups.filter(function (g) { return g.open > 0; });
  var done = groups.filter(function (g) { return g.open === 0; });
  return live.concat(done);
}

// Untapped, a group is open while it still has work in it and folded once it
// hasn't. The exception is a job with nothing open anywhere: that sheet is
// only on screen because someone opened it deliberately, and handing them a
// column of shut headings would answer a question they already asked.
function specGroupCollapsed(g, collapsed, anyOpen) {
  if (Object.prototype.hasOwnProperty.call(collapsed, g.key)) return !!collapsed[g.key];
  return anyOpen && g.open === 0;
}

function specBoxHtml(row, step, tmap) {
  var done = specStepDone(tmap, row.key, step);
  var when = done ? specWhen(tmap, row.key, step) : '';
  var label = step === 'prep' ? 'Prep' : (row.steps.length > 1 ? 'Painted' : 'Done');
  return '<button class="tick' + (done ? ' on' : '') + '" type="button"'
    + ' data-key="' + specEsc(row.key) + '" data-step="' + specEsc(step) + '"'
    + ' data-status="' + (done ? 'done' : 'open') + '">'
    + '<span class="box">' + (done ? '&#10003;' : '') + '</span>'
    + '<span class="tick-label">' + label + (when ? ' <em>' + specEsc(when) + '</em>' : '') + '</span>'
    + '</button>';
}

// One surface in one area. The COLOUR is the largest thing on it, because it
// is the thing being looked up.
function specRowHtml(row, tmap, showArea) {
  var cleared = specRowCleared(row, tmap);
  var prepDone = specStepDone(tmap, row.key, 'prep');
  return '<div class="row' + (cleared ? ' cleared' : '') + '">'
    + '<div class="row-head">' + specEsc(row.label)
      + (row.coats ? ' <span class="coats">' + specEsc(row.coats) + '</span>' : '')
      + (showArea ? ' <span class="where">' + specEsc(row.area) + '</span>' : '')
      + (row.tag ? ' <span class="tag">' + specEsc(row.tag) + '</span>' : '')
    + '</div>'
    + (row.colour ? '<div class="colour">' + specEsc(row.colour) + '</div>' : '')
    + (row.includes ? '<div class="incl">Including ' + specEsc(row.includes) + '</div>' : '')
    + (row.product ? '<div class="prod">' + specEsc(row.product) + '</div>' : '')
    + (row.prep ? '<div class="prep' + (prepDone ? ' done' : '') + '">' + specEsc(row.prep) + '</div>' : '')
    + '<div class="ticks">'
      + row.steps.map(function (s) { return specBoxHtml(row, s, tmap); }).join('')
    + '</div></div>';
}

// The whole sheet, in the view on screen. Returns a string either way: the
// server sends it as the first paint, the page swaps it in on every change.
function specSheetHtml(model, tmap, view, needle, collapsed) {
  var anyOpen = model.rows.some(function (r) { return !specRowCleared(r, tmap); });
  var groups = specGroups(model, tmap, view, needle);
  if (!groups.length) {
    return '<div class="card empty">Nothing matches that.</div>';
  }
  return groups.map(function (g) {
    // While the filter is running everything stays open: folding a group the
    // reader has just searched into would hide the answer they asked for.
    var shut = needle ? false : specGroupCollapsed(g, collapsed, anyOpen);
    return '<div class="grp">'
      + '<button class="grp-head' + (shut ? ' shut' : '') + '" type="button" data-group="' + specEsc(g.key) + '">'
        + '<span class="grp-name">' + specEsc(g.label)
          + (g.note ? ' <span class="grp-note">' + specEsc(g.note) + '</span>' : '')
        + '</span>'
        + '<span class="grp-count">' + (g.open ? g.open + ' open' : 'all done &#10003;') + '</span>'
        + '<span class="chev">&#8250;</span>'
      + '</button>'
      + (shut ? '' : '<div class="grp-rows">'
          + g.rows.map(function (r) {
              return specRowHtml(r, tmap, view === 'stage' || !!needle);
            }).join('')
          + '</div>')
      + '</div>';
  }).join('');
}

// The counts line, spelled out rather than left to be worked out by counting
// boxes.
function specCounts(model, tmap) {
  var total = model.rows.length, open = 0, prepTotal = 0, prepDone = 0, painted = 0;
  model.rows.forEach(function (r) {
    if (!specRowCleared(r, tmap)) open++;
    if (specRowCleared(r, tmap)) painted++;
    if (r.steps.indexOf('prep') >= 0) {
      prepTotal++;
      if (specStepDone(tmap, r.key, 'prep')) prepDone++;
    }
  });
  return { total: total, open: open, painted: painted, prepTotal: prepTotal, prepDone: prepDone };
}

// Serialised for the page. Order matters only in that every one must be
// defined before the script's own code runs, which it is.
const PAGE_FUNCS = [
  specEsc, specTickMap, specStepDone, specRowCleared, specWhen, specSortRows,
  specRowMatches, specGroups, specGroupCollapsed, specBoxHtml, specRowHtml,
  specSheetHtml, specCounts,
].map(f => f.toString()).join('\n');

// ── The page ───────────────────────────────────────────────────────────────
// Brand: the same steel blue / warm grey / Barlow palette as the client quote
// page, so the two obviously come from the same business. Barlow loads
// non-blocking for the reason given there: half this app's life happens on
// one bar of signal, and a webfont is not worth a blank screen.
const PAGE_CSS = `
:root{--steel:#1e6497;--grey:#f4f2ee;--ink:#2b2b2b;--mut:#6b6b6b;--line:#eee9e2;--ok:#1e7a4a}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Barlow",system-ui,-apple-system,sans-serif;background:var(--grey);color:var(--ink);line-height:1.45}
.page{max-width:640px;margin:0 auto;padding:20px 16px 56px}
.head{background:var(--steel);color:#fff;border-radius:14px;padding:22px;display:flex;align-items:center;gap:16px}
.head img{width:56px;height:56px;border-radius:12px;background:#fff;object-fit:contain;flex:none}
.head h1{font-family:"Barlow Semi Condensed","Barlow",sans-serif;font-size:24px;font-weight:700;letter-spacing:.01em}
.head .sub{font-size:14px;opacity:.85;margin-top:2px}
.for{padding:16px 4px 2px;font-size:16px;font-weight:600}
.for span{display:block;font-size:13.5px;font-weight:400;color:var(--mut);margin-top:2px}
.counts{font-size:13.5px;color:var(--mut);padding:6px 4px 0}
.counts b{color:var(--ink);font-weight:700}
.updated{font-size:12px;color:var(--mut);padding:2px 4px 0}
.bar{display:flex;gap:8px;margin-top:14px}
.seg{display:flex;flex:1;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.seg button{flex:1;font:inherit;font-size:14px;font-weight:600;padding:9px 6px;border:none;background:none;color:var(--mut);cursor:pointer}
.seg button.on{background:var(--steel);color:#fff}
.bar .fold{flex:none;font:inherit;font-size:13px;font-weight:700;padding:9px 13px;border:1px solid #d8d2c8;
           background:#fff;color:var(--mut);border-radius:10px;cursor:pointer}
.find{width:100%;font:inherit;font-size:15px;padding:10px 12px;margin-top:8px;border:1px solid #d8d2c8;
      border-radius:10px;background:#fff;color:var(--ink);-webkit-appearance:none}
.grp{margin-top:14px}
.grp-head{width:100%;display:flex;align-items:center;gap:10px;font:inherit;text-align:left;cursor:pointer;
          background:none;border:none;padding:2px 4px 8px;color:var(--steel)}
.grp-name{flex:1;min-width:0;font-family:"Barlow Semi Condensed","Barlow",sans-serif;font-size:14px;
          font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.grp-count{flex:none;font-size:12.5px;font-weight:600;color:var(--mut)}
.grp-note{text-transform:none;letter-spacing:0;font-weight:600}
.grp-note:before{content:"\\2014  "}
.chev{flex:none;font-size:17px;color:var(--mut);transform:rotate(90deg);transition:transform .15s}
.grp-head.shut .chev{transform:none}
.grp-rows{background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}
.row{padding:13px 16px;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:none}
.row.cleared{opacity:.55}
.row.cleared .row-head,.row.cleared .colour{text-decoration:line-through}
.row-head{font-size:14px;font-weight:600}
.coats{font-weight:400;color:var(--mut)}
.where{font-weight:400;color:var(--mut)}
.where:before{content:"\\00b7  "}
.tag{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.03em;border:1px solid var(--steel);
     color:var(--steel);border-radius:8px;padding:0 6px;margin-left:4px;white-space:nowrap;vertical-align:1px}
.colour{font-size:19px;font-weight:700;margin-top:2px;line-height:1.25}
.incl,.prod{font-size:12.5px;color:var(--mut);margin-top:2px}
.prep{font-size:12.5px;color:var(--mut);margin-top:5px}
.prep.done{text-decoration:line-through;opacity:.6}
.ticks{display:flex;gap:8px;margin-top:9px}
.tick{flex:1;display:flex;align-items:center;gap:7px;font:inherit;font-size:13px;font-weight:600;
      color:var(--mut);background:#fff;border:1px solid #d8d2c8;border-radius:10px;padding:7px 10px;cursor:pointer}
.tick.on{border-color:var(--steel);color:var(--steel)}
.tick .box{flex:none;width:18px;height:18px;border:1.5px solid #c9c2b6;border-radius:5px;display:flex;
           align-items:center;justify-content:center;font-size:12px;line-height:1;color:#fff}
.tick.on .box{background:var(--steel);border-color:var(--steel)}
.tick-label em{font-style:normal;font-weight:400;opacity:.8}
.card{background:#fff;border-radius:14px;padding:16px 18px;margin-top:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.empty{font-size:14px;color:var(--mut)}
.flash{position:fixed;left:16px;right:16px;bottom:16px;max-width:608px;margin:0 auto;background:var(--ink);
       color:#fff;border-radius:12px;padding:11px 14px;font-size:14px;font-weight:600;text-align:center;z-index:9}
.foot{font-size:12px;color:var(--mut);text-align:center;margin-top:26px;line-height:1.6}
`;

function shell(title, body, extraHead) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<meta name="theme-color" content="#1e6497">'
    // A link handed to one helper must never turn up in a search result.
    // Belt and braces with the X-Robots-Tag header set on every response.
    + '<meta name="robots" content="noindex, nofollow, noarchive">'
    + '<title>' + specEsc(title) + '</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800'
    + '&family=Barlow+Semi+Condensed:wght@600;700&display=swap" rel="stylesheet" media="print"'
    + ' onload="this.media=\'all\'">'
    + '<style>' + PAGE_CSS + '</style>'
    + (extraHead || '')
    + '</head><body>' + body + '</body></html>';
}

// The generic dead end. Deliberately says nothing about WHY: a wrong token, a
// sheet that was never published, a job since deleted and a link that has been
// stopped all land here reading identically.
function notFoundPage() {
  return shell('Link not found', '<div class="page">'
    + '<div class="card" style="margin-top:40px;text-align:center">'
    + '<h2 style="font-size:18px;margin-bottom:8px">Link not found</h2>'
    + '<p class="empty">This link isn\'t valid any more. Check you\'ve opened the most recent '
    + 'message, or get in touch and we\'ll send a fresh one.</p>'
    + '</div></div>');
}

const longStamp = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ', ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function countsLine(c) {
  return c.open === 0
    ? '<b>All ' + c.total + ' done</b>'
    : '<b>' + c.open + ' outstanding</b>, ' + c.painted + ' done'
      + (c.prepTotal ? ' &#183; Prep ' + c.prepDone + ' of ' + c.prepTotal : '');
}

function sheetPage(view, token) {
  const b = view.business;
  // The stock fallback is /logo.png, which routes/appLogin.js already keeps on
  // its open-paths list for the login page -- so it resolves for a reader with
  // no session on a gated instance too.
  const logo = b.logoDataUri || '/logo.png';
  const tmap = specTickMap(view.ticks);
  const counts = specCounts(view.model, tmap);

  const head = '<div class="head">'
    + '<img src="' + specEsc(logo) + '" alt="" onerror="this.style.display=\'none\'">'
    + '<div><h1>' + specEsc(b.name) + '</h1>'
    + '<div class="sub">Spec sheet</div></div></div>'
    + '<div class="for">' + specEsc(view.model.jobName || 'This job')
    + (view.model.address ? '<span>' + specEsc(view.model.address) + '</span>' : '')
    + '</div>'
    + '<div class="counts" id="counts">' + countsLine(counts) + '</div>'
    + '<div class="updated">Updated ' + specEsc(longStamp(view.publishedAt)) + '</div>';

  const bar = '<div class="bar">'
    + '<div class="seg">'
      + '<button type="button" class="on" data-view="room">By room</button>'
      + '<button type="button" data-view="stage">By stage</button>'
    + '</div>'
    + '<button type="button" class="fold" id="fold">Fold all</button>'
    + '</div>'
    + '<input class="find" id="find" type="search" placeholder="Find a room, surface or colour" autocomplete="off">';

  const foot = '<div class="foot">Tick Prep and Painted as you go &#8212; anyone with this link sees the same sheet.<br>'
    + 'No prices on here. Any questions, just reply to the message this link came in.</div>';

  return shell((view.model.jobName || 'Spec sheet') + ' — ' + (b.name || 'Spec sheet'),
    '<div class="page">' + head + bar
    + '<div id="sheet">' + specSheetHtml(view.model, tmap, 'room', '', {}) + '</div>'
    + foot + '</div>'
    + '<script>window.__SPEC__=' + jsonForScript({ model: view.model, ticks: view.ticks, token })
    + ';</script>'
    + '<script>' + PAGE_FUNCS + '\n' + PAGE_JS + '</script>');
}

// JSON destined for a <script> block. The model is already whitelisted plain
// strings (normaliseSpecModel), but a row label containing "</script>" would
// still end the block early, so the three sequences that can do that are
// escaped. Everything else stays readable JSON.
function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, m =>
      m === '\u2028' ? '\\u2028' : '\\u2029');
}

const PAGE_JS = `
(function () {
  var S = window.__SPEC__ || { model: { rows: [], stages: [] }, ticks: [] };
  var view = 'room', needle = '', collapsed = {}, flashTimer = null;
  var sheet = document.getElementById('sheet');
  var find = document.getElementById('find');

  function tmap() { return specTickMap(S.ticks); }
  function paint() {
    var m = tmap();
    sheet.innerHTML = specSheetHtml(S.model, m, view, needle, collapsed);
    var c = specCounts(S.model, m);
    document.getElementById('counts').innerHTML = c.open === 0
      ? '<b>All ' + c.total + ' done</b>'
      : '<b>' + c.open + ' outstanding</b>, ' + c.painted + ' done'
        + (c.prepTotal ? ' \\u00b7 Prep ' + c.prepDone + ' of ' + c.prepTotal : '');
    var any = S.model.rows.some(function (r) { return !specRowCleared(r, m); });
    var anyShowing = specGroups(S.model, m, view, needle).some(function (g) {
      return !(needle ? false : specGroupCollapsed(g, collapsed, any));
    });
    document.getElementById('fold').textContent = anyShowing ? 'Fold all' : 'Open all';
  }
  function flash(text) {
    var el = document.getElementById('flash');
    if (!el) {
      el = document.createElement('div');
      el.className = 'flash'; el.id = 'flash';
      document.body.appendChild(el);
    }
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3200);
  }

  document.addEventListener('click', function (ev) {
    var seg = ev.target.closest && ev.target.closest('[data-view]');
    if (seg) {
      view = seg.getAttribute('data-view');
      var all = document.querySelectorAll('[data-view]');
      for (var i = 0; i < all.length; i++) all[i].className = all[i] === seg ? 'on' : '';
      paint();
      return;
    }
    var fold = ev.target.closest && ev.target.closest('#fold');
    if (fold) {
      var shutting = fold.textContent.indexOf('Fold') === 0;
      specGroups(S.model, tmap(), view, needle).forEach(function (g) { collapsed[g.key] = shutting; });
      paint();
      return;
    }
    var head = ev.target.closest && ev.target.closest('.grp-head');
    if (head) {
      var key = head.getAttribute('data-group');
      var m = tmap();
      // The REAL anyOpen, not a convenient true: on a sheet with nothing open
      // the default is "every group showing", so flipping against true would
      // write "not folded" over a group already on screen and the tap would
      // appear to do nothing.
      var any = S.model.rows.some(function (r) { return !specRowCleared(r, m); });
      var g = null;
      specGroups(S.model, m, view, needle).forEach(function (x) { if (x.key === key) g = x; });
      collapsed[key] = g ? !specGroupCollapsed(g, collapsed, any) : true;
      paint();
      return;
    }
    var tick = ev.target.closest && ev.target.closest('.tick');
    if (tick) sendTick(tick.getAttribute('data-key'), tick.getAttribute('data-step'),
                       tick.getAttribute('data-status') === 'done' ? 'open' : 'done');
  });

  find.addEventListener('input', function () {
    needle = find.value.trim().toLowerCase();
    paint();
  });

  // Optimistic, with no offline queue: the queue is the phone app's job (it
  // is the one that goes into cellars). A tick that cannot be sent reverts
  // and says so, rather than sitting on screen as a tick nobody recorded.
  function sendTick(key, step, status) {
    var before = S.ticks.slice();
    setLocal(key, step, status, new Date().toISOString());
    paint();
    fetch('/s/' + encodeURIComponent(S.token) + '/tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ item_key: key, step: step, status: status })
    }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.ok) throw new Error('rejected');
        setLocal(key, step, res.body.tick.status, res.body.tick.completedAt);
        paint();
      })
      .catch(function () { S.ticks = before; paint(); flash('No signal, try again'); });
  }
  function setLocal(key, step, status, at) {
    var hit = null;
    S.ticks.forEach(function (t) { if (t.itemKey === key && t.step === step) hit = t; });
    if (!hit) { hit = { itemKey: key, step: step }; S.ticks.push(hit); }
    hit.status = status;
    hit.completedAt = status === 'done' ? at : null;
    hit.source = 'link';
  }

  // Somebody else's ticks -- Nicky on the phone, or a second helper on the
  // same link. A fetch replaces the whole set, which is safe here for the
  // reason it is not on the phone: this page has no queued local writes to
  // swallow, because it has no queue.
  function refresh() {
    fetch('/s/' + encodeURIComponent(S.token) + '/ticks', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) { if (b && b.ticks) { S.ticks = b.ticks; paint(); } })
      .catch(function () {});
  }
  setInterval(function () { if (!document.hidden) refresh(); }, 30000);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
`;

// ── Routes ─────────────────────────────────────────────────────────────────

function publicHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

const SPEC_PATHS = ['/s/:token', '/s/:token/ticks', '/s/:token/tick'];

router.use(SPEC_PATHS, async (req, res, next) => {
  publicHeaders(res);
  if (throttled(req.ip)) return res.status(429).type('text').send('Too many requests — try again shortly.');
  try {
    await ensureSpecSchema();
    next();
  } catch (err) {
    console.error('Spec sheet schema could not be prepared', err);
    res.status(500).type('html').send(notFoundPage());
  }
});

router.get('/s/:token', async (req, res) => {
  try {
    const view = await loadSpecSheet(req.params.token);
    if (!view) { recordMiss(req.ip); return res.status(404).type('html').send(notFoundPage()); }
    res.type('html').send(sheetPage(view, req.params.token));
  } catch (err) {
    console.error('Spec sheet page failed', err);
    res.status(500).type('html').send(notFoundPage());
  }
});

// Polled every 30s while the page is visible, and on focus. Ticks only -- the
// model is not re-sent, because it only changes when the phone republishes and
// the page's own "Updated" line is what says how old it is.
router.get('/s/:token/ticks', async (req, res) => {
  try {
    const view = await loadSpecSheet(req.params.token);
    if (!view) { recordMiss(req.ip); return res.status(404).json({ ok: false }); }
    res.json({ ok: true, ticks: view.ticks });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// A PUBLIC WRITE, so three things hold and none of them is optional:
//
//   · The job is resolved FROM THE TOKEN ONLY, never from the body. A body
//     that names a job id names nothing; there is no such field.
//   · The tick is accepted only if item_key is a row in THAT job's published
//     model and step is one of THAT row's steps. That is what stops the table
//     being filled with junk, and it is why the published model is the thing
//     checked against rather than a length cap alone.
//   · completed_at is the server's now and source is 'link'. The page has no
//     offline queue (see PAGE_JS), so there is no offline stamp to honour --
//     and a public caller's clock is not something to write into the record.
router.post('/s/:token/tick', async (req, res) => {
  try {
    const view = await loadSpecSheet(req.params.token);
    if (!view) { recordMiss(req.ip); return res.status(404).json({ ok: false, error: 'not found' }); }
    const body = req.body || {};
    const itemKey = String(body.item_key == null ? '' : body.item_key);
    const step = String(body.step == null ? '' : body.step);
    const status = String(body.status == null ? '' : body.status);
    if (!SPEC_TICK_STATUSES.has(status) || !tickAllowedByModel(view.model, itemKey, step)) {
      return res.status(400).json({ ok: false, error: 'bad tick' });
    }
    const tick = await writeSpecTick({
      jobId: view.jobId, itemKey, step, status,
      completedAt: new Date().toISOString(), source: 'link',
    });
    res.json({ ok: true, tick });
  } catch (err) {
    console.error('Spec sheet tick failed', err);
    res.status(500).json({ ok: false, error: 'Could not save that — please try again.' });
  }
});

module.exports = router;
module.exports.__test__ = {
  specTickMap, specRowCleared, specGroups, specSheetHtml, specCounts, specGroupCollapsed,
  specSortRows, specRowMatches,
};
