# Этап 10: Telegram Integration

## Цель этапа

Подключить production-канал Telegram к существующему Bot Core (этап 08) и Backend API (этап 04) так, чтобы:

- входящие сообщения и callback-события надежно попадали в диалоговый движок,
- ответы бота отправлялись стабильно с учетом лимитов Telegram,
- мультитенантность сохранялась строго (tenant isolation),
- канал был готов к использованию в notifications и дальнейшему масштабированию.

## Границы MVP

**Входит в этап 10:**
- webhook-based интеграция Telegram Bot API (production путь);
- inbound обработка `message` и `callback_query`;
- двусторонний текстовый диалог + inline кнопки;
- deep-link onboarding (`/start`) для tenant binding;
- идемпотентная обработка `update_id`;
- базовый outbound retry/rate-limit контур;
- минимальная поддержка media как fallback-сценарий.

**Не входит в этап 10:**
- long polling в production (допускается только dev fallback);
- сложные media-сценарии с анализом файлов;
- собственный конструктор Telegram UX в админке (wizard flows и т.п.).

## Архитектурное место в системе

- Channel Adapter `telegram` подключается к Bot Orchestrator из этапа 08.
- Tenant определяется на backend через deep-link binding и/или сохраненный mapping чата.
- Все бизнес-действия (слоты/бронь/отмена) выполняются через внутренние tools → `/api/v1`.
- События канала пишутся в единый telemetry/audit контур (совместимо с WA, этап 09).

## Предварительные зависимости

- Этап 04: `/api/v1`, error model, idempotency policy, rate-limit.
- Этап 08: state machine, guardrails, handoff, tool-calling.
- Этап 11: notifications использует Telegram как транспорт.
- Доступ к `@BotFather`, `BOT_TOKEN`, публичный HTTPS webhook URL.

## Модель мультитенантности

## 10.1 Принцип tenant binding

MVP-решение:
- один Telegram bot token на продукт;
- tenant выбирается через deep-link параметр в `/start`;
- после успешного старта создается постоянный mapping `telegram_chat_id -> tenant_id`.

Правила:
- один `chat_id` в активной сессии привязан к одному tenant;
- принудительная смена tenant только через явный rebind flow (контролируемый);
- deny-by-default для сообщений из чата без валидного tenant binding.

## 10.2 Сущность TenantTelegramBinding

Минимальные поля:
- `tenant_id`
- `telegram_chat_id`
- `telegram_user_id`
- `bind_source` (`deep_link`, `admin_invite`)
- `is_active`
- `created_at`, `updated_at`, `last_seen_at`

Индексы/ограничения:
- unique (`telegram_chat_id`) для исключения двойного активного binding;
- индекс (`tenant_id`, `last_seen_at`) для ops-аналитики.

## Webhook и транспорт

## 10.3 Production webhook

`POST /api/v1/webhooks/telegram`

Требования:
- использовать `setWebhook` (не long polling в production);
- webhook только по HTTPS;
- валидация секрета через `X-Telegram-Bot-Api-Secret-Token`;
- ACK-first модель: быстро вернуть `2xx`, тяжелую обработку выполнять асинхронно.

## 10.4 Dev fallback: long polling

- допустим только для локальной разработки;
- не используется в staging/prod;
- включается feature flag'ом, чтобы исключить конкуренцию с webhook.

## 10.5 Идемпотентность входящих update

- dedupe по `update_id`;
- повторный update не должен приводить к повторному side-effect действию;
- хранить факт duplicate delivery для диагностики нестабильности канала.

## Inbound обработка

## 10.6 Поддерживаемые типы update

В MVP обрабатываются:
- `message` (текст, команды, базовый media fallback);
- `callback_query` (inline кнопки);
- `edited_message` (как правило — игнор с логом, без side effects).

Игнорируемые события:
- неизвестные/неподдерживаемые update types — безопасно логировать и завершать.

## 10.7 Нормализация входящего payload

Извлечь и нормализовать:
- `channel_user_id` = `telegram_user_id`;
- `chat_id`;
- `tenant_id` через binding;
- `message_id`;
- `update_id`;
- `message_type` (text/callback/media/command);
- `text` или `callback_data`;
- `timestamp`.

Если tenant не определен:
- не передавать запрос в Bot Core;
- отправить инструкцию перепривязки (`/start <tenant_key>`);
- зафиксировать ops-событие `tenant_not_bound`.

## 10.8 Команды и deep-link

Поддержка в MVP:
- `/start`:
  - без параметра: нейтральная инструкция, как получить tenant-link;
  - с параметром: попытка привязки tenant;
- `/help`: краткая справка по доступным действиям;
- `/cancel`: сброс текущего шага диалога (без отмены booking).

Deep-link формат:
- `https://t.me/<bot_username>?start=<tenant_bind_token>`
- bind token должен быть подписанным/временным (не простой tenant_id в открытом виде).

## 10.9 Callback data контракт

- лимит Telegram: до 64 байт;
- использовать компактный versioned payload, например `v1:act:slot:<id>`;
- не передавать PII в `callback_data`;
- любые callback payload проходить серверную валидацию.

## 10.10 Media fallback

MVP:
- принимать media updates (photo/document/voice/video);
- не выполнять media understanding;
- отвечать формальным fallback-текстом и предложением продолжить в текстовом формате;
- логировать метрику media usage.

