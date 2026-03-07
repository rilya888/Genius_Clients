# Service Contracts (Stage 01 Baseline)

## Communication Matrix

- Browser -> Web (Next.js BFF): HTTPS
- Web -> API: HTTP with `X-Internal-Tenant-Id` and `X-Internal-Secret`
- Bot -> API: internal HTTP calls only
- Worker -> API/DB integrations: background execution only

## Tenant Context

- Source of truth: `Host` header resolved by web server.
- API tenant context: only trusted internal headers from web.
- Public clients never pass tenant context directly to API.

## API Versioning

- Base path: `/api/v1`
- Health/readiness:
  - `GET /api/v1/health`
  - `GET /api/v1/ready`

## Runtime State

- Bot conversation state: Redis in staging/production.
- Rate-limit storage: centralized Redis in production.
