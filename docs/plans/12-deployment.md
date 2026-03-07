# Этап 12: Testing & Deployment

## Цель этапа

Собрать предсказуемый и безопасный pipeline релиза в Railway, который:

- гарантирует воспроизводимую сборку и выкладку `web/api/bot/worker`,
- не ломает мультитенантные контуры и webhook-интеграции,
- поддерживает контролируемый rollback,
- обеспечивает базовый production baseline для этапов 14 и 15.

## Границы MVP

**Входит в этап 12:**
- единый CI/CD pipeline для build/test/deploy;
- staging + production окружения;
- стратегия миграций БД без простоя;
- деплой сервисов и cron/worker задач;
- smoke-проверки после выкладки;
- минимальный monitoring/alerting bootstrap;
- release checklist + rollback checklist.

**Не входит в этап 12:**
- blue/green с автоматическим traffic split;
- сложные canary/feature-flag orchestration платформенного уровня;
- 24/7 SRE on-call.

## Архитектурное место в системе

- Этап 12 связывает результаты этапов 01-11 в единый production контур.
- Выкладка учитывает контракты безопасности из этапа 14.
- Эксплуатационные процедуры синхронизируются с этапом 15.
- Базовые legal/GDPR требования валидируются на уровне release readiness.

## Стратегия окружений

## 12.1 Окружения

- `local`: разработка и быстрые проверки.
- `staging`: обязательная пред-prod проверка миграций, webhook и smoke flow.
- `production`: рабочее окружение клиентов.

Политика:
- прямые деплои в production без прохождения staging запрещены;
- конфигурация окружений хранится отдельно (env isolation);
- данные production никогда не копируются в staging без анонимизации.

## 12.2 Сервисы и роли

MVP-сервисы:
- `web` (Next.js BFF + UI);
- `api` (core business API `/api/v1`);
- `bot` (orchestrator + channel adapters);
- `worker` (обязательный отдельный сервис для scheduler/reminders/background jobs).

Правило:
- фоновые задачи и cron не исполнять внутри пользовательских HTTP путей.

## CI/CD pipeline

## 12.3 Этапы pipeline

Минимальный pipeline:
1. `install` (детерминированно, lockfile обязателен).
2. `lint`.
3. `typecheck`.
4. `unit tests`.
5. `integration tests` (на тестовом DB и mock внешних API).
6. `build` (`web/api/bot/worker`).
7. `artifact publish` (если применяется).
8. `deploy staging`.
9. `staging smoke`.
10. `manual approval`.
11. `deploy production`.
12. `post-deploy smoke + health validation`.

## 12.4 Gate policy

Release в production блокируется, если:
- не прошли unit/integration тесты;
- не прошли staging smoke;
- есть незакрытые blocker регрессии по booking flow;
- миграции помечены как irreversible без rollback-плана.

## Тестовая стратегия релиза

## 12.5 Unit

Обязательные домены:
- slot calculation;
- booking validation/idempotency;
- i18n key integrity;
- channel payload normalization (WA/TG).

## 12.6 Integration

Покрыть:
- API CRUD и booking lifecycle;
- webhook verify/signature validation (Stripe/WA/TG);
- bot tool-calls к `/api/v1`;
- reminders queue flow (`enqueue -> send -> status`).

## 12.7 E2E (MVP-рекомендовано)

- Public booking flow (web);
- Admin confirm/cancel flow;
- Базовый chat-assisted booking smoke (можно semi-automated).

## Деплой в Railway

## 12.8 Railway services

| Сервис | Source | Build | Start | Назначение |
|---|---|---|---|---|
| `web` | `apps/web` | `pnpm build` | `pnpm start` | BFF + UI |
| `api` | `apps/api` | `pnpm build` | `pnpm start` | Core API |
| `bot` | `apps/bot` | `pnpm build` | `pnpm start` | Channel adapters + AI orchestration |
| `worker` | `apps/worker` | `pnpm build` | `pnpm start:worker` | reminders/scheduler/jobs |

## 12.9 База данных

- Railway Postgres (или эквивалент managed Postgres).
- `DATABASE_URL` отдельный для staging/prod.
- Обязательные расширения и миграции применяются через controlled migration job.

## 12.10 Домены и сеть

- `api.yourapp.com` -> API service.
- `app.yourapp.com` -> web/admin entrypoint.
- `*.yourapp.com` -> tenant public/admin routes.
- TLS обязателен везде.

## Конфигурация и секреты

## 12.11 Базовые env-переменные

- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_API_VERSION`
- `WA_VERIFY_TOKEN`, `WA_WEBHOOK_SECRET`, `META_APP_SECRET`
- `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET_TOKEN`
- `JWT_SECRET`, `INTERNAL_API_SECRET`
- `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## 12.12 Политика секретов

