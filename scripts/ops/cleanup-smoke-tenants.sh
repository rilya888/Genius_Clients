#!/usr/bin/env bash
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

SMOKE_PREFIX="${SMOKE_PREFIX:-spa-smoke-}"
CUTOFF_HOURS="${CUTOFF_HOURS:-24}"
APPLY="${APPLY:-0}"

echo "[cleanup-smoke-tenants] prefix=${SMOKE_PREFIX} cutoff_hours=${CUTOFF_HOURS} apply=${APPLY}"

report_sql=$(cat <<SQL
WITH target AS (
  SELECT id, slug, name, created_at, is_active
  FROM tenants
  WHERE slug LIKE '${SMOKE_PREFIX}%'
    AND created_at < now() - interval '${CUTOFF_HOURS} hours'
)
SELECT
  (SELECT count(*) FROM target) AS tenants_total,
  (SELECT count(*) FROM target WHERE is_active = true) AS tenants_active,
  (SELECT count(*) FROM users u JOIN target t ON t.id = u.tenant_id WHERE u.is_active = true) AS users_active;
SQL
)

echo "[cleanup-smoke-tenants] report"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "${report_sql}"

echo "[cleanup-smoke-tenants] sample"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
  SELECT id, slug, name, created_at, is_active
  FROM tenants
  WHERE slug LIKE '${SMOKE_PREFIX}%'
    AND created_at < now() - interval '${CUTOFF_HOURS} hours'
  ORDER BY created_at DESC
  LIMIT 20;
"

if [[ "${APPLY}" != "1" ]]; then
  echo "[cleanup-smoke-tenants] dry-run complete. Set APPLY=1 to deactivate."
  exit 0
fi

echo "[cleanup-smoke-tenants] applying deactivation"
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
  WITH target AS (
    SELECT id
    FROM tenants
    WHERE slug LIKE '${SMOKE_PREFIX}%'
      AND created_at < now() - interval '${CUTOFF_HOURS} hours'
  )
  UPDATE users
  SET is_active = false
  WHERE tenant_id IN (SELECT id FROM target)
    AND is_active = true;
"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
  UPDATE tenants
  SET is_active = false
  WHERE slug LIKE '${SMOKE_PREFIX}%'
    AND created_at < now() - interval '${CUTOFF_HOURS} hours'
    AND is_active = true;
"

echo "[cleanup-smoke-tenants] done"
