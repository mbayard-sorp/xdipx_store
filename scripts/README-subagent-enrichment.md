# Subagent product enrichment — Max-only path

> Generate product enrichment payloads via the `emma-product-enricher` Claude
> Code subagent (Max subscription, zero Anthropic API spend), then push to
> Shopify + Sanity via `scripts/backfill-product-enrichment.ts --from-file=...`.

## When to use this path vs. the API path

| Path | Cost | Speed | Quality | Best for |
|---|---|---|---|---|
| **API hybrid** (`--via=claude-code --apply`) | ~$0.40/product on Anthropic key | Fully unattended | Per-tool isolated calls | Phase 4 / 5 widening, full-catalog backfills |
| **Subagent** (`--from-file=batch.json --apply`) | $0 API + Max quota | Attended; 1–3 min/product to dispatch | Subagent holds full editorial context across all generators in one session — tighter cross-generator consistency | Calibration runs, editorial review loops, hot-fix individual products, small batches you want to hand-verify |

Both paths land the same `ProductWrites` shape and run the same Shopify push +
Sanity productPage upsert. The only difference is where the generation happens.

## Workflow

The orchestration loop is interactive — you (in Claude Code chat) drive each
batch. The script just pushes pre-generated content. There's intentionally no
auto-loop: each product is a deliberate dispatch + spot-check.

### Step 1 — Prepare the brief for one product

For each product you want to enrich, gather:

- `shopifyProductId` (numeric Shopify product ID — found in Sanity productPage
  doc as `shopifyProductId` or in deal_history table)
- `sku` (Nalpac SKU)
- `rawTitle`, `brand`, `rawDescription` from Shopify via the existing
  `fetchProductSnapshot()` helper (or via Shopify Admin GraphQL directly)
- `categories` from the deal_history row
- `dealPrice`, `msrp` from the same snapshot
- `existingMetafields` — current xdipx.* values so the agent knows what's
  already populated (drives fill-gaps decisions)
- `vocabularies`:
  - `moodVocab`, `audienceVocab`, `mattersVocab` from the
    `askEmmaVocabulary` Sanity singleton
  - `dialRegistryByType` from the `dialRegistry` Sanity singleton
  - `dialTaxonomy` from the `dialTaxonomy` Sanity singleton
- `pairingCandidates` from `getPairingCandidates({ shopifyProductId, ... })`
  in `app/lib/shopify.server.ts`

A scrappy way to assemble this: write a small ad-hoc node script that pulls
all of the above for a list of SKUs and dumps a brief JSON file per product.
Then dispatch the agent with the brief content inlined in the prompt.

### Step 2 — Dispatch `emma-product-enricher`

In chat, spawn the agent via the Agent tool with the brief. Example prompt
shape:

> Generate the full ProductWrites payload for this product. Return ONLY the
> JSON object per your output schema, no markdown fences.
>
> ```json
> { "shopifyProductId": "8718262894763", "sku": "22537", "rawTitle": "Edible G-String", ... }
> ```

The agent is tuned to return a single JSON object matching `ProductWrites`.
It runs on Sonnet via the Max subscription — no API key spend.

### Step 3 — Aggregate results into a batch file

Combine the agent's JSON output for each product into an array:

```json
[
  {
    "shopifyProductId": "8718262894763",
    "sku": "22537",
    "writes": { /* the ProductWrites object the agent returned */ }
  },
  {
    "shopifyProductId": "...",
    "sku": "...",
    "writes": { /* ... */ }
  }
]
```

Save as `scripts/batches/2026-04-27-edible-batch.json` or similar. The
`scripts/batches/` directory is gitignored by convention; these are
ephemeral artifacts of a single enrichment session.

### Step 4 — Push via the script

```bash
env -u ANTHROPIC_API_KEY -u SANITY_API_TOKEN -u SANITY_PROJECT_ID \
    -u SANITY_DATASET -u SHOPIFY_STORE_DOMAIN -u SHOPIFY_ADMIN_ACCESS_TOKEN \
    -u DATABASE_URL \
  npx tsx scripts/backfill-product-enrichment.ts \
    --from-file=scripts/batches/2026-04-27-edible-batch.json \
    --apply
```

The script:
- Skips the orchestrator entirely.
- Looks up each entry's `deal_history` row by `shopifyProductId`.
- Calls `enrichOne()` with the pre-generated writes.
- Runs the same fill-gaps semantics (`maybeShouldRefresh`) and existing
  metafield fallbacks as the orchestrator path.
- Pushes to Shopify (`pushProductToShopify`) and mirrors to Sanity
  productPage (`upsertProductPage`).

`--mode=full` overwrites every field. Default `fill-gaps` only fills empty
ones — same semantics as the orchestrator path.

### Step 5 — Spot-check + iterate

After a small batch lands:
- Read the products in Shopify Admin to confirm metafields populated.
- Query Sanity productPage docs to confirm tags, FAQs, pairings landed.
- If editorial wants tweaks → re-dispatch the agent with feedback in the
  prompt ("regenerate the FAQs more usage-focused"), update the batch file,
  re-run with `--mode=full` to overwrite.

## File schema

`--from-file` expects a top-level JSON array. Each entry:

```ts
{
  shopifyProductId: string         // numeric ID; matches deal_history.shopifyProductId
  sku?:             string         // optional, for log readability
  writes:           ProductWrites  // shape defined in app/lib/emma-orchestrator.server.ts
}
```

The `ProductWrites` interface is the canonical shape — everything the
orchestrator's per-tool generators produce. The agent's output schema (in
`.claude/agents/emma-product-enricher.md`) mirrors this 1:1.

Empty / undefined fields are fine — they trigger fill-gaps fallback to existing
Shopify metafield values just like the orchestrator path.

## Why this exists

Before this path, the orchestrator's per-tool generators each made an isolated
Anthropic API call against the user's API key. The outer turn loop ran on Max
via the Agent SDK, but per-tool generation was billed per token to Anthropic.

The Anthropic API is the only single-turn surface that works cleanly for
JSON-only prompts. The Agent SDK's `query()` API is tool-using-agent shaped —
when called with `tools: []` and `maxTurns: 1`, Claude Code refuses the bare-
prompt shape with "Failed to ..." errors. So `runSingleClaudeCallViaSdk` in
`llm-client.server.ts` is preserved but not wired in for now.

The subagent path sidesteps that by treating each product as one full agentic
session — the agent has tools (Read/Grep/Glob), can iterate internally, and
returns the result via its assistant message. Same Max billing, but the Agent
tool's surface accepts the use case the SDK's `query()` doesn't.
