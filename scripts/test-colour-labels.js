// How a colour's brand and code PRINT — in the dropdown, and on the client's
// quote and Xero invoice line.
//
// The bug: a library `code` holds one of two different things. For Farrow &
// Ball it's the number that gets a tin mixed ("28"). For RAL, COAT and Lick
// it's the shade in WORDS ("Anthracite grey"), there so the search can find a
// colour by what it looks like. colourLabelFor() printed both as "No. <code>",
// so a client's invoice line read "RAL Classic No. Anthracite grey RAL 7016"
// -- shipped since v2.38.5 -- and v2.69.0 added "COAT No. Charcoal Grey The
// Coal Drop" to it.
//
// Runs the REAL colourCodeIsNumber() / colourCodeSuffix() and the REAL
// label-building line out of public/index.html over the REAL seed.
//
//   npm run test:colour-labels
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const src = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
function grab(re, what) {
  const m = src.match(re);
  if (!m) throw new Error(what + ' not found in public/index.html');
  return m[0];
}
const isNumSrc = grab(/function colourCodeIsNumber\(code\) \{[\s\S]*?\n\}/, 'colourCodeIsNumber()');
const suffixSrc = grab(/function colourCodeSuffix\(code\) \{[\s\S]*?\n\}/, 'colourCodeSuffix()');
// The exact expression colourLabelFor() ends on, so the test can't drift from it.
const labelExpr = grab(
  /return \[c\.brand \|\| '', colourCodeIsNumber\(c\.code\) \? 'No\. ' \+ c\.code : '', c\.label\]\s*\n\s*\.filter\(Boolean\)\.join\(' '\);/,
  'the colourLabelFor() return'
);

const api = new Function(`
  ${isNumSrc}
  ${suffixSrc}
  function fullName(c) { ${labelExpr.replace('c.label', 'c.name')} }
  return { colourCodeIsNumber: colourCodeIsNumber, colourCodeSuffix: colourCodeSuffix, fullName: fullName };
`)();

const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'colour-library-seed.json'), 'utf8'));
const find = n => SEED.find(c => c.name === n);

let failed = 0;
function is(actual, expected, description) {
  const ok = actual === expected;
  console.log((ok ? '  ok  ' : 'FAIL  ') + description);
  if (!ok) { console.log('        expected: ' + JSON.stringify(expected) + '\n        actual:   ' + JSON.stringify(actual)); failed++; }
}
function check(description, ok, detail) {
  console.log((ok ? '  ok  ' : 'FAIL  ') + description + (ok ? '' : ' — ' + detail));
  if (!ok) failed++;
}

console.log('Colour label formatting (' + SEED.length + ' entries)\n');
console.log('What prints on the client quote / Xero invoice line:');

// A real code still carries "No." -- this is the behaviour v2.38.5 added and
// the whole reason the field is on the invoice. It must not change.
is(api.fullName(find('Dead Salmon')), 'Farrow & Ball No. 28 Dead Salmon', 'Farrow & Ball keeps its number');
is(api.fullName(find('Lemon Mivvi')), 'Little Greene No. 195 Lemon Mivvi', 'Little Greene keeps its number');
is(api.fullName(find('Indian White')), 'Dulux Heritage No. 1780085 Indian White', 'Dulux Heritage keeps its number');
is(api.fullName(find('Ash Grey')), 'Farrow & Ball No. W9 Ash Grey', 'a letter+digit code is still a code');

// A description never does. It is decoration in front of a name that already
// carries it, on a document whose job is to say what to re-order.
is(api.fullName(find('RAL 7016')), 'RAL Classic RAL 7016', 'RAL drops the description (bug since v2.38.5)');
is(api.fullName(find('The Coal Drop')), 'COAT The Coal Drop', 'COAT drops the description');
is(api.fullName(find('Grey 04')), 'Lick Grey 04', 'Lick prints clean');
is(api.fullName(find('Campground')), 'Valspar No. X144R283B Campground', 'Valspar keeps its mixing code');
is(api.fullName(find('Pink ribbon care')), 'Valspar No. PRC Pink ribbon care', 'and so does a code with no digit in it');
is(api.fullName(find('Timeless')), 'Dulux Timeless', 'a brand with no code at all is unchanged');

