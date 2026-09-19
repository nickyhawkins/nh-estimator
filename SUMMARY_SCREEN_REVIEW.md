# Summary screen — review (written 2026-09-19 against v2.69.3)

**Status: REVIEW + PROPOSAL, nothing built.** Raised by Nicky: *"between honouring
Xero quotes, revisions, snapshots, and accepted prices vs what it would cost today,
everything seems to be getting complicated."*

It is, and not because any one feature was wrong. Each of them — the accepted-quote
freeze, revisions, honoured Xero labour, imported jobs, variations — is individually
well-argued in its own spec, and each one arrived on Summary as **another card**. Nobody
ever went back and asked what the screen was now, in total. This is that pass.

**Conclusion, up front:** what an accepted job would cost at today's rates does not
belong on Summary at all. It was the *detector* for the silent-drift bug, back when no
frozen record existed to make drift impossible; the snapshot has been that record since
v2.38.0. Removing the live money — rather than labelling it more carefully, as an earlier
draft of this document proposed — takes the six explanatory captions, the lock strip and
the divider with it. The one place it is still worth seeing is the moment of amending,
which is where §4a moves it.

---

## 1. What an accepted job actually renders today

In order, from `renderSummary()` (`public/index.html:23604`):

| # | Block | Source |
| --- | --- | --- |
| 1 | Status card — ✓ Accepted, schedule block, deposit block | inline |
| 2 | Profitability | `profitabilityCardHtml` (invoiced only) |
| 3 | "Agreed figures — revision N · Rate changes since then do not move these numbers" + Amend / History | `acceptedQuoteBannerHtml` |
| 4 | "Accepted quote — revision N" — every agreed line + **Accepted total** | `frozenQuoteCardHtml` |
| 5 | Hero — **Accepted Quote £X**, revision, *"Same job priced today: £Y — £Z more, broken down below"*, *"+£V variations → £W job total"* | inline |
| 6 | Stat grid — Labour (frozen) · On Site (live) | inline |
| 7 | "Where the £Z difference is" — agreed→today, which lines moved, rates verdict | `quoteDriftCardHtml` |
| 8 | "Labour agreed in a pre-app Xero quote?" offer line | `xeroImportedSectionHtml` |
| 9 | "Pricing controls are locked… Unlock for amending" | `acceptedPricingLockHtml` |
| 10 | Commercial Job | inline |
| 11 | Standalone Job | inline |
| 12 | Markup / Discount | inline |
| 13 | Payment — deposit, balance, plan | inline |
| 14 | "Working figures — today's rates. Everything below this line is the live calculation" | `workingFiguresDividerHtml` |
| 15 | Room Breakdown (live) | inline |
| 16 | *Cost Summary — suppressed on frozen jobs* | inline |
| 17 | Materials · Add Material · Colour Schedule | inline |

Roughly **fifteen blocks before you reach the shopping list**, on a phone.

## 2. The diagnosis

### 2a. Six pieces of UI exist only to stop you misreading another piece of UI

Blocks 3, 5's aside, 7, 9, 14, and the unlock variant of 9 all say some version of *"the
number near me is not the number you might think it is."* Read them in a row:

- "Rate changes since then do not move these numbers." (3)
- "Same job priced today: £Y — £Z more, broken down below." (5)
- "Where the £Z difference is." (7)
- "Pricing controls are locked — commercial, standalone and markup can't move the agreed total." (9)
- "Everything below this line is the live calculation, not what the client agreed." (14)
- "Pricing controls unlocked. Changes move the working figures below… The accepted total does not move." (9, unlocked)

Each one is well written and each one was the right fix for the report that prompted it.
Together they are the tell: **prose is patching a structural problem.** When a screen
needs six captions to stop misreadings, the misreadings are not the reader's fault — two
worlds are interleaved down one column and every caption is a fence around one of them.
§3 argues the fences come down because one of the two worlds should not be there at all.

### 2b. The same money is told several times over

The agreed total prints twice (4's "Accepted total", 5's hero) and is re-derived twice
more on the same screen (6's frozen Labour stat, 13's deposit + balance). The
agreed-vs-today gap prints three times (5's aside, 7's card, and implicitly 3). The
line-level story prints twice (4's agreed lines, 15's live room breakdown of the same
rooms).

The Cost Summary suppression (16) shows the team already found this once and solved it
locally — its comment says it was *"a third telling of the drift story… in the place
most easily mistaken for a breakdown of the accepted total two cards above it."* That
reasoning is right and it applies to more than Cost Summary.

### 2c. Two axes got conflated into one column

There are genuinely two independent questions on this screen:

- **Provenance** — who priced this? The app's engine / a pre-app Xero quote (honoured) /
  an imported accepted quote / a reconciliation rebuilt from Xero.
