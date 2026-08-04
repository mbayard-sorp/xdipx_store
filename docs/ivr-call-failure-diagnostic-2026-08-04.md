# IVR Call Diagnostic — 2026-08-04

**Call:** `CAc0f0860abd080f9dd0ec3b39a3cd7585`, 2026-08-04 01:30:03–01:31:42 UTC,
99s, `end_reason=user_hangup`, `tokens_total=11947`. Caller `+1818…7258`.

Follow-up to `ivr-call-failure-diagnostic-2026-08-03.md`. Every finding is
reproduced from `sms_turns`, `sms_conversations` and `call_log`.

**Audio was not available.** `api.twilio.com` is blocked by this environment's
network policy, so the call recording could not be fetched. Everything below is
reconstructed from the turn log, which carries the exact SSML the caller heard.

---

## 0. What yesterday's fixes did

Two of them held, and it shows in the data:

- **No engine swap.** Turn 4 took 8829ms. Under the old 5s bridge timeout that
  would have aborted to the v1 Haiku agent mid-call and produced another
  collection readout. `HARD_TIMEOUT_MS` is now 12s, so v2 answered its own turn.
  No desync, no phantom state writes.
- **No phantom budget.** Emma never mentioned a price ceiling, despite
  `priceMax=10` still sitting in the row (see §4).

The call still failed. The remaining defects are different ones.

---

## 1. The transcript

Four turns, all `channel='voice'`, `pipeline_version='v2-voice'`. Stage was
`PRESENTATION` on entry and never moved.

| # | Caller | Emma | Latency |
|---|---|---|---|
| 1 | "I'm looking for a vibrator for my wife and I." | "That's exactly what the We Vibe Chorus Pro is built for. It stays between you both during sex, powerful rumble for her while you both feel it together. Want me to text you the link?" | 2357ms |
| 2 | "Yes." | "Just texted it. Want me to find anything else?…" | 250ms |
| 3 | "Butt else should I get?" | "Good thinking. Most couples who go that route say lube makes everything better, especially the first time a plug is in the mix. Have either of you tried anal play before?" | 2780ms |
| 4 | "No." | **"…the Luster Anal Plug Set 3 Piece Beginner Kit at thirty nine ninety nine. …Want me to text you that link too? / Luster Anal Plug Set 3 Piece Beginner Kit, thirty-nine ninety-nine / Want me to text you the link?"** | **8829ms** |

The caller hung up ~11s after turn 4 finished speaking, without answering.

---

## 2. Turn 4 spoke everything twice

The verbatim SSML:

```
<speak>For a first time, I'd start with the Luster Anal Plug Set 3 Piece
Beginner Kit at thirty nine ninety nine. Three graduated sizes means you go at
your own pace, no guesswork on where to begin. Want me to text you that link
too? <break time="300ms"/> Luster Anal Plug Set 3 Piece Beginner Kit,
thirty-nine ninety-nine <break time="300ms"/> Want me to text you the
link?</speak>
```

Product name twice. Price twice. The same question twice, reworded. Emma asks
for the close, then recites a catalog title at the caller, then asks for the
close again.

`stageResponseToVoiceReply` builds a turn by walking `segments` and appending
the prose, then the `productCard` readback, then the permission question —
each unconditionally. On SMS that is correct: prose sells, the card renders as
a link preview. On voice they collapse into one stream of speech, and the model
had already written the name, the price and the ask into its prose.

This is the last thing the caller heard. Yesterday's doc listed the title
readback under §7 "Not fixed here" as merely "redundant"; on this call it is
the full name-price-question block duplicated, which reads as a broken machine.

## 3. "Just texted it" is spoken whether or not it sent

Turn 2, the pending-PDP permission gate:

