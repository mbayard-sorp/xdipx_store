# Routine: Video Render (weekly, Atlas Cloud)

Entry agent: `video-producer` (`.claude/agents/video-producer.md`), model Sonnet: the payload is
copied verbatim and byte-checked, nothing here is creative. Weekly, Thursday 13:00 UTC
(`0 13 * * 4`). RENDERS OWNER-APPROVED CLIPS AND WRITES NOTHING: it claims up to 3 approved
product-talk clips from the ledger, re-checks that each product can ship, assembles each payload
from the stored script, asserts the words match what the owner approved, and enqueues one job per
clip. The durable `video_jobs` pipeline does the rendering; the owner approves the first frame and
the final cut in `/admin/video-studio`. **This routine never approves either, never posts, and
never renders a product that cannot ship.**

Money model: reasoning bills to the Max subscription; each enqueued job is METERED REAL MONEY on
Atlas Cloud (Wavespeed as mirror, called only when Atlas errors or its balance is exhausted),
logged to `api_token_log` under `video-*`, gated by `video_team_daily_cents` and the per-video
ceiling `video_team_max_cost_cents`. The enqueue API enforces both server-side. RunPod is retired
and fal is images only; this routine never enqueues on either.

## Step 0: Start

```bash
curl -s -X POST "$BASE_URL/api/team/run" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"start","team":"video","runType":"video-render"}'
# -> {"id": $RUN_ID}
```

## Step 1: Gate

```bash
curl -s "$BASE_URL/api/team/gate?team=video&excludeRun=$RUN_ID" -H "x-team-secret: $TEAM_TOKEN"
```

`ok:false` -> skipped event, finish honestly, exit. Never work around a closed gate.

**Enablement and ceilings:** the episode API must be live and `video_program_enabled` must be
`'true'` (`episode-claim` answers 403 `video_program_disabled` otherwise). Read
`POST /api/team/video-job {"op":"config"}` -> `enabled`, `dailyCents`, `maxCostCents`, and
`models`. Any of these missing or off -> skip honestly with the reason. Never enqueue from a script
that did not come from an approved ledger row.

**Tier gate (until Phase 2):** the Atlas tier ids (`infinitetalk-atlas`, `grok-atlas`,
`wan27-spicy-atlas`) land with the Phase 2 provider seam. If **none of the three** is in
`config.models`, **stop before claiming**: file the owner blocker below, post a `skipped` event with
reason `atlas_tier_not_live`, finish `status:'skipped'`, exit. (If some are present, a clip whose
routed tier is missing is released at Step 4 with reason `tier_not_live`.) Never enqueue on a
RunPod tier (`wan22-*`) or a fal tier as a substitute, and never omit `modelTier` (the route fills a
default tier when it is absent).

```json
{"op":"file","dedupeKey":"video:atlas-tier-not-live",
 "title":"Atlas video tiers not eligible on main","category":"merge",
 "sourceRef":"<Phase 2 provider-seam PR url>",
 "unblocks":"Thursday video render of owner-approved clips on Atlas Cloud",
 "evidence":"config.models on run <RUN_ID> lists <ids>; none of infinitetalk-atlas, grok-atlas, wan27-spicy-atlas"}
```

Category `merge` derives a `pr_merged` probe from `sourceRef`, so the row clears itself when the PR
merges. Until that PR exists, drop `sourceRef` and send
`"overrideNoProbeReason":"Phase 2 provider-seam PR not yet opened"` instead.

## Step 2: Claim

Claim up to **3** approved clips, oldest first:
`POST /api/team/video-episode {"op":"episode-claim","runId":$RUN_ID}` -> `{episode}`, once per clip.
The server serves the oldest `approved` non-reserve row whose `plannedSlotAt` is now, past, or null,
and only after those are exhausted an approved reserve row; each claim stamps the row `rendering`.
404 `empty_episode_queue` on the first claim -> **Step 2a**. A 404 after one or more claims just
means the week's queue is done.

Alternates (filed as `isReserve:true` by the Writers Room) are rendered **only** when a slot's
primary fails the Step 3 stock check, never to fill spare capacity.

**`plannedSlotAt` does two jobs today, and they conflict.** The claim serves only rows with
`plannedSlotAt` now or past, and the fanout (`fanOutVideoToSocialDrafts` in
`app/lib/video-pipeline.server.ts`) uses the same value as the Social Studio draft's `scheduledAt`.
Interim rule: the Writers Room sets `plannedSlotAt` to the render Thursday 13:00 UTC and carries the
intended post date in `concept`; the owner sets the real post date in Social Studio. Follow-up
ticket (file once as `kind:'code'`, `dedupeKey:'video:post-slot-at'`): "Add a `postSlotAt` column
to `video_episodes` (additive migration), accepted on `episode-propose`, used by the fanout as
`scheduledAt`, leaving `plannedSlotAt` as the render slot only. DONE WHEN fanout reads `postSlotAt`
on main."

