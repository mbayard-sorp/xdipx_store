# Step 5.5 Backfill — Scope (REVISED)

**Status:** Scoping doc — supersedes prior version that misframed this as full enrichment
**Date:** 2026-05-16
**Scope:** Tag-only backfill of `matters_tags`. Mirrors the proven audience-tagging pipeline. Max-billed, zero API spend.
**Pattern reference:** [audience-tagging-runbook.md](https://github.com/mikebayard/xdipx_store/blob/main/docs/audience-tagging-runbook.md) — same shape, different vocabulary.

---

## Why this is different from full enrichment

The prior `mood_tags` and `audience_tags` backfills used a rule-first + subagent-tail pattern, not full product enrichment. Same applies here.

**Two-stage classification:**
1. **Deterministic rules in TypeScript** handle the majority — keywords in title/description/specs map directly to known tag values. Zero LLM calls.
2. **Subagent dispatch on the ambiguous tail** — only products whose tag set can't be confidently inferred by rules. Chunks of 75 per dispatch. Runs on Mike's Max subscription via `emma-product-enricher`. Zero Anthropic API spend.

This is fundamentally not generation — it's classification against a controlled 12-chip vocabulary.

---

## Source data for classification

Each product brief includes both:

- **Current Shopify description** (`descriptionHtml`) — Emma-rewritten copy, useful for tone signals
- **Original Nalpac description** (`custom.original_description` metafield) — pre-rewrite, contains raw specs and manufacturer claims that the Emma rewrite often softens or removes
- **Product type** + **existing metafields** (rechargeable specs, waterproof rating, dimensions, materials)
- **Existing audience/mood tags** — products tagged "Plus-size friendly" in audience often imply specific matters tags

The Nalpac original is critical — it's where the literal "rechargeable", "100% body-safe silicone", "30-day battery life" specs live. Emma's rewrites may not.

---

## Rule-first pass

Run `scripts/build-matters-briefs.ts` (new — mirrors `build-audience-briefs.ts`). Deterministic rules per chip:

| Chip | Rule signal |
|---|---|
| Beginner-friendly | Product type ∈ {first-time vibrator, beginner-kit} OR existing tag contains "starter"/"intro" OR original description matches /beginner|first[- ]time|intro/i |
| Whisper-quiet | Original or current description matches /whisper[- ]quiet|silent|<\s*30\s*db/i |
| Waterproof | Original spec contains "waterproof" / "IPX7" / "submersible" / "bath-safe" |
| Travel-ready | Description matches /travel|locking|TSA|carry/i AND has dimensions <6in |
| Discreet | Description matches /discreet|plain packaging|unmarked|matte/i OR product type ∈ {lipstick-vibe, bullet} |
| Hands-free | Description matches /hands[- ]free|suction[- ]cup|wearable/i OR has harness/strap accessories |
| Remote-controlled | Description matches /remote|app[- ]controlled|wireless/i OR existing tag includes app-controlled |
| Plus-size friendly | Existing audience tag includes plus-size OR description matches /inclusive|extended size|XL\+/i |
| Easy to clean | Material ∈ {silicone, glass, metal, ceramic} AND (no textured insertable OR detachable OR dishwasher-safe spec) |
| Rechargeable | Original spec contains "rechargeable" / "USB" / "magnetic charging" |
| Soft-touch | Material is silicone or TPE AND description matches /soft|velvety|skin[- ]like/i |
| Latex-free | Material is silicone/TPE/glass/metal (not rubber/latex blend) — true for ~all modern toys |

For each product, the rule pass writes:
- `proposedTags`: array of tags the rules are confident about
- `needsClaude`: boolean — true if the product has ambiguous signal (e.g., generic description, missing original_description, unclear material)
- `rationale`: which rules fired

Estimated rule coverage: **70-85%** of 2,488 untagged products. Same range the audience pipeline hit.

---

## Subagent tail pass

For the remaining ~400-750 ambiguous products:

```bash
npx tsx scripts/chunk-matters-briefs.ts --size=75
# → matters-proposal-briefs.chunk-01.json ... chunk-NN.json
```

Each chunk file is a self-contained payload with:
- 75 product briefs (title, current description, **original Nalpac description**, product type, existing tags, materials, specs)
- The 12-chip canonical vocab inline
- The rule-rationale for each product (so the subagent sees what rules already fired and only needs to add what's missing)

Operator dispatches each chunk to a subagent in chat — one prompt per chunk:

> Generate `matters_tags` for each of these 75 products. Use the 12-chip vocab provided. Reference the original Nalpac description as the source of truth for specs. Return a JSON array of `{ shopifyProductId, mattersTags, rationale }` objects.

The subagent runs as one full session per chunk — sees all 75 products in context, generates tags for all of them in one assistant turn. Runs on Sonnet via Max subscription. **Zero Anthropic API spend.**

---

## Apply pass

`scripts/apply-matters-to-shopify.ts` (new — mirrors `apply-audience-to-shopify.ts`):
- Reads rule-pass results (proposedTags for the deterministic majority)
- Reads subagent outputs from chunk-NN proposal files
- Writes to `xdipx.matters_tags_v2` shadow metafield (per Co-Work step 4 shadow-tag period)
- Per-product rationale → `custom.matters_rationale` metafield (mirrors `audience_rationale` pattern)

48-hour shadow period, diff against existing `matters_tags`, then flip live.

---

## Cost

| Item | Cost |
|---|---|
| Anthropic API spend | **$0** |
| Operator time (rule-pass dev) | ~3 hours one-time (write `build-matters-briefs.ts`, mirroring audience pattern) |
| Operator time (chunk dispatch) | ~5-10 min/chunk × ~6-10 chunks = **1-2 hours attended** |
| Max subscription quota | ~6-10 subagent dispatches; fits comfortably in one or two 5-hour windows |
| Shadow-period operator time | ~30 min reviewing diff output |

---

## Time estimate

| Phase | Duration | Type |
|---|---|---|
| Build `scripts/build-matters-briefs.ts` + rules | ~3 hours | dev work |
| Build `scripts/chunk-matters-briefs.ts` + `apply-matters-to-shopify.ts` | ~2 hours | dev work (mostly copy-paste from audience pipeline) |
| Run rule pass | ~5 min | automated |
| Dispatch 6-10 subagent chunks | 1-2 hours | attended chat |
| Apply results to Sanity (shadow field) | ~30 min | automated |
| 48-hour shadow period | 48 hours elapsed | wait |
| Diff review + QA sample (see below) | ~3 hours | attended |
| Flip shadow → live | ~10 min | automated |
| **Total elapsed** | **~3 days** | (mostly the shadow-period wait) |
| **Total active operator time** | **~9 hours** | |

---

## QA sampling plan

Co-Work review proposed 5% (~125 products), stratified.

**Revised: smaller sample, two-pass.**

- **Rule-pass QA:** review rule outputs on a 50-product stratified sample (10 per product type bucket — vibrator, wand, lube, wear, other). ~1 hour. If >10% wrong, fix the rule and re-run; don't proceed to chunking.
- **Subagent QA:** review 5% of subagent-tagged products (~25 products). ~30 min. Same rubric as Co-Work's binary check.

Total QA: ~75 products, ~1.5 hours. Smaller than 125 because the deterministic rule-pass is auditable in TypeScript — review the rules, not every output.

**Rubric (binary):**
1. Are the assigned tags accurate?
2. Are any obvious tags missing?
3. Did the subagent invent a tag not in canonical vocab?

Failure handling per Co-Work review unchanged.

---

## What gets built (one-time dev work)

Three new scripts in `scripts/`, mirroring the audience-tagging trio:

1. **`scripts/_matters-rules.ts`** — rule registry (the table above as code)
2. **`scripts/build-matters-briefs.ts`** — pull products from Shopify, apply rules, write `matters-proposal-briefs.json`
3. **`scripts/chunk-matters-briefs.ts`** — split ambiguous tail into 75-product chunks
4. **`scripts/apply-matters-to-shopify.ts`** — write shadow metafield + rationale

Use audience-tagging files as templates. The diff is the rule registry and the vocabulary.

---

## Pre-run checklist

Before kicking off:

- [ ] Step 1.5 (casing normalization) has landed
- [ ] New 12-chip `MATTERS` vocab is in [app/types/discovery.ts](../app/types/discovery.ts) and `askEmmaVocabulary` Sanity singleton
- [ ] `xdipx.matters_tags_v2` metafield definition created in Shopify Admin
- [ ] `custom.matters_rationale` metafield definition created (mirrors `audience_rationale`)
- [ ] Three new scripts written, code-reviewed, dry-run passed
- [ ] Rule QA pass clears >90% on the 50-product sample

---

## Open questions for Co-Work

1. **Rule coverage estimate.** 70-85% based on audience pipeline. Acceptable for the rule pass to do most of the work, with the subagent handling the tail? (If Co-Work wants 100% Claude review, costs go up materially.)
2. **QA sample size.** Reduced from 125 to 75. Co-Work happy with the rationale, or want to keep 125?
3. **`Easy to clean` rule.** Encoded as: `material ∈ {silicone, glass, metal, ceramic} AND (non-textured insertable OR detachable OR dishwasher-safe spec)`. Confirm this matches Co-Work's intent.

---

## References

- Pattern reference: [audience-tagging-runbook.md](../../../wizardly-mccarthy-32cc56/docs/audience-tagging-runbook.md)
- Existing scripts to copy from: `scripts/build-audience-briefs.ts`, `scripts/chunk-audience-briefs.ts`, `scripts/apply-audience-to-shopify.ts`, `scripts/_audience-rules.ts`
- Subagent: `.claude/agents/emma-product-enricher.md`
- Original description metafield: `custom.original_description` (read via [app/lib/shopify.server.ts:105](../app/lib/shopify.server.ts))
- Path A review: [docs/what-matters-path-a-review.md](what-matters-path-a-review.md)
