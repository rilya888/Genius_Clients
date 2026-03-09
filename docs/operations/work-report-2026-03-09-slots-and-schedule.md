# Work Report - 2026-03-09 (Slots & Schedule Fixes)

## Summary
В этой итерации были исправлены ключевые проблемы логики расписания и отображения слотов на публичной странице бронирования:
- унифицированы и улучшены поля расписания в админке;
- исправлен шаг слотов (привязка к длительности услуги);
- исправлена логика границ временных окон (включительно);
- исправлен timezone-баг, из-за которого слот `09:00` отображался как `10:00`;
- выполнены повторные деплои и проверки статусов Railway.

## What was changed

### 1) Admin schedule UX improvements
- `Working Hours`:
  - день недели переведен на выпадающий список (`Monday..Sunday`);
  - время старта/окончания переведено на выпадающие списки `HH:MM`.
- `Schedule Exceptions`:
  - `start/end` переведены на `HH:MM` (`Not set` для пустого значения);
  - при `Closed day` выбор времени отключается.
- Добавлен общий helper опций расписания:
  - `apps/web/lib/schedule-options.ts`.

### 2) Slot step aligned with service duration
- В API удален фиксированный шаг `15` минут.
- Шаг слота теперь рассчитывается от длительности выбранной услуги (или override мастера):
  - `slotStepMinutes = master.durationMinutesOverride ?? service.durationMinutes`.

### 3) Inclusive boundary logic + buffer semantics
- Реализована корректная модель интервалов:
  - слот валиден при `start + duration <= windowEnd`;
  - буфер (`bookingBufferMinutes`) трактуется как зазор между записями,
    а не как часть длительности отображаемой услуги.

### 4) Tenant-local day calculation (timezone fix)
- Исправлен расчет начала дня в `SlotService`:
  - расчеты теперь делаются от локальной полуночи таймзоны tenant.
- Исправлен root-cause, из-за которого локальный `09:00` смещался в `10:00`:
  - в `getTimezoneOffsetMs` formatter теперь создается с `timeZone: tenant.timezone`.

### 5) Min advance defaults
- Изменены дефолты `booking_min_advance_minutes` с `60` на `0`:
  - schema default;
  - init migration default;
  - UI default в tenant settings.
- Добавлена миграция:
  - `packages/db/migrations/0003_booking_min_advance_default_zero.sql`.

## Debugging and diagnostics
Для точного поиска причины проблемы со слотом `09:00` были добавлены временные диагностические механизмы:
- `debug=1` для `/api/public/slots` (в BFF запросах public booking);
- серверные `slot-debug-json` логи;
- пер-кандидатная трассировка решений (`accepted/rejected`, reason).

По логам подтверждено:
- `Min Advance = 0`;
- недоступность `09:00` была вызвана timezone-offset багом в серверном расчете.

## Backup
Создан backup репозитория в формате `git bundle`:
- `backups/genius_clients-20260309-100434.bundle`

Восстановление:
```bash
git clone backups/genius_clients-20260309-100434.bundle restored_repo
cd restored_repo
git checkout main
```

## Verification
В ходе итерации многократно выполнены:
- `pnpm --filter @genius/web typecheck`
- `pnpm --filter @genius/web build`
- `pnpm --filter @genius/api typecheck`
- `pnpm --filter @genius/api build`
- деплой и ожидание статуса `SUCCESS` для `web/api/bot/worker`.

## Result
Логика слотов приведена к корректному поведению относительно:
- длительности услуги;
- включительных границ рабочего окна;
- локальной таймзоны tenant;
- буфера между записями.

Это закрывает обнаруженный баг со смещением первого утреннего слота.
