# ADR-001: Phase 0 — Memory Primitives for Conversation Coherence

**Date:** 2026-05-04
**Status:** Proposed
**Owner:** tech-architect
**Implementation owner:** rr7-engineer
**Migration owner:** rr7-engineer (hand-written SQL per project convention)
**Empathy review required:** Yes — the `<known_about_customer>` system-prompt block

---

## Context

Emma derails in specific, reproducible ways. This ADR names each mechanism with file:line precision and decides the fix for each.

### The seven failure modes this phase addresses

**Failure 1 — History window truncation causes forgetting**
`conversation-agent.server.ts:77` sets `HISTORY_LIMIT = 12` turn-pairs. Each turn burns up to 3 tool-hop cycles (tool_use + tool_result blocks) consuming context budget. By turn 13+, the customer's earliest disclosures — vulnerability beats, gift recipients, budget ceiling — fall out of the model's view entirely. No summary. No carry-forward. This is "she forgot what we were discussing" on longer threads.

**Failure 2 — 24h rotation discards all prior context**
`conversation.server.ts:157-167` rotates `conversationId` to a new UUID after 24h inactivity. `conversation-history.server.ts:74` filters `smsTurns` by `conversationId`, so after rotation the history load returns zero rows. The customer is a stranger again. If `lastActiveAt` slips past the 24h boundary mid-conversation — which is possible on mobile where Twilio retries can spread turns — amnesia happens without warning.

**Failure 3 — 6h stage TTL silently resets stage**
`conversation.server.ts:71-79` (`shouldResetStage`) and `conversation.server.ts:173-179` reset stage to DISCOVERY when the new intent doesn't match the allowed list for the current stage AND more than 6 hours have elapsed since `stageSetAt`. The agent is not told this happened. The history is preserved but the system prompt swaps from PRESENTATION to DISCOVERY. Emma behaves like she's meeting the customer for the first time even mid-pitch.

**Failure 4 — Pitched-product detection runs on prose, not tool results**
`conversation-agent.server.ts:282-304` (`detectPitchedCard`) scans the agent's output text for a PDP URL or title match to determine whether a product was pitched. A paraphrased product name or formatting variation causes a miss. When the system thinks no pitch happened, the next turn gets a DISCOVERY system prompt while the customer is asking "what colors does it come in?" — producing re-pitch loops.

**Failure 5 — Only one pitched handle tracked**
`db/schema.ts:479` (`smsConversations`) stores `currentPitchHandle` as a single `text` column. When the agent pitches product A then product B, A is unrecoverable. "Actually, the first one you showed me" has no referent in state.

**Failure 6 — Discovered slots not injected into system prompt**
`conversation-agent.server.ts:370-375` runs `extractSlots` in parallel and writes results to `conversation.discoveredSlots` via `stateWrites`. But `buildSystemPrompt` at `conversation-agent.server.ts:211-218` takes only `stage`, `channel`, and `currentPitchHandle`. The slots are never added to the system prompt. The agent only sees them via conversation history — which truncates (Failure 1). A customer's disclosure ("it's a gift for my partner who's anxious about toys") survives in the DB row but disappears from the agent's working memory. This is the deepest trust failure: we wrote it down and still lost it.

**Failure 7 — Tool-budget exhaustion is silent**
`conversation-agent.server.ts:430` runs the Sonnet loop up to `MAX_TOOL_HOPS = 3`. When three hops are burned and no answer is landed, the loop exits with whatever text was generated. No telemetry flag. No fallback differentiation. The `smsTurns` row gives no signal that this turn was degraded.

---

## Decision

Seven sub-decisions, one per failure mode. Each is additive or a softening of existing behavior — no destructive changes.

### Sub-decision 1: Persistent rolling summary (addresses Failures 1 and 2)

Add two columns to `sms_conversations`:
- `conversation_summary` (text, nullable) — a 1-2 sentence Haiku-generated prose summary of the conversation so far.
- `pitched_handles_log` (text[], nullable) — an ordered array of the last N=10 pitched handles.