## Outbound обработка

## 10.11 Telegram send adapter

Базовые методы MVP:
- `sendMessage`
- `editMessageReplyMarkup` (для обновления inline-кнопок при необходимости)
- `answerCallbackQuery` (обязательный ACK callback-кнопок)

Требования:
- централизованный sender с retry/backoff для transient ошибок;
- outbound rate-limit per bot/per tenant;
- идемпотентность на уровне приложения для повторных попыток отправки.

## 10.12 Ограничения Telegram API

Учитывать:
- rate limits Bot API;
- ограничение длины сообщений;
- возможные ошибки `429`, `400` (invalid payload), `403` (bot blocked by user).

Policy:
- `429`: retry с учетом `retry_after`;
- `403 blocked`: помечать канал пользователя как недоступный для proactive уведомлений;
- `400`: non-retry, фиксировать как validation/contract issue.

## 10.13 Delivery semantics

Важно:
- Telegram не дает полноценную delivered/read модель как WhatsApp;
- для этапа 11 считать технический успех как успешный ответ API `ok=true`;
- для `403 blocked` помечать уведомление как недоставляемое и запускать fallback policy (если есть).

## Безопасность

## 10.14 Секреты и токены

- `BOT_TOKEN` хранится только в secret manager;
- `telegram webhook secret token` обязателен для prod;
- токены не пишутся в логи и не возвращаются в API;
- регламент ротации token без простоя.

## 10.15 Anti-abuse

- inbound rate-limit per `chat_id` и per tenant;
- контроль размера входящего payload;
- sanitize пользовательского текста перед отправкой в Bot Core/LLM;
- жесткое правило tenant isolation для любого tool-call.

## Наблюдаемость и эксплуатация

## 10.16 Метрики

Обязательные метрики:
- webhook receive rate;
- duplicate update rate;
- inbound-to-bot latency p95/p99;
- outbound success/fail rate;
- callback ack latency;
- `403 blocked` rate;
- bind success/fail rate по deep-link.

## 10.17 Логи и трассировка

- correlation id: `update_id -> bot turn -> outbound message`;
- структурированные логи без утечки PII;
- отдельные события: `tenant_not_bound`, `invalid_callback_payload`, `bot_blocked`.

## 10.18 Алертинг

MVP-алерты:
- рост webhook non-2xx;
- всплеск `429`/`403` от Telegram API;
- рост ошибок tenant binding;
- backlog outbound queue выше порога.

## Тестовая стратегия

## 10.19 Unit

- parser update payload (`message`, `callback_query`);
- deep-link token validation;
- callback payload decoder/validator;
- dedupe logic по `update_id`.

## 10.20 Integration

- end-to-end: inbound text -> bot -> outbound reply;
- end-to-end: inline button -> callback -> bot action -> reply;
- negative: invalid secret token, duplicate update, unknown tenant, blocked bot.

## 10.21 UAT

- sandbox/prod-like бот в Telegram;
- smoke-проверка сценариев записи, отмены шага, выбора слота кнопками;
- проверка локалей `it/en` и формального тона;
- проверка handoff после серии неуспешных попыток (контракт этапа 08).

## Поэтапный план работ (поштучно)

1. Зафиксировать data contract для `TenantTelegramBinding` и update event store.
2. Поднять production webhook endpoint с проверкой secret token.
3. Добавить dedupe/idempotency по `update_id`.
4. Реализовать inbound normalizer (`message`/`callback_query`).
5. Реализовать deep-link binding flow (`/start <token>`) с безопасным token validation.
6. Подключить Telegram adapter к Bot Orchestrator (text path).
7. Добавить inline keyboard + callback processing.
8. Добавить media fallback path.
9. Реализовать outbound sender с retry/backoff/rate-limit.
10. Добавить обработку `429/403/400` и политику технического outcome.
11. Подключить метрики, алерты и runbook инцидентов.
12. Провести UAT smoke и закрыть DoD.

## Definition of Ready (DoR)

- Получен `BOT_TOKEN` и username бота.
- Доступен production HTTPS webhook URL.
- Определена политика tenant binding и формат signed bind token.
- Согласованы UX-тексты `/start`, `/help`, fallback-сообщений.
- Подтверждены SLO/метрики для эксплуатации канала.

## Definition of Done (DoD)

- Telegram webhook стабилен и безопасен (secret token validation + idempotency).
- Поддерживаются text и callback сценарии с inline-кнопками.
- Deep-link binding надежно привязывает chat к tenant.
- Media events обрабатываются через контролируемый fallback.
- Outbound sender корректно работает под rate limits и retry policy.
- Логи/метрики/алерты позволяют сопровождать канал в production.
- Интеграция совместима с этапом 08 (bot core) и этапом 11 (notifications).

## Риски и меры

- Риск: пользователь блокирует бота (`403`) и не получает уведомления.
  - Мера: пометка канала как недоступного + fallback канал при наличии.
- Риск: неверный tenant binding через устаревший deep-link.
  - Мера: короткоживущий signed token + rebind policy.
- Риск: дубликаты update при сетевых сбоях.
  - Мера: strict dedupe по `update_id` + idempotent side effects.
- Риск: превышение rate limits Telegram API.
  - Мера: централизованный throttle + retry_after-aware backoff.
