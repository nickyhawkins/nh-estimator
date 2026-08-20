#!/usr/bin/env node
'use strict';

// ── Regression test: accepted quotes must not move ──────────────────────────
//
// Drives the REAL app in a real browser against a real database, and proves
// the one thing the whole accepted-snapshot feature exists for: after a quote
// is accepted, changing the rates must not change a single figure the client
// agreed to — on Summary, on their copy of the quote, in the PDF, or on the
// final invoice.
//
// The central check doubles the day rate, halves wall coverage and adds 25
// points of markup, then asserts that the LIVE figure moves (so the test is
// actually exercising something) while every agreed figure stays put. If this
// file ever fails, accepted quotes have started drifting again.
//
// PREREQUISITES — this is not part of `npm start` and needs three things:
//   1. A Postgres database and DATABASE_URL pointing at it (a scratch one:
//      the test writes jobs, rooms and snapshots into it).
//   2. The app running against that database
//      (DATABASE_URL=... PORT=3199 npm start).
//   3. Playwright, which is not a project dependency:  npm i --no-save playwright
//
// USAGE
//   TEST_BASE_URL=http://localhost:3199 DATABASE_URL=postgres://... \
//     node scripts/test-accepted-snapshots.js
//
// It seeds its own fixture job ('snapshot-test') and clears it first, so it is
// safe to re-run.

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('This test needs Playwright, which is not a project dependency.');
  console.error('  npm i --no-save playwright');
  process.exit(2);
}
const { Client } = require('pg');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3199';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL is required — point it at a scratch database, not production.'); process.exit(2); }
// Playwright's bundled Chromium, or the one this environment already has.
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const JOB_ID = 'snapshot-test';

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (detail ? ' — ' + detail : ''));

