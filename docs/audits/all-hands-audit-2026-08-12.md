# /all-hands automation audit, 2026-08-12

Scope: the `/all-hands` command (`.claude/commands/all-hands.md`, identical global and in-repo) and everything downstream of it: the team API, the improvement bus, agent-editor, R-DEV, and the release engine. Every claim below was verified against code, docs, or the production database on 2026-08-12.

## Verdict

The plumbing the command depends on is real and works: `GET /api/team/status`, the suggestion API (all 9 ops), `gsc_index_daily`, the checkout probe and healthchecks, the ticket lifecycle, dedupe enforcement, and PR autofile all exist and behave roughly as described. The roster and all six pre-read docs exist. The command itself is sound.

The failures are at the two ends: three routing promises in the command that the downstream system cannot honor, and a landing zone that silently strands what /all-hands files. Owner direction is reliably captured; it is not reliably executed.

## Gaps, ordered by impact

### 1. Owner direction lands in `blocked` and stays there (P0)

Production has **49 blocked code tickets. 47 of them have `attempt_count = 0`, no `last_error`, and no `blocked_by_id`.** They were never tried and never escalated; they were filed or parked as blocked. Oldest is 23 days.

This directly swallows all-hands output. From the 2026-08-11 all-hands alone, tickets #2738, #2739, #2740 ("Build the Instagram scheduled-publish job... SHIP IT"), and #2741 are all blocked with zero or one attempt. #2216 (charter amendment v5.3, an explicit owner "codify" from 2026-08-09) is blocked with zero attempts. #1523 (profit measurement blind, P1) and #1704 (release engine stuck-PR bug, P0) are also in the pile.

CLAUDE.md says blocked means "failed three fix attempts and escalated to mike@xdipx.com." Reality: blocked is being used as a "needs owner / protected path / cannot proceed" parking lot with no surfacing mechanism except the standup's one-line "call out anything blocked."

**Fix:** (a) one owner triage session over the 49 rows now; (b) a weekly blocked-digest (email or standup section listing every blocked P1/P2 with its reason and the single question that unblocks it); (c) stop filing owner-decision items as `code` tickets. The command's own classification table says judgment calls become questions in the report, not tickets; the sessions running it are not following that rule when the item is "protected-path feature the owner said to ship."

### 2. Charter edits are routed to a lane that cannot deliver them

Step 2 routes "a standing rule" to "an edit to a mission brief, playbook, **charter**, or agent definition" via agent-editor. But the CI allowlist (`.github/workflows/agent-allowlist.yml`, quoted in `docs/store-team/routine-agent-editor.md:165-170`) only permits `.claude/agents/*.md` and depth-1 `.md` files under `docs/store-team/` and `docs/homepage-team/`. **`docs/emma-voice.md`, `docs/design-doctrine.md`, `docs/ads-policy.md`, and `CLAUDE.md` cannot merge on an agent branch.** One out-of-allowlist file fails the whole PR. The agent-editor definition (agent-editor.md:36) claims conditional permission for emma-voice.md and ads-policy.md that CI will never honor.

Evidence this bites: #2216 (charter amendment, owner codify) misfiled as `code`, blocked; #2756 and #2748 (design-doctrine amendments from the 8/11-8/12 all-hands) sit `approved` as instructions rows agent-editor cannot land.

**Fix:** the command should route charter/doctrine/CLAUDE.md edits to an owner-merged PR opened in the same session (protected-doc lane), and say so. Separately decide whether to extend the CI allowlist to the charters deliberately; do not let the mismatch stand.

### 3. The approved-instructions backlog contradicts the command's central promise

The command's pitch is "direction that does not land in a binding document did not happen." Production: **61 approved `instructions` rows, oldest 2026-07-13 (30 days).** By team: strategy 21, homepage 14, content 13, social 11, support 1, product 1. Overall 108 live approved rows.