After each turn completes (in `applyStateWrites` or as a fire-and-forget call from the stage dispatcher), run a Haiku summarizer call. The prompt is narrow: "Summarize this customer's shopping context in 1-2 sentences for an SMS concierge. Include: what they're shopping for, who it's for if known, any stated constraints (budget, experience level), and the most recent product discussed. Use plain English. No em-dashes."

Model: `claude-haiku-4-5-20251001` (already used in `slot-extractor.server.ts:60`). Target: ~100 input tokens (recent history slice, not full history), 50 output tokens. Cost at current Haiku pricing: negligible per turn at this volume.

The summary is injected at the top of the system prompt on the next turn, before the stage addendum. It is NOT a replacement for history — it is a permanent high-water mark for context that has scrolled out of the history window.

The call must be non-blocking relative to the reply path. Implementation: fire the summarizer after `finaliseTurnRows` completes, with a `catch` that logs and discards errors. The reply ships regardless.

### Sub-decision 2: Inject discovered slots into buildSystemPrompt (addresses Failure 6)

`buildSystemPrompt` gains a new parameter: `memoryContext: { summary: string | null, slots: Partial<DiscoverySlots> }`.

A `<known_about_customer>` XML-tagged block is appended between `CONVERSATION_RULES_CORE` and the stage addendum. Format:

```
<known_about_customer>
Summary: {conversation_summary or "First contact — no prior context."}
Known: audience=for-her | experience=first-time | priceMax=80 | matters=quiet,waterproof
</known_about_customer>
```

Only non-empty slots are serialized. The block is omitted entirely when both summary and slots are empty (first turn). This keeps the system prompt tight on turn 1.

The slot serialization must never emit undefined or null values. Implement a `serializeSlots` helper that filters keys with falsy values before joining.

The `<known_about_customer>` block is subject to `emma-empathy-reviewer` gate before merge — it is part of every system prompt Emma receives and must not violate the 13 principles. Specifically: no clinical language, no assumptions about experience level beyond what the customer stated, no disclosure of internal slot names to the customer.

### Sub-decision 3: Context bridge on 24h rotation (addresses Failure 2)

When `shouldRotate` fires in `getOrCreateConversation` (currently `conversation.server.ts:157`), before issuing the new UUID, read the current `conversation_summary` from the existing row. Copy it into the new row's `conversation_summary` field at insert time, prefixed with a temporal marker: "From a previous conversation: {summary}".

This is a single read before the update — acceptable latency cost. The new conversationId means history returns zero rows from `smsTurns`, but the summary bridge gives the agent the prior context. The agent sees this via the `<known_about_customer>` block on the first turn of the new session.

The `pitched_handles_log` is NOT carried forward on rotation. A 24h gap justifies a fresh pitch slate. Only the summary travels.

### Sub-decision 4: Soften the 6h stage TTL (addresses Failure 3)

The current behavior (silent reset to DISCOVERY) is replaced with log-only mode.

`shouldResetStage` is renamed to `shouldWarnStage` and its return type changes: instead of `boolean`, it returns `{ warn: boolean, priorStage: Stage }`. The caller emits a `console.warn` with the phone, prior stage, and new intent, but does NOT update `stage` or `stageSetAt` in the DB.

The agent's system prompt receives both pieces of information via the stage addendum:
- The stage addendum already injects the current stage.
- If a stage-TTL warning fired, append a single line to the stage addendum: "Note: customer has been inactive for over 6h. Their last known stage was PRESENTATION. Use your judgment about whether to re-introduce the pitch or ask if they want to continue."

The hard auto-reset is eliminated entirely. If a full reset is ever needed again, gate it behind a 24h TTL (matching the session rotation) — not 6h. The 6h boundary was an arbitrary patch; the 24h session rotation is the principled reset point.

