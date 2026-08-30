#!/usr/bin/env bash
# Runs ON the bake-off pod (root, runpod/pytorch base). Idempotent: every step
# checks before it acts, so re-running after a partial failure is safe.
#
# The base image is runpod/pytorch:1.1.0-cu1290-torch290-ubuntu2404, the same
# base the worker Dockerfile uses, so torch/torchvision/torchaudio are already
# correct and MUST NOT be reinstalled by ComfyUI's requirements.txt.
#
# Expects the repo's infra/video-worker/ tree at /root/video-worker (scp'd by
# run-bakeoff.sh).
set -euo pipefail

WORKER_DIR="${WORKER_DIR:-/root/video-worker}"
COMFY_DIR="${COMFY_DIR:-/opt/ComfyUI}"
# Pinned to the worker Dockerfile's COMFY_SHA (ComfyUI v0.33.1).
COMFY_SHA="${COMFY_SHA:-72865f4f27eaf5396f8f36370e0a2be3a9a090ee}"

echo "[setup] pod-setup starting on $(hostname)"

# The volume mounts at /workspace on pods; the worker code and
# extra_model_paths.yaml expect /runpod-volume.
if [[ ! -d /workspace ]]; then
  echo "[FAIL] /workspace is missing: the network volume is not mounted on this pod" >&2
  exit 1
fi
ln -sfn /workspace /runpod-volume
echo "[ ok ] /runpod-volume -> /workspace"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[get ] ffmpeg"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ffmpeg git ca-certificates curl
else
  echo "[skip] ffmpeg already installed"
fi

if [[ -d "${COMFY_DIR}/.git" ]]; then
  have_sha="$(git -C "${COMFY_DIR}" rev-parse HEAD || echo none)"
else
  have_sha="none"
fi
if [[ "${have_sha}" != "${COMFY_SHA}" ]]; then
  echo "[get ] ComfyUI @ ${COMFY_SHA}"
  rm -rf "${COMFY_DIR}"
  git clone --quiet https://github.com/comfyanonymous/ComfyUI.git "${COMFY_DIR}"
  git -C "${COMFY_DIR}" checkout --quiet "${COMFY_SHA}"
else
  echo "[skip] ComfyUI already at ${COMFY_SHA}"
fi

# The base image provides torch; requirements.txt leaves it unpinned, so strip
# it exactly the way the Dockerfile does. The runpod base sometimes ships a
# distutils-installed cryptography that pip cannot uninstall, hence the
# --ignore-installed retry (same gotcha the Dockerfile notes).
#
# Ubuntu 24.04 marks the system python externally managed (PEP 668); the
# Dockerfile's bare pip works because docker RUN sees the image's build env,
# but an SSH shell does not. The torch python IS the system python here, so
# override the marker rather than building a venv without torch.
export PIP_BREAK_SYSTEM_PACKAGES=1
python3 -c 'import torch, sys; print("[ ok ] torch", torch.__version__, "on", sys.executable)' \
  || { echo "[fail] this python has no torch; wrong interpreter for the worker"; exit 1; }
grep -v -E '^(torch|torchvision|torchaudio)(\b|$)' "${COMFY_DIR}/requirements.txt" > /tmp/req.txt
if ! pip install -q -r /tmp/req.txt; then
  echo "[warn] pip install failed, retrying with --ignore-installed cryptography"
  pip install -q --ignore-installed cryptography -r /tmp/req.txt
fi
pip install -q requests
echo "[ ok ] python deps installed"

# The Dockerfile installs this into the ComfyUI root; ComfyUI loads it at boot
# and finds the volume models through it.
cp "${WORKER_DIR}/extra_model_paths.yaml" "${COMFY_DIR}/extra_model_paths.yaml"
echo "[ ok ] extra_model_paths.yaml installed"

# Idempotent: only fetches what the volume is missing. This run loads the S2V
# set for the first time (~16 GB); everything else should be a [skip].
MODELS_ROOT=/workspace/models WITH_S2V=1 WITH_LIGHTX2V=1 bash "${WORKER_DIR}/bootstrap-models.sh"

# Sanity: every model the matrix touches must exist at a plausible size.
# Floors are ~90% of the wire sizes noted in bootstrap-models.sh.
check() {
  # check <relpath> <min_bytes>
  local rel="$1" min="$2"
  local path="/workspace/models/${rel}"
  if [[ ! -s "${path}" ]]; then
    echo "[FAIL] missing model: ${rel}" >&2
    return 1
  fi
  local size
  size="$(stat -c %s "${path}")"
  if (( size < min )); then
    echo "[FAIL] ${rel} is ${size} bytes, below the ${min} floor (truncated download?)" >&2
    return 1
  fi
  echo "[ ok ] ${rel} ($(( size / 1024 / 1024 )) MiB)"
}

fail=0
check text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors                 6000000000 || fail=1
check vae/wan_2.1_vae.safetensors                                           220000000 || fail=1
check diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors   13000000000 || fail=1
check diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors    13000000000 || fail=1
check diffusion_models/wan2.2_s2v_14B_fp8_scaled.safetensors              13500000000 || fail=1
check audio_encoders/wav2vec2_large_english_fp16.safetensors                400000000 || fail=1
check loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors      1000000000 || fail=1
check loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors       1000000000 || fail=1
if (( fail )); then
  echo "[FAIL] model sanity check failed" >&2
  exit 1
fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
echo "[ ok ] pod-setup complete"
