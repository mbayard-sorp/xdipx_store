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
