# ADR-011: Voice Pipeline v1-to-v2 Convergence

**Date:** 2026-08-10
**Status:** Proposed (owner decision recorded 2026-08-01)
**Owner:** tech-architect
**Implementation owners:** ivr-ops (Fly side, flag flip), rr7-engineer (Vercel v2 engine)
**Empathy review required:** No new customer-facing strings are introduced by this ADR. The v2 voice prompt already ships through `emma-empathy-reviewer` under the ADR-002 unification. Any prompt edit made during the soak still routes through the voice gate.
**Gate dependency:** A one-week soak on v2 telemetry (defined below) before the global flip; two weeks green plus a fallback rate under 1% before v1 retirement.

---

## Context

### The current split, stated from the code

IVR voice runs two engines behind a single runtime switch:

- **v1, the default.** `pickIvrPipelineVersion()` in `ivr/src/server.ts:39` reads `IVR_PIPELINE_VERSION` and defaults to `'v1'` (`ivr/src/server.ts:41`). v1 is the Fly-local Claude loop in `ivr/src/claude.ts`: model `claude-haiku-4-5-20251001` (`ivr/src/claude.ts:20`), its own tool loop capped at `MAX_TOOL_HOPS = 20` (`ivr/src/claude.ts:32`). It runs entirely on the Fly machine, no network hop to Vercel.
- **v2, opt-in.** When the caller's phone is in `IVR_V2_PHONES` (`ivr/src/server.ts:37,40`) or `IVR_PIPELINE_VERSION=v2`, `handlePromptV2` (`ivr/src/server.ts`) calls the Vercel v2 engine over HTTP through `callEngineV2` (`ivr/src/v2-bridge.ts`) to `POST /api/emma-engine/turn` (`app/routes/api.emma-engine.turn.tsx`). That endpoint runs the shared v2 conversation stage machine (`app/lib/sms-v2/adapters/voice.server.ts`, then `conversation-agent.server.ts`), the same brain SMS and web chat use, and writes the turn to `sms_turns` with `channel='voice'` (`app/lib/sms-v2/adapters/voice.server.ts:14,529`).

So today the prompt is unified (ADR-002 landed that: one canonical voice prompt, no Fly/Vercel drift) but the **runtime is not**. The default caller still gets the Haiku loop, which never sees the v2 stage machine, the cross-channel memory, or the shared search and promise set. ADR-002 anticipated this exact step and named it a "Phase 10 / operations decision": flip the default. That flip has not happened, and this ADR is the decision to finish it.

### Why converge

One brain, one search, one promise set, across every channel a customer can reach Emma on. Concretely:

- **Memory and cross-channel context.** v2 builds context with `buildEmmaContextWithCrossChannel(conversation, 'voice')` (`app/lib/sms-v2/adapters/voice.server.ts:715`), so a caller who texted earlier is recognized on the phone. v1 has no path to that.
- **Single prompt, single set of rules.** The v1 Haiku loop and the v2 stage machine are separately tuned surfaces. Every voice-behavior fix has to be made, or forgotten, twice. Convergence deletes the second copy.
- **Telemetry parity.** v2 voice turns land in `sms_turns` alongside SMS and web, so quality and funnel analysis is one query. v1 turns do not.

### The one hard constraint: latency

An LLM turn is slow, and the caller hears every millisecond of it as silence. This is the crux, and the ticket that prompted this ADR framed it with numbers that are now out of date. Stating the real budget from the code and the measurements:

- `v2-bridge.ts` originally carried a `500ms` p99 target and a `5s` hard timeout. Both were wrong for an LLM engine and both have already been corrected on `main`. The p99 warn is now `IVR_V2_P99_TARGET_MS`, default `3000` (`ivr/src/v2-bridge.ts:30`), and the hard timeout is `IVR_V2_TIMEOUT_MS`, default `12000` (`ivr/src/v2-bridge.ts:41`), with a total two-attempt budget `IVR_V2_TOTAL_BUDGET_MS`, default `16000` (`ivr/src/v2-bridge.ts:46`).
- The correction was driven by data, not guesswork. The v2 engine runs a Sonnet tool loop (classify, search, compose) that **measured at a 3.8s mean and a 10.6s worst case across 177 logged voice turns** (`ivr/src/v2-bridge.ts:26-29`). The old 5s hard timeout sat below that: 53 of those 177 turns (30%) ran longer than 5s and were aborted at the bridge even though the Vercel side went on to answer, commit its state writes, and log the turn. The caller heard a v1 answer while the v2 conversation silently advanced a stage. The two engines desynced and the call fell apart (`ivr/src/v2-bridge.ts:34-40`).

