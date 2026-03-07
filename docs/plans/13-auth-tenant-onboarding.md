# Этап 13: Auth & Tenant Onboarding

## Цель этапа

Собрать устойчивый контур регистрации и аутентификации для мультитенантного продукта, который:

- создает `tenant + owner` в одном атомарном сценарии,
- безопасно обслуживает вход/выход и сброс пароля,
- поддерживает единую сессию между `app.yourapp.com` и `{slug}.yourapp.com`,
- остается совместимым с BFF-моделью, API-контрактами и будущим расширением ролей.

## Границы MVP

**Входит в этап 13:**
- self-signup владельца с созданием tenant;
- login/logout/refresh/reset password;
- tenant routing по subdomain;
- единая cookie-session между поддоменами;
- базовый email verification (рекомендуемый, не блокирующий);
- минимальная защита auth endpoint (rate-limit, audit, token rotation).

**Не входит в этап 13:**
- SSO (Google/Microsoft/Apple);
- приглашения команды и расширенный RBAC;
- support-процедура ручного восстановления владельца при утрате email-доступа.

## Архитектурное место в системе

- BFF (`web`) отвечает за browser session и безопасный обмен с `api`.
- `api` выполняет auth-операции и хранит инварианты пользователей/tenant.
- tenant context для UI определяется из `Host`.
- этап напрямую связан с этапами:
  - 04 (auth API и security middleware),
  - 05/06 (защита admin/public зон),
  - 14 (hardening),
  - 12/15 (деплой и эксплуатация).

## Доменная модель

## 13.1 Сущности

Минимально задействованы:
- `tenants` (slug, timezone, locale, settings);
- `users` (email, password_hash, role, tenant_id, is_active);
- `refresh_tokens` (rotation, revoke);
- `password_reset_tokens` (одноразовые);
- `email_verification_tokens` (рекомендуемый контур MVP).

## 13.2 Роли в MVP

- `owner` — первый пользователь tenant, полный доступ к admin-возможностям.
- `admin` — заложена совместимость на будущее, но в MVP может отсутствовать отдельный UI-онбординг для этой роли.

## Регистрация и онбординг

## 13.3 Self-signup flow (атомарный)

1. Пользователь открывает `app.yourapp.com/register`.
2. Вводит `email`, `password`, `business_name`, (опционально) желаемый `slug`.
3. Система валидирует данные и резервирует slug.
4. В одной транзакции создаются:
   - `tenant`,
   - `user(role=owner)`,
   - начальные tenant-настройки.
5. Создается auth session (access + refresh через cookie).
6. Редирект в `https://{slug}.yourapp.com/admin`.

Требование:
- при любой ошибке транзакция откатывается полностью (нельзя получить пользователя без tenant или tenant без owner).

## 13.4 Onboarding defaults

При создании tenant задавать baseline:
- `default_locale = it` (или продуктовый default);
- `timezone` (из выбора пользователя или безопасного default);
- значения booking policy по умолчанию (`horizon`, `buffer`, `min_advance`).

Это важно для корректной работы этапов 04/06/08/11 сразу после signup.

## Slug и subdomain policy

## 13.5 Валидация slug

- допустимы только `a-z`, `0-9`, `-`;
- длина в пределах policy (например 3-40 символов);
- запрещены лидирующий/замыкающий дефис и подряд идущие дефисы (по policy);
- blacklist зарезервированных слов: `admin`, `api`, `app`, `www`, `static`, `status`.

## 13.6 Уникальность и гонки

- уникальность slug обеспечивается DB unique index;
- проверка доступности slug на UI не является источником истины;
- финальная проверка только в транзакции создания tenant.

## 13.7 Routing по доменам

- `app.yourapp.com` — auth и входные страницы;
- `{slug}.yourapp.com/admin` — admin зона tenant;
- `{slug}.yourapp.com` — публичная зона tenant;
- `api.yourapp.com` — backend API (BFF-only model).

Если slug не найден:
- возвращать контролируемый `404 tenant not found` без утечки внутренних деталей.

## Сессия и аутентификация

## 13.8 Единая сессия между поддоменами (зафиксировано)

- единая browser session для `app.yourapp.com` и `{slug}.yourapp.com`.
- cookie settings:
  - `Domain=.yourapp.com`
  - `Path=/`
  - `HttpOnly`
  - `Secure`
  - `SameSite=Lax`

## 13.9 Token lifecycle

- access token короткий (например 15 мин);
- refresh token с ротацией и хранением server-side состояния;
- logout:
  - revoke refresh token;
  - очистка auth-cookie по `.yourapp.com`;
- password reset/logout-all:
  - инвалидировать активные refresh токены пользователя.

## 13.10 BFF security boundary

