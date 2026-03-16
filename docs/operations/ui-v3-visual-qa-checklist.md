# UI v3 Visual QA Checklist

## Scope

- Environment: production web
- Reference: `Saasbookingplatformdesign` (`main`)
- Palette adaptation: turquoise brand variant

## Viewports

- Desktop: 1440x900
- Tablet: 768x1024
- Mobile: 390x844

## Landing (`/`)

- Hero layout (headline + CTA + visual card) keeps hierarchy and spacing.
- Social proof, how-it-works, features, product tour, pricing, FAQ, trust, final CTA are present.
- Hover states on cards/buttons are visible and not aggressive.
- No clipping/overflow in EN and IT locale switch.

## Auth (`/auth`)

- Tabs available: Login/Register/Forgot/Reset/Verify.
- Form fields align and preserve readable rhythm on all viewports.
- Status messages appear with clear success/error tone.
- Session check and redirect behavior stay correct.

## Public Booking (`/public/book`)

- Booking progress card is visible and updates as steps are completed.
- Progress bar and context facts (service/specialist/slot) reflect state.
- Slot list and selection are clear on mobile.
- Consent and phone validation remain visible and understandable.

## Admin Shell (`/admin/*`)

- Top session bar shows brand/user block and logout action.
- Sidebar navigation active state is clear.
- Mobile jump navigation works and routes correctly.
- Content panel keeps spacing and readability.

## Admin Pages

- Dashboard shows quick actions, focus cards, recent bookings.
- CRUD pages show consistent pattern: form -> status -> summary -> table.
- Notifications has filters: channel/status/recipient search.
- Settings grouped into sections: General/Scheduling/Notifications/AI/FAQ IT/EN.

## Accessibility baseline

- Focus ring visible on interactive controls.
- Contrast is readable in cards, badges, muted text.
- Status announcements use `role=status` + `aria-live` where needed.

## Acceptance

- No blocking visual defects across listed routes.
- No critical responsiveness regressions.
- No broken interactions in primary flows.

## Sign-off

- Reviewer:
- Date:
- Result: pass / needs fixes
- Notes:
