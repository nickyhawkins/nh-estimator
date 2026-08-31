# Client-facing variation approval — Spec

**Status: BUILT 2026-08-28 (v2.41.0), all five build-order items.**

Depends on `VARIATIONS_SPEC.md` (needs variations to exist) and
`ACCEPTED_SNAPSHOT_SPEC.md` (needs an immutable original total to show). Feeds
`FINAL_INVOICE_SPEC.md` only in the sense that approved variations bill there
exactly as they already did — **this feature adds no money path at all**.

## Purpose

The variation sign-off that shipped with `VARIATIONS_SPEC.md` records *Nicky's*
answer to "did the client say yes". It is an internal record, tapped in after
the conversation. That leaves two gaps on a real job:

- **The conversation has to happen.** "While you're here, can you do the landing
  ceiling?" gets a price out loud, and out loud is where a disputed £312 comes
  from three weeks later.
- **The client has nothing to look at.** The Xero variation quote (v2.13.0)
  fills that gap when there's signal, a Xero connection, an email address and
  time to drive Xero's UI. On a phone, mid-job, in a house with one bar, there
  is nothing.

This is the missing piece: **a link you can text the client on the spot**, and a
page they can answer on their own phone in ten seconds with no login.

## Scope

A public, token-gated page per job (`/quote/:jobId/:token`) showing:

- the **original quote total only** — a single figure, never the itemised
  breakdown (they already have that document, and reopening it invites a
  renegotiation of settled work),
- **every variation** since, each with its description, price, status and date,
- **Approve / Decline** on the ones still pending; approved and declined lines
  are read-only history,
- a **running total** = original quote total + the variations they have
  approved. Pending lines are deliberately excluded: the headline figure on a
  client's screen must never be a bill for work nobody has agreed to.

### Explicitly out of scope

- **No Xero interaction anywhere in this flow.** Approved variations reach Xero
  as final-invoice line items, exactly as they do today.
- **No materials-usage reconciliation.** Considered and dropped: materials
  variance stays internal and surfaces at invoicing as it always has.
- **No itemised breakdown of the original quote.**

## Why the prices are published, not computed

The obvious design is a server route that prices the job's variations on
request. It is wrong twice over.

1. **There is no calc engine on the server.** The engine *is* `index.html` —
   rooms, coverage rates, the per-job markup override, the sundries
   percentages. A second implementation over there is precisely the
   duplicate-totalling-function failure this repo has written three specs
   about.
2. **A published price has to be frozen.** This is the same argument
   `ACCEPTED_SNAPSHOT_SPEC.md` makes about the accepted quote, and it applies
   with more force here because the reader is the client: an extra they
   approved at £312.50 must still read £312.50 after the day rate moves, after
   the room is re-measured, forever.

So the browser prices the lines and **posts them**; the server owns the record.
`job_variations` is a snapshot table, sibling to `quote_snapshots`, not a
projection of the app's data.

### What freezing means, precisely

- A line's description and amount are rewritten by a re-publish **only while its
  status is still `pending`**.
- A line's **status is only ever set when the row is created**, from the app's
  own internal sign-off — so an extra already agreed on the doorstep lands on
  the page as read-only history rather than asking the client to approve
  something they've already said yes to. After that, publishing never touches a
  status again. The answer on it is the client's.
- Lines that drop out of a publish (unflagged, deleted, withdrawn) are removed
  **only while still pending**. An answered line stays, as the record that it
  was offered and answered — the same rule the app's own card follows for
  declined variations.

## Sundries are folded into each line

`computeVariationsView()` carries `varSundries` as one figure across all
variations. The client's page cannot: it has to answer "what does *this* extra
cost" per row, and a shared sundries line that swells and shrinks as rows get
approved is unanswerable.

So each published line carries its own share:
`(raw + raw × sundriesPct + spray × sundriesSprayPct) × varMk`, with flat free
lines passed through verbatim as always. **This changes no total** — `varSundries`
is itself just those same two percentages over those same per-line bases, so
the folded lines sum to the same variations subtotal the app shows.

