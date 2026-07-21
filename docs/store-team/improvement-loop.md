# The Self-Improvement Loop

How the store's agent teams get better every week. The owner holds the two decision
points by default; the first (triage) can be delegated to a per-team auto-approve
valve so the owner isn't the bottleneck. The homepage team runs on auto-approve today
(see [Auto-approving triage](#auto-approving-triage-per-team)).

## The loop, end to end

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 1. RETRO (every routine, last step)                                    │
 │    Each team compares its last run's output against outcomes            │
 │    (orders, margin, GA4, drafts-posted, campaigns-executed) and the     │
 │    strategy brief's directives. Records phase:'retro' events; files     │
 │    real lessons as suggestion rows (status:'proposed').                 │
 └──────────────┬─────────────────────────────────────────────────────────┘
                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 2. WEEKLY SYNTHESIS (strategy routine)                                 │
 │    store-strategist runs the cross-team retro, publishes the weekly    │
 │    strategy brief (every routine reads it at run start), and routes    │
 │    cross-team suggestions (targetTeam). process-optimizer runs the     │
 │    cost review the same day. Both are propose-only.                    │
 └──────────────┬─────────────────────────────────────────────────────────┘
                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 3. TRIAGE #1 — /admin/homepage-team, Suggestions panel                 │
 │    proposed → approved  (worth doing)                                  │
 │    proposed → dismissed (not worth it; the dismissal is itself signal) │
 │    Owner by default. A team's auto-approve valve does this step for it │
 │    automatically at creation (decided_by='auto'); homepage is ON.      │
 └──────────────┬─────────────────────────────────────────────────────────┘
                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 4. APPLY (agent-editor, valve-gated by suggestion_apply_enabled)       │
 │    Approved rows of kind instructions|agent-def|config become ONE PR   │
 │    PER SUGGESTION editing only .claude/agents/*.md and routine/mission │
 │    docs. Row moves approved → pr_open (applyRef = PR URL).             │
 │    Kind code → left for a human to task rr7-engineer.                  │
 │    Kind campaign|promo|program → executed by the owner directly        │
 │    (Klaviyo send, Shopify code, program decision) — no PR needed.      │
 └──────────────┬─────────────────────────────────────────────────────────┘
                ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ 5. OWNER DECISION #2 — merge (or close) the PR                         │
 │    Merged → agent-editor marks pr_open → applied. The improved         │
 │    instructions take effect on the next scheduled run, and the next    │
 │    retro measures whether they actually helped. GOTO 1.                │
 └────────────────────────────────────────────────────────────────────────┘
```

## Who may set which suggestion status

| Transition | Who | Where |
|---|---|---|
| (new) → `proposed` | any agent | `POST /api/team/suggestion {op:'create'}` |
| (new) → `approved` | the acting team's auto-approve valve, at creation | `createSuggestion` writes `decided_by='auto'` when `{team}_team_auto_approve_suggestions` is on |
| `proposed` → `approved` / `dismissed` | owner | dashboard Approve/Dismiss (writes `decided_by='owner'`, `decided_at`) |
| `approved` → `pr_open` | agent-editor | `{op:'mark'}` with the PR URL — the API 409s any transition out of `proposed` |
| `pr_open` → `applied` | agent-editor, after observing the merge | `{op:'mark'}` |

Agents still never flip `proposed → approved` themselves — that is either the owner
or the owner-controlled auto-approve valve. "Acting team" = the suggestion's
`target_team`, or the proposer when unrouted.

## The `kind` taxonomy

| kind | Meaning | Apply path |
|---|---|---|
| `process` | cadence/config advice, workflow observations | owner acts directly |
| `strategy` | cross-team strategic calls | feeds the next brief |
| `instructions` / `agent-def` | edits to agent defs or routine/mission docs | **agent-editor PR** |
| `config` | doc-level config (playbooks), never `pipeline_settings` values | agent-editor PR |
| `code` | needs engineering | human tasks `rr7-engineer` (Routine-B-style PR) |
| `campaign` | a full email campaign brief | owner executes in Klaviyo |
| `promo` | a designed discount/sale (MAP-checked) | owner mints the code in Shopify |
| `program` | referral/loyalty mechanics | owner decides; code parts become `code` rows |

## Auto-approving triage (per team)

Each team has an independent `{team}_team_auto_approve_suggestions` valve (migration
062, editable on that team's tab of `/admin/homepage-team`). When on, `createSuggestion`
writes rows the team will act on straight to `approved` with `decided_by='auto'`,
skipping the owner's triage click. It changes **only** the first gate — every downstream
execution path is untouched:

- `instructions` / `agent-def` / `config` → still become an agent-editor **PR the owner
  merges** (and only when `suggestion_apply_enabled` is also on).
- `campaign` / `promo` / `code` / `program` → still **executed by hand** by the owner
  (Klaviyo send, Shopify code, engineering task). Auto-approve just clears them from the
  triage queue; nothing runs unattended.

**Rollout:** homepage is ON (owner direction, 2026-07-17), paired with
`suggestion_apply_enabled` ON. Every other team defaults OFF. Auto-approved rows carry an
`auto` badge on the dashboard so the automated decisions stay auditable. To pull a team
back to manual triage, flip its valve off — in-flight `approved` rows are unaffected.

## Safety properties

- **The execution gate always remains:** self-modifications still require a PR merge, and
  money/content actions still require a manual step. Auto-approve can automate the *triage*
  gate for a team, but an agent can never change its own instructions without a reviewable
  diff a human merges. (With auto-approve off — the default for all teams but homepage —
  both the triage click and the merge are the owner's.)
- **The apply path has a kill switch** (`suggestion_apply_enabled`, default off) independent of any
  team's enablement, and each team's triage automation has its own
  (`{team}_team_auto_approve_suggestions`, default off).
- **The apply pass needs run-cap headroom:** the Apply Pass and Cost Review share `team=strategy`
  with Monday's Weekly Strategy run, and the gate's run cap counts per team, not per run type.
  `strategy_team_max_runs` must stay at **3** or the later two Monday runs skip `over_run_cap`
  and approved suggestions silently never become PRs (this exact failure hid every apply run
  from 2026-07-07 to 2026-07-21).
- **agent-editor's file allowlist is hard:** agent defs and team docs only — no app code, schema,
  workflows, settings, or secrets, and it must refuse suggestions that would weaken money valves,
  voice gates, MAP rules, or this loop itself.
- **Everything is visible:** suggestions, decisions, PRs, and retro events all surface on the
  dashboard; spend on `/admin/usage`.
