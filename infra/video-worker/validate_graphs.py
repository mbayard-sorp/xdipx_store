#!/usr/bin/env python3
"""Check every ComfyUI graph this worker builds against a LIVE /object_info.

Why this exists
---------------
`build_s2v_workflow` shipped to main carrying a `TODO(verify)` that said, correctly,
that its node names had never been exercised against a live ComfyUI. Nothing enforced
that comment, so the code merged anyway, and the 2026-08-29 bake-off found it could not
have run: it invented three inputs that do not exist on `WanSoundImageToVideo`, omitted
the `AudioEncoderEncode` node that produces the audio embedding, and skipped
`ModelSamplingSD3`. Finding that cost a multi-hour GPU expedition and about $1.

None of it needed a GPU. ComfyUI boots on CPU with no models at all and will happily
report every node signature it implements. This script asks it, and compares the answer
against the graphs the handler actually builds — so the same class of bug fails in CI,
in about a minute, for free.

It drives the real builders out of handler.py rather than a copy of them, so it keeps
telling the truth as the handler changes.

Usage:  COMFY_URL=http://127.0.0.1:8188 python3 validate_graphs.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

COMFY_URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
HERE = os.path.dirname(os.path.abspath(__file__))

def load_handler():
    """Import handler.py, with the environment it expects inside the container.

    Deliberately lazy. handler.py imports `requests` at module scope, and --self-test
    runs in CI before anything is pip-installed: the self-test proves the checker can
    fail and must not need the handler, ComfyUI, or any third-party package to say so.
    """
    # handler.py reads MODELS_ROOT at import time and the `fast` path stats its LoRA
    # files. Point it at a temp tree with the expected names so that branch can be built
    # and checked without downloading 5 GB of weights.
    fake_models = tempfile.mkdtemp(prefix="xdipx-validate-")
    os.environ.setdefault("MODELS_ROOT", fake_models)
    os.makedirs(os.path.join(fake_models, "loras"), exist_ok=True)

    # WORKFLOW_DIR defaults to the container path /app/workflows; outside the image the
    # templates sit next to this file.
    os.environ.setdefault("WORKFLOW_DIR", os.path.join(HERE, "workflows"))

    sys.path.insert(0, HERE)
    import handler  # noqa: PLC0415  (import after the env above is set, by design)

    for pair in handler.LIGHTX2V_LORAS.values():
        for name in pair:
            open(os.path.join(os.environ["MODELS_ROOT"], "loras", name), "a").close()

    return handler


def fetch_object_info(retries: int = 60, delay: float = 2.0) -> dict:
    """ComfyUI takes a few seconds to import its node packs; wait rather than flake."""
    last = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(f"{COMFY_URL}/object_info",
                                         headers={"user-agent": "xdipx-validate"})
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode())
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(delay)
    sys.exit(f"could not reach ComfyUI at {COMFY_URL}: {last}")


def base_params(mode: str, fast: bool = False) -> dict:
    return {
        "mode": mode,
        "prompt": "a validation prompt",
        "negative": "text, watermark",
        "frames": 81,
        "steps": 20,
        "seed": 1234,
        "fast": fast,
    }


def graphs_to_check() -> list[tuple[str, dict]]:
    """Every graph the worker can submit, built by the handler's own code."""
    handler = load_handler()
    out: list[tuple[str, dict]] = []

    # s2v: short speech (single chunk) and long speech (extend chain) are different
    # graphs, and fast=true grafts the lightning LoRA in front of the shift patch.
    for label, seconds in (("s2v single-chunk", 3.0), ("s2v extend-chain", 12.0)):
        for fast in (False, True):
            p = base_params("s2v", fast)
            out.append((f"{label}{' fast' if fast else ''}",
                        handler.build_s2v_workflow(p, "frame.png", "speech.wav", seconds)))

    # i2v / t2v, plain and with the lightx2v LoRAs (whose input names carry their own
    # TODO(verify) in handler.py).
    for mode in ("i2v", "t2v"):
        for fast in (False, True):
            label = f"{mode}{' fast' if fast else ''}"
            image = "frame.png" if mode == "i2v" else None
            out.append((label, handler.build_workflow(base_params(mode, fast), image)))

    return out


