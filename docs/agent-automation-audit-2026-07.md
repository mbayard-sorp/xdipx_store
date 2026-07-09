# Agent Automation Audit — July 2026

**Goal audited against:** as close to full automation as possible for all store functions, and winning new customers.
**Scope:** all agent-plane routines (`.claude/agents/`, `docs/store-team/`, `docs/homepage-team/`), the control plane (`app/lib/team.server.ts`, `/api/team/*`, `/admin/homepage-team`), server-side automation (`server/cron.ts`, `server/webhooks.ts`, schedulers), and every customer-acquisition surface.
**Method:** four parallel code sweeps (team infra, cron/webhooks, acquisition surfaces, ops/support), with the highest-impact findings verified line-by-line.

---

## 1. Executive summary

The store has an unusually complete automation *architecture* — a five-team agent plane (homepage, social, ads, email, strategy) sharing one control plane with budgets, kill switches, a run/event feed, a suggestion improvement bus, and a weekly strategy brief. But measured against the full-automation goal, the current state is:

- **Only two loops are truly closed today:** homepage daily merchandising (Routine A, when `homepage_team_enabled` is on) and the deterministic `/cron/*` store jobs (pricing, imports discovery, deal rotation, profit, monitoring).
- **A large tier of automation is built but switched off** — the import→live chain, the product-manager agent, and every team's enable flag default to off. These are one dashboard flip away, not engineering work.
- **The biggest revenue surfaces have missing plumbing, not missing agents.** Email can't send campaigns (no Klaviyo campaign client), promos can't mint discount codes, referrals capture but don't reward, IG/TikTok can't post, and customer-service email has no inbound pipeline. The agents that would drive these are already written as stubs waiting on the plumbing.
- **Three verified production defects undermine automation that everyone believes is running** (§3): the homepage self-heal healthcheck is not scheduled anywhere that actually fires; review-invite emails silently never send; and the keyword-research job the owner paused is still running weekly.

The fastest path to the goal is: fix the three defects (days), flip the built-but-off switches (owner decision), then build the four missing plumbing pieces in revenue order — email campaigns, review/social-proof loop, restock/abandoned-cart triggers, referral MVP (§5–6).

---

## 2. Automation scorecard by function

Legend: 🟢 closed loop (unattended end-to-end) · 🟡 built, gated off or human-in-loop · 🟠 stub (agent proposes, execution missing) · 🔴 not built.

| Function | State | Detail |
|---|---|---|
| Homepage merchandising (content) | 🟢* | Routine A auto-publishes within gate/budget; *self-heal net currently unscheduled (§3.1)* |
| Homepage design/code changes | 🟡 | Routine B opens PR, human merges — correct by policy |
| Product import: candidate discovery | 🟢 | `/cron/import-monitor` daily, writes `import_candidates` |
| Product import: approve/reject | 🟡 | Fully built (Phase 2 gates + product-manager agent), **all switches default off** |
| Product import: enrich→publish | 🟡 | Fully built (`/cron/import-enrich` + batch poller), `import_enrich_enabled` default off |
| Pricing | 🟢 | Daily recompute + Nalpac cost webhook; auto-applies within mode threshold, queues the rest |
| Daily deal: scoring | 🟢 | `/cron/daily-feed-processor` writes top-30 to KV |
| Daily deal: staging | 🔴 | `orchestrateDealPipeline` called **only** from the admin "Run Pipeline Now" button (§3.4) |
| Daily deal: activation | 🟢 | `/cron/deal-activator` promotes any `queued` deal — but bypasses the approval vocabulary (§3.4) |
| Email marketing | 🟠 | Plan-only stub; **no campaign API client exists** — largest uncovered revenue surface |
| Email lifecycle triggers | 🟡/🔴 | Deal-drop + review-reminder events fire; review *invites* broken (§3.2); back-in-stock & abandoned-cart triggers not built in-repo |
| Social: X | 🟡 | Full posting plumbing exists; autopost double-gated off (`social_team_autopost` + `X_AUTO_POST_ENABLED`); agent drafts only |
| Social: IG/TikTok/FB | 🟠 | Draft rows only; no posting API clients |
| Paid ads | 🟠 | Propose-only **by deliberate policy** (`docs/ads-policy.md`); Meta CAPI conversion tracking already wired |
| Promotions / discount codes | 🟠 | promo-manager proposes; nothing can mint a Shopify discount code |
| Referral / loyalty | 🟠/🔴 | `?ref=` capture + `referrals` table automated; no code generation, rewards, payouts, or loyalty at all |
| SEO/AEO surface | 🟢 | llms.txt, sitemap, feed.xml, robots fully dynamic; AEO check built (but unscheduled, §3.1) |
| Content (blog/notebook) | 🟡 | AI generation is admin-triggered, publish via Sanity is manual; no scheduled content engine |
| Conversational commerce (web chat, SMS v2, IVR) | 🟢 | Live, customer-facing, budget/rate/draft-order-capped — the most autonomous customer-facing surface in the stack |
| Customer service email | 🟠 | customer-service-emma is interactive-only; **no inbound email pipeline exists** (agent def says so verbatim) |
| Reviews | 🟡 | AI spam-gate automated; approval human by default (`auto_approve=false`); invites broken (§3.2) |
| Order → analytics/CAPI/referral capture | 🟢 | `orders/create` webhook, with self-healing CAPI retry queue |
| Returns → refund | 🟢 | `returns/update` webhook auto-refunds on terminal state |
| Fulfillment (Nalpac PO) | 🔴 | Manual handoff; `fulfillment-watchdog` documented as roadmap, not built |
| Self-improvement loop | 🟡 | Retro → suggestion → owner approve → agent-editor PR → owner merge; `suggestion_apply_enabled` default off |
| Monitoring / alerting | 🟡 | log-monitor + healthcheck file GitHub P0 issues + Sentry; **no push/email to the owner**; healthcheck unscheduled (§3.1) |
| Routine scheduling | 🟡 | Agent routines live in Claude's cloud scheduler, outside the repo — unauditable and unversioned |

