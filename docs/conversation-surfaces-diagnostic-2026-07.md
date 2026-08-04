# Conversation Surfaces Diagnostic — IVR, SMS, Emma Chat

> **Superseded 2026-08-04** by `docs/audits/conversation-channels-product-lookup-audit-2026-08-04.md`. Findings A1, A2, A3, A4, A5, A7, A8 and the caching gap are fixed; the newer audit re-verifies the rest and adds live-data findings not covered here.

**Date:** 2026-07-31
**Scope:** Full diagnostic of the IVR's (and SMS/chat's) ability to search the catalog and respond to a customer, plus readiness to join the improvement loop. No fixes applied; this is the input to a phased fix/maintenance plan.

---

## 1. Architecture as it stands

Three customer-facing conversation surfaces, two runtimes:

- **Voice (IVR).** Twilio ConversationRelay (Deepgram STT + ElevenLabs TTS) terminates on a standalone Fly.io WebSocket service (`ivr/`). No DTMF menu tree exists; calls are fully conversational. The Fly service runs one of two brains per call:
  - **v1 (default):** a local streaming Claude loop on `claude-haiku-4-5` (`ivr/src/claude.ts`) with 11 tools, catalog tools proxied over HTTP to Vercel's `/api/internal/qa-tool`.
  - **v2 (flag-gated, `IVR_PIPELINE_VERSION`, default `v1`):** each turn is bridged to Vercel's `/api/emma-engine/turn`, which runs the shared sms-v2 stage machine through a voice adapter (SSML, URL stripping, "can I text you the link" flow).
- **SMS.** `/api/twilio/sms` → v2 stage machine by default (cut over 2026-04-30): intent classifier (regex → heuristic → Haiku), 13 stage handlers, a pure discovery gate state machine (MOOD→WHO→MATTERS→READY) with ~1.4k lines of deterministic template banks, Sonnet 4.6 for generative stages, fabrication guards on every LLM reply. v1 (`sms-processor.server.ts` + `ai-agent/`) is retained as kill switch.
- **Web chat (Ask Emma).** `AskEmmaWidget` → `/api/ask-emma` → same v2 stage machine via a web adapter (flag-gated), falling back to the v1 `generateChatReply` loop (Haiku on web). Solid defense stack (origin allowlist, BotID shadow mode, IP rate limit, session/daily token budgets).

**Catalog search core:** `app/lib/ivr-search.server.ts` — Sanity GROQ over `productPage` docs with field-weighted boosts, strict-category-noun handling, diagnostics reason codes (`matched | filtered-to-zero | no-base-results | sanity-unavailable`), Shopify price/stock hydration, MAP-rule pricing, TTS normalization, and margin-weighted randomized ranking. This one function backs voice, SMS, and the v1 agent. Web chat uses a *different* backend (`searchCatalogForEmma`, Shopify Storefront, cached).

The bones are genuinely good: shared search implementation, reason codes, MAP compliance, anti-fabrication validators, never-throw webhook handlers, a pure and well-tested discovery gate. The problems are wiring gaps, drift between the copies, and a total absence of feedback loops.

---

## 2. Findings

### A. Catalog-search correctness (customer asks, we silently fail)

