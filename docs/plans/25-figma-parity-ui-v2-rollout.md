# Этап 25: Figma Parity UI v2 (Next.js, non-Vite)

## Цель

Достичь максимально близкого визуального соответствия эталону из Figma-архива при сохранении текущей архитектуры приложения (`Next.js App Router + BFF + session/csrf/middleware`).

## Freeze и эталон

- Единственный эталон: `docs/SaaS Booking Platform Design.zip`.
- Любые отклонения от эталона фиксируются в explicit deviation list.
- Паритет по умолчанию: **максимальный 1-в-1**, кроме случаев архитектурной/безопасностной несовместимости.

## Стратегия rollout

- Использовать feature flag: `NEXT_PUBLIC_UI_V2_ENABLED`.
- Режимы:
  - `false` или unset: legacy-представление.
  - `true`: Figma-parity представление.
- Деплой только через `deploy/web`, не затрагивая `bot/api/worker`.

## Детальный план реализации

### Фаза A — Infrastructure

1. Добавить слой UI-флагов в `apps/web/lib/*`.
2. Подключить флаг на ключевых entry points:
   - landing,
   - auth,
   - public booking,
   - admin shell.
3. Подготовить безопасный fallback на legacy UI при выключенном флаге.

### Фаза B — Landing Parity

1. Привести структуру секций к эталону:
   - Hero,
   - Social Proof,
   - How it works,
   - Features,
   - Product Tour,
   - Pricing,
   - FAQ,
   - Trust & Security,
   - Final CTA.
2. Реализовать анимации появления/hover в пределах CSS/motion-policy проекта.
3. Синхронизировать responsive-поведение desktop/tablet/mobile.

### Фаза C — Auth/Public Booking Parity

1. Привести формы к эталонным паттернам полей, отступов и состояний.
2. Сохранить текущую бизнес-логику API и security слой без изменений контракта.
3. Довести до parity состояния:
   - loading,
   - validation error,
   - success,
   - disabled.

### Фаза D — Admin Parity

1. Выравнивание shell/layout, таблиц, фильтров, карточек и форм.
2. Поддержка data-heavy UX без потери читаемости.
3. Паритет статусов и empty/loading/error состояний по всем admin CRUD разделам.

### Фаза E — Stabilization + QA

1. Visual diff-check по ключевым маршрутам.
2. Проверка i18n (IT/EN) на переполнение и переносы.
3. Проверка a11y baseline (focus/contrast/status announcements).
4. Smoke-проверка в staging/production web-only.

## Acceptance Criteria

- UI визуально соответствует эталону архива (в пределах утвержденных отклонений).
- Включение/выключение `NEXT_PUBLIC_UI_V2_ENABLED` корректно переключает представление.
- Нет регрессий auth/booking/admin функционала.
- Нет изменений, затрагивающих `bot/api/worker` deploy-потоки.
- Typecheck/lint проходят для `@genius/web`.

## Текущее состояние

- Фаза A: выполнена.
  - добавлен feature flag helper `NEXT_PUBLIC_UI_V2_ENABLED`;
  - подключено переключение `legacy/v2` для landing, auth, public booking и admin shell;
  - legacy fallback сохранен.
- Фаза B: выполнена в рабочем объеме.
  - V2-лендинг собран section-by-section по эталонной структуре:
    - Hero (расширенная композиция + product snapshot),
    - Social Proof,
    - How it works (4 steps),
    - Core Features (6 cards),
    - Product Tour (tabs-like block + visual KPIs),
    - Pricing (+ yearly emphasis),
    - FAQ (8+ items),
    - Trust & Security,
    - Final CTA.
  - добавлены hover/entry анимации и responsive-адаптация.
- Фаза C: выполнена в рабочем объеме.
  - auth/public booking получили V2-композиции и state presentation;
  - `role=status` + `aria-live` добавлены на статусы.
- Фаза D: выполнена в рабочем объеме.
  - V2 shell/layout применен к admin;
  - page-level V2 presentation применен для:
    - dashboard,
    - bookings,
    - services,
    - masters,
    - working-hours,
    - exceptions,
    - master-services,
    - master-translations,
    - service-translations,
    - notifications,
    - settings.
- Фаза E: частично.
  - `@genius/web` typecheck проходит;
  - следующий шаг: визуальный QA в браузере и web-only деплой актуального набора изменений на `deploy/web`.