So the real per-turn budget is defined and already in the tree: warn at 3s, hard-stop at 12s, both attempts capped at 16s. What remains is not choosing the budget. It is deciding whether a 3.8s-mean voice turn is acceptable UX at all, and if so, flipping the default and retiring v1.

---

## Decision

Converge on v2 as the sole voice engine, in four stages, gated on measured telemetry. Do not hard-cut. v1 stays deployed and reachable as the fallback until the retirement criteria are met.

### Stage A: Canary (owner phone in the allowlist)

Put the owner's phone number(s) into `IVR_V2_PHONES` in the Fly environment. No code change; `pickIvrPipelineVersion` already honors the allowlist (`ivr/src/server.ts:40`). Place real calls: confirm intent handling, SSML playback, outbound SMS for PDP and checkout links, and the cross-channel recognition. This is the cheapest way to feel the 3.8s-mean latency as a human before any real caller does.

### Stage B: One-week soak on telemetry

With the canary passing, watch for one week before touching the global default. The signals, all already recorded:

- **Voice-turn health in `sms_turns` where `channel='voice'`** (`app/lib/sms-v2/adapters/voice.server.ts:529`): error rate, tool-budget exhaustion, and turn latency distribution. The turn logger (`app/lib/sms-v2/turn-logger.server.ts`) is the source.
- **v2-bridge latency and fallback rate** from the bridge logs (`ivr/src/v2-bridge.ts`): how often `callEngineV2` returns null and the call falls through to v1, and the p99 the bridge observes against its 3s warn line.

The soak is a week, not 24 hours, because IVR call volume is low enough that a day is not a sample. Slow regressions (a failure mode that only shows on long calls or a specific intent) need the longer window.

### Stage C: Global flip

