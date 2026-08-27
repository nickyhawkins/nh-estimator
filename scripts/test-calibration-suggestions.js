#!/usr/bin/env node
'use strict';

// ── Regression test: calibration suggestions ────────────────────────────────
//
// Drives the REAL GET /api/calibration-suggestions route against a real
// database, and proves the four rules the figures depend on
// (CALIBRATION_SPEC.md Phase C):
//
//   1. A finished job with NO days logged is EXCLUDED, not counted as zero
//      days — the difference between "no data" and "took no time" is the
//      whole point of the feature.
//   2. Only sprayed jobs feed the wall-coverage figure, and only the wall
//      estimate's own item codes — a tin of ceiling white bought on the same
//      job must not land in it.
//   3. A job with no on-site estimate (imported from Xero, or accepted
//      before acceptedSnapshot shipped) is reported, never silently folded
//      into the days ratio as an estimate of zero.
//   4. The suggested settings are derived, not passed through: bufferPct is
//      the overrun, and the spray uplift multiplies THROUGH the current one
//      (the estimate already had it baked in).
//
// PREREQUISITES — this is not part of `npm start` and needs two things:
//   1. A Postgres database with db/setup.sql run against it (a scratch one:
//      this seeds and deletes its own fixture jobs).
//   2. The app running against that database
//      (DATABASE_URL=... PORT=3199 npm start).
//
// USAGE
//   TEST_BASE_URL=http://localhost:3199 DATABASE_URL=postgres://... \
//     node scripts/test-calibration-suggestions.js
//
// Fixture job ids are all prefixed `calib-test-` and cleared first, so it is
// safe to re-run and safe alongside real data.

const { Client } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3199';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required — point it at a scratch database, not production.'); process.exit(2); }

const PREFIX = 'calib-test-';
const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (detail ? ' — ' + detail : ''));
const near = (a, b, tol) => a != null && Math.abs(a - b) <= (tol == null ? 0.0001 : tol);

// The fixture. Six jobs, each one a rule:
//
//   A  invoiced, sprayed, 5 est days / 6 logged. Wall estimate 3+2 tins,
//      actuals 4+2 of the SAME codes, plus 5 tins of a ceiling code that
//      must not count. The ordinary case, and the newest.
//   B  completed, NOT sprayed, 4 est / 5 logged. Its wall actuals overrun
//      hugely — and must not reach the sprayed-coverage figure at all.
//   D  completed, no acceptedSnapshot estimate (Xero import), 2 logged.
//   E  completed, sprayed, wall paint estimated but NO actuals logged.
//   C  invoiced with a fat estimate and NO labour rows at all.
//   F  accepted (not finished) with days logged.
//
// Expected: A, B, D, E included; C and F invisible.
const JOBS = {
  A: { id: PREFIX + 'a', name: 'A — sprayed, ran over', status: 'invoiced',  finished: { invoicedAt: '2026-08-20T10:00:00.000Z', completedAt: '2026-08-19T10:00:00.000Z' }, estOnSiteDays: 5 },
  B: { id: PREFIX + 'b', name: 'B — rolled',            status: 'completed', finished: { completedAt: '2026-08-18T10:00:00.000Z' }, estOnSiteDays: 4 },
  D: { id: PREFIX + 'd', name: 'D — Xero import',       status: 'completed', finished: { completedAt: '2026-08-15T10:00:00.000Z' }, estOnSiteDays: null },
  E: { id: PREFIX + 'e', name: 'E — sprayed, untracked', status: 'completed', finished: { completedAt: '2026-08-12T10:00:00.000Z' }, estOnSiteDays: 2 },
  C: { id: PREFIX + 'c', name: 'C — no days logged',    status: 'invoiced',  finished: { invoicedAt: '2026-08-21T10:00:00.000Z' }, estOnSiteDays: 99 },
  F: { id: PREFIX + 'f', name: 'F — still running',     status: 'accepted',  finished: {}, estOnSiteDays: 7 },
};

