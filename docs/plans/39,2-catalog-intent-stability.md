# 39,2 — Стабилизация распознавания catalog-intent в WhatsApp-боте

## Цель
Сделать так, чтобы запросы каталога услуг (например, `quali servizi avete?`) стабильно распознавались как `catalog`, без ложного ухода в `unknown`, и без регрессии по `new_booking / cancel_booking / reschedule_booking`.

## Контекст проблемы
По результатам чистого прогона на `alex-salon`:
- `annulla prenotazione` и `sposta prenotazione` распознаются корректно.
- `prenota cambio olio domani alle 10` распознается как `new_booking`.
- `quali servizi avete?` в части прогонов уходит в `unknown` вместо `catalog`.

## Принципы решения
1. Один источник истины для распознавания каталога во всех ветках (fast-path, transport fallback, post-AI heuristics).
2. Четкий приоритет intents, чтобы `catalog` не ломал action-intents.
3. Устойчивость к шуму: пунктуация, вариации формулировок, смешанные фразы.
4. Минимальный риск регрессий через обязательный regression-набор.

## Область изменений
- `apps/bot/src/ai-orchestrator.ts`
- (опционально, если потребуется по результатам) `apps/bot/src/conversation-reset-policy.ts`
- тестовые/смоук сценарии для проверки intent-priority

## Этапы реализации

### 1) Единый детектор catalog-intent
- Добавить функцию `hasCatalogSignal(normalizedText)` с расширенным набором IT/EN паттернов:
  - IT: `quali servizi avete`, `che servizi avete`, `servizi`, `elenco servizi`, `lista servizi`, `catalogo`, `mostra servizi`, `fammi vedere i servizi`.
  - EN: `what services do you have`, `show services`, `service list`, `catalog`.
- Сделать детектор tolerant к пунктуации/лишним пробелам.

### 2) Унификация в трех ветках распознавания
- Использовать `hasCatalogSignal` в:
  - `detectFastPathIntent`
  - `detectTransportFallbackIntent`
  - `normalizeParsedIntentWithHeuristics`
- Убрать расхождения между strict-regex и fallback-логикой.

### 3) Intent-priority без регрессии
- Приоритет:
  1. `cancel` / `reschedule`
  2. `new_booking` (если есть booking-глаголы и/или дата/время)
  3. `catalog`
  4. `unknown`
- Для mixed-фраз (`quali servizi e prezzi`) не допускать падение в `unknown`.
- Не позволять `catalog` перехватывать явный booking/action flow.

### 4) Стабильность в session-state
- Проверить поведение `catalog` запроса в разных состояниях FSM:
  - `choose_intent`
  - `choose_service`
  - `choose_master`
- Если пользователь спрашивает каталог в середине другого flow, бот должен отвечать предсказуемо (каталог + корректный переход).

### 5) Regression-набор
- Добавить обязательный набор фраз для проверок перед деплоем:
  - IT catalog: `quali servizi avete?`, `elenco servizi`, `mostra servizi`
  - EN catalog: `what services do you have`, `service list`
  - Booking: `prenota cambio olio domani alle 10`
  - Cancel: `annulla prenotazione`
  - Reschedule: `sposta prenotazione`
- Критерий: catalog-фразы никогда не дают `unknown`.

### 6) Observability
- Добавить/уточнить логирование причины выбора intent (имя match-правила).
- Метрики:
  - `catalog_detected_count`
  - `unknown_after_catalog_phrase_count`
- Подготовить алерт на аномальный рост `unknown_after_catalog_phrase_count`.

## Критерии готовности
1. `quali servizi avete?` стабильно классифицируется как `catalog`.
2. `new_booking / cancel_booking / reschedule_booking` не деградировали.
3. В regression-наборе нет кейсов с `catalog -> unknown`.
4. Результат подтвержден в живом WhatsApp-чате на `alex-salon`.

## Риски
- Ложное расширение `catalog`-паттернов может зацепить booking-фразы.
- Перегиб по приоритетам может ухудшить `price_info`/`unknown` сценарии.

## Митигация
- Строгие приоритеты intent-логики.
- Набор негативных кейсов в regression-pack.
- Проверка на реальном чате до/после деплоя.

