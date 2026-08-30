#!/usr/bin/env bash
# LOCAL helper: produces the two public asset URLs the bake-off matrix needs
# (a 9:16 identity frame and speech tracks) and prints export lines for
# run-bakeoff.sh.
#
#   IMAGE_URL         9:16 identity frame (reused from a past video job's
#                     scene frame in the DB, or an explicit IMAGE_URL override)
#   AUDIO_URL_SHORT   ~4s speech track  (single-chunk s2v case)
#   AUDIO_URL_LONG    ~12s speech track (extend-chain s2v case)
#
# Speech comes from ElevenLabs when ELEVENLABS_API_KEY is available, else from
# macOS `say` (robotic; fine for pipeline validation, not for judging lipsync
# quality). Uploads use the exact Vercel Blob PUT contract handler.py uses.
#
#   bash make-test-assets.sh            # prints three export lines at the end
#   bash make-test-assets.sh --db-check # only run the scene-frame DB query
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# Same contract as handler.py's blob_put (verified from the @vercel/blob SDK
# source): PUT {base}/?pathname=..., Bearer token, x-api-version 12.
BLOB_API_URL="${BLOB_API_URL:-https://vercel.com/api/blob}"
BLOB_API_VERSION="${BLOB_API_VERSION:-12}"

log() { echo "[assets] $*" >&2; }
die() { echo "[assets] FATAL: $*" >&2; exit 1; }

resolve_secret() {
  # resolve_secret <out_var> <name...>: env first, then .env / .env.local.
  # Never echoes the value.
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

# ── identity frame: reuse a real scene frame from the DB ─────────────────────
# video_jobs.scene_frame_asset_id -> media_assets.id -> media_assets.blob_url
# (db/schema.ts). Rows 3 and 5 are known-good identity frames; prefer them,
# fall back to the newest job that has one.
db_image_url() {
  local dburl
  resolve_secret dburl DATABASE_URL || die "DATABASE_URL not set and not in .env/.env.local"
  psql "${dburl}" -X -q -t -A -c "
    SELECT ma.blob_url
    FROM video_jobs vj
    JOIN media_assets ma ON ma.id = vj.scene_frame_asset_id
    WHERE ma.blob_url IS NOT NULL
    ORDER BY (CASE WHEN vj.id IN (3, 5) THEN 0 ELSE 1 END), vj.id DESC
    LIMIT 1;" | head -1
}

if [[ "${1:-}" == "--db-check" ]]; then
  url="$(db_image_url)"
  [[ -n "${url}" ]] || die "no scene-frame blob_url found in video_jobs/media_assets"
  log "db-check OK: ${url}"
  exit 0
fi

if [[ -n "${IMAGE_URL:-}" ]]; then
  log "using IMAGE_URL override"
else
  IMAGE_URL="$(db_image_url)"
  [[ -n "${IMAGE_URL}" ]] || die "no scene-frame blob_url in the DB; pass IMAGE_URL=... explicitly"
  log "identity frame from DB: ${IMAGE_URL}"
fi

# ── speech tracks ────────────────────────────────────────────────────────────
LONG_TEXT="Welcome back to the studio. Today we are testing how the new video pipeline handles a longer take, with natural pacing, a steady voice, and enough words to carry us comfortably past the twelve second mark before we wrap up."
SHORT_TEXT="This is a short take for the baseline render test."

synthesize() {
  # synthesize <text> <outfile-base>; sets SYNTH_PATH and SYNTH_TYPE.
  local text="$1" base="$2"
  local elkey elvoice
  if resolve_secret elkey ELEVENLABS_API_KEY; then
    resolve_secret elvoice ELEVENLABS_VOICE_ID || elvoice="21m00Tcm4TlvDq8ikWAM"
    log "synthesizing '${base}' with ElevenLabs"
    local mp3="${WORK}/${base}.mp3"
    curl -sS --fail -X POST \
      "https://api.elevenlabs.io/v1/text-to-speech/${elvoice}" \
      -H "xi-api-key: ${elkey}" -H "Content-Type: application/json" \
      -d "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "model_id": "eleven_multilingual_v2"}))' "${text}")" \
      -o "${mp3}"
    SYNTH_PATH="${mp3}"; SYNTH_TYPE="audio/mpeg"
  else
    log "no ELEVENLABS_API_KEY found; falling back to macOS say (QUALITY CAVEAT: robotic voice, judge pipeline health with it, not lipsync quality)"
    local aiff="${WORK}/${base}.aiff" wav="${WORK}/${base}.wav"
    say -v Samantha -o "${aiff}" "${text}"
    afconvert "${aiff}" "${wav}" -f WAVE -d LEI16@24000
    SYNTH_PATH="${wav}"; SYNTH_TYPE="audio/wav"
  fi
  local secs
  secs="$(python3 -c 'import subprocess,sys
r = subprocess.run(["afinfo", sys.argv[1]], capture_output=True, text=True).stdout
for ln in r.splitlines():
    if "estimated duration" in ln:
        print(round(float(ln.split(":")[1].split()[0]), 1)); break' "${SYNTH_PATH}" 2>/dev/null || true)"
  log "  ${base}: ${secs:-?}s"
}

blob_put() {
  # blob_put <path> <pathname> <content-type>; public URL on stdout. Same
  # header set handler.py sends, bakeoff/ prefix keeps these findable.
  local path="$1" pathname="$2" ctype="$3"
  local resp
  resp="$(curl -sS --fail -X PUT \
    "${BLOB_API_URL}/?pathname=${pathname}" \
    -H "authorization: Bearer ${BLOB_TOKEN}" \
    -H "x-api-version: ${BLOB_API_VERSION}" \
    -H "x-vercel-blob-access: public" \
    -H "x-content-type: ${ctype}" \
    -H "x-add-random-suffix: 1" \
    --data-binary "@${path}")"
  python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "${resp}"
}

resolve_secret BLOB_TOKEN BLOB_READ_WRITE_TOKEN XDIPX_READ_WRITE_TOKEN \
  || die "no Blob token (BLOB_READ_WRITE_TOKEN or XDIPX_READ_WRITE_TOKEN in env or .env/.env.local)"

synthesize "${LONG_TEXT}" speech-long
LONG_PATH="${SYNTH_PATH}"; LONG_TYPE="${SYNTH_TYPE}"
synthesize "${SHORT_TEXT}" speech-short
SHORT_PATH="${SYNTH_PATH}"; SHORT_TYPE="${SYNTH_TYPE}"

log "uploading speech tracks to Vercel Blob under bakeoff/assets/"
# Keep the real file extension: handler.py's download_audio infers .mp3/.wav
# from the URL path.
AUDIO_URL_LONG="$(blob_put "${LONG_PATH}" "bakeoff/assets/speech-long.${LONG_PATH##*.}" "${LONG_TYPE}")"
AUDIO_URL_SHORT="$(blob_put "${SHORT_PATH}" "bakeoff/assets/speech-short.${SHORT_PATH##*.}" "${SHORT_TYPE}")"

echo
echo "# paste into your shell, then run run-bakeoff.sh:"
echo "export IMAGE_URL='${IMAGE_URL}'"
echo "export AUDIO_URL_SHORT='${AUDIO_URL_SHORT}'"
echo "export AUDIO_URL_LONG='${AUDIO_URL_LONG}'"
