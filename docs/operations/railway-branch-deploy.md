# Railway Deploy by Service Branch

## Goal

Isolate deployments by service, so a change in one service does not trigger deployment of all services.

## Branches

- `deploy/web` -> deploy only `web`
- `deploy/api` -> deploy only `api`
- `deploy/bot` -> deploy only `bot`
- `deploy/worker` -> deploy only `worker`

Workflow file: `.github/workflows/deploy-railway-branches.yml`

## Required GitHub configuration

### Secret

- `RAILWAY_TOKEN` (Railway API token with deploy permissions)

### Repository Variables

- `RAILWAY_PROJECT_ID` = `de86fcc6-4858-489b-ae1a-7b5330ee7b22`
- `RAILWAY_ENVIRONMENT` = `production`
- `RAILWAY_SERVICE_WEB` = `079bec85-312a-4d1a-a71c-6782d13b26e2`
- `RAILWAY_SERVICE_API` = `0fb4e2e0-0538-4abd-b3af-4473d1200f43`
- `RAILWAY_SERVICE_BOT` = `88bade30-0a6c-4259-9f51-1969e2917f05`
- `RAILWAY_SERVICE_WORKER` = `163eacbb-dc69-44f4-b5e3-fc35f701e5cf`

## How it works

1. Push to one of the deploy branches.
2. Workflow resolves target service from branch name.
3. Matching Dockerfile (`apps/<service>/Dockerfile`) is copied to root as `Dockerfile`.
4. `railway up` deploys only the mapped Railway service ID.

This approach does not require linking Railway services to a GitHub repo source in Railway UI.
Deployment source remains CI-driven from this repository.
