# @genius/web-vite

New frontend implementation based on Vite + React + TypeScript.

## Run

```bash
pnpm --filter @genius/web-vite run dev
```

## Start (production preview)

```bash
pnpm --filter @genius/web-vite run start
```

## Build

```bash
pnpm --filter @genius/web-vite run build
```

## Build With Marketing Prerender

```bash
pnpm --filter @genius/web-vite run build:prerender
```

This command emits route-specific static HTML for:

- `/`
- `/pricing`
- `/faq`

including per-route meta tags, OG tags, canonical, and hreflang links.

## Environment

Copy `.env.example` and set:

- `VITE_API_URL` - API base URL
- `VITE_TENANT_SLUG` - tenant slug for internal tenant routing header

## Scope

- Marketing pages: landing, pricing, FAQ
- Auth pages: login, register
- Public booking page with live API requests
- Admin shell with enterprise-ready account/salon/role context UI

## Container

`apps/web-vite/Dockerfile` builds and serves the Vite app with prerendered marketing routes.