def check_graph(label: str, graph: dict, info: dict) -> list[str]:
    problems: list[str] = []

    for node_id, node in graph.items():
        cls = node.get("class_type")
        if cls not in info:
            problems.append(f"[{label}] node {node_id}: class {cls!r} does not exist")
            continue

        spec = info[cls].get("input", {})
        valid = set(spec.get("required", {})) | set(spec.get("optional", {}))
        for field, value in node.get("inputs", {}).items():
            if field not in valid:
                problems.append(
                    f"[{label}] node {node_id} ({cls}): input {field!r} does not exist. "
                    f"required={sorted(spec.get('required', {}))} "
                    f"optional={sorted(spec.get('optional', {}))}"
                )
            # A link is [node_id, output_index]; the target node must be in the graph.
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                if value[0] not in graph:
                    problems.append(
                        f"[{label}] node {node_id} ({cls}): input {field!r} links to "
                        f"node {value[0]!r}, which is not in the graph"
                    )

        # Every required input must be supplied, either as a literal or a link.
        supplied = set(node.get("inputs", {}))
        for field in spec.get("required", {}):
            if field not in supplied:
                problems.append(
                    f"[{label}] node {node_id} ({cls}): required input {field!r} is missing"
                )

    return problems


# The exact WanSoundImageToVideo signature at COMFY_SHA, used only by --self-test.
_REAL_S2V_SCHEMA = {
    "WanSoundImageToVideo": {
        "input": {
            "required": {"positive": [], "negative": [], "vae": [], "width": [],
                         "height": [], "length": [], "batch_size": []},
            "optional": {"audio_encoder_output": [], "ref_image": [],
                         "control_video": [], "ref_motion": []},
        }
    }
}

# What build_s2v_workflow used to send. Kept as a fixture so the checker is proven to
# reject it: a gate that cannot fail is what let the original bug merge in the first place.
_KNOWN_BAD = {
    "8": {"class_type": "WanSoundImageToVideo",
          # Literals rather than links, so the only problems reported are the three
          # invented inputs and nothing else clouds the signal.
          "inputs": {"positive": 0, "negative": 0, "vae": 0, "ref_image": 0,
                     "width": 720, "height": 1280, "length": 97, "batch_size": 1,
                     "audio": 0, "audio_encoder": 0, "chunk_length": 77}},
}


def self_test() -> None:
    """Prove the checker rejects the graph the bake-off found, without a ComfyUI."""
    problems = check_graph("known-bad", _KNOWN_BAD, _REAL_S2V_SCHEMA)
    phantom = [p for p in problems
               if any(f"input {f!r}" in p for f in ("audio", "audio_encoder", "chunk_length"))]
    if len(phantom) < 3:
        print("SELF-TEST FAILED: the checker did not reject the known-bad s2v graph.")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print(f"self-test ok: known-bad graph rejected with {len(problems)} problem(s), "
          f"{len(phantom)} of them phantom inputs")


def main() -> None:
    if "--self-test" in sys.argv:
        self_test()
        return
    info = fetch_object_info()
    print(f"ComfyUI at {COMFY_URL} exposes {len(info)} node classes\n")

    all_problems: list[str] = []
    for label, graph in graphs_to_check():
        problems = check_graph(label, graph, info)
        status = "FAIL" if problems else "ok"
        print(f"  {status:<4} {label:<20} {len(graph):>2} nodes")
        all_problems.extend(problems)

    if all_problems:
        print(f"\n{len(all_problems)} problem(s):\n")
        for p in all_problems:
            print(f"  - {p}")
        print("\nThe graph would fail AFTER a worker boots and loads weights, which is why "
              "this check exists. Fix the builder in handler.py.")
        sys.exit(1)

    print("\nevery node class, input name, and internal link resolves against the live schema")


if __name__ == "__main__":
    main()
