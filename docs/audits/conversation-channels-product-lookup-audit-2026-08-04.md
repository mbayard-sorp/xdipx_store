# Conversation channels product-lookup audit, 2026-08-04

Scope: IVR (Twilio voice via Fly ConversationRelay service), SMS (sms-v2 pipeline), and the customer-facing Emma chat widget. Question asked: can a customer reliably look up products and get useful answers on these channels, and where does the wiring or search logic break?

Method: four parallel code audits (IVR path, SMS path, web chat path, shared search substrate), plus live verification queries against Sanity project `0nlwk8cf/production` (4,680 productPage docs) and Shopify (4,526 active products). The prior diagnostic `docs/conversation-surfaces-diagnostic-2026-07.md` was re-verified: 6 of its 11 catalog findings are fixed and it is now partially stale; the findings below are the current state.

## Headline

All three channels converge on one search backend, `app/lib/ivr-search.server.ts` (Sanity GROQ over productPage, hydrated from Shopify). That is good architecture. The problem is that **several of the filters that backend accepts match zero products in the live dataset**, and the channels AND those filters into every query. The more precisely a customer describes what they want (a budget, a preference like "quiet", a mood, an experience level), the more likely the system is to return nothing and say "we don't carry that." These are data-contract bugs, not model bugs, and no test or monitor covers any of them.

## P0: filters that provably match zero products (verified live)

1. **`priceMax` queries a Sanity field that does not exist.** `ivr-search.server.ts:260-262,498-501` filters `price <= $priceMax`, but `count(defined(price))` is 0 of 4,680: `upsertProductPage` (`sanity.server.ts:724-775`) never writes it and the schema has no price field. Every "under fifty dollars" request returns empty. For strict-category queries ("vibrators under $50") there is no Shopify fallback either (`ivr-search.server.ts:310-323`).

2. **`mattersTags` filter can never match: casing mismatch.** Query side slugifies to lowercase (`normalizeTag`, `ivr-search.server.ts:273`); stored values are all Title-Case (`"Waterproof"` 695 docs, `"waterproof"` 0). All 65 stored values are Title-Case. The clause is AND-ed, so any stated preference ("quiet", "beginner-friendly") zeroes the whole search. Note `'Plus-size friendly'` contains a space, so a casing fix alone is not sufficient; normalize both sides through one function.

3. **`discoverProducts` enums do not match the enriched vocabulary.** Tool schemas (`app/lib/ai-agent/tools.server.ts:99-106`, `ivr/src/tools/index.ts:102-105`) offer `experience: beginner|intermediate|advanced` but the canonical vocabulary is `first-time|curious|experienced|advanced` (`claude.server.ts:2979`). Live counts: `beginner` 0, `intermediate` 0. `mood: luxurious|relaxing` match 0 docs; mood matching is case-sensitive so `playful` also misses the 486 docs tagged `Playful`. `useCase: solo|couples` are not in `IVR_USE_CASES`. Every mismatched enum is a hard AND filter, so the "guided discovery" tool returns near-zero for most parameter combinations. No runtime code validates tool enums against `ask-emma-vocab.server.ts`, which is why this drifted silently.

4. **Un-enriched products are invisible to discovery.** In `discoverForIvrWithDiagnostics` (`ivr-search.server.ts:458-491`), empty `moodTags` / `ivrUseCase` / `ivrFeatures` exclude a product (AND semantics), while empty `ivrExperience` matches everything (`:470`). Coverage: matters_tags ~82%, audience ~57%, many chips under 25%. The keyword path already treats `mattersTags` as OR-with-empty (`:270-272`); discovery never got the same treatment. Separately, `productTypeDial` is never dropped in the SMS retry ladder (`sms-v2/stages/discovery.server.ts:213-243`) and `productSubtypeDial` is only 26% populated while the IVR prompt tells the model to always use it (`ivr/src/tools/index.ts:86-87`; `wand` = 27 docs, `plug` = 41).

## P0: channel wiring failures

5. **SMS: unguarded awaits mean an exception replies with nothing.** `processor.server.ts:107,125,130,188` are outside any try/catch; a throw reaches `api.twilio.sms.tsx:56` which returns EMPTY_TWIML. The customer gets silence, no retry prompt, no handoff. `stages/research.server.ts:306` (Anthropic call, live on web v2) is one unguarded thrower.

6. **SMS: the customer's brand/model is discarded from the search.** `stages/discovery.server.ts:201` sets `searchQuery = mergedSlots.category ?? customerText`. "Do you have the Lelo Sona 2?" becomes the query `"vibrator"`, then `marginWeightedSelect` (`ivr-search.server.ts:399`) returns three margin-weighted random vibrators. The slot extractor has no brand/vendor rules.

7. **SMS: order status and policy questions are unreachable.** No SMS code path ever sets stage RESEARCH, SUPPORT, OBJECTION, or POST_PURCHASE (`stage-dispatch.server.ts:54` has no case; no handler emits them). `tools/order-status.server.ts` is imported only by the dead SUPPORT/POST_PURCHASE stages; `kb-lookup` is not in the discovery tool set. "Where's my order?" can never be answered by SMS.

