# Этап 27: UI v3 по эталону Saasbookingplatformdesign + интеграция с текущими API

## Зафиксированные решения

- Эталонный источник: `https://github.com/rilya888/Saasbookingplatformdesign`, ветка `main`.
- Бренд-палитра: оставляем бирюзовую (не возвращаемся к фиолетовой).
- Приоритет при конфликте UX vs бизнес-правил: текущие бизнес-правила и API-контракты.
- Если найден конфликт эталонного UX с текущими правилами, решение согласуется отдельно до внедрения.

## Цель

Собрать визуально максимально близкий к эталону интерфейс (landing + auth + admin + public flow), но реализованный нативно в текущем стеке проекта: `Next.js App Router + BFF + session/csrf`.

## Принципы реализации

1. Не переносить Vite/React Router архитектуру из эталона.
2. Переносить композицию, визуальный ритм, компоненты, интерактив и состояния.
3. Все данные и действия только через текущие API проекта.
4. Комментарии в коде только на английском языке.
5. Включение нового UI только через feature flag.

## Техническая рамка

- Feature flag: `NEXT_PUBLIC_UI_V3_ENABLED`.
- Режимы:
  - `false|unset`: текущий UI.
  - `true`: новый UI-v3.
- Новые директории:
  - `apps/web/components/v3/*`
  - `apps/web/lib/v3/*` (адаптеры API <-> UI)
  - `apps/web/styles/v3/*` (tokens + layers)

## Freeze и паритет

1. Freeze эталона: ориентир на `main` как source of truth.
2. Definition of Done по визуалу:
  - секции/композиция: 1-в-1 по структуре;
  - бирюзовая адаптация цветов без изменения информационной иерархии;
  - тайминги motion: 150–350ms;
  - обязательные состояния: loading, empty, error, success, disabled.
3. Любые допустимые отклонения фиксируются в `deviation list` внутри этого документа.

## Матрица соответствия (обязательный этап перед активной разработкой)

Для каждого экрана фиксируется:
- source файл из эталона,
- target route в `apps/web/app/*`,
- необходимые API endpoints,
- UI state map,
- статус миграции.

## Этапы внедрения (вертикальными срезами)

### Срез A: Auth

- Login / Register / Forgot / Reset / Verify.
- Удаление моков, подключение реальных auth endpoint-ов.
- Проверка redirect/session behavior.
- Статус: **выполняется**.
  - В `apps/web/app/auth/page.tsx` реализованы все 5 режимов с реальными API маршрутами.
  - Добавлен unified submit flow + request verification action.
  - Сохранены locale/session проверки и role-safe redirect behavior.
  - Добавлена совместимость rollout: `UI_V3` также активирует modern auth presentation.

### Срез B: Admin Shell + Dashboard

- Перенос shell/layout (sidebar/topbar/mobile).
- Подключение `/api/auth/me` + role guard.
- Реальные KPI и operational summary.
- Статус: **выполняется**.
  - `session-gate` усилен (brand/user head, mobile jump navigation, v3-compatible presentation).
  - Dashboard дополнен quick actions, focus KPI и recent bookings (реальные данные).
  - Следующий шаг: выровнять remaining admin pages по тем же visual-pattern blocks.

### Срез C: Bookings + Services + Masters

- Таблицы, фильтры, CRUD, статусные чипы.
- Унификация ошибок/тостов.

### Срез D: Schedule

- Working hours, exceptions, master-services.
- Валидация интервалов и корректная работа с time-related полями.

### Срез E: Settings + Notifications + Translations

- Сложные формы и ограничения ролей.
- Мониторинг доставок и retry UX.

### Срез F: Landing + Pricing + FAQ + Public Booking

- Максимальный визуальный паритет лендинга по композиции.
- CTA и flow только через рабочие route/API.

## Data Adapter слой

1. Для каждого домена вводится явный mapper:
- `api dto -> ui model`
- `ui form -> api payload`
2. Централизованная нормализация:
- даты,
- денежные значения,
- enum-статусы,
- API errors.

## Контент и i18n

1. EN/IT проверяется на каждом срезе, не в конце.
2. Тексты из эталона маппятся на текущие i18n ключи проекта.
3. Проверка переполнений/переносов на mobile и tablet обязательна.

## QA и выпуск

1. На каждый срез:
- `pnpm --filter @genius/web typecheck`
- smoke сценарии по домену
- визуальный проход desktop/tablet/mobile
2. Перед production:
- visual QA gate (скриншотный чек-лист ключевых экранов)
- ручной sign-off
3. Деплой только через `deploy/web`.

## Откат

- Мгновенный rollback через `NEXT_PUBLIC_UI_V3_ENABLED=false`.

## Deviation list (заполняется по мере реализации)

- Пока пусто.
