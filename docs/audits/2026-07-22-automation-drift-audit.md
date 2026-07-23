# Site Automation Audit, 2026-07-22

Scope: the full automation surface (14 cloud routines, 18 Vercel crons, 38 agent defs, team API gates and valves), SEO/AEO/GEO indexing readiness, cloud-prompt consistency, and the last two weeks of dev work (97 commits since 2026-07-08). Method: 29 audit agents across 7 domains; every critical and high finding was adversarially re-verified against the repo, the live site, and read-only prod DB queries (all 21 confirmed real). Zero API-key spend; read-only throughout. Live trigger prompts were pulled directly from the claude.ai scheduler API and diffed against `docs/store-team/routine-schedule.md` and the playbooks.

## Verdict

The skeleton is unusually complete and mostly healthy: crons fire, gates hold, valves match the manifest, voice and doctrine are enforced on the content path, and the technical SEO/AEO plumbing is genuinely strong. The problems are concentrated in three places. First, the money path: nothing verifies checkout works, GA4 has no purchase event, Klaviyo has no lifecycle events, and the store has taken $0 for 24+ days with no automation positioned to notice why. Second, silent failure: the import chain stalled two days ago with 233 drafts stuck, one routine has never fired, PR #300 was merged into a side branch and lost, and no watchdog exists for any of it. Third, prompt drift: the 2026-07-13 era trigger prompts have fallen behind the roster, the doctrine, and the manifest. Proposal capacity now exceeds owner execution capacity; the bottleneck has moved from automation to the human queues automation feeds.

## Fix this week (P0)

1. **Recover PR #300.** It was merged into a side branch, never main. GitHub reports MERGED while the footer-legitimacy, trust-copy, and brand work never shipped. Decide: cherry-pick to main or explicitly abandon.
2. **Unstall the import-to-live chain.** 233 imported products stuck as unpublished drafts since 2026-07-20; zero enrichment batches submitted in ~96 cron ticks of `/cron/import-enrich`. Diagnose the submit path, then add a throughput check (drafts older than 48h) to the owner digest.
3. **Verify the checkout path end to end, once, by hand.** There is no payment-processor code in the repo (checkout hands off to Shopify checkoutUrl); nobody has confirmed a live order can complete. Then add a GA4 `purchase` event and Klaviyo cart/checkout/order events so every team stops optimizing blind. This is the audit's single highest-leverage item.
4. **Fix the podcast trigger cron before Sunday.** Live cron is `0 16 * * *` (daily); manifest says `0 16 * * 3`. On Sunday 2026-07-26 at 16:00 UTC it collides with the first-ever fire of Weekly SEO Curation and both can mutually refuse as run_in_progress. One RemoteTrigger update.
5. **Create the routine 11 trigger (Off-site Scout).** Playbook shipped 2026-07-16; the trigger was never created; the store's only offsite/LLM-citation motion has produced nothing, ever.
6. **Re-issue the Weekly Strategy trigger prompt.** The live prompt omits program-manager and verifies "the other 7 routines" against a 14-routine fleet, which is exactly why items 4 and 5 went undetected. Use the manifest row 1 text verbatim.
7. **Turn IndexNow on.** The pipeline is fully built and wired into deal rotation and blog publishing, but `INDEXNOW_API_KEY` is unset in prod, `/indexnow.txt` 404s, and every ping silently no-ops. Set the env var (and confirm `SEARCH_PING_ENABLED`).
8. **Own the indexing number.** 27 of 4,501 sitemap URLs are indexed. No agent, routine, or digest section owns this metric or the likely scaled-AI-content driver behind it. Assign it (seo-curator is the natural owner) and put the trend in the weekly brief.

## Trigger fleet sync (concrete revisions)

| Trigger | Revision |
|---|---|
| 12 Podcast Review | Cron `0 16 * * *` to `0 16 * * 3`. Also move off the shared 16:00 minute with SEO curation permanently. |
| 11 Off-site Scout | Create it (Tue 16:00 UTC per manifest). Add trigger ID to the manifest table. |
| 1 Weekly Strategy | Re-push prompt: add program-manager sub-step, "verify routines 1 to 14", Program Status brief section. |
| 7 Merchandiser, 8 Design Cycle, 6 Social | Add the design-doctrine read clause the manifest's common skeleton requires (prompts predate doctrine v1.1). |
| 1, 3, 7, 8 | Attach the GA4 MCP connector their agent defs assume; 4 (Ads) needs Meta Ads MCP or its research steps cannot run. |
| 10, 13, 14 | Strip the unrelated personal connectors (Gmail, Calendar, Drive, SmartSheet, Krisp, Etsy). These autonomous sessions ingest untrusted web content; a mail/drive connector is a live prompt-injection exfiltration surface. Keep only what each def needs (Sanity for 10; none for 13, 14). |
| All | Adopt a rule: any playbook or roster change re-pushes the affected trigger prompt in the same PR checklist. The manifest is source of truth, but nothing enforces it today. |

## Drift register (docs vs code vs live)

- **CLAUDE.md is stale on two load-bearing facts**: it says the homepage default is legacy/a (flipped to b in #274) and understates the import chain's autonomy. Every agent session loads this map.
- **Homepage healthcheck still assumes 'legacy'** as the cookieless default post-flip; the wrong-variant rewarm is latent or live depending on whether `HOME_VARIANT=b` is set in prod.
- **Run caps (strategy=3, content=3) exist only as a hand-edited prod DB row.** Code defaults and migrations still seed the old values that silently killed the Monday apply pass for weeks. Write a migration.
- **`homepage_team_build_cents` is displayed but never enforced**; Design Cycle spend eats the merchandising budget. Content playbook still says max_runs=2; podcast playbook logs no spend; manifest says feature label `homepage-build`, playbook says `homepage-design`.
- **20-minute run lock is shorter than real runs (22 to 69 min)**, already causing double-starts and false failures. Raise it.
- **rr7-engineer carries v2-era brand rules** (cream backgrounds, Archivo/Inter, "No purple") that contradict v3 tokens and doctrine v1.1, and never loads the doctrine. It writes all storefront code.
- **design-critic, qa-reviewer, homepage-designer reference an MCP (`mcp__Claude_Preview__*`) and nine tool names that exist nowhere**, which can dead-end the mandatory Routine B design gate.
- **The voice gate's own canonical example contains an em-dash it is required to BLOCK**, and its CTA whitelist is missing a v5 entry. Two agents load charter addenda ("email", "social") that do not exist.
- **Em-dashes still ship in owned-channel chrome including the live homepage SERP title**, a standing charter violation.
- **Voice v5 trial (ends 2026-08-19)** has a reminder chain but no hard-scheduled reminder; it can silently expire.
- **The content playbook appendix still points at the deleted desktop scheduled task** as the schedule of record.
- ~15 dead one-shot `send_later` triggers clutter the scheduler; two migrations share prefix 055; `emma-aside` spiked 73x in one night (3,642 calls) with no alert or gate.

## SEO / AEO / GEO readiness

Strong and verified live: 4,501-URL sitemap, correct canonicals, one Product JSON-LD node per PDP, 18 AI crawlers allowed, spec-compliant llms.txt, .md twins on every route class (14 of 14 checked resolve), answer-shaped Notebook posts with FAQPage, Emma ProfilePage with sameAs. Gaps, in priority order:

1. IndexNow dead in prod (P0 item 7 above).
2. 27 of 4,501 indexed and unowned (P0 item 8).
3. Sitemap and llms.txt advertise dead product URLs (2 of 60 sampled 404) with no Sanity-vs-Shopify reconciliation, and the weekly aeo-surface-check fetches the same 5 URLs every run so it can never catch rot. Fix the check to sample randomly and add a reconciliation sweep.
4. Zero tracking of LLM-referred traffic (no chatgpt/perplexity/claude referrer handling). When AEO traffic arrives nobody will see it. Small attribution patch.
5. Image sitemap caps at 1,000 products against a 4,259-product catalog, so ~75% of PDPs have no image entries.
6. No PDP emits aggregateRating (reviews flywheel dormant at zero orders), so no star rich results are possible yet.
7. Every .md page stamps a fabricated "Last updated: today" freshness date; the homepage .md twin sources its featured pick from the daily-deal system, not the variant-b hero, so the AI-readable page can name a different product than the live page.
8. llms.txt is a 570KB catalog dump (known, tracked P1-6, due 2026-08-10).

## Autonomy map

What still requires Mike day to day: merging every agent-editor and design-cycle PR; executing approved campaigns (Klaviyo), promos (Shopify discount minting), ad launches, and offsite pitches; reviewing social drafts (18 sitting unreviewed, which makes the autopost graduation criterion mathematically unreachable); clearing pricing approvals (`review_all` was set 2026-07-22 against a history where a 6,586-row queue was 100% abandoned); answering all support email by hand; reading the daily digest; and maintaining the trigger fleet itself with no watchdog.

Highest-leverage missing automations, ranked:

1. **Synthetic checkout probe + purchase telemetry** (P0 item 3). Everything downstream is starved without it.
2. **Trigger-fleet dead-man switch**: a digest section that flags any of the 14 routines with no run row in its expected window. Cheap; would have caught routines 11 and 12 immediately.
3. **Queue-depth digest sections**: pricing pending, social drafts pending, import drafts stuck, approved-but-unexecuted suggestions. The digest is currently blind to exactly the queues that back up.
4. **Klaviyo campaign API client** so approved email briefs can be executed by an agent behind a valve. Email remains the largest uncovered revenue surface and is RED past its own deadline.
5. **Support inbox poller** (Zoho IMAP) feeding customer-service-emma in draft-only mode.
6. **Sanity-vs-Shopify catalog reconciliation sweep** (feeds SEO gap 3).
7. **X autopost graduation path**: define a review SLA or an auto-approve-after-N-passes rule so the social loop can actually close.
8. **Discount-code minting behind a MAP-guard valve** (promo-manager currently proposes into a void).

Scale risks if traffic 10x'd: zero-headroom Monday run caps, the 60s function ceiling on sweeps, the polluted pipeline_settings table (1,798 velocity:* rows), the single shared team token with CRON_SECRET fallback and no rotation story, and a single human merger.

## Open questions for the owner

1. Was `pricing_approval_mode='review_all'` (set 2026-07-22) deliberate? It reinstates a pattern with a proven 100% abandonment rate.
2. Are `OWNER_ALERT_EMAILS`, `ZOHO_SMTP_USER/PASS` set in prod, and has a daily digest actually arrived since PR #282? The send path silently no-ops without them.
3. Who disabled the email (2026-07-17) and ads (2026-07-20) teams, and what is the re-enable criterion? Undocumented flips.
4. Is `HOME_VARIANT=b` set in Vercel prod? Determines whether the healthcheck's 'legacy' fallback is latent or live.
5. Is the stranded remainder of PR #300 still wanted?
6. Do the Klaviyo-side flows (welcome, abandoned cart, review invite) exist in Klaviyo at all? The repo only fires events.
7. Age gate: the Phase 1 checklist promises a site-wide gate; the live site serves all content unconditionally with only a cart-drawer click-through. Compliance stance needed.

---

# Appendix: full verified findings by area

Everything below is the auditors' full detail with evidence citations and per-finding recommendations. All critical/high findings carry an adversarial verification verdict.

### Cloud routine triggers vs manifest vs playbooks

The 13 live cloud triggers mostly match the manifest on cadence, but three structural drifts undermine the autonomy goal. First, the Weekly Podcast Review trigger fires DAILY (live cron 0 16 * * * vs manifest Wed-only), which burns one of the content team's run-cap slots every day, shifts brief-writing from Wednesday to Thursday (so briefs are ~7 days stale at consumption), and will collide head-on with the brand-new Weekly SEO Curation trigger this Sunday 2026-07-26 at 16:00 UTC, likely causing a mutual run_in_progress refusal on that routine's first-ever fire. Second, the fleet's self-healing layer is broken at both ends: routine 11 (offsite-scout, the only offsite/LLM-citation acquisition motion) has never been created, and the Weekly Strategy trigger prompt still verifies only "7 scheduled routines" and omits program-manager, the sub-agent that owns the 1-14 routine-coverage check, so dead routines are not self-detected. Third, MCP wiring is inverted relative to the manifest's access checklist: the routines whose agent defs require GA4/Meta MCPs have zero connectors, while the three newest autonomous triggers carry 8-11 unrelated personal connectors (Gmail, Krisp, Etsy, SmartSheet, Drive, Calendar), a real prompt-injection/exfiltration surface. The two endpoint families are verified equivalent (homepage-team is a shim onto the same gate/caps/budget code), but several doc-vs-code promises are fiction: homepage_team_build_cents is displayed yet never enforced, the content playbook still states max_runs=2 against the manifest's required 3, and the podcast playbook has no spend-logging step at all.


**[HIGH] Podcast trigger fires daily instead of Wed-only; burns content run-cap slots and threatens Sunday's SEO curation fire (verified)**

Live cron for trig_01AN6PKVghE9AM51R13z2UEu is 0 16 * * * (daily); the manifest says 0 16 * * 3 (Wed). Three compounding effects. (1) Every fire POSTs op:start before gating, and getTodayRunCount counts all run rows started today with no status filter, so even honest skips burn one of content's run-cap slots daily, eating the retry slot the cap-3 requirement was created to protect. (2) The pending-brief skip guard means the only day a new brief gets written is Thursday 16:00, right after the Thursday 15:00 content run consumes the old one, so podcast briefs are consumed ~7 days stale instead of <24h fresh, and the manifest's Wednesday slot never actually operates. (3) On Sundays the daily fire lands at the exact minute of Weekly SEO Curation (trig_01YJJXKSCfKRXPfHH5DAFJ24, 0 16 * * 0, created 2026-07-21, never fired): both start run rows then gate, and isRunInProgress sees the other's running row, so both can refuse as run_in_progress. First exposure is Sunday 2026-07-26, the SEO curation routine's first-ever fire. Note: the inventory's parenthetical calling the 2026-07-22 16:01 fire 'a Wednesday-only routine firing Tue' is wrong (2026-07-22 was a Wednesday), but the daily-cron drift itself is confirmed by the cron string.

*Evidence:* trigger-inventory.md rows 12 and 10; docs/store-team/routine-schedule.md:90 (Wed cadence) and :88 (Sun 16:00); docs/store-team/routine-podcast-weekly.md:9-10, 14-22 (start-then-gate, skip guard); app/lib/team.server.ts:217-226 (getTodayRunCount, no status filter), :249-263 (isRunInProgress)

*Recommendation:* Update the trigger's cron to 0 16 * * 3 via RemoteTrigger today, before Sunday 2026-07-26. Optionally move SEO curation or podcast off the shared 16:00 minute permanently so a future misfire cannot collide.

*Verifier correction:* All three effects confirmed, with two precision notes. (a) The Sunday collision is a race with two outcomes: platform stagger (podcast next_run_at 16:00:22Z vs SEO 16:03:28Z on 2026-07-26) makes the one-sided outcome (SEO curation refused run_in_progress while the podcast row is still 'running' inside the 20-min lock window) more likely than the symmetric both-refuse case, and even absent overlap, Sunday's three scheduled content fires (writer 15:00 + podcast 16:00 + SEO 16:00) consume exactly all 3 of content_team_max_runs=3, leaving zero retry headroom. (b) Staleness is transitional right now: the currently-pending brief was written Sunday 7/19 (first daily fire after the trigger's 7/17 update), so Thursday 7/23 consumes it ~4 days stale; the ~7-day steady state begins with the brief written 7/23 16:00.


**[HIGH] Routine 11 (Weekly Off-site Scout) has never been created; the only offsite/LLM-citation acquisition motion is zero (verified)**

The manifest and the playbook both define routine 11 (Tue 16:00 UTC, team strategy, feature strategy-offsite, max 6 pitch/reclamation/expert-quote suggestion rows per run), and the playbook needs no new valve, only the trigger. It has never existed, so no roundup/listicle pitches, unlinked-mention reclamations, or expert-quote prospects have ever been proposed, and no weekly citation-movement tracking happens. The playbook itself states why this matters: LLM answers route around the adult category and surface brands named in third-party editorial sources, and no on-site loop can earn those slots. Every missing week is up to 6 outreach proposals and one movement report the owner never sees, against the stated AEO/GEO goal. Compounding it, the stale strategy prompt (next finding) means the fleet's self-audit does not flag the gap.

*Evidence:* trigger-inventory.md row 11 (MISSING, never created); docs/store-team/routine-schedule.md:39-40, :89; docs/store-team/routine-offsite-weekly.md:8-16, 49-56, 73-78

*Recommendation:* Create the trigger now (strategy team is enabled and the routine is propose-only by construction); with published notebook posts well past the 5-post floor there is no reason to wait. Add its row to the trigger-ID table in the manifest.

*Verifier correction:* Core claim confirmed: routine 11 (Weekly Off-site Scout) has no cloud trigger and has never run, and zero offsite pitches/reclamations/expert-quote prospects exist. One sub-claim is wrong: the fleet's self-audit DOES flag the gap. The 2026-07-20 strategy run filed homepage_team_suggestions id 61 ("ROUTINE COVERAGE #11 Off-site Scout: 0 homepage_team_runs rows exist for team=offsite, ever... confirm trig existence... or create it"), now status=approved. The gap is flagged but unactioned because trigger creation sits outside every automated executor (the apply pass only writes agent-editor PRs); it needs the owner or a RemoteTrigger-capable session.


**[HIGH] Weekly Strategy trigger prompt omits program-manager and verifies only '7 scheduled routines', disabling the fleet's dead-routine detector (verified)**

