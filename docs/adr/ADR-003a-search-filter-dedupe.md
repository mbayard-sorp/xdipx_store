# ADR-003a: Search Filter and Pitched-Handle De-duplication

**Date:** 2026-05-04
**Status:** Implemented by PR #100 (`dcb3707`, 2026-05-07)
**Parent ADR:** ADR-003 (Emma Web Trust Fixes — Phase 0.5)
**Owner:** tech-architect
**Implementation owner:** rr7-engineer
**Empathy review required:** Yes — Sub-decision Y's broaden-on-exhaustion message is an Emma-voice string

---

## Implementation notes

This ADR was proposed 2026-05-04 and **implemented by PR #100** (`dcb3707 Emma v2: SMS engine cutover + cross-channel state, Phases 7–10`, squash-merged 2026-05-07).

Implementation landing points in current `main`:

- **Issue X — Anal-context filter:** `app/lib/sms-v2/discovery-agent-tools.server.ts` lines 152–194 hold the full filter implementation: `ANAL_HANDLE_SUBSTRINGS`, `isAnalTagged()`, `isAnalContextAuthorized()`. Wired into the search tool at the dispatcher layer per the ADR's "tool-call wrapper, NOT agent-prompt rule" decision.
- **Issue Y — Pitched-handle dedup:** `app/lib/sms-v2/conversation-agent.server.ts` line 679 wires `pitchedHandlesLog` into `toolCtxBase` so the dispatcher layer can enforce dedup. The DB observability flag landed via migration `db/migrations/033_search_repeated_pitch.sql` and column `searchRepeatedPitch` in `db/schema.ts:541`. Turn-logger writes are at `app/lib/sms-v2/turn-logger.server.ts:115, 154, 174`.

Eval fixtures 036–040 (`evals/fixtures/`) regression-guard these layers.

Document retained as a historical record of the false-positive trust risk and the layer-choice reasoning.

## Context

Two failures observed in the same real-user session on the Vercel preview during Phase 0.5 testing. Both occurred in a DISCOVERY flow where the user stated "treating myself", "gentle and warming", "first time", and asked about "vibrators."

