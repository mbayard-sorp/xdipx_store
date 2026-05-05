# ADR-001 Engineering Feasibility — Phase 0 "Stop the Bleeding"

**Author:** rr7-engineer (lead engineer pair-of-eyes)
**Date:** 2026-05-04
**Status:** DRAFT — for architect review before implementation starts

---

## 1. Per-Item Feasibility

### Item 1 — Persistent rolling conversation summary (Haiku, 1-2 sentences) injected into next turn's system prompt

| Field | Detail |
|---|---|
| **Verdict** | YES_WITH_CONCERNS |
| **Files to touch** | `db/schema.ts` (new column on `smsConversations`), new `app/lib/sms-v2/summary.server.ts`, `app/lib/sms-v2/conversation-agent.server.ts` (lines 211-218 `buildSystemPrompt`, lines 377-392 pre-history block), `app/lib/sms-v2/conversation.server.ts` (lines 206-239 `applyStateWrites`), `db/migrations/032_conversation_summary.sql` |
| **Shape of change** | Add `conversationSummary text` column to `smsConversations`. New `summary.server.ts` exports `async function updateConversationSummary(phone: string, conversationId: string, turns: HistoryTurn[]): Promise<string>` — calls Haiku with a 2-sentence constraint, writes result back via `applyStateWrites`. Called fire-and-forget at end of `executeConversationAgent` AFTER the turn's prose is generated (not on the hot path). Inject into `buildSystemPrompt` as a new param: `conversationSummary: string | null`. |
| **Risks** | (a) Haiku call adds ~300-500ms latency if awaited; architect plan says "run after each turn" but the existing hot path is already sequential DB→Anthropic→DB. Use fire-and-forget (`void updateConversationSummary(...).catch(...)`) so it writes asynchronously and is ready for the NEXT turn. First-turn injection will always be null — that is correct and expected. (b) Prompt cache invalidation: `buildSystemPrompt` currently sets `cache_control: { type: 'ephemeral' }` on the entire system block (conversation-agent.server.ts:397-398). When `conversationSummary` changes every turn, the cache key changes every turn — this is actually INTENTIONAL for the summary (we want fresh context) but means the system prompt block loses caching benefit. A two-block approach (stable rules block with cache_control + dynamic slot/summary block without) would preserve caching on the rules while still injecting fresh context. The plan doesn't call this out; it's a non-trivial structural change but worth doing correctly the first time. (c) `applyStateWrites` does not currently accept `conversationSummary` — must be added to both the function signature and the Drizzle update. (d) The `webConversations` table mirrors `smsConversations` but is NOT in scope for Phase 0. The migration and schema change should only target `smsConversations`; don't reflexively add to `webConversations` yet. |
| **Effort** | 1 day (including migration, summary module, prompt injection, fire-and-forget wiring, vitest mock) |

---

### Item 2 — Slot injection into system prompt (`<known_about_customer>` block)

