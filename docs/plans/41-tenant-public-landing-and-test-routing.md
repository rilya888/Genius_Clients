# План 41. Tenant public landing и test routing до подключения домена

## Цель
Довести публичную часть продукта до рабочего состояния для каждого салона еще до подключения wildcard-домена, не ломая будущую архитектуру `slug.domain`.

## Целевое состояние
1. У каждого салона есть публичная страница вида `slug.domain/`.
2. Блок записи встроен в публичную страницу салона, а не живет как отдельный продуктовый экран.
3. До подключения домена существует полноценный тестовый режим через `\/t\/:slug`.
4. Tenant context определяется единообразно и безопасно.
5. Публичная запись, админка и будущие интеграции опираются на одну tenant-aware модель.

## Текущее состояние
1. Админский flow уже работает: регистрация, логин, мастера, услуги, расписание, подтверждение записи.
2. Public booking engine работает на уровне API.
3. Основной блокер: публичная страница на общем Railway-домене не знает, для какого салона загружать каталог.
4. На root `\/book` сейчас возникают пустые каталоги и технические ошибки вместо понятного UX.

## Архитектурные решения
### 1. Единая public-page модель
1. Публичная страница салона живет на `slug.domain/`.
2. Блок записи встроен на эту страницу как секция `#booking`.
3. Отдельная страница `\/book` остается только как совместимость и тестовый режим.
4. После подключения домена `\/book` должен вести на booking section или работать как alias.

### 2. Временный тестовый transport layer
1. До подключения домена вводится маршрут `\/t\/:slug`.
2. Внутри него доступны:
- `\/t\/:slug`
- `\/t\/:slug\/book`
- `\/t\/:slug\/app`
3. Этот режим остается как internal QA / support tool и после подключения домена.

### 3. Единый приоритет tenant resolution
1. `\/t\/:slug` в URL.
2. `slug.domain` по host.
3. Internal header для внутренних инструментов и smoke-проверок.
4. Dev-only fallback.
5. Никакого production browser fallback на `demo` для реального публичного сценария.

## Этапы реализации

## Этап 1. Frontend tenant-aware routing foundation
1. Добавить parser test-route slug из pathname.
2. Добавить единый helper tenant-aware URL builder:
- public root
- booking section
- app root
3. Обновить router для поддержки `\/t\/:slug` и `\/t\/:slug\/app`.
4. Сделать так, чтобы frontend API layer использовал slug из test route раньше, чем fallback.
5. Убрать техническое падение public pages при отсутствии tenant context.

## Этап 2. Public tenant landing MVP
1. Создать tenant public landing page.
2. Вывести минимум:
- имя салона
- краткий intro
- timezone / locale meta
- список услуг
- список мастеров
- CTA на запись
3. Встроить booking block в ту же страницу.
4. Добавить секцию empty states для ненастроенного салона.
5. Сохранить совместимость с будущим branded landing.

## Этап 3. Public booking hardening
1. Показать понятные ошибки вместо translation keys / raw API failures.
2. Добавить состояние “страница не привязана к салону”.
3. Добавить состояние “салон еще не готов к записи”.
4. Добавить retry UX для загрузки каталога и слотов.
5. Явно показывать, что запись требует подтверждения администратора.

## Этап 4. Tenant-aware admin pathing для тестового режима
1. Поддержать `\/t\/:slug\/app` без потери авторизации.
2. Сделать tenant-aware nav внутри admin app.
3. Не терять slug при внутренних переходах.
4. Не ломать root `\/app` сценарий.

## Этап 5. Sync и operational UX
1. После создания booking pending count должен быть консистентным.
2. После confirm booking pending banner должен обновляться корректно.
3. Notification / attention / bookings должны смотреть в один источник данных.

## Этап 6. Подготовка к реальному домену
1. Не дублировать логику для `slug.domain` и `\/t\/:slug`.
2. После подключения домена заменить transport layer, а не бизнес-логику.
3. Подготовить redirect strategy:
- `\/t\/:slug` -> `slug.domain/`
- `\/t\/:slug\/book` -> `slug.domain/#booking`
4. Сохранить `\/t\/:slug` как QA fallback.

## Этап 7. Безопасность и диагностика
1. Явно логировать источник tenant resolution.
2. Исключить конфликт между host slug, route slug и internal header.
3. Проверить tenant boundary во всех public route сценариях.
4. Сформировать список smoke-checks для tenant public mode.

## Что обязательно предусмотреть на перспективу
1. Public profile model должна быть расширяема под branding.
2. Tenant slug lifecycle должен поддерживать смену slug суперадмином.
3. Public page должна стать базой для:
- WhatsApp deep links
- email links
- client self-service flows
- SEO metadata
4. Enterprise multi-salon не должен ломать модель public salon page.

## UX-правила
1. Новый салон сразу публично доступен.
2. Если салон не настроен, пользователь видит не ошибку, а понятный empty state.
3. Booking block живет на публичной странице салона, не отдельно.
4. Все комментарии в коде приложения только на английском языке.

## Критерии готовности
1. `\/t\/:slug` открывает публичную страницу конкретного салона.
2. `\/t\/:slug` показывает tenant-specific каталог.
3. Booking создается без ручных header hack в браузере.
4. Booking появляется в `Bookings`.
5. Confirm меняет статус и корректно обновляет pending indicators.
6. `\/t\/:slug\/app` не теряет tenant context.
7. После подключения домена логика страниц не переписывается, а только переключается transport layer.
