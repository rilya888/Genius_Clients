# 30. Реализация супер-админки: рабочий чеклист

Основа: `29-super-admin-panel-subscriptions-and-service-governance.md`

## Зафиксированные решения

- Один супер-админ (server secret).
- Смена тарифа только со следующего биллингового цикла.
- Лимиты в режиме `hard_block`.

## Этап A: Foundation

- [x] Миграции: планы, фичи, версии, tenant subscriptions, audit log.
- [x] Super-admin auth (secret login + session token).
- [x] Каркас `/api/v1/super-admin/*`.

## Этап B: API MVP

- [x] Login/logout.
- [x] CRUD планов.
- [x] Редактор фич/лимитов.
- [x] Publish/rollback.
- [x] Назначение тарифа тенанту (next cycle).
- [x] Audit log endpoint.

## Этап C: UI MVP

- [x] `/super-admin/login`.
- [x] Список тарифов.
- [x] Редактор цены и состава пакета.
- [x] Publish center (diff + confirm).
- [x] Список тенантов и привязка тарифа.
- [x] Просмотр audit log.

## Этап D: Runtime integration

- [x] Чтение активного published плана.
- [x] Проверки лимитов `max_salons`, `max_staff`, `max_bookings_per_month`.
- [x] Блокировка операций при превышении.

Примечание:
- В текущей single-salon архитектуре проверка `max_salons` валидирует базовую емкость (1 `default` salon).
- При внедрении multi-salon нужна доработка проверки на фактическое число салонов.

## Этап E: QA

- [x] Unit/integration тесты auth и publish flow.
- [x] E2E smoke: login -> edit -> publish -> verify.
- [x] Security проверка (rate-limit, CSRF, no-secret-logs).
