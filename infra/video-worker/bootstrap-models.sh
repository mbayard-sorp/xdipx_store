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
#   WITH_INFINITETALK=1 bash bootstrap-models.sh                          # also the InfiniteTalk engine set (+~28.5 GB, needs the volume grown to 150 GB)
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

# ── InfiniteTalk engine set (owner-directed 2026-08-30 after the bake-off) ───
# Kijai-format weights for the ComfyUI-WanVideoWrapper custom nodes that the
# handler's RUNPOD_S2V_ENGINE=infinitetalk path renders through. NOT
# interchangeable with the Comfy-Org files above: the wrapper's own loaders
# (WanVideoTextEncodeCached, WanVideoVAELoader, Wav2VecModelLoader) want the
# kijai -enc- / Wan2_1_VAE_bf16 layouts, so the umt5 and VAE here are second
# copies by design, not duplicates by mistake. URLs and exact byte sizes were
# HEAD-checked live 2026-08-30 (bakeoff/infinitetalk/PIN.md); equality is
# enforced, not a floor, because a resumed curl can silently leave a short file.
#
# Volume math: this set totals 28,534,377,806 bytes (~26.6 GiB). Measured
# 2026-08-29, the 100 GB volume holds ~65 GB of base tiers plus ~16 GB of S2V,
# leaving roughly 19 GB free. THIS SET DOES NOT FIT until the volume is grown
# to 150 GB (the orchestrator handles the growth); the free-space check below
# refuses to start a download that cannot finish.
fetch_exact() {
  # fetch_exact <subdir> <exact_bytes> <url>
  local sub="$1" bytes="$2" url="$3"
  local name dest size
  name="$(basename "${url}")"
  dest="${MODELS_ROOT}/${sub}/${name}"
  mkdir -p "${MODELS_ROOT}/${sub}"
  if [[ -f "${dest}" ]]; then
    size="$(stat -c %s "${dest}")"
    if [[ "${size}" == "${bytes}" ]]; then
      echo "[skip] ${sub}/${name} ($(( bytes / 1024 / 1024 )) MiB)"
      return 0
    fi
    echo "[warn] ${sub}/${name} is ${size} bytes, expected ${bytes}: resuming"
  fi
  echo "[get ] ${sub}/${name} ($(( bytes / 1024 / 1024 )) MiB)"
  curl -L --fail --no-progress-meter --retry 5 --retry-delay 10 -C - \
    ${HF_TOKEN:+-H "Authorization: Bearer ${HF_TOKEN}"} \
    -o "${dest}" "${url}"
  size="$(stat -c %s "${dest}")"
  if [[ "${size}" != "${bytes}" ]]; then
    echo "[FAIL] ${sub}/${name}: got ${size} bytes, expected ${bytes}" >&2
    exit 1
  fi
}

if [ "${WITH_INFINITETALK:-0}" = "1" ]; then
  # Refuse under 30 GB free on the MODELS_ROOT filesystem. Bytes already on
  # disk from this set count as credit so an idempotent re-run passes after
  # the downloads have filled the volume.
  it_files=(
    "diffusion_models/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors"
    "diffusion_models/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors"
    "text_encoders/umt5-xxl-enc-fp8_e4m3fn.safetensors"
    "vae/Wan2_1_VAE_bf16.safetensors"
    "wav2vec2/wav2vec2-chinese-base_fp16.safetensors"
    "loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors"
    "clip_vision/clip_vision_h.safetensors"
  )
  have_kb=0
  for f in "${it_files[@]}"; do
    if [[ -f "${MODELS_ROOT}/${f}" ]]; then
      have_kb=$(( have_kb + $(du -k "${MODELS_ROOT}/${f}" | cut -f1) ))
    fi
  done
  free_kb="$(df -Pk "${MODELS_ROOT}" | awk 'NR==2 {print $4}')"
  need_kb=$(( 30 * 1024 * 1024 ))
  if (( free_kb + have_kb < need_kb )); then
    echo "[FAIL] only $(( free_kb / 1024 / 1024 )) GB free at ${MODELS_ROOT}; the InfiniteTalk set needs ~30 GB." >&2
    echo "       The 100 GB volume has ~19 GB free after the S2V set: grow the volume to 150 GB first, then re-run." >&2
    exit 1
  fi

  # Base Wan2.1 I2V 14B 480p, fp8 scaled (kijai's own repackage).
  fetch_exact diffusion_models 16643349018 \
    "https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/I2V/Wan2_1-I2V-14B-480p_fp8_e4m3fn_scaled_KJ.safetensors"
  # InfiniteTalk single-speaker conditioning module, fp8 scaled.
  fetch_exact diffusion_models 2713548210 \
    "https://huggingface.co/Kijai/WanVideo_comfy_fp8_scaled/resolve/main/InfiniteTalk/Wan2_1-InfiniteTalk-Single_fp8_e4m3fn_scaled_KJ.safetensors"
  # Kijai-format umt5 encoder, fp8 variant (6.3 GiB over the 10.6 GiB bf16).
  fetch_exact text_encoders 6731333792 \
    "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/umt5-xxl-enc-fp8_e4m3fn.safetensors"
  # Kijai-format VAE (254 MB, cheap certainty next to the Comfy-Org one).
  fetch_exact vae 253806278 \
    "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Wan2_1_VAE_bf16.safetensors"
  # chinese-wav2vec2-base as a single safetensors; goes to models/wav2vec2, a
  # wrapper-registered folder name mapped in extra_model_paths.yaml.
  fetch_exact wav2vec2 190115368 \
    "https://huggingface.co/Kijai/wav2vec2_safetensors/resolve/main/wav2vec2-chinese-base_fp16.safetensors"
  # lightx2v cfg+step distill LoRA rank64: the render-proven graph loads it and
  # its 6-step / cfg 1.0 sampling depends on it.
  fetch_exact loras 738005744 \
    "https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors"
  # clip_vision_h for WanVideoClipVisionEncode; nothing else on the volume
  # populates clip_vision/.
  fetch_exact clip_vision 1264219396 \
    "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors"
fi

echo "ComfyUI reads this tree through extra_model_paths.yaml (base_path: ${MODELS_ROOT})."
