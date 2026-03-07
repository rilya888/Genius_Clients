# Этап 14: Security & Data Integrity

## Цель этапа

Зафиксировать и верифицировать обязательные security/data-инварианты перед production rollout, чтобы:

- исключить cross-tenant доступ и критичные утечки данных,
- гарантировать целостность booking/notification/webhook потоков,
- минимизировать риск дублей, гонок и replay-атак,
- обеспечить проверяемый baseline для эксплуатации (этап 15).

## Границы MVP

**Входит в этап 14:**
- trust boundary и tenant isolation (BFF/API/DB);
- DB-инварианты против double-booking и дублей событий;
- idempotency для booking и webhook контуров;
- обязательная валидация подписей webhook;
- auth hardening (cookie/session/token/CSRF);
- centralized rate-limit store (Redis);
- audit trail минимально достаточный для расследований;
- security test matrix + release gates.

**Не входит в этап 14:**
- формальный SOC2/ISO аудит;
- enterprise IAM/SSO;
- full-blown DLP/advanced WAF платформенного уровня.

## Архитектурное место в системе

- Этап 14 накладывает обязательные правила на этапы 04, 08, 09, 10, 11, 13.
- Этап 12 должен деплоить только сборку, которая проходит security gates этапа 14.
- Этап 15 использует этот baseline как operational standard.

## Threat Model (MVP)

Основные угрозы:
- cross-tenant data access;
- duplicate booking из-за гонок/повторов запроса;
- forged/replayed webhook events;
- token theft/session abuse;
- brute-force на auth endpoints;
- silent failure во внешних интеграциях с потерей событий.

Цель этапа:
- закрыть эти угрозы техническими инвариантами, а не только процессными рекомендациями.

## Trust Boundaries

## 14.1 Browser -> BFF -> API

- Browser не вызывает `api.yourapp.com` напрямую.
- BFF извлекает tenant из `Host` и передает в API только trusted internal context:
  - `X-Internal-Tenant-Id`
  - `X-Internal-Secret`
- API не принимает tenant из `query/body/custom client headers`.

Инвариант:
- любой API-запрос без валидного internal auth и tenant context отклоняется.

## 14.2 API -> DB

- все запросы к данным выполняются с обязательным `tenant_id` фильтром;
- отсутствие tenant-фильтра считается blocker-дефектом;
- критичные операции выполняются только в транзакции.

## 14.3 External Providers -> Webhooks

- Stripe/WhatsApp/Telegram webhooks принимаются только при валидной подписи/секрете;
- неподписанные/невалидные запросы не проходят в business logic;
- повторные события dedupe-ятся через event store.

## Tenant Isolation (обязательно)

## 14.4 API policy

- deny-by-default на любые endpoint без подтвержденного tenant context;
- сравнение tenant из JWT (admin flows) и internal tenant context (BFF);
- запрет чтения/изменения сущностей с другим `tenant_id`.

## 14.5 Repository/query policy

- каждый репозиторный метод принимает `tenant_id` явным параметром;
- отсутствие tenant-параметра в методе доступа к tenant-данным запрещено;
- code review rule: нет merge без проверки tenant-scope.

## 14.6 Дополнительный защитный слой (рекомендуемо)

- для таблиц с tenant-данными допускается RLS-подход в post-MVP;
- в MVP основная защита остается на уровне BFF/API/query-contracts + тестов.

## Data Integrity: booking и расписание

## 14.7 Anti double-booking

- создание/подтверждение booking только в транзакции;
- DB constraint на пересечения:
  - `EXCLUDE USING gist (tenant_id WITH =, master_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)`;
  - `cancelled` исключается из активного диапазона.
- API-валидация не заменяет DB constraint.

## 14.8 Concurrency guards

- при изменении статуса booking использовать optimistic guard (`expected_status`);
- reminder job selection: `FOR UPDATE SKIP LOCKED` или эквивалент очереди;
- webhook processing и outbound send должны быть idempotent при повторе.

## 14.9 Time integrity

- хранение всех времен в UTC;
- вычисления окон отправки и отображения — с учетом `tenant.timezone`;
- DST-краевые кейсы покрыты тестами.

## Idempotency (обязательно)

## 14.10 Public booking

- `POST /api/v1/public/bookings` требует `Idempotency-Key`;
- хранить: ключ, hash payload, результат, created_at;
- TTL минимум 24 часа;
- поведение:
  - same key + same payload -> вернуть исходный результат;
  - same key + different payload -> `409`.

## 14.11 Webhooks

- хранить provider event id (`event_id`/`wamid`/`update_id` эквивалентно);
- unique индекс на `(provider, provider_event_id)`;
- повторное событие не инициирует повторный side effect.

## 14.12 Outbound idempotency

- reminder/notification send jobs используют `idempotency_key`;
- retry не должен приводить к нескольким фактическим отправкам одной нотификации;
- delivery timeline сохраняется для расследований.

## Webhook Security

## 14.13 WhatsApp (Meta)

- обязательная проверка `X-Hub-Signature-256`;
- использовать raw request body для корректной валидации подписи;
- секреты: `WA_WEBHOOK_SECRET`/`META_APP_SECRET` в secret manager.

## 14.14 Telegram

- использовать `setWebhook` с `secret_token`;
- проверять `X-Telegram-Bot-Api-Secret-Token` на каждом запросе;
- reject-by-default для запросов без валидного токена.

## 14.15 Stripe

- обязательная проверка `Stripe-Signature`;
- allowlist `event.type`;
- хранить и обрабатывать только ожидаемые события.

