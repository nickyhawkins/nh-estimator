# Resin Repairs: Size Tiers and On-Site Upgrades Spec

NH Estimator. Builds on `WINDOWS_DOORS_SPEC.md` and `WINDOWS_DOORS_STAGE2_SPEC.md` (both built), and touches `VARIATIONS_SPEC.md` and `STAGED_INVOICING_SPEC.md`.

**Status: BUILT (v2.92.0).** See the FEATURES.md entry for where each piece lives. The open questions in section 10 are answered there.

## 1. Summary

A resin repair was priced as one flat figure whatever its size: the `resin` action in `public/windoors.js` (`DEFAULT_RATES.actions.resin = { mins: 25, cost: 4 }`), and separately `settings.rResin` (22 mins per patch) on the Exterior form's window list. A nail-hole fill and a rebuilt sill nose cost the same, which is unfair in both directions.

This spec:

1. Gives every resin repair a **size tier** (Small, Medium, Large, X-Large) priced as a **fixed base** (setup, consolidating, cure wait, return visit) plus a **per-tier** amount (fill and shaping time, resin used).
2. Lets a repair be **upgraded on site** once it is cut out and the true extent is known.
3. Treats an upgrade as an **expected adjustment**, not a variation. The quote terms already say repairs are priced on estimated size and may increase once exposed, so no client approval is needed. The extra goes straight to the final invoice.

Principle: **the quoted tier is the floor.** A repair can go up a tier on site, never down. One that turns out smaller stays at its quoted price.

## 2. Rates

On the Windows & Doors card of the Rates page (where the action mins and £ already live, `readWindoorsRates()`), the single Resin repair row is replaced with:

| Field | Default | Notes |
|---|---|---|
| Resin base mins | 15 | Once per repair, any size |
| Small: mins / £ | 5 / 2 | Hint: nail hole to thumb-sized |
| Medium: mins / £ | 10 / 4 | Hint: up to palm-sized |
| Large: mins / £ | 25 / 8 | Hint: rail end, cill corner |
| X-Large: mins / £ | 45 / 15 | Hint: sill nose or rail rebuild |

A repair's figure is `base mins + tier mins` at the day rate, plus the tier £ as materials, then markup like any other line. Access multipliers do not apply (same as all marks).

Medium (15 + 10 = 25 mins, £4) matches the old flat figure exactly, so existing quotes do not move. Defaults are placeholders for Nicky to tune.

`mergeRates()` stores this as `actions.resin = { baseMins, tiers: { small: {mins, cost}, medium: {...}, large: {...}, xlarge: {...} } }`. An old saved `actions.resin = { mins, cost }` migrates to `baseMins: 15`, Medium tier `mins - 15` (floored at 0) and `cost`, other tiers default. The hints are fixed text, not settings.

Resin is the only action that takes tiers. The shape is generic (a tiered action, `ACTIONS[].tiered`) so splice could take tiers later.

## 3. Data model

`opening_marks` (`db/setup.sql`, and lazily in `lib/windoors.js` `ensureWindoorsSchema()`):

```sql
ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS size_tier VARCHAR;         -- small | medium | large | xlarge; tiered actions only; NULL = medium
ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS agreed_size_tier VARCHAR;  -- the tier the client agreed (quote, or a sent variation); the floor
ALTER TABLE opening_marks ADD COLUMN IF NOT EXISTS upgraded_at TIMESTAMP;     -- when size_tier was last raised above agreed_size_tier
```

- Existing resin marks: NULL reads as Medium for both columns, so nothing moves on migration.
- `agreed_size_tier` is set when the tier stops being freely editable (section 5). Until then it is NULL and `size_tier` is the only figure.
- Offline sync: the new fields ride the existing marks sync the same as `done_at` (`normaliseMark`).

## 4. Pricing (`Windoors.priceJob`)

A third bucket alongside `quote` and `variations`:

```
adjustments: { mins, materials, count, items }
```

For a resin mark:

- **Quote-stage mark:** the quote gets the price at `agreed_size_tier || size_tier`. If `size_tier` is above that, the difference (tier mins and £ only; base does not change) goes to `adjustments`.
- **Variation-stage mark, variation still draft:** the variation gets the price at `size_tier`. No adjustment.
- **Variation-stage mark, variation sent or approved:** the variation gets the price at `agreed_size_tier`; any upgrade above it goes to `adjustments`.
- `perOpening` gets `adjMins` / `adjMaterials` alongside `quoteMins` and `varMins`.

