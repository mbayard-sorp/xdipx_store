#!/usr/bin/env bash
#
# One entry point for every routine's calls to the xdipx team API.
#
# Why this exists
# ---------------
# Every routine playbook told the agent to hand-roll the same shell:
#
#   TOKEN="${TEAM_TOKEN:-${HOMEPAGE_TEAM_TOKEN:-$CRON_SECRET}}"
#   curl -s -X POST "$BASE_URL/api/team/run" -H "x-team-secret: $TOKEN" ...
#
# That composes a command containing a live secret, and whether it runs depends
# on the permission layer resolving it. On 2026-08-24 R-ENRICH's fire had no
# git source attached, so the session started with cwd=/home/user instead of
# the repo, the repo's own .claude/settings.json allowlist never loaded, and
# the auto-mode classifier blocked the call three times. The routine never
# started a run and enriched nothing, two days running. R-DEV ran the same
# shape the same day with the repo as cwd and was allowed.
#
# So the call shape is now one fixed, allowlistable command:
#
#   bash scripts/team-api.sh POST run '{"op":"start","team":"product"}'
#   bash scripts/team-api.sh GET  gate 'team=product&excludeRun=42'
#
# The token is never in the command the agent composes, never written to disk,
# and never on this process's argv (it goes to curl over stdin via --config,
# so it stays out of `ps` too). Callers pass a path and a body, nothing secret.
#
# Exit codes: 0 ok, 2 no token in the environment, 3 bad usage, 4 HTTP >= 400
# (the response body is still printed on 4, because the API answers refusals
# like `{"ok":false,"reason":"over_run_cap"}` with a non-2xx and the routine
# needs to read the reason to skip honestly).

set -euo pipefail

BASE_URL="${TEAM_API_BASE_URL:-https://xdipx.com}"

usage() {
  cat >&2 <<'USAGE'
usage: bash scripts/team-api.sh <GET|POST> <path> [body-or-query]

  path   path under /api/, without the leading slash: team/run, team/gate,
         team/suggestion, team/blocker, homepage-team/spend, ...
  body   POST: a JSON string. GET: a query string without the leading '?'.

examples:
  bash scripts/team-api.sh POST team/run '{"op":"start","team":"product","runType":"enrich"}'
  bash scripts/team-api.sh GET  team/gate 'team=product&excludeRun=42'
USAGE
  exit 3
}

[ $# -ge 2 ] || usage

method="$1"
path="$2"
payload="${3:-}"

case "$method" in
  GET|POST) ;;
  *) usage ;;
esac

# Reject a path that tries to leave /api/ or point somewhere else entirely.
case "$path" in
  /*|*..*|*://*) echo "team-api: refusing suspicious path '$path'" >&2; exit 3 ;;
esac

# Resolution order matches every playbook: TEAM_TOKEN, then HOMEPAGE_TEAM_TOKEN,
# then CRON_SECRET (which prod accepts and which cloud routines reliably have).
TOKEN="${TEAM_TOKEN:-${HOMEPAGE_TEAM_TOKEN:-${CRON_SECRET:-}}}"
if [ -z "$TOKEN" ]; then
  echo "team-api: no token found (looked for TEAM_TOKEN, HOMEPAGE_TEAM_TOKEN, CRON_SECRET)" >&2
  exit 2
fi

url="$BASE_URL/api/$path"
if [ "$method" = "GET" ] && [ -n "$payload" ]; then
  url="$url?$payload"
fi

body_file=""
out_file="$(mktemp)"
cleanup() {
  [ -n "$body_file" ] && rm -f "$body_file"
  rm -f "$out_file"
}
trap cleanup EXIT

status=0
if [ "$method" = "POST" ]; then
  # The body goes through a temp file rather than an argv string so a large or
  # quote-heavy JSON payload cannot be mangled by shell re-quoting. It holds no
  # secret; only the header does, and that goes over stdin below.
  body_file="$(mktemp)"
  printf '%s' "${payload:-\{\}}" > "$body_file"
  http=$(printf 'header = "x-team-secret: %s"\n' "$TOKEN" | curl -sS \
    --config - \
    -X POST "$url" \
    -H 'content-type: application/json' \
    --data-binary "@$body_file" \
    -o "$out_file" -w '%{http_code}') || status=$?
else
  http=$(printf 'header = "x-team-secret: %s"\n' "$TOKEN" | curl -sS \
    --config - \
    "$url" \
    -o "$out_file" -w '%{http_code}') || status=$?
fi

# Always emit the body: the API answers refusals with a non-2xx AND a reason,
# and a routine that cannot read the reason cannot skip honestly.
cat "$out_file"
[ -s "$out_file" ] && echo

[ "$status" -eq 0 ] || exit "$status"
[ "${http:-0}" -lt 400 ] || exit 4
