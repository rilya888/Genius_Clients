# Этап 08: AI Chatbot (OpenAI) — детальный план

## Цель этапа

Собрать единый AI-движок чат-бота для WhatsApp и Telegram, который стабильно проводит пользователя через сценарий записи, соблюдает tenant boundaries и создает корректные booking-записи через API.

## Scope этапа

Входит:
- Архитектура bot engine и orchestrator.
- Prompt + tool-calling контракт.
- Диалоговая state machine.
- Интеграция с `/api/v1` для slots/bookings/catalog.
- i18n-логика (`it/en`) и формальный tone.
- Guardrails, fallback и отказоустойчивость.

Не входит:
- Реализация канал-специфичных webhook transport (детально в этапах 09/10).
- Продвинутые AI-фичи (upsell, аналитика intent quality, memory beyond session).

## MVP Boundaries (зафиксировано)

- Бот решает только задачи записи:
  - показать услуги/мастеров/слоты;
  - создать запись;
  - отменить запись (только “свои записи” текущего чата/канала).
- Нет “свободного” assistant режима за пределами домена записи.
- Нет голосовых/мультимодальных сценариев.

## Архитектурные принципы

- **Single bot core:** один движок для WA и TG, различается только transport adapter.
- **Tool-first:** AI не пишет в БД напрямую, только через строго типизированные internal tools.
- **Deterministic safety:** действия с side effects требуют явной валидации и подтверждения.
- **Tenant isolation:** каждый диалог жестко привязан к `tenant_id`.
- **Observability-first:** каждый шаг диалога и tool-call трассируется.

## Архитектура решения

```
WA/TG Webhook Adapter
        ↓
   Bot Orchestrator
   (context + policy)
        ↓
   OpenAI Responses API
   + tool calling
        ↓
  Internal Bot Tools Layer
        ↓
 /api/v1 (catalog/slots/bookings)
        ↓
  Response formatter (WA/TG)
```

Компоненты:
- `channel-adapter` (WA/TG payload normalization).
- `conversation-manager` (state + TTL + locale).
- `policy-guard` (allowed tools, consent, validation gates).
- `tool-executor` (typed calls to backend services).
- `message-renderer` (формат канала + лимиты длины).

## Tenant и identity resolution

- WA: tenant определяется по `phone_number_id` (этап 09).
- TG: tenant по deep-link/start mapping (этап 10).
- Conversation key:
  - `tenant_id + channel + external_user_id/chat_id`.
- Любой tool-call исполняется только в контексте текущего tenant.

## Диалоговая state machine

Целевые шаги:
1. `greeting`
2. `service_selection`
3. `master_selection` (или Any master)
4. `date_selection`
5. `slot_selection`
6. `contact_collection` (`name`, `phone E.164`, `email?`)
7. `consent_confirmation` (GDPR)
8. `final_confirmation`
9. `booking_created`

Системные состояния:
- `fallback_clarification`
- `handoff_to_human` (опционально, если не уверен)
- `error_recovery`

Правила переходов:
- Нельзя перейти к `createBooking` без:
  - выбранного `service_id`,
  - `slot` (`start_at`, `master_id`),
  - валидных контактов,
  - подтвержденного consent.

## Хранение состояния (обязательно)

- Production: только Redis (in-memory запрещен).
- TTL состояния: 30-60 минут бездействия.
- Сохранять:
  - `tenant_id`, `channel`, `user_id/chat_id`,
  - current step,
  - собранные поля,
  - locale,
  - last tool results (кратко).
- При истечении TTL:
  - диалог начинается заново с понятным сообщением.

## Prompt design

Системный prompt должен явно задавать:
- роль: ассистент записи для конкретного tenant;
- разрешенные действия: только booking-domain;
- правило языка: формальный стиль, `it/en`;
- запрет на выдуманные данные;
- обязательность tool-calls для фактов (слоты, услуги, запись).

Prompt guardrails:
- запрещено подтверждать запись до успешного tool response.
- запрещено обращаться к данным другого tenant.
- запрещено раскрывать технические детали/секреты.

## Tool-calling контракт (MVP)

Обязательные tools:
- `getServices(locale)`
- `getMasters(serviceId?, locale)`
- `getAvailableSlots(serviceId, date, masterId?)`
- `createBooking(serviceId, masterId, startAt, clientName, clientPhoneE164, clientEmail?, clientConsent, clientLocale, source)`
- `cancelBooking(bookingId, reason?)` (ограниченный MVP сценарий)

Требования:
- Все input/output schemas строго типизированы (JSON schema).
- Любой tool-call идемпотентен, где применимо.
- `createBooking` использует `Idempotency-Key`.
- `source` фиксируется как `whatsapp` или `telegram`.
- `cancelBooking` разрешен только для booking, принадлежащих текущему `tenant_id` и текущему chat/user identity.

## Валидация данных от пользователя

- Телефон: нормализация в E.164 перед `createBooking`.
- Email: базовая валидность (если указан).
- Дата/время: проверка against available slots.
- Consent:
  - явное подтверждение пользователем перед записью.

Если валидация провалена:
- бот просит исправить конкретное поле;
- не двигается дальше по state machine.

## i18n и tone of voice