- секреты только через secret manager Railway/провайдера;
- запрет хранения секретов в git и build logs;
- ротация критичных секретов по runbook;
- аудит изменения секретов обязателен.

Примечание по WhatsApp (мультитенантность):
- `WA_ACCESS_TOKEN` и `WA_PHONE_NUMBER_ID` не хранить глобально;
- использовать per-tenant `TenantWhatsAppConfig` + `access_token_secret_ref`.

## Миграции и схема БД

## 12.13 Стратегия миграций

- Подход: expand -> migrate -> contract.
- Запрещены breaking-изменения в один шаг для активных таблиц.
- Каждая миграция имеет:
  - forward plan,
  - rollback/mitigation plan,
  - оценку влияния на lock time.

## 12.14 Порядок на релизе

1. Deploy совместимого приложения (read/write совместимо со старой схемой).
2. Запустить миграции.
3. Прогнать post-migration smoke.
4. Включить новую функциональность (если есть feature flag).

## Health, readiness, smoke

## 12.15 Health endpoints

- `GET /api/v1/health` (liveness).
- `GET /api/v1/ready` (readiness: DB/Redis/queue dependencies).
- Аналогичный lightweight health для `bot/worker` (внутренний endpoint или heartbeat metric).

## 12.16 Post-deploy smoke

Минимальный smoke checklist:
- API отвечает и проходит readiness;
- web открывается для tenant маршрута;
- booking create (тестовый tenant) работает;
- webhook endpoints отвечают корректно;
- reminder worker активен и виден heartbeat.

## Мониторинг и алерты

## 12.17 Monitoring baseline

- централизованные логи по сервисам;
- базовый error tracking;
- метрики:
  - HTTP 5xx rate,
  - job failure rate,
  - webhook error rate,
  - queue lag,
  - DB connection saturation.

## 12.18 Alerting baseline

MVP-алерты:
- API недоступен >5 минут;
- резкий рост 5xx;
- scheduler/worker heartbeat потерян;
- queue lag выше порога;
- массовые webhook signature failures.

## Rollback и инциденты

## 12.19 Rollback policy

- При критической регрессии:
  1. откатить сервисы на предыдущий стабильный deploy;
  2. при необходимости включить read-only mitigation;
  3. выполнить DB rollback только если это безопасно и подготовлено заранее;
  4. зафиксировать incident note и postmortem.

## 12.20 Incident communication

- В MVP: уведомление владельца/оператора через Telegram или email.
- Для tenant-impacting инцидентов — короткий статус-апдейт в agreed канале поддержки.

## GDPR / Privacy readiness

## 12.21 Минимальные требования к релизу

- доступны Privacy Policy и Cookie Policy;
- consent checkbox на публичной записи активен;
- ручной процесс удаления данных по запросу задокументирован;
- PII в логах замаскированы согласно policy этапа 14.

## Поэтапный план работ (поштучно)

1. Зафиксировать матрицу окружений `local/staging/prod`.
2. Собрать CI pipeline: lint/typecheck/unit/integration/build.
3. Добавить staging deploy + smoke gates.
4. Добавить manual approval перед production.
5. Настроить Railway сервисы `web/api/bot/worker`.
6. Настроить секреты и политику их ротации.
7. Внедрить migration workflow (expand/migrate/contract).
8. Добавить `health/ready` проверки и post-deploy smoke script.
9. Настроить monitoring/alerting baseline.
10. Описать rollback и incident runbook.
11. Провести пробный релиз в staging и контрольный релиз в production.
12. Закрыть DoD и передать в этап 15 как operating baseline.

## Definition of Ready (DoR)

- Определены сервисы и ответственность команд по релизу.
- Согласованы пороги алертов и smoke чеклист.
- Подготовлены домены и TLS.
- Подготовлены секреты для всех интеграций (Stripe/WA/TG/OpenAI).
- Подтверждена стратегия миграций и rollback.

## Definition of Done (DoD)

- CI/CD pipeline стабильно проводит релиз в staging и production.
- Все сервисы деплоятся воспроизводимо и проходят smoke.
- Health/readiness/heartbeat дают прозрачную картину состояния.
- Секреты и webhook security настроены по policy.
- Миграции выполняются без критичных регрессий и с rollback-планом.
- Базовые алерты и runbook работают в production.

## Риски и меры

- Риск: релиз ломает booking flow из-за несинхронной миграции.
  - Мера: expand/migrate/contract + staging smoke на реальных сценариях.
- Риск: утечка/ошибка секретов при деплое.
  - Мера: secret manager + audit + регулярная ротация.
- Риск: “тихий” сбой worker/cron.
  - Мера: heartbeat метрика + обязательный алерт на отсутствие heartbeat.
- Риск: webhook деградация после смены домена/сертификата.
  - Мера: post-deploy webhook smoke + мониторинг signature failures.
