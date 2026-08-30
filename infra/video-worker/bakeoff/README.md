# Video-worker bake-off harness

Render-tests the worker's graphs on a temporary RunPod GPU pod, driving the
REAL `handler.py` in its `TEST_LOCAL` mode so the production code path is what
gets exercised end to end: ComfyUI render, ffmpeg postprocess, Vercel Blob
upload. The S2V graph has never produced a frame; this harness exists to change
that.

## Why no GHCR image

The last attempt died on the image, twice: GHCR anonymous pulls got
rate-limited (`toomanyrequests` retry loop, billing the whole time), and a
second host pulled the image at ~0.6 MB/s. This harness sidesteps GHCR
entirely: the pod runs `runpod/pytorch:1.1.0-cu1290-torch290-ubuntu2404`, the
same base as the worker Dockerfile (torch already correct, host-cached on
RunPod), and `pod-setup.sh` reproduces the Dockerfile's remaining steps on the
pod (ComfyUI at the pinned `COMFY_SHA`, pip deps, `extra_model_paths.yaml`).
The code under test is scp'd straight from the working tree, so a graph fix can
be re-rendered in minutes without a registry push.

The slow-host trap is handled structurally: a pod that is not SSH-reachable
within 8 minutes is terminated and re-rolled (up to 3 times), never waited out.

## Files

| File | Runs | Purpose |
|---|---|---|
| `run-bakeoff.sh` | locally | Whole lifecycle: preflight, pod create (REST v2, volume + ssh key), setup, matrix, results, guaranteed teardown |
| `pod-setup.sh` | on the pod | Idempotent: volume symlink, ffmpeg, ComfyUI @ pinned SHA, pip, model bootstrap (`WITH_S2V=1 WITH_LIGHTX2V=1`), model sanity check |
| `render-matrix.py` | on the pod | Runs each matrix case through `TEST_LOCAL`, records handler JSON + wall time + peak GPU memory to `results.jsonl` |
| `matrix.json` | data | The Tuesday matrix (below) |
| `make-test-assets.sh` | locally | Produces the identity-frame and speech-track URLs |

## The matrix

| Case | What it proves |
|---|---|
| `s2v-short` | Base `WanSoundImageToVideo` pass alone (audio under 4.8s, single chunk) |
| `s2v-long` | THE critical case: ~12s audio exercises the `WanSoundImageToVideoExtend` + `LatentConcat` chain, the path every real episode line takes |
| `s2v-long-finish` | Same render with `finish:true`; with `s2v-long` it is the finish-pass A/B pair the worker README owes |
| `i2v-control-fast` | 5s `fast:true` regression control proving the pod setup matches the live lane |

Seeds are pinned (`20260901`) so re-runs are comparable. Peak GPU memory per
case is a first-class output: whether 720x1280 S2V fits in 24 GB is an open
question, and a 4090 run answers it either way.

## Running it

```bash
cd infra/video-worker/bakeoff

# 1. Assets (identity frame from the DB, speech via ElevenLabs or `say`):
bash make-test-assets.sh
# paste the three export lines it prints

# 2. Sanity, no spend:
bash make-test-assets.sh --db-check     # DB query only
bash run-bakeoff.sh --dry-run           # prints the pod-create payload, no POST

# 3. The real run (creates ONE GPU pod, terminates it on exit, even on Ctrl-C):
bash run-bakeoff.sh
```

`RUNPOD_API_KEY` and the Blob token (`BLOB_READ_WRITE_TOKEN` or
`XDIPX_READ_WRITE_TOKEN`) are read from the environment or the repo root
`.env` / `.env.local`. The Blob token is passed per job at run time and never
written into any file, local or remote.

Results land in `results/<timestamp>/results.jsonl` (gitignored), one JSON line
per case: handler output (Blob clip URLs included), `wallSeconds`,
`peakGpuMemMiB`, and the error text on failure. A case failure never aborts the
rest of the matrix.

## Cost expectation

