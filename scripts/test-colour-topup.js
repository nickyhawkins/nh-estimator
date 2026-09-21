// Colour library seed applied to the table (lib/colourLibrarySeed.js),
// against a fake db.
//
// Two failures this exists for. v2.69.0 added 264 colours to the seed file
// and merged, the server deployed and reported the new version, and the
// colours were not there -- because the seed only ever ran from the
// preDeployCommand, which an instance configured by hand doesn't have. A
// release whose whole content is data must not be able to ship without its
// data.
//
// Then v2.73.2 re-cased 1,709 Valspar names and blanked every Valspar code,
// and the insert-only seed put the new names in ALONGSIDE the old ones
// ("Blue whale" and "Blue Whale" both in the dropdown, UNIQUE(name, brand)
// being case-sensitive) while leaving the codes on the 220 whose casing had
// not changed. The COUNT gate made it permanent: the table was now above the
// seed's length, so it would never look again. The seed CONVERGES the table
// now, and the cases below are that table, rebuilt.
//
//   npm run test:colour-topup
const { topUpColourLibrary, planColourLibrary, readSeed } = require('../lib/colourLibrarySeed');

const SEED = readSeed();

// Stand-in for db: a real little table of {id, name, brand, code} rows, since
// the sync DELETEs and UPDATEs and a set of keys can't show that. It answers
// only the four statements the module issues, and throws on anything else so
// a new query can't pass the test by being ignored.
function fakeDb(existingRows, opts) {
  opts = opts || {};
  let nextId = 1;
  const rows = existingRows.map(c => ({ id: nextId++, name: c.name, brand: c.brand, code: c.code || '' }));
  const db = { inserts: 0, conflicts: 0, queries: 0, deletes: 0, updates: 0, rows: rows };
  db.query = async (sql, params) => {
    db.queries++;
    if (/^SELECT id, name, brand, code/i.test(sql.trim())) {
      if (opts.readThrows) throw new Error('relation "colour_library" does not exist');
      return { rows: rows.map(r => ({ id: r.id, name: r.name, brand: r.brand, code: r.code })) };
    }
    if (/^DELETE/i.test(sql.trim())) {
      const ids = new Set(params[0]);
      for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id)) { rows.splice(i, 1); db.deletes++; }
      return { rowCount: ids.size };
    }
    if (/^UPDATE/i.test(sql.trim())) {
      const ids = new Set(params[0]);
      for (const r of rows) if (ids.has(r.id)) { r.code = ''; db.updates++; }
      return { rowCount: ids.size };
    }
    if (/^INSERT/i.test(sql.trim())) {
      const [name, brand, code] = params;
      if (rows.some(r => r.name === name && r.brand === brand)) { db.conflicts++; return { rowCount: 0 }; }
      rows.push({ id: nextId++, name: name, brand: brand, code: code || '' });
      db.inserts++;
      return { rowCount: 1 };
    }
    throw new Error('fakeDb got a statement it does not model: ' + sql.slice(0, 60));
  };
  db.valspar = () => rows.filter(r => r.brand === 'Valspar');
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

  // The normal case: a table already in step costs ONE read and no writes.
  // The read is the whole table now rather than a COUNT (v2.73.3) -- 3,376
  // rows of four short columns, which is the price of the seed being able to
  // correct a row it has renamed.
  const full = fakeDb(SEED);
  const r2 = await topUpColourLibrary(full);
  check('a table already in step costs one read and no writes', () =>
    (!r2.ranSeed && full.queries === 1 && full.inserts === 0 && full.deletes === 0 && full.updates === 0) ||
    `ranSeed=${r2.ranSeed} queries=${full.queries} inserts=${full.inserts} deletes=${full.deletes} updates=${full.updates}`);

  // Colours saved from the app push the count ABOVE the seed. That must not
  // be read as "short" on every boot thereafter.
  const withExtras = fakeDb(SEED.concat([
    { name: "Nicky's Hallway White", brand: 'Mixed', code: '' },
    { name: 'Client Choice', brand: 'Johnstone’s', code: 'X1' }
  ]));
  const r3 = await topUpColourLibrary(withExtras);
  check("a library with the user's own colours in it is left alone", () =>
    (!r3.ranSeed && withExtras.inserts === 0 && withExtras.deletes === 0 && withExtras.updates === 0) ||
    `ranSeed=${r3.ranSeed} inserts=${withExtras.inserts} deletes=${withExtras.deletes} updates=${withExtras.updates}`);

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
  try { await topUpColourLibrary(fakeDb([], { readThrows: true })); } catch (e) { threw = true; }
  check('a missing table rejects rather than throwing synchronously', () => threw === true || 'did not reject');

  // ── A seed row that CHANGED, not one that was added (v2.73.3) ───────────
  // v2.73.2's Valspar rebuild, replayed: the table holds the v2.73.1 rows
  // (sentence case, every one carrying a code) and the deploy inserts the
  // current seed on top of them.
  const V = SEED.filter(c => c.brand === 'Valspar');
  const sentenceCase = n => n.charAt(0) + n.slice(1).toLowerCase();
  const oldValspar = V.map((c, i) => ({ name: sentenceCase(c.name), brand: 'Valspar', code: 'X' + i + 'R' + i + 'A' }));
  const reCased = oldValspar.filter((c, i) => c.name !== V[i].name).length;
  const unchanged = V.length - reCased;
  check('the fixture is the real shape: most names re-cased, some not', () =>
    (reCased > 1500 && unchanged > 100) || `reCased=${reCased} unchanged=${unchanged}`);

  const doubled = fakeDb(SEED.filter(c => c.brand !== 'Valspar').concat(oldValspar));
  for (const c of V) await doubled.query('INSERT', [c.name, c.brand, c.code]); // the v2.73.2 deploy
  check('the v2.73.2 deploy really did double the re-cased rows', () =>
    doubled.valspar().length === V.length + reCased ||
    `${doubled.valspar().length} Valspar rows, expected ${V.length + reCased}`);

  const fix = await topUpColourLibrary(doubled);
  check('the superseded rows are removed', () =>
    (fix.removed === reCased && doubled.valspar().length === V.length) ||
    `removed=${fix.removed} (expected ${reCased}), left ${doubled.valspar().length} of ${V.length}`);
  check('and the codes the insert could not reach are cleared', () =>
    (fix.cleared === unchanged && doubled.valspar().every(r => !r.code)) ||
    `cleared=${fix.cleared} (expected ${unchanged}), ${doubled.valspar().filter(r => r.code).length} still coded`);
  check('what is left is exactly the seed', () => {
    const got = doubled.valspar().map(r => r.name).sort();
    const want = V.map(c => c.name).sort();
    const bad = got.find((n, i) => n !== want[i]);
    return !bad || `first mismatch: ${bad}`;
  });
  const settled = await topUpColourLibrary(doubled);
  check('and the boot after that does nothing at all', () =>
    (!settled.ranSeed && doubled.deletes === reCased) ||
    `ranSeed=${settled.ranSeed} deletes=${doubled.deletes}`);

  // The case the COUNT gate could never have caught, and the reason it went:
  // a table holding ONLY the old names is exactly the seed's LENGTH, so "is
  // it short?" answers no while every Valspar row in it is wrong.
  const renamedOnly = fakeDb(SEED.filter(c => c.brand !== 'Valspar').concat(oldValspar));
  check('a table the right size but the wrong content is not "complete"', () =>
    renamedOnly.rows.length === SEED.length || `${renamedOnly.rows.length} rows vs seed ${SEED.length}`);
  const r9 = await topUpColourLibrary(renamedOnly);
  check('...and one pass fixes it, not two', () => {
    const v = renamedOnly.valspar();
    return (r9.inserted === reCased && r9.removed === reCased && v.length === V.length && v.every(r => !r.code))
      || `inserted=${r9.inserted} removed=${r9.removed} rows=${v.length} coded=${v.filter(r => r.code).length}`;
  });

  // What it must NOT touch. A colour saved from the app is only ever caught
  // when it IS a seed colour -- same brand, same name bar the casing, or the
  // same name exactly on a brand the seed carries no codes for.
  const mine = [
    { name: 'Hallway White', brand: 'Nicky', code: 'MINE-1' },       // a brand the seed has never heard of
    { name: 'Skip Yellow', brand: 'Valspar', code: 'SY1' },          // my own colour under a seeded brand
    { name: 'Dead Salmon', brand: 'Farrow & Ball', code: '28-MINE' } // a hand-edited code on a CODED brand
  ];
  const guarded = fakeDb(SEED.concat(mine));
  const r6 = await topUpColourLibrary(guarded);
  check('a colour of my own is never removed or de-coded', () => {
    const lost = mine.filter(m => !guarded.rows.some(r => r.name === m.name && r.brand === m.brand && r.code === m.code));
    return (!r6.ranSeed && !lost.length) ||
      `ranSeed=${r6.ranSeed} removed=${r6.removed} cleared=${r6.cleared} lost=${lost.map(m => m.name).join(', ')}`;
  });
  // The plan on its own, so the rule is readable without a db in the way.
  check('a sibling that differs only in case is superseded only when the seed knows the other one', () => {
    const rows = [
      { id: 1, name: 'Blue whale', brand: 'Valspar', code: 'R213C' },  // superseded by the seed's "Blue Whale"
      { id: 2, name: 'Blue Whale', brand: 'Valspar', code: '' },
      { id: 3, name: 'blue whale', brand: 'Nicky', code: 'X' },        // a brand the seed doesn't carry
      { id: 4, name: 'Blue Whale', brand: 'Nicky', code: '' }
    ];
    const plan = planColourLibrary(SEED, rows);
    const ids = plan.superseded.map(r => r.id);
    return (ids.length === 1 && ids[0] === 1) || `superseded ids: ${ids.join(', ') || 'none'}`;
  });

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

  // Valspar is read off the e-paint Valspar UK chart Nicky sent as PDFs --
  // all ten pages of it, 200 name+code pairs to a page, 1,934 transcribed.
  // The chart lists three colours twice identically, and four times under one
  // code with two spellings: "Sheepsking rug" and "Cozy cacoon" are dropped
  // (neither is a word, and on a client's quote a misspelling reads as OUR
  // bug), while "Tranquil sea"/"Tranquil seas" are both kept, because both
  // are words. 1,929 here.
  //
  // The CODES are deliberately not (v2.73.2). The chart carries four
  // incompatible formats -- "X144R283B", "R213C", "W31a", "L21bW43b", plus
  // two charity colours coded by initials -- so a Valspar code identifies no
  // single system, and B&Q tints by NAME at the counter. A code that can't be
  // ordered from is noise on a client's quote, so the name carries the colour
  // on its own and every Valspar `code` is blank, as Dulux and Lick already
  // are. The transcription is what's pinned below, not the codes.
  //
  // Still missing, and NOT guessed at: each page printed from the phone was
  // clipped two rows short by the PDF's 14400pt page limit -- page 2 is
  // headed "Blue whale to Cool tide" and stops at "Cool runnings". Page 10
  // is the only complete one (152 rows, and its own footer under them), which
  // is what makes the shortfall exactly 2 x 9 = 18 of 1,947. Nine of the
  // eighteen are named by the page headers -- Blue wash, Cool tide, Far and
  // wide, Herb garland, Margaritaville, Parrish blue, Retro chic, Snowflake,
  // Twinkle twinkle -- and the row before each is unknown. A colour that is
  // absent gets typed as free text; an invented one gets quoted and ordered,
  // which is the v2.69.4 lesson and the reason these stay out.
  const valspar = SEED.filter(c => c.brand === 'Valspar');
  check('Valspar is in the seed', () =>
    valspar.length === 1929 || `Valspar=${valspar.length}`);
  check('no Valspar row carries a code — the chart\'s formats don\'t agree', () => {
    const coded = valspar.filter(c => c.code);
    return !coded.length || `${coded.length} still coded, e.g. ${coded[0].name} = ${coded[0].code}`;
  });
  // Every word starts with a capital (v2.73.2). An apostrophe does not start
  // a word -- "P's And Q's", never "P'S" -- and a token that is already all
  // caps is left alone, so "KAPOW!" and "XOXOXO" are not counted against it.
  check('every Valspar name is capitalised word by word', () => {
    const bad = valspar.filter(c => c.name.split(/[\s-]+/).some(w => {
      const first = w.match(/[A-Za-zÀ-ÿ]/);
      return first && first[0] !== first[0].toUpperCase();
    }));
    return !bad.length || bad.slice(0, 5).map(c => c.name).join('; ');
  });
  // The first and last colour transcribed off each of the ten pages. If the
  // clipped rows ever arrive they extend these spans; they must never replace
  // one, and a page span going missing means a page was dropped wholesale.
  check('all ten chart pages are present', () => {
    const want = ['18 Holes', 'Blue Topaz', 'Blue Whale', 'Cool Runnings',
      'Cool Vapour', 'Fait Accompli', 'Fare Thee Well', 'Heirloom Peony',
      'Herbes De Provence', 'Maple Tan', 'Mariana Trench', 'Parisian Purple',
      'Parrot Flight', 'Resplendent Emerald', 'Retro Peach', 'Snow In June',
      'Snug As A Bug', 'Twilight Shadow', 'Ultra Calm', 'Ziggy'];
    const have = new Set(valspar.map(c => c.name));
    const missing = want.filter(w => !have.has(w));
    return !missing.length || `missing: ${missing.join(', ')}`;
  });
  check('the chart\'s own duplicates were folded, not carried', () => {
    const has = n => valspar.some(c => c.name === n);
    const typos = ['Sheepsking Rug', 'Cozy Cacoon'].filter(has);
    // Both spellings of the pair that are both words stay, as do the two
    // different colours the chart gave one code (R130C, pages apart).
    const kept = ['Sheepskin Rug', 'Cozy Cocoon', 'Tranquil Sea', 'Tranquil Seas',
      'Tropical Smoothie', 'Vivid Imagination'].filter(n => !has(n));
    return (!typos.length && !kept.length) || `carried: ${typos.join(', ')} | lost: ${kept.join(', ')}`;
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
