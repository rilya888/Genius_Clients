# WhatsApp Bot External Audit Report (2026-03-19)

## 1. Scope and status

This document describes the current production behavior and implementation of the Genius Clients bot stack for external audit.

Scope:
- `apps/bot` (WhatsApp + Telegram adapters)
- AI orchestration and deterministic booking FSM
- Security and PII logging controls in bot runtime
- Operational and test checklist for external QA

Current state:
- Bot roadmap is code-complete for the active `apps/bot` scope.
- Remaining non-code work: live UAT execution and post-release wording tuning from production logs.

Latest production bot deployment verified:
- Railway deployment id: `4011079b-99b7-40a6-8879-e78632e8ff08`
- Status: `SUCCESS`

---

## 2. Runtime endpoints and entrypoints

Main file:
- `apps/bot/src/index.ts`

HTTP endpoints:
- `GET /health` – liveness
- `GET /ready` – readiness
- `POST /internal/smoke/ai-failover` – internal smoke path
- `POST /webhooks/telegram` – Telegram inbound
- `GET /webhooks/whatsapp` – WhatsApp webhook verification (`hub.challenge`)
- `POST /webhooks/whatsapp` – WhatsApp inbound processing

---

## 3. High-level processing pipeline (WhatsApp)

For each inbound WhatsApp message:

1. Signature verification and inbound extraction
- validates Meta signature (`x-hub-signature-256`)
- normalizes inbound fields (text/reply id/locale/source ids)

2. Routing context resolution
- enterprise-aware route resolution (`account/salon/tenant`) using:
  - `apps/bot/src/enterprise/channel-routing.ts`
  - `apps/bot/src/enterprise/session-scope.ts`

3. Session load and locale resolve
- session loaded from Redis (`wa session` scoped key)
- locale resolved through `resolveConversationLocale(...)`

4. Reset policy gate
- `applyConversationResetPolicy(...)` is executed once per message
- decides `continue`, `hard_reset_to_menu`, `hard_reset_to_new_intent`, `reset_due_to_timeout`

5. AI reroute decision
- when allowed by policy and feature flags:
  - `processAiWhatsAppMessage(...)` runs fast-path and optional OpenAI parser
- otherwise deterministic flow handles input

6. Deterministic FSM execution
- `processWhatsAppConversation(...)`
- sends structured WhatsApp UI (`buttons` or `list`) and final text replies

7. Logging and counters
- structured logs for reset decision, AI parsing, funnel step, result
- runtime counters for observability and incident triage

---

## 4. Core modules

- Conversation FSM:
  - `apps/bot/src/whatsapp-conversation.ts`
- AI orchestrator:
  - `apps/bot/src/ai-orchestrator.ts`
- OpenAI parser prompt and schema:
  - `apps/bot/src/openai-prompts.ts`
- Responses API client:
  - `apps/bot/src/openai-responses-client.ts`
- Reset policy:
  - `apps/bot/src/conversation-reset-policy.ts`
- Locale strategy:
  - `apps/bot/src/conversation-locale.ts`
- PII-safe logging helper:
  - `apps/bot/src/log-safety.ts`
- Enterprise route/session scope:
  - `apps/bot/src/enterprise/channel-routing.ts`
  - `apps/bot/src/enterprise/session-scope.ts`

---

## 5. Deterministic FSM behavior

Main states:
- `choose_intent`
- `choose_service`
- `choose_master`
- `choose_date`
- `choose_slot`
- `collect_client_name`
- `confirm`
- `cancel_wait_booking_id`
- `reschedule_wait_booking_id`

Key behavior:
- Booking requires service/master/date/slot and then explicit client name collection.
- Cancel and reschedule are based on active bookings (`pending`, `confirmed`).
- Adaptive booking selection UI:
  - 0 active bookings → quick actions
  - 1–2 bookings → buttons
  - 3+ bookings → list

Soft-adjustment behavior inside booking flow:
- "change master" returns to `choose_master` preserving service context
- "change date" returns to `choose_date` preserving service/master
- "change time" on confirm returns to `choose_slot`

Slot conflict handling:
- on create/reschedule conflict, bot does not crash flow
- re-enters slot/date selection with updated availability

Late cancel policy:
- warning and optional blocking before online cancellation
- configured via tenant bot config and env fallback

---

## 6. AI layer behavior

AI mode is hybrid, not autonomous DB access.

### 6.1 Intent detection strategy

Order of resolution:
1. Fast-path deterministic intent detection (local rules)
2. Transport/cached fallback heuristics
3. OpenAI Responses parser (when needed and enabled)
4. Heuristic normalization of parsed result
5. Deterministic resolver and renderer

Supported parser intents:
- `new_booking`
- `cancel_booking`
- `reschedule_booking`
- `booking_list`
- `catalog`
- `check_availability`
- `price_info`
- `address_info`
- `parking_info`
- `working_hours_info`
- `human_handoff`
- `unknown`

