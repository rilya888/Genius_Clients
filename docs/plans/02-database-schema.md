# Этап 02: Database & Schema (детальный план)

## Цель этапа

Спроектировать схему PostgreSQL, которая:
- покрывает MVP-функции записи;
- не ломается при росте tenant-ов и нагрузки;
- заранее поддерживает этапы 04, 08, 09, 10, 11, 14 и 15 без дорогостоящих миграций.

## Scope этапа

Входит:
- Логическая и физическая модель БД.
- Ключевые enum-типизации.
- PK/FK/UNIQUE/CHECK/EXCLUDE ограничения.
- Индексы под основные запросы API/бота/уведомлений.
- План миграций и seed-стратегия.

Не входит:
- Реализация сервисов/роутов.
- Финальная оптимизация производительности под боевую нагрузку.
- Реализация аналитического слоя.

## Принципы моделирования

- Мультитенантность в каждой бизнес-таблице через `tenant_id`.
- Время хранится в UTC (`timestamptz`), отображение в timezone tenant.
- Все статусные поля через enum.
- Схема проектируется под API-versioning `/api/v1`.
- Инварианты бронирования проверяются на уровне БД, не только в коде.
- Имена таблиц и полей в `snake_case`.

## Выбор СУБД и расширений

- СУБД: PostgreSQL.
- Рекомендуемые extension:
  - `pgcrypto` для UUID generation.
  - `btree_gist` для exclusion constraints по интервалам времени.
  - `citext` для case-insensitive email (опционально, но желательно).

## Справочные enum-ы

- `user_role`: `owner`, `admin` (MVP фактически 1 владелец).
- `booking_source`: `web`, `whatsapp`, `telegram`.
- `booking_status`: `pending`, `confirmed`, `cancelled`, `completed`.
- `notification_channel`: `email`, `whatsapp`, `telegram`.
- `notification_type`: `booking_created_admin`, `booking_confirmed_client`, `booking_reminder_24h`, `booking_reminder_2h`, `booking_cancelled`.

## Модель данных (MVP + foundation)

### 2.1 tenants

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | Идентификатор tenant |
| name | text | Название бизнеса |
| slug | text unique | Поддомен (`{slug}.yourapp.com`) |
| default_locale | text | `it` / `en` |
| timezone | text | Например `Europe/Rome` |
| address | text null | Адрес для уведомлений |
| admin_notification_email | text null | Email для уведомлений админу (по умолчанию — owner) |
| admin_notification_telegram_chat_id | bigint null | Telegram chat_id для уведомлений админу |
| booking_horizon_days | int | Горизонт записи |
| booking_min_advance_minutes | int | Минимум минут до записи |
| buffer_minutes | int | Буфер между записями |
| created_at / updated_at | timestamptz | Аудит времени |

Ограничения:
- `booking_horizon_days > 0`
- `booking_min_advance_minutes >= 0`
- `buffer_minutes >= 0`
- `slug` только `[a-z0-9-]`

### 2.2 users

| Поле | Тип | Описание |
|------|-----|----------|
| id | uuid PK | Пользователь |
| tenant_id | uuid FK → tenants.id | Принадлежность tenant |
| email | citext/text | Логин |
| password_hash | text | Хеш пароля |
| role | user_role | Роль |
| email_verified_at | timestamptz null | Верификация |
| created_at / updated_at | timestamptz | |

Индексы/уникальность:
- `unique (email)`  
Примечание: email глобально уникален на уровне платформы.

### 2.3 masters

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| slug | text |
| avatar_url | text null |
| is_active | boolean |
| sort_order | int |
| created_at / updated_at | timestamptz |

Уникальность:
- `unique (tenant_id, slug)`

Примечание:
- Имя — в `master_translations`. "Удаление" через `is_active = false`.

### 2.4 master_translations

| Поле | Тип |
|------|-----|
| master_id | uuid FK → masters.id |
| locale | text |
| display_name | text |
| bio | text null |
| created_at / updated_at | timestamptz |

Ключ: `primary key (master_id, locale)`

### 2.5 services

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| slug | text |
| duration_minutes | int |
| price_cents | int null |
| is_active | boolean |
| sort_order | int |
| created_at / updated_at | timestamptz |

Ограничения:
- `duration_minutes > 0`
- `price_cents >= 0` (если не null)

