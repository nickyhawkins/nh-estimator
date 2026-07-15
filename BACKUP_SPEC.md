# Backup System — Spec (export-all / import)

Scoped 2026-07-15, against `FEATURES.md`'s "Backup system (CSV export / import)" entry — that entry is titled CSV but this doc changes the format decision (see below); it supersedes the "CSV" framing there.

## What this is, and why the existing export doesn't cover it

The app holds every real job on Render Postgres with nothing else behind it. A database problem loses everything. `exportCSV()` on the Summary tab is NOT a backup, even though it looks like one:
- **Active job only** — every other saved job is absent.
- **Export only** — there's no import, so nothing can be restored from it.
- **Lossy by design** — exterior items collapse to a single total row; the materials snapshot, colour library, per-room product overrides, material actuals and full settings never make it into the file. You could not rebuild a job from it, only read a summary of one.

This spec is for a genuine round-trip: export everything, import it back, get the same data.

## Decisions taken

- **Format: JSON, not CSV.** The FEATURES.md entry says "CSV export / import", but CSV can't cleanly represent 7 relational tables with nested per-job data (a room alone has dozens of fields) without either one file per table or heavy flattening — both fragile to round-trip correctly. One JSON file, one structure, trivial to validate on the way back in. Not spreadsheet-editable, but that was never the actual point of a backup.
- **Import is additive — never deletes or overwrites existing data.** Every re-imported job gets a **fresh id** (never reuses the id from the backup file), so importing the same file twice, or importing an old file after making new changes, can never collide with or clobber anything already in the database — worst case you get a duplicate-looking job, never data loss. This was the explicit choice over "wipe and replace", which is closer to true disaster-recovery semantics but risks silently discarding recent work if the wrong file gets imported.
- **Settings and colour_library don't fit "merge, add jobs" literally — they're not per-job.** Reasoned through here rather than left ambiguous:
  - **Settings: exported for completeness, NOT applied on import by default.** There is exactly one settings row — "merge" has no meaning for it, and silently overwriting a business's day rate/markup/coverage rates with whatever was in an old backup is a worse surprise than losing a job, since it's wrong on every quote from that point on, not just one job. Import shows what the backup's settings contain and offers an explicit, off-by-default "also restore settings" checkbox for the genuine disaster-recovery case (fresh empty database, nothing to protect).
  - **Colour library: upserted by `(name, brand)`, same as the existing "+ Save to library" flow already does.** It's an additive reference list that grows over time, not job data — importing entries that already exist is a no-op (or refreshes the code if it changed), and new entries are simply added. Never deletes an existing entry.
- **Scope: `jobs` and its five job-scoped children (`rooms`, `exterior_items`, `colours`, `materials_snapshot`, `material_actuals`), plus `settings` and `colour_library`.** Everything else in `db/setup.sql` is out of scope: `session` (Express session store, not user data), `hsl_state` (dead — no routes or frontend code reference it, confirmed 2026-07-14), and the `debt_plan_*` tables (a separate app sharing this Postgres instance — its own roadmap, not this one).

## File shape

```json
{
  "version": 1,
  "exportedAt": "2026-07-15T12:00:00.000Z",
  "settings": { "...": "the one settings row, as-is" },
  "colourLibrary": [ { "name": "...", "brand": "...", "code": "..." } ],
  "jobs": [
    {
      "job": { "id": "...", "name": "...", "data": { "...": "xeroClient/xeroRef/markupOverride/status/acceptedAt/kitchen/materialsSeeded, whatever job.data currently holds" } },
      "rooms": [ /* full row per room, id preserved WITHIN this file for the import step's own bookkeeping, remapped to a fresh id on write */ ],
      "exteriorItems": [ /* same */ ],
      "colours": [ /* {number,label,brand,code} per job */ ],
      "materialsSnapshot": [ /* full row per line */ ],
      "materialActuals": [ /* full row per line -- see the note below, this is the one table where re-import needs care */ ]
    }
  ]
}
```

`version` exists so a future schema change can detect and either migrate or reject an old file with a clear message, rather than half-importing something the code no longer understands.

