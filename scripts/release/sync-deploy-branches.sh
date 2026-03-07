#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  git fetch origin main
fi

services=("web" "api" "bot" "worker")
current_branch="$(git rev-parse --abbrev-ref HEAD)"

git fetch origin main deploy/web deploy/api deploy/bot deploy/worker

for service in "${services[@]}"; do
  branch="deploy/${service}"
  dockerfile_path="apps/${service}/Dockerfile"
  case "$service" in
    web) start_cmd="pnpm --filter @genius/web run start" ;;
    api) start_cmd="pnpm --filter @genius/api run start:runtime" ;;
    bot) start_cmd="node apps/bot/dist/index.js" ;;
    worker) start_cmd="node apps/worker/dist/index.js" ;;
    *) echo "Unsupported service: ${service}" >&2; exit 1 ;;
  esac

  git checkout -B "$branch" origin/main >/dev/null

  cp "$dockerfile_path" Dockerfile
  tmp="$(mktemp)"
  jq --arg start "$start_cmd" '.scripts.start = $start' package.json > "$tmp"
  mv "$tmp" package.json

  git add Dockerfile package.json
  if git diff --cached --quiet; then
    echo "No deploy sync changes for ${branch}"
  else
    git commit -m "chore(deploy): sync ${service} branch config" >/dev/null
    git push origin "$branch" --force-with-lease
    echo "Synced ${branch}"
  fi
done

git checkout "$current_branch" >/dev/null
