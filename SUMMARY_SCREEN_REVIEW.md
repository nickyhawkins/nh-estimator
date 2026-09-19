# Summary screen — review (written 2026-09-19 against v2.69.3)

**Status: REVIEW + PROPOSAL, nothing built.** Raised by Nicky: *"between honouring
Xero quotes, revisions, snapshots, and accepted prices vs what it would cost today,
everything seems to be getting complicated."*

It is, and not because any one feature was wrong. Each of them — the accepted-quote
freeze, revisions, honoured Xero labour, imported jobs, variations — is individually
well-argued in its own spec, and each one arrived on Summary as **another card**. Nobody
ever went back and asked what the screen was now, in total. This is that pass.

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
Together they are the tell: **prose is patching a layout problem.** When a screen needs
six captions to stop misreadings, the misreadings are structural — the two worlds are
interleaved down one column, and every caption is a fence where there should be a wall.

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

Summary still branches three ways — `frozenQuote`, `honouredLabour != null`, and
`acceptedSnapshot.importedFromXero` — for the hero label, the Labour stat, the quote
total and the imported baseline. But **the snapshot already represents all three**:
`labour.mode` carries `honoured`, and `lines.imported` carries the Xero baseline, both of
which `frozenQuoteCardHtml()` renders correctly.

The final invoice worked this out already. Its comment at `public/index.html:15671`:

> *"Both branches below are already answered by the snapshot when one applies… Left to
> run they would push a SECOND copy of money the frozen lines already carry."*

Summary has not had that pass. On a frozen job the honoured/imported branches are mostly
dead weight — kept alive, read on every render, and each one a place a future change has
to be remembered in three times.

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

## 3. The proposal

**One question decides the whole screen: has this been agreed?**

### Not agreed (draft / quoted)

Today's calculation *is* the answer, and there is no second world to confuse it with.
The current screen is broadly right. Only change: the pre-app-Xero offer line moves out.

### Agreed (accepted / completed / invoiced)

Two blocks, in this order, and nothing interleaved:

**A. Agreed — one card, the whole agreed record.**
Total, revision N, date, provenance in one line (frozen at acceptance / honoured /
rebuilt from Xero), the agreed lines, deposit + balance, variations subtotal, and the
**job total incl. variations**. Amend and History live here. This card answers "what does
the client owe" completely, with nothing on screen contradicting it.

Blocks 3, 4, 5, 6 and 13 collapse into this one card. The frozen Labour stat becomes a
row inside it rather than a stat tile under a hero that means something else.

**B. Today — one collapsed row.**

> `Same job priced today: £Y  (+£Z)  ›`

Tapping it expands into: the drift card (7), the room breakdown (15), and the Cost
Summary (16, which can come back — inside here it can't be mistaken for the agreed
total). Pricing controls (10–12) live inside it too, unlocked, because **opening "Today"
is the unlock** — self-evidently the live side, no lock strip needed to explain it.

That single disclosure replaces blocks 9 and 14 outright and removes the need for 3 and
5's aside: the wall does what six captions were doing. If the two figures agree to the
penny, the row still shows, reading *"Same as agreed"* — which is worth knowing and
currently isn't stated anywhere.

**C. Below** — Materials, Add Material, Colour Schedule, unchanged. These are working
lists, not money, and they are already correctly blind to all of the above.

### And collapse the three money models to one

On a frozen job, read the snapshot and stop — delete the `honouredLabour` and
`importedFromXero` branches from the frozen render path, exactly as the final invoice
already did. They stay live for jobs with no snapshot, which is the only place they are
still load-bearing. This is the single biggest reduction in branching on the screen and
it removes real duplicated state, not just visual clutter.

## 4. What this is worth, honestly

The money is all correct today. Every figure on the current screen is right, each caption
is true, and the bugs that produced them were real bugs properly fixed. This is a
**legibility** problem, not a correctness one — which is why it is a proposal rather than
a fix, and why it should be sequenced behind anything that affects what gets billed
(`VARIATIONS_SPEC.md` Part 2, for one).

One caution against doing it piecemeal: every caption on the list in §2a was added
*individually*, each one locally justified. Removing them one at a time will reintroduce
exactly the misreadings that put them there. The captions go when the wall goes up, in
one change, or they stay.

## 5. Suggested order

1. **Low risk, do anytime, independent of the redesign** — drift line matching by stored
   key (§2e), move the pre-app-Xero offer line out of the money column.
2. **The snapshot collapse** (§2d) — pure de-duplication, no visual change, makes the
   rest safe to attempt.
3. **The A/B split** (§3) — one change, captions removed in the same commit as the wall
   going up.
