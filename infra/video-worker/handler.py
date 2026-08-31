"""
xdipx video worker: RunPod Serverless handler that renders a 9:16 clip with Wan 2.2 14B
through a headless ComfyUI, post-processes with ffmpeg, and uploads to Vercel Blob.

Job input (matches what app/lib/video-pipeline.server.ts will send):
  {
    "prompt": str,
    "negativePrompt": str | null,
    "imageUrl": str | null,        # scene frame, 9:16 portrait; required for modes "i2v" and "s2v"
    "audioUrl": str | null,        # speech track (mp3/wav); required for mode "s2v"; duration derives from it
    "durationSeconds": int,        # 5..15
    "seed": int | null,
    "steps": int | null,           # default 20 (4 when fast == true)
    "mode": "i2v" | "t2v" | "s2v",
    "aspect": "9:16",              # only 9:16 is supported in Phase 1
    "fast": bool | null,           # use the lightx2v 4-step LoRAs (must be on the volume)
    "finish": bool | null,         # finish pass (ticket #5719): motion-interpolate to 30 fps
                                   # and upscale to 1080x1920 before upload; default false
    "blobToken": str,              # Vercel Blob read-write token
    "blobPathPrefix": str          # e.g. "video/<jobId>"
  }

Output on success:
  { videoUrl, lastFrameUrl, width, height, fps, durationSeconds, seed, renderSeconds }
Output on failure:
  { "error": "<clear message>" }

Env RUNPOD_S2V_ENGINE picks the renderer behind mode "s2v": "wan-s2v" (default,
the native Wan 2.2 S2V graph, 16 fps) or "infinitetalk" (the kijai
WanVideoWrapper graph, 25 fps). Same contract either way; only the honest
fps/width/height values in the response may differ. The app never knows which
engine rendered.

Facts verified 2026-08-22 (see README.md for sources): runpod handler contract and
progress_update, /runpod-volume mount path, ComfyUI /prompt and /history shapes, node
input names at ComfyUI v0.33.1, Vercel Blob PUT contract from the @vercel/blob SDK source.
"""

from __future__ import annotations

import glob
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from typing import Any

import requests

COMFY_DIR = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
COMFY_PORT = int(os.environ.get("COMFY_PORT", "8188"))
COMFY_URL = f"http://127.0.0.1:{COMFY_PORT}"
WORKFLOW_DIR = os.environ.get("WORKFLOW_DIR", "/app/workflows")
MODELS_ROOT = os.environ.get("MODELS_ROOT", "/runpod-volume/models")

WIDTH, HEIGHT, FPS = 720, 1280, 16
MIN_SECONDS, MAX_SECONDS = 5, 15
DEFAULT_STEPS, FAST_STEPS = 20, 4
# Owner A/B verdict from the 2026-08-30 bake-off: for talking clips, 8-step
# lightning keeps the cfg-1 look while closing most of the lip-articulation
# gap to 20 steps, at about a quarter of the 20-step cost. Per-job `steps`
# still overrides.
S2V_FAST_STEPS = 8
COMFY_BOOT_TIMEOUT_S = int(os.environ.get("COMFY_BOOT_TIMEOUT_S", "300"))
RENDER_TIMEOUT_S = int(os.environ.get("RENDER_TIMEOUT_S", "1500"))

# Verified from the @vercel/blob SDK source (packages/blob/src/{api,helpers,put}.ts on main,
# 2026-08-22): PUT {base}/?pathname=<pathname>, base defaults to https://vercel.com/api/blob,
# x-api-version 12. TODO(unverified): the older host form
# https://blob.vercel-storage.com/<pathname> is still widely documented; if the vercel.com
# base ever rejects the request, try BLOB_API_URL=https://blob.vercel-storage.com.
BLOB_API_URL = os.environ.get("BLOB_API_URL", "https://vercel.com/api/blob")
BLOB_API_VERSION = os.environ.get("BLOB_API_VERSION", "12")

# ── Wan 2.2 S2V (audio-driven talking, tickets #5713/#5714) ──────────────────
# Facts from the ComfyUI native S2V support (comfyui-wiki tutorial, verified
# 2026-08-26): checkpoint wan2.2_s2v_14B_fp8_scaled.safetensors, audio encoder
# wav2vec2_large_english_fp16.safetensors, umt5 text encoder + wan_2.1 VAE
# shared with the base tiers, 16 fps, generation in 77-frame chunks (~4.8s)
# with extend passes adding 77 frames each (chunks = ceil(audio_s * 16 / 77)).
#
# Bake-off 2026-08-29: the node names and wiring below were checked against the
# ComfyUI source at the pinned COMFY_SHA (v0.33.1) and against the official
# Comfy-Org `video_wan2_2_14B_s2v` template. That pass REPLACED the previous
# graph, which could not have run: it invented `audio`, `audio_encoder` and
# `chunk_length` inputs on WanSoundImageToVideo (none exist), omitted the
# AudioEncoderEncode node that actually produces the audio embedding, and
# skipped ModelSamplingSD3. See docs/store-team/video-worker-runpod.md.
#
# TODO(verify): still NOT executed against a running ComfyUI. The bake-off's
# render half was cut short (GHCR anonymous pull rate limits, then a host
# pulling at ~0.6 MB/s), so nothing here has produced a frame. A render test is
# still required before an image tag is pushed. The endpoint pins an immutable
# tag, so merging this cannot change live behavior.
S2V_MODEL = "wan2.2_s2v_14B_fp8_scaled.safetensors"
S2V_AUDIO_ENCODER = "wav2vec2_large_english_fp16.safetensors"
S2V_CHUNK_FRAMES = 77
S2V_MAX_SECONDS = 60  # provisional per-render cap; the app splits longer lines
# Sampling settings from the official Comfy-Org video_wan2_2_14B_s2v template.
# S2V differs from the base tiers: shift 8 (not 5), uni_pc (not euler), and one
# single-expert sampler pass rather than the high-noise/low-noise pair.
S2V_SHIFT = 8.0
S2V_SAMPLER = "uni_pc"
S2V_CFG = 6.0

