# Routine: Weekly SEO Curation (seo-curator)

The playbook for the weekly keyword-bank and editorial-queue routine. Entry agent: `seo-curator`.
Four jobs per run: triage the gray-zone pending keywords (cap 250), keep the cluster catalog
consolidated (merge maps are PROPOSED as suggestions, never executed here), review the Saturday
trend-scout's pending `trendTopicBrief` proposals (adopt/skip/expire), and plan the coming
week's `seoContentBrief` queue (up to 7) that the daily content-writer consumes.

Runs on the **Max subscription**. Cadence: weekly, **Sunday 19:00 UTC** (`0 19 * * 0`), before Monday's
strategy run reads the results. Moved off 16:00 on 2026-07-29 because the content team's
in-progress lock runs up to ~200 minutes from its 15:00 start and was swallowing the 16:00 slot. Never call the site's Anthropic-keyed endpoints; the site is for
data reads and spend logging only. Sanity reads/writes go through the Sanity MCP tools.

Auth on every `/api/team/*` call: header `x-team-secret: $TEAM_TOKEN` (falls back to
`$HOMEPAGE_TEAM_TOKEN`, then `$CRON_SECRET`). `BASE_URL` = deployed origin.

## Step 0: Valve check (before starting a run)

Read the `seo_curation_enabled` valve (Sanity is not the source; it is a `pipeline_settings` row,
visible on `/admin/homepage-team`). Simplest check from a routine: `GET /api/team/gate?team=content`
returns team state; the valve itself is enforced here in the playbook, mirroring agent-editor's
`suggestion_apply_enabled` pattern:

```bash
# The dashboard exposes valves; routines read them via the settings the gate returns
# or, when in the repo, via: npx tsx -e "…getValve('seo_curation_enabled')…"
```

If off: exit without starting a run. Do not record anything. (Ships OFF; migration 055 seeds it.)

## Step 1: Start + gate

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"content","runType":"seo-curation"}'   # → $RUN_ID

curl -s "$BASE_URL/api/team/gate?team=content&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` → post `{"op":"update","id":$RUN_ID,"update":{"status":"skipped","finished":true,"summary":"gate refused: <reason>"}}`
and stop. The gate enforces `content_team_enabled`, `content_team_daily_cents`, and
`content_team_max_runs`; this routine plus the daily writer share the content team's budget.

## Step 2: Read state (GROQ, read-only)

1. Pending gray zone: `*[_type == "seoKeyword" && status == "pending" && flagged != true && relevanceScore >= 0.50 && relevanceScore < 0.85]{_id, term, kind, intent, relevanceScore, volume, "cluster": cluster->slug.current}`
2. Active clusters with counts: `*[_type == "seoCluster" && status == "active"]{_id, title, "slug": slug.current, pillarTerm, "approved": count(*[_type=="seoKeyword" && references(^._id) && status=="approved"]), "questions": count(*[_type=="seoKeyword" && references(^._id) && status=="approved" && kind=="question"]), "avgVolume": math::avg(*[_type=="seoKeyword" && references(^._id) && status=="approved"].volume)}`
3. Coverage: covered clusters = `*[_type == "seoContentBrief" && status == "published"].cluster._ref`; queued briefs = `*[_type == "seoContentBrief" && status == "queued"]{_id, category, "cluster": cluster->slug.current}`
4. Bank staleness: `*[_type == "seoKeyword"] | order(firstSeenAt desc)[0].firstSeenAt`
5. Published slugs (for pre-checks): `*[_type == "blogPost"].slug.current`
6. The strategy brief (`GET /api/team/brief`) and calendar (`GET /api/team/calendar`) for the Monday theme sync.
7. `docs/store-team/content-plan.md` for the category rhythm and the authority-collection list (§5).
8. Pending trend proposals from Saturday's trend-scout run (routine 16):
   `*[_type == "trendTopicBrief" && status == "pending"]{_id, topic, angle, evidence, suggestedCategory, suggestedTerms, expiresAt}`

## Step 3: Gray-zone triage (cap 250 decisions)

For each pending term in the 0.50-0.85 band, judge: would a real xdipx shopper search this, and can
the catalog honestly answer it?

- **Approve** → patch `{status:'approved', lastResearchedAt: now}`.
- **Reject** (off-vertical, competitor-adjacent, medical/efficacy framing) → patch
  `{status:'rejected'}`. The `isPolicyTermRisk()` patterns in `app/lib/seo-research.server.ts` are
  the floor, not the ceiling; judgment can reject what the regex missed.
- **Unsure** → leave pending. Never touch `flagged == true`.

Batch patches in Sanity transactions of ≤100. One `step` event (`phase:'triage'`) with counts and
3 example terms per bucket.

## Step 4: Cluster hygiene (propose only)

Identify active singletons (approved count ≤ 1) and near-duplicate titles/pillar terms. Build a
merge map: `[{"canonical":"<slug>","absorb":["<slug>",...],"newTitle":"<optional>"}]`. Canonical =
the cluster with the most approved keywords. File it as ONE suggestion row:

```bash
curl -s -X POST "$BASE_URL/api/team/suggestion" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"create","team":"content","category":"other","kind":"config","suggestion":"Cluster merge map (run scripts/merge-seo-clusters.ts --map after approval): <the JSON>","cxRisk":"low"}'
```

Never repoint refs or archive clusters yourself. If last week's map is still `proposed`, do not
file a duplicate; note it in the report instead. One `step` event (`phase:'clusters'`).

