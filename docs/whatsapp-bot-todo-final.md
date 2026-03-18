# WhatsApp Bot — Актуальный TODO (после последнего цикла фиксов)

Дата обновления: 2026-03-16  
Проект: `genius_clients` / `apps/bot`  
Назначение: **только актуальные доработки** для текущего состояния кода и деплоя.

---

## 1. Что уже стабилизировано (не в TODO)

- Гибридный pipeline `reset policy -> AI/NLU -> deterministic FSM` работает в проде.
- `book/cancel/reschedule/booking_list` покрыты fast-path + fallback.
- В booking flow добавлен шаг `collect_client_name` перед подтверждением.
- Работают CTA-токены для confirm/cancel/admin actions.
- Есть adaptive UI для выбора записи:
  - 0 записей -> quick actions,
  - 1-2 -> buttons,
  - 3+ -> list.
- Реализован базовый anti-stale reset policy + idle timeout (`SESSION_IDLE_RESET_MINUTES`).
- Реализован entity carry-over для master/date/time при сценариях с неполным первым запросом.
- Подключены runtime counters и structured logs.

---

## 2. Актуальные пробелы (сейчас)

### Критичные (делать первыми)

### A1. Slot conflict на confirm (race condition)
**Проблема:** между показом слота и подтверждением слот может стать занятым.  
**Нужно:** явная обработка backend-конфликта (`409` / `SLOT_CONFLICT`) с пользовательским сценарием, без технических ошибок.

Ожидаемое поведение:
1. При конфликте не ронять flow.
2. Показать сообщение: слот занят.
3. Сразу предложить альтернативные слоты на той же дате.
4. Если слотов на дате нет — предложить альтернативные даты.

Файлы:
- `apps/bot/src/whatsapp-conversation.ts`
- при необходимости `apps/bot/src/index.ts` (маппинг ошибок)

---

### A2. PII-safe logging (GDPR-практика)
**Проблема:** маскирование частично есть, но не гарантировано для всех событий и полей.  
**Нужно:** единая политика логирования для phone/name/free-text summary.

Требования:
- `phone/from` только в masked виде.
- `clientName` не логировать в открытом виде.
- `handoff_summary` логировать в сокращенном/обезличенном виде.
- Ввести единый helper для безопасных лог-полей и использовать его в bot логах.

Файлы:
- `apps/bot/src/index.ts`
- `apps/bot/src/ai-orchestrator.ts`

---

### A3. Soft reset вместо жесткого сброса в части конфликтов
**Проблема:** при части intent-конфликтов бот теряет слишком много контекста.  
**Нужно:** частичный reset (preserve context), чтобы пользователь мог менять параметр без полного перезапуска.

Минимальный scope:
- Если пользователь на `choose_slot` просит "другой мастер" -> вернуться в `choose_master`, сохранив `serviceId`.
- Если просит "другая дата" -> вернуться в `choose_date`, сохранив `serviceId/masterId`.
- Если просит "другое время" на `confirm` -> `choose_slot` без потери даты.

Файлы:
- `apps/bot/src/conversation-reset-policy.ts`
- `apps/bot/src/whatsapp-conversation.ts`

---

### Важные (второй приоритет)

### B1. Retry для внутренних API вызовов
**Проблема:** кратковременные сбои API могут приводить к плохому UX.  
**Нужно:** ограниченный retry (например 2 попытки с backoff) для безопасных запросов (`fetch services/masters/slots/bookings`) + дружелюбный fallback-текст.

Файлы:
- `apps/bot/src/index.ts`
- `apps/bot/src/ai-orchestrator.ts`
- `apps/bot/src/whatsapp-conversation.ts`

---

### B2. UX-поведение для `reply_text` в нестандартных ситуациях
**Проблема:** часть ответов остается шаблонно-механической.  
**Нужно:** использовать `reply_text` как override там, где нужен человеческий ответ (ambiguous, emotional, unexpected mid-flow), но без разрушения FSM шага.

Файлы:
- `apps/bot/src/openai-prompts.ts`
- `apps/bot/src/ai-orchestrator.ts`

