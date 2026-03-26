# Admin Digest Smoke Runbook

## Purpose
Verify WhatsApp admin quick actions (`today/tomorrow/next`) and web deeplink behavior after deploy.

## Preconditions
- `api`, `bot`, `worker`, `web` deployed from same commit.
- `INTERNAL_API_SECRET` configured in `bot`.
- `WEB_URL` or `APP_URL` configured in `bot` and `worker`.
- Tenant has:
  - `adminNotificationWhatsappE164`
  - `operatorWhatsappE164`
  - active WhatsApp endpoint binding.
  - `desiredWhatsappBotE164` matches connected endpoint `e164`.

## Post-change guard (when numbers are edited)
1. Open operational settings and save WhatsApp block.
2. If API returns a validation error, do not continue until fixed:
  - `whatsapp_desired_bot_required_for_connected_endpoint`
  - `whatsapp_operator_required_for_connected_endpoint`
  - `whatsapp_routing_mismatch_for_tenant`
3. Immediately send `today` from the operator/admin number and confirm bot response.

## Test 1: Commands from admin number
1. Send `today` to bot from admin number.
2. Expect booking list response + quick action buttons.
3. Send `tomorrow`.
4. Expect tomorrow list response.
5. Send `next`.
6. Expect nearest 3 bookings response.

## Test 2: Open web action
1. In bot response tap `Open web`.
2. Expect message with `/app/bookings` link.
3. Open link, confirm bookings page loads.

## Test 3: Pending CTA from digest
1. Ensure at least one pending booking exists.
2. Send `today` (or `next`).
3. Tap `Confirm`.
4. Verify booking status changed to `confirmed` in admin web.
5. Repeat with another pending booking:
  - tap `Reject`,
  - send rejection reason,
  - verify client received rejection message.

## Test 4: New booking notification path
1. Create a new booking as client.
2. Admin receives `booking_created_admin` notification.
3. Verify CTA buttons: `Confirm`, `Reject`, `Open web`.
4. Tap `Confirm`, verify status transition and client confirmation delivery.

## Observability checks
- Bot metrics endpoint (`/metrics`) should include:
  - `bot_admin_digest_handled_total`
  - `bot_admin_digest_errors_total`
- Bot logs should not show repeated:
  - `admin_digest_fetch_failed`
  - `booking_admin_action_failed`
- Worker logs should show successful `whatsapp-admin-cta` sends.
