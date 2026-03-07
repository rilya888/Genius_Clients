# Этап 03: Multilingual Foundation (детальный план)

## Цель этапа

Построить i18n-фундамент, который:
- покрывает MVP-языки (`it`, `en`);
- одинаково работает в `web`, `api`, `bot` и уведомлениях;
- позволяет добавлять новые языки без переписывания бизнес-логики.

## Scope этапа

Входит:
- Структура словарей и naming conventions ключей.
- API локализации (`t`, форматтеры дат/времени/денег).
- Правила определения локали для Public/Admin/Bot/Notifications.
- Fallback-политика и контроль отсутствующих ключей.
- QA-checklist переводов.

Не входит:
- Подключение сторонних TMS (Crowdin, Lokalise и т.д.).
- Полный процесс профессиональной локализации post-MVP.

## Принципы на перспективу

- Ключи стабильны во времени, тексты могут меняться.
- Ключи не содержат бизнес-данных tenant, только шаблоны.
- Фолбэк всегда детерминированный: `requested locale -> tenant default -> en`.
- Интерполяция только именованными параметрами (`{name}`, `{date}`).
- Никаких “склеек строк” в коде UI/API/Bot, только `t(...)`.
- Тон коммуникации во всех каналах: формальный (it/en).

## Структура i18n-пакета

```
packages/i18n/
├── locales/
│   ├── it/
│   │   ├── common.json
│   │   ├── admin.json
│   │   ├── public.json
│   │   ├── bot.json
│   │   └── notifications.json
│   └── en/
│       ├── common.json
│       ├── admin.json
│       ├── public.json
│       ├── bot.json
│       └── notifications.json
├── src/
│   ├── index.ts
│   ├── t.ts
│   ├── locale.ts
│   └── format.ts
└── package.json
```

Примечание:
- `notifications.json` выделяется отдельно, чтобы тексты reminder/email не смешивались с bot/public.

## Дизайн ключей перевода

Формат:
- `domain.section.item`
- Примеры: `common.actions.submit`, `admin.masters.title`, `public.booking.success.pending`, `bot.errors.noSlots`.

Правила:
- Не использовать “плоские” ключи типа `submit`.
- Не использовать ключи, завязанные на конкретный текст.
- Для статусов брони использовать единый namespace:
  - `common.bookingStatus.pending`
  - `common.bookingStatus.confirmed`
  - `common.bookingStatus.cancelled`
  - `common.bookingStatus.completed`

## Минимальный набор доменов

### common.json

- Общие кнопки, статусы, валидационные ошибки.
- Названия дней недели/месяцев.
- Общие system/error messages.

### admin.json

- Навигация админки.
- Лейблы и подсказки форм.
- Сообщения CRUD-операций.

### public.json

- Весь booking flow (этап 06).
- Тексты GDPR consent и ошибок формы.
- Страницы успешной/ошибочной записи.

### bot.json

- Приветствие и сценарии диалога (этап 08).
- Тексты кнопок и fallback ошибок.
- Сообщения для подтверждения/отмены записи.
- Тексты должны соблюдать формальный стиль обращения.

### notifications.json

- Напоминания 24h/2h.
- Сообщения о подтверждении/отмене.
- Тексты для admin notifications (email/TG).

## API локализации (контракт)

```ts
import { t, resolveLocale, formatDateTime } from '@genius/i18n';

t('common.actions.submit', { locale: 'it' });
t('bot.booking.confirmed', { locale: 'en', params: { name: 'Mario' } });
formatDateTime(new Date(), { locale: 'it', timezone: 'Europe/Rome' });
```

Минимальные функции:
- `t(key, { locale, params? })`
- `resolveLocale(input, { tenantDefault, fallback })`
- `formatDate(...)`
- `formatTime(...)`
- `formatDateTime(...)`
- `formatCurrency(...)` (для будущего Stripe/UI)

## Определение локали (по каналам)

### Public (`web`, этап 06)

Приоритет:
1. Locale в URL (`/[locale]/...`).
2. Cookie locale (если есть).
3. `Accept-Language`.
4. `tenant.default_locale`.
5. `en` fallback.

### Admin (`web`, этап 05)

Приоритет:
1. Настройка пользователя (если появится).
2. `tenant.default_locale`.
3. `en`.

### Bot (`wa/tg`, этапы 08-10)

Приоритет:
1. Явный выбор пользователем в диалоге.
2. Определение по первому сообщению.
3. `tenant.default_locale`.
4. `en`.

### Notifications (этап 11)

Приоритет:
1. `booking.client_locale`.
2. `tenant.default_locale`.
3. `en`.

## Контракты с другими этапами

- Этап 04 (`/api/v1`): ошибки и response messages локализуются через единые ключи.
- Этап 05/06: UI-компоненты не содержат hardcoded текстов.
- Этап 08-10: Bot и web используют один `@genius/i18n` пакет.
- Этап 11: reminder templates используют `notifications.json`.
- Этап 14: в логах сохраняется ключ сообщения, а не только текст (для аудита и диагностики).

