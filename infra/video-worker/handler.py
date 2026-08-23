"""
xdipx video worker: RunPod Serverless handler that renders a 9:16 clip with Wan 2.2 14B
through a headless ComfyUI, post-processes with ffmpeg, and uploads to Vercel Blob.

Job input (matches what app/lib/video-pipeline.server.ts will send):
  {
    "prompt": str,
    "negativePrompt": str | null,
    "imageUrl": str | null,        # scene frame, 9:16 portrait; required when mode == "i2v"
    "durationSeconds": int,        # 5..15
    "seed": int | null,
    "steps": int | null,           # default 20 (4 when fast == true)
    "mode": "i2v" | "t2v",
    "aspect": "9:16",              # only 9:16 is supported in Phase 1
    "fast": bool | null,           # use the lightx2v 4-step LoRAs (must be on the volume)
    "blobToken": str,              # Vercel Blob read-write token
    "blobPathPrefix": str          # e.g. "video/<jobId>"
  }

Output on success:
  { videoUrl, lastFrameUrl, width, height, fps, durationSeconds, seed, renderSeconds }
Output on failure:
  { "error": "<clear message>" }

Facts verified 2026-08-22 (see README.md for sources): runpod handler contract and
progress_update, /runpod-volume mount path, ComfyUI /prompt and /history shapes, node
input names at ComfyUI v0.33.1, Vercel Blob PUT contract from the @vercel/blob SDK source.
"""

from __future__ import annotations

import glob
import json
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
COMFY_BOOT_TIMEOUT_S = int(os.environ.get("COMFY_BOOT_TIMEOUT_S", "300"))
RENDER_TIMEOUT_S = int(os.environ.get("RENDER_TIMEOUT_S", "1500"))

# Verified from the @vercel/blob SDK source (packages/blob/src/{api,helpers,put}.ts on main,
# 2026-08-22): PUT {base}/?pathname=<pathname>, base defaults to https://vercel.com/api/blob,
# x-api-version 12. TODO(unverified): the older host form
# https://blob.vercel-storage.com/<pathname> is still widely documented; if the vercel.com
# base ever rejects the request, try BLOB_API_URL=https://blob.vercel-storage.com.
BLOB_API_URL = os.environ.get("BLOB_API_URL", "https://vercel.com/api/blob")
BLOB_API_VERSION = os.environ.get("BLOB_API_VERSION", "12")

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


