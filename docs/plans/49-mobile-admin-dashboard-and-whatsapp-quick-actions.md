# План 49: Mobile-first админ-дашборд + быстрые WhatsApp-действия

## Цель
Сделать удобный рабочий контур для администратора салона на телефоне/планшете:
- полноценное администрирование в web (основной канал),
- быстрые действия и сводки в WhatsApp (вторичный канал),
- сложные сценарии только через web-приложение.

## Принципы
1. Web — источник истины для записей, статусов и финансовых полей.
2. WhatsApp — только короткие действия и запросы (2-3 кнопки).
3. Все сложные операции (детальная правка, перенос по слотам, финансы, история) — через web deeplink.

## Scope MVP
### Включено
- day views: сегодня/завтра;
- карточка записи с действиями: confirm/cancel/reschedule/complete/no_show;
- completion без обязательной суммы (amount optional);
- статус no_show;
- базовые финансовые поля для простой бухгалтерии;
- WhatsApp: today/tomorrow summary + quick actions + deeplink.

### Исключено
- полноценный бухгалтерский модуль (налоги/акты);
- мобильное нативное приложение;
- Telegram как основной админ-канал.

## Этап A: Данные и API (backend foundation)
1. Расширить модель booking:
   - статус `no_show`;
   - `completed_at`;
   - `completed_amount_minor` (nullable);
   - `completed_currency` (nullable);
   - `completed_payment_method` (nullable);
   - `completed_payment_note` (nullable);
   - `completed_by_user_id` (nullable FK на users).
2. Формализовать state-machine переходов:
   - `pending -> confirmed|cancelled|rejected`;
   - `confirmed -> completed|cancelled|no_show`;
   - `no_show -> []`;
   - `completed -> []`;
   - `cancelled -> []`;
   - `rejected -> []`.
3. Добавить API-валидации:
   - `completed` допустим без суммы;
   - если сумма указана, то > 0;
   - при `no_show` сбрасывать completion-поля.
4. Логировать все переходы в audit с from/to и payload.

## Этап B: Mobile-first dashboard UX
1. Dashboard блоки: `Today`, `Tomorrow`, `Attention`.
2. Карточки записей с touch-friendly действиями.
3. Booking detail: confirm/cancel/reschedule/complete/no_show.
4. Для `complete`:
   - сумма optional,
   - способ оплаты optional,
   - заметка optional.
5. Адаптивность:
   - mobile: 1 колонка,
   - tablet: split list/detail,
   - большие touch targets.

## Этап C: WhatsApp quick actions
1. Push о новой записи: `Confirm`, `Reject`, `Open in Web`.
2. Команды администратора:
   - `today` -> список записей на сегодня,
   - `tomorrow` -> список записей на завтра,
   - `next` -> ближайшие 3.
3. Ответы короткие, лимитированные, без сложных форм.
4. В каждом сообщении deeplink в web.

## Этап D: Устойчивость и наблюдаемость
1. Idempotency и защита от гонок статусов.
2. Метрики:
   - confirmation latency,
   - completed count,
   - no_show count,
   - completed revenue sum.
3. UAT сценарии (10-15 критических бизнес-потоков).

## Критерии готовности
1. Админ с телефона управляет записями сегодня/завтра без десктопа.
2. `i) complete` работает с optional amount.
3. `ii) no_show` доступен и корректно отражается в списках/фильтрах.
4. WhatsApp отдает только быстрые действия и сводки, без тупиковых flow.
5. Все переходы статусов валидируются сервером и логируются.

## Статус реализации (2026-03-26)
- Этап A: выполнен
  - Добавлен статус `no_show`, completion-поля и серверная валидация/transition-map.
  - Добавлены API-поля для `completedAmountMinor/completedCurrency/completedPayment*`.
- Этап B: выполнен
  - На Dashboard добавлены блоки `Today/Tomorrow` с быстрым подтверждением pending.
  - На странице Bookings добавлены действия `confirm/cancel/reject/complete/no_show`.
- Этап C: выполнен (код)
  - Добавлен internal endpoint `POST /api/v1/public/admin/bookings-digest`.
  - В bot добавлены команды admin: `today/tomorrow/next` (+ `/today` `/tomorrow` `/next`).
  - В ответе bot отправляет список записей + быстрые кнопки.
  - Для ближайшей pending-записи добавлены CTA `Confirm/Reject` прямо из сводки.
  - Для `booking_created_admin` добавлена кнопка `Open web` и deeplink в тексте уведомления.
- Этап D: выполнен по коду
  - Добавлены KPI: `no_show today`, `completed revenue today`.
  - Добавлены runtime-метрики bot для admin-digest (`handled/errors`) и alert на fetch-failure.
  - Подготовлен UAT-чеклист: `49.1-mobile-admin-whatsapp-uat-checklist.md`.
  - Добавлен smoke-runbook: `../operations/admin-digest-smoke-runbook.md`.
  - Осталось: только финальный live-UAT прогон в прод-контуре.

## Риски и контроль
1. Риск перегрузки WhatsApp логикой:
   - контроль: строго quick-actions + deeplink.
2. Риск конфликтов статуса при параллельной работе:
   - контроль: optimistic concurrency + 409 + refresh UX.
3. Риск несогласованных day boundaries:
   - контроль: вычисления today/tomorrow по timezone tenant.
