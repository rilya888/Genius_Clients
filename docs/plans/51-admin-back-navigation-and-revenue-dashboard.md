# План 51: Back-навигация во внутренних экранах + мини-бухгалтерия (today/week/month/custom)

## 1) Цель этапа

Сделать админку удобной для ежедневной операционной работы:
1. Единая кнопка возврата на Dashboard на всех внутренних экранах (кроме Dashboard).
2. Мини-бухгалтерия в Dashboard и отдельный экран Revenue.
3. Роли доступа к revenue: только `owner` и `admin`.

---

## 2) Продуктовые решения

### 2.1 Back to Dashboard
- Добавить единый компонент `BackToDashboardAction`.
- Размещать его внизу страниц:
  - Bookings
  - Services
  - Staff
  - Schedule
  - Settings
  - FAQ Settings
  - Privacy
  - Notification Center
  - Revenue
- Для mobile сделать sticky-версию (с учетом safe-area).

### 2.2 Мини-бухгалтерия (Dashboard)
- Блок `Revenue Overview` с карточками:
  - Today
  - This week
  - This month
- Для каждого периода:
  - `totalRevenue` (только completed с заполненной суммой)
  - `completedCount`
  - `completedWithAmountCount`
  - `completedWithoutAmountCount`
  - `averageTicket`

### 2.3 Отдельная страница Revenue
- Маршрут: `/app/revenue` и tenant-scoped вариант `/t/:tenantSlug/app/revenue`.
- Фильтры:
  - предустановки `today / week / month`
  - `custom` с `from/to`.
- Валидации custom:
  - `from <= to`
  - максимальный диапазон 365 дней.
- Таблица completed-операций + summary сверху.

---

## 3) Доступ и права

1. Revenue доступен только ролям `owner/admin`.
2. Для остальных ролей:
- пункт меню revenue не показывается,
- прямой переход на маршрут revenue редиректит на Dashboard.

---

## 4) Источник данных и правила расчета

1. Источник: `bookings`.
2. Учитываем только `status = completed`.
3. Для периодов используем `completed_at` (не `start_at`).
4. Выручка:
- в сумму попадают только записи с `completed_amount_minor > 0`.
- completed без суммы считаются в отдельный счетчик.
5. Все границы периодов считаются в timezone tenant.

---

## 5) Backend задачи

1. Добавить слой revenue в admin-domain:
- сервис/репозиторий для summary и списка операций.

2. Новые endpoint'ы:
- `GET /api/v1/admin/revenue/summary?range=today|week|month|custom&from&to`
- `GET /api/v1/admin/revenue/bookings?range=...&from&to&limit&cursor`

3. Проверки:
- валидация `range`;
- для `custom` обязательные `from/to`;
- валидация диапазона <= 365 дней;
- tenant isolation.

4. Производительность:
- проверить индекс под запросы revenue (`tenant_id`, `status`, `completed_at`).
- при необходимости добавить миграцию индекса.

---

## 6) Frontend задачи

1. Общий компонент `BackToDashboardAction`.
2. Интеграция во все внутренние страницы (кроме Dashboard).
3. Dashboard:
- добавить `Revenue Overview` карточки и ссылку `Open revenue`.
4. Создать `RevenuePage`:
- summary + фильтры + таблица completed.
5. Навигация:
- добавить пункт `Revenue` в меню для `owner/admin`.

---

## 7) UX и адаптив

1. Sticky bottom action на mobile не должен перекрывать контент.
2. Добавить `padding-bottom` контенту внутренних страниц под sticky action.
3. Таблица revenue на mobile переходит в карточки/scroll-safe режим.

---

## 8) i18n

Добавить ключи EN/IT для:
- back to dashboard,
- revenue overview,
- today/week/month/custom,
- completed without amount,
- average ticket,
- invalid custom range,
- access denied for revenue.

---

## 9) Тестирование

### 9.1 Backend
- Корректные суммы и счетчики по периодам.
- Timezone boundary tests.
- Custom range validation.
- Role access enforcement.

### 9.2 Frontend
- Наличие back-кнопки на всех нужных страницах.
- Revenue скрыт/доступен по ролям.
- Мобильный sticky не ломает layout.

### 9.3 E2E smoke
1. Создать booking -> confirmed -> completed (с суммой).
2. Проверить обновление summary today/week/month.
3. Проверить custom interval.
4. Проверить owner/admin доступ и блокировку staff.

---

## 10) Definition of Done

1. Back-навигация реализована на всех внутренних экранах.
2. Dashboard показывает revenue summary по today/week/month.
3. Есть RevenuePage с custom interval и детализацией.
4. Revenue доступен только owner/admin.
5. Сборка и smoke-тесты проходят без регрессий booking flow.
