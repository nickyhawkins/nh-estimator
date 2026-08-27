# Repo notes for Claude sessions

## There is exactly one user manual

The user manual lives at **`docs/user-manual/README.md`** — an illustrated,
screen-by-screen guide with phone-viewport screenshots in
`docs/user-manual/images/`, and a PDF edition at
`docs/user-manual/NH-Estimator-User-Manual.pdf` (regenerate it after any
edit with `npm run build:manual`; the cover stamps the app version and
date automatically from `package.json`).

**Do not create a new manual file anywhere else** — not `USER_MANUAL.md`
at the repo root, not a docs file under a different name. That file has
been recreated from scratch several times by sessions that didn't know
the illustrated one existed, and each time it had to be merged back in
and the duplicate removed. If you're working on a feature and it needs
documenting for users, add it to `docs/user-manual/README.md` directly
(with a fresh screenshot if the UI changed) and rebuild the PDF — don't
write a parallel text summary.

If you find `USER_MANUAL.md` back at the repo root: it's a stray
duplicate, not a second manual to maintain. Fold anything genuinely new
in its "What's new" section into `docs/user-manual/README.md`, then
overwrite it back to a one-line pointer at the illustrated manual.

`FEATURES.md` is the developer changelog/roadmap — a different document
with a different audience, fine to keep updating as-is.
