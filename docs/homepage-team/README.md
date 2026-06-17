# Autonomous Homepage Merchandising Team

An "agency dream team" of agents that designs, builds, and maintains the xdipx homepage at `/`
within a budget, self-heals, and only touches code via reviewed PRs. **Off by default.** Content,
copy, imagery, and section order auto-publish (with rollback); any component/layout/code change goes
through a human-approved PR.

This folder is the operator's runbook. The agent definitions live in `.claude/agents/`
(`homepage-orchestrator`, `homepage-ia`, `homepage-designer`, `merch-calendar`, `process-optimizer`,
plus the reused roles). The full approved plan is in `~/.claude/plans/dreamy-gathering-barto.md`.

---

## Two-plane architecture

The system is split across two planes that share a secret.

```
CONTROL PLANE  (Vercel + Neon + Admin UI)         AGENT PLANE  (Claude cloud routines)
────────────────────────────────────────         ────────────────────────────────────
Vercel cron (daily)                                Routine A: Daily Merchandiser (cheap, daily)
  └─ reset/gate budget, run healthcheck              orchestrator → gate → calendar + GA4 + Nalpac
  └─ trigger Routine A ─────────────────────►          → emma-copywriter + media-manager
                                                       → writes Sanity homepage + Shopify metafields
GET  /api/homepage-team/gate  ◄────────────────────┐   → auto-publishes content, records spend
POST /api/homepage-team/spend ◄────────────────────┤ Routine B: Design Cycle (weekly / on-demand)
POST /api/homepage-team/run   ◄────────────────────┤   IA + designer → prototype branch
POST /api/homepage-team/event ◄────────────────────┘   → rr7-engineer + sanity-content-builder build
                                                       → tech-architect + qa + Emma voice gate
Admin UI: /admin/homepage-team                         → opens a PR (NEVER auto-merge) + preview URL
  (kill switch, $budget, spend, run log, "run now")
```

**Why split.** Vercel functions cap at 300s, have no git, and an ephemeral filesystem — they can't
run a multi-step design/build/PR cycle. Claude cloud routines have full tooling and long runtime.
Vercel stays the cheap, durable **control plane** (budget, kill switch, gate, the rendered site,
healthcheck). The agents live in the **agent plane** (scheduled cloud routines) and reach back to the
control plane only for **data** and **spend logging** through four API routes.

- `app/lib/homepage-team.server.ts` — gate / config / run + event recorders.
- `app/routes/api.homepage-team.{gate,spend,run,event}.tsx` — the four endpoints, all guarded by the
  team callback secret.

---

## Max-vs-metered cost model

The single biggest budget lever: **run all agent reasoning on the Max subscription, keep only the
genuinely-paid bits on metered services.**

| Workload | Runs on | Billed to | Counts vs the $/day cap? |
|---|---|---|---|
| Orchestrator, IA, designer, copywriter, SEO, QA reasoning | Claude cloud routine (authenticated scheduled session) | **Max subscription** | No (`source:'agent-sdk'` → $0) |
| Image generation (fal.ai primary, Imagen fallback) | fal.ai / Google Vertex | **Paid per image** | **Yes — the main cost** |
| Daily Vercel cron (gate, log, trigger, healthcheck) | Vercel | Vercel compute (negligible) | No |
| Any LLM call that hits the **site's** Anthropic-keyed API | Anthropic API key | **Metered API** | **Yes — avoid** |

- **Why a scheduled cloud routine, not a Vercel-hosted SDK:** the self-hosted Agent SDK has no
  headless auth — it reads a local interactive session's credentials, so a Vercel cron can never bill
  to Max. A scheduled cloud agent *is* that authenticated session, on a schedule. It's the only way
  to get Max billing for scheduled work.
- **Keep reasoning off the metered API:** the routine does its own thinking and calls the site only
  for **data** (Shopify / Sanity / Neon / Nalpac / GA4) and to **log spend** via `POST /spend`. If it
  instead calls our Anthropic-keyed endpoints (e.g. `generateCopy`), that work flips from $0-Max to
  metered. Copy generation happens *inside* the routine (`emma-copywriter`), not by calling
  `claude.server.ts`.
- **Realistic daily spend** ≈ just images. A day featuring top-100 products that already have art =
  **~$0**; a day generating 3–6 new fal.ai images ≈ **$0.10–0.50**. The cap (default $15/day) mostly
  bounds the weekly design cycle and runaway loops.
- **Observability caveat:** Max (`agent-sdk`) rows appear on `/admin/usage` at **$0 cost but with
  token counts** *only if the routine reports usage via `POST /spend`*. `/admin/usage` faithfully
  shows the metered + image spend — the numbers the cap actually governs.

### Two separate ceilings — don't conflate them

1. **The $/day metered cap** (`homepage_team_daily_cents`, default 1500 = $15) — protects your wallet
   (images + any metered LLM). Enforced by the gate.
2. **Max quota** — the Max plan's own rolling/weekly limits. A runaway routine can exhaust Max and
   **lock you out of your own Claude Code.** Protect it with run/turn caps, not dollars
   (`homepage_team_max_runs`, per-routine `maxTurns`), not the dollar cap.

---

## Kill switch, budget, and cascade guards

All toggles live in `pipeline_settings` (read by `getTeamConfig()`); the team is **OFF by default**.