---

## 3. Verified defects (automation you think you have, but don't)

These were confirmed line-by-line, not just reported by the sweep.

### 3.1 P0 — The homepage self-heal net and AEO check have no working scheduler
`.github/workflows/cron.yml:5-9` documents that **Vercel native cron never fires for this project**; GitHub Actions is the real scheduler. But `/cron/homepage-healthcheck` (*/30, the rollback safety net that justifies homepage content auto-publish) and `/cron/aeo-surface-check` (weekly) exist **only in `vercel.json`** — they are absent from the Actions schedule matrix. Net effect: the autonomous merchandiser's self-heal guarantee is not running.
**Fix (small PR):** add both to `cron.yml`'s schedule/resolve blocks and to the `workflow_dispatch` options. Also note two standing Actions caveats worth engineering around eventually: 5-minute minimum granularity (the */2 enrichment poller runs */5) and auto-disable of scheduled workflows after 60 days without repo activity — a silent way for the *entire* cron plane to stop.

### 3.2 P0 — Review-invite emails silently never send
`server/webhooks.ts:237-238`: the `orders/fulfilled` handler schedules invite creation with an in-process `setTimeout(delayMs)` where `delayMs` = `inviteDelayDays` (default 3) in **days**. On Vercel serverless the instance is reclaimed long before that fires, so the invite row is never created and the `Review Invite Sent` Klaviyo event (line 265) never fires. Downstream, `/cron/review-reminders` has nothing to remind about, and the manual invite form at `admin.reviews.invites` still carries a `// TODO: Send invite email via Klaviyo`. **The store is collecting zero post-purchase reviews on autopilot.**
**Fix:** persist an invite with a `send_after` timestamp at webhook time (no delay logic in-process) and let a daily cron (extend `/cron/review-reminders`) send invites whose `send_after` has passed. Also wire the four dead Klaviyo helpers (`trackReviewSubmitted/Approved/InviteSent/ReminderSent` — defined in `klaviyo.server.ts`, never called) or delete them.

