# Ads Control Plane: scope and phased build

Status: proposed 2026-10-19 by `/all-hands` on owner direction. Binding once the owner approves §9.
Companion: `docs/adr/ADR-018-ads-control-plane.md`. Supersedes nothing: `ad-studio-v2-plan.md`
stays the record of what was built through PR #1508; this document is the plan for what sits on
top of it.

## 0. What the owner said

Verbatim, 2026-10-19:

> I'm going to need a lot better tools to manage meta ads. I want a world class tool to help me
> manage and fully optimize my ads. I want a world class set of tools to manage them. The system
> should be capable of adding additional ad channels such as Reddit or X to run ads on. The
> /all-hands team can help advise on the best way to build this into our ecosystem and can also
> assist with the best ways to use automation to drive and continuously optimize the ad channels.
> Scope out a system and phase out a build. Use only Opus 5.5 agents to do the builds.

Read as five items:

1. **Manage Meta ads from inside xdipx**, not Ads Manager: see what is live, what it spent, what it
   earned, and act on it (pause, resume, budget, approve), from a phone.
2. **Fully optimize**: a loop that pulls data on a schedule, judges it, and changes the account,
   with the owner approving anything that raises spend.
3. **Channel-pluggable**: adding a platform is one adapter directory, not a rewrite. Reddit and X
   are the named examples.
4. **The team advises and automates**: this document, plus standing instructions and tickets.
5. **Opus 5.5 builds only**: the build lane for this program runs on Opus 5.5, not the Sonnet
   R-DEV pass.

## 1. State of play, verified 2026-10-19

Everything below was read live or from the code on 2026-10-19, not from memory.

**Meta account 920738511029316** (Meta Ads MCP, read-only, 22:40 UTC):
- Campaign "xdipx | Curious lead funnel | Meta lane | 2026-10", published by the owner 11:06 MST.
  One ad set (US 25+, broad, FB + IG, Leads). Ads: img38 v3 ACTIVE, img30 v3 ACTIVE, img35 v3
  DISAPPROVED (the Discriminatory Practices / financial-products classifier; ticket #16368 is the
  M7 record, owner has read it, appeal pending).
- HOLD campaign 120249748010950056 holds 48 gate-failing images and never publishes.
- Shopify Autopilot Advantage+ Sales, campaign 120249603764920056 (its one ad is 120249603770030056): PAUSED, $0.18 last 7 days, runs on the raw
  feed (M5 violation). Paused twice already; Shopify Growth can re-enable it.
- The two active ads published today have no metrics yet.

**Valves** (`pipeline_settings`):
- `ads_spend_enabled`: no row, reads false. Simulation.
- `ads_team_enabled` true, `ads_team_max_runs` 2, `ads_team_daily_cents` 2000 (compute, not media).
- `ads_team_auto_approve_suggestions` **false** since 2026-10-04 while every other team is true.
  Twelve ads `code` rows sit at `proposed` with no triage path: 13406, 13407, 13435, 13530, 13589,
  13741, 14347, 14560, 15057, 15882, 16156, 16383.
- Media caps have no rows; defaults apply: $20/day, $600/month, 45% gross margin.

