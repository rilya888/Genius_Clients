# 36. Подписки и Stripe: унификация планов (детальная проработка)

## Цель этапа
Привести подписочную модель к единому стандарту во всех слоях (БД/API/frontend/super-admin/Stripe), чтобы:
1. Плановая матрица была единой и неизменной по кодам.
2. Trial и апгрейд в Stripe работали без ручных операций.
3. UI и backend всегда показывали одинаковые тарифы и лимиты.
4. Webhook-обновления были идемпотентными и безопасными.

## Финальная матрица планов (зафиксировано)
1. `starter`
2. `pro`
3. `business`
4. `enterprise`

Правило салонов:
1. `starter`, `pro`, `business` -> `max_salons = 1`
2. `enterprise` -> `max_salons > 1`

Политика продаж:
1. `starter/pro/business` — покупка через Stripe checkout.
2. `enterprise` — только через контакт с администрацией (без self-checkout).

## Текущее состояние (важно для миграции)
1. В исторических данных и миграциях есть `growth`.
2. В runtime governance используется `tenant_subscriptions` + `subscription_plan_features`.
3. Stripe foundation есть (webhook endpoint + `stripe_customers`), но полноценный billing lifecycle еще не унифицирован.
4. В этапе 35 уже создан trial на `business` и read-only до verify.

Вывод: этап 36 должен быть выполнен как совместимый rollout без поломки текущих tenant/booking сценариев.

## Scope
1. Data migration для кодов планов и feature-map.
2. Backend billing APIs (checkout, subscription status, upgrade flow).
3. Stripe products/prices + webhook lifecycle.
4. Frontend унификация отображения тарифов.
5. Super-admin синхронизация планов и операторских операций.
6. QA/observability/runbook для production поддержки.

## Out of Scope
1. Полный self-service `enterprise`.
2. Multi-salon функциональность вне лимитов enterprise.
3. Переход на usage-based billing.

## Архитектурные принципы
1. **Single source of truth**:
   - код плана хранится в БД (`subscription_plans.code`) и совпадает с Stripe metadata.
2. **Idempotent billing**:
   - каждый Stripe event обрабатывается ровно один раз (provider event id + dedupe).
3. **Fail-safe pricing**:
   - если pricing конфиг невалиден, checkout не стартует.
4. **Plan-code immutability**:
   - коды планов фиксированы; меняются только цены/фичи/активность.
5. **Compatibility first**:
   - мягкая миграция `growth` -> `pro` (или архив) без runtime outage.

## Модель данных и миграции
### 1. План-каталог
1. Должны существовать ровно 4 активных кода:
   - `starter`, `pro`, `business`, `enterprise`.
2. `growth`:
   - деактивировать в `subscription_plans`,
   - убрать из UI и API-выдачи для клиентов.

### 2. Feature-map
Минимальный инвариант по `max_salons`:
1. `starter/pro/business` = `1`
2. `enterprise` > `1`

Дополнительно:
1. Проверить `max_staff`, `max_bookings_per_month`, whatsapp-фичи.
2. Зафиксировать значения в миграции и runbook.

### 3. Tenant subscriptions
1. Нормализовать записи с `plan_code='growth'`:
   - миграция данных в `pro` (если клиентов нет, все равно подготовить SQL для безопасного случая).
2. Обновить pending transitions, чтобы не осталось `pending_plan_code='growth'`.

### 4. Stripe mapping (новые поля/таблица)
1. Добавить стабильное сопоставление `plan_code -> stripe_price_id`:
   - отдельная таблица `subscription_plan_billing_config` (рекомендуется) или JSON-конфиг с валидацией.
2. Для каждого plan_code хранить:
   - `stripe_product_id`
   - `stripe_price_id_monthly` (минимум)
   - `is_checkout_enabled` (false для enterprise)

## Backend API (целевые контракты)
1. `GET /api/v1/admin/billing/plans`
   - список доступных тарифов для текущего tenant.
   - исключить `growth`.
2. `GET /api/v1/admin/billing/subscription`
   - текущий план, trial статус, `trialEndsAt`, `daysLeft`, pending change.
3. `POST /api/v1/admin/billing/checkout`
   - request: `targetPlanCode`.
   - pre-check:
     - plan существует и активен,
     - не `enterprise`,
     - upgrade only (без понижения на этом этапе),
     - если trial активен — вернуть флаг подтверждения.
   - response:
     - `checkoutUrl` или `requiresTrialConfirm`.
4. `POST /api/v1/admin/billing/checkout/confirm`
   - явное подтверждение покупки до окончания trial.
