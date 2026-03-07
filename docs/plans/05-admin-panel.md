# Этап 05: Admin Panel (детальный план)

## Цель этапа

Построить админ-панель tenant-а, через которую владелец управляет каталогом, расписанием, записями и настройками бизнеса без обращения к разработчику.

## Scope этапа

Входит:
- UI/UX каркас админки (layout, навигация, экраны, формы).
- Интеграция с `/api/v1/admin/*` и `/api/v1/auth/*`.
- Управление мастерами, услугами, переводами, расписанием, записями, tenant settings.
- RBAC-поведение (`owner/admin`) в UI.
- i18n для `it/en` (формальный стиль).

Не входит:
- Публичный сайт клиента (этап 06).
- Продвинутые отчеты/аналитика.
- Реализация платежного UI beyond foundation.

## MVP Boundaries (зафиксировано)

- Действия с bookings только поштучные (без bulk confirm/cancel).
- CSV export/import в MVP не реализуется.
- Read-only экран `Recent changes` по `audit_logs` не входит в MVP.

## Архитектурные принципы

- **BFF-first:** браузер работает только с Next.js сервером; прямого доступа к api нет.
- **API contract-first:** frontend ориентируется на OpenAPI contracts из этапа 04.
- **No hardcoded text:** все UI тексты через i18n ключи.
- **Safe by default:** destructive action только через подтверждение.
- **Config over code:** бизнес-правила управляются из tenant settings.

## Информационная архитектура (IA)

Маршруты админки:
- `/admin/dashboard` (MVP-lite: короткий обзор)
- `/admin/masters`
- `/admin/services`
- `/admin/schedule/working-hours`
- `/admin/schedule/exceptions`
- `/admin/bookings`
- `/admin/settings/general`
- `/admin/settings/integrations` (WA/TG foundation)

Навигация:
- Sidebar: Dashboard, Bookings, Masters, Services, Schedule, Settings.
- Global topbar: tenant name, locale switcher, user menu (logout).

## Auth и session model

- Login/register flows используют `/api/v1/auth/*`.
- Browser session: `HttpOnly` cookie (через BFF), без bearer в browser JS.
- После login:
  - редирект на `{slug}.yourapp.com/admin/dashboard`.
- Logout:
  - вызов `/api/v1/auth/logout` + очистка сессии.

## RBAC в UI

- `owner` видит и редактирует все разделы.
- `admin`:
  - доступ к bookings/catalog/schedule;
  - без доступа к критичным tenant/integration/security настройкам.
- UI скрывает недоступные действия, backend все равно валидирует роль.

## Разделы и функциональность

### 5.1 Dashboard (MVP-lite)

- Карточки:
  - bookings today;
  - pending bookings;
  - ближайшая запись;
  - quick links (create master/service, open bookings).
- Цель: быстрый вход в операционную работу.

### 5.2 Masters

Возможности:
- Список мастеров (таблица + фильтр active/inactive).
- Create/Edit/Deactivate.
- Сортировка (`sort_order`) и ручная перестановка (опционально drag-drop).
- Привязка услуг (`master_services`) и override длительности.
- Редактирование переводов:
  - `display_name` для `it/en`
  - `bio` (опционально)

Валидация:
- `slug` уникален в tenant.
- Нельзя деактивировать последнего активного мастера, если есть активные будущие записи (блокирующее предупреждение или forced workflow с переносом).

### 5.3 Services

Возможности:
- Список услуг (active/inactive).
- Create/Edit/Deactivate.
- Поля: slug, duration, price, sort_order.
- Переводы `name/description` в `it/en`.

Валидация:
- `duration_minutes > 0`.
- Если цена задана: `price_cents >= 0`.
- Для MVP требуем оба перевода (`it` и `en`) при сохранении.

### 5.4 Working Hours

Возможности:
- Настройка часов по дням недели.
- Поля: `is_closed`, `open_time`, `close_time`.
- Быстрый preset (например, “Mon-Fri 09:00-18:00”, опционально).

Валидация:
- `open_time < close_time`, если не выходной.
- Отображение времени в timezone tenant.

### 5.5 Schedule Exceptions

Возможности:
- Календарь исключений.
- Типы:
  - full-day closed;
  - custom hours;
  - per-master exception.
- Просмотр ближайших исключений списком.

Валидация:
- На одну дату не должно быть конфликтующих исключений для одного scope (tenant/master).

### 5.6 Bookings

Возможности:
- Таблица записей с фильтрами:
  - дата/период;
  - мастер;
  - статус;
  - источник (`web`, `whatsapp`, `telegram`).
