# ADR-016: Video pipeline v2, Atlas Cloud as the video provider

Date: 2026-09-23
Status: Accepted on merge (owner merge; cost-adjacent, touches protected `app/lib/team-keys.ts`)
Author: rr7-engineer (plan unit "Phase 2a: provider seam", video content strategy 2026-09-23)
Supersedes: the video half of ADR-010 (video stays on fal) and ADR-014's assumption
that the audio-driven talking tier is `wan22-s2v` on the RunPod worker.

## Context

Video has had three homes in five weeks: fal (until 2026-08-26), the owned RunPod
worker (Wan 2.2 14B i2v/t2v, with s2v never deployed), and now nothing that ships.
Zero videos have ever been posted. The RunPod worker needs a GPU image build, a
network volume, a pod-watch cron, idle probes, cancel paths and burn accounting,
and its audio-driven mode was never deployed, so the program has had no talking
tier at all since fal was retired.

ADR-010 kept video on fal because Atlas had no audio-driven (OmniHuman-class)
model. That blocker is gone: Atlas now serves `atlascloud/infinitetalk`.

## Evidence: the Atlas video bake-off, 2026-09-23

Full table and grades in `docs/media-model-routing.md`, section "Atlas video
bake-off 2026-09-23". Request and response bodies were captured live and are the
adapter's source (not the docs pages). Two cast members, one in-stock product
(Le Wand Mini Micro), about $5.65 total.

| Tier | Atlas model id | Result | Price used |
|---|---|---|---|
| InfiniteTalk 720p (talking, default) | `atlascloud/infinitetalk` | Pass x2. Cast voice kept, hand and product locked. 203 to 237 s wall per 10 s | $0.06/s upper bound (list $0.03/s base, 720p multiplier unpublished; one response read $0.60 for ~10 s) |
| Grok Imagine 1.5 i2v (talking, fallback) | `xai/grok-imagine-video-v1.5/image-to-video` | Pass x2, best motion realism. Speaks in xAI's voice, not the cast's. No dialogue field | $0.141/s (data.price $1.41 per 10 s) |
| Wan 2.7 i2v (silent insert) | `alibaba/wan-2.7/image-to-video` | Maya A-, Sofia C (scale break) | $0.10/s (data.price $0.50 per 5 s) |
| Wan 2.2 Turbo i2v (draft) | `atlascloud/wan-2.2-turbo/image-to-video` | B- (off-brief laugh, mild drift) | $0.02/s list |
| Wan 2.2/2.7 Spicy | several | 400 `not found` on this key | n/a |

No clip was content-blocked. Protocol facts the adapter relies on: one submit
endpoint for every model (`POST /api/v1/model/generateVideo`, flat `{model, ...}`),
one poll endpoint (`GET /api/v1/model/prediction/{id}`), `pending` can follow
`processing`, `data.price` is intermittent, outputs are aliyuncs URLs that expire
(Seedream stills were 24 h signed URLs, not the 14 days `atlas.server.ts` claimed),
inputs can be uploaded with `POST /api/v1/model/uploadMedia`, and Cloudflare 403s a
default Python User-Agent.

## Decision

1. **Atlas Cloud is the video provider.** Four tiers, all `provider: 'atlascloud'`
   in `VIDEO_MODELS`: `italk-atlas` (default talking), `grok-atlas`
   (fallback talking, owner A/B only), `wan27-atlas` (silent insert),
   `wan22turbo-atlas` (draft). Matching cost keys in `model-pricing.server.ts`.
2. **One seam, no provider branches in the pipeline.** `advanceClip`,
   `advanceClipMultiScene` and `advanceClipAvatar` call
   `submitVideoWithMirror` and `providerForHandle` from
   `app/lib/media-providers/registry.server.ts`. A new provider is an adapter
   file plus a registry line; the pipeline does not change.
3. **The handle shape does not change.** Every adapter returns the existing
   `{requestId, statusUrl, responseUrl}` stored in `video_jobs.providerRequestIds`,
   so there is no migration. Atlas and Wavespeed set statusUrl = responseUrl =
   the prediction URL, built from the id (never taken from the response, since
   the poller sends the bearer key to it). **Tier ids are at most 16 chars**:
   `video_jobs.model_tier` and `video_episodes.model_tier` are `varchar(16)`, so
   the InfiniteTalk tier is `italk-atlas`, not `infinitetalk-atlas` (18 chars,
   which would have failed every enqueue in Postgres after the ceiling checks).
   The column is not widened; a test asserts every `VideoModelId` fits.
4. **Download and re-host in the same tick.** When a poll sees COMPLETED, the
   pipeline fetches the result, downloads the mp4 and `blobPut`s it before the
   tick ends. Nothing stores a provider URL. A transient failure in that step
   does not burn the paid render: the job heartbeats and waits, counting
   attempts in a `download_attempts` bookkeeping key on `providerRequestIds`
   (the `assembly_attempts` precedent), and fails only on the third failed
   attempt. The key is cleared on success. Avatar parts are all re-hosted
   before any asset row is written, so a retry cannot duplicate part assets.