// The fixture: two ordinary rooms and two priced material lines. Nothing
// exotic — the bug was never exotic.
async function seed(db) {
  await db.query('DELETE FROM quote_snapshots WHERE job_id = ANY($1)', [[JOB_ID, JOB_ID + '-legacy']]);
  await db.query('DELETE FROM rooms WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM colours WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM jobs WHERE id = ANY($1)', [[JOB_ID, JOB_ID + '-legacy']]);
  await db.query(`INSERT INTO jobs (id,name,data) VALUES ($1,'Snapshot Test','{}'::jsonb)`, [JOB_ID]);
  await db.query(`INSERT INTO colours (number, job_id, label) VALUES (1,$1,'White')`, [JOB_ID]);
  await db.query(
    `INSERT INTO rooms (id, job_id, name, data) VALUES
       ($1||'-r1',$1,'Lounge', '{"name":"Lounge","emoji":"\u{1F6CB}","l":5,"w":4,"h":2.4,"wc":2,"cc":2,"xc":2,"skirtM":18,"doorQty":1,"frameQty":1,"prepPct":10,"colourNumber":1}'::jsonb),
       ($1||'-r2',$1,'Hallway','{"name":"Hallway","emoji":"\u{1F6AA}","l":6,"w":2,"h":2.4,"wc":2,"cc":2,"xc":2,"skirtM":16,"doorQty":3,"frameQty":3,"prepPct":10,"colourNumber":1}'::jsonb)`,
    [JOB_ID]);
  await db.query(
    `INSERT INTO materials_snapshot (id, job_id, data) VALUES
       ($1||'-m1',$1,'{"id":"m1","itemCode":"LG-IM-B-5","description":"Little Greene Intelligent Matt - Band B 5ltr","quantity":3,"unitAmount":78.5,"chargeable":true,"calcQuantity":3}'::jsonb),
       ($1||'-m2',$1,'{"id":"m2","itemCode":"TIK-H30-A-27","description":"Tikkurila Helmi 30 - Band A 2.7ltr","quantity":2,"unitAmount":52,"chargeable":true,"calcQuantity":2}'::jsonb)`,
    [JOB_ID]);
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await seed(db);

  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => fail.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Wait only for the app to be up and to have LOADED its jobs list -- not for
  // rooms. Which job it opens on first load is whatever localStorage or the
  // server's updated_at ordering says, and on a fresh database that is not the
  // fixture; requiring rooms here would time out rather than fail a check.
  // Pointing it at the fixture and reloading is what makes the state definite.
  await page.waitForFunction(() => typeof window.renderSummary === 'function'
    && Array.isArray(window.jobs) && window.jobs.length > 0, null, { timeout: 20000 });
  await page.evaluate((j) => { activeJobId = j; localStorage.setItem('pe-active-job-id', j); }, JOB_ID);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.rooms && window.rooms.length === 2 && window.materialsSnapshot && window.materialsSnapshot.length === 2, null, { timeout: 20000 });

  // Render Summary so lastSummaryTotals is populated, exactly as tapping the tab does.
  const live = await page.evaluate(() => { renderSummary(); return lastSummaryTotals; });
  check('live summary produces a total', live && live.estQuoteTotal > 0, 'live total ' + (live && live.estQuoteTotal));

  // ── Accept ────────────────────────────────────────────────────────────────
  await page.evaluate((j) => { setJobStatusById(j, 'accepted'); }, JOB_ID);
  await page.waitForFunction(() => window.quoteSnapshots && window.quoteSnapshots.length === 1 && !window.quoteSnapshots[0].unsynced, null, { timeout: 15000 });

  const snap = await page.evaluate(() => JSON.parse(JSON.stringify(latestQuoteSnapshot(activeJob()))));
  check('snapshot captured at v1', snap.version === 1 && snap.reconciliationLevel === 'full');
  check('snapshot has work line items', (snap.data.lines.work || []).length > 0, (snap.data.lines.work || []).length + ' lines');
  check('snapshot has materials breakdown', (snap.data.materials.lines || []).length === 2);
  check('snapshot has materials working (tins)', (snap.data.materials.working || []).length > 0);
  check('snapshot records labour mode', !!snap.data.labour.mode, snap.data.labour.mode);
  check('snapshot records day rate', snap.data.labour.dayRate > 0, String(snap.data.labour.dayRate));
  check('snapshot records markup', snap.data.markup.value != null, JSON.stringify(snap.data.markup));
  check('snapshot records VAT triple', snap.data.totals.vatRegistered === false && snap.data.totals.vat === 0 && snap.data.totals.incVat === snap.data.totals.exVat);
  check('snapshot records the rates in force', snap.data.rates && snap.data.rates.dr > 0 && Array.isArray(snap.data.rates.coverageRates));
  const agreed = snap.data.totals.incVat;
  check('snapshot total matches the live total at acceptance', Math.abs(agreed - live.estQuoteTotal) < 0.02, `${agreed} vs ${live.estQuoteTotal}`);

  const ties = await page.evaluate(() => {
    const d = latestQuoteSnapshot(activeJob()).data;
    const sum = (rows) => Math.round(rows.reduce((t, r) => t + r.lineTotal, 0) * 100) / 100;
    return {
      labour: sum(d.lines.work) === d.totals.labour,
      materials: sum(d.lines.materials) === d.totals.materials,
      grand: Math.round((d.totals.labour + d.totals.materials + d.totals.importedBaseline) * 100) / 100 === d.totals.incVat,
      quoteModel: d.quote.total === d.totals.incVat,
      workSubtotal: !d.quote.work || d.quote.work.subtotal === d.totals.labour
    };
  });
  check('snapshot lines sum EXACTLY to its totals',
    ties.labour && ties.materials && ties.grand, JSON.stringify(ties));
  check('the client-facing model agrees with the totals to the penny',
    ties.quoteModel && ties.workSubtotal, JSON.stringify(ties));

  const persisted = await db.query('SELECT version, reconciliation_level, note FROM quote_snapshots WHERE job_id=$1', [JOB_ID]);
  check('snapshot reached the database', persisted.rows.length === 1 && persisted.rows[0].note === 'accepted');

  // ── THE ACTUAL BUG: change the rates and confirm the agreed figure holds ──
  await page.evaluate(() => {
    settings.dr = settings.dr * 2;            // day rate doubled
    settings.cw = settings.cw / 2;            // wall coverage halved (twice the paint)
    settings.mu = settings.mu + 25;           // markup up 25 points
    localStorage.setItem('pe-settings', JSON.stringify(settings));
    renderSummary();
  });
  const afterDrift = await page.evaluate(() => ({
    frozen: frozenQuoteTotal(activeJob()),
    liveNow: lastSummaryTotals.estQuoteTotal,
    heroText: document.querySelector('#sum-data .hero-amount').textContent,
    heroLabel: document.querySelector('#sum-data .hero-label').textContent,
    bodyHasDriftNote: document.getElementById('sum-data').innerHTML.includes('today’s rates')
  }));
  check('rate change moved the LIVE figure (so the test is real)',
    Math.abs(afterDrift.liveNow - live.estQuoteTotal) > 1, `${live.estQuoteTotal} -> ${afterDrift.liveNow}`);
  check('AGREED figure did NOT move after the rate change',
    Math.abs(afterDrift.frozen - agreed) < 0.005, `${agreed} -> ${afterDrift.frozen}`);
  check('Summary hero shows the AGREED total, not the live one',
    afterDrift.heroText.replace(/[^0-9.]/g, '') === agreed.toFixed(2), `hero "${afterDrift.heroText}", agreed ${agreed}`);
  check('Summary hero is labelled as the accepted quote', afterDrift.heroLabel.includes('Accepted'), afterDrift.heroLabel);
  check('Summary discloses the live figure as an aside', afterDrift.bodyHasDriftNote);

  // ── Home and Summary must never disagree ──────────────────────────────────
  // They read different sources by design: Summary the snapshot, Home the
  // cached headline on the job (because Home also renders jobs whose snapshot
  // isn't loaded). A snapshot written by anything other than an in-app
  // acceptance left that cache stale, and the same job then showed two
  // different totals on two screens.
  const twoScreens = await page.evaluate(() => {
    // Simulate a snapshot written behind the app's back — the Xero
    // reconciliation migration, or another device.
    const j = activeJob();
    j.acceptedSnapshot = Object.assign({}, j.acceptedSnapshot, { estQuoteTotal: 9999.99 });
    syncAcceptedSnapshotHeadline(j.id);
    renderDash(); renderSummary();
    const home = (document.getElementById('dash-body').innerText.match(/£[\d,]+\.\d\d/) || [''])[0];
    const hero = document.querySelector('#sum-data .hero-amount');
    return { home, summary: hero ? hero.textContent.trim() : '(none)', cache: activeJob().acceptedSnapshot.estQuoteTotal };
  });
  check('a stale cached headline heals when the job loads', twoScreens.cache !== 9999.99, 'cache = ' + twoScreens.cache);
  check('Home and Summary show the SAME total',
    twoScreens.home === twoScreens.summary, `Home ${twoScreens.home} vs Summary ${twoScreens.summary}`);

  // ── Client-facing quote + PDF read the snapshot ───────────────────────────
  const quoteDoc = await page.evaluate(() => {
    openClientQuote();
    const m = clientQuoteModel;
    const html = document.getElementById('client-quote-frame').srcdoc;
    closeClientQuote();
    return { frozen: m.frozen, revision: m.revision, total: m.total, note: m.frozenNote,
             htmlHasAgreed: html.includes('do not change with later price revisions'),
             htmlHasLivePreviewWording: html.includes('Figures are live as of this preview'),
             filename: quotePdfFilename(m) };
  });
  check('client quote preview renders from the snapshot', quoteDoc.frozen === true && quoteDoc.revision === 1);
  check('client quote total is EXACTLY the agreed total', quoteDoc.total === agreed, `${quoteDoc.total} vs ${agreed}`);
  check('client quote footer states the figures are fixed', quoteDoc.htmlHasAgreed && !quoteDoc.htmlHasLivePreviewWording);
  check('PDF filename names the revision, not today', /accepted-rev1\.pdf$/.test(quoteDoc.filename), quoteDoc.filename);

  const pdfOk = await page.evaluate(async () => {
    openClientQuote();
    const bytes = await buildClientQuotePdf(clientQuoteModel);
    closeClientQuote();
    return { size: bytes.length, header: String.fromCharCode.apply(null, bytes.slice(0, 5)) };
  });
  check('PDF builds from the frozen model', pdfOk.header === '%PDF-' && pdfOk.size > 1000, `${pdfOk.size} bytes`);

  // ── Final invoice bills the agreed labour, not a re-calculation ───────────
  const invoice = await page.evaluate(() => {
    const m = buildFinalInvoiceModel();
    return { labour: m.labour.map(l => ({ desc: l.desc, amount: Math.round(l.amount * 100) / 100 })),
             sundriesLine: m.sundries.amount };
  });
  const invLabourTotal = invoice.labour.reduce((s, l) => s + l.amount, 0);
  const snapLabour = snap.data.totals.labour;
  check('final invoice labour is EXACTLY the agreed labour (no penny drift)',
    Math.round(invLabourTotal * 100) === Math.round(snapLabour * 100), `invoice ${invLabourTotal.toFixed(2)} vs agreed ${snapLabour}`);
  check('final invoice does not double-charge sundries (it is already a frozen work row)',
    invoice.sundriesLine === 0, 'separate sundries line = ' + invoice.sundriesLine);
  check('the frozen work rows include the agreed sundries line',
    invoice.labour.some(l => /Sundries/i.test(l.desc)), invoice.labour.map(l => l.desc).join(' | '));

  // ── Amend appends a revision and keeps the original ───────────────────────
  await page.evaluate(() => { window.prompt = () => 'added the study'; window.confirm = () => true; });
  await page.evaluate(() => amendAcceptedQuote());
  await page.waitForFunction(() => window.quoteSnapshots.length === 2 && !window.quoteSnapshots[0].unsynced, null, { timeout: 15000 });
  const revs = await page.evaluate(() => quoteSnapshots.map(s => ({ v: s.version, note: s.note, total: s.data.totals.incVat })));
  check('amend created revision 2', revs.length === 2 && revs[0].v === 2 && /added the study/.test(revs[0].note));
  check('revision 1 is unchanged and still readable', revs[1].v === 1 && Math.abs(revs[1].total - agreed) < 0.005);
  check('revision 2 is priced at the NEW rates', revs[0].total > revs[1].total, `${revs[1].total} -> ${revs[0].total}`);
  const newHero = await page.evaluate(() => { renderSummary(); return document.querySelector('#sum-data .hero-amount').textContent; });
  check('client-facing view defaults to the latest revision',
    newHero.replace(/[^0-9.]/g, '') === revs[0].total.toFixed(2), `${newHero} vs ${revs[0].total}`);

  const dbRevs = await db.query('SELECT version, note FROM quote_snapshots WHERE job_id=$1 ORDER BY version', [JOB_ID]);
  check('both revisions persisted, original intact', dbRevs.rows.length === 2 && dbRevs.rows[0].note === 'accepted');

  // ── Snapshots are immutable in memory ─────────────────────────────────────
  const frozenCheck = await page.evaluate(() => {
    const s = latestQuoteSnapshot(activeJob());
    const before = s.data.totals.incVat;
    try { s.data.totals.incVat = 1; } catch (e) { /* strict mode throws */ }
    try { s.data.lines.work.push({ description: 'sneaky', lineTotal: 99 }); } catch (e) {}
    return { unchanged: s.data.totals.incVat === before, frozen: Object.isFrozen(s.data.totals) };
  });
  check('a render path cannot mutate a snapshot', frozenCheck.unchanged && frozenCheck.frozen);

  // ── Un-accepting returns to live but keeps the record ─────────────────────
  await page.evaluate((j) => { window.confirm = () => true; setJobStatusById(j, null); }, JOB_ID);
  const afterDraft = await page.evaluate(() => ({
    frozen: jobQuoteIsFrozen(activeJob()),
    stillHasRows: quoteSnapshots.length,
    hero: document.querySelector('#sum-data .hero-label').textContent
  }));
  check('un-accepting resumes live pricing', afterDraft.frozen === false && !afterDraft.hero.includes('Accepted'));
  check('un-accepting does NOT destroy the record', afterDraft.stillHasRows === 2);
  const dbAfter = await db.query('SELECT count(*)::int AS n FROM quote_snapshots WHERE job_id=$1', [JOB_ID]);
  check('the database still holds both revisions', dbAfter.rows[0].n === 2);

  // ── An accepted job with no snapshot is called out, not hidden ────────────
  await db.query(`INSERT INTO jobs (id,name,data) VALUES ($1,'Legacy Job','{"status":"accepted","acceptedAt":"2026-01-05T00:00:00.000Z"}'::jsonb)`, [JOB_ID + '-legacy']);
  const legacy = await page.evaluate(async (id) => {
    jobs.push({ id: id, name: 'Legacy Job', status: 'accepted', acceptedAt: '2026-01-05T00:00:00.000Z' });
    activeJobId = id;
    await loadQuoteSnapshots(id);
    const j = jobs.find(x => x.id === id);
    return { needs: jobQuoteNeedsSnapshot(j), frozen: jobQuoteIsFrozen(j), banner: acceptedQuoteBannerHtml(j) };
  }, JOB_ID + '-legacy');
  check('accepted-with-no-snapshot is detected', legacy.needs === true && legacy.frozen === false);
  check('accepted-with-no-snapshot warns that figures are live',
    legacy.banner.includes('live, not frozen') && legacy.banner.includes('TODAY'));

  await browser.close();
  await db.end();

  console.log('\nPASS (' + pass.length + ')');
  pass.forEach(p => console.log('  ✓ ' + p));
  if (fail.length) {
    console.log('\nFAIL (' + fail.length + ')');
    fail.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nAll accepted-quote freeze checks passed.');
})().catch((e) => { console.error('E2E harness error:', e); process.exit(1); });