**Room/item ids are preserved in the file but never reused on import** — only the *job* id is guaranteed fresh; room/exterior-item/materials-snapshot/actuals ids inside an imported job are regenerated too (all of them are referenced only by their own job's `job_id`, no cross-table id references to worry about), so nothing anywhere in the schema can collide with what already exists.

## API

Two new routes in `routes/api.js`, alongside the existing per-resource ones:

- **`GET /api/backup/export`** — one query per table (7 total, `settings` + `colour_library` global, the rest grouped by job via a single query each rather than N+1 per job), assembled into the shape above, returned as `Content-Disposition: attachment` JSON. No job_id param — this is always everything.
- **`POST /api/backup/import`** — body is the file shape above, plus `{ restoreSettings: boolean }` from the confirmation step. For each job in the file: generate a fresh job id, insert the job row (name suffixed with " (imported)" if a job of that name already exists, so duplicates read as duplicates rather than silently blending in), insert its rooms/exterior_items/colours/materials_snapshot/material_actuals with fresh ids and the new job_id. Upsert `colourLibrary` entries by `(name, brand)`. Apply `settings` only if `restoreSettings` was true. Returns a summary (`{jobsImported: 3, colourLibraryEntriesAdded: 12, settingsRestored: false}`) for the client to show as a result, not just a bare 200.

**Validation before writing anything:** reject with a clear error (not a partial import) if `version` is missing/unrecognised, or if the top-level shape doesn't match — fail closed rather than importing a corrupted or foreign file halfway.

## UI

Lives in **Settings**, a new "Backup" card (this is account-wide, not per-job, so it doesn't belong on Summary next to the per-job CSV export):
- **"Export everything"** button — downloads the JSON file client-side (same `Blob` + `URL.createObjectURL` pattern `exportCSV()` already uses), named `nh-estimator-backup-YYYY-MM-DD.json`.
- **"Import backup"** — file picker, then a **preview/confirm step before anything is written**: parse the file client-side, show "This will add N jobs: [names] and M colour library entries." plus the off-by-default "Also restore settings from this backup (overwrites your current rates/markup)" checkbox, then a confirm button that actually POSTs. Matches the general rule of confirming before a write that's hard to undo — even though nothing here can destroy existing data, restoring settings by mistake is still a real footgun worth a second look before it happens.
- Import result (the summary the API returns) shown back to the user, not just silently succeeding.

## Gotchas

- **`material_actuals` is the one table with something real to lose if this is built carelessly** — per `MATERIAL_TRACKING_SPEC.md`, it's the input to the invoice and has no localStorage mirror by design. Export is a plain read, no risk there. Import must still go through the server's existing per-row-not-delete-all convention in spirit (even though this is a fresh job/fresh ids, so there's nothing to delete) — just don't be tempted to "simplify" by reusing the snapshot's delete-all-then-rewrite pattern for actuals; it doesn't apply here since every imported row is new, but the underlying reason (actuals are unrecoverable if lost) is still the reason to be careful with this table specifically.
- **`db/setup.sql` is already written to be idempotent/re-runnable** (`IF NOT EXISTS`, backfill-then-`NOT NULL`) — the import route should respect that same spirit: never assume a fresh/empty database, always work against whatever's already there.
- **This is a genuinely new API surface with real write paths** — per the project's local-verification limits (no Postgres on this Mac), it can be built and unit-tested against a stubbed db the way `MATERIAL_TRACKING_SPEC.md`'s Phase 1 was, but **the real first test is a real export followed by a real import against the live Render database**, ideally into a job list you don't mind seeing duplicated if something's off.

## Explicitly out of scope for v1

- Automatic/scheduled backups — this is a manual export/import feature, not a cron job.
- Partial export (e.g. "just this one job") — the file shape above is structured so this is a natural v2 extension (the same per-job bundle, just one entry instead of the whole `jobs` array), but v1 is always everything.
- Import from an OLDER app version's data shape (e.g. a job saved before `kitchen`/`markupOverride` existed on `job.data`) — since `job.data` is already a JSONB blob read with `||`/`!=null` fallbacks everywhere on the read side, an old export should load fine without special-casing, but this hasn't been verified against an actually-old file.
