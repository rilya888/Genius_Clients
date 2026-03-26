# WhatsApp Bot Baseline Audit 2026-03-24

## Цель
Зафиксировать фактическое baseline-состояние бота перед реализацией domain-agnostic плана и отделить:
- уже существующие runtime-регрессии;
- локально внесенные baseline-исправления;
- то, что еще нужно проверить после деплоя.

## Найденные проблемы до baseline-правок

### 1. Drift runtime prompt/config
- В коде `OPENAI_PROMPT_VERSION` уже был `2026-03-18.1`.
- В Railway логах бот продолжал работать с:
  - `promptVersion: 2026-03-14.1`
  - `policyVersion: 2026-03-14.a`
  - `fastPathVersion: 2026-03-14.a`
- Причина: effective prompt version берется из `tenantConfig.promptVariant`, а не только из compile-time константы.
- До baseline было трудно понять:
  - бот реально работает по свежему prompt;
  - или runtime tenant config удерживает старую ветку.

### 2. Locale behavior был плохо наблюдаем
- В логах был только `localeReason`.
- Не было видно:
  - marker scores;
  - inference scores;
  - был ли включен session hold для короткого нейтрального ответа.
- Из-за этого было сложно разбирать кейсы вида:
  - пользователь пишет по-английски, а бот отвечает по-итальянски;
  - язык держится сессией, хотя сообщение уже на другом языке.

### 3. AI timeout ошибочно выглядел как domain error
- Ошибка `The operation was aborted due to timeout` классифицировалась как `tool_domain_error`.
- Это смешивало:
  - проблемы orchestration/OpenAI timeout;
  - реальные domain/tool ошибки backend.

### 4. Reset detector ошибочно трактовал `cancel my booking`
- В reset detector `booking_list` проверялся раньше `cancel_booking`.
- Поэтому фраза `cancel my booking` могла детектиться как `booking_list`.
- Это ломало reset/reroute и вело не в ту ветку.

### 5. Non-continuation reset логически выглядел как menu-reset
- Для `non_continuation_message` policy возвращала `hard_reset_to_menu`.
- При этом фактически сообщение reroute-илось дальше.
- Из-за этого логи вводили в заблуждение: казалось, что бот уводит в menu, хотя это был reset + reroute сценарий.

## Внесенные baseline-изменения

### 1. Prompt version diagnostics
Добавлено явное разрешение effective prompt version:
- `requestedPromptVariant`
- `promptResolutionReason`
- `effectiveVersion`

Теперь в логах AI inbound видно:
- что запросил tenant config;
- поддерживается ли variant;
- какая prompt version реально используется.

### 2. Locale diagnostics
`resolveConversationLocale(...)` теперь возвращает:
- `markerScores`
- `inferenceScores`
- `usedSessionHold`

Эти поля добавлены в логи:
- `[bot] whatsapp inbound message`
- `[bot] whatsapp reset policy`
- `[bot][ai] inbound normalize`

Это позволяет точно видеть:
- почему выбран язык;
- был ли это text marker;
- был ли это session hold;
- насколько сильны были сигналы `it/en`.

### 3. AI failure classification
`classifyAiError(...)` теперь различает:
- `openai_transport_error`
- `openai_chain_error`
- `openai_timeout_error`
- `ai_parse_error`
- `tool_domain_error`

Timeout и broken Responses chain больше не маскируются под domain/tool ошибки.

### 4. Local fallback для timeout/chain failures
Для:
- `openai_timeout_error`
- `openai_chain_error`
- `openai_transport_error`

бот теперь сначала пытается сделать локальный intent fallback, а не сразу деградировать в сломанную UX-ветку.

### 5. Reset detector order fixed
Порядок в `detectIntentForReset(...)` исправлен:
- `cancel_booking`, `reschedule_booking`, `new_booking` теперь проверяются раньше `booking_list`.

Локально подтверждено:
- `cancel my booking` -> `cancel_booking`

### 6. Non-continuation semantics clarified
Для `non_continuation_message` reset policy теперь возвращает:
- `decision: hard_reset_to_new_intent`

Это лучше соответствует фактическому поведению:
- старый flow очищается;
- текущее сообщение reroute-ится как новый запрос.

## Локальная проверка после изменений

### Reset policy
Проверка сценариев через `applyConversationResetPolicy(...)`:

1. `choose_service` + `cancel my booking`
- результат:
  - `decision = hard_reset_to_new_intent`
  - `reason = intent_conflict`
  - `detectedIntent = cancel_booking`

2. `choose_service` + `hello there`
- результат:
  - `decision = hard_reset_to_new_intent`
  - `reason = non_continuation_message`
  - `reroute = true`

3. `choose_service` + `Haircut`
- результат:
  - `decision = continue_current_flow`
  - continuation matched semantically

### Locale
Локально подтверждено:

1. `cancel my booking` при `sessionLocale=it`
- результат:
  - `resolvedLocale = en`
  - `localeReason = text_marker_en`

2. `annulla prenotazione` при `sessionLocale=en`
- результат:
  - `resolvedLocale = it`
  - `localeReason = text_marker_it`

3. `ok` при `sessionLocale=it`
- результат:
  - `resolvedLocale = it`
  - `localeReason = session_locale`
  - `usedSessionHold = true`

## Что еще не подтверждено
Эти пункты требуют деплоя и просмотра живых Railway логов:

1. Что в runtime логах теперь видны:
- `requestedPromptVariant`
- `promptResolutionReason`
- `localeMarkerScores`
- `localeInferenceScores`
- `localeUsedSessionHold`

2. Что timeout в бою теперь логируется как:
- `openai_timeout_error`
а не как `tool_domain_error`

3. Что `cancel my booking` и аналогичные фразы реально идут в ветку cancel, а не в booking_list/menu

4. Что old prompt drift действительно объясняется tenant config или старым деплоем, а не другой скрытой веткой исполнения

## Gate перед стартом domain-agnostic
Перед реализацией плана 39 нужно на живых логах подтвердить:

1. Runtime prompt version прозрачна и диагностируема.
2. Locale routing стабильно реагирует на язык текущего сообщения.
3. Timeout/chain failures отделены от domain ошибок.
4. Reset/reroute больше не искажает intent на типовых фразах.

Только после этого можно безопасно накладывать universal terminology / flow config слой.
