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
| 20:00 | R-DEV, dev pass 2 | Cloud routine, `rr7-engineer` | Second attempt pass. Claims bounced tickets first | PLANNED |
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
| `in_progress` | The assignee agent, to `pr_open` or `blocked`. `system` returns it to `approved` when the lease expires. |
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
| **Agent allowlist** | Every changed file on an `agents/suggestion-*` branch is inside `agent-editor`'s allowlist. Turns a prose rule into an enforced check | GitHub Actions | PLANNED |
| **QA verdict** | A human-grade review of the diff plus CI status plus the rendered preview, with evidence. Required for `kind:'code'`; docs PRs need the allowlist check instead | `qa-reviewer`, R-QA routine | PLANNED |
| **Protected-path classifier** | No changed file touches checkout or payment, cart, `db/migrations` or `db/schema.ts`, auth or session, team valves or spend controls (`team.server.ts`, `team-keys.ts`), `.github/`, `vercel.json`, `.env*`, `package.json`, or the release engine's own files. Runs on the changed-file list from the GitHub API, never on ticket or PR text | Release engine | PLANNED |
| **Render-truth** | The published slate demonstrably rendered on the live page. Replaces "HTTP 200 and the hero renders", which is what let a three-day breakage go unseen | Healthcheck cron + Routine A step 7 | PLANNED |
| **Theme** | During a theme week the hero, at least one rail, and at least one tile demonstrably belong to the active theme, and the orchestrator states the mapping in a run event. Failure means REVISE before publish, not a note afterwards | Routine A, `design-critic` | PLANNED |
| **Freshness** | The designated slots actually changed. An unchanged slate needs a stated reason; two identical consecutive days files a ticket | Routine A + a KV fingerprint check | PLANNED |
| **Emma voice** | Every customer-facing string passes `emma-empathy-reviewer` against `docs/emma-voice.md` | The publishing routine | LIVE |
| **Post-deploy smoke** | After a merge: `/` and `/discover` load, one PDP renders its markers, render-truth holds, and the HTTP-tier checkout probe passes. Failure triggers instant rollback plus a revert PR | Release engine | PLANNED |

The classifier deserves one extra sentence. It reads the changed-file list from the GitHub API, so
no wording inside a ticket or PR description can talk it into reclassifying a diff, and the glob
list covers the classifier's own file and the CI workflows, so no agent PR can widen it.

---

## 5. What escalates, and how

Escalation is an email to **mike@xdipx.com** via `sendOwnerEmail`
(`app/lib/owner-alerts.server.ts`). Five triggers, and no others:

1. A **protected-path PR** exists. Labelled `needs-owner`, emailed once, never merged by the engine.
2. A ticket reaches its **third failed attempt**. It goes `blocked` and the email carries the last
   three errors.
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
| `{team}_team_auto_approve_suggestions` | That team's suggestions land in `proposed` and wait for the owner's triage click. Homepage is on; every other team defaults off | that team's tab |
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

---

## 8. What is not built yet

Recorded plainly so nobody mistakes the design for the system, as of 2026-07-27:

- The release engine (`app/lib/release-engine.server.ts`, `/cron/release-engine`) does not exist in
  the repo. `release_engine_enabled` exists and is **false**.
- `app/lib/github.server.ts` and `/api/team/pr` (the egress-safe GitHub and preview proxy that the
  QA routine depends on) do not exist yet.
- The guarded transition map (`transitionSuggestion`, `expireStaleClaims`) is not yet in
  `app/lib/team.server.ts`; migration 070 has shipped the columns it needs.
- The R-DEV and R-QA cloud-routine triggers have not been created. Their playbooks exist.
- Render-truth, the theme gate, and the freshness gate are specified, not implemented. The
  design-critic screenshot gate stays REVISE-only until the snapshot harness exists; text-based
  render truth is the enforcing gate, and pretending otherwise is how the last blindness happened.
- The detectors file GitHub issues today but do not yet file tickets.

When you implement one of these, move its row from PLANNED to LIVE here in the same PR.

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
