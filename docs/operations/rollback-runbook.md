# Rollback Runbook (MVP)

## Trigger conditions

- Booking creation/cancel is failing for >5 minutes.
- Webhook signature failures spike after release.
- Worker delivery queue grows with repeated failures.

## Steps

1. Freeze new deployments.
2. Identify last known good revision.
3. Rollback services in order:
   - `web`
   - `api`
   - `bot`
   - `worker`
4. If incident was schema-related, stop worker delivery loop before DB rollback.
5. Re-run health and ready checks.
6. Execute smoke checks for auth + booking + webhook receive.

## Data safety notes

- Do not delete `webhook_events` during rollback.
- Do not truncate `notification_deliveries`; keep forensic state for retry after fix.
- Keep audit log continuity.

## Post-rollback

- Open incident timeline.
- Record root-cause candidates and affected tenant scope.
- Prepare forward-fix with isolated migration/test plan.
