# План 52: Унификация даты/времени (формат ДД.ММ.ГГГГ и актуальное время)

## Цель
Привести весь проект к единому формату отображения даты и времени:
- Дата: `ДД.ММ.ГГГГ`
- Дата+время: `ДД.ММ.ГГГГ HH:mm`
- Время: `HH:mm`

И устранить расхождения времени между web/admin/public/bot/worker за счёт строгого использования `tenant.timezone`.

## Обязательные правила
1. Никаких прямых `toLocaleString()/toLocaleDateString()/toLocaleTimeString()` в UI.
2. Все бизнес-времена (booking, activity, reminders, approvals, revenue) показываются в `tenant.timezone`.
3. Без секунд в UI и сообщениях пользователю/администратору.
4. Входные значения дат в фильтрах/полях оставляем ISO (`YYYY-MM-DD`) для совместимости HTML input и API.

## Этап 1. Базовый инфраструктурный слой
1. Добавить общий модуль форматирования в web:
   - `formatUiDate(value, timezone)` => `ДД.ММ.ГГГГ`
   - `formatUiTime(value, timezone)` => `HH:mm`
   - `formatUiDateTime(value, timezone)` => `ДД.ММ.ГГГГ HH:mm`
2. Протянуть timezone в scope:
   - API `/api/v1/admin/scope` должен отдавать `account.timezone`.
   - `ScopeContext` хранит `tenantTimezone`.
3. Обновить `packages/i18n/src/format.ts` под единый формат (точка-разделитель и 24h).

## Этап 2. Web Admin (обязательный, высокий приоритет)
1. Заменить все прямые `toLocale...` на общий formatter:
   - `DashboardPage.tsx`
   - `BookingsPage.tsx`
   - `RevenuePage.tsx`
   - `NotificationsPage.tsx`
   - `StaffPage.tsx`
   - `SchedulePage.tsx`
2. Проверить mobile/table layouts после смены формата.
3. Проверить, что время везде совпадает для одного booking.

## Этап 3. Public Web
1. `PublicBookingPage` должен показывать слоты в `tenant.timezone`.
2. Если timezone отсутствует в slots-ответе — добавить поле `timezone` в API `/api/v1/public/slots` и прокинуть в web API типы.

## Этап 4. Bot/Worker (стабилизация канала)
1. Унифицировать формат даты/времени в WhatsApp сообщениях:
   - без секунд
   - формат даты `ДД.ММ.ГГГГ`
   - время `HH:mm`
2. Проверить, что reminders/approval/messages используют timezone салона, а не timezone сервера.

## Этап 5. Legacy timezone hygiene
1. Добавить аудит-скрипт по tenant timezone:
   - найти tenants без валидного timezone
   - проставить безопасный fallback (`Europe/Rome`) и залогировать отчёт
2. Добавить запись в ops-документацию по проверке timezone перед онбордингом.

## Этап 6. Экспорт/отчёты
1. Если есть CSV/экспорт в admin, выровнять формат дат и времени под тот же контракт.
2. Не смешивать локаль браузера и формат продукта.

## Этап 7. Тесты и защитные меры
1. Unit тесты форматтера (дата/время/дата+время).
2. DST-кейсы (переход лето/зима).
3. Smoke: booking создаётся и одинаково отображается в:
   - Bookings
   - Dashboard
   - Revenue
   - WhatsApp уведомлениях
4. Добавить CI-проверку, что в `apps/web-vite/src` не добавляются новые `toLocale...` вызовы.

## Критерии готовности
1. В UI везде формат `ДД.ММ.ГГГГ` и `HH:mm`.
2. Нет визуальных и логических расхождений по времени между разделами.
3. Нет прямых `toLocale...` в web страницах.
4. Smoke и сборки проходят.
