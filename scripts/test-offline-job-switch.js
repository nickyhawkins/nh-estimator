#!/usr/bin/env node
'use strict';

// ── Regression test: switching jobs offline must not empty a job ───────────
//
// The four bulk collections (rooms, exterior items, colours, the materials
// snapshot) mirror to localStorage under ONE key each -- pe-rooms and
// friends -- which holds whichever job is active. That was enough while a job
// switch could only happen with a server to fetch the next job from. Offline
// it was silently destructive:
//
//   loadActiveJobData() set each collection to [] when its fetch failed, so a
//   switch in a dead spot showed the new job EMPTY, every room gone. Measure
//   into it and saveRooms() PUTs [thatOneRoom] to that job -- queued, then
//   flushed on reconnect, replacing a whole house's measurements on the
//   server with one room. No error anywhere: the queue did as it was told.
//
//   Worse on a cold relaunch. pe-active-job-id had moved to the new job while
//   pe-rooms still held the OLD job's rows, so the app came back up showing
//   one job's measurements under another job's name, and wrote them there on
//   the first edit.
//
// So every job opened on this phone now keeps its own copy, a failed fetch
// falls back to THAT rather than to [], and a job this phone has never held
// is refused with a reason rather than opened empty. Held here, along with
// the bounds -- a phone is not a database, so the copies are capped and a
// full localStorage must not lose the write.
//
// Pure node against the real source: the functions are extracted out of
// public/index.html by name and evaluated with stubs, the same shape as
// scripts/test-scope-text.js. No browser, no server, no database.
//
// USAGE
//   node scripts/test-offline-job-switch.js
//   npm run test:offline-jobs

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));
const same = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

// ── Extraction ─────────────────────────────────────────────────────────────
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
  for (const lead of ['\nfunction ', '\nasync function ']) {
    const at = SRC.indexOf(lead + name + '(');
    if (at >= 0) return sliceBalanced(SRC, at + 1, '{', '}');
  }
  throw new Error('function ' + name + ' not found in public/index.html');
}
function extractVarLine(name) {
  const m = new RegExp('^var ' + name + ' = .*$', 'm').exec(SRC);
  if (!m) throw new Error('var ' + name + ' not found in public/index.html');
  return m[0];
}

const FNS = ['jobMirrorKey', 'readJobMirrorOrder', 'dropJobMirror', 'touchJobMirror',
             'readJobMirror', 'hasJobMirror', 'writeJobMirror', 'writeJobMirrorAll',
             'seedJobMirrorFromLegacy', 'loadActiveJobData', 'switchJob'];
const VARS = ['JOB_MIRROR_COLLS', 'JOB_MIRROR_LIMIT', 'JOB_MIRROR_ORDER_KEY'];

// ── Harness ────────────────────────────────────────────────────────────────
// `server` maps a collection name to its rows, or to the string 'DOWN' for a
// fetch that fails. Everything loadActiveJobData touches beyond the four bulk
// collections is a no-op stub: those have no local mirror by design and are
// not what is under test.
function load(server, opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage);
  const alerts = [];
  const box = {
    console, JSON, Date, Error, Array, Math, Promise, encodeURIComponent, String, Object,
    // ── app state ──
    activeJobId: opts.activeJobId || null,
    jobs: opts.jobs || [],
    rooms: [], extItems: [], colours: [], materialsSnapshot: [],
    materialActuals: [], labourLog: [], snags: [], snagRooms: [],
    quoteSnapshots: [], quoteSnapshotsJobId: null,
    serverAvailable: opts.serverAvailable !== false,
    serverShadow: {},
    pendingSaves: { rooms: null, colours: null, extItems: null, materials: null },
    snagEditId: null, matReorderMode: false, measureReorderMode: false,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        if (opts.quotaAfter !== undefined && Object.keys(store).length >= opts.quotaAfter && !(k in store)) {
          const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
        }
        store[k] = String(v);
      },
      removeItem: (k) => { delete store[k]; },
    },
    alert: (m) => alerts.push(m),
    activeJob: () => box.jobs.filter((j) => j.id === box.activeJobId)[0] || null,
    // ── stubs ──
    apiGet: async (p) => {
      const coll = /\/api\/(\w+)/.exec(p)[1];
      const v = server[coll];
      if (v === 'DOWN' || v === undefined) throw new TypeError('Failed to fetch');
      return v;
    },
    noteServerCopy: () => {},
    loadLabourLog: async () => {}, loadSnags: async () => {}, loadSnagRooms: async () => {},
    loadSpecTicks: async () => {}, refreshSpecLink: async () => {},
    loadQuoteSnapshots: async () => {}, loadClientVariations: async () => {},
    applyClientVariationAnswers: () => {}, ensureDefaultColour: () => {},
    clearUndoStack: () => {}, restoreJobIdentityFields: () => {}, updateNavBadge: () => {},
    renderHome: () => {}, renderExterior: () => {}, renderColours: () => {},
    renderSummary: () => {}, renderDash: () => {}, renderJobs: () => {},
    goTab: (t) => { box.tab = t; },
    saveRooms: async () => {}, saveColours: async () => {},
    saveExtItems: async () => {}, saveMaterialsSnapshot: async () => {},
    tab: null,
  };
  vm.createContext(box);
  vm.runInContext(VARS.map(extractVarLine).join('\n') + '\n' + FNS.map(extractFn).join('\n'), box);
  return { box, store, alerts, run: (code) => vm.runInContext(code, box) };
}