def ensure_comfy() -> None:
    """Start ComfyUI once per worker and block until /system_stats answers."""
    global _comfy_proc
    if comfy_alive():
        return
    if _comfy_proc is None or _comfy_proc.poll() is not None:
        log("starting ComfyUI")
        _comfy_proc = subprocess.Popen(
            [
                sys.executable, "main.py",
                "--listen", "127.0.0.1",
                "--port", str(COMFY_PORT),
                "--disable-auto-launch",
                "--dont-print-server",
            ],
            cwd=COMFY_DIR,
            stdout=sys.stdout,
            stderr=sys.stderr,
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
    if mode not in ("i2v", "t2v"):
        raise ValueError(f"mode must be 'i2v' or 't2v', got {mode!r}")
    prompt = (inp.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    if inp.get("aspect", "9:16") != "9:16":
        raise ValueError("only aspect '9:16' is supported in Phase 1")
    try:
        seconds = int(inp.get("durationSeconds", 5))
    except (TypeError, ValueError):
        raise ValueError("durationSeconds must be an integer")
    if not MIN_SECONDS <= seconds <= MAX_SECONDS:
        raise ValueError(f"durationSeconds must be {MIN_SECONDS}..{MAX_SECONDS}, got {seconds}")
    image_url = inp.get("imageUrl")
    if mode == "i2v" and not image_url:
        raise ValueError("imageUrl is required for mode 'i2v'")
    if not inp.get("blobToken"):
        raise ValueError("blobToken is required")
    prefix = (inp.get("blobPathPrefix") or "").strip().strip("/")
    if not prefix:
        raise ValueError("blobPathPrefix is required")
    # Default to the 4-step lightx2v path: the 20-step path does not finish inside
    # the timeout on 24GB cards (measured 2026-08-22). Send fast: false to opt out.
    fast = inp.get("fast")
    fast = True if fast is None else bool(fast)
    steps = inp.get("steps")
    steps = int(steps) if steps else (FAST_STEPS if fast else DEFAULT_STEPS)
    if not 1 <= steps <= 60:
        raise ValueError("steps must be 1..60")
    seed = inp.get("seed")
    seed = int(seed) if seed is not None else random.randint(0, 2**32 - 1)
    return {
        "mode": mode,
        "prompt": prompt,
        "negative": (inp.get("negativePrompt") or "").strip(),
        "image_url": image_url,
        "seconds": seconds,
        "frames": frames_for(seconds),
        "steps": steps,
        "seed": seed,
        "fast": fast,
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


def build_workflow(p: dict[str, Any], image_name: str | None) -> dict[str, Any]:
    path = os.path.join(WORKFLOW_DIR, f"wan22_{p['mode']}_916.json")
    with open(path) as f:
        wf = json.load(f)

    wf["5"]["inputs"]["text"] = p["prompt"]
    wf["6"]["inputs"]["text"] = p["negative"]
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


class ComfyDied(RuntimeError):
    """ComfyUI stopped answering mid-render (typically the host OOM killer)."""


def free_models() -> None:
    """Ask ComfyUI to drop every staged model. Without this a warm worker keeps
    ~20 GB of Wan weights resident in system RAM between jobs, and the next
    job's load pushes a 31 GB host into the OOM killer (seen live 2026-08-22)."""
    try:
        requests.post(f"{COMFY_URL}/free", json={"unload_models": True, "free_memory": True}, timeout=30)
    except Exception:  # noqa: BLE001
        pass


def render(wf: dict[str, Any], on_tick) -> dict[str, Any]:
    """Submit + wait, rebooting ComfyUI and resubmitting once if it dies."""
    global _comfy_proc
    for attempt in (1, 2):
        try:
            return wait_for(submit(wf), on_tick)
        except ComfyDied as exc:
            if attempt == 2:
                raise
            log(f"ComfyUI died mid-render ({exc}); rebooting and retrying once")
            if _comfy_proc is not None and _comfy_proc.poll() is None:
                _comfy_proc.kill()
            _comfy_proc = None
            ensure_comfy()
    raise RuntimeError("unreachable")


def wait_for(prompt_id: str, on_tick) -> dict[str, Any]:
    started = time.time()
    while time.time() - started < RENDER_TIMEOUT_S:
        try:
            r = requests.get(f"{COMFY_URL}/history/{prompt_id}", timeout=30)
        except requests.ConnectionError as exc:
            raise ComfyDied(str(exc)[:200]) from exc
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


def postprocess(src: str, workdir: str) -> tuple[str, str]:
    mp4 = os.path.join(workdir, "clip.mp4")
    png = os.path.join(workdir, "last-frame.png")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src,
         "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", str(FPS), mp4])
    # -sseof -0.07 lands inside the final 16 fps frame; -update 1 writes a single image.
    run(["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-0.07", "-i", mp4,
         "-frames:v", "1", "-update", "1", png])
    return mp4, png


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
    try:
        p = validate(job.get("input") or {})
        progress("booting ComfyUI")
        ensure_comfy()

        if p["mode"] == "i2v":
            progress("downloading scene frame")
            image_name = download_scene_frame(p["image_url"])

        wf = build_workflow(p, image_name)
        progress(f"rendering {p['mode']} {p['seconds']}s ({p['frames']} frames, {p['steps']} steps, seed {p['seed']})")
        entry = render(wf, lambda s: progress(f"rendering... {s}s"))
        src = find_output_video(entry, wf["15"]["inputs"]["filename_prefix"])

        progress("encoding mp4 + last frame")
        mp4, png = postprocess(src, workdir)

        progress("uploading to Vercel Blob")
        video_url = blob_put(p["blob_token"], f"{p['blob_prefix']}/clip.mp4", mp4, "video/mp4")
        frame_url = blob_put(p["blob_token"], f"{p['blob_prefix']}/last-frame.png", png, "image/png")

        return {
            "videoUrl": video_url,
            "lastFrameUrl": frame_url,
            "width": WIDTH,
            "height": HEIGHT,
            "fps": FPS,
            "durationSeconds": p["seconds"],
            "seed": p["seed"],
            "renderSeconds": round(time.time() - t0, 1),
        }
    except Exception as exc:  # noqa: BLE001
        log(f"FAILED: {exc}")
        return {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        free_models()
        shutil.rmtree(workdir, ignore_errors=True)
        if image_name:
            try:
                os.remove(os.path.join(COMFY_DIR, "input", image_name))
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