- GPU preference order: L40S ($0.99/hr), L40 ($0.82/hr), RTX 6000 Ada
  ($0.84/hr), then RTX 4090 ($0.74/hr). Secure-cloud POD rates from the live
  catalog 2026-08-30; pods bill much lower than the serverless flex rates the
  worker docs quote. US-IL-1 only (volume `q167g3em77` pins the datacenter).
- The S2V weights download (~16 GB, first run only) is the big fixed cost:
  roughly 15 to 40 minutes depending on volume write speed. Later runs skip it.
- Render half: the i2v fast control is minutes; the three S2V cases are
  unmeasured (that is the point). Budget for the whole first run: roughly 1.5
  to 3 pod-hours, so about $1.50 to $3 on a 48 GB card. Re-rolls cost cents
  (the $0.50/3-pods datum from the last attempt).
- The driver prints wall time, the pod hourly rate, and the estimated $ spent
  at exit.

## Teardown checklist (every run, no exceptions)

1. `run-bakeoff.sh` terminates the pod in an EXIT trap and then hard-fails
   with a loud warning if `GET /v2/pods` reports a nonzero count. Read its
   last lines.
2. If it warned, terminate the stray in the console or with
   `curl -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" https://api.runpod.ai/v2/pods/<id>`
   immediately. A stray pod once cost $14.
3. Backstop: the hourly `/cron/runpod-pod-watch` sweep files an owner blocker
   for any pod left RUNNING, and records the GPU spend in the ledger under
   feature `bakeoff-gpu`. It is a backstop, not a license.
4. The S2V weights stay on the volume (that is the volume's job); nothing else
   persists.

## Recording results

Numbers from a run belong in `docs/store-team/video-worker-runpod.md`
(the Bake-off section). Template:

```
### Bake-off render results (<date>, <GPU>, <VRAM> GB)

| Case | Result | Render s | Finish s | Peak VRAM MiB | Clip |
|---|---|---|---|---|---|
| s2v-short | PASS/FAIL | | n/a | | <blob url> |
| s2v-long | PASS/FAIL | | n/a | | <blob url> |
| s2v-long-finish | PASS/FAIL | | | | <blob url> |
| i2v-control-fast | PASS/FAIL | | n/a | | <blob url> |

- 720x1280 S2V on 24 GB: fits / OOMs (peak <n> MiB on <GPU>).
- Finish-pass A/B verdict after eyeballing both clips: <keep minterpolate / go RIFE>.
- Cost of this run: $<n> (<h>h at $<rate>/hr). Ledger row: feature bakeoff-gpu.
- Graph verdict: <renders clean / node errors, listed below>.
```

Update the "What is still unproven" list in that doc to match what this run
proved.

## InfiniteTalk lane (challenger)

The talking-tier bake-off has a second lane: InfiniteTalk (MeiGen-AI) through
the kijai/ComfyUI-WanVideoWrapper custom-node pack, pinned by sha in
`infinitetalk/PIN.md`. It runs AFTER the S2V matrix, on the same pod:

```bash
ssh <pod>
bash /root/video-worker/bakeoff/infinitetalk/setup-infinitetalk.sh
python3 /root/video-worker/bakeoff/infinitetalk/run-infinitetalk.py \
  --image-url "$IMAGE_URL" --audio-url "$AUDIO_URL_LONG" \
  --prompt "<the s2v-long prompt>" --seed 20260901 --out-dir /root/it-results
```

Run it for the same test cases with the same assets and the same pinned seed
so the two lanes are comparable head to head. Setup downloads ~26.6 GB of
weights to POD-LOCAL disk (`/opt/it-models`), never the network volume: only
a bake-off winner's weights get promoted, and these die with the pod. It also
kills the matrix's ComfyUI, since custom nodes only load at boot.

Outputs land locally on the pod (`/root/it-results`, one results.jsonl row per
case in the matrix's shape plus `"lane": "infinitetalk"`, videos alongside);
the operator scp's them back before teardown:

```bash
scp -P <port> -i ~/.ssh/runpod_ed25519 'root@<host>:/root/it-results/*' results/<timestamp>/
```