Уникальность:
- `unique (tenant_id, slug)`

Примечание:
- Название и описание — в `service_translations`.

### 2.6 service_translations

| Поле | Тип |
|------|-----|
| service_id | uuid FK → services.id |
| locale | text |
| name | text |
| description | text null |
| created_at / updated_at | timestamptz |

Ключ: primary key (service_id, locale). Минимум it и en при создании услуги.

### 2.7 master_services

| Поле | Тип |
|------|-----|
| master_id | uuid FK → masters.id |
| service_id | uuid FK → services.id |
| duration_minutes_override | int null |
| created_at | timestamptz |

Ключ:
- `primary key (master_id, service_id)`

Ограничение:
- `duration_minutes_override > 0` (если не null)

### 2.8 working_hours

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| day_of_week | int |
| open_time | time null |
| close_time | time null |
| is_closed | boolean |
| created_at / updated_at | timestamptz |

Ограничения:
- `day_of_week between 0 and 6`
- если `is_closed = false`, то `open_time < close_time`

Уникальность:
- `unique (tenant_id, day_of_week)`

### 2.9 schedule_exceptions

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| master_id | uuid null FK |
| date | date |
| is_closed | boolean |
| custom_open_time | time null |
| custom_close_time | time null |
| reason | text null |
| created_at / updated_at | timestamptz |

Ограничения:
- если `is_closed = false`, то `custom_open_time < custom_close_time`

Индексы:
- `(tenant_id, date)`
- `(tenant_id, master_id, date)`

### 2.10 bookings

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| master_id | uuid FK |
| service_id | uuid FK |
| start_at | timestamptz |
| end_at | timestamptz |
| client_name | text |
| client_phone | text |
| client_email | text null |
| client_locale | text |
| client_consent_at | timestamptz null | Время согласия на обработку данных (GDPR) |
| source | booking_source |
| status | booking_status |
| client_telegram_chat_id | bigint null |
| reminder24h_sent_at | timestamptz null |
| reminder2h_sent_at | timestamptz null |
| created_at / updated_at | timestamptz |

Ключевые ограничения:
- `start_at < end_at`
- Anti-overlap для активных записей:
  - `EXCLUDE USING gist (tenant_id WITH =, master_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status IN ('pending', 'confirmed'))`

Индексы:
- `(tenant_id, master_id, start_at)`
- `(tenant_id, start_at)`
- `(tenant_id, status, start_at)`
- `(tenant_id, client_phone)`

### 2.9 tenant_whatsapp_configs

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK unique |
| phone_number_id | text unique |
| access_token_ref | text |
| is_active | boolean |
| created_at / updated_at | timestamptz |

Примечание:
- В БД хранить ссылку на секрет (`access_token_ref`), не raw token.

### 2.10 tenant_telegram_configs

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK unique |
| bot_username | text |
| bot_token_ref | text |
| webhook_secret_ref | text null |
| is_active | boolean |
| created_at / updated_at | timestamptz |

### 2.11 password_reset_tokens

| Поле | Тип |
|------|-----|
| id | uuid PK |
| user_id | uuid FK |
| token_hash | text unique |
| expires_at | timestamptz |
| used_at | timestamptz null |
| created_at | timestamptz |

### 2.12 email_verification_tokens

| Поле | Тип |
|------|-----|
| id | uuid PK |
| user_id | uuid FK |
| token_hash | text unique |
| expires_at | timestamptz |
| used_at | timestamptz null |
| created_at | timestamptz |

### 2.13 refresh_tokens

| Поле | Тип |
|------|-----|
| id | uuid PK |
| user_id | uuid FK |
| token_hash | text unique |
| expires_at | timestamptz |
| revoked_at | timestamptz null |
| replaced_by_token_id | uuid null |
| created_at | timestamptz |

### 2.14 idempotency_keys

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| key | text |
| request_hash | text |
| response_status | int |
| response_body | jsonb |
| created_at | timestamptz |
| expires_at | timestamptz |

Уникальность:
- `unique (tenant_id, key)`

Назначение:
- `POST /api/v1/public/bookings` и другие write-endpoints.

### 2.15 webhook_events

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid null FK |
| provider | text |
| external_event_id | text |
| payload | jsonb |
| processed_at | timestamptz null |
| created_at | timestamptz |

