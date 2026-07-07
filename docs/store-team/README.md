# Store-Wide Agent Teams

The homepage merchandising team's two-plane architecture, generalized to the whole store. Five
teams — **homepage, social, ads, email, strategy** — share one control plane (gate, budgets, kill
switches, run/event feed, the suggestion improvement bus, the weekly strategy brief) and run as
scheduled Claude cloud routines billing to the Max subscription. **Everything ships OFF by default.**

This folder is the operator's runbook for the store-wide layer. The homepage-specific runbook stays
in `docs/homepage-team/`; agent definitions live in `.claude/agents/`.

---

## Two-plane architecture

```
CONTROL PLANE  (Vercel + Neon + Admin UI)          AGENT PLANE  (Claude cloud routines)
────────────────────────────────────────          ─────────────────────────────────────
GET  /api/team/gate?team=…        ◄──────────┐     Daily:   Routine A (homepage merchandiser)
POST /api/team/run                ◄──────────┤              Social drafts (social-media-manager)
POST /api/team/event              ◄──────────┤     Weekly:  Strategy retro + brief (store-strategist
POST /api/team/suggestion         ◄──────────┤                → inventory-sentinel, promo-manager,
GET/POST /api/team/brief          ◄──────────┤                  loyalty-referral-manager sub-steps)
GET/POST /api/team/calendar       ◄──────────┤              Ads proposals (ads-manager)
POST /api/team/social-post        ◄──────────┤              Email briefs (email-marketing-manager)
POST /api/team/ad-campaign        ◄──────────┘              Apply pass (agent-editor → PRs)
                                                            Cost review (process-optimizer)
Admin UI: /admin/homepage-team  (team tabs:
  kill switches, budgets, valves, suggestions
  approve/dismiss, strategy brief, ad proposals,
  run history per team)
```

The original `/api/homepage-team/{gate,run,event,spend}` endpoints are unchanged (they now delegate
with `team='homepage'`). All teams log spend through the existing `POST /api/homepage-team/spend`
under their own `feature` labels (`social-drafts`, `ads-planning`, `email-planning`,
`strategy-weekly`); the per-team gate sums `feature LIKE '{team}-%'`.

- `app/lib/team.server.ts` — the generalized control plane (gate/config/runs/events/suggestions/
  brief/campaigns/social drafts/calendar). `app/lib/homepage-team.server.ts` is a compat shim.
- `app/lib/team-keys.ts` — client-safe team ids, `pipeline_settings` key sets, defaults, valves.
- `db/migrations/051_store_teams.sql` — team columns + `strategy_briefs` + `ad_campaigns`.

## Team roster and cadence

| Team | Entry agent | Cadence | Money valve state (stub) |
|---|---|---|---|
| homepage | `homepage-orchestrator` | daily (Routine A) + weekly (Routine B) | live (content auto-publish, PR for code) |
| social | `social-media-manager` | daily or 3×/week | **draft-only** — writes `social_posts` rows `status:'draft'`; owner posts |
| ads | `ads-manager` | weekly | **propose-only** — writes `ad_campaigns` proposals; owner launches in-platform |
| email | `email-marketing-manager` | weekly | **plan-only** — campaign briefs as suggestions; owner executes in Klaviyo |
| strategy | `store-strategist` (+ `inventory-sentinel`, `promo-manager`, `loyalty-referral-manager` sub-steps; `agent-editor` and `process-optimizer` run under this team's budget) | weekly (Mon recommended) | advisory only — brief + suggestions |

Routines are scheduled **externally in Claude's cloud scheduler** (same as the homepage team — the
repo only ships the playbooks in this folder and the callback endpoints). Recommended schedule:
strategy Monday morning, agent-editor + process-optimizer later Monday, ads/email Tuesday, social
daily.

## Kill switches, budgets, valves

All in `pipeline_settings`, editable from `/admin/homepage-team` (team tabs). Everything defaults
OFF / conservative.

| Setting key | Default | Purpose |
|---|---|---|
| `{team}_team_enabled` | `false` | Per-team kill switch (homepage keeps `homepage_team_enabled`). |
| `{team}_team_daily_cents` | social/ads/email 500, strategy 300, homepage 1500 | Daily metered cap per team. |
| `{team}_team_max_runs` | social 2, others 1, homepage 4 | Max-quota guard (runs/day). |
| `homepage_team_build_cents`, `homepage_team_max_images` | 10000 / 12 | Homepage-only extras. |
| `social_team_autopost` | `false` | **Draft-mode valve.** Live posting also requires `X_AUTO_POST_ENABLED`, and only X has plumbing. |
| `suggestion_apply_enabled` | `false` | **Apply-path valve.** When on, agent-editor turns approved instruction-suggestions into PRs. |

Auth for every `/api/team/*` call: `x-team-secret` (or Bearer) matching `TEAM_TOKEN` /
`HOMEPAGE_TEAM_TOKEN` / `CRON_SECRET`.

## The self-improvement loop (short version)

Every routine ends with a **retro step**: outcomes vs last run + the strategy brief's directives,
recorded as `phase:'retro'` events, with real lessons filed as suggestion rows. Weekly,
`store-strategist` runs the cross-team retro and publishes the strategy brief every team reads at
run start; `process-optimizer` runs the cost review. The owner approves/dismisses suggestions on the
dashboard; `agent-editor` turns approved instruction-kind rows into one-PR-per-suggestion; the owner
merges. Full lifecycle: `docs/store-team/improvement-loop.md`.

## Stub graduation criteria (owner's call, suggested defaults)

- **Social → autopost (X only):** ~20 consecutive drafts posted unedited with zero voice-gate
  rejections, then flip `social_team_autopost` + set `X_AUTO_POST_ENABLED`. IG/TikTok stay manual
  until posting plumbing is built (kind `code` suggestion → `rr7-engineer`).
- **Ads → live spend:** never automatic. Approved proposals are launched by hand in-platform;
  automating creation would require granting write MCP tools deliberately (a reviewed decision, not
  a valve).
- **Email → Klaviyo drafts:** build a campaign-API client first (kind `code` suggestion), then
  briefs can become Klaviyo drafts pending owner send.

## Roadmap agents (documented, not built)

- **fulfillment-watchdog** — customer order → Nalpac PO monitoring (needs PO automation first;
  today that handoff is manual).
- **compliance-auditor** — quarterly audit that the age gate renders, consent logging is complete,
  and ad/creative practices still match current platform policy.

## Access checklist (per routine)

Same as the homepage team: scheduled Claude cloud agent with repo access, the team callback secret,
GA4 MCP where the agent def lists it, and (ads only) the Meta Ads MCP read/insights tools named in
`.claude/agents/ads-manager.md`. Apply migrations with
`npx tsx scripts/apply-migrations.ts --from 051`.
