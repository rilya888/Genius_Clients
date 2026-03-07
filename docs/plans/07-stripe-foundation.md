# Этап 07: Stripe Foundation (детальный план)

## Цель этапа

Подготовить безопасный и расширяемый foundation для Stripe, чтобы позже включить оплату без перелома архитектуры API/DB/админки.

## Scope этапа

Входит:
- Инфраструктурная интеграция Stripe SDK и конфигурации.
- Контракт webhook endpoint `/api/v1/webhooks/stripe`.
- Сервисный слой для customer management.
- Согласование модели данных `stripe_customers` и event dedup.
- Документация “как включить оплату позже”.

Не входит:
- Checkout Session/PaymentIntent flow в публичном сайте.
- Подписки и биллинг логика.
- Финальный UI платежей в админке.

## MVP Boundaries (зафиксировано)

- Оплаты в MVP выключены.
- Нет шага оплаты в booking flow.
- Stripe используется только как foundation:
  - customer management;
  - webhook ingestion;
  - подготовка к будущему billing.

## Архитектурные принципы

- **Security-first:** секреты не храним в клиентском коде и не логируем.
- **Idempotent processing:** все webhook события обрабатываются безопасно при повторах.
- **Tenant-safe mapping:** любая Stripe сущность должна быть связана с tenant.
- **Forward-compatible:** структура допускает переход к Connect/subscriptions post-MVP.

## Конфигурация и окружение

