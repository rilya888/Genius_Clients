# Railway Alerts Baseline

## Scope

Services:

- `web`
- `api`
- `bot`
- `worker`
- `postgres`
- `redis`

## Minimum alert set

1. Deployment failed.
2. Service restart storm (high restart rate).
3. Service unavailable by healthcheck.
4. Volume usage thresholds for stateful services (`postgres`, `redis`).

## Configuration policy

- Production: enable all alerts, notify on-call channel.
- Staging: enable deployment-failed alerts, optional restart alerts.
- Keep alert channels centralized to one team endpoint.

## Validation

After alert setup changes:

1. Trigger a staging redeploy.
2. Confirm alert delivery for failure/success transitions.
3. Record confirmation timestamp in work report.
