# genius_clients

Monorepo for a multi-tenant booking platform with web, api, bot, and worker services.

## Workspaces

- `apps/web`: Next.js BFF and UI shell
- `apps/api`: API service (`/api/v1` baseline)
- `apps/bot`: Bot adapter service shell
- `apps/worker`: Background jobs and scheduler shell
- `packages/shared`: Shared runtime utilities and types
- `packages/db`: DB access package shell
- `packages/i18n`: Translation dictionaries and helpers

## Quick Start

1. Install Node `>=20.12.0` and `pnpm`.
2. Copy `.env.example` values into local `.env` files per app.
3. Install dependencies: `pnpm install`.
4. Run services:
- `pnpm dev:web`
- `pnpm dev:api`
- `pnpm dev:bot`
- `pnpm dev:worker`

## Quality Gates

- `pnpm lint`
- `pnpm typecheck`
- `pnpm i18n:check`
- `pnpm test`
- `pnpm build`

## Pre-Deploy Commands

- `pnpm predeploy:env`
- `pnpm predeploy:quality`
- `pnpm predeploy`
- `pnpm smoke:local`

## Docker Baseline

- `apps/web/Dockerfile`
- `apps/api/Dockerfile`
- `apps/bot/Dockerfile`
- `apps/worker/Dockerfile`

## Bot Commands (Telegram)

- `/start` or `/help`
- `/slots <serviceId> <YYYY-MM-DD> [masterId]`
- `/book <serviceId> <startAtISO> <phoneE164> [masterId] [name]`
- `/cancel <bookingId> <phoneE164>`

## Bot Webhooks

- `POST /webhooks/telegram`
- `GET /webhooks/whatsapp` (Meta verification handshake)
- `POST /webhooks/whatsapp`

## Background Jobs (Worker)

- Reminder queueing sweep (24h / 2h)
- Notification delivery dispatcher (`queued -> sent/failed`)
- Auth/idempotency cleanup sweep for expired tokens/keys
- Manual trigger endpoints (POST):
  - `/run/reminders`
  - `/run/delivery`
  - `/run/cleanup`
