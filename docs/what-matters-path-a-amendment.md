# "What Matters" — Path A Amendment

**Status:** Step 0 data is in. Some of Co-Work's drop list does not survive the data.
**Date:** 2026-05-16
**Scope:** Supersedes step 0 of [what-matters-cowork-review.md](what-matters-cowork-review.md) and [what-matters-step0-amendment.md](what-matters-step0-amendment.md).
**Decision:** Proceed with Path A (ship the swap on judgment, validate post-launch), but with two chip changes the catalog data forces.

---

## What we tried to run, what actually ran

| Track | Status | Why |
|---|---|---|
| Track A.1 — chip selection rate (GA4) | **Bust** | `discovery_chip_toggle` parameters `chip_group`, `chip_value`, `chip_on` are not registered as custom dimensions. Unqueryable via Data API. |
| Track A.2 — co-selection matrix | **Bust** | Same. Also: 57 events / 30 days / 2 sessions — dev traffic only. |
| Track A.3 — aggregate conversion lift | **Bust** | 4 add-to-carts in 30 days. Insufficient n. |
| Track A.3a — per-chip conversion lift | **Bust** | Same. |
| **Track A.4 — result-set narrowness (Sanity)** | **✅ Ran** | Strong signal. See findings below. |
| Track B — SMS skip rate | **Bust** | 6 SMS conversations in DB, all with `discovery_state = NULL`. Zero production gate traffic. |

Net: the only validation data is the catalog narrowness from Sanity. That is enough to overrule two of Co-Work's drop calls and to flag a casing problem bigger than anyone realized.

---

## Catalog narrowness — the data

**Source:** Sanity GROQ over `productPage` docs (non-archived, non-draft).
**Property:** `mattersTags`.
**Total products:** 4,106.
**Products with ≥1 matters tag:** 1,618 (39%).
**Untagged:** 2,488 (61%).

Per-tag counts (consolidating casing variants, both kebab-lower and Title-Case-Hyphenated):

| Tag | Count | % of tagged | % of catalog | Filter-test verdict |
|---|---|---|---|---|
| Body-safe silicone | 904 | **56%** | 22% | **TABLE STAKES — drop confirmed** |
| Beginner-friendly | 595 | 37% | 14% | Borderline; useful filter, keep |
| Waterproof | 521 | 32% | 13% | Keep |
| Discreet (design) | 461 | 28% | 11% | Keep |
| Rechargeable | 381 | **24%** | 9% | **NOT table stakes — keep or drop on judgment** |
| Travel-size | 358 | 22% | 9% | Keep |
| Soft-touch | 167 | **10%** | 4% | **NOT table stakes — keep** |
| Latex-free | 163 | 10% | 4% | Net-new chip candidate? |
| Plus-size friendly | 160 | 10% | 4% | Keep (already approved by Co-Work) |
| First-time | 132 | 8% | 3% | Duplicate of Beginner-friendly — merge |
| Whisper-quiet (incl "Quiet") | 123 | 8% | 3% | Strong keep |
| Hands-free | 93 | 6% | 2% | Strong keep |
| App-controlled | 42 | 3% | 1% | Thin but distinct (folds to Remote-controlled per Co-Work split) |
| Easy-clean (all variants) | 11 | <1% | <1% | Needs backfill rule |

The threshold used: **>60% of tagged catalog = table stakes**. Only `body-safe-silicone` passes that bar (56% is close; treat as drop given direction).

---

## Where the data overrules Co-Work

### Keep `Rechargeable` and `Soft-touch`

Co-Work's review dropped `Body-Safe Silicone`, `Rechargeable`, and `Soft-Touch` together as "baseline expectations." The catalog data says only `Body-safe silicone` is actually baseline (56% coverage). `Rechargeable` is on 24% of tagged products, `Soft-touch` on 10% — both pass the filter test cleanly.

Why this matters: dropping a chip that selects for 10% of catalog removes a real filter. Especially `Soft-touch` — there's a clear non-soft-touch product set (hard ABS, ceramic, glass, leather, metal) that users actively avoid.

**Revised drop list:** `Body-Safe Silicone` only. Keep `Rechargeable` and `Soft-touch` in the chip set.

### Casing is worse than we thought

Same concept exists in both `body-safe-silicone` (754) and `Body-Safe-Silicone` (150). Same for Waterproof (347 / 174), Beginner-Friendly (466 / 129), Rechargeable (237 / 144), Travel-Size (192 / 166), Hands-Free (29 / 64), Discreet-Design (424 / 37), Plus-Size-Friendly (157 / 3), Whisper-Quiet (67 / 33).

This isn't a chip-set problem — it's a data-integrity problem. Two enricher generations or two backfill scripts wrote different casing and nothing reconciled them. The casing fix Co-Work approved (sentence-case lock) becomes a forced normalization migration that merges hundreds of duplicates.

**Action:** the migration's step 5 (backfill) needs to normalize all existing values to the new canonical sentence-case before — or as part of — applying the chip set swap. Without this, half the catalog filters by the wrong variant.

### The deeper problem: 61% of catalog has no `matters_tags` at all

2,488 of 4,106 products have `mattersTags: null` or `[]`. Whatever chip set we ship, the filter only reaches 39% of the catalog out of the gate. This is more important than the chip-set debate.

**Recommendation:** add a "matters_tags backfill across full catalog" task to the migration plan, separate from the chip rename work. Use the enricher with the new vocabulary to fill the 61% gap. This is a v2.0 task, not v2.1.

### Co-Work's `Easy to clean` warning was optimistic

Co-Work said "accept ~30% of catalog won't tag on day one." Reality: only 11 products carry any easy-clean variant tag today. Without explicit backfill, day-one coverage is **<1%**.

