#!/usr/bin/env bash
# Idempotent one-time download of the Wan 2.2 14B model set onto the RunPod network volume.
# Run this ONCE from a temporary pod that has the volume mounted (see README.md). Serverless
# workers never download; they only read from /runpod-volume/models.
#
# Every file name below was verified against the Hugging Face tree pages on 2026-08-22:
#   https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/{diffusion_models,text_encoders,vae,loras}
#
# Usage:
#   MODELS_ROOT=/runpod-volume/models bash bootstrap-models.sh            # core set (~36 GB)
#   WITH_LIGHTX2V=1 bash bootstrap-models.sh                              # also the 4-step LoRAs (+~5 GB)
#   WITH_S2V=1 bash bootstrap-models.sh                                   # also the audio-driven talking set (+~15 GB)
#   SKIP_T2V=1 bash bootstrap-models.sh                                   # i2v only (-~28 GB)
set -euo pipefail

MODELS_ROOT="${MODELS_ROOT:-/runpod-volume/models}"
HF_BASE="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"

mkdir -p "${MODELS_ROOT}"/{diffusion_models,text_encoders,vae,loras,clip_vision}
# Reserved for Phase 2 style/motion LoRAs. Nothing is written here by this script.
touch "${MODELS_ROOT}/loras/.keep"

fetch() {
  # fetch <subdir> <filename>
  local sub="$1" name="$2"
  local dest="${MODELS_ROOT}/${sub}/${name}"
  if [[ -s "${dest}" && ! -f "${dest}.partial" ]]; then
    echo "[skip] ${sub}/${name} already present"
    return 0
  fi
  echo "[get ] ${sub}/${name}"
  touch "${dest}.partial"
  # -C - resumes an interrupted download; HF_TOKEN is optional (these repos are public).
  # --no-progress-meter, not -s: errors still print, but the per-second progress bar does not.
  # One 15 GB checkpoint otherwise buries the log in ~29 KB of redraw spam, which is how a real
  # failure goes unnoticed.
  curl -L --fail --no-progress-meter --retry 5 --retry-delay 10 -C - \
    ${HF_TOKEN:+-H "Authorization: Bearer ${HF_TOKEN}"} \
    -o "${dest}" "${HF_BASE}/${sub}/${name}"
  rm -f "${dest}.partial"
  echo "[done] ${sub}/${name} ($(du -h "${dest}" 2>/dev/null | cut -f1))"
}

# Shared: text encoder + VAE. Wan 2.2 14B uses the Wan 2.1 VAE (the 2.2 VAE is for the 5B ti2v model).
fetch text_encoders umt5_xxl_fp8_e4m3fn_scaled.safetensors      # 6.74 GB
fetch vae           wan_2.1_vae.safetensors                      # 254 MB

# I2V 14B, fp8 scaled, two-expert (high noise / low noise) scheme.
fetch diffusion_models wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors   # 14.3 GB
fetch diffusion_models wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors    # 14.3 GB

# T2V 14B, fp8 scaled.
if [[ -z "${SKIP_T2V:-}" ]]; then
  fetch diffusion_models wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors # 14.3 GB
  fetch diffusion_models wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors  # 14.3 GB
fi

# Optional: lightx2v 4-step distillation LoRAs (handler input `fast: true`). Cuts render time ~5x
# at some quality cost. Same HF repo, split_files/loras.
if [[ -n "${WITH_LIGHTX2V:-}" ]]; then
  fetch loras wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors   # 1.23 GB
  fetch loras wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors    # 1.23 GB
  if [[ -z "${SKIP_T2V:-}" ]]; then
    fetch loras wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors # 1.23 GB
    fetch loras wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors  # 1.23 GB
  fi
fi

echo
echo "Done. Contents of ${MODELS_ROOT}:"
du -sh "${MODELS_ROOT}"/* 2>/dev/null || true
echo

# Audio-driven talking set (tickets #5713/#5714): the Wan 2.2 S2V checkpoint
# plus the wav2vec2 audio encoder. The umt5 text encoder and wan_2.1 VAE above
# are shared. Volume math, measured on the volume 2026-08-29 rather than
# estimated: diffusion_models was already 54 GB, loras 4.6 GB, text_encoders
# 6.3 GB, vae 0.24 GB, so ~65 GB of the 100 GB volume before this block. The
# checkpoint is 15.2 GB on the wire (not the 14.3 GB previously noted here) and
# the encoder ~0.6 GB, leaving roughly 19 GB spare. A second talking model
# (InfiniteTalk, LongCat-Video-Avatar) does NOT fit alongside this one without
# growing the volume — worth knowing before planning a three-way bake-off.
if [ "${WITH_S2V:-0}" = "1" ]; then
  mkdir -p "${MODELS_ROOT}/audio_encoders"
  fetch diffusion_models wan2.2_s2v_14B_fp8_scaled.safetensors             # 15.2 GB
  fetch audio_encoders   wav2vec2_large_english_fp16.safetensors           # ~0.6 GB
fi

echo "ComfyUI reads this tree through extra_model_paths.yaml (base_path: ${MODELS_ROOT})."