The live prompt (updated 2026-07-13) orchestrates inventory-sentinel, promo-manager, loyalty-referral-manager, and product-manager only. program-manager (added 2026-07-11, commit 1550f76, PR #234) is the sub-agent that audits trackers, produces the Program Status brief section, and verifies that each of routines 1-14 posted a run in the last 7 days, filing a process suggestion for any that silently stopped. The prompt also says 'verify each of the other 7 scheduled routines', a pre-expansion fleet count. If the session follows the prompt over the playbook, the brief ships without Program Status and the routine-coverage check either does not run or runs against half the fleet, which is exactly why the never-created routine 11 and the daily-firing podcast trigger have gone undetected. The manifest names this check as the mechanism for reconciling scheduler-vs-manifest drift.

*Evidence:* trigger-inventory.md prompt-drift note 1; docs/store-team/routine-weekly-strategy.md:76-85 (program-manager sub-step + 1-14 coverage check); docs/store-team/routine-schedule.md:6-8, :79; git 1550f76 (2026-07-11)

*Recommendation:* Re-issue the trigger prompt from the manifest row 1 text verbatim (it already includes program-manager and defers to the playbook). Add a standing rule that any playbook/roster change to a scheduled routine requires re-pushing that trigger's prompt in the same PR checklist.

*Verifier correction:* The prompt drift is real but the claimed consequence is not. Live trigger trig_018pSqtCKWC3fxbstN7wQBvs (updated 2026-07-13T16:33Z, after commit 1550f76 of 2026-07-11 added program-manager) verbatim enumerates only "inventory-sentinel, promo-manager, loyalty-referral-manager, and product-manager" and says "verify each of the other 7 scheduled routines", while the manifest (docs/store-team/routine-schedule.md:79) lists 5 sub-steps and the playbook (docs/store-team/routine-weekly-strategy.md:76-85) mandates the 1-14 coverage check. However, the prompt also says to follow the playbook "exactly, start to finish", and the playbook wins in practice: the 2026-07-20 strategy run (run 54) posted 18 program-manager events and its coverage check DID detect the missing routine 11 (homepage_team_suggestions #61, "ROUTINE COVERAGE #11 Off-site Scout: 0 homepage_team_runs rows exist for team=offsite, ever", approved 2026-07-20) plus coverage gaps #14 (#62) and #5 (#60). The dead-routine detector is functioning, and the daily-firing podcast trigger is invisible to it by design (it detects silence, not over-firing), not because of the prompt omission. Downgrade to medium: stale-prompt inconsistency that relies on the session preferring the playbook over the prompt's contradictory enumeration, not a broken detector.


**[HIGH] MCP connector wiring inverted vs the manifest access checklist: required MCPs absent, unrelated personal connectors attached to autonomous triggers (verified)**

The manifest's access checklist requires the GA4 MCP where the agent def lists it and Meta Ads read/insights tools for ads. Live wiring: triggers 1 (store-strategist), 3 (process-optimizer), 7 (homepage-orchestrator, plus homepage-cro), and 8 all declare mcp__google-analytics__* in their entry/sub-agent defs yet have zero MCP connections, so GA4-weighted steps (strategy outcomes read, merchandiser scoreboard, cost review) silently degrade; trigger 4 (ads-manager, 13 named Meta_Ads_MCP tools) also has none, so Meta insights and ads_library_search research cannot run. Conversely triggers 10, 13, and 14 carry 8-11 broad personal connectors (Gmail, Google_Calendar, Google_Drive, SmartSheet, Krisp, Etsy, Meta_Ads, Shopify, Claude_Code_Remote, Vercel, Sanity): pricing-ops and product-manager declare only Read/Bash/Grep/Glob, needing none of these, and these sessions autonomously process untrusted external content (feeds, competitor pages, search results), making a Gmail/Drive connector a live prompt-injection exfiltration and side-effect surface. The podcast-reviewer agent def also omits mcp__Sanity__* from its tools line even though its playbook requires Sanity MCP writes (its trigger does carry Sanity).

*Evidence:* docs/store-team/routine-schedule.md:98-103; trigger-inventory.md table rows 1-14 and prompt-drift note 3; .claude/agents/store-strategist.md:4, homepage-orchestrator.md:4, homepage-cro.md:4, process-optimizer.md:4, ads-manager.md:4, pricing-ops.md:4, product-manager.md:4, podcast-reviewer.md:4

*Recommendation:* Rebuild each trigger's connector list to exactly what its entry-agent def declares: add google-analytics to 1/3/7/8 and Meta Ads read tools to 4; strip everything except Vercel (and Shopify where the playbook reads Storefront data) from 13 and 14, and trim 10 to Sanity + Vercel like trigger 9. Add mcp__Sanity__* to podcast-reviewer's tools line.

*Verifier correction:* Claim confirmed with two minor precision fixes: (1) the merchandiser's "yesterday's scoreboard" step (routine-daily-merchandise.md:143-144) is documented against getHomepageSignals() in app/lib/ga4.server.ts, a repo-side GA4 Data API lib that by design returns zeroed signals on failure, so that one step has a non-MCP path (if the cloud env carries the service-account vars); the MCP dependency the missing connector breaks is the Step 2 GA4 read (routine-daily-merchandise.md:118-119) plus the strategy outcomes read (routine-weekly-strategy.md:47-48) and cost review (improvement-loop.md:14). (2) Of the 11 connectors on triggers 10/14 (8 on 13), four are business-scoped (Shopify, Sanity, Vercel, Meta_Ads) rather than personal, but Gmail, Google_Calendar, Google_Drive, SmartSheet, Krisp, and Etsy are genuinely unrelated, and none of the 11 are declared in the pricing-ops or product-manager tool lines (both Read/Bash/Grep/Glob only). The core inversion, the ads-manager Meta gap, and the podcast-reviewer Sanity omission are all exactly as claimed.


**[MEDIUM] Run-cap requirement (strategy=3, content=3) lives only in manifest prose and an unversioned DB edit; playbook and migration still say 2**

The manifest (2026-07-21) states strategy_team_max_runs and content_team_max_runs must be 3 and documents that cap 1 made the Monday Apply Pass and Cost Review skip over_run_cap for weeks (runs 28/58), which is why no approved suggestion ever became a PR. But no migration records the correction: 054 seeds content_team_max_runs='2', code defaults are strategy 1 / content 2 with the comment '2nd run = one voice-gate retry', and the content playbook still tells the routine the gate enforces content_team_max_runs (2). Any DB reseed, new environment, or an agent trusting the playbook reverts to the broken Monday behavior; and the correction landed 2026-07-21, one day AFTER this week's Monday runs, so the 2026-07-20 apply pass likely still skipped.

*Evidence:* docs/store-team/routine-schedule.md:42-49; db/migrations/054_enable_content_team.sql:15; app/lib/team-keys.ts:76-77; docs/store-team/routine-content-daily.md:38-39

*Recommendation:* Add a migration (065) seeding strategy_team_max_runs='3' and content_team_max_runs='3' with the rationale in the header, and fix the (2) in routine-content-daily.md Step 1 plus the team-keys.ts comment.


**[MEDIUM] homepage_team_build_cents is never enforced; the Design Cycle's 'separate allowance' is fiction and its spend eats the daily merchandising budget**

routine-design-cycle.md promises 'its own turn cap and homepage_team_build_cents allowance (separate from the daily $ cap)'. In code, buildCents is read into config and rendered as an admin form field, but gate() never checks it: the only budget test is remainingCents from dailyCents minus spend WHERE feature LIKE 'homepage-%'. Design-cycle images log feature homepage-images, so on Wednesdays Routine B's generations draw down the same daily cap and 12-image cap as Routine A, and a heavy design cycle can starve the merchandiser (or vice versa) while the owner believes a separate build budget protects them.

*Evidence:* docs/homepage-team/routine-design-cycle.md:11-13, 132-135; app/lib/team.server.ts:200-211, 308-347 (gate, no buildCents reference); app/routes/admin.homepage-team.tsx:253 (display only)

*Recommendation:* Either enforce buildCents in gate() for runType 'design' (spend WHERE feature IN ('homepage-design'/'homepage-build')), or delete the buildCents key/field and rewrite the playbook to say design shares the daily cap, so docs and code agree.


**[MEDIUM] Spend feature-label drift: manifest 'homepage-build' vs playbook 'homepage-design', and the podcast playbook logs no spend at all**

Budget attribution and the admin dashboard key off raw feature labels: gate() sums feature LIKE '{team}-%' and /admin/usage groups per exact feature string. The manifest labels routine 8 'homepage-build' while its playbook instructs feature:'homepage-design', so design spend fragments into different dashboard rows depending on which text the session followed (both still hit the homepage budget). Separately, routine-podcast-weekly.md contains no spend-logging step at all, violating the manifest's common skeleton ('log spend ... under the team's feature label') and leaving the manifest's content-podcast label unused anywhere, so the Cost Review routine and /admin/usage never see that routine's token counts. All other labels (strategy-weekly/apply/cost-review/offsite, ads-planning, email-planning, social-drafts, content-blog, content-seo-curation, product-daily) correctly carry their team prefix.

*Evidence:* docs/store-team/routine-schedule.md:73, :86, :90; docs/homepage-team/routine-design-cycle.md:132; docs/store-team/routine-podcast-weekly.md (steps 0-6, no spend call); app/lib/team.server.ts:204-206; app/routes/admin.usage.tsx:63-70

*Recommendation:* Pick one design label (homepage-build, matching the manifest) and fix the playbook; add a Step 6 spend call with feature content-podcast to the podcast playbook.


**[MEDIUM] runType values make content-team routines indistinguishable and routine 13 unverifiable, hollowing out the routine-coverage check**

The weekly-strategy playbook has program-manager verify each of routines 1-14 'posted a run in the last 7 days (homepage_team_runs)'. But within team=content, the podcast playbook itself starts runs with runType 'manual', and the live SEO curation trigger prompt also uses runType 'manual' despite its playbook specifying 'seo-curation', so podcast runs, curation runs, and dashboard-fired manual runs are indistinguishable, and per-routine coverage cannot actually be computed. Worse, routine 13 (Daily Pricing Sweep) runs with no team gate and never posts a run row by design ('ops (no team gate) / n/a'), so the 1-14 check will either perpetually report it missing or the checker learns to ignore gaps, defeating the purpose. The legacy /api/homepage-team/run also coerces any unknown runType to 'merchandise' while /api/team/run accepts any <=24-char string, verified as the only behavioral difference between the two endpoint families (homepage-team.server.ts is a shim delegating every gate/cap/budget check to team.server.ts with team='homepage').

*Evidence:* docs/store-team/routine-weekly-strategy.md:82-85; docs/store-team/routine-podcast-weekly.md:17; docs/store-team/routine-seo-curation.md:34; trigger-inventory.md prompt-drift note 6; docs/store-team/routine-schedule.md:91; app/routes/api.homepage-team.run.tsx:18; app/routes/api.team.run.tsx:20; app/lib/homepage-team.server.ts:1-82

*Recommendation:* Give every routine a unique runType (podcast, seo-curation) in both playbook and trigger prompt; have routine 13 post a minimal ops run row (or exempt it explicitly in the coverage-check text) so 'missing' is meaningful.


**[MEDIUM] Content playbook appendix still instructs that the desktop scheduled task is the schedule, contradicting the manifest's delete order**

routine-content-daily.md's enablement runbook step 5 says the desktop task xdipx-daily-content-writer 'already exists on the owner's machine and fires daily at 8am local Pacific ... unlike the cloud triggers for routines 1-8'. The manifest supersedes this: routine 9 is cloud trigger trig_01Qf5puo6AZyJqWn9QHN5mxQ since 2026-07-13 and the owner 'should delete that desktop task so the routine can't double-fire (the gate's run cap would otherwise let a second run write a second post)'. An operator or agent-editor following the binding playbook appendix would keep or recreate the desktop task, reintroducing the double-post risk the manifest explicitly warns about.

*Evidence:* docs/store-team/routine-content-daily.md:231-235; docs/store-team/routine-schedule.md:13-20, :33, :87

*Recommendation:* Rewrite appendix step 5 to reference the cloud trigger and state the desktop task must not exist; this is a one-paragraph agent-editor-eligible doc fix.


**[MEDIUM] Merchandiser/Design/Social trigger prompts predate the design doctrine and omit the mandatory doctrine read**

The manifest's common skeleton (binding prompt shape) says runs that produce or place imagery, graphics, or visual layout additionally read docs/design-doctrine.md ('binding on pixels'). The live prompts for triggers 6, 7, and 8 were written 2026-07-13, before the doctrine landed (#258, 2026-07-16), and per the inventory none instruct reading it; the merchandiser prompt names only emma-voice + mission brief. The playbooks do reference the doctrine heavily (archetype table, ground lock), so the drift bites only when a session weighs the prompt over the playbook, but archetype/ground-lock violations are exactly the class of defect the doctrine gate exists to stop, and prompts are the first thing every fresh session reads.

*Evidence:* docs/store-team/routine-schedule.md:66-67; trigger-inventory.md prompt-drift note 2; docs/homepage-team/routine-daily-merchandise.md:192-215 (doctrine 4 rules present in playbook)

*Recommendation:* Re-issue trigger prompts 6, 7, 8 from the manifest skeleton so the doctrine clause is present at the prompt layer too.


**[MEDIUM] Model selection undocumented and misaligned: manifest has no model column, mechanical routines run Opus, agent defs pin Sonnet**

All 13 triggers run claude-opus-4-8 except Daily Pricing Sweep on claude-sonnet-5, and the manifest records none of this (no model column anywhere). The entry-agent defs disagree with the trigger models: content-writer, social-media-manager, product-manager, podcast-reviewer, and seo-curator all declare model: sonnet yet their routines run Opus sessions daily/weekly, and the product routine's own playbook says it 'spends no AI tokens (SQL sweep + one bulk curl per intent)', making a daily Opus session pure Max-quota burn. The sonnet-5 choice for pricing looks like the right pattern applied to exactly one routine.

*Evidence:* trigger-inventory.md table (model column) and prompt-drift note 5; docs/store-team/routine-schedule.md:77-92 (no model field); .claude/agents/content-writer.md:5, social-media-manager.md:5, product-manager.md:5, podcast-reviewer.md:5, seo-curator.md:5 (model: sonnet); docs/store-team/routine-product-daily.md:11-12

*Recommendation:* Add a model column to the manifest as source of truth; downgrade at least routines 6, 9, 12, 13-pattern, and 14 to a Sonnet-class model to protect Opus quota for strategy/design work.


**[LOW] seo_curation_enabled valve has no server-side enforcement and the playbook's suggested read path does not exist**

The curation playbook's Step 0 tells the routine to read the valve 'via the settings the gate returns', but GateResult exposes only the content autopublish valve (valves: { autopublish }); seo_curation_enabled is enforced nowhere in the gate or route code, only by playbook honor. The parallel valve for agent-editor (suggestion_apply_enabled) has the same honor-system shape but is at least accurately documented.

*Evidence:* docs/store-team/routine-seo-curation.md:15-27; app/lib/team.server.ts:296-301, 315-338 (only contentAutopublish read into valves); app/lib/team-keys.ts:142-149

*Recommendation:* Either return seoCuration in the content GateResult valves (one-line addition next to autopublish) and point the playbook at it, or correct the playbook to name the repo-script read path only.


**[LOW] Housekeeping drift: ~15 dead one-shot triggers, skeleton vs legacy homepage endpoints, stale model string in playbook spend example**

Three polish items: (a) ~15 fired/disabled send_later triggers from 2026-07-12 PR babysitting clutter the trigger list that RemoteTrigger maintenance operates on; (b) the manifest's common skeleton says every routine starts via POST /api/team/run with a team param, but routines 7/8's playbooks use the legacy /api/homepage-team/* family (verified equivalent via the shim, so this is doc inconsistency only); (c) routine-daily-merchandise.md's Step 6 spend example hardcodes model claude-sonnet-4-6 while the sessions run claude-opus-4-8, so spend rows misreport the model (cost impact zero: source agent-sdk prices to $0 in estimateCostUsd).

*Evidence:* trigger-inventory.md:23-24; docs/store-team/routine-schedule.md:68-73 vs docs/homepage-team/routine-daily-merchandise.md:26-33; docs/homepage-team/routine-daily-merchandise.md:318; app/lib/model-pricing.server.ts:23

*Recommendation:* Delete the dead one-shots in the next RemoteTrigger session; add one sentence to the skeleton noting homepage uses the legacy endpoint family; change the example model string to a placeholder.


### Agent definition consistency across .claude/agents/*.md

The 38 agent definitions (task brief said 39; the directory holds 38) are in good shape structurally: every valve and kill-switch name they cite resolves to a real pipeline_settings key or the teamKeys() template, all suggestion kinds are valid per api.team.suggestion.tsx, spend feature labels correctly map to teams via teamFromFeature(), no hardcoded model id is outdated (claude-sonnet-4-6 matches), and the propose-only/draft-only/plan-only stubs are consistently and explicitly worded. The two serious problems are both on the build-and-gate path: rr7-engineer, the agent that writes all storefront code, still carries v2-era brand rules (cream backgrounds, Archivo/Inter fonts, "No purple") that directly contradict the v3 tokens and design doctrine v1.1, and never references the doctrine even though the doctrine names it as a required reader; and the three preview-dependent agents (design-critic, qa-reviewer, homepage-designer) reference an MCP server (Claude_Preview) and nine preview_* tool names that exist nowhere in the repo or current tooling, which can dead-end the mandatory Routine B design gate. A cluster of medium voice-charter drift exists: two agents told to load nonexistent "email"/"social" charter addenda, the voice gate's own canonical example containing an em-dash it is supposed to BLOCK, and customer-service-emma citing a missing file and a discount-minting power no code supports. Everything else is polish-level version-label and cap-number drift.


**[HIGH] rr7-engineer's brand rules are two design generations stale and it never loads the design doctrine (verified)**

rr7-engineer is the only agent that writes production storefront code, yet its critical_rules mandate v2-era visuals: 'Use bg-cream', 'Flat coral or coral-on-cream', 'No purple' (plum #7A2BB8 IS the v3 emphasis color), and 'font-display (Archivo) / font-body (Inter)' when the shipped fonts are Newsreader and DM Sans. app/app.css explicitly marks cream/sun/butter as legacy aliases not to be used in new code, and docs/design-doctrine.md's header names rr7-engineer as a design agent that 'loads this file before ... building', but rr7-engineer.md contains zero reference to docs/design-doctrine.md or the v3 token names. Every Routine B build cycle risks shipping deprecated tokens, wrong fonts, and suppressing legitimate plum usage.

*Evidence:* .claude/agents/rr7-engineer.md lines 18-21 (bg-cream, coral-on-cream, 'No purple', Archivo/Inter) vs app/app.css lines 16-20 & 51-52 (cream = legacy alias) and lines 62-63 (Newsreader/DM Sans); docs/design-doctrine.md lines 3-5 ('Every design agent (homepage-designer, rr7-engineer, the future design-critic) ... loads this file'); grep shows only design-critic.md, homepage-designer.md, media-manager.md reference design-doctrine.

*Recommendation:* Rewrite rr7-engineer's brand-token block to the v3 palette (paper/ink/coral/plum/sage, Newsreader/DM Sans) and add the same binding docs/design-doctrine.md read-first clause the other visual agents carry.

*Verifier correction:* Confirmed as stated, with two peripheral softenings: (1) "only agent that writes production storefront code" is slightly loose since homepage-designer also has Write/Edit tools, though rr7-engineer is the designated builder for every [shell-PR] in Routine B docs (routine-design-cycle.md:90, competitor-teardown-2026-07-live.md:98-118); (2) rr7-engineer's workflow step 1 does instruct reading CLAUDE.md, which carries the v3 token table, so a run may partially self-correct, but its critical_rules ("No purple", bg-cream, Archivo/Inter) then directly contradict CLAUDE.md and app.css, which is the drift claimed.


**[HIGH] design-critic, qa-reviewer, and homepage-designer reference a preview MCP (mcp__Claude_Preview__*) and tool names that do not exist anywhere (verified)**

All three defs list mcp__Claude_Preview__* in their tools frontmatter, and qa-reviewer's workflow names nine specific tools (preview_eval, preview_console_logs, preview_network, preview_snapshot, preview_inspect, preview_click, preview_fill, preview_resize, preview_screenshot). No repo config (.mcp.json, .claude/settings) defines a Claude_Preview server, the only occurrences of the string in the entire repo are these three agent files, and the current browser tooling (Claude_Browser) exposes differently named tools (preview_start/preview_logs/navigate/computer/read_page/etc.). design-critic is the mandatory design gate in Routine B and its own rules say 'If you cannot obtain a screenshot, STOP and report; never score from code or memory', so an unresolvable toolset either blocks every design cycle or silently degrades the gate. qa-reviewer similarly downgrades to BLOCKED-ON without preview evidence.

*Evidence:* grep -rln 'Claude_Preview' returns only .claude/agents/qa-reviewer.md, homepage-designer.md, design-critic.md (no .mcp.json or settings hit); qa-reviewer.md lines 22-31 (preview_eval/preview_snapshot/preview_click/preview_fill/preview_inspect etc.); design-critic.md line 20 ('If you cannot obtain a screenshot, STOP').

*Recommendation:* Verify which MCP server name the cloud-routine and local environments actually expose, then update the three defs' tools lines and qa-reviewer's step-by-step tool names to the real toolset (or a tool-agnostic 'capture screenshots at 375/768/1440' instruction).

*Verifier correction:* Claim confirmed with one addition and one nuance. Addition: the dangling reference extends beyond repo config, ~/.claude.json (global mcpServers: only Sanity; xdipx_store project entry: only google-analytics) and ~/.claude/settings*.json define no Claude_Preview server either, so the namespace resolves nowhere at any config level. Nuance: an unmatched tools pattern in agent frontmatter fails silently (the subagent simply lacks those tools) rather than erroring, and all three agents also carry Bash, so a scripted-screenshot workaround is possible in principle; the realistic failure mode is design-critic honoring its line-20 STOP rule (blocking the Routine B gate at docs/homepage-team/routine-design-cycle.md:106) or reviewers proceeding without preview evidence (qa-reviewer BLOCKED-ON path). qa-reviewer.md:23-32 actually names ten preview_* references (the cited nine plus preview_start).


**[MEDIUM] email-marketing-manager and social-media-manager are told to load charter addenda that do not exist**

docs/emma-voice.md v5 defines exactly five channel addenda: marketing, enrichment, conversational, support, blog. email-marketing-manager says 'Read docs/emma-voice.md (plus its email channel addendum)' and social-media-manager says 'plus its social channel addendum', neither addendum exists; both channels are covered by the 'Marketing and advertising' addendum. emma-copywriter gets it right ('Marketing and advertising for campaigns, ads, and email'). An agent searching for a nonexistent addendum either wastes turns or skips addendum rules entirely, and the marketing addendum carries load-bearing rules for these exact channels (transactional email dialed 2-3, first-touch surfaces pulled back to 5-7).

*Evidence:* .claude/agents/email-marketing-manager.md line 16 ('email channel addendum'); .claude/agents/social-media-manager.md line 16 ('social channel addendum'); docs/emma-voice.md lines 121-173 (addendum markers: marketing/enrichment/conversational/support/blog only).

*Recommendation:* Change both defs to name the 'Marketing and advertising' addendum explicitly, mirroring emma-copywriter's wording.


**[MEDIUM] The voice gate's own canonical example output contains an em-dash it is required to BLOCK, and its CTA whitelist is missing a v5 entry**

emma-empathy-reviewer principle 12 says 'BLOCK any string containing' U+2014, yet the def's canonical BLOCK-example suggested rewrite is: "This one keeps coming up for what you described. {name}, {pdpUrl}. It's {price}. Does this feel like the one?", a literal em-dash inside a template the gate is modeling its rewrites on ('keeps coming up' also brushes the charter's banned 'keep(s) coming back to' tic family). Separately, principle 14 lists the CTA whitelist as 'Take a peek →', 'Show me', 'I'll take it ♥' while the v5 charter whitelist also includes 'Find your fit →', the gate could wrongly flag charter-compliant copy.

*Evidence:* .claude/agents/emma-empathy-reviewer.md line 69 (principle 12), line 94 ('{name}, {pdpUrl}' with U+2014), line 73 (principle 14, three CTAs); docs/emma-voice.md line 88 (banned tics) and line 99 (four-CTA whitelist including 'Find your fit →').

*Recommendation:* Fix the line-94 example to use a period or comma instead of the em-dash and a non-tic-adjacent phrasing, and add 'Find your fit →' to principle 14.


**[MEDIUM] customer-service-emma cites a nonexistent module and claims a discount-code power no code supports, contradicting promo-manager**

customer-service-emma's authorized_actions point at 'patterns in app/lib/shopify.server.ts, app/lib/customer-api.server.ts, app/lib/draft-orders.server.ts', draft-orders.server.ts does not exist (draft-order logic lives in shopify.server.ts, app/lib/ai-agent/tools.server.ts, and app/routes/admin.phone-orders.tsx). It also authorizes 'Discount codes up to 20% off a single order as a goodwill gesture', but no discount-code/priceRule creation code exists anywhere in shopify.server.ts, customer-api.server.ts, or tools.server.ts, and promo-manager's def states flatly that 'Nothing in the codebase can mint a Shopify discount code today; the owner creates approved codes manually'. Two defs directly contradict each other about a customer-facing capability.

*Evidence:* ls: app/lib/draft-orders.server.ts MISSING; grep for discountCode/priceRule in app/lib/shopify.server.ts, app/lib/ai-agent/tools.server.ts, app/lib/customer-api.server.ts returns nothing; .claude/agents/customer-service-emma.md lines 25-32; .claude/agents/promo-manager.md line 3.

*Recommendation:* Update customer-service-emma's file list (customer-api.server.ts + tools.server.ts + admin.phone-orders.tsx), and either remove the discount-code authorization or reword it as 'flag for the owner to mint' until a code path exists.


**[MEDIUM] Voice-gate underlap: five agents mandate emma-empathy-reviewer for marketing copy the reviewer's own scope never claims**

ads-manager, email-marketing-manager, social-media-manager, merch-calendar, and promo-manager all route ad copy, subject lines, social drafts, and promo copy through emma-empathy-reviewer as a mandatory gate. The reviewer's scope section lists only SMS/chat template banks, ai-agent prompts, homepage merchandising copy, and blog drafts, and its 16 binding principles are conversational-shaped (one question per reply, explainer closers, gate-suspension on vulnerability) with no criteria for ad/email/social surfaces (e.g. the marketing addendum's paid-ads 3-4 register rule or transactional-email 2-3 rule). The gate will still catch charter basics, but there is no defined rubric for the surfaces it is most often invoked on by other teams, so verdicts on marketing copy are improvised.

*Evidence:* .claude/agents/emma-empathy-reviewer.md lines 16-37 (scope; excludes 'Marketing copy on PDPs', never mentions ads/email/social) vs ads-manager.md line 44, email-marketing-manager.md line 16 & 44, social-media-manager.md lines 16 & 44, merch-calendar.md line 41, promo-manager.md line 38 (all mandate the gate).

*Recommendation:* Extend the reviewer's scope with an explicit marketing-surface section (subject lines, ad copy, social drafts) keyed to the charter's marketing addendum register rules, so the gate the other defs rely on is actually specified.


**[MEDIUM] Autonomy underlap documented inside the defs: support email and log monitoring have no autonomous owner**

customer-service-emma's autonomy_note says it is 'invoked interactively, a human pastes the email into the conversation' with the IMAP/webhook pipeline unbuilt, and log-monitor's autonomy_note says 'Currently invoked interactively. Once an autonomous poller is built ...'. Both defs are honest, but for a store whose stated goal is fully autonomous day-to-day management, two operationally critical jobs (inbound customer support at hello@xdipx.com, production error sweeps) run only when a human remembers to trigger them. customer-service-emma also acts directly (refunds, cancellations) with no kill switch or cap, unlike the carefully-bounded product-manager carve-out, a gap that will matter the day the autonomous pipeline is wired.

*Evidence:* .claude/agents/customer-service-emma.md lines 87-89 (autonomy_note); .claude/agents/log-monitor.md lines 79-81 (autonomy_note); contrast .claude/agents/product-manager.md lines 17-23 (kill switch + per-run cap pattern).

*Recommendation:* Track the support-email and log-sweep pipelines as roadmap items with owners, and pre-add a customer_service_enabled-style valve + refund cap to customer-service-emma's def before it ever runs unattended.


**[LOW] homepage-designer and homepage-ia cite 'the v4 Emma-placement rule' though the charter is v5**

Both defs say 'Note the v4 Emma-placement rule: no Emma top billing on the homepage hero.' The rule survived into v5 (charter line 80), so the content is correct but the version label is stale and could cue an agent to consult a superseded charter version.

*Evidence:* .claude/agents/homepage-designer.md line 14 and .claude/agents/homepage-ia.md line 14 vs docs/emma-voice.md line 1 ('Voice Charter (v5)') and line 80 (placement rule).

*Recommendation:* Drop the version number: 'the charter's Emma-placement rule'.


**[LOW] nalpac-feed-analyst references app/lib/deal-activator.server.ts, which no longer exists**

The def's workflow says to read 'feed-processor.server.ts, deal-pipeline.server.ts, deal-activator.server.ts, or deal-rotator.server.ts'. deal-activator.server.ts is absent from app/lib (the activator logic lives in deal-pipeline.server.ts / server/cron.ts; deal-rotator.server.ts exists). CLAUDE.md's file map carries the same stale entry.

*Evidence:* .claude/agents/nalpac-feed-analyst.md line 27; ls app/lib shows deal-pipeline.server.ts and deal-rotator.server.ts but no deal-activator.server.ts; grep 'deal-activator' hits only app/lib/deal-pipeline.server.ts and server/cron.ts (the /cron/deal-activator route).

*Recommendation:* Replace the filename with deal-pipeline.server.ts (and fix the same line in CLAUDE.md's file map).


**[LOW] content-writer states content_team_max_runs = 2, but the scheduling doctrine now requires 3**

content-writer.md says 'Runs: content_team_max_runs (2; the second run exists only to retry a voice-gate REVISE)'. routine-schedule.md (2026-07-21) mandates the value be 3 because SEO curation and podcast review share the content team's run cap on Sundays/Wednesdays, so both the number and the rationale in the def are stale. The gate enforces the real value regardless, but agent-editor edits and run-summary reasoning key off the def's text.

*Evidence:* .claude/agents/content-writer.md line 28 vs docs/store-team/routine-schedule.md lines 47-49 ('content_team_max_runs must be 3'); app/lib/team-keys.ts TEAM_DEFAULTS content: maxRunsPerDay 2 (code default, DB-overridden).

*Recommendation:* Update the parenthetical to '(3, shared with seo-curator and podcast-reviewer; extra headroom is the voice-gate retry)'.


**[LOW] product-manager.md ends with a stray unmatched </output> tag**

The file closes with </output_format> followed by an orphan </output> tag with no opening counterpart, a copy-paste remnant that slightly malforms the prompt every daily product run loads.

*Evidence:* .claude/agents/product-manager.md final lines: '</output_format>' then '</output>' (tail -3).

*Recommendation:* Delete the trailing </output> line.


**[LOW] podcast-reviewer (and the agent-editor apply pass) log no spend, so /admin/usage undercounts their teams**

Every other cloud routine's def carries an explicit 'Log usage: POST /api/homepage-team/spend {... feature:...}' step with a {team}-prefixed label that teamFromFeature() attributes to the team. podcast-reviewer's def and docs/store-team/routine-podcast-weekly.md contain no spend step at all, and routine-agent-editor.md likewise has none. process-optimizer's inputs assume 'every team logs under its {team}-* feature labels', so these runs are invisible to the cost-review loop.

*Evidence:* .claude/agents/podcast-reviewer.md (no spend/feature mention; grep 'spend' in docs/store-team/routine-podcast-weekly.md returns nothing); grep 'spend' docs/store-team/routine-agent-editor.md returns nothing; app/lib/team-keys.ts lines 40-45 (teamFromFeature prefix mapping); .claude/agents/process-optimizer.md line 19.

*Recommendation:* Add a spend-log step (e.g. feature 'content-podcast' and 'strategy-apply') to both defs/playbooks.


**[LOW] social-media-manager selects imagery with no reference to the design doctrine or ground lock**

The audit brief lists social-media-manager among the visual agents expected to reference docs/design-doctrine.md. Its def requires a real mediaUrls asset on every IG/TikTok draft and lets it choose reused assets itself ('best reusable asset' when budget is out), but never mentions the doctrine, the §4 archetypes, or the coral-soft/plum-soft/paper ground lock. media-manager gates new generations, but reused-asset selection by social is un-doctrined, so an off-doctrine legacy asset can ship in a draft the owner reviews.

*Evidence:* .claude/agents/social-media-manager.md (zero hits for 'design-doctrine'; imagery rules at lines 45); grep shows only design-critic.md, homepage-designer.md, media-manager.md cite the doctrine; docs/design-doctrine.md §4 lines 167+ (ground lock at line 225).

*Recommendation:* Add one line to social-media-manager's imagery step: reused assets must satisfy doctrine §4 (archetype + ground lock); when in doubt, ask media-manager to judge.


### Technical SEO readiness for Google indexing

The technical SEO foundation is genuinely strong: robots.txt, a well-formed 4,501-URL sitemap, correct canonicals, one Product JSON-LD node per PDP (the July duplicate-node fix is holding), sensible noindex handling (crawl+noindex for /search, noindex only on truly-gone 404/410 pages, faceted collection variants noindexed with canonicals to the bare URL), and clean 301s for retired routes. The mid-July Googlebot concern is resolved at origin: the homepage serves identical 200 HTML to Googlebot and browsers (byte-identical in testing), with only the correct platform-level www/http 308s remaining. The last two weeks of perf PRs (#295, #304-#307) all reduce LCP/payload risk and were verified as SSR-safe. The two real gaps are automation-shaped: the IndexNow push channel is fully built and wired into deal rotation and blog publishing but dead in production (key file 404s, so every ping silently no-ops), and the image-sitemap builder still assumes a ~500-product catalog while the import automation has grown it to 4,259, leaving roughly three-quarters of PDPs without image sitemap entries. No sampled PDP emits aggregateRating, so no product can earn star rich results yet.


**[HIGH] IndexNow push pipeline is built and wired but dead in production (verified)**

pingSearchEngines() is called after every deal rotation (app/lib/deal-rotator.server.ts:451-452), every Sanity blog publish webhook (app/routes/api.webhooks.sanity-publish.tsx:73-74), and blog revalidation (app/routes/api.revalidate.blog.tsx:42-43). But the function returns immediately unless SEARCH_PING_ENABLED === 'true' and warns-and-skips without INDEXNOW_API_KEY (app/lib/search-ping.server.ts:18-29). The key file route returns 404 when INDEXNOW_API_KEY is unset (app/routes/[indexnow.txt].tsx:19-21), and live https://xdipx.com/indexnow.txt returns 404, proving the key is not set in prod. Neither var appears in the local .env either. The content team publishes a Notebook post daily expecting fast discovery; Bing/Yandex (and the AI answer engines that ride Bing's index) get no push at all, silently, which cuts directly against the AEO/GEO goal.

*Evidence:* curl -s -o /dev/null -w '%{http_code}' https://xdipx.com/indexnow.txt → 404; app/lib/search-ping.server.ts:18 (SEARCH_PING_ENABLED gate), :25-29 (key-missing skip); app/lib/deal-rotator.server.ts:451; app/routes/[indexnow.txt].tsx:16-21

*Recommendation:* Generate an IndexNow key, set INDEXNOW_API_KEY and SEARCH_PING_ENABLED=true in the Vercel production environment, confirm https://xdipx.com/indexnow.txt returns the key, then watch for '[search-ping] IndexNow 200' log lines after the next midnight rotation and blog publish.


**[MEDIUM] Image sitemap builder caps at 1,000 products against a 4,259-product sitemap**

getProductImagesForSitemap() paginates at most 4 pages x 250 products, with a stale comment reading 'Two pages = up to 500 products, plenty of headroom for the current catalog' (app/lib/shopify.server.ts, function starting line 1251, loop 'for (let page = 0; page < 4; page++)'). The live sitemap contains 4,259 /products/ URLs but only 2,622 <image:loc> entries total (~2.6 images each across at most 1,000 products), so roughly 3,250 PDPs carry no image sitemap data. The import automation grew the catalog roughly 8x past this function's design ceiling and nobody re-sized it; whichever 1,000 products Shopify returns first get image annotations, the rest are invisible to Google Images via the sitemap.

*Evidence:* app/lib/shopify.server.ts:1251 onward ('page < 4', 'first: 250', stale 'plenty of headroom' comment); live sitemap.xml: 4,501 <loc> entries (4,259 products) vs 2,622 <image:loc> entries

*Recommendation:* Raise the pagination bound to cover the full catalog (loop on hasNextPage with a generous safety cap, e.g. 25 pages), keep the 1-hour KV cache, and update the stale comment. Verify <image:image> count roughly tracks product count after deploy.


**[MEDIUM] No sampled product emits aggregateRating, so no PDP can earn star rich results**

ProductStructuredData only emits aggregateRating when deal.rating.count > 0 (app/components/seo/ProductStructuredData.tsx:156-164), which is correct, but across 5 live PDPs sampled (including the two homepage hero/featured products, which get the most crawl attention) none carried aggregateRating. The reviews automation (invites, admin review queue, PR stack #220-#227) exists precisely to fill this; either no reviews have been approved yet or the aggregate is not reaching the PDP loader. Until ratings flow, the whole 4,259-product catalog competes in SERPs without stars while the structured-data plumbing sits ready.

*Evidence:* Live JSON-LD on https://xdipx.com/products/gaia-eco-slimline-vibrator, /products/intense-wand-vibrator, /products/the-shimmy-mint (aggregateRating: absent in all); app/components/seo/ProductStructuredData.tsx:156-164

*Recommendation:* Check the reviews pipeline end-to-end (are review invites sending, are approved reviews landing in getProductAggregate's source table) and confirm at least the homepage-featured products show aggregateRating in their Product node once real reviews exist. Never fabricate ratings per design-doctrine section 6.


**[LOW] priceValidUntil claims every catalog price expires tonight**

getTodayMidnightISO() stamps priceValidUntil = today 23:59:59 UTC on every Offer for all ~4,259 products (app/components/seo/ProductStructuredData.tsx:4-8, used at :80,:91). That daily-deal semantic is wrong for the static catalog: any crawl of edge-cached or next-day HTML sees a priceValidUntil in the past, which surfaces as recurring 'priceValidUntil in the past' warnings in GSC's Merchant listings report and adds noise to the exact report the automation is supposed to keep clean. Confirmed live: sampled PDPs crawled 2026-07-22 22:39 UTC carried priceValidUntil 2026-07-22T23:59:59.000Z.

*Evidence:* app/components/seo/ProductStructuredData.tsx:4-8,80; live Product JSON-LD on /products/intense-wand-vibrator showing priceValidUntil 2026-07-22T23:59:59.000Z

*Recommendation:* Only emit priceValidUntil for genuinely time-boxed deal pricing (live daily deal); omit it for regular catalog offers, or set it to a far-future rolling date (e.g. +30d) if the field is wanted for sale annotations.


**[LOW] Sitemap comment claims /new is 'deliberately noindex' but the route is indexable when stocked**

[sitemap.xml].tsx:116-118 justifies dropping /new from the sitemap because it is 'deliberately noindex (churning daily inventory)'. The route actually only adds noindex when it has zero products (app/routes/_layout.new.tsx:52-55), and the live page currently serves with a self-canonical and no robots meta (verified 2026-07-22). The behavior (indexable but unsubmitted, discovered via nav links) is defensible, but the comment misstates policy, and future maintainers or the agent team could 're-fix' either side based on the wrong premise.

*Evidence:* app/routes/[sitemap.xml].tsx:116-118 vs app/routes/_layout.new.tsx:52-55; live curl of https://xdipx.com/new shows canonical, zero 'noindex' occurrences

*Recommendation:* Either correct the sitemap comment to 'indexable but unsubmitted (churning inventory makes lastmod meaningless)' or, if index-when-stocked is the policy, re-add /new to the sitemap with lastmod = newest arrival date.


**[LOW] Blanket changefreq=daily / priority=0.9 on all 4,259 products contradicts actual lastmod**

Every product entry gets changefreq 'daily' and priority '0.9' (app/routes/[sitemap.xml].tsx:143-144), but live lastmod distribution shows most of the catalog untouched since the May import (2,128 URLs at 2026-05-16, 1,197 at 2026-05-17; only ~850 touched in the last two days). Google largely ignores changefreq/priority, but lastmod is the store's ONLY Google discovery push (search-ping.server.ts:8-10 deliberately skips Google), so keeping the sitemap's freshness signals honest is what the whole discovery design leans on. Products at 0.9 also equal the nav-destination tier, flattening the intended hierarchy.

*Evidence:* app/routes/[sitemap.xml].tsx:143-144; live sitemap lastmod histogram (2,128 x 2026-05-16, 1,197 x 2026-05-17, 719 x 2026-07-21); app/lib/search-ping.server.ts:8-10

*Recommendation:* Set product changefreq to 'weekly' and priority ~0.7 (below nav tier), keeping lastmod from Sanity _updatedAt as the real freshness signal.


**[LOW] No automated Core Web Vitals regression monitoring behind the perf sprint**

PRs #295 (7c873f3), #304 (48f5e04), #305 (a1b4ada), #306 (9b191b9), #307 (534f7da) are a coherent, well-executed LCP campaign (payload 3.3MB to 1MB, Sentry off the critical graph, right-sized srcsets, lean card streams, 300s edge cache), all diff-reviewed as SSR-safe with no hidden-content or CLS risk. But the 'mobile scored 65, LCP 5.2s' trigger came from a manual PageSpeed run, and the only CWV reference in automation docs is a tracker note (docs/store-team/trackers/design-elevation.md); no lighthouse/PSI/CrUX check exists in scripts/, server/, or app/lib/. For a store meant to run unsupervised, the next regression (a heavy homepage-team image swap, a new modulepreload) goes unnoticed until rankings or a human notice.

*Evidence:* git show 7c873f3 / 48f5e04 / a1b4ada / 9b191b9 / 534f7da; grep for pagespeed|lighthouse|crux across scripts/, server/, app/lib/ matches only docs/store-team/trackers/design-elevation.md

*Recommendation:* Add a weekly cron hitting the PageSpeed Insights API (free key) for / , one PDP, and one collection page, storing LCP/CLS/INP and alerting into the existing owner-digest when mobile LCP regresses past a threshold.


**[LOW] Trailing-slash product URLs serve 200 duplicates instead of redirecting**

https://xdipx.com/products/gaia-eco-slimline-vibrator/ (trailing slash) returns 200 with the same content rather than 301ing to the canonical non-slash URL. The rel=canonical on the page correctly points to the non-slash URL, so this is mitigated, but any externally-linked slash variant spends crawl budget on a duplicate fetch before canonical consolidation.

*Evidence:* curl -w '%{http_code}' https://xdipx.com/products/gaia-eco-slimline-vibrator/ → 200; canonical in that response = https://xdipx.com/products/gaia-eco-slimline-vibrator

*Recommendation:* Add a server-level trailing-slash 301 normalization (Express middleware in server/index.ts) for non-root paths.


### AEO/GEO, visibility to LLMs and answer engines

The AEO/GEO plumbing is genuinely strong and verified working live: robots.txt allows 18 named AI crawlers, /llms.txt is spec-compliant with titled markdown links, every route class has a .md twin serving text/markdown with a canonical Link header (14 of 14 curated URLs checked returned 200), and the JSON-LD layer is rich and correct (BlogPosting with datePublished/dateModified/author linked to /contributors/emma, FAQPage on posts/PDPs/homepage/collections, Product with AggregateOffer/gtin/return/shipping data, ProfilePage for Emma, OnlineStore with live sameAs socials). Notebook posts are answer-shaped end to end, with question-form slugs and H2s. The rot is at the edges: roughly 3% of the 4,259 product URLs sampled (2 of 60) 404 on both HTML and .md while still listed in sitemap.xml and llms.txt, because both are generated from Sanity productPage docs with no reconciliation against Shopify; the weekly aeo-surface-check can never catch this because it only fetches the same first five .md URLs every run. There is also zero tracking of LLM-referred traffic (no chatgpt/perplexity/claude referrer handling anywhere in attribution or analytics code), so when AEO traffic arrives nobody will be able to see it. The known llms.txt bloat item (570KB, 4,511 links) is tracked as P1-6 but not started.


**[HIGH] Sitemap and llms.txt advertise dead product URLs with no automated reconciliation (verified)**

Both sitemap.xml and llms.txt are generated from Sanity productPage docs (getProductHandlesForSitemap), while the PDP and its .md twin resolve against Shopify (getDealByHandle). When a product disappears from Shopify but its Sanity doc survives, the URL keeps being advertised while returning 404. The hiddenUntilLive flag is only cleared one-way at activation (markProductPageLive); nothing re-hides docs when the Shopify product goes away. In a 60-URL random sample of the 4,259 product entries, 2 URLs 404'd on both the .md and HTML surfaces (~3%, extrapolating to roughly 100-150 dead URLs). This erodes crawler trust for Google and feeds LLMs citable links to dead pages, and the rot compounds as the autonomous import pipeline churns the catalog daily.

*Evidence:* Live: https://xdipx.com/products/male-power-sneak-peek-bong-thong and https://xdipx.com/products/elbow-grease-original-gallon both return 404 (HTML and .md) while present in https://xdipx.com/sitemap.xml and https://xdipx.com/llms.txt (fetched 2026-07-22). Source: app/lib/sanity.server.ts:2032-2048 (Sanity-only handle query); app/lib/shopify.server.ts:3060-3072 (one-way markProductPageLive); app/routes/[llms.txt].tsx:63 (same query feeds llms.txt).

*Recommendation:* Add a nightly reconciliation job that diffs Sanity productPage handles against live Shopify handles and sets hiddenUntilLive (or deletes the doc) for anything gone, so sitemap and llms.txt self-heal. Serve 410 for known-removed handles instead of 404 to signal permanence.

*Verifier correction:* Claim confirmed in full; if anything the rot is understated. The dead-URL rate may be higher than the cited ~3%: an independent 50-URL random sample of the sitemap found 4 404s (8%), including 3 dead URLs not cited by the original auditor (oxballs-hulk-gargantic-jack-u-texture-cocksheath-special-edition-night, male-power-sheer-prints-sheer-thong-flamingo, main-squeeze-camgirls-bailey-rayne). Combined samples put plausible dead-URL count anywhere from ~130 to ~340 of the 4,259 advertised, so treat "100-150" as a floor, not a range.


**[MEDIUM] aeo-surface-check only ever validates the same 5 URLs and can never catch catalog rot**

The weekly cron parses llms.txt and takes the first 5 deduped .md URLs, which are deterministically the Discover-section links (discover.md, new.md, index.md, the live pick, then the alphabetically-first product). Notebook posts, pages, collections, and 99.9% of product .md twins are never sampled, and the check validates only status + content-type, not content or the presence of dead links. The two dead product URLs found in this audit are exactly the class of failure this check exists to catch and structurally cannot. It also only console.errors (surfacing via Sentry) rather than alerting on a failure threshold.

*Evidence:* server/cron.ts:510-570; the sampling logic at server/cron.ts:533-537 (matchAll, dedupe, slice(0,5)); schedule '0 6 * * 0' in vercel.json:32. Live llms.txt section order confirms the first 5 .md URLs are always the Discover block.

*Recommendation:* Randomly sample N URLs per section (products, collections, notebook, pages) each run, add an llms.txt-wide dead-link audit on a slower cadence (e.g. monthly full crawl of the 4.5k URLs at low concurrency), and record results somewhere the owner-digest can escalate from instead of relying on Sentry review.


**[MEDIUM] No tracking of LLM-referred traffic anywhere in the stack**

attribution.server.ts captures only utm_* params and ?ref codes; there is no Referer-header or document.referrer capture, and no mention of chatgpt.com, perplexity.ai, claude.ai, copilot, or gemini anywhere in analytics.client.ts or the attribution/GA4 wiring. GA4's default channel grouping will bury AI-assistant referrals inside generic 'Referral'. The store is investing heavily in AEO surfaces but has no way to measure whether they produce visits or orders, which undermines both the $2k/month profit goal instrumentation and the autonomy goal (agents can't optimize what isn't measured).

*Evidence:* app/lib/attribution.server.ts:15-51 (utm/ref only, no referrer); grep of app/ for chatgpt|perplexity|claude.ai|gemini referrer handling returns only robots.txt UA strings and imagen model names; app/lib/analytics.client.ts has no referrer logic.

*Recommendation:* Capture the Referer host into the existing attribution cookie on first touch and tag known AI-assistant domains (chatgpt.com, perplexity.ai, claude.ai, gemini.google.com, copilot.microsoft.com, you.com) as source=ai-assistant; mirror it as a GA4 custom channel group. Cheap now, impossible to backfill later.


**[MEDIUM] llms.txt is a 570KB, 4,511-link catalog dump (known, tracked as P1-6, not started)**

The live llms.txt is ~570KB with 4,259 product lines, dwarfing the curated sections (11 notebook posts, 12 pages). The llms.txt convention favors a compact curated index an LLM can ingest whole; at this size most consumers will truncate it, and the products drown the highest-citation-value content (Notebook answers, FAQ, policies). Product entries have titles but no descriptions. The prior full-store audit flagged this (P1-6: slim llms.txt + add llms-full.txt) and the roadmap shows it not-started with a 2026-08-10 due date; /llms-full.txt currently 404s.

*Evidence:* Live fetch 2026-07-22: 569,927 bytes, 4,511 links, 4,259 in ## Products; https://xdipx.com/llms-full.txt returns 404. docs/store-team/trackers/automation-audit-roadmap.md:25 (p1-6-llms, not-started); docs/audits/2026-07-full-store-audit.md:97,147. Generator: app/routes/[llms.txt].tsx:138-146.

*Recommendation:* Execute P1-6 before AI-crawler traffic ramps: keep a curated llms.txt (primary pages, Notebook posts with descriptions, collections, policies, top products) and move the full catalog enumeration to llms-full.txt linked from the Optional section.


**[MEDIUM] Every .md page stamps a fabricated 'Last updated: <today>' freshness date**

mdFooter writes `Last updated: ${new Date().toISOString().split('T')[0]}` on every render, so every .md twin claims it was updated on the day it was fetched (modulo the 15-minute KV cache). An LLM citing the page inherits a false freshness signal, and the date contradicts the truthful dateModified in the HTML twin's BlogPosting JSON-LD. This is machine-readable fabricated proof, at odds with the doctrine's never-fabricate-proof principle.

*Evidence:* app/lib/markdown-page.server.ts:29-38 (mdFooter using new Date()); confirmed live: https://xdipx.com/products/womanizer-enhance-black.md footer shows the fetch date. Contrast app/components/seo/BlogStructuredData.tsx:17-18 which uses real publishedAt/_updatedAt.

*Recommendation:* Thread the real Shopify updatedAt / Sanity _updatedAt into each *ToMarkdown call and print that; drop the line entirely where no real timestamp exists.


**[LOW] Product .md 'What it is' block emits raw category handles ('Positioned for for-her')**

productToMarkdown joins deal.category values verbatim into the factual answer sentence, producing text like 'Positioned for for-her.' in the first citable paragraph of every affected product twin. Since this block is explicitly designed as the answer-engine extraction target, the garbled phrasing lands directly in potential citations.

*Evidence:* Live: https://xdipx.com/products/womanizer-enhance-black.md line 5 reads 'Positioned for for-her.'; source app/lib/markdown-page.server.ts:256-263 (category join without humanization).

*Recommendation:* Map category handles through the existing humanizeHandle-style formatting (and a small alias table: for-her -> 'her', for-him -> 'him') before interpolating.


**[LOW] Product .md FAQ questions rendered as H2 siblings of the section header**

The product markdown route appends '## Frequently asked questions' and then each question also as '## ', so questions are structural siblings of their own section header rather than nested '###' Q&A pairs. Minor inconsistency with the answer-shaped heading hierarchy used elsewhere (notebook .md uses proper nesting), and it slightly weakens section-scoped extraction.

*Evidence:* app/routes/products.$slug[.md].tsx:44-47 (both section header and questions pushed as '## '); confirmed live in https://xdipx.com/products/womanizer-enhance-black.md ('## Frequently asked questions' followed by '## What kind of stimulation...').

*Recommendation:* Change the per-question heading to '###'.


**[LOW] llms.txt omits notebook series/tag/author archives that the sitemap includes**

The sitemap lists /notebook/series/field-notes (and the route tree has tag/author archives), but llms.txt's Notebook section enumerates only the hub, glossary, and category archives. BlogPosting JSON-LD advertises series via isPartOf with a /notebook/series/ URL, so LLMs are pointed at a surface llms.txt does not index and which has no .md twin route.

*Evidence:* Live sitemap contains https://xdipx.com/notebook/series/field-notes; llms.txt Notebook section (app/routes/[llms.txt].tsx:161-168) lists only hub/glossary/categories; app/components/seo/BlogStructuredData.tsx:58-66 emits series URLs; no notebook.series.$slug[.md].tsx route exists in app/routes/.

*Recommendation:* Either add series archives (and their .md twins) to llms.txt or accept the gap deliberately; keep sitemap and llms.txt scope decisions in one place so they cannot drift.


### Server-side automation plumbing: crons, gates, valves, alerting

The cron plane is solid: all 18 vercel.json cron paths have matching GET-capable handlers via the cronRoute helper with constant-time CRON_SECRET auth (server/cron.ts:52-86), and live DB evidence shows they fire (import_monitor_last_run_at 2026-07-22T08:02, gsc_index_daily current through 2026-07-22, gsc_snapshots first row 2026-07-21). The valve layer is coherent and the states prove the store is genuinely running itself: homepage, social, strategy, content, and product teams are ON with auto-approve-suggestions ON; suggestion_apply is ON; product_manager_enabled AND import_enrich_enabled are both ON, meaning the fully unattended import-to-live path is live; email and ads teams are OFF; run caps match the manifest (strategy=3, content=3, both set 2026-07-21). Run health over 14 days is largely green (homepage merchandise 13 successes, content 11, social daily since 7/14). The weak spots are concurrency and observability: the 20-minute run lock is shorter than most real runs (22-69 min), which already caused double-starts, and there is no code-level dead-man switch for the 14 cloud routines, one of which (offsite-scout) has literally never fired.


**[HIGH] 20-minute run lock is shorter than typical run duration, causing double-starts and transient false failures (verified)**

RUN_LOCK_WINDOW_MIN=20 (app/lib/team.server.ts:81) drives both the same-team concurrency guard (isRunInProgress, only counts runs started within 20 min) and expireStaleRuns (flips any 'running' row older than 20 min to failed). But real runs routinely exceed 20 minutes, so a legitimately-running routine loses its lock mid-flight: a second run of the same team can start (observed: 'duplicate run row from an accidental double start' on homepage merchandise and strategy apply-note, both 2026-07-21) and the in-flight row can be auto-flipped to failed with a misleading error (observed 'auto-expired' failures on email 7/14 and homepage merchandise 7/13). updateRun also never clears the error column on later success.

*Evidence:* app/lib/team.server.ts:81 (RUN_LOCK_WINDOW_MIN = 20), team.server.ts:269-280 (expireStaleRuns). DB: 10 succeeded runs in the last 14 days ran >20 min (design run id 72: 69 min on 7/22; product id 60: 44 min; strategy id 54: 42 min; merchandise runs 22-36 min). Skipped rows dated 2026-07-21: 'duplicate run row from an accidental double start; canonical run is 65' and 'accidental duplicate start; using run 61'.

*Recommendation:* Raise the lock window to ~90 min, or better, base the lock on a heartbeat (latest homepage_team_events row or an updateRun touch) instead of started_at, so a routine posting phase updates keeps its lock. Have updateRun clear error/finishedAt when a run later succeeds.

*Verifier correction:* Core claim confirmed: RUN_LOCK_WINDOW_MIN=20 (app/lib/team.server.ts:81) drives both isRunInProgress (lines 249-263) and expireStaleRuns (lines 269-279), real runs routinely exceed 20 min (13 succeeded runs >20 min in the last 14 days, not 10; max 68.6 min), and updateRun (line 377) never clears the error column on later success. DB proves mid-flight expiry directly: runs 13, 24, and 72 are status='succeeded' yet still carry the 'auto-expired' error text, meaning they were flipped to failed mid-run and later overwrote status without clearing error; runs 14, 23, 33 ended failed with the same auto-expired error. Two corrections: (1) run 72 is team 'homepage', not 'design'. (2) The cited 2026-07-21 duplicate rows are NOT lock-expiry double-starts: run 66 started 0.76s after canonical run 65 and run 63 started 3m45s after canonical run 61, both within the 20-min window; those were start-time races the lock correctly caught (both self-skipped). The real lock-expiry-caused same-team overlap is the 7/13 pair: run 24 started 16:43:48 while run 23 (started 16:10:00) was still status='running' (not auto-expired until 16:43:57), because 23 had aged out of the 20-min window.


**[HIGH] No dead-man switch for the 14 cloud routines; routine 11 (offsite-scout) has never fired (verified)**

The agent plane runs on Claude cloud scheduler triggers outside the repo. Nothing in code notices a trigger that stops firing: the owner digest lists only runs that exist in the last 24h, and the manifest's mitigation is a prompt clause asking the weekly strategy routine to verify the others ran, which is itself a cloud routine (circular) and weekly at best. Concretely, routine 11 (Weekly Off-site Scout) was never created as a trigger and has zero run rows ever; the product-team trigger gap (enabled 2026-07-16, trigger created 2026-07-21) went 5 days with zero runs and nothing alerted. Existing dead-man coverage is partial: notebook-healthcheck (daily, emails owner if the blog post is missing) covers routine 9, and the pricing sweep (routine 13) covers the pricing cron, but social, strategy, apply-pass, podcast, seo-curation, merchandiser, design-cycle, and product have no independent monitor.

*Evidence:* docs/store-team/routine-schedule.md:10-12 and :40-41 ('Routine 11 ... has never fired'); DB: SELECT count(*) FROM homepage_team_runs WHERE run_type ILIKE '%offsite%' = 0; zero product-team rows before 2026-07-21 despite product_team_enabled updated 2026-07-16; owner digest only queries homepage_team_runs for the last 24h (app/lib/owner-digest.server.ts:96-101).

*Recommendation:* Add a daily 'routine-expectation' check to an existing cron (e.g. owner-digest or a new /cron/routine-healthcheck): encode the manifest's expected cadence per team/run_type, compare against homepage_team_runs, and sendOwnerEmail when an expected run is missing. Create the routine-11 trigger or delete it from the manifest.

*Verifier correction:* Core claim confirmed, with one correction: the notebook-healthcheck does NOT cover routine 9 as a dead-man. app/lib/notebook-healthcheck.server.ts only asserts that the notebook index, the latest EXISTING post (+.md twin), and a category page render cleanly (HTTP 200, body size, image, JSON-LD); it has no freshness/publishedAt check, so a silently-stopped Daily Content Writer leaves yesterday's post rendering fine and triggers nothing (owner email only fires on a hard render failure that opens a new P1 GitHub issue). Coverage is therefore thinner than claimed: only the pricing cron has an independent recency check (routine 13's prompt verifies the 07:00 UTC batch recompute ran within 26h, routine-schedule.md:91), and that checker is itself a cloud routine. Content, social, strategy, apply-pass, podcast, seo-curation, merchandiser, design-cycle, and product routines all lack any independent monitor. Minor nuance: the owner digest's gate table (owner-digest.server.ts:163) does passively display runsToday per team (e.g. '0/1 runs'), but nothing flags or alerts on it, and zero is the normal state for weekly routines most days.


**[MEDIUM] Ungated non-team LLM spend spiked 73x in one night (emma-aside, 3,642 calls on 7/21) with no alert**

Per-request PDP Emma asides bill to feature 'copy-gen' (the claude.server.ts default), which maps to no team (teamFromFeature returns null), so this spend bypasses every team budget gate and is invisible in the owner digest's gate table. On 2026-07-21, 01:00-06:00 UTC, emma-aside made 3,642 haiku calls (924 in the 04:00 hour) versus a 5-50/day baseline, a pattern consistent with a bot crawl generating unique cache keys. The in-file ceiling is 5,000 gens/day, which at haiku pricing permits roughly $600/mo worst case against the file's own stated $15-30/mo target. Cost this time was only ~$14.73/wk, but nothing would have alerted at 10x the price.

*Evidence:* api_token_log: feature='copy-gen' caller='emma-aside' = 3,693 calls/$14.73 in 7 days, of which 3,642 on 2026-07-21 (hourly: 924@04:00, 859@02:00, 827@01:00). app/lib/emma-aside.server.ts:27 (DAILY_BUDGET_CEIL = 5000) and header comment 'Budget target ~$15-30/mo'. app/lib/team-keys.ts teamFromFeature: 'copy' is not a TeamId.

*Recommendation:* Lower DAILY_BUDGET_CEIL to a few hundred, skip generation for known bot user-agents, and add a non-team spend line (copy-gen, enrichment, contextual) to the owner digest with a simple day-over-day spike callout.


**[MEDIUM] Owner digest and alert channels fail silently; a dead digest is undetectable**

sendOwnerEmail returns { sent:false } (never throws) when SMTP creds are missing or the send errors, and the /cron/owner-digest handler wraps any result in res.json({ ok:true, ...result }), so a digest that stops sending still returns HTTP 200 and Vercel cron sees success. The once-per-day KV guard is claimed before the send attempt, so a failed send also cannot be retried the same day without force=1. Since the digest is itself the alerting backstop, its failure mode is fully silent. Local .env has no ZOHO_SMTP_* or TWILIO_* names, so prod delivery could not be verified from this audit (see open questions).

*Evidence:* app/lib/owner-alerts.server.ts:48-52 (missing creds -> { sent:false }); app/lib/owner-digest.server.ts:78-80 (KV NX claim before send) and :213-214; server/cron.ts:291-302 (res.json({ ok: true, ...result }) regardless of result.sent).

*Recommendation:* Return HTTP 500 from /cron/owner-digest when result.sent is false so the failed invocation is visible in Vercel cron history, and claim the KV once-a-day key only after a successful send. Verify ZOHO_SMTP_USER/PASS and TWILIO_* exist in the Vercel prod env.


**[MEDIUM] Hand-written migrations have no bookkeeping table and a duplicate number (two 055 files)**

scripts/apply-migrations.ts applies db/migrations/*.sql from a --from argument with no record of what was applied; applied state is only inferable by probing objects, and the header comment is stale ('Apply ... 004-017', 'drizzle only tracks 0000-0003' while the journal now has 0000-0005). Two files share number 055 (055_content_team_max_images.sql and 055_seo_valves.sql), breaking the NNN uniqueness the --from filter and runbooks assume. The gate-critical migrations the audit worried about ARE all applied in prod: 052/054/059/062 verified via live seeded keys (product_manager_enabled, content_team_enabled, product_team_*, *_auto_approve_suggestions), 063 via the live homepage budget values (60000/100/50000/10), 064 via existing gsc_index_daily and gsc_url_inspections tables with rows through 2026-07-22.

*Evidence:* scripts/apply-migrations.ts:1-10 (stale header, no bookkeeping); ls db/migrations shows 055_content_team_max_images.sql AND 055_seo_valves.sql; db/migrations/meta/_journal.json entries 0000-0005. DB probes: to_regclass('gsc_index_daily')/('gsc_url_inspections')/('nalpac_price_history') all non-null; pipeline_settings rows for all 062/059/052 keys present.

*Recommendation:* Add a tiny applied_migrations bookkeeping table written by apply-migrations.ts, renumber one of the 055 files at next touch, and refresh the script's header comment.


**[MEDIUM] pipeline_settings is polluted with 1,798 velocity:* cache rows**

The pricing velocity computation writes one per-variant JSON row per SKU (key 'velocity:<variantId>') into pipeline_settings, the same table that holds the ~60 kill switches and valves. This makes any 'SELECT * FROM pipeline_settings' valve audit return 200KB+ of noise, grows the table daily, and risks a future accidental key collision with the LIKE '{team}_team_%' config reads.

*Evidence:* DB: SELECT count(*) FROM pipeline_settings WHERE key LIKE 'velocity:%' = 1798, all updated 2026-07-22 (daily rewrite). Writer: app/lib/pricing-velocity.server.ts.

*Recommendation:* Move velocity buckets to their own table or to KV (they are already daily-recomputed cache data), leaving pipeline_settings as a pure valve/config table.


**[LOW] Homepage budget elevation (migration 063) has no expiry or rollback reminder**

The design-elevation push lifted homepage_team_daily_cents to 60000 ($600/day, 40x the 1500 default), max_images to 100, and max_runs to 10 on 2026-07-20, by explicit owner direction. The migration says 'flip values back down at any time' but nothing tracks that the push has ended (variant-b flip and teardown PRs are merged); the elevated caps persist indefinitely, and with team routines running on subscription (7-day homepage api_token_log spend is $0.43) the dollar gate is effectively a no-op, leaving max_runs=10 as the only real throttle.

*Evidence:* db/migrations/063_design_elevation_budget.sql:23-28; live pipeline_settings: homepage_team_daily_cents=60000, homepage_team_max_images=100, homepage_team_max_runs=10 (all updated 2026-07-20); api_token_log homepage-% spend last 7 days = $0.43.

*Recommendation:* Once the design push is declared done, dial the three keys back down from /admin/homepage-team; consider noting the intended end state in the mission brief so a strategy run can file the reminder.


**[LOW] Cron guard comment claims x-vercel-cron is accepted, but code requires the secret; single-point env dependency**

The comment at server/cron.ts:56-57 says the guard passes on 'either the shared secret OR that [x-vercel-cron] header', but the code only accepts x-cron-secret or Authorization: Bearer matching CRON_SECRET. This works today because Vercel injects Authorization: Bearer $CRON_SECRET when the env var exists on the project, but it means all 18 scheduled jobs 401 silently if CRON_SECRET is ever unset or rotated out of sync on the Vercel project, and the comment misleads future editors into thinking there is a platform-gate fallback.

*Evidence:* server/cron.ts:56-77 (comment vs. guard implementation); vercel.json crons block lists 18 paths, every one registered via cronRoute (GET+POST) in server/cron.ts.

*Recommendation:* Fix the comment to match the code, and let the proposed routine-healthcheck (finding 2) double as detection: cron-fed tables going stale (e.g. import_monitor_last_run_at) implies a plane-wide auth failure.


### Last two weeks of dev work (2026-07-08 → 2026-07-22, 97 commits): drift between shipped code, doc claims, and dangling follow-ups

The two weeks shipped an enormous amount that genuinely landed: the variant-b homepage flip (#274), the v5 voice charter with a real tracker (#279), owner alerting/daily digest closing tracker milestone p0-6 (#282), GSC index monitoring (#297), and verified fixes for three previously-open issues (the 13 /discover shell links are down to the spec-capped 2, the hero/rail reshuffle mismatch is solved by Sanity hero pinning plus the 300s cache-aligned shuffle in #307, and FAQPage JSON-LD on Notebook posts is live from #248). The sharpest drift is one piece of silently lost work: PR #300, the owner-directed homepage P0 stand-up run, was merged into a side branch instead of main, so GitHub reports it MERGED while its footer-legitimacy, trust-copy, and brand work never reached the storefront. Second-order drift clusters around the variant flip: the homepage healthcheck still mirrors the pre-flip resolver and falls back to 'legacy', and CLAUDE.md still tells every agent session the default is legacy/a. The improvement loop's Monday run-cap fix lives only in a hand-edited prod DB row plus a doc sentence, with code defaults and migrations still seeding the old values that caused the apply pass to silently skip for weeks. The v5 trial has a working but multi-link reminder chain with no hard-scheduled fallback, and both program trackers remain RED with most of the 2026-07-20 P0 asks still unmoved in code as of today.


**[CRITICAL] PR #300 (homepage P0 stand-up run) merged into a side branch, never reached main, work silently lost while GitHub reports MERGED (verified)**

The owner-directed 'P0 stand-up run, Emma photo, trust copy, brand eyebrows, footer legitimacy, imagery fixes' was based on and merged into branch claude/homepage-competitive-analysis-00dd1e, not main. Its merge commit b284d4d is not an ancestor of main. Only the Emma-photo slice was independently re-implemented in merged PR #302 (which also records brand eyebrows as re-scoped/deferred); the footer legitimacy links (POLICY_LINKS to real policy pages), the frequency-sorted catalog-brands footer row (getFeaturedBrandNames), trust copy, and StorefrontProductCard changes exist only on the stranded branch. These implement the teardown gospel's top trust steals (#299), so the team believes P0 trust work shipped when the live storefront never got it.

*Evidence:* gh pr view 300 --json baseRefName → "claude/homepage-competitive-analysis-00dd1e", state MERGED, mergeCommit b284d4d; git merge-base --is-ancestor b284d4d HEAD → NOT IN HEAD; grep POLICY_LINKS app/components/store/Footer.tsx on main → no matches; branch diff shows Footer.tsx +51 lines of POLICY_LINKS/brands absent from main

*Recommendation:* Rebase the surviving scope of b284d4d (footer POLICY_LINKS + brands row, trust copy, product-card changes) onto main as a fresh PR, dropping the Emma-photo part superseded by #302; then add a repo convention/check that team PRs targeting anything other than main require an explicit note, since 'merged' status on a side-branch base is invisible drift.

*Verifier correction:* Confirmed with one refinement: PR #300 (merged 2026-07-22T04:46:53Z, merge commit b284d4d) targeted branch claude/homepage-competitive-analysis-00dd1e, which had already been squash-merged to main as PR #299 (f5ad74b, docs-only) 21 seconds earlier at 04:46:32Z, so none of #300's app code ever reached main. b284d4d is reachable only from origin/claude/homepage-competitive-analysis-00dd1e. The Footer.tsx delta stranded on that branch is +47/-1 (not +51) and includes POLICY_LINKS and getFeaturedBrandNames(), both absent from main; StorefrontProductCard.tsx (+22/-6), StorefrontHome.tsx, discovery.server.ts, EditorialTiles.tsx, and _layout.tsx changes are likewise stranded. Only the Emma-photo slice was re-shipped via PR #302 (2fb4897, ancestor of main), whose body records the brand-eyebrow item as index-blocked and re-scoped/deferred.


**[HIGH] Homepage healthcheck still assumes 'legacy' as the cookieless default after the #274 flip to 'b' (verified)**

PR #274 changed only home-variant.server.ts and its test: the resolver's final fallback is now 'b' (line 80), and the commit rationale says 'the code-level default IS the flip switch' rather than relying on HOME_VARIANT. But activeServedVariant() in the 30-minute homepage healthcheck mirrors the OLD chain and returns 'legacy' when Sanity activeVariant is unset/'off'/timed-out and HOME_VARIANT is unset. In that state the post-rollback rewarm targets the legacy payload, not the variant-b payload the live page actually serves, the same healthcheck whose false-rollback bug was a P0 earlier in July. The stale mirror is also baked into the checked-in Vercel entry bundle.

*Evidence:* app/lib/homepage-healthcheck.server.ts:69-78 (return 'legacy') and comment at :66 ('then HOME_VARIANT env, then legacy') vs app/lib/home-variant.server.ts:80 (return variant 'b', source 'default'); same stale fallback compiled into server/vercel-entry.mjs:15371-15380; git show ca26d15 --stat shows #274 touched only home-variant.server.ts + test

*Recommendation:* One-line fix: make activeServedVariant() fall back to 'b' (or better, import/reuse resolveHomeVariant's cookieless chain so the two can never diverge again), rebuild vercel-entry.mjs, and update the stale comment at app/routes/_layout._index.tsx:147.

*Verifier correction:* Confirmed with one wording fix: activeServedVariant() in app/lib/homepage-healthcheck.server.ts:69-78 still falls back to 'legacy' (comment at :66 says "then HOME_VARIANT env, then legacy") while the live resolver's fallback is 'b' (app/lib/home-variant.server.ts:80, changed by ca26d15/#274 which touched only that file + its test). In the mismatch state the rollback path (homepage-healthcheck.server.ts:275-284) does not warm a "legacy payload" as claimed; it takes the non-b branch, warming the Variant A payload via warmHomepagePayloadA and skipping the b-branch's post-restore invalidateCmsCache(), so recovery still targets the wrong variant's caches for the variant-b page the live site actually serves. Additional divergence: the healthcheck honors HOME_VARIANT=legacy but the live resolver ignores 'legacy' and serves 'b'. The stale mirror is also present in the checked-in server/vercel-entry.mjs (~15371-15379).


**[HIGH] Monday run-cap fix (caps must be 3) exists only as a hand-applied prod DB edit; code defaults and migrations still seed the values that silently killed the apply pass (verified)**

routine-schedule.md (2026-07-21) states strategy_team_max_runs and content_team_max_runs 'must be 3' and documents the root cause: at cap 1 the noon strategy run consumed the only slot, so the Apply Pass and Cost Review skipped over_run_cap every Monday and no approved suggestion ever became a PR. But TEAM_DEFAULTS still hardcodes strategy=1 and content=2, migration 054 seeds content_team_max_runs='2', and no migration anywhere sets either cap to 3 (grep of db/migrations for max_runs finds only 054/059/063). The fix therefore lives solely in an unversioned pipeline_settings row; any settings reset, re-seed, re-application of 054, or new environment silently reintroduces the exact skipped-apply-pass failure, which is invisible until someone notices no PRs are being produced.

*Evidence:* docs/store-team/routine-schedule.md ('Run-cap requirements (2026-07-21)' section); app/lib/team-keys.ts:76-77 (strategy maxRunsPerDay 1, content 2); db/migrations/054_enable_content_team.sql:15 ('content_team_max_runs','2'); grep -rn max_runs db/migrations/ shows no migration setting 3

*Recommendation:* Add a migration 065 seeding strategy_team_max_runs='3' and content_team_max_runs='3' (and align TEAM_DEFAULTS), so the documented requirement is durable; the weekly strategy routine's self-audit should also assert the caps match routine-schedule.md.

*Verifier correction:* Core claim confirmed with one vector corrected: re-applying migration 054 would NOT reintroduce the bug, because 054 inserts with ON CONFLICT (key) DO NOTHING (db/migrations/054_enable_content_team.sql:17), so the existing value 3 survives. Every other vector stands: the cap-3 fix exists only as unversioned prod pipeline_settings rows (strategy_team_max_runs='3' and content_team_max_runs='3', both updated_at 2026-07-21T12:14:21.159Z, identical timestamp consistent with a hand edit); TEAM_DEFAULTS still hardcodes strategy maxRunsPerDay 1 and content 2 (app/lib/team-keys.ts:76-77); app/lib/team.server.ts:122-127 falls back to TEAM_DEFAULTS when the settings row is absent and line 343 enforces the over_run_cap skip; migration 052 deliberately seeds no cap keys ('code-side defaults apply', db/migrations/052_enable_teams.sql:12); and a repo-wide grep for strategy_team_max_runs/content_team_max_runs outside markdown finds only 054's content=2. So a settings-row deletion, a fresh environment seeded from migrations, or any reset to code defaults silently restores strategy cap 1 and re-kills the Monday Apply Pass exactly as documented in docs/store-team/routine-schedule.md:42-49.


**[HIGH] CLAUDE.md contradicts shipped code on the homepage default and understates the import chain's autonomy, and it's the map every agent session loads (verified)**

Three stale claims in the binding project guide: (1) 'Default until flipped is legacy/a; set HOME_VARIANT=b … to make the storefront the homepage', false since #274 (2026-07-19); the code default is 'b'. (2) The product-import carve-out calls product_manager_enabled 'default off' and import_enrich_enabled 'still-manual', but migration 052 flips both true together with import_monitor_phase=2; the import-monitor runbook itself (line 108) says 052 enables 'the full unattended discover → import → enrich → publish chain'. (3) The Cron Schedule section lists 3 crons; vercel.json now has 19. Agents (homepage team, rr7-engineer, auditors) reading CLAUDE.md will mis-model which variant serves '/', how autonomous the import path is, and what jobs run.

*Evidence:* CLAUDE.md:58 ('Default until flipped is legacy/a') vs app/lib/home-variant.server.ts:80; CLAUDE.md carve-out text vs db/migrations/052_enable_teams.sql:15-24 and docs/import-monitor-runbook.md:108,136; CLAUDE.md Cron Schedule (3 rows) vs vercel.json:21-39 (19 crons)

*Recommendation:* One docs pass on CLAUDE.md: variant-b is the code default with rollback via revert; carve-out states the current prod switch state (052 applied); cron table either lists all vercel.json entries or points at vercel.json as the source of truth.

*Verifier correction:* All three staleness claims confirmed, with one count fixed: vercel.json has 18 crons (lines 22-39), not 19, vs CLAUDE.md's 3-row table. (1) CLAUDE.md:58 says default is legacy/a, but app/lib/home-variant.server.ts:80 returns variant 'b' as default since commit ca26d15 (#274, 2026-07-19). (2) CLAUDE.md calls product_manager_enabled 'default off' and import_enrich_enabled 'still-manual', but db/migrations/052_enable_teams.sql:15-24 flips both true with import_monitor_phase=2, docs/import-monitor-runbook.md calls this 'the full unattended discover → import → enrich → publish chain', and a live SELECT confirms all three keys are applied in the prod DB (updated 2026-07-09), so the understatement is live, not just on-file.


**[MEDIUM] Voice v5 30-day trial (ends 2026-08-19) has a real but fragile reminder chain, no hard-scheduled reminder exists**

The check-in will fire only through a multi-link chain: the Weekly Strategy cloud trigger fires Mondays → program-manager audits trackers/*.md and flips v5-checkin AMBER the week of 2026-08-17 → its docs-only PR must be merged and deployed → the daily owner-digest (reads trackers from the deployed filesystem) surfaces the RAG change, provided OWNER_ALERT_* env vars are configured. Every link has recent precedent for breaking: the Monday chain was silently dead for weeks (run-cap bug, fixed only 2026-07-21 and not durably), tracker PRs are never auto-merged, and tracker parsing in prod broke once already (hotfix #293, __dirname in the ESM bundle). There is no cron, cloud trigger, or scheduled task keyed to the 2026-08-17 date itself; if the Monday 2026-08-17 strategy run doesn't fire or its PR isn't merged, the trial silently expires with the intensity-9 register left running undecided.

*Evidence:* docs/store-team/trackers/voice-register-v5-trial.md (v5-checkin row + RAG rules); app/lib/owner-digest.server.ts:117-118,183-206 (tracker RAG in digest); app/lib/tracker.server.ts:58-60 (runtime file reads); 6190e42 hotfix(tracker) #293; docs/store-team/routine-schedule.md run-cap section (Mondays previously skipped over_run_cap)

*Recommendation:* Add one belt-and-suspenders reminder outside the agent loop: a dated entry in the owner-digest (e.g. hardcode a 'v5 trial decision due' banner when now >= 2026-08-14) or a one-time scheduled task for 2026-08-17, so the decision reaches Mike even if the Monday chain breaks.


**[MEDIUM] Both program trackers are RED and most 2026-07-20 P0 asks are still unmoved in code; only p0-6 has closed since the flip**

Verified against main today: p0-1 (no Klaviyo campaign functions in klaviyo.server.ts), p0-2 (server/webhooks.ts:330 still early-returns unless available===0; no back-in-stock path), p0-8 (_layout._index.tsx:700/708 still link the 301-ing /for-him and /for-her), p0-7 (PDP stock indicator still commented out, products.$slug.tsx:61), design p1-stack (none of the three design skills in .claude/skills, now 9 days overdue), and p2-snapshots (no scripts/design-snapshots.ts, no tests/visual/) are all exactly as the 2026-07-20 audit left them, including the two fixes the PM called '~1-hour' candidates for that week's apply pass. What did close: p0-6 alerting shipped in #282 (owner-alerts, owner-digest, api.team.status, /admin/trackers all on main), and p0-3's blocking bug (batch custom_id over 64 chars) was fixed in #280/#281. The structural point: the apply pass that should carry the cheap fixes only gained run-cap headroom on 2026-07-21, so its first real chance is Mon 2026-07-27, a full week of latency on 'this week' asks.

*Evidence:* grep campaign app/lib/klaviyo.server.ts → none; server/webhooks.ts:330; app/routes/_layout._index.tsx:700,708; app/routes/_layout.products.$slug.tsx:61; ls .claude/skills (35 marketing skills, none of the three design skills); ls scripts/design-snapshots.ts tests/visual → missing; PR #282 commit c5e91ea file list; trackers' 2026-07-20 status logs

*Recommendation:* Treat p0-2 and p0-8 as direct 1-hour PRs rather than waiting for the Monday apply pass; expect Monday's PM audit to flip p0-6 done and re-probe p0-3 (verify a full-enrichment batch has actually succeeded post-#281 before crediting it).


**[MEDIUM] Em-dashes still ship across owned-channel chrome, including the live homepage SERP title, a standing charter violation flagged in earlier sessions and still open**

The v5 charter (and the owner's global rule) bans em-dashes, yet: BRAND_TITLE is 'xdipx, Sexual Wellness, Edited' (served live on xdipx.com right now, and now the fallback default for the new team-editable homeSeo from #308); every Notebook meta/SERP title uses ', ' separators across 9 route files; and Emma-voice fallback strings baked into components ship em-dashes to users whenever Sanity copy is absent (AskEmmaWidget greeting "Hey, I'm Emma…", PersonalizedSearchRail quips like '3 a.m. browsing, no judgement', SensationDial, EmmaDiscoveryRail).

*Evidence:* app/lib/brand.ts:14; live curl of https://xdipx.com/ <title> → 'xdipx, Sexual Wellness, Edited'; app/routes/_layout.notebook.$slug.tsx:52-54 and 16 more title lines across notebook routes; app/components/store/AskEmmaWidget.tsx:35; PersonalizedSearchRail.tsx:73,82,204-206; SensationDial.tsx:143; EmmaDiscoveryRail.tsx:135-137

*Recommendation:* Decide explicitly whether the no-em-dash rule covers title separators (if yes, switch to '·' or '|' in one sweep); regardless, fix the in-copy Emma fallback strings, and add an em-dash check to the voice gate for code-level fallback strings, not just generated copy.


**[MEDIUM] The homepage AEO twin (/index.md) sources its featured pick from the daily-deal system, not the variant-b hero, the AI-readable page can name a different product than the live homepage**

index[.md].tsx still calls getDailyDeal() and renders 'Emma's current pick' from the deal-rotation metafields, while the live variant-b hero pick is set by the homepage team via singleton.emmaHeroStorefront.featuredProductHandle (pinned in assembleStorefrontHome). Two independent selection systems, so LLMs and crawlers reading the markdown twin can be told a different 'current pick' than any visitor sees, undermining the AEO parity work (#212/#219/#296) the same fortnight invested in.

*Evidence:* app/routes/index[.md].tsx:19-25 (getDailyDeal → homepageToMarkdown); app/lib/markdown-page.server.ts:523+ ("## Emma's current pick" from the deal); app/lib/storefront-home.server.ts:143-163 (hero pinned from singleton.emmaHeroStorefront)

*Recommendation:* Point the twin's featured-pick section at the same source as the live hero (emmaHeroStorefront pinned handle, falling back to the deal only when unset), keeping the 15-min cache.


**[LOW] Operational docs carry now-false status lines with no resolution log**

Three examples verified: ops-blockers.md #14 still says 'gsc_snapshots has zero rows ever' though GSC went live 2026-07-21 and #297 built a whole index monitor on top of it (doc last touched by #267); routine-schedule.md still says 'Still outstanding: smoke-test by firing Weekly Strategy manually' though the Weekly Strategy run demonstrably fired 2026-07-20 (it wrote both trackers' first-audit status logs); import-monitor-runbook.md:41 says 'Phases 2–3 deferred' while lines 108/136 of the same doc describe migration 052 setting phase 2, an internal contradiction already tracked as roadmap item p2-8-docs but worth a nearer-term fix since agents read the runbook top-down.

*Evidence:* docs/store-team/ops-blockers.md:21 vs commit cec668d (#297); docs/store-team/routine-schedule.md smoke-test paragraph vs trackers' 2026-07-20 status logs; docs/import-monitor-runbook.md:41 vs :108,136; git log -- docs/store-team/ops-blockers.md → last touch 6338cbe (#267)

*Recommendation:* Give ops-blockers.md a dated 'resolved' section and have the weekly strategy run reconcile it; fix the two stale sentences in routine-schedule.md and runbook line 41 in the same docs PR.


**[LOW] Routine 11 (Weekly Off-site Scout) has never fired, playbook shipped 2026-07-16, cloud trigger never created**

The routine doc and agent (#229) landed six days ago and routine-schedule.md honestly records 'Routine 11 … still has no cloud trigger, it has never fired', including through the 2026-07-21 trigger-creation session that created triggers 10 and 14. The offsite/LLM-citation program (digital PR for AEO/GEO) is therefore fully built and fully dormant.

*Evidence:* docs/store-team/routine-schedule.md ('Routine 11 (Weekly Off-site Scout) still has no cloud trigger'); commit 645a2a2 (#229) shipped docs/store-team/routine-offsite-weekly.md

*Recommendation:* Create the trigger (Tue 16:00 UTC per the manifest) at next enablement session; until then the propose-only offsite program produces nothing.


**[LOW] Two migrations share prefix 055, muddying the numbered hand-migration convention**

db/migrations contains both 055_content_team_max_images.sql and 055_seo_valves.sql. apply-migrations.ts filters by 3-digit prefix and lexical sort so both do apply deterministically, but '--from 055' and any 'only NNN outstanding' bookkeeping (the team's established way of tracking prod migration state) is ambiguous for this pair, and ops-blockers #41 records that 055's image-cap value had in fact 'never been applied in prod' until 2026-07-17.

*Evidence:* ls db/migrations → 055_content_team_max_images.sql and 055_seo_valves.sql; scripts/apply-migrations.ts:31-37 (prefix filter + sort); docs/store-team/ops-blockers.md #41

*Recommendation:* Renumber one file (e.g. 055b or bump to a free number with a note) or record in db/migrations/meta which prod state includes both, so future --from runs are unambiguous.


### Gap analysis, human touchpoints and missing automation for fully autonomous store management

The store has an unusually complete automation skeleton (14 cloud routines, 19 Vercel crons, per-team valves, an improvement bus with auto-approve triage now ON for all five active teams, and a daily owner digest since PR #282), but the loops that touch money are either dead-ended at humans who are not doing the work, or silently broken. Two things are actively failing right now: the unattended import-to-live chain stalled on 2026-07-20 with 233 imported products stuck as unpublished drafts (zero enrichment batches submitted in ~96 cron ticks), and the store has taken 0 orders / $0 for at least 24 consecutive days with no automated checkout verification to tell the owner whether the funnel itself is broken. Meanwhile pricing autonomy was switched off today (review_all mode) despite historical proof that pending-approval queues are never worked (6,586 pricing rows pending since May 13, zero ever applied), 18 social drafts sit unreviewed so the autopost graduation criterion can mathematically never trigger, email campaign execution still has no plumbing (p0-1 RED past target), and the support inbox has zero automation. The pattern across the whole system: agent proposal capacity now far exceeds owner execution capacity, and the daily digest is blind to exactly the queues that are backing up (pricing, social review, import/enrich). The highest-leverage missing automations are a synthetic checkout probe, a Klaviyo campaign client, an inbound support-email poller, and queue-depth/trigger-liveness sections in the digest.


**[CRITICAL] Import-to-live chain silently stalled since 2026-07-20: 233 products stuck as unpublished drafts (verified)**

Both valves for the unattended import path are ON (pipeline_settings: import_enrich_enabled=true, product_manager_enabled=true), yet no enrichment has happened for ~2 days despite the */30 cron. 233 status='imported' candidates (223 imported 2026-07-21, 10 on 2026-07-22) have enrich_batch_id NULL, meaning the submit step has not even claimed them across ~96 ticks; max(enriched_at) is 2026-07-20; batch_jobs has zero rows since 2026-07-13 and its only 3 full-enrichment rows are all 'failed'. All 233 pass the selection query's inner join (verified: 233 joinable to deal_history with non-null shopify_product_id). Strong timing correlation: import_enrich_batch_cap was raised to 50 on 2026-07-21 (pipeline_settings updated_at), and submitEnrichmentBatch serially calls gatherProductBrief (Shopify round-trips) for up to `cap` products inside a 60s Vercel function before stamping any progress, a timeout kills the tick with zero durable progress, then every subsequent tick repeats identically. Errors go only to Sentry (per project memory, handleError swallows console), and the owner digest has no import/enrich queue section, so nothing surfaced this.

*Evidence:* DB: SELECT counts on import_candidates (233 unenriched, enrich_batch_id NULL, reviewed 07-20..07-22; max enriched_at 2026-07-20); batch_jobs (3 rows, all failed, last 2026-07-13); pipeline_settings import_enrich_batch_cap=50 updated 2026-07-21. Code: app/lib/import-enrich.server.ts:282-330 (serial gatherProductBrief loop before submit, progress stamped only after submitFullEnrichmentBatch succeeds); server/cron.ts:452-467 (60s serverless context, catch → console.error only).

*Recommendation:* Immediate: drop import_enrich_batch_cap to ~10, confirm a tick submits (enrich_batch_id gets stamped), then drain the 233. Structural: chunk the brief-gathering, stamp enrich_batch_id per chunk or move brief assembly into the batch request, add a stall detector (imported-with-null-batch-id count > N for > 6h → owner alert) and an import/enrich queue-depth section to the owner digest.

*Verifier correction:* Stall is real but the proposed mechanism is partly wrong. Confirmed: both valves ON (pipeline_settings import_enrich_enabled=true, product_manager_enabled=true); 233 candidates match submitEnrichmentBatch's full selection (status='imported', enriched_at/enrich_batch_id/enrich_failed_at NULL, joined to deal_history with bare-numeric shopify_product_id), all enrich_attempts=0; max(enriched_at)=2026-07-20 20:40:41, last enrich_batch_id stamp 2026-07-20 20:43; stillPending=0 so the submit gate is open every tick yet nothing is claimed; batch_jobs has exactly 3 rows, all full-enrichment/failed, last 2026-07-13; owner digest (app/lib/owner-digest.server.ts:200-206) has no import/enrich section. Corrections: (1) vercel.json:10 sets maxDuration 300, not 60s, the 60s figure comes from a poller comment; (2) the cap-raise-to-50 timing correlation is refuted: 220 of the 233 were imported 05:15-06:07 UTC on 07-21 and the 06:30/07:00 UTC ticks ran with the old cap=10 and still stamped nothing, while the cap raise came later at 07:22 UTC. The stall window instead brackets PR #280 (69584d8 "fix(import-enrich): valid batch custom_ids + bulk new-items import tooling", deployed ~00:44 UTC 07-21) or a poison-pill product throwing in the serial gatherProductBrief loop; the loop's no-partial-progress structure (import-enrich.server.ts:302-326) is confirmed and makes any per-tick exception repeat identically, but timeout-at-cap-50 specifically is unproven. Also, api_token_log shows 'enrichment' activity until 07-21 06:40 UTC (743- and 100-request msgbatches not tied to import_candidates, likely a manual bulk re-enrich), so the observable cron-path stall starts 07-21 ~05:30 UTC, not 07-20.


**[CRITICAL] 24+ days of $0 revenue with no automated checkout verification, every downstream flywheel is starved (verified)**

daily_profit_summary shows 0 orders / $0.00 for every day 2026-07-13 through 2026-07-22, and docs/store-team/ops-blockers.md P0 #15 dates the streak from Jun 29. This is the single gating question for the whole autonomy program, and it is entirely unautomated: nothing exercises the age-gate → cart → checkout-extras → Segpay/Verotel path end-to-end, so a broken payment step is indistinguishable from no traffic. The starvation cascades measurably: review_invites has 0 rows ever, reviews has 1 row, reviews_pdp_enabled=false (correctly, per policy), two complete voice-gated email briefs are deliberately parked (docs/store-team/email-briefs-parked.md) awaiting checkout confirmation, retros have no order/margin outcomes to learn from, and pricing has no elasticity signal. The teams keep producing (10 homepage runs, 9 content runs succeeded in the last 7 days) into a funnel nobody has verified transacts.

*Evidence:* DB: daily_profit_summary 2026-07-13..22 all 0|0.00; review_invites count=0; reviews count=1. docs/store-team/ops-blockers.md (P0 #15, dated Jun 29–Jul 13). docs/store-team/email-briefs-parked.md (briefs parked pending checkout confirmation). homepage_team_runs last-7-days counts.

*Recommendation:* Build the missing automation with the highest leverage in the entire system: a daily synthetic checkout probe (Playwright against prod: age gate → PDP → cart → checkout-extras → reach the payment provider's hosted page with a test SKU) that writes a pass/fail row and fires sendOwnerSms/sendOwnerEmail (app/lib/owner-alerts.server.ts) on failure. Human stays: fixing whatever the probe finds, and the one-time live transaction test. Until the probe passes, treat every other automation investment as secondary, exactly as ops-blockers already says.

*Verifier correction:* All cited evidence confirmed, and the streak is an undercount: daily_profit_summary has $0.00 / 0 orders for every real trading day in its history. The only nonzero rows ever (2026-03-26 through 2026-03-31, 42-87 orders/day) match db/seed.ts:113-127, which writes dailyProfitSummary rows for the seed deals' past 7 days, and order_line_items has 0 rows, so the store has never recorded a real order, not just 24 days of none. Minor gaps: 2026-07-10 has no summary row at all (cron gap), and reviews_pdp_enabled lives in pipeline_settings (migration 055), not a reviews table.


**[HIGH] Pricing autonomy switched off today into an approval pattern with a proven 100% abandonment rate (verified)**

pricing_approval_mode was set to 'review_all' on 2026-07-22 (pipeline_settings updated_at is today). In review_all, every v2 recompute returns 'pending' (app/lib/pricing-apply-v2.server.ts:100), so from tomorrow's 07:00 UTC batch, every price change across the catalog requires a human click. The historical evidence says those clicks never happen: the v1 pricing_changes queue holds 6,586 'pending' rows, ALL from run_date 2026-05-13, with 0 ever applied and 2 failed, a full-catalog reprice proposal that has sat untouched for 10 weeks. The v2 engine was genuinely autonomous until today (3,383 auto_applied lifetime, 1,555 applied in the last 7 days per pricing_audit_log). The daily pricing sweep routine (routine 13) is explicitly read-only and 'never approves/rejects/applies', so no agent can drain the new pending flow. Separately pricing_costsync_enabled=false, so Nalpac wholesale/MAP drops do not trigger repricing at all.

*Evidence:* DB: pipeline_settings pricing_approval_mode='review_all' updated 2026-07-22, pricing_costsync_enabled='false'; pricing_changes: 6,586 pending all run_date=2026-05-13, applied=0; pricing_audit_log: auto_applied=3,383, applied=6,999, 1,555 applied last 7 days, current through 2026-07-22. Code: app/lib/pricing-apply-v2.server.ts:100-109. docs/store-team/routine-schedule.md routine 13 (read-only mandate).

*Recommendation:* Confirm the review_all flip was a deliberate owner hold (see open questions); if not, revert to 'balanced'. If deliberate, pair it with a batch-approve surface on /admin/pricing plus a pending-count line in the owner digest, or it becomes a second 6,586-row graveyard. Retire/bulk-close the stale v1 queue as p2-9-pricing-converge already plans (docs/store-team/trackers/automation-audit-roadmap.md).

*Verifier correction:* Core claim verified: pricing_approval_mode flipped to 'review_all' today (pipeline_settings updated_at 2026-07-22 17:51 UTC, after today's 07:00 UTC batch and the last audit row at 17:40, so the change bites from tomorrow's batch); in review_all every surviving price change returns 'pending' (app/lib/pricing-apply-v2.server.ts:101, not :100); v2 was genuinely autonomous (3,383 auto_applied lifetime, 1,555 applied+auto_applied last 7 days); pricing_costsync_enabled=false; routine 13 is explicitly read-only (docs/store-team/routine-schedule.md:91) and the only pending→applied writers are admin-session endpoints (api.pricing.audit-action.tsx, api.pricing.approve-all.tsx, both requireAdmin), so no agent can drain the queue. TWO corrections: (1) 'proven 100% abandonment rate' overstates. The abandoned queue is the superseded v1 pricing_changes table (6,586 pending, all run_date 2026-05-13, 0 ever applied, 2 failed). The queue review_all actually feeds is the v2 pricing_audit_log pending flow, which the owner HAS been draining: all 6,999 lifetime 'applied' rows required admin clicks, including 99 in the last 7 days and 44 in the last day, and v2 pending currently stands at 0. The risk is a large new daily click burden (~200-250 changes/day based on last-day auto_applied=191), not a proven-abandoned pattern. (2) 'every v2 recompute returns pending' is loose: skipped_no_change (9,754 last day) and rejected (1,087 last day) still short-circuit before the review_all branch; only actual price changes passing margin-floor/MAP checks queue as pending.


**[HIGH] Email campaign execution has no plumbing at all, the largest uncovered revenue surface, RED past its own deadline (verified)**

app/lib/klaviyo.server.ts contains only list-subscribe, event-tracking, and profile helpers, no campaign create/schedule/send functions (verified by function inventory). email_team_enabled=false since 2026-07-17, both filed campaign briefs were dismissed, and the two production-ready briefs are parked in docs. The roadmap tracker's own probe marked p0-1-email RED at its 2026-07-20 target with 'zero evidence' and suggestion #57 filed. Even when checkout is fixed, campaign execution remains a fully manual Klaviyo session; the welcome flow and re-engagement broadcast (which double as the checkout smoke test) cannot be staged by any agent.

*Evidence:* app/lib/klaviyo.server.ts:29-360 (function list, no campaign API); grep for klaviyo-campaigns across app/ and server/ = no matches. docs/store-team/trackers/automation-audit-roadmap.md p0-1-email row (RED, 'no campaign functions at all'). DB: pipeline_settings email_team_enabled=false (2026-07-17); suggestions email/dismissed campaign=2.

*Recommendation:* Build klaviyo-campaigns.server.ts: create campaign + template from an approved brief, assign segment, leave in DRAFT; add an admin 'stage in Klaviyo' action on approved campaign-kind suggestions. Owner keeps the send click inside Klaviyo. This converts the parked briefs from a manual transcription job into a one-click review, and is the prerequisite for the email team ever re-enabling usefully.

*Verifier correction:* Claim stands as written. Only nits: klaviyo.server.ts is 447 lines (exports continue past the cited line 360, all still non-campaign helpers), and a third dismissed kind=campaign row exists (#18, a strategy-team meta-observation, not a brief); the two filed briefs #21/#22 are indeed both dismissed.


**[HIGH] Social loop dead-ends at an owner review that never happens; autopost graduation is mathematically unreachable (verified)**

All 18 social_posts rows ever created are status='draft', review_status='pending_review', zero posts have ever been published on any platform. The oldest draft is 2026-07-14. The documented graduation criterion for enabling autopost (~20 consecutive unedited drafts, per the prior audit Tier 1 item 5) can never be met because the counter requires reviews that are not occurring; the social_team_autopost key does not even exist in pipeline_settings (double-gated with env X_AUTO_POST_ENABLED, app/lib/team-keys.ts:103-104,143). Meanwhile the social routine succeeded 7 times in the last 7 days but max(created_at) on drafts is 2026-07-19, so recent runs are producing nothing (see open questions). IG/TikTok have no posting clients at all (p2-3, targeted 2026-09-21). Net: a daily routine burns spend producing content with zero distribution and zero engagement feedback, indefinitely.

*Evidence:* DB: social_posts total=18, all draft|pending_review, created 2026-07-14..19; homepage_team_runs social succeeded=7 in 7 days; pipeline_settings has no social_team_autopost key. app/lib/team-keys.ts:103-143. docs/agent-automation-audit-2026-07.md §4 Tier 1 (graduation criterion). Roadmap p2-3-social row.

*Recommendation:* Pick one: (a) institute a weekly 10-minute owner review ritual driven by a 'social drafts awaiting review: N (oldest X days)' line in the daily digest, or (b) flip X autopost now with a review-sampling regime (audit 1 in 5 posted). Also build the cheap middle path the prior audit named: draft packaging (caption + rendered asset + checklist) so manual IG/TikTok posting takes 30 seconds. Pausing the daily cadence to 2-3x/week until distribution exists would stop pure waste.

*Verifier correction:* All cited facts confirmed. One wording refinement: the graduation criterion (docs/store-team/README.md:93-94) counts "~20 consecutive drafts posted unedited," so it requires the owner to manually post drafts, not merely review them; with 0 of 18 drafts ever reviewed or posted (posted_at all NULL), the counter has never started. "Unreachable" holds under current behavior rather than as a mathematical impossibility.


**[HIGH] Customer support email (hello@xdipx.com) has zero automation and is scheduled last in the roadmap (verified)**

customer-service-emma (.claude/agents/customer-service-emma.md) is a fully specified support agent with authorized Shopify actions and escalation rules, but it is interactive-only: grep across app/, server/, scripts/ finds no IMAP client, no inbox poller, no inbound-email webhook, and no schedule/trigger for it (Zoho appears only as outbound SMTP in app/lib/owner-alerts.server.ts:42-50 and app/lib/pricing-report.server.ts:323). Every inbound support email is read and answered by the owner by hand, or not at all, with a payments dispute risk profile (high-risk billing, 'what's that charge?' emails) where response latency directly feeds chargebacks. The roadmap slots this as p2-4 with a 2026-09-28 target, the last milestone in the program, which is misaligned with both the autonomy goal and the chargeback exposure.

*Evidence:* grep -rl 'IMAP|imap|zoho|Zoho' over app/ server/ scripts/ .claude/agents/ → only owner-alerts.server.ts, pricing-report.server.ts (outbound SMTP), and the agent def itself. .claude/agents/customer-service-emma.md (no inbox wiring, tools are Read/Bash/Grep/Glob). docs/store-team/trackers/automation-audit-roadmap.md p2-4-support row (target 2026-09-28). Project memory: hello@xdipx.com is on Zoho IMAP.

*Recommendation:* Promote p2-4 to P1. Sketch: a cloud routine (or Vercel cron + Zoho IMAP poll in a .server module) fetches unseen messages, threads them, runs customer-service-emma via the SDK, and stores draft replies + proposed Shopify actions for one-click owner approval on a new /admin/support surface; auto-send graduates per category (order-status first, refunds last) exactly as the agent def already anticipates. Human stays: approving drafts initially, all escalation categories permanently.

*Verifier correction:* All substantive elements confirmed, with one precision fix: p2-4-support (target 2026-09-28, not-started) is not uniquely the last milestone; it shares the final W12 target date with p2-5-eeat, p2-7-cwv, p2-8-docs, and p2-9-pricing-converge (automation-audit-roadmap.md:32-37, week anchors line 8). It sits in the final cohort of the program, not solo-last. Everything else stands: customer-service-emma is fully specified but interactive-only by its own autonomy_note (lines 87-89: "a human pastes the email into the conversation"); no IMAP client, inbox poller, inbound-email webhook, or schedule exists for it anywhere in app/, server/, scripts/, or routines; Zoho appears only as outbound SMTP (owner-alerts.server.ts:42-50, pricing-report.server.ts:323); nodemailer is the only mail dependency (outbound); webhook routes are Shopify/Nalpac/Sanity only. Chargeback framing is grounded in the agent def itself (lines 19, 44) and the high-risk payments stack in CLAUDE.md.


**[HIGH] The trigger fleet has no watchdog; one routine has never existed and nothing would notice another dying (verified)**

The 14 agent routines live in Claude's cloud scheduler, outside the repo. Routine 11 (Weekly Off-site Scout) has never had a trigger and has never run, confirmed both by docs and by the runs table (no offsite run_type rows ever). The only liveness check is the Monday weekly-strategy self-audit, which is itself a single point of failure (if ITS trigger dies, the checker dies with it), and history proves the failure mode is real: ops-blockers #16/#17 record social and ads triggers silently not firing for 7+ days, discovered only by a manual audit; the apply pass silently never ran for two weeks (runs 28/58) due to the run-cap interaction. The daily owner digest lists runs that happened but does not diff expected-vs-actual against the schedule manifest, so an absent run produces no signal, and for disabled teams (ads/email) a dead trigger is indistinguishable from a valve-off skip.

*Evidence:* docs/store-team/routine-schedule.md ('Routine 11 ... still has no cloud trigger, it has never fired'; run-cap failure history 2026-07-07..21). DB: homepage_team_runs run_type inventory has no offsite rows. docs/store-team/ops-blockers.md #16/#17. app/lib/owner-digest.server.ts:97-98 (reads runs, no expected-schedule diff).

*Recommendation:* The repo already versions the expected schedule (routine-schedule.md). Add a digest section that parses each routine's cadence and flags any routine whose last matching run (including gate-skips, which prove trigger liveness) is older than its period + grace. Create the routine-11 trigger or formally remove it from the manifest. This turns 'is the automation even running?' into a daily monitored property instead of a Monday best-effort.

*Verifier correction:* Claim stands as written except one refinement: for disabled teams a dead trigger and a valve-off skip are technically distinguishable in homepage_team_runs (routines write a status='skipped' row after the gate check, e.g. routine-ads-weekly.md Steps 0-1), but no automated consumer surfaces that difference, the owner digest lists only runs that occurred and alerts only on status='failed', so in practice absence still produces zero signal.


**[MEDIUM] Owner digest is blind to the three queues that are actually backing up**

The daily digest (built as p0-6, PR #282, /cron/owner-digest 13:00 UTC) covers profit, team runs, valve snapshot, GSC indexing, the suggestion queue, and trackers, but queries neither pricing_changes (6,586 pending + tomorrow's review_all inflow), nor social_posts (18 awaiting review), nor import_candidates (319 pending; 233 stuck unenriched). Grep confirms zero references to those tables in owner-digest.server.ts. The digest is the owner's designated no-dashboard interface, so every backlog it omits is effectively invisible, which is precisely how the enrich stall and the social review pile-up went unnoticed. Additionally, delivery cannot be confirmed from the repo: sendOwnerEmail silently returns sent:false when ZOHO_SMTP_USER/PASS are unset (owner-alerts.server.ts:49-50), and those keys plus OWNER_ALERT_EMAILS exist only in .env.example (L164-169), not the local .env.

*Evidence:* app/lib/owner-digest.server.ts:85-140 (only daily_profit_summary, homepage_team_runs, homepage_team_suggestions, gsc_index_daily/gsc_url_inspections); grep -c 'pricing_changes|social_posts|import_candidates' = 0. app/lib/owner-alerts.server.ts:42-50. Commit c5e91ea (#282), cec668d (#297).

*Recommendation:* Add a 'queues needing you' section: pricing pending (count + oldest), social drafts pending_review (count + oldest), import pending / imported-unenriched (count + stalled flag), approved-suggestion execution backlog by kind. Verify OWNER_ALERT_EMAILS and Zoho SMTP vars are set in the production Vercel env and that a digest actually arrived (the KV once-a-day guard makes a silent-skip look identical to a send in the logs).


**[MEDIUM] Auto-approve fixed triage, but execution is the new bottleneck: 21 approved self-improvement rows and 3 approved ad campaigns are waiting on owner hands**

With {team}_team_auto_approve_suggestions ON for all five active teams (homepage/content/social/strategy/product, flipped 2026-07-18/19), suggestions now flow frictionlessly to 'approved', where they wait. Currently approved and unexecuted: 21 agent-editor-eligible rows (homepage 10 instructions + 1 agent-def, content 6 instructions + 1 config, social 3 instructions; oldest 2026-07-12) against an apply pass that runs only Mondays with a 5-PR cap and has produced just 4 'applied' rows lifetime, a 4-5 week backlog at current throughput, each PR then needing an owner merge. Owner-executed kinds pile with no nudge: strategy 10 process + 2 program, content 6 process + 2 code (code rows need a human to task rr7-engineer). ad_campaigns has 3 approved proposals from 2026-07-14 never launched (defensible while ads are held, but they sit with no expiry/re-review). Nothing measures proposal-to-execution latency, so the improvement loop's real cycle time is unmanaged.

*Evidence:* DB: homepage_team_suggestions status='approved' by team/kind (query in audit), oldest approved 2026-07-12; applied lifetime=4; ad_campaigns approved=3, created 2026-07-14. docs/store-team/improvement-loop.md (kind→executor table, 5/run cap); routine-schedule.md routine 2 (Mon-only). gh pr list: 0 open PRs. pipeline_settings *_auto_approve_suggestions=true × 5.

*Recommendation:* Raise the apply-pass cap (10-15) or add a second weekly apply slot (cap 3 on strategy_team_max_runs permits Monday only, schedule Thursday under a different team label or raise the cap deliberately). Add approved-row age to the digest queue section. Give campaign/promo/code/program rows a stale-after policy: auto-dismiss or re-propose after 21 days so the queue reflects reality. Consider letting agent-editor also open the PR for approved 'code' rows tagged XS (still owner-merged).


**[MEDIUM] Three revenue plumbing pieces remain unbuilt despite being top of the roadmap: back-in-stock, discount minting, referral rewards**

(1) Back-in-stock (p0-2, RED past its 2026-07-20 target): waitlist signups fire Klaviyo 'Waitlist Signup' events (klaviyo.server.ts:85) but no code detects restock, grep finds no back-in-stock path in server/webhooks.ts or klaviyo.server.ts; captured demand leaks. (2) Discount minting (p1-5): no discountCodeBasicCreate wrapper exists anywhere, so every approved promo-kind suggestion (2 currently proposed under strategy) requires the owner to hand-mint codes in Shopify with a manual MAP check. (3) Referrals (p2-2): ?ref capture and the referrals table exist but no code generation or reward issuance, so the loyalty-referral-manager's proposals are inert. All three are agent-ready (the proposing agents exist) and blocked purely on engineering; all three matter only after checkout works, which is why they rank below the probe/email/support items.

*Evidence:* docs/store-team/trackers/automation-audit-roadmap.md rows p0-2-restock (RED, 'handleInventoryUpdate still early-returns... no Klaviyo back-in-stock trigger exists anywhere'), p1-5-discounts, p2-2-referral. grep: no 'discountCodeBasicCreate' and no back-in-stock strings in app/ or server/. app/lib/klaviyo.server.ts:58-86.

*Recommendation:* Ship in this order once the checkout probe passes: back-in-stock (XS: restock branch in the existing inventory webhook + one Klaviyo event), discount minting (MAP-guarded wrapper consuming owner-approved promo rows), referral MVP (code generation reusing the minting wrapper + reward on first attributed order). Each has a clear human gate already designed: owner approves the promo/reward parameters; agents handle everything else.


**[MEDIUM] Scale fragility at 10x: zero-headroom run caps, the 60s function ceiling, a polluted settings table, and a single-merger owner**

If traffic or agent activity grew 10x tomorrow: (1) strategy_team_max_runs=3 exactly equals Monday's three strategy-team fires and content_team_max_runs=3 exactly covers Sunday/Wednesday double-days, zero retry headroom, and the documented failure mode (silent over_run_cap skips hiding the apply pass for two weeks) returns on the first flaky run. (2) The Vercel 60s cap is already the binding constraint twice over, the GSC index-sweep needed resizing (#298 'index-sweep sizing for function timeout') and the enrich stall (finding 1) fits the same signature; any per-item serial loop over a growing catalog will hit it next (inventory-check */15, pricing batch). (3) pipeline_settings holds 1,798 velocity:* cache rows plus multi-KB JSON blobs (searchFilterTaxonomy, pricing_product_types_cache, brandVoice) in the same table the gate reads on every team call, a settings table being used as a KV store, on Neon. (4) KV payload pressure already forced the Upstash gzip fix (#291) and the homepage payload diet (#295, 3.3MB→1MB). (5) Every code path change still funnels through one person's merge button: agent-editor PRs, design-cycle PRs, code-kind suggestions, the owner is the only merger, with no delegation or batching mechanism.

*Evidence:* pipeline_settings: strategy_team_max_runs=3, content_team_max_runs=3 (updated 2026-07-21); velocity:* count=1798. docs/store-team/routine-schedule.md (run-cap requirements section, 'zero retry headroom'). Commits 7d0daf8 (#298), 7c873f3 (#295); #291 per audit brief. docs/store-team/improvement-loop.md (owner merges every PR).

*Recommendation:* Move velocity:* into Vercel KV or a dedicated table (one-line namespace change). Set run caps to load+1 as policy, not load. Adopt a chunk-and-checkpoint convention for any cron iterating per-product (the enrich fix generalizes). For the merge bottleneck, keep the human gate but batch it: a weekly 'merge review' block driven by the digest, and consider auto-merge for agent-editor PRs that only touch the allowlisted docs AND pass CI, since the file allowlist is already hard, that is the single biggest supervised-time reduction available without weakening a money valve.


**[MEDIUM] Published content has no per-asset performance readback: teams optimize on proxies while 27 of 4,501 sitemap URLs are indexed**

The feedback side of the improvement loop is thin exactly where volume is highest. Content publishes daily (9 succeeded runs in 7 days) and homepage merchandises daily, but GSC data shows 27 'Submitted and indexed' URLs out of 4,501 tracked, 1,077 'Discovered - currently not indexed', 609 sitemap URLs excluded by noindex, and 2,390 never inspected, i.e., almost nothing the content team ships is currently findable, and no per-post readback (impressions/clicks per notebook URL, indexed-or-not per new post) reaches the content retro. GSC snapshots only began 2026-07-21 (1 row) so the pipeline is new, but the wiring gap is structural: retros read runs/spend/GA4 aggregates, not per-asset outcomes. Social has literally zero performance data (nothing ever posted); ads proposals have never had actual_spend synced (none launched); import decisions get no sell-through readback (0 orders). Only the homepage team has a genuine outcome loop (healthcheck + GA4 + edge-cache telemetry).

*Evidence:* DB: gsc_url_inspections coverage_state breakdown (27 indexed / 1,077 discovered-not-indexed / 609 noindex / 2,390 null); gsc_snapshots count=1 (2026-07-21); gsc_index_daily 2 rows. homepage_team_runs content succeeded=9 in 7 days. ad_campaigns actual_spend_usd all 0. social_posts posted=0.

*Recommendation:* Wire per-asset readback into the retro step each routine already runs: content retro should read its own posts' rows from gsc_url_inspections (indexed? impressions once available) and file suggestions against pages that never index; seo-curator's weekly report already has the right shape to carry this. Add 'newly indexed this week: N' as a KPI in the strategy brief so the content team's target is indexed pages, not published posts. The 609 noindexed sitemap URLs and 148 duplicate-canonical URLs belong to the SEO auditor's area but should be cross-checked.


**[LOW] Deliberately-off automations inventory: what flipping each one actually requires**

Built-but-off switches, with flip requirements: (1) ads_team_enabled=false (2026-07-20), flip is one dashboard toggle, but correctly held per ops-blockers #17 until checkout converts; trigger still fires and gate-skips, proving liveness. (2) email_team_enabled=false (2026-07-17), flipping is pointless until the Klaviyo campaign client exists (finding 4); briefs would just re-accumulate. (3) social_team_autopost, key absent (default off) + env X_AUTO_POST_ENABLED; requires the review ritual (finding 5) to satisfy the graduation criterion first. (4) reviews_pdp_enabled=false, correctly off until real reviews exist (Google policy note in migration 055); blocked by zero orders, not by engineering. (5) pricing_costsync_enabled=false, engine v2 is live and applying; this flip is genuinely one toggle plus watching the first day's audit rows. (6) monitor_p2_tierC_enabled=false, Tier-C auto-import; owner accepted 'admit all vendors' 2026-07-13 with a ~2026-08-12 revisit (p2-10). (7) keyword_research_enabled=false, monthly cron no-ops; flip when the SEO bank needs replenishing. (8) Routine 11 offsite-scout, needs a trigger created, not a valve.

*Evidence:* DB: pipeline_settings values with updated_at dates as listed. docs/store-team/ops-blockers.md #16/#17. db/migrations/052_enable_teams.sql (originally set ads/email true, both since flipped back off, confirming active owner curation of the valve set). docs/store-team/trackers/automation-audit-roadmap.md p2-10.

*Recommendation:* Keep this inventory in the tracker with the flip-precondition for each (several 'off' states are correct and should not be flipped blind). The two flips with positive expected value right now: pricing_costsync_enabled (protects margin on Nalpac cost drops, zero revenue dependency) and creating the routine-11 trigger (propose-only, no spend).


### Completeness critic (cross-cutting checks)

The seven reports cover routines, agents, SEO/AEO surfaces, cron plumbing, recent dev drift, and autonomy gaps well, but they collectively never audited the money path or the measurement of it: no one verified that checkout can actually take a payment (CLAUDE.md names Segpay/Verotel, yet the codebase contains zero payment-processor code and hands off to Shopify checkoutUrl), no GA4 purchase event exists anywhere (the funnel goes dark at begin_checkout while Meta CAPI alone receives Purchase), and Klaviyo has no cart/checkout/order lifecycle events at all, which means the email program everyone agrees is the biggest missing revenue surface would have no flow triggers even after its plumbing is built. Compliance was also unaudited: the Phase 1 checklist promises a site-wide age gate, but the live homepage serves all 243KB of content unconditionally and the only age panel is a localStorage click-through inside the cart drawer. Two reports quietly contradict each other on import-chain health (plumbing calls the unattended import path live and green off cron-liveness evidence; gap analysis shows 233 stuck drafts and zero enrichment batches since 2026-07-20), which itself exposes the missing throughput-level health metric. Finally, nobody owned the single most alarming SEO number in the whole audit, 27 of 4,501 URLs indexed, nor the scaled-AI-content risk that likely drives it, and the team-token control plane's shared-secret fallback and the missing backup story for team-auto-published Sanity content beyond the homepage singleton went unexamined.


**[HIGH] Payments subsystem never audited: no payment-processor code exists and nobody verified checkout can take money**

CLAUDE.md declares the payments layer as 'Segpay or Verotel (high-risk, NOT Stripe/PayPal)', but a repo-wide search finds zero occurrences of either processor in app/, server/, db/, or docs/ beyond that stack-table row. The storefront hands off to Shopify's hosted checkout via cart checkoutUrl and nothing in the repo or any of the seven reports establishes which gateway (if any) is live on the Shopify side. Shopify Payments prohibits adult products, so an unconfigured or rejected high-risk gateway is a plausible single root cause for the gap auditor's critical '24+ days of $0 revenue' finding, yet no auditor looked at this layer at all.

*Evidence:* CLAUDE.md:78 (payments row); grep for segpay/verotel across app, server, db, docs returns no code hits; app/lib/shopify.server.ts:2245,2282,2308 (checkoutUrl handoff is the only checkout plumbing).

*Recommendation:* Before building any synthetic checkout probe, manually walk one real test transaction through Shopify checkout and confirm which gateway is active and approving adult-catalog orders; document the gateway in CLAUDE.md and add its status to the owner digest.


**[HIGH] GA4 conversion tracking dead-ends at begin_checkout: no purchase event exists anywhere, so every team optimizes blind to revenue**

app/lib/analytics.client.ts implements view_item, add_to_cart, view_cart, and begin_checkout but contains no purchase event (grep for 'purchase' in the file returns nothing). Because checkout completes on Shopify's domain, a purchase event must come server-side, and the order webhook sends only a Meta CAPI Purchase (server/webhooks.ts:168-200); there is no GA4 Measurement Protocol call outside a connectivity test in admin.settings.tsx:104. Result: Meta would see conversions but GA4 (the stack's declared analytics layer feeding strategy/ads decisions) never records a purchase, ROAS or conversion-rate readback is impossible, and the gap auditor's 'no per-asset performance readback' finding is structurally unfixable until this lands. No report noticed the asymmetry.

*Evidence:* app/lib/analytics.client.ts:154-157 (funnel ends at begin_checkout, no purchase event in file); server/webhooks.ts:168-200 (Meta CAPI Purchase only); app/routes/admin.settings.tsx:104 (only mp/collect reference in the codebase).

*Recommendation:* Add a GA4 Measurement Protocol purchase event to handleOrderCreated alongside the existing CAPI send (same event_id idempotency), or enable Shopify's native GA4 sales tracking, and backfill a note in the analytics doc about which system owns conversion truth.


**[HIGH] Klaviyo has zero cart/checkout/order lifecycle events, so abandoned-cart and post-purchase flows have no trigger data even once email plumbing is built**

app/lib/klaviyo.server.ts covers list subscribes, review events, wishlist events, and a daily-deal trigger, but no 'Added to Cart', 'Started Checkout', or 'Placed Order' events exist anywhere in the codebase, and the order webhook makes no Klaviyo call. Because the storefront is headless, Klaviyo's Shopify onsite tracking never runs either. The gap auditor flagged missing campaign-send plumbing (p0-1) as the largest uncovered revenue surface, but this is a second, independent blocker: the highest-ROI automated flows (abandoned cart, browse abandonment, post-purchase) cannot fire without these events regardless of campaign plumbing. No report audited Klaviyo event wiring.

*Evidence:* Function inventory of app/lib/klaviyo.server.ts:29-422 (subscribes, review, wishlist, preference functions only); grep for 'Started Checkout'/'Placed Order'/'Added to Cart' across app and server returns no code hits; server/webhooks.ts imports no Klaviyo module.

*Recommendation:* Wire trackEvent calls for Added to Cart (cart action), Started Checkout (checkoutUrl handoff), and Placed Order (order webhook, idempotent on retries), then confirm in Klaviyo which metrics the flows are keyed on; treat this as a prerequisite line item on the p0-1 email milestone.


**[HIGH] Nobody owns the audit's worst SEO number: 27 of 4,501 URLs indexed, with unexamined scaled-AI-content risk as the likely driver**

The SEO auditor audited indexing readiness (sitemap, canonicals, JSON-LD) and the AEO auditor audited machine surfaces, but the actual indexing outcome, 0.6% of sitemap URLs indexed, appears only as an aside inside the gap auditor's per-asset-readback finding and generated no finding of its own. With 4,259 PDPs of templated, batch-AI-generated copy grown by the import automation, the unexamined hypotheses include Google's scaled-content/thin-content classification, crawl-budget starvation, and 'Crawled - currently not indexed' at scale; the GSC snapshot infra to answer this exists (gsc_index_daily, live since 2026-07-21 per the plumbing report) but no auditor queried coverage reasons or trend. For a store whose stated goal is being fully Google-indexable, this is the central open question of the entire audit and it fell between three auditors' scopes.

*Evidence:* Gap report ('27 of 4,501 sitemap URLs are indexed'); SEO report (4,501-URL sitemap, 4,259 products, no finding on indexing rate); plumbing report (gsc_index_daily current through 2026-07-22, gsc_snapshots first row 2026-07-21). No report contains a finding about index coverage reasons or scaled-content risk.

*Recommendation:* Pull the GSC page-indexing report breakdown (reasons per excluded URL) via the live service account, add index-coverage percentage and top exclusion reason to the owner digest, and commission a focused review of PDP copy uniqueness/quality at scale before importing more products.


**[MEDIUM] Two auditors contradict each other on import-chain health because health is measured at cron-liveness, not throughput**

The server-plumbing report concludes the unattended import-to-live path is 'live' and run health 'largely green', citing import_monitor_last_run_at 2026-07-22T08:02 as evidence crons fire. The gap report, for the same window, rates the same chain critical: 233 products stuck as unpublished drafts with zero enrichment batches submitted in ~96 cron ticks since 2026-07-20. Both are factually right, which is the finding: every health signal in the system (cron timestamps, run records, valve states) measures 'did the job start', and nothing measures 'did work move through', so a green dashboard and a fully stalled pipeline coexist. Neither auditor identified which gate or error actually stopped batch submission, so the stall's root cause is still unknown after a 7-auditor audit.

*Evidence:* Plumbing report ('import_monitor_last_run_at 2026-07-22T08:02', 'fully unattended import-to-live path is live') vs gap report ('stalled on 2026-07-20 with 233 imported products stuck as unpublished drafts (zero enrichment batches submitted in ~96 cron ticks)').

*Recommendation:* Add throughput SLOs (e.g. 'enrichment batches submitted per day > 0 while drafts pending', 'drafts older than 48h = alert') to the owner digest and cron alerting, and run a targeted debug session on why batch submission stopped 2026-07-20.


**[MEDIUM] Age-gate compliance drift: the Phase 1 checklist promises a site-wide age gate but the live site serves all content unconditionally, with only a localStorage click-through in the cart drawer**

CLAUDE.md's launch checklist requires 'Age gate renders before all content, persists 30 days', but AgeGatePanel is rendered only inside CartDrawer.tsx, verification is a client-side localStorage flag (use-age-verified.ts, xdipx_age_verified, 30-day expiry), and a live GET of https://xdipx.com/ returns the full 243KB page (HTTP 200) to any unverified visitor. This is good for crawler access (no cloaking, consistent with the SEO auditor's byte-identical Googlebot check) but it means an adult store running intensity-9 explicit copy has no content-level age verification, which no auditor examined against state age-verification laws, ad-network adult-content policies, or the paid-ads plans in the roadmap. The consent-logging plumbing exists (api.consent.tsx, consent.server.ts) but nobody audited it either.

*Evidence:* CLAUDE.md:268 (checklist line); app/components/store/CartDrawer.tsx:107 (only AgeGatePanel render); app/lib/use-age-verified.ts:3-5 (localStorage, 30-day); live check: curl https://xdipx.com/ returned 200 with 243,004 bytes and '18 or older' strings present but content unbarred.

*Recommendation:* Get an explicit owner decision documented in-repo: either the cart-only gate is the intended policy (update the checklist and note the legal reasoning) or reinstate a site-wide gate using a crawler-safe client overlay; have the ads-policy doc state how age gating interacts with paid acquisition.


**[MEDIUM] Team-token control plane runs on a single shared static secret that falls back to CRON_SECRET, with no scoping or rotation story**

All 10 api.team.* routes correctly call assertTeamAuth (spot-verified: none missing), but the expected secret resolves as TEAM_TOKEN ?? HOMEPAGE_TEAM_TOKEN ?? CRON_SECRET, so if TEAM_TOKEN is unset in any environment the cron secret doubles as the write-credential for the entire agent control plane (suggestion writes, import-candidate approve/reject, run recording). One leaked value then grants both planes. The secret is also distributed by symlinking .env into every worktree (scripts/setup-worktree.sh) and attached to 13+ external cloud-routine prompts, a wide blast radius with no rotation procedure, no per-team scoping, and no auth-failure alerting. The routines auditor flagged MCP connector exposure on triggers but nobody audited the token model those same triggers authenticate with.

*Evidence:* app/lib/team.server.ts:65-71 (fallback chain in assertTeamAuth); spot-check: 0 of 10 app/routes/api.team.*.tsx files lack an assertTeamAuth call; CLAUDE.md worktree-setup section (env symlinking).

*Recommendation:* Set a dedicated TEAM_TOKEN in prod distinct from CRON_SECRET, remove the CRON_SECRET fallback from assertTeamAuth, log and alert on 401s to /api/team/*, and write a one-page rotation runbook covering which cloud-routine prompts embed the token.


**[LOW] No backup/restore story for team-auto-published Sanity content beyond the homepage singleton's last-good-revision rollback**

The homepage healthcheck rolls the homepage doc back to a stored last-good revision on hard failure, but the other surfaces agents write daily, emmaCuratedRail, editorialTiles, productPage docs created by import sync, and the content team's daily blog posts, have no snapshot, export, or restore tooling anywhere in scripts/ (no sanity export/backup script exists), and the design-elevation-plan itself concedes content auto-publishes daily with 'rollback only on hard failure'. Recovery from a bad agent run, a schema mistake, or a bulk-write bug across those doc types currently depends entirely on Sanity's plan-dependent document history and manual Studio work, which no auditor examined despite auto-publish being the store's core carve-out.

*Evidence:* docs/homepage-team/README.md:122 (rollback covers the Sanity homepage doc only); docs/homepage-team/design-elevation-plan.md:37 ('No visual regression safety net... rollback only on hard'); ls scripts/ shows sync/seed/dedupe scripts but no export or backup tooling.

*Recommendation:* Add a nightly cron that runs a Sanity dataset export to blob storage (cheap, read-only), and document the restore path per doc type; confirm the Sanity plan's history retention window and note it in the homepage-team README.
