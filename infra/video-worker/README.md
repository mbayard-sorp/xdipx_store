# xdipx video worker (RunPod Serverless, Wan 2.2 14B via ComfyUI)

Phase 1 of an owned video-render provider for the `video_jobs` pipeline
(`app/lib/video-pipeline.server.ts`). Replaces a fal.ai model call with a RunPod
Serverless endpoint that runs Wan 2.2 14B (Apache 2.0 open weights) inside a headless
ComfyUI, encodes an H.264 mp4 at 720x1280 / 16 fps, extracts the last frame, and
uploads both to Vercel Blob.

Nothing in this directory is wired into the app yet. The app-side provider
(`app/lib/runpod-video.server.ts`, Phase 2) will call `/run` and poll `/status`.

## Contents

| File | Purpose |
|---|---|
| `Dockerfile` | runpod/pytorch base, ComfyUI pinned to v0.33.1, ffmpeg, runpod SDK. No models inside. |
| `bootstrap-models.sh` | One-time, idempotent download of the model set onto the network volume. |
| `extra_model_paths.yaml` | Points ComfyUI at `/runpod-volume/models`. |
| `workflows/wan22_i2v_916.json` | ComfyUI API-format workflow, image to video, 720x1280, 16 fps. |
| `workflows/wan22_t2v_916.json` | Same for text to video. |
| `handler.py` | RunPod handler: boot ComfyUI, fill workflow, render, ffmpeg, upload. |
| `test_input.json` | Sample job for `TEST_LOCAL`. |

## Job contract

Input (`{"input": {...}}`):

```
prompt            string   required
negativePrompt    string   optional
imageUrl          string   required for mode i2v; public URL of a 9:16 scene frame
durationSeconds   int      5..15
seed              int      optional (random if absent)
steps             int      optional, default 20 (4 when fast=true)
mode              "i2v" | "t2v"
aspect            "9:16"   only value accepted in Phase 1
fast              bool     optional, use lightx2v 4-step LoRAs (must be on the volume)
blobToken         string   Vercel Blob read-write token
blobPathPrefix    string   e.g. "video/<jobId>"; files land at <prefix>/clip.mp4 and <prefix>/last-frame.png (random suffix added)
```

Output: `{ videoUrl, lastFrameUrl, width: 720, height: 1280, fps: 16, durationSeconds, seed, renderSeconds }`
or `{ error: "<message>" }`.

## Finish pass (ticket #5719)

`finish: true` on any mode runs a finish stage before upload: real
motion-compensated interpolation to 30 fps (ffmpeg minterpolate mci, never
frame duplication) then a lanczos upscale to 1080x1920 with light unsharp.
This closes most of the visible quality gap against professional creators:
without it the app's ffmpeg naively stretches 720p16 to 1080p30 downstream.
The response reports `finishSeconds` separately from `renderSeconds` so the
metered cost stays attributable. Default OFF; the app arms it per job once
`video_finish_pass_enabled` is on and an A/B pair has been eyeballed (the
bake-off session renders that pair and records the numbers in
`docs/store-team/video-worker-runpod.md`). Upgrade path if minterpolate is
too slow or smeary on this content: model-based RIFE + RealESRGAN behind a
`WITH_FINISH=1` bootstrap, same input contract.

## Mode s2v (audio-driven talking, tickets #5713/#5714)

`mode: "s2v"` takes `imageUrl` (the approved identity frame) plus `audioUrl`
(the ElevenLabs speech track) and returns a performed talking clip whose
duration derives from the audio (cap 60s per render; the app splits longer
lines). The clip KEEPS its speech track (the silent modes stay `-an`).
Checkpoints land on the volume via `WITH_S2V=1 bash bootstrap-models.sh`
(wan2.2_s2v_14B_fp8_scaled + wav2vec2_large_english_fp16; umt5 and the VAE are
shared with the base tiers). Generation runs at 16 fps in 77-frame chunks: the
base `WanSoundImageToVideo` pass produces the first 77 frames (4.8 s) and each
further chunk is a `WanSoundImageToVideoExtend` pass sampled and joined onto the
running latent with `LatentConcat(dim='t')`. The chunking is built by
`build_s2v_workflow`, not done inside the node.

