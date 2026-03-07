# Этап 11: Notifications & Reminders

## Цель этапа

Собрать надежный контур уведомлений для клиентских и админских событий, чтобы:

- напоминания отправлялись вовремя и без дублей,
- статус доставки был прозрачен для операционного контроля,
- логика была совместима с каналами WhatsApp (этап 09) и Telegram (этап 10),
- платформа была готова к дальнейшему масштабированию (новые каналы, шаблоны, политики).

## Границы MVP

**Входит в этап 11:**
- напоминание клиенту за 24 часа;
- напоминание клиенту за 1–2 часа (**обязательно в MVP**);
- уведомление администратору о новой записи;
- уведомление клиенту о подтверждении/отмене/переносе;
- очередь задач с retry/backoff и idempotency;
- базовый delivery tracking по каналам;
- tenant timezone-aware расписание.

**Не входит в этап 11:**
- маркетинговые кампании и массовые рассылки;
- сложный visual editor шаблонов;
- ML-оптимизация времени отправки.

## Архитектурное место в системе

- Источники событий: Backend API (booking lifecycle), scheduler jobs, admin actions.
- Dispatcher маршрутизирует уведомление в конкретный канал (`whatsapp`, `telegram`, `email`).
- Отправка идет через job queue (не синхронно в HTTP request path).
- Статусы доставки складываются в единый журнал отправок для аналитики и ретраев.
- Канальные адаптеры переиспользуют контракты этапов 09/10.

## Типы уведомлений

## 11.1 Клиент: напоминание за 24 часа

- Триггер: `status = confirmed`, время записи входит в окно 24ч.
- Канал:
  - `whatsapp`: шаблонное сообщение;
  - `telegram`: обычное сообщение;
  - `web/email`: только если канал и email доступны.
- Язык: `booking.client_locale`.

## 11.2 Клиент: напоминание за 1–2 часа

- Триггер: `status = confirmed`, время записи входит в окно 1–2ч.
- Статус в MVP: **обязательное уведомление**.
- Канал и локаль по тем же правилам, что и 24ч.

## 11.3 Админ: новая запись

- Триггер: создание записи (`pending` или `confirmed`, согласно policy этапа 04).
- Каналы: `admin_notification_email` и/или `admin_notification_telegram_chat_id`.
- Содержание: клиент, услуга, мастер, дата/время, ссылка на карточку в админке.

## 11.4 Клиент: подтверждение записи

- Триггер: `pending -> confirmed`.
- Канал: по источнику записи (`source`) и доступности контакта.
- Содержание: факт подтверждения + ключевые детали визита.

## 11.5 Клиент: отмена/перенос

- Триггер: `cancelled` или изменение времени.
- Содержание:
  - при отмене: факт отмены + что делать дальше;
  - при переносе: новое время и подтверждение актуальных деталей.

## Оркестрация и планирование

## 11.6 Scheduler

- Запуск каждые 5 минут (рекомендовано), допустимо 10–15 минут для low-load MVP.
- Джобы формируются отдельно для:
  - `reminder_24h`,
  - `reminder_2h`.
- Важно: выборка должна учитывать `tenant.timezone`, а хранение времени остается в UTC.

## 11.7 Окна времени и DST

- Окна отправки:
  - `24h`: `start_at` в интервале `[now+23h30m, now+24h30m]`;
  - `2h`: `start_at` в интервале `[now+1h30m, now+2h30m]`.
- Использовать timezone-aware библиотеку, чтобы корректно переживать DST-переходы.
- При неоднозначных локальных временах (DST shift) источником истины считается UTC `start_at`.

## 11.8 Защита от дублей

- Для выбора задач использовать `FOR UPDATE SKIP LOCKED` или эквивалентную очередь.
- У каждой задачи есть `dedupe_key`:
  - пример: `tenant_id:booking_id:reminder_24h`.
- Повторный запуск scheduler не должен порождать повторную отправку одной и той же нотификации.

## Data Contract и статусы

## 11.9 Поля booking

Используются поля:
- `reminder24h_sent_at`
- `reminder2h_sent_at`
- `client_locale`
- `source`

Эти поля обновляются только после технически успешной отправки (по правилам канала).

## 11.10 Журнал отправок (notification deliveries)

Рекомендуемый минимальный контракт:
- `id`
- `tenant_id`
- `booking_id` (nullable для системных сообщений)
- `notification_type` (`reminder_24h`, `reminder_2h`, `booking_confirmed`, `booking_cancelled`, `admin_new_booking`)
- `channel` (`whatsapp`, `telegram`, `email`)
- `recipient`
- `idempotency_key`
- `provider_message_id` (если доступен)
- `status` (`queued`, `sent`, `delivered`, `read`, `failed`, `blocked`)
- `error_code`, `error_message`
- `created_at`, `sent_at`, `updated_at`

## 11.11 Delivery semantics по каналам

- WhatsApp: использовать статусы `sent/delivered/read/failed` из webhook этапа 09.
- Telegram: технический успех = API ответ `ok=true`, блокировка = `403 blocked`.
- Email: успех = accepted провайдером, при bounce/complaint статус обновляется отдельно.

## 11.12 Idempotency отправки

