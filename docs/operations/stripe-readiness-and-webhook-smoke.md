# Stripe Readiness & Webhook Smoke

## Goal
Validate Stripe foundation in staging/production with an idempotent webhook flow.

## Required environment variables
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION`
- `SMOKE_API_BASE_URL` (for smoke command)
- `STRIPE_TEST_TENANT_ID` (tenant id existing in target environment)

## Minimal validation flow
1. Ensure env variables are present in target environment.
2. Confirm endpoint is reachable:
   - `POST /api/v1/webhooks/stripe`
3. Run idempotency smoke:
   - `pnpm smoke:stripe-webhook`
4. Expected result:
   - first call processed (`deduplicated=false`)
   - second identical call deduplicated (`deduplicated=true`)

## Notes
- Smoke script signs payload using `STRIPE_WEBHOOK_SECRET`.
- Script uses `checkout.session.completed` because this event is allowed in current MVP policy.
- Use staging first, then production.