Set `IVR_PIPELINE_VERSION=v2` in the Fly environment (production). This makes v2 the default for every caller. Rollback stays a one-variable change (Stage's rollback section below). Keep watching the same Stage B signals.

### Stage D: v1 retirement

Only after the retirement criteria (below) are met: delete the v1 Fly loop (`ivr/src/claude.ts`) and its now-dead branch in `ivr/src/server.ts` (`handlePromptV1` and the `pickIvrPipelineVersion` fork), in a dedicated PR. Note the coupling: once v1 is gone, `callEngineV2` returning null can no longer "fall through to v1", so the fallback contract in `v2-bridge.ts` and `server.ts` changes to "ask the caller to repeat". That behavior already exists for mid-call nulls (`ivr/src/v2-bridge.ts:65-73`); retirement extends it to the first turn. Do not delete v1 before that fallback is the only path left, and do not delete it in the same PR as the flip.

### The latency budget, settled

The per-turn budget is: **warn at 3s (`IVR_V2_P99_TARGET_MS`), hard-stop one attempt at 12s (`IVR_V2_TIMEOUT_MS`), cap both attempts at 16s (`IVR_V2_TOTAL_BUDGET_MS`)**, sized above the measured 10.6s worst case so a genuine v2 answer is never aborted into a desync. These are env-overridable, so the soak can tune them without a deploy. The 5s and 500ms figures from the originating ticket are historical and should not be reintroduced.

---

## Rollback

Every stage rolls back with one environment variable and no code change, for as long as v1 is deployed (through Stage C):

- **Canary (Stage A):** remove the phone from `IVR_V2_PHONES`.
- **Global flip (Stage C):** set `IVR_PIPELINE_VERSION=v1` (or unset it; the default is v1 per `ivr/src/server.ts:41`) and redeploy the Fly app. Minutes, not a code change.

After Stage D deletes v1, rollback becomes `git revert` of the deletion commit plus a Fly deploy. That is the reason Stage D is gated hard and kept separate from the flip.

### v1 retirement criteria

All three, measured, before Stage D:

1. Two consecutive weeks on `IVR_PIPELINE_VERSION=v2` with no voice-quality regression in the `sms_turns` `channel='voice'` telemetry.
2. v2-bridge fallback rate under 1% of voice turns (null-return from `callEngineV2`).
3. Owner sign-off after a set of live confirmation calls.

---

## Consequences

### What gets better

- One voice brain. Every future voice fix is made once, in the v2 stage machine, and reaches callers, SMS, and web at the same time.
- Callers get cross-channel memory, the shared search, and the shared promise set on the phone for the first time.
- Voice quality becomes measurable in the same `sms_turns` surface as every other channel.
- The Fly codebase shrinks at Stage D: `ivr/src/claude.ts` and the v1 branch in `server.ts` become deletable.

### Costs and risks

- **Latency is the customer-facing cost.** A 3.8s-mean turn means a real pause after the caller stops talking. The 12s hard timeout is a ceiling, not a typical, but the tail is audible. Stage A exists to feel this before real callers do, and the soak exists to quantify it. If the mean is unacceptable, the answer is engine-side latency work (warm the Vercel function, tighten the tool loop), not a shorter timeout that reintroduces the desync.
- **Cold-start pause on inbound calls.** The v2 path adds a Vercel round-trip; a cold function can add seconds on the first turn of the day. Mitigation is a warm-ping from Fly during business hours (an ivr-ops task), and the bridge's single 5xx retry already absorbs a transient cold start.
- **Desync is the failure mode to avoid, and it is now guarded.** The 5s-timeout desync is exactly what the 12s value fixes. Do not lower `IVR_V2_TIMEOUT_MS` below the measured worst case while v1 is still a first-turn fallback.

---

## Alternatives Considered

- **Hard cutover, delete v1 immediately.** Rejected. Voice is customer-facing, and v1 is the only fallback for a v2 outage or a cold-start spike. The staged soak with a one-variable rollback is the safe path.
- **Keep both engines indefinitely behind the flag.** Rejected as the end state, though it is the current state. Two voice brains is the maintenance cost convergence exists to remove. The flag is a soak tool, not a destination.
- **Lower the hard timeout to protect against long turns.** Rejected, and specifically warned against. The data shows a 5s timeout aborts 30% of genuine answers into a desync. The timeout must sit above the measured worst case; latency is fixed engine-side, not by cutting off correct answers.

---

## Open questions for the owner

1. **Is a 3.8s-mean voice turn acceptable UX for the storefront's callers?** This is the one question the data cannot answer on its own. Stage A is designed to put it in front of the owner as a felt experience before any commitment.
2. **Warm-ping ownership.** Preventing cold-start pauses during business hours is an ivr-ops task; confirm it should be scheduled alongside the flip rather than deferred.
3. **Soak length.** This ADR sets one week before the flip and two weeks green before retirement. Confirm, or set a different window if call volume warrants a longer sample.

---

## Oxygen-seam impact

None. The v2 voice path already flows Twilio to Fly WebSocket to Vercel `POST /api/emma-engine/turn` to `app/lib/sms-v2/adapters/voice.server.ts`, all inside `app/lib/sms-v2/`, which is the correct RR-side location. This ADR flips a runtime flag and, at Stage D, deletes Fly-local code. It introduces no new import of `@vercel/kv` or `server/` into `app/`, and no new Shopify coupling. The single Shopify seam (`app/lib/shopify.server.ts`) is untouched.

---

## Verdict

**APPROVE THE CONVERGENCE, GATE THE FLIP.**

The unification work is done; the remaining decision is operational. The latency budget is already defined and correct in the code (3s warn, 12s hard, 16s total), sized from 177 measured turns, so the technical blocker the originating ticket raised is resolved. What is left is a staged flip with a one-variable rollback and a measured retirement bar. Proceed to Stage A once the owner accepts the latency reality of an LLM voice turn.
