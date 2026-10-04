# Routine Ads Daily: the buyer step (addendum)

This file holds two steps for `docs/store-team/routine-ads-daily.md` that cannot be written there
yet, because that playbook is still on the PR-B branch (#1501, ticket 13378). When #1501 merges, the
apply lane folds Step 4b in after Pass 2 Step 4 and Step 5b in after Pass 2 Step 5, renumbers
nothing else, and deletes this file in the same PR. The agent is `.claude/agents/paid-media-buyer.md`
(owner direction 2026-10-03: the roster needed someone who owns profit per dollar of paid spend).

Both steps run inside Pass 2 under its existing `$RUN_ID` and its existing slot in
`ads_team_max_runs`. No new routine, trigger or run cap.

## Pass 2, Step 4b. Buyer judgment (after metrics and rules)

Runs right after Step 4 (`POST team/ad-metrics {op:'daily'}`), every Pass 2, including while
`ads_spend_enabled` is false.

**Skip condition.** If Step 4 recorded `metrics_api_not_live`, post a `step` event
`summary:"skipped: buyer_no_metrics"`, `phase:"buyer"`, and continue to Step 5. If metrics landed
but `rules` came back `{ok:false}`, the buyer still runs and judges from the summaries.

**Why the session fetches and relays.** `paid-media-buyer` runs as a spawned subagent on Opus, and a
spawned subagent cannot reach `/api/team/*` (run 331, 2026-08-15). The `ads-manager` session fetches
the inputs, pastes them into the subagent's prompt, and posts what it returns verbatim. The session
does not edit the buyer's verdicts.

**Inputs the session fetches:**

1. Step 4's full `daily` response (attribution, rollup, `rules`).
2. The creative ids that are live, paused in the last 7 days, or named by a firing, then:
   ```bash
   bash scripts/team-api.sh POST team/ad-metrics '{"op":"summary","creativeIds":[<ids>],"lookback":7}'
   bash scripts/team-api.sh POST team/ad-metrics '{"op":"summary","creativeIds":[<ids>],"lookback":30}'
   ```
3. The last 14 days of `ad_rule_events`, as the Live tab shows them (rule, creative, action,
   `detail`, `applied_by`, `applied_at`). If no team read exists for them yet, pass the firings from
   item 1 plus the buyer's own `decision` events from the last 14 days
   (`POST team/event {op:'list', sinceDays:14}`, `agentRole:'paid-media-buyer'`).
4. From `GET team/status` and the settings the Spend tab reads: `ads_spend_enabled`,
   `ads_media_daily_cap_cents`, `ads_media_monthly_cap_cents`, month-to-date spend,
   `ads_gross_margin_pct`, the `ads_rule_*` thresholds.
5. Open blockers and suggestions that mention a Meta rejection, restriction or data-sharing tier.

**Spawn** `paid-media-buyer` with those inputs and the line "Pass 2 Step 4b, <date>, simulation:
<on|off>". It returns the block in its `<output_format>`.

**Outputs the session writes:**

- Each rule-event payload as a `decision` event, until a team write op for `ad_rule_events` exists:
  ```bash
  bash scripts/team-api.sh POST team/event '{"op":"record","runId":<RUN_ID>,"eventType":"decision","phase":"buyer","agentRole":"paid-media-buyer","summary":"<plain one-line reading> | <payload JSON>"}'
  ```
  When the write op ships, the same payloads go to it unchanged, with `appliedBy` null. The buyer
  never applies anything: no valve lets it today.
- Each refresh request as a `decision` event whose summary starts `refresh-request:`. Pass 1 Step 2
  reads these from the event list as precedents for the next slate.
- Each owner blocker through `POST /api/team/blocker`, with its verify probe.
- The buyer's header lines (simulation label, spend against both caps, contribution today and 7d,
  firings judged, shifts, fatigue calls, tests, checkpoint) copied into the Pass 2 run summary.

**Never in this step:** a platform call of any kind, a valve write, a budget change applied anywhere,
or a creative edit. If the buyer's block asks for one, post a `decision` event saying so and drop
that item.

## Pass 2, Step 5b. Weekly profit memo (Sundays)

Runs after Step 5 on the Sunday Pass 2 only, so Monday's 12:00 UTC strategy run reads it.

1. Fetch the same inputs as Step 4b with `lookback:7` and the prior week's summaries, plus the real
   order count and AOV from `daily_profit_summary` and the state of tickets #3441 and #3422.
2. Spawn `paid-media-buyer` with "Step 5b, weekly memo, week of <date>". It returns a suggestion
   payload.
3. File it as returned:
   ```bash
   bash scripts/team-api.sh POST team/suggestion '{"op":"create","team":"ads","targetTeam":"strategy","kind":"campaign","category":"other","cxRisk":"low","suggestion":"<memo>"}'
   ```
4. Post a `step` event `summary:"buyer memo filed #<id>"`, `phase:"buyer"`.

The memo's first line is the checkpoint from `docs/store-team/mission-brief.md` §2 (AOV of at least
$45 over 10 or more real orders, and a trustworthy measurement chain), with the current numbers.
While `ads_spend_enabled` is false, every figure in it is labeled `SIMULATION` with its source.

## Pass 2 summary and definition of done, additions

- The Pass 2 summary gains one line: `buyer: <n> firings judged, <n> shifts, <n> refreshes, <n>
  tests open` or `buyer: skipped (<reason>)`.
- Pass 2 still succeeds on the playbook's existing terms. A buyer step that ran but could not read a
  metric reports the gap; it does not fail the run.