async function seed(db) {
  const ids = Object.values(JOBS).map(j => j.id);
  for (const table of ['labour_log', 'material_actuals', 'materials_snapshot', 'rooms']) {
    await db.query(`DELETE FROM ${table} WHERE job_id = ANY($1)`, [ids]);
  }
  await db.query('DELETE FROM jobs WHERE id = ANY($1)', [ids]);

  for (const j of Object.values(JOBS)) {
    const data = Object.assign({ status: j.status }, j.finished);
    // estOnSiteDays null is the Xero-import shape: the snapshot exists, the
    // estimate inside it doesn't (the app never estimated that job).
    data.acceptedSnapshot = { estOnSiteDays: j.estOnSiteDays, estWorkingDays: j.estOnSiteDays };
    await db.query('INSERT INTO jobs (id, name, data) VALUES ($1, $2, $3::jsonb)', [j.id, j.name, JSON.stringify(data)]);
  }

  const room = (jobId, n, spray) => db.query(
    'INSERT INTO rooms (id, job_id, name, data) VALUES ($1, $2, $3, $4::jsonb)',
    [jobId + '-r' + n, jobId, 'Room ' + n, JSON.stringify({ name: 'Room ' + n, l: 4, w: 3, h: 2.4, sprayWalls: spray })]);
  await room(JOBS.A.id, 1, true);
  await room(JOBS.A.id, 2, false);      // one sprayed room is enough
  await room(JOBS.B.id, 1, false);
  await room(JOBS.E.id, 1, true);

  const day = (jobId, date, days) => db.query(
    'INSERT INTO labour_log (id, job_id, work_date, days) VALUES ($1, $2, $3, $4)',
    [jobId + '-l' + date, jobId, date, days]);
  // A: 6 days against 5 estimated.
  await day(JOBS.A.id, '2026-08-10', 1); await day(JOBS.A.id, '2026-08-11', 1);
  await day(JOBS.A.id, '2026-08-12', 2); await day(JOBS.A.id, '2026-08-13', 1);
  await day(JOBS.A.id, '2026-08-14', 1);
  // B: 5 against 4.  D: 2, no estimate.  E: 2 against 2.
  await day(JOBS.B.id, '2026-08-10', 2.5); await day(JOBS.B.id, '2026-08-11', 2.5);
  await day(JOBS.D.id, '2026-08-10', 1); await day(JOBS.D.id, '2026-08-11', 1);
  await day(JOBS.E.id, '2026-08-10', 1); await day(JOBS.E.id, '2026-08-11', 1);
  // F is not finished, so its days must never surface.
  await day(JOBS.F.id, '2026-08-10', 4);
  // C deliberately gets none.

  const est = (jobId, n, line) => db.query(
    'INSERT INTO materials_snapshot (id, job_id, data) VALUES ($1, $2, $3::jsonb)',
    [jobId + '-m' + n, jobId, JSON.stringify(line)]);
  await est(JOBS.A.id, 1, { itemCode: 'W1', description: 'Wall paint 5ltr', quantity: 3, role: 'wall', source: 'estimate' });
  await est(JOBS.A.id, 2, { itemCode: 'W2', description: 'Wall paint 2.5ltr', quantity: 2, role: 'wall', source: 'estimate' });
  await est(JOBS.A.id, 3, { itemCode: 'C1', description: 'Ceiling white 10ltr', quantity: 2, role: 'ceiling', source: 'estimate' });
  await est(JOBS.A.id, 4, { itemCode: 'W9', description: 'Extra wall tin, added by hand', quantity: 9, source: 'manual', custom: true });
  await est(JOBS.B.id, 1, { itemCode: 'W1', description: 'Wall paint 5ltr', quantity: 4, role: 'wall', source: 'estimate' });
  await est(JOBS.E.id, 1, { itemCode: 'W1', description: 'Wall paint 5ltr', quantity: 3, role: 'wall', source: 'estimate' });

  const act = (jobId, n, code, qty) => db.query(
    'INSERT INTO material_actuals (id, job_id, item_code, description, actual_quantity) VALUES ($1, $2, $3, $4, $5)',
    [jobId + '-a' + n, jobId, code, code + ' as used', qty]);
  await act(JOBS.A.id, 1, 'W1', 4);
  await act(JOBS.A.id, 2, 'W2', 2);
  await act(JOBS.A.id, 3, 'C1', 5);     // ceiling — must not reach the wall figure
  await act(JOBS.B.id, 1, 'W1', 9);     // rolled job — must not reach it either
  // E: nothing. Untracked materials, not "used no paint".
  await db.query('INSERT INTO material_actuals (id, job_id, item_code, description, actual_quantity) VALUES ($1, $2, NULL, $3, $4)',
    [JOBS.A.id + '-aft', JOBS.A.id, 'Free-text: filler', 3]);

  // Settings the suggestions are measured against.
  await db.query(`UPDATE settings SET data = data || '{"bufferPct":0,"sprayUpliftPct":30}'::jsonb WHERE id = 1`);
}