const ROOMS_A = [{ id: 'a1', name: 'Lounge' }, { id: 'a2', name: 'Hall' }];
const ROOMS_B = [{ id: 'b1', name: 'Kitchen' }, { id: 'b2', name: 'Bed 1' }, { id: 'b3', name: 'Bath' }];
const ALL_DOWN = { rooms: 'DOWN', extitems: 'DOWN', colours: 'DOWN', materials: 'DOWN', actuals: 'DOWN' };

// A phone that has already opened both jobs in signal.
function phoneWithBothJobs() {
  return {
    'pe-job-jobA-rooms': JSON.stringify(ROOMS_A),
    'pe-job-jobA-extitems': '[]', 'pe-job-jobA-colours': '[]', 'pe-job-jobA-materials': '[]',
    'pe-job-jobB-rooms': JSON.stringify(ROOMS_B),
    'pe-job-jobB-extitems': '[]', 'pe-job-jobB-colours': '[]', 'pe-job-jobB-materials': '[]',
    'pe-job-mirror-order': JSON.stringify(['jobA', 'jobB']),
    'pe-active-job-id': 'jobA',
    'pe-rooms': JSON.stringify(ROOMS_A),
  };
}
const TWO_JOBS = [{ id: 'jobA', name: '12 Elm Road' }, { id: 'jobB', name: '3 Oak Lane' }];