This change requires a review of `STAGE_EXPECTED_INTENTS` at `conversation.server.ts:62-69`. Those lists drove the reset logic. They can be kept as documentation of what intents are "natural" to each stage, but they no longer trigger automated state changes.

### Sub-decision 5: Replace regex pitched-product detection with tool-result truth (addresses Failure 4)

`detectPitchedCard` at `conversation-agent.server.ts:282-304` currently runs after the Sonnet loop completes and scans the output prose for URL or title matches.

The fix: during the Sonnet loop's tool-result processing, when `runDiscoveryTool` returns cards via `cardsByToolUseId`, capture the handles in a new `toolPitchedHandles: Set<string>` accumulator. When the loop terminates, check `toolPitchedHandles` first. If exactly one handle was returned by a `searchProducts` or `getProductDetails` call this turn, that is the pitched handle — no prose scanning needed. If multiple handles were returned (A/B pitch), capture the one that appears in the final prose (existing regex logic as tiebreaker). If zero handles were returned from tools, no pitch occurred.

`detectPitchedCard` is demoted to a fallback: it only runs when `toolPitchedHandles` is empty AND cards exist in `allCards`. Its role is catching edge cases where the tool returned results but the loop didn't surface them via the standard path.

This means the handle tracking is grounded in what the tool actually returned, not what the agent mentioned. A paraphrase in the prose no longer causes a miss.

### Sub-decision 6: Track last 10 pitched handles (addresses Failure 5)