| Field | Detail |
|---|---|
| **Verdict** | YES |
| **Files to touch** | `app/lib/sms-v2/conversation-agent.server.ts` lines 211-218 (`buildSystemPrompt`), line 393 where `systemText` is built |
| **Shape of change** | `buildSystemPrompt` gains two new params: `discoveredSlots: Partial<DiscoverySlots>` and `conversationSummary: string | null`. A new helper `buildKnownAboutCustomer(slots, summary)` renders the `<known_about_customer>` XML block. If both are empty/null, the block is omitted entirely (don't inject empty XML). Slots are already read at line 371 (`priorSlots`) and passed to `extractSlots` — thread the merged result forward into the system prompt builder. |
| **Risks** | (a) The `<known_about_customer>` block is per-turn variable. See Item 1 risk (b) on prompt cache split — same fix applies here. If we have a two-block system (stable `CONVERSATION_RULES_CORE` + dynamic customer context), the stable block gets `cache_control` and the dynamic block does not. This is the right architecture. (b) `discoveredSlots` arrives as `Record<string, unknown>` from the DB (typed as JSONB). The conversion to `Partial<DiscoverySlots>` already happens at line 371 via a cast — use the same pattern, not a validated parse. (c) Emma empathy reviewer must sign off on the `<known_about_customer>` block's framing language before it ships (per the team gates). Flag this as a required gate in the task breakdown. |
| **Effort** | Half day (no migration needed, pure prompt assembly change) |

---

### Item 3 — 24h rotation preserves a summary bridge to the new conversationId

| Field | Detail |
|---|---|
| **Verdict** | YES_WITH_CONCERNS |
| **Files to touch** | `app/lib/sms-v2/conversation.server.ts` lines 157-168 (24h rotation block in `getOrCreateConversation`) |
| **Shape of change** | When rotation fires, before issuing the `updates` object, read `row.conversationSummary` from the existing row. Write the new `conversationId` AND copy `conversationSummary` forward into the new row's update. The summary is the continuity bridge — on next turn, `buildSystemPrompt` injects it and Emma "remembers." |
| **Risks** | (a) The rotation currently does an update-in-place on the same phone-keyed row (not an insert). So "copy forward" means including `conversationSummary: row.conversationSummary` in the `updates` object at line 158. This is simpler than the architect's description implies — there is no "new row"; just keep the summary column value. The conversationId rotates; the summary stays. (b) Risk: if the rotation fires and the old summary contains PII that the new conversation's system prompt injects for a customer who re-opts from a different context, verify the empathy gate sees this. Likely fine, but worth flagging. (c) `ConversationRow` type (lines 28-53 of conversation.server.ts) must gain `conversationSummary: string | null` to be read here without a raw cast. |
| **Effort** | Half day (mostly falls out of Items 1+2 schema work — this is 10 lines of code once the column exists) |

---

### Item 4 — Soften the 6h stage TTL so it doesn't silently reset to DISCOVERY

| Field | Detail |
|---|---|
| **Verdict** | YES |
| **Files to touch** | `app/lib/sms-v2/conversation.server.ts` lines 71-79 (`shouldResetStage`), lines 169-183 (where the reset fires), `app/lib/sms-v2/turn-logger.server.ts` (add a log call on suppressed reset) |
| **Shape of change** | Option A (recommended by plan): replace the auto-reset with a log-only path. `shouldResetStage` becomes `shouldWarnAboutStage` — it returns a `warn: boolean` flag instead of performing a reset. The conversation.server.ts caller logs it (console.info) and passes a `stageMismatch: boolean` field into the agent context so the agent can see "the intent classifier thinks this looks like DISCOVERY but you're in PRESENTATION." The agent decides. Option B (simpler, safer for Phase 0): extend the TTL from 6h to 24h (same as rotation) and keep the reset but gate it on higher intent confidence (say, `confidence >= 0.8`). Option B is one-line safe. Option A is architecturally correct but needs the context-threading work. Recommendation: ship Option B in Phase 0, do Option A as a named item in Phase 1. |
| **Risks** | (a) Removing the reset entirely risks a stuck OBJECTION stage with no escape hatch. Keep a very long (48h+) hard reset as a fallback. (b) The `intentConfidence` field exists on `IntentResult` and is threaded through the codebase — using it as a gate for resets is trivially implementable. (c) `STAGE_EXPECTED_INTENTS` at line 61 omits DISCOVERY, GREETING, RECONNECT — which means the reset currently only fires for PRESENTATION, OBJECTION, UPSELL, CHECKOUT, POST_CHECKOUT, POST_PURCHASE, SUPPORT. DISCOVERY is already exempt. Confirm the architect knows the blast radius is smaller than the plan implies. |
| **Effort** | Half day (Option B: extend TTL + confidence gate). 1 day for Option A with context threading. |

---

### Item 5 — Replace regex pitched-product detection with tool-result truth

| Field | Detail |
|---|---|
| **Verdict** | YES |
| **Files to touch** | `app/lib/sms-v2/conversation-agent.server.ts` lines 282-304 (`detectPitchedCard`), lines 497-503 (where `detectPitchedCard` is called), lines 440-474 (the Sonnet loop where tool results accumulate in `cardsByToolUseId`) |
| **Shape of change** | The tool loop already accumulates `cardsByToolUseId: Map<string, IvrProductCard[]>` and adds handles to `realHandles` at lines 453-456. The issue is that `detectPitchedCard` is still called on the prose AFTER the loop, using regex as the detection mechanism. Change: when the agent calls `getProductDetails` on a specific handle, capture that handle directly from `block.input` (typed as `{ handle: string }`) at the point the tool call is processed in the loop (around line 447). Store it in a `toolResultPitchedHandle: string | null` local. Then `detectPitchedCard` becomes the fallback only when `toolResultPitchedHandle === null`. The `searchProducts` tool result already produces cards in `cardsByToolUseId` — when exactly one card comes back, that IS the pitched handle. Extend the capture to: if `searchProducts` returns exactly one card, treat that card's handle as the tool-result truth. |
| **Risks** | (a) The `block.input` type is `Record<string, unknown>` — requires a narrowing check `typeof toolInput.handle === 'string'` before trusting it. Do not assume shape. (b) `searchProducts` returning multiple cards (e.g. 3 options listed) should NOT auto-select as pitched — the agent may or may not pitch one of them. Limit the tool-result truth to `getProductDetails` calls and single-card `searchProducts` results only. (c) The `runDiscoveryTool` function at line 447 mutates `cardsByToolUseId` via the `cardSink` in `toolCtxBase` — this side-effect-based architecture means the handle capture also needs to happen in the same loop body. No architectural change needed, just an additional capture. |
| **Effort** | Half day |

---

### Item 6 — Track last 10 pitched handles in a new `pitched_handles_log` column

| Field | Detail |
|---|---|
| **Verdict** | YES |
| **Files to touch** | `db/schema.ts` (new column on `smsConversations`), `db/migrations/032_conversation_summary.sql` (same migration as Item 1 — bundle both schema changes), `app/lib/sms-v2/conversation.server.ts` `applyStateWrites` signature (add `pitchedHandlesLog?: string[] | null`), `app/lib/sms-v2/conversation-agent.server.ts` `stateWrites` building at lines 537-541, `app/lib/sms-v2/types.server.ts` `ConversationStateWrites` interface |
| **Shape of change** | `pitchedHandlesLog text[]` column (Postgres native text array, Drizzle `text('pitched_handles_log').array()`). When a new pitch fires (line 533 in conversation-agent.server.ts, `newPitchHandle !== undefined`), read the current log from `ctx.conversation.pitchedHandlesLog ?? []`, prepend the new handle, slice to last 10, write via `stateWrites`. The agent can then see "here are the last 10 handles I've pitched" and avoid re-pitching. The `ConversationRow` interface in conversation.server.ts gains `pitchedHandlesLog: string[] | null`. |
| **Risks** | (a) Drizzle's `.array()` modifier on a `text` column maps to `text[]` in Postgres — this is supported but watch the migration syntax: `ALTER TABLE sms_conversations ADD COLUMN pitched_handles_log text[]`. (b) The architect's plan says "last N=10 pitched handles" — using prepend+slice(10) is correct; don't use append because you want the most recent at index 0 for quick lookup. (c) For the agent to actually USE the list, it needs to appear in the system prompt or history. It's most useful in the `<known_about_customer>` block from Item 2 — "You've already shown: [handle-a, handle-b]." This dependency should be explicit in the task order. (d) `ConversationStateWrites` in `types.server.ts` must be extended, and `applyStateWrites` in `conversation.server.ts` must handle the array column — check that Drizzle's neon-http driver passes arrays correctly (it does for jsonb, but native `text[]` needs a test). |
| **Effort** | Half day (once migration is written) |

---

### Item 7 — Surface `tool_budget_exhausted` flag in telemetry

| Field | Detail |
|---|---|
| **Verdict** | YES |
| **Files to touch** | `app/lib/sms-v2/conversation-agent.server.ts` lines 426-486 (the Sonnet loop), lines 556-563 (telemetry build), `app/lib/sms-v2/turn-logger.server.ts` `TurnObservabilityUpdate` interface (line 93), `finaliseTurnRows` (line 112), `db/schema.ts` `smsTurns` table, `db/migrations/032_conversation_summary.sql` (bundle here) |
| **Shape of change** | Add `toolBudgetExhausted: boolean` to `TurnObservabilityUpdate` and `StageTelemetryOverride`. In the Sonnet loop (conversation-agent.server.ts), add a `let toolBudgetExhausted = false` before the loop, then after the loop check: `if (hop === MAX_TOOL_HOPS - 1 && res.stop_reason === 'tool_use') { toolBudgetExhausted = true }` — this fires when the loop hit the ceiling with a pending tool call. Include in telemetry. Add `tool_budget_exhausted boolean not null default false` column to `smsTurns` schema and migration. Wire through `finaliseTurnRows` like `softBeat` is wired (lines 139-140 of turn-logger.server.ts). |
| **Risks** | (a) The loop exits naturally via `break` on a non-tool_use stop_reason. On the 3rd hop, if `stop_reason === 'tool_use'`, the loop exits via the `for` condition (`hop < MAX_TOOL_HOPS`) without a `break` — the budget was exhausted. Verify: after the loop body on the last hop, `res` is still in scope because the `continue` at line 475 only fires if there's another hop available. On the final hop, if `stop_reason === 'tool_use'`, the loop just... ends, and `finalText` is never set, triggering `safeFallback`. The `toolBudgetExhausted` flag should be set in `safeFallback` too. (b) Minor: the flag needs to flow through `safeFallback` — currently `safeFallback` returns a hardcoded telemetry object (lines 596-600). Add the flag there as well. |
| **Effort** | Half day |

---

### Item 8 — Eval harness with 30 golden conversations and a Sonnet-as-judge runner

| Field | Detail |
|---|---|
| **Verdict** | YES_WITH_CONCERNS |
| **Files to touch** | New directory `evals/` at repo root: `evals/fixtures/` (30 JSON golden conversations), `evals/judge.ts` (Sonnet-as-judge runner), `evals/run.ts` (entry point), `package.json` (add `"eval:emma": "tsx evals/run.ts"` script) |
| **Shape of change** | Each fixture: `{ id, description, channel, turns: [{role, text}][], expectedPrinciples: string[], shouldNotAppear: string[] }`. The judge runner replays the fixture through `executeConversationAgent` (or its equivalent) in test mode with a mocked Anthropic client for the agent calls (so fixtures don't burn real tokens), then calls Sonnet ONCE per fixture as judge with the full transcript + the expected principles. Judge returns `{ verdict: 'PASS'|'REVISE'|'BLOCK', violations: string[] }`. For the SIDE-BY-SIDE comparison of v1 vs v2 prompts (mentioned in the plan), the runner needs to be able to inject a custom system prompt — structure the judge runner to accept a `systemPromptOverride` param. |
| **Risks** | (a) THIS IS THE LARGEST ITEM. 30 golden conversations is significant authoring work. The plan calls for coverage of: pivot narration, upsell on voice, PDP iMessage preview, vulnerability disclosure, gift shopping, returning customer with old context. That's ~5 scenario categories, 5-6 fixtures each. Budget 4-6 hours of fixture authoring alone. (b) Running `executeConversationAgent` in vitest requires mocking the Anthropic client. The existing `slot-extractor.test.ts` pattern uses `_setAnthropicClient` for this. The conversation-agent does NOT have an equivalent injectable client — it uses a module-scope `const client = new Anthropic(...)` at line 71. To test it without real API calls, either: (i) add `export function _setConversationAgentClient(c: Anthropic)` (same pattern as slot-extractor), or (ii) test end-to-end with real Sonnet for the judge-only fixture, mock the agent. Option (ii) is more useful — mock the agent's responses as fixture data and use real Sonnet only for judgment. (c) The `npm run test` script currently runs `tsx scripts/check-tts-normalize-sync.ts && vitest run` — confirm the eval harness should be a SEPARATE script (`npm run eval:emma`) and not bundled into `npm test`. Bundling it into `npm test` would require API keys in CI by default; separate is safer. (d) The plan says "run the eval on the v1 Fly prompt side-by-side." The Fly v1 prompt lives in the IVR repo (`ivr/src/prompts.ts`), not here. For Phase 0, the side-by-side comparison can only run against the v2 SMS system prompt vs a hypothetical "v1-style" prompt you reconstruct. The architect should clarify whether the Fly repo is accessible to this eval harness in Phase 0. |
| **Effort** | 2+ days (fixture authoring is the bottleneck) |

---

## 2. Gotchas List

**1. Prompt cache invalidation on every turn (conversation-agent.server.ts:397-399)**
The entire system prompt is in one `TextBlockParam` with `cache_control: { type: 'ephemeral' }`. Once we inject a per-turn rolling summary and discovered slots, the system block changes on every turn and the Anthropic prompt cache never gets a hit on it. The current model (`claude-sonnet-4-6`) charges for cache writes even on misses. The fix is a two-block system: block 1 = stable rules (`BRAND_VOICE + CONVERSATION_RULES_CORE + stage addendum + channel addendum`) with `cache_control: { type: 'ephemeral' }`, block 2 = dynamic customer context (no cache_control). This is a meaningful cost and quality win but requires changing `systemParam` from a single-element array to a two-element array. The Anthropic SDK's `system` param accepts `TextBlockParam[]` — already the case here, so the type change is trivial. The routing logic to keep the stable block truly stable (same content across hops within a turn) needs attention.

**2. `webConversations` is a parallel table that will diverge (db/schema.ts:541-566)**
`smsConversations` and `webConversations` have near-identical column sets. Any schema migration that adds columns to `smsConversations` (Items 1, 6, 7) must explicitly decide whether `webConversations` gets the same column. Currently `webConversations` does NOT have `conversationSummary`, `pitchedHandlesLog`, or `tool_budget_exhausted`. The migration should add to both tables OR add only to `smsConversations` with a comment documenting why. Do not accidentally add to neither (schema will drift from code expectations).

**3. The Haiku model identifier has a specific non-obvious string (slot-extractor.server.ts:60)**
Current usage: `HAIKU_MODEL = 'claude-haiku-4-5-20251001'`. The summary module (Item 1) must use the same string. Do NOT use `claude-haiku-4` or any other alias — the exact model string matters for billing and capability routing. Copy the constant from slot-extractor.server.ts rather than guessing.

**4. `conversationId` rotation fires in `getOrCreateConversation` but is called TWICE per turn in processor.server.ts (lines 48-72)**
`processSmsMessageV2` calls `getOrCreateConversation(phone)` at line 49, then calls `getOrCreateConversation(phone, intentResult.intent)` again at line 69 for the 6h TTL check. The 24h rotation fires on the FIRST call (the second call won't rotate again — `lastActiveAt` is updated). But the SECOND call reads back the already-updated row, so the `conversationSummary` copy-forward logic (Item 3) must happen in the first call's rotation block, not the second. This double-call pattern is a subtle trap for anyone adding logic to `getOrCreateConversation`.

**5. `applyStateWrites` is called from processor.server.ts (line 95-108), not from conversation-agent.server.ts**
The agent returns `stateWrites` as part of `StageResponse`, and the PROCESSOR applies them. This means any new field (like `pitchedHandlesLog`, `conversationSummary`) must thread through: `ConversationStateWrites` type (types.server.ts) → returned by the agent in `stateWrites` → applied by processor.server.ts in `applyStateWrites`. Items 1, 6, and 3 all hit this path. Verify `types.server.ts` `ConversationStateWrites` is extended for each new field, or the write is silently dropped.

**6. `executeDiscoveryStage` is a dispatch shim — the Sonnet agent path and the legacy gate path have diverged behavior (stages/discovery.server.ts:356-366)**
`pickDiscoveryAgentVersion` controls whether the legacy gate machine or the Sonnet `executeDiscoveryAgent` runs. The slot injection (Item 2) and summary injection (Item 1) both only apply when `executeConversationAgent` runs (via `executeDiscoveryAgent`). The legacy gate machine (`executeDiscoveryGate`) does NOT call `executeConversationAgent`. If a phone is on the legacy path (`v2-gate`), Items 1 and 2 do nothing for that phone. The plan assumes the Sonnet agent is the default — verify whether `DISCOVERY_AGENT_VERSION` defaults to `v2-gate` or `v2-agent` in production before assuming the fix is live everywhere.

**7. No injectable client on `conversation-agent.server.ts` (line 71)**
Module-scope `const client = new Anthropic(...)`. The slot extractor has `_setAnthropicClient` for test isolation (slot-extractor.server.ts:56-58). The conversation agent does not. Any integration test that calls `executeConversationAgent` will make real API calls unless you add the same injection pattern. The eval harness (Item 8) will need this — plan for it explicitly.

**8. Migration numbering: the next hand-written migration number is 032**
Highest confirmed: `031_pending_pdp_url.sql`. The migration runner at scripts/apply-migrations.ts filters on 3-digit prefixes only (line 33: `num.length === 3`). Name the new file `032_conversation_summary.sql`. The 4-digit Drizzle-kit files (`0000-0003`) are filtered out by the same check — safe to coexist.

**9. `smsTurns` unique index on `twilioMessageSid` will reject null values across multiple rows (db/schema.ts:527)**
`uniqueIndex('sms_turns_twilio_sid_uniq').on(t.twilioMessageSid)` — in Postgres, a unique index on a nullable column allows multiple NULLs (NULLs are not considered equal). This is correct behavior for simulator rows (which have no twilioSid). No change needed here, but any schema addition to `smsTurns` must account for simulator rows having null in this column.

**10. `tool_budget_exhausted` detection edge case: on the final hop, `res` is consumed by the text-extraction block, not the tool-use block (conversation-agent.server.ts:477-483)**
The loop `break`s on any non-`tool_use` stop_reason. On the final hop (hop = 2 when MAX_TOOL_HOPS = 3), if `stop_reason === 'tool_use'`, the loop increments `hop` to 3, fails the `hop < MAX_TOOL_HOPS` check, and exits WITHOUT going through either the `tool_use` branch or the `end_turn` branch. `finalText` is never set, so `safeFallback` is triggered at line 489. The `toolBudgetExhausted` flag should be set BEFORE the loop exits — either check at the end of each iteration whether `hop === MAX_TOOL_HOPS - 1 && res.stop_reason === 'tool_use'`, or check after the loop whether `!finalText && allCards.length > 0` (a reasonable proxy).

---

## 3. Atomic Task Breakdown

Tasks are ordered by dependency. Tasks that are independent can execute in parallel (noted).

---

**Task 0.1 — Write and apply migration 032**
Files: `db/migrations/032_conversation_summary.sql`, `db/schema.ts`
What: `ALTER TABLE sms_conversations ADD COLUMN conversation_summary text`, `ADD COLUMN pitched_handles_log text[]`, `ALTER TABLE sms_turns ADD COLUMN tool_budget_exhausted boolean NOT NULL DEFAULT false`. Mirror `conversation_summary` and `pitched_handles_log` to `web_conversations` with the same ALTER (or add a TODO comment if intentionally deferred). Update `db/schema.ts` with the new columns in Drizzle column definitions.
Acceptance: `npx tsx scripts/apply-migrations.ts --from 032` succeeds on preview DB. TypeScript types on `smsConversations` include the new columns.
Dependencies: none — this is the foundation for everything below.

---

**Task 0.2 — Extend `ConversationRow`, `ConversationStateWrites`, and `applyStateWrites`**
Files: `app/lib/sms-v2/conversation.server.ts`, `app/lib/sms-v2/types.server.ts`
What: Add `conversationSummary: string | null`, `pitchedHandlesLog: string[] | null` to `ConversationRow` interface. Add optional `conversationSummary?: string | null`, `pitchedHandlesLog?: string[] | null` to `ConversationStateWrites`. Add the corresponding branches in `applyStateWrites` following the existing pattern at lines 228-236.
Acceptance: typecheck passes. No behavioral change.
Dependencies: Task 0.1.

---

**Task 0.3 — Implement summary module**
Files: new `app/lib/sms-v2/summary.server.ts`
What: Export `async function generateConversationSummary(turns: HistoryTurn[], priorSummary: string | null): Promise<string>`. Calls Haiku with `HAIKU_MODEL` constant (copied from slot-extractor.server.ts). Prompt: "Summarize this sexual-wellness shopping conversation in 1-2 sentences from the assistant's perspective. Note what the customer is shopping for, key preferences disclosed, and the current pitch if any." Returns the summary string. On any error, returns `priorSummary ?? ''`. Export a `_setSummaryAnthropicClient` for test injection (matching the slot-extractor pattern).
Acceptance: vitest unit test with mocked client passes. Output is under 200 characters (enforce in the prompt).
Dependencies: Task 0.1 (for the type), but can be written in parallel with Task 0.2.

---

**Task 0.4 — Wire fire-and-forget summary update into conversation-agent.server.ts**
Files: `app/lib/sms-v2/conversation-agent.server.ts`
What: Import `generateConversationSummary` from summary.server.ts. After `finalProse` is determined (around line 495), call `void generateConversationSummary(history, ctx.conversation.conversationSummary ?? null).then(summary => applyStateWrites(ctx.conversation.phone, { conversationSummary: summary })).catch(err => console.warn('[conversation-agent] summary update failed', err))`. Do NOT await — fire and forget so it doesn't add latency to the turn.
Acceptance: A conversation turn completes in normal latency. The `sms_conversations` row has `conversation_summary` populated on the NEXT read. Existing vitest tests still pass.
Dependencies: Tasks 0.2, 0.3.

---

**Task 0.5 — Refactor `buildSystemPrompt` to two-block structure with slot and summary injection**
Files: `app/lib/sms-v2/conversation-agent.server.ts` lines 211-218 and 391-399
What: Change `buildSystemPrompt` signature to `buildSystemPrompt(stage, channel, currentPitchHandle, discoveredSlots, conversationSummary)`. Split the system param into two `TextBlockParam` entries: (1) stable rules block with `cache_control: { type: 'ephemeral' }`, (2) dynamic `<known_about_customer>` block WITHOUT `cache_control`. New `buildKnownAboutCustomer(slots, summary, pitchedHandlesLog)` helper produces the XML block. If all inputs are empty/null/empty-array, return an empty string and omit the second block.
Acceptance: typecheck passes. System prompt in a test run contains the `<known_about_customer>` block when slots are non-empty. Emma empathy reviewer gate: the `<known_about_customer>` block must pass review before merging.
Dependencies: Tasks 0.2, 0.3, 0.4. Also depends on Task 0.6 (pitchedHandlesLog in ctx) to fully populate the block.

---

**Task 0.6 — Track pitched handles log in stateWrites and read into system prompt**
Files: `app/lib/sms-v2/conversation-agent.server.ts` lines 533-541 (`stateWrites` build), `app/lib/sms-v2/types.server.ts`, `app/lib/sms-v2/processor.server.ts` lines 95-108
What: When `pitched !== undefined` (a new handle was pitched), read `ctx.conversation.pitchedHandlesLog ?? []`, prepend `pitched.handle`, slice to 10, write to `stateWrites.pitchedHandlesLog`. Ensure `processor.server.ts` threads `pitchedHandlesLog` through `applyStateWrites`. `ConversationStateWrites` gets `pitchedHandlesLog?: string[] | null`.
Acceptance: After two pitches, `sms_conversations.pitched_handles_log` contains both handles. After 11 pitches, it contains only the most recent 10.
Dependencies: Tasks 0.1, 0.2.

---

**Task 0.7 — Replace regex pitched-product detection with tool-result truth**
Files: `app/lib/sms-v2/conversation-agent.server.ts` lines 440-503
What: Add `let toolResultPitchedHandle: string | null = null` before the Sonnet loop. Inside the loop where `block.name === 'getProductDetails'` and the tool returns successfully, extract `handle` from `block.input` with a type guard. When `searchProducts` returns exactly one card (check `cards.length === 1` after accumulating), set `toolResultPitchedHandle`. After the loop, in the `detectPitchedCard` call: if `toolResultPitchedHandle !== null`, prefer it over regex. Update `detectPitchedCard` to accept a `preferredHandle: string | null` param.
Acceptance: A conversation where the agent calls `getProductDetails(handle: 'lovense-domi-2')` and doesn't mention the URL produces `stateWrites.currentPitchHandle = 'lovense-domi-2'`. Existing regex fallback still works for prose-only pitches.
Dependencies: None (independent of schema changes).

---

**Task 0.8 — Soften 6h stage TTL (Option B: extend + confidence gate)**
Files: `app/lib/sms-v2/conversation.server.ts` lines 71-79
What: Extend the TTL from 6h to 24h (matching the rotation TTL). Add an intent confidence gate: only reset if `intentResult.confidence >= 0.75`. Log the suppressed reset at `console.info` level so it shows up in Vercel logs for the log-monitor role.
Acceptance: A conversation in PRESENTATION stage that receives a turn classified as DISCOVERY-intent with confidence 0.6 does NOT reset to DISCOVERY. With confidence 0.9 after 24h, it does reset.
Dependencies: None (independent of schema changes).

---

**Task 0.9 — Surface `tool_budget_exhausted` flag in telemetry**
Files: `app/lib/sms-v2/conversation-agent.server.ts` (Sonnet loop + safeFallback), `app/lib/sms-v2/turn-logger.server.ts` (`TurnObservabilityUpdate`, `StageTelemetryOverride`, `finaliseTurnRows`), `app/lib/sms-v2/types.server.ts` (`StageResponse.telemetry`)
What: Add `toolBudgetExhausted?: boolean` to `StageResponse['telemetry']`. In the Sonnet loop, detect budget exhaustion (see Gotcha #10 for the correct detection point). Pass through `safeFallback` as well. Add `tool_budget_exhausted?: boolean` to `TurnObservabilityUpdate` and wire to the DB column via `finaliseTurnRows`.
Acceptance: A mocked test where the agent makes 3 tool calls without a final text response produces `smsTurns.tool_budget_exhausted = true`. Normal turns produce `false`.
Dependencies: Tasks 0.1, 0.2. Partially depends on 0.5 for the telemetry shape, but can be developed in parallel.

---

**Task 0.10 — Eval harness scaffold and first 10 golden fixtures**
Files: `evals/run.ts`, `evals/judge.ts`, `evals/fixtures/*.json`, `package.json`
What: Create `evals/` directory. `run.ts` is the CLI entry point, reads all fixtures, replays each through a fixture-driven agent (using stored turn pairs, not live API calls), calls Sonnet-as-judge once per fixture, outputs PASS/REVISE/BLOCK with violations. Add `"eval:emma": "tsx evals/run.ts"` to package.json scripts. First 10 fixtures: 2 pivot narration, 2 gift shopping, 2 returning customer, 2 vulnerability disclosure, 2 tool-budget scenarios.
Acceptance: `npm run eval:emma` runs without errors. Fixtures pass when the described behavior is present and fail when it's absent (validate with one intentionally-broken fixture).
Dependencies: Task 0.7 (so the pitched handle detection is accurate in replay). Does NOT depend on schema changes for the scaffold.

---

**Task 0.11 — Complete remaining 20 golden fixtures and v1-vs-v2 comparison mode**
Files: `evals/fixtures/*.json`, `evals/run.ts` (add `--prompt-override` flag)
What: Write the remaining 20 fixtures covering: single-product variant questions ("what colors?"), price objection + pivot, channel-specific (voice: no URLs, SMS: URL on its own line), discreet billing question mid-pitch, post-checkout shopping continuation. Add `--system-prompt-override <file>` flag to `run.ts` so the v1 Fly prompt can be injected for the side-by-side comparison. Document the baseline PASS rate for both prompts.
Acceptance: `npm run eval:emma -- --system-prompt-override evals/v1-fly-prompt.txt` runs and outputs a side-by-side comparison report.
Dependencies: Task 0.10.

---

## 4. Blockers and Open Questions for the Architect

**Q1: `webConversations` parity for Phase 0 schema changes.**
Items 1 and 6 add columns to `smsConversations`. The `webConversations` table has nearly identical structure. Does Phase 0 require parity? If yes, the migration must ALTER both tables. If no, document why (different pipeline, Phase 2 will align when participants table arrives). Recommendation: add to both now. Cost is one extra ALTER statement. Leaving them different creates a fork that Phase 2 has to reconcile.

**Q2: Prompt cache split — architect should confirm this is in scope for Phase 0.**
The two-block system prompt (stable rules + dynamic customer context) is the architecturally correct solution for Items 1+2, but it's a larger refactor than the plan implies. The plan says "inject into next turn's system prompt" without specifying the cache impact. If Phase 0 ships a single-block system prompt with dynamic content, we're paying for cache misses on every turn with no benefit. The architect should either include the two-block refactor explicitly in Phase 0 scope, or accept that prompt caching is temporarily broken for the duration of Phase 0 (acceptable as a known tradeoff).

**Q3: `DISCOVERY_AGENT_VERSION` default in production.**
Items 1 and 2 only affect turns that go through `executeConversationAgent` (the Sonnet path). The legacy gate machine (`executeDiscoveryGate`) is a separate code path that does NOT benefit from summary or slot injection. If the production flag defaults to `v2-gate` for most phones, Phase 0's memory improvements won't be felt by most customers. The architect should confirm the flag state and whether Phase 0 includes flipping it to `v2-agent` as a prerequisite.

**Q4: Fly repo accessibility for eval harness v1-vs-v2 comparison.**
The plan says "run the eval on the v1 Fly prompt side-by-side." The Fly v1 prompt is in a separate repo (`ivr/src/prompts.ts`). Does the eval harness need to import from there, or is the comparison done by copy-pasting the v1 prompt into `evals/v1-fly-prompt.txt`? The copy-paste approach is simpler and sufficient for Phase 0 — confirm this is acceptable.

**Q5: `applyStateWrites` is called twice per turn for some state (processor.server.ts).**
`processor.server.ts` calls `applyStateWrites` once at line 95 (stage handler writes), then there's a separate `applyStateWrites(phone, { stage: 'DISCOVERY' })` at line 175 (the GREETING → DISCOVERY bump). The summary update from Task 0.4 fires INSIDE `executeConversationAgent` as a fire-and-forget write. This means up to 3 separate DB writes per turn. For Phase 0 this is acceptable (writes are async), but worth flagging for Phase 1 write batching.

---

## 5. Final Verdict

**CAN_EXECUTE_WITH_OPEN_QUESTIONS**

All 8 items are feasible in the current codebase. No blockers. The open questions (Q1-Q5 above) are pre-implementation decisions that can be resolved in a 15-minute architect review, not code problems. The work itself is cleanly scoped and the codebase's existing patterns (injectable Anthropic client in slot-extractor, `_setAnthropicClient` for tests, `applyStateWrites` extension pattern, fire-and-forget Klaviyo calls) all provide clear templates for the new code. The eval harness (Item 8) is the riskiest item in terms of effort — the 30-fixture authoring is real work — but it's not technically hard. Phase 0 can ship in the planned week with two engineers working in parallel on schema+agent core (Tasks 0.1-0.9) and eval harness (Tasks 0.10-0.11).

**Do not start coding until Q2 (prompt cache split) and Q3 (discovery agent flag) are answered.** Both affect scope in a way that changes the first day of implementation.
