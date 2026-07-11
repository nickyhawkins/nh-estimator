const express = require('express');
const db = require('../db');
const router = express.Router();

// ── Rooms ──────────────────────────────────────────────────────────────────

// Get all rooms
router.get('/rooms', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, data FROM rooms ORDER BY created_at ASC');
    const rooms = result.rows.map(r => ({ id: r.id, name: r.name, ...r.data }));
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a room (create or update)
router.put('/rooms/:id', async (req, res) => {
  const { id } = req.params;
  const room = req.body;
  const { name, ...data } = room;
  try {
    await db.query(`
      INSERT INTO rooms (id, name, data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (id) DO UPDATE SET name = $2, data = $3, updated_at = NOW()
    `, [id, name || 'Room', data]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a room
router.delete('/rooms/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all rooms
router.delete('/rooms', async (req, res) => {
  try {
    await db.query('DELETE FROM rooms');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Exterior Items ─────────────────────────────────────────────────────────

router.get('/extitems', async (req, res) => {
  try {
    const result = await db.query('SELECT id, label, data FROM exterior_items ORDER BY created_at ASC');
    const items = result.rows.map(r => ({ id: r.id, label: r.label, ...r.data }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/extitems/:id', async (req, res) => {
  const { id } = req.params;
  const item = req.body;
  const { label, ...data } = item;
  try {
    await db.query(`
      INSERT INTO exterior_items (id, label, data, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (id) DO UPDATE SET label = $2, data = $3, updated_at = NOW()
    `, [id, label || 'Exterior', data]);
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
  try {
    await db.query('DELETE FROM exterior_items');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Colours ────────────────────────────────────────────────────────────────
// Job-scoped list of {number, label} — same lifecycle as rooms/exterior
// items, not a permanent setting.

router.get('/colours', async (req, res) => {
  try {
    const result = await db.query('SELECT number, label FROM colours ORDER BY number ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/colours/:number', async (req, res) => {
  const number = +req.params.number;
  const { label } = req.body;
  try {
    await db.query(`
      INSERT INTO colours (number, label, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (number) DO UPDATE SET label = $2, updated_at = NOW()
    `, [number, label || '']);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/colours/:number', async (req, res) => {
  try {
    await db.query('DELETE FROM colours WHERE number = $1', [+req.params.number]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/colours', async (req, res) => {
  try {
    await db.query('DELETE FROM colours');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── Materials snapshot ────────────────────────────────────────────────────
// Job-scoped, editable list of priced material lines for the current quote
// — same lifecycle as rooms/exterior items, not a permanent setting.

router.get('/materials', async (req, res) => {
  try {
    const result = await db.query('SELECT id, data FROM materials_snapshot ORDER BY created_at ASC');
    const lines = result.rows.map(r => ({ id: r.id, ...r.data }));
    res.json(lines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/materials/:id', async (req, res) => {
  const { id } = req.params;
  const { id: _drop, ...data } = req.body;
  try {
    await db.query(`
      INSERT INTO materials_snapshot (id, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()
    `, [id, data]);
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
  try {
    await db.query('DELETE FROM materials_snapshot');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────

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

// ── HSL State ──────────────────────────────────────────────────────────────

router.get('/hsl', async (req, res) => {
  try {
    const result = await db.query('SELECT data FROM hsl_state WHERE id = 1');
    res.json(result.rows[0]?.data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/hsl', async (req, res) => {
  try {
    await db.query(
      'UPDATE hsl_state SET data = $1, updated_at = NOW() WHERE id = 1',
      [req.body]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/hsl', async (req, res) => {
  try {
    await db.query("UPDATE hsl_state SET data = '{}', updated_at = NOW() WHERE id = 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Clear all ──────────────────────────────────────────────────────────────

router.delete('/all', async (req, res) => {
  try {
    await db.query('DELETE FROM rooms');
    await db.query("UPDATE hsl_state SET data = '{}' WHERE id = 1");
    await db.query('DELETE FROM exterior_items');
    await db.query('DELETE FROM colours');
    await db.query('DELETE FROM materials_snapshot');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
