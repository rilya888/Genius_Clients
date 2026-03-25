# План 45: WhatsApp-подтверждение записи администратором (confirm/reject + причина)

## 1. Цель
Сделать единый рабочий флоу:
1. Клиент создает запись через бот/лендинг.
2. Запись появляется в админке со статусом `pending`.
3. Администратору салона в WhatsApp приходит уведомление о новой записи с кнопками `Подтвердить` / `Отклонить`.
4. `Подтвердить` -> запись становится `confirmed`, клиент получает подтверждение.
5. `Отклонить` -> бот запрашивает у администратора причину следующим сообщением; после причины запись становится `rejected`, клиент получает отказ с причиной.

## 2. Бизнес-правила (зафиксировано)
1. Для отказа используем статус `rejected`.
2. Причина отказа обязательна и отправляется клиенту.
3. Кнопки в WhatsApp имеют TTL (по умолчанию 24 часа, конфигурируемо).
4. Если запись уже обработана, ответ администратору: "уже обработано".
5. Admin-уведомление в WhatsApp отправляется только для источников `whatsapp` и `web_public`.
6. Авто-таймаута `pending` нет.
7. Модель на MVP: 1 WhatsApp-номер администратора на 1 физический салон.

## 3. Изменения данных и схемы
1. Расширить enum `booking_status`: добавить `rejected`.
2. Добавить поле `bookings.rejection_reason` (text, nullable).
3. Расширить enum `notification_type`: добавить `booking_rejected_client`.
4. Обновить Drizzle schema и типы в репозиториях/API/UI.

## 4. Backend (API)
1. Добавить public endpoint `POST /api/v1/public/bookings/:id/admin-action`.
2. Поддерживаемые действия:
- `confirm`
- `reject` (только с `rejectionReason`)
3. Проверка авторизации администратора по номеру:
- `admin_notification_whatsapp_e164`
- либо `operator_whatsapp_e164`
4. Идемпотентность и гонки:
- условный update только из `pending`
- повторное действие возвращает `applied=false` + фактический статус.
5. Аудит:
- `booking_status_changed` с meta: source=`whatsapp_admin_action`, from/to, reason.

## 5. Очередь уведомлений
1. При создании записи из `whatsapp`/`web_public`:
- enqueue `booking_created_admin` по каналу `whatsapp` на `admin_notification_whatsapp_e164`.
2. При `rejected`:
- enqueue `booking_rejected_client` клиенту.
3. При `confirmed`:
- текущий `booking_confirmed_client` остается.

## 6. Worker (доставка)
1. Для `booking_created_admin` + channel=`whatsapp` отправлять interactive buttons:
- `cta:<token_admin_confirm>`
- `cta:<token_admin_reject>`
2. Токены генерируются через `createBookingActionToken` с `WA_ACTION_TOKEN_SECRET` и TTL.
3. В текст admin-уведомления включать:
- услугу
- мастера
- дату/время
- клиент
- короткий ID записи.
4. Для `booking_rejected_client` отправлять клиенту сообщение с причиной.

## 7. Bot (webhook/CTA)
1. Обработать CTA `admin_confirm` и `admin_reject`.
2. `admin_confirm`:
- вызывает `/public/bookings/:id/admin-action` с `action=confirm`.
3. `admin_reject`:
- не применяет отказ сразу;
- переводит админа в state `awaiting_rejection_reason` для конкретной booking;
- просит отправить причину следующим сообщением.
4. Следующее текстовое сообщение админа:
- используется как причина;
- вызывает `/public/bookings/:id/admin-action` с `action=reject` + `rejectionReason`;
- отправляет администратору результат.
5. Если action-token просрочен/уже обработан:
- сообщение "уже обработано" или "действие истекло".

## 8. Админка (web)
1. Добавить статус `rejected` в:
- фильтры
- status-pill
- локализации.
2. Обеспечить корректное отображение `rejectionReason` (если есть).
3. Статусы после WhatsApp-действий должны отображаться корректно при следующем refresh/poll.

## 9. Наблюдаемость и ошибки
1. Детализировать `error_message` delivery при fail (код + сообщение Meta).
2. Логировать события:
- отправка admin CTA
- клик confirm/reject
- ожидание причины
- применение reject с причиной.
3. Гарантировать, что повторная обработка не генерирует дубли клиентских уведомлений.

## 10. Тест-план
1. E2E Confirm:
- клиент создает запись -> админ получает CTA -> confirm -> статус `confirmed` в админке -> клиент получает подтверждение.
2. E2E Reject:
- клиент создает запись -> админ CTA reject -> бот запрашивает причину -> админ отправляет причину -> статус `rejected` -> клиент получает причину.
3. Повторный клик по CTA после обработки -> "уже обработано".
4. Истекший токен -> "действие истекло".
5. Проверка, что для источника `web` admin CTA не отправляется.

## 11. Порядок реализации
1. Миграции + schema + типы.
2. BookingService/AdminAction endpoint.
3. Worker: admin CTA outbound + rejected client outbound.
4. Bot: CTA + ожидание причины + submit reject.
5. Web-vite: статус `rejected` и UI-отображение.
6. Smoke-тесты на `alex-salon`.

## 12. Статус выполнения
Статус: 100% (реализация завершена).

Закрыто:
1. Миграции БД и типы (`rejected`, `rejection_reason`, `booking_rejected_client`) внедрены.
2. Public admin-action endpoint (`confirm/reject`) внедрен с проверкой номера администратора и обязательной причиной для reject.
3. Worker отправляет admin CTA (Confirm/Reject), клиенту уходят `confirmed/rejected` уведомления.
4. Bot обрабатывает CTA, поддерживает шаг "введите причину" для reject и корректные ответы при `already processed`/`expired`.
5. Админка поддерживает статус `rejected` в фильтрах и отображении.
6. Добавлены структурные логи для ключевых событий (CTA send/click, reject reason flow, apply result, concurrency/already-processed).
7. Добавлены автотесты для action-token (в т.ч. `token_expired`).

Проверки:
1. Typecheck: `@genius/api`, `@genius/bot`, `@genius/worker`, `@genius/shared` — успешно.
2. Tests: `@genius/shared` — успешно, включая новый тест истечения action-token.
