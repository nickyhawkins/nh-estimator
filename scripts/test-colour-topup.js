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