## The token

- `jobs.client_token`, 24 random bytes as base64url (192 bits, 32 characters).
- Generated once, at quote acceptance (`POST /api/quote-snapshots` mints it as a
  side effect, unawaited — a link that can be minted lazily is never worth
  failing an acceptance over) or lazily on the first **Send for approval**.
  `ensureClientToken()` is idempotent, so doing both is doing one.
- **Never rotated.** Rotating it silently breaks a link already texted to
  someone, which is a worse failure than the one rotation would fix.
- A column on `jobs`, deliberately **not** a key on `jobs.data`: that blob is
  PUT-merged whole on every status change and note edit, and a credential one
  careless spread away from being wiped is not a credential.
- Compared in **constant time** after looking the job up by id — never matched
  in a `WHERE` clause.
- The token is the whole credential, so it is treated like the quote itself:
  anyone holding it can see that job's totals and answer its extras.

## Routes

Public (`routes/publicQuote.js`, mounted in `server.js` **ahead of the login
gate** — the reader has no account and never will):

```
GET  /q/:token                                      the page (SHORT — what links use)
POST /q/:token/variations/:variationId/approve
POST /q/:token/variations/:variationId/decline

GET  /quote/:jobId/:token                           the original shape, kept working
POST /quote/:jobId/:token/variations/:variationId/approve
POST /quote/:jobId/:token/variations/:variationId/decline
```

**Two URL shapes, both permanent.** The short one is what a client actually
receives: 68 characters against 109, so it survives a text message without
wrapping into something that looks broken, and it carries no job id — one less
internal identifier on a stranger's screen. Nothing was lost by dropping it:
the token is already globally unique (`jobs_client_token`), so the job id never
did any work in the URL beyond making it longer. The long shape stays supported
forever because links were already sent on it, and each page builds its action
paths from the base the reader arrived on, so nobody is ever bounced between
the two. Resolving a job **by** token is a plain indexed lookup and is
deliberately not the authorization decision — that is still the constant-time
compare, identically for both shapes.

Authenticated (`routes/api.js`):

```
GET  /api/jobs/:id/client-variations   the link + every published line
PUT  /api/jobs/:id/client-variations   publish/refresh the priced lines
POST /api/jobs/:id/client-link         mint the link without publishing
```

### Rules the public routes hold

- **A bad job id and a bad token give the same generic 404 page**, byte for
  byte. Nothing tells a caller which half of the URL they got wrong. A job with
  no token can never be opened at all.
- **The approve/decline UPDATE is guarded on `status = 'pending'`.** A second tap
  — a double-tap on a phone, a re-submitted form, a forwarded link — reports the
  answer that stands (409) rather than silently flipping it.
- **The opposite timestamp is cleared** on every answer, so a row can never carry
  both an `approved_at` and a `declined_at` and leave the trail ambiguous.
- `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy:
  no-referrer` on every response, plus a robots `<meta>`: a link handed to one
  client must never turn up in a search result.
- A **per-IP throttle** on misses. Not a security control — 192 bits is not
  brute-forceable and this wouldn't save it if it were. It stops a script
  spending the single Render instance's database connections on failed lookups.

## The page

Steel blue `#1e6497` / warm grey `#f4f2ee` / Barlow, matching
`buildClientQuoteHtml()` exactly, so the approval page reads as the next page of
the quote document the client already has. Server-rendered in one response —
no data fetch, no framework, nothing to wait for on one bar of signal.

Approve/Decline are **real `<form method="POST">` elements**, upgraded by a
small inline script to submit with `fetch` and update in place. The confirmation
state — the line flips, the running total moves, a flash appears — happens
without a navigation, because a full page load on bad signal is exactly where a
tap goes missing and gets tapped twice. With JavaScript off or still loading,
the forms POST for real and the route 303s back to the page with a flash. On any
fetch failure the handler submits the form rather than swallowing the tap.

When the app holds **no original total** for the job (imported from Xero, or
accepted before snapshots shipped) the Original quote card is omitted entirely
rather than showing a dash — a dash reads to a client as a broken page.

