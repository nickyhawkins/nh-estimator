#!/usr/bin/env node
'use strict';

// ── Windows and doors on the invoice (WINDOWS_DOORS_INVOICE_SPEC.md) ─────────
//
//   1. The invoice line's words: counts, zeros left out, colours, the stage.
//   2. The work report model: every opening, work found on site flagged,
//      pending/declined/unticked work left out, and no prices anywhere.
//   3. The PDF: a real PDF, Barlow embedded, small enough for Xero.
//   4. Interims: the fixture and its site additions as ONE line, each still
//      recorded on its own; nothing changes for a job without the fixture.
//   5. The Xero attachment: never uploaded twice, IncludeOnline, the limits.
//   6. In the real app (browser): a 22-opening job's final invoice has exactly
//      one windows and doors line -- the quote plus the site additions -- with
//      the right counts, and a job without the fixture is unchanged.
//
// USAGE
//   node scripts/test-windoors-invoice.js
//   npm run test:windoors-invoice

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch (e) {
  try { ({ chromium } = require('playwright')); }
  catch (e2) {
    console.error('This test needs Playwright (playwright-core is a devDependency).');
    process.exit(2);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const p = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch (e) { /* not installed under this name */ }
  }
  throw new Error('No Chrome/Chromium found. Install one, or point CHROME_PATH at the executable.');
}

const W = require('../public/windoors');
const { build } = require('./fixtures/windoors-job');
const { renderWorkReportPdf } = require('../lib/workReportPdf');
const { interimInvoiceLineItems, planInterimInvoice } = require('../lib/invoices');
const { attachPdfOnce, hasAttachmentsScope, MAX_BYTES } = require('../lib/xeroAttachments');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const near = (name, got, want) => check(name, Math.abs(got - want) < 0.005, { got, want });

// Anything that looks like money: a £, or a figure with pence.
const MONEY = /£|\b\d+\.\d\d\b/;

