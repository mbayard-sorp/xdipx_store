# Audience Tagging Runbook (v2.2)

Operational guide for applying the v2.2 audience taxonomy revision. Source of truth for the spec: `/Users/mikebayard/Documents/xdipx.com/Nalpac Reports/taxonomy/TAXONOMY_SPEC_v2_audience_revision.md`.

This runbook covers the **scripted** portions of Phase 7a–7c. The Claude pass on ambiguous products is dispatched as **subagents on Mike's Max subscription** — no Anthropic API key is ever used.

---

## 0. Prerequisites (one-time setup)

Before the first run, create three Shopify metafield definitions manually in Shopify Admin:

| Namespace | Key | Type | Scope | Purpose |
|---|---|---|---|---|
| `custom` | `audience_rationale` | Multi-line text | Products | AI / rule rationale for audience tags |
| `custom` | `editorial_gate_failures` | JSON | Products | List of failed gate check IDs (§8) |
| `custom` | `editorial_gate_run_at` | Date and time | Products | When the gate last ran |
| `custom` | `editorial_gate_override` | True / false | Products | Lets Emma opt a product out of check 2 |
| `xdipx` | `queer_friendly_override` | True / false | Products | Lets Emma curate a queer-friendly tag (§3) |

The audience-tagging metafield (`xdipx.audience_tags`, list.single_line_text_field) already exists.

Confirm `.env` has:
```
SHOPIFY_STORE_DOMAIN=xdipx.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
SHOPIFY_ADMIN_API_VERSION=2024-10
```

---

## 1. Phase 7a — Pre-strip (zero-outage deploy)

### 7a.1 — Type field closeout

Out of scope for these scripts. Per spec §6 the v1 §7 Type cleanup is 96% complete. Run a 30-minute pass to add the 9 new controlled values + re-type the 22 ambiguous items before continuing.

### 7a.2 — Loader union-logic deploy

The route loader change is included in this PR:

- [app/lib/shopify.server.ts](../app/lib/shopify.server.ts) — adds `getProductsByTypesOrTag()`
- [app/routes/_layout.for-him.tsx](../app/routes/_layout.for-him.tsx) — switches to union loader with `FOR_HIM_TYPES`
- [app/routes/_layout.for-her.tsx](../app/routes/_layout.for-her.tsx) — switches to union loader with `FOR_HER_TYPES`

While this is live, products match either Shopify product_type (e.g., "Stroker") **or** the legacy `for-him`/`for-her` Shopify product tag. The route is never empty during 7b's metafield strip.

After Phase 7c, remove the `tag:` branch from `getProductsByTypesOrTag` (or replace the helper with a pure type-filter helper) in a second deploy.

---

## 2. Phase 7b — Strip + re-tag

### 7b.1 — Build the briefs file

```bash
npx tsx scripts/build-audience-briefs.ts
```

- Pulls every active + draft product from Shopify Admin (paged, 100/page, 1s sleep every 2 pages)
- Applies R1–R7 (relationship), L1–L7 (life-event), Q1–Q8 (LGBTQ affirmative-signal only), C1–C6 (cleanup detection) inline
- Writes `audience-proposal-briefs.json` with deterministic results per product
- Prints distribution of pre-Claude tags + counts of products that need the Claude pass

Sample smoke run:
```bash
npx tsx scripts/build-audience-briefs.ts --limit=50
```

Status flag (defaults to `active+draft` per §4.1):
```bash
npx tsx scripts/build-audience-briefs.ts --status=active+draft
npx tsx scripts/build-audience-briefs.ts --status=active     # active only
```

### 7b.2 — Chunk the ambiguous briefs for subagent dispatch

```bash
npx tsx scripts/chunk-audience-briefs.ts --size=75
```

Filters to products where `deterministic.needsClaude === true` (no R-rule fired, needs a relationship-tag decision from Claude) and splits into `audience-proposal-briefs.chunk-NN.json`.

Products fully covered by deterministic rules are skipped — they don't need a subagent.

### 7b.3 — Dispatch subagents (Max subscription, zero API spend)

