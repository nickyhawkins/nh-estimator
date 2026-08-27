#!/usr/bin/env node
'use strict';

// Accepted-quote snapshot guardrails (the third of the three the spec asks
// for). The other two can't be bypassed by accident:
//
//   1. STRUCTURAL — routes/api.js exposes GET and POST on /quote-snapshots
//      and nothing else. There is no endpoint that could update or delete a
//      snapshot, so no amount of client code can rewrite one.
//   2. RUNTIME — deepFreezeSnapshot() in public/index.html freezes every
//      snapshot before a render path sees it, so a caller that treats one
//      like a live model throws instead of silently editing agreed figures.
//
// This file is the one that catches the failure those two can't: not a write
// to a snapshot, but a READ that never happens — an accepted-quote render
// path quietly going back to the live calc, so the figures start drifting
// again with nothing on screen to show it. That's the original bug, and it
// would reappear as an ordinary-looking edit to a render function.
//
// Run it with `npm run check:snapshots`, or in CI. Exit code 1 = a guardrail
// tripped, with the file, line and what to do about it.
//
// It is a text check, not a type system, so it is deliberately narrow: it
// asserts things that are cheap to state exactly and expensive to get wrong.
// A false positive means the code moved somewhere this file has to be taught
// about — update the check, don't delete it.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const failures = [];
function fail(file, msg, detail) {
  failures.push({ file, msg, detail });
}

// The route declaration a given offset sits inside — the nearest
// `router.<method>('<path>'` at or before it.
function enclosingRoute(src, index) {
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g;
  let m, best = null;
  while ((m = re.exec(src)) && m.index < index) best = `router.${m[1]}('${m[2]}'`;
  return best;
}

// Comments and string literals removed, everything else left at its original
// offset so line numbers still line up. Without this the checks below read
// their own explanatory comments as code: a comment saying "must not call
// calcRoom()" would trip the very rule it documents, and the honest fix — not
// naming the function in the prose — would make the guardrail's own reasoning
// unwriteable. Offsets are preserved by blanking rather than deleting.
function stripCommentsAndStrings(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      let j = src.indexOf('\n', i); if (j < 0) j = src.length;
      blank(i, j); i = j; continue;
    }
    if (two === '/*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2;
      blank(i, j); i = j; continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === ch) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

// Line number of the first occurrence of a needle, for a clickable message.
function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

// ── 1. The server surface stays append-only ─────────────────────────────────
// A PUT or DELETE route on /quote-snapshots would make every other guarantee
// here decorative: the whole design rests on there being no way to rewrite a
// row once it's written.
(function checkServerSurface() {
  const src = read('routes/api.js');
  const routeRe = /router\.(get|post|put|patch|delete)\(\s*'(\/quote-snapshots[^']*)'/g;
  const allowed = { get: true, post: true };
  let m;
  let sawGet = false, sawPost = false;
  while ((m = routeRe.exec(src))) {
    const [, method, route] = m;
    if (!allowed[method]) {
      fail('routes/api.js:' + lineOf(src, m.index),
        `router.${method}('${route}') exists — quote snapshots are append-only.`,
        'An accepted quote is a record of what a client agreed. Correcting one means appending a\n'
        + '    new revision (see amendAcceptedQuote), never rewriting or removing the old one.');
    }
    if (method === 'get') sawGet = true;
    if (method === 'post') sawPost = true;
  }
  if (!sawGet || !sawPost) {
    fail('routes/api.js', 'The /quote-snapshots GET and POST routes are missing.',
      'Without them nothing can be frozen or read back, and every accepted quote silently\n'
      + '    returns to being re-priced from the live rates.');
  }
  // The POST must derive the version itself. A client-supplied version is a
  // race waiting to overwrite a revision that already exists.
  const postBody = src.slice(src.indexOf("router.post('/quote-snapshots'"));
  const insert = postBody.slice(0, postBody.indexOf('\n});'));
  if (!/COALESCE\(MAX\(version\), 0\) \+ 1/.test(insert)) {
    fail('routes/api.js', 'POST /quote-snapshots no longer derives version from MAX(version) + 1.',
      'Versions assigned anywhere but inside the INSERT can collide between devices, and a\n'
      + '    collision that is not caught is one revision overwriting another.');
  }
  if (/\bUPDATE\s+quote_snapshots\b/i.test(src)) {
    fail('routes/api.js', 'An UPDATE against quote_snapshots was found.',
      'Snapshots are immutable. Append a revision instead.');
  }
  // One DELETE is legitimate and only one: the whole-job cascade. Which route
  // a statement belongs to is decided by the nearest route declaration ABOVE
  // it, not by a fixed window of characters -- a window is a comment away from
  // giving the wrong answer in either direction.
  const deletes = [...src.matchAll(/DELETE\s+FROM\s+quote_snapshots/gi)];
  deletes.forEach((d) => {
    if (enclosingRoute(src, d.index) !== "router.delete('/jobs/:id'") {
      fail('routes/api.js:' + lineOf(src, d.index),
        'DELETE FROM quote_snapshots outside the DELETE /jobs/:id cascade.',
        'Deleting the whole job is a deliberate destroy-everything action. Deleting a snapshot\n'
        + '    on its own is a figure being quietly withdrawn, which is the thing this table prevents.');
    }
  });
})();

