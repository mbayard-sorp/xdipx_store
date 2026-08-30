#!/usr/bin/env python3
"""Collect a render that outlived its handler.

The handler's in-band RENDER_TIMEOUT_S can expire while ComfyUI keeps
rendering the submitted prompt (killing the handler does not kill its
detached ComfyUI child). This waits for the CURRENTLY RUNNING prompt to
finish, then runs the same postprocess + Blob upload the handler would
have, and appends a results.jsonl row so the bake-off record stays whole.

Usage (on the pod):
  BLOB_TOKEN=... python3 salvage-render.py <case-name> <audio-seconds> \
      <blob-prefix> <out-dir> [max-wait-seconds]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.environ.get("WORKER_DIR", "/root/video-worker"))
import handler  # noqa: E402


def main() -> int:
    case, audio_seconds, prefix, out_dir = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
    max_wait = int(sys.argv[5]) if len(sys.argv) > 5 else 7200
    token = os.environ["BLOB_TOKEN"]

    import requests
    q = requests.get(f"{handler.COMFY_URL}/queue", timeout=10).json()
    running = q.get("queue_running") or []
    if not running:
        print("no running prompt; checking history for the newest entry")
        hist = requests.get(f"{handler.COMFY_URL}/history", timeout=10).json()
        if not hist:
            print("nothing to salvage")
            return 1
        prompt_id = list(hist.keys())[-1]
    else:
        prompt_id = running[0][1]
    print(f"salvaging prompt {prompt_id} for case {case}")

    t0 = time.time()
    entry = None
    while time.time() - t0 < max_wait:
        r = requests.get(f"{handler.COMFY_URL}/history/{prompt_id}", timeout=30)
        e = r.json().get(prompt_id) if r.status_code == 200 else None
        if e:
            status = e.get("status") or {}
            if status.get("status_str") == "error":
                print(f"prompt errored: {json.dumps(status)[:500]}")
                return 1
            if e.get("outputs"):
                entry = e
                break
        elapsed = int(time.time() - t0)
        if elapsed % 60 < 5:
            print(f"waiting on render... {elapsed}s", flush=True)
        time.sleep(5)
    if entry is None:
        print(f"render did not finish within {max_wait}s")
        return 1

    src = handler.find_output_video(entry, "")
    print(f"render done, output {src}")
    workdir = tempfile.mkdtemp(prefix="salvage-")
    mp4, png = handler.postprocess(src, workdir, keep_audio=True, trim_seconds=audio_seconds)
    video_url = handler.blob_put(token, f"{prefix}/clip.mp4", mp4, "video/mp4")
    frame_url = handler.blob_put(token, f"{prefix}/last-frame.png", png, "image/png")

    row = {
        "run": "salvage",
        "case": case,
        "mode": "s2v",
        "ok": True,
        "error": None,
        "wallSeconds": None,
        "peakGpuMemMiB": None,
        "output": {
            "videoUrl": video_url,
            "lastFrameUrl": frame_url,
            "width": handler.WIDTH,
            "height": handler.HEIGHT,
            "fps": handler.FPS,
            "durationSeconds": round(audio_seconds),
            "note": "collected by salvage-render.py after the handler's in-band timeout",
        },
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "results.jsonl"), "a") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row["output"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
