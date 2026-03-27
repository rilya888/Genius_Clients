#!/usr/bin/env bash
set -euo pipefail

TARGETS=("apps/web-vite/src" "apps/web/app")
PATTERN='toLocale(DateString|TimeString|String)\('

if rg -n "$PATTERN" "${TARGETS[@]}"; then
  echo "\n[date-format-guard] Found forbidden toLocale formatter usage. Use shared DD.MM.YYYY formatters instead." >&2
  exit 1
fi

echo "[date-format-guard] OK"
