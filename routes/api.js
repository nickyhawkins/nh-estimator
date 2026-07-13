const express = require('express');
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
    await db.query('DELETE FROM rooms WHERE job_id = $1', [id]);
    await db.query('DELETE FROM exterior_items WHERE job_id = $1', [id]);
    await db.query('DELETE FROM colours WHERE job_id = $1', [id]);
    await db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [id]);
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

// ── Clear all (within a job) ────────────────────────────────────────────────

router.delete('/all', async (req, res) => {
  const jobId = requireJobId(req, res); if (!jobId) return;
  try {
    await db.query('DELETE FROM rooms WHERE job_id = $1', [jobId]);
    await db.query('DELETE FROM exterior_items WHERE job_id = $1', [jobId]);
    await db.query('DELETE FROM colours WHERE job_id = $1', [jobId]);
    await db.query('DELETE FROM materials_snapshot WHERE job_id = $1', [jobId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