5. `POST /api/v1/webhooks/stripe`
   - обработка:
     - checkout.session.completed
     - customer.subscription.created/updated/deleted
     - invoice.payment_succeeded/payment_failed
   - обновление `tenant_subscriptions` и audit.

## Бизнес-правила checkout
1. Если trial активен:
   - первый запрос на покупку возвращает:
     - `requiresTrialConfirm=true`,
     - `trialDaysLeft`.
2. После подтверждения:
   - создается Stripe checkout session.
3. `enterprise`:
   - checkout запрещен,
   - возвращается reason `enterprise_contact_required`.
4. Политика апгрейда:
   - `Immediate + prorate` (апгрейд применяется сразу, Stripe считает корректировку за остаток периода).
5. Политика доступа:
   - запуск checkout и любые изменения подписки доступны только роли `owner`.
   - в подписках до `enterprise` это фактически один и тот же пользователь-владелец.

## Billing state-модель (обязательно для реализации)
1. Поддерживаемые состояния:
   - `trialing`, `active`, `past_due`, `canceled`, `incomplete`.
2. Переходы управляются webhook-событиями Stripe и подтверждаются локальным resolver.
3. При любом состоянии приоритет у server-side фактов из Stripe + локального event log.

## Политика `past_due` (мягкая)
1. День `D+0`:
   - пометить подписку как `past_due`,
   - показать баннер «Требуется оплата».
2. День `D+3`:
   - включить `read-only` для операционных разделов.
3. День `D+14`:
   - включить `hard lock` бизнес-функций,
   - оставить доступ к login, billing/settings и контактам поддержки.
4. После успешной оплаты:
   - автоматически вернуть доступ в соответствии с текущим планом.

## Stripe интеграция (детально)
1. Создать и зафиксировать продукты/цены:
   - starter/pro/business.
2. В metadata Stripe передавать:
   - `tenant_id`
   - `tenant_slug`
   - `target_plan_code`
3. Идемпотентность:
   - dedupe по `provider=stripe + provider_event_id`.
4. Обработка ошибок:
   - webhook retry-safe,
   - статус event `processed/failed` с деталями.
5. Секреты и версии:
   - фиксировать `STRIPE_API_VERSION`.
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
6. Валюта:
   - единая валюта `EUR` на этом этапе.
7. Налоги:
   - Stripe Tax не включается в рамках этапа 36 (отдельный будущий этап).

## Frontend (web/admin/landing)
1. Единый источник plan cards:
   - starter/pro/business/enterprise.
2. Удалить `growth` из:
   - Landing pricing,
   - Settings billing block,
   - любых селекторов super-admin для клиентского UI.
3. Billing block в settings:
   - текущий план,
   - trial days left,
   - CTA только на более дорогие планы,
   - enterprise CTA = контакт с администрацией.
4. Trial confirm modal:
   - текст: «У вас еще X дней trial. Вы точно хотите купить сейчас?».
5. Ошибки и состояния:
   - plan not available,
   - checkout unavailable,
   - webhook pending sync.
6. UI для `past_due`:
   - D+0: warning banner в dashboard/settings,
   - D+3: явный статус read-only + CTA «Оплатить»,
   - D+14: блокирующий экран для защищенных разделов с переходом в billing.

## Super-admin изменения
1. План-справочник в super-admin:
   - показать только 4 актуальных плана.
2. Операции:
   - принудительное назначение подписки tenant,
   - аудит всех изменений.
3. Ограничить случайные rollback на невалидные plan codes.

## Security и целостность
1. Проверка Stripe signature обязательна.
2. Никакого доверия данным цены/плана с фронта без server-side validation.
3. Любая смена плана логируется в audit.
4. Защита от race condition:
   - проверка активной подписки в транзакции.
5. Контроль прав:
   - backend ACL для billing mutation endpoints: только `owner`.

## Rollout-план
1. Фаза A: миграции данных и plan catalog cleanup (`growth` off).
2. Фаза B: backend billing endpoints + stripe mapping.
3. Фаза C: frontend billing/settings/landing унификация.
4. Фаза D: webhook processing + observability.
5. Фаза E: production включение checkout для starter/pro/business.

Rollback:
1. `is_checkout_enabled=false` для всех plan codes.
2. Оставить текущие подписки active без новых checkout.
3. Сохранить webhook intake и audit.

## Тест-план
1. Unit:
   - plan code validation,
   - upgrade matrix,
   - trial confirm requirement.
2. Integration:
   - checkout session creation,
   - webhook event apply,
   - idempotent replay of same event.
