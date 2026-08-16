# ADR-012: Google Ads gap closed by extending ads-manager, not adding a new agent

Date: 2026-08-15
Status: Proposed

## Context

The owner asked for a "google ads expert agent" on the strategy team, framed as closing a
strategy gap. Investigation of the current fleet shows:

- `ads-manager` (`.claude/agents/ads-manager.md`) already plans Google Search campaigns
  competently. It has produced one well-formed, owner-approved proposal
  (`gads-search-bodysafe-education-2026w29`, $3/day). Its charter already names Google Search as
  the priority-2 paid channel per `docs/ads-policy.md`, already writes a mandatory `policyCheck`,
  and its workflow already has a Step 6 "Retro" that is *supposed* to compare launched-campaign
  spend against revenue.
- `ads-manager`'s toolset is Meta-only (`mcp__Meta_Ads_MCP__*`, read/insights). It has no Google
  Ads tool of any kind, and no Google Ads MCP connector exists in this environment.
- `app/lib/ad-publish/google.server.ts` already exists as the write-side seam for Google Ads (a
  human-triggered "push paused draft" from `/admin/ad-studio`) and is an **inert stub**: it checks
  `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_CUSTOMER_ID` / `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`
  (all unset) and returns `not_configured`.
- `ad_campaigns.actualSpendUsd` and `ad_campaigns.externalCampaignId` already exist in
  `db/schema.ts` and are never written by anything. Step 6's "synced spend" has never existed to
  compare against.
- `ads_team_enabled = false`; last gated-out run 2026-08-11. `ads` is deliberately excluded from
  the five-team auto-approve rollout (homepage, content, product, social, strategy).
- `ad_campaigns` proposals are **invisible to the owner**, independent of the enabled valve:
  neither `app/lib/owner-digest.server.ts` (`gatherOwnerQueue`, `gatherTicketMetrics`) nor
  `app/lib/ticket-janitor.server.ts` reads the `ad_campaigns` table. Both only watch
  `homepage_team_suggestions`. So even a re-enabled `ads` team with a fresh proposal produces no
  signal anywhere the owner is prompted to look — the "-manual admin page exists
  (`/admin/ad-studio`), nothing points at it.
- `ads-manager.md`'s own budget guard (`<budget_and_cascade_guards>`, line "Every proposal's
  `plannedDailyCents` must fit within `ads_team_daily_cents`") conflates two different budgets:
  `ads_team_daily_cents` (`getTodaySpendCents`, `app/lib/team.server.ts`) sums the *agent's own
  Claude token cost* from `api_token_log`, not ad platform spend. It happens to have produced a
  plausible small ad budget so far ($3/day against a $5 compute ceiling) but the rule is wrong on
  its face and will misbehave the first time compute cost and desired ad budget diverge.

## Decision

**No new agent.** The gap is a missing data surface plus missing owner-visibility plumbing, not a
missing planner. Paid acquisition — planning, launching-by-proxy, and post-launch optimization —
is one concern and stays owned by one agent (`ads-manager`), per the "one vendor per concern"
rule. A second "google-ads-optimizer" agent would duplicate `ads-manager`'s policy-reading,
`policyCheck` discipline, and retro step for no reason other than platform name.

Concretely:

1. **Give `ads-manager` a Google Ads read-only data surface** once credentials exist, added to its
   `tools:` frontmatter alongside the existing Meta MCP list — not a new agent, an extended
   toolset on the existing one.
2. **Make Step 6 (Retro) real.** It already exists in the charter; today it silently does nothing
   because nothing populates `actualSpendUsd`/`externalCampaignId`. Wire the sync (API when
   available, manual CSV import in the interim — see below) and the retro step starts doing the
   job it was already written to do.
3. **Fix the digest blind spot.** Add `ad_campaigns` status counts (proposed/approved, oldest age)
   to `owner-digest.server.ts`'s owner-queue section, so a proposal reaches the owner's inbox the
   same way every other team's proposal does. This is required *before* re-enabling `ads_team_enabled`,
   otherwise re-enabling just recreates the exact silent-pile-up the owner is trying to fix.
