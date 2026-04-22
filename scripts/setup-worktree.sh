#!/usr/bin/env bash
# Run this inside a new worktree to symlink .env files from the main repo root.
# Safe to re-run — each symlink is refreshed. Global worktree skill calls this
# automatically after `npm install` if it exists.
set -euo pipefail

main_root=$(git worktree list --porcelain | awk '$1=="worktree"{print $2; exit}')
wt_root=$(git rev-parse --show-toplevel)

if [ "$main_root" = "$wt_root" ]; then
  echo "setup-worktree: running in main repo, nothing to link"
  exit 0
fi

linked=0
for f in .env .env.local .env.preview .env.preview-ivr; do
  if [ -f "$main_root/$f" ]; then
    ln -sf "$main_root/$f" "$wt_root/$f"
    linked=$((linked+1))
  fi
done

echo "setup-worktree: linked $linked env file(s) from $main_root"
