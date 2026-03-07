# Этап 04: Backend API (детальный план)

## Цель этапа

Спроектировать backend API уровня `/api/v1`, который:
- обслуживает Public/Admin/Bot сценарии MVP;
- соответствует BFF-модели и tenant-isolation;
- готов к интеграциям WA/TG/Stripe, уведомлениям и hardening этапам.

## Scope этапа

Входит:
- Контракты REST endpoint-ов (`/api/v1`).
- Middleware-пайплайн (auth, tenant-context, validation, idempotency, rate-limit).
- Сервисный слой (slots, bookings, masters/services, notifications trigger points).
- Webhook contracts для Stripe/WhatsApp/Telegram.
- Error model, audit hooks, observability baseline.

Не входит:
- Полноценная реализация UI/admin/public.
- Prompt logic OpenAI (детально в этапе 08).
- Финальные production hardening-механики сверх agreed MVP.

## Архитектурные принципы

- **BFF-only:** браузер не вызывает API напрямую, только через Next.js server layer.
- **Versioning:** все endpoint-ы только под `/api/v1`.
- **Tenant safety:** tenant context только из доверенных источников.
- **Thin routes / fat services:** бизнес-логика в service-слое, роуты только orchestration.
- **DB invariants first:** критичные ограничения на уровне БД (этап 02), API не дублирует лишнее.
- **Contract-first:** OpenAPI спецификация обязательна и является источником истины для API-контрактов.

## Структура API сервиса

```
apps/api/
├── src/
│   ├── routes/
│   │   ├── auth/
│   │   ├── public/
│   │   ├── admin/
│   │   └── webhooks/
│   ├── services/
│   │   ├── slot-service.ts
│   │   ├── booking-service.ts
│   │   ├── catalog-service.ts
│   │   ├── auth-service.ts
│   │   └── webhook-service.ts
│   ├── middleware/
│   │   ├── internal-auth.ts
│   │   ├── jwt-auth.ts
│   │   ├── tenant-context.ts
│   │   ├── rate-limit.ts
│   │   ├── idempotency.ts
│   │   └── validate.ts
│   ├── schemas/          # zod/valibot request/response schemas
│   ├── repositories/     # db-access layer
│   ├── lib/              # logger, errors, time utils
│   └── index.ts
└── package.json
```

## Tenant resolution и security model

### Public/Admin через BFF

- Next.js извлекает tenant из `Host` (`{slug}.yourapp.com`).
- Next.js передает в API:
  - `X-Internal-Tenant-Id`
  - `X-Internal-Secret`
- API валидирует `X-Internal-Secret` против `INTERNAL_API_SECRET`.
- API не доверяет клиентским `X-Tenant-Slug`/`tenant` query.

### Auth/Admin

- JWT несет `user_id`, `tenant_id`, `role`, `token_version`.
- Любой admin endpoint проверяет tenant из JWT и сверяет с tenant-context запроса.
- Browser <-> Next.js: только `HttpOnly` cookie для сессии (без хранения bearer в JS runtime браузера).
- Next.js <-> API: service-to-service auth через `X-Internal-Secret`.

### Webhooks

- WhatsApp: tenant определяется по `phone_number_id` из `tenant_whatsapp_configs`.
- Telegram: tenant по deep-link/start-параметру или маппингу chat-to-tenant.
- Stripe: tenant через собственный mapping metadata/customer.

## API conventions

- Base path: `/api/v1`.
- Формат ответа:
  - успех: `{ "data": ... , "meta": ...? }`
  - ошибка: `{ "error": { "code": "...", "message": "...", "details": ...? } }`
- Request validation: schema-first (Zod/аналог), `400` на invalid input.
- Correlation ID: `X-Request-Id` в запросе/ответе.
- Временные поля: ISO-8601 UTC.

## OpenAPI contract-first

- Обязательный артефакт этапа: `apps/api/openapi/openapi.yaml`.
- Любой endpoint добавляется/меняется сначала в OpenAPI, затем в коде.
- OpenAPI включает:
  - схемы request/response;
  - error codes;
  - auth requirements;
  - примеры payload.
- Из OpenAPI генерируются typed-контракты для BFF и (по необходимости) bot-клиента.

## Эндпоинты (контракт MVP)

### Auth

| Method | Path | Назначение |
|---|---|---|
| POST | `/api/v1/auth/register` | Создать `tenant + owner user` |
| POST | `/api/v1/auth/login` | Выдать access/refresh |
| POST | `/api/v1/auth/refresh` | Ротация refresh token |
| POST | `/api/v1/auth/logout` | Отзыв refresh token |
| POST | `/api/v1/auth/forgot-password` | Создать reset token |
| POST | `/api/v1/auth/reset-password` | Смена пароля по токену |

Требования:
- Email глобально уникален.
- Password policy и hash (bcrypt/argon2).
- Audit-log на register/login/reset.

### Public