# The official Wan templates' quality-negative block (verbatim from
# video_wan2_2_14B_s2v CLIPTextEncode node 7; the i2v/t2v templates ship the
# same string). At cfg 6 the negative meaningfully shapes output, so an empty
# job negative falls back to this rather than to nothing.
WAN_DEFAULT_NEGATIVE = (
    "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，"
    "低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，"
    "毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"
)

# ── InfiniteTalk engine for mode "s2v" (owner-directed 2026-08-30) ───────────
# The 2026-08-30 bake-off put full-res InfiniteTalk ahead of Wan2.2-S2V on lip
# sync and motion naturalness to the owner's eye. It is the v2 engine behind
# the SAME job contract: mode "s2v" in, clip + last frame out, and the app
# never knows which engine rendered. RUNPOD_S2V_ENGINE selects it per
# endpoint; "wan-s2v" (the default) keeps current behavior.
#
# The graph is NOT built programmatically like build_s2v_workflow: it is the
# render-proven template from the bake-off (workflows/infinitetalk_916.json,
# converted from the kijai wrapper's own example at the sha pinned in
# bakeoff/infinitetalk/PIN.md), parameterized by placeholder fill exactly as
# the bake-off's run-infinitetalk.py did. Sampling (6 steps, cfg 1.0, shift 11,
# dpm++_sde, lightx2v distill LoRA) is baked into the template because those
# settings are what rendered; the job's `steps`/`fast` fields are ignored on
# this engine. Output is 25 fps (the wrapper example's rate), kept honest in
# the response rather than resampled to 16.
S2V_ENGINE = os.environ.get("RUNPOD_S2V_ENGINE", "wan-s2v")
S2V_ENGINES = ("wan-s2v", "infinitetalk")
IT_WORKFLOW = "infinitetalk_916.json"
IT_FPS = 25  # audio embeds and CreateVideo both run at 25 in the wrapper example
IT_SAVE_NODE = "132"  # SaveVideo id in the template (base graphs use "15")

LIGHTX2V_LORAS = {
    "i2v": (
        "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
        "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
    ),
    "t2v": (
        "wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors",
        "wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors",
    ),
}

_comfy_proc: subprocess.Popen | None = None
# Which model family the running ComfyUI has loaded. The i2v/t2v expert pair
# and the s2v checkpoint cannot coexist in one server process: the container
# cgroup (38 GiB observed on a 4090 pod) OOM-kills ComfyUI when the second
# family loads on top of a warm first. Verified live 2026-08-30 during the
# bake-off (s2v submit after an i2v render crashed the server in 3s).
# "infinitetalk" is its own family for the same reason (a full 14B base model
# plus its conditioning module, loaded through wrapper nodes with their own
# memory management); it never shares a server with "base" or "s2v".
_comfy_family: str | None = None


def log(msg: str) -> None:
    print(f"[video-worker] {msg}", flush=True)


# ---------------------------------------------------------------------------
# ComfyUI lifecycle
# ---------------------------------------------------------------------------

def comfy_alive() -> bool:
    try:
        return requests.get(f"{COMFY_URL}/system_stats", timeout=3).status_code == 200
    except requests.RequestException:
        return False


