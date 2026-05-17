# "What Matters" — Remaining Steps Handoff

**Date:** 2026-05-17
**Branch:** `claude/gifted-spence-00de20`
**Status:** Steps 0a, 1-3, 1.5, 4, 5.5, 7, 8 shipped. Step 6 + diff tool + flip remain.
**Prerequisite reading:** [what-matters-final-signoff.md](../../../xdipx_store/docs/what-matters-final-signoff.md) (outside worktree)

---

## Where things stand

### Live in production

- **Shadow metafield `xdipx.matters_tags_v2`** is populated catalog-wide (4,210 products, 8,370 metafield writes, 4 errors on deleted products).
  - 3,019 from rule pass + 1,191 from Claude pass
  - 3,472 products have ≥1 tag → **82.5% catalog coverage** (clears Co-Work's 80% launch gate)
  - 738 products have empty v2 tags (mostly lubes, toy cleaners, novelty items that legitimately don't fit any chip)
- **`custom.matters_rationale`** populated alongside — grepable trace for every classification ("Rule pass: M-EZ-1 ...", "Claude pass: ...")
- **Sanity `productPage.mattersTags`** normalized to sentence-case (1,595 docs patched in step 1.5)
- **`MATTERS_V2_ENABLED` env flag** plumbed through:
  - UI chip render: gated via `getActiveMatters()` in [app/lib/feature-flags.server.ts](../app/lib/feature-flags.server.ts)
  - SMS gate options: gated via `mattersOpts()` in [app/lib/sms-v2/discovery-gate.server.ts](../app/lib/sms-v2/discovery-gate.server.ts)
  - Enricher vocab source: gated via `activeMattersVocab()` in [app/lib/ask-emma-vocab.server.ts](../app/lib/ask-emma-vocab.server.ts)
  - SEO research vocab: routed through `getAskEmmaVocabulary()` in [app/lib/seo-research.server.ts](../app/lib/seo-research.server.ts)
- **`MATTERS` constant is the union v1 ∪ v2** in [app/types/discovery.ts](../app/types/discovery.ts) — acts as the allow-list filter so both vocabularies pass during the transition

### Not yet flipped

- `MATTERS_V2_ENABLED` is `false` in every environment. The v2 chip set exists but is not user-visible.
- Live `xdipx.matters_tags` still holds the legacy v1 values (mostly Title-Case-Hyphenated + some kebab-case + some noise like `water-based`).
- After the flip, products' live `matters_tags` need to mirror what's in `matters_tags_v2` for filters to work cleanly.

### Commit trail

| Commit | What |
|---|---|
| `adbd82a` | Step 0a — feature flag, SMS gate analytics, migration 036 |
| `44c7cac` | Step 1.5 — Sanity casing normalization |
| `68f60bd` | Steps 1-3 — v2 chip-set vocabulary behind flag |
| `40555ff` | `scripts/_matters-rules.ts` — rule registry |
| `52880b8` | Fix: `needsClaude` fires on empty rule output |
| `8e7300f` | `scripts/build-matters-briefs.ts` |
| `d76c3fc` | `scripts/chunk-matters-briefs.ts` |
| `efb47b8` | `scripts/apply-matters-to-shopify.ts` |
| `bac24db` | `scripts/dispatch-matters-chunks.ts` |
| `ebffe62` | Fix: tolerant JSON parse + salvage mode + tighter prompt |
| `a07857f` | Fix: metafieldDefinitions connection for shadow-def check |
| `8640787` | Step 7 — enricher + Emma vocab gated |
| `ca063ed` | Step 8 — SEO research vocab routed through gated accessor |

---

## Remaining work, in recommended order

### A. Diff tool (1-2 hours) — DO THIS FIRST

Build `scripts/diff-matters-shadow.ts` so you and Co-Work can spot-review the v1 → v2 transition before flipping.

**Goal:** for every product, produce a CSV row with:

| Column | Source |
|---|---|
| `handle` | Shopify product handle |
| `title` | Shopify product title |
| `v1_tags` | Current `xdipx.matters_tags` JSON-decoded |
| `v2_tags` | Current `xdipx.matters_tags_v2` JSON-decoded |
| `added` | Values in v2 but not v1 |
| `removed` | Values in v1 but not v2 |
| `kept` | Values in both (after sentence-case normalization) |
| `rationale` | Current `custom.matters_rationale` |
| `regression_risk` | Score 0-3 based on how many tags lost without v2 equivalent |

**Implementation notes:**

- Mirror the pagination pattern from `scripts/build-matters-briefs.ts` (Shopify Admin GraphQL, 100/page, 1s sleep every 2 pages)
- The "regression risk" heuristic is judgement-y. Simplest: 0 if v1 was empty or only had noise (e.g., `water-based`), 1 if 1 legit chip lost without v2 equivalent, 2 if 2+, 3 if all v1 chips dropped and v2 is empty
- Output CSV to stdout so it can pipe to `pbcopy` or `> diff.csv`
- Also print a stderr summary block:
  - Total products
  - % added tags
  - % removed tags
  - % no change (after casing normalization)
  - Top 10 most-added v2 chips
  - Top 10 most-removed v1 chips
  - High-risk regression count

**Reference scripts to copy from:** `scripts/build-matters-briefs.ts` (Shopify query + pagination), `scripts/normalize-matters-tags-casing.ts` (sentence-case canonicalization for the "kept" diff).

**Run:** ~5-10 min against the full 4,210-product catalog.

**Review:** spot-check ~50-100 high-risk rows by hand. If the regression risk distribution looks acceptable (most products either gained tags or kept the same signal), proceed to step B/C.

### B. Step 6 — PDP fallback for `Body-safe silicone` (~1-2 hours)

`Body-safe silicone` is the only legacy v1 chip that's truly dropped in v2 (the others are renamed or kept). Co-Work's review specified that products carrying that signal should surface it as a PDP bullet via the existing `feature_bullets` metafield so the information isn't lost when the chip disappears from the UI.

**Implementation:**

Build `scripts/backfill-body-safe-silicone-bullets.ts` that:

1. Queries all products where `parsedMaterials` contains `silicone` (from the brief builder output, or re-run material parsing inline)
2. Reads existing `xdipx.feature_bullets` metafield (JSON array of strings)
3. If no existing bullet mentions silicone or body-safe, appends `"Body-safe silicone construction"` (or a Co-Work-approved phrase — confirm wording before running)
4. Writes back to `xdipx.feature_bullets`
5. Dry-run by default, `--apply` to write

**Expected scope:** ~900 products carry silicone material signal. Many will already have a silicone mention in their PDP copy/bullets — skip those to avoid duplication.

**Decision needed before running:** confirm the exact bullet wording with Co-Work. Options:
- "Body-safe silicone construction"
- "100% body-safe silicone"
- "Phthalate-free body-safe silicone"

### C. Pre-flip checklist (~30 min)

Run through before flipping `MATTERS_V2_ENABLED`:

- [ ] Diff tool output reviewed; high-risk regression rows triaged
- [ ] Step 6 PDP bullet backfill landed (or explicitly skipped)
- [ ] `feature_bullets` for silicone products spot-checked on Shopify Admin
- [ ] `getActiveMatters()` returns v2 set when env is `true` (verify with a quick `tsx` repl)
- [ ] SMS gate `mattersOpts()` returns v2 set when env is `true`
- [ ] Web `availableMatters` prop in [app/routes/_layout.collections.$handle.tsx](../app/routes/_layout.collections.$handle.tsx) and siblings derives from actual product data — auto-adapts as v2 values flow in
- [ ] No hardcoded v1 chip values remain in code (one stale comment in [app/lib/discovery-emma.ts:126](../app/lib/discovery-emma.ts) — safe to leave or clean up)

### D. The flip (~30 min)

Two parts, do in this order:

**1. Copy `matters_tags_v2` → `matters_tags` live.**

Write `scripts/promote-matters-shadow-to-live.ts` that:
- Pulls every product's `matters_tags_v2`
- Writes the same array to `matters_tags` (live)
- Optionally: clears `matters_tags_v2` after copy succeeds (or keep it for audit)
- Dry-run + `--apply`

This is the moment the live data changes. After this, the catalog filters by v2 values; the chip UI hasn't flipped yet but it doesn't matter because `MATTERS` is still the union allow-list — both v1 and v2 values still pass.

**2. Flip the env flag.**

In Vercel production env:
```
MATTERS_V2_ENABLED=true
```

Trigger a redeploy. The new chips appear on the home discovery flow, the SMS gate switches subset, the enricher cites v2 vocab. Start the 30-day kill-criterion clock from this moment per Co-Work's review.

### E. Post-flip cleanup (defer to v2.0.1)

After the kill criterion window closes and any failing chips are dropped:

- Retire `MATTERS_V1` constant from [app/types/discovery.ts](../app/types/discovery.ts)
- Collapse `MATTERS` to just `[...MATTERS_V2]`
- Remove the gate logic from `getActiveMatters()`, `mattersOpts()`, `activeMattersVocab()` — they all unconditionally return v2
- Remove `MATTERS_V2_ENABLED` env var documentation from `.env.example`
- Drop `xdipx.matters_tags_v2` and `custom.matters_rationale` metafield definitions if no longer needed for audit
- Run a final casing-normalization pass on Shopify `matters_tags` (similar to the Sanity one in step 1.5)

---

## Critical files for the next agent

| File | Purpose |
|---|---|
| [app/types/discovery.ts](../app/types/discovery.ts) | `MATTERS_V1`, `MATTERS_V2`, `MATTERS` union, `Matters` type |
| [app/lib/feature-flags.server.ts](../app/lib/feature-flags.server.ts) | `mattersV2Enabled()`, `getActiveMatters()` |
| [app/lib/ask-emma-vocab.server.ts](../app/lib/ask-emma-vocab.server.ts) | Enricher vocab source with flag gate |
| [app/lib/sms-v2/discovery-gate.server.ts](../app/lib/sms-v2/discovery-gate.server.ts) | SMS gate `MATTERS_OPTS_V1`, `_V2`, `mattersOpts()` |
| [app/lib/discovery.server.ts](../app/lib/discovery.server.ts) | `MATTERS_SET` allow-list reads from union; filters Shopify metafield values |
| [scripts/_matters-rules.ts](../scripts/_matters-rules.ts) | Deterministic rule registry; 12 rules, IDs `M-BEG-1` … `M-LAT-1` |
| [scripts/build-matters-briefs.ts](../scripts/build-matters-briefs.ts) | Pull Shopify products, evaluate rules, write briefs JSON |
| [scripts/chunk-matters-briefs.ts](../scripts/chunk-matters-briefs.ts) | Split ambiguous tail into 25-product chunks |
| [scripts/dispatch-matters-chunks.ts](../scripts/dispatch-matters-chunks.ts) | Max-billed Claude classification of ambiguous tail |
| [scripts/apply-matters-to-shopify.ts](../scripts/apply-matters-to-shopify.ts) | Write rule + Claude output to shadow metafield |
| [scripts/normalize-matters-tags-casing.ts](../scripts/normalize-matters-tags-casing.ts) | Sentence-case normalization (already ran on Sanity) |

---

## Key decisions Co-Work locked

Don't relitigate these:

1. **12-chip set, sentence-case** — Beginner-friendly, Whisper-quiet, Waterproof, Travel-ready, Discreet, Hands-free, Remote-controlled, Plus-size friendly, Easy to clean, Rechargeable, Soft-touch, Latex-free
2. **SMS subset** — Beginner-friendly · Discreet · Waterproof · Hands-free · Just show me
3. **Rule-first + Claude-tail** backfill via Max subscription (zero Anthropic API spend)
4. **Body-safe silicone is the only dropped legacy chip** → PDP bullet fallback
5. **`Easy to clean` rule** — `material ∈ {silicone, glass, borosilicate, stainless-steel, ceramic, ABS} AND (waterproof OR detachable-parts OR non-electric)`. Porosity, not surface texture, drives cleanability.
6. **Kill criterion clock starts at backfill-complete (the flip), not chip-swap-merge.** 30 days post-flip, drop chips that fail dual threshold: selection rate <2% AND result-set narrowness >60%.
7. **`MATTERS_V2_ENABLED` env-var flag**, not Sanity-managed (deploy-controlled, not editorial)

---

## Open considerations for the next agent

1. **Should the diff tool also pull Sanity `productPage.mattersTags`?** Currently the shadow metafield only lives in Shopify. The Sanity mirror still has the (now sentence-case) v1 values. After the live flip, you'll want a similar normalization pass on Sanity to push v2 values there too — but only after the Shopify live write is verified.

2. **The 4 deleted products from the apply.** `apply-shadow.log` lists two product GIDs where `metafieldsSet` failed with "Owner does not exist." If those products are restored before the flip, re-run apply on just those. If they're permanently gone, ignore.

3. **The `matters-proposal-*.json` artifacts** (briefs, chunks, proposals) are ~30MB total in cwd. They're not gitignored. Either add to `.gitignore` or move to a temp dir before pushing the branch. They're useful as audit trail; recommend keeping for ~30 days post-flip.

4. **Step 6's PDP bullet wording.** Hasn't been Co-Work-approved. Don't pick unilaterally; ask before writing the script.

5. **Diff tool's regression-risk threshold.** The 0-3 scoring I sketched is illustrative. Tune to what Co-Work actually wants to triage.

---

## Document trail

1. [docs/what-matters-proposal.md](what-matters-proposal.md)
2. [docs/what-matters-step0-amendment.md](what-matters-step0-amendment.md)
3. [docs/what-matters-path-a-amendment.md](what-matters-path-a-amendment.md)
4. [docs/what-matters-backfill-scope.md](what-matters-backfill-scope.md)
5. [docs/what-matters-cowork-handoff.md](what-matters-cowork-handoff.md)
6. Co-Work response docs (outside worktree, in `/Users/mikebayard/Claude/xdipx_store/docs/`):
   - `what-matters-cowork-review.md`
   - `what-matters-step0-amendment-review.md`
   - `what-matters-path-a-review.md`
   - `what-matters-final-signoff.md`
7. **This doc — remaining work handoff**