3. E2E:
   - trial tenant -> checkout -> webhook -> plan updated.
   - enterprise CTA -> no checkout.
4. Regression:
   - booking limits корректно применяются после апгрейда.
   - unverified read-only (этап 35) не ломается.
5. Billing status scenarios:
   - `active -> past_due(D+0) -> read-only(D+3) -> hard lock(D+14)`.
   - восстановление доступа после `invoice.payment_succeeded`.
6. Proration scenarios:
   - апгрейд `starter -> pro`, `pro -> business` в середине цикла применяет план сразу.

## Observability
1. Метрики:
   - `billing_checkout_create_total`
   - `billing_checkout_create_failed_total`
   - `stripe_webhook_received_total`
   - `stripe_webhook_processed_total`
   - `stripe_webhook_failed_total`
   - `billing_plan_change_total`
   - `billing_state_transition_total`
   - `billing_read_only_enabled_total`
   - `billing_hard_lock_enabled_total`
2. Логи:
   - requestId, tenantId, currentPlan, targetPlan, stripeEventId.
3. Алерты:
   - рост failed webhooks,
   - резкое падение checkout conversion.

## Риски и меры
1. Риск: рассинхрон code <-> stripe_price_id.
   - Мера: startup validation и health-check.
2. Риск: повторные webhook-события меняют подписку некорректно.
   - Мера: strict idempotency + event store.
3. Риск: legacy `growth` остается в hidden местах.
   - Мера: grep/checklist по репо + migration assertion.
4. Риск: trial и checkout конфликтуют по датам.
   - Мера: единый billing-state resolver в backend.

## Definition of Done
1. Во всех интерфейсах и API только 4 плана: starter/pro/business/enterprise.
2. `growth` отсутствует в активном UI/API и не используется для новых подписок.
3. Checkout для starter/pro/business работает через Stripe.
4. Enterprise доступен только через контакт с администрацией.
5. Webhook lifecycle обновляет подписку надежно и идемпотентно.
6. Trial-пользователь получает корректный confirm перед покупкой.
7. Governance limits применяются по актуальному плану после webhook sync.
8. Runbook и smoke-сценарии для billing доступны команде.
9. Checkout/plan-change endpoints доступны только `owner`.
10. Апгрейд работает по `Immediate + prorate`.
11. Мягкий `past_due` lifecycle (D+3/D+14) реализован и покрыт тестами.
12. Валюта единственная (`EUR`), Stripe Tax не активирован.

## ENV-переменные этапа
1. `STRIPE_SECRET_KEY`
2. `STRIPE_WEBHOOK_SECRET`
3. `STRIPE_API_VERSION`
4. `BILLING_CHECKOUT_ENABLED`
5. `BILLING_ENTERPRISE_CONTACT_URL`
6. `BILLING_TRIAL_CONFIRM_REQUIRED=true`
7. `BILLING_PAST_DUE_READONLY_AFTER_DAYS=3`
8. `BILLING_PAST_DUE_HARD_LOCK_AFTER_DAYS=14`
9. `BILLING_DEFAULT_CURRENCY=eur`

## Исполняемый backlog
1. Миграции для plan catalog cleanup и stripe mapping.
2. Backend billing endpoints + validation.
3. Checkout session service + metadata contract.
4. Stripe webhook processor (idempotent apply).
5. Frontend settings/landing pricing унификация.
6. Super-admin cleanup для 4 планов.
7. Smoke и мониторинг billing pipeline.
8. Production rollout по фазам A-E.

## Статус реализации (2026-03-22)
1. Выполнено:
- унификация каталога планов до `starter/pro/business/enterprise` в runtime;
- `growth` выведен из активного UI/API и мигрирован в `pro` в stage36 migration;
- backend billing endpoints и governance (`owner`-доступ, trial confirm, enterprise contact-only);
- Stripe webhook обработка и идемпотентный event pipeline;
- публичный pricing контракт возвращает canonical 4 плана.
2. Проверки:
- `pnpm --filter @genius/api run typecheck` — OK;
- `curl https://api-production-9caa.up.railway.app/api/v1/marketing/pricing/plans` — 4 плана (`starter/pro/business/enterprise`), `enterprise.selfServe=false`.
3. Что не закрывается без внешних данных:
- полноценный webhook smoke `pnpm smoke:stripe-webhook` требует секреты:
  - `STRIPE_WEBHOOK_SECRET`,
  - `STRIPE_TEST_TENANT_ID`,
  - `SMOKE_API_BASE_URL`.
4. Итог:
- код и миграции этапа выполнены;
- финальная операционная валидация Stripe в production требует заполненных smoke env и тестового tenant.