def ensure_comfy(family: str = "base") -> None:
    """Start ComfyUI once per worker and block until /system_stats answers.

    A family switch (any of base i2v/t2v, s2v, infinitetalk to another)
    restarts the server first; see _comfy_family above.
    """
    global _comfy_proc, _comfy_family
    if comfy_alive():
        if _comfy_family in (None, family):
            _comfy_family = family
            return
        log(f"model family switch ({_comfy_family} -> {family}): restarting ComfyUI")
        if _comfy_proc is not None and _comfy_proc.poll() is None:
            _comfy_proc.terminate()
            try:
                _comfy_proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                _comfy_proc.kill()
                _comfy_proc.wait()
        _comfy_proc = None
    _comfy_family = family
    if _comfy_proc is None or _comfy_proc.poll() is not None:
        log("starting ComfyUI")
        # COMFY_LOG decouples ComfyUI's output from this process's stdout.
        # The bake-off harness needs that: ComfyUI outlives the handler
        # process (deliberately, so cases reuse the warm server), and an
        # inherited pipe both blocks the harness's EOF and dies with the
        # first case's pipe. Unset (the serverless worker), output streams
        # to the worker log exactly as before.
        comfy_log = os.environ.get("COMFY_LOG")
        out = open(comfy_log, "a") if comfy_log else sys.stdout  # noqa: SIM115
        _comfy_proc = subprocess.Popen(
            [
                sys.executable, "main.py",
                "--listen", "127.0.0.1",
                "--port", str(COMFY_PORT),
                "--disable-auto-launch",
                "--dont-print-server",
            ],
            cwd=COMFY_DIR,
            stdout=out,
            stderr=out if comfy_log else sys.stderr,
        )
    deadline = time.time() + COMFY_BOOT_TIMEOUT_S
    while time.time() < deadline:
        if comfy_alive():
            log("ComfyUI is up")
            return
        if _comfy_proc.poll() is not None:
            raise RuntimeError(f"ComfyUI exited during boot with code {_comfy_proc.returncode}")
        time.sleep(1)
    raise RuntimeError(f"ComfyUI did not answer /system_stats within {COMFY_BOOT_TIMEOUT_S}s")


# ---------------------------------------------------------------------------
# Input validation + workflow fill
# ---------------------------------------------------------------------------

def frames_for(seconds: int) -> int:
    # Wan latent length must be 4k+1. 16 fps * 5 s = 80 -> 81 frames; 15 s -> 241.
    n = seconds * FPS + 1
    return n - ((n - 1) % 4)


def validate(inp: dict[str, Any]) -> dict[str, Any]:
    mode = inp.get("mode", "i2v")
    if mode not in ("i2v", "t2v", "s2v"):
        raise ValueError(f"mode must be 'i2v', 't2v' or 's2v', got {mode!r}")
    prompt = (inp.get("prompt") or "").strip()
    if not prompt and mode != "s2v":
        raise ValueError("prompt is required")
    if inp.get("aspect", "9:16") != "9:16":
        raise ValueError("only aspect '9:16' is supported in Phase 1")
    try:
        seconds = int(inp.get("durationSeconds", 5))
    except (TypeError, ValueError):
        raise ValueError("durationSeconds must be an integer")
    if mode == "s2v":
        # Duration derives from the audio; the field is advisory here and the
        # real length is probed after download (bounded by S2V_MAX_SECONDS).
        if not 1 <= seconds <= S2V_MAX_SECONDS:
            raise ValueError(f"durationSeconds must be 1..{S2V_MAX_SECONDS} for mode 's2v', got {seconds}")
    elif not MIN_SECONDS <= seconds <= MAX_SECONDS:
        raise ValueError(f"durationSeconds must be {MIN_SECONDS}..{MAX_SECONDS}, got {seconds}")
    image_url = inp.get("imageUrl")
    if mode in ("i2v", "s2v") and not image_url:
        raise ValueError(f"imageUrl is required for mode '{mode}'")
    audio_url = inp.get("audioUrl")
    if mode == "s2v" and not audio_url:
        raise ValueError("audioUrl is required for mode 's2v' (the performed speech track)")
    if not inp.get("blobToken"):
        raise ValueError("blobToken is required")
    prefix = (inp.get("blobPathPrefix") or "").strip().strip("/")
    if not prefix:
        raise ValueError("blobPathPrefix is required")
    fast = bool(inp.get("fast", False))
    finish = bool(inp.get("finish", False))
    steps = inp.get("steps")
    fast_default = S2V_FAST_STEPS if mode == "s2v" else FAST_STEPS
    steps = int(steps) if steps else (fast_default if fast else DEFAULT_STEPS)
    if not 1 <= steps <= 60:
        raise ValueError("steps must be 1..60")
    seed = inp.get("seed")
    seed = int(seed) if seed is not None else random.randint(0, 2**32 - 1)
    return {
        "mode": mode,
        "prompt": prompt,
        "negative": (inp.get("negativePrompt") or "").strip(),
        "image_url": image_url,
        "audio_url": audio_url,
        "seconds": seconds,
        "frames": frames_for(seconds),
        "steps": steps,
        "seed": seed,
        "fast": fast,
        "finish": finish,
        "blob_token": inp["blobToken"],
        "blob_prefix": prefix,
    }