### 6.2 Reply style and `reply_text`

Parser contract enforces:
- `reply_text` is optional
- used only for human clarification/empathy/transition
- default structured steps should use `null`
- low-value generic `reply_text` is filtered in runtime

### 6.3 Safety controls

- AI cannot directly mutate DB
- booking/cancel/reschedule actions go through backend API validations
- unknown/failure paths fallback to deterministic choices or handoff

---

## 7. CTA actions and idempotency

Flow action tokens are signed and time-limited.

Supported CTA actions:
- `flow_confirm_booking`
- `flow_confirm_cancel`

Behavior:
- tokens are validated before action execution
- expired/invalid tokens produce safe user-facing fallback
- cancellation and booking actions rely on backend idempotent semantics

Note for auditors:
- repeated-click idempotency must be validated by ensuring a second inbound CTA event is actually delivered by WhatsApp (UI may not always resend identical action).

---

## 8. Security and privacy controls

### 8.1 Webhook integrity
- WhatsApp webhook signature verified
- verification challenge endpoint controlled by `WA_VERIFY_TOKEN`

### 8.2 PII-safe logging
Implemented centralized helper (`log-safety.ts`):
- phone masking in logs
- token/email/phone/id redaction in log strings
- safe alert context serialization and truncation
- handoff summary sanitization

### 8.3 Secret handling
Sensitive env keys are never embedded in prompts.
Runtime depends on env injection in Railway.

---

## 9. Environment configuration (audit subset)

Core AI:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-5-mini`)
- `OPENAI_RESPONSES_ENABLED`
- `OPENAI_MAX_CALLS_PER_SESSION`
- `OPENAI_MAX_CALLS_PER_DAY_PER_TENANT`
- `AI_FAILURE_HANDOFF_THRESHOLD`
- `UNKNOWN_TURN_HANDOFF_THRESHOLD`
- `SESSION_IDLE_RESET_MINUTES`

WhatsApp:
- `WA_VERIFY_TOKEN`
- `WA_WEBHOOK_SECRET`
- `WA_PHONE_NUMBER_ID`
- `WA_ACCESS_TOKEN`
- `WA_ACCESS_TOKEN_BY_PHONE_JSON`
- `WA_ACTION_TOKEN_SECRET`

Operational:
- `OPS_ALERT_WEBHOOK_URL`
- `OPS_ALERT_WEBHOOK_TOKEN`

Late cancel policy:
- `BOT_LATE_CANCEL_WARN_HOURS`
- `BOT_LATE_CANCEL_BLOCK_HOURS`

---

## 10. Observability

Log groups used in production:
- `[bot] whatsapp inbound message`
- `[bot] whatsapp reset policy`
- `[bot] ai route decision`
- `[bot][ai] inbound normalize`
- `[bot][ai] parsed`
- `[bot][ai] booking funnel step`
- `[bot][ai] session health`
- `[bot] cta action received`
- `[bot][alert] ...`

Current notable operational observations:
- occasional WhatsApp outbound network failures (`fetch failed`) were observed; runtime emits warning alert and keeps service alive.

---

## 11. External QA/UAT checklist (recommended)

### Booking
1. `book me with Anna tomorrow`
2. select service
3. verify date is not unnecessarily re-asked when already resolved
4. select slot
5. provide name
6. confirm booking

### Cancel
1. `cancel booking`
2. choose booking
3. confirm cancel
4. repeat same confirmation action to verify idempotent handling path

### Reschedule
1. `reschedule booking`
2. choose booking
3. select new service/master/date/slot
4. confirm

### Language stability
- English messages should return English responses
- Italian messages should return Italian responses
- neutral short replies should not arbitrarily switch language

### Handoff
- complaint/human-support message should trigger empathetic response and handoff policy

---

## 12. Known limits and explicit non-goals of this stage

- `SupportedLocale` in shared i18n is currently `it/en` only.
- `ru/uk` full product localization requires shared i18n expansion outside current `apps/bot`-only scope.
- Final acceptance depends on live UAT execution with inbound webhook evidence, not code review alone.

---

## 13. Files changed in the latest hardening cycle (high-impact)

- `apps/bot/src/ai-orchestrator.ts`
- `apps/bot/src/whatsapp-conversation.ts`
- `apps/bot/src/conversation-locale.ts`
- `apps/bot/src/conversation-reset-policy.ts`
- `apps/bot/src/openai-prompts.ts`
- `apps/bot/src/index.ts`
- `apps/bot/src/log-safety.ts`
- `apps/bot/src/enterprise/channel-routing.ts`
- `apps/bot/src/enterprise/session-scope.ts`
- `docs/whatsapp-bot-todo-final.md`

