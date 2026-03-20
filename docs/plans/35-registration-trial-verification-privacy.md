# 35. Регистрация, Trial, Email Verification, Privacy (детальная проработка)

## Цель этапа
Сделать онбординг нового клиента безопасным, предсказуемым и готовым к коммерческой модели:
1. Регистрация с корректной валидацией email/пароля.
2. Обязательное подтверждение email.
3. Автоматическое создание trial-подписки на 30 дней.
4. Юридически корректная фиксация privacy-consent.
5. Подготовка к CAPTCHA (Turnstile) через feature-flag.
6. UX-уведомление после регистрации о процессе подключения WhatsApp-бота.

## Финальные бизнес-правила (зафиксировано)
1. Trial: 30 дней, план `business`, лимит салонов = 1.
2. Email verification обязательна для полного доступа.
3. Пароль: минимум 6 символов и минимум 1 спецсимвол.
4. Privacy checkbox обязателен на регистрации.
5. Turnstile включается флагом после подключения реального домена.
6. После signup пользователь получает сообщение:
   - для подключения WhatsApp нужно написать администрации;
   - нужен новый номер;
   - номер нельзя одновременно использовать как бот-номер и как обычный чат.
7. Неподтвержденные аккаунты удаляются через 30 дней от даты регистрации.
8. Для уже существующего email на регистрации возвращается явная ошибка, что аккаунт существует.
9. Восстановление пароля обязательно: flow "Forgot password / Reset password".

## Зависимости от других этапов
1. Этап 34 (tenant-host):
   - после регистрации сразу использовать tenant-slug и переходить на tenant-контекст.
2. Этап 36 (подписки/Stripe):
   - trial должен корректно входить в checkout-логику и апгрейд.
3. Этап 37 (settings/billing UX):
   - данные trial должны отображаться в настройках подписки.

## Scope (что входит)
1. Backend: auth-flow, verify/resend endpoints, trial provisioning, consent persistence.
2. Frontend: форма регистрации, экран verify-email, resend, сообщения/ошибки, post-signup notice.
3. Инфраструктура: конфиги Resend/Turnstile, rate-limit для verify/resend.
4. QA/Observability: метрики регистрации/верификации, smoke-сценарии.
5. Password reset flow: forgot/reset endpoints, токены, UI-экраны.

## Out of Scope (что не входит)
1. Полная реализация Stripe checkout и lifecycle (это этап 36).
2. Multi-salon бизнес-логика enterprise (отдельный этап).
3. Полноценная доменная production-каноникализация (часть этапа 34/infra rollout).

## Целевая архитектура флоу регистрации
1. Пользователь отправляет форму регистрации.
2. Backend:
   - валидирует поля;
   - создает tenant + owner user (pending verification);
   - создает trial subscription (business, 30 дней);
   - сохраняет privacy consent;
   - генерирует verify token;
   - отправляет verify email через Resend.
3. Frontend показывает экран «Проверьте email» + кнопку resend.
4. Пользователь подтверждает email по ссылке.
5. Backend активирует email_verified_at.
6. После логина пользователь попадает в админку tenant и видит статус trial.

## Зафиксированные продуктовые решения
1. Неподтвержденный email:
   - вход в `/app` разрешен,
   - режим только read-only,
   - любые state-changing действия заблокированы до verify.
2. `privacyVersion`:
   - фиксированная версия из конфигурации (`PRIVACY_POLICY_VERSION`),
   - без управления через super-admin на этом этапе.
3. Поведение при `email already exists`:
   - явная ошибка для пользователя.
4. Старт trial:
   - сразу при успешной регистрации, до verify.
5. TTL неподтвержденных аккаунтов:
   - автоудаление через 30 дней.

## Изменения модели данных (детально)
1. Таблица `users`:
   - `email_verified_at TIMESTAMP NULL`.
   - `email_verification_sent_at TIMESTAMP NULL` (для антиспама/UX).
   - `email_verification_attempts INT DEFAULT 0`.
2. Таблица `tenant_subscriptions`:
   - использовать текущую модель, но гарантировать:
     - `plan_code='business'`,
     - `status='trialing'` (или эквивалентное текущее состояние),
     - `effective_from=trial_started_at`,
     - `effective_to=trial_ends_at`.
3. Новая таблица `tenant_consents` (рекомендуется):
   - `id`, `tenant_id`, `user_id`, `consent_type`, `consent_version`, `accepted_at`, `ip`, `user_agent`.
   - минимум одна запись `privacy_policy`.
