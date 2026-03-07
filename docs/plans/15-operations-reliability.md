# Этап 15: Operations & Reliability (MVP)

## Цель этапа

Зафиксировать эксплуатационный baseline для стабильной работы MVP в production, чтобы:

- сервис восстанавливался в целевых рамках `RPO/RTO`,
- инциденты обнаруживались и эскалировались предсказуемо,
- ключевые фоновые и интеграционные процессы не деградировали «тихо»,
- команда имела исполнимый runbook и формальные release/rollback правила.

## Границы MVP

**Входит в этап 15:**
- reliability policy + incident management baseline;
- backup/restore и проверка восстановления;
- очередь задач и DLQ эксплуатация;
- SLI/операционные метрики + алерты;
- обязательный error tracking через Sentry;
- runbook и on-call-lite процедуры;
- retention/housekeeping процедуры;
- release safety checklist.

**Не входит в этап 15:**
- 24/7 enterprise on-call ротация;
- формальный внешний SLA с контрактными штрафами;
- мульти-регион active-active архитектура.

## Reliability Policy

## 15.1 Service posture

- Режим MVP: `best effort` без публичного SLA.
- Внутренние ориентиры восстановления:
  - `RPO = 24h`
  - `RTO = 4h`
- Все production-инциденты фиксируются в incident журнале и завершаются postmortem.

## 15.2 SLI baseline (внутренний)

Минимально наблюдаемые SLI:
- API availability (`/api/v1/health`, `/api/v1/ready`),
- 5xx error rate,
- queue lag и job failure rate,
- webhook processing success rate,
- reminder on-time delivery rate,
- DB connectivity saturation.

## Backup & Restore

## 15.3 Backup policy

- Ежедневный полный backup PostgreSQL.
- Хранение backup минимум 7 дней.
- Шифрование backup на стороне провайдера.
- Backup job должен быть мониторируемым (success/fail metric + alert).

## 15.4 Restore drill

- Минимум 1 подтвержденный restore drill до публичного запуска.
- Далее: регулярный drill по графику (например, ежемесячно/ежеквартально по policy команды).
- Результат drill фиксируется:
  - длительность восстановления,
  - корректность данных,
  - достигнут ли `RTO=4h`.

## 15.5 Restore acceptance

Восстановление считается успешным, если:
- база поднята и доступна приложению,
- миграции/схема консистентны,
- базовые smoke-сценарии (auth, booking, reminder enqueue) проходят.

## Queue, Retry, DLQ Operations

## 15.6 Queue policy

- Внешние отправки (`whatsapp/telegram/email`) только через queue.
- Fire-and-forget отправки в HTTP path запрещены.

## 15.7 Retry/DLQ

- Retry с backoff + jitter, лимит 3-5 попыток.
- После лимита задача уходит в DLQ с reason code.
- DLQ разбор выполняется по runbook с фиксацией решения:
  - replay,
  - discard,
  - ручная компенсация.

## 15.8 Queue health SLI

- queue lag,
- oldest message age,
- retry rate,
- DLQ size,
- worker heartbeat.

## Monitoring & Alerting

## 15.9 Monitoring stack (MVP)

- Централизованные логи Railway.
- Метрики приложений/воркеров.
- **Sentry обязателен** как error tracking для `web/api/bot/worker`.

## 15.10 Alert policy

Обязательные алерты MVP:
- API недоступен >5 минут;
- sustained рост 5xx;
- worker heartbeat отсутствует > порога;
- queue lag выше порога;
- массовые webhook signature failures;
- backup job failure;
- резкий рост Sentry critical issues.

## 15.11 Alert routing

- Канал: Telegram и/или email владельцу/оператору.
- Для P1/P2 обязательна эскалация до подтверждения получения.

## Incident Management

## 15.12 Severity model

- `P1`: полная недоступность core booking/auth или потеря данных.
- `P2`: частичная деградация ключевого потока (например reminders/webhooks массово падают).
- `P3`: локальные/обходные деградации без критичного impact.

## 15.13 Incident flow

1. Detection (alert/Sentry/user report).
2. Triage и назначение severity.
3. Mitigation (быстрое восстановление сервиса).
4. Root-cause investigation.
5. Postmortem с action items и владельцами.

