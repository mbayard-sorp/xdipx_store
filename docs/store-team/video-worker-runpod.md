# Video worker on RunPod (owned Wan 2.2 provider)

Operator page for the team. Engineering detail lives in `infra/video-worker/README.md`.

## What it is

A second video provider for the `video_jobs` pipeline next to fal.ai. It runs Wan 2.2 14B
(open weights, Apache 2.0) inside ComfyUI on a RunPod Serverless GPU endpoint. Given a
9:16 scene frame and a motion prompt it returns a 720x1280, 16 fps H.264 clip of 5 to 15
seconds plus the last frame as a PNG, both uploaded to Vercel Blob under the job's
`video/<jobId>/` prefix exactly like fal output is today.

Why it exists: fal bills per clip at model-list prices and blocks some product imagery; an
owned worker bills per GPU second, accepts any prompt the charter allows, and lets us add
our own LoRAs later (a reserved `loras/` folder is already on the volume).

Status: Phase 1 is the worker itself (image, models, handler). It is not yet selectable
from `/admin/video-studio`; Phase 2 adds `app/lib/runpod-video.server.ts` and a
`video_provider` valve.

## Where things live

| Thing | Where |
|---|---|
| Worker code | `infra/video-worker/` in the repo |
| Container image | GHCR, `xdipx-video-worker:<tag>`, built and pushed by hand |
| Models (~36 GB core, ~41 GB with fast LoRAs) | RunPod network volume, `/runpod-volume/models/` |
| Rendered clips | Vercel Blob, `video/<jobId>/clip.mp4` and `last-frame.png` |
| Endpoint | RunPod console > Serverless |

The models are downloaded once onto the volume by `bootstrap-models.sh`. Workers never
download anything; the image holds code only, so a new image tag is a code change, not a
multi-gigabyte rebuild.

## Cost model

- Scale-to-zero Flex endpoint: $0 while idle.
- Billed per second of GPU time while a job runs. L40S class is about $1.75/hr
  (~$0.0005/s); RTX 4090 class about $1.10/hr.
- Estimated per clip (to be measured on the first batch, numbers are not yet verified):
  a 5 s clip at full quality around 3 to 6 minutes, $0.10 to $0.20; with `fast: true`
  (4-step distilled LoRAs) under a minute, a few cents. 15 s clips roughly 3x.
- Cold start adds 2 to 4 minutes of billed time on the first job a worker takes (loading
  ~36 GB from the volume). Batching jobs close together keeps workers warm and amortises it.
- Network volume storage is a small fixed monthly fee (RunPod lists it per GB-month).

Spend control belongs to the owner under the cost-only doctrine: the endpoint's max
workers cap (3) is the hard ceiling, the app-side daily video budget gate is the soft one.

## Owner-only steps

1. Build and push the image to GHCR (`docker buildx`, linux/amd64).
2. Create the network volume, attach it to a temporary pod, run `bootstrap-models.sh`
   once, terminate the pod.
3. Create the serverless endpoint: min 0 / max 3 workers, Flex, 48 GB GPU class first,
   execution timeout 1800 s, volume attached.
4. Store the endpoint id and a RunPod API key as Vercel env vars (`RUNPOD_ENDPOINT_ID`,
   `RUNPOD_API_KEY`) when Phase 2 lands.
5. Kill switch: set max workers to 0 in the RunPod console. In-flight jobs finish,
   nothing new starts, cost stops.

Agents do none of the above. They may read this page, file tickets against the worker
code, and (Phase 2) enqueue jobs through the normal `video_jobs` path under the video
team's budget gate.

## Deployed image vs this repo (worker capability)

The endpoint pins an **immutable image sha**, so the handler in this repo and the handler
actually running are different things. As of 2026-08-27 the endpoint runs `eb2a126`
(2026-08-22), which implements modes **`i2v` and `t2v` only**. Mode `s2v` (audio-driven
talking) landed in the repo on 2026-08-26 (#935) but **has never been deployed**, still
carries `TODO(verify)` on its ComfyUI node names, and has no weights on the model volume.
Selecting a tier whose mode the running image lacks would cold-boot a GPU only to
`ValueError` in the handler.

So the app declares the running image's real capability with the **`RUNPOD_WORKER_MODES`**
Vercel env var (comma-separated; default `i2v,t2v` when unset). `tierIneligibility()`
(`app/lib/fal-video.server.ts`) refuses any tier whose worker mode is not in that set at
propose time, at the team API (before the money gate), in the studio composer, and inside
`enqueueVideoJob`; `submitRunpodVideo` refuses an undeclared mode before the HTTP call as
the last backstop. Registration in `VIDEO_MODELS` is untouched, so `/admin/usage` and
in-flight jobs still resolve every historical tier.

**Eligible tiers today are `wan22-i2v` and `wan22-t2v`. The program has no talking tier.**

Enablement order to add the talking (`s2v`) tier, all owner-only (see owner blocker 45):

1. Pick the checkpoint from the bake-off (Wan2.2-S2V vs InfiniteTalk vs
   LongCat-Video-Avatar) and confirm the handler's ComfyUI node names (clear `TODO(verify)`).
2. Download the chosen weights onto the model volume (`bootstrap-models.sh`).
3. Build and deploy a new worker image implementing `s2v`, and update the endpoint to it.
4. Add `s2v` to `RUNPOD_WORKER_MODES` in Vercel (e.g. `i2v,t2v,s2v`). Only then does
   `wan22-s2v` become selectable; nothing in code needs to change.

## Stray pod watch

The bootstrap step above (owner step 2) uses a RunPod Pod, the hourly-billed machine
product, not the Serverless endpoint this file otherwise describes. Serverless scales to
zero and is billed per job, correct and no action needed. A Pod keeps billing at its
hourly rate (about $0.74/hr for the class used here) until it is stopped or terminated,
whether or not anyone is using it.

`/cron/runpod-pod-watch` (`app/lib/runpod-pods.server.ts`) runs hourly, lists every pod in
`RUNNING` state via `GET https://api.runpod.io/v2/pods`, and files a single owner blocker
(dedupe key `runpod:stray-pod`, probe `runpod_no_pods`) naming each running pod, its hours
running, and its hourly rate when any are found. The row clears itself once the pod is
stopped or terminated. This exists because a bootstrap pod was left running 18.7 hours on
2026-08-22/23, costing about $14, before anyone noticed.

`RUNPOD_API_KEY` in Vercel must keep the `api.runpod.io/graphql` (management) permission
for this check to work; a Serverless-scoped key reports "could not ask" (a `null` probe
verdict, never a false all-clear) rather than a real answer.
