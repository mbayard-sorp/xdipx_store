# ADR-003: Emma Web Chat Trust Fixes (Phase 0.5)

**Date:** 2026-05-04
**Status:** Implemented by PR #100 (`dcb3707`, 2026-05-07)
**Owner:** tech-architect
**Implementation owner:** rr7-engineer
**Empathy review required:** Yes — sub-decisions B, C, F touch prompt strings or Emma-voice templates
**Phase gate dependency:** Phase 0 shipped. These fixes apply before Phase 1 begins.

---

## Implementation notes

This ADR was proposed 2026-05-04 and **implemented by PR #100** (`dcb3707 Emma v2: SMS engine cutover + cross-channel state, Phases 7–10`, squash-merged 2026-05-07).

Sub-decision landing points in current `main`:

- **Sub-decision A** (PDP URLs in multi-result prose) — `app/lib/sms-v2/stages/discovery.server.ts` line ~178 with the ADR-003 reference comment.
- **Sub-decision B** (page-context framing): `app/lib/sms-v2/conversation-agent.server.ts` lines 357–372, the `pageContextLine` construction with the empathy-reviewed flat framing.
- **Sub-decision C** (cold PDP visit threading): `app/lib/sms-v2/conversation-agent.server.ts` lines 631–638, `pageHandle ?? currentPitchHandle` fallback chain.
- **Sub-decision D** (COMMIT_PICK false positive): `app/lib/sms-v2/intent-classifier.server.ts` lines 106–110, negative-lookahead pattern.
- **Sub-decision E** (session bridge after navigation): `app/lib/sms-v2/adapters/web.server.ts` (371 lines), `localStorage` sessionId persistence in `AskEmmaWidget.tsx`, cookieId echo in `app/routes/api.ask-emma.tsx`.
- **Sub-decision F1** (welcome wall-of-text cap): `app/lib/ai-agent/prompt.ts` lines 122–139, 40-word cap and no safe-space preamble rules. F1 also ported into `conversation-agent.server.ts` line 117.
- **Sub-decision F2** (acknowledgement-before-products): `app/lib/ai-agent/prompt.ts` line 139, "When the disclosure is emotionally heavy..." rule. F2 also ported into `conversation-agent.server.ts` line 123.

Eval fixtures 031–040 (`evals/fixtures/`) are the regression guards for these decisions.

Document retained as a historical record of the trust-failure diagnosis and the sub-decision reasoning.

## Context

Phase 0 shipped Migration 032 (`conversation_summary`, `pitched_handles_log`) and the two-block system prompt. Real-user web chat testing against the Vercel preview surfaced six issues and one config anomaly that together constitute a trust failure before Phase 1 can proceed.

The transcript characteristics:
- Users saw a bare numbered list with no clickable URLs in the web widget when the `runSearchBranch` gate-machine path fired.
- Two sessions queried post-deploy showed `conversation_summary = NULL` and `pitched_handles_log = NULL` — Phase 0's core deliverable was not reaching them.
- A user on `/products/me-you-us-rosebud-...` received a generic welcome ("What brings you in today?") with no acknowledgement of the page they were on.
- The message "I want it to help me relax and give me an orgasm when I'm stressed" was classified `COMMIT_PICK` and routed to the wrong stage handler.
- A user clicked a product link in chat, navigated to the PDP, and returned to a blank conversation (new `session_id` row).
- A welcome turn produced 90+ words of safe-space framing before any question — the model ignored the 80-word soft hint in `CHAT_MODE`.

Additionally: `WEB_PIPELINE_VERSION` was set to empty string in the Vercel dashboard, which `web-pipeline-flag.server.ts:51` coerces to `'v1'` with a warn-once log — yet turn logs show `pipeline_version='v2-web'`, indicating sessions are reaching v2 through the `WEB_V2_SESSIONS` allowlist, not the global flag. This is a configuration inconsistency that needs investigation before Phase 1.

