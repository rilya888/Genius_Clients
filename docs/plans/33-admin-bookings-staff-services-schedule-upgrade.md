# 33. План доработки Admin: Bookings/Services/Staff/Schedule/Notifications (multi-salon ready)

## 1) Цели и рамки

Реализовать улучшения admin-панели по 7 пунктам:
1. Bookings: убрать ID, показывать человекочитаемую услугу, актуальный статус, добавить подтверждение записи.
2. Глобальные всплывающие уведомления о новых записях на страницах admin.
3. Services: modal редактирования/удаления существующих услуг + кнопка добавления новой услуги.
4. Staff: убрать ID, выпадающий статус, modal редактирования/удаления, кнопка добавления мастера.
5. Schedule: перейти к блочной модели по мастерам (имена вместо ID), редактирование дней/часов.
6. При деактивации мастера предупреждать о подтвержденных будущих записях.
7. Notification Center: убрать ID из UI.

Все изменения проектируются с перспективой multi-salon Enterprise.

## 2) Зафиксированные решения

1. **Переходы статусов booking**:
   - В списке Bookings даем действие только `pending -> confirmed` (кнопка `Confirm`).
   - Остальные переходы остаются отдельными admin-действиями.
   - На backend вводим строгую карту допустимых переходов.

2. **Удаление сущностей**:
   - Для `services` и `staff` используется **soft delete**.

3. **Права и доступ по салонам**:
   - `owner`: видит данные выбранного салона и может переключать салон.
   - `salon_admin`: видит только свой салон, без переключателя.
   - Все API-пути в admin проходят проверку scope (`tenantId` + `salonId`).

4. **Деактивация мастера с записями**:
   - Backend проверяет будущие `confirmed` записи.
   - UI показывает warning modal с количеством и ближайшими датами.
   - Админ может отменить или продолжить деактивацию с явным подтверждением.
   - Действие пишется в аудит.

## 3) Архитектурные принципы

1. Любое отображение в UI — только на основе актуальных данных из БД.
2. Слой API — единственный источник бизнес-правил (валидации, переходы статусов, проверки связей).
3. Никаких «скрытых» ID в интерфейсах, где они не несут ценности.
4. Новые контракты сразу формализуем с учетом `salonId` (даже если в текущем релизе частично заглушено).
5. Все критичные изменения включаются по feature-flag там, где возможен риск регрессий.

## 4) Этапы реализации

### Этап A. Backend-контракты и база

1. Bookings:
   - Добавить endpoint подтверждения записи (`PATCH /api/v1/admin/bookings/:id/status` или dedicated confirm endpoint).
   - Реализовать валидацию допустимого перехода `pending -> confirmed`.
   - Убедиться, что `serviceName` и `staffName` доступны в админ-списке booking.

2. Staff:
   - Ввести проверку уникальности имени мастера в рамках scope (`tenant + salon`).
   - Soft-delete для удаления мастера.
   - Проверка при переводе `active -> inactive`: наличие будущих `confirmed` booking.

3. Services:
   - Full CRUD (create/update/soft-delete).
   - Проверка зависимостей перед удалением (будущие записи).

4. Schedule:
   - Подготовить batched контракт обновления расписания мастера.
   - Валидация пересечений и некорректных интервалов.

5. Notifications:
   - Контракт получения новых booking-событий для всплывающих уведомлений (polling cursor).
   - Удаление ID из DTO, используемого в UI Notification Center (если не нужен клиенту).

### Этап B. Frontend: Bookings

1. Удалить колонку ID.
2. Показывать `serviceName` вместо кода.
3. Показ статуса с локализованным лейблом.
4. Добавить кнопку `Confirm` у `pending`.
5. Оптимистичное обновление строки + rollback при ошибке.

### Этап C. Frontend: Глобальные уведомления

1. Вынести Notification Provider в общий layout admin-приложения.
2. Запустить polling новых записей (интервал + дедупликация).
3. Toast: текст + CTA перехода в Bookings.
4. Ввести состояние «прочитано/получено» (минимум на клиенте, лучше через cursor API).

### Этап D. Frontend: Services

1. Кнопка `Add service`.
2. Клик по существующему сервису -> modal edit/delete.
3. Подключение к API create/update/delete.
4. Валидация форм и обработка конфликтов/ограничений удаления.

### Этап E. Frontend: Staff

1. Удалить колонку ID.
2. В Status — dropdown переключения.
3. Клик по мастеру -> modal edit/delete.
4. Кнопка `Add staff`.
5. Ошибка duplicate name в форме создания/редактирования.
6. Warning-flow при деактивации мастера с подтвержденными записями.

### Этап F. Frontend: Schedule (новое представление)

1. Карточки по мастерам (имя в заголовке).
2. Внутри карточки: дни недели и интервалы.
3. Добавление/редактирование/удаление интервалов.
4. Сохранение батчем через новый API.
5. UX-защиты: блокировка при unsaved changes, валидация на клиенте.

### Этап G. Notification Center

1. Убрать отображение ID.
2. Сохранить только информативные поля: тип, текст, время, действие.

## 5) Multi-salon и права (обязательные проверки)

1. В каждом admin endpoint:
   - проверка роли (`owner` / `salon_admin`),
   - проверка доступа к salon scope.
2. В frontend:
   - owner: selector салона в шапке/контексте,
   - salon_admin: фиксированный salon context.
3. События/уведомления всегда фильтруются по активному salon context.

## 6) Миграции и целостность данных

1. Индексы под частые запросы:
   - booking по `staff_id + starts_at + status`,
   - service/staff soft-delete filters.
2. Уникальность имени мастера (case-insensitive) в scope.
3. Backfill/cleanup для старых booking, где service/staff отображались кодами.

## 7) Тестирование

1. Backend:
   - unit/integration на status transition, duplicate staff name, soft-delete rules.
2. Frontend:
   - e2e: confirm booking, service CRUD, staff CRUD/status, schedule editing, new-booking toast.
3. Regression:
   - auth/admin smoke, multi-salon scope smoke.

## 8) Наблюдаемость и аудит

1. Аудит-логи для admin действий:
   - confirm booking,
   - staff deactivate/delete,
   - service delete/update,
   - schedule update.
2. Метрики:
   - новые записи,
   - confirm rate,
   - ошибки API по admin-модулям,
   - деактивации с активными booking.

## 9) Релизная стратегия

1. Feature flags:
   - booking confirm action,
   - global booking toast,
   - new schedule UI.
2. Пошаговый rollout:
   - сначала backend + hidden UI,
   - потом UI по модулям,
   - затем полный enable.
3. План отката:
   - отключение flags,
   - возврат к старому расписанию UI.

## 10) Definition of Done

1. Bookings: без ID, с serviceName, корректным статусом, рабочим подтверждением.
2. Global toast о новых записях работает во всех admin-страницах.
3. Services: add/edit/delete (soft delete) с записью в БД.
4. Staff: add/edit/delete, status dropdown, duplicate name validation.
5. Schedule: блочное отображение по мастерам, редактирование и сохранение.
6. При деактивации мастера показывается предупреждение о будущих confirmed booking.
7. Notification Center: без ID.
8. Проходят тесты и smoke-контракты.