**Enablement gate:** the graph was rewritten on 2026-08-29 after the bake-off
found the original could not run (invented node inputs, a missing
`AudioEncoderEncode`, no `ModelSamplingSD3`; see
`docs/store-team/video-worker-runpod.md`). It is verified against the ComfyUI
source at the pinned `COMFY_SHA` and the official template, but **has never been
executed** — no frame has been rendered, and whether 720x1280 fits in 24 GB is
untested. A render test is still required BEFORE any image tag is pushed. The
endpoint pins an immutable sha tag, so merging this repo change alters nothing
live by construction.

Frame count is `durationSeconds * 16 + 1` rounded down to the nearest `4k+1` (Wan latent
constraint): 5 s = 81 frames, 15 s = 241 frames.

## Workflow placeholders (node ids are fixed, the handler edits by id)

| Node | Class | Field the handler fills |
|---|---|---|
| 5 | CLIPTextEncode | `text` = prompt |
| 6 | CLIPTextEncode | `text` = negative |
| 7 (i2v only) | LoadImage | `image` = downloaded scene frame filename |
| 8 | WanImageToVideo / EmptyHunyuanLatentVideo | `length`, `width`, `height` |
| 11 | KSamplerAdvanced (high noise) | `noise_seed`, `steps`, `cfg`, `end_at_step` |
| 12 | KSamplerAdvanced (low noise) | `noise_seed`, `steps`, `cfg`, `start_at_step` |
| 15 | SaveVideo | `filename_prefix` |

Sampling: euler / simple, shift 5.0, cfg 3.5, steps split 50/50 between the high-noise and
low-noise experts (matches the Comfy-Org Wan 2.2 14B templates). `fast=true` inserts
`LoraLoaderModelOnly` nodes with the lightx2v 4-step LoRAs and drops cfg to 1.0.

## 1. Build and push the image (by hand, owner only)

```bash
cd infra/video-worker
docker buildx build --platform linux/amd64 \
  -t ghcr.io/<github-org>/xdipx-video-worker:0.1.0 \
  --push .
```

GHCR needs `docker login ghcr.io` with a PAT that has `write:packages`. Make the package
public (or add a registry credential on the RunPod template) so RunPod can pull it.

## 2. Create the network volume and load the models (once)

1. RunPod console > Storage > New Network Volume. 100 GB is enough for the core set
   (~36 GB) plus LoRAs and headroom. Pick a datacenter that has L40S / 4090 capacity; the
   endpoint is pinned to that datacenter by the volume (RunPod doc).
2. Start a temporary GPU or CPU pod with the volume attached (it mounts at `/workspace`
   on pods; on serverless workers it is `/runpod-volume`).
3. In the pod:

```bash
curl -fsSL https://raw.githubusercontent.com/<github-org>/<repo>/main/infra/video-worker/bootstrap-models.sh -o bootstrap-models.sh
MODELS_ROOT=/workspace/models WITH_LIGHTX2V=1 bash bootstrap-models.sh
```

4. Terminate the pod. Re-running the script later only fetches what is missing.

## 3. Create the serverless endpoint

RunPod console > Serverless > New Endpoint:

- Container image: `ghcr.io/<github-org>/xdipx-video-worker:0.1.0`
- Container disk: 20 GB (ComfyUI output/input scratch, no models)
- GPU: 48 GB class first (L40S / 6000 Ada), 24 GB (RTX 4090) as second choice.
  TODO(unverified): whether the 14B fp8 two-expert pipeline at 720x1280 x 241 frames fits
  a 24 GB card without offload has not been measured; start with 48 GB.
