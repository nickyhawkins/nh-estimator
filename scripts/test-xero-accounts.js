#!/usr/bin/env node
'use strict';

// ── Per-instance Xero accounts (Settings → Materials) ──────────────────────
//
// A new instance's Xero may not use Nicky's 201 labour / 202 materials / SUN
// sundry convention. What is held here:
//   1. xeroAccountConfig() defaults to 201 / 202 / SUN, so an instance that
//      never touches the fields behaves exactly as before.
//   2. The materials catalogue and Price Lookup filter on the CONFIGURED
//      materials account, and sundries split on the configured prefix.
//   3. Quote lines post to the configured accounts, and with no accounts
//      passed they are byte-identical to the historic 201/202 lines.
//   4. Invoice lines built with the '201'/'202' markers are translated to
//      the configured codes; any other code passes through untouched.
//
// USAGE
//   node scripts/test-xero-accounts.js
//   npm run test:xero-accounts

const {
  xeroAccountConfig, postingAccount, groupMaterialItems, priceLookupItems, buildQuoteLineItems
} = require('../routes/xero.js');

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// ── 1. Defaults ────────────────────────────────────────────────────────────
eq('no settings = the original convention', xeroAccountConfig(undefined),
  { labour: '201', materials: '202', sundryPrefix: 'SUN' });
eq('blank fields fall back to the defaults', xeroAccountConfig({ labourAccountCode: '  ', materialsAccountCode: '' }),
  { labour: '201', materials: '202', sundryPrefix: 'SUN' });
eq('configured codes are trimmed and used', xeroAccountConfig({ labourAccountCode: ' 4000 ', materialsAccountCode: '4010', sundryCodePrefix: 'CON' }),
  { labour: '4000', materials: '4010', sundryPrefix: 'CON' });

// ── 2. Catalogue + Price Lookup ────────────────────────────────────────────
const item = (Code, Name, account) => ({
  Code, Name, SalesDetails: { UnitPrice: 10, AccountCode: account }, PurchaseDetails: { UnitPrice: 8 }
});
const ITEMS = [
  item('DUL001', 'Dulux Diamond Matt - PBW 5ltr', '4010'),
  item('CON001', 'Decorators Caulk', '4010'),
  item('SUN001', 'Lining Paper', '4010'),
  item('OLD001', 'Dulux Trade Eggshell - PBW 2.5ltr', '202')
];
const groups = groupMaterialItems(ITEMS.filter(i => i.SalesDetails.AccountCode === '4010'), 'CON');
eq('the configured prefix makes a sundry', groups.sundries.map(s => s.itemCode), ['CON001']);
check('an item the prefix does not match is not a sundry', !groups.sundries.some(s => s.itemCode === 'SUN001'));
check('paint still parses under a custom prefix', !!groups.paint['Dulux Diamond Matt']);
eq('the default prefix is still SUN', groupMaterialItems([item('SUN001', 'Lining Paper', '202')]).sundries.length, 1);
check('a prefix with regex characters is matched literally',
  groupMaterialItems([item('S.X1', 'Tape', '4010'), item('SAX1', 'Tape 2', '4010')], 'S.').sundries.length === 1);
eq('Price Lookup filters on the configured account', priceLookupItems(ITEMS, '4010').map(i => i.code).sort(),
  ['CON001', 'DUL001', 'SUN001']);
eq('Price Lookup defaults to 202', priceLookupItems(ITEMS).map(i => i.code), ['OLD001']);

// ── 3. Quote lines ─────────────────────────────────────────────────────────
const BODY = {
  rooms: [{ name: 'Lounge', total: 500 }],
  materials: [{ itemCode: 'DUL001', description: 'Dulux', quantity: 1, unitAmount: 50 }],
  settings: { sundriesPct: 10 }, markup: 0, markupType: 'percent', lineMult: 1
};
const codesOf = lines => lines.filter(l => l.AccountCode).map(l => l.AccountCode);
eq('no accounts passed = historic 201/202', codesOf(buildQuoteLineItems(BODY)), ['201', '202', '202']);
eq('configured accounts are used on every line',
  codesOf(buildQuoteLineItems(BODY, xeroAccountConfig({ labourAccountCode: '4000', materialsAccountCode: '4010' }))),
  ['4000', '4010', '4010']);
eq('the amounts do not move with the accounts',
  buildQuoteLineItems(BODY).map(l => l.UnitAmount),
  buildQuoteLineItems(BODY, { labour: '4000', materials: '4010' }).map(l => l.UnitAmount));

// ── 4. Invoice marker translation ──────────────────────────────────────────
const acc = xeroAccountConfig({ labourAccountCode: '4000', materialsAccountCode: '4010' });
eq('201 marker -> labour account', postingAccount('201', acc), '4000');
eq('202 marker -> materials account', postingAccount('202', acc), '4010');
eq('any other code passes through', postingAccount('620', acc), '620');
eq('defaults are an identity mapping', ['201', '202'].map(c => postingAccount(c, xeroAccountConfig())), ['201', '202']);

console.log(`\n${pass.length} passed`);
pass.forEach(p => console.log('  ✓ ' + p));
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  fail.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
