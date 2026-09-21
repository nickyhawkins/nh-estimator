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
  const newBrandRows = SEED.filter(c => c.brand === 'Lick' || c.brand === 'COAT').length;
  check('and the rows added are exactly the new brands', () =>
    short.inserts === newBrandRows || `inserted ${short.inserts}, expected ${newBrandRows}`);

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
    return (n('Lick') === 100 && n('COAT') === 126) || `Lick=${n('Lick')} COAT=${n('COAT')}`;
  });

  // Valspar (v2.73.0) is read off the e-paint Valspar UK chart Nicky sent --
  // pages 2, 4, 5, 7 and 8 of it, 198 name+code pairs each. The chart lists
  // three colours twice identically and once as "Sheepsking rug" against the
  // same code as "Sheepskin rug", so 990 transcribed rows are 986 here.
  //
  // The chart is NOT fully in yet: pages 1, 3, 6 and everything after page 8
  // are still to come, and each page Nicky printed was clipped a couple of
  // rows short of its own header range (page 2 is headed "Blue whale to Cool
  // tide" and stops at "Cool runnings"). So the gaps are, in order: the start
  // of the alphabet up to "Blue whale"; "Cool runnings" to "Fare thee well";
  // "Maple tan" to "Parrot flight"; and "Snow in June" to the end. Nothing
  // was inferred across a gap -- that is the v2.69.4 mistake, and the reason
  // the page boundaries are pinned below rather than described in a comment
  // alone.
  const valspar = SEED.filter(c => c.brand === 'Valspar');
  check('Valspar is in the seed', () =>
    valspar.length === 986 || `Valspar=${valspar.length}`);
  check('every Valspar row carries its mixing code', () =>
    valspar.every(c => c.code) || 'a Valspar colour has no code');
  // The four shapes the chart actually uses: X144R283B, R213C, W31a, L21bW43b
  // (some printed with upper-case suffixes), plus the two charity initials.
  const SHAPE = /^(X\d+R\d+[A-Fa-f]|R\d+[A-Fa-f]|W\d+[A-Ea-e]|L\d+[A-Ea-e]W\d+[A-Ea-e]|PRC|PRS)$/;
  check('every Valspar code matches a shape on the chart', () => {
    const odd = valspar.filter(c => !SHAPE.test(c.code));
    return !odd.length || odd.slice(0, 5).map(c => c.name + ' = ' + c.code).join('; ');
  });
  // The first and last colour of each page transcribed. A page that later
  // arrives extends these spans; it must never replace one.
  check('the transcribed chart pages are all present', () => {
    const want = ['Blue whale', 'Cool runnings', 'Fare thee well', 'Heirloom peony',
      'Herbes de Provence', 'Maple tan', 'Parrot flight', 'Resplendent emerald',
      'Retro peach', 'Snow in June'];
    const have = new Set(valspar.map(c => c.name));
    const missing = want.filter(w => !have.has(w));
    return !missing.length || `missing: ${missing.join(', ')}`;
  });
  check('the chart\'s own duplicates were folded, not carried', () => {
    const typo = valspar.some(c => c.name === 'Sheepsking rug');
    const kept = valspar.some(c => c.name === 'Sheepskin rug' && c.code === 'R95B');
    return (!typo && kept) || `typo=${typo} kept=${kept}`;
  });

  // Lick's range is NOT contiguous -- Beige runs 01,02,03,09,10 and stops, Grey
  // skips 05 and 09-13. v2.69.0 guessed contiguous ranges and invented 36
  // colours that don't exist. This pins the range to the chart so it can't
  // drift back to a guess.
  const lick = SEED.filter(c => c.brand === 'Lick').map(c => c.name);
  const EXPECTED_LICK = {
    Beige: [1,2,3,9,10], Black: [1,2], Blue: [1,2,3,4,5,6,7,8,9,10,11,13,14,15,17,18,19],
    Brown: [2], Green: [1,2,3,4,5,6,7,8,9,13,14,18,19,20], Greige: [1,2,3],
    Grey: [1,2,3,4,6,7,8,14,15,16,17,18], Orange: [1,2,3,4,5],
    Pink: [1,2,3,4,5,7,8,9,12,13], Purple: [1,3,5,6], Red: [1,2,3,6],
    Taupe: [2,3,5], Teal: [1,2,3,4,5,6], White: [1,2,3,4,5,6,7], Yellow: [1,2,3,5,6,7,8]
  };
  const expected = [];
  for (const [fam, nums] of Object.entries(EXPECTED_LICK))
    for (const n of nums) expected.push(fam + ' ' + String(n).padStart(2, '0'));
  // A Soho House colour carries the collaboration name after its number.
  const baseOf = n => n.replace(/ (Soho Farmhouse|Soho Warehouse|Amsterdam House|Nashville House)$/, '');
  const got = lick.map(baseOf).sort();
  check('the Lick range matches the chart exactly — no invented numbers', () => {
    const missing = expected.filter(e => !got.includes(e));
    const extra = got.filter(g => !expected.includes(g));
    return (!missing.length && !extra.length) || `missing: ${missing.join(', ')} | extra: ${extra.join(', ')}`;
  });
  check('the four Lick x Soho House colours keep their collaboration name', () => {
    const want = ['Beige 02 Soho Farmhouse', 'Greige 02 Soho Warehouse', 'Grey 08 Amsterdam House', 'Pink 13 Nashville House'];
    const miss = want.filter(w => !lick.includes(w));
    return !miss.length || `missing: ${miss.join(', ')}`;
  });

  console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
})();