4. Таблица токенов верификации (если еще нет единой):
   - `user_id`, `token_hash`, `expires_at`, `used_at`, `created_at`.
   - индекс на `user_id`, уникальность активного токена.
5. Механизм удаления неподтвержденных аккаунтов:
   - job (cron/worker) с удалением пользователей и связанных tenant-данных, если:
     - `email_verified_at IS NULL`,
     - `created_at < NOW() - interval '30 days'`.
6. Таблица reset-токенов (или унифицированная таблица токенов):
   - `user_id`, `token_hash`, `expires_at`, `used_at`, `created_at`, `purpose='password_reset'`.

## API-контракты (целевые)
1. `POST /api/v1/auth/register`
   - request:
     - `businessName`
     - `email`
     - `password`
     - `privacyAccepted` (boolean, must be true)
     - `privacyVersion` (string)
     - `turnstileToken` (optional под флагом)
   - response:
     - `requiresEmailVerification=true`
     - `tenantSlug`
     - `trialEndsAt`
     - `whatsappSetupNotice`
2. `POST /api/v1/auth/verify-email/resend`
   - request: `email`
   - response: always generic success (без утечки existence).
3. `GET/POST /api/v1/auth/verify-email` (по текущему стилю проекта)
   - принимает token.
   - помечает email как подтвержденный.
4. `GET /api/v1/auth/me`
   - дополнить:
     - `emailVerified` (boolean),
     - `trialEndsAt`,
     - `trialDaysLeft`,
     - `planCode`.
5. `POST /api/v1/auth/forgot-password`
   - request: `email`.
   - response: generic success (чтобы не раскрывать наличие email в системе).
6. `POST /api/v1/auth/reset-password`
   - request: `token`, `newPassword`.
   - response: success + инвалидация всех активных сессий (через token version).

## Правила авторизации до подтверждения email
1. Разрешено:
   - verify-email страницы,
   - resend verification,
   - forgot/reset password,
   - logout.
2. Ограничить:
   - state-changing admin endpoints,
   - критичные действия (создание услуг/мастеров/записей из админки).
3. UI-поведение:
   - баннер/экран «Подтвердите email для продолжения».
   - read-only бейдж/индикатор в админке до verify.

## Валидация и безопасность
1. Email:
   - строгий синтаксис,
   - lower-case normalization.
2. Пароль:
   - `length >= 6`,
   - минимум 1 спецсимвол,
   - серверная проверка обязательна даже при фронтовой валидации.
3. Anti-abuse:
   - rate-limit на register и resend.
   - rate-limit на forgot-password и reset-password.
   - generic responses для resend.
4. Turnstile:
   - флаг `AUTH_TURNSTILE_ENABLED`.
   - если `true`, registration требует валидный token.
5. Токены верификации:
   - хранить только hash,
   - короткий TTL,
   - one-time use.
6. Токены восстановления пароля:
   - hash-only storage,
   - short TTL,
   - one-time use,
   - принудительное аннулирование активных access/refresh сессий после reset.

## UX/Frontend (детально)
1. RegisterPage:
   - поля: business name, email, password.
   - чекбокс privacy (обязательный).
   - inline ошибки по полям.
2. После успешной регистрации:
   - не считать пользователя полноценно активным без verify.
   - показать экран «Письмо отправлено».
   - показать WhatsApp notice (текст бизнес-правила).
3. Verify flow:
   - отдельная страница обработки verify token.
   - явные состояния: success / expired / invalid.
   - кнопка resend.
4. Login flow:
   - если email не подтвержден, переадресовать на verify screen.
   - после входа при неподтвержденном email: доступ в `/app` только для чтения, без mutation-действий.
5. i18n:
   - все новые тексты добавить в `en/it` словари.
6. Forgot/Reset UI:
   - `ForgotPasswordPage` с отправкой email.
   - `ResetPasswordPage` с проверкой токена и формой нового пароля.

## Trial lifecycle (детально)
1. На signup создавать trial автоматически в одной транзакции с tenant/user.
2. `trial_ends_at = signup_at + 30 days`.
3. На чтении профиля/подписки отдавать `trial_days_left` (не отрицательный).
4. По истечении trial:
   - статус должен переходить в состояние, требующее выбора платного плана (этап 36).
