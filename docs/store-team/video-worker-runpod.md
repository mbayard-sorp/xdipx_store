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

1. **Validate the graph.** Partly done — see §Bake-off below. The graph was rewritten on
   2026-08-29 because the original could not have run. What remains is a render test: the
   corrected graph has never produced a frame. A wrong node name fails *after* the worker
   boots, so this is a real cost.
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

## Bake-off (2026-08-30): render results

The corrected S2V graph rendered end to end, 4 of 4 matrix cases green, driven through the
real handler.py in TEST_LOCAL mode on a temporary 4090 pod ($0.74/hr) via the harness in
`infra/video-worker/bakeoff/`. All cases at the production 720x1280 @ 16 fps, Sofia cast
reference frame, ElevenLabs speech, seed 20260901.

| Case | Settings | Wall | Peak VRAM | Metered cost |
|---|---|---|---|---|
| i2v-control-fast | 5s, 4-step lightning | 223s | 19.2 GB | ~$0.05 (matches live lane) |
| s2v-short | 2.9s, 1 chunk, 20 steps cfg 6 | 26.5 min | 22.1 GB | ~$0.33 |
| s2v-long | 14.2s, 3 chunks, 20 steps cfg 6 | ~95 min | ~20 GB | ~$1.17 |
| s2v-long-fast | same, 4-step lightning cfg 1 | 9.9 min | 19.8 GB | ~$0.12 |
| s2v-long-fast8 | same, 8-step lightning cfg 1 | 19.3 min | 20.1 GB | ~$0.24 |

Findings that bind production settings:

- **24 GB fits.** Every S2V case fit a 4090; the tightest was the 20-step single chunk at
  22.1 GB. The 48 GB preference stands for headroom, not necessity.
- **20-step S2V does not fit the serverless execution timeout for real lines.** One 77-frame
  chunk at 20 steps runs ~29 min on a 4090 (1800s limit ≈ one chunk); every extend chunk adds
  the same again. Full-quality S2V is a pod job, not a serverless job, at current settings.
  The lightning path (4 or 8 steps, cfg 1) fits easily and costs an eighth as much.
- **One model family per ComfyUI process.** The pod container cgroup is far smaller than the
  host (38 GiB observed); a warm server holding the i2v/t2v expert pair is OOM-killed the
  moment the s2v checkpoint loads on top. The handler now restarts ComfyUI on a family
  switch (`ensure_comfy(family=...)`), which also protects the serverless worker once mixed
  modes deploy. Large downloads to the container disk count against the same cgroup, so do
  not bootstrap weights while a render is up.
- **Owner quality verdict 2026-08-30 (in-session):** cfg 1 lighting (the lightning path) beat
  cfg 6 on look; 20-step won on lip articulation; post-grading cfg 6 toward cfg 1 tone reads
  washed out and is not a substitute. The 8-step lightning hybrid was rendered as the
  candidate production default. Chunk-seam identity held across both seams in the 14s
  3-chunk render; hands are the visible weak point at 20 steps (fused fingers while
  gesturing), and the lightning path gestures less, which hides it.
- Fixes applied to `build_s2v_workflow` before the run, from the source-verification pass
  (all CPU-validated against a live ComfyUI at the pinned sha): full 77-frame chunks with an
  ffmpeg tail-trim to audio length (the model needs >= 73 frames per pass), the t2v
  high-noise lightning LoRA grafted for fast mode (4 steps at cfg 1 with no distill LoRA
  renders mush), the official first-frame VAE overbake hack (LatentCut prepend, drop 4
  decoded frames), and the official Wan default negative when a job sends none.

### InfiniteTalk challenger round (same day, same 4090, same assets and seed)

Rendered via `infra/video-worker/bakeoff/infinitetalk/` (kijai WanVideoWrapper at the pinned
commit, ~28.5 GB of weights pod-local, never on the volume). One defect fixed en route: the
wrapper's vendored wav2vec2 subclass returns hidden_states=None under transformers 5 (its
custom forward bypasses the new hidden-states machinery), crashing MultiTalkWav2VecEmbeds;
`patch-wav2vec2-hf5.py` reroutes it through layer hooks and is applied by the setup script.

| Case | Res | Wall | Peak VRAM |
|---|---|---|---|
| it-short (2.9s) | 480x832 | 2.0 min | 16.2 GB |
| it-long (14.2s, 5 windows) | 480x832 | 7.2 min | 16.9 GB |
| it-product (16.3s) | 480x832 | 8.6 min | 16.8 GB |
| it-long-720 (14.2s) | 720x1280 | 27.9 min | 24.05 GB |

Owner verdicts (2026-08-30, in-session): InfiniteTalk lip sync and motion naturalness beat
S2V ("really close and feels more natural"); S2V fast kept a slight edge on attractiveness;
IT sync drifts slightly on fast speech at the end of a line; the IT 480p cuts read lower
quality than S2V's 720p, as expected from the resolution gap. The decisive operational
datum: at 720x1280 on a 24 GB card, IT peaks at 24.05 GB and block-swap thrashing makes it
SLOWER than 8-step S2V at the same resolution (27.9 vs 19.3 min). IT's speed advantage
(3 to 5x) exists at 480p, or presumably at 720p on 48 GB cards, which remain low-stock.

LongCat-Video-Avatar remains unevaluated (wrapper support is branch-grade; weakest
operational story of the three).

## Bake-off (2026-08-29): Wan2.2-S2V graph

