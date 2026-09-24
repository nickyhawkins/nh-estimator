#!/usr/bin/env node
'use strict';

// ── Backup round trip: suppliers and supplier orders ───────────────────────
//
// Held here, against a real Postgres through the real routes:
//
//   1. Export carries suppliers[] and supplierOrders[] (top level: suppliers
//      are global and an order can span jobs), with each order's jobs and
//      per-job lines.
//   2. Import brings suppliers back under their own ids, and leaves a supplier
//      that's already there exactly as it is.
//   3. Every imported job is a fresh copy under a new id, so each order is
//      copied too, re-pointed at those copies: GET /supplier-orders on an
//      imported job returns its history, lines and all, and the "ordered"
//      status still resolves (job id + product key).
//   4. Only the part of an order whose job is in the file comes across; an
//      order with none of its jobs in the file is skipped.
//   5. A backup file from before this existed (no suppliers/orders keys)
//      still imports.
//
// PREREQUISITES: DATABASE_URL pointing at a SCRATCH database (db/setup.sql
// run, or not -- the supplier tables create themselves). The router is
// mounted in-process; no server needs to be running. Fixture rows are all
// prefixed `supbk-test-` and cleared before and after, and the backup is
// filtered to the fixture jobs before import, so real data is never copied.
//
// USAGE
//   DATABASE_URL=postgres://... node scripts/test-supplier-backup.js
//   npm run test:supplier-backup

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required — point it at a scratch database, not production.');
  process.exit(2);
}

const express = require('express');
const db = require('../db');

const P = 'supbk-test-';
const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function cleanup() {
  const jobs = await db.query(`SELECT id FROM jobs WHERE name LIKE $1`, [P + '%']);
  for (const j of jobs.rows) await call('DELETE', '/jobs/' + j.id);
  await db.query(`DELETE FROM suppliers WHERE id LIKE $1`, [P + '%']).catch(() => {});
}

let base;
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}

