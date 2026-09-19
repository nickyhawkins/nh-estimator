// Colour library top-up.
//
// The seed's home is `npm run provision`, which render.yaml runs as the
// preDeployCommand. That covers an instance created from the blueprint. It
// does NOT cover an instance whose service predates the preDeployCommand or
// was configured by hand, and the failure there is silent in the worst way:
// the code deploys, the version number goes up, and the colours the release
// was ABOUT are missing, with nothing on the phone to say why -- which is
// exactly how v2.69.0 could look shipped and not be.
//
// So the server tops the table up itself on boot. One COUNT; if the table
// already holds at least as many rows as the seed file, nothing else runs --
// and it can only ever be short, since colours saved from the app add rows.
// Idempotent by the same ON CONFLICT (name, brand) the seed scripts use, so
// a colour anyone edited by hand keeps its own code.
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'db', 'colour-library-seed.json');

function readSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

// Returns what it did, so a caller (and the test) can tell "already complete"
// from "topped up" without reading the log.
async function topUpColourLibrary(db, log) {
  const entries = readSeed();
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM colour_library');
  const before = rows[0].n;
  if (before >= entries.length) {
    return { checked: entries.length, before: before, inserted: 0, ranSeed: false };
  }
  let inserted = 0;
  for (const { name, brand, code } of entries) {
    const r = await db.query(
      `INSERT INTO colour_library (name, brand, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (name, brand) DO NOTHING`,
      [name, brand, code || '']
    );
    if (r.rowCount > 0) inserted++;
  }
  if (log) log(`colour library topped up: ${before} rows -> ${before + inserted} (seed holds ${entries.length})`);
  return { checked: entries.length, before: before, inserted: inserted, ranSeed: true };
}

module.exports = { topUpColourLibrary, readSeed, SEED_PATH };