**Result: the shipped S2V graph could not have run. It has been rewritten and (2026-08-30)
render-tested, see above.** Scope was Wan2.2-S2V only; InfiniteTalk and LongCat-Video-Avatar were never
reached, so no quality comparison exists between the three candidates.

Checked against the ComfyUI source at the pinned `COMFY_SHA` (72865f4f, v0.33.1, 2026-08-13)
and the official Comfy-Org `video_wan2_2_14B_s2v` template. Five defects in
`build_s2v_workflow`, all now fixed:

| Assumed | Actual |
|---|---|
| `WanSoundImageToVideo.audio` | no such input |
| `WanSoundImageToVideo.audio_encoder` | no such input |
| `WanSoundImageToVideo.chunk_length` | no such input |
| `LoadAudio` feeds the S2V node directly | must pass through `AudioEncoderEncode`, a node the graph never created |
| `UNETLoader` → `KSampler` | needs `ModelSamplingSD3` between them (shift **8** for S2V, not the base tiers' 5) |

The node's real signature is `positive, negative, vae, width, height, length, batch_size,
audio_encoder_output?, ref_image?, control_video?, ref_motion?`. Sampler settings from the
template: `uni_pc` / `simple`, cfg 6, 20 steps (the graph had `euler`).

**The architectural one: chunking is not internal.** `chunk_length` does not exist because the
node does not chunk. It generates at most 77 frames (4.8 s at 16 fps); longer speech is a chain
of `WanSoundImageToVideoExtend` passes, each sampled and joined onto the running latent with
`LatentConcat(dim='t')`. The old comment claiming the node "consumes the audio embedding across
chunks internally" was wrong. This is not an edge case — essentially every episode line runs
longer than 4.8 s, so the chain is the normal path. `build_s2v_workflow` now builds it.

Also fixed: `extra_model_paths.yaml` mapped `diffusion_models`, `text_encoders`, `vae`, `loras`
and `clip_vision` but **not** `audio_encoders`, so `AudioEncoderLoader` would have seen an empty
list even with `wav2vec2_large_english_fp16.safetensors` sitting on the volume.

### What is still unproven

- No frame has been rendered. Node names and wiring are source-verified only.
- **VRAM is an open question.** The official template defaults to 640x640; the worker targets
  720x1280, 2.25x the pixels. Whether a 14B fp8 S2V pass fits in 24 GB at that size is untested,
  and 48 GB classes (A40/L40S/L40/A6000) were all out of stock in US-IL-1 across three attempts.
- No render time, so no cost model for the talking tier.
- No InfiniteTalk or LongCat-Video-Avatar comparison.

### Two operational traps found on the way

- **GHCR anonymous pulls get rate-limited.** A pod pulling
  `ghcr.io/mbayard-sorp/xdipx-video-worker:eb2a126` retry-looped on
  `toomanyrequests` for ~15 minutes while billing, and never started. The package is public, but
  public is not the same as unthrottled. The serverless endpoint pulls the same way, so pushing a
  new sha tag and repointing the endpoint can stall identically. Attach a registry credential
  before relying on a fresh tag pulling promptly.
- **Host pull speed varies wildly.** A second pod pulled the base image at ~0.6 MB/s with ~8 GB
  to go. Sample the rate a few minutes in and re-roll rather than waiting it out; three pods cost
  about $0.50 total and none of them rendered anything.

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

### Out-of-band pod spend lands in the ledger (ticket #6320)

Pods are created outside the `video_jobs` pipeline (owner bootstraps, S2V graph bake-offs
driven straight against the RunPod REST API), so nothing wrote their cost to `api_token_log`.
The Video tab on `/admin/homepage-team` and `/admin/usage` therefore read `$0` for a day that
spent real GPU money: the same money-path blind spot the fleet evaluation flagged, a real cost
with no ledger row. The stray-pod watch above catches a pod *left running*, but said nothing
about money already spent.

The same hourly `/cron/runpod-pod-watch` sweep now records the GPU spend of every `RUNNING`
pod into `api_token_log` under feature `bakeoff-gpu` (`RUNPOD_POD_FEATURE`), with the pod id in
`ref_id` and GPU-seconds in `request_count`. It records the **increment** since the last sweep,
watermarked per pod in KV (`runpod-pod:recorded-cents:<podId>`) against the pod's cumulative
uptime cost (`rate * hoursRunning`), so re-seeing the same long-lived pod each hour never
double-counts. It captures the historically expensive case well: the 18.7h/$14 pod accruing
hourly, and captures whatever an hourly sweep catches of sub-hour rolls. A pod created and
terminated between two sweeps is the known gap: the pods API reports `cost 0` once a pod is
`TERMINATED`, so a fast bake-off roll that never overlaps a sweep tick is not seen here (those
settle via the RunPod billing API, not this poll).

**Decision: recorded, NOT gated (the safer default).** This out-of-band spend is shown on the
Video tab beside the gated "Spent today" figure as a separate "Out-of-band GPU" stat, but it is
**not** counted against `video_team_daily_cents`. A bake-off or bootstrap refused by the daily
gate is worse than one that is merely visible. This is enforced purely by the feature name:
`bakeoff-gpu` is not a `video-` prefix, so `teamFromFeature()` returns `null` (no budget-counter
bump) and `getTodaySpendCents`'s `feature LIKE 'video-%'` window never sums it, the same
record-only trick `media-blocks` uses, with no edit to the protected spend-control code. If the
store later decides this spend SHOULD count against the daily gate, rename the feature to a
`video-` prefix (no exclusion is needed, the LIKE window will then include it).