5. **Audio-driven tiers keep the ElevenLabs step.** The cast member's voice is
   synthesized as before, each speech part is parked on Blob, and the Blob URL
   is handed to the provider with the frame's Blob URL. Atlas falls back to its
   own `uploadMedia` once if a direct URL is refused.
6. **Content blocks** route through `classifyAtlasBlock` / `recordAtlasBlock`
   (shared with the still-image path). A failed prediction is recorded with a
   synthetic 500, so a GPU fault is not counted as a refusal while a message
   with content wording still is.

7. **The writers pick the production mode** (owner ruling 2026-09-23: "I want
   the voices to be consistent"). The pitch carries `mode: 'talking' |
   'voiceover'` (default `talking`). With no tier named, talking renders on
   `italk-atlas` and voiceover on `wan27-atlas` (silent render, the cast
   member's ElevenLabs voice overdubbed at the lipsync stage). A named tier
   wins, but talking on a silent tier or voiceover on an audio-driven tier is a
   400 naming the mismatch, and an enqueue carrying an `episodeId` is checked
   against the approved pitch's mode. A voiceover resolves the presenter's
   voice at enqueue like a talking tier, so a friend with no `voiceId` is
   refused before spend. `grok-atlas` stays eligible but `ownerOnly`: the team
   API refuses it and the config op flags it, so no routine routes it; the
   studio composer may.

## The mirror rule

Wavespeed (`app/lib/media-providers/wavespeed-video.server.ts`, key
`WAVESPEED_API_KEY`) is a mirror, not a second primary:

- used only when Atlas is unconfigured, or an Atlas submit returned an error
  envelope that proves the render was not accepted (`isMirrorableSubmitError`):
  the error is an `AtlasVideoSubmitError` (a response was received and
  classified), it is not a content refusal, and its status is not 502, 504 or
  524 (a gateway that may have lost an accepted render). Balance exhaustion,
  429, other 5xx, unknown model and rejected input qualify. Everything else is
  rethrown and never mirrored: a network error after the POST (the render may be
  running), an input read or `uploadMedia` failure, a body validation error, a
  200 with no prediction id;
- only for tiers with a like-for-like endpoint: `italk-atlas` ->
  `wavespeed-ai/infinitetalk`, `wan22turbo-atlas` -> `wavespeed-ai/wan-2.2/i2v-720p`.
  `grok-atlas` and `wan27-atlas` have no mirror and park on an Atlas outage
  rather than silently downgrade;
- never load-balanced: a healthy Atlas takes every render;
- a content refusal is never retried on the mirror (it is a verdict on the
  content, not the provider);
- a mirror-issued handle is polled on the mirror (`ownsHandle`, by poll host).

**Residual double-spend bound.** A duplicate needs Atlas to return a non-gateway
error envelope for a render it nonetheless ran. Then there is at most one
duplicate per submit, and only on a mirrored tier (Grok is not mirrored): at
most one InfiniteTalk part, capped at `maxRenderSeconds` 30 x $0.06/s = $1.80,
about $0.60 for a typical 10 s part, or $0.10 for Wan 2.2 Turbo. (The $1.41
figure sometimes quoted is one 10 s Grok clip; Grok never reaches the mirror.)

`tierIneligibility` returns `provider_not_configured` for an Atlas tier when
neither Atlas nor (for a mirrored tier) Wavespeed is keyed.

**Wavespeed is unverified.** No call has been made. Base URL, paths, model ids,
field names and status vocabulary are from its public docs and the fact that
Atlas's envelope is a near copy of Wavespeed's. All of it sits in two tables at
the top of the adapter, so a correction is a one-file change. Verify with one
cheap wan-2.2 i2v submit before relying on it. A mirror render is booked at the
tier's Atlas rate.

## What was retired in this change

- `wan22-i2v`, `wan22-t2v`, `wan22-s2v` return `retired_provider`. They stay
  registered so historical rows and `/admin/usage` resolve.
- The pipeline's RunPod branches (submit, poll, metered-actual cost, the s2v part
  caps). A queued wan22 row now fails at the clip stage with the retirement named;
  an in-flight RunPod handle fails and the existing orphan-cancel path cancels it.
  **Before merge:** confirm no `video_jobs` row on a wan22 tier is
  `awaiting_provider` (`select job_id, model_tier, status from video_jobs where
  model_tier like 'wan22%' and status in ('queued','awaiting_provider')`).
- `/cron/runpod-pod-watch` removed from `vercel.json` and `cron-expectations.ts`
  in the same commit (the drift test reds otherwise). The route handler stays in
  `server/cron.ts`, unscheduled.

## What is deferred

- **Phase 4 (RunPod deletion):** done 2026-09-23, see §Retired below.
- **`video_default_model_tier`**: the code default
  `VIDEO_DEFAULT_MODEL_TIER_DEFAULT` in `team-keys.ts` (protected) moves from
  the retired `kling25-pro` to `italk-atlas` in this change. The stored setting
  stays the owner's override and in production it reads `wan22-i2v`, a valid
  but retired id, so it wins over the code default: the owner sets it to
  `italk-atlas` after merge (blocker 226). Until then an enqueue that omits
  `modelTier` is refused with the retirement message, not rendered.
- **Grok as a talking tier:** the adapter supports `spokenLine` (written into the
  prompt as `She looks into the lens and says: "<line>"`), but the pipeline does
  not pass it, and `classifyAudioPath` strips invented dialogue. Shipping Grok's
  own voice needs an owner A/B and an explicit "gated line in prompt" audio path.
- **Actual cost:** Atlas's `data.price` is intermittent, so the estimate booked
  at submit stands. Reconciling against the Atlas invoice is a later pass.
- **InfiniteTalk tail gate** (mouth left open through the silent pad) and the
  Wan 2.7 "keep the product at the same distance" prompt clause belong to the
  writers room and the render gate, not the seam.
- **Spicy tiers:** ask Atlas whether they need enabling, bundled with the open
  AUP confirmation.

## Consequences

- The program has a talking tier again, in the cast's own voice, at about
  $0.60 per 10 s clip, with no GPU infrastructure to run.
- One vendor carries all video; the mirror covers the default talking tier and
  the draft tier only. An Atlas outage stops Grok and Wan 2.7 renders.
- Verification for Phase 2 is one real `italk-atlas` job on a disposable
  product ($1 to $2), watched through frame approval, clip, assembly and poster.

## Retired

Phase 4, 2026-09-23. The owner deleted the RunPod serverless endpoint and its
100 GB network volume (blocker 225), so the RunPod video path was removed from
the code and docs rather than left dormant.

Removed:

- Modules and their tests: `app/lib/runpod-video.server.ts`,
  `runpod-endpoint.server.ts`, `runpod-pods.server.ts`, and
  `owner-blockers-runpod-probe.test.ts`.
- The worker: all of `infra/video-worker/`, including `bakeoff/`.
- `fal-video.server.ts`: the `wan22-i2v`, `wan22-t2v`, `wan22-s2v` specs, the
  `workerMode` field, `workerModeIneligibility`, and `'runpod'` from the
  `provider` union. The three ids now live in `RETIRED_VIDEO_TIER_IDS`;
  `tierIneligibility` accepts any string and returns `retired_provider` for
  them (and any other historical `wan22-*` id), so a historical row gets the
  retirement named, never an unknown-tier error or an undefined spec.
  `advanceJob`, `enqueueVideoJob`, `enqueueVideoJobSet`, the episode validator
  and the team video-job route all check it first. A stored
  `video_default_model_tier` of `wan22-i2v` is still refused, not swapped for a
  paid Atlas tier (blocker 226).
- `video-pipeline.server.ts`: `logRunpodBurn`, `cancelInflightRunpodRequests`
  (on job failure and on owner reject), `jobUsedRunpod`, `confirmRunpodIdle`, and
  the poster-stage idle probe. No Atlas or Wavespeed cancel existed to keep.
- `server/cron.ts`: the `/cron/runpod-pod-watch` handler.
- Owner-blocker probes `runpod_no_pods` and `runpod_endpoint_idle`, and the
  `runpod:stray-pod` and `runpod:endpoint-workers-up` filings. An open row that
  still names one of those probes is skipped by `verifyBlockers` (unknown probe),
  so it needs clearing by hand.
- The `runpod` credential-health integration (`RUNPOD_API_KEY`).
- `token-log.server.ts`: `logRunpodPodCost`, `RUNPOD_POD_FEATURE`, and
  `getTodayRunpodPodSpendCents`, plus the Video tab's "Out-of-band GPU" card.
  Historical `bakeoff-gpu` rows still show in `/admin/usage`.
- `model-pricing.server.ts`: the RunPod rate estimators and
  `computeRunpodActualCostUsd`. `runpod/wan22` and `runpod/wan22-s2v` stay in
  `VIDEO_RATES` as tombstones at their last default estimate so historical rows
  resolve; no tier selects them.
- Admin: the `wan22-*` options in the Video tab's default-tier picker (now
  derived from `VIDEO_MODELS`), and the Video Studio GPU-idle badge.
- `blob.server.ts` `requireBlobToken`, whose only caller was the RunPod client.

Kept on purpose: `requireVideoProvider('runpod')` still throws the ADR-016
retirement message. The `video_jobs.runpod_idle_confirmed_at` and
`runpod_idle_probe_json` columns are no longer read or written; dropping them is
a separate `db/migrations` PR. `docs/store-team/video-worker-runpod.md` stays as
the history of the bake-off.