| Setting key | Default | Purpose |
|---|---|---|
| `homepage_team_enabled` | `false` | **Kill switch.** Gate returns `reason:'disabled'` when off. |
| `homepage_team_daily_cents` | `1500` | Daily $ cap (metered + images). |
| `homepage_team_build_cents` | `10000` | Initial-build / design-cycle allowance. |
| `homepage_team_max_images` | `12` | Max image generations per day. |
| `homepage_team_max_runs` | `4` | Max team runs per day (Max-quota guard). |

Cascade-risk guards (the orchestrator and routines enforce these — see the risk register in the plan):

1. **Loop never converges** → hard `maxTurns` per routine (~12–16); abort + alert on cap hit.
2. **Self-heal retry storm** → circuit breaker on `attempt_count` in `homepage_team_runs`; disable +
   alert after N same-day failures.
3. **Image-gen runaway** → reuse Shopify Files first; per-product cache; `max_images` cap; re-gate
   before every generation.
4. **Overlapping runs** → one run at a time; the gate returns `reason:'run_in_progress'` and the
   second run exits immediately.
5. **Stale gate / overspend** → gate computes remaining live from `api_token_daily`; every paid step
   re-checks; hard stop at `remainingCents <= 0`.
6. **Sanity write thrash** → diff before write; patch only changed fields; skip no-op publishes.
7. **Structural churn hurts SEO** → merchandising changes **content only** in a stable shell;
   structure/layout changes go through the gated PR path.
8. **Weekly cycle sprawl** → Routine B is weekly, has its own turn + `build_cents` cap, and opens a
   PR (never auto-merges).
9. **Over-optimizing on sparse data** → early runs are heuristic/best-practice led; GA4 is weighted
   only once traffic is meaningful.

**Self-healing:** `/cron/homepage-healthcheck` fetches `/` + `/discover` and asserts 200 / LCP image /
valid JSON-LD. On failure it rolls the Sanity homepage doc back to the stored last-good revision and
alerts via Sentry + a `log-monitor` GitHub issue (errors go to Sentry, not Vercel logs).

---

## How to operate it

**Enable / disable.** From `/admin/homepage-team`: flip the kill switch (`homepage_team_enabled`).
Off → the next gate call returns `ok:false, reason:'disabled'` and Routine A no-ops with a `skipped`
status.

**Set the budget.** Same dashboard: edit the daily $ cap, image cap, and run cap. The gate enforces
them immediately (it reads `pipeline_settings` and live spend on every call).

**Run now.** Use the dashboard "run now" to trigger Routine A out of cadence (still gated).

**Watch the dashboard.** `/admin/homepage-team` shows the current run's phase + active agent, today's
spend (from `api_token_daily`), the last healthcheck result, per-agent status cards, and a per-run
timeline → conversation viewer (readable inline, full verbatim from Blob). Open PR links live here
too. Spend itself is on `/admin/usage` under features `homepage-merchandise`, `homepage-design`,
`homepage-images`.

**Review process suggestions.** `process-optimizer` writes `homepage_team_suggestions` weekly; approve
/ dismiss / apply from the dashboard. The team never self-rewires.

---

## Access checklist (before turning the team on)

- [ ] **fal.ai** account + `FAL_KEY` (Vercel envs **and** worktree `.env*` via `scripts/setup-worktree.sh`,
      **and** the routine's secret store). Confirm a model choice + pricing/TOS for adult-wellness imagery.
- [ ] **Scheduled Claude cloud agent** enabled for this repo, with repo/git access, Sanity MCP, GA4 MCP,
      image tooling, and the design stack (`taste-skill`, `ui-ux-pro-max`, shadcn/ui MCP, Emil Kowalski's
      skill). Confirm **Max headroom** for a daily routine without starving interactive Claude Code.
- [ ] **GitHub** — an identity the routine pushes/PRs as, **plus branch protection on `main`** so the
      team's PRs require human approval (this is what enforces "gate code").
- [ ] **Team callback secret** — `HOMEPAGE_TEAM_TOKEN` set in Vercel and in the routine's secret store
      (falls back to `CRON_SECRET`). Sent as `x-team-secret` or `Authorization: Bearer`.
- [ ] **Migration `049_homepage_team.sql` applied** (`npx tsx scripts/apply-migrations.ts --from 049`):
      `homepage_team_runs`, `homepage_team_events`, `homepage_team_suggestions`, `marketing_calendar`.
      Also confirm `042`/`043` are applied so `/admin/usage` doesn't 500.
- [ ] **GA4** property id + read access for the `google-analytics` MCP.
- [ ] Other runtime secrets in the routine's store: `SHOPIFY_ADMIN_TOKEN`, `SANITY_WRITE_TOKEN`, and
      (only if logging spend directly rather than via `/spend`) a Neon connection string.

**The team is OFF by default.** Nothing runs until `homepage_team_enabled=true` and the gate passes.

---

## Routines

- [`routine-daily-merchandise.md`](./routine-daily-merchandise.md) — Routine A, the exact daily
  playbook (auto-publishes content, never code).
- [`routine-design-cycle.md`](./routine-design-cycle.md) — Routine B, weekly/on-demand
  wires → prototype → build → PR (never auto-merges).
