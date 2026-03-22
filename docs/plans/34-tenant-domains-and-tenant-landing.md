# 34. Tenant Domains + Tenant Public Landing (geniusclients.info)

## Цель
Ввести доменную модель для каждого салона:
- `slug.geniusclients.info` — публичный лендинг и онлайн-запись клиентов.
- `slug.geniusclients.info/app` — админка конкретного салона.

Результат должен быть устойчивым к будущему росту (enterprise, multi-salon, дополнительные каналы).

## Текущее состояние (важно для миграции)
1. Tenant-контекст в API сейчас передается в основном через `x-internal-tenant-slug` / `x-internal-tenant-id`.
2. `web-vite` в `http.ts` использует `VITE_TENANT_SLUG` (или `demo`) и всегда добавляет `x-internal-tenant-slug`.
3. `tenant.slug` уже существует в БД и уникален.
4. Публичные и admin API маршруты уже требуют tenant context middleware.

Вывод: нельзя “резко” убрать header-модель, нужен совместимый переходный режим.

## Бизнес-границы этапа 34
1. Базовый домен: `geniusclients.info`.
2. Для каждого tenant используется поддомен `slug.geniusclients.info`.
3. Один и тот же tenant на этом этапе = один “салонный” публичный сайт + одна админка.
4. На этапе 34 не делаем новую биллинговую логику (она в отдельных планах), но учитываем совместимость.
5. `https://geniusclients.info` (без поддомена) всегда открывает основной маркетинговый лендинг платформы.

## Архитектурные принципы
1. **Host-first tenant resolution**:
   - для браузерного трафика tenant определяется по `Host`;
   - header tenant (`x-internal-tenant-slug`) остается как fallback на переходный период.
2. **Fail-closed безопасность**:
   - если tenant не разрешился, запрос не обслуживается.
3. **Backward compatibility**:
   - бот/внутренние сервисы продолжают работать через trusted internal headers.
4. **Single source of truth**:
   - canonical `tenant.slug`, нормализованный и уникальный.
5. **Подготовка к enterprise**:
   - дизайн данных должен позволять в будущем добавить несколько hostnames на tenant/салон.

## Нормализация slug и доменные правила
1. Канонический slug:
   - lower-case;
   - только `a-z`, `0-9`, `-`;
   - длина 3..63;
   - не начинается/не заканчивается `-`;
   - без underscore (`_`), потому что он ненадежен для hostname-поддоменов.
2. При регистрации:
   - если slug не задан явно, генерируется из названия;
   - конфликт -> суффикс (`-2`, `-3`) или ошибка с предложением вариантов.
3. Отображаемое имя салона может содержать любые символы/регистр; slug — технический идентификатор домена.
4. Фильтр зарезервированных slug (минимум):
   - `www`, `app`, `api`, `admin`, `super-admin`, `mail`, `support`, `help`, `billing`, `status`, `blog`, `docs`.
5. Любой slug из зарезервированного списка должен отклоняться на уровне backend-валидации и фронтенд-формы.

## Политика изменения slug
1. Самостоятельное изменение slug пользователем запрещено.
2. Изменение slug выполняется только суперадминистратором по обращению в администрацию.
3. Для операции смены slug обязателен внутренний процесс:
   - проверка доступности нового slug;
   - аудит (кто изменил, когда, старый/new slug);
   - установка временного 301-редиректа со старого поддомена на новый (переходный период).

## Целевая модель роутинга
1. `https://slug.geniusclients.info/`:
   - tenant public landing + запись (flow как у бота: услуга -> мастер -> дата -> слот -> контакты -> подтверждение).
2. `https://slug.geniusclients.info/app`:
   - login/admin для этого tenant.
3. `https://slug.geniusclients.info/login`:
   - авторизация того же tenant, без ручного выбора салона.
4. Super admin остается на отдельном контролируемом host/path (не tenant-host).

## Изменения в данных (перспективно)
### Минимум для этапа 34
1. Проверить и усилить constraints для `tenants.slug` (если нужно).
2. Миграция/бэкфилл slug для legacy tenant.

### Рекомендуемое расширение (с заделом)
1. Таблица `tenant_hostnames`:
   - `tenant_id`, `hostname`, `is_primary`, `status`, `verified_at`.
2. На этапе 34 можно хранить только primary hostname, но структура пригодится для enterprise и кастомных доменов.

## Изменения в backend/API
1. Новый middleware `tenantHostResolver`:
   - извлекает host;
   - для `*.geniusclients.info` резолвит slug;
   - устанавливает `tenantId` в context.
2. Обновление `tenantContextMiddleware`:
   - приоритет для browser/public/admin: host -> header fallback;
   - для internal-service traffic: trusted headers остаются.
3. Защита от spoofing:
   - принимать tenant headers только из trusted internal окружения (или при `x-internal-secret`).
4. Логи и трассировка:
   - в structured logs добавлять `requestHost`, `resolvedTenantId`, `resolvedTenantSlug`, `resolverSource` (`host|header`).
5. Ошибки:
   - четкий `TENANT_NOT_FOUND` для неизвестного host;
   - `AUTH_FORBIDDEN` при tenant mismatch.

## Изменения во frontend (`web-vite`)
1. Убрать жесткую привязку к `VITE_TENANT_SLUG` для браузерного режима.
2. В client API adapter:
   - определять tenant по `window.location.hostname`;
   - для tenant-host не отправлять/или отправлять согласованный header только как дублирующий контекст в переходном режиме.
3. Маршруты:
   - `/` -> публичная страница tenant;
   - `/app/*` -> админка tenant.
