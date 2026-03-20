# Tenant Host Resolution Rollout

## Goal
Enable host-first tenant resolution for API and web with safe fallback and easy diagnostics.

## Runtime flags
API service:
- `TENANT_BASE_DOMAIN=geniusclients.info`
- `TENANT_HOST_RESOLUTION_ENABLED=true`
- `TENANT_RESOLUTION_DEBUG_HEADERS_ENABLED=false` (set `true` only for diagnostics window)
- `TENANT_BROWSER_HEADER_FALLBACK_ENABLED=true` during Railway test phase, then `false` on real wildcard domain.
- `TENANT_TRUST_FORWARDED_HOST=false` (keep disabled unless trusted proxy chain is explicitly configured)

Web service:
- `VITE_TENANT_BASE_DOMAIN=geniusclients.info` (optional, defaults to this value in code)

## Rollout steps
1. Deploy API and web from GitHub branches (`deploy/api`, `deploy/web`).
2. Set API flags above and wait for redeploy `SUCCESS`.
3. Validate core health:
   - `GET /api/v1/health`
   - web `/` and `/login`.
4. If diagnostics needed, set:
   - `TENANT_RESOLUTION_DEBUG_HEADERS_ENABLED=true`
5. Run tenant-host smoke from browser:
   - open `https://<slug>.geniusclients.info/`
   - confirm booking/public API responses.
6. Run security smoke:
   - `pnpm smoke:tenant-host:security`
7. Disable debug headers after verification.

## Expected behavior
- Tenant is resolved by host when possible.
- Internal services can resolve tenant via internal headers with `x-internal-secret`.
- Browser header fallback is controlled by `TENANT_BROWSER_HEADER_FALLBACK_ENABLED`.
- No downtime during rollout.

## Troubleshooting
1. `TENANT_NOT_FOUND` on tenant host:
   - Check tenant slug exists in DB.
   - Check subdomain format and reserved words.
2. API works only with header:
   - Verify `TENANT_HOST_RESOLUTION_ENABLED=true`.
   - Verify request host is under `*.geniusclients.info`.
   - During Railway temporary host tests, keep `TENANT_BROWSER_HEADER_FALLBACK_ENABLED=true`.
3. Inconsistent tenant behavior:
   - Temporarily enable debug headers and inspect:
     - `x-tenant-resolver-source`
     - `x-tenant-resolved-slug`

## Rollback
1. Set `TENANT_HOST_RESOLUTION_ENABLED=false`.
2. Redeploy API.
3. Keep header-based flow active while investigating host routing issue.

## Hardening when real domain is connected
1. Keep `TENANT_HOST_RESOLUTION_ENABLED=true`.
2. Set `TENANT_BROWSER_HEADER_FALLBACK_ENABLED=false`.
3. Confirm browser requests still resolve tenant only by host.

## Super-admin slug change (restricted flow)
Slug can be changed only via super-admin API:
- `PUT /api/v1/super-admin/tenants/:tenantId/slug`
- body: `{ "slug": "new-slug", "actor": "operator_name" }`

Notes:
- Uses shared slug validation and reserved-word filter.
- Writes audit log entry `super_admin.tenant.update_slug`.
