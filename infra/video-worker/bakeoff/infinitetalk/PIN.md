# InfiniteTalk lane pin

## Wrapper commit

| | |
|---|---|
| Repo | https://github.com/kijai/ComfyUI-WanVideoWrapper |
| Pinned sha | `088128b224242e110d3906c6750e9a3a348a659b` |
| Recorded | 2026-08-30 (main HEAD via the GitHub API that day; commit dated 2026-05-24, "Don't count .disabled as duplicate") |
| License | Apache 2.0 |

A custom-node pack that drifts under an autonomous team is a standing hazard:
kijai pushes to main frequently and node signatures change without notice. The
pin is the mitigation. `setup-infinitetalk.sh` clones at this sha, the workflow
was converted and validated against this sha, and nothing here may float to
main. Bumping the pin means re-running the CPU validation pass below.

## Weights (pod-local, /opt/it-models, die with the pod)

All URLs HEAD-checked live 2026-08-30; sizes are the exact `content-length`
bytes and `setup-infinitetalk.sh` enforces them as equality.

| File | Bytes | Source |
|---|---|---|
| `diffusion_models/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors` | 16,643,349,018 | Kijai/WanVideo_comfy_fp8_scaled `I2V/` |
| `diffusion_models/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors` | 2,713,548,210 | Kijai/WanVideo_comfy_fp8_scaled `InfiniteTalk/` |
| `text_encoders/umt5-xxl-enc-fp8_e4m3fn.safetensors` | 6,731,333,792 | Kijai/WanVideo_comfy |
| `vae/Wan2_1_VAE_bf16.safetensors` | 253,806,278 | Kijai/WanVideo_comfy |
| `loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors` | 738,005,744 | Kijai/WanVideo_comfy `Lightx2v/` |
| `clip_vision/clip_vision_h.safetensors` | 1,264,219,396 | Comfy-Org/Wan_2.1_ComfyUI_repackaged |
| `wav2vec2/wav2vec2-chinese-base_fp16.safetensors` | 190,115,368 | Kijai/wav2vec2_safetensors |

Total: 28,534,377,806 bytes (~26.6 GiB) on the pod's 40 GB container disk.

Nothing is reused from the network volume: the volume's umt5 and VAE files are
the Comfy-Org repackages for ComfyUI's NATIVE loaders, and the wrapper's own
loaders (`WanVideoTextEncodeCached`, `WanVideoVAELoader`) want the kijai `-enc-`
/ `Wan2_1_VAE_bf16` layouts. The umt5 is the fp8 variant rather than the
example's bf16 (saves 4.3 GiB on the tight disk; `quantization: fp8_e4m3fn` is
the loader's documented pairing for that file). The volume has no clip_vision
file at all.

## Workflow provenance

The graph now lives at `infra/video-worker/workflows/infinitetalk_916.json`
(promoted there when InfiniteTalk became the worker's v2 s2v engine,
2026-08-30; `run-infinitetalk.py` reads it from that path). It was converted
node for node from the wrapper's own
example `example_workflows/wanvideo_2_1_14B_I2V_InfiniteTalk_example_03.json`
at sha `088128b224242e110d3906c6750e9a3a348a659b` (UI format -> API format
against a live `/object_info` at the same sha). Sampling settings are the
example's own: 6 steps, cfg 1.0, shift 11, `dpm++_sde`, seed fixed,
`add_noise_to_samples: true`, frame_window_size 81, motion_frame 9,
audio embeds at 25 fps, output combined at 25 fps.

**The example ships ONLY an accelerated variant.** There is no plain
(non-distilled) InfiniteTalk example at this sha: the shipped graph loads
`lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors` and its
6-step / cfg 1.0 sampling depends on that LoRA. This lane reproduces the
example faithfully, LoRA included, as the baseline. A "plain" A/B (no LoRA,
more steps, real cfg) would mean inventing settings kijai never shipped;
if wanted later, start from steps 25 / cfg ~5 / scheduler unipc and treat it
as an experiment, not a reference.

Deviations from the example, each to keep the custom-node surface to exactly
one pack (the wrapper) and the run non-interactive:

