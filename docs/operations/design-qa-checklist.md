# Design Migration QA Checklist

## Scope
- Project: `apps/web`
- Goal: visual migration acceptance at 95% parity target.
- Release mode: full release (no feature-flag rollout).
- Blocking requirement: Safari/iOS must pass critical flows.

## Browsers and devices
- Desktop Chrome (latest stable).
- Desktop Firefox (latest stable).
- Desktop Safari (latest stable).
- iOS Safari (latest stable).
- Android Chrome (latest stable).

## Breakpoints
- 360x800
- 390x844
- 768x1024
- 1024x768
- 1280x800
- 1440x900

## Critical user flows
1. `Home -> Auth -> Admin Dashboard`
2. `Public Booking -> Slot selection -> Booking Success`
3. `Admin: Masters CRUD (create/update/deactivate)`
4. `Admin: Services CRUD (create/update/deactivate)`
5. `Admin: Bookings status transitions`

## Visual acceptance
- Header, spacing, and typography are consistent across pages.
- Sidebar state and active nav highlighting are correct.
- Cards, tables, forms, and actions use shared design tokens/classes.
- No inline-style regressions in `apps/web/app`.
- Visual parity to reference design reaches 95% for key pages.

## Interaction and state checks
- Form focus style is visible and consistent.
- Disabled controls render correctly.
- Empty states do not break layout.
- Error state page and Not Found page render correctly.
- Loading state page is shown during route transitions when applicable.

## i18n checks
- IT/EN switch applies immediately without hard reload.
- Public booking success page respects locale.
- Missing translation keys are not shown as raw key strings in target flows.
- Dictionary parity check passes.

## Safari/iOS blocker checks
- Sticky header and admin sidebar behavior.
- Date input usability on booking and admin pages.
- Buttons and form controls remain tappable and aligned.
- No clipped content or overflow in admin tables (horizontal scroll works).

## Release gate
- `pnpm --filter @genius/web typecheck` passes.
- `pnpm --filter @genius/i18n typecheck` passes.
- `pnpm i18n:check` passes.
- Manual QA checklist items marked complete.

## Post-release smoke
- Home page opens successfully.
- Auth page login/register forms render and submit.
- Booking creation redirects to success page.
- Admin pages load without client-side crashes.
