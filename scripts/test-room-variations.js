#!/usr/bin/env node
'use strict';

// ── Regression test: extra work inside an already-measured room ─────────────
//
// VARIATIONS_SPEC.md Part 2. The live case this exists for: a job is accepted,
// the client then asks for three radiators painting in two rooms that were
// measured and quoted months ago. Typing them into those rooms used to re-price
// the rooms and nothing else — no variation, no chip, no money, and on a frozen
// job no client-facing figure moved at all. The work got done and was never
// billed.
//
// The two properties that matter most here, and the two that are easiest to
// break by accident:
//
//   1. A RATE CHANGE MUST NOT LOOK LIKE EXTRA WORK. The delta is priced by
//      running the engine over the live inputs and over the frozen baseline,
//      both at today's rates, precisely so that moving a rate cancels out. If
//      that ever becomes a stored-£ comparison, every room on every accepted
//      job reports a scope change the next time the day rate moves.
//
//   2. THE AGREED FIGURE MUST NOT MOVE, whatever is decided about the extra.
//      Original scope prices at the baseline whether the delta is unclassified,
//      classified as extra work, or declined by the client.
//
// PREREQUISITES — same as test-accepted-snapshots.js:
//   1. A Postgres database and DATABASE_URL pointing at it (a scratch one).
//   2. The app running against it (DATABASE_URL=... PORT=3199 npm start).
//   3. Playwright:  npm i --no-save playwright
//
// USAGE
//   TEST_BASE_URL=http://localhost:3199 DATABASE_URL=postgres://... \
//     node scripts/test-room-variations.js
//
// Seeds its own fixture job ('roomvar-test') and clears it first, so it is safe
// to re-run.

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
const EXECUTABLE = process.env.CHROMIUM_PATH || undefined;
const JOB_ID = 'roomvar-test';

const pass = [], fail = [];
const check = (name, ok, detail) => (ok ? pass : fail).push(name + (detail ? ' — ' + detail : ''));
const p2 = (n) => Math.round((+n || 0) * 100) / 100;