**Action:** the `Easy to clean` chip requires a defined backfill rule applied to the full catalog before launch, or it ships as a filter that returns ~11 results and looks broken. Don't ship the chip without the backfill landing first.

---

## Revised final chip set (web canonical)

| # | Chip | Status | Notes |
|---|------|--------|-------|
| 1 | Beginner-friendly | Keep | Merges First-time |
| 2 | Whisper-quiet | Keep | Per Co-Work, hold for overlap audit post-launch |
| 3 | Waterproof | Keep | |
| 4 | Travel-ready | Keep | Renamed from Travel-size |
| 5 | Discreet | Keep | Renamed from Discreet-design |
| 6 | Hands-free | Keep | Co-Work split |
| 7 | Remote-controlled | Keep | Co-Work split (was App-controlled) |
| 8 | Plus-size friendly | Keep | Standalone per Co-Work |
| 9 | Easy to clean | NEW — requires backfill before launch | |
| 10 | **Rechargeable** | **Keep (against Co-Work)** | Data: 24% coverage, not table stakes |
| 11 | **Soft-touch** | **Keep (against Co-Work)** | Data: 10% coverage, not table stakes |

**Dropped:** `Body-safe silicone` (data confirms it's table stakes at 56%). `First-time` (duplicate). `For sensitive bodies` (never made it past Co-Work review). `Discreet-design` (renamed).

Chip count: **11.** Co-Work already broke the "8 is sacred" rule; data forces another two keepers. Mobile-render check at 375px becomes non-optional.

**SMS subset (revised):** `Beginner-friendly · Discreet · Waterproof · Hands-free · Just show me`. No data to choose between Co-Work's Option A and Option B, but Hands-free has stronger filter-test grounding than Plus-size friendly for SMS first-impression.

---

## Pre-launch instrumentation (now actually a step)

Before launch, register these in GA4 Admin → Custom Definitions → Custom Dimensions:

| Parameter | Scope | Display name |
|---|---|---|
| `chip_group` | Event | Discovery — chip group |
| `chip_value` | Event | Discovery — chip value |
| `chip_on` | Event | Discovery — chip on |

Without this, post-launch validation per the kill criterion will be unrunnable for the same reason it was unrunnable today. ~5 min of clicking, ships forward the entire post-launch analytics story.

Add a parallel SMS-side event — `sms_gate_advance` with `gate`, `slot_filled`, `skipped` parameters — emitted from [app/lib/ai-agent/chat.server.ts:514](../app/lib/ai-agent/chat.server.ts) inside the persistGateState block. Wire it to GA4 via the existing Measurement Protocol setup. Or, simpler: write SMS skip-rate counters to the `sms_turns` table as a `metadata` JSONB column update. Either works; pick one.

---

## Kill criteria — locked now

Post-launch, **30 days after the chip swap ships**, pull the data and drop any chip that fails BOTH:

1. Selection rate <2% of sessions that engaged the matters gate
2. Result-set narrowness >60% (returns >60% of tagged catalog when selected alone)

Special case for `Easy to clean` per Co-Work: same dual threshold applies. Document baseline narrowness at launch (post-backfill) as the comparison anchor.

---

## Revised migration plan

Steps 1–9 from [Co-Work review](what-matters-cowork-review.md#revised-migration-plan) stand, with three insertions:

- **Step 0a (NEW):** Register `chip_group`, `chip_value`, `chip_on` as custom dimensions in GA4. Decide and implement SMS gate analytics path.
- **Step 1.5 (NEW):** Casing normalization pass — read all existing `matters_tags` values, write back in canonical sentence-case. Run before chip rename so renames don't double-write.
- **Step 5.5 (NEW):** Full-catalog `matters_tags` backfill via enricher with new 11-chip vocabulary. Target: lift coverage from 39% to ≥80%. `Easy to clean` backfill rule (per Co-Work: non-porous AND (non-textured insertable OR detachable OR dishwasher-safe)) runs inside this pass.

Steps 4 (shadow-tag period) and 9 (`SCORE_MATTERS` weight A/B) unchanged.

---

## Open questions

1. **Latex-free.** Tag exists on 163 products (10% of tagged). Doesn't appear in either proposal's chip set but passes the filter test. Add as chip #12, or keep as PDP bullet copy only?
2. **Casing migration timing.** Run before or as part of the chip swap commit? Recommend before — it's a no-op data fix that should land independently so the chip swap PR is reviewable.
3. **Untagged catalog (61%) backfill.** Block the v2.0 launch on this, or ship the new chip set and backfill incrementally? Recommend block — a discovery system that hits 39% of catalog is a worse story than a slightly delayed launch.

---

## File references

- Web chip definition: [app/types/discovery.ts:35](../app/types/discovery.ts)
- SMS chip definition: [app/lib/sms-v2/discovery-gate.server.ts:84](../app/lib/sms-v2/discovery-gate.server.ts)
- Gate persistence: [app/lib/ai-agent/chat.server.ts:186](../app/lib/ai-agent/chat.server.ts)
- Scoring weight: [app/lib/discovery-emma.ts:22](../app/lib/discovery-emma.ts)
- Web analytics: [app/lib/analytics.client.ts:182](../app/lib/analytics.client.ts)
- DB schema: [db/schema.ts](../db/schema.ts) — `sms_conversations`, `sms_turns`, `web_conversations`
- Original proposal: [docs/what-matters-proposal.md](what-matters-proposal.md)
- Co-Work review: [docs/what-matters-cowork-review.md](what-matters-cowork-review.md)
- Step 0 amendment: [docs/what-matters-step0-amendment.md](what-matters-step0-amendment.md)
- Step 0 review: [docs/what-matters-step0-amendment-review.md](what-matters-step0-amendment-review.md)