8. **Web chat v1: the discovery gate can loop forever and never search.** `api.ask-emma.tsx:224-231` passes no `sessionId`, so gate state is never persisted (`chat.server.ts:235,517-524`), yet the gate still forces `askQuickChoice` and blocks search tools while in MOOD/WHO/MATTERS (`chat.server.ts:420-427`). Slots never accumulate; `mood` is never extracted at all (no `regexSlots.mood` in `slot-extractor.server.ts`); the `SKIP_SENTINEL` "just show me" escape is documented but never produced; 3 of 4 WHO pill labels ("For me", "For a partner", "A gift") match no extractor rule. A shopper can tap pills indefinitely and never see a product. Which engine (v1 vs sms-v2 web adapter) is live depends on `WEB_PIPELINE_VERSION` env; both are reachable.

9. **IVR: after-hours and fallback voicemails go into a black hole.** The `<Record>` branches in `api.twilio.voice.tsx:58-72` and `api.twilio.voice-fallback.tsx:14-24` write only a call_log row; `api.twilio.recording-status.tsx:31-34` only updates an existing voicemails row, and the only voicemails writer is the live-agent tool. With `IVR_BUSINESS_HOURS=9-21`, every overnight caller's message sits in Twilio storage, invisible to /admin/voicemails, no Klaviyo notification.

## P1: resilience and honesty of failure

10. **Failure reasons are computed and then thrown away.** `searchForIvrWithDiagnostics` distinguishes `filtered-to-zero` / `no-base-results` / `sanity-unavailable`, but `runQaTool` (`tools.server.ts:355-364`) and the `searchForIvr` wrapper (`ivr-search.server.ts:365-368`) discard it. Voice and chat cannot tell "your filters are too tight, loosen them" from "the catalog service is down", and there is no Sentry alert on `sanity-unavailable` rate. Only the SMS/v2 discovery stage uses the diagnostics and retries.

11. **`discoverForIvr` and strict-category queries have no Shopify fallback.** Sanity down means the vibe/discovery path returns `[]` (`ivr-search.server.ts:441`), and even keyword search skips the fallback for the highest-intent nouns like "lube" and "vibrator" (`:310-323`). The fallback that does exist drops all structured filters and the `hiddenUntilLive` guard silently.

12. **Empty results are cached for 3-4 minutes.** `cached()` (`kv.server.ts:283-304`) memoizes `[]`/`null` (L1 180s + KV 240s for GROQ). A transient Sanity blip pins "we don't carry that" for every caller asking the same thing. Same mechanism as the documented homepage null-cache trap. `invalidateCache` is per-instance L1 only.

13. **Out-of-stock products get recommended.** No stock predicate in either GROQ query; `marginWeightedSelect` (`ivr-search.server.ts:399-414`) deliberately tops off with OOS items, and the v2 web adapter hardcodes `inStock: true` on cards (`adapters/web.server.ts:113`). Shopify-hydration misses are silently dropped (`:342-346`), quietly shortening result lists with no log.

14. **IVR Fly service: no timeout on the qa-tool proxy.** `ivr/src/tools/catalog.ts:13-20` is a bare fetch; the silence re-engage timer is cleared during tool hops (`ivr/src/server.ts:185`), so a hung call gives the caller unbounded dead air. SMS similarly has no LLM deadline while Twilio's webhook timeout is ~15s, and Twilio's retry re-enters the pipeline with no MessageSid idempotency check.

15. **SMS tool-hop budget discards completed searches.** `MAX_TOOL_HOPS = 3` counts the terminal text turn (`conversation-agent.server.ts:719,799`); at hop exhaustion a successful search result is thrown away and the customer gets "I lost the thread for a sec."

16. **Assistant-first history permanently breaks a conversation.** An empty inbound body (media-only MMS) creates a history whose first message is assistant-role (`conversation-history.server.ts:87-88`), which the Messages API rejects, sending every subsequent turn to safeFallback forever.

## P2: quality and drift (selected)

