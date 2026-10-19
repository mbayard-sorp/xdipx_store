# ADR-018: Ads Control Plane: channel adapters, entity mirror, and a ledger-gated mutation path

Date: 2026-10-19
Status: Proposed (owner approval checklist in `docs/store-team/ads-control-plane-plan.md` §13)

## Context

The owner asked for world-class tooling to manage and optimize paid ads, Meta first, with the
ability to add channels such as Reddit or X later, driven by automation. Ad Studio v2 (PRs #1500
to #1508) produces ideas, creatives, exports and recommendations, but:

- nothing reads any ad platform. `importMetaInsights` throws `not_configured`; spend arrives by CSV
  or by hand.
- nothing can change anything on a platform except two admin-only create-paused pushes. The rules
  engine's applier seam (`app/lib/ad-platform-apply.server.ts`) is a no-op and `setPlatformApplier`
  is never called in production.
- the rules R1 to R8 judge on attributed orders and 7-day ROAS, while the only live Meta campaign is
  a Leads campaign with a 7 to 30 day lead-to-order lag. Wired as they stand, R1 would pause every
  working lead ad.
- the applier is keyed on a creative id and a budget multiplier, but under campaign budget
  optimization the budget lives on the campaign, so scale and brake at ad level map to no Meta call.
- the code that controls spend (`ad-platform-apply.server.ts`, `ad-settings*.ts`,
  `ad-spend-core.ts`, `ad-rules-core.ts`) is not in `PROTECTED_GLOBS`. Harmless while the applier is
  a no-op; once it can call Meta, an agent-filed code change to cap logic could merge with no human.
- `docs/ads-policy.md` prohibits paid Reddit and X for this category.

## Decision

1. **Every ad platform is reached only through a `ChannelAdapter`** registered in
   `app/lib/ads/channels/registry.server.ts`. The export registry (`app/lib/ad-export/`) stays the
   build layer and never touches a platform; the channel layer is the operate layer. Meta is the
   first adapter; Microsoft wraps the existing client second.
2. **Platform state is mirrored** into `ad_platform_entities` and `ad_platform_insights_daily` by
   deterministic Vercel crons (entity sync every 6h and after every write; insights hourly for today
   and yesterday, with a 7-day restatement pull at 09:00 UTC). Rules evaluate on the mirror and on
   `order_attribution`. Platform-reported conversions are display only.
3. **Every mutation is an idempotent `ad_actions` ledger row** with who, why, before, after and
   tier. Spend-decreasing actions (pause, brake, halt) may auto-apply behind two valves,
   `ads_spend_enabled` and a new `ads_auto_apply_enabled`, under a daily action cap.
   Spend-increasing actions (scale, resume, budget up, new audience) need owner approval in the
   console or a signed digest link. Taking anything live, raising a cap, or creating a campaign stays
   owner-only outside the ledger. While either valve is off every action is written as `dry_run`.
4. **Rules are objective-aware.** OUTCOME_LEADS campaigns are judged by L1 to L8 (CPL ceiling,
   zero-lead kill, funnel-break halt, cohort verdicts) with R2 and R7; OUTCOME_SALES campaigns keep
   R1 to R8. The CPL ceiling is an owner-set valve, not break-even.
5. **Spend-control code becomes protected** (Phase 0, owner-merged).
6. **Prohibited channels get no adapter.** Reddit and X appear in the console's channel list as
   "policy: prohibited, no adapter" until the policy row is re-verified with date and source and the
   owner codifies a lane. Adding a channel then is one directory under `channels/` plus a registry
   entry and the enablement checklist.
7. **Builds run in Opus 5.5 sessions.** Program tickets open with `[opus-build]`; R-DEV never claims
   them.

## Consequences

- Phases 0 to 3 (guardrails, read foundation, insights, read-only console) ship before any
  automated mutation. Phase 5 (mutations) starts only after 14 days of dry-run ledger rows the owner
  has read.
- The `ad_campaigns` legacy table stops receiving writes and is not dropped.
- Ad Studio's Live and Spend tabs redirect to `/admin/ads` once the console exists.
- A Meta system user token in env replaces OAuth app review; a daily `debug_token` probe files a
  blocker on expiry or revocation.
- The economics stay the owner's problem, not the tool's: at a $30 AOV and 45% margin the lead
  funnel breaks even only if lead-to-order and repeat rates do the work. The loop measures cost per
  first order and 60-day contribution per lead and says so in every digest.

## Alternatives rejected

- Keep one creative-keyed applier and wire it to Meta now: pauses working lead ads and cannot touch a
  CBO budget.
- Boot-time adapter registration in `server/index.ts`: cold-start import ordering bugs; the dispatcher
  resolves adapters from the registry at call time instead.
- Per-platform tables and a Meta OAuth token table: not needed for one owned account.
- Build Reddit and X adapters now: policy-prohibited, no account to smoke-test, and code that can
  push to a prohibited lane is the failure mode the export registry removed for TikTok.
- A `model` column on the ticket bus for the Opus build rule: a schema change for one program.

## References

- `docs/store-team/ads-control-plane-plan.md`
- `docs/store-team/ad-studio-v2-plan.md`, `ad-studio-v2-runbook.md`
- `docs/ads-policy.md` §Meta strategic lane M1 to M8
- `docs/audits/meta-lead-funnel-audit-2026-10-18.md`
- ADR-008 (ticket with every PR), ADR-009 (conversion tracking ownership), ADR-012 (ads-manager, not a new agent)
