# WhatsApp Bot Baseline GitHub Verification

## Цель
Проверить baseline-стабилизацию бота после деплоя, который пришел из GitHub, а не из локального CLI.

## Предусловия
1. Bot-сервис задеплоен из актуального GitHub commit.
2. В Railway logs уже виден новый старт сервиса.
3. Проверка идет на production bot service.

## Локальный smoke перед GitHub-пушем
Запускать из корня проекта:

```bash
pnpm --filter @genius/bot exec tsx ../../scripts/smoke/whatsapp-bot-baseline-smoke.ts
```

Ожидаемо:
- `failedCount = 0`

## Сообщения для живой проверки

### 1. Проверка переключения языка на английский
Отправить:

```text
cancel my booking
```

Ожидаемо:
- бот отвечает по-английски;
- бот не уходит в generic menu;
- ветка идет в cancel flow или в понятное сообщение про отсутствие бронирований.

В логах должно быть:
- `locale = en`
- `localeReason = text_marker_en`
- `localeMarkerScores.en > localeMarkerScores.it`

### 2. Проверка переключения языка на итальянский
Отправить:

```text
annulla prenotazione
```

Ожидаемо:
- бот отвечает по-итальянски;
- бот не удерживает английский язык из старой сессии;
- ветка идет в cancel flow или в понятное сообщение про отсутствие бронирований.

В логах должно быть:
- `locale = it`
- `localeReason = text_marker_it`

### 3. Проверка neutral follow-up
После активного итальянского flow отправить:

```text
ok
```

Ожидаемо:
- язык остается итальянским;
- в логах:
  - `localeReason = session_locale`
  - `localeUsedSessionHold = true`

### 4. Проверка non-continuation reset
Дойти до `choose_service`, затем отправить:

```text
hello there
```

Ожидаемо:
- старый flow очищается;
- текущее сообщение reroute-ится как новый запрос;
- бот не застревает в старом выборе услуги.

В логах должно быть:
- `resetReason = non_continuation_message`
- `resetDecision = hard_reset_to_new_intent`
- `rerouteAfterReset = true`

### 5. Проверка intent conflict
Дойти до `choose_service`, затем отправить:

```text
cancel my booking
```

Ожидаемо:
- не `booking_list`;
- именно cancel intent;
- старый booking flow не тащит выбор услуги дальше.

В логах должно быть:
- `detectedIntent = cancel_booking`
- `resetReason = intent_conflict`

### 6. Проверка runtime prompt drift
Отправить любое обычное booking-сообщение:

```text
book tomorrow
```

В логах AI inbound должно появиться:
- `promptVersion`
- `requestedPromptVariant`
- `promptResolutionReason`

Это нужно, чтобы понять:
- runtime действительно работает по текущему prompt;
- или tenant config продолжает держать старую prompt ветку.

### 7. Проверка timeout classification
Если в логах снова возникнет AI failure, проверить поля:
- `errorClass`
- `errorCode`

Ожидаемо:
- timeout не должен больше логироваться как `tool_domain_error`;
- ожидаемые варианты:
  - `openai_timeout_error`
  - `openai_chain_error`
  - `openai_transport_error`

## Обязательные поля, которые должны появиться в логах

### Inbound / reset logs
- `localeMarkerScores`
- `localeInferenceScores`
- `localeUsedSessionHold`
- `resetDecision`
- `resetReason`
- `rerouteAfterReset`

### AI inbound logs
- `promptVersion`
- `requestedPromptVariant`
- `promptResolutionReason`
- `policyVersion`
- `fastPathVersion`

### AI failure logs
- `errorClass`
- `errorCode`

## Критерии, что baseline готов
Baseline можно считать закрытым, если после GitHub-деплоя подтверждено:

1. Английский и итальянский reliably переключаются по тексту пользователя.
2. Neutral follow-up удерживает язык активной сессии.
3. `cancel my booking` идет в `cancel_booking`, а не в `booking_list`.
4. `non_continuation_message` больше не выглядит как ложный menu reset.
5. Runtime prompt/config drift полностью прозрачен по логам.
6. AI timeout и chain failures больше не замаскированы под domain errors.

Только после этого можно безопасно начинать реализацию domain-agnostic плана 39.