## Локализация данных из БД

Решение:
- Для переводимых бизнес-сущностей использовать translation-таблицы (вариант B), а не один текст на все языки.

Минимум для MVP:
- `service_translations`:
  - `service_id`, `locale`, `name`, `description`, `created_at`, `updated_at`
  - `unique(service_id, locale)`
- `master_translations` (если появятся переводимые bio/описания):
  - `master_id`, `locale`, `display_name`, `bio`, `created_at`, `updated_at`
  - `unique(master_id, locale)`

Правило чтения:
- Запрос сначала по locale пользователя, затем fallback на `tenant.default_locale`, затем `en`.

## Fallback и обработка отсутствующих ключей

- Если ключ отсутствует в выбранной локали:
  - попытка взять из `tenant.default_locale`;
  - затем из `en`.
- Если ключ отсутствует везде:
  - вернуть сам ключ;
  - записать событие в лог (`missing_translation_key`) для исправления.

Telemetry severity:
- `warning`: ключ отсутствует в requested locale, но найден во fallback.
- `error`: ключ отсутствует во всех доступных локалях.

## Форматы дат, времени, чисел

- Форматирование через `Intl` API с учетом locale и timezone tenant.
- Все `start_at/end_at` хранятся в UTC (этап 02), но отображаются локализованно.
- Денежные значения форматируются из `price_cents` с валютой tenant (post-MVP расширение).

## Pluralization и интерполяция

- Для фраз с количеством использовать ICU/plural rules (не ручные `if` в UI).
- Плейсхолдеры и plural формы должны быть идентичны между `it` и `en`.
- Для потенциально небезопасных контекстов (HTML/Markdown) использовать безопасную интерполяцию.

## Качество и контроль переводов

Минимальные проверки:
- Проверка, что набор ключей `it` и `en` совпадает.
- Проверка валидности JSON.
- Проверка плейсхолдеров: если в `en` есть `{name}`, в `it` должен быть тот же плейсхолдер.
- Проверка, что в коде не используются строки UI напрямую (грубый lint-pattern).
- Проверка plural ключей (`one/other` или ICU-эквивалент) в обеих локалях.
- Проверка safe interpolation для HTML/Markdown каналов.

## Версионирование контента и шаблонов

- Ключи переводов не переименовываются в рамках релизного цикла (freeze перед релизом).
- Для WhatsApp template messages вести отдельный mapping `template_name -> locale -> i18n_key`.
- Изменения текстов шаблонов, требующих повторного одобрения Meta, проходят отдельным changelog.

## Добавление нового языка (runbook)

1. Создать `locales/{lang}/` с теми же файлами.
2. Скопировать ключи из `en` как baseline.
3. Заполнить переводы.
4. Прогнать i18n checks.
5. Включить язык в `SupportedLocale`.
6. Проверить Public/Admin/Bot/Notifications smoke flow.

## Ownership

- Архитектура i18n и ключей: `Frontend Lead`.
- Интеграция в API/Bot/Notifications: `Backend Lead`.
- Контент-проверка переводов: `Product/Owner`.

## Риски и профилактика

- Риск: рассинхрон ключей между языками.  
  Мера: автоматическая проверка parity ключей.
- Риск: дублирование текстов в коде и словарях.  
  Мера: запрет hardcoded UI строк в review-чеклисте.
- Риск: неверный язык в reminder/bot.  
  Мера: единый `resolveLocale` и фиксированный приоритет источников.

## Definition of Done (детально)

- [ ] Сформирована структура словарей `it/en` для `common/admin/public/bot/notifications`.
- [ ] Зафиксирован key-naming standard и правила интерполяции.
- [ ] Определен единый алгоритм `resolveLocale` для всех каналов.
- [ ] Описаны formatter-функции для даты/времени/денег.
- [ ] Описаны fallback-правила и логирование missing keys.
- [ ] Подготовлен checklist качества переводов.
- [ ] Добавление нового языка описано как стандартная процедура.
- [ ] Зафиксирована модель translation-таблиц для переводимых полей БД.
- [ ] Зафиксирован формальный tone of voice (it/en) для web/bot/notifications.
- [ ] Зафиксированы pluralization и safe interpolation правила.

## Definition of Ready для Этапов 05/06/08/11

- [ ] Есть базовый набор ключей для всех экранов MVP (admin/public/bot/reminders).
- [ ] Локализация совместима с маршрутами Public (`/[locale]/...`).
- [ ] Локализация совместима с `booking.client_locale` и notification pipeline.
- [ ] Нет неразрешенных вопросов по fallback и приоритетам локали.
- [ ] Translation-таблицы (`service_translations`, `master_translations`) и fallback чтения согласованы с этапом 02.
