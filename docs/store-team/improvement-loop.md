# The Self-Improvement Loop

How the store's agent teams get better every week. The owner holds the two decision
points by default; the first (triage) can be delegated to a per-team auto-approve
valve, and the second (merge) can be delegated to the release engine, so the owner
isn't the bottleneck. The homepage team runs on auto-approve today (see
[Auto-approving triage](#auto-approving-triage-per-team)). What the owner can never
delegate is a protected-path merge.

For the wider picture (daily cadence, gates, kill switches, what the owner still owns),
read [`operating-system.md`](./operating-system.md).

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
 │ 5. MERGE — the release engine, not the agent                           │
 │    A server-side cron squash-merges the PR when CI is green and the    │
 │    diff is allowlist-clean (docs) or the linked ticket is QA-verified  │
 │    (code), and no changed file touches a protected path. It then waits │
 │    for the production deploy, runs smoke checks, and marks the row     │
 │    applied, or reverts and bounces the ticket to in_progress.          │
 │    Protected-path PRs stop here and email the owner, who merges them   │
 │    by hand. Kill switch: release_engine_enabled. Off = the owner       │
 │    merges everything, exactly as before.                               │
 │    The improved instructions take effect on the next scheduled run,    │
 │    and the next retro measures whether they helped. GOTO 1.            │
 └────────────────────────────────────────────────────────────────────────┘
```

## The ticket lifecycle

Suggestions and tickets are the same rows on the same bus (`homepage_team_suggestions`). A row moves
through these statuses, and the API refuses any transition not in the table below (409), so the
discipline is structural rather than an honor system.

```
proposed → approved → in_progress → pr_open → in_review → verified → applied
                ↑          │            │          │           │
                │          └── blocked  └──────────┴───────────┘
                └───────────── bounce back to in_progress on failure
```

| Status | Meaning |
|---|---|
| `proposed` | filed by an agent, not yet triaged |
| `approved` | worth doing, waiting for someone to pick it up |
| `in_progress` | claimed by an agent under a lease (`assignee`, `claim_expires_at`) |
| `pr_open` | a PR exists for it |
| `in_review` | QA has it open |
| `verified` | QA passed it with evidence; eligible for merge |
| `applied` | merged, deployed, and smoke-checked |
| `blocked` | cannot proceed without the owner (protected path, third failed attempt, external blocker) |
| `dismissed` | not worth doing; the dismissal is itself signal |

| Transition | Who may perform it | Where |
|---|---|---|
| (new) → `proposed` | any agent | `POST /api/team/suggestion {op:'create'}` |
| (new) → `approved` | the acting team's auto-approve valve, at creation | `createSuggestion` writes `decided_by='auto'` when `{team}_team_auto_approve_suggestions` is on |
| `proposed` → `approved` / `dismissed` | owner only | dashboard Approve/Dismiss (writes `decided_by='owner'`, `decided_at`) |
| `approved` → `in_progress` | `agent:rr7-engineer`, `agent:agent-editor` | `{op:'claim'}` (atomic, takes a lease) |
| `approved` → `pr_open` | `agent:agent-editor` (legacy direct path for docs suggestions) | `{op:'mark'}` with the PR URL |
| `in_progress` → `pr_open` | the assignee agent only | `{op:'transition'}` with a `pr` link |
| `in_progress` → `blocked` | the assignee, or `system` | `{op:'transition'}` with a note |
| `in_progress` → `approved` | `system` only (lease expiry releases the claim) | `expireStaleClaims()` |
| `pr_open` → `in_review` | `agent:qa-reviewer` | `{op:'transition'}` |
| `pr_open` → `applied` | `agent:agent-editor`, and only for kind `instructions`/`agent-def`/`config` | `{op:'mark'}` (preserved for backward compatibility) |
| `in_review` → `verified` | `agent:qa-reviewer` | `{op:'transition'}` with evidence in the note |
| `in_review` → `in_progress` | `agent:qa-reviewer` (FAIL bounce) | `{op:'transition'}` with `lastError`; increments `attempt_count` |
| `verified` → `applied` | `system` (the release engine, post-merge and post-smoke only) | release engine |
| `verified` → `in_progress` | `system` (merge, deploy, or smoke failure) | release engine; increments `attempt_count` |
| `blocked` → `approved` | owner, or `system` when the blocker clears | dashboard / engine |
| any non-terminal → `dismissed` | owner only | dashboard |

Three things are worth stating plainly. Agents still never flip `proposed → approved` themselves;
that is the owner or the owner-controlled auto-approve valve. `qa-reviewer` has no path to `applied`
at all, so QA structurally cannot merge or ship its own verdict. And only `system` (the release
engine) can write `applied` for code tickets, which it does after the deploy is live and smoke-checked,
never before. "Acting team" = the suggestion's `target_team`, or the proposer when unrouted.

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

- `instructions` / `agent-def` / `config` → still become an agent-editor **PR** (and only when
  `suggestion_apply_enabled` is also on), merged by the release engine after CI and the allowlist
  check, or by the owner when the diff touches a protected path.
- `campaign` / `promo` / `code` / `program` → still **executed by hand** by the owner
  (Klaviyo send, Shopify code, engineering task). Auto-approve just clears them from the
  triage queue; nothing runs unattended.

**Rollout:** **As of 2026-07-29 auto-approve is ON for all five active teams** (homepage, content, product, social, strategy), by owner decision. The four non-homepage valves were in fact flipped on 2026-07-18; the docs said otherwise for eleven days, which is why valve writes are now recorded in `settings_audit_log` (migration 072) with an actor and a source. Auto-approved rows carry an
`auto` badge on the dashboard so the automated decisions stay auditable. To pull a team
back to manual triage, flip its valve off — in-flight `approved` rows are unaffected.

## Escalation policy

Escalation means an email to **mike@xdipx.com** (`sendOwnerEmail`, `app/lib/owner-alerts.server.ts`).
The loop is only worth having if it stays quiet, so escalate when, and only when, one of these five
things is true:

1. **A protected-path PR exists.** The classifier found checkout or payment, cart, `db/migrations`
   or `db/schema.ts`, auth or session, team valves or spend controls, `.github/`, `vercel.json`,
   `.env*`, `package.json`, or the release engine's own files in the diff. The engine labels the PR
   `needs-owner`, emails once (deduped per PR), and never merges it. Only the owner merges those.
2. **A ticket reaches its third failed attempt.** The row goes to `blocked` and the email carries
   the ticket, its PRs, and the last three `last_error` values.
3. **A revert PR itself fails CI.** The automatic mitigation has failed and main may be unhealthy.
4. **The engine circuit-breaks.** Two rollbacks in one day flips `release_engine_enabled` to false
   and emails. The store keeps running; merges stop until the owner turns it back on.
5. **The owner-decision queue has an item older than seven days.** The daily digest flags it.

Everything else stays inside the loop: a red CI run, a QA bounce, a claim that expired, a dedupe
hit, a routine that skipped at the gate. Those are ordinary states with an owner already assigned
(the next dev pass, the next QA pass, the lease expiry). They surface on the dashboard and in the
13:00 UTC digest, not in your inbox.

## Safety properties

- **The execution gate always remains:** self-modifications still require a PR that passes CI and
  the allowlist check, and money/content actions still require a manual step. Auto-approve can
  automate the *triage* gate for a team, and the release engine can automate the *merge* gate, but
  an agent can never change its own instructions without a reviewable diff that a machine outside
  its own process approved against rules the agent cannot edit. Two rules make that real: the
  protected-path classifier runs on the changed-file list from the GitHub API rather than on any
  text an agent wrote, and `.github/` plus the release engine's own files are themselves protected,
  so no agent PR can loosen the gates. (Auto-approve is now on for all five active teams, so the
  owner's triage click is no longer the gate on the instruction path; CI, the file allowlist, the
  protected-path classifier, and the daily merge cap are. When `release_engine_enabled` is off the
  merge is the owner's too.)
- **The merge path has its own kill switch** (`release_engine_enabled`, default off, on the strategy
  tab of `/admin/homepage-team`) plus a daily merge cap (`release_engine_max_merges_per_day`).
  Turning it off restores owner-merges-everything with no other change.
- **Money valves are untouched by any of this:** the `deal_status: approved` gate, video frame
  review, and social autopost stay owner-gated, and they live in `pipeline_settings`, which the
  engine never writes.
- **The apply path has a kill switch** (`suggestion_apply_enabled`, default off) independent of any
  team's enablement, and each team's triage automation has its own
  (`{team}_team_auto_approve_suggestions`, default off).
- **The apply pass needs run-cap headroom:** the Apply Pass and Cost Review share `team=strategy`
  with Monday's Weekly Strategy run, and the gate's run cap counts per team, not per run type.
  `strategy_team_max_runs` must be **8** (R-DEV runs twice daily and R-QA once, all as `team=strategy`, alongside the three loop runs) or the later two Monday runs skip `over_run_cap`
  and approved suggestions silently never become PRs (this exact failure hid every apply run
  from 2026-07-07 to 2026-07-21).
- **agent-editor's file allowlist is hard:** agent defs and team docs only — no app code, schema,
  workflows, settings, or secrets, and it must refuse suggestions that would weaken money valves,
  voice gates, MAP rules, or this loop itself.
- **Everything is visible:** suggestions, decisions, PRs, and retro events all surface on the
  dashboard; spend on `/admin/usage`.

## What does NOT belong on the bus

A suggestion is an **ask**: something a lane can execute and then close. Reports are not asks. 22 of
the 52 approved `process` rows that piled up were weekly summaries, coverage reports, and retros —
rows that could never reach a terminal state because there was nothing to do, so they aged forever
and buried the rows that did need a decision.

File a report as a run **event** (`POST /api/team/event`), which is already the retro channel and is
free. Reserve suggestion rows for work with an owner and an end state. If a report contains an ask,
file the ask as its own row and keep the narrative in the event.