Уникальность:
- `unique (provider, external_event_id)`

### 2.16 audit_logs

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| actor_user_id | uuid null FK |
| action | text |
| entity | text |
| entity_id | uuid null |
| meta | jsonb |
| created_at | timestamptz |

Индексы:
- `(tenant_id, created_at desc)`
- `(tenant_id, entity, entity_id)`

### 2.17 stripe_customers (foundation)

| Поле | Тип |
|------|-----|
| id | uuid PK |
| tenant_id | uuid FK |
| stripe_customer_id | text unique |
| email | text |
| created_at / updated_at | timestamptz |

## Связь с будущими компонентами

- Этап 04 (API): основные CRUD и slot queries используют `masters/services/working_hours/schedule_exceptions/bookings`.
- Этап 08-10 (боты): tenant/channel конфиги + `bookings` + `webhook_events`.
- Этап 11 (уведомления): `reminder24h_sent_at`, `reminder2h_sent_at`, индексы по времени и статусу.
- Этап 14 (security): anti-overlap, idempotency, webhook dedup, audit trail.
- Этап 15 (ops): таблицы позволяют безопасные ретраи и расследование инцидентов.

## Нефункциональные решения схемы

- Все FK для бизнес-сущностей с каскадной политикой, исключающей случайную потерю исторических bookings.
- Удаление tenant в MVP не автоматизировать каскадом; только controlled process.
- PII хранить минимально необходимую; токены хранить только в hash.

## Хранение файлов (MVP)

- Аватары мастеров: временно через локальное хранилище Railway.
- В БД хранится только `avatar_url`.
- Пост-MVP: перенос на S3/R2 без изменения доменной модели.

## План миграций

Порядок миграций:
1. Базовые extension + enum-ы.
2. Core tenant/auth таблицы.
3. Каталог мастеров и master_translations.
4. Каталог услуг и service_translations.
5. Календарь и исключения.
6. Bookings + anti-overlap constraints + индексы.
7. Интеграционные таблицы (WA/TG/Stripe, webhook_events, idempotency_keys).
8. Audit и auth-токены.

Правила:
- Миграции forward-only.
- Каждая миграция обратима через follow-up migration (не ручной SQL в проде).
- Миграции и их проверка обязательны в staging до production.

## Seed-стратегия (dev/staging)

- `seed:tenant`: 1 demo tenant.
- `seed:catalog`: 2-3 мастера, 5-8 услуг.
- `seed:schedule`: рабочие часы + 1-2 исключения.
- `seed:bookings`: записи в разных статусах для тестов.

Требование:
- Seed должен быть идемпотентным.

## Ownership

- Схема и миграции: `Backend Lead`.
- Проверка индексов и ограничений: `Backend Lead + Architect`.
- Согласование PII/GDPR аспектов: `Product/Owner`.

## Риски и профилактика

- Риск: блокировки и конфликты в пиковое время.  
  Мера: индексы + транзакции + exclusion constraints.
- Риск: дубли из webhook/повторов клиента.  
  Мера: `webhook_events` + `idempotency_keys`.
- Риск: несогласованность времени и timezone.  
  Мера: `timestamptz` + единые правила UTC.
- Риск: хранение чувствительных токенов.  
  Мера: хранить только ссылки/хэши, не raw secrets.

## Definition of Done (детально)

- [ ] Финализирована логическая модель таблиц и связей.
- [ ] Зафиксированы все ключевые ограничения (UNIQUE/CHECK/FK/EXCLUDE).
- [ ] Определены индексы под критичные запросы API/бота/reminder job.
- [ ] Согласованы таблицы idempotency/webhook dedup/audit.
- [ ] Подготовлен пошаговый план миграций.
- [ ] Подготовлена seed-стратегия для dev/staging.
- [ ] Модель совместима с `/api/v1` и этапами 04/08/11/14/15.

## Definition of Ready для Этапа 04

- [ ] Есть окончательный список таблиц/полей для CRUD endpoint-ов.
- [ ] Есть явные правила tenant isolation через `tenant_id`.
- [ ] Anti-overlap для booking утвержден на уровне БД.
- [ ] Индексы подтверждены для slot calculation и списков bookings.
- [ ] Таблицы для idempotency и webhook dedup готовы к использованию.