5. Логи аудита:
   - `auth.register.success`,
   - `subscription.trial.created`,
   - `auth.email_verified`.
6. Неподтвержденные аккаунты:
   - автоматическое удаление через 30 дней отдельной фоновой задачей.

## Rollout-план без даунтайма
1. Фаза A:
   - миграции БД,
   - backend с backward-compatible ответами.
2. Фаза B:
   - frontend с новыми полями/verify UI.
3. Фаза C:
   - включение verify enforcement.
4. Фаза D:
   - включение Turnstile (когда домен готов).
5. Фаза E:
   - включение scheduled cleanup неподтвержденных аккаунтов.
6. Rollback:
   - отдельный флаг для временного ослабления verify gating (аварийно).

## Тест-план
1. Unit:
   - password/email validation.
   - token TTL/one-time use.
   - trial days-left вычисление.
2. Integration:
   - register -> trial created.
   - register without privacy -> 400.
   - verify success/expired/reused.
   - resend rate-limit.
   - forgot/reset happy path и expired/reused token.
   - reset invalidates active sessions.
   - cleanup job deletes stale unverified users.
3. E2E:
   - полный signup -> verify -> login -> dashboard.
   - unverified login -> verify screen.
   - forgot-password -> email link -> reset -> login with new password.
4. Security:
   - user enumeration check on resend.
   - user enumeration check on forgot-password.
   - brute-force resilience for register/resend.
   - turnstile required path when flag enabled.

## Observability
1. Метрики:
   - `auth_register_attempt_total`
   - `auth_register_success_total`
   - `auth_verify_email_success_total`
   - `auth_verify_email_failed_total`
   - `auth_verify_email_resend_total`
   - `auth_forgot_password_total`
   - `auth_reset_password_success_total`
   - `auth_reset_password_failed_total`
   - `auth_unverified_cleanup_deleted_total`
2. Логи:
   - `requestId`, `tenantId`, `userId`, `emailHash`, `reason`.
3. Алерты:
   - резкий рост verify failures,
   - всплеск resend.

## Риски и меры
1. Риск: рассинхрон tenant/user/subscription при signup.
   - Мера: одна транзакция + идемпотентность на email.
2. Риск: спам resend.
   - Мера: rate-limit + cooldown + generic response.
3. Риск: падение deliverability email.
   - Мера: retry policy + мониторинг bounce/complaint в Resend.
4. Риск: UX-фрустрация на verify.
   - Мера: понятные экраны и быстрый resend.
5. Риск: агрессивная очистка удалит нужный аккаунт.
   - Мера: удалять только строго неподтвержденные аккаунты старше 30 дней + логировать каждое удаление.

## Definition of Done
1. Без privacy checkbox регистрация невозможна.
2. Email verification обязательна и реально ограничивает доступ.
3. На signup создается trial (business, 30 дней, 1 салон).
4. Данные trial отображаются в `me/settings`.
5. Post-signup WhatsApp notice отображается всегда.
6. Resend защищен от abuse.
7. Работает forgot/reset password c инвалидацией старых сессий.
8. Неподтвержденные аккаунты удаляются джобой через 30 дней.
9. Тесты (unit/integration/e2e-smoke) проходят.
10. Rollout runbook и env-переменные задокументированы.

## ENV-переменные этапа
1. `RESEND_API_KEY`
2. `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`
3. `AUTH_EMAIL_VERIFICATION_REQUIRED`
4. `AUTH_TURNSTILE_ENABLED`
5. `TURNSTILE_SECRET_KEY`
6. `TRIAL_DURATION_DAYS=30`
7. `TRIAL_DEFAULT_PLAN_CODE=business`
8. `PRIVACY_POLICY_VERSION=v1`
9. `UNVERIFIED_ACCOUNT_RETENTION_DAYS=30`
10. `PASSWORD_RESET_TOKEN_TTL_MINUTES`

## Порядок реализации (исполняемый backlog)
1. Миграции и репозитории consent/verification/trial.
2. Обновление auth-service/register transaction.
3. Verify/resend endpoints + rate-limit.
4. Forgot/reset endpoints + token storage + session invalidation.
5. Verify gating в session/auth middleware (read-only mode for unverified).
6. Frontend Register/Verify/Login/Forgot/Reset UX.
7. Cleanup job для неподтвержденных аккаунтов > 30 дней.
8. i18n обновления.
9. Smoke scripts и метрики.
10. Rollout в production через GitHub deploy ветки.
