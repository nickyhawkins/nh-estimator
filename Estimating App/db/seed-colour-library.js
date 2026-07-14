// One-off seed for the colour_library table (see FEATURES.md — Colour
// reference library). Run once after db/setup.sql has created the table:
//   node db/seed-colour-library.js
// Safe to re-run: ON CONFLICT (name, brand) DO NOTHING.
const fs = require('fs');
const path = require('path');
const db = require('../db');

async function seed() {
  const entries = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'colour-library-seed.json'), 'utf8')
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
  console.log(`Seeded ${inserted} of ${entries.length} colour_library entries (rest already present).`);
  await db.pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
