#!/usr/bin/env bash
# Runs ON the bake-off pod, AFTER ../pod-setup.sh, to add the InfiniteTalk
# challenger lane. Idempotent: every step checks before it acts.
#
# What it does, and the constraints it encodes:
#  - Clones kijai/ComfyUI-WanVideoWrapper at the PINNED sha (PIN.md). A custom
#    node pack that drifts under an autonomous team is a standing hazard; never
#    bump the sha here without updating PIN.md.
#  - Downloads the InfiniteTalk weight set to POD-LOCAL disk (/opt/it-models),
#    NEVER the network volume: only a bake-off winner's weights get promoted.
#    URLs and byte sizes below were resolved via the HF API and HEAD-checked
#    live on 2026-08-30; the size check catches truncated downloads.
#  - Registers /opt/it-models with ComfyUI by appending a second section to
#    /opt/ComfyUI/extra_model_paths.yaml (the volume section from pod-setup
#    stays untouched).
#  - Kills any running ComfyUI at the end: the S2V matrix leaves one running,
#    and custom nodes + model paths are only picked up at boot.
set -euo pipefail

COMFY_DIR="${COMFY_DIR:-/opt/ComfyUI}"
IT_MODELS="${IT_MODELS:-/opt/it-models}"
WRAPPER_DIR="${COMFY_DIR}/custom_nodes/ComfyUI-WanVideoWrapper"
# Pinned main HEAD of kijai/ComfyUI-WanVideoWrapper, recorded 2026-08-30 (PIN.md).
WRAPPER_SHA="${WRAPPER_SHA:-088128b224242e110d3906c6750e9a3a348a659b}"

echo "[it-setup] InfiniteTalk lane setup starting on $(hostname)"

[[ -d "${COMFY_DIR}" ]] || { echo "[FAIL] ${COMFY_DIR} missing: run ../pod-setup.sh first" >&2; exit 1; }

# The whole set is ~28.6 GB on the pod's 40 GB container disk. Refuse to start
# a download that cannot finish.
free_gb="$(df -BG --output=avail /opt | tail -1 | tr -dc '0-9')"
need_gb=30
have_gb="$(du -sBG "${IT_MODELS}" 2>/dev/null | cut -f1 | tr -dc '0-9' || echo 0)"
if (( free_gb + ${have_gb:-0} < need_gb )); then
  echo "[FAIL] only ${free_gb}G free on /opt (need ~${need_gb}G for the InfiniteTalk weights)" >&2
  exit 1
fi

# ── wrapper at the pinned sha ────────────────────────────────────────────────
if [[ -d "${WRAPPER_DIR}/.git" ]]; then
  have_sha="$(git -C "${WRAPPER_DIR}" rev-parse HEAD || echo none)"
else
  have_sha="none"
fi
if [[ "${have_sha}" != "${WRAPPER_SHA}" ]]; then
  echo "[get ] ComfyUI-WanVideoWrapper @ ${WRAPPER_SHA}"
  rm -rf "${WRAPPER_DIR}"
  git clone --quiet https://github.com/kijai/ComfyUI-WanVideoWrapper.git "${WRAPPER_DIR}"
  git -C "${WRAPPER_DIR}" checkout --quiet "${WRAPPER_SHA}"
else
  echo "[skip] wrapper already at ${WRAPPER_SHA}"
fi

# Local patch: transformers>=5 stopped honoring output_hidden_states inside
# Wav2Vec2Encoder.forward (capture moved to decorator machinery the wrapper's
# vendored subclass bypasses), which crashes MultiTalkWav2VecEmbeds with
# "'NoneType' object is not subscriptable". Hook-based capture fixes it on
# both transformers 4.x and 5.x. Idempotent; fails loudly on sha drift.
# See PIN.md "Local patch".
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "${SCRIPT_DIR}/patch-wav2vec2-hf5.py" "${WRAPPER_DIR}/multitalk/wav2vec2.py"

# Wrapper deps. torch comes from the base image and is not in this
# requirements.txt, so no stripping is needed (unlike ComfyUI's own).
pip install -q -r "${WRAPPER_DIR}/requirements.txt"
echo "[ ok ] wrapper python deps installed"

