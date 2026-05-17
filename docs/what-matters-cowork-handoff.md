# "What Matters" — Final Sign-Off Handoff

**To:** Co-Work
**From:** Code
**Date:** 2026-05-16
**Asking for:** Final sign-off on the chip set, the backfill plan, and three open scoping questions. After your approval, step 0a kicks off and the migration moves to execution.

---

## What's locked

Per [what-matters-path-a-review.md](what-matters-path-a-review.md):

**Final 12-chip set (web canonical), sentence-case:**

1. Beginner-friendly *(merges First-time)*
2. Whisper-quiet
3. Waterproof
4. Travel-ready *(renamed from Travel-size)*
5. Discreet *(renamed from Discreet-design)*
6. Hands-free *(split from "Hands-Free or remote")*
7. Remote-controlled *(split — was App-controlled)*
8. Plus-size friendly
9. Easy to clean *(NEW)*
10. Rechargeable *(retained per data)*
11. Soft-touch *(retained per data)*
12. Latex-free *(NEW)*

**SMS subset:** `Beginner-friendly · Discreet · Waterproof · Hands-free · Just show me`

**Sequencing:** Code lands behind `MATTERS_V2_ENABLED` flag. User-visible launch gates on catalog backfill ≥80% coverage. Kill-criterion 30-day clock starts at `backfill_complete_date`, not chip-swap-merge.

---

## What's changed since your last review

### 1. Backfill is Max-billed, not API-billed

Original scope misframed this as full product enrichment via Anthropic Batches API at $50-75. After review of the prior `mood_tags` and `audience_tags` backfill pipelines, the correct pattern is:

- **Deterministic rules in TypeScript** classify the majority (estimated 70-85% of 2,488 products) with zero LLM calls
- **`emma-product-enricher` subagent on Max subscription** handles the ambiguous tail in chunks of 75 products per dispatch
- **Zero Anthropic API spend.** Mirrors exactly what the audience-tagging pipeline did.

Full revised scope: [docs/what-matters-backfill-scope.md](what-matters-backfill-scope.md).

**Cost:** $0 API + ~9 hours of active operator time + 48-hour shadow period wait. ~3 days elapsed total.

### 2. Source data now includes both descriptions

The brief for each product includes:

- Current Shopify description (Emma-rewritten — useful for tone signals)
- **Original Nalpac description (`custom.original_description` metafield)** — pre-rewrite, contains literal manufacturer specs like "rechargeable," "100% body-safe silicone," "IPX7 waterproof rating"

The Nalpac original is the source of truth for spec-based chips (Rechargeable, Waterproof, Latex-free, Soft-touch). Emma's rewrites often soften or remove these literal specs.

### 3. QA sample reduced from 125 to 75 (with reasoning)

- **50-product rule-pass QA** (10 per product-type bucket) — review the rule outputs to validate the rule registry. Cheaper than reviewing every output because rules are auditable in TypeScript.
- **25-product subagent QA** (5% of estimated subagent-tagged tail) — same binary rubric as your prior review.

Same rigor, narrower target. Open to going back to 125 if you'd rather over-sample.

---

## Three open questions for your sign-off

### Q1 — Rule coverage acceptable?

Rule-first pass estimated to cover 70-85% of 2,488 products with zero LLM calls. Remaining 15-30% (~400-750 products) go through the subagent. This matches the audience-tagging pipeline's actual coverage rate.

**Decision:** Approve rule-first, or require 100% subagent review (significantly more dispatch time, no $ cost change)?

### Q2 — QA sample: 75 or 125?

Recommendation: 75 (50 rule-pass + 25 subagent). Alternative: 125 per your prior review.

**Decision:** 75 or 125?

### Q3 — `Easy to clean` rule

Proposed encoding: `material ∈ {silicone, glass, metal, ceramic} AND (non-textured insertable OR detachable parts OR dishwasher-safe spec)`.

Direct transcription of your wording from the step 0 review. Confirming before encoding into [scripts/_matters-rules.ts](../scripts/_matters-rules.ts).

**Decision:** Approve as written, or amend?

---

## What happens after your sign-off

1. **Step 0a:** Register GA4 custom dimensions (`chip_group`, `chip_value`, `chip_on`). Wire SMS gate advance to `sms_turns.metadata` JSONB. Introduce `MATTERS_V2_ENABLED` env-var flag (no existing convention in repo — confirming env-var is acceptable vs. Sanity-managed).
2. **Step 1.5:** Casing normalization PR — independent, lands immediately.
3. **Steps 1-3:** Chip set rename PR — code lands behind flag.
4. **Step 5.5 dev work:** Write `_matters-rules.ts`, `build-matters-briefs.ts`, `chunk-matters-briefs.ts`, `apply-matters-to-shopify.ts` (mirroring the audience trio).
5. **Step 5.5 execution:** Rule pass → chunk dispatch → apply to shadow metafield → 48-hour diff → flip live.
6. **Coverage clears ≥80%:** Flip `MATTERS_V2_ENABLED=true`. Launch. Start kill-criterion clock.

---

## Trust-but-verify summary table

| Concern | Resolution |
|---|---|
| Original instinct to drop Soft-touch and Rechargeable | Overruled by data — kept |
| 8-chip ceiling | Broken to 12 by data + your additions |
| Casing chaos in existing tags | Independent normalization PR (step 1.5) before swap |
| 61% catalog untagged | Blocks launch (not code) until backfill clears 80% |
| Kill-criterion firing for wrong reason (sparse coverage) | Start clock at backfill-complete, not chip-swap-merge |
| GA4 custom dimensions not retroactive | Registered in step 0a; data starts accumulating from registration |
| Backfill cost | $0 — Max-billed via existing subagent pattern |
| QA rigor | 75-product sample (50 rule + 25 subagent) — open to 125 |

---

## Document trail

1. [docs/what-matters-proposal.md](what-matters-proposal.md) — original audit + 8-chip proposal
2. [docs/what-matters-cowork-review.md](what-matters-cowork-review.md) — your first review, dropped to 9 chips, set kill criterion
3. [docs/what-matters-step0-amendment.md](what-matters-step0-amendment.md) — instrumentation grep, narrowed step 0 to 1 day
4. [docs/what-matters-step0-amendment-review.md](what-matters-step0-amendment-review.md) — your additions: result-set narrowness, per-chip lift, `Easy to clean` kill criterion
5. [docs/what-matters-path-a-amendment.md](what-matters-path-a-amendment.md) — data findings: GA4 too thin, Sanity narrowness revealed Co-Work drop list was half wrong
6. [docs/what-matters-path-a-review.md](what-matters-path-a-review.md) — your concession + chip #12 (Latex-free) + kill-criterion sequencing fix
7. [docs/what-matters-backfill-scope.md](what-matters-backfill-scope.md) — current scope (this doc references)
8. **This doc** — final sign-off ask

---

## What I need from you

Three answers (Q1, Q2, Q3 above). Anything else you want clarified.

After sign-off, step 0a kicks off and the rest of the migration is autopilot through the runbook.