console.log('\nWhat prints under the name in the dropdown:');
is('RAL Classic' + api.colourCodeSuffix(find('RAL 7016').code), 'RAL Classic · Anthracite grey', 'RAL shows its description, no "No."');
is('COAT' + api.colourCodeSuffix(find('The Coal Drop').code), 'COAT · Charcoal Grey', 'COAT shows its description');
is('Farrow & Ball' + api.colourCodeSuffix(find('Dead Salmon').code), 'Farrow & Ball · No. 28', 'a number keeps "No."');
is('Lick' + api.colourCodeSuffix(find('Grey 04').code), 'Lick', 'a blank code adds nothing');

console.log('\nThe seed itself:');
// The rule only works because the two shapes never overlap. Hold that.
const mixed = [];
const byBrand = {};
for (const c of SEED) {
  const shape = !c.code ? 'blank' : (api.colourCodeIsNumber(c.code) ? 'code' : 'desc');
  (byBrand[c.brand] = byBrand[c.brand] || new Set()).add(shape);
}
for (const [brand, shapes] of Object.entries(byBrand)) if (shapes.size > 1) mixed.push(brand + ' (' + [...shapes].join('+') + ')');
check('every brand is wholly one shape — no ragged column', mixed.length === 0, mixed.join(', '));
// The rule has to classify each brand the way that brand actually works --
// including RAL descriptions that carry a digit ("Telegrey 1"), which the
// no-space half of the test is what saves.
const EXPECTED = {
  'Farrow & Ball': 'code', 'Little Greene': 'code', 'Dulux Heritage': 'code',
  'Valspar': 'code',
  'RAL Classic': 'desc', 'COAT': 'desc',
  'Dulux': 'blank', 'Paint & Paper Library': 'blank', 'Lick': 'blank'
};
const wrong = SEED.filter(c => {
  const shape = !c.code ? 'blank' : (api.colourCodeIsNumber(c.code) ? 'code' : 'desc');
  return EXPECTED[c.brand] && shape !== EXPECTED[c.brand];
});
check('every brand classifies the way that brand actually works',
  wrong.length === 0,
  wrong.slice(0, 5).map(c => c.brand + ' ' + c.name + ' = ' + JSON.stringify(c.code)).join('; '));
check('a description carrying a digit is still a description (RAL "Telegrey 1")',
  api.colourCodeIsNumber('Telegrey 1') === false && api.colourCodeIsNumber('W9') === true,
  'the digit/space rule misclassifies one of them');
// Valspar is the brand that found the hole in the digit half of the rule: two
// of its 986 are coded by INITIALS, with no digit in them at all, and read as
// descriptions -- which took the code off the client's quote line. All-caps
// carries them; RAL's one-word descriptions are written like shades, and the
// lowercase in them is what keeps the two apart.
check('an all-caps code with no digit is a code (Valspar "PRC")',
  api.colourCodeIsNumber('PRC') === true && api.colourCodeIsNumber('PRS') === true,
  'a charity code still reads as a description');
check('a one-word description is still a description (RAL "Telemagenta")',
  ['Beige', 'Ivory', 'Curry', 'Vermilion', 'Rose', 'Telemagenta', 'Cream']
    .every(d => api.colourCodeIsNumber(d) === false),
  'a RAL shade name flipped to a code');
check('every seeded brand is covered by the expectation above',
  Object.keys(byBrand).every(b => EXPECTED[b]),
  Object.keys(byBrand).filter(b => !EXPECTED[b]).join(', '));
check('nothing prints a bare "No." with no code after it',
  SEED.every(c => !/No\.\s*$/.test(api.fullName({ brand: c.brand, code: c.code, name: c.name }))), 'trailing "No."');

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