For each chunk, dispatch a `general-purpose` subagent with the prompt below. Mike runs these via the `Agent` tool — **never** import `@anthropic-ai/sdk` from a script.

**Subagent prompt template:**

```
You are processing chunk audience-proposal-briefs.chunk-NN.json for the
xdipx.com v2.2 audience taxonomy. Read the file, classify each brief,
write audience-proposals.chunk-NN.json.

For each brief, output a relationship tag and optionally life-event and
LGBTQ tags following these rules:

RELATIONSHIP (required: pick 1 or 2 from solo, couples, long-distance):
  - solo: one-person use. Strokers, single bullets, personal lube
  - couples: paired toys, harnesses, games, shared-experience items
  - long-distance: app-controlled, remote-enabled, sync-able
  - Most agnostic items get both solo + couples

LIFE-EVENT (0-2, optional):
  - gift: gift sets, kits, packaging-forward
  - date-night: couples kits, games, role-play, mood items
  - bachelorette: novelty/themed/party-supply (rare)
  - anniversary: premium pairs ($150+), indulgent kits
  - birthday: bundles + cards, celebratory packaging
  - housewarming: candles, oils, kits as new-home-appropriate gifts
  - L7: if you add gift, also include a relationship tag

LGBTQ (0-1 plus optional identity-specific — AFFIRMATIVE SIGNAL ONLY):
  Only apply if the product has an explicit signal per spec §3:
    - Tier 1 brand allow-list (already deterministic, may be set)
    - Marketing copy uses inclusive language
    - Functional-queer category (packers, ungendered harnesses)
    - Editor override metafield set
  DEFAULT to NO identity tag. Do NOT auto-tag anatomy-agnostic lubes or
  candles as queer-friendly — that's the label-not-filter trap.

Output JSON contract:
{
  "proposals": [
    {
      "id":               "<brief.id verbatim>",
      "relationshipTags": ["solo" | "couples" | "long-distance"],
      "lifeEventTags":    ["gift" | "date-night" | ...] (optional, omit if none),
      "lgbtqTags":        ["queer-friendly" | ...] (optional, omit if none),
      "rationale":        "<one short sentence, ≤200 chars>"
    }, ...
  ]
}

Notes:
- Each brief already includes `deterministic.finalAudience` — those tags
  will be MERGED with yours. Don't re-emit them unless you'd remove them.
- Cleanup values (him, her, lgbtq, first-time, gift-idea, us) are auto-stripped.
- Write exactly one chunk file: audience-proposals.chunk-NN.json
  (same NN as the input).
```

Dispatch one subagent per chunk in parallel. Wait for all to finish before merging.

### 7b.4 — Merge subagent outputs

```bash
npx tsx scripts/merge-audience-chunks.ts
```

Combines `audience-proposals.chunk-NN.json` into one `audience-proposals.json`. Reports coverage against the needs-Claude subset and lists any missing IDs so you can re-dispatch the failed chunks.

### 7b.5 — Format reviewable CSV

```bash
npx tsx scripts/format-audience-csv.ts
```

Builds `audience-proposals-final.csv` with current/final/dropped/added/kept/rule-ids/rationale per product. Prints distribution audit + sparsity-floor compliance (active-only counts per §4.1).

This CSV is what Co-Work and Mike review before the apply step. Iterate on rules / re-dispatch chunks until the distribution and sparsity numbers look right.

### 7b.6 — Apply to Shopify

Dry-run first:
```bash
npx tsx scripts/apply-audience-to-shopify.ts --dry-run
```

When the diff looks right:
```bash
npx tsx scripts/apply-audience-to-shopify.ts
```

- Writes `xdipx.audience_tags` (only on diff, set-equality)
- Writes `custom.audience_rationale` for every product with a rationale
- Batches of 25 (Shopify `metafieldsSet` limit)
- Applies to BOTH active + draft (briefs already include both)

After apply, refresh KV: visit `/admin/discovery` → "Refresh now".

---

## 3. Phase 8 — Editorial completeness gate

Per §8, every product must pass five checks before it publishes. Run the gate:

