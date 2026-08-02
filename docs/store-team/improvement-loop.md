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
 │    Kind code → claimed by R-DEV (rr7-engineer) on its next pass and    │
 │    turned into a ticket/<id> PR; QA verifies before the engine merges. │
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
| `in_review` → `in_progress` | `agent:qa-reviewer` (FAIL bounce) | `{op:'transition'}` with `lastError`; increments `attempt_count` and renews the assignee's lease (`BOUNCE_LEASE_SEC`) so the next dev pass still finds it |
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
| `code` | needs engineering | **R-DEV claims it automatically** (`rr7-engineer`, 14:00 + 20:00), one `ticket/<id>` PR, QA-verified, engine-merged |
| `campaign` | a full email campaign brief | owner executes in Klaviyo |
| `promo` | a designed discount/sale (MAP-checked) | owner mints the code in Shopify |
| `program` | referral/loyalty mechanics | owner decides; code parts become `code` rows |

### File the ask in a kind that has an executor

Only two kinds have an automated executor: `code` (claimed by R-DEV) and
`instructions`/`agent-def`/`config` (applied by `agent-editor`). `process`, `strategy`, `program`,
`promo`, and `campaign` all mean **a human acts directly**, so a row filed in one of them waits on
the owner and ages until they read it. Filing executable work as `process` is choosing to delay that
work indefinitely — it is how 16 of 30 aged rows in the 2026-07-30 digest ended up in a queue of one
busy human for up to 18 days, and 4 more were fixed by other work while nobody noticed.

**Before filing, ask: who executes this?**

- *Edit a playbook, agent definition, mission brief, or charter* → `instructions` (or `agent-def` /
  `config`). `agent-editor` PRs it.
- *Change code, a schema, or a script* → `code`, with repro steps and an explicit **DONE WHEN**.
  R-DEV claims it.
- *A decision or action only the owner can take* — a valve flip, a spend approval, a brand or legal
  judgment, a manual action in a third-party admin — → `process`. This is the only correct use of
  `process`, and it is genuinely for the owner, not a place to park work you could have specified.

If a row **bundles** an owner decision with executable work, **split it into two rows** (one
`process` for the decision, one `code`/`instructions` for the work) rather than filing one `process`
row that half-executes. `agent-editor`'s Step 1.5 hygiene pass (rekind/retire) is the cleanup for
rows already misfiled; this rule is meant to stop them being created.

## Auto-approving triage (per team)