This ADR is Phase 0.5: fix the regressions and UX gaps before advancing.

---

## Decision

Seven sub-decisions ordered by customer-facing impact. Issues 1, 2, 3 are highest impact. Issue 5 is a frontend concern parallelizable with the others. Issues 4 and 6 are quality issues that compound if left unfixed.

---

### Sub-decision A: Add PDP URLs to `buildMultiResultProse` (Issue 1 — BUG, SURGICAL)

**File:** `app/lib/sms-v2/stages/discovery.server.ts:178`

The current template:
```ts
const lines = capped.map((c, i) => `${i + 1}. ${c.title} ($${c.price.toFixed(2)})`)
```

The card objects returned by `searchForIvrWithDiagnostics` include a `handle` field. The fix adds the URL:
```ts
const lines = capped.map((c, i) =>
  `${i + 1}. [${c.title}](/products/${c.handle}) — $${c.price.toFixed(2)}`
)
```

This is the web chat path only — `buildMultiResultProse` is called from `runSearchBranch` inside the gate-machine DISCOVERY branch. The unified Sonnet agent path (`executeConversationAgent`) generates URLs from tool results and is unaffected.

**Empathy review required:** No — this is a data format fix, not a prompt string change. However: confirm the card type exported by `searchForIvrWithDiagnostics` exposes `handle` before shipping. `rr7-engineer` must verify the type shape.

**Dependencies:** None. Can ship immediately.

---

### Sub-decision B: Move memory-primitive wiring to the stage dispatcher (Issue 2 — REGRESSION, ARCHITECTURAL)

**This is the most consequential issue. Phase 0's core deliverable is not firing on all paths.**

**Root cause:** `generateConversationSummary` and `pitchedHandlesLog` append are called from inside `executeConversationAgent` (the unified Sonnet path). The gate-machine path (`executeDiscoveryGate` → `runSearchBranch`) and any stage handler that does NOT go through `executeConversationAgent` never triggers the fire-and-forget summarizer and never appends the pitched handle. These callers return a `StageResponse` with `stateWrites` but the summarizer is not invoked.

**Coupling analysis — three options:**

Option (a) — Move fire-and-forget hooks UP into the stage dispatcher so every `applyStateWrites` call triggers them. This is architecturally cleanest and is the chosen approach.

Option (b) — Add the wiring explicitly INTO each branch handler. More duplication, higher risk of future omission as new branches are added.

Option (c) — Replace gate-machine and templated paths with the unified Sonnet agent. This is Phase 1 territory. Out of scope here.

**Decision: Option (a).**

**Where the dispatcher lives:** `app/lib/sms-v2/processor.server.ts`. The `processSmsMessageV2` and `processWebMessageV2` functions call stage handlers and then call `applyStateWrites`. The summarizer call must be placed AFTER `applyStateWrites` completes (so the DB row is stable), as a fire-and-forget.

**Concrete change:**

In `processor.server.ts`, after the `applyStateWrites` call (whichever code path ran the stage handler), add:

```ts
// Non-blocking: do not await before returning reply to caller.
// Phase 0 condition #1: summarizer must fire after applyStateWrites, never before.
void generateConversationSummary(history, ctx.conversation.conversationSummary ?? null)
  .then(summary =>
    applyStateWrites(ctx.conversation.phone, { conversationSummary: summary })
  )
  .catch(err => console.warn('[processor] summary update failed (non-fatal)', err))
```

The same location appends to `pitchedHandlesLog` when a `currentPitchHandle` is present in `stateWrites`.

**Critically:** this must happen in the web processor (`processWebMessageV2`) as well as the SMS processor. The `webConversations` table has `conversation_summary` and `pitched_handles_log` per ADR-001 feasibility note (Task 0.1 added them to both tables). Verify the columns are present before wiring.

**Empathy review required:** No — this is wiring change, not a prompt change. The `<known_about_customer>` block already passed empathy review as an ADR-001 condition.

