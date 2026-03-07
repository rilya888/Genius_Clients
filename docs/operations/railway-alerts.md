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

## Applied rules (2026-03-07)

- Workspace: `0802cef0-2d95-4f25-b95f-bf624a084125`
- Channels: `EMAIL`, `INAPP`
- Events: `Deployment.failed`, `Deployment.crashed`
- Severities: `WARNING`, `CRITICAL`

Project rules:

- `Genius_Clients` (`de86fcc6-4858-489b-ae1a-7b5330ee7b22`): `bd04fb90-0622-409e-aae2-ef52ae10d12a`
- `Genius_Clients_Staging` (`29e89fdc-8d04-4455-ae9a-3c5e0f0271ca`): `80e170f8-8f14-4dc1-9fc4-899e66c04c2b`
