# UI v3 Screen/API Matrix

## Auth

| Source (etalon) | Target route | API endpoints | Notes |
|---|---|---|---|
| `src/app/pages/auth/Login.tsx` | `/auth` (login tab) | `POST /api/auth/login`, `GET /api/auth/me` | Remove mock timeout; keep session/csrf flow |
| `src/app/pages/auth/Register.tsx` | `/auth` (register tab) | `POST /api/auth/register` | Align validation and errors |
| `src/app/pages/auth/ForgotPassword.tsx` | `/auth` (forgot tab) | `POST /api/auth/forgot-password` | Endpoint confirmed in web/api routes |
| `src/app/pages/auth/ResetPassword.tsx` | `/auth` (reset tab) | `POST /api/auth/reset-password` | Endpoint confirmed in web/api routes |
| `src/app/pages/auth/EmailVerification.tsx` | `/auth` (verify state) | `POST /api/auth/request-email-verification`, `POST /api/auth/verify-email` | Endpoints confirmed in web/api routes |

## Admin Core

| Source (etalon) | Target route | API endpoints | Notes |
|---|---|---|---|
| `src/app/layouts/AdminLayout.tsx` | `/admin/*` shell | `GET /api/auth/me` | Role-aware nav and session gate |
| `src/app/pages/admin/Dashboard.tsx` | `/admin` | `GET /api/admin/* summary` | Use existing counters and integrations status |
| `src/app/pages/admin/Bookings.tsx` | `/admin/bookings` | `GET/PATCH /api/admin/bookings*` | Preserve current status transitions |
| `src/app/pages/admin/Services.tsx` | `/admin/services` | `GET/POST/PUT/DELETE /api/admin/services*` | Preserve sort/price semantics |
| `src/app/pages/admin/Staff.tsx` | `/admin/masters` | `GET/POST/PUT/DELETE /api/admin/masters*` | Source "Staff" maps to masters domain |
| `src/app/pages/admin/Schedule.tsx` | `/admin/working-hours`, `/admin/exceptions`, `/admin/master-services` | `GET/POST/PUT/DELETE /api/admin/working-hours*`, `/exceptions*`, `/master-services*` | Split into current domain pages |
| `src/app/pages/admin/Settings.tsx` | `/admin/settings` | `GET/PATCH /api/admin/tenant-settings` | Owner-only constraints stay |

## Public + Marketing

| Source (etalon) | Target route | API endpoints | Notes |
|---|---|---|---|
| `src/app/pages/Landing.tsx` | `/` | None (content-driven) | Keep turquoise palette adaptation |
| `src/app/pages/Pricing.tsx` | `/` sections | None | Integrated pricing section in landing |
| `src/app/pages/FAQ.tsx` | `/` sections | Optional CMS later | Start static then externalize |
| `src/app/pages/public/BookingFlow.tsx` | `/public/book` | `GET /api/public/*`, `POST /api/public/bookings` | Keep legal consent and phone validation |

## Gaps to verify before coding

1. Confirm final CTA routing and legal page linkage in V3 layout.
2. Confirm if pricing content remains static or moves to tenant-managed content.
