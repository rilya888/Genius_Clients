# Onboarding Checklist

## Prerequisites

- Node.js >= 20.12.0
- pnpm >= 10.16.1

## Setup

1. Copy `.env.example` values into local environment files.
2. Run `pnpm install`.
3. Run quality checks:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`

## Run Services

- `pnpm dev:web`
- `pnpm dev:api`
- `pnpm dev:bot`
- `pnpm dev:worker`

## Pull Request Readiness

- All CI checks pass.
- No secrets committed.
- Changes respect workspace boundaries (`apps/*` do not import each other directly).