The new `pitched_handles_log` text array column (from Sub-decision 1's migration) stores an ordered log of pitched handles, most-recent last, capped at 10 entries.

`applyStateWrites` gains a `pitchedHandlesLog` write path. Each time a new handle is pitched (detected via Sub-decision 5's tool-result truth), append it to the array and trim to the last 10.

The existing `currentPitchHandle` column is preserved. It continues to track the single most-recent pitch for the stage addendum (`PRESENTATION_ADDENDUM` and `OBJECTION_ADDENDUM` both use it). `pitched_handles_log` is additional state, not a replacement.

The agent does not receive the full log in the system prompt — that would bloat context. The log is available for lookup when the customer says "the first one" — the `lookupReturningCustomer` or a new resolution path can pull from it. Specifically: the PRESENTATION addendum should be updated to note "Prior pitched products (if the customer refers back): {log[0..2] if log.length > 1}" — capped to the 2 oldest, since those are the ones most likely to be the "earlier option" the customer is referencing.

### Sub-decision 7: Surface tool-budget exhaustion in telemetry (addresses Failure 7)

`TurnObservabilityUpdate` in `turn-logger.server.ts:93-106` gains a `toolBudgetExhausted?: boolean` field.

In the Sonnet loop at `conversation-agent.server.ts:430`, add a tracker: `let toolHopsUsed = 0` incremented on each `tool_use` stop_reason. After the loop exits, if `toolHopsUsed >= MAX_TOOL_HOPS` AND `finalText` was pulled on the last hop's `end_turn` (rather than an earlier hop), set `toolBudgetExhausted = true`.

This flag is written to `smsTurns` via the same observability update path. It enables a dashboard query: "turns where tool_budget_exhausted=true, grouped by week" — the leading indicator that the MAX_TOOL_HOPS ceiling is too low or that a prompt change is causing the agent to over-search.

No behavior change. No fallback change. Telemetry only.

### Sub-decision 8: Eval harness architecture

The eval harness is new infrastructure, not a change to existing code. It lives entirely in `evals/` at the repo root. No import from `app/` — the harness runs against the API directly via fixture inputs, treating the agent as a black box.

Structure:
```
evals/
  fixtures/
    001-returning-customer-memory.json
    002-gift-shopping-partner-anxious.json
    003-re-pitch-loop-regression.json
    ...up to 030...
  judge/
    prompt.ts          -- Sonnet-as-judge system prompt
    runner.ts          -- reads fixtures, calls API twice (v1 + v2 prompts), scores
  golden/
    README.md          -- how to add a new golden conversation
  index.ts             -- CLI entry point
```

Fixture format (JSON):
```json
{
  "id": "001-returning-customer-memory",
  "description": "Customer returns after 24h gap; expect Emma to use summary bridge",
  "channel": "sms",
  "priorSummary": "Customer was shopping for a quiet wand for a partner, mentioned $100 ceiling.",
  "turns": [
    { "role": "user", "text": "hey, I was looking at that wand" },
    { "role": "expected_behavior", "tags": ["uses_prior_context", "no_restarter_question"] }
  ],
  "evalDimensions": ["memory", "coherence", "no_derail"],
  "regressionFor": null
}
```

Judge prompt (Sonnet `claude-sonnet-4-6`): given the fixture, the v1 system prompt, the v2 system prompt, and Emma's response to each, score each response 1-5 on each `evalDimensions` value. Return JSON: `{ v1: { memory: 4, coherence: 3 }, v2: { memory: 2, coherence: 4 } }`. The judge prompt is seeded with the 13 Emma principles as grading rubric.

Runner: for each fixture, run two Anthropic API calls with identical messages but different system prompts (v1 Fly prompt vs v2 SMS prompt). Collect scores. Output a table to stdout. Exit code 1 if any v2 dimension score < 3.

`npm run eval:emma` — defined in root `package.json`. The runner must not require a real Twilio webhook or DB — it calls the Anthropic API directly with constructed messages. The fixture's `priorSummary` and `turns` are injected as-is.

The 30 golden conversations must cover: returning-customer memory, gift-shopping vulnerability, re-pitch loop, pivot narration (forbidden), IVR upsell suppression, PDP iMessage preview format, 24h rotation bridge, slot injection after truncation, tool-budget exhausted path, and stage-TTL softening. The remaining slots are open for new regressions as they surface.

---

## Consequences

### What gets better

- Failure modes 1-7 are each directly addressed by a named sub-decision.
- The eval harness makes every future prompt change falsifiable. "Did this help or hurt?" has a data answer within minutes.
- The side-by-side v1 vs v2 eval answers the open question about whether v1 Fly prompt actually performs better. If v1 scores higher on the goldens, Sub-decision 8 surfaces that before Phase 1 prompt unification work begins.
- `toolBudgetExhausted` telemetry gives the first quantitative signal on MAX_TOOL_HOPS adequacy.

### The costs

**Haiku call per turn:** approximately 100 input tokens + 50 output tokens at current Haiku 4.5 pricing. At $0.25/MTok input and $1.25/MTok output (Haiku 4.5 pricing as of this ADR), that is $0.000025 input + $0.0000625 output per turn = ~$0.00009 per turn. At 1,000 turns/day, $0.09/day. Not material. The call is fire-and-forget post-reply; it does not add to the customer-facing latency path.

**Schema migration:** two new columns on `sms_conversations`. The table is keyed by phone (primary key) — no index rebuilds, no lock escalation on Neon. The backfill is empty: both columns start null. Zero-cost migration operationally.

**System prompt growth:** the `<known_about_customer>` block adds ~50-100 tokens per turn to the Sonnet input. At Sonnet pricing this is ~$0.0003 per turn. At 1,000 turns/day, $0.30/day. Acceptable.

**`pitched_handles_log` append cost:** one additional field in `applyStateWrites`. No additional DB round-trip — it merges into the existing update.

### The risks

**Summarizer hallucination:** the Haiku call takes a history slice and produces prose. Haiku can confabulate — inventing a detail that wasn't in the slice (wrong budget, wrong audience). The injected summary becomes a false prior that misdirects the next turn. Mitigation: the summary prompt must be tightly constrained ("only include facts the customer explicitly stated — do not infer or elaborate"), and the summary is labeled as secondary context in the `<known_about_customer>` block ("Emma sees the full conversation history; use this summary only for details that may have scrolled out of view"). The full history still takes precedence. If history and summary conflict, history wins.

**Slot injection bloating the system prompt:** if `discoveredSlots` accumulates many keys over a long conversation, the `<known_about_customer>` block grows. Cap the serialized slot count at 8 keys and trim by recency. The summary carries the rest.

**Summarizer as a new dependency on Haiku availability:** if the Haiku API is unavailable, the fire-and-forget call will fail silently. This is acceptable — the summary column stays at its last value. But if the Haiku call is firing before the reply ships (wrong implementation), this becomes a customer-facing latency dependency. Implementation must be strictly post-reply.

---

## Alternatives Considered

### Rolling summary: where to store it

**Option A (chosen): DB column on `sms_conversations`.**
Survives process restarts, 24h rotation (bridged), and multi-instance Vercel deployments. Single source of truth. Migration cost: one `ALTER TABLE`.

**Option B: In-memory cache (Redis/KV).**
Faster writes. But Vercel KV is Vercel-specific infrastructure — importing it inside `app/` violates the Oxygen seam. Even if wrapped in `server/`, multi-instance cache invalidation is a new failure mode. Per CLAUDE.md, Vercel-specific code stays in `server/index.ts`, not `app/`. Rejected.

**Option C: Reconstruct summary on every turn from full history.**
No extra storage. But the point of the summary is to survive history truncation — reconstructing from the same truncated history defeats the purpose. Rejected.

**Option D: Only summarize on stage changes.**
Cheaper (fewer Haiku calls). But stage changes are exactly the moments when the derail has already happened. Derails also occur within a stage (e.g. slot disclosure on turn 3 lost by turn 14). The summary must update every turn to be useful. Rejected.

### 6h TTL softening: what to do with it

**Option A (chosen): Log-only. Agent sees prior stage + new intent as context. No automated reset.**
Preserves state. Gives the agent the information it needs to decide whether to re-introduce or continue. Removes the silent surprise.

**Option B: Keep the reset but increase TTL to 24h (matching rotation).**
Better than 6h. But the reset is still silent from the agent's perspective, and the 24h boundary coincides with session rotation — at which point the conversation is already treated as a new session. Two overlapping resets at the same threshold is redundant. Rejected.

**Option C: Delete the TTL entirely.**
Simplest code. But a customer who texted in PRESENTATION yesterday and texts "hello" today probably isn't mid-pitch anymore. The agent should at least see a signal that time has passed. Log-only with a note in the system prompt provides that signal without destroying state. The full deletion (Option C) gives the agent no signal at all. Rejected.

### Pitched-handles tracking: which log structure

**Option A (chosen): Append-only ordered text array, last-10, most-recent last.**
Simple. Queryable as JSON in Postgres. The log's order is its semantics — "the first one" maps to `log[0]`. Capped to prevent unbounded growth.

**Option B: Just extend currentPitchHandle to hold the last 2.**
Cheaper schema change (no new column). But "the first one you showed me" in a 5-pitch session can't be resolved from the last 2. Rejected.

**Option C: Full reverse index (handle -> turn number) in a separate table.**
Maximally queryable. But this is Phase 3 observability scope, not Phase 0 coherence. A separate table for this is over-engineering at this stage. Rejected.

---

## Migration Notes

### SQL migration: `db/migrations/032_memory_primitives.sql`

```sql
-- 032_memory_primitives.sql
-- Phase 0: rolling summary + pitched handles log + tool_budget_exhausted flag

ALTER TABLE sms_conversations
  ADD COLUMN IF NOT EXISTS conversation_summary   text,
  ADD COLUMN IF NOT EXISTS pitched_handles_log    text[];

ALTER TABLE sms_turns
  ADD COLUMN IF NOT EXISTS tool_budget_exhausted  boolean NOT NULL DEFAULT false;
```

Applied via: `npx tsx scripts/apply-migrations.ts --from 032`

### Drizzle schema changes (`db/schema.ts`)

In `smsConversations`:
```ts
conversationSummary:  text('conversation_summary'),
pitchedHandlesLog:   text('pitched_handles_log').array(),
```

In `smsTurns`:
```ts
toolBudgetExhausted: boolean('tool_budget_exhausted').notNull().default(false),
```

### Backfill strategy

None required. Both `smsConversations` columns start null. The summarizer populates them on the first post-migration turn. `smsTurns.toolBudgetExhausted` defaults to false, which is correct for all historical rows (they weren't tracked, so we don't know — false is the safe default).

### `ConversationRow` type update (`conversation.server.ts`)

Add to the `ConversationRow` interface:
```ts
conversationSummary: string | null
pitchedHandlesLog:   string[] | null
```

### `TurnObservabilityUpdate` type update (`turn-logger.server.ts`)

Add:
```ts
toolBudgetExhausted?: boolean | undefined
```

---

## Oxygen-Seam Impact

Zero impact on `app/lib/shopify.server.ts`. No Shopify API calls are added, modified, or removed. All new code lives in:
- `app/lib/sms-v2/summary.server.ts` (new file)
- `app/lib/sms-v2/conversation-agent.server.ts` (modifications)
- `app/lib/sms-v2/conversation.server.ts` (modifications)
- `app/lib/sms-v2/turn-logger.server.ts` (modifications)
- `db/schema.ts` (additive columns)

No Vercel-specific imports (`@vercel/kv`, etc.) are introduced inside `app/`. The Haiku call goes through the existing Anthropic client pattern already established in `slot-extractor.server.ts`. All new files end in `.server.ts` — tree-shaking boundary preserved.

`summary.server.ts` will follow the injectable-client pattern from `slot-extractor.server.ts:56-58` (`_setAnthropicClient`) so it can be tested without real API calls.

---

## Coupling Analysis

### What reads/writes the affected fields

`smsConversations.conversationSummary`:
- Written by: new `summary.server.ts` (post-turn, fire-and-forget)
- Read by: `getOrCreateConversation` (returns it in `ConversationRow`)
- Consumed by: `buildSystemPrompt` via `memoryContext` parameter
- On rotation: read before UUID swap, written as "From a previous conversation: {summary}" on the new row

`smsConversations.pitchedHandlesLog`:
- Written by: `applyStateWrites` (when a new pitch is detected)
- Read by: PRESENTATION addendum builder (injects last-2 for "earlier option" resolution)
- NOT carried forward on 24h rotation

`smsTurns.toolBudgetExhausted`:
- Written by: `finaliseTurnRows` via `TurnObservabilityUpdate`
- Read by: Phase 3 funnel dashboard (future ADR-004)

### Shared surface: `smsConversations` is used by SMS, IVR, and web channels

The `smsConversations` table is the state store for all SMS and IVR conversations. `webConversations` is a parallel table for web. The new columns are SMS/IVR-specific for now. The web adapter reads from `webConversations`, which is not modified in this phase. No cross-table coupling is introduced.

The voice adapter (`app/lib/sms-v2/adapters/voice.server.ts`) reads `ConversationRow` on each IVR turn. The new fields will be present in `ConversationRow` but the voice adapter will initially pass them through without using them — the `buildSystemPrompt` changes are in `conversation-agent.server.ts`, which the voice adapter calls. So IVR immediately benefits from slot injection and the summary bridge on the next turn after the migration ships.

### What breaks if we get this wrong

**If the summary call fires before the reply ships** (wrong async ordering): customer-facing latency increases by ~200-400ms. Unacceptable. The implementation must place the summarizer call in a position where it cannot block the reply path. `finaliseTurnRows` is called after the reply is constructed; the summarizer must be called after `finaliseTurnRows`, not inside it.

**If `buildSystemPrompt` receives a malformed slots object:** the serialization could inject `undefined` strings into the system prompt. The `serializeSlots` helper must treat any falsy value as absent and skip the key entirely.

**If `pitched_handles_log` grows beyond 10 items:** the DB column is text[], not bounded by schema. The application layer must enforce the cap — slice to last 10 before every write. Do not rely on the DB to enforce this.

**If the 24h rotation bridge copies a stale summary:** if the prior conversation's summary is itself empty or null (e.g., the customer had only one turn), the bridge should write null — not the string "From a previous conversation: null". Guard the copy: `newSummary = priorSummary ? \`From a previous conversation: ${priorSummary}\` : null`.

---

## Eval Harness Architecture

Full directory tree:
```
evals/
  fixtures/
    001-returning-customer-memory.json
    002-gift-shopping-partner-anxious.json
    003-re-pitch-loop-vibrator-colors.json
    004-pivot-narration-regression.json
    005-ivr-upsell-voice-suppression.json
    006-pdp-imessage-url-format.json
    007-24h-rotation-bridge.json
    008-slot-injection-after-truncation.json
    009-tool-budget-exhausted-graceful.json
    010-stage-ttl-softened.json
    011-vulnerability-disclosure-soft-beat.json
    012-gift-no-recipient-hint.json
    013-first-time-buyer-safe-space.json
    014-returning-customer-no-reintroduce.json
    015-price-ceiling-respected.json
    016-multiple-pivots-no-re-pitch.json
    017-a-b-pitch-remembered-first-option.json
    018-objection-validate-before-pivot.json
    019-discreet-billing-question-answered.json
    020-url-format-sms-own-line.json
    021-no-em-dashes-in-reply.json
    022-no-countdown-language.json
    023-no-sex-as-adjective.json
    024-checkout-url-not-fabricated.json
    025-xdipx-billing-descriptor-correct.json
    026-max-tool-hops-exceeded-graceful.json
    027-commit-then-upsell-flow.json
    028-voice-no-url-spoken.json
    029-web-product-card-link-format.json
    030-cross-channel-summary-bridge.json
  judge/
    prompt.ts
    runner.ts
  golden/
    README.md
  tsconfig.json
  index.ts
```

Fixture schema (TypeScript type):
```ts
interface EvalFixture {
  id: string                     // e.g. "001-returning-customer-memory"
  description: string
  channel: 'sms' | 'voice' | 'web'
  priorSummary: string | null    // injected as conversation_summary would be
  priorSlots: Record<string, unknown>  // injected as discoveredSlots would be
  pitchedHandlesLog: string[]    // prior pitched handles
  turns: Array<
    | { role: 'user'; text: string }
    | { role: 'expected_behavior'; tags: string[] }
  >
  evalDimensions: Array<'memory' | 'coherence' | 'no_derail' | 'voice_rules' | 'no_fabrication' | 'emma_voice'>
  regressionFor: string | null   // commit SHA or issue ID if this is a regression guard
}
```

Judge prompt (abbreviated — full text in `evals/judge/prompt.ts`): given a fixture, a system prompt used (v1 or v2), and Emma's response, score each `evalDimensions` element 1-5. Return only JSON. Grading rubric anchors on the 13 Emma principles. Scoring criteria per dimension:
- `memory`: did Emma use the prior context (summary, slots) appropriately without ignoring or contradicting it?
- `coherence`: did Emma acknowledge what the customer said before pivoting or asking a question?
- `no_derail`: did Emma stay on the customer's topic rather than reverting to DISCOVERY mode inappropriately?
- `voice_rules`: no em-dashes, no "sex" as adjective, no countdown language, no "buy now", correct billing descriptor (XDIPX).
- `no_fabrication`: no invented URLs, no invented prices, no checkout URLs in non-checkout turns.
- `emma_voice`: playful, warm, trusted-friend register; not clinical, not sleazy.

Runner: `evals/runner.ts` reads all fixtures, for each fixture constructs two Anthropic message arrays (one with the v1 Fly prompt as system, one with the v2 SMS agent system prompt), calls Anthropic API in parallel, sends both responses to the judge, collects scores. Outputs a Markdown table: fixture ID, v1 scores per dimension, v2 scores per dimension, winner. Exit code 1 if any v2 score falls below 3 on any dimension.

`npm run eval:emma` in root `package.json`:
```json
"eval:emma": "npx tsx evals/index.ts"
```

The runner requires only `ANTHROPIC_API_KEY` in the environment. No Neon connection. No Twilio. No Shopify. It is a pure API client.

The v1 Fly prompt for comparison is captured as a static string in `evals/fixtures/_v1-fly-prompt.txt` — a snapshot taken before Phase 1 deletes it. This ensures the comparison remains stable even after Phase 1 removes the Fly agent.

---

## What Could Go Wrong (Ranked by Concern)

**Risk 1 — Summarizer fires in the reply path (highest concern).**
If `rr7-engineer` places the summarizer call inside `finaliseTurnRows` or the stage dispatcher before the reply is returned to Twilio, every SMS reply takes an extra ~300ms. Twilio's webhook timeout is 15 seconds, but 300ms per turn over 30 turns becomes 9 seconds of extra latency accumulated — and any given turn could spike higher on API cold start. The spec says fire-and-forget post-reply; the implementation MUST be verified at code review that the reply path returns before the summarizer is awaited. This is the single most likely implementation error and the most consequential.

**Risk 2 — Summarizer hallucination poisons subsequent turns (second concern).**
Haiku is cheaper and faster than Sonnet but less reliable on constrained factual extraction. If the summarizer invents a slot the customer never stated ("Customer mentioned they have chronic pain" when the customer said "I want something gentle"), that false fact is injected into every subsequent system prompt until overwritten. Because the summary is labeled as lower-priority context, the agent may weight it less than fresh history — but this is a prompt convention, not a guarantee. Mitigation: tight summarizer prompt, clear "facts only" constraint, and the eval harness testing the memory-vs-summary conflict fixture. Still: this is the hardest failure mode to catch in QA because it requires a long conversation where the summarizer has been called 5+ times.

**Risk 3 — The 6h TTL softening surfaces a zombie PRESENTATION stage (third concern).**
Before this change, a customer who texted "PRESENTATION" yesterday and texts "hello" today would get DISCOVERY (the silent reset). After this change, they get PRESENTATION with a 6h-gap note in the system prompt. The agent may interpret the gap note as "check in on the pitch" and open with something like "Still thinking about that Domi 2?" — which could be appropriate or could be confusing if the customer genuinely moved on. This is better than the silent DISCOVERY reset, but it is a new behavior the empathy reviewer should specifically check. The `emma-empathy-reviewer` gate must include at least one test of the gap-note language in the stage addendum.

---

## Verdict

**APPROVE WITH CONDITIONS.**

The seven sub-decisions are sound. The schema migration is additive and safe. The Oxygen seam is unaffected. The eval harness is the right investment.

**Conditions before implementation begins:**

1. `rr7-engineer` must explicitly confirm the summarizer fires after `finaliseTurnRows` returns, not within the reply path. A code comment on the call site is required: `// Non-blocking: do not await before returning reply to Twilio`. This is not optional.

2. The `<known_about_customer>` system-prompt block must pass `emma-empathy-reviewer` gate before the branch merges. The reviewer must specifically check: (a) no disclosure of internal slot keys to the customer, (b) no assumptions beyond what was stated, (c) the gap-note language in the 6h-softened stage addendum.

3. The eval harness must include fixture `007-24h-rotation-bridge` and `008-slot-injection-after-truncation` as the first two fixtures run in CI — they are the regressions most likely to resurface. If either scores below 4 on `memory`, the phase does not advance.

4. The summarizer Haiku prompt must not contain em-dashes. Review it against the voice memory before shipping.