Causes, all confirmed in `routine-agent-editor.md`:
- agent-editor runs weekly, capped at 15 PRs/run.
- Too-vague rows are left approved with a decision event. Refused rows are left approved and **re-listed every future run**. Already-satisfied instructions rows cannot be self-closed (the API 409s agent-editor retiring `instructions` kinds). Conflicting rows: one implemented, the other left approved.
- Supersession is text-only. `supersedes_id` is 0 for all 61 approved instructions rows; chains like the Instagram cluster (#2213 approved 8/9, then #2732 "Consolidated rewrite, SUPERSEDES..." applied 8/12, while #2213 still sits approved) exist only in prose, so nothing can mechanically close the stale row.

**Fix:** (a) allow agent-editor to retire/dismiss `instructions` rows it proves superseded or satisfied (lift the API 409, log the evidence); (b) /all-hands sessions must set `supersedesId` when consolidating and prefer updating the surviving row; (c) consider bumping agent-editor to 2x/week while the backlog drains; (d) one owner pass to dismiss the dead rows.

### 4. Misrouting traps the command does not warn about

- **`config` kind is docs-only.** The kind exists but agent-editor explicitly cannot touch `pipeline_settings` values. Step 2's "a setting, valve, cap, or schedule → owner, or `config` ticket" is half wrong: a config ticket for a valve flip lands with an executor that must refuse it. 2 approved config rows are sitting in exactly this state. Valve/cap/schedule items are owner actions, full stop.
- **Team is required and wrong-but-valid teams strand rows.** `op:'create'` 400s without a team. Auto-approve keys off `targetTeam ?? team`; the valves are on only for the 5 active teams. A row filed under ads, email, video, or support sticks at `proposed` with no triage session scheduled to ever see it.
- **Unknown kinds are coerced to `process`**, which has no automated executor (18 approved process rows attest). A typo'd kind quietly becomes owner homework.
- **Kinds with no executor**: `process` (owner-direct) and `program` (owner decision); `campaign`/`promo` scripts exist but are valve-gated off and never transition the row. 18 process + 19 strategy + 2 program approved rows are live. The standup should count these as "needs you," not as queue depth.

**Fix:** a short "landing rules" block in all-hands.md: valid teams and which have auto-approve on, valid kinds and who executes each, valves are owner-only, always set team + kind + dedupeKey + supersedesId explicitly.

### 5. Dedupe is real but opt-in, and the wording oversells it

The partial-unique index on `dedupe_key` works (repeat create returns `{deduped:true, id}`; a repeat against a `blocked` row even auto-reopens it to approved, which is a nice property the command should exploit deliberately). But nothing requires the caller to supply a key, and a re-worded key stacks a duplicate. Also the command says repeat direction "updates the existing row"; it does not; content is never updated, the repeat just points at the live row.

**Fix:** wording fix in Step 4, plus an instruction to run `op:'list'` and check for an existing live row before filing anything.

## Savings

1. **Pre-read: ~160 KB (~40k tokens) per run before any work starts.** The six mandatory docs total 159.6 KB; emma-voice.md (36.8 KB) and design-doctrine.md (23.5 KB) are only relevant when an item touches customer-facing words or pixels. Replace the blanket list with a 2-3 KB routing card embedded in the command (classification table + valid teams/kinds/valves + lifecycle + protected paths) and load charters conditionally. Cuts the typical run's fixed cost by well over half.
2. **Standup is six hand-rolled pulls per run.** One `scripts/standup.ts` (or a `?standup=1` view on `/api/team/status`) returning status + ticket rollup + open PRs + last merch run + last gsc row + failing probes in one shot would make the no-arg path near-free and consistent between runs.
3. **Specialist convening is the biggest variable cost.** "For anything non-trivial, spawn the relevant specialists in parallel" invites 4-8 subagents at 50-120k tokens each. Most direction items have one obvious owner. Convene only when the item is contested, cross-surface, or the specialist's read changes the routing; otherwise route directly.
4. **Backlog drag is a recurring tax.** Every agent-editor run re-lists refused rows; every strategist retro re-reads 108 approved rows; R-DEV's bounced-first pass scans the blocked pile twice a day. The one-time triage in gaps 1 and 3 stops paying this tax weekly.
5. **Duplicate filings waste downstream QA and R-DEV cycles.** Enforcing dedupeKey + list-before-create (gap 5) is the cheap prevention.

## Concrete fix list

| # | Fix | Where | Who |
|---|---|---|---|
| 1 | Triage 49 blocked + dismiss stale approved rows | dashboard | owner, one session |
| 2 | Weekly blocked-digest with unblock questions | new small cron or standup section | code ticket |
| 3 | Protected-doc lane: charter/doctrine/CLAUDE.md edits become owner-merged PRs opened in-session | all-hands.md Step 2 + 4 | edit the command |
| 4 | Fix `config`-ticket routing for valves (owner-only) | all-hands.md Step 2 | edit the command |
| 5 | Landing rules block: teams, kinds, executors, dedupeKey + supersedesId mandatory, list-before-create | all-hands.md Step 4 | edit the command |
| 6 | Let agent-editor retire superseded/satisfied `instructions` rows with evidence | api.team.suggestion + routine-agent-editor.md | code ticket |
| 7 | Replace blanket pre-read with routing card + conditional charter loads | all-hands.md "Read before you route" | edit the command |
| 8 | `scripts/standup.ts` single-shot standup | scripts/ | code ticket |
| 9 | Scope specialist convening to contested/cross-surface items | all-hands.md Step 3 | edit the command |
| 10 | Resolve agent-editor definition vs CI allowlist mismatch (emma-voice/ads-policy) | agent-editor.md or allowlist workflow | owner decision |