- SMS product links render as bare relative paths (`/products/handle`), not tappable, plus an em-dash (`stages/discovery.server.ts:182` + `stripMarkdownForSms`); the v2 voice path can read "/products/handle" aloud (`adapters/voice.server.ts:86-99`).
- MATTERS gate answers are collected then never passed to search on SMS (`stages/discovery.server.ts:203-210` omits `mattersTags`).
- DTMF digits are detected and discarded (`ivr/src/server.ts:202-205`) while the v2 voice adapter says "press 1 for X".
- v1/v2 voice engines make contradictory checkout-link promises (`ivr/src/prompts.ts:32,41` vs `adapters/voice.server.ts:207-212`).
- Search matching is thin for STT input: prefix globs, 8-entry synonym table, 40-term strict-category list, no fuzzy matching. Deepgram transcription errors have no tolerance.
- Cross-channel lookup breaks above 20 concurrent conversations (`cross-channel.server.ts:112-132`) and runs 3 queries on every turn for a one-stage consumer.
- Web chat: kbLookup exists but is not exposed to the customer chat tool set (`tools.server.ts:758-784` not in `QA_TOOL_DEFINITIONS`); policy answers come from model memory.
- v2 web checkout can add to an orphan cart while saying "Added to your cart" (`stages/checkout.server.ts:241-250`; `api.ask-emma.tsx:203-206` sets no cookie).
- v2 web turns bypass token budget accounting entirely (`api.ask-emma.tsx:211`).
- Session cap message says "refresh to start fresh" but the 60-day cookie + localStorage key means a 6h lockout (`emma-log.server.ts:8-30`, `emma-budget.server.ts:13`).
- Stale flash-sale framing in IVR prompts/tools post deal-retirement (`ivr/src/prompts.ts:11`, `ivr/src/tools/index.ts:25`).
- Config split-brain: `DISCOVERY_AGENT_VERSION` default `v2-gate` in code vs `v2-agent` in `.env`; `IVR_PIPELINE_VERSION` set nowhere; which brain is live in prod is not determinable from the repo.
- Zero test coverage on the entire lookup path: no tests for `ivr-search.server.ts`, the Twilio routes, the tool loop, the stage machine's search branches, or the Fly service. Existing sms-v2 tests cover pure functions only.

## Recommendations

Ordered by expected customer impact per unit of work.

1. **Fix the three dead filters (P0 1-3).** Either write `price` into productPage during upsert or drop the filter and apply priceMax post-hydration on Shopify prices; normalize `mattersTags` and mood matching through one shared normalizer applied on both write and query side; regenerate the tool enum lists from the canonical vocabularies in `claude.server.ts` / `ask-emma-vocab.server.ts` instead of hand-maintaining them. Add a startup or CI assertion that every tool enum value matches at least one live document.
2. **Make enrichment gaps soft (P0 4).** OR-with-empty for moodTags/ivrUseCase/ivrFeatures in discover, mirroring the mattersTags keyword treatment; add productTypeDial as the last drop in the SMS retry ladder.
3. **Never reply with silence (P0 5).** Wrap the whole v2 processor in try/catch that returns a friendly "text me that again in a minute" TwiML, and add a MessageSid idempotency check.
4. **Stop discarding what the customer said (P0 6, P2 MATTERS).** Search with the full customer text plus extracted slots, not category-or-text; pass mattersTags through on SMS; add brand/model slot extraction or simply prefer customerText when it contains capitalized tokens not in the category vocabulary.
5. **Wire order status and kb-lookup into the reachable SMS path (P0 7)** or route those intents to a static reply with the support email. Same for kbLookup on web chat v1.
6. **Fix or bypass the web v1 gate (P0 8).** Pass sessionId from the route so state persists, add extractor rules for the actual pill labels and the skip sentinel, and add a circuit breaker: after N gate turns with no accumulated slots, force a search with whatever exists.
7. **Close the voicemail black hole (P0 9).** Insert a voicemails row (and fire the notify hook) from the `<Record>` branches or from recording-status when no row exists.
8. **Propagate failure reasons and add fallbacks (P1 10-11).** Return `reason` through runQaTool so prompts can say "try loosening the filters"; give discoverForIvr and strict-category queries the Shopify fallback; alert on sanity-unavailable rate.
9. **Stop caching empty results (P1 12).** Skip the write in `cached()` when the value is null/empty, or use a 15s negative TTL. This fixes the homepage null-cache trap too.
10. **Stock honesty (P1 13).** Filter OOS at query/hydration time unless the pool is thin, and never hardcode inStock on cards; log dropped-handle hydration misses.
11. **Timeouts everywhere on the hot path (P1 14-15).** AbortSignal on the Fly qa-tool fetch and all LLM calls with deadlines inside Twilio's 15s window; make the hop budget count only tool calls and always emit text from completed results.
12. **Add a regression harness.** A small CI suite that runs the top 20 real customer query shapes (category, brand+model, budget, preference, mood, "where's my order") through `searchForIvr`/`discoverForIvr` against fixture data and asserts non-empty results and correct reason codes. This class of bug (filters matching zero products for months) is exactly what a data-contract test catches and code review does not.
13. **Resolve the config split-brain.** Pin `DISCOVERY_AGENT_VERSION`, `WEB_PIPELINE_VERSION`, `IVR_PIPELINE_VERSION` in Vercel prod env explicitly and record the choice in a doc; delete the dead v1 paths once v2 is trusted.

## Cross-references

- Prior diagnostic: `docs/conversation-surfaces-diagnostic-2026-07.md` (2026-07-31). Fixed since: A1, A2, A3, A4, A5, A7, A8, plus GROQ caching. Still open: A6 (enrichment coverage), A10 (dead stages), monitoring, kill valve. New findings 1-3 above are not in that document; it should be marked superseded by this one.
- Coverage docs: `docs/what-matters-remaining-handoff.md`, `docs/matters-tagging-handoff.md`, `scripts/report-discovery-coverage.ts`.