(async () => {
  // ── 1. The line's words ──────────────────────────────────────────────────
  eq('1. the spec\'s own example', W.invoiceLineText({ windows: 14, doors: 3, report: 'attached', colours: { frames: 'Dead Salmon', doors: 'Off-Black' } }),
    'Exterior windows and doors: preparation and painting of outside faces, 14 windows and 3 doors. Full breakdown of work per opening in attached report. Colours: Dead Salmon (frames), Off-Black (doors).');
  eq('1. no doors: "and 3 doors" left out', W.invoiceLineText({ windows: 14, doors: 0, report: 'attached' }),
    'Exterior windows and doors: preparation and painting of outside faces, 14 windows. Full breakdown of work per opening in attached report.');
  eq('1. no windows: "14 windows and" left out', W.invoiceLineText({ windows: 0, doors: 1, report: 'attached' }),
    'Exterior windows and doors: preparation and painting of outside faces, 1 door. Full breakdown of work per opening in attached report.');
  check('1. unnamed colours are not mentioned', !/Colour/.test(W.invoiceLineText({ windows: 2, doors: 1, colours: { frames: null, doors: null } })));
  check('1. one colour for both reads once', / Colour: White \(frames and doors\)\.$/.test(W.invoiceLineText({ windows: 2, doors: 1, colours: { frames: 'White', doors: 'White' } })));
  check('1. a door colour on a job with no doors is not mentioned', !/Off-Black/.test(W.invoiceLineText({ windows: 2, doors: 0, colours: { frames: 'White', doors: 'Off-Black' } })));
  check('1. an interim says which stage', / \(stage 2 of 3\)$/.test(W.invoiceLineText({ windows: 2, doors: 1, report: 'final', stage: { n: 2, of: 3 } })));
  check('1. ...and says the report comes with the final', /report attached to the final invoice\./.test(W.invoiceLineText({ windows: 2, report: 'final' })));
  check('1. an interim with no stage picked says how far', / \(40% complete\)$/.test(W.invoiceLineText({ windows: 2, pct: 40 })));
  check('1. no report, no report sentence', !/report/.test(W.invoiceLineText({ windows: 2, doors: 1, report: false })));

  // ── 2. The report model ──────────────────────────────────────────────────
  const { data, variations } = build();
  const colours = { window: 'Farrow & Ball No. 28 Dead Salmon', door: 'Off-Black' };
  const model = W.workReportModel(data, variations, { colours });
  eq('2. counts from the openings', model.counts, { windows: 19, doors: 3, bays: 0, other: 0 });
  eq('2. every opening is in the report', model.sections.length, 22);
  eq('2. all four sides', model.sides, ['front', 'back', 'left', 'right']);
  const byCode = {};
  model.sections.forEach(s => { byCode[s.opening.id] = s; });
  eq('2. quoted work is not flagged', byCode.f1w2.items.map(i => [i.text, i.onSite]), [['Reputty x3 panes', false], ['Resin repair (cill, medium)', false]]);
  eq('2. an approved site variation is found on site', byCode.b0w1.items.map(i => [i.text, i.onSite]), [['Replace glass x2 panes', true]]);
  eq('2. prep raised on site is found on site', byCode.b0w2.items.map(i => i.onSite), [true]);
  check('2. a repair found bigger than quoted is found on site', byCode.b1w3.items.length === 1 && byCode.b1w3.items[0].onSite && /larger than quoted/.test(byCode.b1w3.items[0].text), byCode.b1w3.items);
  eq('2. pending and declined variation work is not reported', [byCode.r1w1.items.length, byCode.r1w2.items.length], [0, 0]);
  eq('2. work not ticked off is not reported (and is counted)', [byCode.f1w3.items.length, model.unticked], [0, 1]);
  check('2. an opening with only its painting is compact', byCode.f0w2.standard && /2 coats in Farrow & Ball No\. 28 Dead Salmon/.test(byCode.f0w2.paint));
  check('2. doors are painted in the door colour', /Off-Black/.test(byCode.f0d1.paint));
  eq('2. openings with work found on site', model.onSiteOpenings, 4);
  const words = JSON.stringify(model.sections.map(s => [s.label, s.what, s.paint, s.items]));
  check('2. no prices anywhere in the report', !MONEY.test(words), words.match(MONEY));
  // An opening left out of the job isn't reported or counted.
  const ex = build(); ex.data.openings.find(o => o.id === 'f0w1').excluded = true;
  const exModel = W.workReportModel(ex.data, ex.variations, {});
  eq('2. an opening not in the job is left out', [exModel.sections.length, exModel.counts.windows], [21, 18]);

  // ── 3. The PDF ───────────────────────────────────────────────────────────
  const pdf = await renderWorkReportPdf({ model, data, businessName: 'Nicky Hawkins', clientName: 'A Client', address: '1 Test Street, Hove',
                                          completedAt: '2026-09-20T10:00:00Z', invoiceNumber: 'INV-0421' });
  check('3. it is a PDF', pdf.slice(0, 5).toString('latin1') === '%PDF-');
  const raw = pdf.toString('latin1');
  check('3. Barlow is embedded', /\/BaseFont \/[A-Z]{6}\+Barlow-Regular/.test(raw) && /\/FontFile2/.test(raw));
  check('3. no other font is used', !/\/BaseFont \/(Helvetica|Times|Courier)/.test(raw));
  check('3. well under Xero\'s attachment limit (' + Math.round(pdf.length / 1024) + 'KB)', pdf.length < 1024 * 1024 && pdf.length < MAX_BYTES);
  const pages = (raw.match(/\/Type \/Page\b/g) || []).length;
  check('3. more than one page for 22 openings, and not dozens (' + pages + ')', pages >= 2 && pages <= 8);

  // ── 4. Interims ──────────────────────────────────────────────────────────
  const wdLabour = { key: 'windoors:windoors', description: 'Exterior windows and doors (outside faces): 19 sash windows', lineTotal: 2000, pct: 40, prevPct: 0, amount: 800 };
  const room = { key: 'room:r1', description: 'Lounge', lineTotal: 500, pct: 40, prevPct: 0, amount: 200 };
  const hall = { key: 'room:r2', description: 'Hall', lineTotal: 300, pct: 40, prevPct: 0, amount: 120 };
  const wdVar = { key: 'windoors:v1', description: 'Variation: Windows and doors — glass', lineTotal: 150, pct: 100, prevPct: 0, amount: 150 };
  const other = { key: 'room:v2', description: 'Variation: Bedroom', lineTotal: 90, pct: 100, prevPct: 0, amount: 90 };
  const text = 'Exterior windows and doors: preparation and painting of outside faces, 19 windows and 3 doors. (stage 2 of 3)';
  const li = interimInvoiceLineItems({ labour: [room, hall, wdLabour], variations: [wdVar, other], materials: [], windoors: { description: text } });
  eq('4. one windows and doors line, the quote share plus the site additions', li.filter(l => /windows and doors/i.test(l.description)).map(l => [l.description, l.unitAmount]), [[text, 950]]);
  eq('4. the other lines are laid out as before (whole-job % over the rooms)', li.map(l => l.description),
    ['Labour: 40% of quoted works (previously invoiced 0%)', text, 'Variation: Bedroom — complete']);
  near('4. nothing lost or doubled', li.reduce((t, l) => t + l.unitAmount, 0), 800 + 200 + 120 + 150 + 90);
  const li0 = interimInvoiceLineItems({ labour: [room, hall], variations: [other], materials: [] });
  const li0b = interimInvoiceLineItems({ labour: [room, hall], variations: [other], materials: [], windoors: { description: text } });
  eq('4. a job without the fixture is unchanged', li0b, li0);
  const plan = planInterimInvoice({ existing: [], depositTotal: 0, body: {
    idempotencyKey: 'test-key-123', windoorsText: text,
    labour: [Object.assign({ billedBefore: 0 }, wdLabour), Object.assign({ billedBefore: 0 }, room)],
    variations: [{ kind: 'windoors', sourceId: 'v1', description: wdVar.description, lineTotal: 150, pct: 100, prevPct: 0, billedBefore: 0 }],
  } });
  check('4. the server plans it', !plan.error, plan.error);
  if (!plan.error) {
    eq('4. ...as one Xero line', plan.row.lineItems.filter(l => l.description === text).length, 1);
    eq('4. ...with each line still recorded on its own', [plan.row.labourLines.map(l => l.key), plan.row.variationLines.map(l => l.key)], [['windoors:windoors', 'room:r1'], ['windoors:v1']]);
  }

  // ── 5. The Xero attachment ───────────────────────────────────────────────
  const INV = '0f8c2f5e-1111-4222-8333-944445555666';
  const fake = (existing) => {
    const calls = [];
    const http = async (req) => {
      calls.push(req);
      if (req.method === 'get') return { data: { Attachments: existing } };
      return { data: { Attachments: [{ AttachmentID: 'att-1', FileName: 'x' }] } };
    };
    return { http, calls };
  };
  const f1 = fake([]);
  const r1 = await attachPdfOnce({ http: f1.http, accessToken: 't', tenantId: 'tn', invoiceId: INV, fileName: 'Work-Report-INV-0421.pdf', bytes: pdf });
  eq('5. uploaded once, not skipped', [r1.skipped, r1.attachmentId, f1.calls.map(c => c.method)], [false, 'att-1', ['get', 'post']]);
  check('5. IncludeOnline=true, the spec\'s file name, as a PDF', /\/Attachments\/Work-Report-INV-0421\.pdf\?IncludeOnline=true$/.test(f1.calls[1].url) && f1.calls[1].headers['Content-Type'] === 'application/pdf');
  const f2 = fake([{ FileName: 'Work-Report-INV-0421.pdf', AttachmentID: 'att-0' }]);
  const r2 = await attachPdfOnce({ http: f2.http, accessToken: 't', tenantId: 'tn', invoiceId: INV, fileName: 'Work-Report-INV-0421.pdf', bytes: pdf });
  eq('5. a retry finds it already there and uploads nothing', [r2.skipped, r2.attachmentId, f2.calls.map(c => c.method)], [true, 'att-0', ['get']]);
  const f3 = fake(Array.from({ length: 10 }, (_, i) => ({ FileName: 'other' + i + '.pdf' })));
  let refused = null;
  try { await attachPdfOnce({ http: f3.http, accessToken: 't', tenantId: 'tn', invoiceId: INV, fileName: 'Work-Report-INV-0421.pdf', bytes: pdf }); } catch (e) { refused = e.message; }
  check('5. Xero\'s 10-attachment limit is said, not hit', /10 attachments/.test(refused || ''), refused);
  let notPdf = null;
  try { await attachPdfOnce({ http: fake([]).http, accessToken: 't', tenantId: 'tn', invoiceId: INV, fileName: 'a.pdf', bytes: Buffer.from('hello world') }); } catch (e) { notPdf = e.message; }
  check('5. only a PDF is sent', /not a PDF/.test(notPdf || ''));
  eq('5. the scope is read off the token', [hasAttachmentsScope({ scope: 'openid accounting.invoices accounting.attachments' }), hasAttachmentsScope({ scope: 'openid accounting.invoices' }), hasAttachmentsScope(null)], [true, false, false]);
  eq('5. the file name', require('../lib/windoors').workReportFileName('INV-0421'), 'Work-Report-INV-0421.pdf');

  // ── 6. In the app ────────────────────────────────────────────────────────
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);
  const fx = build();
  const app = await page.evaluate((fx) => {
    jobs = [{ id: 'j1', name: '14 Brunswick Square', status: 'completed',
              windoorsVariations: fx.variations.map(v => ({ id: v.id, createdAt: '2026-09-11T09:00:00Z', sentAt: '2026-09-11T10:00:00Z', description: '',
                                                            variationStatus: v.status, variationApprovedAt: v.approvedAt })) }];
    activeJobId = 'j1';
    colours = [{ number: 1, label: 'Dead Salmon', brand: '', code: '' }, { number: 2, label: 'Off-Black', brand: '', code: '' }];
    windoors = { jobId: 'j1', property: Object.assign({ job_id: 'j1' }, fx.data.property), openings: fx.data.openings, marks: fx.data.marks };
    const m = buildFinalInvoiceModel();
    const wd = m.labour.filter(l => l.wd);
    const vars = windoorsVariationLines();
    return {
      wd: wd.map(l => ({ amount: l.amount, quoted: l.quoted, site: l.site })),
      otherWd: m.variations.filter(l => /windows|resin/i.test(l.desc)).length,
      text: wdInvoiceText({ report: 'attached' }),
      pendingRaw: vars.filter(v => v.status === 'pending').reduce((t, v) => t + v.raw, 0),
      approvedRaw: vars.filter(v => v.status === 'approved').reduce((t, v) => t + v.raw, 0),
      adj: wdAdjustments().raw, sPct: (settings.sundriesPct || 0) / 100,
      varMk: (1 + commercialRatio()) * (effectiveMarkupType() === 'fixed' ? 1 : 1 + effectiveMarkup() / 100),
    };
  }, fx);
  eq('6. exactly one windows and doors line on the invoice', [app.wd.length, app.otherWd], [1, 0]);
  if (app.wd.length) {
    const want = (app.approvedRaw + app.pendingRaw + app.adj) * (1 + app.sPct) * app.varMk;
    near('6. its amount is the quote plus every site addition', app.wd[0].amount, app.wd[0].quoted + Math.round(want * 100) / 100);
    check('6. ...never below the quote', app.wd[0].amount >= app.wd[0].quoted);
    check('6. ...and the site additions are there to be billed', app.wd[0].site.amount > 0.005 && app.wd[0].site.pending === 1 && app.wd[0].site.approved === 1, app.wd[0].site);
  }
  eq('6. the counts and colours on the line', app.text,
    'Exterior windows and doors: preparation and painting of outside faces, 19 windows and 3 doors. Full breakdown of work per opening in attached report. Colours: Dead Salmon (frames), Off-Black (doors).');
  const plain = await page.evaluate(() => {
    jobs = [{ id: 'j2', name: 'Plain Job', status: 'completed' }]; activeJobId = 'j2';
    windoors = { jobId: null, property: null, openings: [], marks: [] };
    const m = buildFinalInvoiceModel();
    return { wd: m.labour.filter(l => l.wd).length, hasText: typeof wdReportGoesOn === 'function' ? wdReportGoesOn(Object.assign({ attachWindoorsReport: true }, m)) : null };
  });
  eq('6. a job without the fixture has no windows and doors line, and no report', plain, { wd: 0, hasText: false });
  check('no page errors', errors.length === 0, errors);
  await browser.close();
  srv.close();

  console.log('\n' + pass.length + ' passed');
  pass.forEach(n => console.log('  ✓ ' + n));
  if (fail.length) {
    console.log('\n' + fail.length + ' FAILED');
    fail.forEach(n => console.log('  ✗ ' + n));
    process.exit(1);
  }
  console.log('\nAll good.');
})().catch((e) => { console.error(e); process.exit(1); });
