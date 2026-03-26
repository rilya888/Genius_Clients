# MVP WhatsApp-only Ops Runbook

## Scope
Operational procedures for production MVP where booking communication runs through WhatsApp only.

## 1) Pre-release gates
1. `MVP_CHANNEL_MODE=whatsapp_only pnpm railway:audit-env`
2. `pnpm predeploy:quality`
3. `SMOKE_SUPER_ADMIN_SECRET=... SMOKE_TENANT_SLUG=alex-salon pnpm release:mvp:gates`
4. `pnpm deploy:check-consistency`

## 2) Deploy rollback

### Fast rollback (all services)
1. Identify previous stable commit hash.
2. Reset all `deploy/*` branches to that commit (web/api/bot/worker).
3. Push `deploy/*` and wait for Railway `SUCCESS`.
4. Run `pnpm smoke:production` and `pnpm smoke:observability`.

### Service-only rollback
1. Roll back only impacted service branch (`deploy/<service>`).
2. Verify downstream compatibility with API schema and bot/worker contracts.
3. Run targeted smoke plus full health smoke.

## 3) Database integrity and restore readiness

### Integrity audit
- Run: `DATABASE_URL=... pnpm ops:db-integrity-audit`
- Ensure:
  - no orphan bookings by tenant/user checks
  - no duplicates in `whatsapp_contact_windows`
  - latest migration appears in `__drizzle_migrations`

### Backup and restore drill
1. Create a fresh logical backup (`pg_dump`) with timestamp.
2. Restore into isolated database.
3. Run integrity audit on restored DB.
4. Record restore duration.

### Target objectives
- RPO: up to 24h for MVP.
- RTO: up to 2h for MVP.

## 4) Incident playbooks

### A) Admin confirmation not delivered
1. Check worker logs for `booking_created_admin` delivery attempts.
2. Verify `WA_ACCESS_TOKEN_BY_PHONE_JSON` token for active phone number id.
3. Verify template status in Meta if outside 24h window.
4. Validate tenant admin destination phone in DB.

### B) Template send fails
1. Check error code in worker logs (`132001`, `131026`, etc.).
2. Confirm template exists in active WABA for active sender phone.
3. Confirm template language code mapping (`WA_TEMPLATE_LANG_IT`, `WA_TEMPLATE_LANG_EN`).
4. Re-run booking flow and confirm provider message id in logs.

### C) Token expired / unauthorized
1. Rotate long-lived token in Meta.
2. Update `WA_ACCESS_TOKEN_BY_PHONE_JSON` in bot and worker.
3. Confirm by sending direct test message.
4. Re-run booking confirm flow.

### D) Tenant not found / session mismatch
1. Validate host/slug routing behavior and `x-internal-tenant-slug` fallback.
2. Run tenant smoke scripts.
3. Verify `APP_ROOT_DOMAIN` and `SESSION_COOKIE_DOMAIN`.

## 5) Monitoring baseline
- API health/ready must be 200.
- Bot health/ready must be 200.
- Worker health/ready must be 200.
- Delivery errors by notification type must be searchable in logs.
- Super-admin auth security smoke must pass before release sign-off.

