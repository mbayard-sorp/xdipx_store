# The Operating System

The one page to read if you are new here. It describes how xdipx runs itself: what fires when, how
a piece of work travels from "something is wrong" to "it shipped", which gates it has to clear, what
reaches the owner's inbox, and every switch that stops it.

Two companion docs go deeper. [`improvement-loop.md`](./improvement-loop.md) owns the ticket
lifecycle table and the escalation policy in full. [`routine-schedule.md`](./routine-schedule.md) is
the versioned manifest of the cloud routines and their exact prompts. Where this page and those
disagree, they win on their own subject.

**Honesty rule for this document.** Some of what follows is running in production today, and some
of it is being built. Every row and section below is tagged `LIVE` (verified in `vercel.json`, the
routine manifest, or the repo) or `PLANNED` (designed, not yet wired). Do not read a `PLANNED` row
as a fact about the current system. Keep the tags accurate when you edit this file, and delete a tag
only when you have verified the thing yourself.

---

## 1. The shape of it

Detectors notice problems. Tickets carry them. Agents fix them on branches. QA verifies. A
server-side release engine merges, watches the deploy, and rolls back if the live site gets worse.
The owner is the escalation path, not the conveyor belt.

```
 detectors ──► ticket (improvement bus) ──► dev claims ──► PR ──► QA verifies
 (cron)            proposed/approved         in_progress    pr_open   in_review
                                                                          │
                                        owner ◄── escalate ◄── blocked    ▼
                                                                      verified
                                                                          │
                                                       release engine ────┤
                                                       merge, deploy,     ▼
                                                       smoke, revert   applied
```

One important asymmetry: everything above the release engine is an agent, and no agent can merge.
The release engine is not an agent. It is a cron on Vercel with a fixed rule set that lives in files
agents are forbidden to edit.

---

## 2. Daily cadence (UTC)

All times UTC. Vercel crons are verified against `vercel.json`; cloud routines against
`docs/store-team/routine-schedule.md`.