Глобальные переменные:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_API_VERSION` (pinning версии Stripe API)

Требования:
- Разные ключи для `staging` и `production`.
- Ключи хранятся только в secret manager/окружении Railway.
- Никаких raw secret значений в логах, скриншотах, README.
- Stripe API version фиксируется явно (без auto-upgrade поведения).

## Модель данных и связи

Базовая таблица:
- `stripe_customers` (см. этап 02):
  - `tenant_id`
  - `stripe_customer_id`
  - `email`
  - timestamps

Для дедупликации webhook:
- использовать общую таблицу `webhook_events`:
  - `provider = 'stripe'`
  - `external_event_id = event.id`

Правила:
- инвариант: `1 tenant = 1 stripe customer` (ровно один активный customer на tenant).
- при повторном запросе использовать `getOrCreateCustomer`.

## Multi-tenant стратегия Stripe (MVP и перспектива)

MVP:
- единый Stripe account проекта.
- tenant-разделение в приложении (по `tenant_id`).

Post-MVP направление:
- поддержка Stripe Connect (при необходимости revenue split/merchant-of-record вариантов).
- расширение модели tenant settings для Stripe account linking.

## API / service contracts

### Внутренний сервис (без публичного UI flow)

Минимальный сервис:
- `createCustomer(tenantId, email, name?)`
- `getOrCreateCustomer(tenantId, email, name?)`
- `findCustomerByTenant(tenantId)`

Поведение:
- повторные вызовы не создают дублей;
- при конфликте email/customer ID — deterministic resolution и audit event.
- все write-вызовы в Stripe используют `Idempotency-Key`.

### Webhook endpoint

- `POST /api/v1/webhooks/stripe`
- обязательная проверка `Stripe-Signature`.
- обязательная работа с `raw request body` для корректной верификации подписи.
- ответ `200` только после корректной валидации/постановки в обработку.

События MVP (allowlist):
- `customer.created`
- `customer.updated`
- `customer.deleted` (опционально как no-op + sync marker)
- `payment_intent.succeeded` (foundation readiness; без бизнес-эффектов в MVP)
- `payment_intent.payment_failed` (foundation readiness)

Все остальные события:
- игнорируются безопасно, логируются как `ignored_event_type`.

## Webhook processing semantics

Шаги:
1. Проверить подпись Stripe.
2. Распарсить event и проверить `event.type` в allowlist.
3. Проверить dedup (`webhook_events`).
4. Сохранить событие и обработать идемпотентно.
5. Обновить `processed_at`.

Поведение ошибок:
- невалидная подпись -> `400/401`.
- временная внутренняя ошибка -> `5xx` (Stripe retry).
- дубликат события -> `200` (no-op).

## Partial failure и reconciliation policy

- Если Stripe customer создан, а локальная запись в `stripe_customers` не создалась:
  - задача уходит в retry queue;
  - при исчерпании retry — reconciliation job по `tenant_id/email`.
- Если локальная запись создана, но Stripe операция не подтверждена:
  - помечать состояние как `pending_sync`;
  - periodic reconcile до консистентного состояния.

## Безопасность

- Подпись webhook обязательна всегда.
- Секреты маскируются в логах.
- Запрещено возвращать внутренние детали Stripe ошибок в клиентские ответы.
- Все операции Stripe доступны только через backend/BFF, не напрямую из browser.

## Observability и операционка

Логировать:
- `stripe_webhook_received`
- `stripe_webhook_processed`
- `stripe_webhook_ignored`
- `stripe_webhook_failed`
- `stripe_customer_created`
- `stripe_customer_reused`

Метрики:
- количество webhook событий по типам;
- доля failed processing;
- latency обработки webhook.
- размер таблицы `webhook_events` и число записей старше retention.

Алерты (минимум):
- spike failed Stripe webhooks;
- отсутствие успешных Stripe webhook при входящем трафике событий.

Data retention:
- `webhook_events` для Stripe хранить 90 дней.
- Старые события удалять/архивировать по расписанию (ежедневная cleanup job).

## Secret rotation runbook

- Ротация `STRIPE_SECRET_KEY` и `STRIPE_WEBHOOK_SECRET` выполняется через staged rollout:
  1. Обновить ключи в staging, проверить webhook processing.
  2. Обновить production secrets.
  3. Проверить smoke-событие и метрики ошибок.
- Во время ротации не логировать старые/новые секреты.

## Интеграция с админкой (MVP)

- Раздел “Платежи” может быть:
  - скрыт feature-flag,
  - или read-only заглушка “Coming soon”.
- Разрешается показывать:
  - статус Stripe foundation (`configured/not configured`);
  - без возможности запускать checkout.

## Тестовая стратегия этапа

- Unit:
  - signature verification wrapper,
  - idempotent event handling,
  - getOrCreate customer logic.
- Integration:
  - webhook endpoint (valid signature / invalid signature / duplicate event),
  - запись в `webhook_events`,
  - sync с `stripe_customers`.
- Contract tests:
  - OpenAPI описание webhook endpoint.

## Ownership

- Stripe integration backend: `Backend Lead`.
- Webhook reliability/ops: `Backend + DevOps`.
- Security review: `Architect`.

## Риски и профилактика

- Риск: дубли/повторы webhook создают повторные side effects.  
  Мера: strict dedup через `webhook_events` + идемпотентные handlers.
- Риск: утечка секретов Stripe.  
  Мера: secret manager + log redaction policy.
- Риск: раннее включение оплаты без готового бизнес-процесса.  
  Мера: жесткий MVP boundary (без checkout в production flow).
- Риск: vendor lock-in сложности при multi-tenant monetization.  
  Мера: заранее описанная стратегия перехода к Connect.

## Definition of Done (детально)

- [ ] Stripe SDK и конфигурация окружений (`staging/production`) зафиксированы.
- [ ] Зафиксированы `STRIPE_API_VERSION` и raw-body требование для webhook signature.
- [ ] Реализован и задокументирован `/api/v1/webhooks/stripe`.
- [ ] Проверка `Stripe-Signature` обязательна.
- [ ] Обработка webhook событий идемпотентна и использует dedup таблицу.
- [ ] Сервис `createCustomer/getOrCreateCustomer` определен и покрыт тестами.
- [ ] Зафиксирован инвариант `1 tenant = 1 stripe customer`.
- [ ] Для outbound Stripe write-вызовов зафиксирована idempotency policy.
- [ ] Модель `stripe_customers` согласована с этапом 02.
- [ ] Описаны partial-failure reconciliation и retry flow.
- [ ] Зафиксирован retention для `webhook_events` (90 дней) и cleanup-процесс.
- [ ] Описан runbook ротации Stripe секретов.
- [ ] В админке определен foundation-статус платежей без checkout UI.
- [ ] Подготовлена инструкция включения оплаты post-MVP.

## Definition of Ready для будущего платежного этапа

- [ ] Есть стабильный mapping tenant <-> stripe_customer.
- [ ] Webhook pipeline работает надежно и наблюдаем.
- [ ] Security требования Stripe соблюдены (подписи, секреты, redaction).
- [ ] Архитектура готова к добавлению Checkout/Connect без breaking changes.
