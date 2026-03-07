# Railway Native Deploy by Service Branch

## Goal

Isolate deployments by service using Railway native GitHub integration, so a change in one service does not trigger deployment of all services.

## Branches

- `deploy/web` -> deploy only `web`
- `deploy/api` -> deploy only `api`
- `deploy/bot` -> deploy only `bot`
- `deploy/worker` -> deploy only `worker`

## Service mapping

- `web` -> repo `rilya888/Genius_Clients`, branch `deploy/web`, Dockerfile `apps/web/Dockerfile`
- `api` -> repo `rilya888/Genius_Clients`, branch `deploy/api`, Dockerfile `apps/api/Dockerfile`
- `bot` -> repo `rilya888/Genius_Clients`, branch `deploy/bot`, Dockerfile `apps/bot/Dockerfile`
- `worker` -> repo `rilya888/Genius_Clients`, branch `deploy/worker`, Dockerfile `apps/worker/Dockerfile`

## Required GitHub app access

Before connecting services, Railway must have access to this repo.

1. Railway Dashboard -> `Account Settings` -> `Integrations` -> `GitHub`.
2. Open Railway GitHub app installation settings.
3. Include repo `rilya888/Genius_Clients` in allowed repositories.
4. Return to Railway project and connect each service source.

## Railway service setup checklist

For each service (`web`, `api`, `bot`, `worker`):

1. Service -> `Settings` -> `Source` -> `Connect Repo`.
2. Repo: `rilya888/Genius_Clients`.
3. Branch: the mapped branch from the table above.
4. Root Directory: repository root.
5. Builder: `Dockerfile`.
6. Dockerfile Path: mapped Dockerfile path from the table above.

After setup, deploys happen natively in Railway from pushes to each `deploy/*` branch.

## Branch sync command

To sync all deploy branches from `main` with branch-specific config:

- `pnpm deploy:sync-branches`

This command:

1. Recreates `deploy/web`, `deploy/api`, `deploy/bot`, `deploy/worker` from `origin/main`.
2. Sets branch-specific root `Dockerfile`.
3. Sets branch-specific root `scripts.start` in `package.json`.
4. Force-pushes deploy branches with lease.