| Method | Path | Назначение |
|---|---|---|
| GET | `/api/v1/public/tenants/:slug` | Публичная инфо tenant |
| GET | `/api/v1/public/masters` | Список активных мастеров (локализованный) |
| GET | `/api/v1/public/services` | Список активных услуг (локализованный) |
| GET | `/api/v1/public/slots` | Доступные слоты (`master_id` optional; без `master_id` = режим Any master) |
| POST | `/api/v1/public/bookings` | Создать booking (`pending`) |

Требования к `POST /public/bookings`:
- Обязателен `client_consent = true` (запись `client_consent_at`).
- Поддержка `Idempotency-Key`.
- Tenant определяется из internal context, не из body/query.

### Admin

| Method | Path | Назначение |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/v1/admin/masters` | CRUD мастеров |
| GET/POST/PUT/DELETE | `/api/v1/admin/master-translations` | CRUD переводов мастеров |
| GET/POST/PUT/DELETE | `/api/v1/admin/services` | CRUD услуг |
| GET/POST/PUT/DELETE | `/api/v1/admin/service-translations` | CRUD переводов услуг |
| GET/POST/PUT/DELETE | `/api/v1/admin/master-services` | Связь мастер-услуга |
| GET/POST/PUT/DELETE | `/api/v1/admin/working-hours` | Рабочие часы |
| GET/POST/PUT/DELETE | `/api/v1/admin/exceptions` | Исключения расписания |
| GET | `/api/v1/admin/bookings` | Список и фильтры |
| PATCH | `/api/v1/admin/bookings/:id` | Смена статуса |
| PATCH | `/api/v1/admin/tenant-settings` | booking horizon/buffer/timezone/locale |

Особенности:
- “Удаление” мастеров/услуг: `is_active = false` (soft deactivate).
- Любой CRUD пишет `audit_logs`.

## Authorization matrix (owner/admin)

- `owner`:
  - полный доступ ко всем admin endpoint;
  - изменение tenant settings;
  - управление интеграциями (WA/TG/Stripe).
- `admin`:
  - CRUD мастеров/услуг/расписания/записей;
  - без изменения критичных tenant/integration/security settings.
- Любой доступ проверяется по `role` из JWT + `tenant_id`.

### Webhooks

| Method | Path | Назначение |
|---|---|---|
| GET/POST | `/api/v1/webhooks/whatsapp` | Verify + входящие WA |
| POST | `/api/v1/webhooks/telegram` | Входящие TG updates |
| POST | `/api/v1/webhooks/stripe` | Stripe events |

Требования:
- Проверка подписей обязательна.
- Event dedup через `webhook_events`.
- Обработка идемпотентна.

## Slot service (детальный алгоритм)

Вход:
- `tenant_id`, `service_id`, `date`, `master_id?`, `locale`.

Шаги:
1. Проверить горизонт бронирования (`booking_horizon_days`).
2. Проверить минимальный lead-time (`booking_min_advance_minutes`).
3. Загрузить рабочие часы и исключения.
4. Загрузить существующие active bookings (`pending`, `confirmed`).
5. Рассчитать эффективную длительность:
   - `master_services.duration_minutes_override` или `services.duration_minutes`.
6. Добавить `buffer_minutes`.
7. Построить слоты с заданным шагом (рекомендуемо 5/10/15 мин, фиксируется в config).
8. Убрать пересечения и прошедшее время.
9. Вернуть слоты в timezone tenant, но с UTC-value для API.

Выход:
- список `{ start_at, end_at, display_time, master_id }` (для режима Any master обязательно возвращать мастер для каждого слота).

## Booking lifecycle API

Статусы:
- `pending` -> `confirmed` -> `completed`
- `pending|confirmed` -> `cancelled`

Правила:
- `completed` только для прошлого времени.
- `cancelled` нельзя вернуть обратно без новой записи (MVP правило).
- Любая смена статуса фиксируется в `audit_logs`.
- Переход статуса выполняется с optimistic guard (expected current status), чтобы избежать гонок.

Side effects:
- `pending` create -> admin notification trigger.
- `confirmed` -> client confirmation notification trigger.
- `cancelled` -> cancellation notification trigger.

## Validation policy

- Все input DTO валидируются schema-слоем.
- Системные валидации:
  - UUID формат.
  - дата/время не в прошлом.
  - locale только `it|en`.
  - phone в формате E.164.
  - email format.
  - GDPR consent required для public booking.

## Idempotency policy

- Применяется минимум к:
  - `POST /api/v1/public/bookings`
  - webhook processing endpoints
- Хранилище: `idempotency_keys`.
- Поведение:
  - тот же key + тот же payload -> вернуть сохраненный результат;
  - тот же key + другой payload -> `409`.

## Rate limiting и anti-abuse

- Public slots/bookings: `100 req/min/IP`.
- Auth login: `5 attempts / 5 min / email`.
- Forgot-password: ограничение по email и IP.
- Webhooks: отдельные limits, но без блокировки валидных provider retries.
- Для public booking в MVP используем только rate-limit (без captcha/challenge).

## Pagination / filtering standard

- Общий формат:
  - `data: []`
  - `meta: { pagination: ... }`
- `admin/bookings`: cursor-based pagination (рекомендуемо по `created_at,id`).
- `admin/masters`, `admin/services`: offset pagination допустима в MVP (`limit`, `offset`), с возможностью перейти на cursor позже.
- Фильтры и сортировка:
  - whitelisted поля сортировки;
  - валидация операторов фильтра на уровне schema.

## Error model (единый каталог)

- `AUTH_INVALID_CREDENTIALS` (`401`)
- `AUTH_UNAUTHORIZED` (`401`)
- `AUTH_FORBIDDEN` (`403`)
- `TENANT_NOT_FOUND` (`404`)
- `BOOKING_SLOT_CONFLICT` (`409`)
- `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD` (`409`)
- `VALIDATION_ERROR` (`400`)
- `RATE_LIMITED` (`429`)
- `INTERNAL_ERROR` (`500`)

Требование:
- Ошибки локализуются через i18n-ключи, но имеют стабильный machine code.

## Observability baseline

- Structured logs: request_id, tenant_id, route, status_code, latency_ms.
- Бизнес-события:
  - booking_created
  - booking_confirmed
  - booking_cancelled
  - webhook_received / webhook_processed / webhook_failed
- Health endpoint: `GET /api/v1/health`.

PII logging policy:
- Маскировать/редактировать: `client_phone`, `client_email`, токены/секреты/подписи.
- Не логировать raw access/refresh tokens, webhook signatures и пароли.
- Для диагностики использовать безопасные идентификаторы (`booking_id`, `tenant_id`, `request_id`).

Performance targets (MVP baseline):
- `GET /api/v1/public/slots`: p95 <= 400ms при типичной нагрузке.
- `POST /api/v1/public/bookings`: p95 <= 500ms без внешних webhook side-effects.
- `GET /api/v1/admin/bookings`: p95 <= 300ms на стандартных фильтрах.

## Интеграция с i18n

- API принимает `locale` (из BFF контекста) для локализуемых response fields.
- Данные мастеров/услуг берутся из translation-таблиц с fallback:
  - requested locale -> tenant default -> en.
- Ошибки возвращают:
  - `error.code` (stable)
  - `error.message` (localized)

## Webhook ack/retry semantics

- Verify signature/secret до любой бизнес-обработки.
- Если подпись невалидна: `401/403`.
- Если payload невалиден: `400`.
- Если событие принято в обработку (в т.ч. асинхронно через queue): `200` максимально быстро.
- Если временная внутренняя ошибка: `5xx`, провайдер должен сделать retry.
- Повторные события безопасны за счет dedup (`webhook_events`).

## Тестовая стратегия этапа

- Unit:
  - slot calculation
  - booking status transitions
  - idempotency behavior
- Integration:
  - tenant isolation
  - CRUD admin/public happy path
  - webhook signature verification + dedup
  - translation fallback queries
- Concurrency:
  - параллельное создание booking в один слот -> один успех, остальные conflict.

## Ownership

- API contracts и middleware: `Backend Lead`.
- Auth + security checks: `Backend Lead + Architect`.
- Webhook flows: `Integrations Engineer`.
- Test coverage: `Backend Team`.

## Риски и профилактика

- Риск: утечка tenant-данных через ошибки/фильтры.  
  Мера: tenant-context middleware + integration tests.
- Риск: race conditions при бронировании.  
  Мера: транзакции + DB exclusion constraints + conflict handling.
- Риск: дубли webhook событий.  
  Мера: webhook event dedup + idempotent handlers.
- Риск: рассинхрон API и i18n/DB translation модели.  
  Мера: единые DTO и fallback contract tests.

## Definition of Done (детально)

- [ ] Зафиксирован полный `/api/v1` контракт для auth/public/admin/webhooks.
- [ ] OpenAPI (`openapi.yaml`) создан и используется как source of truth.
- [ ] Описан middleware pipeline и security checks.
- [ ] Зафиксирован `HttpOnly cookie` подход для browser <-> BFF.
- [ ] Описан slot algorithm с tenant constraints и buffer/lead-time.
- [ ] Описана idempotency policy для bookings и webhooks.
- [ ] Зафиксирована authorization matrix (`owner/admin`) по endpoint-группам.
- [ ] Зафиксирован pagination/filtering standard.
- [ ] Описана error model с machine-readable codes.
- [ ] Описана базовая observability и health endpoint.
- [ ] Зафиксированы PII logging policy и webhook ack/retry semantics.
- [ ] Зафиксированы API performance targets (p95 baseline).
- [ ] Определена тестовая стратегия unit/integration/concurrency.
- [ ] Контракты согласованы с этапами 02/03/06/08/11/14.

## Definition of Ready для Этапов 05/06/08/09/10/11

- [ ] Public/Admin endpoint-ы стабильны и версионированы.
- [ ] Для фронта зафиксированы request/response DTO.
- [ ] Для бота зафиксированы сервисные контракты slots/createBooking/cancelBooking.
- [ ] Для webhook-провайдеров зафиксированы signature/dedup правила.
- [ ] Для notifications определены trigger points в booking lifecycle.