---

### B3. Стабилизация locale в edge-cases
**Проблема:** основные кейсы работают, но есть редкие переключения в смешанных диалогах.  
**Нужно:** дофиксировать язык на активный flow при нейтральных коротких ответах, менять только при явном языковом сигнале.

Файлы:
- `apps/bot/src/conversation-locale.ts`
- `apps/bot/src/index.ts`

---

### B4. Негатив/жалоба -> empathetic ответ + handoff policy
**Проблема:** жалобы иногда распознаются как обычный unknown path.  
**Нужно:** обязательный empathetic ответ и predictably routed handoff, если `humanHandoffEnabled`.

Файлы:
- `apps/bot/src/ai-orchestrator.ts`
- `apps/bot/src/index.ts`

---

### Полезные улучшения (после стабилизации)

### C1. Prompt variant per tenant
Переключать вариант промта через tenant config, без общего деплоя.

### C2. Фильтрация booking list по дате в cancel/reschedule
Если пользователь указал дату в тексте, поднимать релевантные записи вверх.

### C3. Политика поздней отмены (tenant policy)
`lateCancelWarnHours` / `lateCancelBlockHours`.

### C4. Доп. языки (`ru`, `uk`)
После стабилизации EN/IT.

---

## 3. Обновленный порядок внедрения

## Итерация 1 (критический hardening)
1. A1 Slot conflict handling.  
2. A2 PII-safe logging.  
3. B1 Retry policy для внутренних API.

**Результат итерации:** бот не ломается на конкурентных бронях и временных сбоях, лог-практика безопаснее.

## Итерация 2 (диалоговая устойчивость)
1. A3 Soft reset preserve-context.  
2. B3 Locale stabilization в edge-cases.  
3. B4 Complaint/handoff policy.

**Результат итерации:** меньше "обнулений" флоу, более предсказуемые диалоги, лучшее поведение в конфликтных запросах.

## Итерация 3 (качество общения и масштабируемость)
1. B2 `reply_text` override strategy.  
2. C1 Prompt variant per tenant.  
3. C2/C3 (дата-фильтр и late cancel policy).

**Результат итерации:** более человечный UX и готовность к per-tenant эволюции.

---

## 4. Актуальный UAT-чеклист

### Блок 1: booking robustness
- [ ] `book me with Anna tomorrow` -> service -> без повторного запроса даты.
- [ ] При конфликте слота на confirm -> альтернативные слоты/даты, без 500-текста. *(manual test deferred: сейчас подключен только 1 телефон к боту)*.
- [ ] На `confirm` фраза "change time" -> переход в `choose_slot` с сохранением контекста.

### Блок 2: cancel/reschedule robustness
- [ ] Отмена при 1 активной записи -> buttons, не list.
- [ ] Отмена при 3+ записях -> list.
- [ ] Confirm cancel через CTA работает идемпотентно.

### Блок 3: language and tone
- [ ] EN запросы стабильно EN ответы.
- [ ] IT запросы стабильно IT ответы.
- [ ] Нейтральные ответы (`ok`, `yes`, `domani`) не переключают язык без сигнала.

### Блок 4: reliability and observability
- [ ] При кратковременной недоступности API бот дает дружелюбный retry/fallback.
- [ ] Логи не содержат raw phone/client name.
- [ ] В логах видны `traceId`, intent, reset reason, fallback reason.

---

## 5. Definition of Done для этой дорожной карты

Считаем этап закрытым, когда:
1. Все пункты A1-A3 реализованы и покрыты smoke/UAT.
2. Критические regressions отсутствуют минимум в 2 последовательных днях ручного теста.
3. PII-safe logging подтвержден выборочной проверкой логов.
4. Для конфликтов слота и intent-change сценариев есть воспроизводимые тест-кейсы и ожидаемые ответы.

---

Статус: документ синхронизирован с текущим состоянием после последних фиксов и деплоя.  
При следующем изменении логики reset/locale/booking-confirm файл нужно обновлять в этой же папке.
