# Release Checklist (Pre-Deploy)

## 1. Quality gates

- Run `MVP_CHANNEL_MODE=whatsapp_only pnpm predeploy:env` with production-like secrets loaded.
- Run `pnpm predeploy:quality`.
- Ensure `pnpm test` is green.

## 2. Database

- Apply migrations in staging first.
- Verify new migration `0002_notifications_retry_dlq_and_stripe_foundation.sql` was applied.
- Validate critical tables: `webhook_events`, `notification_deliveries`, `stripe_customers`.

## 3. Runtime config

- Confirm required env vars are set for `web`, `api`, `bot`, `worker`.
- Run `MVP_CHANNEL_MODE=whatsapp_only pnpm railway:audit-env` and ensure `missing required: 0`.
- Validate `WA/Stripe` webhook secrets are current.
- Validate `WORKER_ADMIN_SECRET` and token TTL settings.
- Validate `WEB_URL` (or `APP_URL`) is set for:
  - `bot` (used for `Open web` quick action links)
  - `worker` (used in `booking_created_admin` admin CTA message)
- For WhatsApp window-policy, verify:
  - `WA_TEMPLATE_BOOKING_CREATED_ADMIN`
  - `WA_TEMPLATE_BOOKING_REMINDER_24H`
  - `WA_TEMPLATE_BOOKING_REMINDER_2H`
  - `WA_TEMPLATE_LANG_IT`
  - `WA_TEMPLATE_LANG_EN`

## 4. Smoke validation

- Run `pnpm smoke:local` against running services.
- Run `pnpm smoke:production`.
- Run `pnpm smoke:observability`.
- Run admin digest smoke from authorized admin number:
  - send `today`, verify list reply
  - send `tomorrow`, verify list reply
  - send `next`, verify nearest bookings
  - verify `Open web` reply returns `/app/bookings` link
- Run unified prod gates:
  - `SMOKE_SUPER_ADMIN_SECRET=... SMOKE_TENANT_SLUG=alex-salon pnpm release:mvp:gates`
- For `web-vite` auth/admin stability releases, run strict SPA gates:
  - `RELEASE_REQUIRE_AUTH_SMOKE=1 SMOKE_AUTH_AUTOREGISTER=1 SMOKE_API_URL=https://api-production-9caa.up.railway.app pnpm release:spa:gates`
- If Stripe secrets are configured, run webhook idempotency smoke:
  - `SMOKE_API_BASE_URL=https://api-production-... STRIPE_WEBHOOK_SECRET=... STRIPE_TEST_TENANT_ID=... pnpm smoke:stripe-webhook`
- Check readiness endpoints:
  - web: `/api/ready`
  - api: `/api/v1/ready`
  - bot: `/ready`
  - worker: `/ready`

## 5. Alerts and monitoring

- Configure Railway service alerts (restart spikes / deployment failures) for `web`, `api`, `bot`, `worker`.
- Run `pnpm railway:audit-alerts` for the default project in `railway.json`.
- For multiple projects run: `bash scripts/release/audit-railway-alerts.sh <projectId...>`.
- Confirm Sentry DSN and runtime error reporting are enabled where applicable.

## 6. Go/No-Go

- No unresolved P1 defects.
- No unresolved schema drift.
- Rollback plan confirmed.
- `web` production deploy path is GitHub -> `deploy/web` branch trigger in Railway (no CLI snapshot deploy).
- WhatsApp-only MVP mode is explicitly set and validated:
  - `MVP_CHANNEL_MODE=whatsapp_only`
