# Этап 09: WhatsApp Integration

## Цель этапа

Подключить production-канал WhatsApp Business (Meta Cloud API) к существующему Bot Core (этап 08) и Backend API (этап 04) так, чтобы:

- входящие сообщения стабильно попадали в диалоговый движок,
- исходящие ответы и сервисные уведомления отправлялись корректно,
- мультитенантный роутинг был строгим и безопасным,
- платформа была готова к масштабированию по tenant/номерам без смены архитектуры.

## Границы MVP

**Входит в этап 09:**
- webhook verify + webhook receive для Meta Cloud API;
- multi-tenant роутинг по `phone_number_id`;
- двусторонний текстовый диалог бот ↔ клиент;
- интерактивные элементы (кнопки/списки) для сценариев выбора;
- обработка delivery/read/error статусов (базовый контур наблюдаемости);
- поддержка шаблонных исходящих сообщений вне 24h окна;
- идемпотентная обработка входящих/статусных webhook events.

**Не входит в этап 09:**
- сложные rich-media сценарии как основной канал продаж (видео-каталоги и т.п.);
- собственный UI-конструктор шаблонов в админке (на MVP достаточно конфигурации и runbook);
- маркетинговые рассылки (только сервисные сообщения).

## Архитектурное место в системе

- Channel Adapter `whatsapp` подключается к Bot Orchestrator из этапа 08.
- Tenant определяется строго на backend по `phone_number_id` из webhook payload.
- Вызовы бизнес-инструментов (слоты/бронь/отмена) идут только через внутренний Backend API слой.
- Исходящие отправки централизуются через единый Outbound Sender с retry/idempotency.
- События канала пишутся в audit/telemetry для диагностики и последующего SLA-анализа.

## Предварительные зависимости

- Этап 04 (`/api/v1`, idempotency, error model, rate-limit).
- Этап 08 (Bot state machine, guardrails, handoff policy).
- Этап 11 (notifications) использует этот канал как транспорт.
- Наличие WABA и Meta App, доступных секретов и production webhook URL.

## Data Contract и сущности

## 9.1 TenantWhatsAppConfig

Минимальная конфигурация на tenant:

- `tenant_id`
- `phone_number_id` (unique globally)
- `waba_id`
- `business_account_id` (опционально для диагностики)
- `access_token_secret_ref` (ссылка на secret store)
- `webhook_verify_token_hash`
- `is_active`
- `quality_rating` (опционально, для ops)
- `created_at`, `updated_at`

Правила:
- один `phone_number_id` принадлежит ровно одному tenant;
- tenant может иметь несколько номеров (масштабирование);
- отключение номера через `is_active=false` без удаления истории.

## 9.2 Хранилище событий канала

Использовать таблицу webhook events (из этапа 02/07) с расширением полей для WA:

- `provider = 'whatsapp'`
- `provider_event_id` (wamid/event id)
- `phone_number_id`
- `tenant_id`
- `event_type` (`message_in`, `status_sent`, `status_delivered`, `status_read`, `status_failed`)
- `payload_json`
- `received_at`
- `processed_at`
- `processing_status`
- `error_code`, `error_message`

Индексы:
- unique (`provider`, `provider_event_id`) для идемпотентности;
- (`tenant_id`, `received_at`) для операционного анализа.

## Webhook слой

## 9.3 Verify endpoint

`GET /api/v1/webhooks/whatsapp`

- проверка `hub.mode`, `hub.verify_token`, `hub.challenge`;
- verify token хранится в секретах (не в plain env);
- endpoint возвращает challenge только при корректной валидации;
- все невалидные попытки логируются как security event.

## 9.4 Receive endpoint

`POST /api/v1/webhooks/whatsapp`

- принять raw body;
- валидировать подпись `X-Hub-Signature-256`;
- распарсить `entry[].changes[].value`;
- раздельно обработать:
  - входящие сообщения пользователя,
  - статусы ранее отправленных сообщений,
  - системные обновления (при необходимости игнорировать с логом);
- ACK быстро (`2xx`) после постановки в внутреннюю обработку, без тяжелой синхронной логики.

## 9.5 Идемпотентность webhook

- dedupe по `provider_event_id`;
- повторный webhook не должен создавать повторную бизнес-операцию;
- при гонках использовать upsert + unique constraint;
- хранить факт повторной доставки для мониторинга качества канала.

## Входящий маршрут (Inbound)

## 9.6 Нормализация входящего сообщения

Извлечь и нормализовать:
- `channel_user_id` = E.164 номер клиента из `from`;
- `tenant_id` по `phone_number_id`;
- `message_id` (`wamid`);
- `message_type` (text/interactive/button/list/media);
- `text` или полезный payload действия;
- `timestamp` провайдера.

Если `tenant_id` не найден:
- не передавать в бот;
- записать security/ops событие;
- вернуть безопасный ACK без утечки деталей.

## 9.7 Поддержка интерактивов

В MVP включить:
- reply buttons (до 3);
- list messages (до 10 элементов);
- маппинг `interactive.reply.id` → внутренние intent/action ID.

Требование forward-compatible:
- internal callback payload должен содержать версию формата (`v1:...`), чтобы менять схему без поломки старых сообщений.

## 9.8 Поддержка media (MVP-базовый контур)

Решение по ответу пользователя: **да, добавляем**.

В MVP:
- принимать media webhook events;
- не выполнять heavy media understanding;
- отвечать fallback-сообщением и переводить пользователя в поддерживаемый сценарий (текст/кнопки);
- логировать факт media usage для принятия решения в post-MVP.