### Step 2a: Empty queue

Post a `skipped` event with reason `empty_episode_queue`; file an owner blocker
(`{"op":"file","dedupeKey":"video:empty-episode-queue","category":"approval",
"title":"No approved video clips to render","whereToGo":"/admin/video-studio/scripts",...}`); finish
`status:'skipped'`; exit. **Never invent a script. Never re-render a posted clip.**

## Step 3: Stock re-check at claim

For every claimed clip, before any payload is built, confirm the product can ship now. The product
handle is on the row (`productPlacements[0].handle`; `productHandle` once the PLANNED Phase 2 field
lands).

1. **Shopify availability, via the store's own product read.** `GET https://xdipx.com/products/<handle>`.
   A 404 means the product is unpublished or archived in Shopify. On a 200, read the Product JSON-LD
   `offers`. Offers are **per variant** (each `InStock` only when that variant is
   `availableForSale` with `quantityAvailable > 0`, from Shopify via `app/lib/shopify.server.ts`),
   so the product passes if **any** Offer is `https://schema.org/InStock` and fails if none is. A 5xx
   is not an answer: treat the product as unverified and fail it. The PDP sits behind the storefront
   edge cache (`s-maxage=60`, stale-while-revalidate up to 600 s, `app/lib/cache-headers.ts`), so
   the read can be up to about ten minutes stale; note that in the retro.
2. **Nalpac stock, as the shortlist recorded it.** When a shortlist exists
   (`metricsJson.videoShortlist`), find the handle and read its `stockCheckedAt`; record that age in
   the retro. A shortlist that exists and omits the handle fails the clip. When no shortlist exists,
   mark the clip `nalpac_unverified` in the retro and proceed on the Shopify read alone. This routine
   cannot read the feed live.

Follow-up ticket (file once as `kind:'code'`, `dedupeKey:'video:stock-check-op'`): "Add
`POST /api/team/video-job {op:'stock-check', handle}` returning `{availableForSale, totalInventory}`
read through `app/lib/shopify.server.ts`, team-token auth, read-only, no cache, so the render
routine checks stock without scraping the PDP's cached JSON-LD. DONE WHEN the op is on main and
listed in the route header."

**A product that fails either check is not rendered.** Release its claim
(`episode-release`, reason `out_of_stock` or `stock_unverified`) and claim the batch alternate
covering the same format:

- **PLANNED (Phase 2):** a targeted claim of the alternate linked to that slot (the `alternate`
  field on propose). Use it once the route header lists it.
- **Until then**, with the plain claim: do not release the failed clip yet, because a released row
  returns to `approved` and the oldest-first claim would serve it straight back. Hold it, keep
  claiming, and render the first returned reserve row that shares the failed clip's `batchId` and
  format (read from `concept` until `format` lands) and passes its own stock check. Hold every other
  returned row unrendered. Stop after 6 claim calls in total. At the end of Step 4, release every
  held row that was not enqueued, each with its reason. An out-of-stock primary also goes on the
  report as an owner decision (reject it on `/admin/video-studio/scripts`), because it will be
  served again next Thursday. **Caveat:** reserves are served only after every claimable primary,
  so if older approved rows sit in the queue the 6-call cap can run out before any reserve comes
  back. Then the slot goes unrendered and the report says so honestly; never raise the cap to chase
  it.

Follow-up ticket (file once as `kind:'code'`, `dedupeKey:'video:claim-by-episode-id'`):
"`episode-claim` accepts an explicit `episodeId` (the server still requires the row to be
`approved` and still honors `video_program_enabled`), so the render routine can claim a slot's
alternate chosen from `episode-list {status:'approved'}` by `batchId` and `isReserve`. DONE WHEN the
op accepts `episodeId` on main and the route header documents it."

No alternate passes -> the slot goes unrendered this week, and the report says which and why.

## Step 4: Assemble, assert, enqueue

One job per clip: `POST /api/team/video-job {"op":"enqueue", ...}`. The `presenter` value is derived
from the approved row: `friend:<castSlugs[0]>` for a cast speaker, `emma` when `castSlugs[0]` is `emma`;
the writers room stores the speaker at `castSlugs[0]` and the listener, if any, at `castSlugs[1]`.

