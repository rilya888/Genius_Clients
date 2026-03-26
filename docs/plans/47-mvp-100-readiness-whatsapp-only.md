# План 47: Доведение до 100% готовности к прод-MVP (WhatsApp-only)

## Цель этапа
Довести проект до эксплуатационно готового состояния для прод-MVP без Telegram: стабильный деплой через GitHub, воспроизводимые проверки перед релизом, подтверждённые E2E-контуры записи/подтверждения, и операционные runbook/rollback/restore.

## Границы этапа
- Включено: Web/API/Bot/Worker, WhatsApp, multi-tenant, super-admin security, release gates.
- Исключено: Telegram-интеграция и Telegram-переменные как обязательные/блокирующие.

## Поток реализации

### 1) Релизная консистентность
1. Зафиксировать единый baseline commit для `web/api/bot/worker`.
2. Синхронизировать `deploy/web`, `deploy/api`, `deploy/bot`, `deploy/worker` на baseline.
3. Проверить, что последние деплои всех сервисов `SUCCESS` и указывают на согласованные commit/branch.
4. Обновить release-checklist: деплой только через GitHub ветки, без snapshot CLI для прода.

**Критерий готовности:** все сервисы деплоятся из согласованных `deploy/*` веток; нет расхождения фронта/бэкенда по релизной базе.

### 2) Env-аудит под WhatsApp-only
1. Обновить `audit-railway-env`:
   - Telegram переменные перевести в optional/ignored для MVP.
   - Сохранить проверку обязательных переменных безопасности/БД/WhatsApp.
2. Добавить явный режим `MVP_CHANNEL_MODE=whatsapp_only` (документация + поведение аудита).
3. Зафиксировать обязательный список env для prod и staging.

**Критерий готовности:** `railway:audit-env` не краснеет из-за Telegram.

### 3) Унифицированные smoke-gates для прода
1. Исправить `smoke:observability` (реальный скрипт/удаление битой ссылки).
2. Добавить единый orchestrator smoke-гейтов для прода:
   - health-check 4 сервисов
   - SPA public contract (валидный tenant)
   - SPA auth/admin contract
   - super-admin security
   - tenant host security/resolution
3. Стандартизировать входные переменные smoke (`SMOKE_API_URL`, `SMOKE_TENANT_SLUG`, `SMOKE_AUTH_AUTOREGISTER`, `SMOKE_SUPER_ADMIN_SECRET`).

**Критерий готовности:** один запуск prod-gates дает воспроизводимый pass/fail без ручных донастроек.

### 4) WhatsApp E2E release-gates
1. Проверка основного бизнес-флоу:
   - клиент создает запись
   - админу приходит запрос подтверждения
   - админ подтверждает
   - клиент получает подтверждение
2. Проверка окна 24h:
   - открытое окно -> session message
   - закрытое окно -> template message
3. Проверка reject-флоу:
   - админ отклоняет
   - вводит причину
   - клиент получает причину
4. Проверка идемпотентности:
   - повтор webhook/event не создает дубль уведомлений/статусов.

**Критерий готовности:** все сценарии проходят и подтверждены логами с request-id/providerMessageId.

### 5) Стабильность tenant/domen/session
1. Проверить и зафиксировать `APP_ROOT_DOMAIN` + `SESSION_COOKIE_DOMAIN` для текущего Railway-домена.
2. Проверить auth/session на:
   - корневом домене
   - tenant slug маршрутах
3. Проверить tenant-host resolution/security smoke.

**Критерий готовности:** логин/сессия стабильны, tenant routing воспроизводим.

### 6) DB migration safety + restore readiness
1. Проверить, что прод и стейджинг на одинаковой migration head.
2. Добавить SQL-проверки целостности ключевых таблиц:
   - tenants/users/bookings/notification_deliveries/whatsapp_contact_windows.
3. Подготовить и выполнить backup + test restore drill на отдельной БД.
4. Зафиксировать RPO/RTO для MVP.

**Критерий готовности:** есть валидированный сценарий восстановления и подтверждённая целостность данных.

### 7) Rollback и операционная готовность
1. Описать и проверить rollback-процедуру (по сервисам и целиком).
2. Описать runbook по инцидентам:
   - нет сообщения админу
   - не уходит template
   - token expired
   - tenant not found / session issue
3. Проверить наличие минимальных алертов и читаемых логов по API/Bot/Worker.

**Критерий готовности:** оператор может выполнить диагностику и откат без участия разработки.

### 8) Финальный sign-off
1. Прогон полного чеклиста и smoke-gates.
2. Финальный backup перед релизом.
3. Фиксация версии как `MVP Ready (WhatsApp-only)` с known limits.

**Критерий готовности:** нет открытых P0/P1, все release gates зеленые.

## Порядок выполнения (практически)
1. Исправления в scripts (env-audit + smoke orchestrator + observability smoke).
2. Обновление release/docs/checklists.
3. Прогон прод-гейтов.
4. Донастройка env/domain при необходимости.
5. Backup/restore/rollback документация и проверки.

## Риски и контроль
- Риск расхождения deploy commit между web и api/bot/worker.
  - Контроль: проверка deployment list как gate.
- Риск ложных smoke-fail из-за отсутствующих переменных запуска.
  - Контроль: единый orchestrator с проверкой prerequisite.
- Риск регресса WhatsApp при смене токенов/шаблонов.
  - Контроль: E2E + логирование providerMessageId + fallback policy.