- Workers: min 0, max 3, Flex (scale to zero)
- Idle timeout: 60 s. Execution timeout: 1800 s (default is 600 s, too short for 15 s clips at 20 steps)
- Network volume: the one from step 2
- Env vars: none required. Optional: `RENDER_TIMEOUT_S`, `COMFY_BOOT_TIMEOUT_S`,
  `BLOB_API_URL` (see handler.py TODO), `WAN_FAST_DEFAULT` is NOT a thing; pass `fast` per job.

Blob token is passed per job, not as an endpoint env var, so rotating it never requires
redeploying the endpoint.

## 4. Test

```bash
export RUNPOD_API_KEY=...
export EP=<endpoint-id>

# submit
curl -s -X POST https://api.runpod.ai/v2/$EP/run \
  -H "authorization: Bearer $RUNPOD_API_KEY" -H "content-type: application/json" \
  -d @test_input.json
# -> {"id":"<job-id>","status":"IN_QUEUE"}

# poll
curl -s https://api.runpod.ai/v2/$EP/status/<job-id> \
  -H "authorization: Bearer $RUNPOD_API_KEY"
```

Replace `imageUrl` and `blobToken` in `test_input.json` first. Progress strings show up in
the status response while the job is `IN_PROGRESS`. Async results are kept 30 minutes.

Local smoke test inside the container (needs a GPU and the volume mounted):

```bash
TEST_LOCAL=/app/test_input.json python /app/handler.py
```

## Cold start and cost

- Flex rate (RunPod pricing page via search, 2026-08): L40S / 6000 Ada ~$1.75/hr
  (~$0.00049/s), RTX 4090 ~$1.10/hr (~$0.00031/s). Billing is per second of execution.
- Cold start: image pull (once per host) plus ComfyUI boot plus first model load from the
  network volume (~29 GB of fp8 diffusion weights + 6.7 GB encoder). Expect 2 to 4 minutes
  on the first job per worker; warm workers skip all of it.
  TODO(unverified): measure on the real endpoint and record here.
- Per clip: TODO(unverified) render time for 720x1280 at 20 steps has not been measured.
  Rough order of magnitude from the Comfy-Org template's RTX 4090D notes (71 to 536 s at
  640x640): a 5 s clip at 20 steps is probably 3 to 6 minutes on an L40S ($0.10 to $0.20),
  and under a minute with `fast=true`. A 15 s clip scales roughly linearly. Record real
  numbers after the first batch.

## Kill switch

RunPod console > the endpoint > Edit > Max Workers = 0. In-flight jobs finish, nothing new
starts, no cost accrues. The app-side valve (Phase 2) is the preferred switch; this is the
hard stop.

## Verified facts and sources (2026-08-22)

- runpod handler contract, `progress_update(job, msg)`, `{"error": ...}` return:
  docs.runpod.io/serverless/workers/handler-functions; `rp_progress.py` on github.com/runpod/runpod-python.
- `/runpod-volume` mount path: docs.runpod.io/serverless/storage/network-volumes.
- `/run`, `/status`, auth header, default 600 s execution timeout, 30 min async retention:
  docs.runpod.io/serverless/endpoints/send-requests.
- ComfyUI `/prompt` (`{prompt, client_id}` -> `{prompt_id, number, node_errors}`),
  `/history/{id}` outputs shape: docs.comfy.org/development/comfyui-server/api-examples.
- Node input names at ComfyUI v0.33.1 (commit 72865f4f27eaf5396f8f36370e0a2be3a9a090ee):
  `nodes.py`, `comfy_extras/nodes_wan.py`, `nodes_hunyuan.py`, `nodes_video.py`,
  `nodes_model_advanced.py`.
- Model file names: huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged tree pages.
- Two-expert scheme and sampler settings: Comfy-Org/workflow_templates
  `video_wan2_2_14B_i2v.json` and `video_wan2_2_14B_t2v.json`.
- Vercel Blob PUT contract: vercel/storage `packages/blob/src/{api,helpers,put,put-helpers}.ts` on main.
- Base image tag: hub.docker.com/r/runpod/pytorch/tags. runpod SDK 1.12.0: pypi.org/project/runpod.
