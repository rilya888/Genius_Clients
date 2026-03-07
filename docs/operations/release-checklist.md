# Release Checklist (Pre-Deploy)

## 1. Quality gates

- Run `pnpm predeploy:env` with production-like secrets loaded.
- Run `pnpm predeploy:quality`.
- Ensure `pnpm test` is green.

## 2. Database

- Apply migrations in staging first.
- Verify new migration `0002_notifications_retry_dlq_and_stripe_foundation.sql` was applied.
- Validate critical tables: `webhook_events`, `notification_deliveries`, `stripe_customers`.

## 3. Runtime config

- Confirm required env vars are set for `web`, `api`, `bot`, `worker`.
- Run `pnpm railway:audit-env` and ensure `missing required: 0`.
- Validate `WA/TG/Stripe` webhook secrets are current.
- Validate `WORKER_ADMIN_SECRET` and token TTL settings.

## 4. Smoke validation

- Run `pnpm smoke:local` against running services.
- Run `pnpm smoke:production`.
- Check readiness endpoints:
  - web: `/api/ready`
  - api: `/api/v1/ready`
  - bot: `/ready`
  - worker: `/ready`

## 5. Alerts and monitoring

- Configure Railway service alerts (restart spikes / deployment failures) for `web`, `api`, `bot`, `worker`.
- Confirm Sentry DSN and runtime error reporting are enabled where applicable.

## 6. Go/No-Go

- No unresolved P1 defects.
- No unresolved schema drift.
- Rollback plan confirmed.
