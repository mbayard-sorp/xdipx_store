#!/usr/bin/env python3
"""
Runs ON the bake-off pod. Drives the REAL handler.py through its TEST_LOCAL
mode, one case per process, so the production code path (ComfyUI render,
ffmpeg postprocess, Vercel Blob upload) is what gets exercised end to end.

Usage:
  BLOB_TOKEN=... IMAGE_URL=... AUDIO_URL_SHORT=... AUDIO_URL_LONG=... \
    python3 render-matrix.py <matrix.json> <out_dir>

Per case it records the handler's JSON output, wall seconds, and peak GPU
memory (nvidia-smi polled from a thread), appending one line to
<out_dir>/results.jsonl. A case failure never aborts the remaining cases.

The blob token reaches each handler process through an anonymous pipe
(TEST_LOCAL=/proc/self/fd/N), so the job payload is never written to disk.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time

COMFY_DIR = os.environ.get("COMFY_DIR", "/opt/ComfyUI")
WORKER_DIR = os.environ.get("WORKER_DIR", "/root/video-worker")
HANDLER = os.environ.get("HANDLER_PY", os.path.join(WORKER_DIR, "handler.py"))
WORKFLOW_DIR = os.environ.get("WORKFLOW_DIR", os.path.join(WORKER_DIR, "workflows"))
MODELS_ROOT = os.environ.get("MODELS_ROOT", "/runpod-volume/models")
# Handler default is 1500s; the extend-chain case is unmeasured, so widen it.
RENDER_TIMEOUT_S = os.environ.get("RENDER_TIMEOUT_S", "2700")
# Boot + model load + download + upload margin on top of the render timeout.
CASE_TIMEOUT_S = int(RENDER_TIMEOUT_S) + 900


def log(msg: str) -> None:
    print(f"[matrix] {msg}", flush=True)


def resolve(value):
    """'env:NAME' string values come from the environment at run time."""
    if isinstance(value, str) and value.startswith("env:"):
        name = value[4:]
        got = os.environ.get(name, "")
        if not got:
            raise RuntimeError(f"required environment variable {name} is not set")
        return got
    return value


class GpuPoller(threading.Thread):
    """Polls nvidia-smi for peak memory.used (MiB) until stopped."""

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


def parse_trailing_json(lines: list[str]):
    """The handler logs progress lines, then prints its result as the final
    (multi-line, indent=2) JSON object. Parse from the last '{' line."""
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == "{":
            try:
                return json.loads("\n".join(lines[i:]))
            except json.JSONDecodeError:
                continue
    return None


def kill_stale_comfy() -> None:
    """After a boot-shaped failure, clear any wedged ComfyUI so the next case
    starts fresh (a healthy one is intentionally reused across cases)."""
    subprocess.run(["pkill", "-f", "main.py --listen 127.0.0.1"], check=False)
    time.sleep(3)


def run_case(case: dict, run_id: str, out_dir: str) -> dict:
    name = case["name"]
    inp = {k: resolve(v) for k, v in case["input"].items()}
    inp["blobPathPrefix"] = f"bakeoff/{run_id}/{name}"
    job = {"id": f"bakeoff-{name}", "input": inp}
    payload = json.dumps(job).encode()

    env = dict(os.environ)
    env.update({
        "COMFY_DIR": COMFY_DIR,
        "WORKFLOW_DIR": WORKFLOW_DIR,
        "MODELS_ROOT": MODELS_ROOT,
        "RENDER_TIMEOUT_S": RENDER_TIMEOUT_S,
        # ComfyUI outlives each handler process (warm reuse across cases);
        # without this its inherited pipe blocks EOF and then breaks. See
        # ensure_comfy in handler.py.
        "COMFY_LOG": os.path.join(out_dir, "comfyui.log"),
    })

    # Anonymous pipe instead of a job file: the payload (with the blob token)
    # never touches disk. The payload is far below the 64 KiB pipe buffer, so
    # writing before spawn cannot block.
    r, w = os.pipe()
    os.set_inheritable(r, True)
    os.write(w, payload)
    os.close(w)
    # /proc/self/fd on the pod (Linux); /dev/fd keeps local smoke tests working.
    fd_dir = "/proc/self/fd" if os.path.isdir("/proc/self/fd") else "/dev/fd"
    env["TEST_LOCAL"] = f"{fd_dir}/{r}"

    log(f"case {name}: mode={inp['mode']} duration={inp.get('durationSeconds')} "
        f"fast={inp.get('fast')} finish={inp.get('finish')} seed={inp.get('seed')}")

    poller = GpuPoller()
    poller.start()
    t0 = time.time()
    lines: list[str] = []
    timed_out = False
    try:
        proc = subprocess.Popen(
            [sys.executable, "-u", HANDLER],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, env=env, pass_fds=(r,), cwd=os.path.dirname(HANDLER),
        )
    finally:
        os.close(r)

    # Read from a daemon thread and gate the case on process EXIT, not on
    # pipe EOF: the handler's ComfyUI child inherits this stdout pipe and
    # outlives the handler (it is deliberately reused across cases), so the
    # pipe never closes and a plain read loop hangs forever after the first
    # case. proc.wait(timeout) doubles as the hard watchdog.
    assert proc.stdout is not None

    def _reader() -> None:
        for line in proc.stdout:
            line = line.rstrip("\n")
            lines.append(line)
            print(f"  | {line}", flush=True)

    reader = threading.Thread(target=_reader, daemon=True)
    reader.start()
    try:
        proc.wait(timeout=CASE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        proc.wait()
    reader.join(timeout=5)
    wall = round(time.time() - t0, 1)
    poller.stop()
    poller.join(timeout=5)

    output = parse_trailing_json(lines)
    ok = bool(output) and "error" not in (output or {})
    error = None
    if timed_out:
        ok, error = False, f"case exceeded {CASE_TIMEOUT_S}s, handler killed"
    elif output is None:
        ok, error = False, f"no JSON result in handler output (exit {proc.returncode})"
    elif "error" in output:
        error = output["error"]

    if not ok and error and ("did not answer" in error or "exited during boot" in error or timed_out):
        kill_stale_comfy()

    result = {
        "run": run_id,
        "case": name,
        "mode": inp["mode"],
        "ok": ok,
        "error": error,
        "wallSeconds": wall,
        "peakGpuMemMiB": poller.peak_mib,
        "output": output if ok else output,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)),
    }
    with open(os.path.join(out_dir, "results.jsonl"), "a") as f:
        f.write(json.dumps(result) + "\n")
    log(f"case {name}: {'OK' if ok else 'FAILED'} in {wall}s (peak GPU {poller.peak_mib} MiB)")
    return result


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    matrix_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    with open(matrix_path) as f:
        matrix = json.load(f)
    if not os.environ.get("BLOB_TOKEN"):
        print("BLOB_TOKEN is required in the environment", file=sys.stderr)
        return 2

    run_id = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    log(f"run {run_id}: {len(matrix['cases'])} cases, handler {HANDLER}")

    results = []
    last_family = None
    for case in matrix["cases"]:
        # One model family per ComfyUI process: the container cgroup is far
        # smaller than the host (38 GiB observed on a 4090 pod), and a warm
        # server holding the i2v/t2v expert pair gets OOM-killed the moment
        # the s2v checkpoint loads on top. Restart on every family switch.
        family = "s2v" if case["input"].get("mode") == "s2v" else "i2v-t2v"
        if last_family is not None and family != last_family:
            log(f"model family switch ({last_family} -> {family}): restarting ComfyUI")
            kill_stale_comfy()
        last_family = family
        try:
            results.append(run_case(case, run_id, out_dir))
        except Exception as exc:  # a broken case must not sink the rest
            log(f"case {case.get('name')}: harness error: {exc}")
            row = {"run": run_id, "case": case.get("name"), "ok": False,
                   "error": f"harness: {exc}", "wallSeconds": None,
                   "peakGpuMemMiB": None, "output": None}
            with open(os.path.join(out_dir, "results.jsonl"), "a") as f:
                f.write(json.dumps(row) + "\n")
            results.append(row)

    print()
    hdr = f"{'case':<18} {'ok':<4} {'wall s':>7} {'render s':>9} {'finish s':>9} {'peak MiB':>9}  video"
    print(hdr)
    print("-" * len(hdr))
    for row in results:
        out = row.get("output") or {}
        print(f"{row['case']:<18} {str(row['ok']):<4} "
              f"{row.get('wallSeconds') if row.get('wallSeconds') is not None else '-':>7} "
              f"{out.get('renderSeconds', '-'):>9} {out.get('finishSeconds', '-'):>9} "
              f"{row.get('peakGpuMemMiB') if row.get('peakGpuMemMiB') is not None else '-':>9}  "
              f"{out.get('videoUrl', row.get('error') or '-')}")
    failed = sum(1 for row in results if not row["ok"])
    print(f"\n{len(results) - failed}/{len(results)} cases passed; results in {out_dir}/results.jsonl")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
