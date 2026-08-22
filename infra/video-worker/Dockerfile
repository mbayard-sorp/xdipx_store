# xdipx video worker: Wan 2.2 14B via ComfyUI on RunPod Serverless.
# Models are NOT baked in. They live on the network volume at /runpod-volume/models
# (see bootstrap-models.sh). This image only carries code.
#
# Build (linux/amd64 only, RunPod has no arm64 GPU hosts):
#   docker buildx build --platform linux/amd64 -t ghcr.io/<org>/xdipx-video-worker:<tag> --push .

# Tag verified on hub.docker.com/r/runpod/pytorch/tags 2026-08-22 (CUDA 12.9, torch 2.9.0, Ubuntu 24.04).
FROM runpod/pytorch:1.1.0-cu1290-torch290-ubuntu2404

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

# runpod 1.12.0 is the latest on PyPI as of 2026-08-10 (verified 2026-08-22).
RUN pip install runpod==1.12.0

COPY extra_model_paths.yaml ${COMFY_DIR}/extra_model_paths.yaml
COPY workflows /app/workflows
COPY handler.py /app/handler.py
COPY test_input.json /app/test_input.json

WORKDIR /app
CMD ["python", "-u", "/app/handler.py"]