| # | Finding | Where | Effect |
|---|---|---|---|
| A1 | `findCollection` implemented in `runQaTool` but **absent from the Fly voice tool registry** | `app/lib/ai-agent/tools.server.ts:421` vs `ivr/src/tools/index.ts` | Callers asking "do you carry Lelo?" / "what lingerie do you have?" can't get a collection/brand lookup — the exact case the tool description says never to refuse from memory |
| A2 | Voice tool schemas advertise a `collection` filter on `searchProducts`/`discoverProducts`; `runQaTool` only reads `category` | `ivr/src/tools/index.ts:85,103` vs `tools.server.ts:341-360` | The model dutifully passes `collection:`; it is silently dropped — filters never apply |
| A3 | SMS discovery agent offers the model a `category` enum containing `'wand'` and `'plug'`, which are **not valid `productTypeDial` values** | `app/lib/sms-v2/discovery-agent-tools.server.ts:53` vs `studio/schemas/productPage.js:316-336` | Those searches filter to zero, every time |
| A4 | SMS discovery agent passes `matters` slots as `tags`, which GROQ matches against raw Nalpac editorial categories, not `mattersTags` | `discovery-agent-tools.server.ts:301`, `ivr-search.server.ts:227-232` | "quiet", "beginner-friendly" etc. silently return nothing |
| A5 | `runQaTool.searchProducts` never forwards `productTypeDial`/`productSubtypeDial`/`tags` even though the search core supports them | `tools.server.ts:347` | Voice + v1 chat search strictly weaker than SMS-v2 search |
| A6 | Un-enriched products: empty `moodTags`/`ivrUseCase`/`ivrFeatures` make a product **invisible to `discoverProducts`**, while empty `ivrExperience` makes it match *every* experience filter; missing `productTypeDial` makes it unreachable from SMS discovery (the dial filter is never dropped on retry) | `ivr-search.server.ts:411,422,428,437`; `stages/discovery.server.ts:214-243` | Coverage gaps translate directly into "we don't carry that" |
| A7 | IVR search does not honor `hiddenUntilLive` (web search does) | `ivr-search.server.ts:199-201` vs `search.server.ts:273` | Draft import stubs are pitchable by phone/SMS |
| A8 | `predictiveSearchUnified` filters neither `archived` nor `hiddenUntilLive` | `search.server.ts:741-750` | Draft/archived stubs in the typeahead |
| A9 | `ivrExperience` scalar/array drift: web `/search` still treats it as a scalar post-Phase-2 | `search.server.ts:365,601,645` | Experience facet/filter broken on web search |
| A10 | 8 of 13 SMS stages (SUPPORT, RECONNECT, CHECKOUT, POST_PURCHASE, …) have **zero catalog access** | `app/lib/sms-v2/stages/` | "Do you sell X?" mid-support is answered from memory or not at all |
| A11 | Web chat searches a different backend (Shopify Storefront) than voice/SMS (Sanity) | `emma-chat-tools.server.ts` vs `ivr-search.server.ts` | Same question, different answers per channel; no mood/dial filtering on web |

### B. Experience quality

- **No caching anywhere on the voice/SMS search path** — every turn is a live Sanity fetch + Shopify hydration, while the lower-stakes web-chat backend is fully cached. On a phone call this is audible dead air. (`ivr-search.server.ts`, `search.server.ts`: zero `cached()` calls.)
- **Two brains with contradictory promises.** Voice v1's prompt insists checkout links are email-only, never SMS (`ivr/src/prompts.ts:32,41`); voice v2 texts checkout links (`adapters/voice.server.ts:210`). A caller's experience depends on a flag.
- **No fuzzy matching.** Misheard/misspelled queries rely on prefix globs + an 8-entry synonym map (`search.server.ts:108-136`). For a *voice* channel fed by STT, this is thin.
- **Wrong voicemail copy.** Anonymous callers and missing-config failures hear "We're closed right now" (`api.twilio.voice.tsx:46,225,255`).
- **DTMF is detected and dropped** (`ivr/src/server.ts:202-205`); v2 speaks "press 1" style hints that do nothing.
- **Non-deterministic ranking** (margin-weighted random) is a reasonable merchandising call but makes eval runs irreproducible.

### C. Reliability, observability, safety

- **No monitoring of the conversation surfaces.** No cron or alert covers Fly WS health, ConversationRelay connect failures, `voice-fallback` firings, or v2-bridge fallback rate — all `console.warn` only. `/cron/log-monitor` sees only error logs.
- **v2 outages are invisible.** `/api/emma-engine/turn` returns **200 with apology SSML** on crash (`api.emma-engine.turn.tsx:182`), so the Fly bridge never falls back to v1 during a persistent v2 failure.
- **Nothing reads the chat transcript tables.** `emma_chat_sessions/turns/events` have exactly one consumer: the writer. No transcript viewer, no quality dashboard.
- **Fabrication-guard and validator trips are silently repaired and never counted** — the best available quality signals (fabricated URLs, refusals, v2→v1 fallthrough, budget exhaustion) are measured nowhere.
- **No kill valves.** There is no `chat_enabled` / `sms_agent_enabled` valve; the only chat kill mechanisms are removing the API key or exhausting the token ceiling. All pipeline flags are env vars memoized at module load — changing them requires a redeploy.
- **STOP/HELP compliance claim mismatch.** `stage-dispatch.server.ts:52` and `processor.server.ts:187` claim the webhook catches STOP/HELP/START before dispatch; it does not, and the v1 fall-through that used to catch them is now unreachable (every stage has a v2 handler). Needs verification that v2 handlers honor STOP in every stage — this is a compliance risk, not just a bug.
- **Test coverage is inverted.** The pure discovery gate is well tested; the four Twilio webhook routes, signature verification, the entire Fly service, the voice adapter, and the v2 processor have zero tests. Smoke scripts exist but are manual.

