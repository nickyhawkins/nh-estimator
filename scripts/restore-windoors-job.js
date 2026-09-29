#!/usr/bin/env node
'use strict';

// ── Put one job's Windows and doors back from a restored copy of the database ─
//
// Before v2.88.2, changing the house type (period, form or roof) DELETED the
// windows and doors on any side the new house didn't have, and the dormers
// under a parapet, with every mark on them. The app now hides them instead;
// this script is for a job that lost them before that.
//
// You need a copy of the database from before the change: a Render
// point-in-time recovery (Dashboard -> the database -> Recovery, which makes a
// NEW database at the time you choose; your live one is untouched), or a
// pg_dump restored somewhere. This reads that copy and puts back, into the
// live database, only what the live job is missing:
//
//   job_openings    every window/door/bay/other item in the copy whose id the
//                   live job doesn't have (and whose slot is free)
//   opening_marks   every mark in the copy whose id the live job doesn't have,
//                   on an opening that exists once the above is done
//   job_property    the house as it was in the copy (appearance + style), and
//                   the layout of each side (and each side's dormers) that the
//                   live job has lost. The live coats, colours, paint products
//                   and default prep are left alone.
//
// Nothing that exists in the live job is changed or deleted: work marked since
// the copy was taken stays. Nothing outside these three tables is touched
// (quotes, invoices, variations' sign-offs are all on the job and stay as
// they are). The on-site variations the restored marks belong to come back on
// the Variations card by themselves (v2.88.1's recovery) if they're missing.
//
// It PREVIEWS by default. Nothing is written without --apply, and then it's
// one transaction: all of it or none of it.
//
// USAGE
//   FROM_DATABASE_URL=<the restored copy> DATABASE_URL=<live> \
//     node scripts/restore-windoors-job.js --job "14 Brunswick Square"
//   ...same, with --apply to write it
//
//   --job   the job's name exactly as the app shows it, or its id
//   --keep-house   leave the live house type (appearance) as it is

const { Client } = require('pg');

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const FROM = opt('--from') || process.env.FROM_DATABASE_URL;
const TO = opt('--to') || process.env.DATABASE_URL;
const JOB = opt('--job');
const APPLY = flag('--apply');
const KEEP_HOUSE = flag('--keep-house');

if (!FROM || !TO || !JOB) {
  console.error('Needs FROM_DATABASE_URL (the restored copy), DATABASE_URL (live) and --job "<name or id>".');
  process.exit(2);
}
if (FROM === TO) { console.error('FROM and TO are the same database -- point FROM at the restored copy.'); process.exit(2); }

const ssl = url => /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
const connect = async url => { const c = new Client({ connectionString: url, ssl: ssl(url) }); await c.connect(); return c; };

async function findJob(db, key) {
  const r = await db.query('SELECT id, name FROM jobs WHERE id = $1 OR name = $1', [key]);
  return r.rows;
}
async function columns(db, table) {
  const r = await db.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table]);
  return new Set(r.rows.map(x => x.column_name));
}
const label = o => o.side + ' ' + (o.level === 'roof' ? 'dormer' : o.level === 'lower_ground' ? 'lower ground' : 'floor ' + o.floor)
  + ' ' + (o.kind === 'door' ? 'D' : o.kind === 'bay' ? 'B' : o.kind === 'other' ? 'O' : 'W') + o.position
  + (o.parent_opening_id ? ' (bay window)' : '') + (o.nickname ? ' "' + o.nickname + '"' : '');

