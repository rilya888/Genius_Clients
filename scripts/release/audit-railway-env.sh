#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-production}"
SERVICES=("web" "api" "bot" "worker")

required_web=("API_URL" "INTERNAL_API_SECRET")
recommended_web=("APP_ROOT_DOMAIN" "SESSION_COOKIE_DOMAIN")

required_api=("DATABASE_URL" "AUTH_TOKEN_SECRET" "INTERNAL_API_SECRET")
recommended_api=("REDIS_URL" "STRIPE_SECRET_KEY" "STRIPE_WEBHOOK_SECRET" "WA_VERIFY_TOKEN" "WA_WEBHOOK_SECRET" "TG_WEBHOOK_SECRET_TOKEN")

required_bot=("API_URL" "INTERNAL_API_SECRET")
recommended_bot=("REDIS_URL" "BOT_TENANT_SLUG" "OPENAI_API_KEY" "TG_BOT_TOKEN" "WA_ACCESS_TOKEN" "WA_PHONE_NUMBER_ID" "WA_VERIFY_TOKEN" "WA_WEBHOOK_SECRET")

required_worker=("DATABASE_URL" "WORKER_ADMIN_SECRET")
recommended_worker=("REDIS_URL" "TG_BOT_TOKEN" "WA_ACCESS_TOKEN" "WA_PHONE_NUMBER_ID")

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

if ! command -v "$HOME/.npm-global/bin/railway" >/dev/null 2>&1 && ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI is required but not found." >&2
  exit 1
fi

RAILWAY_BIN="$HOME/.npm-global/bin/railway"
if [[ ! -x "$RAILWAY_BIN" ]]; then
  RAILWAY_BIN="railway"
fi

missing_required_total=0
missing_recommended_total=0

get_vars_json() {
  local service="$1"
  "$RAILWAY_BIN" variable list --service "$service" --environment "$ENVIRONMENT" --json
}

check_group() {
  local label="$1"
  local service="$2"
  local vars_json="$3"
  shift 3
  local names=("$@")
  local missing=()

  for key in "${names[@]}"; do
    if ! jq -e --arg key "$key" '.[$key] != null and .[$key] != ""' >/dev/null <<<"$vars_json"; then
      missing+=("$key")
    fi
  done

  if ((${#missing[@]} == 0)); then
    printf "  - %s: OK\n" "$label"
    return 0
  fi

  if [[ "$label" == "required" ]]; then
    missing_required_total=$((missing_required_total + ${#missing[@]}))
  else
    missing_recommended_total=$((missing_recommended_total + ${#missing[@]}))
  fi
  printf "  - %s: MISSING (%s)\n" "$label" "$(IFS=', '; echo "${missing[*]}")"
  return 1
}

echo "Railway env audit"
echo "Environment: ${ENVIRONMENT}"
echo

for service in "${SERVICES[@]}"; do
  echo "[${service}]"
  vars_json="$(get_vars_json "$service")"

  case "$service" in
    web)
      check_group "required" "$service" "$vars_json" "${required_web[@]}" || true
      check_group "recommended" "$service" "$vars_json" "${recommended_web[@]}" || true
      ;;
    api)
      check_group "required" "$service" "$vars_json" "${required_api[@]}" || true
      check_group "recommended" "$service" "$vars_json" "${recommended_api[@]}" || true
      ;;
    bot)
      check_group "required" "$service" "$vars_json" "${required_bot[@]}" || true
      check_group "recommended" "$service" "$vars_json" "${recommended_bot[@]}" || true
      ;;
    worker)
      check_group "required" "$service" "$vars_json" "${required_worker[@]}" || true
      check_group "recommended" "$service" "$vars_json" "${recommended_worker[@]}" || true
      ;;
  esac
done

echo
echo "Summary:"
echo "  missing required: ${missing_required_total}"
echo "  missing recommended: ${missing_recommended_total}"

if ((missing_required_total > 0)); then
  exit 1
fi
