// Provision (or re-provision) this instance's database. Idempotent — every
// statement in the schema files is IF NOT EXISTS / ON CONFLICT guarded, so
// this is safe to run on every deploy (render.yaml runs it as the
// preDeployCommand) and on an existing database.
//
//   npm run provision
//
// What it does, in order:
//   1. db/setup.sql            — estimator schema (all instances)
//   2. db/setup-debt.sql       — ONLY when DEBT_APP_ENABLED=true (the
//                                owner's personal instance; contains
//                                personal seed data)
//   3. colour library seed     — ~3,400 trade colours: inserts what is
//                                missing, and corrects rows the seed has
//                                since renamed or de-coded
//
// Needs DATABASE_URL. See docs/NEW_INSTANCE.md for the full new-customer
// runbook this belongs to.

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { topUpColourLibrary } = require('../lib/colourLibrarySeed');

const ROOT = path.join(__dirname, '..');

async function runSqlFile(rel) {
  const sql = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  await db.query(sql);
  console.log('applied ' + rel);
}

// The seed is applied by the same function the server runs on boot, so the
// two paths cannot drift: it inserts what is missing, drops rows a rename has
// superseded, and clears codes the seed has dropped. See
// lib/colourLibrarySeed.js for why an insert-only seed was not enough.
async function seedColours() {
  const r = await topUpColourLibrary(db, null);
  if (!r.ranSeed) {
    console.log(`colour library: already in step (${r.before} rows, seed holds ${r.checked})`);
    return;
  }
  console.log(`colour library: ${r.inserted} added, ${r.removed} superseded row(s) removed,`
    + ` ${r.cleared} stale code(s) cleared (seed holds ${r.checked})`);
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await runSqlFile('db/setup.sql');
  if (process.env.DEBT_APP_ENABLED === 'true') {
    await runSqlFile('db/setup-debt.sql');
  } else {
    console.log('skipped db/setup-debt.sql (DEBT_APP_ENABLED not true)');
  }
  await seedColours();
  await db.pool.end();
  console.log('provision complete');
})().catch((err) => {
  console.error('Provision failed:', err.message);
  process.exit(1);
});