### D. Rot and drift

- `ivr/dist/server.mjs` — a stale build artifact committed to git.
- `scripts/enrich-ivr-tags.ts` — writes the deleted `ivrMood` field, gates on it (so it re-enriches everything forever), and uses the pre-Phase-2 experience vocabulary. Must not be run as-is.
- Three sources of truth for IVR limit defaults (`ivr/.env.example`, `ivr/src/config.ts`, Vercel `IVR_CONFIG_DEFAULTS`) with three different value sets.
- System prompts duplicated between Vercel and Fly with manual sync (`prompt.ts:1-6`, `ivr/src/prompts.ts`, `evals/v1-fly-prompt.txt`); model ID string duplicated in 6+ files.
- Stale TODOs: kbLookup tool exists (338 lines) but three stages still carry "TODO: register kbLookup once available"; dead `minutesToMs` legacy branch; log line claims "6h stage TTL" (it's 24h); unreachable v1 fall-through in the v2 processor; unreferenced checkout template arrays.
- Prompt-change governance not enforced: `prompt.ts` carries "EMPATHY REVIEW REQUIRED" markers, but nothing routes live chat/SMS/voice prompt edits through `emma-empathy-reviewer` (which gates content/social/email/video, not the live channels).

---

## 3. Improvement-loop status

**The conversational channels are entirely outside the loop.** No team, no routine, no detector, no dashboard, no valve:

- `ivr-ops` and `customer-service-emma` agents exist but are on-demand only — zero rows in `routine-schedule.md`, no playbooks.
- All six `fileDetectionTicket` detectors cover homepage/content/checkout/pricing/logs; none reads `emma_chat_*`, `sms_turns`, `web_conversations`, or `call_log`. The detector helper hardcodes `team: 'homepage'` unless an explicit `targetTeam` is passed (`detection-tickets.server.ts:129-130`).
- None of the 20 scheduled routines touches these surfaces; `emma-empathy-reviewer` never sees the live prompts.

**Adding a `support` team is a well-trodden, mostly additive path** (content team is the closest precedent):

1. **Owner-attended (protected paths):** add `'support'` to `TEAM_IDS` + defaults in `app/lib/team-keys.ts`; migration `076_support_team.sql` seeding `support_team_enabled=false`, budget, run cap, auto-approve off. Optional real kill valves: `chat_enabled`, `sms_agent_enabled`.
2. **Loop-carriable:** dashboard label (one line — the rest of `/admin/homepage-team?team=support` is data-driven); `.claude/agents/support-analyst.md`; `docs/store-team/routine-support-daily.md` (sample conversations, score against the voice charter + accuracy, file suggestions with executors); manifest row + cloud trigger.
3. **Detector:** a `/cron/conversation-health` filing tickets with `targetTeam:'support'` on: fabrication-guard trips, refusal rate, v2→v1 fallthrough, `agent_failed` 500s, budget-exhaustion counts, voice-fallback firings, Fly health.
4. **Rollup + viewer:** a `conversation_quality_daily` rollup (mirroring `seo_coverage_daily`) and a transcript viewer over `emma_chat_*`/`sms_turns` — the raw grain the retro and the owner both need.

---

## 4. Suggested phasing (input to plan mode)

- **Phase 0 — stop the silent failures (small PRs, high leverage):** A1-A5 tool/filter wiring; A7/A8 visibility guards; wrong voicemail copy; STOP-compliance verification; cache the IVR search path; delete/quarantine the stale enricher and `ivr/dist`.
- **Phase 1 — one brain, one search:** decide voice v2 cutover (or retire v2); reconcile the checkout-link promise; converge web chat onto the shared search core; enrichment-coverage push so `discoverProducts` stops hiding products (A6); add fuzzy/synonym depth for STT queries.
- **Phase 2 — see what's happening:** conversation-health detector + valves + `conversation_quality_daily` + transcript viewer; alerting on Fly/v2-bridge; make emma-engine failures visible to the fallback; webhook-route tests.
- **Phase 3 — join the loop:** support team migration + routine + empathy gate on live prompt changes; weekly conversation retro feeding the suggestion bus.
