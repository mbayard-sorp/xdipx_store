# IVR Call Failure Diagnostic — 2026-08-03

**Trigger:** owner placed a live call and reported four symptoms in order: Emma
assumed a $10 spending ceiling, then couldn't complete the search, then
"sounded like it defaulted to a collection search", then failed.

**Call:** `CA6e09379592fe1cc854c669be1917a5a0`, 2026-08-03 03:59:03–04:00:43 UTC,
100s, `end_reason=user_hangup`, `tokens_total=29844`.

This is a follow-up to `conversation-surfaces-diagnostic-2026-07.md`. Every
finding below is reproduced from `sms_turns`, `sms_conversations`, `call_log`
and `api_token_log`, not inferred from reading code.

---

## 1. The transcript

Seven turns, all `channel='voice'`, `pipeline_version='v2-voice'`.

| # | Caller | Emma | Latency |
|---|---|---|---|
| 1 | "oh" | "Hey, glad you're back. What are you looking for today?" | 1131ms |
| 2 | "I'm shopping for a new vibrator." | "Solo use, or for play with a partner?" | 1780ms |
| 3 | "For play with a partner." | "Her pleasure, his, or something you both feel?" | 2856ms |
| 4 | "Something we both feel together." | "A couples toy. What intensity?" | 4132ms |
| 5 | "During sex." | **"Those results are all above your ten dollar budget…"** | **7585ms** |
| 6 | "Powerful and intense." | "That combo is tough to find at under ten dollars." | 2413ms |
| 7 | "Cheri is no ceiling." | Pitched We-Vibe Chorus Pro, spoken as "$155.99" | **6622ms** |

The caller never mentioned money on this call.

## 2. Where the $10 came from

The `sms_conversations` row for the caller's number held:

```json
"discovered_slots": {
  "priceMax": 10, "subtype": "plug", "category": "vibrator",
  "audience": "for-her", "experience": "first-time",
  "matters": ["powerful"], "isAdviceRequest": true
}
```

Two compounding defects:

**2a. `discoveredSlots` never cleared between sessions.**
`getOrCreateConversation` rotates the conversation UUID and resets the stage
on a 24h gap, but left `discoveredSlots`, `discoveryState`,
`pitchedHandlesLog`, `currentPitchHandle` and `pendingPdpUrl` untouched. The
row is keyed by phone number, so a slot captured in an earlier session steers
every future conversation forever. `priceMax=10` was months old.

**2b. `extractPriceMax` treated any bare 2–3 digit number as a budget.**
The pattern `(?:under|less\s+than\s*)?\$?(\d{2,3})\b` made both the budget cue
and the `$` optional. Measured against realistic phone ASR:

| Utterance | Extracted budget |
|---|---|
| "my order number is 10 4 2" | $10 |
| "i have 10 minutes" | $10 |
| "the 10 inch one" | $10 |
| "we have been together 10 years" | $10 |
| "i am 45 and new to this" | $45 |
| "my zip is 85142" | $142 |

`priceMax=10` entered the row from an utterance that had nothing to do with
price, then never left.

**2c. Slots contradicted each other.** `category='vibrator'` sat alongside
`subtype='plug'`. That pair reaches search as `productTypeDial=vibrator` +
`productSubtypeDial=plug`, which matches nothing in the catalog. `mergeSlots`
overwrote `category` without invalidating the category-scoped `subtype`, and
the agent path used a plain object spread that didn't even go through
`mergeSlots`. This is the "couldn't complete my search".

## 3. Where the collection search came from

`ivr/src/v2-bridge.ts` aborted any turn that exceeded `HARD_TIMEOUT_MS = 5000`
and fell through to the v1 local Haiku agent. Measured across every logged
voice turn:

```
all v2-voice turns: 177   over 5s: 53   (30%)
2026-08-03: 7 turns, 2 over 5s, max 7585ms
2026-07-31: 11 turns, 4 over 5s, max 7978ms
```

Turns 5 and 7 of this call both blew the budget. On timeout the Fly server ran
`handlePromptV1`, which is a **different brain**: different system prompt,
different memory, and a tool set that includes `findCollection` and
`listCollections` — tools the v2 agent deliberately does not expose. That is
the caller hearing a collection readout mid-search.

Worse, the abort is client-side only. Vercel kept executing, answered, wrote
its state (turns 5 and 7 are in `sms_turns`; turn 7 advanced the row to
`PRESENTATION` and set `pendingPdpUrl`) and logged the turn — all for a reply
the caller never heard. The two engines desynced. That is the "then it failed".