- **Time** — is this what was agreed, or what it would cost today?

They are orthogonal, but they are rendered as one flat list, so a reader has to hold both
in their head per card and nothing on screen groups by either. That is the actual source
of "everything seems to be getting complicated": it is not too much information, it is
un-grouped information.

### 2d. Three money models where the code already knows there should be one

Summary computes three money models on every render — `quoteTotal` via
`honouredLabour`, `importedBaseline` via `acceptedSnapshot.importedFromXero`, and the
frozen figures — where the snapshot already represents all three: `labour.mode` carries
`honoured` and `lines.imported` carries the Xero baseline, both of which
`frozenQuoteCardHtml()` renders correctly. The final invoice made exactly this
observation about its own copies at `public/index.html:15671`:

> *"Both branches below are already answered by the snapshot when one applies… Left to
> run they would push a SECOND copy of money the frozen lines already carry."*

**Correction to an earlier draft of this document**, which claimed Summary had never had
that pass and that its honoured/imported branches were dead weight on the frozen path.
Checked against the code, that is not true: every display site is already written
`frozenQuote ? <from snapshot> : <honoured or live>`, so on a frozen job the other two
branches are unreachable, not merely redundant. The guardrail in
`scripts/check-snapshot-guardrails.js` is what keeps them that way.

What is real is narrower, and it is a consequence of §3 rather than a finding of its own:
those three models are computed for, and only reach the screen through, the **live**
figures. Once the live money comes off an accepted Summary they are no longer read there
at all, and the ternaries guarding them collapse on their own. So this is not a separate
change — it falls out of §4b, and is listed here only so the branching is not mistaken
for something still needing its own pass.

### 2e. Smaller things worth fixing regardless of the redesign

- **Drift matches lines by description string** (`quoteLineDrift`, `public/index.html:7114`).
  Rename a room after acceptance and its line reports as one `gone` plus one `new`, i.e.
  its whole value twice, sorted to the top of "which lines moved" as the biggest mover on
  the screen. Nothing is wrong with the money; the explanation is just loudly wrong.
  Snapshots are deliberately self-contained (`ACCEPTED_SNAPSHOT_SPEC.md` §1.3) so a room
  id can't be the key — but a stored `sourceKey` on the line, written at capture and never
  resolved against live data, would keep the self-containment and survive a rename.
- **"Labour agreed in a pre-app Xero quote?"** (8) renders on *every ordinary job*, forever,
  as a permanent offer for a rare case. It belongs in the job's settings, not in the
  money column.
- **Commercial / Standalone / Markup (10–12)** are three cards holding one toggle each on
  an accepted job, all locked, all inert. Three cards of chrome for controls that by
  their own caption cannot do anything.

## 3. The question that resolves it — the display was the alarm, the snapshot is the fix

Nicky's own framing, and it is the one that makes the rest of this easy:

> *"All of this got added when I noticed quotes were silently drifting from what was
> agreed."*

That is exactly the history. Before v2.38.0 there was no frozen record, so the only way
to know a quote had moved was to **show today's price beside it and let a human spot the
gap**. The display *was* the safety mechanism, and it was the right one, because nothing
else existed.

It isn't any more. The snapshot is the safety mechanism now: the agreed figures are rows
in an append-only table that no code path updates (`ACCEPTED_SNAPSHOT_SPEC.md` §1.1 —
`routes/api.js` exposes GET and POST and nothing else). They physically cannot move. The
live figure standing next to them is a monitor for a fault that has already been
engineered out, and it costs six captions, a card, a lock strip and a divider to keep on
screen.

### Is it load-bearing anywhere?

The test: if today's money vanished from an accepted job's Summary, what could you no
longer do? Each candidate, checked:

| Needs a live figure? | Verdict |
| --- | --- |
| **Amending** | No. `amendAcceptedQuote()` (`public/index.html:6897`) builds its own live snapshot and prompts with revision N, N+1 and the delta before writing. It reads nothing off Summary. |
| **Variations** | No. They price live, but against a *per-item baseline*, on the Variations card. A whole-job "today" total says nothing about them. |
| **On-site days** | No — that's a **days** figure, not money, and it stays live deliberately (`ACCEPTED_SNAPSHOT_SPEC.md`, "What stays live") because the diary needs real days. |
| **Materials** | No. They legitimately move — they bill as actuals. That is the materials list's job and it is already blind to all of this. |
| **Deposit / payment plan** | No. Frozen, and reads the snapshot. |

Nothing. The calc still has to **run** on an accepted job — variations, materials and
days all need it — but running it and **displaying it as a rival total** are two
different decisions, and the screen currently conflates them.

### What must stay

1. **The loud red banner** for jobs accepted before snapshots shipped
   (`jobQuoteNeedsSnapshot`). Those figures genuinely are live and genuinely are
   drifting. That is a real remaining hole and the warning is correct — a migration
   state, not a permanent feature.