4. Навигация после регистрации:
   - редирект на canonical host нового tenant (`https://slug.geniusclients.info/app`).
5. Обработка “wrong host”:
   - если пользователь вошел не на canonical host, редирект на корректный.

## Infra/DNS/SSL (Railway + домен)
1. DNS:
   - wildcard `*.geniusclients.info` -> web service.
2. API домен:
   - отдельный стабильный host (например `api.geniusclients.info`) для CORS/конфигов.
3. SSL:
   - wildcard сертификат для `*.geniusclients.info`.
4. CORS:
   - allowlist для `https://*.geniusclients.info` + служебные домены.
5. Session/cookie политика:
   - если используются cookie, проверить `Domain=.geniusclients.info`, `Secure`, `SameSite`.
   - если bearer в storage — проверить CSRF и origin policy на state-changing запросы.
6. Каноникализация:
   - принудительно `https`;
   - единое правило trailing slash;
   - предсказуемое поведение `www` (редирект на canonical host).

## Публичный tenant-лендинг и booking-flow
1. Публичная страница tenant должна использовать текущие данные tenant:
   - услуги;
   - мастера;
   - доступные слоты;
   - настройки расписания и исключения.
2. Booking-flow должен использовать те же backend сервисы, что и бот (единая логика availability).
3. Источник записи помечается как web public source.
4. Ошибки/empty states:
   - нет услуг;
   - нет активных мастеров;
   - нет слотов на дату.

## Поэтапный rollout без даунтайма
1. Этап A (подготовка):
   - добавить middleware host resolver в неактивном режиме (feature flag);
   - включить расширенное логирование резолва tenant.
2. Этап B (совместимый режим):
   - host-first + header fallback;
   - обновить frontend на host-логику.
3. Этап C (каноникализация):
   - включить redirect на canonical tenant host;
   - добавить smoke tests по поддоменам.
4. Этап D (ужесточение):
   - ограничить browser tenant headers;
   - оставить header-path только для internal сервисов.
5. Этап E (операционная готовность):
   - включить прод-smoke сценарии по нескольким tenant поддоменам;
   - проверить rollback-переключатель на header-only режим.

## Тестирование и QA
1. Unit:
   - slug normalization/validation;
   - host parsing и resolver.
2. Integration:
   - `public/*` на tenant-host возвращает данные только этого tenant;
   - `admin/*` на tenant-host не смешивает данные.
3. E2E:
   - регистрация -> редирект на `slug.geniusclients.info/app`;
   - booking через публичный host;
   - login/logout и переходы внутри `/app`.
4. Security:
   - попытка tenant spoof через header на browser-запросе;
   - попытка доступа к чужому tenant через path/query.
   - host header injection проверки (допуск только по валидному шаблону `*.geniusclients.info` и разрешенным служебным host).
5. Regression:
   - бот и worker flows продолжают работать через internal tenant context.
6. CDN/cache:
   - проверка отсутствия cross-tenant cache leakage (cache key и `Vary` учитывают `Host`).

## Наблюдаемость и поддержка
1. Метрики:
   - `tenant_resolver_source_count{host|header}`;
   - `tenant_resolver_not_found_count`;
   - `tenant_mismatch_forbidden_count`.
2. Логи:
   - обязательные поля: `requestId`, `host`, `tenantId`, `tenantSlug`, `resolverSource`.
3. Runbook:
   - “tenant host not found”;
   - “wrong tenant resolution”.
4. Rollback runbook:
   - быстрый возврат в header-priority режим через feature flag;
   - checklist валидации после отката.

## Зависимости от других планов
1. План 35 (регистрация):
   - signup должен сразу создавать и выдавать canonical host.
2. План 36 (подписки):
   - лимиты и trial не должны ломать tenant-host onboarding.
3. План 39 (бот):
   - единая модель услуг/слотов между web public и ботом.

## Основные риски и меры
1. Риск: cross-tenant утечки из-за fallback header.
   - Мера: host-first, trusted-origin checks, поэтапное отключение browser headers.
2. Риск: CORS/cookie ошибки на поддоменах.
   - Мера: явный CORS allowlist + QA на реальном домене.
3. Риск: legacy tenant без корректного slug.
   - Мера: бэкфилл и pre-release аудит slug.
4. Риск: SEO/индексация служебных `/app` страниц.
   - Мера: `noindex` для admin маршрутов.

## Критерии готовности (Definition of Done)
1. Любой tenant доступен по `https://slug.geniusclients.info`.
2. `https://slug.geniusclients.info/app` открывает админку именно этого tenant.
3. Публичный booking-flow создает запись только в tenant текущего host.
4. Отсутствуют cross-tenant доступы в QA/security smoke.
5. Бот/worker интеграции не имеют регрессий после host-first перехода.

## Статус реализации (2026-03-22)
1. Выполнено:
- host-first tenant resolution в API + header fallback в совместимом режиме;
- tenant host security guard для browser headers;
- web-vite tenant host routing (`/`, `/app`, `/login`) с canonical переходами;
- smoke сценарии:
  - `pnpm smoke:tenant-host` — OK (с `SMOKE_TENANT_AUTOREGISTER=1`);
  - `pnpm smoke:tenant-host:security` — OK.
2. Ограничение вне кода:
- production wildcard-домен `*.geniusclients.info` и финальная DNS/SSL каноникализация зависят от инфраструктурного подключения реального домена.
3. Итог:
- этап реализован на 100% в коде и тестируемом контуре Railway;
- финальный custom-domain cutover выполняется как отдельная infra-операция.