Это снижает риск «немого» бота при реальном пользовательском поведении.

## Исходящий маршрут (Outbound)

## 9.9 Send API adapter

Базовый endpoint отправки:

`POST https://graph.facebook.com/v18.0/{phone_number_id}/messages`

Требования:
- per-tenant access token из secret manager;
- idempotency key на стороне приложения для повторных попыток;
- controlled retry с backoff для 5xx/429;
- circuit-breaker на tenant/number при системной деградации.

## 9.10 24-hour window и шаблоны

Решение по ответу пользователя: **да, включаем полноценный контур шаблонов**.

- если с последнего user message >24h, отправка только через approved template;
- шаблоны для MVP минимум:
  - `booking_confirmation`
  - `booking_reminder_24h`
  - `booking_reminder_2h`
  - `booking_cancellation`
- параметризация шаблонов через безопасный рендер (escape + длины полей);
- fallback policy при template reject: лог + алерт ops + резервный канал (если есть).

## 9.11 Delivery/read/error статусы

Решение по ответу пользователя: **да, отслеживаем статусы**.

MVP-минимум:
- принимать `sent`, `delivered`, `read`, `failed`;
- связывать статус с исходящим `message_id`;
- сохранять timeline для каждой отправки;
- выставлять технический outcome для нотификаций (успех/ошибка/неизвестно).

Это критично для этапа 11 (напоминания), чтобы не считать уведомление «доставленным» без подтверждения канала.

## Безопасность

## 9.12 Политика секретов

- токены не логируются и не возвращаются в API;
- хранение только в secrets manager;
- ротация токенов по runbook без downtime;
- при revoke/expiry токена tenant переводится в `degraded channel state` с видимым алертом.

## 9.13 Контроль злоупотреблений

- inbound rate-limit per `channel_user_id` и per tenant;
- защита от replay (signature + timestamp window где применимо);
- валидация размера payload;
- фильтрация неподдерживаемых типов без падения процесса.

## Наблюдаемость и эксплуатация

## 9.14 Метрики

Обязательные метрики:
- webhook receive rate;
- webhook dedupe rate;
- inbound-to-bot latency p95/p99;
- outbound success/fail rate;
- status distribution (`sent/delivered/read/failed`);
- template send fail rate;
- per-tenant error budget consumption.

## 9.15 Логи и трассировка

- correlation id сквозной: webhook event → bot turn → outbound message;
- структурированные логи без PII leakage;
- отдельные ops-события для `tenant_not_found`, `signature_invalid`, `token_expired`.

## 9.16 Алертинг

MVP-алерты:
- spike `status_failed`;
- sustained 401/403 от Meta API;
- резкий рост webhook signature invalid;
- рост backlog outbound queue выше порога.

## Тестовая стратегия

## 9.17 Unit

- payload parser (text/interactive/status/media);
- tenant resolver;
- dedupe logic;
- 24h policy selector (session vs template send).

## 9.18 Integration

- verify webhook handshake;
- end-to-end: inbound message → bot reply → outbound send;
- end-to-end: outbound send → status webhook reconciliation;
- negative кейсы: invalid signature, unknown tenant, expired token, duplicate event.

## 9.19 Sandbox/UAT

- тест на реальном sandbox-номере Meta;
- smoke сценарии для каждого типа поддерживаемого сообщения;
- проверка мультиязычного ответа из bot layer (`it/en`).

## Поэтапный план работ (поштучно)

1. Зафиксировать контракт `TenantWhatsAppConfig` и события канала.
2. Реализовать verify endpoint + secure token validation.
3. Реализовать receive endpoint с signature validation и ACK-first моделью.
4. Добавить dedupe/idempotency слой webhook обработки.
5. Подключить inbound normalizer и tenant resolver.
6. Подключить adapter к Bot Orchestrator (только text path).
7. Добавить interactive path (buttons/lists + callback mapping).
8. Добавить media fallback path (без AI media analysis).
9. Реализовать outbound sender + retry/backoff + secret retrieval.
10. Реализовать 24h policy engine + template sender.
11. Подключить status reconciliation (`sent/delivered/read/failed`).
12. Включить метрики/алерты/runbook и UAT smoke.

## Definition of Ready (DoR)

- Подтвержден доступ к Meta Cloud API и WABA.
- Есть production webhook URL и TLS.
- Есть секреты: verify token, app secret/signature key, access tokens.
- Согласован набор шаблонов для сервисных сообщений.
- Подтвержден tenant mapping policy для `phone_number_id`.

## Definition of Done (DoD)

- Webhook verify/receive работают стабильно и идемпотентно.
- Входящие text/interactive/media (fallback) корректно обрабатываются.
- Исходящие сообщения отправляются с retry и безопасным хранением токенов.
- 24h window policy соблюдается; template path рабочий.
- Delivery/read/fail статусы фиксируются и доступны для этапа 11.
- Есть метрики, алерты и runbook на ключевые инциденты.
- UAT пройден на sandbox/prod-like окружении без blocker-дефектов.

## Риски и меры

- Риск: блокировка/ограничения Meta по качеству номера.
  - Мера: мониторинг quality rating + fallback канал уведомлений.
- Риск: drift формата webhook payload.
  - Мера: versioned parser + tolerant reading + контрактные тесты.
- Риск: токен истек и silent fail отправок.
  - Мера: proactive alerting по 401/403 + runbook rotation.
- Риск: неверный tenant mapping.
  - Мера: strict unique mapping + audit + deny-by-default при mismatch.
