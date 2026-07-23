const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const router = express.Router();

// Every per-job resource below (rooms, exterior items, colours, materials)
// requires a job_id — on GET/DELETE-collection it's a query param
// (?job_id=X), on PUT it's `jobId` in the body (the client already sends
// the full object there). Hard-required: client and server ship from the
// same repo/deploy, so there's no version skew to soften for. The real
// risk — a DB that hasn't had db/setup.sql re-run yet — is handled by
// initApp() isolating these fetches in their own try/catch, not by
// making job_id optional here.
function requireJobId(req, res) {
  const jobId = req.query.job_id || (req.body && req.body.jobId);
  if (!jobId) { res.status(400).json({ error: 'job_id is required' }); return null; }
  return jobId;
}

// Transactional replace-all, shared by the four bulk PUT collection routes
// below (rooms / extitems / colours / materials). The client's save*()
// functions used to DELETE the whole collection then PUT each row as
// separate requests — O(rows) round trips per edit, and a PUT dropping
// after the DELETE landed left the server's copy empty until the next full
// save (the localStorage mirror was the only recovery). Here the whole new
// set lands or nothing changes.
//
// created_at is set to clock_timestamp() per row, NOT the default NOW():
// NOW() is the transaction timestamp, identical for every row in the loop,
// and the GET routes order by created_at ASC — all-tied timestamps would
// make list order nondeterministic. clock_timestamp() advances within the
// transaction, so the client's array order is preserved exactly.
//
// NB material_actuals is deliberately NOT given a bulk replace-all route —
// see the save-strategy comment on the actuals section below; a
// transaction would make it safe, but one-row-per-PUT keeps the invoice's
// blast radius at a single row and there's no N-row save path to speed up.
async function replaceAllRows(res, jobId, table, rows, insertRow) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${table} WHERE job_id = $1`, [jobId]);
    for (const row of rows) await insertRow(client, row);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

// ── Jobs ───────────────────────────────────────────────────────────────────
// Global list of jobs. Fully separate — no duplicate-as-template. Each job
// owns its own rooms/exterior_items/colours/materials_snapshot rows below.

router.get('/jobs', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, data, updated_at FROM jobs ORDER BY updated_at DESC');
    const jobs = result.rows.map(j => ({ id: j.id, name: j.name, updatedAt: j.updated_at, ...j.data }));
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/jobs', async (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
  try {
    await db.query('INSERT INTO jobs (id, name) VALUES ($1, $2)', [id, name]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/jobs/:id', async (req, res) => {
  const { id } = req.params;
  const { name, ...data } = req.body;
  try {
    await db.query(`
      UPDATE jobs SET name = COALESCE($2, name), data = $3, updated_at = NOW() WHERE id = $1
    `, [id, name || null, data]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletes the job and every row that belongs to it. No FK/transaction —
// matches the existing DELETE /all route's shape and risk tolerance
// (this schema has zero foreign keys anywhere today).
router.delete('/jobs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Child tables concurrently (no FKs, fully independent), then the job
    // row itself last so a failure part-way never leaves an orphaned job id
    // pointing at half-deleted children.
    await Promise.all([
      db.query('DELETE FROM rooms WHERE job_id = $1', [id]),
      db.query('DELETE FROM exterior_items WHERE job_id = $1', [id]),
      db.query('DELETE FROM colours WHERE job_id = $1', [id]),
      db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [id]),
      db.query('DELETE FROM material_actuals WHERE job_id = $1', [id]),
      db.query('DELETE FROM labour_log WHERE job_id = $1', [id]),
    ]);
    await db.query('DELETE FROM jobs WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Rooms ──────────────────────────────────────────────────────────────────

// Get all rooms for a job
router.get('/rooms', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    const result = await db.query('SELECT id, name, data FROM rooms WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
    const rooms = result.rows.map(r => ({ id: r.id, name: r.name, ...r.data }));
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a room (create or update)
router.put('/rooms/:id', async (req, res) => {
  const { id } = req.params;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const room = req.body;
  const { name, jobId: _drop, ...data } = room;
  try {
    await db.query(`
      INSERT INTO rooms (id, job_id, name, data, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET job_id = $2, name = $3, data = $4, updated_at = NOW()
    `, [id, jobId, name || 'Room', data]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replace a job's entire room list in one transaction (see replaceAllRows)
router.put('/rooms', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  const rows = req.body && req.body.rooms;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rooms array is required' });
  await replaceAllRows(res, jobId, 'rooms', rows, (client, room) => {
    const { id, name, jobId: _drop, ...data } = room;
    return client.query(
      'INSERT INTO rooms (id, job_id, name, data, created_at, updated_at) VALUES ($1, $2, $3, $4, clock_timestamp(), NOW())',
      [id, jobId, name || 'Room', data]
    );
  });
});

// Delete a room (id is already globally unique, no job_id needed)
router.delete('/rooms/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all rooms for a job
router.delete('/rooms', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    await db.query('DELETE FROM rooms WHERE job_id = $1', [jobId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Exterior Items ─────────────────────────────────────────────────────────

router.get('/extitems', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    const result = await db.query('SELECT id, label, data FROM exterior_items WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
    const items = result.rows.map(r => ({ id: r.id, label: r.label, ...r.data }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/extitems/:id', async (req, res) => {
  const { id } = req.params;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const item = req.body;
  const { label, jobId: _drop, ...data } = item;
  try {
    await db.query(`
      INSERT INTO exterior_items (id, job_id, label, data, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO UPDATE SET job_id = $2, label = $3, data = $4, updated_at = NOW()
    `, [id, jobId, label || 'Exterior', data]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replace a job's entire exterior-item list in one transaction (see replaceAllRows)
router.put('/extitems', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  const rows = req.body && req.body.items;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'items array is required' });
  await replaceAllRows(res, jobId, 'exterior_items', rows, (client, item) => {
    const { id, label, jobId: _drop, ...data } = item;
    return client.query(
      'INSERT INTO exterior_items (id, job_id, label, data, created_at, updated_at) VALUES ($1, $2, $3, $4, clock_timestamp(), NOW())',
      [id, jobId, label || 'Exterior', data]
    );
  });
});

router.delete('/extitems/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM exterior_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/extitems', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    await db.query('DELETE FROM exterior_items WHERE job_id = $1', [jobId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Colours ────────────────────────────────────────────────────────────────
// Job-scoped list of {number, label, brand, code} — number is only unique
// WITHIN a job (see colours_job_number_uniq in db/setup.sql), so every
// route here needs job_id, including the single-number routes.

router.get('/colours', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    const result = await db.query('SELECT number, label, brand, code FROM colours WHERE job_id = $1 ORDER BY number ASC', [jobId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/colours/:number', async (req, res) => {
  const number = +req.params.number;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const { label, brand, code } = req.body;
  try {
    await db.query(`
      INSERT INTO colours (number, job_id, label, brand, code, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (job_id, number) DO UPDATE SET label = $3, brand = $4, code = $5, updated_at = NOW()
    `, [number, jobId, label || '', brand || '', code || '']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replace a job's entire colour list in one transaction (see replaceAllRows).
// No created_at handling needed here — colours order by number, not date.
router.put('/colours', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  const rows = req.body && req.body.colours;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'colours array is required' });
  await replaceAllRows(res, jobId, 'colours', rows, (client, c) => {
    return client.query(
      'INSERT INTO colours (number, job_id, label, brand, code, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [+c.number, jobId, c.label || '', c.brand || '', c.code || '']
    );
  });
});

router.delete('/colours/:number', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    await db.query('DELETE FROM colours WHERE job_id = $1 AND number = $2', [jobId, +req.params.number]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/colours', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    await db.query('DELETE FROM colours WHERE job_id = $1', [jobId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Colour reference library ──────────────────────────────────────────────
// Global, permanent lookup — NOT job-scoped, never cleared by Clear Rooms/
// Clear Everything. Seeded once (db/seed-colour-library.js), grows as
// unmatched colours are saved on first use from the Colours tab.

router.get('/colour-library', async (req, res) => {
  try {
    const result = await db.query('SELECT name, brand, code FROM colour_library ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/colour-library', async (req, res) => {
  const { name, brand, code } = req.body;
  if (!name || !brand) return res.status(400).json({ error: 'name and brand are required' });
  try {
    await db.query(`
      INSERT INTO colour_library (name, brand, code)
      VALUES ($1, $2, $3)
      ON CONFLICT (name, brand) DO UPDATE SET code = $3
    `, [name, brand, code || '']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Materials snapshot ────────────────────────────────────────────────────
// Job-scoped, editable list of priced material lines for the current quote
// — same lifecycle as rooms/exterior items, not a permanent setting.

router.get('/materials', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    const result = await db.query('SELECT id, data FROM materials_snapshot WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
    const lines = result.rows.map(r => ({ id: r.id, ...r.data }));
    res.json(lines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/materials/:id', async (req, res) => {
  const { id } = req.params;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const { id: _dropId, jobId: _dropJobId, ...data } = req.body;
  try {
    await db.query(`
      INSERT INTO materials_snapshot (id, job_id, data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (id) DO UPDATE SET job_id = $2, data = $3, updated_at = NOW()
    `, [id, jobId, data]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replace a job's entire materials snapshot in one transaction (see replaceAllRows)
router.put('/materials', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  const rows = req.body && req.body.lines;
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'lines array is required' });
  await replaceAllRows(res, jobId, 'materials_snapshot', rows, (client, line) => {
    const { id, jobId: _drop, ...data } = line;
    return client.query(
      'INSERT INTO materials_snapshot (id, job_id, data, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), NOW())',
      [id, jobId, data]
    );
  });
});

router.delete('/materials/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM materials_snapshot WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/materials', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    await db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [jobId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Material actuals ──────────────────────────────────────────────────────
// Job-scoped log of what was really BOUGHT, against materials_snapshot's
// estimate of what should be needed. See MATERIAL_TRACKING_SPEC.md.
//
// THE SAVE STRATEGY IS DELIBERATELY NOT THE SNAPSHOT'S. saveMaterialsSnapshot()
// does DELETE(whole job) then re-PUTs every line — safe there only because the
// snapshot regenerates from rooms at the touch of Recalculate. Actuals are the
// INVOICE and regenerate from nothing: a failure between that DELETE and the
// re-PUTs would destroy them silently. So there is no collection-level "replace
// all" route here on purpose. One row per PUT, delete one row at a time.
//
// A row is a PRODUCT, not an estimate line — one row per item_code per job,
// enforced by the partial unique index in db/setup.sql. The ON CONFLICT below
// targets that index rather than the primary key, so a client that PUTs a fresh
// uid() for an item already logged updates that row instead of failing.

router.get('/actuals', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    const result = await db.query(
      `SELECT id, item_code, description, actual_quantity, unit_amount, bought
         FROM material_actuals WHERE job_id = $1 ORDER BY created_at ASC`,
      [jobId]
    );
    // Numerics come back from pg as strings — cast at the boundary so the
    // client never has to think about it (it multiplies these by prices).
    res.json(result.rows.map(r => ({
      id: r.id,
      itemCode: r.item_code,
      description: r.description,
      actualQuantity: r.actual_quantity == null ? 0 : +r.actual_quantity,
      unitAmount: r.unit_amount == null ? null : +r.unit_amount,
      bought: r.bought,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/actuals/:id', async (req, res) => {
  const { id } = req.params;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const { itemCode, description, actualQuantity, unitAmount, bought } = req.body;
  if (!description) return res.status(400).json({ error: 'description is required' });
  try {
    // Empty string -> NULL: a free-text row has no code, and '' would defeat
    // the partial unique index (it's only partial on NULL), letting two
    // free-text rows collide as one product.
    const code = itemCode || null;
    const result = await db.query(`
      INSERT INTO material_actuals (id, job_id, item_code, description, actual_quantity, unit_amount, bought, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (job_id, item_code) WHERE item_code IS NOT NULL
      DO UPDATE SET description = $4, actual_quantity = $5, unit_amount = $6, bought = $7, updated_at = NOW()
      RETURNING id
    `, [id, jobId, code, description, +actualQuantity || 0, unitAmount == null || unitAmount === '' ? null : +unitAmount, !!bought]);
    // Report the id that actually holds the row: on conflict the server keeps
    // the original, so a client PUTting a new uid() for an already-logged item
    // would otherwise hold an id that matches nothing.
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/actuals-freetext/:id', async (req, res) => {
  // Free-text rows (item_code NULL) can't use the ON CONFLICT above — the
  // partial index doesn't cover them, so there's nothing to conflict on and
  // every PUT would insert a duplicate. They key on the primary key instead.
  const { id } = req.params;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const { description, actualQuantity, unitAmount, bought } = req.body;
  if (!description) return res.status(400).json({ error: 'description is required' });
  try {
    await db.query(`
      INSERT INTO material_actuals (id, job_id, item_code, description, actual_quantity, unit_amount, bought, updated_at)
      VALUES ($1, $2, NULL, $3, $4, $5, $6, NOW())
      ON CONFLICT (id) DO UPDATE SET description = $3, actual_quantity = $4, unit_amount = $5, bought = $6, updated_at = NOW()
    `, [id, jobId, description, +actualQuantity || 0, unitAmount == null || unitAmount === '' ? null : +unitAmount, !!bought]);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/actuals/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM material_actuals WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Labour log ────────────────────────────────────────────────────────────
// Job-scoped, one row per DATE on site (days = person-days). The labour
// half of actuals -- see CALIBRATION_SPEC.md Phase A. Same save strategy as
// material_actuals and for the same reason: this is history that regenerates
// from nothing, so no collection-level replace-all, one row per PUT, and the
// PUT upserts on (job_id, work_date) so re-logging a day edits it rather
// than double-counting it.

router.get('/labour', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    // to_char, not the raw DATE: pg hands DATE back as a JS Date at server-
    // local midnight, and serialising that through JSON/toISOString can
    // shift it a day depending on the server's timezone. The string can't.
    const result = await db.query(
      `SELECT id, to_char(work_date, 'YYYY-MM-DD') AS work_date, days, note
         FROM labour_log WHERE job_id = $1 ORDER BY work_date ASC`,
      [jobId]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      workDate: r.work_date,
      days: r.days == null ? 0 : +r.days,
      note: r.note || '',
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/labour/:id', async (req, res) => {
  const { id } = req.params;
  const jobId = requireJobId(req, res); if (!jobId) return;
  const { workDate, days, note } = req.body;
  if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return res.status(400).json({ error: 'workDate (YYYY-MM-DD) is required' });
  }
  try {
    const result = await db.query(`
      INSERT INTO labour_log (id, job_id, work_date, days, note, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (job_id, work_date)
      DO UPDATE SET days = $4, note = $5, updated_at = NOW()
      RETURNING id
    `, [id, jobId, workDate, +days || 0, note || '']);
    // Same id-adoption contract as /actuals: on conflict the server keeps
    // the row that already holds this date, and the client adopts its id.
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/labour/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM labour_log WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────
// Global — not job-scoped.

router.get('/settings', async (req, res) => {
  try {
    const result = await db.query('SELECT data FROM settings WHERE id = 1');
    res.json(result.rows[0]?.data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    await db.query(
      'UPDATE settings SET data = $1, updated_at = NOW() WHERE id = 1',
      [req.body]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bank holidays (gov.uk) ─────────────────────────────────────────────────
// One shared fetch of https://www.gov.uk/bank-holidays.json, cached in
// memory for a day (the file changes a few times a year). Trimmed to
// {division: [{date, title}]} — the client only needs dates and names.
// Two consumers: GET /api/bank-holidays (the Schedule calendar) and the
// ICS feed's working-day walk below, so both sides skip the same days.
// A failed fetch keeps serving the stale cache if one exists, else the
// endpoint 503s and everything degrades to "no holidays known" — the
// pre-holiday behaviour, never an error the user sees.
const BANK_HOLIDAY_DIVISIONS = ['england-and-wales', 'scotland', 'northern-ireland'];
let bankHolidayCache = { at: 0, divisions: null };
async function getBankHolidays() {
  if (bankHolidayCache.divisions && Date.now() - bankHolidayCache.at < 24 * 60 * 60 * 1000) {
    return bankHolidayCache.divisions;
  }
  try {
    const axios = require('axios');
    const resp = await axios.get('https://www.gov.uk/bank-holidays.json', { timeout: 10000 });
    const divisions = {};
    for (const div of BANK_HOLIDAY_DIVISIONS) {
      const events = resp.data && resp.data[div] && Array.isArray(resp.data[div].events)
        ? resp.data[div].events : null;
      if (!events) throw new Error('unexpected gov.uk shape');
      divisions[div] = events.map((e) => ({ date: e.date, title: e.title }));
    }
    bankHolidayCache = { at: Date.now(), divisions };
  } catch (err) {
    // Keep any stale cache; only bump `at` so a dead gov.uk isn't hit on
    // every request (retry at most every 10 minutes).
    if (bankHolidayCache.divisions) bankHolidayCache.at = Date.now() - 24 * 60 * 60 * 1000 + 10 * 60 * 1000;
  }
  return bankHolidayCache.divisions;
}

router.get('/bank-holidays', async (req, res) => {
  const divisions = await getBankHolidays();
  if (!divisions) return res.status(503).json({ error: 'bank holidays unavailable' });
  res.json(divisions);
});

// ── Schedule ICS feed (SCHEDULING_SPEC.md) ─────────────────────────────────
// One all-day multi-day VEVENT per scheduled accepted job, so jobs land in
// the phone's real calendar via a subscribed-calendar URL instead of the
// app growing calendar UI. iOS calendar subscriptions can't carry the
// app's session cookie, so the URL's ?key token (generated client-side
// when the Settings toggle is first enabled) IS the auth — and the whole
// endpoint 404s until icsEnabled, so nothing is exposed by default.
//
// Server-side twin of the client's working-day walk (isWorkingDay/
// workingDaySpan in public/index.html) — the two MUST agree on which days
// a job occupies: Sundays never count, Saturdays only when workSaturdays
// (job-level override wins over the setting), and bank holidays (v1.16.0)
// are skipped. `holidays` is a Set of ISO dates for the settings region —
// pass an empty Set when gov.uk is unreachable, which matches the client's
// own no-data fallback.
function icsWorkingDaySpan(startIso, n, workSat, holidays) {
  const out = [];
  const p = startIso.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  let guard = 0;
  while (out.length < n && guard++ < 800) {
    const day = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (((day >= 1 && day <= 5) || (workSat && day === 6)) && !(holidays && holidays.has(iso))) {
      out.push(iso);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso) => iso.replace(/-/g, '');

router.get('/schedule.ics', async (req, res) => {
  try {
    const settingsResult = await db.query('SELECT data FROM settings WHERE id = 1');
    const s = settingsResult.rows[0]?.data || {};
    // 404 (not 401/403) on any auth failure: an unauthenticated probe
    // learns nothing about whether the feed exists.
    if (!s.icsEnabled || !s.icsKey || req.query.key !== s.icsKey) return res.status(404).end();

    const jobsResult = await db.query('SELECT id, name, data FROM jobs');
    const events = [];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    // Same region default as the client's mergeSettings — keep in sync.
    const divisions = await getBankHolidays();
    const region = s.bankHolidayRegion || 'england-and-wales';
    const holidays = new Set(((divisions && divisions[region]) || []).map((e) => e.date));
    // Nicky's own blocked days (v1.17.0) join the skip set — same walker rules.
    for (const iso of Object.keys(s.blockedDays || {})) holidays.add(iso);
    for (const row of jobsResult.rows) {
      const d = row.data || {};
      if (d.status !== 'accepted' || !d.startDate || !(+d.scheduledDays > 0)) continue;
      const workSat = d.workSaturdays != null ? !!d.workSaturdays : !!s.workSaturdays;
      const span = icsWorkingDaySpan(d.startDate, Math.ceil(+d.scheduledDays), workSat, holidays);
      if (!span.length) continue;
      // DTEND is exclusive per RFC 5545: the day after the last booked day.
      const p = span[span.length - 1].split('-');
      const end = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
      end.setUTCDate(end.getUTCDate() + 1);
      // Event title: "job name — scheduleTitle" when a title was typed at
      // scheduling time (per Nicky 2026-07-22 — the title extends the name,
      // it doesn't replace it); otherwise name — client, EXCEPT when
      // they're the same text (job names are usually the client name,
      // which read as "Smith — Smith" before this dedupe).
      const title = (d.scheduleTitle && String(d.scheduleTitle).trim()) || '';
      const client = (d.xeroClient || '').trim();
      const sameName = client && client.toLowerCase() === String(row.name || '').trim().toLowerCase();
      const summary = title
        ? row.name + ' — ' + title
        : row.name + (client && !sameName ? ' — ' + client : '');
      events.push(
        'BEGIN:VEVENT',
        `UID:${row.id}@nh-estimator`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(span[0])}`,
        `DTEND;VALUE=DATE:${icsDate(end.toISOString().slice(0, 10))}`,
        `SUMMARY:${icsEscape(summary)}`,
        'END:VEVENT'
      );
    }
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//NH Estimator//Schedule//EN',
      'X-WR-CALNAME:NH Jobs',
      ...events,
      'END:VCALENDAR'
    ];
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(lines.join('\r\n') + '\r\n');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Clear all (within a job) ────────────────────────────────────────────────

router.delete('/all', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    // Actuals go too: this is "clear ALL data in this job", the user has
    // confirmed "cannot be undone", and leaving them would strand an invoice
    // log against an estimate that no longer exists. NB this is the ONLY route
    // that clears actuals wholesale, and it's user-confirmed. clearJob()
    // (rooms/colours/snapshot only) deliberately leaves them alone —
    // destroying the estimate must never destroy the invoice.
    await Promise.all([
      db.query('DELETE FROM rooms WHERE job_id = $1', [jobId]),
      db.query('DELETE FROM exterior_items WHERE job_id = $1', [jobId]),
      db.query('DELETE FROM colours WHERE job_id = $1', [jobId]),
      db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [jobId]),
      db.query('DELETE FROM material_actuals WHERE job_id = $1', [jobId]),
      db.query('DELETE FROM labour_log WHERE job_id = $1', [jobId]),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Backup (export-all / import) ────────────────────────────────────────
// See BACKUP_SPEC.md for the full design/reasoning. Two properties that
// matter for both routes below:
//   - Export is a plain read across every job, not per-job -- one query per
//     TABLE (grouped by job_id in memory), not one query per table per job.
//   - Import is ADDITIVE ONLY: every re-imported job (and everything under
//     it) gets a brand-new id, so nothing from a backup file can ever
//     collide with or overwrite a row already in the database. Worst case
//     of importing the same file twice is a duplicate-looking job, never
//     lost data. No transaction wraps the import loop (matches this file's
//     existing convention -- see DELETE /jobs/:id's comment on why; the
//     blast radius here is even smaller than that route's, since a partial
//     failure mid-import can only leave an incomplete NEW job behind, never
//     touch anything that already existed).

router.get('/backup/export', async (req, res) => {
  try {
    const settingsResult = await db.query('SELECT data FROM settings WHERE id = 1');
    const libraryResult = await db.query('SELECT name, brand, code FROM colour_library ORDER BY name ASC');
    const jobsResult = await db.query('SELECT id, name, data FROM jobs ORDER BY updated_at DESC');
    const roomsResult = await db.query('SELECT id, job_id, name, data FROM rooms ORDER BY created_at ASC');
    const extResult = await db.query('SELECT id, job_id, label, data FROM exterior_items ORDER BY created_at ASC');
    const coloursResult = await db.query('SELECT job_id, number, label, brand, code FROM colours ORDER BY job_id ASC, number ASC');
    const materialsResult = await db.query('SELECT id, job_id, data FROM materials_snapshot ORDER BY created_at ASC');
    const actualsResult = await db.query(
      `SELECT id, job_id, item_code, description, actual_quantity, unit_amount, bought
         FROM material_actuals ORDER BY created_at ASC`
    );
    // Additive field on the v1 shape (jobs[].labourLog) -- import tolerates
    // its absence, so pre-labour-log backup files stay importable and the
    // version stays 1. to_char for the same timezone reason as GET /labour.
    const labourResult = await db.query(
      `SELECT id, job_id, to_char(work_date, 'YYYY-MM-DD') AS work_date, days, note
         FROM labour_log ORDER BY work_date ASC`
    );

    // One pass per table to bucket rows by job_id, rather than filtering
    // each job's rows out of the full result N times.
    const byJob = (rows) => rows.reduce((acc, r) => {
      (acc[r.job_id] = acc[r.job_id] || []).push(r);
      return acc;
    }, {});
    const roomsByJob = byJob(roomsResult.rows);
    const extByJob = byJob(extResult.rows);
    const coloursByJob = byJob(coloursResult.rows);
    const materialsByJob = byJob(materialsResult.rows);
    const actualsByJob = byJob(actualsResult.rows);
    const labourByJob = byJob(labourResult.rows);

    const jobs = jobsResult.rows.map(j => ({
      job: { id: j.id, name: j.name, data: j.data || {} },
      rooms: (roomsByJob[j.id] || []).map(r => ({ id: r.id, name: r.name, data: r.data })),
      exteriorItems: (extByJob[j.id] || []).map(r => ({ id: r.id, label: r.label, data: r.data })),
      colours: (coloursByJob[j.id] || []).map(r => ({ number: r.number, label: r.label, brand: r.brand, code: r.code })),
      materialsSnapshot: (materialsByJob[j.id] || []).map(r => ({ id: r.id, data: r.data })),
      materialActuals: (actualsByJob[j.id] || []).map(r => ({
        id: r.id,
        itemCode: r.item_code,
        description: r.description,
        // Numerics come back from pg as strings -- cast at the boundary,
        // same as GET /actuals does.
        actualQuantity: r.actual_quantity == null ? 0 : +r.actual_quantity,
        unitAmount: r.unit_amount == null ? null : +r.unit_amount,
        bought: r.bought,
      })),
      labourLog: (labourByJob[j.id] || []).map(r => ({
        id: r.id,
        workDate: r.work_date,
        days: r.days == null ? 0 : +r.days,
        note: r.note || '',
      })),
    }));

    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settingsResult.rows[0]?.data || {},
      colourLibrary: libraryResult.rows,
      jobs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// THE one copy-a-job implementation (JOB_TEMPLATES_SPEC.md's solve-it-once
// rule): walks an entry's child rows and inserts every one under newJobId
// with fresh row ids. Shared by backup import and POST /jobs/:id/duplicate
// — divergence here would mean duplicate and import silently disagreeing
// about what a job contains. Name-collision suffixing stays with each
// caller (import's "(imported)" vs duplicate's "(copy)"); this function
// takes the rows as given. Duplicate simply omits materialActuals and
// labourLog from its entry — actuals and logged days are the HISTORY of a
// real job, never template data.
async function copyJobRows(entry, newJobId) {
  for (const r of (entry.rooms || [])) {
    await db.query(
      'INSERT INTO rooms (id, job_id, name, data) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), newJobId, r.name || 'Room', r.data || {}]
    );
  }
  for (const it of (entry.exteriorItems || [])) {
    await db.query(
      'INSERT INTO exterior_items (id, job_id, label, data) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), newJobId, it.label || 'Exterior', it.data || {}]
    );
  }
  for (const c of (entry.colours || [])) {
    await db.query(
      'INSERT INTO colours (number, job_id, label, brand, code) VALUES ($1, $2, $3, $4, $5)',
      [c.number, newJobId, c.label || '', c.brand || '', c.code || '']
    );
  }
  for (const m of (entry.materialsSnapshot || [])) {
    await db.query(
      'INSERT INTO materials_snapshot (id, job_id, data) VALUES ($1, $2, $3)',
      [crypto.randomUUID(), newJobId, m.data || {}]
    );
  }
  for (const a of (entry.materialActuals || [])) {
    await db.query(
      `INSERT INTO material_actuals (id, job_id, item_code, description, actual_quantity, unit_amount, bought)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [crypto.randomUUID(), newJobId, a.itemCode || null, a.description || '', +a.actualQuantity || 0,
        a.unitAmount == null ? null : +a.unitAmount, !!a.bought]
    );
  }
  for (const l of (entry.labourLog || [])) {
    if (!l.workDate || !/^\d{4}-\d{2}-\d{2}$/.test(l.workDate)) continue;
    await db.query(
      `INSERT INTO labour_log (id, job_id, work_date, days, note) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id, work_date) DO NOTHING`,
      [crypto.randomUUID(), newJobId, l.workDate, +l.days || 0, l.note || '']
    );
  }
}

// What survives from a source job's data blob when it's duplicated as a
// template (JOB_TEMPLATES_SPEC.md's copies/doesn't table): the SCOPE and
// pricing choices copy (kitchen config minus its variation flag, markup
// override, materials-seeded marker); everything belonging to the source
// job's own lifecycle — client contact, quote/invoice links, status +
// timestamps, schedule, acceptedSnapshot, variations, notes — does not.
// A copy is a fresh draft for a new client.
function templateJobData(d) {
  d = d || {};
  const keep = {};
  ['materialsSeeded', 'markupOverride', 'markupType'].forEach(k => {
    if (d[k] !== undefined && d[k] !== null) keep[k] = d[k];
  });
  if (d.kitchen) {
    keep.kitchen = { ...d.kitchen };
    delete keep.kitchen.isVariation;
  }
  return keep;
}
const stripVariationFlag = (data) => {
  const copy = { ...(data || {}) };
  delete copy.isVariation;
  return copy;
};

// Duplicate a job as a fresh draft — the whole of the templates feature:
// a "template" is just a job kept around to duplicate (naming convention,
// no template type). Copied rooms/exteriors lose their isVariation flag
// (a template built from a job that had variations copies them as plain
// scope).
router.post('/jobs/:id/duplicate', async (req, res) => {
  const { id } = req.params;
  try {
    const jobResult = await db.query('SELECT id, name, data FROM jobs WHERE id = $1', [id]);
    const src = jobResult.rows[0];
    if (!src) return res.status(404).json({ error: 'job not found' });

    const [roomsResult, extResult, coloursResult, matsResult] = await Promise.all([
      db.query('SELECT name, data FROM rooms WHERE job_id = $1', [id]),
      db.query('SELECT label, data FROM exterior_items WHERE job_id = $1', [id]),
      db.query('SELECT number, label, brand, code FROM colours WHERE job_id = $1', [id]),
      db.query('SELECT data FROM materials_snapshot WHERE job_id = $1', [id]),
    ]);

    const newJobId = crypto.randomUUID();
    const name = `${src.name} (copy)`;
    const data = templateJobData(src.data);
    await db.query('INSERT INTO jobs (id, name, data) VALUES ($1, $2, $3)', [newJobId, name, data]);
    await copyJobRows({
      rooms: roomsResult.rows.map(r => ({ name: r.name, data: stripVariationFlag(r.data) })),
      exteriorItems: extResult.rows.map(it => ({ label: it.label, data: stripVariationFlag(it.data) })),
      colours: coloursResult.rows,
      materialsSnapshot: matsResult.rows,
    }, newJobId);

    // Same shape GET /jobs rows take, so the client can slot it straight in.
    res.json({ id: newJobId, name, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/backup/import', async (req, res) => {
  const { backup, restoreSettings } = req.body || {};
  // Fail closed: reject anything that doesn't look like a v1 backup BEFORE
  // writing a single row. A half-applied import of a malformed or foreign
  // file is worse than refusing it outright.
  if (!backup || backup.version !== 1 || !Array.isArray(backup.jobs)) {
    return res.status(400).json({ error: 'Not a recognised backup file (missing or unsupported version).' });
  }
  try {
    // Existing job names, so a re-imported job that collides gets suffixed
    // rather than silently reading as the same job it isn't (ids never
    // collide either way -- this is purely so two same-named jobs in the
    // list are visibly distinguishable). Grown as we go, so two jobs of the
    // same name WITHIN one backup file also get suffixed against each other.
    const existingNamesResult = await db.query('SELECT name FROM jobs');
    const existingNames = new Set(existingNamesResult.rows.map(r => r.name));

    let jobsImported = 0;
    for (const entry of backup.jobs) {
      const srcJob = entry.job || {};
      const newJobId = crypto.randomUUID();
      let name = srcJob.name || 'Imported Job';
      if (existingNames.has(name)) name = `${name} (imported)`;
      existingNames.add(name);

      await db.query('INSERT INTO jobs (id, name, data) VALUES ($1, $2, $3)', [newJobId, name, srcJob.data || {}]);
      await copyJobRows(entry, newJobId);
      jobsImported++;
    }

    // Colour library: upsert by (name, brand), same as POST /colour-library
    // above -- additive reference list, never deleted, never overwritten
    // wholesale.
    let colourLibraryEntriesAdded = 0;
    for (const c of (backup.colourLibrary || [])) {
      if (!c.name || !c.brand) continue;
      await db.query(
        `INSERT INTO colour_library (name, brand, code) VALUES ($1, $2, $3)
         ON CONFLICT (name, brand) DO UPDATE SET code = $3`,
        [c.name, c.brand, c.code || '']
      );
      colourLibraryEntriesAdded++;
    }

    // The one place this import genuinely can overwrite something -- opt-in
    // only (see BACKUP_SPEC.md: overwriting live business rates/markup
    // silently is a worse surprise than a duplicate job).
    const settingsRestored = !!(restoreSettings && backup.settings);
    if (settingsRestored) {
      await db.query('UPDATE settings SET data = $1, updated_at = NOW() WHERE id = 1', [backup.settings]);
    }

    res.json({ ok: true, jobsImported, colourLibraryEntriesAdded, settingsRestored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Address autofill (Google Places, per Nicky 2026-07-23) ─────────────────
// UK address lookup as you type in the street field, the way Xero's own
// contact form does it — no address database of our own, just a thin proxy
// over the Places API (New). Proxied server-side so the API key never
// reaches the browser. Dormant until GOOGLE_MAPS_API_KEY is set in the
// environment (Render → Environment): /address-autocomplete then answers
// {disabled:true} and the client shows nothing, so the app works
// identically with or without the key.
//
// URL overridable via env purely so the test harness can stand in for
// Google; production never sets it.
const GOOGLE_PLACES_URL = process.env.GOOGLE_PLACES_URL || 'https://places.googleapis.com/v1';

router.get('/address-autocomplete', async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.json({ disabled: true, suggestions: [] });
  const q = (req.query.q || '').trim();
  if (q.length < 4) return res.json({ suggestions: [] });
  try {
    const r = await fetch(`${GOOGLE_PLACES_URL}/places:autocomplete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      // Region-limited to GB — this is a UK sole trader's client list; a
      // bare query like "12 Elm" matches half the planet otherwise.
      body: JSON.stringify({ input: q, includedRegionCodes: ['GB'] })
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: (data.error && data.error.message) || 'Address lookup failed' });
    }
    const suggestions = (data.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map(p => ({ id: p.placeId, text: (p.text && p.text.text) || '' }))
      .filter(s => s.id && s.text);
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/address-details', async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(400).json({ error: 'Address lookup is not configured' });
  const id = (req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const r = await fetch(`${GOOGLE_PLACES_URL}/places/${encodeURIComponent(id)}`, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'addressComponents' }
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: (data.error && data.error.message) || 'Address lookup failed' });
    }
    const comp = (t) => {
      const c = (data.addressComponents || []).find(c => (c.types || []).includes(t));
      return (c && (c.longText || c.shortText)) || '';
    };
    // Street line from Google's parts: "12 Elm Road" is street_number +
    // route; named houses/flats arrive as premise/subpremise instead, so
    // fall back through those. postal_town is the Royal Mail post town
    // (what UK addresses actually use); locality covers the rare gaps.
    const number = comp('street_number') || comp('premise');
    const street = [comp('subpremise'), [number, comp('route')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    res.json({
      street: street,
      town: comp('postal_town') || comp('locality'),
      postcode: comp('postal_code')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
