# План 48: Стабилизация распознавания переноса записи и исправление fallback списка бронирований

## Цель
Сделать так, чтобы фразы пользователя про перенос записи (например, `i want to change my booking`) стабильно приводили к сценарию выбора бронирования для переноса, а не к тупиковому текстовому списку без интерактива.

## Проблема
- Текущий fast-path/intent normalizer может классифицировать запрос переноса как `booking_list`.
- Ветка `booking_list` в AI-оркестраторе отдает plain-text список и подсказку только про отмену (`type: cancel booking`), без возможности выбрать запись.
- В результате пользователь не может завершить сценарий переноса из этого ответа.

## Изменения

### 1) Исправить приоритет интентов для переноса
1. Добавить явный приоритет `reschedule_booking` для сигналов `change/move/reschedule/postpone` (и итальянских эквивалентов).
2. Не позволять слабому `booking_list` перезаписывать уверенный `reschedule_booking`.
3. Добавить reason-код в логах при override (`intent_override_reason`) для диагностики.

### 2) Канонизация лексики и опечаток
1. Нормализовать частые варианты: `change booking`, `move booking`, `reschedule appointment`, `sposta prenotazione`, `cambia prenotazione`.
2. Обработать частые короткие формы и мелкие опечатки через normalization-search слой.

### 3) Привести `booking_list` fallback к рабочему UX
1. Убрать тупиковый plain-text в ответе `booking_list`.
2. Для активных бронирований отдавать интерактивный artifact (`kind: booking_list`) с CTA выбора записи.
3. Для отсутствия бронирований отдавать quick actions.

### 4) Синхронизация AI/non-AI поведения
1. Проверить согласованность decision path для fast-path и AI parser fallback.
2. Если fast-path уверенно дает `reschedule_booking`, AI fallback не должен понижать intent до `booking_list` без веской причины.

### 5) Тесты
1. Юнит-тесты intent normalization:
   - `i want to change my booking` -> `reschedule_booking`
   - `can I move my appointment` -> `reschedule_booking`
   - `show my bookings` -> `booking_list`
2. Интеграционный тест artifact-ответа:
   - `booking_list` при активных бронированиях возвращает интерактивный выбор, а не plain text.

### 6) Валидация
1. Прогон unit/typecheck.
2. Ручной smoke в WhatsApp: запрос переноса -> выбор конкретной записи.
3. Проверка логов: intent source, override reason, artifact kind.

## Критерий готовности
- Фраза `i want to change my booking` стабильно запускает перенос (выбор записи для reschedule).
- Больше нет ответа вида plain-text списка без интерактивного выбора.
- Тесты и проверка логов подтверждают отсутствие регрессий по `booking_list`.