Corroboration: `call_log.tokens_total = 29844` for this call, but every
`api_token_log` row in the window is `feature='sms'`. The v1 spend is real and
completely unlogged (see §5).

## 4. Why nobody caught it

`sms_turns` telemetry coverage:

```
voice     turns=177  tool_calls=0  errors=0  metadata=0
non-voice turns=640  tool_calls=310
```

`logVoiceTurn` accepted only tokens and latency and dropped `toolCalls`,
`fabricationCaught`, `softBeat`, `toolBudgetExhausted`, `searchRepeatedPitch`
and `gateAdvance` on the floor. ADR-002 names ">5s latency outliers" as a
Stage C monitoring signal; it was firing on 30% of turns with nothing watching.

The voice adapter also never persisted `pitchedHandlesLog` or
`conversationSummary`, so the search tool's re-pitch dedup never accumulated on
a call.

## 5. Secondary findings

- **v1 token spend is invisible.** `api_token_log` has **zero** rows with
  `feature='ivr'`, while `call_log.tokens_total` shows 17k–78k tokens per call.
  `logIvrTokens` returns silently when `DATABASE_URL` is unset on the Fly
  machine.
- **Summary bridge compounds.** The live row's `conversation_summary` began
  with `"From a previous conversation: "` **six times** — `getOrCreateConversation`
  re-prefixed an already-prefixed summary on every rotation.
- **Prices spoken as digits.** The v2 voice path passed `"$155.99"` straight to
  ElevenLabs and never called `normalizeForTTS`. The v1 channel rules have
  always required prices as words; v2 never enforced it.
- **Internal flags leaked into the prompt.** `isAdviceRequest=true` was
  serialized into Emma's `<known_about_customer>` block. It is OR-accumulated,
  so once set it never clears within a session.

---

## 6. Fixes applied

| # | Fix | File |
|---|---|---|
| 1 | Bridge timeout 5s → 12s (`IVR_V2_TIMEOUT_MS`), p99 warn 500ms → 3s, total retry budget cap | `ivr/src/v2-bridge.ts` |
| 2 | Never swap to v1 mid-call once v2 has answered — ask the caller to repeat instead | `ivr/src/server.ts`, `ivr/src/session.ts` |
| 3 | Clear session-scoped state on 24h rotation; keep identity columns | `app/lib/sms-v2/conversation.server.ts` |
| 4 | `bridgeSummary` strips existing prefixes before adding one | `app/lib/sms-v2/conversation.server.ts` |
| 5 | `extractPriceMax` requires a budget cue, `$`, or a trailing money noun; rejects non-price units | `app/lib/sms-v2/slot-extractor.server.ts` |
| 6 | `mergeSlots` drops a category-scoped `subtype` when the category changes | `app/lib/sms-v2/discovery-gate.server.ts` |
| 7 | Agent path uses `mergeSlots` instead of a plain spread | `app/lib/sms-v2/conversation-agent.server.ts` |
| 8 | Internal routing flags excluded from `<known_about_customer>` | `app/lib/sms-v2/conversation-agent.server.ts` |
| 9 | Voice turns log the same telemetry columns as SMS; slow turns warn | `app/lib/sms-v2/adapters/voice.server.ts` |
| 10 | Voice persists `pitchedHandlesLog` + `conversationSummary` | `app/lib/sms-v2/adapters/voice.server.ts` |
| 11 | Prices spoken as words; prose runs through `normalizeForTTS` | `app/lib/sms-v2/adapters/voice.server.ts` |
| 12 | `logIvrTokens` warns once when `DATABASE_URL` is missing | `ivr/src/token-log.ts` |

## 7. Not fixed here

- **The already-poisoned live row.** `+1818…7258` still carries `priceMax=10`
  and the six-deep summary. Fix 3 clears it automatically at the next 24h
  rotation; a call inside that window still sees the stale slots. Clearing it
  by hand is a one-row `UPDATE` and needs owner sign-off (production write).
- **Turn latency itself.** 12s is sized above the observed worst case, not a
  fix for a 3.8s-mean turn. The real work is trimming the classify → search →
  compose chain, or streaming partial audio so the caller hears something
  before the tool loop finishes. Worth a ticket.
- **Product-title readback.** The pitch spoke the full raw product title
  ("Satin Black We Vibe Chorus Pro Couples Vibrator") after the prose had
  already named the product. Redundant on a phone call, and the v1 prompt warns
  against reading full product names aloud on speakerphone.
