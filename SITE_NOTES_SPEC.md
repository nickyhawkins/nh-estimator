# Site Notes & Photos — Spec (notes now, photos deliberately deferred)

**Status: Part 1 (notes) BUILT 2026-07-23 (v1.12.0); Part 2 (photos) DROPPED
2026-07-23 per Nicky — no photo storage will be built.** Idea #7 in
`FEATURES_2.0_IDEAS.md`. Split decision made here: **notes are v1 and nearly
free; photos are a separate, infrastructure-carrying decision that should not
block notes** — and the decision came back "drop them".

**Part 1 as built:** one plain textarea on `jobs.data.notes`, auto-growing,
500ms-debounced autosave through `persistJobData()`, value only re-synced when
the field ISN'T focused (form-wipe guard). 📝 chip on Jobs-list rows when
non-empty. Rides backup exports automatically; job duplication deliberately
does NOT copy notes. Verified in the Chromium smoke run (debounced save, PUT
payload, chip, per-job isolation).

**Revised UI 2026-07-23 (v1.14.2, per Nicky — "a little notepad item in a
corner"):** the full-width Notes card on Home was too prominent for a field
that's usually empty. It's now a small 📝 corner button (bottom-left, opposite
the + fab) opening a bottom sheet with the same textarea — same storage, same
debounce, same form-wipe guard. An accent dot on the button marks "this job
has notes", and closing the sheet flushes any pending debounced save
immediately so a quick type-and-Done never loses the last keystrokes.

## Part 1 — per-job notes (build now)

Free-text notes captured on site: access arrangements ("key under pot, dog is friendly"),
condition observations before starting ("existing crack above bay — photograph before
sanding"), things promised verbally, snag list at the end.

- **Storage:** `jobs.data.notes` (string). No schema change, rides `persistJobData()`,
  automatically in backup exports and job duplication-exclusion decisions
  (`JOB_TEMPLATES_SPEC.md`: notes do NOT copy — they're about a real house).
- **UI:** a "Notes" card on Home for the active job — always visible, grows with content,
  plain `<textarea>` with debounced save (the pattern the preview-debounce work in
  `a0cb766` established). A 📝 chip on the Jobs-list row when non-empty.
- One field, not a list of timestamped entries. Nicky can date lines by hand if wanted;
  structure can come later if the single field proves messy. Start dumb.

That's the whole of Part 1. It could ship in an afternoon and covers most of the real
day-to-day value ("what did I agree at the survey three weeks ago?").

## Part 2 — photos (decide before building; NOT part of Part 1)

Survey photos (the bay window that's hard to describe, pre-existing damage worth
evidencing) and before/afters (disputes; marketing later).

**The blocker is storage, and it's architectural, not UI:**

- **Render Postgres is the wrong home for image blobs.** The database is the app's single
  irreplaceable store, currently small, cheaply backed up by a JSON export. Phone photos
  are 2–5MB each; a year of jobs would swamp the DB tier, slow every backup, and make the
  export file useless. `bytea` in Postgres is explicitly REJECTED, not deferred.
- The right shape is object storage (Cloudflare R2 / Backblaze B2 / S3) with only
  metadata in Postgres (`job_photos`: id, job_id, key, caption, taken_at). That means:
  a new paid service, credentials in Render env, upload endpoints (or presigned PUTs),
  and photos being OUTSIDE the backup export (document that clearly — the backup story
  changes from "one file has everything" to "one file + a bucket").
- Client-side compression before upload regardless (canvas resize to ~1600px, JPEG ~0.8 —
  turns 4MB into ~300KB; phone-camera EXIF rotation must be handled, it's the classic
  sideways-photo bug).

**Decision for Nicky before any build:** is the day-to-day value worth a second paid
service and a second backup surface? If yes → spec the upload flow properly at that point
(presigned uploads, an R2 free-tier start, per-job gallery on the Notes card). If no →
Part 1 notes already carry the "write it down" half, and the camera roll carries the
photos as it does today. **Recommendation: ship Part 1, live with it a month, then decide
— the notes field will reveal how often a photo was the thing actually missing.**

## Explicitly out of scope (both parts)

- OCR/paint-tin-label scanning, voice notes, sketching — gimmick territory for this app.
- Sharing notes/photos with clients — notes are internal shorthand; anything
  client-facing goes on the quote or in a message, as today.