def download_scene_frame(url: str) -> str:
    """Fetch the scene frame into ComfyUI's input dir; returns the bare filename LoadImage expects."""
    name = f"scene-{uuid.uuid4().hex}.png"
    dest = os.path.join(COMFY_DIR, "input", name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = requests.get(url, timeout=60, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f"scene frame download failed: HTTP {r.status_code} for {url[:120]}")
    with open(dest, "wb") as f:
        for chunk in r.iter_content(1 << 16):
            f.write(chunk)
    return name


def download_audio(url: str) -> str:
    """Fetch the speech track into ComfyUI's input dir; returns the bare filename LoadAudio expects."""
    ext = ".mp3" if ".mp3" in url.split("?")[0].lower() else ".wav"
    name = f"speech-{uuid.uuid4().hex}{ext}"
    dest = os.path.join(COMFY_DIR, "input", name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = requests.get(url, timeout=120, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f"speech track download failed: HTTP {r.status_code} for {url[:120]}")
    with open(dest, "wb") as f:
        for chunk in r.iter_content(1 << 16):
            f.write(chunk)
    return name


def probe_audio_seconds(path: str) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    try:
        return float(res.stdout.strip())
    except ValueError:
        raise RuntimeError(f"could not probe audio duration: {res.stderr[-300:]}")


def probe_video_fps(path: str) -> float:
    """Actual frame rate of a rendered file. The infinitetalk engine reports
    (and keeps) this rather than assuming the wrapper's nominal 25."""
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    raw = res.stdout.strip().splitlines()[0] if res.stdout.strip() else ""
    try:
        num, _, den = raw.partition("/")
        fps = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        raise RuntimeError(f"could not probe video fps: {res.stderr[-300:]}")
    if fps <= 0:
        raise RuntimeError(f"ffprobe reported a non-positive fps ({raw!r}) for {path}")
    return fps


def build_s2v_workflow(p: dict[str, Any], image_name: str, audio_name: str, audio_seconds: float) -> dict[str, Any]:
    """
    Programmatic API-format graph for Wan 2.2 S2V, matching the shape of the
    official Comfy-Org `video_wan2_2_14B_s2v` template.

    Audio reaches the sampler as an ENCODED embedding, not as raw audio:
    LoadAudio -> AudioEncoderEncode(audio_encoder, audio) -> the S2V node's
    `audio_encoder_output`. `WanSoundImageToVideo` has no `audio` or
    `audio_encoder` input and never did.

    Chunking is NOT internal to the node, and there is no `chunk_length` input.
    The base node generates at most S2V_CHUNK_FRAMES; longer speech is a chain
    of `WanSoundImageToVideoExtend` passes, each sampled and joined onto the
    running latent with `LatentConcat` on the time axis. Every episode line
    longer than ~4.8s takes that path, which is the normal case.

    Node names and wiring checked against ComfyUI at the pinned COMFY_SHA
    (v0.33.1) and the official template on 2026-08-29. NOT yet render-tested;
    see docs/store-team/video-worker-runpod.md.
    """
    # Every chunk renders the full 77 frames: the model needs at least 73 per
    # pass (official template note), and the audio-embed bucket zero-pads past
    # the end of speech, so overshooting the audio is the designed behavior.
    # The decoded video is trimmed back to the audio duration in postprocess.
    audio_frames = min(frames_for(max(1, round(audio_seconds))), frames_for(S2V_MAX_SECONDS))
    n_chunks = max(1, -(-audio_frames // S2V_CHUNK_FRAMES))
    total_frames = n_chunks * S2V_CHUNK_FRAMES
    base_frames = S2V_CHUNK_FRAMES
    cfg = 1.0 if p["fast"] else S2V_CFG

    wf: dict[str, Any] = {
        "1": {"class_type": "UNETLoader", "_meta": {"title": "s2v model"},
              "inputs": {"unet_name": S2V_MODEL, "weight_dtype": "default"}},
        # Wan needs the flow-shift patch; the base tiers' workflow JSON does the
        # same thing between UNETLoader and the sampler.
        "2": {"class_type": "ModelSamplingSD3", "_meta": {"title": "shift"},
              "inputs": {"model": ["1", 0], "shift": S2V_SHIFT}},
        "3": {"class_type": "CLIPLoader", "_meta": {"title": "umt5"},
              "inputs": {"clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors", "type": "wan"}},
        "4": {"class_type": "VAELoader", "_meta": {"title": "wan vae"},
              "inputs": {"vae_name": "wan_2.1_vae.safetensors"}},
        "5": {"class_type": "CLIPTextEncode", "_meta": {"title": "positive"},
              "inputs": {"clip": ["3", 0], "text": p["prompt"] or "a person speaking naturally to camera"}},
        "6": {"class_type": "CLIPTextEncode", "_meta": {"title": "negative"},
              "inputs": {"clip": ["3", 0], "text": p["negative"] or WAN_DEFAULT_NEGATIVE}},
        "7": {"class_type": "LoadImage", "_meta": {"title": "identity frame"},
              "inputs": {"image": image_name}},
        "16": {"class_type": "LoadAudio", "_meta": {"title": "speech"},
               "inputs": {"audio": audio_name}},
        "17": {"class_type": "AudioEncoderLoader", "_meta": {"title": "wav2vec2"},
               "inputs": {"audio_encoder_name": S2V_AUDIO_ENCODER}},
        "18": {"class_type": "AudioEncoderEncode", "_meta": {"title": "encode speech"},
               "inputs": {"audio_encoder": ["17", 0], "audio": ["16", 0]}},
        "8": {"class_type": "WanSoundImageToVideo", "_meta": {"title": "s2v base chunk"},
              "inputs": {
                  "positive": ["5", 0], "negative": ["6", 0], "vae": ["4", 0],
                  "ref_image": ["7", 0], "audio_encoder_output": ["18", 0],
                  "width": WIDTH, "height": HEIGHT,
                  "length": base_frames, "batch_size": 1,
              }},
        "11": {"class_type": "KSampler", "_meta": {"title": "sample base"},
               "inputs": {"model": ["2", 0], "positive": ["8", 0], "negative": ["8", 1],
                          "latent_image": ["8", 2], "seed": p["seed"],
                          "steps": p["steps"], "cfg": cfg,
                          "sampler_name": S2V_SAMPLER, "scheduler": "simple", "denoise": 1.0}},
    }

    if p["fast"]:
        # 4 steps at cfg 1.0 without a distillation LoRA produces mush. The
        # official template's 4-step S2V variant loads the t2v HIGH-NOISE
        # lightning LoRA on the single S2V expert, between UNETLoader and
        # ModelSamplingSD3 (UNETLoader -> LoraLoaderModelOnly -> ModelSamplingSD3).
        lora = LIGHTX2V_LORAS["t2v"][0]
        if not os.path.exists(os.path.join(MODELS_ROOT, "loras", lora)):
            raise RuntimeError(f"fast=true but {lora} is missing from {MODELS_ROOT}/loras (run bootstrap-models.sh with WITH_LIGHTX2V=1)")
        wf["19"] = {"class_type": "LoraLoaderModelOnly", "_meta": {"title": "lightning 4step"},
                    "inputs": {"model": ["1", 0], "lora_name": lora, "strength_model": 1.0}}
        wf["2"]["inputs"]["model"] = ["19", 0]

    # Extend chain for anything past the first chunk.
    latent: list[Any] = ["11", 0]
    remaining = total_frames - base_frames
    node_id = 100
    while remaining > 0:
        length = min(S2V_CHUNK_FRAMES, remaining)
        ext, ks, cat = str(node_id), str(node_id + 1), str(node_id + 2)
        wf[ext] = {"class_type": "WanSoundImageToVideoExtend",
                   "_meta": {"title": f"s2v extend +{length}"},
                   "inputs": {"positive": ["5", 0], "negative": ["6", 0], "vae": ["4", 0],
                              "length": length, "video_latent": latent,
                              "audio_encoder_output": ["18", 0], "ref_image": ["7", 0]}}
        wf[ks] = {"class_type": "KSampler", "_meta": {"title": f"sample +{length}"},
                  "inputs": {"model": ["2", 0], "positive": [ext, 0], "negative": [ext, 1],
                             "latent_image": [ext, 2], "seed": p["seed"],
                             "steps": p["steps"], "cfg": cfg,
                             "sampler_name": S2V_SAMPLER, "scheduler": "simple", "denoise": 1.0}}
        wf[cat] = {"class_type": "LatentConcat", "_meta": {"title": "join chunk"},
                   "inputs": {"samples1": latent, "samples2": [ks, 0], "dim": "t"}}
        latent = [cat, 0]
        remaining -= length
        node_id += 3

    # Official-template hack: the Wan VAE overbakes the first decoded frame, so
    # duplicate the first latent frame before the single decode and drop the
    # decoded lead after. The causal VAE decodes T latents to 4T-3 frames (the
    # first latent yields 1 frame, the rest 4 each), so the prepend adds exactly
    # 4 frames; batch_index 4 removes precisely those, keeping the frame count
    # identical to the no-hack decode. (The template drops chunk-count frames
    # instead, an empirical choice that does not generalize.)
    wf["94"] = {"class_type": "LatentCut", "_meta": {"title": "cut first latent frame"},
                "inputs": {"samples": latent, "dim": "t", "index": 0, "amount": 1}}
    wf["95"] = {"class_type": "LatentConcat", "_meta": {"title": "prepend duplicate"},
                "inputs": {"samples1": ["94", 0], "samples2": latent, "dim": "t"}}
    wf["13"] = {"class_type": "VAEDecode", "_meta": {"title": "decode"},
                "inputs": {"samples": ["95", 0], "vae": ["4", 0]}}
    wf["96"] = {"class_type": "ImageFromBatch", "_meta": {"title": "drop overbaked lead"},
                "inputs": {"image": ["13", 0], "batch_index": 4, "length": 4096}}
    wf["14"] = {"class_type": "CreateVideo", "_meta": {"title": "frames+audio -> video"},
                "inputs": {"images": ["96", 0], "audio": ["16", 0], "fps": FPS}}
    wf["15"] = {"class_type": "SaveVideo", "_meta": {"title": "save"},
                "inputs": {"video": ["14", 0],
                           "filename_prefix": f"video/xdipx-s2v-{p['seed']}-{uuid.uuid4().hex[:8]}",
                           "format": "mp4", "codec": "h264"}}
    return wf


def build_infinitetalk_workflow(p: dict[str, Any], image_name: str, audio_name: str,
                                audio_seconds: float) -> dict[str, Any]:
    """
    Load and parameterize the render-proven InfiniteTalk graph
    (workflows/infinitetalk_916.json; provenance in bakeoff/infinitetalk/PIN.md).

    Textual placeholder fill, same mechanics as the bake-off harness: numeric
    placeholders are quoted strings in the template so the file stays valid
    JSON, and the replacement includes the quotes. Frames come from the audio
    duration at the wrapper's 25 fps; MultiTalkWav2VecEmbeds treats num_frames
    as a maximum and clamps to the audio length, so ceil overshoot is the
    designed behavior. Width/height are the production 720x1280 (bake-off
    it-long-720: renders fine, peaks at 24.05 GB, belongs on the 48 GB pool).
    """
    path = os.path.join(WORKFLOW_DIR, IT_WORKFLOW)
    with open(path) as f:
        text = f.read()
    frames = math.ceil(audio_seconds * IT_FPS)
    for placeholder, value in (
        ('"__WIDTH__"', str(WIDTH)),
        ('"__HEIGHT__"', str(HEIGHT)),
        ('"__SEED__"', str(p["seed"])),
        ('"__FRAMES_OR_AUTO__"', str(frames)),
        ('"__IMAGE__"', json.dumps(image_name)),
        ('"__AUDIO__"', json.dumps(audio_name)),
        ('"__PROMPT__"', json.dumps(p["prompt"] or "a person speaking naturally to camera")),
    ):
        if placeholder not in text:
            raise RuntimeError(f"{IT_WORKFLOW} is missing placeholder {placeholder}")
        text = text.replace(placeholder, value)
    wf: dict[str, Any] = json.loads(text)
    wf[IT_SAVE_NODE]["inputs"]["filename_prefix"] = (
        f"video/xdipx-it-{p['seed']}-{uuid.uuid4().hex[:8]}"
    )
    return wf


def build_workflow(p: dict[str, Any], image_name: str | None) -> dict[str, Any]:
    path = os.path.join(WORKFLOW_DIR, f"wan22_{p['mode']}_916.json")
    with open(path) as f:
        wf = json.load(f)

    wf["5"]["inputs"]["text"] = p["prompt"]
    wf["6"]["inputs"]["text"] = p["negative"] or WAN_DEFAULT_NEGATIVE
    wf["8"]["inputs"]["length"] = p["frames"]
    wf["8"]["inputs"]["width"] = WIDTH
    wf["8"]["inputs"]["height"] = HEIGHT
    if p["mode"] == "i2v":
        wf["7"]["inputs"]["image"] = image_name

    steps = p["steps"]
    split = max(1, steps // 2)
    cfg = 1.0 if p["fast"] else 3.5
    for node_id in ("11", "12"):
        s = wf[node_id]["inputs"]
        s["noise_seed"] = p["seed"]
        s["steps"] = steps
        s["cfg"] = cfg
    wf["11"]["inputs"]["end_at_step"] = split
    wf["12"]["inputs"]["start_at_step"] = split

    if p["fast"]:
        high, low = LIGHTX2V_LORAS[p["mode"]]
        for name in (high, low):
            if not os.path.exists(os.path.join(MODELS_ROOT, "loras", name)):
                raise RuntimeError(f"fast=true but {name} is missing from {MODELS_ROOT}/loras (run bootstrap-models.sh with WITH_LIGHTX2V=1)")
        # LoraLoaderModelOnly sits between UNETLoader and ModelSamplingSD3.
        # TODO(verify): input names model / lora_name / strength_model were not re-fetched from
        # nodes.py at v0.33.1 during this build; they match the upstream template usage.
        wf["20"] = {"class_type": "LoraLoaderModelOnly", "_meta": {"title": "lightx2v high"},
                    "inputs": {"model": ["1", 0], "lora_name": high, "strength_model": 1.0}}
        wf["21"] = {"class_type": "LoraLoaderModelOnly", "_meta": {"title": "lightx2v low"},
                    "inputs": {"model": ["2", 0], "lora_name": low, "strength_model": 1.0}}
        wf["9"]["inputs"]["model"] = ["20", 0]
        wf["10"]["inputs"]["model"] = ["21", 0]

    wf["15"]["inputs"]["filename_prefix"] = f"video/xdipx-{p['seed']}-{uuid.uuid4().hex[:8]}"
    return wf


# ---------------------------------------------------------------------------
# ComfyUI submit + poll
# ---------------------------------------------------------------------------

def submit(wf: dict[str, Any]) -> str:
    r = requests.post(f"{COMFY_URL}/prompt", json={"prompt": wf, "client_id": uuid.uuid4().hex}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"ComfyUI /prompt rejected the workflow: HTTP {r.status_code} {r.text[:600]}")
    body = r.json()
    if body.get("node_errors"):
        raise RuntimeError(f"ComfyUI node errors: {json.dumps(body['node_errors'])[:800]}")
    return body["prompt_id"]


def wait_for(prompt_id: str, on_tick) -> dict[str, Any]:
    started = time.time()
    while time.time() - started < RENDER_TIMEOUT_S:
        r = requests.get(f"{COMFY_URL}/history/{prompt_id}", timeout=30)
        entry = r.json().get(prompt_id) if r.status_code == 200 else None
        if entry:
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                msgs = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
                detail = json.dumps(msgs[-1][1])[:800] if msgs else json.dumps(status)[:800]
                raise RuntimeError(f"ComfyUI execution error: {detail}")
            if entry.get("outputs"):
                return entry
        on_tick(int(time.time() - started))
        time.sleep(3)
    raise RuntimeError(f"render exceeded {RENDER_TIMEOUT_S}s")


def find_output_video(entry: dict[str, Any], filename_prefix: str) -> str:
    """SaveVideo reports its file in history outputs; fall back to globbing the output dir."""
    for node_out in (entry.get("outputs") or {}).values():
        for items in node_out.values():
            if not isinstance(items, list):
                continue
            for it in items:
                if isinstance(it, dict) and str(it.get("filename", "")).lower().endswith((".mp4", ".webm", ".mkv", ".mov")):
                    return os.path.join(COMFY_DIR, "output", it.get("subfolder") or "", it["filename"])
    matches = sorted(glob.glob(os.path.join(COMFY_DIR, "output", f"{filename_prefix}*.*")), key=os.path.getmtime)
    if matches:
        return matches[-1]
    raise RuntimeError("render finished but no video file was found in ComfyUI outputs")


# ---------------------------------------------------------------------------
# ffmpeg + Blob
# ---------------------------------------------------------------------------

def run(cmd: list[str]) -> None:
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {res.stderr[-600:]}")


def postprocess(src: str, workdir: str, keep_audio: bool = False,
                trim_seconds: float | None = None,
                fps: float | None = FPS) -> tuple[str, str]:
    mp4 = os.path.join(workdir, "clip.mp4")
    png = os.path.join(workdir, "last-frame.png")
    audio_args = ["-c:a", "aac", "-b:a", "128k"] if keep_audio else ["-an"]
    # s2v renders whole 77-frame chunks past the end of speech (the model's
    # per-pass floor); trim the padded tail back to the audio duration here.
    trim_args = ["-t", f"{trim_seconds:.3f}"] if trim_seconds else []
    # fps=None keeps the source frame rate untouched (the infinitetalk engine
    # renders at 25; resampling it down to 16 would throw frames away).
    rate_args = ["-r", str(fps)] if fps else []
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
         *trim_args, *audio_args, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", *rate_args, mp4])
    # -sseof -0.07 lands inside the final 16 fps frame; -update 1 writes a single image.
    run(["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-0.07", "-i", mp4,
         "-frames:v", "1", "-update", "1", png])
    return mp4, png


FINISH_FPS = 30
FINISH_WIDTH, FINISH_HEIGHT = 1080, 1920


def finish_pass(mp4: str, workdir: str) -> str:
    """
    Finish quality (ticket #5719): REAL motion-compensated interpolation to
    30 fps (ffmpeg minterpolate mci/aobmc, not frame duplication) followed by
    a lanczos upscale to 1080x1920 with a light unsharp. Zero new models on
    the volume; ffmpeg is already in the image. If the bake-off finds
    minterpolate too slow or too smeary on this content, the upgrade path is
    model-based RIFE + RealESRGAN behind a WITH_FINISH bootstrap; the input
    contract (finish: true) stays identical either way.

    Interpolation FIRST, upscale second: interpolating at 720p costs a
    quarter of the motion search of doing it at 1080p.
    """
    out = os.path.join(workdir, "clip-finished.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4,
         "-vf",
         f"minterpolate=fps={FINISH_FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,"
         f"scale={FINISH_WIDTH}:{FINISH_HEIGHT}:flags=lanczos,unsharp=5:5:0.4:5:5:0.0",
         "-c:a", "copy",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", out])
    return out


def blob_put(token: str, pathname: str, path: str, content_type: str) -> str:
    with open(path, "rb") as f:
        data = f.read()
    r = requests.put(
        f"{BLOB_API_URL}/",
        params={"pathname": pathname},
        data=data,
        headers={
            "authorization": f"Bearer {token}",
            "x-api-version": BLOB_API_VERSION,
            "x-vercel-blob-access": "public",
            "x-content-type": content_type,
            "x-add-random-suffix": "1",
        },
        timeout=300,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"Vercel Blob upload failed: HTTP {r.status_code} {r.text[:400]}")
    url = r.json().get("url")
    if not url:
        raise RuntimeError("Vercel Blob upload returned no url")
    return url


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------

def handler(job: dict[str, Any]) -> dict[str, Any]:
    t0 = time.time()

    def progress(msg: str) -> None:
        log(msg)
        try:
            import runpod  # noqa: WPS433  (absent in TEST_LOCAL runs without the SDK)
            runpod.serverless.progress_update(job, msg)
        except Exception:  # noqa: BLE001
            pass

    workdir = tempfile.mkdtemp(prefix="xdipx-")
    image_name = None
    audio_name = None
    try:
        p = validate(job.get("input") or {})
        # Engine switch for mode "s2v" (see the InfiniteTalk block up top). The
        # env is read per job so a bad value fails the job with a clear error
        # instead of crashing the worker at import.
        engine = S2V_ENGINE
        if p["mode"] == "s2v" and engine not in S2V_ENGINES:
            raise ValueError(f"RUNPOD_S2V_ENGINE must be one of {S2V_ENGINES}, got {engine!r}")
        it = p["mode"] == "s2v" and engine == "infinitetalk"

        family = "base"
        if p["mode"] == "s2v":
            family = "infinitetalk" if it else "s2v"
        progress("booting ComfyUI")
        ensure_comfy(family=family)

        if p["mode"] in ("i2v", "s2v"):
            progress("downloading scene frame")
            image_name = download_scene_frame(p["image_url"])

        if p["mode"] == "s2v":
            progress("downloading speech track")
            audio_name = download_audio(p["audio_url"])
            audio_seconds = probe_audio_seconds(os.path.join(COMFY_DIR, "input", audio_name))
            if audio_seconds > S2V_MAX_SECONDS:
                raise ValueError(f"speech track is {audio_seconds:.1f}s, over the {S2V_MAX_SECONDS}s per-render cap; split upstream")
            p["seconds"] = max(1, round(audio_seconds))
            if it:
                p["frames"] = math.ceil(audio_seconds * IT_FPS)
                wf = build_infinitetalk_workflow(p, image_name, audio_name, audio_seconds)
                save_node = IT_SAVE_NODE
                progress(f"rendering s2v via infinitetalk, {p['seconds']}s "
                         f"({p['frames']} frames @ {IT_FPS} fps, seed {p['seed']})")
            else:
                p["frames"] = frames_for(p["seconds"])
                wf = build_s2v_workflow(p, image_name, audio_name, audio_seconds)
                save_node = "15"
                progress(f"rendering s2v {p['seconds']}s ({p['frames']} frames, {p['steps']} steps, seed {p['seed']})")
        else:
            wf = build_workflow(p, image_name)
            save_node = "15"
            progress(f"rendering {p['mode']} {p['seconds']}s ({p['frames']} frames, {p['steps']} steps, seed {p['seed']})")
        prompt_id = submit(wf)
        entry = wait_for(prompt_id, lambda s: progress(f"rendering... {s}s"))
        src = find_output_video(entry, wf[save_node]["inputs"]["filename_prefix"])

        progress("encoding mp4 + last frame")
        # s2v keeps its performed speech track; the silent tiers stay silent.
        # The infinitetalk engine renders at the wrapper's 25 fps: probe the
        # real rate and keep it (report it honestly) rather than forcing 16.
        out_fps: float = FPS
        if it:
            out_fps = probe_video_fps(src)
            mp4, png = postprocess(src, workdir, keep_audio=True,
                                   trim_seconds=audio_seconds, fps=None)
        else:
            mp4, png = postprocess(src, workdir, keep_audio=(p["mode"] == "s2v"),
                                   trim_seconds=(audio_seconds if p["mode"] == "s2v" else None))

        finish_seconds = 0.0
        if p["finish"]:
            progress("finish pass: interpolating to 30 fps + upscaling to 1080p")
            tf = time.time()
            mp4 = finish_pass(mp4, workdir)
            finish_seconds = round(time.time() - tf, 1)

        progress("uploading to Vercel Blob")
        video_url = blob_put(p["blob_token"], f"{p['blob_prefix']}/clip.mp4", mp4, "video/mp4")
        frame_url = blob_put(p["blob_token"], f"{p['blob_prefix']}/last-frame.png", png, "image/png")

        return {
            "videoUrl": video_url,
            "lastFrameUrl": frame_url,
            "width": FINISH_WIDTH if p["finish"] else WIDTH,
            "height": FINISH_HEIGHT if p["finish"] else HEIGHT,
            "fps": FINISH_FPS if p["finish"] else (round(out_fps, 3) if out_fps != int(out_fps) else int(out_fps)),
            "durationSeconds": p["seconds"],
            "seed": p["seed"],
            "renderSeconds": round(time.time() - t0, 1),
            # Split so metered cost stays attributable (generate vs finish).
            "finishSeconds": finish_seconds,
        }
    except Exception as exc:  # noqa: BLE001
        log(f"FAILED: {exc}")
        return {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        for name in (image_name, audio_name):
            if name:
                try:
                    os.remove(os.path.join(COMFY_DIR, "input", name))
                except OSError:
                    pass


if __name__ == "__main__":
    test_file = os.environ.get("TEST_LOCAL")
    if test_file:
        # TEST_LOCAL=/app/test_input.json python handler.py  -> runs the handler once, prints JSON.
        with open(test_file) as f:
            job = json.load(f)
        job.setdefault("id", f"local-{uuid.uuid4().hex[:8]}")
        print(json.dumps(handler(job), indent=2))
    else:
        import runpod
        runpod.serverless.start({"handler": handler})
