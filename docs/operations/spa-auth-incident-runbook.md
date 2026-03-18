# SPA Auth/Admin Incident Runbook

## Scope

Use this runbook when users report one of the following in the new SPA (`/app`):

- login succeeds but admin pages are empty;
- repeated redirects to `/login`;
- random `401` on admin pages.

## Quick triage checklist

1. Reproduce in clean browser session with hard refresh.
2. Check request to `/api/v1/admin/services` and capture `x-request-id`.
3. Verify the affected account in production DB:
   - user exists;
   - expected tenant mapping exists;
   - services/masters/bookings data exists.
4. Run release gates and smoke contracts:
   - `pnpm release:spa:gates`
     - optional strict mode: `RELEASE_REQUIRE_AUTH_SMOKE=1 pnpm release:spa:gates`
   - `pnpm smoke:web-vite:api-target`
   - `pnpm smoke:spa:auth-admin`
   - `pnpm smoke:spa:public` (if tenant env is set)

Required env for `smoke:spa:auth-admin`:
- `SMOKE_API_URL`
- `SMOKE_AUTH_EMAIL`
- `SMOKE_AUTH_PASSWORD`
- `SMOKE_TENANT_SLUG`

Alternative (auto-create temporary tenant for smoke):
- `SMOKE_AUTH_AUTOREGISTER=1`
- `SMOKE_API_URL`

## API checks

Run these calls with the affected tenant slug:

1. `POST /api/v1/auth/login`
2. `GET /api/v1/auth/me` with returned access token
3. `GET /api/v1/admin/services` with same access token
4. `POST /api/v1/auth/refresh` with refresh token

If step 2 works and step 3 fails with `401`, verify Authorization header propagation in SPA client.

## Frontend checks

1. Confirm `localStorage` has:
   - `access_token`
   - `refresh_token`
   - `access_expires_at`
2. Ensure `ProtectedAppRoute` validates session via `ensureAccessToken()` and `/auth/me`.
3. Ensure admin API calls use valid token from session layer and one forced retry on `401`.
4. Validate logout flow clears local session and redirects to `/login`.

## Recovery actions

1. If issue is token-related, force logout/login and verify refresh flow.
2. If issue is tenant mismatch, correct tenant context and re-run public/admin smoke tests.
3. If issue is frontend regression, rollback web service and re-run production smoke.

## Evidence to attach

- affected email/tenant slug;
- `x-request-id` from failed call;
- smoke command outputs;
- deploy version and timestamp.