**Code** (Ad Studio v2, PRs #1500 to #1508 merged; Microsoft PR 1 #1673 merged, PR 2 #1681 open):
- Writers: `app/lib/ad-export/meta-push.server.ts` (create-only, PAUSED, env token, Graph v23) and
  `ad-export/microsoft-push.server.ts` (create paused). Reddit: `reddit-oauth.server.ts` only, no
  client. X: nothing. Google: Ads Editor CSV only.
- **No live read of any platform.** `ad-metrics.server.ts:233 importMetaInsights` throws
  `not_configured`. Spend arrives by CSV or by hand in `pnl_ad_spend`.
- Rules R1 to R8 (`ad-rules-core.ts`) recommend only; R7 auto-applies. The applier seam
  `ad-platform-apply.server.ts` is a no-op and `setPlatformApplier` is never called outside tests.
- No entity mirror (campaign, ad set, ad ids and statuses), no Meta token table, no mutation ledger
  beyond `ad_rule_events`, no ads cron: metrics and rules run only when the 20:30 UTC routine calls
  `POST /api/team/ad-metrics`.
- Attribution: `utm_content=<creative id>` on every final URL rides cart attributes to order
  note_attributes to `order_attribution`; `attributeShopifyOrders` matches orders to creatives.
  `classifyChannelGroup` has no paid bucket. GA4 purchases are mostly "(not set)".
- Agents: `ads-manager` (sonnet, two passes 14:30 and 20:30 UTC) and `paid-media-buyer` (opus,
  recommend-only, no team-token write op: ticket 13435).
- Dead or stubbed: `ad-creative.server.ts` v1, `listMsAdsSearchCampaigns` has no caller, Graph
  version split (v21 CAPI, v23 push), migration numbers 125 and 126 each used twice.
- **The code that controls spend is not protected.** `PROTECTED_GLOBS` in `github.server.ts`
  does not list `ad-platform-apply.server.ts`, `ad-settings*.ts`, `ad-spend-core.ts` or
  `ad-rules-core.ts`. Harmless while the applier is a no-op. Once it can call Meta, an agent-filed
  `code` row that changes cap logic could merge with no human in the loop.

**Policy** (`docs/ads-policy.md`, binding): Meta is a strategic lane under gates M1 to M8. TikTok,
X, Reddit and Pinterest paid are **prohibited** for this category. Microsoft runs through the Adult
Advertising Program (account 188472831, status Pending). Google is Search only, restricted. Snap is
restricted at register 6-7. Adult networks are allowed at register 10.

**Economics** (`docs/audits/meta-lead-funnel-audit-2026-10-18.md`): AOV $30.65 product, 45% gross
margin, contribution $9 to $13 on a qualifying basket, break-even CPL $0.48 to $0.75 at a 5%
lead-to-order rate. $10/day cannot leave Meta's learning phase.

## 2. Findings the plan has to answer first

These came out of the architecture read (tech-architect, Opus) and were verified against the code.

1. **The rules judge on orders, but the live campaigns are Leads campaigns.** R1 pauses an ad once
   lifetime spend passes the break-even multiple with zero orders (`ad-rules-core.ts:205`). R3 and
   R5 are order and ROAS based. `ad_creative_daily_metrics` has no `leads` column. Wire the applier
   as things stand and R1 pauses every passing lead ad. Rules must read the campaign objective
   before any Meta auto-apply.
2. **The applier targets one creative; Meta budgets sit higher up.** `PlatformApplyRequest` is keyed
   on `creativeId` and `budgetMultiplier`. The live campaign is CBO, so the budget lives on the
   campaign. Scale and brake at ad level map to no Meta call. The request has to target the entity
   that owns the budget.
3. **Spend-control code is outside the protected paths** (see §1). Closing this is Phase 0.
4. **Reddit and X adapters now would be wasted work.** Policy prohibits both. There is no account to
   smoke-test against, the APIs churn, and code that can push to a prohibited lane is the exact
   failure mode the export registry removed for TikTok. The capability the owner asked for comes
   from the adapter interface plus a registry entry: one directory per channel, added when a policy
   row is re-verified and the owner codifies a lane.
5. **ADR-013 is taken.** The ADR for this program is ADR-018.

## 3. Architecture

### 3.1 Two layers: build and operate

The export registry (`app/lib/ad-export/registry.server.ts`) stays the **build** layer: it produces
payloads and files and never touches a platform. A new **operate** layer, `app/lib/ads/channels/`,
is the only code that talks to an ad platform.

```
app/lib/ads/channels/
  types.ts                  client-safe: ChannelId, EntityLevel, NormalizedEntity, NormalizedInsightRow, MutationVerb
  registry.server.ts        getChannel(id), listChannels(), enablement status per channel
  apply.server.ts           ledger-driven dispatcher (§5)
  meta/graph.server.ts      the single Graph v23 HTTP client: retries, x-business-use-case-usage backoff
  meta/adapter.server.ts    implements ChannelAdapter
  meta/insights.server.ts
  meta/mutate.server.ts     createPaused (moved from ad-export/meta-push), pause, resume, set_budget
  microsoft/adapter.server.ts   Phase 6, wraps the existing microsoft-ads*.ts
```

### 3.2 The adapter interface

```ts
interface ChannelAdapter {
  id: ChannelId                 // 'meta' | 'microsoft' | 'google' | 'snap' | 'adult:<network>' | ...
  capabilities: {
    read: boolean; insights: boolean; mutate: MutationVerb[]
    audiences: 'none' | 'read' | 'write'; preview: boolean
  }
  auth: { health(): Promise<TokenHealth> }        // token strategy stays inside the adapter
  syncEntities(opts: { since?: Date }): Promise<NormalizedEntity[]>      // campaign, adset, ad, creative, review status
  pullInsights(range: DateRange, level: EntityLevel): Promise<NormalizedInsightRow[]>
  createPaused(payload: unknown): Promise<CreatedRefs>                    // consumes the exporter's built payload
  mutate(m: { verb: 'pause' | 'resume' | 'set_budget' | 'update_creative'; target: EntityRef; params: unknown }): Promise<MutationResult>
  audiences?: { list(): Promise<NormalizedAudience[]> }
  preview?(adRef: EntityRef): Promise<string>
  policyCheck(ctx: PolicyContext): Promise<PolicyVerdict>                 // M1 to M8 for Meta; reads the mirror for disapprovals
}
```

**Wiring.** No boot-time registration. The default applier in `ad-platform-apply.server.ts` becomes
a dispatcher into `channels/apply.server.ts`, which writes a ledger row and resolves the adapter
from the registry. `setPlatformApplier` stays as a test-only override. `server/index.ts` does not
learn about ads.

**What moves and what goes.** `meta-push.server.ts` becomes `meta/mutate.server.ts createPaused`
on the shared Graph client; `meta-payload.ts` and `meta-paused-draft.server.ts` stay as pure
builders; `metaCredentialsFromEnv` moves into the adapter's auth. Removed: the optional
`Exporter.push`, the `importMetaInsights` stub, the no-op applier, and all writes to the legacy
`ad_campaigns` table (stop writing, do not drop).

### 3.3 Data model (additive migrations only, 128 and up)

| Migration | Table | Key columns |
|---|---|---|
| 128 | `ad_platform_entities` | platform, account_id, level (campaign, adset, ad, creative), external_id, parent_external_id, name, status, effective_status, objective, daily_budget_cents, lifetime_budget_cents, bid_strategy, creative_id (nullable FK `ad_creatives`), review_feedback jsonb, raw jsonb, first_seen_at, last_synced_at. UNIQUE (platform, external_id) |
| 129 | `ad_platform_insights_daily` | platform, level, external_id, day, spend_cents, impressions, reach, frequency, clicks, link_clicks, leads, platform_purchases, platform_purchase_value_cents, actions jsonb, pulled_at. UNIQUE (platform, level, external_id, day) |
| 129 | `ad_creative_daily_metrics` + `leads integer` | API rows mapped to a creative land here with `source='api'`. This table stays the rules engine's only input |
| 130 | `ad_actions` (the ledger) | idempotency_key UNIQUE, platform, target_level, target_external_id, verb, params, before jsonb, after jsonb, proposed_by (`rule:R5`, `agent:paid-media-buyer`, `owner`), reason, rule_event_id, tier (auto, approve, owner), status (proposed, dry_run, approved, applied, failed, rejected, expired), approved_by, applied_at, platform_response, error, expires_at |
| 131 | `ad_channel_health` | channel (PK), checked_at, state (ok, expiring, invalid, unknown), valid, expires_at, data_access_expires_at, scopes jsonb, error, env_var. One row per channel, overwritten by the daily token health cron (phase 1d, ticket #16406). Holds the reading, never the token |
| 132 | `ad_audiences` | platform, external_id, name, kind (custom, lookalike, saved), role (targeting, exclusion), approx_size, status, synced_at. Read-only mirror first |
| 133 | `ad_experiments` | hypothesis, variable, arms jsonb, primary_metric (cpl, cpa, roas), min_spend_cents, starts_at, ends_at, status, verdict, decided_by |
| 134 | `ad_health_samples` | sampled_at, key (hello_ok, lead_posts_1h, landing_views_1h, lead_events_6h, growth_campaign_active, lead_post_event), value, detail jsonb. Hourly inputs for rule L3 and the pager (phase 2d, ticket #16410) |
| 135 | `ad_channel_checklist` | channel, item, checked_at, checked_by, evidence; UNIQUE (channel, item). The nine enablement items from §6 (phase 7a, ticket #16438) |

`ad_rule_events` stays the record of rule evaluations; `ad_actions` is the record of mutations.
Every rule event that wants a platform change creates exactly one ledger row.

**Not added, on purpose:** a Meta OAuth token table (a system user token in env, §8), per-platform
tables, an hourly insights table (re-upsert today's daily row each hour), a budget table that
duplicates `pipeline_settings`, a second attribution table (`order_attribution` is the source of
truth), stored creative bytes.

### 3.4 Sync and scheduling

Deterministic work runs on Vercel cron. Judgment runs in Claude routines.

| Job | Plane | Cadence | Notes |
|---|---|---|---|
| `/cron/ads-sync-entities` | Vercel cron | every 6h, plus read-after-write on every ledger apply | writes `cron_runs` |
| `/cron/ads-insights` | Vercel cron | hourly for today and yesterday at ad level; 09:00 UTC re-pulls the last 7 days (Meta restates inside its attribution window) | then runs metrics and rule evaluation in the same invocation. `cron-expectations.ts` entry with money event true: if this pull fails, R7 runs blind |
| token health (`debug_token`) | Vercel cron | daily | files a blocker with a verify probe when expiry is under 14 days or the token is invalid |
| ideas and render (`ads-manager`) | Claude routine | existing 14:30 and 20:30 UTC | unchanged |
| buyer review (`paid-media-buyer`) | Claude routine | daily after the 09:00 restatement | reads console data through the team API, proposes ledger rows |

Constraints that bite: cron routes accept GET, check `x-cron-secret`, and must have a
`cron-expectations.ts` entry or CI fails. All work finishes before the response (Vercel discards
post-response work). Rate limits are not a concern at two campaigns and about 52 ads; the Graph
client still reads `x-business-use-case-usage` and backs off above 75%. The hourly pull is a
backstop; the hard stop is platform-side: the account spending cap already set ($100), plus a
`spend_cap` on every campaign at creation.

## 4. Admin surface

Split operations from creative production rather than adding tabs. Ad Studio keeps Ideas and
Creatives. A new console, `/admin/ads`, holds operations:

- `admin.ads._index.tsx`: spend today against cap, pacing, CPL and CPA against break-even, alerts
  (disapprovals, token expiry, stale sync, R7 armed).
- `admin.ads.tree.tsx`: campaign > ad set > ad as expandable rows with live status, budget, 1d and
  7d spend, CPL and CPA, net ROAS from `order_attribution`. Checkbox bulk pause and resume through
  the ledger.
- `admin.ads.actions.tsx`: the ledger with Pending, Dry-run, Applied and Failed views. Approve and
  reject here.
- `admin.ads.audiences.tsx`, `admin.ads.experiments.tsx`, `admin.ads.channels.tsx`.

Ad Studio's Live and Spend tabs redirect to the console once Phase 3 ships. Mobile rules apply:
every table inside `<ResponsiveTable>` with a `min-w` floor, no cards, tree rows indent inside the
table, bulk-action bar sticky at the bottom below `md:`, approve and reject targets at least 44px.

## 5. Automation and safety

**Kill switches, outermost first.**
1. `ads_spend_enabled` (exists): off means no platform call of any kind.
2. New `ads_auto_apply_enabled`, default false. Separates "ads may run" from "machines may change
   them", so live campaigns can run with recommend-only automation.
3. New `ads_auto_actions_max_per_day` (default 10) and `ads_budget_max_step_pct` (default 20). The
   sum of live budgets never exceeds `ads_media_daily_cap_cents`.
4. The Meta account spending cap, platform-side, which our code cannot bypass.

All valves live in `ad-settings-defaults.ts` and are owner-written only.

**One invariant, enforced in `channels/apply.server.ts`:** an action that can increase spend
needs approval; an action that decreases spend may auto-apply.

| Tier | Actions | Condition |
|---|---|---|
| Auto | R7 pause-all, R2 broken creative, R1 and R3 pause (objective-aware), R6 brake (budget down) | both valves on, under the daily action cap |
| One-tap approve | R5 scale, R4 revive (resume raises spend), any budget increase, attaching an audience, every buyer proposal | owner taps in the console or the signed digest link |
| Owner only, outside the ledger | taking a campaign live (M4), raising caps, uploading customer lists | Ads Manager or valve flip |

**Dry run.** While either valve is off, every proposed action writes an `ad_actions` row with
`status='dry_run'` and the computed before and after. Fourteen days of shadow ledger the owner has
read is the precondition for flipping `ads_auto_apply_enabled`.

**Buyer write path.** New route `app/routes/api.team.ad-action.tsx`, `op:'propose'` only, writes
`status='proposed'`. It can never approve or apply. Approval is an admin-session action in the
console plus a signed one-tap link in the owner digest. This closes ticket 13435.

**M7 from the mirror.** `policyCheck` refuses new Meta proposals when any entity's
`effective_status` is DISAPPROVED inside the window. Nothing is stored and no agent writes a hold.

## 6. Reddit, X and the channel enablement checklist

Policy prohibits paid Reddit and X for this category. No adapter is built for either until the
policy row in `docs/ads-policy.md` is re-verified with a date and source and the owner codifies a
lane. The console's channels page shows them as "policy: prohibited, no adapter".

A channel's mutate capability stays off until every item is green:

- Policy row in `docs/ads-policy.md`, verified with date and source URL, and an owner-codified lane.
- Account id, a test or sandbox account, billing descriptor XDIPX confirmed.
- Token strategy documented and the health probe green.
- Insights smoke: yesterday's spend reconciles with the platform UI.
- Paused-create smoke: create PAUSED, read back through entity sync, delete.
- UTM template confirmed to carry `utm_content=<creative id>`.
- `cron-expectations.ts` entry and the platform-side spend cap set.

## 7. Phases and PRs

Every PR files its ticket with a `pr`-kind link in the same breath (ADR-008). Phase 0 PRs touch
protected paths and escalate to the owner; everything else merges on the ordinary lane once QA
verifies. Sizes: S under half a day, M one to two days, L three or more.

| Phase | PRs | Done when |
|---|---|---|
| **0. Guardrails** | 0a add `app/lib/ad-platform-apply.server.ts`, `app/lib/ad-settings*.ts`, `app/lib/ad-spend-core.ts`, `app/lib/ads/channels/apply.server.ts`, `app/lib/ads/channels/*/mutate.server.ts` to `PROTECTED_GLOBS` (S, owner-merged). 0b new valves in `ad-settings-defaults.ts`: `ads_auto_apply_enabled`, `ads_auto_actions_max_per_day`, `ads_budget_max_step_pct`, `ads_lead_cpl_ceiling_cents`, all off or conservative (S, owner-merged). 0c ADR-018 and this plan (S) | the classifier test proves those paths escalate; docs merged |
| **1. Read foundation** | 1a migration 128 (S). 1b `channels/types.ts`, registry, `meta/graph.server.ts` (M). 1c entity sync and its cron (M). 1d token health probe filing a blocker, migration 131 `ad_channel_health` (S) | the mirror matches Ads Manager: campaigns, ads and statuses equal; 24h of green `cron_runs` |
| **2. Insights** | 2a migration 129 plus the `leads` column (S). 2b hourly and restatement pulls feeding `ad_creative_daily_metrics source='api'` and `pnl_ad_spend`; stub deleted (M). 2c a paid bucket in `classifyChannelGroup` (S). 2d hourly health counters for L3 (`/hello` probe, lead POSTs per hour, Lead events per 6h, Shopify Growth campaign status) stored for the console and the pager (S) | yesterday's spend matches Ads Manager to the cent three days running; CSV import no longer needed |
| **3. Console, read-only** | 3a overview and alerts (M). 3b tree view (L). 3c Ad Studio Live and Spend redirects (S) | the owner answers "what is live, what did it spend, what did it earn" at 375px without Ads Manager |
| **4. Objective-aware rules and dry-run ledger** | 4a migration 130 (S). 4b rules read the mirrored objective; lead campaigns get L1 to L8 (§9.3) with R2 and R7, sales campaigns keep R1 to R8; R7 compares a 7-day average (M). 4c `PlatformApplyRequest` retargeted to `EntityRef`, all outputs as dry-run rows (M). 4d actions view (M) | 14 days of dry-run rows and no false R1 on a lead ad |
| **5. Mutations** | 5a Meta `mutate` (pause, resume, set_budget) with read-after-write (M, protected). 5b tier classifier and approve action (M, protected). 5c `api.team.ad-action` propose op plus the `paid-media-buyer` definition update (S) | a ledger pause shows in Ads Manager and the mirror within 60s; a retry with the same idempotency key does nothing; a budget increase cannot auto-apply (test) |
| **6. Breadth** | 6a `createPaused` moved onto the adapter (M). 6b audiences mirror, migration 132 (M). 6c experiments, migration 133, plus view (M). 6d Microsoft adapter: Reporting API insights and the existing push (L) | Microsoft spend arrives without CSV; the Meta draft push runs only through the adapter |
| **7. Enablement framework** | 7a channels page and checklist (S) | Reddit and X show as "policy: prohibited" with no adapter |

Order matters: nothing in Phase 5 starts before Phase 4's 14 days of dry-run rows exist.

**Build log, 2026-10-19 to 2026-10-20.** On owner direction ("complete all phases now, you run as
orthestrator, merge as needed, Opus 5.5 only") every PR below was built by an Opus 5.5 agent in its
own worktree and squash-merged by the orchestrating session once `check` and `migration-dry-run`
were green. The 14-day dry-run gate therefore moved from "before Phase 5 is built" to "before the
owner flips `ads_auto_apply_enabled`" (§13).

| Phase | PR | Ticket |
|---|---|---|
| 0a protected paths | #1697 | 16401 |
| 0b valves | #1699 | 16402 |
| 0c plan and ADR-018 | #1696 | 16418 |
| 1a migration 128 | #1698 | 16403 |
| 1b adapter seam | #1700 | 16404 |
| 1c entity sync cron | #1704 | 16405 |
| 1d token health, migration 131 | #1705 | 16406 |
| 2a migration 129 | #1702 | 16407 |
| 2b hourly insights pull | #1707 | 16408 |
| 2c paid attribution bucket | #1703 | 16409 |
| 2d health samples and L3, migration 134 | #1711 | 16410 |
| 3a console overview | #1708 | 16411 |
| 3b tree | #1714 | 16412 |
| 3c Ad Studio redirects and Settings | #1717 | 16413 |
| 4a actions ledger, migration 130 | #1706 | 16427 |
| 4b objective-aware rules L1 to L8 | #1709 | 16428 |
| 4c dry-run dispatcher | #1716 | 16429 |
| 4d actions view | #1719 | 16430 |
| 5a Meta mutate | #1720 | 16431 |
| 5b hourly applier, digest links, pager | #1722 | 16432 |
| 5c buyer propose op | #1718 | 16433 |
| 6a draft push on the adapter | #1721 | 16434 |
| 6b audiences, migration 132 | #1712 | 16435 |
| 6c experiments, migration 133 | #1713 | 16436 |
| 6d Microsoft adapter | #1710 | 16437 |
| 7a channels page, migration 135 | #1715 | 16438 |

## 8. Risks for the owner

- **Business-level enforcement.** Meta enforces at the business, not the ad account. A disapproval
  streak can restrict the Business Manager, taking pixel 1619122322498289, CAPI and Instagram
  publishing down with the ads. Keep M7 automatic and the policy hook strict. Owner decision: a
  separate Business Manager for ads only.
- **Token.** A system user token in the owner's Business Manager with `ads_read` and
  `ads_management` on its own ad account avoids OAuth app review; Development-tier access is enough
  at this scale. System user tokens can be set to never expire but still die when the admin is
  removed or the app deauthorized, which is how the Instagram token lapsed. The daily `debug_token`
  probe catches revocation.
- **Attribution.** GA4 purchases are "(not set)" and there is no paid bucket. Rules judge on
  `order_attribution` by `utm_content`. Platform-reported conversions are display only. CAPI outbox
  deduplication must hold or Meta optimizes on doubled conversions.
- **Economics, the biggest one.** $30 AOV at 45% margin is about $13.50 break-even CPA; CURIOUS15
  takes $4.50 off that, leaving about $9 on a discounted first order. At a 10% lead-to-order rate,
  CPL has to land near $0.90 to break even on the first order. A tool cannot fix that number.
  Either LTV is measured and credited (repeat rate per cohort) or the lead funnel is underwater by
  design. Phase 2 data gives the real lead-to-order rate; feed it into the rule break-even.
- **Statistical power.** At $10/day no A/B test reaches significance in useful time. Experiments
  are a structured hypothesis log, not a stats engine, until spend is 5x higher.

## 9. The optimization loop (paid-media-buyer read, Opus)

Everything in this section runs on top of the plumbing in §3 to §5. Numbers are labeled
SIMULATION until `ads_spend_enabled` is true. Assumptions are tagged [A].

### 9.1 The numbers the loop is built on

- Break-even CPA on orders: $30.65 x 45% = $13.79 (the code default assumes a $33 AOV, $14.85).
- Contribution per qualifying basket after CURIOUS15: $9.33 to $12.61 (measured, audit).
- Break-even CPL on the first order: $0.48 to $0.75 at 5% lead-to-order. A cold account in this
  category should expect $3 to $8 CPL [A].
- The gap: at $3 to $8 CPL and 5% lead-to-order the cost per first order is $60 to $160 against
  about $11 of contribution. Ad optimization cannot close a 5x to 15x gap; only lead-to-order rate,
  repeat orders and AOV can. So the loop judges **cost per first order and 60-day contribution per
  lead**, with CPL as the early proxy.
- **The CPL ceiling cannot be break-even.** "Pause at 2x break-even CPL" pauses everything on day
  one. The ceiling is an owner-set list-building price: new valve `ads_lead_cpl_ceiling_cents`,
  starting at the $8 the owner named in blocker 732. Once 60-day cohorts exist it is replaced by
  measured contribution per lead.

### 9.2 Cadence

**Hourly (cron, code only, feeds kill switches never optimization):** account spend, impressions,
CPM; every ad's `effective_status` and review status plus `account_status`; our own counters
(`/hello` returns 200, successful lead POSTs in the last 60 minutes, Meta landing views); pixel or
CAPI Lead count in the last 6h; the Shopify Growth campaign's status.

**Daily 07:00 UTC (cron pulls, then rules):** re-pull the last 3 days at ad level (Meta restates
for about 72h [A]): spend, impressions, reach, frequency, CPM, outbound clicks and CTR, landing
views and cost per view, Meta leads plus our Klaviyo leads by `utm_content`, code reveals, orders by
`utm_content` and by CURIOUS15 redemption.

**Weekly, Sunday (cron pulls, buyer routine judges):** ad-set breakdowns by `publisher_platform` +
`platform_position`, age bucket, gender, hour (diagnostic only; dayparting at this spend is noise);
cohort table by `utm_content` with lead-to-order and contribution per lead at days 7, 14 and 30.

**Statistical floors. Below these no verdict is allowed.**
- Kill on zero leads: spend of at least 3x the CPL ceiling (at an $8 ceiling, $24).
- CPL comparison: at least 10 leads per ad (still about ±30%).
- CTR verdict: at least 2,000 impressions per ad (R2 already requires this).
- Lead-to-order by creative: a cohort of at least 40 leads at least 14 days old. In month one,
  lead-to-order is read at account level only.
- Breakdown slices: act only when a slice carries at least 25% of spend, has at least 10 leads on
  each side, and its CPL is at least 2x the rest.

### 9.3 Rules for lead campaigns (L1 to L8)

R1, R3, R5 and R6 are wrong for lead campaigns (they judge on orders or 7-day ROAS inside a 7 to 30
day lag). R2 stays (computed on outbound CTR). R4's revive window becomes 30 days. R8 rarely fires at
this reach; fatigue shows first as CTR decay. R7's cap is misaligned: Meta may spend up to 75% over
a daily budget on a given day [A], so a $25 campaign under the $20 cap fires R7 daily; either the
daily cap is at least 1.75x the campaign budget or R7 compares a 7-day average. $25 x 30 also passes
the $600 monthly cap, so blocker 732's plan only fits as a 14-day burst.

| Id | Trigger | Action | Floor | Cooldown |
|---|---|---|---|---|
| L1 zero-lead kill | ad spend ≥ 3x ceiling, 0 Klaviyo leads | pause ad | ≥ 1,000 impr, ≥ 48h live | one-shot; revive via L7 |
| L2 CPL ceiling | 7d CPL > 1.5x ceiling | pause ad; if every ad in the set breaches, brake the set 30% | ≥ 5 leads or spend ≥ 5x ceiling | 72h per ad set |
| L3 funnel break | ≥ 30 landing views in a rolling 6h with 0 successful lead POSTs, or `/hello` non-200 on 2 consecutive probes | pause all, page owner | none | owner resumes |
| L4 click leak | outbound clicks ≥ 50, landing views / clicks < 60% | flag landing speed, notify | ≥ 50 clicks | 7d |
| L5 scale | 7d CPL ≤ 0.7x ceiling with ≥ 10 leads, and account 14d lead-to-order ≥ 3% | +20% one-tap, within caps | ≥ 10 leads | 72h |
| L6 lead quality | cohort ≥ 20 leads, ≥ 7d old: email-1 click or reveal-to-cart < 50% of account median | deprioritize; refresh brief on lever audience or hook | ≥ 20 leads | 14d |
| L7 cohort verdict | cohort ≥ 40 leads, ≥ 30d old: CPL > 3x contribution per lead pauses; contribution per lead ≥ CPL graduates and allows revive | pause, or revive one-tap | ≥ 40 leads, 30d | one-shot |
| L8 lead fatigue | 7d CTR down ≥ 30% from first 3 days, or CPL up ≥ 50% from first 10 leads | refresh request | ≥ 10 leads, ≥ 7d | 7d |

Rules pick their set by the mirrored campaign objective: OUTCOME_LEADS gets L1 to L8 plus R2 and R7;
OUTCOME_SALES keeps R1 to R8. Landing conversion (leads / landing views) is reported per creative
daily but has no kill rule: the page is the same for every ad, so a gap there is audience or promise.

### 9.4 Tiers and caps (refines §5)

| Action | Tier |
|---|---|
| pause an ad (L1, L2), halt everything (R7, L3), brake a budget down 30% (L2), undo its own action within 24h | A: machine alone |
| refresh the M8 exclusion audiences with new customers and subscribers | A, after the owner approves it once as a standing rule (it sends hashed PII to Meta) |
| scale +20% (L5), revive (L7, R4), activate a staged PAUSED ad in an existing ad set, exclude a placement, shift budget between channels inside the monthly cap | B: one tap; the tap is the activation, so M4 holds |
| first activation of any campaign or ad set, raising a cap, new campaign, objective, audience, age, geo or offer change, new channel, reopening the lane after a rejection, any appeal | C: owner only |

Per-day caps: at most 3 automatic pauses a day (a 4th halts and pages); at most 1 automatic brake
per campaign per 72h; the machine never unpauses anything; it never pauses the last live ad in a set
without paging; at most 3 one-tap cards a day ranked by expected 7-day contribution; at most 1
budget change per campaign per 72h from any source. Advantage+ anything stays never, in every tier.

A spend-guard halt (halt_all proposed by rule:R7 or rule:L3) always applies once ads_spend_enabled
and ads_auto_apply_enabled are both on: it is exempt from ads_auto_actions_max_per_day and the
3-a-day pause cap, its ledger row says "spend guard: cap exempt", and R7 still pages the owner
(owner decision 2026-10-20, ticket #16648).

### 9.5 Creative testing: the slot model

At $25/day there is about $175 a week and a test costs about $40 per ad (about 2,000 impressions
and 5 to 10 leads at a $5 CPL [A]), so about 3 new creatives a week is the ceiling.

Structure (owner action in Ads Manager, Tier C): one campaign with ad-set budgets, two ad sets on
the same audience. **Proven** 70% ($17.50), at most 3 ads. **Test** 30% ($7.50), at most 3 ads. Not
CBO with one ad set: Meta starves new ads within hours on near-zero data, so a test never happens.
New ads enter Test in one Monday batch so the account takes one learning reset a week.

Six live slots. The 10 to 20 ideas a day feed a **bench** in Ad Studio, never in Ads Manager (M6
forbids hold campaigns). Bench entry: M1 to M8 passed, hearted or auto-picked, rendered in 1:1, 4:5
and 9:16, product in stock. Bench caps at 9. Each Monday freed Test slots fill from the top of the
bench, varying one lever only: hook, format or product.

Kill: L1, or $40 spent with CPL above 1.5x the Proven median, or 10 days or $60 without graduating.
Graduate: at least 10 leads, CPL at or below the Proven median, email-1 click not below half the
account median. A graduate moves to Proven as a new ad on the same post id (keeps engagement) and
the weakest Proven ad leaves. Fatigue: L8, CPM up at least 40% at flat frequency, or rising hidden
comments (also a policy-health signal in this category).

### 9.6 Cross-channel allocator (weekly, code proposes, buyer writes the rationale)

Each adapter supplies: daily spend by creative, clicks, our attributed orders and leads by
`utm_content`, a per-channel lag curve (share of 30-day orders arrived by day N), minimum learning
spend, headroom (for Search, impression share lost to budget), and `policy_state`
(allowed, restricted, prohibited).

1. Score each channel on trailing 28-day contribution per dollar, lag-corrected (observed orders /
   completion share), shrunk toward zero below 10 orders with weight n/(n+10).
2. Propose moving at most 20% of the weekly budget from the lowest marginal channel to the highest.
3. Skip a channel with no headroom.
4. Keep a 15% exploration reserve for the newest compliant lane.
5. Propose pausing any channel below zero contribution for 4 straight weeks on at least $150.
6. The monthly cap is a hard sum constraint. A shift is Tier B.

Likely marginal order [A]: Google Search, Microsoft Adult Program, adult networks with site
targeting, Snap, Meta (Meta's lead-gen pays only on second orders).

### 9.7 Attribution the loop trusts

1. **Primary key: CURIOUS15 redemption.** The code is shown only on `/hello`, so every redemption is
   a paid-funnel order. Redemptions running ahead of leads on a day means a coupon-site leak; page.
2. **Creative key: the Klaviyo join.** Lead profile `utm_content` joins to Placed Order within 30
   days of capture.
3. **Shopify `utm_content` on the order** covers Door B and direct clicks. It is on 2 of 34 orders
   today, so fixing the stamping path is a prerequisite.
4. **Meta-reported numbers are a cross-check only.** Leads differing from ours by more than 20% for
   3 days is a measurement fault (CAPI dedupe or capture), not a performance signal. 1-day
   view-through purchases count as zero. 7-day click purchases are reported as "Meta claims X, we
   see Y" and never feed a rule.

One order, one channel: the code wins, then the last non-direct `utm_source`.

### 9.8 Digest and pages

Morning digest, eight lines:
1. `SIMULATION | LIVE. Yesterday $X of $Y cap. Month to date $X of $600 (pace Z%).`
2. `Leads: N yesterday (Meta says M). CPL $X, 7d $X, ceiling $8.`
3. `Paid orders: N yesterday, N in 30d. Cost per first order $X vs $11 contribution.`
4. `Cohort 14d+: lead-to-order X% on N leads (break-even needs Y%).`
5. `Contribution 7d: $X, by lane: Meta $X, Search $X.`
6. `Machine did: paused img07 (L1: $24, 0 leads). Undo: <link>.`
7. `Your taps: N. Top: scale Proven +20%, expected +$X over 7d.`
8. `Health: 0 rejections, account OK, Lead event received 2h ago.`

Pages (email at once, SMS if opted in): any ad rejection or account restriction; R7 or L3 fired;
spend at least 1.5x the daily cap; ad-account payment failure; the Shopify Growth campaign
re-enabled; CURIOUS15 redemptions ahead of leads or any use of HKK1P6EV0AEJ; no Lead event for 6h
while spend is above $5.

## 10. Build lane: Opus 5.5 only

The owner's constraint applies to the build lane. R-DEV claims `code` tickets as
`agent:rr7-engineer` (`model: sonnet`); over the last 14 days its rows ran on `claude-sonnet-4-6`
and `claude-sonnet-5`. The trigger, not the agent definition, decides the model, so "Opus only"
needs an explicit marker that fails closed.

Decision:
- Every ticket in this program opens with the tag `[opus-build]` and carries
  `program: ads-control-plane` in its text.
- `routine-dev-daily.md` gains one rule: R-DEV never claims a row whose text opens with
  `[opus-build]`; if one is claimed by mistake it is released, not blocked. The rows are built in
  owner-started Opus 5.5 sessions (this desktop, Max subscription, no API cost), one worktree and one
  `ticket/<id>` branch per PR. The session claims the row, opens the PR with the ticket link, and QA
  and the release engine proceed exactly as today.
- Program tickets are filed under `team: 'ads'`, where auto-approve is off, so they sit at
  `proposed` and the Sonnet pass cannot claim them even without the tag. The Opus session moves the
  row to `approved` with actor `owner` when it starts.
- Rejected: a `model` column on the bus (schema and API change for one program) and a third
  scheduled build routine (a third prompt that drifts from its playbook, and a claim race with R-DEV).

Cost: about 25 PRs on subscription quota. The constraint is owner attention to start sessions, not
dollars. If throughput becomes the problem, the fallback is an `rr7-engineer-opus` definition plus
a claim filter on the tag, which is a bus change and gets its own ticket.

## 11. Cost (process-optimizer read, Opus; prod `api_token_log` 2026-10-06 to 10-19)

- Metered spend of the ads loop today is about $0.46/day, all images: 180 renders at $0.036 each.
  Reasoning runs on the Max subscription. `ads_team_daily_cents` is 2000 against $0.46 actual
  spend, so it is not a guardrail; the team default of 500 in `team-keys.ts` is stale.
- A Meta insights sync on Vercel cron costs about $0 extra (one Graph read and a few hundred upserts).
  `ad_creative_daily_metrics` has 0 rows today: no insights have ever been pulled.
- One Opus buyer pass a day is $0 metered on Max; on the API key it would be $1 to $3 per pass.
- Steps that never call a model: insights pull, rule evaluation, anomaly detection, spend and valve
  checks, slogan fit check. Digest is a template fill from SQL with at most one short model paragraph.
- Efficiency wins in the current routine, filed as standing instructions (§12): 228 ideas filed,
  208 unrated, all 19 hearts on 2 days (cut the slate to 5 to 8 while more than 50 sit unrated);
  44% of renders blocked after the image was paid for (run the slogan fit check and charter lint
  before the image call); 37 of 176 creatives have any feedback (cap autopicks at 2 when 10 or more
  creatives are unrated); products that drift repeatedly go on a skip-list.

## 12. Where this landed, and what is still open

Everything in §7 is on main as of 2026-10-20 (build log above). Production applies the additive
migrations 128 to 135 on its next build. The tickets sit at `pr_open` until the release engine's
merged-PR reconcile moves them to `applied`; nothing else may walk that edge.

**Still open, by owner (these are the cost and brand decisions in CLAUDE.md's owner surface):**
- Create a Meta system user token with `ads_read` and `ads_management` and set it in Vercel as
  `META_ADS_ACCESS_TOKEN`; the daily token-health cron files a blocker until it is valid.
- Decide the CPL ceiling (`ads_lead_cpl_ceiling_cents`, default $8) and the campaign structure
  (Proven and Test ad sets with ad-set budgets, §9.5). Both are Tier C.
- Read 14 days of `dry_run` rows on `/admin/ads/actions` before flipping `ads_auto_apply_enabled`.
  `ads_spend_enabled` stays the master valve. Both are off today.
- Decide whether an R7 halt should bypass `ads_auto_actions_max_per_day` (today a halt counts as one
  action and is written as a dry run once the cap is used up).
- Microsoft: the adapter reads and pulls insights; `mutate` stays empty until the Adult Advertising
  Program accepts account 188472831.

**Known gaps the builders reported (each is a follow-up ticket candidate, none blocks the owner's
read-only use of the console):**
- `lead_events_6h` is always 0 because `meta-capi.server.ts` keeps no Lead-event ledger; L3 and the
  "no Lead event for 6h" page therefore rely on landing views and lead POSTs only.
- L6 (lead quality) cannot fire: the lead funnel report exposes no email-1 click or reveal-to-cart
  rate by `utm_content`.
- The pager skips ad-account payment failure (the mirror never reads `account_status`) and
  CURIOUS15 redemptions running ahead of leads (nothing in the store reads discount redemptions).
- The digest "Undo" link opens the Applied tab; a signed link proposing the inverse action is not
  built.
- "Never pause the last live ad in a set without paging" and "at most one automatic brake per
  campaign per 72h" (§9.4) are not enforced in code yet.
- The Live tab's Pause, Scale and Refresh buttons went away with the tab; the actions view and the
  ledger replace them, and bulk checkboxes on the tree stay disabled until a bulk ledger action
  exists.
- Microsoft shows `policyState: restricted` in the registry while `docs/ads-policy.md` says "allowed
  through the Adult Advertising Program"; the registry wording is the stricter reading and stands
  until the program accepts the account.

**Standing instructions for the ads routine** (slate size, pre-render lint, autopick cap, drift
skip-list) are rows 16414 to 16417. They sit at `proposed` because `ads_team_auto_approve_suggestions`
is off and the valve keys off the acting team, so the owner's click is what sends them to
agent-editor.

## 13. Approval checklist (owner)

- [x] Phase order and PR split as in §7 (built 2026-10-19 to 2026-10-20, see the build log)
- [x] Console at `/admin/ads` rather than more Ad Studio tabs
- [x] Reddit and X stay adapter-less until a policy row is re-verified and a lane codified
- [x] Phase 0a protected-path additions (#1697)
- [x] Phase 0b valves `ads_auto_apply_enabled`, `ads_auto_actions_max_per_day`, `ads_budget_max_step_pct`, `ads_lead_cpl_ceiling_cents` (#1699)
- [ ] CPL ceiling value: $8 to start (blocker 732), or another number
- [ ] Campaign structure: Proven and Test ad sets with ad-set budgets, replacing the single CBO ad set (Tier C, Ads Manager)
- [ ] Meta system user token created by the owner and set in Vercel as `META_ADS_ACCESS_TOKEN`
- [x] Build lane: Opus 5.5 agents per PR, R-DEV skips `[opus-build]` rows (§10)
- [ ] Read 14 days of dry-run rows, then flip `ads_auto_apply_enabled` (and `ads_spend_enabled` when spend is wanted)
