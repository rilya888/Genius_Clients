# SPA/API Compatibility Matrix (`apps/web-vite` <-> `apps/api`)

## Scope

This matrix defines runtime contracts required for stable login and admin flows in SPA.

## Auth routes

| Route | Method | SPA Expectation | API Response Shape |
| --- | --- | --- | --- |
| `/api/v1/auth/login` | `POST` | returns session tokens | `{ data: { session: { accessToken, refreshToken, accessTokenExpiresInSeconds, refreshTokenExpiresAt } } }` |
| `/api/v1/auth/register` | `POST` | returns session tokens | `{ data: { session: { ... } } }` |
| `/api/v1/auth/refresh` | `POST` | rotates refresh and returns new session | `{ data: { session: { ... } } }` |
| `/api/v1/auth/logout` | `POST` | revokes refresh token, no crash when token missing | `{ data: { revoked: boolean } }` |
| `/api/v1/auth/me` | `GET` | validates access token and returns identity | `{ data: { userId, tenantId, email, role, isEmailVerified } }` |

## Admin routes

| Route family | Auth mode | Required headers |
| --- | --- | --- |
| `/api/v1/admin/*` | Bearer access token | `authorization`, `x-internal-tenant-slug` |

Notes:
- `401` from admin endpoints must trigger one refresh attempt in SPA.
- Repeated `401` after refresh must clear local session and redirect to `/login`.

## Public routes

| Route family | Auth mode | Required headers |
| --- | --- | --- |
| `/api/v1/public/*` | no bearer | `x-internal-tenant-slug` |

## Cross-cutting transport rules

- State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) must include `x-csrf-token`.
- API errors should expose `x-request-id`; SPA surfaces it in UI-safe error text.
- SPA runtime should not default to localhost in production-like hosts.

## Ownership

- SPA client contract adapters: `apps/web-vite/src/shared/api/*`
- Session lifecycle: `apps/web-vite/src/shared/auth/session.ts`
- API route guards: `apps/api/src/routes/index.ts`