```json
{"op":"enqueue","episodeId":<id>,"runId":<RUN_ID>,
 "productHandle":"<the checked handle>","formula":"<the row's formula>",
 "presenter":"friend:<speaker slug>|emma","scriptJson":{ "...": "the approved row's script, verbatim" },
 "modelTier":"<see below>","durationSeconds":<n>,"targetPlatforms":["instagram"],
 "aiDisclosure":true}
```

- **Verbatim.** `scriptJson` is copied from the approved row. **Assert the spoken text is
  byte-identical to the approved row before sending.** A mismatch is a refusal, not a fix: file a
  blocker naming both strings, release the claim, and move to the next clip. The server runs the same
  comparison and answers 409 (403 if the row is not approved); hitting either means this assertion
  was skipped, which is itself a finding.
- **Tier.** InfiniteTalk 720p (`infinitetalk-atlas`) is the default for every talking clip. Grok
  Imagine (`grok-atlas`) only for a clip under 15 s, and only after one recorded A/B against
  InfiniteTalk on the same first frame. Wan 2.7 Spicy (`wan27-spicy-atlas`) only for the silent
  3 to 5 s inserts. All three ids are Phase 2; Step 1's tier gate stops the run until they exist.
- **Refusals are valid outcomes.** A 403 `gated` or a per-video-ceiling refusal: report it, never
  downgrade quality to squeeze under, never split a clip across jobs. Release the claim.

**If you claimed a clip and are not going to enqueue it, hand the claim back.** Only `approved`
rows are claimable, so a refusal that just exits strands the row in `rendering`:

```bash
curl -s -X POST "$BASE_URL/api/team/video-episode" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"episode-release","episodeId":'$EPISODE_ID',"reason":"<out_of_stock|gated|over_ceiling|script_mismatch|...>"}'
```

Releasing is not approving spend; it restores the approval the owner already gave. A run that dies
before releasing is caught by the stale-claim reaper after two hours, but that is a backstop. Once a
job exists the release is refused with a 409 and the outcome belongs to the job.

## Step 5: The owner's parks

The pipeline takes it from here (`/cron/video-job-poller`). This routine approves nothing:

- **First frame:** parks at `awaiting_frame_approval` while `video_frame_review` is on (LIVE). The
  owner judges it on the four-panel sheet (`video-realism-recipe.md` §8).
- **Final cut:** parks at `awaiting_render_approval` while `video_render_review` is on. **PLANNED**
  until the Phase 2 owner-gates PR merges; until then the finished cut waits in
  `/admin/video-studio` for the owner as before.

Approval of the cut fans out to Social Studio, where the owner posts by hand. X never receives a
video row.

## Step 6: Report, retro, finish

Post `phase:'retro'` events: per clip, the episode id, product, stock verdict with the shortlist's
`stockCheckedAt` age, job id and estimated cost; the week's cumulative cost and cost per clip;
re-rolls (frame retries from `POST /api/team/video-job {"op":"list"}`); filter blocks by provider;
alternates used and why; claims released and why. Never fabricate engagement.

**Close the run on the LAST retro event, in the same call, via `finish`, never as a separate
`/api/team/run` call afterward (ticket #8027).** Writers-room runs #633/#654 and video-render run
#666 each posted a full retro trail and died before a separate finish call, and sat idle until the
reaper marked them `'auto-expired'`.

```bash
curl -s -X POST "$BASE_URL/api/team/event" \
  -H "x-team-secret: $TEAM_TOKEN" -H "content-type: application/json" \
  -d '{"op":"record","runId":'$RUN_ID',"phase":"retro",
       "summary":"3 clips enqueued on infinitetalk-atlas, est $X; 1 alternate used (out_of_stock)",
       "finish":{"status":"succeeded","summary":"..."}}'
```

Do not follow it with a separate `POST /api/team/run {op:'update', finished:true, ...}`; that
reintroduces the gap this fixes.

## Enablement runbook (owner)

1. The Writers Room v2 playbook live and at least one approved clip in the ledger.
2. The Phase 2 provider seam merged (owner merge): Atlas and Wavespeed providers and the three Atlas
   tier ids. Until then this routine stops at the Step 1 tier gate and files the blocker.
3. `video_program_enabled` on, `video_team_max_runs` at 3, on the Video tab of
   `/admin/homepage-team`.
4. Edit `trig_01T1rn2K5jysEHxrvzzYL5Vd` to `0 13 * * 4`, model Sonnet, prompt pointing at THIS
   playbook, entry agent `video-producer`, no connectors, git source attached and verified; see
   `routine-schedule.md` §Re-pointing the video triggers.
