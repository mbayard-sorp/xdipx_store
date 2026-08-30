#!/usr/bin/env python3
"""
Runs ON the bake-off pod, after setup-infinitetalk.sh. Renders one InfiniteTalk
talking-video case through the local ComfyUI and records a results line in the
same shape as ../render-matrix.py, plus "lane": "infinitetalk".

Usage:
  python3 run-infinitetalk.py --image-url URL --audio-url URL \
      --prompt "..." --seed 20260901 --out-dir /root/it-results [--case name] \
      [--width 480] [--height 832] [--frames 0]

Unlike the S2V lane there is no handler.py in the middle: this script boots
ComfyUI itself (the setup step kills the matrix's instance because custom
nodes and model paths only load at boot), submits the filled workflow to
/prompt, polls /history, and copies the output video into --out-dir. Nothing
is uploaded anywhere: outputs are pod-local and the operator scp's them back.

--frames 0 (the default) means auto: ceil(audio_seconds * 25) at the example's
25 fps. MultiTalkWav2VecEmbeds treats num_frames as a maximum and clamps to
the audio length, so a slight overshoot is the designed behavior.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid

import requests

COMFY_DIR = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
COMFY_PORT = int(os.environ.get("COMFY_PORT", "8188"))
COMFY_URL = f"http://127.0.0.1:{COMFY_PORT}"
COMFY_BOOT_TIMEOUT_S = int(os.environ.get("COMFY_BOOT_TIMEOUT_S", "300"))
# InfiniteTalk renders window by window; 12s of audio is ~5 windows. Unmeasured,
# so this is deliberately generous (same reasoning as the S2V matrix widening).
RENDER_TIMEOUT_S = int(os.environ.get("RENDER_TIMEOUT_S", "3600"))
WORKFLOW_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workflow_infinitetalk.json")
FPS = 25  # the example's VHS_VideoCombine frame rate; audio embeds also run at 25

_comfy_proc: subprocess.Popen | None = None


def log(msg: str) -> None:
    print(f"[infinitetalk] {msg}", flush=True)


# ── ComfyUI lifecycle (same pattern as handler.py) ───────────────────────────

def comfy_alive() -> bool:
    try:
        return requests.get(f"{COMFY_URL}/system_stats", timeout=3).status_code == 200
    except requests.RequestException:
        return False


def ensure_comfy() -> None:
    global _comfy_proc
    if comfy_alive():
        return
    log("starting ComfyUI")
    _comfy_proc = subprocess.Popen(
        [sys.executable, "main.py",
         "--listen", "127.0.0.1", "--port", str(COMFY_PORT),
         "--disable-auto-launch", "--dont-print-server"],
        cwd=COMFY_DIR, stdout=sys.stdout, stderr=sys.stderr,
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


# ── GPU peak poller (same as render-matrix.py) ───────────────────────────────

class GpuPoller(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.peak_mib = 0
        self._halt = threading.Event()

    def run(self) -> None:
        while not self._halt.wait(2):
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=10,
                ).stdout
                for line in out.splitlines():
                    line = line.strip()
                    if line.isdigit():
                        self.peak_mib = max(self.peak_mib, int(line))
            except Exception:
                pass

    def stop(self) -> None:
        self._halt.set()


# ── inputs ───────────────────────────────────────────────────────────────────

def download_input(url: str, prefix: str, default_ext: str) -> str:
    """Fetch into ComfyUI's input dir; returns the bare filename Load* expects."""
    path_part = url.split("?")[0].lower()
    ext = default_ext
    for cand in (".png", ".jpg", ".jpeg", ".webp", ".mp3", ".wav", ".flac", ".ogg"):
        if path_part.endswith(cand):
            ext = cand
            break
    name = f"{prefix}-{uuid.uuid4().hex}{ext}"
    dest = os.path.join(COMFY_DIR, "input", name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = requests.get(url, timeout=120, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f"download failed: HTTP {r.status_code} for {url[:120]}")
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


def fill_workflow(image_name: str, audio_name: str, prompt: str,
                  width: int, height: int, seed: int, frames: int) -> dict:
    """Textual placeholder fill. Numeric placeholders are quoted strings in the
    template so the file stays valid JSON; the replacement includes the quotes."""
    with open(WORKFLOW_PATH) as f:
        text = f.read()
    for placeholder, value in (
        ('"__WIDTH__"', str(width)),
        ('"__HEIGHT__"', str(height)),
        ('"__SEED__"', str(seed)),
        ('"__FRAMES_OR_AUTO__"', str(frames)),
        ('"__IMAGE__"', json.dumps(image_name)),
        ('"__AUDIO__"', json.dumps(audio_name)),
        ('"__PROMPT__"', json.dumps(prompt)),
    ):
        if placeholder not in text:
            raise RuntimeError(f"workflow template is missing placeholder {placeholder}")
        text = text.replace(placeholder, value)
    return json.loads(text)


# ── submit + poll (same contract as handler.py) ──────────────────────────────

def submit(wf: dict) -> str:
    r = requests.post(f"{COMFY_URL}/prompt",
                      json={"prompt": wf, "client_id": uuid.uuid4().hex}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"ComfyUI /prompt rejected the workflow: HTTP {r.status_code} {r.text[:600]}")
    body = r.json()
    if body.get("node_errors"):
        raise RuntimeError(f"ComfyUI node errors: {json.dumps(body['node_errors'])[:800]}")
    return body["prompt_id"]


def wait_for(prompt_id: str) -> dict:
    started = time.time()
    last_tick = 0
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
        elapsed = int(time.time() - started)
        if elapsed - last_tick >= 30:
            log(f"rendering... {elapsed}s")
            last_tick = elapsed
        time.sleep(3)
    raise RuntimeError(f"render exceeded {RENDER_TIMEOUT_S}s")


def find_output_video(entry: dict, filename_prefix: str) -> str:
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


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--image-url", required=True)
    ap.add_argument("--audio-url", required=True)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--case", default="infinitetalk")
    # 480x832 is the 9:16 first pass (the example's native area is 640x640 on
    # the 480p-class model); 720x1280 is the stretch goal, try it second.
    ap.add_argument("--width", type=int, default=480)
    ap.add_argument("--height", type=int, default=832)
    ap.add_argument("--frames", type=int, default=0, help="0 = auto from audio duration at 25 fps")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    run_id = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    t0 = time.time()
    poller = GpuPoller()
    poller.start()
    image_name = audio_name = None
    ok, error, output = False, None, None
    try:
        ensure_comfy()
        log("downloading inputs")
        image_name = download_input(args.image_url, "it-frame", ".png")
        audio_name = download_input(args.audio_url, "it-speech", ".wav")
        audio_seconds = probe_audio_seconds(os.path.join(COMFY_DIR, "input", audio_name))
        frames = args.frames or math.ceil(audio_seconds * FPS)
        log(f"case {args.case}: {audio_seconds:.1f}s audio, {frames} frames max, "
            f"{args.width}x{args.height}, seed {args.seed}")

        wf = fill_workflow(image_name, audio_name, args.prompt,
                           args.width, args.height, args.seed, frames)
        prompt_id = submit(wf)
        entry = wait_for(prompt_id)
        src = find_output_video(entry, wf["132"]["inputs"]["filename_prefix"])

        dest = os.path.join(args.out_dir, f"{args.case}-{args.seed}.mp4")
        shutil.copyfile(src, dest)
        ok = True
        output = {
            "videoPath": dest,
            "width": args.width,
            "height": args.height,
            "fps": FPS,
            "durationSeconds": round(audio_seconds, 1),
            "seed": args.seed,
            "renderSeconds": round(time.time() - t0, 1),
        }
        log(f"video: {dest}")
    except Exception as exc:  # a failed case must still write its results line
        error = f"{type(exc).__name__}: {exc}"
        log(f"FAILED: {error}")
    finally:
        poller.stop()
        poller.join(timeout=5)
        for name in (image_name, audio_name):
            if name:
                try:
                    os.remove(os.path.join(COMFY_DIR, "input", name))
                except OSError:
                    pass

    # Same row shape as ../render-matrix.py's results.jsonl, plus "lane", so
    # the two lanes can be compared from one merged file.
    result = {
        "run": run_id,
        "case": args.case,
        "lane": "infinitetalk",
        "mode": "infinitetalk",
        "ok": ok,
        "error": error,
        "wallSeconds": round(time.time() - t0, 1),
        "peakGpuMemMiB": poller.peak_mib,
        "output": output,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
    }
    with open(os.path.join(args.out_dir, "results.jsonl"), "a") as f:
        f.write(json.dumps(result) + "\n")
    log(f"case {args.case}: {'OK' if ok else 'FAILED'} in {result['wallSeconds']}s "
        f"(peak GPU {poller.peak_mib} MiB)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
