# Отчет о проделанной работе (2026-03-06)

## 1. Контекст задачи

Запрос: выполнить pre-deploy подготовку и закрыть 7 пунктов до состояния максимально возможной готовности без полноценного production deploy.

## 2. Что реализовано

### 2.1 База данных и миграции

- Расширена схема `notification_deliveries` для retry/DLQ:
  - `attempt_count`
  - `max_attempts`
  - `next_attempt_at`
  - `last_attempt_at`
  - `dead_lettered_at`
- Добавлен индекс диспетчеризации: `idx_notification_delivery_dispatch`.
- Добавлена foundation-таблица `stripe_customers`.
- Добавлена миграция:
  - `packages/db/migrations/0002_notifications_retry_dlq_and_stripe_foundation.sql`

### 2.2 Backend API

- Добавлен `StripeRepository`:
  - upsert customer mapping (`tenant_id`, `stripe_customer_id`, `email`, `user_id`)
  - list/find методы.
- Расширен `WebhookService`:
  - в Stripe webhook добавлена обработка customer mapping в `stripe_customers`.
- Расширены admin-эндпоинты:
  - `GET /api/v1/admin/stripe-customers` (owner-only)
- Расширены admin summary/list notification deliveries:
  - учтен `dead_letter`
  - добавлены поля попыток/времени.

### 2.3 Worker (надежность доставки)

- Реализован retry/backoff/DLQ pipeline:
  - обработка статусов `queued` и `failed`
  - экспоненциальный backoff
  - перевод в `dead_letter` при исчерпании лимита попыток
- Добавлены env-параметры worker:
  - `WORKER_DELIVERY_MAX_ATTEMPTS`
  - `WORKER_DELIVERY_BACKOFF_BASE_SECONDS`

### 2.4 Bot интеграции

- Добавлен WhatsApp webhook adapter в bot:
  - `GET /webhooks/whatsapp` (verify handshake)
  - `POST /webhooks/whatsapp` (inbound receive)
  - проверка подписи (`x-hub-signature-256`)
- Добавлена отправка WhatsApp outbound сообщений через Meta API.
- Унифицирована обработка входящих команд и текста для каналов Telegram/WhatsApp через общий обработчик.

### 2.5 Web / Admin UI

- Расширена страница уведомлений:
  - отображение `Dead Letter`
  - отображение счетчика попыток `attemptCount/maxAttempts`

### 2.6 Скрипты pre-deploy и smoke

Добавлены скрипты:

- `scripts/validate-env.mjs` — проверка обязательных env по группам сервисов.
- `scripts/release/predeploy.mjs` — последовательный запуск quality gates.
- `scripts/smoke/local-smoke.mjs` — локальные health/smoke проверки.

Обновлены команды в корневом `package.json`:

- `pnpm predeploy:env`
- `pnpm predeploy:quality`
- `pnpm predeploy`
- `pnpm smoke:local`
- `pnpm test`

### 2.7 Минимальный автотест-контур

- Добавлены тесты в i18n:
  - `packages/i18n/src/locale.test.ts`
  - `packages/i18n/src/t.test.ts`

### 2.8 Документация эксплуатации

Добавлены документы:

- `docs/operations/release-checklist.md`
- `docs/operations/rollback-runbook.md`
- `docs/operations/incident-runbook.md`

Обновлен `README.md` (predeploy/smoke команды, webhook endpoints).

## 3. Проверки и прогоны

### 3.1 Что реально запущено

- `pnpm install` — успешно (после фикса TLS для corepack/pnpm).
- `pnpm predeploy` — запускается, env-check проходит.
- `node --check` для новых `.mjs` скриптов — успешно.
- `node scripts/smoke/local-smoke.mjs` — исполняется.

### 3.2 Обнаруженные блокеры

1. `pnpm predeploy` падает на существующих проблемах проекта (не только новых изменений):
- `apps/web`: множественные TS/JSX ошибки и missing imports.
- `apps/api`: runtime resolution issues при локальном запуске.

2. Локальный инфраструктурный контур не поднят полностью:
- Docker daemon недоступен (`Cannot connect to the Docker daemon`).
- Из-за этого БД/Redis локально не стартуют стабильным способом.

3. Railway staging не готов в этой рабочей связке:
- linked project: `geniuslab-it`
- доступен только `production` environment
- отсутствует выделенный staging + не подтверждена структура сервисов для миграций/смоуков.

## 4. Что исправлено дополнительно по ходу

- Добавлен `@types/pg` в `packages/db/devDependencies`.
- Убраны жесткие `rootDir` из tsconfig для `apps/api`, `apps/bot`, `apps/worker`, чтобы убрать конфликт с workspace imports.

## 5. Файлы, затронутые в этой итерации

- `packages/db/src/schema/tables.ts`
- `packages/db/migrations/0002_notifications_retry_dlq_and_stripe_foundation.sql`
- `apps/api/src/repositories/stripe-repository.ts`
- `apps/api/src/repositories/index.ts`
- `apps/api/src/repositories/admin-repository.ts`
- `apps/api/src/repositories/notification-repository.ts`
- `apps/api/src/services/webhook-service.ts`
- `apps/api/src/services/admin-service.ts`
- `apps/api/src/routes/admin/index.ts`
- `apps/worker/src/index.ts`
- `apps/bot/src/index.ts`
- `apps/web/app/admin/notifications/page.tsx`
- `scripts/validate-env.mjs`
- `scripts/release/predeploy.mjs`
- `scripts/smoke/local-smoke.mjs`
- `packages/i18n/src/locale.test.ts`
- `packages/i18n/src/t.test.ts`
- `docs/operations/release-checklist.md`
- `docs/operations/rollback-runbook.md`
- `docs/operations/incident-runbook.md`
- `infra/docker-compose.local.yml`
- `README.md`
- `.env.example`
- `package.json`
- `packages/db/package.json`
- `packages/i18n/package.json`
- `apps/api/tsconfig.json`
- `apps/bot/tsconfig.json`
- `apps/worker/tsconfig.json`

## 6. Итоговый статус

- Архитектурно и кодово pre-deploy foundation существенно усилен (retry/DLQ, Stripe foundation, WhatsApp adapter, runbooks, predeploy tooling).
- Полное закрытие predeploy pipeline в green пока невозможно без устранения существующих ошибок в `apps/web`/`apps/api` и подготовки рабочей среды для staging миграций и smoke.

## 7. Следующие шаги

1. Довести `apps/web` и `apps/api` до green `lint/typecheck/build`.
2. Подготовить staging окружение (Railway) с доступным Postgres и сервисами `web/api/bot/worker`.
3. Применить миграцию `0002` в staging и прогнать smoke на staging URL.
4. После staging green — финальный deploy в production по runbook.
