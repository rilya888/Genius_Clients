# Resend Onboarding Runbook

## Goal
Enable reliable verification and password-reset email delivery in production.

## Required environment variables
1. `RESEND_API_KEY`
2. `RESEND_FROM_EMAIL`
3. `APP_URL`

## Domain setup
1. Add your sender domain in Resend.
2. Configure DNS records provided by Resend:
- SPF
- DKIM
3. Optional but recommended:
- DMARC policy (`p=none` for warm-up, then tighten later).

## Validation steps
1. Register a new tenant account:
- expect verification email delivery.
2. Trigger forgot-password:
- expect reset email delivery.
3. Check API logs for send result:
- success path
- failure path with request id.

## Failure handling
1. If delivery fails:
- verify `RESEND_API_KEY` and domain verification state.
- verify `RESEND_FROM_EMAIL` belongs to verified domain.
2. Confirm frontend shows controlled error and includes `requestId`.
3. Retry with `request-email-verification` endpoint after cooldown.

## Observability
1. Track:
- registration attempts vs verification requests;
- verification send failures;
- reset send failures.
2. Alert when email send failures spike during a 10–15 min window.
