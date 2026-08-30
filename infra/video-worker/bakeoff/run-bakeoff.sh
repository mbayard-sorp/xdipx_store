#!/usr/bin/env bash
# LOCAL driver for the video-worker bake-off. Creates a temporary RunPod GPU
# pod (base image host-cached on RunPod, so no GHCR pull, which is what killed
# the last attempt), sets it up with pod-setup.sh, drives the REAL handler.py
# through render-matrix.py, pulls the results back, and ALWAYS terminates the
# pod on exit.
#
# Usage:
#   IMAGE_URL=... AUDIO_URL_SHORT=... AUDIO_URL_LONG=... bash run-bakeoff.sh
#   bash run-bakeoff.sh --dry-run     # print the pod-create payload, no POST
#
# RUNPOD_API_KEY and the Blob token (BLOB_READ_WRITE_TOKEN or
# XDIPX_READ_WRITE_TOKEN) come from the environment or the repo root .env /
# .env.local. Asset URLs come from make-test-assets.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# api.runpod.io is the management REST v2 API (pods live here); api.runpod.ai
# hosts only the serverless job endpoints. Easy to conflate, they 404 politely.
API="https://api.runpod.io/v2"
POD_IMAGE="runpod/pytorch:1.1.0-cu1290-torch290-ubuntu2404"
VOLUME_ID="${VOLUME_ID:-q167g3em77}"
DATACENTER="${DATACENTER:-US-IL-1}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/runpod_ed25519}"
# Preference order. 24 GB 4090 last: whether 720x1280 S2V fits in 24 GB is
# itself a bake-off datum, but prefer not to confound the first render.
GPUS=("NVIDIA L40S" "NVIDIA L40" "NVIDIA RTX 6000 Ada Generation" "NVIDIA GeForce RTX 4090")
# The slow-host trap: a pod that is not SSH-reachable in ~8 minutes gets
# terminated and re-rolled, never waited out (a 0.6 MB/s host once ate a run).
SSH_DEADLINE_S=480
MAX_ROLLS=3
POD_DISK_GB=40

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

POD_ID=""
POD_RATE="0"
POD_CREATED_AT=0
CUM_COST_USD="0"
RUN_T0=$(date +%s)

log()  { echo "[bakeoff] $*"; }
die()  { echo "[bakeoff] FATAL: $*" >&2; exit 1; }

# Read one key from the environment, then .env, then .env.local. Never echoes
# the value.
resolve_secret() {
  local out_var="$1"; shift
  local name val
  for name in "$@"; do
    val="${!name:-}"
    if [[ -z "${val}" ]]; then
      val="$(grep -h -m1 "^${name}=" "${REPO_ROOT}/.env" "${REPO_ROOT}/.env.local" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
    fi
    if [[ -n "${val}" ]]; then
      printf -v "${out_var}" '%s' "${val}"
      return 0
    fi
  done
  return 1
}

api() {
  # api <method> <path> [json-body]; response body lands in API_BODY and the
  # HTTP code in API_CODE. Globals, not stdout: a command-substitution caller
  # would run this in a subshell and lose both.
  local method="$1" path="$2" data="${3:-}"
  local tmp
  tmp="$(mktemp)"
  if [[ -n "${data}" ]]; then
    API_CODE="$(curl -sS -o "${tmp}" -w '%{http_code}' -X "${method}" \
      -H "Authorization: Bearer ${RUNPOD_API_KEY}" -H "Content-Type: application/json" \
      -d "${data}" "${API}${path}")" || API_CODE=000
  else
    API_CODE="$(curl -sS -o "${tmp}" -w '%{http_code}' -X "${method}" \
      -H "Authorization: Bearer ${RUNPOD_API_KEY}" "${API}${path}")" || API_CODE=000
  fi
  API_BODY="$(cat "${tmp}")"
  rm -f "${tmp}"
}

