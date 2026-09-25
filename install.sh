#!/usr/bin/env bash
set -euo pipefail
for tool in git node npm codex; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$tool" >&2
    exit 1
  fi
done
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/mimo-bridge-install.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
git clone --depth 1 https://github.com/readysteadyscience/codex-meets-mimo-bridge.git "$work_dir/source"
cd "$work_dir/source"
npm ci --ignore-scripts --no-audit --no-fund
node scripts/install.mjs