async function seed(db) {
  await db.query('DELETE FROM job_variations WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM quote_snapshots WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM rooms WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM colours WHERE job_id = $1', [JOB_ID]);
  await db.query('DELETE FROM jobs WHERE id = $1', [JOB_ID]);
  await db.query(`INSERT INTO jobs (id,name,data) VALUES ($1,'Room Variations Test','{}'::jsonb)`, [JOB_ID]);
  await db.query(`INSERT INTO colours (number, job_id, label) VALUES (1,$1,'White')`, [JOB_ID]);
  await db.query(
    `INSERT INTO rooms (id, job_id, name, data) VALUES
       ($1||'-r1',$1,'Lounge', '{"name":"Lounge","emoji":"\u{1F6CB}","l":5,"w":4,"h":2.4,"wc":2,"cc":2,"xc":2,"skirtM":18,"doorQty":1,"frameQty":1,"prepPct":10,"colourNumber":1}'::jsonb),
       ($1||'-r2',$1,'Hallway','{"name":"Hallway","emoji":"\u{1F6AA}","l":6,"w":2,"h":2.4,"wc":2,"cc":2,"xc":2,"skirtM":16,"doorQty":3,"frameQty":3,"prepPct":10,"colourNumber":1}'::jsonb),
       ($1||'-r3',$1,'Master Bedroom','{"name":"Master Bedroom","emoji":"\u{1F6CF}","l":4.2,"w":3.6,"h":2.4,"wc":2,"cc":2,"xc":2,"skirtM":15,"doorQty":1,"frameQty":1,"prepPct":10,"colourNumber":1}'::jsonb)`,
    [JOB_ID]);
  await db.query(
    `INSERT INTO materials_snapshot (id, job_id, data) VALUES
       ($1||'-m1',$1,'{"id":"m1","itemCode":"LG-IM-B-5","description":"Little Greene Intelligent Matt - Band B 5ltr","quantity":3,"unitAmount":78.5,"chargeable":true,"calcQuantity":3}'::jsonb)`,
    [JOB_ID]);
}

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  await seed(db);

  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => fail.push('PAGE ERROR: ' + e.message));

  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof switchJob === 'function' && window.jobs && window.jobs.length, null, { timeout: 30000 });
    await page.evaluate(async (id) => { await switchJob(id); }, JOB_ID);
    await page.waitForFunction((id) => activeJobId === id && window.rooms.length === 3, JOB_ID, { timeout: 20000 });

    // ── Pre-acceptance: the concept does not exist yet ─────────────────────
    const before = await page.evaluate(() => ({
      applies: variationApplies(),
      baselines: rooms.filter(r => r.variationBaseline).length,
      delta: variationDeltaOf('room', rooms[0])
    }));
    check('no baselines before the quote is accepted', before.baselines === 0 && before.applies === false);
    check('no delta without a baseline to measure against', before.delta === null);

    // ── Acceptance freezes the agreed SCOPE beside the agreed money ────────
    await page.evaluate(() => { window.confirm = () => true; setJobStatusById(activeJobId, 'accepted'); });
    await page.waitForFunction(() => rooms.every(r => !!r.variationBaseline), null, { timeout: 20000 });
    const stamped = await page.evaluate(() => ({
      rooms: rooms.map(r => ({ name: r.name, rads: +r.rads || 0, baseRads: +r.variationBaseline.obj.rads || 0 })),
      jobStamp: !!activeJob().variationBaselinesAt,
      nested: rooms.some(r => !!(r.variationBaseline.obj && r.variationBaseline.obj.variationBaseline))
    }));
    check('every room is baselined at acceptance', stamped.rooms.length === 3 && stamped.jobStamp);
    check('a baseline never nests a baseline inside itself', stamped.nested === false);

    // ── The live case: radiators into an already-measured room ─────────────
    const agreedBefore = await page.evaluate(() => frozenQuoteTotal(activeJob()));
    const added = await page.evaluate(() => {
      const tcAll = () => rooms.reduce((t, r) => t + calcRoom(r).total, 0);
      rooms[0].rads = 1.5;
      const v = computeVariationsView();
      return {
        raw: Math.round(variationDeltaOf('room', rooms[0]).raw * 100) / 100,
        otherRoom: variationDeltaOf('room', rooms[1]),
        unclassified: v.unclassifiedDeltas.map(u => u.name),
        variationsTotal: v.variationsTotal,
        pending: v.pendingCount,
        tcOrig: Math.round((tcAll() - v.varLabourAll) * 100) / 100,
        baselineStillClean: +rooms[0].variationBaseline.obj.rads || 0
      };
    });
    check('adding radiators to a measured room produces a delta', added.raw > 0, `£${added.raw} raw`);
    check('a room that was not touched has no delta', added.otherRoom === null);
    check('the delta is UNCLASSIFIED until somebody says what it is',
      added.unclassified.length === 1 && added.unclassified[0] === 'Lounge');
    check('an unclassified extra is billed nowhere', added.variationsTotal === 0);
    check('an unclassified extra still counts as pending work', added.pending === 1);
    check('pricing the baseline does not rewrite it (calcRoom mutates its argument)',
      added.baselineStillClean === 0);
    const tcOrigBaseline = added.tcOrig;

    // ── THE property: a rate change is not extra work ──────────────────────
    const rates = await page.evaluate(() => {
      const wasRate = settings.dr;
      const before = variationDeltaOf('room', rooms[1]);
      settings.dr = wasRate * 2;
      settings.rWall = (+settings.rWall || 10) * 3;
      const after = variationDeltaOf('room', rooms[1]);
      // The touched room's delta must still be JUST the radiators, re-priced.
      const touched = variationDeltaOf('room', rooms[0]);
      settings.dr = wasRate;
      settings.rWall = (+settings.rWall) / 3;
      return { before, after, touchedStillOnlyRadiators: !!touched };
    });
    check('doubling the day rate does not invent a delta on an untouched room',
      rates.before === null && rates.after === null);
    check('the touched room still reports its own change after a rate move',
      rates.touchedStillOnlyRadiators === true);

    // ── Classify as extra work ─────────────────────────────────────────────
    const classified = await page.evaluate(() => {
      const tcAll = () => rooms.reduce((t, r) => t + calcRoom(r).total, 0);
      classifyVariationDelta('room', rooms[0].id, 'extra');
      const v = computeVariationsView();
      return {
        lines: v.varLines.map(l => ({ name: l.name, kind: l.kind, status: l.status })),
        total: Math.round(v.variationsTotal * 100) / 100,
        unclassified: v.unclassifiedDeltas.length,
        tcOrig: Math.round((tcAll() - v.varLabourAll) * 100) / 100,
        chip: deltaChipHtml('room', rooms[0]),
        published: buildClientVariationLines().map(l => ({ kind: l.kind, desc: l.description }))
      };
    });
    check('classifying it makes a variation line',
      classified.lines.length === 1 && /extra work/.test(classified.lines[0].name));
    check('the line is its own kind, not the carrier’s',
      classified.lines[0].kind === 'roomdelta');
    check('it arrives Pending, awaiting the client', classified.lines[0].status === 'pending');
    check('it is now worth money', classified.total > 0, `£${classified.total}`);
    check('and is no longer an open question', classified.unclassified === 0);
    check('the room gets an EXTRA chip, never a VARIATION one',
      /\+ EXTRA/.test(classified.chip) && !/>VARIATION/.test(classified.chip));
    check('it publishes under a kind that cannot collide with a whole-room variation',
      classified.published.length === 1 && classified.published[0].kind === 'roomdelta');

    // ── THE other property: the agreed figure never moves ──────────────────
    const declined = await page.evaluate(() => {
      const tcAll = () => rooms.reduce((t, r) => t + calcRoom(r).total, 0);
      rooms[0].variationStatus = 'declined';
      const v = computeVariationsView();
      const out = { total: v.variationsTotal, tcOrig: Math.round((tcAll() - v.varLabourAll) * 100) / 100 };
      rooms[0].variationStatus = 'pending';
      return out;
    });
    const agreedAfter = await page.evaluate(() => frozenQuoteTotal(activeJob()));
    check('original scope holds at the baseline while the extra is unclassified',
      tcOrigBaseline === classified.tcOrig, `${tcOrigBaseline} vs ${classified.tcOrig}`);
    check('...and once it is classified as extra work',
      classified.tcOrig === tcOrigBaseline);
    check('...and when the client declines it',
      declined.tcOrig === tcOrigBaseline, `${declined.tcOrig} vs ${tcOrigBaseline}`);
    check('a declined extra is worth nothing', declined.total === 0);
    check('the AGREED total never moved through any of it',
      Math.abs(agreedAfter - agreedBefore) < 0.005, `${agreedBefore} -> ${agreedAfter}`);

    // ── The final invoice bills it once, separately ────────────────────────
    const invoice = await page.evaluate(() => {
      const m = buildFinalInvoiceModel();
      return {
        labour: m.labour.map(l => ({ d: l.desc, a: Math.round(l.amount * 100) / 100 })),
        vars: m.variations.map(v => ({ d: v.desc, a: Math.round(v.amount * 100) / 100, dropped: v.dropped }))
      };
    });
    const lounge = invoice.labour.find(l => /Lounge/.test(l.d));
    check('the room’s own invoice line does not grow with the extra',
      !!lounge && lounge.a > 0, lounge ? `Lounge £${lounge.a}` : 'no Lounge line');
    check('the extra bills as its own variation line',
      invoice.vars.some(v => /Lounge — extra work/.test(v.d) && !v.dropped));

    // ── Sign-off, and a figure that moves after it ─────────────────────────
    const signoff = await page.evaluate(() => {
      window.prompt = () => 'agreed by text';
      approveVariation('roomdelta', rooms[0].id);
      const atSignoff = p2(rooms[0].variationApprovedRaw);
      const cleanNow = variationSignoffDrift('roomdelta', rooms[0]);
      rooms[0].rads = 2.0;                       // a fourth radiator, after the yes
      const moved = variationSignoffDrift('roomdelta', rooms[0]);
      return {
        stamped: atSignoff, cleanNow, moved: !!moved,
        stillApproved: variationStatusOf(rooms[0]) === 'approved',
        warns: /Changed since sign-off/.test(variationsCardHtml(computeVariationsView()))
      };
      function p2(n) { return Math.round((+n || 0) * 100) / 100; }
    });
    check('approving stamps the figure that was agreed', signoff.stamped > 0);
    check('nothing looks wrong at the moment of sign-off', signoff.cleanNow === null);
    check('editing the room afterwards is detected', signoff.moved === true);
    check('the client’s answer is NOT silently thrown away', signoff.stillApproved === true);
    check('the card says the figure changed since sign-off', signoff.warns === true);

    // ── A correction bills nothing and re-agrees the scope ─────────────────
    const corrected = await page.evaluate(() => {
      classifyVariationDelta('room', rooms[0].id, 'correction');
      const v = computeVariationsView();
      return {
        lines: v.varLines.length, unclassified: v.unclassifiedDeltas.length,
        total: v.variationsTotal,
        recorded: !!rooms[0].variationBaselineCorrectedAt,
        delta: variationDeltaOf('room', rooms[0])
      };
    });
    check('a correction bills nothing', corrected.total === 0 && corrected.lines === 0);
    check('a correction leaves no open question', corrected.unclassified === 0 && corrected.delta === null);
    check('a correction is RECORDED, not just an absence of one', corrected.recorded === true);

    // ── Amending absorbs the extras into the new revision ──────────────────
    const amended = await page.evaluate(() => {
      rooms[0].rads = 3;
      classifyVariationDelta('room', rooms[0].id, 'extra');
      amendAcceptedQuote();
      const html = document.getElementById('schedule-sheet').innerHTML;
      document.getElementById('amend-note').value = 'took on the radiators';
      confirmAmendAcceptedQuote();
      return { warned: /This absorbs 1 extra/.test(html) };
    });
    check('the amend sheet warns what it is about to absorb', amended.warned === true);
    await page.waitForFunction(() => window.quoteSnapshots.length === 2, null, { timeout: 20000 });
    const afterAmend = await page.evaluate(() => {
      const v = computeVariationsView();
      return { lines: v.varLines.length, unclassified: v.unclassifiedDeltas.length,
               delta: variationDeltaOf('room', rooms[0]),
               rebaselined: +rooms[0].variationBaseline.obj.rads || 0 };
    });
    check('amending re-baselines the room at its current scope', afterAmend.rebaselined === 3);
    check('and the extra stops being extra', afterAmend.lines === 0 && afterAmend.delta === null);

    // ── A classified extra that shrinks back is no longer extra ───────────
    const shrank = await page.evaluate(() => {
      rooms[1].rads = 2;
      classifyVariationDelta('room', rooms[1].id, 'extra');
      const wasBilled = buildFinalInvoiceModel().variations.some(v => /Hallway/.test(v.desc));
      // Now shrink it decisively below its baseline. Halving the room's length
      // is the unambiguous way: removing doors would not do it, because a door
      // is a hole in the wall -- take it out and the wall area it was covering
      // comes back, which costs more than painting the door saved.
      rooms[1].rads = 0; rooms[1].l = 3;
      const v = computeVariationsView();
      return {
        wasBilled,
        stillClassified: v.varLines.some(l => /Hallway/.test(l.name)),
        backToAQuestion: v.unclassifiedDeltas.some(u => u.name === 'Hallway'),
        // The invoice must bill what is measured now, not the old baseline.
        pricesLive: !buildFinalInvoiceModel().variations.some(v2 => /Hallway/.test(v2.desc))
      };
    });
    check('an extra that shrinks back below its baseline stops being billed',
      shrank.wasBilled === true && shrank.pricesLive === true);
    check('...and goes back to being an open question',
      shrank.stillClassified === false && shrank.backToAQuestion === true);

    // ── A new extra never inherits an old sign-off ─────────────────────────
    const inherited = await page.evaluate(() => {
      rooms[1].doorQty = 3;
      classifyVariationDelta('room', rooms[1].id, 'extra');
      window.prompt = () => '';
      approveVariation('roomdelta', rooms[1].id);
      const approved = variationStatusOf(rooms[1]);
      // Rule it a correction, then let it grow again: the new extra is new.
      classifyVariationDelta('room', rooms[1].id, 'correction');
      rooms[1].rads = 4;
      classifyVariationDelta('room', rooms[1].id, 'extra');
      return { approved, after: variationStatusOf(rooms[1]),
               noStaleFigure: rooms[1].variationApprovedRaw == null };
    });
    check('a corrected-then-regrown extra arrives Pending, not Approved',
      inherited.approved === 'approved' && inherited.after === 'pending');
    check('and carries no stale agreed figure', inherited.noStaleFigure === true);

    // ── The publish round trip actually reaches the server ────────────────
    // buildClientVariationLines() being right in memory is not enough: the
    // server validates source_kind against a whitelist and rejects the WHOLE
    // payload on an unknown one, so a missing kind takes Send for approval
    // down for the job rather than dropping a line.
    const published = await page.evaluate(async (id) => {
      const lines = buildClientVariationLines();
      const res = await fetch('/api/jobs/' + encodeURIComponent(id) + '/client-variations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines })
      });
      return { status: res.status, kinds: lines.map(l => l.kind), body: await res.text() };
    }, JOB_ID);
    check('publishing a delta line is accepted by the server',
      published.status === 200, `HTTP ${published.status} ${published.body.slice(0, 120)}`);
    check('it publishes under its own source kind',
      published.kinds.some(k => /delta$/.test(k)), published.kinds.join(','));
    const rows = await db.query('SELECT source_kind FROM job_variations WHERE job_id=$1', [JOB_ID]);
    check('and reaches the database under that kind',
      rows.rows.some(r => /delta$/.test(r.source_kind)),
      rows.rows.map(r => r.source_kind).join(',') || 'no rows');

    // ── A save that changes nothing must report nothing ───────────────────
    // The room form rebuilds the whole room object from the DOM, filling in
    // every field it knows about. A room stored before a field existed lacks
    // the key, calcRoom reads a missing key as zero/off, and the form then
    // supplies a non-empty default — so opening a room and saving it with NO
    // edit priced it differently and read as extra work. £36.93 on a room with
    // doors and no stored doorCoats.
    const noop = await page.evaluate(() => {
      goTab('home');
      editRoom(rooms[2].id);          // Master Bedroom, untouched so far
      saveRoom();
      return { sheetOpen: document.getElementById('schedule-sheet-backdrop').style.display === 'block',
               delta: variationDeltaOf('room', rooms[2]),
               unclassified: computeVariationsView().unclassifiedDeltas.map(u => u.name) };
    });
    check('opening a room and saving it unchanged reports no extra work',
      noop.delta === null, noop.delta);
    check('...and throws no sheet at you', noop.sheetOpen === false);
    check('...and leaves no open question on the card',
      !noop.unclassified.includes('Master Bedroom'), noop.unclassified.join(','));

    // The guard: ROOM_SHAPE_DEFAULTS is a second copy of what the form writes,
    // and this file's recurring bug is a second copy drifting from the first.
    // Re-derive the form's real defaults and fail if the list has fallen behind.
    // Asks the question that matters rather than listing key names: for every
    // non-empty default the form writes, does REMOVING it from a room change
    // what that room costs? If it does and it is not in ROOM_SHAPE_DEFAULTS,
    // that field can produce a phantom delta and the list has fallen behind.
    const drift = await page.evaluate(() => {
      goTab('home'); goScreen('room');       // a blank form
      const blank = buildRoomFromForm();
      goBack();
      // A realistic room to test each field against: doors and frames present,
      // so the coat defaults actually bite.
      const probe = Object.assign({}, blank, { l: 4, w: 3, h: 2.4, doorQty: 1, frameQty: 1 });
      const full = calcRoom(JSON.parse(JSON.stringify(probe))).total;
      const missing = [];
      Object.keys(blank).forEach(k => {
        if (k === 'id' || k === 'name' || k in ROOM_SHAPE_DEFAULTS) return;
        const v = blank[k];
        const empty = v === 0 || v === false || v === '' || v === null || v === undefined
          || (Array.isArray(v) && v.length === 0);
        if (empty) return;
        const without = JSON.parse(JSON.stringify(probe));
        delete without[k];
        if (Math.abs(calcRoom(without).total - full) > 0.005) missing.push(k + '=' + JSON.stringify(v));
      });
      return missing;
    });
    check('no default the form writes can move a room\u2019s price from outside ROOM_SHAPE_DEFAULTS',
      drift.length === 0, drift.join(', '));

    // And the whole point: normalising must not swallow a REAL change.
    const stillReal = await page.evaluate(() => {
      goTab('home');
      editRoom(rooms[2].id);
      document.getElementById('r-rads').value = '1.6';
      saveRoom();
      const d = variationDeltaOf('room', rooms[2]);
      closeScheduleSheet();
      return d && Math.round(d.raw * 100) / 100;
    });
    check('but a room that genuinely gains radiators still reports it',
      stillReal > 0, stillReal);
    // Put the room back as it was — the declined-amend test below uses it.
    await page.evaluate(() => {
      rooms[2].rads = 0;
      classifyVariationDelta('room', rooms[2].id, 'correction');
      closeScheduleSheet();
    });
    await page.waitForTimeout(400);

    // ── A room that lost its baseline heals itself ────────────────────────
    // The job-level stamp and the rooms are two separate writes to two
    // different tables. They can come apart — the job PUT lands, the rooms PUT
    // is lost to a dead spot — leaving a job marked "baselined" whose rooms
    // carry none. Keyed on the job flag, nothing ever healed that, so no room
    // on the job could report a delta again, silently and permanently.
    // Reported from the field: adding radiators did nothing at all.
    const healed = await page.evaluate(async () => {
      // Strip the baselines the way a lost rooms-write would, flag intact.
      rooms.forEach(r => { delete r.variationBaseline; r.variationDelta = false; });
      saveRooms();
      const before = { flag: !!activeJob().variationBaselinesAt,
                       baselined: rooms.filter(r => r.variationBaseline).length };
      goTab('summary'); renderSummary();
      return { before, after: rooms.filter(r => r.variationBaseline).length };
    });
    check('a job whose rooms lost their baselines is detected despite the flag',
      healed.before.flag === true && healed.before.baselined === 0, healed.before);
    check('and every room gets one back', healed.after === 3, healed.after);

    // ...and the feature works again from there.
    const worksAgain = await page.evaluate(() => {
      // Add to whatever the healed baseline just froze, so this is an increase
      // whatever earlier steps left on the room.
      rooms[1].rads = (+rooms[1].rads || 0) + 1.4;
      const d = variationDeltaOf('room', rooms[1]);
      return { delta: d && Math.round(d.raw * 100) / 100 };
    });
    check('a delta is reported again once healed', worksAgain.delta > 0, worksAgain);

    // Healing must never touch a carrier that already has a baseline — doing so
    // would re-stamp at today's scope and forgive a real extra.
    const preserved = await page.evaluate(() => {
      const keptAt = rooms[1].variationBaseline.at;
      delete rooms[0].variationBaseline;           // only ONE room loses it
      saveRooms(); renderSummary();
      return { otherRoomUntouched: rooms[1].variationBaseline.at === keptAt,
               stillSeesDelta: !!variationDeltaOf('room', rooms[1]),
               missingOneHealed: !!rooms[0].variationBaseline };
    });
    check('healing one room leaves the others\u2019 baselines exactly as they were',
      preserved.otherRoomUntouched === true && preserved.missingOneHealed === true, preserved);
    check('so an extra already recorded against another room is not forgiven',
      preserved.stillSeesDelta === true);

    // ── A DECLINED extra survives an amend rather than being absorbed ─────
    // Amending re-agrees the current scope, and the extra is still measured on
    // the job -- the radiators are typed into the room. Folding a declined one
    // in would bill work the client said no to, and the absorb warning would
    // never mention it, because that warning filters declined lines out.
    const declinedAmend = await page.evaluate(async () => {
      rooms[2].rads = 2.5;
      classifyVariationDelta('room', rooms[2].id, 'extra');
      rooms[2].variationStatus = 'declined';
      const baseBefore = JSON.stringify(rooms[2].variationBaseline.obj.rads || 0);
      const snapNow = buildAcceptedQuoteSnapshot(activeJob());
      const masterLine = (snapNow.lines.work || []).find(l => /Master Bedroom/.test(l.description));
      const warn = classifiedDeltaSummary(activeJob());
      amendAcceptedQuote();
      document.getElementById('amend-note').value = 'unrelated change';
      confirmAmendAcceptedQuote();
      return { baseBefore, warnNames: warn.names,
               masterAmount: masterLine ? masterLine.lineTotal : null };
    });
    await page.waitForTimeout(1500);
    const afterDeclinedAmend = await page.evaluate(() => ({
      baseAfter: JSON.stringify(rooms[2].variationBaseline.obj.rads || 0),
      stillDeclined: variationStatusOf(rooms[2]) === 'declined' && rooms[2].variationDelta === true,
      notBilled: !buildFinalInvoiceModel().variations.some(v => /Master Bedroom/.test(v.desc) && !v.dropped)
    }));
    // Other extras on this job ARE being absorbed, legitimately -- what must
    // not appear in that list is the one the client refused.
    check('a declined extra is not counted in what an amend absorbs',
      !declinedAmend.warnNames.includes('Master Bedroom'), declinedAmend.warnNames.join(',') || 'none');
    check('a declined extra is not priced into the new revision',
      declinedAmend.baseBefore === '0' && afterDeclinedAmend.baseAfter === '0');
    check('a declined extra survives the amend, still declined',
      afterDeclinedAmend.stillDeclined === true);
    check('and is still billed nowhere', afterDeclinedAmend.notBilled === true);

    // ── Un-accepting withdraws the acceptance, not the record ─────────────
    await page.evaluate(() => { window.confirm = () => true; setJobStatusById(activeJobId, null); });
    await page.waitForFunction(() => jobQuoteIsFrozen(activeJob()) === false, null, { timeout: 20000 });
    const unaccepted = await page.evaluate(() => ({
      keptBaselines: rooms.every(r => !!r.variationBaseline),
      keptSnapshots: quoteSnapshots.length,
      conceptGone: variationApplies() === false
    }));
    // The snapshot deliberately survives un-accept, so the agreed SCOPE has to
    // as well. Clearing it made the round trip destructive: re-accepting
    // captured no new revision (a snapshot already existed) but re-baselined
    // every room at today's scope, absorbing classified extras into "original
    // scope" with none of the warning amendAcceptedQuote() gives.
    check('un-accepting keeps the agreed scope, exactly as it keeps the record',
      unaccepted.keptBaselines === true && unaccepted.keptSnapshots > 0);
    check('but the concept does not apply while the job is not accepted',
      unaccepted.conceptGone === true);

    await page.evaluate(() => { window.confirm = () => true; setJobStatusById(activeJobId, 'accepted'); });
    await page.waitForFunction(() => jobQuoteIsFrozen(activeJob()) === true, null, { timeout: 20000 });
    const reaccepted = await page.evaluate(() => ({
      stillHasExtra: computeVariationsView().varLines.some(l => /extra work/.test(l.name))
    }));
    check('re-accepting does not silently absorb the extras', reaccepted.stillHasExtra === true);

  } catch (err) {
    console.error('E2E harness error:', err);
    fail.push('harness: ' + err.message);
  } finally {
    await browser.close();
    await db.end();
  }

  if (pass.length) {
    console.log(`\nPASS (${pass.length})`);
    pass.forEach((n) => console.log('  ✓ ' + n));
  }
  if (fail.length) {
    console.error(`\nFAIL (${fail.length})`);
    fail.forEach((n) => console.error('  ✗ ' + n));
    console.error('\nExtra work added inside a measured room is money that gets done and never billed.');
    console.error('If a change here is deliberate, change this check with it and say why in the commit.\n');
    process.exit(1);
  }
  console.log('\nAll room-variation checks passed.');
})();
