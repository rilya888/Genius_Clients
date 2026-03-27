# План 53: Отмена записи с обязательной причиной, категорией и быстрыми действиями для клиента

## Цель
Сделать отмену записи со стороны салона прозрачной для клиента:
1. Клиент всегда получает причину отмены.
2. В сообщении сразу доступны 2 быстрых действия:
   - Записаться снова
   - Связаться с администратором
3. Для салона причина отмены структурируется: обязательная категория + текст.

## Бизнес-правила
1. При смене статуса на `cancelled` из админки обязательно передаются:
   - `cancellationReasonCategory`
   - `cancellationReason`
2. Категория обязательна только для отмены салоном (admin flow).
3. Для legacy-отмен без причины в уведомлении клиента использовать fallback: "Reason not specified" / "Motivo non specificato".
4. Комментарии в коде только на английском.

## Категории причин отмены
1. `master_unavailable`
2. `schedule_conflict`
3. `client_request`
4. `other`

## Этап 1. Данные и БД
1. Добавить в `bookings` поле `cancellation_reason_category` (`varchar(64)` / nullable).
2. Обновить Drizzle schema и миграцию.
3. Обновить чтение/запись в repository слое.

## Этап 2. API-контракт
1. Расширить PATCH `/api/admin/bookings/:id`:
   - принять `cancellationReasonCategory`.
2. В `booking-service.updateAdminBookingStatus`:
   - требовать category + reason для `cancelled`.
   - валидировать category по allowlist.
3. В audit meta сохранять category.

## Этап 3. Web Admin UX
1. В `BookingsPage` при отмене:
   - сначала выбор категории (через prompt/select flow текущего UI);
   - затем ввод текстовой причины;
   - обе проверки обязательны.
2. Передавать category + reason в `updateAdminBookingStatus` API helper.
3. Добавить i18n-строки для категорий и валидации.

## Этап 4. Клиентское уведомление WhatsApp
1. Обновить worker-пейлоад `booking_cancelled`:
   - включать причину отмены;
   - формат времени `DD.MM.YYYY HH:mm`.
2. Для WhatsApp отправлять interactive buttons:
   - `intent:new` (Записаться снова)
   - `intent:human` (Связаться с администратором)
3. Для не-WhatsApp каналов оставить текстовый fallback.

## Этап 5. Обработка кнопки "Связаться с администратором"
1. В deterministic WhatsApp flow добавить обработку `intent:human`.
2. Поведение:
   - клиенту: подтверждение, что запрос передан оператору;
   - администратору: уведомление о запросе handoff.
3. Если handoff notifier недоступен — graceful fallback без падения flow.

## Этап 6. Надежность и совместимость
1. Не ломать текущий `intent:new` flow.
2. Сохранить обратную совместимость для старых записей (nullable category).
3. Не трогать Telegram (вне MVP).

## Этап 7. Проверки
1. Unit/contract:
   - отмена без category -> validation error;
   - отмена без reason -> validation error;
   - корректная отмена -> status updated.
2. Integration:
   - enqueue `booking_cancelled` с новой причиной;
   - WhatsApp message содержит причину и 2 кнопки.
3. Manual smoke:
   - отмена из веба;
   - клиент получает причину + кнопки;
   - кнопка "Записаться снова" запускает booking flow;
   - кнопка "Связаться с администратором" инициирует handoff.

## Критерии готовности
1. Нельзя отменить запись салоном без category+reason.
2. Клиент всегда получает причину отмены.
3. В WhatsApp у клиента есть 2 быстрых действия после отмены.
4. Кнопка handoff работает стабильно и не ломает основной booking flow.