(async () => {
  // ── 1. THE BUG: switching jobs with no signal ────────────────────────────
  {
    const h = load(ALL_DOWN, { activeJobId: 'jobA', jobs: TWO_JOBS, serverAvailable: false,
                               storage: phoneWithBothJobs() });
    h.box.rooms = ROOMS_A.slice();
    const ok = await h.run("switchJob('jobB')");
    eq('the switch goes through', ok, true);
    same("and the new job's OWN rooms are on screen, not an empty list", h.box.rooms, ROOMS_B);
    eq('the app is on the new job', h.box.activeJobId, 'jobB');
    // The cold-relaunch half: initApp reads pe-rooms against pe-active-job-id,
    // so those two must never describe different jobs.
    eq('pe-active-job-id names the new job', h.store['pe-active-job-id'], 'jobB');
    same('and pe-rooms holds THAT job\'s rooms, not the one we came from',
      JSON.parse(h.store['pe-rooms']), ROOMS_B);
  }

  // ── 2. A job this phone has never held is refused, not opened empty ──────
  {
    const storage = phoneWithBothJobs();
    const h = load(ALL_DOWN, { activeJobId: 'jobA', serverAvailable: false, storage,
      jobs: TWO_JOBS.concat([{ id: 'jobC', name: '9 Beech Way' }]) });
    h.box.rooms = ROOMS_A.slice();
    const ok = await h.run("switchJob('jobC')");
    eq('the switch is refused', ok, false);
    eq('the app is still on the job it was on', h.box.activeJobId, 'jobA');
    eq('and so is pe-active-job-id', h.store['pe-active-job-id'], 'jobA');
    same('with that job\'s rooms still on screen', h.box.rooms, ROOMS_A);
    // The cold-relaunch invariant again: after a refusal, the pe-* mirror the
    // next launch reads must describe the job we ended up on.
    same('and pe-rooms restored to match', JSON.parse(h.store['pe-rooms']), ROOMS_A);
    eq('the user is told why, by name', h.alerts.length, 1);
    check('naming the job that could not be opened', /9 Beech Way/.test(h.alerts[0] || ''), h.alerts[0]);
    check('and saying nothing has changed', /nothing has changed/.test(h.alerts[0] || ''), h.alerts[0]);
    check('the screen did not move', h.box.tab === null, String(h.box.tab));
  }

  // ── 3. Online, the server is still authoritative ─────────────────────────
  {
    const h = load({ rooms: ROOMS_B, extitems: [], colours: [], materials: [], actuals: [] },
      { activeJobId: 'jobA', jobs: TWO_JOBS, storage: phoneWithBothJobs() });
    const ok = await h.run("switchJob('jobB')");
    eq('the switch goes through', ok, true);
    same('the server\'s rows are what is shown', h.box.rooms, ROOMS_B);
    check('and are written to the per-job copy for next time',
      h.store['pe-job-jobB-rooms'] === JSON.stringify(ROOMS_B), h.store['pe-job-jobB-rooms']);
  }
  {
    // An EMPTY server response is real data -- the rows were deleted, possibly
    // from another device -- and must not be second-guessed by the mirror.
    const h = load({ rooms: [], extitems: [], colours: [], materials: [], actuals: [] },
      { activeJobId: 'jobA', jobs: TWO_JOBS, storage: phoneWithBothJobs() });
    await h.run("switchJob('jobB')");
    same('a successful but empty response empties the job', h.box.rooms, []);
    eq('and the stale local copy is replaced, not kept', h.store['pe-job-jobB-rooms'], '[]');
  }

  // ── 4. A partial outage takes each collection from wherever it can ───────
  {
    const h = load({ rooms: 'DOWN', extitems: [{ id: 'x1' }], colours: [], materials: [], actuals: [] },
      { activeJobId: 'jobA', jobs: TWO_JOBS, storage: phoneWithBothJobs() });
    const ok = await h.run("switchJob('jobB')");
    eq('the switch still goes through', ok, true);
    same('the collection that failed comes off the phone', h.box.rooms, ROOMS_B);
    same('the one that answered comes off the server', h.box.extItems, [{ id: 'x1' }]);
  }

  // ── 5. The copies are bounded ────────────────────────────────────────────
  {
    const h = load(ALL_DOWN, { activeJobId: 'j0' });
    const limit = h.run('JOB_MIRROR_LIMIT');
    for (let i = 0; i < limit + 3; i++) h.run("writeJobMirror('rooms', 'j" + i + "', [{ id: 'r' }])");
    eq('no more than the limit are kept', h.run('readJobMirrorOrder()').length, limit);
    eq('the oldest is dropped', h.run("readJobMirror('rooms', 'j0')"), null);
    check('the newest is kept', h.run("readJobMirror('rooms', 'j" + (limit + 2) + "')") !== null);
    const leftovers = Object.keys(h.store).filter((k) => /^pe-job-j0-/.test(k));
    same('and its stored keys go with it, not just its place in the list', leftovers, []);
  }

  // ── 6. Re-opening a job keeps it, however old it is ──────────────────────
  {
    const h = load(ALL_DOWN, { activeJobId: 'j0' });
    const limit = h.run('JOB_MIRROR_LIMIT');
    h.run("writeJobMirror('rooms', 'old', [{ id: 'keep' }])");
    for (let i = 0; i < limit - 1; i++) h.run("writeJobMirror('rooms', 'j" + i + "', [{ id: 'r' }])");
    h.run("writeJobMirror('rooms', 'old', [{ id: 'keep' }])");   // opened again
    for (let i = 0; i < 3; i++) h.run("writeJobMirror('rooms', 'n" + i + "', [{ id: 'r' }])");
    check('a job re-opened recently survives the ones that came before it',
      h.run("readJobMirror('rooms', 'old')") !== null, h.run('JSON.stringify(readJobMirrorOrder())'));
  }

  // ── 7. A full localStorage must not lose the write ───────────────────────
  {
    const storage = {};
    for (let i = 0; i < 6; i++) storage['pe-job-j' + i + '-rooms'] = '[{"id":"r"}]';
    storage['pe-job-mirror-order'] = JSON.stringify(['j0', 'j1', 'j2', 'j3', 'j4', 'j5']);
    const h = load(ALL_DOWN, { activeJobId: 'jobNew', storage, quotaAfter: 7 });
    h.run("writeJobMirror('rooms', 'jobNew', [{ id: 'new' }])");
    check('the write lands after older copies are dropped to make room',
      JSON.stringify(h.run("readJobMirror('rooms', 'jobNew')")) === '[{"id":"new"}]',
      JSON.stringify(h.run("readJobMirror('rooms', 'jobNew')")));
  }
  {
    // And when there is nothing left to drop it must not throw -- losing an
    // offline copy is survivable, an exception out of saveRooms() is not.
    const h = load(ALL_DOWN, { activeJobId: 'solo', quotaAfter: 0 });
    let threw = false;
    try { h.run("writeJobMirror('rooms', 'solo', [{ id: 'r' }])"); } catch (e) { threw = true; }
    check('a localStorage that cannot be written to at all is survived, not thrown', !threw);
  }

  // ── 8. Deleting a job takes its copy with it ─────────────────────────────
  {
    const h = load(ALL_DOWN, { activeJobId: 'jobA', storage: phoneWithBothJobs() });
    h.run("dropJobMirror('jobB')");
    eq('the copy is gone', h.run("readJobMirror('rooms', 'jobB')"), null);
    eq('and so is its place in the list', h.run("hasJobMirror('jobB')"), false);
    check('the other job is untouched', h.run("hasJobMirror('jobA')"));
  }

  // ── 9. A phone upgrading to this build gets a copy straight away ─────────
  {
    const h = load(ALL_DOWN, { activeJobId: 'jobA', storage: {
      'pe-active-job-id': 'jobA',
      'pe-rooms': JSON.stringify(ROOMS_A),
      'pe-colours': JSON.stringify([{ number: 1 }]),
    }});
    eq('it starts with no per-job copy', h.run("hasJobMirror('jobA')"), false);
    h.run("seedJobMirrorFromLegacy('jobA')");
    same('the job in hand is seeded from the old single-job keys',
      h.run("readJobMirror('rooms', 'jobA')"), ROOMS_A);
    same('for every collection that had one', h.run("readJobMirror('colours', 'jobA')"), [{ number: 1 }]);
    same('and a collection with no old key reads as empty, not missing',
      h.run("readJobMirror('extitems', 'jobA')"), []);
  }
  {
    // Seeding must never overwrite a copy that is already there -- the pe-*
    // keys are the ACTIVE job's, and on a later launch that may not be this one.
    const h = load(ALL_DOWN, { activeJobId: 'jobB', storage: phoneWithBothJobs() });
    h.run("seedJobMirrorFromLegacy('jobB')");
    same('an existing copy is left alone', h.run("readJobMirror('rooms', 'jobB')"), ROOMS_B);
  }

  // ── 10. A brand-new job is empty, and known to be ────────────────────────
  {
    const h = load(ALL_DOWN, { activeJobId: 'jobA', storage: phoneWithBothJobs(),
      jobs: TWO_JOBS.concat([{ id: 'jobNew', name: 'New house' }]) });
    h.run("writeJobMirrorAll('jobNew', null)");
    eq('the phone knows the job exists', h.run("hasJobMirror('jobNew')"), true);
    same('and that it has nothing in it', h.run("readJobMirror('rooms', 'jobNew')"), []);
    const ok = await h.run("switchJob('jobNew')");
    eq('so a job created with no signal can be switched to', ok, true);
    same('and opens empty, as it should', h.box.rooms, []);
  }

  // ── 11. Tapping the job you are already on still goes somewhere ─────────
  {
    // The three call sites gate their follow-on navigation on the return
    // value now, so "already there" has to answer TRUE rather than fall off
    // the end of the function.
    const h = load(ALL_DOWN, { activeJobId: 'jobA', jobs: TWO_JOBS, storage: phoneWithBothJobs() });
    eq('switching to the job already open reports success', await h.run("switchJob('jobA')"), true);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  pass.forEach((n) => console.log('  ok   ' + n));
  fail.forEach((n) => console.log('  FAIL ' + n));
  console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
