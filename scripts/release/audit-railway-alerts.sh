#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

declare -a PROJECT_IDS=()
if [[ $# -gt 0 ]]; then
  PROJECT_IDS=("$@")
elif [[ -f "$ROOT_DIR/railway.json" ]]; then
  PROJECT_IDS=("$(jq -r '.projectId // empty' "$ROOT_DIR/railway.json")")
fi

PROJECT_IDS=("${PROJECT_IDS[@]/#/}")
PROJECT_IDS=("${PROJECT_IDS[@]/%/}")

if [[ ${#PROJECT_IDS[@]} -eq 0 || -z "${PROJECT_IDS[0]}" ]]; then
  echo "Usage: $0 <projectId> [projectId...]" >&2
  echo "Or configure railway.json with projectId." >&2
  exit 1
fi

API_URL="https://backboard.railway.app/graphql/v2"
required_events='["Deployment.failed","Deployment.crashed"]'
required_severities='["WARNING","CRITICAL"]'
required_channels='["EMAIL","INAPP"]'

check_project() {
  local project_id="$1"
  local workspace_id
  local query_project
  local query_rules
  local payload
  local response
  local matched

  query_project='query($id:String!){ project(id:$id){ id name workspace { id name } } }'
  payload="$(jq -n --arg q "$query_project" --arg id "$project_id" '{query:$q,variables:{id:$id}}')"
  response="$(curl -sS "$API_URL" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' --data "$payload")"

  if jq -e '.errors != null' >/dev/null <<<"$response"; then
    echo "[alerts] project ${project_id}: query error" >&2
    jq '.errors' <<<"$response" >&2
    return 1
  fi

  workspace_id="$(jq -r '.data.project.workspace.id // empty' <<<"$response")"
  local project_name
  project_name="$(jq -r '.data.project.name // empty' <<<"$response")"
  if [[ -z "$workspace_id" ]]; then
    echo "[alerts] project ${project_id}: workspace not found" >&2
    return 1
  fi

  query_rules='query($wid:String!,$pid:String!){ notificationRules(workspaceId:$wid, projectId:$pid){ id eventTypes severities channels { config } } }'
  payload="$(jq -n --arg q "$query_rules" --arg wid "$workspace_id" --arg pid "$project_id" '{query:$q,variables:{wid:$wid,pid:$pid}}')"
  response="$(curl -sS "$API_URL" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' --data "$payload")"

  if jq -e '.errors != null' >/dev/null <<<"$response"; then
    echo "[alerts] project ${project_id}: notificationRules query error" >&2
    jq '.errors' <<<"$response" >&2
    return 1
  fi

  matched="$(
    jq -r \
      --argjson events "$required_events" \
      --argjson severities "$required_severities" \
      --argjson channels "$required_channels" '
      [
        .data.notificationRules[]
        | select(
            (($events - .eventTypes) | length == 0)
            and (($severities - .severities) | length == 0)
            and (($channels - (.channels | map(.config.type))) | length == 0)
          )
      ] | length
      ' <<<"$response"
  )"

  if [[ "$matched" -gt 0 ]]; then
    echo "[alerts] ${project_name} (${project_id}): OK"
    return 0
  fi

  echo "[alerts] ${project_name} (${project_id}): missing required deployment alert rule" >&2
  return 1
}

has_errors=0
for project_id in "${PROJECT_IDS[@]}"; do
  if [[ -z "$project_id" ]]; then
    continue
  fi
  if ! check_project "$project_id"; then
    has_errors=1
  fi
done

if [[ "$has_errors" -ne 0 ]]; then
  exit 1
fi

echo "[alerts] all checks passed"
