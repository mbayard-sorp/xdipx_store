# Cloud Routine Schedule Manifest

The agent-plane routines run in Claude's cloud scheduler, outside this repo. This manifest is the
versioned source of truth for what should be scheduled: routine names, cadences, and the exact
scheduled prompt each fires with (fresh session per fire, completion notifications off). If the
scheduler and this file disagree, fix one of them — the weekly strategy routine should verify each
expected routine actually ran (the runs table has the data) and file a suggestion when one is
missing.

Status 2026-07-13: routines 1–9, 12, and 13 exist as triggers in Claude's cloud scheduler (fresh
session per fire, completion notifications off), each firing the exact prompt in this manifest.
Routine 9 (Daily Content Writer) was recreated as a cloud trigger on 2026-07-13, closing the
known gap where the old desktop scheduled task (`xdipx-daily-content-writer`, fires only while
the Claude app is open) never ran reliably — **the owner should delete that desktop task** so the
routine can't double-fire (the gate's run cap would otherwise let a second run write a second
post). Content runs still no-op at the gate until `content_team_enabled` is flipped on (see the
enablement runbook appendix in `docs/store-team/routine-content-daily.md`).
Trigger IDs, for reference when editing or deleting a routine:

| # | Name | Trigger ID |
|---|---|---|
| 1 | xdipx — Weekly Strategy | `trig_018pSqtCKWC3fxbstN7wQBvs` |
| 2 | xdipx — Apply Pass (agent-editor) | `trig_018kKMQRtD6a5XPUJu5aVPK5` |
| 3 | xdipx — Cost Review (process-optimizer) | `trig_01S2ha8LYtKkpZ7JoPGAJKKZ` |
| 4 | xdipx — Ads Proposals | `trig_013PfuKac4rkjPTHuUwXWzRn` |
| 5 | xdipx — Email Briefs | `trig_01FkT8YQZJWvPqVQ8nBEPzjq` |
| 6 | xdipx — Social Drafts | `trig_01CKe93nZQ1uQqqDZLpQ5GG8` |
| 7 | xdipx — Daily Merchandiser (Routine A) | `trig_01PEat4JFm4fVmbNQKomSVMS` |
| 8 | xdipx — Design Cycle (Routine B) | `trig_017s5fsNnWgk7xpXgF8QZccB` |
| 9 | xdipx — Daily Content Writer | `trig_01Qf5puo6AZyJqWn9QHN5mxQ` (cloud trigger since 2026-07-13; replaces desktop task `xdipx-daily-content-writer`, which should be deleted) |
| 12 | xdipx — Weekly Podcast Review | `trig_01AN6PKVghE9AM51R13z2UEu` |
| 13 | xdipx — Daily Pricing Sweep | `trig_01AchSCvZnX56hbr7VsTvVSi` (cloud trigger since 2026-07-13; replaces desktop task `pricing-daily-sweep`, deleted the same day) |
| 14 | xdipx — Daily Product Manager | _(cloud trigger TBD — create at enablement; see `routine-product-daily.md` appendix)_ |

On 2026-07-13 the last three desktop scheduled tasks on the owner's machine were deleted:
`pricing-daily-sweep` (recreated as cloud routine 13), plus `homepage-daily-merchandise` and
`homepage-design-cycle`, which had been duplicating cloud routines 7 and 8 since 2026-07-09 and
risked double-fires. All routines now run exclusively in Claude's cloud scheduler.

Still outstanding: smoke-test by firing Weekly Strategy manually (`fire_trigger` on
`trig_018pSqtCKWC3fxbstN7wQBvs`) and confirm the run row plus gate state on
`/admin/homepage-team?team=strategy` — gate-closed skip before migration 052 is applied, a full run
after. The weekly strategy routine's own first scheduled fire also verifies the other 7 ran, going
forward.

## Common prompt skeleton

Every prompt below follows the same shape: work in the xdipx_store repo; read the binding mission
brief (`docs/store-team/mission-brief.md`, or `docs/homepage-team/mission-brief.md` for the
homepage team) and `docs/emma-voice.md`; follow the named playbook exactly; start the run via
`POST https://xdipx.com/api/team/run` (header `x-team-secret: $TEAM_TOKEN`, falling back to
`$HOMEPAGE_TEAM_TOKEN` / `$CRON_SECRET`); **gate first** via
`GET https://xdipx.com/api/team/gate?team=<team>&excludeRun=<run id>` and on `ok:false` post a
skipped event, finish the run honestly, and exit cleanly; end with the playbook's retro step; log
spend via `POST https://xdipx.com/api/homepage-team/spend` under the team's feature label.

