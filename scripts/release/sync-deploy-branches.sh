#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

BRANCH_PREFIX="${1:-deploy}"
if [[ ! "$BRANCH_PREFIX" =~ ^[a-z0-9._/-]+$ ]]; then
  echo "Invalid branch prefix: ${BRANCH_PREFIX}" >&2
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

git fetch origin main

for service in "${services[@]}"; do
  branch="${BRANCH_PREFIX}/${service}"
  case "$service" in
    web)
      dockerfile_path="apps/web-vite/Dockerfile"
      start_cmd="pnpm --filter @genius/web-vite run start"
      ;;
    api) start_cmd="pnpm --filter @genius/api run start:runtime" ;;
    bot) start_cmd="node apps/bot/dist/index.js" ;;
    worker) start_cmd="node apps/worker/dist/index.js" ;;
    *) echo "Unsupported service: ${service}" >&2; exit 1 ;;
  esac

  if [[ "$service" != "web" ]]; then
    dockerfile_path="apps/${service}/Dockerfile"
  fi

  git checkout -B "$branch" origin/main >/dev/null

  cp "$dockerfile_path" Dockerfile
  tmp="$(mktemp)"
  jq --arg start "$start_cmd" '.scripts.start = $start' package.json > "$tmp"
  mv "$tmp" package.json

  git add Dockerfile package.json
  if git diff --cached --quiet; then
    remote_ref="origin/${branch}"
    if git show-ref --verify --quiet "refs/remotes/${remote_ref}"; then
      remote_sha="$(git rev-parse "${remote_ref}")"
    else
      remote_sha=""
    fi
    local_sha="$(git rev-parse HEAD)"

    if [[ "$local_sha" != "$remote_sha" ]]; then
      git push origin "$branch" --force-with-lease
      echo "Synced ${branch} (main updates only)"
    else
      echo "No deploy sync changes for ${branch}"
    fi
  else
    git commit -m "chore(deploy): sync ${service} branch config (${BRANCH_PREFIX})" >/dev/null
    git push origin "$branch" --force-with-lease
    echo "Synced ${branch}"
  fi
done

git checkout "$current_branch" >/dev/null
