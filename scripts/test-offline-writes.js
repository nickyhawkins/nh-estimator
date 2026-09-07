#!/usr/bin/env node
'use strict';

// ── Regression test: a write made in a dead spot still reaches the queue ────
//
// The offline write queue (v2.5.0) is built entirely on fetch() REJECTING:
// every helper queues from a catch block. That assumption holds in airplane
// mode and nowhere else. A phone in a dead spot on site has a bar of signal
// and no throughput -- navigator.onLine is true, the connection opens, and
// the request then neither resolves nor rejects for as long as the OS allows.
// In that state the catch never ran, so:
//
//   · the write was never queued -- an On Site material or labour entry
//     logged there reached neither the server nor the queue, which is the one
//     thing the queue exists to prevent;
//   · pendingWrites stayed raised, so the sync dot sat on amber "Saving…"
//     with nothing in flight;
//   · initApp's sync block hung on its first request, so updateSyncStatus(),
//     flushOfflineQueue() and flushPendingSnapshots() at its foot never ran --
//     writes queued in the LAST dead spot weren't retried on this launch.
//
// So requests now carry a deadline (netFetch), and a deadline abort has to
// count as a dropped connection everywhere a dropped connection already did
// (isNetworkFailure). Held here, along with the two job helpers that used to
// be a bare `await fetch(...)` -- so a job could not be STARTED off-signal at
// all, which is where every measured room has to go.
//
// Pure node against the real source: the functions are extracted out of
// public/index.html by name and evaluated with stubs, the same shape as
// scripts/test-scope-text.js. No browser, no server, no database.
//
// USAGE
//   node scripts/test-offline-writes.js
//   npm run test:offline-writes

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const pass = [], fail = [];
const check = (name, ok, detail) =>
  (ok ? pass : fail).push(name + (!ok && detail !== undefined ? '\n      ' + detail : ''));
const eq = (name, got, want) =>
  check(name, got === want, 'got:  ' + JSON.stringify(got) + '\n      want: ' + JSON.stringify(want));

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

const FNS = ['netFetch', 'isNetworkFailure', 'queueOfflineWrite', 'hasQueuedWrite',
             'persistOfflineQueue', 'apiPut', 'createJob', 'deleteJob'];