4. **Fix the budget-guard wording bug** in `ads-manager.md`: `plannedDailyCents` (a proposed ad
   spend) must never be validated against `ads_team_daily_cents` (the agent's own compute
   budget). Replace with an explicit, sane ceiling (e.g. a fixed ad-spend policy note the owner
   sets, not the compute gate) or drop the automatic check and rely on the owner's manual approval
   at `/admin/ad-studio`.
5. **Leave `ads_team_auto_approve_suggestions` off**, deliberately, same as today. Ad-platform
   proposals carry ban risk (see `docs/ads-policy.md`); this is exactly the class of decision that
   should keep the owner's triage click, unlike a homepage copy tweak.

## Alternatives considered

- **New `google-ads-optimizer` sub-agent under `strategy`.** Rejected: duplicates `ads-manager`'s
  policy-reading and proposal discipline; two agents now need to agree on what counts as a
  "campaign," doubling the surface for drift between Meta and Google logic that should share one
  retro step. Violates the "if a second is needed, propose deprecating the first" rule — and there
  is no reason to deprecate `ads-manager`, it works.
- **Fold spend-review into `store-strategist`'s weekly retro.** Rejected: `store-strategist` is
  advisory and cross-team by design (`<guardrails>`: "You never edit config... Your outputs are
  the brief, suggestions, and events"). It has no platform-scoped context, no policy-check
  discipline, and folding platform-specific ad hygiene into it breaks the single-responsibility
  boundary the rest of the fleet already respects (compare: `promo-manager`, not
  `store-strategist`, owns discount mechanics).
- **No agent loop; owner reviews Google Ads manually forever.** Cheapest, but reproduces the exact
  blind spot the mission-brief history already flagged once for GA4/organic traffic: "no agent's
  charter said 'get more visitors', so nobody reported the gap." An unowned optimization loop is
  the same failure mode for paid spend.

## Consequences

- `rr7-engineer` implements the Google Ads read client in `app/lib/ad-publish/google.server.ts`
  (or a sibling file in `app/lib/ad-publish/`) behind the same three env vars the stub already
  checks — one seam, matching the Shopify/Imagen single-file-per-vendor pattern.
- `rr7-engineer` adds an `ad_campaigns` line to `owner-digest.server.ts`'s owner-queue gatherer.
- An `instructions`/`agent-def` suggestion (routed through `agent-editor`, same as any other
  charter change — architects don't hand-edit agent files) updates `ads-manager.md`: tool list,
  Step 6, and the `plannedDailyCents` guard wording.
- `ads_team_enabled` stays `false` until the digest visibility fix ships; flipping it earlier just
  recreates the invisible pile-up.
- No Oxygen-migration seam is touched: Google Ads is a third-party vendor integration, not a
  Shopify or Vercel-specific concern, so `app/lib/ad-publish/google.server.ts` living in `app/lib`
  is correct and doesn't need `.server.ts` boundary review beyond the existing rule.
- If Google Ads developer-token approval is slow, the manual-CSV fallback (below) unblocks the
  retro loop without waiting on it.

## Fallback: manual CSV import (until API access exists)

`GOOGLE_ADS_DEVELOPER_TOKEN` requires Google review and can take days to weeks. Rather than block
the retro loop on that:

1. Owner exports the Search Terms report and Campaigns performance CSV from the Google Ads UI
   weekly, timed before the Tuesday 13:00 UTC `ads-planning` routine.
2. `/admin/ad-studio` (already the ads-team's admin surface) gets a small upload action that
   parses cost/clicks/conversions per campaign and writes `ad_campaigns.actualSpendUsd` /
   `externalCampaignId`; search-term-level rows land in a new lightweight table only if/when
   `ads-manager` actually needs term-level pruning data — don't build that schema speculatively
   before the shape is proven.
3. `ads-manager`'s Step 6 retro reads that Neon data as a normal DATA read (consistent with its
   existing cost-model rule: "the site is for data... and spend logging only").
4. If no CSV was uploaded that week, the retro says so honestly in the run summary rather than
   silently skipping — same discipline `store-strategist` already uses for `UNMEASURED` reads.