### 3.3 P1 — "Paused" keyword-research is still spending
Commit `cc8b976` (#198) paused the weekly SEO keyword-research by removing it from `vercel.json` — the scheduler that doesn't fire. `cron.yml` still runs it every Sunday 02:00 UTC. The spend the owner intended to stop is still happening weekly.
**Fix:** remove the `0 2 * * 0` entry from `cron.yml` (keep the handler for manual triggers, as #198 intended). Process lesson: `vercel.json` should either be deleted or carry a "not authoritative" banner so future scheduling edits land in `cron.yml`.

### 3.4 P1 — The daily-deal pipeline's middle is manual, and the activator bypasses approval
Two related problems:
- **Staging never runs automatically.** `orchestrateDealPipeline()` is invoked from exactly one place: the "Run Pipeline Now" button in `admin.settings.tsx:137`. The comment in `deal-pipeline.server.ts:14` claiming it's "called automatically after dailyFeedProcessor() in server/cron.js" is stale — no such call exists. If nobody clicks the button, the 23:59 activator finds no `queued` deal.
- **Two divergent status vocabularies.** The automated track uses `queued → live → vault` (`deal-rotator.server.ts:393` selects `status='queued'`; `:190` will even claim `pending_approval`). The admin queue UI (`admin.queue.tsx`) uses `pending → approved → live`. The nightly activator **never looks at `approved`** — so the CLAUDE.md rule "never auto-publish a deal without `deal_status: approved`" is not what the code enforces; anything staged as `queued` goes live with no approval check.

**Fix:** unify the vocabulary (one enum, one path), make the activator honor the approval gate explicitly, and then decide the automation posture deliberately: either (a) cron-call `orchestrateDealPipeline` after the feed processor and keep a human approval step before activation, or (b) declare the daily-deal loop fully autonomous behind a new `deal_pipeline_enabled` switch with the same gate/budget pattern the teams use. (Daily deals are documented as a deferred phase — if that's still true, the cheapest fix is the vocabulary/comment cleanup plus a dashboard warning when no deal is queued.)

### 3.5 P2 — Documentation and dashboard drift
- `CLAUDE.md` cites `docs/import-automation-plan.md`; the file does not exist.
- `product_manager_enabled` / `product_manager_max_actions_per_run` are not in the `/admin/homepage-team` settings allowlist — they're edited from `/admin/imports` only. Fine, but the team dashboard presents itself as the single control surface and isn't.
- `api.webhooks.order-created.tsx` and `api.webhooks.returns-update.tsx` are no-op stubs shadowing the real Express handlers — delete or mark clearly.

---

## 4. Gap analysis toward full automation

### Tier 1 — Built, just switched off (owner decisions, zero engineering)
Everything ships off by default per the store-team doctrine. Reaching "as automated as possible" from here is mostly flipping valves, in this suggested order:

1. `homepage_team_enabled` — the flagship closed loop (after §3.1 restores its safety net).
2. The **import→live chain**: `import_monitor_phase='2'` + `product_manager_enabled='true'` + `import_enrich_enabled='true'`. All three are explicitly sanctioned by CLAUDE.md carve-outs; caps (`monitor_p2_max_auto_imports_per_day=8`, PM 20 actions/run) bound the blast radius.
3. `strategy_team_enabled`, `social_team_enabled`, `email_team_enabled`, `ads_team_enabled` — the propose/draft layers cost little and generate the briefs, drafts, and retro fuel the improvement loop needs.
4. `suggestion_apply_enabled` — closes the self-improvement loop up to its two (correct) human gates.
5. Later, per the documented graduation criterion: `social_team_autopost` + `X_AUTO_POST_ENABLED` after ~20 consecutive unedited drafts.

Precondition for all of it: the agent routines must actually be scheduled in Claude's cloud scheduler. That configuration lives outside the repo — see Tier 4.

### Tier 2 — Missing plumbing (engineering work; the agents already exist as stubs)
| Gap | What to build | Unblocks |
|---|---|---|
| **Klaviyo campaign client** | `klaviyo-campaigns.server.ts` (create campaign/template, assign segment, schedule as *draft*) + team endpoint | email-marketing-manager graduates from plan-only to drafts-in-Klaviyo pending owner send — the documented roadmap step for the largest uncovered revenue surface |
| **Shopify discount-code minting** | Admin API `discountCodeBasicCreate` wrapper with hard MAP guard, behind an approval-consumes-proposal flow | promo-manager's approved proposals stop requiring manual code creation; codes flow to email/social/homepage on calendar schedule |
| **Back-in-stock trigger** | Restock detection in the existing `inventory_levels/update` webhook → fire Klaviyo `Back In Stock` event against `waitlist` signups | Converts existing waitlist demand automatically; today no code detects restock |
| **Abandoned-cart trigger** | Verify Klaviyo actually receives checkout-started events from the headless flow; if not, fire a `Started Checkout` event when the cart hands off to Shopify checkout | The single highest-converting lifecycle flow; currently assumed to exist Klaviyo-side, unverified in code |
| **Inbound support email pipeline** | Gmail/IMAP poll (or forwarding webhook) → Express endpoint → customer-service-emma via SDK → drafts held for approval (auto-send only for low-risk categories later) | The agent's own def describes exactly this as the missing piece |
| **IG/TikTok posting or packaging** | At minimum: draft packaging (caption + rendered asset + checklist) to make manual posting 30 seconds; full API clients later | social-media-manager's non-X drafts become actionable |
| **Referral program MVP** | Customer-facing ref-code generation + share UI + reward issuance (store credit / discount code once minting exists); capture side already works | loyalty-referral-manager proposals become executable |
| **Owner alerting** | Push/email digest (the `review_settings.digestEmail` field already exists, nothing sends it): P0 issues, gate-closed events, pending approvals count | Cuts approval latency — the real bottleneck once teams run weekly |
| **Fulfillment watchdog** | Order → Nalpac PO status monitoring (roadmap agent); needs PO automation first | Closes the last unmonitored ops loop |

### Tier 3 — Deliberately human-gated (keep, but streamline)
Ads launch/spend, PR merges for code, and suggestion approval are human gates **by policy** (money valves, MAP, platform-policy survival). Recommendation: don't automate these; reduce their friction instead — batched approval UX on the dashboard, owner notifications when queues are non-empty (Tier 2 alerting), and one-click "approve + notify agent" so a weekly 10-minute review sustains everything downstream.

### Tier 4 — Structural risks to the automation itself
- **Agent-routine schedules are invisible.** They live only in Claude's cloud scheduler. Commit a `docs/store-team/schedule.md` manifest (routine → cadence → last-verified date) and have store-strategist's weekly run verify each expected routine actually ran (runs table has the data) — filing a suggestion when one is missing. This turns "is automation even running?" into a monitored property.
- **Single-scheduler fragility.** GitHub Actions is best-effort and auto-disables after 60 days of repo inactivity. Either resolve the Vercel cron ticket or add a dead-man's-switch: a cheap external ping (or the strategy routine) alerts if `profit-summary` hasn't written a row in 48h.
- **Two pricing stacks** (v2 `pricing_audit_log` batch vs legacy `pricing_changes` webhook) — converge on v2 before drift causes a MAP incident.

---

## 5. Winning new customers — prioritized

The store's acquisition constraint is category-driven: paid social is effectively prohibited (`docs/ads-policy.md`), so growth must come from **email/lifecycle, SEO/AEO, organic social, referral, and Google's restricted-serving surface**. Ranked by expected impact per unit effort:

1. **Lifecycle email actually firing (fix + build).** Fix review invites (§3.2), verify/build abandoned-cart and back-in-stock triggers, then ship the Klaviyo campaign client so the email team's weekly briefs become scheduled drafts. Email is the one channel with no policy ceiling and it is currently the least automated revenue surface.
2. **Social proof flywheel.** Fixed invites → reviews accumulate → review stars in PDP JSON-LD (seo-pdp-auditor already checks schema) → CTR from search. Zero-review PDPs are an acquisition tax on every other channel.
3. **Content/SEO/AEO engine.** The AEO surface (llms.txt, .md parity) is genuinely strong and mostly automated — re-schedule its health check (§3.1). The gap is cadence: blog/notebook generation exists but is admin-triggered. Build a weekly content routine (emma-copywriter → emma-empathy-reviewer gate → Sanity draft → owner one-click publish) targeting the keyword bank that keyword-research has been (accidentally) filling weekly.
4. **Organic X on autopilot, IG/TikTok packaged.** X plumbing is done; run the documented graduation path. For IG/TikTok, draft-packaging (Tier 2) captures most of the value without platform-API risk.
5. **Referral MVP.** Attribution is already captured; a share-a-code UI plus a store-credit reward is a contained build and the only channel that compounds with order volume.
6. **Google restricted-serving + Merchant Center.** The one mainstream paid channel the policy allows. `gmc-metafields.server.ts` exists — add a GMC feed-health check to the ads team's weekly run, and have ads-manager proposals prioritize Google Shopping over Meta (where proposals can never launch anyway).

---

## 6. Recommended sequence

**Now (days — fixes, one small PR each):**
1. Schedule `homepage-healthcheck` + `aeo-surface-check` in `cron.yml`; remove `keyword-research` per #198's intent (§3.1, §3.3).
2. Rework review invites to persisted `send_after` + cron send; wire or delete the dead Klaviyo helpers (§3.2).
3. Deal-pipeline vocabulary cleanup + stale-comment fix + "no deal queued" dashboard warning (§3.4).
4. Doc drift cleanup (§3.5).

**Next (weeks — owner flips + first plumbing):**
5. Schedule the agent routines in Claude's cloud scheduler; commit the schedule manifest; enable homepage, strategy, social, email, ads teams and `suggestion_apply_enabled`.
6. Flip the import→live chain (Phase 2 + product-manager + enrich) — already sanctioned, capped, and built.
7. Build: back-in-stock trigger, abandoned-cart verification/trigger, owner alert digest.

**Then (month two — revenue plumbing):**
8. Klaviyo campaign client → email team graduates to drafts-pending-send.
9. Discount-code minting with MAP guard → promo pipeline becomes executable.
10. Inbound support-email pipeline for customer-service-emma (drafts-for-approval first).
11. Referral MVP; X autopost graduation when the draft track record supports it.

**Ongoing:** weekly strategy routine verifies every expected routine ran; process-optimizer keeps cost per run falling; compliance-auditor (roadmap) gets built before ad spend ever goes live.

---

## Appendix A — Full switch/valve inventory

| Switch | Store | Default | Controls |
|---|---|---|---|
| `{homepage,social,ads,email,strategy}_team_enabled` | pipeline_settings | false | Per-team kill switches |
| `{team}_team_daily_cents` / `_max_runs` | pipeline_settings | 300–1500 / 1–4 | Budget + run caps |
| `homepage_team_build_cents` / `_max_images` | pipeline_settings | 10000 / 12 | Homepage extras |
| `social_team_autopost` | pipeline_settings | false | Live-posting valve (needs env too) |
| `suggestion_apply_enabled` | pipeline_settings | false | agent-editor PR path |
| `product_manager_enabled` / `_max_actions_per_run` | pipeline_settings | false / 20 | Unattended import decisions |
| `import_monitor_enabled` / `_run_days` / `_phase` | pipeline_settings | on / all days / 1 | Candidate discovery + Phase-2 auto-import |
| `monitor_p2_*` (cap 8/day, markup 0.08, qty 30, gap 3.0, carried-brand) | pipeline_settings | as listed | Phase-2 gates |
| `import_enrich_enabled` / `_batch_cap` | pipeline_settings | false / 10 | Draft→enrich→publish |
| `pricing_approval_mode` | pipeline_settings | balanced (5% threshold) | Auto-apply vs queue |
| `pricing_webhook_enabled` | pipeline_settings | true | Nalpac cost-change path |
| `auto_approve` / `spam_threshold` / `reminders_enabled` / `invite_delay_days` | review_settings | false / 0.75 / true / 3 | Review moderation + invites |
| `X_AUTO_POST_ENABLED` | env | unset | Env half of social autopost + deal auto-tweet |
| `SMS_PIPELINE_VERSION` / `WEB_PIPELINE_VERSION` | env | v2 / v1 | Conversational engine versions |
| `BOTID_BLOCK_ENABLED` | env | unset (shadow) | Ask Emma bot blocking |
| `IVR_*` caps, `SMS_MAX_PER_HOUR` | env | 5 calls/h, 15 sms/h, $500/5-item/2-order draft caps | Conversational guardrails |

## Appendix B — Closed loops verified running today (defaults as-is)

Order capture → profit metafields/CAPI/referral rows · fulfilled → (broken invite, §3.2) · returns → auto-refund · sold-out → deal rotation · deal activation + Klaviyo event · pricing batch + webhook auto-apply · import candidate discovery · enrichment batch advancement · profit summary + CAPI drain · log-monitor → GitHub P0 issues · llms.txt/sitemap/feed generation · Ask Emma web chat, SMS v2, IVR (customer-facing, capped).
