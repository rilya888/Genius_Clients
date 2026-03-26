#!/usr/bin/env bash
set -euo pipefail

RAILWAY_BIN="$HOME/.npm-global/bin/railway"
if [[ ! -x "$RAILWAY_BIN" ]]; then
  RAILWAY_BIN="railway"
fi

if ! command -v "$RAILWAY_BIN" >/dev/null 2>&1; then
  echo "Railway CLI is required" >&2
  exit 1
fi

services=(web api bot worker)
declare -a expected_branches=("deploy/web" "deploy/api" "deploy/bot" "deploy/worker")

echo "Deploy consistency check"
for idx in "${!services[@]}"; do
  service="${services[$idx]}"
  expected_branch="${expected_branches[$idx]}"
  json="$($RAILWAY_BIN deployment list --service "$service" --limit 1 --json)"
  status="$(jq -r '.[0].status // "UNKNOWN"' <<<"$json")"
  commit="$(jq -r '.[0].meta.commitHash // empty' <<<"$json")"
  branch="$(jq -r '.[0].meta.branch // empty' <<<"$json")"
  created="$(jq -r '.[0].createdAt // empty' <<<"$json")"

  printf -- "- %s: status=%s branch=%s commit=%s createdAt=%s\n" "$service" "$status" "$branch" "$commit" "$created"

  if [[ "$status" != "SUCCESS" ]]; then
    echo "Service $service is not on SUCCESS deployment" >&2
    exit 1
  fi

  if [[ -z "$commit" ]]; then
    echo "Service $service has empty commit hash" >&2
    exit 1
  fi

  if [[ "$branch" != "$expected_branch" ]]; then
    echo "Service $service is deployed from unexpected branch. Expected $expected_branch, got $branch." >&2
    exit 1
  fi
done

echo "All services are SUCCESS and mapped to expected deploy branches."