# ── weights, pod-local ───────────────────────────────────────────────────────
# fetch <subdir> <exact_bytes> <url>
# Exact sizes from live HEAD checks 2026-08-30; equality (not a floor) because
# a resumed curl can silently leave a short file.
fetch() {
  local sub="$1" bytes="$2" url="$3"
  local name dest size
  name="$(basename "${url}")"
  dest="${IT_MODELS}/${sub}/${name}"
  mkdir -p "${IT_MODELS}/${sub}"
  if [[ -f "${dest}" ]]; then
    size="$(stat -c %s "${dest}")"
    if [[ "${size}" == "${bytes}" ]]; then
      echo "[skip] ${sub}/${name} ($(( bytes / 1024 / 1024 )) MiB)"
      return 0
    fi
    echo "[warn] ${sub}/${name} is ${size} bytes, expected ${bytes}: resuming"
  fi
  echo "[get ] ${sub}/${name} ($(( bytes / 1024 / 1024 )) MiB)"
  curl -fL --retry 3 --retry-delay 5 -C - -o "${dest}" "${url}"
  size="$(stat -c %s "${dest}")"
  if [[ "${size}" != "${bytes}" ]]; then
    echo "[FAIL] ${sub}/${name}: got ${size} bytes, expected ${bytes}" >&2
    exit 1
  fi
}

# Base Wan2.1 I2V 14B 480p, fp8 scaled (the wrapper's own repackage).
fetch diffusion_models 16643349018 \
  "https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors"
# InfiniteTalk single-speaker conditioning module, fp8 scaled.
fetch diffusion_models 2713548210 \
  "https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/InfiniteTalk/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors"
# Kijai-format umt5 encoder. The volume's umt5_xxl_fp8_e4m3fn_scaled.safetensors
# is the Comfy-Org repackage for ComfyUI's native CLIPLoader; the wrapper's
# WanVideoTextEncodeCached wants the -enc- layout, so this is not a duplicate.
# fp8 variant (6.3 GiB) over bf16 (10.6 GiB) to protect the 40 GB pod disk.
fetch text_encoders 6731333792 \
  "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/umt5-xxl-enc-fp8_e4m3fn.safetensors"
# Kijai-format VAE (same reasoning as the encoder; 254 MB, cheap certainty).
fetch vae 253806278 \
  "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors"
# chinese-wav2vec2-base as a single safetensors (the example's alternative to
# its runtime-download node; goes to models/wav2vec2 per the example's note).
fetch wav2vec2 190115368 \
  "https://huggingface.co/Kijai/wav2vec2_safetensors/resolve/main/wav2vec2-chinese-base_fp16.safetensors"
# lightx2v cfg+step distill LoRA rank64: the example workflow loads it and its
# 6-step / cfg 1.0 sampling depends on it.
fetch loras 738005744 \
  "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors"
# clip_vision_h for the example's WanVideoClipVisionEncode; not on the volume
# (pod-setup's bootstrap never fetches any clip_vision file).
fetch clip_vision 1264219396 \
  "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors"

# ── register the pod-local tree with ComfyUI ─────────────────────────────────
YAML="${COMFY_DIR}/extra_model_paths.yaml"
if ! grep -q '^it_models:' "${YAML}" 2>/dev/null; then
  cat >> "${YAML}" <<EOF

# InfiniteTalk bake-off lane: POD-LOCAL weights, die with the pod (never the
# volume). wav2vec2 is a wrapper-registered folder name; extra keys are fine.
it_models:
  base_path: ${IT_MODELS}/
  diffusion_models: diffusion_models/
  text_encoders: text_encoders/
  vae: vae/
  loras: loras/
  clip_vision: clip_vision/
  wav2vec2: wav2vec2/
EOF
  echo "[ ok ] it_models section appended to extra_model_paths.yaml"
else
  echo "[skip] extra_model_paths.yaml already has the it_models section"
fi

# The S2V matrix intentionally leaves a healthy ComfyUI running; it predates
# the wrapper install and the yaml append, so it must not be reused.
pkill -f 'main.py --listen 127.0.0.1' 2>/dev/null && echo "[ ok ] stale ComfyUI killed (run-infinitetalk.py boots a fresh one)" || true

du -sh "${IT_MODELS}"/* 2>/dev/null || true
echo "[ ok ] InfiniteTalk lane setup complete"