**Dependencies:** None upstream. This is the foundation for Sub-decision C (page context). Sub-decision A does not depend on this.

---

### Sub-decision C: Thread `page_handle` and `page_route` into the system prompt (Issue 3 — FEATURE GAP)

**Files:** `app/routes/api.chat.tsx` (or wherever the web turn endpoint reads `page_handle`/`page_route` from the request), `app/lib/sms-v2/conversation-agent.server.ts` (`buildSystemBlocks`)

`web_conversations.page_handle` and `page_route` are captured. They are not currently passed into `buildSystemBlocks` or the `<known_about_customer>` block.

**Fix:** Pass `page_handle` and `page_route` as optional fields into `buildKnownAboutCustomer`. When non-null, add a line to the `<known_about_customer>` block:

```
Page context: customer is currently on /products/me-you-us-rosebud (PDP)
```

This is the minimum wire. The channel addendum (`CHANNEL_WEB`) does not need changes — the context flows through the dynamic Block 2 which is already fresh every turn.

**What this changes for the customer:** A user who opens the chat on a PDP sees a reply that acknowledges the product they're looking at instead of "What brings you in today?" This is the behavior the user explicitly tested and expected.

**Empathy review required:** Yes. The `<known_about_customer>` block is under empathy gate per ADR-001 binding condition #2. The new `Page context:` line must be reviewed for:
- Does it cause Emma to assume the customer wants that product? (It should not — it is context, not a commit signal.)
- Does it leak internal route strings to the customer? (It must not — only the product name or human-readable route label should appear, not raw handles.)

**Recommended page context line format for review:** `"Customer is viewing: [Product Name] — they may be interested in this or browsing alternatives."` with the product name resolved from `page_handle` via a short lookup.

**Dependencies:** Sub-decision B (memory wiring) should land first so the page context appears alongside a valid summary, not in a vacuum.

---

### Sub-decision D: Fix intent classifier false `COMMIT_PICK` on discovery signals (Issue 4 — BUG)

**File:** `app/lib/sms-v2/intent-classifier.server.ts:104-112`

The phrase `"I want it to help me relax and give me an orgasm when I'm stressed"` matched the `COMMIT_PICK` regex at lines 104-112:

```ts
{
  re: /^\s*(buy|order|checkout|sold|yes\s+please|yes\s+buy|i\s+want)\s*[!.]*\s*$/i,
  intent: 'COMMIT_PICK',
},
```

The pattern `i\s+want` at the end of that line matches a bare "I want" prefix at the START of the string (`^`) — but the actual message is 12 words long and passes through the regex as a non-anchor match because the `/i` flag applied to a `^\s*(...)` pattern does not anchor the end. Wait: the pattern IS anchored `^...\s*$` — so a 12-word sentence would NOT match. But there is a second regex at line 105:

```ts
re: /\b(i'?ll\s+take\s+it|let'?s\s+do\s+it|add\s+to\s+cart|buy\s+it|buy\s+now|place\s+order|order\s+now|check\s+out|get\s+it|send\s+it|i\s+want\s+it|i\s+want\s+that|i'?ll\s+get\s+it|i'?m\s+in)\b/i,
```

The phrase "I want it" (`i\s+want\s+it`) in `"...give me an orgasm when I'm stressed"` — checking the actual text: "I want it to help me relax" contains `i want it` at positions 0-8. The `\b` word-boundary pattern at line 105 fires on `i want it` even when followed by ` to help me relax`. That is the bug.

**Fix:** The `i\s+want\s+it` pattern in the phrase-based COMMIT_PICK regex needs a negative lookahead to exclude cases where "it" is followed by `\s+to\b` (use-case description, not a commit):

```ts
re: /\b(i'?ll\s+take\s+it|let'?s\s+do\s+it|add\s+to\s+cart|buy\s+it|buy\s+now|place\s+order|order\s+now|check\s+out|get\s+it|send\s+it|i\s+want\s+it(?!\s+to\b)|i\s+want\s+that|i'?ll\s+get\s+it|i'?m\s+in)\b/i,
```