| UTC | Surface | Type | What it does | State |
|---|---|---|---|---|
| every 15 min | `/cron/log-monitor` | Vercel cron | Reads production errors, opens a GitHub issue, and (planned) files a `kind:'code'` ticket deduped on the error fingerprint | LIVE (cron + ticket filing, PR #349) |
| every 30 min | `/cron/homepage-healthcheck` | Vercel cron | Fetches `/` and `/discover`, asserts 200 + LCP image + valid JSON-LD, rolls the Sanity homepage back to last-good on failure | LIVE |
| every 30 min | render-truth assertion (inside the same cron) | Vercel cron | Asserts the *published* slate actually rendered: hero handle, every rail title, tile headlines, couples heading; hard-fails when fallback markers render where team content is published | LIVE (PR #349; verified in production 2026-07-28, 9 assertions passing, 0 fallbacks) |
| every 6 h | `/cron/checkout-probe` | Vercel cron | Walks the money path and alerts on failure. Checkout is a protected path, so anything it files always escalates | LIVE |
| every 10 min | `/cron/release-engine` | Vercel cron | Discovers agent PRs, classifies protected paths, checks gates, squash-merges, polls the deploy, smokes it, reverts on failure, escalates | LIVE (PR #351; `release_engine_enabled` turned ON by the owner 2026-07-28) |
| 04:40 | `/cron/indexnow-push` | Vercel cron | Pushes changed and stale URLs to IndexNow | LIVE |
| 12:30 | `/cron/seo-daily` | Vercel cron | Computes index deltas from `gsc_index_daily`, pushes recrawl batches, files tickets on anomalies, writes the digest blob | LIVE |
| 13:00 | `/cron/owner-digest` | Vercel cron | The one owner email per day: shipped, homepage now, SEO deltas, tickets, escalations | LIVE (route + five sections, PR #352). Delivery was broken until 2026-07-28: see the note below |
| 14:00 | R-DEV, dev pass 1 | Cloud routine, `rr7-engineer` | Claims up to 3 `kind:'code'` tickets, one branch and one PR each. Playbook: [`routine-dev-daily.md`](./routine-dev-daily.md) | LIVE (trigger `trig_01MEQYsg5sHPbM4v39FqssAD`, `0 14,20 * * *` UTC) |
| 15:30 | R-QA | Cloud routine, `qa-reviewer` | Reviews every `pr_open` ticket, verifies or bounces. Playbook: [`routine-qa-daily.md`](./routine-qa-daily.md) | LIVE (trigger `trig_019GjVP9hGBU1gmXRBYtYURm`, `30 15 * * *` UTC) |
| 17:00 (target) | Routine A, daily merchandise | Cloud routine, `homepage-orchestrator` | Picks the featured product, refreshes Emma copy and imagery, publishes content to Sanity within the budget and kill switch | LIVE, **but the trigger fires at 10:00, not 17:00** |
| 20:00 | R-DEV, dev pass 2 | Cloud routine, `rr7-engineer` | Second attempt pass. Claims bounced tickets first | LIVE (same trigger as pass 1: `trig_01MEQYsg5sHPbM4v39FqssAD`, cron `0 14,20 * * *`) |
| Mon 12:00 | Weekly strategy retro | Cloud routine, `store-strategist` | Cross-team retro, weekly brief, ticket metrics, routine coverage audit | LIVE |

**Routine A timing, stated honestly.** The design for this operating system assumes Routine A runs
at 17:00 UTC (10:00 Pacific), so that the dev pass, the QA pass, and the merchandising run are
separated. The value recorded in `routine-schedule.md` for routine 7 is `0 10 * * *`, that is 10:00
UTC, and that is what the trigger fires at today. Nobody has moved it. Until someone does, the
merchandising run happens four hours *before* the QA pass, not after it. Treat 17:00 as a target and
10:00 as the fact.

Other crons run on this repo (feed processor, deal activator, profit summary, pricing recompute,
import monitor and enrich, batch pollers, GSC sweeps, warm). They are not part of the self-healing
loop; `vercel.json` is their source of truth.

---

## 3. The ticket lifecycle and who owns each move

Tickets and suggestions are the same rows on the same bus (`homepage_team_suggestions`). The full
transition table, including every allowed actor and the 409 behaviour, lives in
[`improvement-loop.md`](./improvement-loop.md#the-ticket-lifecycle). The short version:

| Status | Who moves it out, and to where |
|---|---|
| `proposed` | **Owner only**, to `approved` or `dismissed`. A per-team auto-approve valve can do this at creation time. No agent may. |
| `approved` | A dev or editor agent claims it to `in_progress` under a lease. The owner may dismiss it. |
| `in_progress` | The assignee agent, to `pr_open` or `blocked`. `system` returns it to `approved` when the lease expires. A bounce back into this status renews the lease, so a bounced ticket stays with its assignee instead of being reaped before the pass that has to fix it. |
| `pr_open` | `qa-reviewer`, to `in_review`. `agent-editor` may go straight to `applied` for docs-kind rows (the legacy path, preserved). |
| `in_review` | `qa-reviewer` only: `verified` with evidence, or bounce to `in_progress` with a concrete `last_error` and an attempt consumed. |
| `verified` | `system` only, that is the release engine: `applied` after merge and smoke, or back to `in_progress` on failure. |
| `blocked` | Owner, or `system` when the blocker clears. |

Two structural properties are worth internalising, because they are what make the automation safe
rather than merely convenient. **QA has no path to `applied`**, so a reviewer cannot ship its own
verdict. **Only `system` writes `applied` for code**, and only after the production deploy is live
and smoke-checked, so "applied" always means "actually running on xdipx.com".

Claims are leased. An agent that dies mid-ticket does not park the work forever; the lease expires
and the ticket returns to `approved` for the next pass.

---

## 4. The gates

Nothing merges because someone said it was fine. Each gate is a separate check with its own failure
mode.

| Gate | What it asserts | Who runs it | State |
|---|---|---|---|
| **CI** | `npm run typecheck`, `npm test`, `npm run build` all pass. The required status check on `main` is the `check` job in `.github/workflows/ci.yml` | GitHub Actions | LIVE |
| **Agent allowlist** | Every changed file on an `agents/suggestion-*` branch is inside `agent-editor`'s allowlist. Turns a prose rule into an enforced check | GitHub Actions | LIVE (`.github/workflows/agent-allowlist.yml`, mirrored by `AGENT_EDITOR_ALLOWLIST_RE` in release-engine.server.ts) |
| **QA verdict** | A human-grade review of the diff plus CI status plus the rendered preview, with evidence. Required for `kind:'code'`; docs PRs need the allowlist check instead | `qa-reviewer`, R-QA routine | LIVE (R-QA, `trig_019GjVP9hGBU1gmXRBYtYURm`, since 2026-07-28) |
| **Protected-path classifier** | No changed file touches checkout or payment, cart, `db/migrations` or `db/schema.ts`, auth or session, team valves or spend controls (`team.server.ts`, `team-keys.ts`), `.github/`, `vercel.json`, `.env*`, `package.json`, or the release engine's own files. Runs on the changed-file list from the GitHub API, never on ticket or PR text | Release engine | LIVE (`PROTECTED_GLOBS` + `classifyChangedFiles`, app/lib/github.server.ts) |
| **Render-truth** | The published slate demonstrably rendered on the live page. Replaces "HTTP 200 and the hero renders", which is what let a three-day breakage go unseen | Healthcheck cron + Routine A step 7 | LIVE (PR #349; 9 assertions passing in production 2026-07-28, and see the 30-minute row above, which already says LIVE) |
| **Theme** | During a theme week the hero, at least one rail, and at least one tile demonstrably belong to the active theme, and the orchestrator states the mapping in a run event. Failure means REVISE before publish, not a note afterwards | Routine A, `design-critic` | PLANNED, and honestly blocked: `design-critic` cannot obtain a screenshot in a scheduled run and correctly abstains. The capture pipeline was cut by the owner 2026-07-30, so this gate only runs when the owner invokes it interactively |
| **Freshness** | The designated slots actually changed. An unchanged slate needs a stated reason; two identical consecutive days files a ticket | Routine A + a KV fingerprint check | LIVE (the sameness detector files `sameness:<slot>` tickets from the healthcheck). Was effectively muted on four slots until 2026-07-30, because an open ticket held the undated dedupe key and the detector could not re-file |
| **Emma voice** | Every customer-facing string passes `emma-empathy-reviewer` against `docs/emma-voice.md` | The publishing routine | LIVE |
| **Post-deploy smoke** | After a merge: `/` and `/discover` load, one PDP renders its markers, render-truth holds, and the HTTP-tier checkout probe passes. Failure triggers instant rollback plus a revert PR | Release engine | LIVE (release-engine.server.ts; reverts on failure) |

The classifier deserves one extra sentence. It reads the changed-file list from the GitHub API, so
no wording inside a ticket or PR description can talk it into reclassifying a diff, and the glob
list covers the classifier's own file and the CI workflows, so no agent PR can widen it.

---

## 5. What escalates, and how

Escalation is an email to **mike@xdipx.com** via `sendOwnerEmail`
(`app/lib/owner-alerts.server.ts`). Five triggers, and no others:

1. A **protected-path PR** exists. Labelled `needs-owner`, emailed once, never merged by the engine.
2. A ticket reaches its **third failed attempt**. It goes `blocked` and the email carries the last
   three errors. The release engine owns this for every bouncer: inline on its own merge, deploy, or
   smoke failure, and via an hourly sweep for tickets QA bounced three times, since QA has no
   `blocked` edge in the transition map and no escalation channel.
3. A **revert PR itself fails CI**. Automatic mitigation has failed.
4. The engine **circuit-breaks**: two rollbacks in one day flips `release_engine_enabled` off.
5. The **owner-decision queue has an item older than seven days**, surfaced by the daily digest.

Everything else stays in the loop and shows up on the dashboard and in the 13:00 digest: red CI, a
QA bounce, an expired claim, a deduped detector hit, a routine that skipped at the gate. Those all
have a next owner already (the next dev pass, the next QA pass, the lease expiry). They are not
your problem unless they persist, and if they persist, rule 5 catches them.

---

## 6. Kill switches

Every one of these is a `pipeline_settings` row. Agents may never write `pipeline_settings`.

| Switch | Effect when off | Where to flip it |
|---|---|---|
| `release_engine_enabled` | No agent PR is merged by anything but the owner. Exactly today's world. Default **false** | `/admin/homepage-team`, strategy tab |
| `release_engine_max_merges_per_day` | Hard ceiling on merges per day (seeded at 6), independent of the switch | same |
| `suggestion_apply_enabled` | `agent-editor` opens no PRs at all | `/admin/homepage-team` |
| `{team}_team_auto_approve_suggestions` | Off: that team's suggestions land in `proposed` and wait for the owner's triage click. **On for all five active teams since 2026-07-29** (owner decision; the four non-homepage valves were actually flipped 2026-07-18 and the docs lagged, which is why valve writes now land in `settings_audit_log` with an actor) | that team's tab |
| `{team}_team_enabled` | That team's routines no-op at the gate | that team's tab |
| `{team}_team_daily_cents` / `{team}_team_max_runs` | Spend and run ceilings per team per day | that team's tab |
| `homepage_team_enabled` | The daily merchandising run publishes nothing | `/admin/homepage-team` |
| `content_team_autopublish` | Blog posts stay as Sanity drafts | content tab |
| `product_manager_enabled` | Import candidates are not actioned | `/admin/imports` |
| `import_enrich_enabled` | Imported products never go draft to live | `/admin/imports` |
| `seo_curation_enabled`, `trend_scout_enabled` | Those weekly routines exit before starting a run | content tab |
| `social_team_autopost` | Social drafts are never posted live. **Money valve, owner-gated** | social tab |
| `video_frame_review` | Video frames require owner review. **Money valve, owner-gated** | `/admin/video-studio` |
| `deal_status: approved` (Shopify metafield, not a valve) | No deal publishes without it. **Money valve, owner-gated** | `/admin/deals` |

The three money valves at the bottom are unchanged by anything on this page. The release engine
never writes them, and every file that could change them is a protected path.

---

## 7. What the owner is still on the hook for

Short list, deliberately. If it is not here, the system is supposed to handle it.

- **Triage for every team except homepage.** `proposed → approved` is the owner's call, and no agent
  can make it. Homepage delegates it to a valve; the rest do not.
- **Every protected-path merge.** Checkout and payment, cart, migrations and schema, auth and
  session, valves and spend controls, CI and deploy config, the release engine itself. The engine
  will prepare, label, and email these, and will never merge one.
- **The three money valves.** Deal approval, video frame review, social autopost. Nothing automates
  these and nothing is proposing to.
- **The five escalations in §5**, when they land. That is the intended inbox volume: rare.
- **Turning the engine back on after a circuit break**, once you understand why it tripped.
- **Strategic direction.** The weekly brief is written by agents from evidence, but what the store
  is *for*, what it sells, what the voice is, and what a good week looks like remain the owner's.
- **One-time setup that only an owner can do:** GitHub branch protection and the merge token, Vercel
  environment variables, creating cloud-routine triggers and their secret stores.
- **Authoring protected-path code**, not merely merging it. No agent in the roster may write a
  protected-path diff: R-DEV blocks the ticket instead. Until that changes, this work happens in an
  owner-attended session. See §9, fact two.

**If you are the owner and you are merging more than the list above**, the cause is almost never a
gate misfiring. It is that the change never entered the ticket bus, so the engine was never allowed
to look at it. §9 has the measurements.

---

## 8. What is not built yet

**This section was six rows of stale fiction until 2026-07-30.** It still claimed the release engine
did not exist and that `release_engine_enabled` was false, three days after the engine shipped, was
turned on, and started merging. §2 said LIVE on the same page. An agent that reads this file at run
start and believes §8 concludes the entire merge lane is imaginary. Corrected below; the honesty
rule at the top of this document applies to this section hardest, because it is the one that ages
fastest.

Built and live since this section was last written: the release engine and its cron,
`app/lib/github.server.ts` and `/api/team/pr`, the guarded transition map in `app/lib/team.server.ts`,
the R-DEV and R-QA triggers, render-truth, the freshness detector, and ticket-filing detectors.
Verified 2026-07-30: `release_engine_enabled` is `true`, the daily cap is 12, and the engine has
merged autonomously — tickets #43, #70 and #152 reached `applied` through it, and PR #421 was
squash-merged by it with no owner involvement at all.

Genuinely not built, as of 2026-07-30:

- **The theme gate.** Still blocked, and honestly so: `design-critic` cannot obtain a screenshot in a
  scheduled run and correctly abstains. It only runs when the owner invokes it interactively.
- **Auto-filing a ticket for a ticket-less PR.** See §9: this is the largest remaining hole and it is
  designed but undecided (`docs/adr/ADR-008-owner-out-of-merge-path.md`, steps 2 and 4).

When you implement one of these, move its row out of this section in the same PR. When you find a row
here that is already built, delete it in the same PR — a stale "not built" row is worse than no
section, because it actively misleads.

---

## 9. Why work still reaches the owner's merge button

Two structural facts, both measured on 2026-07-30. Neither is a bug in the release engine; both are
limits of what it was scoped to see. Read this before concluding the engine is broken.

**Fact one: most PRs are outside the engine's jurisdiction by construction.** The engine considers
only branches under `agents/`, `ticket/`, `claude/`, `phase1/`, `tonight/` or `revert/pr-`, and for
anything that is not a revert or docs-only it additionally requires a linked ticket in status
`verified`. Classifying the last 60 merged PRs against those rules:

| | count | why the engine never merged it |
|---|---|---|
| Ineligible branch (`fix/`, `docs/`, `chore/`, `ci/`) | 18 (30%) | the engine does not look at these prefixes |
| Eligible branch, no ticket reference in the title | 35 (58%) | decision `skip`, code `no-ticket` |
| Actual candidates | 7 (12%) | |

The cause is origin, not quality: most work is born in an owner-attended session, which produces a
branch and a PR but never a bus row, so the PR can never acquire the `verified` ticket the engine
demands. **A change that is never ticketed can never be merged by the engine.** If you want a fix to
ship without the owner, it has to enter through the bus.

**Fact two: protected-path work has no agent lane at all.** `routine-dev-daily.md` Step 2 requires
R-DEV to transition a ticket to `blocked` rather than write a line of code when any changed file is
protected, and it is right to. But nothing else picks that work up. There is no agent anywhere in the
roster permitted to author a protected-path diff, so every such change must be written in an
owner-attended session and merged by the owner.

This has a consequence worth stating plainly, because it looks like a paradox and gets rediscovered
every few weeks: **the changes that would reduce the owner's merge load are themselves almost all
protected-path changes.** The transition map, the engine's own gate logic, the branch prefixes, CI
config, valve plumbing — all protected. Getting the owner out of the merge path costs a small,
finite number of owner merges up front. That cost is one-time and correct; it is not the recurring
tax, and it is not a reason to widen the protected list.

## 10. How fast the engine actually drains, and why a queue is not a stall

Measured 2026-08-04. Read this before concluding from a list of open PRs that anything is broken.

**The engine merges one PR per cycle, not one per cron tick.** `runReleaseCycle` returns immediately
after `mergeOne`, and the merged PR then occupies the `awaiting-deploy` phase across subsequent
cycles until the production deploy is READY and post-deploy smoke passes. The cron is `*/10`, but a
full merge plus deploy plus smoke costs about three cycles. **Observed steady-state throughput is one
merge every 30 minutes, roughly 2 per hour**, confirmed by seven consecutive merges landing at 22:30,
23:01, 23:30, 00:00, 00:30, 01:01 and 01:31 UTC.

This is a deliberate design property, not a defect. Every merge, including a docs-only one, pays a
full production deploy and smoke run, and merges are serialized so that a failing smoke check reverts
exactly one change. Do not "fix" the queue by merging more per cycle or shortening the interval:
both raise deploy frequency and burn the two-rollbacks-per-day circuit breaker
(`ROLLBACK_CIRCUIT_LIMIT`) faster, which turns the engine off entirely.

**What this means for the queue.** `agent-editor` opens its apply PRs in a burst, up to the 15-PR cap
in its playbook, typically within a few minutes of each other. The engine drains them at 2 per hour
against a daily cap of 12. **A burst of 8 PRs appearing at once and taking four hours to clear is the
system working correctly.** Same-day landing is not a property the docs lane has ever had, and the
apply cap and the drain rate were set independently of each other.

### Three ways a PR can be stuck, and how loud each one is

Ranked by how likely you are to find out. This asymmetry is the real reason a healthy engine can look
broken.

| Stuck because | Signal the owner gets |
|---|---|
| Protected path | `needs-owner` label, one email, a digest row. **Loud, correct.** |
| No linked `verified` ticket | A `no-ticket` or `ticket-not-verified` line in the engine's per-cycle decision log. **Quiet, but discoverable.** |
| **Ineligible branch prefix** | **Nothing at all.** |

The third row is the one that matters. `listOpenPullRequests` filters by prefix before any
`PullRequestFacts` object is built, so an ineligible PR is never evaluated, never labelled, never
emailed, never logged by number, and never reaches the digest. It is invisible to every observability
surface at once, and it can sit for a month without anything saying so. **Silence from the engine
means "not looked at", never "looked at and fine".** Until this is fixed, an open PR on a prefix
outside `AGENT_BRANCH_PREFIXES` plus `revert/pr-` is owner-only work whether or not anyone noticed.

Verified instance: `pm/tracker-*`, the program-manager's weekly tracker PR. `pm/` is not an eligible
prefix, and separately the allowlist regex `docs/store-team/[^/]+\.md` does not cross into
`docs/store-team/trackers/`. **No tracker PR has ever been merged by the engine.** Both playbooks
claimed otherwise until 2026-08-04.

### The QA cadence asymmetry

R-DEV runs twice a day, 14:00 and 20:00 UTC. R-QA runs once, at 15:30 UTC. A `kind:'code'` ticket
cannot reach `verified` without a QA pass, so **every PR from the 20:00 dev pass waits about 19 hours
for review**, while the 14:00 pass gets reviewed within 90 minutes. Pass two structurally cannot land
same-day. Verified instance: PR #477 opened 20:25 UTC on 2026-08-03, CI green on the required `check`
job, and could not be looked at until 15:30 UTC the next day. This is a scheduling gap, not a gate
doing its job.

## A note on owner email, 2026-07-28

Every alert in this document routes through `sendOwnerEmail`, and until 2026-07-28 not one had
ever been delivered. Two faults stacked. The SMTP credentials were never set, so the function
returned `sent:false` and only logged a warning. Once they were set, it still failed: the function
loaded nodemailer with a bare `require()`, and the Vercel entry is bundled as ESM where `require`
is not defined, so the `ReferenceError` was caught and reported as "nodemailer not installed"
about a package that was installed the whole time.

Both are fixed (PR #354) and a real digest was delivered and confirmed. The lesson worth keeping:
an error string that asserts a cause nobody verified will hide a bug for as long as anyone is
willing to believe it. Prefer reporting the underlying error.

## Operational note: the release engine's Vercel credential, 2026-07-28

The engine's post-merge phase looks up the production deployment by matching the merge commit SHA
against `meta.githubCommitSha`. That call needs `VERCEL_TOKEN`, and the token's scope must include
the team that owns the project (`mikebayard-5194s-projects`). A personal-scoped or expired token
does not error loudly: `listProductionDeployments` logs a warning and returns an empty list, which
the poller reports as "deployment not found yet", indistinguishable from a deploy that has not
started. The first live merge (PR #356) hit exactly this and sat in `awaiting-deploy` while the
deployment had in fact succeeded.

Two things follow. Rotate `VERCEL_TOKEN` and `GITHUB_TOKEN` together, since both were minted at the
same time and both expired silently. And when the poller reports "not found" for more than a couple
of minutes, check the token before believing the deployment is missing: confirm against the commit
status on GitHub, which is written by Vercel's own integration and does not depend on our token.
