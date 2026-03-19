# 29. План реализации супер-админки для управления подписками и сервисом

## Цель

Создать супер-админку платформы, где без деплоя можно:
- менять цены подписок;
- менять состав включенных услуг и лимитов;
- публиковать новую версию тарифов;
- назначать тарифы тенантам;
- вести аудит изменений.

## Зафиксированные решения из чата

- На этапе 1 супер-админ один (доступ по серверному секрету).
- Смена тарифа для тенанта применяется только со следующего биллингового цикла.
- При превышении лимитов — только режим `hard_block`.
- В каждом тарифе бот обязателен.
- Канал этапа 1: только WhatsApp.

## Обязательные требования

- Отдельный контур доступа (не смешивать с tenant-admin).
- Полный audit log изменений тарифов/лимитов.
- Versioned конфигурация тарифов (draft/published).
- Возможность rollback на прошлую опубликованную версию.

## Архитектура

- Frontend: `/super-admin` в `apps/web`.
- Backend API: `/api/v1/super-admin/*`.
- Auth: отдельный super-admin middleware и cookie namespace.
- DB: таблицы тарифов, фич, версий, назначений, аудита.

## Доступ по серверному секрету

- `SUPER_ADMIN_LOGIN_SECRET`
- `SUPER_ADMIN_SESSION_SECRET`
- `SUPER_ADMIN_SESSION_TTL_HOURS`

Поток:
1. POST login с секретом.
2. Проверка через `timingSafeEqual`.
3. Выдача signed short-lived session cookie.
4. Все super-admin маршруты требуют валидную сессию.

## Модель данных

- `subscription_plans`
- `subscription_plan_features`
- `subscription_plan_versions`
- `tenant_subscriptions`
- `super_admin_audit_log`

Для `tenant_subscriptions` обязательно:
- `billing_cycle_anchor`
- `pending_plan_code`
- `change_mode = next_cycle`

## API (MVP)

- `POST /api/v1/super-admin/auth/login`
- `POST /api/v1/super-admin/auth/logout`
- `GET /api/v1/super-admin/plans`
- `POST /api/v1/super-admin/plans`
- `PUT /api/v1/super-admin/plans/:id`
- `PUT /api/v1/super-admin/plans/:id/features`
- `POST /api/v1/super-admin/plans/publish`
- `POST /api/v1/super-admin/plans/rollback/:version`
- `GET /api/v1/super-admin/tenants`
- `PUT /api/v1/super-admin/tenants/:tenantId/subscription`
- `GET /api/v1/super-admin/audit-log`

## Правила применения смены тарифа

- Любое изменение для действующего тенанта — только next billing cycle.
- До даты применения работает текущий тариф.
- UI обязан показывать текущий и запланированный тариф + дату вступления.

## Лимиты и биллинг

- На этапе 1 overage отключен.
- Проверки лимитов работают в режиме `hard_block`.

## Безопасность

- Не логировать секреты.
- Rate-limit login endpoint.
- CSRF защита.
- (Опционально) IP allowlist на `/super-admin`.

## Этапы

1. Foundation: миграции + auth middleware + каркас API.
2. API MVP: CRUD тарифов + publish/rollback + назначения.
3. UI MVP: login + editor + publish center + tenant mapping + audit.
4. Интеграция лимитов в runtime.
5. QA и hardening.

## Критерии готовности

- Можно менять цену и состав услуг в тарифах.
- Можно публиковать/откатывать версию.
- Можно назначать тариф тенанту на следующий цикл.
- Все действия пишутся в audit log.
