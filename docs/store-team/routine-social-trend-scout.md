# Routine: Weekly Social Trend Scout (social-trend-scout)

The playbook for the weekly platform-format research routine. Entry agent: `social-trend-scout`.
One job per run: scan how short video is winning right now across three lanes (format trends on
TikTok/Reels/Shorts, trending sounds with a lyrics-cleanliness verdict per sound, competitor and
creator activity in the sexual-wellness space) and file up to 4 trend briefs as suggestion rows
targeting the video and social teams. The video-producer's Tuesday run and the social-media-manager's
daily runs read approved briefs with their weekly context.

Scope note: this routine is distinct from routine 16 (trend-scout), which researches community
discourse for the content/blog lanes and writes `trendTopicBrief` docs in Sanity. This routine
never writes a `trendTopicBrief`; its only write path is suggestion rows, mirroring offsite-scout.

PROPOSE-ONLY: this routine never posts, never writes `social_posts` rows, never enqueues or
touches video jobs, and generates no images. Runs on the **Max subscription**. Recommended
cadence: weekly, Monday 17:00 UTC (after Monday's strategy brief at 12:00, the day before the
video-producer's Tuesday 17:00 run). Never call the site's Anthropic-keyed endpoints; the site is
for data reads, gating, run/event recording, suggestion filing, and spend logging only.

Auth on every `/api/team/*` call: header `x-team-secret: $TEAM_TOKEN` (falls back to
`$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Valve check (before starting a run)

Read the `social_trend_scout_enabled` valve (a `pipeline_settings` row, visible and editable on
the Social tab of `/admin/homepage-team`; migration 069 seeds it OFF), mirroring trend-scout's
`trend_scout_enabled` pattern. If off: exit without starting a run. Do not record anything.

## Step 1: Start + gate

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"social","runType":"social-trend-scout"}'   # → $RUN_ID

curl -s "$BASE_URL/api/team/gate?team=social&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` with any reason other than `run_in_progress` → post
`{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and stop. The gate enforces the social team's enable switch, daily budget, and run cap; this
routine shares them with the daily social-drafts run, so the social run cap must leave room for
both on Mondays (see the enablement runbook).

**`reason:"run_in_progress"` gets a same-day retry, not an immediate skip (ticket #3191).**
This routine fires once a week, so accepting that refusal costs the entire cycle: stuck run 251
held the social gate silently for hours and zeroed out a whole week of trend research. The gate
names the blocker (`blockingRun: {id, runType, idleMinutes}`), and the social team's staleness
threshold is 60 minutes, so a genuinely hung sibling stops blocking the gate within the hour on
its own. Instead of skipping:

```bash
for i in 1 2 3 4 5 6 7 8; do   # ~2h of re-checks, 15 min apart
  sleep 900
  GATE=$(curl -s "$BASE_URL/api/team/gate?team=social&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN")
  # ok:true → break and continue from Step 2
done
```

Post one `step` event when entering the wait (`phase:'gate-wait'`, naming the blocking run id and
its idleMinutes) so the stall window is visible on the dashboard. If the gate opens inside the
window, continue from Step 2 normally. Only if it is still `run_in_progress` after the full
window: post the skipped update with a summary naming the blocking run id, and stop.

## Step 2: Read state

1. `docs/store-team/mission-brief.md` (binding), `docs/store-team/social-video-strategy-DRAFT.md`
   (the format thesis and platform playbook), and
   `docs/store-team/social-video-viral-checklist.md` (a trend that cannot pass it is not worth
   proposing). The sourcing sensibilities of `docs/ads-policy.md` apply to lane selection.
2. The strategy brief (`GET /api/team/brief`) for the week's themes and Video Plan.
3. Prior still-`proposed` suggestions from earlier social-trend-scout runs (dedupe guard: never
   duplicate one).

## Step 3: Research the three lanes

Scan with WebSearch/WebFetch, honestly and within budget:

- **Format trends**: press, newsletter, and roundup coverage of what short-video formats are
  surging on TikTok, Reels, and Shorts (hook patterns, edit styles, series mechanics). Read
  coverage, never the apps themselves.
- **Sounds**: trending-audio coverage; every sound named gets an explicit lyrics-cleanliness
  verdict (`clean` / `flagged` / `unverified`) with an evidence URL. Flagged-lyrics audio is
  never used; trending formats and instrumentals are fine; `unverified` is recommended against.
- **Competitor/creator activity**: what sexual-wellness brands and educators are shipping, what
  is landing, and what earned strikes or takedowns (survival intelligence).

No explicit-content sourcing (education/product/wellness register only). One `step` event
(`phase:'research'`) with sources scanned per lane.

## Step 4: File the briefs (up to 4, plus 1 summary; hard cap 5 rows)

For each of the strongest findings the pipeline can honestly use, file one suggestion row
(`POST /api/team/suggestion`): `targetTeam:'video'` for format/production findings,
`targetTeam:'social'` for timing/caption/sound findings, kind `strategy`. Each body carries:

- The trend in plain words and why now.
- Evidence: real URLs actually resolved, with honest sourceQuality (`viewed-directly` /
  `coverage-only`). A trend with no checkable evidence does not get a brief.
- The lyrics verdict where a sound is involved.
- One concrete way a named formula (ten-second-fix, the-one-thing, translate-the-feeling,
  brand-tentpole) could ride it without bending the viral checklist or the register caps.

One `step` event (`phase:'proposals'`) listing what was filed.

## Step 5: Retro + finish

One `decision` event (`phase:'retro'`): trends considered and dropped (one line why), strike and
takedown intelligence worth flagging even without a brief. A discourse topic that belongs to the
blog lanes → name it for trend-scout's territory in the retro, never write it up. Log spend
(`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"social-trend-scout",...}`),
then finish:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<lanes scanned + briefs filed + drops>"}}'
```

## Appendix: Enablement runbook

Ships inert. To turn on, in order:

1. **Apply migration 069 in prod:** `npx tsx scripts/apply-migrations.ts --from 069` (seeds
   `social_trend_scout_enabled` OFF).
2. **Check the social run cap:** Mondays carry the daily social-drafts run plus this routine, so
   the social team's run cap must be at least 2 with retry headroom preferred at 3 (the gate's
   run cap counts per team per day, not per run type; the strategy and content teams hit this
   exact failure mode before their caps were raised).
3. **Flip `social_trend_scout_enabled`** on the Social tab of `/admin/homepage-team`.
4. **One supervised manual run:** fire the routine by hand; verify the run row +
   `phase:'research'` / `phase:'proposals'` events on `/admin/homepage-team?team=social` and the
   suggestion rows on the dashboard.
5. **Create the cloud trigger** with the RemoteTrigger tool (routine 20 in
   `docs/store-team/routine-schedule.md`): Monday `0 17 * * 1` UTC, fresh session per fire,
   completion notifications off, prompt per the common skeleton in the schedule manifest, and
   record the `trig_` id in the manifest.
6. **Next Tuesday**, confirm the video-producer run's context read picked up any approved briefs
   (its retro should name them).

**Kill-switch drill:** `social_trend_scout_enabled` off = Step 0 exits before any run row. The
social team's enable switch off = Step 1 gate refuses. Both are honest no-ops.
