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

Status: Phase 1 (worker itself) and Phase 2 (`app/lib/runpod-video.server.ts`) are both
live. The endpoint is up and measured; it is not yet selectable from `/admin/video-studio`.

## Where things live

| Thing | Where |
|---|---|
| Worker code | `infra/video-worker/` in the repo |
| Container image | `ghcr.io/mbayard-sorp/xdipx-video-worker:latest`, public, built and pushed by hand |
| Network volume | `q167g3em77` (`xdipx-wan22-models`), 100 GB, US-IL-1 |
| Models (~36 GB core, ~41 GB with fast LoRAs) | on the volume, `/runpod-volume/models/` |
| Rendered clips | Vercel Blob, `video/<jobId>/clip.mp4` and `last-frame.png` |
| Endpoint | `1cnxz75c71177q`, RunPod console > Serverless, US-IL-1 |

The models are downloaded once onto the volume by `bootstrap-models.sh`. Workers never
download anything; the image holds code only, so a new image tag is a code change, not a
multi-gigabyte rebuild.

## Cost model

Measured live against endpoint `1cnxz75c71177q` (2026-08-22). Workers land on RTX 4090
because L40S stock is currently LOW in US-IL-1.

- Scale-to-zero Flex endpoint: $0 while idle.
- Billed per second of GPU time while a job runs. RTX 4090 flex is $1.10/hr
  (~$0.00031/s), the rate the endpoint actually bills at today.
- Full 20-step Wan 2.2 pipeline (no LoRA), 720x1280, 5 s, on a 4090: EXCEEDED the 900 s
  execution timeout (VRAM swapping between the two 14B experts). The 20-step path needs an
  L40S/48 GB card to finish; it does not fit a 24 GB card's memory/time budget.
- Same job with `fast: true` (lightx2v 4-step LoRAs, already on the volume): COMPLETED,
  executionTime 219669 ms (~3.7 min), valid h264 720x1280 16 fps 5.06 s output. At the 4090
  rate that is about $0.067 per 5 s clip. **`fast: true` is the default** in
  `app/lib/runpod-video.server.ts` for exactly this reason: the 20-step path does not
  finish inside the timeout on the 24 GB cards the endpoint actually schedules onto.
- Execution timeout on the endpoint is 1800000 ms (30 min).
- Cold start adds time on the first job a worker takes (loading ~36 GB from the volume).
  Batching jobs close together keeps workers warm and amortises it.
- Network volume storage is a small fixed monthly fee (RunPod lists it per GB-month).

**Driver requirement:** the image ships `torch` built for CUDA 12.9 (`cu129`), so the
endpoint's GPU pool must satisfy `minCudaVersion 12.9`. A host with an older driver fails
the job with CUDA error 804 (forward compatibility not supported) rather than running slow;
this is a hard scheduling constraint, not a performance one.

Spend control belongs to the owner under the cost-only doctrine: the endpoint's max
workers cap (3) is the hard ceiling, the app-side daily video budget gate is the soft one.

## Owner-only steps

1. Build and push the image to GHCR (`docker buildx`, linux/amd64). Live tag:
   `ghcr.io/mbayard-sorp/xdipx-video-worker:latest` (public).
2. Create the network volume, attach it to a temporary pod, run `bootstrap-models.sh`
   once, terminate the pod. Live volume: `q167g3em77` (`xdipx-wan22-models`), 100 GB,
   US-IL-1.
3. Create the serverless endpoint: min 0 / max 3 workers, Flex, execution timeout
   1800000 ms (30 min), `minCudaVersion 12.9` (the image's torch build requires it; an
   older-driver host fails with CUDA error 804), volume attached. Live endpoint:
   `1cnxz75c71177q`. Note the pool is currently RTX 4090-heavy because L40S stock is LOW
   in US-IL-1. The fast (`fast: true`) default in `runpod-video.server.ts` exists because
   of this: the full 20-step path needs an L40S/48 GB card to finish inside the timeout,
   and 4090s are what the endpoint actually schedules onto.
4. Store the endpoint id and a RunPod API key as Vercel env vars
   (`RUNPOD_VIDEO_ENDPOINT_ID`, `RUNPOD_API_KEY`). Done, Phase 2 (`runpod-video.server.ts`)
   is live and submitting real jobs.
5. Kill switch: set max workers to 0 in the RunPod console. In-flight jobs finish,
   nothing new starts, cost stops.

Agents do none of the above. They may read this page, file tickets against the worker
code, and enqueue jobs through the normal `video_jobs` path under the video team's budget
gate.