(async () => {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', require('../routes/api'));
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = 'http://127.0.0.1:' + srv.address().port + '/api';
  try {
    await cleanup();

    // ── Fixture: two jobs, a supplier, a two-job order, a one-job order ─────
    await call('POST', '/jobs', { id: P + 'j1', name: P + 'Ermine Street' });
    await call('POST', '/jobs', { id: P + 'j2', name: P + 'Mill Lane' });
    await call('PUT', '/suppliers/' + P + 's1', { name: 'Brewers', email: 'orders@brewers.example', accountNumber: 'NH4471', branchName: 'Cambridge', branchAddress: 'Units 1-2' });
    await call('PUT', '/supplier-orders/' + P + 'o1', {
      supplierId: P + 's1', supplierName: 'Brewers', deliveryMethod: 'home', deliveryAddress: '1 Yard Road',
      deliveryNotes: 'Porch', requiredBy: '2026-10-02', bodyText: 'Hi Brewers,\r\n\r\n6 x Optiva', sentAt: '2026-09-24T09:00:00.000Z',
      jobIds: [P + 'j1', P + 'j2'],
      lines: [
        { lineNo: 0, productKey: 'code:OPT5', jobId: P + 'j1', description: 'Optiva 5 - Dead Salmon 3ltr', quantity: 3 },
        { lineNo: 0, productKey: 'code:OPT5', jobId: P + 'j2', description: 'Optiva 5 - Dead Salmon 3ltr', quantity: 3 },
        { lineNo: 1, description: 'Decorators caulk', quantity: 2, isExtra: true },
      ],
    });
    await call('PUT', '/supplier-orders/' + P + 'o2', {
      supplierId: P + 's1', supplierName: 'Brewers', deliveryMethod: 'collect', bodyText: 'Hi again', sentAt: '2026-09-25T09:00:00.000Z',
      jobIds: [P + 'j2'], lines: [{ lineNo: 0, productKey: 'code:SUN1', jobId: P + 'j2', description: 'Tape', quantity: 4 }],
    });

    // ── 1. Export ────────────────────────────────────────────────────────────
    const exp = (await call('GET', '/backup/export')).body;
    const sup = (exp.suppliers || []).find(s => s.id === P + 's1');
    eq('1. export carries the supplier', sup && [sup.name, sup.email, sup.accountNumber, sup.branchName, sup.branchAddress],
      ['Brewers', 'orders@brewers.example', 'NH4471', 'Cambridge', 'Units 1-2']);
    const o1 = (exp.supplierOrders || []).find(o => o.id === P + 'o1');
    eq('1. export carries the order with its jobs', o1 && o1.jobIds.slice().sort(), [P + 'j1', P + 'j2']);
    eq('1. and its per-job lines', o1 && o1.lines.map(l => [l.lineNo, l.productKey, l.jobId, l.quantity, l.isExtra]), [
      [0, 'code:OPT5', P + 'j1', 3, false], [0, 'code:OPT5', P + 'j2', 3, false], [1, null, null, 2, true],
    ]);
    eq('1. and its delivery details', o1 && [o1.deliveryMethod, o1.deliveryAddress, o1.deliveryNotes, o1.requiredBy, o1.bodyText],
      ['home', '1 Yard Road', 'Porch', '2026-10-02', 'Hi Brewers,\r\n\r\n6 x Optiva']);

    // The file, cut down to the fixture: only j1 in it, so o1 comes across
    // for j1 only and o2 (j2 only) is skipped.
    const file = {
      ...exp,
      jobs: exp.jobs.filter(e => e.job.id === P + 'j1'),
      colourLibrary: [],
      suppliers: exp.suppliers.filter(s => s.id.startsWith(P)),
      supplierOrders: exp.supplierOrders.filter(o => o.id.startsWith(P)),
    };

    // ── 2. Suppliers: existing one untouched ─────────────────────────────────
    await call('PUT', '/suppliers/' + P + 's1', { name: 'Brewers (edited)', email: 'new@brewers.example' });
    await db.query('DELETE FROM suppliers WHERE id = $1', [P + 's2']).catch(() => {});
    file.suppliers.push({ id: P + 's2', name: 'Johnstones', email: 'jdc@example.com' });
    const imp = await call('POST', '/backup/import', { backup: file });
    eq('import succeeds', imp.status, 200);
    eq('2. only the missing supplier is added', imp.body.suppliersAdded, 1);
    const sups = (await call('GET', '/suppliers')).body.filter(s => s.id.startsWith(P));
    eq('2. the existing supplier keeps its edits; the new one keeps its id', sups.map(s => [s.id, s.name]).sort(),
      [[P + 's1', 'Brewers (edited)'], [P + 's2', 'Johnstones']]);

    // ── 3/4. Orders re-pointed at the imported job ───────────────────────────
    eq('4. one order imported (the j2-only one skipped)', imp.body.supplierOrdersImported, 1);
    const newJob = (await db.query(`SELECT id FROM jobs WHERE name = $1`, [P + 'Ermine Street (imported)'])).rows[0];
    check('3. the job came back as a fresh copy', !!newJob && newJob.id !== P + 'j1');
    const hist = (await call('GET', '/supplier-orders?job_id=' + encodeURIComponent(newJob.id))).body;
    eq('3. the imported job has its order history', hist.length, 1);
    const h = hist[0] || {};
    check('3. under a new order id', h.id && h.id !== P + 'o1', h.id);
    eq('3. pointing only at the imported job', h.jobIds, [newJob.id]);
    eq('4. with only that job\'s lines (and the extra)', (h.lines || []).map(l => [l.lineNo, l.productKey, l.jobId === newJob.id, l.quantity, l.isExtra]), [
      [0, 'code:OPT5', true, 3, false], [1, null, false, 2, true],
    ]);
    eq('3. details and the email as sent intact', [h.supplierId, h.supplierName, h.deliveryMethod, h.requiredBy, h.sentAt, h.bodyText],
      [P + 's1', 'Brewers', 'home', '2026-10-02', '2026-09-24T09:00:00.000Z', 'Hi Brewers,\r\n\r\n6 x Optiva']);
    const origHist = (await call('GET', '/supplier-orders?job_id=' + P + 'j1')).body;
    eq('3. the original job\'s history is untouched', origHist.map(o => o.id), [P + 'o1']);

    // ── 5. An old backup file ────────────────────────────────────────────────
    const old = { ...file }; delete old.suppliers; delete old.supplierOrders;
    const impOld = await call('POST', '/backup/import', { backup: old });
    eq('5. a pre-suppliers backup still imports', [impOld.status, impOld.body.jobsImported, impOld.body.suppliersAdded, impOld.body.supplierOrdersImported], [200, 1, 0, 0]);
  } catch (e) {
    fail.push('threw: ' + (e && e.stack || e));
  } finally {
    await cleanup().catch(() => {});
    srv.close();
    await db.pool.end();
  }

  console.log('\n' + pass.length + ' passed');
  pass.forEach(n => console.log('  ✓ ' + n));
  if (fail.length) {
    console.log('\n' + fail.length + ' FAILED');
    fail.forEach(n => console.log('  ✗ ' + n));
    process.exit(1);
  }
  console.log('\nAll good.');
})();