## Step 4b: Trend review (adopt / skip / expire, before planning)

First expire: any pending `trendTopicBrief` past its `expiresAt` → patch `status:'expired'`.
Judge the rest on one question: can the catalog honestly serve this topic?

- **Adopt, cluster path (preferred):** the trend maps to an eligible cluster → boost that
  cluster's priority for Step 5, let the trend shape the brief's working title and `targetQuery`,
  and patch the trend `{status:'adopted', adoptedBrief: <ref to the seoContentBrief>}`.
- **Adopt, clusterless path (max 1-2 per week, INSIDE the 7-brief cap):** no cluster fits but the
  topic is strong and evidence-backed → mint a trend-sourced `seoContentBrief` without
  cluster/primaryKeyword refs (the schema allows it), category from `suggestedCategory`, and note
  the trend in `createdBy`. Patch the trend `adopted` + `adoptedBrief` as above.
- **Skip:** everything else → patch `{status:'skipped', skipReason:'<one line>'}`.

Trend `suggestedTerms` missing from the keyword bank go into the Step 6 report (they feed the
`keyword_research_enabled` conversation), never directly into `seoKeyword` docs. One `step` event
(`phase:'trend-review'`) with adopted/skipped/expired counts and per-id outcomes.

## Step 5: Plan the week's briefs (cap 7)

Slots, from `docs/store-team/content-plan.md`: Mon guide (theme-synced to the active
`marketing_calendar` theme when one applies), Tue comparison, Wed guide, Thu care, Fri guide,
Sat wellness-basics, Sun comparison.

Eligible clusters: `status == 'active'`, approved count ≥ 3, not covered (no published brief
references it), no queued brief already. Category inference from the cluster's keyword shapes
(vs/versus → comparisons; clean/store/care → care; body-safe/material/basics → wellness-basics;
else guides).

Priority per cluster: `2 × (questions/approved) + ln(approved) + 3 if it maps to a content-plan §5
authority collection + (avgVolume/100 when volume exists)`. Prefer question-shaped beginner
clusters and comparisons.

For each filled slot, create idempotently (`_id: seoContentBrief-${slug}`, `createIfNotExists`):
`title` (answer-shaped working title), `slug` (pre-checked against blogPost AND seoContentBrief
slugs), `category`, `cluster` ref, `targetQuery` (the cluster's best question or pillar term),
`primaryKeyword` ref (highest relevance×volume approved term), `secondaryKeywords` (3-5),
`questionKeywords` (every approved `kind=='question'` term, max 8), `embedHints` (only handles
verified in stock via the Storefront data, or leave empty), `internalLinks` (relevant
`/collections/*` paths), `priority`, `status:'queued'`, `plannedFor` (the slot's date),
`createdBy: 'seo-curator run <RUN_ID>'`.

A slot with no eligible cluster stays unfilled (the writer falls back to the static content-plan
backlog); say so in the event. One `step` event (`phase:'planning'`) listing slugs + categories.

## Step 6: Report + finish

Compute and post the weekly report as ONE **run event** (`POST /api/team/event`), not a suggestion
row. A report has nothing to execute, so on the bus it can never reach a terminal state and just
ages in `approved`: 22 of the 52 stuck `process` rows were exactly this. Events are the retro
channel and are free. (Step 7 below already said this; line 132 used to say the opposite.)

- Triage: approved / rejected / left pending counts.
- Trend review: adopted / skipped / expired counts, plus trend `suggestedTerms` missing from the
  keyword bank.
- Clusters: covered / total active; merge map proposed or pending approval.
- Queue depth after planning (**flag if < 7**).
- Bank staleness: days since newest `firstSeenAt`; note if `keyword_research_enabled` is off and
  the bank is > 60 days stale.
- Enrichment coverage: share of published products whose `productPage` carries Emma-enriched copy
  (non-empty full story / emma fields), plus a 10-product spot-check for near-identical wholesale
  descriptions. This is the store's thin-content early-warning number.

Log spend (`POST /api/homepage-team/spend {"kind":"tokens","source":"agent-sdk","feature":"content-seo-curation",...}`),
then finish:

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"update","id":'$RUN_ID',"update":{"finished":true,"status":"succeeded","summary":"<triage counts + briefs created + coverage + staleness>"}}'
```

## Appendix: Enablement runbook

Ships inert. To turn on, in order:

1. **Apply migration 055 in prod:** `npx tsx scripts/apply-migrations.ts --from 055` (seeds
   `seo_curation_enabled` plus the keyword-research and reviews valves).
2. **Drain the backlog first:** review `npx tsx scripts/seo-bank-triage.ts` (dry run), then
   `--apply`. The curator's weekly cap of 250 is sized for steady-state, not the initial 1,700.
3. **Flip `seo_curation_enabled`** on the Content tab of `/admin/homepage-team`.
4. **One supervised manual run:** fire the trigger by hand; verify the run row + events on
   `/admin/homepage-team?team=content`, the briefs in Sanity, and the weekly report event (posted as a run event, not a suggestion row: a report has no executor and can never reach a terminal state, so filing it on the bus just ages there — see improvement-loop.md).
5. **Confirm the schedule** (routine #10 in `docs/store-team/routine-schedule.md`).

**Kill-switch drill:** `seo_curation_enabled` off = Step 0 exits before any run row.
`content_team_enabled` off = Step 1 gate refuses. Both are honest no-ops.
