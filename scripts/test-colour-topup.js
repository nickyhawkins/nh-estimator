// Colour library boot top-up (lib/colourLibrarySeed.js) against a fake db.
//
// The failure this exists for: v2.69.0 added 264 colours to the seed file and
// merged, the server deployed and reported the new version, and the colours
// were not there -- because the seed only ever ran from the preDeployCommand,
// which an instance configured by hand doesn't have. A release whose whole
// content is data must not be able to ship without its data.
//
//   npm run test:colour-topup
const { topUpColourLibrary, readSeed } = require('../lib/colourLibrarySeed');

const SEED = readSeed();

// Minimal stand-in for db: counts the INSERTs and answers the COUNT with
// whatever the test says is already in the table.
function fakeDb(existingRows, opts) {
  opts = opts || {};
  const present = new Set(existingRows.map(c => c.name + '|' + c.brand));
  const db = { inserts: 0, conflicts: 0, queries: 0 };
  db.query = async (sql, params) => {
    db.queries++;
    if (/COUNT/i.test(sql)) {
      if (opts.countThrows) throw new Error('relation "colour_library" does not exist');
      return { rows: [{ n: present.size }] };
    }
    const key = params[0] + '|' + params[1];
    if (present.has(key)) { db.conflicts++; return { rowCount: 0 }; }
    present.add(key); db.inserts++;
    return { rowCount: 1 };
  };
  db.present = present;
  return db;
}

let failed = 0;
function check(description, fn) {
  let ok, detail = '';
  try { const r = fn(); ok = r === true; if (!ok) detail = ' — ' + r; }
  catch (e) { ok = false; detail = ' — threw: ' + e.message; }
  console.log((ok ? '  ok  ' : 'FAIL  ') + description + detail);
  if (!ok) failed++;
}

(async () => {
  console.log('Colour library boot top-up (seed holds ' + SEED.length + ')\n');

  // The v2.69.0 case: the table is on the old 1,221 and the seed has grown.
  const old = SEED.filter(c => c.brand !== 'Lick' && c.brand !== 'COAT');
  const short = fakeDb(old);
  const r1 = await topUpColourLibrary(short);
  check('a table short of the seed is topped up', () =>
    (r1.ranSeed && r1.inserted === SEED.length - old.length) ||
    `ranSeed=${r1.ranSeed} inserted=${r1.inserted}, expected ${SEED.length - old.length}`);
  check('and the rows added are exactly the new brands', () =>
    short.inserts === 262 || `inserted ${short.inserts}, expected 262`);

  // The normal case: a complete table costs one query and nothing else.
  const full = fakeDb(SEED);
  const r2 = await topUpColourLibrary(full);
  check('a complete table runs the COUNT and stops', () =>
    (!r2.ranSeed && full.queries === 1 && full.inserts === 0) ||
    `ranSeed=${r2.ranSeed} queries=${full.queries} inserts=${full.inserts}`);

  // Colours saved from the app push the count ABOVE the seed. That must not
  // be read as "short" on every boot thereafter.
  const withExtras = fakeDb(SEED.concat([
    { name: "Nicky's Hallway White", brand: 'Mixed', code: '' },
    { name: 'Client Choice', brand: 'Johnstone’s', code: 'X1' }
  ]));
  const r3 = await topUpColourLibrary(withExtras);
  check("a library with the user's own colours in it is left alone", () =>
    (!r3.ranSeed && withExtras.inserts === 0) || `ranSeed=${r3.ranSeed} inserts=${withExtras.inserts}`);

  // Re-running must never duplicate: same name+brand hits ON CONFLICT.
  const again = fakeDb(old);
  await topUpColourLibrary(again);
  const before = again.inserts;
  const r4 = await topUpColourLibrary(again);
  check('a second boot inserts nothing more', () =>
    (!r4.ranSeed && again.inserts === before) || `inserts went ${before} -> ${again.inserts}`);

  // An empty table (a brand-new instance) gets the lot.
  const empty = fakeDb([]);
  const r5 = await topUpColourLibrary(empty);
  check('an empty table is seeded in full', () =>
    (r5.ranSeed && empty.inserts === SEED.length) || `inserted ${empty.inserts} of ${SEED.length}`);

  // A database that isn't there must reject, for the caller to swallow --
  // never take the web server down with it.
  let threw = false;
  try { await topUpColourLibrary(fakeDb([], { countThrows: true })); } catch (e) { threw = true; }
  check('a missing table rejects rather than throwing synchronously', () => threw === true || 'did not reject');

  // The seed itself: the constraint the inserts rely on is UNIQUE(name, brand).
  const keys = new Set(SEED.map(c => c.name + '|' + c.brand));
  check('the seed file holds no duplicate name+brand', () =>
    keys.size === SEED.length || `${SEED.length - keys.size} duplicate(s)`);
  check('every seed row has a name, a brand and a string code', () =>
    SEED.every(c => c.name && c.brand && typeof c.code === 'string') || 'malformed row(s)');
  check('Lick and COAT are actually in the seed', () => {
    const n = b => SEED.filter(c => c.brand === b).length;
    return (n('Lick') === 136 && n('COAT') === 126) || `Lick=${n('Lick')} COAT=${n('COAT')}`;
  });

  console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
})();
