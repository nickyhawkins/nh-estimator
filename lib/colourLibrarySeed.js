// Colour library seed, applied to the table.
//
// The seed's home is `npm run provision`, which render.yaml runs as the
// preDeployCommand. That covers an instance created from the blueprint. It
// does NOT cover an instance whose service predates the preDeployCommand or
// was configured by hand, and the failure there is silent in the worst way:
// the code deploys, the version number goes up, and the colours the release
// was ABOUT are missing, with nothing on the phone to say why -- which is
// exactly how v2.69.0 could look shipped and not be.
//
// So the server applies it itself on boot, and both paths run this one
// function.
//
// v2.69.2 did that with a COUNT and an insert loop: if the table held at
// least as many rows as the seed, stand down. That reading -- the seed can
// only ever GROW -- was true until v2.73.2 re-cased 1,709 Valspar names and
// blanked every Valspar code. An insert-only seed under
// ON CONFLICT (name, brand) DO NOTHING then did the wrong thing twice:
//
//   · the re-cased names arrived as SECOND rows, "Blue whale" and "Blue
//     Whale" both in the dropdown, because UNIQUE(name, brand) is
//     case-sensitive;
//   · the 220 names whose casing had not changed kept their old codes,
//     because a row already matching (name, brand) is skipped;
//   · and the COUNT made it permanent -- the table was now ABOVE the seed's
//     length, so the top-up would never look again.
//
// So the table is now CONVERGED on the seed instead of topped up to it. One
// read of the whole table (3,376 rows of four short columns -- a few hundred
// KB, next to nothing at boot), three sets computed in memory, and writes
// only for what is actually out of step:
//
//   · MISSING -- a seed row the table hasn't got. Inserted, as before.
//   · SUPERSEDED -- a row whose (name, brand) is NOT in the seed, sitting
//     beside a same-brand row that IS and whose name differs only in case.
//     That pair can only come from the seed re-casing a name it already
//     shipped, so the one the seed no longer knows about is deleted.
//   · STALE CODE -- a row that IS in the seed, carrying a code where the seed
//     carries none, and only for a brand the seed says is codeless
//     throughout (Dulux, Paint & Paper Library, Lick, and Valspar since
//     v2.73.2). The seed dropping a whole brand's codes is a decision about
//     that brand, so it wins. A brand that still HAS codes keeps the
//     hand-edit protection v2.69.2 built, and a differing code is left alone.
//
// A colour saved from the app is only ever touched when it IS one of the
// seed's own -- same brand and the same name bar the casing, or the same name
// exactly on a codeless brand. Anything the seed has never heard of is not
// the seed's business, which is what keeps a library someone has added to
// safe from a deploy.
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'db', 'colour-library-seed.json');

function readSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

const key = (name, brand) => name + '|' + brand;
const ckey = (name, brand) => name.toLowerCase() + '|' + brand;

// What the table should change to look like the seed. Pure, so the decision
// is testable on its own and the query layer below stays dull.
function planColourLibrary(entries, rows) {
  const seeded = new Set(entries.map(c => key(c.name, c.brand)));
  const seededCI = new Map(entries.map(c => [ckey(c.name, c.brand), c.name]));
  const codeless = new Set([...new Set(entries.map(c => c.brand))]
    .filter(b => entries.every(c => c.brand !== b || !c.code)));
  const have = new Set(rows.map(r => key(r.name, r.brand)));

  const missing = entries.filter(c => !have.has(key(c.name, c.brand)));
  const superseded = rows.filter(r =>
    !seeded.has(key(r.name, r.brand)) && seededCI.has(ckey(r.name, r.brand)));
  const stale = rows.filter(r =>
    r.code && codeless.has(r.brand) && seeded.has(key(r.name, r.brand)));
  return { missing: missing, superseded: superseded, stale: stale };
}

// Returns what it did, so a caller (and the test) can tell "already in step"
// from "changed" without reading the log.
async function topUpColourLibrary(db, log) {
  const entries = readSeed();
  const { rows } = await db.query('SELECT id, name, brand, code FROM colour_library');
  const before = rows.length;
  const plan = planColourLibrary(entries, rows);

  if (!plan.missing.length && !plan.superseded.length && !plan.stale.length) {
    return { checked: entries.length, before: before, inserted: 0, ranSeed: false,
             removed: 0, cleared: 0 };
  }

  let inserted = 0;
  for (const { name, brand, code } of plan.missing) {
    // ON CONFLICT is belt and braces now that the plan has already ruled the
    // row out, and it is what makes two instances booting at once harmless.
    const r = await db.query(
      `INSERT INTO colour_library (name, brand, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (name, brand) DO NOTHING`,
      [name, brand, code || '']
    );
    if (r.rowCount > 0) inserted++;
  }
  if (plan.superseded.length) {
    await db.query('DELETE FROM colour_library WHERE id = ANY($1)', [plan.superseded.map(r => r.id)]);
  }
  if (plan.stale.length) {
    await db.query(`UPDATE colour_library SET code = '' WHERE id = ANY($1)`, [plan.stale.map(r => r.id)]);
  }

  if (log) {
    log(`colour library synced: ${before} rows -> ${before + inserted - plan.superseded.length}`
      + ` (+${inserted} added, -${plan.superseded.length} superseded, ${plan.stale.length} code(s) cleared;`
      + ` seed holds ${entries.length})`);
  }
  return { checked: entries.length, before: before, inserted: inserted, ranSeed: true,
           removed: plan.superseded.length, cleared: plan.stale.length };
}

module.exports = { topUpColourLibrary, planColourLibrary, readSeed, SEED_PATH };