Each team has an independent `{team}_team_auto_approve_suggestions` valve (migration
062, editable on that team's tab of `/admin/homepage-team`). When on, `createSuggestion`
writes rows the team will act on straight to `approved` with `decided_by='auto'`,
skipping the owner's triage click. It changes **only** the first gate — every downstream
execution path is untouched:

- `instructions` / `agent-def` / `config` → still become an agent-editor **PR** (and only when
  `suggestion_apply_enabled` is also on), merged by the release engine after CI and the allowlist
  check, or by the owner when the diff touches a protected path.
- `campaign` / `promo` / `program` → still **executed by hand** by the owner (Klaviyo send, Shopify
  code, program decision). Auto-approve just clears them from the triage queue.
- `code` → **no longer a human hand-off.** This line used to sit with the row above and said an
  engineering task waited for the owner to assign it. Since R-DEV went live (2026-07-28) an approved
  `code` row is claimed by `rr7-engineer` on the next 14:00 or 20:00 pass without anyone asking. With
  `strategy_team_auto_approve_suggestions` on and `release_engine_enabled` on, the full path from an
  agent filing a `code` row to that change running on xdipx.com has **no human step in it**.

  That is the intended design, not an oversight, and the gates that remain are real: CI, the
  protected-path classifier reading the GitHub file list, QA's `verified` verdict, the daily merge
  cap, and post-deploy smoke with automatic revert. But "nothing runs unattended" stopped being true
  for `code` on that date, and a safety property nobody can state correctly is not one you can rely
  on. To restore the owner gate on engineering work specifically, flip
  `strategy_team_auto_approve_suggestions` off: `code` rows then wait in `proposed` for a triage
  click, and R-DEV only ever claims from `approved`.

**Rollout:** as of 2026-07-29, auto-approve is ON for all five active teams (homepage, content,
product, social, strategy) by owner decision. The four non-homepage valves were in fact flipped on
2026-07-18; the docs said otherwise for eleven days, which is why valve writes are now recorded in
`settings_audit_log` (migration 072) with an actor and a source. Auto-approved rows carry an
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
   the ticket, its PRs, and the last three `last_error` values. This is the release engine's job for
   every bouncer, not just its own: it bounces on merge/deploy/smoke failure and blocks inline, and
   an hourly sweep catches tickets QA bounced to three attempts (QA has no `blocked` edge and no
   escalation channel of its own).
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
- **The apply pass needs run-cap AND budget headroom:** the Apply Pass and Cost Review share
  `team=strategy` with Monday's Weekly Strategy run, R-DEV's two passes, and R-QA, and the gate's
  ceilings count per team, not per run type. `strategy_team_max_runs` must be **8** against six
  scheduled Monday runs, because the cap counts every run row whether or not it succeeded.
  `strategy_team_daily_cents` must cover two coding passes plus a review pass, and `gate()` checks
  the budget **before** the run cap, so an under-sized budget shows up as `over_budget` on the later
  runs and reads like a spend problem rather than an unset valve. Migration 074 versions both (1500
  cents, 8 runs); before it, neither key had ever been written and both fell back to defaults sized
  for one advisory retro a week. Otherwise the later Monday runs skip and approved suggestions
  silently never become PRs (this exact failure, with the cap at 1, hid every apply run from
  2026-07-07 to 2026-07-21).
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

## Intake doctrine: two strikes, two rows

Binding on every routine's retro step. Cite this section by name rather than restating it.

The bus reached 192 open rows on 2026-08-02 because filing was free and closing was not. Measured
over the preceding 14 days: **241 rows in, 94 closed, net +10.5 a day**. Against that, the executors
have hard ceilings, and the sum of them is smaller than intake:

| Lane | Executor | Ceiling | Intake over the same 14 days |
|---|---|---|---|
| `code` | R-DEV, 3 per pass, 2 passes a day | 42/wk | 39/wk filed, 15/wk actually drained |
| `instructions` / `agent-def` / `config` | Apply Pass, 15 PRs per run | 30/wk | 45/wk |
| `process` / `strategy` / `program` / `promo` / `campaign` | none; Step 1.5 disposal only | 50/wk of rekind+retire | 37/wk |

A triage of all 192 found 37 rows already fixed or moot, 21 duplicates, and 21 filed in a kind with
no executor. **Four rows in ten could never have reached a terminal state.** These four rules exist
to stop manufacturing them.

1. **Two strikes.** File a lesson only when the same failure has now happened **twice** and you can
   name both runs. A first occurrence is a run event, not a row.
2. **Two rows.** File at most **2 suggestion rows per run**. If a run produced more lessons than
   that, file the two highest-priority and put the rest in the retro event.
3. **Zero is the expected outcome of a clean run.** A run summary must never report a suggestion
   count as an achievement, and no `<output_format>` should imply that filing nothing is a gap.
4. **Set `priority` and `dedupeKey` on every row you file.** Both default silently and both were
   inert on 2026-08-02: 186 of 243 rows sat at the default priority 3, so "priority order" was
   really arrival order, and 110 had no dedupe key, so a recurring signal stacked a fresh row every
   run instead of reopening one. A row worth filing is worth ranking against the rows already there.

What filing is measured on is what agents optimise. Before 2026-08-02, eleven agent definitions
carried `suggestions filed` as a required line in `<output_format>` and **nothing anywhere measured
whether a filed row ever reached `applied`**. Filing was scored, closing was not, and the queue
behaved exactly as that scoring predicts. If you add a metric to a retro step, make it a closure
metric.
