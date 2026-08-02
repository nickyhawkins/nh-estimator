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
//   3. colour library seed     — ~620 trade colours, skips existing rows
//
// Needs DATABASE_URL. See docs/NEW_INSTANCE.md for the full new-customer
// runbook this belongs to.

const fs = require('fs');
const path = require('path');
const db = require('../db');

const ROOT = path.join(__dirname, '..');

async function runSqlFile(rel) {
  const sql = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  await db.query(sql);
  console.log('applied ' + rel);
}

async function seedColours() {
  const entries = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'db', 'colour-library-seed.json'), 'utf8')
  );
  let inserted = 0;
  for (const { name, brand, code } of entries) {
    const result = await db.query(
      `INSERT INTO colour_library (name, brand, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (name, brand) DO NOTHING`,
      [name, brand, code || '']
    );
    if (result.rowCount > 0) inserted++;
  }
  console.log(`colour library: ${inserted} of ${entries.length} seeded (rest already present)`);
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