This is a surgical one-token change. The negative lookahead `(?!\s+to\b)` prevents "I want it to..." from matching while preserving "I want it ♥", "I want it now", "I want it shipped", etc. as valid COMMIT_PICK signals.

**Empathy review required:** No — this is a regex correctness fix. It does not change any Emma-voice string. However: `rr7-engineer` must add a new eval fixture `031-commit-pick-false-positive-use-case.json` covering this exact message before the fix ships, so regression is caught if the pattern drifts again.

**Dependencies:** None. Parallelizable.

---

### Sub-decision E: Keep `AskEmmaWidget` session alive across navigation (Issue 5 — UX REGRESSION, FRONTEND)

**Current state:** `AskEmmaWidget` is mounted at the layout level in `app/routes/_layout.tsx:97` — `<AskEmmaWidget />` is inside the `StoreLayout` component. This is correct. In React Router v7 framework mode, the layout route persists across nested route transitions; `Outlet` updates but the layout shell (including the widget) does not unmount.

**Why the session was lost:** The issue is not an unmount. The widget reads `session_id` from a cookie via the chat API. When the user navigated to a new route, `useFetcher` was idle, `turns` state was in memory, localStorage was populated (the persist effect at line 134). The new `session_id` row was created on the server — implying the server-side session cookie was not sent or was not matched. Possible causes:

1. The chat API route reads `page_handle` / `page_route` from the request and creates a new `web_conversations` row if no matching session is found. If the session cookie was scoped to a specific path or domain variant in the preview deploy, the POST on the new PDP URL may have missed it.
2. The `STORAGE_KEY = 'xdipx:emma:state:v1'` hydration (line 72-79) restores `turns` from localStorage on mount — but if the widget had been hydrated before with a different session and localStorage was cleared or expired, the turns would repopulate without the server session alignment.

**Fix — two parts:**

Part 1 (server): In the chat API route handler, when looking up the existing `web_conversations` row by session cookie, ensure the lookup is by cookie value only and is not invalidated by `page_route` changing. The session must survive page navigation — `page_handle` and `page_route` should be UPDATED on an existing row, not used as lookup keys to create a new row.

Part 2 (client, defense-in-depth): The widget already persists `turns` to localStorage keyed by `STORAGE_KEY`. Add the `session_id` to the persisted payload:
```ts
localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, turns: sanitized, sessionId }))
```
On hydration, read back `sessionId` and pass it as an `X-Emma-Session` header or query param on the first POST. This lets the server align the cookie session even if the cookie itself was lost during navigation in the preview environment.

**Layout mount confirmed clean:** `_layout.tsx:97` places `<AskEmmaWidget />` outside `<main>` and outside `<Outlet>`. In RR7, `StoreLayout` persists across all nested routes. The widget does NOT unmount on navigation. The fix is server-side session lookup + localStorage `sessionId` carry.

**Oxygen-seam impact:** None. `_layout.tsx` is RR7-side and does not import any Vercel-specific code. The widget uses `useFetcher` to hit the chat API route — standard RR7 pattern.

**Empathy review required:** No — no Emma-voice strings are changed.

**Dependencies:** Can be developed in parallel with Sub-decisions B and C. Should ship before or with Sub-decision C since page context is only useful when the session is stable.

---

### Sub-decision F: Tighten the welcome turn and the post-signal reply (Issue 6 — PROMPT QUALITY)

**Two distinct prompt quality problems:**

**Problem F1 — Wall-of-text welcome (90+ words vs. the 80-word target):**
`CHAT_MODE` says "Aim for under 80 words" — a soft hint that Sonnet ignores stochastically. The fix is to make it a hard constraint with a structural rule, not a guideline:

