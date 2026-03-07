#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not installed." >&2
  exit 1
fi

RAILWAY_CONFIG="$HOME/.railway/config.json"
if [[ ! -f "$RAILWAY_CONFIG" ]]; then
  echo "Railway config not found: ${RAILWAY_CONFIG}" >&2
  exit 1
fi

TOKEN="$(jq -r '.user.token // empty' "$RAILWAY_CONFIG")"
if [[ -z "$TOKEN" ]]; then
  echo "Railway token is not available in ${RAILWAY_CONFIG}" >&2
  exit 1
fi

if [[ -f "$ROOT_DIR/railway.json" ]]; then
  PROJECT_ID="$(jq -r '.projectId // empty' "$ROOT_DIR/railway.json")"
else
  PROJECT_ID=""
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "Project ID is not configured. Add railway.json with projectId." >&2
  exit 1
fi

TIMEOUT_SECONDS="${1:-900}"
POLL_SECONDS="${2:-10}"

services=("web" "api" "bot" "worker")
start_ts="$(date +%s)"

fetch_statuses() {
  read -r -d '' QUERY <<'EOF'
query Services($projectId: String!) {
  project(id: $projectId) {
    environments {
      edges {
        node {
          name
          serviceInstances {
            edges {
              node {
                serviceName
                latestDeployment { status }
              }
            }
          }
        }
      }
    }
  }
}
EOF

  payload="$(jq -n --arg query "$QUERY" --arg projectId "$PROJECT_ID" '{query:$query,variables:{projectId:$projectId}}')"
  if response="$(
    curl -sS --retry 4 --retry-delay 2 --retry-all-errors \
      https://backboard.railway.app/graphql/v2 \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      --data "$payload" \
      2>/dev/null
  )"; then
    printf '%s' "$response" | jq -r '
      .data.project.environments.edges[]
      | select(.node.name == "production")
      | .node.serviceInstances.edges[].node
      | "\(.serviceName)=\(.latestDeployment.status // "UNKNOWN")"
    '
    return 0
  fi

  if [[ -x "$HOME/.npm-global/bin/railway" ]]; then
    for service in "${services[@]}"; do
      status="$(
        "$HOME/.npm-global/bin/railway" deployment list --service "$service" --limit 1 --json 2>/dev/null \
          | jq -r '.[0].status // "UNKNOWN"' 2>/dev/null || true
      )"
      if [[ -z "$status" ]]; then
        status="UNKNOWN"
      fi
      printf '%s=%s\n' "$service" "$status"
    done
    return 0
  fi

  return 1
}

echo "Waiting for Railway services to reach SUCCESS (timeout: ${TIMEOUT_SECONDS}s)..."

while true; do
  all_success=1
  now="$(date +%s)"
  elapsed=$((now - start_ts))
  status_lines="$(fetch_statuses)"

  echo "---- elapsed: ${elapsed}s ----"
  for service in "${services[@]}"; do
    status="$(printf '%s\n' "$status_lines" | awk -F= -v s="$service" '$1==s{print $2}' | tail -n 1)"
    if [[ -z "$status" ]]; then
      status="UNKNOWN"
    fi
    echo "${service}: ${status}"
    if [[ "$status" != "SUCCESS" ]]; then
      all_success=0
      if [[ "$status" == "FAILED" || "$status" == "CRASHED" ]]; then
        echo "Service ${service} entered ${status}. Stop waiting." >&2
        exit 1
      fi
    fi
  done

  if [[ "$all_success" -eq 1 ]]; then
    echo "All services are SUCCESS."
    exit 0
  fi

  if (( elapsed >= TIMEOUT_SECONDS )); then
    echo "Timeout exceeded (${TIMEOUT_SECONDS}s)." >&2
    exit 1
  fi

  sleep "$POLL_SECONDS"
done
