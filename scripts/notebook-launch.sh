#!/usr/bin/env bash
#
# scripts/notebook-launch.sh — one-command runner for the Notebook launch steps.
#
# Runs, in order:
#   1. seed-notebook-content.ts  (settings singleton, category intros, series)
#   2. seed-glossary.ts          (20 starter glossary terms)
#   3. gen-notebook-art.ts       (masthead + 4 category headers + 3 series
#                                 covers, 2 candidates each, into .notebook-art/)
#   4. prints the vision-review checklist and the exact --upload command for
#      each keeper (upload stays manual by design — every image gets eyeballed)
#
# Usage, from the repo root on a machine with the real .env:
#   bash scripts/notebook-launch.sh              # everything
#   bash scripts/notebook-launch.sh --seed-only  # steps 1-2 only
#   bash scripts/notebook-launch.sh --art-only   # steps 3-4 only
#   bash scripts/notebook-launch.sh --dry-run    # pass --dry-run to every script
#
# Idempotent: re-running updates seeds in place and generates fresh art
# candidates. Safe to re-run after more backlog posts publish to pick up new
# series attachments.

set -u

SEED_ONLY=false
ART_ONLY=false
DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --seed-only) SEED_ONLY=true ;;
    --art-only)  ART_ONLY=true ;;
    --dry-run)   DRY_RUN="--dry-run" ;;
    *) echo "Unknown flag: $arg"; echo "Usage: notebook-launch.sh [--seed-only|--art-only] [--dry-run]"; exit 1 ;;
  esac
done
if $SEED_ONLY && $ART_ONLY; then
  echo "Pick one of --seed-only / --art-only (or neither for everything)."
  exit 1
fi

RUN_SEED=true; RUN_ART=true
$SEED_ONLY && RUN_ART=false
$ART_ONLY && RUN_SEED=false

banner() { printf '\n━━━ %s ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' "$1"; }

# ── Preflight ────────────────────────────────────────────────────────────────
banner "Preflight"

if [ ! -f package.json ] || [ ! -f scripts/seed-glossary.ts ]; then
  echo "✗ Run this from the xdipx_store repo root (package.json + scripts/ not found here)."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "✗ node_modules missing. Run: npm install"
  exit 1
fi
if [ ! -f .env ]; then
  echo "✗ .env not found in the repo root. The seed and art scripts read"
  echo "  SANITY_PROJECT_ID / SANITY_API_TOKEN / FAL_KEY from it."
  exit 1
fi

# Pull only the keys we need out of .env (never source arbitrary shell).
env_val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
MISSING=""
[ -n "$(env_val SANITY_PROJECT_ID)" ] || MISSING="$MISSING SANITY_PROJECT_ID"
[ -n "$(env_val SANITY_API_TOKEN)" ]  || MISSING="$MISSING SANITY_API_TOKEN"
if $RUN_ART && [ -z "$(env_val FAL_KEY)" ]; then
  MISSING="$MISSING FAL_KEY"
fi
if [ -n "$MISSING" ]; then
  echo "✗ Missing in .env:$MISSING"
  echo "  (SANITY_API_TOKEN must be a write token; FAL_KEY is only needed for art generation.)"
  exit 1
fi
echo "✓ repo root, node_modules, and .env keys look good"
[ -n "$DRY_RUN" ] && echo "  (dry run: every script prints its plan, nothing is written or generated)"

FAILED=""
run_step() { # run_step <label> <cmd...>
  local label="$1"; shift
  if "$@"; then
    echo "✓ $label"
  else
    echo "✗ $label failed (continuing)"
    FAILED="$FAILED\n  - $label"
  fi
}

# ── Steps 1-2: seed content ──────────────────────────────────────────────────
if $RUN_SEED; then
  banner "Step 1 · Series, settings, and category intros"
  run_step "seed-notebook-content" npx tsx scripts/seed-notebook-content.ts $DRY_RUN

  banner "Step 2 · Glossary (20 starter terms)"
  run_step "seed-glossary" npx tsx scripts/seed-glossary.ts $DRY_RUN
fi

# ── Step 3: art generation ───────────────────────────────────────────────────
if $RUN_ART; then
  banner "Step 3 · Editorial art candidates → .notebook-art/"
  # surface[:slug] for the eight launch assets
  ASSETS="masthead category:guides category:comparisons category:care category:wellness-basics series:first-times series:how-it-works series:field-notes"
  for asset in $ASSETS; do
    surface="${asset%%:*}"
    slug="${asset#*:}"
    if [ "$slug" = "$asset" ]; then
      run_step "generate $surface" npx tsx scripts/gen-notebook-art.ts --surface "$surface" --count 2 --save-dir .notebook-art $DRY_RUN
    else
      run_step "generate $surface/$slug" npx tsx scripts/gen-notebook-art.ts --surface "$surface" --slug "$slug" --count 2 --save-dir .notebook-art $DRY_RUN
    fi
  done

  banner "Step 4 · Review, then upload the keepers"
  cat << 'EOF'
Open .notebook-art/ and review each candidate against the image brief
(docs/notebook-team/image-brief.md):

  · bright and warm, never moody or dark        · no warped hands or uncanny objects
  · palette-compatible (coral/plum/sage/paper)  · no tableware, no readable text
  · quiet zone clear where the title overlays (masthead center, category left
    third, series upper third)

Then upload each keeper (swap the -1/-2 filename for the one you chose, and
write real Emma-voice alt text — descriptive, non-explicit):

  npx tsx scripts/gen-notebook-art.ts --surface masthead --upload .notebook-art/masthead-1.png --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface category --slug guides          --upload .notebook-art/category-guides-1.png          --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface category --slug comparisons     --upload .notebook-art/category-comparisons-1.png     --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface category --slug care            --upload .notebook-art/category-care-1.png            --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface category --slug wellness-basics --upload .notebook-art/category-wellness-basics-1.png --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface series --slug first-times       --upload .notebook-art/series-first-times-1.png       --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface series --slug how-it-works      --upload .notebook-art/series-how-it-works-1.png      --alt "..."
  npx tsx scripts/gen-notebook-art.ts --surface series --slug field-notes       --upload .notebook-art/series-field-notes-1.png       --alt "..."

A dud pair? Re-run just that surface for two fresh candidates:
  npx tsx scripts/gen-notebook-art.ts --surface category --slug care --count 2 --save-dir .notebook-art
EOF
fi

# ── Summary ──────────────────────────────────────────────────────────────────
banner "Done"
if [ -n "$FAILED" ]; then
  printf 'Some steps failed:%b\nRe-run this script (or the individual command) after fixing — everything is idempotent.\n' "$FAILED"
  exit 1
fi
echo "All steps completed."
$RUN_SEED && echo "  · Series + glossary are live (or planned, if --dry-run)."
$RUN_ART  && echo "  · Art candidates are in .notebook-art/ awaiting your review + upload."
echo "  · Finish with the production pass: docs/notebook-team/qa-checklist.md"