Change the current `CHAT_MODE` guidance from:
> "Keep each reply short — 1–3 sentences, occasionally a short second paragraph. Aim for under 80 words."

To:
> "Keep each reply short. Welcome turns: one warm line + one question. Max 40 words on first contact. Subsequent turns: 50–100 words. Never open with a preamble about what a safe or judgment-free space this is — that's the brand's posture, not something Emma announces."

The "never open with safe-space framing" rule is the specific fix for the 90-word welcome. The framing Emma produced was a standard LLM over-explanation of its own safety posture. Making it an explicit prohibition removes the stochastic variation.

**Problem F2 — Template-dumping on clear signal without URLs:**
When the user disclosed "I want it to help me relax and give me an orgasm when I'm stressed", the gate-machine fired `buildMultiResultProse` (fixed in Sub-decision A) with no URLs. But even with URLs, the bare list is not the right response to a clear use-case disclosure. The correct response is: validate the feeling, offer 1-2 picks by name with one follow-up. This is a prompt behavior issue for the unified Sonnet agent path, not just the gate-machine template.

Add to `CHAT_MODE` under GATE-AWARE DISCOVERY:
> "When the customer discloses a feeling, use-case, or scenario (not just a product category), lead your reply with a one-sentence acknowledgement of what they described before showing products. Never open with a bare product list. One warm beat, then the pick."

**Empathy review required:** Yes — both changes modify `CHAT_MODE` which is an Emma-voice prompt string. The empathy reviewer must check:
- The "max 40 words on first contact" rule doesn't make the welcome feel abrupt or dismissive.
- The "one warm beat" instruction doesn't produce a formula ("I hear you — here's the product") that sounds canned.
- The "never open with safe-space framing" prohibition doesn't accidentally suppress genuinely needed safety language in edge cases (e.g., trauma disclosure). The prohibition must be scoped to the welcome turn, not globally.

**Dependencies:** Sub-decision D (intent classifier fix) must land first so that when F2's "one warm beat" guidance fires for use-case disclosures, the intent is correctly classified as DISCOVERY/NAME_ITEM and routed to the right handler.

---

### Config investigation: `WEB_PIPELINE_VERSION` routing inconsistency

This is not a code fix — it is an operational verification task before Phase 1.

`web-pipeline-flag.server.ts:51` coerces an empty string to `'v1'` with a warn-once log. But turns show `pipeline_version='v2-web'`. This means sessions are reaching v2 via the `WEB_V2_SESSIONS` allowlist (`web-pipeline-flag.server.ts:65`), not the global flag. This is the correct precedence behavior — the allowlist IS working. But:

1. Verify `WEB_V2_SESSIONS` contains the test session IDs in the Vercel preview env.
2. Set `WEB_PIPELINE_VERSION=v2` explicitly in the preview env (not empty string) to confirm the flag is correctly wired before Phase 1 flips it globally.
3. Confirm the warn-once log appeared in Vercel function logs during the affected sessions — if it did not, the empty string may not have reached `readGlobalVersion` (e.g., if `WEB_PIPELINE_VERSION` was literally unset, not empty, and `.trim()` of `undefined` would throw without the `?? 'v1'` guard). Review the guard at line 50: `const raw = (process.env['WEB_PIPELINE_VERSION'] ?? 'v1').trim()` — this is safe. An unset env var returns `'v1'` before `.trim()`.

Owner: `rr7-engineer` verifies in Vercel dashboard. No code change needed unless the guard is found to be insufficient.

---

## Consequences

### What gets better
- Web widget product lists are tappable (Sub-decision A). Immediate UX win.
- Phase 0's memory primitives fire on ALL paths, not just the Sonnet agent path. `conversation_summary` and `pitched_handles_log` populate for all customers (Sub-decision B).
- Customers on a PDP get a reply that acknowledges the product they're looking at (Sub-decision C).
- A common use-case disclosure ("I want it to relax me") routes correctly to DISCOVERY, not prematurely to COMMIT/CHECKOUT (Sub-decision D).
- Chat session survives product page navigation (Sub-decision E).
- Welcome turns stop over-explaining and use-case disclosures get a warm beat before the product list (Sub-decision F).