## Auth & Session Hardening

## 14.16 Session contract

- единая сессия между `app.yourapp.com` и `{slug}.yourapp.com`;
- cookie policy:
  - `Domain=.yourapp.com`
  - `HttpOnly`
  - `Secure`
  - `SameSite=Lax`
  - `Path=/`

## 14.17 Token policy

- access token короткий (например 15 минут);
- refresh token rotation обязательна;
- revoke refresh token при logout/password reset;
- запрет хранения auth токенов в browser localStorage/sessionStorage.

## 14.18 CSRF

- CSRF token обязателен для всех state-changing BFF-запросов;
- отсутствие валидного CSRF token => `403`;
- CSRF проверка покрыта integration тестами.

## 14.19 Password/email policy

- пароли: argon2/bcrypt, современный work factor;
- email verification в MVP non-blocking (рекомендуемый слой), без блокировки админ-доступа;
- возможность feature-flag перейти к обязательной verification в production.

## Rate-limit и Abuse Protection

## 14.20 Centralized rate-limit store

- store для rate-limit в production: Redis;
- in-memory rate-limit запрещен;
- единая политика для:
  - auth endpoints,
  - public endpoints,
  - webhook ingress guard.

## 14.21 Rate-limit baseline

- login: ограничение попыток по email + IP;
- forgot-password: ограничение по email + IP;
- public booking/slots: лимиты по IP/tenant;
- webhook ingress: мягкий guard, не блокирующий валидные retries провайдеров.

## Audit & Compliance Minimum

## 14.22 Audit events

Обязательные события аудита:
- смена статуса booking;
- изменения расписания/исключений;
- изменения tenant settings/integration settings;
- auth security события (login failed/reset/revoke).

Минимальные поля:
- `actorUserId`
- `tenantId`
- `action`
- `entity`
- `entityId`
- `createdAt`
- `meta` (ограниченный, без секретов/чувствительных raw payload)

## 14.23 GDPR baseline

- поддержка ручного экспорта/удаления данных по запросу владельца tenant;
- PII masking в логах и трассировке;
- retention сроков придерживаться политики этапа 15.

## Observability for Security

## 14.24 Security metrics

- invalid webhook signature rate;
- duplicate event rate;
- cross-tenant access denied count;
- auth failed-login rate;
- CSRF reject rate;
- idempotency conflict rate (`409`).

## 14.25 Security alerts

MVP-алерты:
- всплеск invalid signatures;
- резкий рост failed-login;
- аномальный рост CSRF rejects;
- рост cross-tenant deny событий;
- массовый рост idempotency conflicts.

## Security Testing Matrix (обязательно)

## 14.26 Integration tests

- tenant A не может читать/писать tenant B ресурсы;
- два конкурентных запроса на один слот не создают двойную бронь;
- повтор `Idempotency-Key` ведет к ожидаемому deterministic результату;
- webhook с невалидной подписью отклоняется;
- duplicate webhook event не создает повторный side effect;
- state-changing BFF запрос без CSRF отклоняется.

## 14.27 Concurrency/load smoke

- нагрузочный smoke для booking create/confirm;
- проверка lock contention и времени ответа на конфликтных слотах;
- проверка стабильности rate-limit при нескольких инстансах.

## Поэтапный план работ (поштучно)

1. Зафиксировать trust boundaries и deny-by-default правила.
2. Провести ревизию tenant-scoped repository методов.
3. Включить/проверить DB anti-overlap constraints и транзакционные guards.
4. Завершить idempotency контур для booking/webhooks/outbound.
5. Проверить и усилить webhook signature validation для Stripe/WA/TG.
6. Закрепить session/token/CSRF политику в auth middleware.
7. Включить centralized Redis rate-limit для auth/public/webhooks.
8. Довести audit события до минимально обязательного покрытия.
9. Подключить security метрики и алерты.
10. Прогнать security integration + concurrency smoke.
11. Зафиксировать остаточные риски и mitigation в runbook.
12. Закрыть DoD и разрешить production rollout gate.

## Definition of Ready (DoR)

- Зафиксированы API/webhook/auth контракты этапов 04/09/10/13.
- Подтверждены секреты и ключи подписи в secret manager.
- Готов Redis для bot state и centralized rate-limit.
- Подготовлены тестовые сценарии для security matrix.
- Согласованы security alert thresholds.

## Definition of Done (DoD)

- Tenant isolation реализован и подтвержден тестами.
- DB constraints исключают double-booking в конкурентных сценариях.
- Idempotency работает для booking, webhook и notification send контуров.
- Подписи webhook строго валидируются для Stripe/WA/TG.
- Session/token/CSRF политики соблюдаются на BFF/API границе.
- Redis используется как centralized rate-limit store и bot state store.
- Security метрики/алерты работают в staging и production.
- Security test matrix пройден без blocker-дефектов.

## Риски и меры

- Риск: обход tenant isolation через дефект в BFF/API интеграции.
  - Мера: deny-by-default + integration tests + audit deny events.
- Риск: silent дубль брони при гонках.
  - Мера: DB exclusion constraint + transaction guards + conflict tests.
- Риск: replay/forged webhook.
  - Мера: signature validation + dedupe store + alerting на invalid signatures.
- Риск: компрометация сессии через слабую cookie/CSRF конфигурацию.
  - Мера: strict cookie flags + CSRF enforcement + regression tests.
- Риск: расхождение rate-limit между инстансами.
  - Мера: centralized Redis store, запрет in-memory в production.