```bash
# Inspect only — no metafield writes, no status changes
npx tsx scripts/run-editorial-gate.ts --dry-run

# Write gate failure metafields (no status changes)
npx tsx scripts/run-editorial-gate.ts

# Promote passing drafts → active and demote failing actives → draft
npx tsx scripts/run-editorial-gate.ts --promote --demote
```

Outputs a CSV report in `scripts/output/editorial-gate-report-{ISO}.csv` with per-product failure lists.

Check 2 (Emma aside) uses heuristic regex on first-person markers. Tune `EMMA_ASIDE_MARKERS` in [scripts/run-editorial-gate.ts](../scripts/run-editorial-gate.ts) if the false-positive or false-negative rate is too high. Products that legitimately don't need an aside (utility lubes, etc.) can opt out via `custom.editorial_gate_override = true`.

Idempotent — safe to schedule nightly. Run after every Nalpac import.

---

## 4. Phase 7c — Cleanup deploy

After 7b apply + gate stabilize:

1. Edit [app/lib/shopify.server.ts](../app/lib/shopify.server.ts) — remove the legacy `tag:{tag}` branch from `getProductsByTypesOrTag` (or replace the helper with a pure type-filter)
2. Deploy
3. Sitemap ping: `npx tsx scripts/seo-ping.ts` (if present) or trigger manually

After this, the routes filter purely by Shopify product_type. The `for-him` / `for-her` Shopify product tags can be left in place (they no longer affect rendering) or stripped in a future cleanup pass.

---

## 5. Rollback per phase

| Phase | Rollback |
|---|---|
| 7a.2 loader | Revert the loader file; route returns to tag-only filter |
| 7b strip | Re-import a Matrixify CSV backup taken before the run; or re-write the old `audience_tags` values from a JSON snapshot of the briefs file |
| 7b re-tag | Same as strip — restore from snapshot |
| 7c cleanup | Revert the helper edit; tag branch re-activates |
| Editorial gate | Re-promote demoted products via Shopify Admin UI or `productUpdate` mutation; no metafield removal needed |

The briefs file (`audience-proposal-briefs.json`) IS a snapshot of pre-apply Shopify state — keep it and the proposals file checked in to a backup branch before each apply.

---

## 6. Files

| Script | Purpose |
|---|---|
| [scripts/_audience-rules.ts](../scripts/_audience-rules.ts) | Source of truth for R1–R7 / L1–L7 / Q1–Q8 / C1–C6 |
| [scripts/build-audience-briefs.ts](../scripts/build-audience-briefs.ts) | Pulls Shopify, applies deterministic rules |
| [scripts/chunk-audience-briefs.ts](../scripts/chunk-audience-briefs.ts) | Splits needs-Claude subset for subagent dispatch |
| [scripts/merge-audience-chunks.ts](../scripts/merge-audience-chunks.ts) | Merges subagent output + coverage check |
| [scripts/format-audience-csv.ts](../scripts/format-audience-csv.ts) | Builds reviewable CSV + audit JSON |
| [scripts/apply-audience-to-shopify.ts](../scripts/apply-audience-to-shopify.ts) | Writes metafields to Shopify |
| [scripts/run-editorial-gate.ts](../scripts/run-editorial-gate.ts) | Phase 1 publish gate per §8 |

---

## 7. Gotchas

- **No Anthropic SDK in any script.** All Claude work is dispatched via subagents on Max subscription.
- **Drafts are tagged too.** Per §4.1, the re-tag covers both active and draft so promoted drafts are launch-ready.
- **Sparsity floor is measured on active only** even though we tag drafts. The format script reports both.
- **L4 anniversary** is candidate-only from deterministic rules — Claude confirms. Don't apply L4 directly without a Claude pass.
- **Q3 (packer/STP) auto-adds non-binary** — affirmative-signal interpretation per §5. May be aggressive; tune if Co-Work pushes back.
- **`custom.audience_rationale` is 255 chars max** (single_line_text_field). Rationale is truncated at apply time.
- **Cleanup detection ≠ deletion.** C1–C6 hits are logged for audit; actual removal happens because the apply step writes the **new** value, which excludes the cleanup values.