build_payload() {
  # build_payload <gpu-id>; payload JSON on stdout. Field names verified
  # against https://api.runpod.io/v2/openapi.json (CreatePodRequest) 2026-08-30.
  local gpu="$1"
  PUBKEY="$(cat "${SSH_KEY}.pub")" GPU_ID="${gpu}" POD_IMAGE="${POD_IMAGE}" \
  VOLUME_ID="${VOLUME_ID}" DATACENTER="${DATACENTER}" POD_DISK_GB="${POD_DISK_GB}" \
  python3 - <<'PY'
import json, os, time
print(json.dumps({
    # env.PUBLIC_KEY + startSsh + ports 22/tcp = direct SSH with OUR key on the
    # pod's public ip/port mapping (ssh.direct in the pod GET). Setting
    # PUBLIC_KEY explicitly means account-registered keys are not required.
    "name": f"xdipx-bakeoff-{time.strftime('%Y%m%d-%H%M%S')}",
    "image": os.environ["POD_IMAGE"],
    "disk": int(os.environ["POD_DISK_GB"]),
    "ports": ["22/tcp"],
    "env": {"PUBLIC_KEY": os.environ["PUBKEY"].strip()},
    "startSsh": True,
    "cloud": "SECURE",
    "dataCenterIds": [os.environ["DATACENTER"]],
    # The image torch is cu129; hosts reporting an older driver (12.4 is
    # common in US-IL-1) never start the container, which presents as a pod
    # stuck RUNNING with no SSH and uptime 0. Same pin the endpoint carries.
    "gpu": {"id": os.environ["GPU_ID"], "count": 1, "minCudaVersion": "12.9"},
    # The volume mounts at /workspace on pods; pod-setup.sh symlinks
    # /runpod-volume onto it.
    "mounts": {"network": [{"volumeId": os.environ["VOLUME_ID"], "path": "/workspace"}]},
}, indent=2))
PY
}

pod_field() {
  # pod_field <json> <python-expr over p>
  python3 -c 'import json,sys; p=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2"
}

list_pod_count() {
  api GET /pods
  [[ "${API_CODE}" == "200" ]] || die "could not list pods (HTTP ${API_CODE}): ${API_BODY}"
  python3 -c 'import json,sys; p=json.loads(sys.argv[1])["pods"]; print(len(p)); [print("  {} {} {}".format(x["id"], x["name"], x["status"]), file=sys.stderr) for x in p]' "${API_BODY}"
}

accrue_pod_cost() {
  # Adds the current pod's elapsed cost to the running total.
  if [[ -n "${POD_ID}" && "${POD_CREATED_AT}" -gt 0 ]]; then
    local secs=$(( $(date +%s) - POD_CREATED_AT ))
    CUM_COST_USD="$(python3 -c "print(round(${CUM_COST_USD} + ${secs} / 3600 * ${POD_RATE}, 3))")"
  fi
}

terminate_pod() {
  [[ -n "${POD_ID}" ]] || return 0
  accrue_pod_cost
  log "terminating pod ${POD_ID}"
  api DELETE "/pods/${POD_ID}" >/dev/null || true
  if [[ "${API_CODE}" != "204" && "${API_CODE}" != "404" ]]; then
    log "WARNING: DELETE /pods/${POD_ID} returned HTTP ${API_CODE}"
  fi
  POD_ID=""
  POD_CREATED_AT=0
}

cleanup() {
  local status=$?
  trap - EXIT
  terminate_pod || true
  local count
  count="$(list_pod_count 2>/dev/null || echo "?")"
  local wall=$(( $(date +%s) - RUN_T0 ))
  log "wall time: $((wall / 60))m $((wall % 60))s; last pod rate: \$${POD_RATE}/hr; estimated GPU spend: \$${CUM_COST_USD}"
  log "(spend lands in the ledger via the hourly runpod-pod-watch sweep, feature bakeoff-gpu)"
  if [[ "${count}" != "0" ]]; then
    echo "" >&2
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
    echo "!! ${count} RunPod pod(s) STILL EXIST and are BILLING.       " >&2
    echo "!! Terminate them NOW in the console or with:                " >&2
    echo "!!   curl -X DELETE -H \"Authorization: Bearer \$RUNPOD_API_KEY\" ${API}/pods/<id>" >&2
    echo "!! A stray pod once cost \$14. Do not walk away.             " >&2
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
    exit 1
  fi
  log "zero pods remain, teardown clean"
  exit "${status}"
}

# ── dry run: build and print the payload, POST nothing ───────────────────────
if [[ "${DRY_RUN}" == "1" ]]; then
  [[ -f "${SSH_KEY}.pub" ]] || die "ssh public key ${SSH_KEY}.pub not found"
  log "dry run: pod-create payload for '${GPUS[0]}' (POST ${API}/pods):"
  build_payload "${GPUS[0]}"
  log "dry run: GPU fallback order: ${GPUS[*]:1}"
  exit 0
fi

# ── (a) preflight ────────────────────────────────────────────────────────────
[[ -f "${SSH_KEY}.pub" ]] || die "ssh public key ${SSH_KEY}.pub not found"
[[ -f "${SSH_KEY}" ]] || die "ssh private key ${SSH_KEY} not found"
resolve_secret RUNPOD_API_KEY RUNPOD_API_KEY || die "RUNPOD_API_KEY not set and not in .env/.env.local"
resolve_secret BLOB_TOKEN BLOB_READ_WRITE_TOKEN XDIPX_READ_WRITE_TOKEN \
  || die "no Blob token (BLOB_READ_WRITE_TOKEN or XDIPX_READ_WRITE_TOKEN)"