// ── 2. Accepted-quote render paths never reach for the live calc ────────────
// The check that actually protects the figures. Each entry names a function
// whose job is to render (or serialise) what was AGREED, and the calc it must
// not call to do it. buildAcceptedQuoteSnapshot is the deliberate exception:
// running the calc exactly once, at acceptance, is its entire purpose.
const LIVE_CALC_FUNCTIONS = [
  'calcRoom', 'calcExtItem', 'calcKitchen', 'calcFittedUnit', 'calcFittedUnitsAgg',
  'computeMaterials', 'computeDepositPlan', 'realisticDays', 'standaloneInfo',
  'applyMarkupAmount', 'markupRatio', 'effectiveMarkup',
];

// Functions that render an accepted quote and must be snapshot-only.
const FROZEN_RENDERERS = [
  'frozenQuoteCardHtml',
  'openSnapshotHistory',
  'snapshotLevelLabel',
  'frozenQuoteModel',
  'frozenQuoteTotal',
  'frozenQuoteLabour',
  'frozenQuoteMaterialsTotal',
];

// Pull one top-level `function name(...) { ... }` body out by brace matching.
// Crude, and adequate: public/index.html's functions are all top-level and
// brace-balanced, and a parse failure here shows up as a missing-function
// error below rather than as a silent pass.
function extractFunction(src, name) {
  const sig = new RegExp('\\nfunction ' + name + '\\s*\\(');
  const m = sig.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { body: src.slice(i, j + 1), start: m.index };
    }
  }
  return null;
}