## 15.14 Communication

- Для tenant-impacting инцидентов публиковать краткий статус-апдейт в согласованном канале поддержки.
- Внутри команды фиксировать таймлайн событий и решений.

## Runbook

## 15.15 RUNBOOK.md (обязательный)

Минимальные разделы:
- API down,
- DB connection errors,
- webhook failures,
- reminders not sent,
- queue backlog/DLQ growth,
- restore from backup,
- Sentry spike triage,
- secret rotation hotfix.

Для каждого раздела:
- как диагностировать,
- первые 3 действия,
- критерий «инцидент снят».

## Release Safety

## 15.16 Pre-release checklist

- unit/integration tests green,
- staging deploy + smoke green,
- миграции проверены,
- critical alerts и Sentry hooks активны,
- rollback plan подтвержден.

## 15.17 Post-release checklist

- `/api/v1/health` и `/api/v1/ready` в норме,
- booking smoke проходит,
- webhook ingest активен,
- reminder worker heartbeat есть,
- нет всплеска критичных Sentry ошибок.

## 15.18 Rollback policy

- rollback сервисов на предыдущий стабильный deploy;
- DB rollback только при заранее подготовленном безопасном сценарии;
- при необходимости временный mitigation (read-only/degrade mode).

## Data Retention & Housekeeping

## 15.19 Retention policy

- `bookings`: до запроса удаления (GDPR flow),
- `audit_logs`: 365 дней,
- `webhook_events`: 90 дней,
- `notification_delivery`: 90 дней,
- app logs: 30 дней,
- `idempotency_keys`: TTL 24 часа,
- bot state (Redis): TTL 30-60 минут.

## 15.20 Housekeeping jobs

- регулярная очистка истекших технических данных;
- контроль, что cleanup job не нарушает расследуемые инциденты;
- отдельная метрика успеха cleanup.

## Ownership

## 15.21 Ответственность

- Reliability owner (MVP): backend/devops владелец проекта.
- Incident commander: назначается на каждый P1/P2.
- Postmortem owner: закрепляется до закрытия action items.

## Поэтапный план работ (поштучно)

1. Зафиксировать internal SLI и пороги алертов.
2. Настроить обязательный Sentry для всех сервисов.
3. Настроить backup job + мониторинг результата backup.
4. Провести и задокументировать restore drill.
5. Довести queue retry/DLQ runbook до исполнимого состояния.
6. Настроить incident severity и эскалационные правила.
7. Подготовить единый `RUNBOOK.md` по обязательным сценариям.
8. Внедрить pre/post-release checklists в процесс деплоя.
9. Подключить retention/cleanup jobs + мониторинг cleanup.
10. Прогнать reliability game-day на staging.
11. Закрыть DoD и передать baseline в production operation.

## Definition of Ready (DoR)

- Подтверждены `RPO=24h`, `RTO=4h` как целевые ориентиры MVP.
- Подготовлены каналы алертов и ответственные.
- Есть доступ к Sentry/логам/метрикам для всех сервисов.
- Подготовлены backup и queue infrastructure.
- Согласованы шаблоны postmortem и incident log.

## Definition of Done (DoD)

- Backup и restore drill подтверждают достижимость `RPO/RTO` ориентиров.
- SLI/alerts покрывают API, worker, queue, webhook и backup контуры.
- Sentry обязателен и активен для `web/api/bot/worker`.
- Runbook покрывает обязательные аварийные сценарии.
- Queue/DLQ процессы управляемы и проверены на практике.
- Pre/post-release checklists встроены в процесс релиза.
- Reliability baseline принят как production gate.

## Риски и меры

- Риск: деградация обнаруживается слишком поздно.
  - Мера: обязательные алерты + Sentry + heartbeat контроль.
- Риск: backup есть, но restore неработоспособен.
  - Мера: регулярный restore drill с критериями приемки.
- Риск: DLQ накапливается без обработки.
  - Мера: DLQ SOP + алерт по размеру/возрасту задач.
- Риск: релиз вносит silent regression.
  - Мера: обязательные post-release smoke + Sentry watch.
- Риск: отсутствует единая реакция на инциденты.
  - Мера: severity model + runbook + postmortem discipline.
