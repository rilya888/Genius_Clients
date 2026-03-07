# Incident Runbook (On-call Lite)

## Priority classification

- P1: Booking path unavailable or cross-tenant risk.
- P2: Integrations degraded (WA/TG/Stripe) with workaround.
- P3: Non-critical UI or reporting issue.

## First 10 minutes

1. Confirm blast radius (`single tenant` vs `global`).
2. Check health/ready endpoints for all services.
3. Check latest deployment and migrations.
4. Review logs for:
   - `webhook_processing_failed`
   - `delivery_failed`
   - `rate_limit_exceeded`

## Operational controls

- Use `POST /run/reminders`, `POST /run/delivery`, `POST /run/cleanup` with `x-worker-secret` for controlled recovery.
- Use admin retry endpoint for failed deliveries after fix.

## Escalation

- Security suspicion -> immediate P1 + release freeze.
- Payment/webhook regression -> backend + integrations owners.
- Persistent queue growth -> backend + worker owners.
