# Routine: Weekly Trend Scout (trend-scout)

The playbook for the weekly community-discourse research routine. Entry agent: `trend-scout`.
One job per run: scan what people are actually asking and arguing about this month across four
lanes (Reddit communities, sex-ed TikTok trend coverage, new research and press, product-category
buzz) and propose 3-5 `trendTopicBrief` docs in Sanity. The Sunday SEO-curation run (routine 10)
judges them: adopt into the `seoContentBrief` queue, skip with a reason, or expire when stale.

RESEARCH-ONLY: this routine never writes `blogPost`, `seoContentBrief`, or keyword docs, never
publishes, and generates no images. Runs on the **Max subscription**. Recommended cadence: weekly,
Saturday 16:00 UTC (the day before Sunday planning). Never call the site's Anthropic-keyed
endpoints; the site is for data reads, gating, run/event recording, and spend logging only. Sanity
reads/writes go through the Sanity MCP tools.

Auth on every `/api/team/*` call: header `x-team-secret: $TEAM_TOKEN` (falls back to
`$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Valve check (before starting a run)

Read the `trend_scout_enabled` valve (a `pipeline_settings` row, visible and editable on the
Content tab of `/admin/homepage-team`; migration 068 seeds it OFF), mirroring seo-curator's
`seo_curation_enabled` pattern. If off: exit without starting a run. Do not record anything.

## Step 1: Start + gate

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"content","runType":"trend-scout"}'   # → $RUN_ID

curl -s "$BASE_URL/api/team/gate?team=content&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` → post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and stop. The gate enforces `content_team_enabled`, `content_team_daily_cents`, and
`content_team_max_runs`; this routine, the daily writer, and Sunday curation share the content
team's budget.

## Step 2: Read state

1. `docs/store-team/mission-brief.md` (binding) and `docs/store-team/content-plan.md` (§2 slot
   rhythm, §5 authority collections) for topic fit; the sourcing sensibilities of
   `docs/ads-policy.md` apply to lane selection.
2. The strategy brief (`GET /api/team/brief`) for the week's themes.
3. Existing briefs (dedupe + backlog guard):

```groq
*[_type == "trendTopicBrief"]{_id, topic, status, expiresAt}
```

   **More than 10 `pending` → skip proposing entirely**, note it in the retro, finish the run
   honestly. Do not stack on an unread pile.
4. Recent `blogPost` slugs and queued `seoContentBrief` titles, so you never propose what is
   already written or already planned.

## Step 3: Research the four lanes

Scan with WebSearch/WebFetch, honestly and within budget:

- **Reddit**: sexual-wellness and toy-recommendation communities; recurring questions, new
  complaints, product debates.
- **TikTok trend coverage**: press/roundup coverage of sex-ed TikTok waves (read coverage, never
  the app itself).
- **Research + press**: newly published studies and major-outlet wellness journalism.
- **Product buzz**: category launches, viral products, materials debates.

No explicit-content sourcing (education/product/wellness discourse only). One `step` event
(`phase:'research'`) with sources scanned per lane.

## Step 4: Write the briefs (3-5, hard cap 5)

For each of the strongest topics the catalog can honestly serve, create idempotently
(`_id: trendTopicBrief-<topic-slug>`, `createIfNotExists`; skip topics that already have a brief
in any status):

- `topic` (the question in plain words); `angle` (why now + what the honest answer looks like;
  flag health-adjacent topics so the writer plans the clinician line).
- `evidence[]` (1-3 entries): real URLs you actually resolved, one-line `sourceNote`, honest
  `sourceQuality` (`viewed-directly` when you read the source itself, `coverage-only` otherwise).
  A trend with no checkable evidence does not get a brief.
- `suggestedCategory` (content-plan §2 slot fit); `suggestedTerms[]` (phrasings people use; the
  curator judges keyword-bank fit, you never write keyword docs).
- `status:'pending'`; `expiresAt` = today + 14 days; `createdBy` = `trend-scout run $RUN_ID`.

One `step` event (`phase:'proposals'`) listing brief ids + topics.

## Step 5: Retro + finish

One `decision` event (`phase:'retro'`): topics considered and dropped (one line why), backlog
state. Real lessons → suggestion rows (`POST /api/team/suggestion`, kind `process`; a trend that
needs new products → `targetTeam:'product'`, kind `strategy`). Log spend
(`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"content-trend-scout",...}`),
then finish:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<lanes scanned + briefs written + backlog state>"}}'
```

## Appendix: Enablement runbook

Ships inert. To turn on, in order:

1. **Apply migration 068 in prod:** `npx tsx scripts/apply-migrations.ts --from 068` (seeds
   `trend_scout_enabled` OFF and versions the content budget at 500 cents / 3 runs).
2. **Deploy the Sanity schema** so `trendTopicBrief` exists in Studio.
3. **Flip `trend_scout_enabled`** on the Content tab of `/admin/homepage-team`.
4. **One supervised manual run:** fire the trigger by hand; verify the run row +
   `phase:'research'` / `phase:'proposals'` events on `/admin/homepage-team?team=content` and the
   pending briefs in Sanity Studio.
5. **Create the cloud trigger** (routine 16 in `docs/store-team/routine-schedule.md`): Saturday
   `0 16 * * 6` UTC, and record the `trig_` id in the manifest.
6. **Next Sunday**, confirm the curation run's `phase:'trend-review'` event shows the briefs
   judged (adopted/skipped/expired).

**Kill-switch drill:** `trend_scout_enabled` off = Step 0 exits before any run row.
`content_team_enabled` off = Step 1 gate refuses. Both are honest no-ops.