**Failure X — Anal-tagged product on a general vibrator query.**
`vedo-bump-rechargeable-anal-vibe-just-black` was returned as the top result for a general vibrator search. No anal-context signal existed in the conversation. Emma pitched it five times across turns. The product handle and Sanity `productTypeDial` field both clearly mark this as an anal product. For a self-described first-time user asking about vibrators, this is a trust-breaking failure. A false negative (user actually wanted anal, Emma didn't surface it) is recoverable — the user re-asks. A false positive (anal product on a general first-time vibrator query) damages trust on first contact and cannot be undone.

**Failure Y — Repeated pitch of the same handle.**
When the user said "show me some alternatives" and "show me what you like," the search returned `vedo-bump...` each time. The agent re-pitched it five times. `pitched_handles_log` contained five copies of the same handle. Emma even acknowledged the loop ("the catalog keeps pointing me right back to...") but continued pitching it. This indicates the dedup is not enforced at the tool or dispatcher layer — the agent layer prompt guidance alone ("if you've already pitched a handle, pick a different result") is insufficient when the search itself keeps returning the same top result.

Both failures compound: the anal filter would have eliminated the bad result entirely, but even without that, the dedup would have forced a different product on the second alternatives request.

This ADR does not re-litigate Phase 0.5 scope from ADR-003. It addresses two search-layer behaviors that cannot be solved by prompt guidance alone.

---

## Decision (Issue X) — Anal-Context Filter

### Layer: tool-call wrapper (dispatcher layer), NOT agent-prompt rule

**Chosen: `runDiscoveryTool` in `app/lib/sms-v2/discovery-agent-tools.server.ts`.**

The filter fires in the `searchProducts` branch of `runDiscoveryTool`, as a post-processing step on `diag.cards` before the results are returned to the agent. This is the dispatcher layer — the agent never sees anal-tagged products unless anal context is authorized.

Rationale for this layer over the alternatives:

- **Search-tool layer (query-side GROQ exclusion):** The GROQ filter can exclude `productTypeDial == 'plug'` at the database level. This would be maximally efficient. However, `productTypeDial = 'plug'` covers non-anal plugs (ear plugs, nipple plugs) if the catalog ever adds them, and the Sanity tagging for anal products may not be uniformly `productTypeDial = 'plug'` — some may carry `productTypeDial = 'vibrator'` with an `ivrCategory` or tag of `anal`. A result-side filter can check multiple signals (handle substring, category field, tags array) without requiring perfect Sanity schema hygiene. Query-side exclusion is faster but brittle; result-side is one extra milliseconds at most on 3-card result sets.

- **Agent-prompt rule:** Already present in `CONVERSATION_RULES_CORE` ("PAIRING SANITY" in `SMS_MODE`) and in the PRESENTATION addendum. The failure proves it is insufficient — the agent sees the anal product, recognizes the mismatch, and pitches it anyway ("the catalog keeps pointing me right back to..."). Prompt rules are probabilistic; the dispatcher layer is deterministic.

### The filter rule

In `runDiscoveryTool`, after `const top = diag.cards.slice(0, 3)`, apply the filter before stashing into `cardSink` and before returning:

```
const analAuthorized = isAnalContextAuthorized(ctx)
const filteredTop = analAuthorized ? top : top.filter(card => !isAnalTagged(card))
```

**`isAnalTagged(card: IvrProductCard): boolean`** — returns true when any of:
1. `card.handle` contains one of: `anal`, `plug`, `prostate`, `beads` as a word-boundary substring (case-insensitive). This catches `vedo-bump-rechargeable-anal-vibe-just-black` and similar.
2. `card.category` (string) is `'anal'` or `'plug'`.
3. Future-proofing: if `IvrProductCard` gains a `tags` field, check `tags.includes('anal')`.

The handle-substring check is the primary signal because Sanity tagging hygiene cannot be guaranteed. The category check is a secondary confirmation.

**`isAnalContextAuthorized(ctx: DiscoveryAgentToolContext): boolean`** — returns true when any of:
1. The `query` string passed to `searchProducts` contains: `anal`, `plug`, `prostate`, `butt`, `rear`, `backdoor`. (The agent called search with explicit anal intent.)
2. `ctx.pitchedHandlesLog` contains at least one handle that itself passes `isAnalTagged`. (Prior turn pitched an anal product — user has tolerated it.)
3. The `category` input to `searchProducts` is `'plug'` or `'anal'`. (The agent explicitly categorized the search as anal.)

**Default behavior when signal is absent:** exclude. If all three authorization checks return false, anal-tagged cards are filtered from the result set before the agent sees them. The agent receives a smaller result set; if all 3 results were anal-tagged, it receives zero results. Zero-result behavior is already handled by the existing `no-base-results` / `filtered-to-zero` diagnostic path — the agent can acknowledge no match and try a different angle.

**Shopify fallback path:** the Shopify fallback in `searchForIvrWithDiagnostics` does not return `productTypeDial` or `category`. For fallback results, the handle-substring check is the only signal. Accept this limitation — the Shopify fallback is a degraded mode and the catalog's anal products should have `anal` or `plug` in their handles.

**`DiscoveryAgentToolContext` extension:** add `pitchedHandlesLog: string[] | null` to the context object. The caller (in `conversation-agent.server.ts` `executeConversationAgent`) already has `ctx.conversation.pitchedHandlesLog` — pass it through to the tool context when constructing `DiscoveryAgentToolContext`.

---

## Decision (Issue Y) — Pitched-Handle De-duplication

### Layer: tool-call wrapper (dispatcher layer), composing with the existing `pitched_handles_log`

**Chosen: post-filter in `runDiscoveryTool`, applied AFTER the anal filter.**

The dedup receives the anal-filtered card list, removes any card whose handle appears in `ctx.pitchedHandlesLog`, and returns what remains. The agent never sees already-pitched handles unless the search is exhausted.

Rationale for this layer over the alternatives:

- **Query-side exclusion:** GROQ does not support a `handle NOT IN [...]` clause with a dynamic list in a clean way. It is possible with a condition like `!(shopifyHandle in $excludedHandles)` but requires the exclude list to be passed as a GROQ parameter, meaning it must be threaded through `IvrSearchOpts`. This couples the search interface to the conversation state. The result-side filter keeps `ivr-search.server.ts` stateless.

- **Agent-prompt rule:** The existing `CONVERSATION_RULES_CORE` already says "if you've already pitched a given handle, pick a different result." The failure proves the model complies when results are varied but cannot comply when all results are the same handle. The fix is structural, not instructional.

- **`searchProducts` `excludeHandles` param on `IvrSearchOpts`:** Adding this param to `searchForIvrWithDiagnostics` is the cleanest long-term option and should be the Phase 1 solution when the candidate pool is larger. For Phase 0.5 a result-side filter in the tool wrapper is lower risk (no change to `ivr-search.server.ts` or `IvrSearchOpts`; easier to revert; no coupling to conversation state in the search module).

### The handle-exclusion rule

After the anal filter, in `runDiscoveryTool`:

```
const priorHandles = new Set((ctx.pitchedHandlesLog ?? []).map(h => h.toLowerCase()))
const deduped = filteredTop.filter(card => !priorHandles.has(card.handle.toLowerCase()))
```

### Broaden-on-exhaustion behavior

When `deduped` is empty (all returned cards have been pitched before) and the original `filteredTop` was non-empty, signal exhaustion and instruct the agent to broaden:

Return to the agent:

```json
{
  "results": [],
  "reason": "all_results_previously_pitched",
  "message": "All matching products have already been shown in this conversation. Try a different search angle — broader query, different category, or drop a filter."
}
```

The agent's existing behavior for `no-base-results` (acknowledge and try a different angle) is the correct response, but `all_results_previously_pitched` is a distinct reason code so it can be logged separately. The agent's `CONVERSATION_RULES_CORE` already says "if a search returned no results, acknowledge plainly and offer a different angle" — this is sufficient instruction for the exhaustion case.

**Emma-voice exhaustion message (for web chat):** The `message` field above is a machine-readable instruction to the agent, not customer-facing prose. The agent generates its own reply. The empathy reviewer must verify that when the agent receives `all_results_previously_pitched`, it does not produce a reply that makes the customer feel they have broken something or run out of catalog. Acceptable Emma-voice outcome: "Hmm, I've shown you everything I have at that price point in this category. Want me to widen the search a bit, or try a different direction?" Unacceptable: "I cannot find any more results."

**When `deduped` is empty AND `filteredTop` was empty (no anal-filtered candidates):** return the existing `no-base-results` reason. Do not surface `all_results_previously_pitched` when the catalog genuinely has nothing.

**New telemetry flag:** add `search_repeated_pitch: true` to `StageResponse.telemetry` when `all_results_previously_pitched` is returned. This is distinct from `tool_budget_exhausted` (hop count) and is needed to surface this failure mode in turn logs without parsing the reason code.

---

## Coupling

### Composition order

The two filters compose sequentially in `runDiscoveryTool`:

```
raw results (from searchForIvrWithDiagnostics)
  → anal filter (context-gated: remove if not authorized)
  → dedup filter (remove previously pitched handles)
  → return to agent (possibly empty, with reason code)
```

De-dup fires after anal filter. This is intentional: an anal-tagged handle in `pitchedHandlesLog` is fine to dedup against because it was pitched in a prior turn (which means it was authorized then). If the anal filter had NOT authorized it (e.g., it was pitched before the auth signals existed), the dedup's `priorHandles` set prevents it from surfacing again regardless.

### Interaction with ADR-003 Sub-decision B

`pitched_handles_log` is now written by the processor (per ADR-003 Sub-decision B), not by the agent. By the time `runDiscoveryTool` is called on TURN N, `ctx.conversation.pitchedHandlesLog` reflects all handles pitched through TURN N-1. TURN N's new pitch will be appended by the processor AFTER this turn completes. This means: the dedup correctly excludes prior-turn handles and does NOT prematurely exclude the handle about to be pitched this turn.

**One edge case:** if the agent makes multiple `searchProducts` hops within a single turn (up to 3 hops), `pitchedHandlesLog` does not update between hops. A handle pitched in hop 1's result will NOT be excluded in hop 2's result. This is acceptable — within a single turn, the agent is expected to pick one product and not re-pitch; the dedup prevents cross-turn repetition.

### `DiscoveryAgentToolContext` extension

Adding `pitchedHandlesLog` to `DiscoveryAgentToolContext` requires the caller in `conversation-agent.server.ts` to thread it through. `ctx.conversation.pitchedHandlesLog` is already available in `executeConversationAgent`. The `toolCtx` object constructed there must be extended:

```ts
const toolCtx: DiscoveryAgentToolContext = {
  phone: ctx.conversation.phone,
  channel,
  cardSink,
  toolUseId: block.id,
  pitchedHandlesLog: ctx.conversation.pitchedHandlesLog ?? null,  // ADD
}
```

This is a non-breaking additive change to the interface. The field is optional (`pitchedHandlesLog?: string[] | null`); callers that do not pass it treat it as `null` (no dedup, current behavior).

---

## Empathy Review

| Item | Required | What to review |
|---|---|---|
| Issue X — anal filter default-exclude | No — behavioral correctness | N/A |
| Issue X — `isAnalContextAuthorized` signals | No | N/A |
| Issue Y — dedup filter | No — behavioral correctness | N/A |
| Issue Y — `all_results_previously_pitched` agent reply | YES | Confirm the agent's generated reply for this reason code does not make the customer feel blamed or stuck. Run 2-3 example replies through the empathy reviewer before shipping. Acceptable: gentle redirect. Unacceptable: "I can't find anything," "catalog exhausted," or any language that implies the user has done something wrong. |

---

## Eval Coverage

The following golden fixtures must be authored and pass (score >= 3 on all dimensions) before the respective sub-decision merges.

| Fixture | Issue | What it guards |
|---|---|---|
| `036-anal-filter-on-general-vibrator.json` | X | User says "treating myself, first time, vibrator" — search must return zero anal-tagged results even if `vedo-bump-rechargeable-anal-vibe` is in the raw Sanity results |
| `037-anal-authorized-by-explicit-mention.json` | X | User says "I'm curious about anal plugs" — anal-tagged results ARE allowed; filter must not suppress them |
| `038-no-repeat-pitch-on-show-alternatives.json` | Y | User says "show me alternatives" after a prior pitch — the same handle must not appear in the new result set |
| `039-broaden-on-exhaustion.json` | Y | Simulated full `pitched_handles_log` — when all results are previously pitched, agent acknowledges without blaming the customer and proposes a broader angle |
| `040-anal-filter-and-dedup-compose.json` | X + Y | Full failure session replay: "treating myself + first time + vibrator" + "show me alternatives" — vedo-bump must not appear in turn 1 OR turn 2 |

Fixture 040 is the end-to-end regression test for the exact session that produced both failures.

---

## What Could Go Wrong

**Ranked by blast radius:**

1. **Anal filter over-fires on legitimate anal queries.** If `isAnalContextAuthorized` does not correctly detect the signal from the agent's query string, a user who explicitly asks "I want to try an anal toy" will get zero results and no acknowledgement of why. This is a trust failure of a different kind — the user asked for something and received nothing. Mitigation: the query-string check in `isAnalContextAuthorized` must match natural language variants (`butt`, `rear`, `backdoor`, `plug`, `prostate`, `anal`) not just the clinical term. Eval fixture 037 guards this directly.

2. **Dedup empties the result set legitimately on a small catalog.** If the vibrator catalog has only 2-3 products that match a given query and the user has been through all of them, the dedup correctly returns `all_results_previously_pitched`. But the agent's reply must be graceful, not a brick wall. If the empathy reviewer flags the reply as cold, the fix is in the `CONVERSATION_RULES_CORE` guidance for this reason code — not in loosening the dedup. The dedup must not be weakened as a fix for a UX problem.

3. **Handle-substring false positives in the anal filter.** A product named "Candle" contains no substring match. A product named "Anal-ogue" (hypothetical) would match. The real risk is a product whose handle happens to contain `plug` in a non-anal context (e.g., `outlet-plug-adapter`). The category field check acts as a second gate. However: if `isAnalTagged` returns true for a non-anal product, that product will be silently excluded on general queries. The customer would need to specifically ask for it. Given the catalog is sexual-wellness-specific, false positives on `anal`/`plug`/`prostate` are low probability — but `beads` is riskier (jewelry beads, etc.). Consider dropping `beads` from the handle-substring list and relying on the category field check for anal-bead products.

4. **`pitchedHandlesLog` grows unbounded and causes over-exclusion in long sessions.** The processor already caps the log at 10 entries (`slice(-10)` in `processor.server.ts:149`). The dedup uses the full log (up to 10 handles). If a user has been through 10 products in one session, the 11th search could return all previously-excluded results. This is correct behavior — 10-product sessions are unusual, and the cap prevents a fully exhausted catalog from never surfacing previously-shown products.

5. **Shopify fallback path does not carry `productTypeDial`.** The fallback in `searchForIvrWithDiagnostics` returns `IvrProductCard` objects built from `toIvrCard()` which reads `p.category` from the Shopify Product. If Shopify product category is not tagged as `anal` or `plug`, the handle-substring check is the only defense. This is a known limitation, not a new regression — it is the same risk that existed before this ADR.

---

## Verdict

**APPROVE WITH CONDITIONS.**

Both decisions are architecturally sound. The tool-wrapper layer is the correct enforcement point: it is deterministic (unlike agent-prompt rules), stateless with respect to the search module (unlike query-side exclusion), and composes cleanly with the existing `pitched_handles_log` primitives from ADR-003 Sub-decision B.

**Conditions before implementation begins:**

1. **`isAnalTagged` handle-substring list:** drop `beads` from the list. Use `['anal', 'plug', 'prostate']` as the substring set. Category field check covers anal-beads products tagged correctly in Sanity. `rr7-engineer` may restore `beads` if catalog analysis shows zero false-positive risk.

2. **`DiscoveryAgentToolContext` interface change is additive only.** `pitchedHandlesLog` must be typed `string[] | null | undefined` with `undefined` treated identically to `null` (no dedup). No existing callsite should need to change.

3. **Eval fixture 036 and 040 must be authored before the anal filter merges.** These are the primary regression guards for the exact failure observed. The filter must not merge without them passing.

4. **Empathy review for the `all_results_previously_pitched` agent reply must PASS before fixture 039 is finalized.** The fixture's expected reply shape depends on what the empathy reviewer approves. Do not finalize 039 before that review.

5. **`search_repeated_pitch` telemetry flag must be added to `StageResponse`** in `app/lib/sms-v2/types.server.ts` before the dedup merges. Logging without the flag means the failure mode is invisible in turn analytics.

6. **No changes to `ivr-search.server.ts` or `IvrSearchOpts`.** Both filters live in `discovery-agent-tools.server.ts`. The search module stays stateless.