// ── Harness ────────────────────────────────────────────────────────────────
// `route` stands in for the network: return a response, throw (a dropped
// connection), or return 'HANG' (a dead spot -- a promise that never settles,
// but which an abort signal can still cut short).
function load(route) {
  const store = {};
  const calls = { begin: 0, end: 0, flushes: 0, switched: null };
  const sandbox = {
    console,
    setTimeout, clearTimeout, Promise, JSON, Date, Error, TypeError,
    AbortController,
    // The pieces of app state the extracted functions close over.
    offlineQueue: [],
    serverAvailable: true,
    jobs: [],
    activeJobId: null,
    pendingWrites: 0,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    updateSyncStatus: () => {},
    beginWrite: () => { sandbox.pendingWrites++; calls.begin++; },
    endWrite: () => { sandbox.pendingWrites--; calls.end++; },
    flushOfflineQueue: () => { calls.flushes++; },
    apiAuthExpired: () => false,
    uid: (() => { let n = 0; return () => 'job' + (++n); })(),
    switchJob: async (id) => { calls.switched = id; },
    renderJobs: () => {},
    loadActiveJobData: async () => {},
    confirm: () => true,
    fetch: (input, opts) => new Promise((resolve, reject) => {
      const r = route(typeof input === 'string' ? input : input.url, opts);
      if (r === 'HANG') {
        // A real hung request is still abortable -- that is the whole point.
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
        return;
      }
      if (r instanceof Error) return reject(r);
      resolve(r);
    }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(FNS.map(extractFn).join('\n'), sandbox);
  // Deadlines short enough to test in real time; the shipped values are
  // asserted separately below.
  vm.runInContext('var NET_READ_TIMEOUT_MS = 60, NET_WRITE_TIMEOUT_MS = 60;', sandbox);
  return { sandbox, calls, run: (code) => vm.runInContext(code, sandbox) };
}

const ok = () => ({ ok: true, status: 200, json: async () => ({}) });

(async () => {
  // ── 1. The shipped deadlines are real numbers, and reads give up first ───
  {
    const read = /var NET_READ_TIMEOUT_MS = (\d+);/.exec(SRC);
    const write = /var NET_WRITE_TIMEOUT_MS = (\d+);/.exec(SRC);
    check('a read deadline is set', !!read && +read[1] > 0, String(read && read[1]));
    check('a write deadline is set', !!write && +write[1] > 0, String(write && write[1]));
    // Reads are re-issued cheaply on the next launch; a write cut short means
    // a needless queue-and-retry of a payload that was actually going through.
    check('and a write is given longer than a read', +write[1] > +read[1],
      read[1] + ' read vs ' + write[1] + ' write');
  }

  // ── 2. netFetch turns a hang into a rejection the app already understands ─
  {
    const h = load(() => 'HANG');
    let caught = null;
    try { await h.run("netFetch('/api/rooms', undefined, 60)"); } catch (e) { caught = e; }
    check('a request that hangs is aborted rather than left pending', !!caught, String(caught));
    eq('and rejects as an AbortError', caught && caught.name, 'AbortError');
    check('which isNetworkFailure reads as a dropped connection',
      h.run('isNetworkFailure')(caught));
  }
  {
    const h = load(() => ok());
    check('a real dropped connection (TypeError) is a network failure',
      h.run('isNetworkFailure')(new TypeError('Failed to fetch')));
    check('but a server that answered and refused is NOT',
      !h.run('isNetworkFailure')(new Error('HTTP 500')));
  }

  // ── 3. A write into a dead spot is queued, and the dot is not left stuck ─
  {
    const h = load(() => 'HANG');
    await h.run("apiPut('/api/rooms?job_id=j1', [{ id: 'r1' }])");
    eq('a hung write is queued rather than lost', h.sandbox.offlineQueue.length, 1);
    eq('under the method and path it was made with', h.sandbox.offlineQueue[0].path, '/api/rooms?job_id=j1');
    eq('the server is marked unreachable', h.sandbox.serverAvailable, false);
    eq('and pendingWrites comes back down, so the dot cannot stick on "Saving…"',
      h.sandbox.pendingWrites, 0);
    check('the queue survives the app being closed in the dead spot',
      JSON.parse(h.sandbox.localStorage.getItem('pe-offline-queue')).length === 1);
  }

  // ── 4. A job can be STARTED with no signal ───────────────────────────────
  {
    const h = load(() => new TypeError('Failed to fetch'));
    await h.run("createJob('14 Rose Terrace')");
    eq('the job exists on the phone the moment it is named', h.sandbox.jobs.length, 1);
    eq('and is the one the app switches to', h.calls.switched, h.sandbox.jobs[0].id);
    eq('its POST is queued for reconnect', h.sandbox.offlineQueue.length, 1);
    eq('as a POST to /api/jobs', h.sandbox.offlineQueue[0].method + ' ' + h.sandbox.offlineQueue[0].path,
      'POST /api/jobs');
    eq('carrying the same client-generated id the phone is already using',
      h.sandbox.offlineQueue[0].body.id, h.sandbox.jobs[0].id);
    check('and the jobs list is mirrored to localStorage',
      JSON.parse(h.sandbox.localStorage.getItem('pe-jobs')).length === 1);
  }
  {
    // Same for a hung request, not just a cleanly dropped one.
    const h = load(() => 'HANG');
    await h.run("createJob('Dead spot house')");
    eq('a job started where requests hang is kept too', h.sandbox.jobs.length, 1);
    eq('and queued', h.sandbox.offlineQueue.length, 1);
  }

  // ── 5. Two jobs in one dead spot must not collapse into one ──────────────
  {
    const h = load(() => new TypeError('Failed to fetch'));
    await h.run("createJob('First house')");
    await h.run("createJob('Second house')");
    eq('both jobs are on the phone', h.sandbox.jobs.length, 2);
    eq('and BOTH POSTs are queued -- same method, same path, different job',
      h.sandbox.offlineQueue.length, 2);
    const names = h.sandbox.offlineQueue.map((q) => q.body.name).sort().join('|');
    eq('with neither overwritten by the other', names, 'First house|Second house');
  }

  // ── 6. Last-write-wins still applies where it should ─────────────────────
  {
    const h = load(() => new TypeError('Failed to fetch'));
    await h.run("apiPut('/api/rooms?job_id=j1', [{ id: 'r1' }])");
    // The second edit to the same collection replaces the first: the queue
    // has always been last-write-wins for the four collection PUTs, and the
    // per-job key added for jobs must not have changed that.
    h.run("queueOfflineWrite('PUT', '/api/rooms?job_id=j1', [{ id: 'r1' }, { id: 'r2' }])");
    eq('a newer PUT to the same collection replaces the older one',
      h.sandbox.offlineQueue.length, 1);
    eq('and it is the newer body that survives', h.sandbox.offlineQueue[0].body.length, 2);
  }
  {
    // Entries written by an older build have no key field and must still
    // dedupe the old way rather than stacking up forever.
    const h = load(() => ok());
    h.sandbox.offlineQueue = [{ method: 'PUT', path: '/api/colours?job_id=j1', body: ['old'], at: 'x' }];
    h.run("queueOfflineWrite('PUT', '/api/colours?job_id=j1', ['new'])");
    eq('a keyless entry left by an older build is still replaced, not stacked',
      h.sandbox.offlineQueue.length, 1);
    eq('by the newer body', h.sandbox.offlineQueue[0].body[0], 'new');
  }

  // ── 7. Deleting a job off-signal, and create-then-delete netting out ─────
  {
    const h = load(() => new TypeError('Failed to fetch'));
    await h.run("createJob('Wrong address')");
    const id = h.sandbox.jobs[0].id;
    await h.run("deleteJob('" + id + "')");
    eq('the job is gone from the phone', h.sandbox.jobs.length, 0);
    eq('and both writes are queued, in the order they were made',
      h.sandbox.offlineQueue.map((q) => q.method).join(','), 'POST,DELETE');
    eq('the DELETE naming the job', h.sandbox.offlineQueue[1].path, '/api/jobs/' + id);
  }

  // ── 8. A server that ANSWERS and refuses is not a dead spot ──────────────
  {
    const h = load(() => new Error('something else entirely'));
    let threw = false;
    try { await h.run("createJob('Refused')"); } catch (e) { threw = true; }
    check('a failure that is not a network failure still surfaces', threw);
    eq('and is not quietly queued as if it were offline', h.sandbox.offlineQueue.length, 0);
  }
  {
    const h = load(() => ({ ok: false, status: 500, json: async () => ({}) }));
    await h.run("createJob('Server said no')");
    // apiPut/createJob have never inspected response.ok -- the server ANSWERED,
    // so there is nothing to retry blindly. Recorded here so the distinction
    // between "no signal" and "the server refused" stays deliberate.
    eq('a 500 is not queued for replay -- the server answered', h.sandbox.offlineQueue.length, 0);
    eq('and the job is still created locally', h.sandbox.jobs.length, 1);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  pass.forEach((n) => console.log('  ok   ' + n));
  fail.forEach((n) => console.log('  FAIL ' + n));
  console.log('\n' + pass.length + ' passed, ' + fail.length + ' failed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
