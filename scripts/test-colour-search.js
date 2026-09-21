// Colour library autocomplete — what the dropdown offers for a typed query.
//
// Runs the REAL colourMatchRank() and the REAL filter/sort block out of
// public/index.html (pulled from the file, never a copy that can drift) over
// the REAL db/colour-library-seed.json, sorted by name the way
// GET /api/colour-library returns it.
//
// The bug this holds: the filter matched name and code but NOT brand, so
// typing "lick" or "coat" found nothing and 264 entries were invisible to
// anyone who didn't already know an exact colour name. Brands that NUMBER
// their colours rather than naming them (Lick "Grey 04", RAL "RAL 7016") are
// exactly the ones you look up by brand, so this is the search that matters
// for them. Only 8 rows are shown, hence the ranking: a name starting with
// the query outranks a mid-string hit, or the good match falls off the list.
//
//   npm run test:colour-search
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const rankSrc = src.match(/function colourMatchRank\(c, qLower\) \{[\s\S]*?\n\}/);
if (!rankSrc) throw new Error('colourMatchRank() not found in public/index.html');
const filterSrc = src.match(/colourDropdownMatches = colourLibrary\.filter\(function\(c\)\{[\s\S]*?\.slice\(0, 8\);/);
if (!filterSrc) throw new Error('the colourDropdownMatches filter was not found in public/index.html');

// ORDER BY name ASC — what the API hands the client, so ties break the way
// they do in the app rather than the way the seed file happens to be ordered.
const colourLibrary = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'db', 'colour-library-seed.json'), 'utf8')
).slice().sort((a, b) => a.name.localeCompare(b.name, 'en'));

const search = new Function('colourLibrary', 'qLower', `
  ${rankSrc[0]}
  var colourDropdownMatches;
  ${filterSrc[0]}
  return colourDropdownMatches;
`);

let failed = 0;
function check(query, description, assertion) {
  const rows = search(colourLibrary, query.toLowerCase());
  let ok;
  try { ok = !!assertion(rows); } catch (e) { ok = false; }
  const shown = rows.slice(0, 4).map(r => r.brand + ' ' + r.name).join(' | ') || '(nothing)';
  console.log((ok ? '  ok  ' : 'FAIL  ') + '"' + query + '" — ' + description + '\n        ' + shown);
  if (!ok) failed++;
}

console.log('Colour library autocomplete (' + colourLibrary.length + ' entries)\n');

// The brands the search could not reach before v2.69.1.
check('lick', 'a brand name finds that brand', r => r.length === 8 && r.every(x => x.brand === 'Lick'));
check('coat', 'COAT too', r => r.length > 0 && r.some(x => x.brand === 'COAT'));
check('grey 0', 'a hue+number prefix leads with those, not mid-string hits',
  // Count is deliberately not asserted: Lick's range is not contiguous, so how
  // many greys start "Grey 0" is a property of the chart, not of the ranking.
  r => r.length > 0 && r[0].name.toLowerCase().indexOf('grey 0') === 0
       && r.slice(0, 4).every(x => x.name.toLowerCase().indexOf('grey 0') === 0));
check('grey 04', 'an exact Lick name', r => r.some(x => x.brand === 'Lick' && x.name === 'Grey 04'));
check('coal drop', 'a COAT name typed partly', r => r.length === 1 && r[0].name === 'The Coal Drop');
check('charcoal', "a COAT shade description in `code`", r => r.some(x => x.name === 'The Coal Drop'));
// Lick carries no descriptions any more (v2.69.3 — 29 of 136 was a ragged
// column, and the other 107 can't be filled in honestly from here), so Lick
// is reachable by brand and by name only. COAT's are complete, so COAT keeps
// description search.
check('white 0', 'Lick by name still works without a description',
  r => r.some(x => x.brand === 'Lick' && x.name === 'White 05'));

// Valspar. Its colour names are whole phrases -- "Bohemian Bliss", "Cool
// Runnings" -- and it carries no codes at all since v2.73.2, so name and
// brand are the two ways in. That is how B&Q's counter works too: it tints
// to the NAME, which is the reason the codes went.
check('valspar', 'the brand reaches its colours', r => r.length === 8 && r.every(x => x.brand === 'Valspar'));
check('bohemian', 'a Valspar name typed partly', r => r.some(x => x.brand === 'Valspar' && x.name === 'Bohemian Bliss'));
check('cool runn', 'a two-word Valspar name mid-phrase', r => r.some(x => x.name === 'Cool Runnings'));

// Everything that already worked must still work.
check('dead sal', 'the manual\'s own example still resolves',
  r => r.length === 1 && r[0].brand === 'Farrow & Ball' && r[0].name === 'Dead Salmon');
check('anthracite', 'RAL by description (the reason `code` is searched at all)',
  r => r.some(x => x.brand === 'RAL Classic' && x.name === 'RAL 7016'));
check('ral 7016', 'RAL by number, ranked first', r => r[0].name === 'RAL 7016');
check('farrow', 'an existing brand name now reaches its colours',
  r => r.length === 8 && r.every(x => x.brand === 'Farrow & Ball'));
check('zzzz', 'no match is still no match', r => r.length === 0);

// ── Typing a bare brand name ───────────────────────────────────────────────
// Searching by brand made "lick" a useful thing to TYPE, and the field commits
// what it holds on blur -- so browsing Lick and tapping elsewhere left the job
// carrying a colour called "Lick". The real colourTextIsBareBrand(), over the
// real library, with `colours` (the job) supplied per case.
const bareBrandSrc = src.match(/function colourTextIsBareBrand\(label\) \{[\s\S]*?\n\}/);
if (!bareBrandSrc) throw new Error('colourTextIsBareBrand() not found in public/index.html');
const isBareBrand = new Function('colourLibrary', 'colours', 'label', `
  ${bareBrandSrc[0]}
  return colourTextIsBareBrand(label);
`);

console.log('\nTyping a bare brand name into a colour field:');
function brand(label, jobColours, expected, description) {
  const got = isBareBrand(colourLibrary, jobColours || [], label);
  const ok = got === expected;
  console.log((ok ? '  ok  ' : 'FAIL  ') + JSON.stringify(label) + ' — ' + description +
    (ok ? '' : ` (expected ${expected}, got ${got})`));
  if (!ok) failed++;
}

brand('Lick', [], true, 'declined — this is the one Nicky hit');
brand('lick', [], true, 'case-insensitive');
brand('  COAT  ', [], true, 'whitespace trimmed');
brand('Farrow & Ball', [], true, 'an existing brand too, ampersand and all');
brand('RAL Classic', [], true, 'and a two-word brand');
brand('Grey 04', [], false, 'a real colour name is committed');
brand('Lick Grey 04', [], false, "brand + colour isn't a bare brand");
brand('Licked', [], false, 'a name that merely starts with a brand');
brand('', [], false, 'blank is how a colour is CLEARED — never declined');
brand('   ', [], false, 'and so is whitespace');
brand('Hallway white', [], false, 'free text the library has never heard of still lands');
// A colour already on the job wins: typing an existing name JOINS it, which is
// the documented way two areas share a tin. Declining that would break it.
brand('Lick', [{ label: 'Lick' }], false, 'a colour already on the job by that name is joined, not declined');
// And a library colour named after its own brand would win, if one ever exists.
brand('Dulux', [], true, 'no Dulux colour is called "Dulux", so it stays a brand');
brand('Valspar', [], true, 'a brand added later is guarded by the same rule, with no list to update');

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