2. **The room breakdown**, as a *working* view: how a measurement gets checked and how a
   variation room is seen. Not as money-versus-money.
3. **Today's price at the moment of amending** — see below.

## 4. The proposal

### 4a. Move the drift card to the amend flow

`quoteDriftCardHtml` is the best-reasoned thing on the screen. It splits labour from
materials, names which lines moved, and states plainly whether the Rates page is
responsible or whether an app release re-costed a room with nothing on the job touched.
Nothing here suggests deleting it.

But *"why is this different from what we agreed?"* is a question asked at exactly one
moment: **when you are about to re-price.** On Summary it is an unprompted answer to a
question nobody asked, rendered where it is most easily mistaken for a breakdown of the
accepted total two cards above it. In the amend flow it is the right information at the
right moment — and the current amend prompt offers a bare `was → now` with no
attribution at all, which is precisely what this card exists to supply.

The whole chain — `quoteDriftCardHtml` → `quoteLineDrift` → `ratesDriftSince` — is
**display-only and reachable from exactly one call site** (`renderSummary()`,
`public/index.html:23730`). Verified by grep: no other caller, no side effects, nothing
persisted. So it relocates wholesale into the amend sheet with nothing else touched.
Amend becomes a sheet rather than a `prompt()`, carrying the card plus the
what-changed note field it already asks for.

### 4b. Summary, accepted job, in full

> **Agreed card** → **Variations** → **Room breakdown** (labelled as working) →
> **Materials** → **Colour Schedule**

That's it. No Today block, no working divider, no lock strip, no hero aside, no
agreed-figures banner — only the red one, and only on unfrozen jobs.

The **Agreed card** absorbs blocks 3, 4, 5, 6 and 13 from §1: total, revision N and its
date, provenance in one line (frozen at acceptance / honoured / rebuilt from Xero), the
agreed lines, deposit and balance, the variations subtotal, and the job total including
variations. Amend and History live on it.

This is materially smaller and safer than the earlier draft of this document, which
proposed keeping today's money behind a collapsed "Today ›" disclosure. That was still
answering the wrong question — it kept the rival total on the screen and merely folded
it up. Deciding it does not belong on an accepted job's Summary at all removes the
disclosure, the captions and the branching together.

### 4c. Pricing controls move off the money column

Commercial, Standalone and Markup (blocks 10–12) exist on an accepted job **only** to
price an amendment — which is why they are locked, and why a strip had to be written to
explain the lock. With amending now a screen of its own, they belong there or in the
job's settings. Three cards of inert chrome leave the money column entirely, and
`acceptedPricingLockHtml` plus its unlock variant are deleted rather than relocated.

### 4d. The three money models collapse on their own

Per the correction in §2d: the frozen render path already reads the snapshot and nothing
else, so there is no separate deletion to make here. Removing the live money (§4b) is
what retires `quoteTotal`, `internalEstimate` and `importedBaseline` from an accepted
job's screen; they stay exactly as they are for jobs still being quoted and for accepted
jobs with no snapshot, which is where they remain load-bearing. The ternaries that
currently pick between the three are simplified in the same change, not before it.

## 5. The one thing lost, and where it should go instead

*"Am I underpricing now compared to when I quoted this?"* — a real question, and the only
genuine use the live figure had left.

It is a **rates-calibration** question across many jobs, not a per-job one, and asking it
one job at a time via a card on every accepted Summary is the worst available way to
answer it. If it is wanted, it belongs with `CALIBRATION_SPEC.md` as a view over closed
jobs, where a trend is visible and a single job's noise is not mistaken for one.

## 6. What this is worth, honestly

The money is all correct today. Every figure on the current screen is right, every
caption is true, and the bugs that produced them were real bugs properly fixed. This is a
**legibility** problem, not a correctness one — which is why it is a proposal rather than
a fix, and why it should be sequenced behind anything that affects what gets billed
(`VARIATIONS_SPEC.md` Part 2, for one).

One caution against doing it piecemeal: every caption in §2a was added *individually*,
each locally justified by a real report. Removing them one at a time will reintroduce
exactly the misreadings that put them there. The captions go when the live money goes, in
one change, or they stay.

## 7. Suggested order

1. **Low risk, anytime, independent of the rest** — drift line matching by stored key
   (§2e); move the "Labour agreed in a pre-app Xero quote?" offer line out of the money
   column.
2. **Drift card → amend sheet** (§4a) — self-contained, one call site, and it is what
   makes step 3 possible without losing anything.
3. **Strip the live money from an accepted Summary** (§4b, §4c) — captions, divider,
   lock strip and pricing cards all in the one change, with §4d's ternaries collapsing
   inside it.