(function checkFrozenRenderers() {
  const raw = read('public/index.html');
  // Every scan below runs over CODE, with comments and string bodies blanked
  // out at their original offsets, so reported line numbers still point at the
  // real line.
  const src = stripCommentsAndStrings(raw);

  FROZEN_RENDERERS.forEach((name) => {
    const fn = extractFunction(src, name);
    if (!fn) {
      fail('public/index.html', `Expected accepted-quote renderer ${name}() was not found.`,
        'Either it was renamed (update this list) or removed (which means some accepted view is\n'
        + '    back to rendering live figures).');
      return;
    }
    LIVE_CALC_FUNCTIONS.forEach((calc) => {
      const call = new RegExp('\\b' + calc + '\\s*\\(');
      if (call.test(fn.body)) {
        fail('public/index.html:' + lineOf(src, fn.start + 1),
          `${name}() calls ${calc}() — an accepted quote must render from its snapshot only.`,
          'Every figure this function shows was agreed by a client. Deriving any part of it from\n'
          + '    the current rates is what makes accepted quotes drift.');
      }
    });
  });

  // openClientQuote() is the client-facing document and its PDF — the single
  // most important branch in the feature. It MUST return before any calc runs
  // when the job is frozen.
  const ocq = extractFunction(src, 'openClientQuote');
  if (!ocq) {
    fail('public/index.html', 'openClientQuote() was not found.', 'The client quote preview is the primary frozen render path.');
  } else {
    const guardAt = ocq.body.indexOf('jobQuoteIsFrozen(');
    if (guardAt < 0) {
      fail('public/index.html', 'openClientQuote() no longer branches on jobQuoteIsFrozen().',
        'Without the branch, opening an accepted quote re-prices it at today’s rates and the PDF\n'
        + '    handed to the client carries figures they never agreed to.');
    } else {
      const beforeGuard = ocq.body.slice(0, guardAt);
      LIVE_CALC_FUNCTIONS.forEach((calc) => {
        if (new RegExp('\\b' + calc + '\\s*\\(').test(beforeGuard)) {
          fail('public/index.html', `openClientQuote() calls ${calc}() before the frozen check.`,
            'The frozen branch has to come first. A calc that runs before it still runs for accepted\n'
            + '    jobs, which is exactly the leak the branch exists to close.');
        }
      });
    }
  }

  // Snapshots are written from one place, so that "who can freeze figures?"
  // has a one-word answer.
  const writers = [...src.matchAll(/pendingQuoteSnapshots\.push\(/g)];
  writers.forEach((w) => {
    const context = src.slice(Math.max(0, w.index - 2500), w.index);
    if (!/function captureQuoteSnapshot\s*\(/.test(context)) {
      fail('public/index.html:' + lineOf(src, w.index),
        'A snapshot is being queued outside captureQuoteSnapshot().',
        'Acceptance and amendment are the only two events that may freeze figures. Route the new\n'
        + '    caller through captureQuoteSnapshot() so it inherits the version, note and offline handling.');
    }
  });

  const posts = [...src.matchAll(/'\/api\/quote-snapshots'/g)];
  posts.forEach((pmatch) => {
    const context = src.slice(Math.max(0, pmatch.index - 3000), pmatch.index + 200);
    if (!/function flushPendingSnapshots\s*\(/.test(context)) {
      fail('public/index.html:' + lineOf(src, pmatch.index),
        'POST /api/quote-snapshots is called outside flushPendingSnapshots().',
        'All writes go through the pending queue, so a capture taken on site with no signal is\n'
        + '    never lost — which is when acceptances actually happen.');
    }
  });

  // The runtime freeze itself.
  if (!/function deepFreezeSnapshot\s*\(/.test(src)) {
    fail('public/index.html', 'deepFreezeSnapshot() is gone.',
      'It is the runtime half of the guardrail: without it a render path can mutate agreed figures\n'
      + '    in memory and display the result as though the client had signed it.');
  }
  if (!/quoteSnapshots\s*=\s*deepFreezeSnapshot\(/.test(src)) {
    fail('public/index.html', 'Loaded snapshots are no longer passed through deepFreezeSnapshot().',
      'Freeze them where they are adopted, not where they are read — a single unfrozen path is\n'
      + '    enough to lose the guarantee.');
  }
})();

// ── Report ──────────────────────────────────────────────────────────────────
if (failures.length === 0) {
  console.log('✓ Accepted-quote snapshot guardrails hold.');
  console.log('  · quote_snapshots is append-only on the server (GET + POST, version derived in the INSERT)');
  console.log('  · accepted-quote render paths read the snapshot and never the live calc');
  console.log('  · snapshots are written from captureQuoteSnapshot() only, and deep-frozen once loaded');
  process.exit(0);
}

console.error(`✗ ${failures.length} accepted-quote guardrail${failures.length === 1 ? '' : 's'} tripped:\n`);
failures.forEach((f, i) => {
  console.error(`  ${i + 1}. ${f.file}`);
  console.error(`     ${f.msg}`);
  if (f.detail) console.error(`     ${f.detail}`);
  console.error('');
});
console.error('Accepted quotes are what clients have agreed to pay. If a change here is deliberate,');
console.error('change this check with it and say why in the commit — do not simply remove it.\n');
process.exit(1);