- Каждая outbound-задача несет `idempotency_key`.
- Повтор с тем же ключом не создает новую отправку.
- Для провайдеров, где возможно, использовать их native idempotency механизмы дополнительно к приложению.

## Маршрутизация каналов

## 11.13 Выбор канала

Порядок выбора:
1. Канал источника записи (`source`) при его доступности.
2. Tenant policy fallback (например, если TG недоступен — email).
3. Если нет доступного канала, событие переводится в `failed_unreachable` и уходит в ops-лог.

## 11.13.1 Обязательная fallback-матрица (MVP)

- `reminder_24h`:
  - primary: `source` канал записи;
  - fallback: `email` (если валидный email есть);
  - если fallback недоступен: `failed_unreachable` + алерт в ops.
- `reminder_2h`:
  - primary: `source` канал записи;
  - fallback: `email` (если валидный email есть);
  - если fallback недоступен: `failed_unreachable` + алерт в ops.
- `booking_confirmed` / `booking_cancelled`:
  - primary: `source` канал записи;
  - fallback: `email` (если валидный email есть);
  - если fallback недоступен: `failed_unreachable`.
- `admin_new_booking`:
  - primary: tenant-настройка (`telegram` и/или `email`);
  - если оба канала недоступны: `failed_admin_unreachable` + высокий приоритет алерта.

Правило: fallback выполняется не более одного шага (без бесконечных каскадов).

## 11.14 Политика для WhatsApp >24h

- Для напоминаний использовать только approved templates.
- Базовые шаблоны MVP:
  - `booking_reminder_24h`
  - `booking_reminder_2h`
  - `booking_confirmation`
  - `booking_cancellation`

## 11.15 Локализация и стиль

- Локали MVP: `it`, `en`.
- Стиль сообщений: формальный.
- Ключи сообщений ведутся через i18n-домены этапа 03 (`notifications.json`).

## Надежность и эксплуатация

## 11.16 Retry и DLQ

- Retry только для transient ошибок (`429`, `5xx`, network timeout).
- Backoff: экспоненциальный с jitter, лимит 3–5 попыток.
- После лимита задача в `failed`/DLQ с обязательным reason code.

## 11.17 Метрики

Обязательные метрики:
- job enqueue rate;
- reminder send success/failure rate по типам;
- delivery status distribution по каналам;
- retry count и DLQ size;
- scheduler lag;
- notification latency (event -> send).

## 11.18 Алерты

MVP-алерты:
- reminder success rate ниже порога;
- рост DLQ;
- scheduler не запускался дольше порога;
- резкий рост `403 blocked` (Telegram) или `failed` (WhatsApp).

## Тестовая стратегия

## 11.19 Unit

- селектор окон `24h`/`2h` с учетом timezone;
- dedupe/idempotency ключи;
- channel routing logic;
- локализация шаблонов.

## 11.20 Integration

- booking event -> queue -> channel adapter -> status update;
- retry + DLQ сценарии;
- negative кейсы: blocked recipient, template reject, duplicate scheduler run.

## 11.21 UAT

- end-to-end для 24h и 2h reminder на реальных тестовых каналах;
- проверка локалей `it/en`;
- проверка, что дубли не уходят при рестарте worker.

## Поэтапный план работ (поштучно)

1. Зафиксировать taxonomy уведомлений и их триггеры.
2. Добавить data contract журнала отправок и статусов.
3. Реализовать scheduler окна `24h` и `2h` с tenant timezone.
4. Добавить блокировку/дедуп (SKIP LOCKED или очередь).
5. Подключить dispatcher каналов с policy выбора.
6. Реализовать outbound idempotency + retry/backoff.
7. Подключить WhatsApp template path и Telegram path.
8. Реализовать reconciliation delivery статусов.
9. Обновлять `reminder24h_sent_at` / `reminder2h_sent_at` только после технического успеха.
10. Добавить метрики/алерты/runbook инцидентов.
11. Прогнать UAT smoke для всех типов уведомлений.
12. Закрыть DoD и передать в этапы 12/15 как эксплуатационный baseline.

## Definition of Ready (DoR)

- Согласованы типы уведомлений и канальные политики.
- Согласована fallback-матрица по всем `notification_type`.
- Подтверждены шаблоны WhatsApp и ключи локализации.
- Доступны рабочие channel adapters (этапы 09/10).
- Зафиксирована tenant timezone policy.
- Подтверждены пороги алертов и DLQ обработка.

## Definition of Done (DoD)

- Напоминания за 24ч и 1–2ч стабильно отправляются без дублей.
- Админские и клиентские системные уведомления работают по триггерам.
- Delivery статусы фиксируются и доступны для диагностики.
- Retry/DLQ контур работает и покрыт тестами.
- Ведутся метрики и алерты по ключевым отказам.
- Runbook инцидентов по notifications готов и проверен.

## Риски и меры

- Риск: дубли при параллельных воркерах.
  - Мера: idempotency key + locking/queue discipline.
- Риск: смещение времени из-за timezone/DST.
  - Мера: UTC как источник истины + tenant timezone conversion на этапе отбора.
- Риск: канал недоступен (`403 blocked`, token expired).
  - Мера: fallback policy + DLQ + ops alert.
- Риск: template reject в WhatsApp.
  - Мера: pre-approved templates + алерт + резервный канал.
