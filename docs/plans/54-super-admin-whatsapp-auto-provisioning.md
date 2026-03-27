# План 54: Автоподключение номеров WhatsApp из Super Admin (без автоподтверждения OTP)

## Цель
Сделать единый управляемый процесс, при котором Super Admin меняет номера бота и администратора для салона в панели, а система автоматически:
- валидирует и запускает provisioning в Meta,
- ждет только ручной ввод OTP,
- после OTP сама завершает binding, routing и healthcheck,
- безопасно откатывается при ошибках.

## Целевой UX
1. Super Admin открывает карточку салона и вводит:
- `bot_number_e164`
- `operator_number_e164`
2. Нажимает `Start provisioning`.
3. Система переводит задачу в нужный шаг и показывает статус.
4. Если нужен код: статус `OTP_REQUIRED`, кнопка `Request OTP` и поле `Confirm OTP`.
5. После успешного OTP система автоматически:
- привязывает `phone_number_id`/`waba_id`,
- обновляет endpoint,
- активирует новый routing,
- выполняет healthcheck,
- выставляет `READY`.

## Архитектура данных

### 1) `whatsapp_number_provisioning_jobs`
Хранит orchestration-задачу:
- `id`, `tenant_id`
- `bot_number_e164`, `operator_number_e164`
- `status` (`draft|running|otp_required|ready|failed_retryable|failed_final|rolled_back`)
- `step` (`validating|meta_prepare|otp_request|otp_verify|routing_update|healthcheck|done`)
- `job_key` (идемпотентность)
- `meta_payload_json`, `error_code`, `error_message`
- `attempts`, `last_attempt_at`, `next_retry_at`
- `created_by`, `updated_by`, timestamps

### 2) `whatsapp_tenant_bindings`
Единый источник правды для runtime-маршрутизации:
- `id`, `tenant_id`
- `bot_number_e164`, `operator_number_e164`
- `phone_number_id`, `waba_id`, `business_id`
- `endpoint_id`
- `binding_version`
- `is_active`, `verified_at`, timestamps

### 3) `whatsapp_otp_sessions`
Состояние OTP:
- `id`, `job_id`
- `verification_method` (`sms|voice`)
- `masked_target`
- `state` (`created|requested|verified|expired|failed`)
- `attempts`, `max_attempts`
- `otp_expires_at`, timestamps

## State machine provisioning
- `DRAFT -> VALIDATING -> META_PREPARE`
- `META_PREPARE -> OTP_REQUIRED` (если нужен OTP)
- `OTP_REQUIRED -> OTP_VERIFYING -> META_CONFIRMED`
- `META_CONFIRMED -> ROUTING_UPDATING -> HEALTHCHECK -> READY`
- Ошибки:
  - retryable: `FAILED_RETRYABLE`
  - final: `FAILED_FINAL`
- При провале post-OTP шага: rollback на предыдущий активный binding.

## API (Super Admin)
1. `POST /api/v1/super-admin/tenants/:tenantId/whatsapp/provision/start`
- вход: `botNumber`, `operatorNumber`, `verificationMethod`
- выход: текущий `job`

2. `POST /api/v1/super-admin/tenants/:tenantId/whatsapp/provision/request-otp`
- вход: `jobId`, опционально `verificationMethod`
- выход: обновленный `job` + `otpSession`

3. `POST /api/v1/super-admin/tenants/:tenantId/whatsapp/provision/confirm-otp`
- вход: `jobId`, `code`
- выход: обновленный `job`, статус маршрутизации

4. `POST /api/v1/super-admin/tenants/:tenantId/whatsapp/provision/retry`
- вход: `jobId`
- выход: обновленный `job`

5. `GET /api/v1/super-admin/tenants/:tenantId/whatsapp/provision/status`
- выход: активный `job`, `currentBinding`, `lastBinding`, `diagnostics`

## Интеграция Meta API
Вынести в отдельный адаптер `MetaWhatsAppProvisionAdapter`:
- `prepareNumber(...)`
- `requestOtp(...)`
- `confirmOtp(...)`
- `fetchPhoneNumberProfile(...)`
- `healthcheckSend(...)`

Требования:
- retries/backoff,
- нормализация ошибок (`retryable|final|user_action_required`),
- маскирование секретов и OTP в логах.

## Routing и rollback
1. Новый binding создается как неактивный.
2. Активируется только после успешного `HEALTHCHECK`.
3. При ошибке переключения — автооткат на предыдущий `is_active=true` binding.
4. Runtime-бот читает только активный binding.

## UI (Super Admin)
Добавить блок `WhatsApp Provisioning`:
- поля `Bot number` и `Operator number`,
- статус шага и прогресс,
- кнопки `Start`, `Request OTP`, `Confirm OTP`, `Retry`, `Rollback`,
- панель диагностики (что конкретно не готово).

## Контроль гонок и идемпотентность
- один активный job на tenant,
- `job_key` для защиты от повторных запусков,
- optimistic lock/version check на шаги.

## Ограничения OTP
- лимит попыток,
- TTL сессии,
- cooldown на `request-otp`,
- блокировка brute-force.

## Наблюдаемость и эксплуатация
- аудит: все переходы state machine,
- метрики: время подключения, error rate по шагам, retry count,
- алерты на stuck статусы (`otp_required`, `failed_retryable`),
- runbook для быстрого восстановления.

## Совместимость и миграция
1. Миграция текущих endpoint в `whatsapp_tenant_bindings` (baseline).
2. До полного rollout использовать feature flag `WA_AUTO_PROVISION_ENABLED`.
3. Пошаговый rollout по allowlist tenant.

## Фазы реализации

### Фаза A (backend foundation)
- миграции + schema,
- repository + service + state machine,
- API endpoints,
- базовые unit/integration тесты.

### Фаза B (meta orchestration)
- адаптер Meta API,
- обработка OTP,
- post-OTP routing + healthcheck + rollback.

### Фаза C (super-admin UI)
- provisioning виджет,
- UX ошибок и диагностики,
- retry/rollback actions.

### Фаза D (hardening)
- алерты и метрики,
- runbook,
- rollout по tenant-группам.

## Критерии готовности
- Новый номер подключается из Super Admin без ручного редактирования БД.
- Единственный ручной шаг — ввод OTP.
- После `READY` бот и admin-notifications работают на новых номерах.
- При провале сохраняется/восстанавливается предыдущий рабочий routing.
