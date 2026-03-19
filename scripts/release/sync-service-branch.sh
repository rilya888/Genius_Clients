#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  echo "Usage: $0 <service> [branchPrefix] [baseBranch]" >&2
  exit 1
fi

BRANCH_PREFIX="${2:-deploy}"
BASE_BRANCH="${3:-main}"

if [[ ! "$BRANCH_PREFIX" =~ ^[a-z0-9._/-]+$ ]]; then
  echo "Invalid branch prefix: ${BRANCH_PREFIX}" >&2
  exit 1
fi

if [[ ! "$SERVICE" =~ ^[a-z0-9._-]+$ ]]; then
  echo "Invalid service: ${SERVICE}" >&2
  exit 1
fi

case "$SERVICE" in
  web)
    dockerfile_path="apps/web-vite/Dockerfile"
    start_cmd="pnpm --filter @genius/web-vite run start"
    ;;
  api)
    dockerfile_path="apps/api/Dockerfile"
    start_cmd="pnpm --filter @genius/api run start:runtime"
    ;;
  bot)
    dockerfile_path="apps/bot/Dockerfile"
    start_cmd="node apps/bot/dist/index.js"
    ;;
  worker)
    dockerfile_path="apps/worker/Dockerfile"
    start_cmd="node apps/worker/dist/index.js"
    ;;
  *)
    echo "Unsupported service: ${SERVICE}" >&2
    exit 1
    ;;
esac

TARGET_BRANCH="${BRANCH_PREFIX}/${SERVICE}"

git fetch origin "${BASE_BRANCH}" "${TARGET_BRANCH}" || git fetch origin "${BASE_BRANCH}"

tmp_dir="$(mktemp -d)"
cleanup() {
  git worktree remove "$tmp_dir" --force >/dev/null 2>&1 || true
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

git worktree add --detach "$tmp_dir" "origin/${BASE_BRANCH}" >/dev/null
cd "$tmp_dir"

cp "$dockerfile_path" Dockerfile
tmp_pkg="$(mktemp)"
jq --arg start "$start_cmd" '.scripts.start = $start' package.json > "$tmp_pkg"
mv "$tmp_pkg" package.json

git add Dockerfile package.json
if ! git diff --cached --quiet; then
  git commit -m "chore(deploy): sync ${SERVICE} branch config (${BRANCH_PREFIX})" >/dev/null
fi

remote_sha="$(git ls-remote --heads origin "${TARGET_BRANCH}" | awk '{print $1}' || true)"
if [[ -n "$remote_sha" ]]; then
  git push origin "HEAD:refs/heads/${TARGET_BRANCH}" "--force-with-lease=refs/heads/${TARGET_BRANCH}:${remote_sha}"
else
  git push origin "HEAD:refs/heads/${TARGET_BRANCH}" --force
fi

echo "Synced ${TARGET_BRANCH} from ${BASE_BRANCH}"