### Costs
- Sub-decision B (dispatcher wiring) slightly increases DB write volume per turn — a second `applyStateWrites` call for the summary. At current volume this is negligible. At scale this is one of the writes that should be batched in Phase 1 cleanup.
- Sub-decision C (page context) adds ~20 tokens to Block 2 per turn on PDPs. Negligible cost.
- Sub-decision F (prompt tightening) changes `CHAT_MODE`. Any prompt change has a regression risk that must be covered by the eval harness before shipping.
- Sub-decision E (session fix, Part 2) adds `sessionId` to the localStorage payload — a small privacy-surface addition. The `sessionId` is already in the cookie; persisting it to localStorage does not introduce new exposure but should be noted in the cookie consent audit.

---

## Alternatives Considered

### Issue 1 — URL format
Alternative: pass the full absolute URL (`https://xdipx.com/products/{handle}`). Rejected for web chat — relative `/products/{handle}` is consistent with the `CHAT_MODE` rule ("PDP links of the form /products/handle are allowed and encouraged") and avoids hardcoding the domain. The web widget renders the link in the same origin.

### Issue 2 — Memory wiring location
Option (b): add wiring into each branch handler explicitly. Rejected — the codebase already has `executeDiscoveryGate`, `runSearchBranch`, `runNarrowBranch`, and potentially others. Adding the fire-and-forget to each is duplication that will regress when a new branch is added without it. The dispatcher is the single chokepoint.

Option (c): replace gate-machine with unified Sonnet agent now. This is Phase 1 work. ADR-002 is the right home for it. Pulling it into Phase 0.5 expands scope in a way that delays the trust fixes.

### Issue 3 — Page context depth
Alternative: inject the full product `tagline` or `full_story` into the context block, not just the page handle. Rejected for Phase 0.5 — that requires an additional Shopify or DB lookup per turn and adds latency. The handle + product name is sufficient to make Emma aware. Richer product context can be injected lazily in Phase 1 if needed.

### Issue 5 — Widget persistence
Alternative: force a client-side reload to resync session. Rejected — a reload destroys turns and was the failure the user experienced. The fix must preserve turns in memory and align the server session, not restart it.

Alternative: move the widget outside the RR7 router entirely (a portal to `document.body`). Not needed — the current mount at `_layout.tsx:97` already persists across navigation. The issue is server-side session lookup, not mount behavior.

### Issue 6 — Hard token cap
Alternative: add `max_tokens` override per turn type in `CHANNEL_WEB` to enforce the word limit mechanically. Rejected — `max_tokens` caps the output but doesn't prevent a wall-of-text from appearing early in a long token budget. The explicit prohibition in the prompt is more targeted. If the wall-of-text persists after the prompt change, a lower `maxTokens` for the web welcome turn can be added as a follow-up.

---

## Coupling Analysis

Sub-decision B is the deepest concern. The summarizer/pitched-handles wiring currently lives inside `executeConversationAgent`. Moving it UP to the processor requires:

1. The processor must have access to `history` (the loaded turn list) at the point after `applyStateWrites` completes, to pass to `generateConversationSummary`. Currently `history` is loaded inside `executeConversationAgent`. If the gate-machine path runs instead, history was never loaded in the processor scope.
   - Fix: load history in the processor BEFORE dispatching to the stage handler, and pass it down. OR: load it lazily inside the summarizer call (a second history load). The first approach is architecturally cleaner and the history is useful context for the dispatcher anyway.

2. The web processor (`processWebMessageV2`) likely has a different code path than the SMS processor. Both need the summarizer wired. Verify they share a common dispatch layer or add the wiring to both separately.