for v in IMAGE_URL AUDIO_URL_SHORT AUDIO_URL_LONG; do
  [[ -n "${!v:-}" ]] || die "${v} is not set; run make-test-assets.sh first and export its output"
done

log "preflight: checking for existing pods"
EXISTING="$(list_pod_count)"
if [[ "${EXISTING}" != "0" ]]; then
  die "${EXISTING} pod(s) already exist (listed above). Refusing to start: terminate them first (a stray pod once cost \$14)."
fi

trap cleanup EXIT

# ── (b) create the pod, poll to SSH-reachable, re-roll slow hosts ────────────
SSH_HOST=""; SSH_PORT=""; SSH_USER=""

create_pod() {
  local gpu payload
  for gpu in "${GPUS[@]}"; do
    log "creating pod: ${gpu} in ${DATACENTER}"
    payload="$(build_payload "${gpu}")"
    api POST /pods "${payload}"
    if [[ "${API_CODE}" == "201" ]]; then
      POD_ID="$(pod_field "${API_BODY}" 'p["id"]')"
      POD_RATE="$(pod_field "${API_BODY}" 'p.get("cost", 0)')"
      POD_CREATED_AT=$(date +%s)
      log "pod ${POD_ID} created (${gpu}, \$${POD_RATE}/hr)"
      return 0
    fi
    log "no ${gpu} (HTTP ${API_CODE}): $(echo "${API_BODY}" | head -c 300)"
  done
  return 1
}

wait_ssh() {
  local deadline=$(( $(date +%s) + SSH_DEADLINE_S )) status direct
  while (( $(date +%s) < deadline )); do
    api GET "/pods/${POD_ID}"
    if [[ "${API_CODE}" == "200" ]]; then
      status="$(pod_field "${API_BODY}" 'p["status"]')"
      # cost becomes definitive once the pod is placed
      POD_RATE="$(pod_field "${API_BODY}" 'p.get("cost") or '"${POD_RATE}")"
      if [[ "${status}" == "RUNNING" ]]; then
        # Prefer the direct public-ip mapping; fall back to the ssh.runpod.io
        # proxy (works with the account-registered key; scp does not work over
        # it, which is why results come back over plain ssh below).
        local candidate
        for candidate in direct proxy; do
          local coords
          coords="$(pod_field "${API_BODY}" 'json.dumps(p["ssh"].get("'"${candidate}"'") or {})')"
          SSH_HOST="$(pod_field "${coords}" 'p.get("host","")')"
          SSH_PORT="$(pod_field "${coords}" 'p.get("port","")')"
          SSH_USER="$(pod_field "${coords}" 'p.get("username","")')"
          if [[ -n "${SSH_HOST}" && -n "${SSH_PORT}" && -n "${SSH_USER}" ]]; then
            if ssh -i "${SSH_KEY}" -p "${SSH_PORT}" \
                 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                 -o BatchMode=yes -o ConnectTimeout=8 \
                 "${SSH_USER}@${SSH_HOST}" true 2>/dev/null; then
              log "pod ${POD_ID} SSH-reachable via ${candidate} at ${SSH_HOST}:${SSH_PORT}"
              return 0
            fi
          fi
        done
      elif [[ "${status}" == "ERROR" || "${status}" == "TERMINATED" ]]; then
        log "pod ${POD_ID} entered ${status}"
        return 1
      fi
      log "pod ${POD_ID}: ${status}, waiting for SSH ($(( deadline - $(date +%s) ))s left)"
    fi
    sleep 10
  done
  log "pod ${POD_ID} not SSH-reachable within ${SSH_DEADLINE_S}s (slow-host trap): re-rolling, not waiting"
  return 1
}

reachable=0
for roll in $(seq 1 "${MAX_ROLLS}"); do
  log "attempt ${roll}/${MAX_ROLLS}"
  if ! create_pod; then
    log "no capacity on any preferred GPU, retrying in 30s"
    sleep 30
    continue
  fi
  if wait_ssh; then
    reachable=1
    break
  fi
  terminate_pod
done
(( reachable )) || die "no SSH-reachable pod after ${MAX_ROLLS} attempts"

SSH_OPTS=(-i "${SSH_KEY}" -p "${SSH_PORT}" -o StrictHostKeyChecking=no \
          -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 \
          -o ServerAliveInterval=30 -o ServerAliveCountMax=10)