(async () => {
  const src = await connect(FROM), dst = await connect(TO);
  try {
    const sj = await findJob(src, JOB), dj = await findJob(dst, JOB);
    if (sj.length !== 1 || dj.length !== 1) {
      console.error('The job must match exactly one job in each database. Copy: ' + sj.length + ', live: ' + dj.length + '.');
      [...sj, ...dj].forEach(j => console.error('  ' + j.id + '  ' + j.name));
      process.exit(1);
    }
    if (sj[0].id !== dj[0].id) { console.error('The job has a different id in the copy (' + sj[0].id + ') and live (' + dj[0].id + ') -- not the same job.'); process.exit(1); }
    const jobId = dj[0].id;
    console.log('Job: ' + dj[0].name + ' (' + jobId + ')\n');

    const read = async db => ({
      property: (await db.query('SELECT * FROM job_property WHERE job_id = $1', [jobId])).rows[0] || null,
      openings: (await db.query('SELECT * FROM job_openings WHERE job_id = $1', [jobId])).rows,
      marks: (await db.query('SELECT * FROM opening_marks WHERE job_id = $1', [jobId])).rows,
    });
    const from = await read(src), to = await read(dst);
    if (!from.property) { console.log('The copy has no Windows and doors for this job. Nothing to restore.'); return; }

    // Openings the live job is missing, whose slot is still free.
    const liveIds = new Set(to.openings.map(o => o.id));
    const slot = o => [o.side, o.level, o.floor, o.kind, o.position].join('|');
    const liveSlots = new Set(to.openings.map(slot));
    const openings = [], slotTaken = [];
    from.openings.forEach(o => {
      if (liveIds.has(o.id)) return;
      if (liveSlots.has(slot(o))) slotTaken.push(o); else openings.push(o);
    });
    const willExist = new Set([...liveIds, ...openings.map(o => o.id)]);
    const liveMarkIds = new Set(to.marks.map(m => m.id));
    const marks = from.marks.filter(m => !liveMarkIds.has(m.id) && willExist.has(m.opening_id));

    // The house: the copy's appearance, and each side's layout the live job lost.
    const fl = from.property.layout || {}, tl = (to.property && to.property.layout) || {};
    const layout = Object.assign({}, tl);
    const layoutBack = [];
    Object.keys(fl).forEach(side => {
      if (!tl[side]) { layout[side] = fl[side]; layoutBack.push(side + ' (whole side)'); }
      else if (fl[side] && fl[side].roof && !tl[side].roof) { layout[side] = Object.assign({}, tl[side], { roof: fl[side].roof }); layoutBack.push(side + ' dormers'); }
    });
    const houseBack = !KEEP_HOUSE && JSON.stringify(from.property.appearance || null) !== JSON.stringify((to.property && to.property.appearance) || null);

    console.log('Windows and doors to put back: ' + openings.length);
    openings.forEach(o => console.log('  + ' + label(o)));
    if (slotTaken.length) {
      console.log('\nIn the copy but NOT put back, because the live job has a different opening in that place now: ' + slotTaken.length);
      slotTaken.forEach(o => console.log('  ! ' + label(o)));
    }
    const byAction = {};
    marks.forEach(m => { const k = m.action_key + (m.stage === 'variation' ? ' (variation)' : ''); byAction[k] = (byAction[k] || 0) + 1; });
    console.log('\nMarked work to put back: ' + marks.length + (marks.length ? ' -- ' + Object.keys(byAction).map(k => k + ' x' + byAction[k]).join(', ') : ''));
    console.log('Side layouts to put back: ' + (layoutBack.length ? layoutBack.join(', ') : 'none'));
    console.log('House type: ' + (houseBack ? 'back to ' + JSON.stringify({ period: from.property.appearance && from.property.appearance.period, form: from.property.appearance && from.property.appearance.form, roof: from.property.appearance && from.property.appearance.roof }) : 'unchanged'));

    if (!openings.length && !marks.length && !layoutBack.length && !houseBack) { console.log('\nNothing is missing. Nothing to do.'); return; }
    if (!APPLY) { console.log('\nPreview only -- nothing written. Run again with --apply to put it back.'); return; }

    const oCols = [...await columns(dst, 'job_openings')].filter(c => from.openings.length === 0 || c in from.openings[0]);
    const mCols = [...await columns(dst, 'opening_marks')].filter(c => from.marks.length === 0 || c in from.marks[0]);
    const insert = async (table, cols, row, conflict) => {
      const vals = cols.map(c => row[c]);
      await dst.query('INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map((_, i) => '$' + (i + 1)).join(', ') + ') ' + conflict, vals);
    };
    await dst.query('BEGIN');
    try {
      // Bays before their windows, so nothing points at a row that isn't there.
      const ordered = openings.filter(o => !o.parent_opening_id).concat(openings.filter(o => o.parent_opening_id));
      for (const o of ordered) await insert('job_openings', oCols, o, 'ON CONFLICT DO NOTHING');
      for (const m of marks) await insert('opening_marks', mCols, m, 'ON CONFLICT (id) DO NOTHING');
      if (to.property) {
        await dst.query('UPDATE job_property SET layout = $2' + (houseBack ? ', appearance = $3, style = $4' : '') + ', updated_at = NOW() WHERE job_id = $1',
          houseBack ? [jobId, layout, from.property.appearance, from.property.style] : [jobId, layout]);
      } else {
        const pCols = [...await columns(dst, 'job_property')].filter(c => c in from.property);
        await insert('job_property', pCols, from.property, 'ON CONFLICT (job_id) DO NOTHING');
      }
      await dst.query('COMMIT');
    } catch (err) {
      await dst.query('ROLLBACK');
      throw err;
    }
    console.log('\nDone. Open the job in the app (pull to refresh, or reopen it) and check each side.');
  } finally {
    await src.end(); await dst.end();
  }
})().catch(err => { console.error('Failed, nothing was changed: ' + err.message); process.exit(1); });