## The routines

| # | Name | Cron (UTC) | Team / feature label | Playbook | Extra prompt clauses |
|---|---|---|---|---|---|
| 1 | xdipx — Weekly Strategy | `0 12 * * 1` | strategy / `strategy-weekly` | `docs/store-team/routine-weekly-strategy.md` | Run as store-strategist with the inventory-sentinel, promo-manager, loyalty-referral-manager, product-manager, and program-manager sub-steps. Advisory only: publish the brief (including program-manager's Program Status section), file/route suggestions, never operate (program-manager's docs-only tracker PR on `pm/tracker-<date>` is the one allowed write, never auto-merged). |
| 2 | xdipx — Apply Pass (agent-editor) | `0 20 * * 1` | strategy / `strategy-apply` | `docs/store-team/routine-agent-editor.md` | Step 0: if `suggestion_apply_enabled` is not `'true'`, exit without starting a run. Owner-APPROVED suggestions of kind instructions/agent-def/config only; one minimal-diff PR per suggestion on branch `agents/suggestion-<id>`; max 5/run; allowlisted files only; NEVER merge or push to the default branch; refuse anything that weakens valves, the voice gate, MAP, or the loop's human gates. |
| 3 | xdipx — Cost Review (process-optimizer) | `0 21 * * 1` | strategy / `strategy-cost-review` | `.claude/agents/process-optimizer.md` + `docs/store-team/improvement-loop.md` | Read recent runs/events/`api_token_log` cost + outcomes across every team; file suggestion rows with estimated $ savings and an explicit CX-risk note. Propose only; no self-rewiring. |
| 4 | xdipx — Ads Proposals | `0 13 * * 2` | ads / `ads-planning` | `docs/store-team/routine-ads-weekly.md` | PROPOSE-ONLY: write `ad_campaigns` proposals with a substantive policyCheck citing `docs/ads-policy.md`; never create/edit/activate/boost anything on any platform; you spend no money, ever. Max 3 proposals/run. |
| 5 | xdipx — Email Briefs | `0 15 * * 2` | email / `email-planning` | `docs/store-team/routine-email-weekly.md` | PLAN-ONLY: file campaign briefs as suggestions (kind campaign) for the owner to execute in Klaviyo; send nothing. Max 2 briefs/run. |
| 6 | xdipx — Social Drafts | `0 14 * * *` (daily) | social / `social-drafts` | `docs/store-team/routine-social-daily.md` | DRAFT-ONLY: every draft passes the emma-empathy-reviewer voice gate, then lands as a `social_posts` row with status `draft`. Never post live; never touch `social_team_autopost`. |
| 7 | xdipx — Daily Merchandiser (Routine A) | `0 10 * * *` (daily) | homepage / `homepage-*` | `docs/homepage-team/routine-daily-merchandise.md` | Entry agent homepage-orchestrator; mission brief is `docs/homepage-team/mission-brief.md`; content auto-publish within the gate/budget/image caps; never code changes. |
| 8 | xdipx — Design Cycle (Routine B) | `0 14 * * 3` (Wed) | homepage / `homepage-build` | `docs/homepage-team/routine-design-cycle.md` | Build on a branch and open a PR; never auto-merge; stop at the open PR. |
| 9 | xdipx — Daily Content Writer | `0 15 * * *` (daily, approx 8a Pacific) | content / `content-blog` | `docs/store-team/routine-content-daily.md` | Entry agent content-writer. Cloud trigger since 2026-07-13 (`trig_01Qf5puo6AZyJqWn9QHN5mxQ`), replacing the unreliable desktop task `xdipx-daily-content-writer` (delete the desktop task to prevent double-fires). One post per run; topic by the weekly rhythm in `docs/store-team/content-plan.md` (Thursday checks the pending `podcastReviewBrief` first; Tue/Fri are Real Talk per content-plan §8B); every draft passes the emma-empathy-reviewer voice gate; publish live only on PASS with the `content_team_autopublish` valve on, otherwise leave the Sanity draft. No-ops at the gate until migration 054 is applied and `content_team_enabled` is on; see the enablement runbook appendix in the playbook. |
| 10 | xdipx — Weekly SEO Curation | `0 16 * * 0` (Sun) | content / `content-seo-curation` | `docs/store-team/routine-seo-curation.md` | Entry agent seo-curator. Step 0: if `seo_curation_enabled` is not `'true'`, exit without starting a run. Triage the gray-zone pending keywords (cap 250 decisions); propose cluster merge maps as suggestions (NEVER execute merges); plan up to 7 seoContentBrief docs for the coming week following the content-plan rhythm; file the weekly report suggestion (coverage, queue depth, bank staleness, enrichment coverage). Never write posts, never touch flagged keywords, never delete anything. |
| 11 | xdipx — Weekly Off-site Scout | `0 16 * * 2` (Tue) | strategy / `strategy-offsite` | `docs/store-team/routine-offsite-weekly.md` | Entry agent offsite-scout. PROPOSE-ONLY: research the roundups/listicles LLM answers cite for sexual-wellness shopping queries, draft pitches + unlinked-mention reclamations + expert-quote prospects as suggestion rows (max 6/run, no duplicates of still-proposed rows), each with a mandatory policy note against `docs/ads-policy.md`. Never send, never post, never spend; the owner executes approved pitches manually from hello@xdipx.com. Tuesday avoids the Monday strategy run (1-run/day cap). Fewer than 5 published notebook posts → file only the summary and recommend waiting. |
| 12 | xdipx — Weekly Podcast Review | `0 16 * * 3` (Wed) | content / `content-podcast` | `docs/store-team/routine-podcast-weekly.md` | Entry agent podcast-reviewer. RESEARCH-ONLY: pick the most recent unreviewed episode from `docs/store-team/podcast-shortlist.md` (rotation rules binding), review from transcript or show notes with sourceQuality recorded honestly, and write ONE pending `podcastReviewBrief` in Sanity — never a blogPost, never a publish, no images. A pending brief already waiting → skip honestly. Wednesday so Thursday's content run (routine 9, podcast-notes slot) finds a fresh brief. Trigger created 2026-07-13: `trig_01AN6PKVghE9AM51R13z2UEu`. |
| 13 | xdipx — Daily Pricing Sweep | `37 14 * * *` (daily, approx 7:37a Pacific) | ops (no team gate) / n/a | `.claude/agents/pricing-ops.md` | Entry agent pricing-ops. Cloud trigger since 2026-07-13 (`trig_01AchSCvZnX56hbr7VsTvVSi`), replacing the desktop task `pricing-daily-sweep` (deleted). Verify the 07:00 UTC batch recompute ran in the last 26 hours (~1,200+ audit rows), catch up via `POST /cron/pricing-batch-recompute` at most once if missed, triage the pending approval queue, flag error rows and reject spikes. Read-only on the database; never approves/rejects/applies price changes; the catch-up trigger is the only allowed mutation. |
| 14 | xdipx — Daily Product Manager | `0 9 * * *` (daily) | product / `product-daily` | `docs/store-team/routine-product-daily.md` | Entry agent product-manager. Sweeps `import_candidates` for pending/watching rows the deterministic Phase-2 gates left behind and executes approve/reject/watch via `/api/team/import-candidate-action` (bulk `ids`, one call per intent). 09:00 UTC = after the 08:00 `/cron/import-monitor` discovery run. No-ops at the gate until migration 059 is applied and `product_team_enabled` is on; the execute endpoint is separately gated by `product_manager_enabled` (on from migration 052). This is the execution cadence; the weekly-strategy run invokes product-manager review-only. See the enablement runbook appendix in the playbook. |

Times chosen for a US-Eastern owner: strategy Monday 8a ET, apply/cost-review Monday afternoon
after the owner's suggestion review, ads/email Tuesday morning, social daily 10a ET, merchandiser
daily 6a ET, design cycle Wednesday 10a ET.

## Access checklist (per routine)

Same as `docs/homepage-team/README.md`: scheduled Claude cloud session with repo access, the team
callback secret (`TEAM_TOKEN` / `HOMEPAGE_TEAM_TOKEN`) in its secret store, GA4 MCP where the agent
def lists it, and (ads only) the read/insights Meta Ads MCP tools named in
`.claude/agents/ads-manager.md`. All routines no-op at the gate until migration 052 is applied.