- Пагинация (cursor-based, как в API).
- Карточка записи (детали клиента, источник, язык, consent, таймзона).
- Действия:
  - confirm (`pending -> confirmed`);
  - cancel (`pending|confirmed -> cancelled`);
  - mark completed (`confirmed -> completed`, только для прошлого времени);
  - ручное создание booking (MVP: через форму).

UX-предосторожности:
- Для смены статуса — подтверждающий modal.
- Optimistic UI only where safe; финальное состояние после revalidate от сервера.

### 5.7 Tenant Settings

#### General
- `name` (editable),
- `slug` (readonly),
- `address`,
- `default_locale`,
- `timezone`,
- `booking_horizon_days`,
- `booking_min_advance_minutes`,
- `buffer_minutes`,
- `admin_notification_email`,
- `admin_notification_telegram_chat_id`.

#### Integrations (foundation)
- WhatsApp:
  - status подключения,
  - `phone_number_id` (readonly after binding),
  - reconnect/disconnect flow (для `owner`).
- Telegram:
  - status и базовая информация.

Ограничения:
- Критичные настройки интеграций редактирует только `owner`.

## UX/Design system требования

- Desktop-first + корректная tablet версия.
- Единые form components и error states.
- Empty/loading/error/success состояния на каждом экране.
- Нотификации действий (toast/inline):
  - save success,
  - validation error,
  - api failure.

## Работа с API и данными

- Все вызовы через BFF server actions/route handlers.
- Валидация данных:
  - client-side для UX;
  - server-side обязательна через API schema.
- Синхронизация после мутаций:
  - invalidation/revalidate списков и карточек.
- Обработка API errors:
  - маппинг `error.code` -> i18n message.

## Формы и валидация (минимальный стандарт)

- Унифицированный form schema слой.
- Dirty-check для предупреждения о несохраненных изменениях.
- Поля времени/даты строго в tenant timezone.
- Для phone/email использовать нормализацию и подсказки формата.

## i18n в админке

- Языки: только `it`, `en`.
- Стиль сообщений: формальный.
- Все строки в `admin.json` / `common.json`.
- Переводимые бизнес-данные редактируются через translation-формы (`it/en`) в разделах masters/services.

## Безопасность и соответствие этапу 14

- CSRF защита для state-changing действий через BFF слой.
- UI не показывает чувствительные секреты (token refs masked).
- Audit-sensitive действия:
  - status change booking;
  - изменение расписания;
  - tenant/integration settings changes.
- Любое destructive действие требует explicit confirmation.

## Observability (frontend/admin)

- Логировать ключевые admin события (без PII):
  - master_created/updated/deactivated,
  - service_created/updated/deactivated,
  - booking_status_changed,
  - tenant_settings_updated.
- Ошибки UI отправлять в error tracking (Sentry обязателен в MVP).

## Тестовая стратегия этапа

- Unit:
  - form validation schemas,
  - маппинг API error codes в UI messages.
- Integration (UI+API mocks):
  - CRUD мастеров/услуг с переводами,
  - booking status transitions,
  - tenant settings update.
- E2E (критичный минимум):
  - login -> create master/service -> configure hours -> confirm booking.

## Ownership

- UX и компоненты: `Frontend Lead`.
- Интеграция с API/BFF: `Frontend + Backend`.
- RBAC и security UX: `Frontend + Architect`.
- Переводы интерфейса: `Product/Owner`.

## Риски и профилактика

- Риск: сложные формы приведут к ошибкам данных.  
  Мера: schema-driven forms + server validation + clear UX errors.
- Риск: RBAC расхождения между UI и API.  
  Мера: authorization matrix + integration tests.
- Риск: race conditions при ручной работе с bookings.  
  Мера: optimistic guard + forced revalidate после мутаций.
- Риск: плохая управляемость при росте данных.  
  Мера: стандартизированная pagination/filtering и быстрые фильтры.

## Definition of Done (детально)

- [ ] Реализована структура админки и маршруты разделов.
- [ ] Работают CRUD экраны для masters/services с переводами `it/en`.
- [ ] Работают экраны расписания (working hours + exceptions).
- [ ] Работает экран bookings с фильтрами, пагинацией и сменой статусов.
- [ ] Работают tenant settings (general + integrations foundation) с RBAC.
- [ ] Все тексты UI локализованы через i18n (формальный стиль).
- [ ] Ошибки API корректно отображаются по `error.code`.
- [ ] Минимальные E2E сценарии пройдены.
- [ ] Контракты UI синхронизированы с OpenAPI `/api/v1`.

## Definition of Ready для Этапа 06

- [ ] Admin создает и редактирует каталог/расписание без ручных SQL.
- [ ] Tenant settings (timezone, locale, booking constraints) управляются из UI.
- [ ] Есть валидные данные для публичного booking flow (services/masters/hours).
- [ ] RBAC и auth/session модель стабильно работают.