```ts
try {
  await sendSms(callerPhone, `Here's the link: ${pendingUrl}`)
} catch (err) {
  console.warn(...)                    // swallowed
}
await applyStateWrites(callerPhone, { pendingPdpUrl: null })   // cleared anyway
return { ssml: wrapSsml(`Just texted it. …`) }                 // claimed anyway
```

A failed send produces a `console.warn` and a caller who has been told the link
is on its way. The pending URL is cleared on the way out, so a second "yes"
resolves to nothing and cannot retry.

**Whether the send actually failed on this call is unknown.** `sendSms` does not
write to `sms_messages` — only the inbound SMS webhook does — so the empty table
proves nothing either way, and Twilio's API is unreachable from here. The defect
is that the system cannot answer the question at all: there is no success/failure
record for a customer-facing promise. That is worth fixing regardless of what
happened at 01:30:47.

## 4. Emma pitched a day-old abandoned product with no discovery

Turn 1: the caller opens with "I'm looking for a vibrator for my wife and I" and
Emma immediately answers **"That's exactly what the We Vibe Chorus Pro is built
for"** — no `searchProducts` call, 750 input tokens, stage already
`PRESENTATION`.

She was not answering the caller. She was resuming the *previous* call. The
We-Vibe Chorus Pro was `currentPitchHandle` from the 2026-08-03 call — the one
that ended in a hangup after the $10-budget failure.

`getOrCreateConversation` clears session-scoped shopping state on a 24h gap.
The gap here was **21.5 hours**. Nothing rotated:

```json
"discovered_slots": {
  "priceMax": 10, "subtype": "plug", "category": "vibrator",
  "audience": "for-her", "experience": "first-time",
  "matters": ["powerful"], "isAdviceRequest": true
}
```

`priceMax=10` and the `category=vibrator` + `subtype=plug` contradiction are the
same poisoned values from yesterday, still live. The `conversation_summary` still
carries **six** stacked `"From a previous conversation: "` prefixes. Yesterday's
fixes 3–6 are all deployed and correct; none of them fire without a rotation,
and the rotation never happened.

The 24h window is right for SMS, where a thread is one long conversation. It is
wrong for voice: a phone call is a discrete session that ends at hangup. An
abandoned pitch from a day ago should not be the first thing a new caller hears.

## 5. ASR turned "What else" into "Butt else" and Emma ran with it

Turn 3's transcript is `"Butt else should I get?"`. The caller almost certainly
said **"What else should I get?"** — a generic follow-up.

Emma treated the mistranscription as intent, pivoted to anal play, and spent
turn 4 pitching a plug kit. The `STT_HINTS` list in `api.twilio.voice.tsx` biases
Deepgram toward exactly this vocabulary (`anal`, `plug`, `butt plug`), and the
stale `subtype=plug` slot from §4 pointed the same way.

Nothing in the pipeline treats a syntactically broken utterance as low
confidence. "Butt else should I get?" is not a sentence; it should have drawn a
clarifier, not a category pivot. The caller asked an open question and was
steered somewhere they never asked about.

Note the intent label on turn 4 is `UPSELL_DECLINE`, from the caller's "No." —
but the question they answered was *"have either of you tried anal play
before?"*. That "no" meant "we haven't", not "I don't want it". The reply
happened to fit; the classification did not.

## 6. 8.8 seconds of dead air

Turn 4 ran two `searchProducts` calls serially (`beginner anal plug`, then
`anal safe lube`) for 8829ms of silence. Nothing covers that gap — `softBeat`
is a telemetry flag, not a filler utterance, and the bridge is a single
request/response with no partial audio.

Raising the bridge timeout to 12s stopped the engine swap, but it also means the
caller can now legitimately wait 12 seconds hearing nothing. The caller hung up
during the turn that followed this one.

---

## 7. Fixes applied

| # | Fix | File |
|---|---|---|
| 1 | Product-card title/price readback is now a **fallback** — suppressed when the prose already names the product (distinctive-token match, tolerant of paraphrase) | `app/lib/sms-v2/adapters/voice.server.ts` |
| 2 | "Want me to text you the link?" suppressed when the prose already asked. `pendingPdpUrl` is still written unconditionally, so a "yes" resolves either way | `app/lib/sms-v2/adapters/voice.server.ts` |
| 3 | "Just texted it" only spoken on a send that resolved; failure says so honestly and **leaves `pendingPdpUrl` set** so another "yes" retries | `app/lib/sms-v2/adapters/voice.server.ts` |
| 4 | Failed link sends write `errors: ['pending_pdp_sms_send_failed']` to `sms_turns`; `logVoiceTurn` gained a turn-level `errors` param | `app/lib/sms-v2/adapters/voice.server.ts` |
| 5 | A new `callSid` with no activity inside `IVR_SESSION_FRESH_MS` (default 2h) clears session-scoped shopping state and drops to `RECONNECT`. Identity and `conversationSummary` are preserved | `app/lib/sms-v2/adapters/voice.server.ts` |
| 6 | Regression tests for the readback dedupe, built from the verbatim turn-1532 and turn-1535 strings | `app/lib/sms-v2/__tests__/voice-readback-dedupe.test.ts` |

Fix 5 detects the first turn of a call by prefix-matching
`sms_turns.twilio_message_sid` against `call:{callSid}:%`, which `logVoiceTurn`
already writes — no schema change. It also retires the poisoned row for voice:
the next call from `+1818…7258` clears `priceMax=10` and the contradictory
slots on turn 1 rather than waiting for a 24h gap that keeps not arriving.

The 2h window deliberately preserves a real cross-channel handoff (text Emma,
call a few minutes later to keep going). Tune with `IVR_SESSION_FRESH_MS`.

## 8. Not fixed here

- **Turn latency (§6).** Unchanged, and now the single biggest driver of
  hangups. Two candidate directions: run independent `searchProducts` calls
  concurrently instead of serially, or have the Fly server speak a filler beat
  when the bridge response hasn't landed within ~1.5s. The second needs a
  protocol change (the bridge is one request/response today) and should be its
  own ticket.
- **Low-confidence ASR handling (§5).** No fix attempted. Acting on
  "Butt else should I get?" as if it were intent needs a confidence gate and a
  clarifier path, and the `STT_HINTS` bias needs re-examining alongside it.
  Removing hints is not obviously right — they exist because Deepgram was
  redacting these terms to asterisks.
- **Intent labels on answers to Emma's own questions (§5).** `UPSELL_DECLINE`
  for a "no" that answered "have you tried this before?" is a classifier that
  ignores what was just asked. Worth a ticket.
- **The poisoned SMS row.** Fix 5 covers the voice path only. The row still
  carries `priceMax=10`, the `vibrator`/`plug` contradiction and the six-deep
  summary for **SMS** until a 24h gap arrives. Clearing it by hand is a one-row
  `UPDATE` and still needs owner sign-off (production write).
- **v1 token spend still invisible.** `api_token_log` has zero rows with
  `feature='ivr'` — confirmed again for this call's window, while
  `call_log.tokens_total` reads 11947. `logIvrTokens` now warns once when
  `DATABASE_URL` is unset, but nobody has checked the Fly machine's env.
