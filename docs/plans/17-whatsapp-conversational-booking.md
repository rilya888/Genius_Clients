# 17. WhatsApp Conversational Booking

## 17.1 Goal

Implement production-ready WhatsApp conversational booking with interactive steps:

1. Service selection.
2. Master selection.
3. Date selection (next 7 days).
4. Time slot selection.
5. Confirmation.
6. Booking creation in DB.

MVP also includes cancellation and rescheduling via the same conversational flow.

## 17.2 Confirmed Product Decisions

- Cancellation: include in MVP.
- Rescheduling: include in MVP.
- Main WhatsApp UX for options: `list message` (recommended for long lists).
- Human handoff: supported.
- Consent policy: per-tenant configuration.
- Slot conflict strategy:
  - First show alternatives for the same date.
  - If no alternatives, show dates for next 7 days.

## 17.3 Target Architecture

- `api`:
  - tenant-aware catalog/slots/booking contracts;
  - webhook verification/signature policy;
  - booking conflict and idempotency guarantees.
- `bot`:
  - channel adapter for WhatsApp interactive messages;
  - conversation state machine (FSM);
  - orchestration of create/cancel/reschedule actions.
- Storage:
  - Redis for fast short-lived chat session state in MVP;
  - move to DB-backed `chat_sessions`/`chat_events` in next iteration.

## 17.4 Conversation Flow (MVP)

### 17.4.1 Entry

- User sends any message.
- Bot answers with intent menu:
  - `New booking`
  - `Reschedule`
  - `Cancel`
  - `Human support`

### 17.4.2 New Booking

1. Ask service (`list`).
2. Ask master (`list`).
3. Ask date (next 7 days, tenant timezone).
4. Ask slot (`list` with pagination if needed).
5. Ask confirmation (`Confirm`, `Change`, `Cancel`).
6. Create booking and send booking code.

### 17.4.3 Cancellation

1. Ask booking code.
2. Validate phone ownership and status.
3. Cancel booking.
4. Send result.

### 17.4.4 Rescheduling

1. Ask booking code to reschedule.
2. Run the same selection steps as new booking (service/master/date/slot/confirm).
3. On confirm:
  - create new booking first;
  - cancel old booking second;
  - return final result with both IDs.

## 17.5 Session Model (MVP Redis)

- Key: `wa:session:{tenant}:{phone}`.
- TTL: 60 minutes.
- Payload:
  - `state`
  - `intent`
  - selected ids (`serviceId`, `masterId`, `date`, `slotStartAt`)
  - `bookingIdToCancelOrReschedule`
  - `locale`
  - `flowVersion`
- Inbound dedup key:
  - `wa:inbound:{messageId}`
  - TTL: 24 hours.

## 17.6 API Contracts Needed

- Existing and used:
  - `GET /api/v1/public/services`
  - `GET /api/v1/public/masters`
  - `GET /api/v1/public/slots`
  - `POST /api/v1/public/bookings`
  - `POST /api/v1/public/bookings/:id/cancel`
- Additions for phase-2 hardening:
  - dedicated public reschedule contract;
  - lookup endpoint for active bookings by phone (limited, masked output).

## 17.7 Reliability Rules

- Inbound event dedup by WhatsApp `message_id`.
- Booking creation always with idempotency key.
- Revalidate slot right before confirm/create.
- Explicit recovery path on slot conflict.
- Audit every state transition and final action outcome.

## 17.8 Security Rules

- Strict webhook signature verification.
- No raw token logging.
- All phone numbers normalized to E.164.
- Rate limits for webhook and per-phone chat abuse.

## 17.9 Observability

- Metrics:
  - flow starts, step drop-offs, confirm rate, booking success rate;
  - cancellation success rate;
  - reschedule success rate;
  - slot conflict rate.
- Structured logs with correlation IDs from inbound message to DB booking result.

## 17.10 Rollout Plan

1. Implement FSM + Redis session storage behind feature flag.
2. Enable for one tenant (`BOT_TENANT_SLUG`) only.
3. Run WhatsApp test-number E2E.
4. Validate DB consistency and rollback path.
5. Expand tenant-by-tenant.

## 17.11 Delivery Phases

### Phase A (now)

- Add plan file.
- Implement MVP conversational FSM in `bot`:
  - new booking full interactive path;
  - cancellation path by booking code;
  - reschedule path (create new + cancel old).

### Phase B

- API additions for richer cancellation/reschedule UX.
- DB-backed session/event tables.
- Full operator handoff workflow.

### Phase C

- Analytics dashboard, alerting, and quality gates.
- Cross-channel flow reuse (Telegram).

## 17.12 Definition of Done (MVP)

- User can complete booking without `/book` command syntax.
- User can cancel by booking code through chat.
- User can reschedule through chat and see final result.
- New bookings from WhatsApp are stored in Railway Postgres with `source='whatsapp'`.
- All critical paths pass smoke checks on production test setup.