- GGUF weights (`Wan2_1-InfiniteTalk_Single_Q8.gguf`, `wan2.1-i2v-14b-480p-Q8_0.gguf`)
  swapped for their fp8_scaled safetensors equivalents from kijai's own repos
  (the workflow's model-links note lists fp8 as a first-class option);
  `quantization: fp8_e4m3fn_scaled` set explicitly to match.
- `Wav2VecModelLoader` (single safetensors, offline) instead of
  `DownloadAndLoadWav2VecModel` (runtime HF-hub download). The example's own
  note names this exact swap and the `models/wav2vec2` folder.
- MelBandRoFormer vocal separation bypassed: `LoadAudio` feeds
  `MultiTalkWav2VecEmbeds.audio_1` directly. The separator exists to strip
  music from songs; our input is clean TTS speech. Saves a model download and
  a node, AUDIO type either way.
- KJNodes `ImageResizeKJv2`/`GetImageSizeAndCount`/Set/Get/INTConstant
  replaced by core `ImageScale` (lanczos, center crop) and inlined links.
- VHS `VHS_VideoCombine` replaced by core `CreateVideo` + `SaveVideo` at the
  same 25 fps (the exact pattern handler.py's S2V graph uses).
- `attention_mode: sdpa` instead of the example's `sageattn`:
  setup-infinitetalk.sh does not install sageattention. Expect some speed left
  on the table; renders should be unaffected.

## Local patch: transformers 5.x hidden-states capture (2026-08-30)

The wrapper is still cloned at the pinned sha, then `setup-infinitetalk.sh`
applies `patch-wav2vec2-hf5.py` to `multitalk/wav2vec2.py` (idempotent; fails
loudly if the pinned file drifts). This is the ONE deliberate deviation from
the pinned tree.

Why: the pod environment carries transformers 5.16.1 (ComfyUI core wants
`transformers>=4.50.3` and pod setup installs latest). Since transformers 5,
`Wav2Vec2Encoder.forward` takes `**kwargs: Unpack[TransformersKwargs]` and
ends with `return BaseModelOutput(last_hidden_state=hidden_states)`: it never
collects per-layer hidden states. Collection moved to the
`check_model_inputs` / `OutputRecorder` decorator machinery on the STOCK model
classes' forward, which the wrapper's vendored `Wav2Vec2Model` subclass
bypasses by overriding `forward`. So `encoder_outputs.hidden_states` is None
and `MultiTalkWav2VecEmbeds` (multitalk/nodes.py:248,
`torch.stack(embeddings.hidden_states[1:], dim=1)`) dies with
"'NoneType' object is not subscriptable" on every case, ~15s in.

Not fixable from the workflow: no `Wav2VecModelLoader` /
`MultiTalkWav2VecEmbeds` input controls this, and the node passes
`output_hidden_states=True` correctly already. Downgrading transformers to
4.x was rejected: the env is shared with the S2V lane, which was validated
under 5.16.1.

The patch routes the vendored file's two `self.encoder(...)` call sites
through a helper that registers forward hooks on `encoder.layers`, calls the
encoder unchanged, and rebuilds the 4.x-style hidden_states tuple when the
encoder did not provide one (4.x behavior wins when present). Element 0 of
the rebuilt tuple is positional filler; the consumer slices `[1:]`.

## Resolution

The example's native run is 640x640 (its INTConstants override the 832x480
widget defaults). This lane parameterizes `__WIDTH__` x `__HEIGHT__`:

- First pass: **480x832** (9:16 within the 480p model class, dimensions
  divisible by 16).
- Stretch goal: **720x1280**. The base model is the 480P checkpoint, so treat
  720p output as an experiment; if it smears, the honest 9:16 path at higher
  res is a 480x832 render plus the worker's existing ffmpeg finish pass.

## CPU validation (2026-08-30, macOS, ComfyUI @ 72865f4f, wrapper @ 088128b2)

Wrapper cloned at the pinned sha into a CPU ComfyUI at the worker's pinned
core sha; wrapper requirements pip-installed; server booted with `--cpu`.
Wrapper imported clean (only the FantasyPortrait sub-nodes skipped for a
missing optional `onnx`, not used here).

| Check | Result |
|---|---|
| Wrapper import on CPU | ok (0.9s, no errors) |
| All 18 node classes exist in /object_info | ok |
| Every input name valid (required + optional) | ok |
| Every link resolves, every required input supplied | ok |
| Static enum literals (scheduler, quantization, precision, mode, ...) | ok |
| Real `POST /prompt` server-side validation (dummy weight files) | ok, HTTP 200, `node_errors: {}` |
| Execution smoke | fails at `Wav2VecModelLoader` "header too small", i.e. only because the dummy weights are 0 bytes, exactly as expected |

## Unproven until the GPU run

- Actual rendering: no frame has ever been produced through this graph.
- fp8_scaled base + lightx2v bf16 LoRA with `merge_loras: false` on this
  wrapper sha (validated structurally, not numerically).
- Peak VRAM with 20-block swap at 480x832 and at 720x1280.
- The umt5 fp8-file + `quantization: fp8_e4m3fn` pairing loads correctly.
- Wall-clock per second of audio (windowed loop cost is unmeasured).
- 28.6 GB of downloads fitting alongside whatever the S2V run already put on
  the 40 GB container disk (setup preflights free space and fails loudly).