- Локали в MVP: только `it`, `en`.
- Приоритет локали:
  1. Явный выбор пользователя в чате.
  2. Определение по первому сообщению.
  3. `tenant.default_locale`.
  4. `en`.
- Все бот-сообщения из `bot.json`/`common.json`.
- Стиль: формальный во всех сообщениях.

## Channel adaptation

### Telegram

- Использовать InlineKeyboard где это ускоряет выбор.
- Учитывать лимит длины сообщения.
- Для callback data передавать компактные безопасные идентификаторы.

### WhatsApp

- Использовать supported interactive элементы (buttons/lists).
- Учитывать ограничения 24h window и template-переходы (этап 11).

## Error handling и fallback

- API/tool timeout:
  - одна автоматическая попытка retry;
  - при повторном fail — user-friendly fallback.
- `BOOKING_SLOT_CONFLICT`:
  - объяснить, что слот уже занят;
  - сразу предложить альтернативные слоты.
- `RATE_LIMITED`:
  - короткое сообщение + просьба повторить позже.
- Unknown intent:
  - мягкая переориентация в supported сценарии.
- После 2-3 подряд неуспешных попыток (validation/tool failures) — обязательный переход в `handoff_to_human`.

## Booking confirmation и consent proof

- Перед `createBooking` бот обязан показать финальное резюме и запросить явное подтверждение пользователя.
- Без явного подтверждения (`Да/Confirm`) вызов `createBooking` запрещен.
- Для GDPR-аудита сохранять consent proof:
  - `consent_text_key` (какой текст был показан),
  - `consent_timestamp`,
  - `channel/source`.

## Безопасность и guardrails

- Input sanitization перед отправкой в LLM и tools.
- Ограничение max turns в одной сессии (anti-loop).
- Prompt-injection defense:
  - user input не может менять системные правила/tool policy.
- PII masking в логах:
  - phone/email редактируются.

## Observability и метрики

Логируем события:
- `bot_message_received`
- `bot_locale_resolved`
- `bot_tool_called`
- `bot_tool_failed`
- `bot_booking_created`
- `bot_fallback_triggered`

Метрики:
- conversion до booking_created;
- drop-off по шагам;
- среднее число сообщений до booking;
- tool error rate;
- conflict rate для слотов.

## Performance targets (MVP baseline)

- Median bot reply time <= 2.5s (без heavy retries).
- p95 bot reply time <= 6s.
- Tool call timeout budget: 2-3s, общий budget ответа контролируемый.

Cost/turn limits (MVP):
- max turns per conversation session: 20.
- max tool calls per session: 12.
- max output tokens per assistant response: фиксированный верхний предел (например 400-600).
- при достижении лимитов — graceful stop + handoff to human.

## Тестовая стратегия этапа

- Unit:
  - state machine transitions;
  - locale resolution;
  - input normalization (phone/email).
- Integration:
  - tool-calling against `/api/v1` mock/real staging.
  - booking create flow end-to-end (bot -> api -> db).
  - slot conflict recovery.
- Safety tests:
  - prompt injection attempts;
  - cross-tenant access denial.
- Channel contract tests:
  - WA/TG payload parsing and rendering.

## Ownership

- Bot orchestration + tools: `Backend/AI Engineer`.
- Channel adapters: `Integrations Engineer`.
- Prompt + conversation quality: `Product + AI Engineer`.
- Reliability and monitoring: `Backend + DevOps`.

## Риски и профилактика

- Риск: LLM генерирует “уверенные”, но неверные ответы.  
  Мера: tool-first policy и запрет подтверждений без tool result.
- Риск: потеря контекста диалога.  
  Мера: Redis state + TTL + restart strategy.
- Риск: высокая латентность в час пик.  
  Мера: timeout budget, retries с лимитом, fallback ответы.
- Риск: пользователь не завершает flow.  
  Мера: короткие шаги, кнопки выбора, ясные next actions.

## Definition of Done (детально)

- [ ] Зафиксирована архитектура bot core и channel adapters.
- [ ] Описана строгая state machine для booking flow.
- [ ] Описан tool-calling контракт с обязательными schema.
- [ ] Зафиксированы правила валидации (включая phone E.164 и consent).
- [ ] Зафиксирована i18n стратегия (`it/en`, формальный стиль).
- [ ] Описаны fallback/error recovery сценарии.
- [ ] Зафиксировано правило отмены: только “свои” записи текущего чата/канала.
- [ ] Добавлен обязательный финальный confirm-step перед `createBooking`.
- [ ] Зафиксирован consent proof contract для GDPR.
- [ ] Зафиксированы security guardrails и PII logging policy.
- [ ] Зафиксированы cost/turn/tool-call лимиты для MVP.
- [ ] Зафиксирован обязательный human handoff после 2-3 подряд неудачных попыток.
- [ ] Определены метрики/логи/перформанс-цели.
- [ ] Тестовая стратегия покрывает unit/integration/safety/channel contracts.

## Definition of Ready для Этапов 09/10/11

- [ ] Bot core готов к подключению WA webhook adapter (этап 09).
- [ ] Bot core готов к подключению TG webhook adapter (этап 10).
- [ ] Booking source корректно маркируется (`whatsapp`/`telegram`).
- [ ] `client_locale` и consent корректно передаются в booking.
- [ ] Есть совместимый контракт для уведомлений и reminder flow (этап 11).