- browser не обращается к `api.yourapp.com` напрямую;
- BFF извлекает session и tenant context, затем вызывает API с internal auth;
- tenant-id для API берется из trusted host resolution, не из query/body.

## Email-процессы

## 13.11 Email verification (MVP)

- verification рекомендуется, но не блокирует вход в админку;
- статус верификации хранится в user profile;
- возможность включить обязательность verification в production feature flag'ом.

## 13.12 Forgot/Reset password

- `forgot-password` всегда отвечает нейтрально (без user enumeration);
- reset token одноразовый, с TTL;
- после успешного reset:
  - revoke существующих refresh токенов,
  - запись события в audit/security log.

## 13.13 Восстановление владельца

- в MVP нет ручной support-процедуры восстановления доступа владельца;
- допустимый путь: reset password через email владельца;
- потеря доступа к email владельца — out-of-scope MVP, перенос в post-MVP governance.

## Безопасность

## 13.14 Anti-abuse для auth endpoint

- login rate-limit: ограничение попыток по email + IP;
- forgot-password rate-limit: по email + IP;
- register rate-limit: по IP/UA fingerprint (минимальный слой);
- audit событий: register/login/logout/reset/failed-login.
- centralized rate-limit store в production: Redis (in-memory rate-limit запрещен).

## 13.15 Password policy

- минимальная длина и базовые требования сложности (согласованные продуктом);
- хранение только в виде secure hash (argon2/bcrypt);
- запрет логирования исходного пароля и токенов.

## 13.16 Cookie/CSRF соображения

- `SameSite=Lax` закрывает базовый класс CSRF для большинства сценариев;
- для всех state-changing BFF-операций CSRF token обязателен в MVP;
- auth cookie не читается клиентским JS.

## Наблюдаемость

## 13.17 Метрики

- signup success/fail rate;
- login success/fail rate;
- reset password conversion;
- refresh token rotate/revoke rate;
- tenant-not-found rate по host routing.

## 13.18 Алерты

MVP-алерты:
- всплеск failed login;
- рост reset-password запросов сверх порога;
- аномальный рост tenant-not-found на production host.

## Тестовая стратегия

## 13.19 Unit

- slug normalization/validation;
- password policy;
- token TTL/rotation logic;
- host->tenant resolver.

## 13.20 Integration

- register -> tenant+owner created atomically;
- login/refresh/logout с cookie-сессией на `.yourapp.com`;
- forgot/reset flow с revoke старых refresh token;
- negative кейсы: duplicate slug, duplicate email, invalid token, expired token.

## 13.21 E2E smoke

- signup на `app.yourapp.com` -> редирект в `{slug}.yourapp.com/admin`;
- повторный вход и сохранение единой сессии между доменами;
- logout очищает доступ на обоих хостах.

## Поэтапный план работ (поштучно)

1. Зафиксировать contracts для auth endpoints и cookie policy.
2. Реализовать slug policy + DB uniqueness + reserved words.
3. Реализовать транзакционный signup (`tenant + owner + defaults`).
4. Реализовать login/logout/refresh с rotation refresh token.
5. Реализовать forgot/reset с одноразовым TTL token.
6. Подключить единый cookie domain `.yourapp.com`.
7. Подключить host-based tenant resolver и controlled 404.
8. Добавить audit и rate-limit для auth endpoints.
9. Подключить email verification (рекомендуемый, non-blocking).
10. Добавить метрики и алерты auth/onboarding.
11. Прогнать integration + E2E smoke на staging.
12. Закрыть DoD и передать контур в этапы 12/14/15.

## Definition of Ready (DoR)

- Согласованы auth API contracts и cookie policy.
- Подготовлены домены `app/api/*.yourapp.com` и TLS.
- Определены tenant onboarding defaults.
- Подключен email provider и шаблоны писем.
- Согласованы rate-limit пороги auth endpoints.

## Definition of Done (DoD)

- Self-signup создает tenant и owner атомарно без гонок.
- Работают login/refresh/logout/reset flows.
- Единая сессия между `app.yourapp.com` и `{slug}.yourapp.com` стабильна.
- Host-based tenant routing работает предсказуемо и безопасно.
- Email verification доступен как рекомендуемый non-blocking слой.
- CSRF token enforcement включен для state-changing BFF-операций.
- Auth контур покрыт тестами и наблюдаемостью.

## Риски и меры

- Риск: коллизии slug при одновременных регистрациях.
  - Мера: unique index + retry-friendly UX.
- Риск: компрометация refresh token.
  - Мера: rotation + revoke on sensitive actions + HttpOnly cookie.
- Риск: неправильная cookie-конфигурация ломает сессию между поддоменами.
  - Мера: staging E2E matrix на `app` и `{slug}` хостах.
- Риск: рост атак на login/reset.
  - Мера: rate-limit + audit + alerting.