3. `generateConversationSummary` currently imports from `summary.server.ts` which is imported inside `conversation-agent.server.ts`. Moving the call to the processor means the processor imports `summary.server.ts` directly — this is a new import but not a seam violation (it ends in `.server.ts`).

---

## Migration Notes

No new DB migrations are required. Migration 032 already added `conversation_summary` and `pitched_handles_log` to both `sms_conversations` and `web_conversations` (per ADR-001 feasibility Task 0.1 and `rr7-engineer`'s note at Gotcha #2: "Mirror to `web_conversations` with the same ALTER (or add a TODO comment if intentionally deferred)"). Verify both columns exist in production before wiring the web processor.

If the columns were NOT added to `web_conversations` in Migration 032, a follow-up `033_web_conversation_memory.sql` is needed:
```sql
ALTER TABLE web_conversations
  ADD COLUMN IF NOT EXISTS conversation_summary  text,
  ADD COLUMN IF NOT EXISTS pitched_handles_log   text[];
```
Applied via: `npx tsx scripts/apply-migrations.ts --from 033`

---

## Oxygen-Seam Impact

Sub-decision E (widget persistence) touches `app/routes/_layout.tsx` (layout mount, confirmed clean) and `app/components/store/AskEmmaWidget.tsx` (localStorage/session carry). Neither file imports `@vercel/kv` or `server/index.ts`. Both are RR7-side. No Oxygen-seam violation.

Sub-decisions B and C touch `app/lib/sms-v2/processor.server.ts` and `app/lib/sms-v2/conversation-agent.server.ts` — both are `.server.ts` files within `app/lib/`. No Shopify API calls are added or modified. The `shopify.server.ts` seam is unaffected.

Sub-decision F touches `app/lib/ai-agent/prompt.ts` (or `voice.ts` after Phase 1). Phase 0.5 ships the change to `prompt.ts` since `voice.ts` does not exist yet. When Phase 1 creates `voice.ts`, the Phase 0.5 changes must be ported. `rr7-engineer` should note this in the Phase 1 task breakdown as a one-liner: "carry Phase 0.5 CHAT_MODE changes from `prompt.ts` into `CHANNEL_ADDENDA.web` in `voice.ts`."

---

## Sequencing and Effort Estimate

These six sub-decisions are not fully serial. Recommended execution order:

| Order | Sub-decision | Effort | Parallelizable with |
|---|---|---|---|
| 1 | A — URL fix in `buildMultiResultProse` | 1 hour | Any |
| 1 | D — Intent classifier negative lookahead | 1 hour | A |
| 2 | B — Memory wiring to dispatcher | 1 day | E |
| 2 | E — Widget session persistence | 0.5 day | B |
| 3 | C — Page context in system prompt | 0.5 day | After B |
| 4 | F — Prompt tightening (empathy gate) | 0.5 day + review | After D, after eval baseline |
| — | Config — verify `WEB_PIPELINE_VERSION` | 30 min | Any |

Total: ~3 engineer-days plus the empathy review turnaround for Sub-decision F.

Sub-decisions A and D can be merged in a single PR (no empathy review required). Sub-decisions B and E can be developed in parallel and merged together (session fix without memory wiring is incomplete). Sub-decision C requires B to be live. Sub-decision F requires D and an empathy review; it is the last to merge.

---

## Empathy Review Required

| Sub-decision | What to review |
|---|---|
| C — page context | The `Page context:` line in `<known_about_customer>`. Confirm it does not cause Emma to assume purchase intent from page presence alone. Confirm it does not leak internal handle strings. |
| F — prompt tightening | The "max 40 words on first contact" rule, the "never open with safe-space framing" prohibition, and the "one warm beat before products" rule. Check: abruptness, canned-ness, and whether the safety-framing prohibition has a carve-out for genuine trauma disclosure moments. |

Both empathy reviews must PASS before the respective sub-decision merges.

---

## Eval Coverage

The following golden fixtures should be added to `evals/fixtures/` as part of this phase:

| Fixture | Issue | What it guards |
|---|---|---|
| `031-commit-pick-false-positive-use-case.json` | D | "I want it to help me relax and give me an orgasm when I'm stressed" classifies as NAME_ITEM or DISCOVERY, not COMMIT_PICK |
| `032-page-context-pdp-aware-welcome.json` | C | User on PDP gets a reply that acknowledges the product, not a generic "what brings you in" |
| `033-no-url-in-multi-result-list.json` | A | Regression: multi-result prose contains PDP URLs |
| `034-session-bridge-after-navigation.json` | E | After navigation, the conversation summary is still populated and Emma references prior context |
| `035-welcome-wall-of-text.json` | F | Welcome turn is under 50 words, no safe-space preamble |

These five fixtures must be authored and pass (score >= 3 on all dimensions) before the respective sub-decision merges.

---

## Open Questions

**OQ1 — Was Migration 032 applied to `web_conversations` as well as `sms_conversations`?**
The ADR-001 feasibility doc (Task 0.1) says to add to both tables "or add a TODO comment if intentionally deferred." Before Sub-decision B is wired, `rr7-engineer` must run `\d web_conversations` against the production DB and confirm. If the columns are absent, Migration 033 must ship before B.

**OQ2 — Does `processWebMessageV2` exist as a distinct function, or does it share a processor with SMS?**
If there is a single `processSmsMessageV2` that handles both SMS and web by checking a `channel` field, Sub-decision B's wiring point is unambiguous. If web has its own processor, both code paths need the wiring. `rr7-engineer` must confirm before beginning B.

**OQ3 — What card fields does `searchForIvrWithDiagnostics` expose?**
Sub-decision A assumes the returned card objects include a `handle` field. `rr7-engineer` must verify the type of `Awaited<ReturnType<typeof searchForIvrWithDiagnostics>>['cards'][number]` before shipping A. If `handle` is absent, the fix must go through the `IvrProductCard` type to add it first.

**OQ4 — Is the welcome wall-of-text reproducible with the current `CHAT_MODE` prompt in isolation, or does it only occur when `<known_about_customer>` is empty?**
If the issue only occurs on the first turn (empty summary, no slots), the fix may need to be conditional: "when `<known_about_customer>` is absent, keep welcome under 40 words." `rr7-engineer` should reproduce the exact prompt conditions (empty Block 2) before authoring the fixture.

---

## Verdict

**APPROVE WITH CONDITIONS.**

All six sub-decisions are architecturally sound. Sub-decisions A and D are trivially safe and should ship immediately. Sub-decisions B and E are the most consequential and carry the highest regression risk — B must be verified against OQ1 and OQ2, E must be verified against the server-side session lookup behavior.

**Conditions before implementation begins:**

1. **OQ1 resolved first.** `rr7-engineer` confirms `web_conversations` has the memory columns. If not, Migration 033 ships before any other Phase 0.5 work.

2. **OQ3 resolved before Sub-decision A ships.** Confirm `handle` field presence on the card type. One-line type check; no ambiguity.

3. **Sub-decision B fires AFTER `applyStateWrites` returns, never before.** The call site must carry the comment: `// Non-blocking: do not await before returning reply to caller. Phase 0 condition #1.` Code reviewer must verify this is not inside the turn-reply path.

4. **Sub-decision F requires empathy PASS before merge.** No prompt string in `CHAT_MODE` ships without an empathy gate. If the reviewer returns REVISE, the change does not merge until the revision passes.

5. **Eval fixture 031 (intent classifier regression) ships in the same PR as Sub-decision D.** The negative lookahead is not a standalone fix without a test that will catch it regressing.

6. **Config investigation (WEB_PIPELINE_VERSION) completed before Phase 1 scope is opened.** Phase 1 flips `WEB_PIPELINE_VERSION` globally. If the current routing inconsistency is not understood, Phase 1's global flag flip may produce unexpected behavior.
