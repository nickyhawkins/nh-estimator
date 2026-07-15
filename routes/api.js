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
    await db.query('DELETE FROM material_actuals WHERE job_id = $1', [id]);
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
    // Actuals go too: this is "clear ALL data in this job", the user has
    // confirmed "cannot be undone", and leaving them would strand an invoice
    // log against an estimate that no longer exists. NB this is the ONLY route
    // that clears actuals wholesale, and it's user-confirmed. clearJob()
    // (rooms/colours/snapshot only) deliberately leaves them alone —
    // destroying the estimate must never destroy the invoice.
    await db.query('DELETE FROM material_actuals WHERE job_id = $1', [jobId]);
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

module.exports = router;
