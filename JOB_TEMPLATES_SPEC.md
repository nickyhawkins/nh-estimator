# Job Templates — Spec (duplicate a job as a starting point)

**Status: SCOPED 2026-07-22, not built.** Idea #6 in `FEATURES_2.0_IDEAS.md`. Small.

## Purpose

Deferred by design when Multiple Saved Jobs shipped ("fully separate, no
duplicate-as-template; if templates are ever wanted, they layer on from here" —
`db/setup.sql` line 3). They're wanted: a "standard 3-bed repaint" turns a survey into
adjust-and-confirm instead of enter-from-scratch.

**A template is just a job that gets duplicated** — no template type, no separate storage.
v1 is a Duplicate button; the "template" is a naming convention.

## The mechanism — reuse the backup import's copy loop

`POST /api/backup/import` already does exactly this: walk a job's rooms / exterior items /
colours / materials snapshot, insert every row under a NEW job id with fresh row ids.
**Factor that loop into `copyJobRows(sourceJobEntry, newJobId)` and call it from both
places** — one copy-a-job implementation in the codebase, not two (the repo's solve-it-once
rule; divergence here means duplicate and import silently disagree about what a job
contains, which is how the extCost/extItems class of bug starts).

New endpoint: `POST /api/jobs/:id/duplicate` → reads the source job's rows (the same
per-table queries the export uses, filtered to one job), builds the entry shape, calls
`copyJobRows`, returns the new job.

### What copies, what doesn't

| | Copied? | Why |
|---|---|---|
| rooms / exterior items / colours | ✅ | the point of the feature |
| materials snapshot | ✅ | stale is fine — Recalculate is the existing answer |
| `material_actuals` | ❌ **never** | actuals are the history (and the invoice) of a REAL job; template data must not fabricate them |
| labour log (`CALIBRATION_SPEC.md`) | ❌ never | same reason |
| job.data: contact fields (edits #12) | ❌ | new client |
| job.data: status + timestamps, `xeroQuoteId`, `xeroQuoteStatus` | ❌ → fresh draft | a copy has no quote and no history |
| job.data: `startDate`/`scheduledDays`, `acceptedSnapshot`, variations flags | ❌ | all belong to the source job's lifecycle |

Copy name: `"{source name} (copy)"`, immediately renameable (rename already exists).
The `isVariation` flag on copied rooms is STRIPPED (a template built from a job that had
variations should copy the rooms as plain scope).

## UI

- **"Duplicate"** on each Jobs-list row (next to rename ✎). Creates the copy and switches
  to it, landing on Home ready to adjust.
- Keeping templates is then just keeping jobs named "TEMPLATE — 3-bed repaint" in Draft.
  They'll sit in the Draft group; fine at v1 volumes. If the drafts group gets noisy, v1.5
  is a `job.data.isTemplate` flag + a "Templates" group pinned at the bottom of the Jobs
  list and excluded from the attention strip — don't build it until it's actually noisy.

## Gotchas

- Colour rows: the copy keeps colour NUMBERS and labels (numbers are per-job since
  `colours_job_number_uniq`, so no collision). Brand/code copy too — a template's colours
  are usually placeholders; overwriting them per client is the normal Colours-tab flow.
- The import loop's name-collision suffix logic ("(imported)") is import-specific — keep
  it OUT of `copyJobRows` (the factored function takes the final name as given; each
  caller does its own naming).
- Deep-copy the JSONB blobs (fresh row ids INSIDE `data` too, where rooms carry their id
  in the blob) — exactly what import already handles; factoring must not lose that.
