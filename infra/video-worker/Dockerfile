# xdipx video worker: Wan 2.2 14B via ComfyUI on RunPod Serverless.
# Models are NOT baked in. They live on the network volume at /runpod-volume/models
# (see bootstrap-models.sh). This image only carries code.
#
# Build (linux/amd64 only, RunPod has no arm64 GPU hosts):
#   docker buildx build --platform linux/amd64 -t ghcr.io/<org>/xdipx-video-worker:<tag> --push .

# Pinned by DIGEST: the 1.1.0-cu1290-torch290-ubuntu2404 tag is mutable and was
# rebuilt upstream between 2026-08-22 and 2026-08-30 (python 3.11 -> 3.12,
# pip 26, preinstalled requests 2.34), which broke this build's old requests
# pin. The digest below is the 2026-08-30 rebuild the fixes were verified on.
FROM runpod/pytorch:1.1.0-cu1290-torch290-ubuntu2404@sha256:52079a229dfebb83564090868aa23a190c72baa0cfd0613536249137d598eca0

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COMFY_DIR=/opt/ComfyUI \
    COMFY_PORT=8188 \
    MODELS_ROOT=/runpod-volume/models

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# ComfyUI pinned to release v0.33.1 (commit verified on the GitHub release page, 2025-08-13).
# Native Wan 2.2 nodes (UNETLoader, CLIPLoader type=wan, WanImageToVideo, EmptyHunyuanLatentVideo,
# KSamplerAdvanced, ModelSamplingSD3, CreateVideo, SaveVideo) ship in core, so no custom nodes are
# required. Add pinned custom nodes below if a later phase needs them (one RUN per repo, pinned SHA).
ARG COMFY_SHA=72865f4f27eaf5396f8f36370e0a2be3a9a090ee
RUN git clone https://github.com/comfyanonymous/ComfyUI.git ${COMFY_DIR} \
 && cd ${COMFY_DIR} && git checkout ${COMFY_SHA} \
 && rm -rf .git

# ComfyUI's requirements.txt leaves torch unpinned; the base image already provides torch,
# so install everything else on top without touching it.
RUN cd ${COMFY_DIR} \
 && grep -v -E '^(torch|torchvision|torchaudio)(\b|$)' requirements.txt > /tmp/req.txt \
 && pip install -r /tmp/req.txt

# kijai/ComfyUI-WanVideoWrapper: the custom-node pack behind the InfiniteTalk
# s2v engine (RUNPOD_S2V_ENGINE=infinitetalk). Pinned to the sha recorded in
# bakeoff/infinitetalk/PIN.md; never float to main (node signatures change
# without notice, and bumping the pin means re-running the CPU validation).
# The wrapper is code, not weights: its model set lands on the network volume
# via WITH_INFINITETALK=1 bootstrap-models.sh, so the image stays model-free.
# torch-stripped install like ComfyUI's own requirements above; the wrapper's
# requirements.txt does not currently pin torch, but the grep keeps that true
# if a future pin bump changes it.
ARG WRAPPER_SHA=088128b224242e110d3906c6750e9a3a348a659b
RUN git clone https://github.com/kijai/ComfyUI-WanVideoWrapper.git ${COMFY_DIR}/custom_nodes/ComfyUI-WanVideoWrapper \
 && cd ${COMFY_DIR}/custom_nodes/ComfyUI-WanVideoWrapper && git checkout ${WRAPPER_SHA} \
 && rm -rf .git \
 && grep -v -E '^(torch|torchvision|torchaudio)(\b|$)' requirements.txt > /tmp/wrapper-req.txt \
 && pip install -r /tmp/wrapper-req.txt

# transformers 5.x compatibility patch for the wrapper's vendored wav2vec2
# (hidden-states capture moved to decorator machinery the vendored subclass
# bypasses; see bakeoff/infinitetalk/PIN.md, "Local patch"). The script exits
# non-zero if the pinned file has drifted, which fails the build loudly, by
# design: an unpatched wrapper crashes every infinitetalk render ~15s in.
COPY bakeoff/infinitetalk/patch-wav2vec2-hf5.py /tmp/patch-wav2vec2-hf5.py
RUN python /tmp/patch-wav2vec2-hf5.py ${COMFY_DIR}/custom_nodes/ComfyUI-WanVideoWrapper/multitalk/wav2vec2.py \
 && rm /tmp/patch-wav2vec2-hf5.py

# runpod 1.12.0 is the latest on PyPI as of 2026-08-10 (verified 2026-08-22).
# No requests pin: the base preinstalls a newer requests and pip 26 refuses
# the downgrade (ResolutionImpossible). --ignore-installed cryptography works
# around the base's debian-installed cryptography that pip cannot uninstall.
# Both verified in the live base image 2026-08-30.
RUN pip install --ignore-installed cryptography runpod==1.12.0

COPY extra_model_paths.yaml ${COMFY_DIR}/extra_model_paths.yaml
COPY workflows /app/workflows
COPY handler.py /app/handler.py
COPY test_input.json /app/test_input.json

WORKDIR /app
CMD ["python", "-u", "/app/handler.py"]