## How the answer gets back

The link is a web page, not a push channel. The app pulls:

- automatically, with the job's other data on open/switch, and
- on demand, via **Check answers** on the Variations card.

`adoptClientVariationAnswers()` then writes the client's answer onto the app's
own record — the `isVariation` carrier — with a note saying where it came from
and the client's own timestamp.

**It only ever adopts onto a line whose internal status is still Pending.** An
answer Nicky already recorded by hand always wins, because the person who was
there knows what was agreed. This relaxes the rule the Xero status poll follows
(which *prompts* the ✓ taps rather than flipping lines) on the one point where
relaxing it is safe: an Approve on this page is per-line and unambiguous, where
a whole-quote ACCEPTED in Xero is not.

Adoption also has to run **after** the job's rooms and exterior items have
loaded — an answer can only be written onto a carrier that is in memory — so the
fetch and the adoption are deliberately separate calls, the second placed after
the load `Promise.all` settles rather than inside it.

## Schema

`db/setup.sql`, and lazily via `ensureClientQuoteSchema()` because
**`db/setup.sql` is not run on deploy** (same situation as `quote_snapshots`).

```
jobs.client_token VARCHAR                     + unique partial index

job_variations (
  id, job_id → jobs(id) ON DELETE CASCADE,
  source_kind,          -- room | ext | kitchen | fittedunit | free
  source_id,            -- the in-app carrier's id ('kitchen' for the kitchen)
  description,          -- denormalised: must still read after a rename/delete
  amount,               -- as published, markup + sundries share folded in
  status,               -- pending | approved | declined
  approved_at, declined_at, created_at, updated_at
)
UNIQUE (job_id, source_kind, source_id)
INDEX  (job_id)
```

`(job_id, source_kind, source_id)` unique is the storage-level guarantee behind
"Send for approval twice updates the page rather than duplicating the extra" —
the publish route upserts on it, the same pattern as `material_actuals_job_item`
and `labour_log_job_date`.

**This is the schema's only foreign key**, and the exception is deliberate.
Everywhere else child rows are cleaned up by hand in `DELETE /jobs/:id`, which
is fine for data the app can regenerate. An orphan *here* is a price a client
agreed to, still live on a public URL, under a job that no longer exists.
`ON DELETE CASCADE` makes that unrepresentable rather than something to
remember — so `job_variations` is deliberately **absent** from that route's
delete list.

### Backup

Exported as `jobs[].clientVariations`, additive on the v1 shape. What is worth
restoring is the **answer** — "the client approved the landing ceiling at £312.50
on 14 Aug" is a fact — not the link: a restored job gets a new id, so
`client_token` is not exported at all and the restored lines stay private until
the next Send for approval mints a fresh one. Duplicate omits the key entirely,
like `materialActuals` and `labourLog`: a template copy is a fresh draft, and
inheriting another client's answers would be worse than useless.

## Build order (as built)

1. Schema: `client_token` on jobs, `job_variations` with status/timestamps.
2. Token generation at acceptance, and lazily on first Send for approval.
3. Public GET route + the page.
4. Approve/decline POST routes.
5. **Send for approval** on the Variations card, the shareable link with
   copy-to-clipboard, and the answer read-back.

## Gotchas

- **Mount order in `server.js` is load-bearing.** The public router must sit
  ahead of `app.use(requireAuth)`. Behind it, a gated instance redirects the
  client to a login page they can never pass. `/logo.png` is already on
  `appLogin`'s open-paths list, which is why the page's fallback logo resolves
  for a client with no session.
- **The page's fallback logo, not the app's.** `express.static` is behind the
  gate; anything else the page references would 404 for the client.
- **Publishing pushes prices, never statuses (after creation).** If that ever
  looks like a bug, re-read "What freezing means" — it is the feature.
- **Withdrawal only works on pending lines.** Deleting a room whose extra the
  client already approved leaves the line on their page. That is the record
  working as intended; the app's own card is where the internal answer lives.
