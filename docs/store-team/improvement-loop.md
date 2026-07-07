# The Self-Improvement Loop

How the store's agent teams get better every week — with the owner holding both decision points.

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
 │ 3. OWNER DECISION #1 — /admin/homepage-team, Suggestions panel         │
 │    proposed → approved  (worth doing)                                  │
 │    proposed → dismissed (not worth it; the dismissal is itself signal) │
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
| `proposed` → `approved` / `dismissed` | **owner only** | dashboard Approve/Dismiss (writes `decided_at`) |
| `approved` → `pr_open` | agent-editor | `{op:'mark'}` with the PR URL — the API 409s any transition out of `proposed` |
| `pr_open` → `applied` | agent-editor, after observing the merge | `{op:'mark'}` |

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

## Safety properties

- **Two human gates on every self-modification:** the approval click and the PR merge. An agent can
  never change its own instructions on one authorization, and never without a reviewable diff.
- **The apply path has a kill switch** (`suggestion_apply_enabled`, default off) independent of any
  team's enablement.
- **agent-editor's file allowlist is hard:** agent defs and team docs only — no app code, schema,
  workflows, settings, or secrets, and it must refuse suggestions that would weaken money valves,
  voice gates, MAP rules, or this loop itself.
- **Everything is visible:** suggestions, decisions, PRs, and retro events all surface on the
  dashboard; spend on `/admin/usage`.