Rule 3 at the top of `windoors.js` ("quote and variation are never summed into the same figure") extends to adjustments: they are their own figure, never folded into either.

The floor is enforced in pricing too, not just the UI: a `size_tier` below `agreed_size_tier` prices at `agreed_size_tier`.

## 5. When a tier is locked

- **Quote-stage marks:** `agreed_size_tier` is stamped from `size_tier` when the job is accepted (the same moment the accepted snapshot is taken). Before acceptance the tier is freely editable in both directions; it is just quoting. Withdrawing the acceptance lifts the lock.
- **Variation-stage marks:** stamped when their variation is sent to the client (or answered by hand).
- Jobs accepted before this ships: stamp on first load of the job's marks (NULL reads as Medium, which is what they were priced at).
- Amending the accepted quote re-agrees every quote repair at the tier it is at, before the new revision is captured.

## 6. UI

### Quoting (Measure / opening detail)

When the resin action is applied to a part, the mark gets an S / M / L / XL segmented control (hint text under it). It defaults to the tier last used on this job, else Medium. The mark's label reads `Resin repair (cill, L)`.

### On site

On the opening detail on the On Site tab, a resin mark shows its tier control with tiers below `agreed_size_tier` disabled. Tapping a higher tier upgrades it immediately; no sheet, no variation prompt. The change shows as a badge on the mark: `M → L`. Tapping back down to the agreed tier undoes the upgrade.

The elevation drawing gets no new mark style; an upgraded quote mark stays solid.

### Summary / On Site totals

A line under the W&D total: **Repair size adjustments +£X** (only when non-zero), tapping through to a list of upgraded repairs by opening (`Front, ground floor, W1: resin repair (cill) M → L, +£12.40`).

## 7. Where adjustments flow

| Consumer | Behaviour |
|---|---|
| Accepted snapshot / original quote total | Unchanged. Adjustments never move the agreed figure |
| Variations subtotal and approval flow | Not included. No approval needed |
| Client variations page | Its own line, "Repair size adjustments (per quote terms)", included in the updated total, no approve button |
| Interim invoices | Not included (billed on the final invoice only) |
| Final invoice | Its own line: "Resin repairs: size adjustments once exposed (per quote terms)" |
| Work report | Upgraded repairs show their final tier: `resin repair (cill, large)`. No prices |
| Profitability view, Billing section | Invoiced total includes adjustments; quoted does not |
| Xero | The final invoice line above; no Xero quote regenerated |

## 8. Tests

`scripts/test-windoors.js` (module and wiring) and `scripts/test-windoors-resin-tiers.js` (the app in a browser):

- Old `{ mins: 25, cost: 4 }` rates migrate to base 15 / Medium 10 / £4 and price a resin mark at 25 mins / £4.
- NULL `size_tier` prices as Medium.
- Quote mark agreed M, upgraded to L: quote carries M, adjustments carry L minus M, variations untouched.
- Quote mark agreed L, set to S: prices as L, adjustments zero.
- Draft variation mark: tier edits change the variation, no adjustment. After send, an upgrade lands in adjustments.
- Pre-acceptance: tier changes move the quote, adjustments always zero.
- Work report shows the upgraded tier.

## 9. Out of scope

- Tiers for any action other than resin.
- Downgrades or credits for a repair that turns out smaller.
- Actual resin usage tracking.

## 10. Open questions, as built

1. **Client variations page:** shown, no approval, so the running total the client sees matches what will be invoiced.
2. **Interim invoices:** final invoice only.
3. **Final invoice line:** a separate line rather than folded into the fixture's quote line. Labour "as quoted" stays exactly as quoted, and the client can see what the extra is for.
4. **Repairs found on site that were not quoted:** stay as variation-stage marks needing client approval.
5. **Exterior form window list** (`w.resin` patch counts, `settings.rResin`): left flat for now. W&D is the main route; converting it would need the carrier delta sheet in `VARIATIONS_SPEC.md` to gain an "Expected adjustment" outcome.