async function get(n) {
  const r = await fetch(BASE + '/api/calibration-suggestions' + (n == null ? '' : '?n=' + n));
  if (!r.ok) throw new Error('GET /api/calibration-suggestions?n=' + n + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await seed(db);

  // ── The default sample ──────────────────────────────────────────────────
  const all = await get(8);
  const ids = all.jobs.map(j => j.id);
  const ours = ids.filter(id => id.startsWith(PREFIX));

  check('n defaults to 8 and is echoed', all.n === 8, 'got ' + all.n);
  check('finished jobs with days logged are included',
    ['a', 'b', 'd', 'e'].every(k => ours.includes(PREFIX + k)), ours.join(', '));
  check('a finished job with NO labour rows is excluded entirely',
    !ids.includes(JOBS.C.id));
  check('an unfinished job is excluded even with days logged',
    !ids.includes(JOBS.F.id));
  check('ordered most recently finished first',
    ours[0] === JOBS.A.id && ours.indexOf(JOBS.B.id) < ours.indexOf(JOBS.D.id), ours.join(' > '));

  const a = all.jobs.find(j => j.id === JOBS.A.id) || {};
  check('per-job days come from the labour log', a.actualDays === 6, String(a.actualDays));
  check('per-job estimate comes from acceptedSnapshot', a.estOnSiteDays === 5, String(a.estOnSiteDays));
  check('a job with one sprayed room reads as sprayed', a.sprayedWalls === true);
  check('a rolled job does not', (all.jobs.find(j => j.id === JOBS.B.id) || {}).sprayedWalls === false);

  // ── Days ratio ──────────────────────────────────────────────────────────
  // A 5/6, B 4/5, E 2/2 → 11 estimated, 13 logged. D has no estimate.
  const d = all.days;
  check('days sample counts only jobs with an estimate', d.sample.jobs === 3, String(d.sample.jobs));
  check('days sample reports the estimate-less job rather than dropping it',
    d.sample.jobsWithoutEstimate === 1, String(d.sample.jobsWithoutEstimate));
  check('estimated days summed from acceptedSnapshot', d.sample.estimatedDays === 11, String(d.sample.estimatedDays));
  check('actual days summed from the labour log (D excluded, C and F invisible)',
    d.sample.actualDays === 13, String(d.sample.actualDays));
  check('days ratio', near(d.ratio, 13 / 11, 0.0002), String(d.ratio));
  check('overrun %', near(d.overrunPct, 18.2, 0.05), String(d.overrunPct));
  check('suggested bufferPct is the overrun, rounded', d.setting.suggested === 18, String(d.setting.suggested));
  check('current bufferPct read from settings', d.setting.current === 0, String(d.setting.current));
  check('days suggestion targets bufferPct', d.setting.key === 'bufferPct', d.setting.key);

  // ── Sprayed wall coverage ───────────────────────────────────────────────
  // Only A counts: E is sprayed but untracked, B is tracked but rolled.
  const w = all.wallCoverage;
  check('coverage counts sprayed jobs only', w.sample.sprayedJobs === 2, String(w.sample.sprayedJobs));
  check('a sprayed job with no wall actuals is excluded, and reported',
    w.sample.jobs === 1 && w.sample.jobsWithoutActuals === 1,
    w.sample.jobs + ' in, ' + w.sample.jobsWithoutActuals + ' untracked');
  check('estimated wall quantity is the wall roles only (manual line ignored)',
    w.sample.estimatedQuantity === 5, String(w.sample.estimatedQuantity));
  check('actual wall quantity matches on item code (ceiling tins ignored)',
    w.sample.actualQuantity === 6, String(w.sample.actualQuantity));
  check('free-text actuals never reach the coverage figure',
    !w.sample.items.some(i => i.itemCode == null));
  check('the per-code working is returned',
    w.sample.items.length === 2 && w.sample.items[0].itemCode === 'W1'
      && w.sample.items[0].estimated === 3 && w.sample.items[0].actual === 4,
    JSON.stringify(w.sample.items));
  check('coverage ratio', near(w.ratio, 1.2, 0.0002), String(w.ratio));
  check('over %', near(w.overPct, 20, 0.05), String(w.overPct));
  check('current uplift read from settings', w.setting.current === 30, String(w.setting.current));
  // (1 + 30/100) × 1.2 − 1 = 0.56
  check('suggested uplift multiplies THROUGH the current one, not replacing it',
    w.setting.suggested === 56, String(w.setting.suggested));
  check('coverage suggestion targets sprayUpliftPct (cwSpray no longer exists)',
    w.setting.key === 'sprayUpliftPct', w.setting.key);

  // ── N is honoured ───────────────────────────────────────────────────────
  const one = await get(1);
  check('n=1 takes the single most recent finished job', one.jobs.length === 1 && one.jobs[0].id === JOBS.A.id,
    JSON.stringify(one.jobs.map(j => j.id)));
  check('n=1 days ratio is that job alone', one.days.sample.estimatedDays === 5 && one.days.sample.actualDays === 6,
    one.days.sample.estimatedDays + ' / ' + one.days.sample.actualDays);
  check('n=1 suggested buffer', one.days.setting.suggested === 20, String(one.days.setting.suggested));
  check('n=1 coverage still resolves from that job', near(one.wallCoverage.ratio, 1.2, 0.0002), String(one.wallCoverage.ratio));
  const bad = await get('banana');
  check('a junk n falls back to the default', bad.n === 8, String(bad.n));
  const huge = await get(9999);
  check('n is capped', huge.n === 50, String(huge.n));

  // ── No sprayed jobs at all ──────────────────────────────────────────────
  // The spec's explicit case: say so for that suggestion, don't compute a
  // ratio and don't take the whole card down with it.
  await db.query(`UPDATE rooms SET data = data - 'sprayWalls' WHERE job_id = ANY($1)`, [[JOBS.A.id, JOBS.E.id]]);
  const noSpray = await get(8);
  check('with no sprayed jobs, coverage reports unavailable', noSpray.wallCoverage.available === false);
  check('...with a reason, not a ratio',
    noSpray.wallCoverage.ratio === null && /sprayed/.test(noSpray.wallCoverage.reason || ''), String(noSpray.wallCoverage.reason));
  check('...and no suggested value to adopt', noSpray.wallCoverage.setting.suggested === null);
  check('...while the days suggestion is unaffected', noSpray.days.available === true && noSpray.days.setting.suggested === 18,
    String(noSpray.days.setting.suggested));

  // ── Under, not over ─────────────────────────────────────────────────────
  // Coming in under estimate can't mean a negative buffer.
  await db.query('UPDATE labour_log SET days = 0.5 WHERE job_id = ANY($1)', [[JOBS.A.id, JOBS.B.id, JOBS.E.id]]);
  const under = await get(8);
  check('jobs under estimate give a ratio below 1', under.days.ratio < 1, String(under.days.ratio));
  check('...and a floored bufferPct of 0, never negative', under.days.setting.suggested === 0, String(under.days.setting.suggested));

  // ── Nothing to say ──────────────────────────────────────────────────────
  await db.query('DELETE FROM labour_log WHERE job_id = ANY($1)', [Object.values(JOBS).map(j => j.id)]);
  const empty = await get(8);
  check('with no logged jobs the route still answers 200 with both flags down',
    empty.jobs.filter(j => j.id.startsWith(PREFIX)).length === 0
      && empty.days.available === false && empty.wallCoverage.available === false);
  check('...and says why', /no finished jobs with days logged/.test(empty.days.reason || ''), String(empty.days.reason));

  // Cleanup: leave the database as it was found.
  const ourIds = Object.values(JOBS).map(j => j.id);
  for (const table of ['labour_log', 'material_actuals', 'materials_snapshot', 'rooms']) {
    await db.query(`DELETE FROM ${table} WHERE job_id = ANY($1)`, [ourIds]);
  }
  await db.query('DELETE FROM jobs WHERE id = ANY($1)', [ourIds]);
  await db.end();

  console.log('\n  ' + pass.length + ' passed');
  pass.forEach(p => console.log('   ✓ ' + p));
  if (fail.length) {
    console.log('\n  ' + fail.length + ' FAILED');
    fail.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
  }
  console.log('\n  All calibration checks passed.\n');
})().catch(err => { console.error(err); process.exit(1); });