REMOTE="${SSH_USER}@${SSH_HOST}"

# ── (c) ship infra/video-worker/ to the pod ──────────────────────────────────
log "copying $(basename "${WORKER_DIR}")/ to the pod"
tar -C "${WORKER_DIR}/.." --exclude 'video-worker/bakeoff/results' -czf - video-worker \
  | ssh "${SSH_OPTS[@]}" "${REMOTE}" 'rm -rf /root/video-worker && tar -C /root -xzf -'

# ── (d) pod setup (idempotent; streams) ──────────────────────────────────────
log "running pod-setup.sh (ComfyUI clone, deps, model bootstrap; S2V weights download here)"
ssh "${SSH_OPTS[@]}" "${REMOTE}" 'bash /root/video-worker/bakeoff/pod-setup.sh'

# ── (e) render matrix (streams; token travels via stdin, never argv/files) ───
log "running the render matrix"
MATRIX_RC=0
{
  printf 'export BLOB_TOKEN=%q\n' "${BLOB_TOKEN}"
  printf 'export IMAGE_URL=%q\n' "${IMAGE_URL}"
  printf 'export AUDIO_URL_SHORT=%q\n' "${AUDIO_URL_SHORT}"
  printf 'export AUDIO_URL_LONG=%q\n' "${AUDIO_URL_LONG}"
  printf 'export RENDER_TIMEOUT_S=%q\n' "${RENDER_TIMEOUT_S:-2700}"
  printf 'exec python3 -u /root/video-worker/bakeoff/render-matrix.py /root/video-worker/bakeoff/%s /root/bakeoff-results\n' "${MATRIX_FILE:-matrix.json}"
} | ssh "${SSH_OPTS[@]}" "${REMOTE}" 'bash -s' || MATRIX_RC=$?

# ── (f) pull results back ────────────────────────────────────────────────────
RESULTS_DIR="${SCRIPT_DIR}/results/$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "${RESULTS_DIR}"
# Plain ssh, not scp: the ssh.runpod.io proxy fallback does not carry scp.
ssh "${SSH_OPTS[@]}" "${REMOTE}" 'cat /root/bakeoff-results/results.jsonl 2>/dev/null' \
    > "${RESULTS_DIR}/results.jsonl" \
  || log "WARNING: no results.jsonl came back"
if [[ -s "${RESULTS_DIR}/results.jsonl" ]]; then
  log "results: ${RESULTS_DIR}/results.jsonl"
  log "rendered clip URLs:"
  python3 - "${RESULTS_DIR}/results.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    row = json.loads(line)
    out = row.get("output") or {}
    print(f"  {row['case']}: {out.get('videoUrl') or row.get('error')}")
PY
fi

# ── optional hold: keep the pod for a follow-up lane (e.g. InfiniteTalk) ─────
# BAKEOFF_HOLD=1 writes the SSH coordinates to results/<ts>/ssh.env and waits
# for `touch <results>/DONE`, capped at BAKEOFF_HOLD_MAX_MIN minutes so a
# forgotten hold cannot become a stray-pod incident. The EXIT trap still
# terminates the pod on any path out of here.
if [[ "${BAKEOFF_HOLD:-0}" == "1" ]]; then
  HOLD_MAX_MIN="${BAKEOFF_HOLD_MAX_MIN:-90}"
  {
    echo "POD_ID=${POD_ID}"
    echo "SSH_HOST=${SSH_HOST}"
    echo "SSH_PORT=${SSH_PORT}"
    echo "SSH_USER=${SSH_USER}"
  } > "${RESULTS_DIR}/ssh.env"
  log "HOLD: pod stays up for follow-up work (max ${HOLD_MAX_MIN}m)"
  log "HOLD: ssh coordinates in ${RESULTS_DIR}/ssh.env; touch ${RESULTS_DIR}/DONE to release"
  HOLD_DEADLINE=$(( $(date +%s) + HOLD_MAX_MIN * 60 ))
  while (( $(date +%s) < HOLD_DEADLINE )); do
    [[ -f "${RESULTS_DIR}/DONE" ]] && { log "HOLD released"; break; }
    sleep 15
  done
  [[ -f "${RESULTS_DIR}/DONE" ]] || log "HOLD expired after ${HOLD_MAX_MIN}m, tearing down anyway"
fi

# ── (g)+(h) teardown + accounting happen in the EXIT trap ────────────────────
if [[ "${MATRIX_RC}" != "0" ]]; then
  log "matrix finished with failures (rc ${MATRIX_RC}); see results.jsonl"
  exit "${MATRIX_RC}"
fi
log "bake-off complete"
