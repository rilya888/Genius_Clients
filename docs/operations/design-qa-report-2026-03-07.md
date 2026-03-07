# Design Migration QA Report (2026-03-07)

## Build and quality status
- `pnpm --filter @genius/i18n typecheck`: PASS
- `pnpm i18n:check`: PASS
- `pnpm --filter @genius/web typecheck`: PASS
- `pnpm --filter @genius/web build`: PASS
- `pnpm smoke:production`: PASS

## Deployment status
- Branches synced: `deploy/web`, `deploy/api`, `deploy/bot`, `deploy/worker`
- Railway services: `web`, `api`, `bot`, `worker`, `redis`, `postgres` => `SUCCESS`

## Production route checks
- `GET /` => `200`
- `GET /auth` => `200`
- `GET /public/book` => `200`
- `GET /public/booking-success?locale=it&bookingId=SMOKE-1` => `200`
- Unknown route => `404` (expected)

## Completed migration scope
- Foundations and global tokens in `apps/web/app/globals.css`
- Header and language switcher redesign
- Public pages:
  - Home
  - Auth
  - Public Booking
  - Booking Success
  - Not Found
  - Error
  - Loading
- Admin pages:
  - Dashboard
  - Masters
  - Services
  - Master Services
  - Working Hours
  - Exceptions
  - Bookings
  - Settings
  - Notifications
  - Master Translations
  - Service Translations
- Admin sidebar layout with active navigation state

## Accessibility and UX polish (implemented)
- Global `:focus-visible` outline
- Consistent control typography and transitions
- Disabled cursor behavior for action buttons
- Reduced-motion support (`prefers-reduced-motion`)
- Table row hover feedback

## Remaining manual QA (required before final sign-off)
- Safari macOS visual pass across key routes
- iOS Safari visual and interaction pass (blocking)
- Android Chrome responsive pass on booking and admin routes
- Pixel parity review against design reference with target >= 95%

## Notes
- This report contains automated and server-side checks.
- Manual browser QA is still required for final acceptance gate.
