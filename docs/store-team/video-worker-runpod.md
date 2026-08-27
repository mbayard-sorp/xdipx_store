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

## What is DEPLOYED versus what is in this repo (ticket #5727)

The endpoint pins an immutable sha tag, so the handler in this repo and the handler the
workers run are two different things, and merging worker code changes nothing live.

| | Deployed | In this repo |
|---|---|---|
| Image | `ghcr.io/mbayard-sorp/xdipx-video-worker:eb2a126` (2026-08-22) | `main` |
| Modes | `i2v`, `t2v` | `i2v`, `t2v`, `s2v` (#935) |
| Finish pass (#936) | absent | present, and **not wired app-side** (nothing sends `finish: true`), so it is inert either way |

The app no longer assumes otherwise. `RUNPOD_WORKER_MODES` (`app/lib/runpod-video.server.ts`)
declares what the deployed image implements and defaults to `i2v,t2v`; `tierIneligibility`
refuses `wan22-s2v` while `s2v` is absent, at propose time, at the enqueue, and inside
`submitRunpodVideo` before the HTTP call. Until then the program has **no talking tier at all**
and the writers room writes voiceover-carried b-roll, exactly as the render playbook says.

### Enabling the talking tier (owner, in this order)

Doing any of these without the others only moves the failure later and makes it cost more.

1. **Validate the graph.** `build_s2v_workflow` carries `TODO(verify)` on the node class and
   input names (handler.py lines 76, 261, 338); they were never exercised against a live
   ComfyUI. Run the bake-off (Wan2.2-S2V vs InfiniteTalk vs LongCat-Video-Avatar) and record
   the result here. A wrong node name fails *after* the worker boots, so this is a real cost.
2. **Load the weights.** Start a pod on network volume `q167g3em77` and run
   `MODELS_ROOT=/workspace/models WITH_S2V=1 bash bootstrap-models.sh`
   (wan2.2_s2v_14B_fp8_scaled + wav2vec2_large_english_fp16). **Terminate the pod** — a pod
   left running cost about $14 on 2026-08-22, which is why the stray-pod watch below exists.
3. **Build and push the image**, then repoint the endpoint at the new sha tag. Owner-only:
   it needs `docker login ghcr.io` with a `write:packages` PAT.
4. **Widen `RUNPOD_WORKER_MODES` to `i2v,t2v,s2v`** in Vercel production. This is the switch
   that makes the app believe step 3 happened; flipping it early re-arms the exact trap.

Steps 1-3 are all owner-only (GPU pod, registry credential, endpoint config), which is why
this is a blocker-list item rather than something an agent can finish.

## Spin-down: what is automatic, what is verified, what is cancelled

Three different things, often confused:

**Idling is not billed and needs no code.** The endpoint is Serverless Flex with
`workers.min = 0`, a 5-second idle timeout, and FlashBoot. RunPod scales it to zero itself.
The health endpoint reporting `idle: 3, ready: 3` is the FlashBoot cache, not billed compute:
measured 2026-08-27, the endpoint had shown three idle workers for four days since the last
job on 08-23 and billed nothing on 08-24 through 08-27. The only billed idle is the 5-second
timeout after each job, about $0.004. There is nothing to spin down and no code should try.

**That it went quiet is verified, per video.** `confirmRunpodIdle` (ticket #5717) probes both
the endpoint and the pods list after the terminal stage and stamps `runpod_idle_confirmed_at`;
`/cron/runpod-pod-watch` re-probes any completed job still unconfirmed past a 20-minute grace
and files the `runpod:endpoint-workers-up` blocker if ACTIVE (billing) workers persist. Idle
Flex slots are correctly not counted as active.

**In-flight requests on an abandoned job ARE cancelled** (ticket #5728). This is the one that
actually leaked. A submitted RunPod request outlives the row that submitted it: nothing reads
the output of a terminal job, but the GPU renders and bills to completion or to the 1800s
execution timeout, roughly $1.43 an orphan and more for a multi-part avatar job.
`cancelInflightRunpodRequests` now runs on both abandonment paths, reading each request's
executionTime BEFORE cancelling so the burn still reaches `api_token_log`:

- the generic `advanceJob` failure handler, which also covers the avatar multi-part case where
  one failed part used to abandon its siblings mid-render;
- `rejectVideoJob`, the owner's Reject button. Prod job 4 ("Rejected by owner: cancelled
  during step-4 test") took exactly that path and left its request running.

Cancelling is safe only because the caller has already made the row terminal, so the work
being stopped is work the app can no longer use. fal handles are deliberately left alone.

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
