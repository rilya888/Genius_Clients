# 37. Admin UX: Dashboard, Settings, Service-Master Mapping (детальная проработка)

## Цель этапа
Сделать админ-панель практичной для ежедневной работы владельца/админа:
1. Dashboard показывает реальное состояние бизнеса и подсказывает действия.
2. Services управляют допуском мастеров к услугам без ручных обходов.
3. Settings содержат операционные данные салона и связаны с bot/public booking.
4. Навигация и контекст роли/салона прозрачны на каждой странице.

## Связь с предыдущими этапами
1. Этап 33 дал CRUD по bookings/staff/services/schedule.
2. Этап 35 дал verify/read-only логику.
3. Этап 36 дал billing/subscription блок.

Вывод: этап 37 должен собрать это в единый UX-слой без дублирования бизнес-логики.

## Scope
1. Sidebar/Top context: явный блок `salon + role + subscription state`.
2. Dashboard (операционный): KPI, alerts, action center, быстрые переходы.
3. Services <-> Masters mapping: массовое и точечное управление связями.
4. Settings (операционные): адрес, парковка, часы работы, подписка, FAQ/privacy links.
5. API-агрегации под dashboard и settings (без тяжелых вычислений на фронте).
6. Ролевой UX: owner/admin видят одно и то же ядро, но owner-only действия помечены.

## Out of Scope
1. BI-аналитика с историей > 90 дней.
2. Новый billing-функционал (вне текущего блока подписки этапа 36).
3. Deep multi-salon интерфейсы enterprise (только базовый scope-переключатель).

## Архитектурные принципы
1. **Single backend truth**: KPI считаются на API, фронт только рендерит.
2. **No hidden coupling**: mapping сервис-мастер хранится в `master_services`, без параллельных источников.
3. **Actionable UI**: каждый alert имеет CTA (куда перейти и что исправить).
4. **Graceful degradation**: при частичных ошибках dashboard показывает доступные блоки.
5. **Forward compatibility**: структура dashboard должна расширяться под enterprise/multi-salon.

## Функциональные требования

### 1. Sidebar / Context bar
1. Показывать:
   - `account/salon display name`,
   - `role`,
   - `planCode`,
   - billing state (`ok/past_due_warning/read_only/hard_locked`).
2. Добавить визуальную подсветку ограничений:
   - read-only,
   - hard lock (только allowed paths).
3. На мобильных экранах контекст не теряется (sticky compact header).

### 2. Dashboard
1. KPI-ряд (today + rolling 7d):
   - `bookings_today_total`,
   - `bookings_week_total`,
   - `bookings_pending_count`,
   - `bookings_cancelled_week`,
   - `staff_active_count`,
   - `avg_daily_utilization` (базовый расчет по слотам/записям).
2. Attention center:
   - неподтвержденные записи,
   - мастера без расписания,
   - услуги без назначенных мастеров,
   - past_due billing warnings.
3. Quick actions:
   - перейти в bookings с фильтром `pending`,
   - добавить услугу,
   - добавить мастера,
   - открыть расписание.
4. Activity preview:
   - последние N событий (booking status change / master status / service changes).
5. Временные окна KPI:
   - расчеты `today` и `rolling 7d` выполняются в `tenant.timezone`, не в UTC.

### 3. Services <-> Masters
1. В карточке/модалке услуги:
   - multiselect с чекбоксами всех активных мастеров.
2. Поведение сохранения:
   - atomic replace набора связей по услуге (в транзакции).
3. Валидации:
   - минимум 1 мастер для активной услуги (hard-block на сохранение активной услуги без мастеров),
   - запрещать дубли.
4. Runtime enforcement:
   - booking/slot selection не предлагает мастеров без связи с услугой.
5. Массовые операции:
   - включить/выключить мастера для услуги по кнопке.
6. Деактивация мастера:
   - при переводе мастера в `inactive` автоматически удалять его связи из `master_services`.
   - операция в транзакции: `masters` update + cleanup mapping.

### 4. Settings
1. Блок «Общие данные салона»:
   - адрес,
   - парковка (boolean + note),
   - общие часы работы (display-level справка, не конфликтует с per-master schedule).
2. Блок подписки:
   - использовать endpoint этапа 36,
   - owner-only действия,
   - статус и CTA.
3. Блок ссылок:
   - FAQ editor,
   - privacy/GDPR,
   - notification center.
4. Удалить/не показывать legacy price block (если остался в старом UI).

## Data model изменения
1. `tenants`:
   - добавить поля (если еще нет):
     - `address_country`,
     - `address_city`,
     - `address_line1`,
     - `address_line2`,
     - `address_postal_code`,
     - `parking_available`,
     - `parking_note`,
     - `business_hours_note`.
   - для существующих tenant выполнить backfill дефолтами (`''`/`NULL` по контракту формы).
2. `master_services`:
   - использовать как единственный источник разрешений.
3. Дополнительных таблиц не требуется, если dashboard KPI считаются SQL-агрегациями.

## API контракты (целевые)
1. `GET /api/v1/admin/dashboard`
   - response:
     - `kpis`,
     - `attentionItems`,
     - `quickActions`,
     - `recentActivity`.
2. `GET /api/v1/admin/services/:id/masters`
   - текущий mapping.
3. `PUT /api/v1/admin/services/:id/masters`
   - request: `{ masterIds: string[] }`
   - mode: replace set.
4. `GET /api/v1/admin/settings/operational`
5. `PATCH /api/v1/admin/settings/operational`
   - owner/admin write policy по текущей модели ролей.
   - адрес передается как структурированный объект:
     - `address.country`,
     - `address.city`,
     - `address.line1`,
     - `address.line2`,
     - `address.postalCode`.

## UX/Frontend требования
1. Единый компонент статуса для `success/warning/error/info`.
2. Таблицы и модалки:
   - единые spacing/typography/radius (исправление визуальных рассинхронов).
3. Формы:
   - optimistic UI только там, где rollback безопасен.
4. Dashboard:
   - skeleton loading,
   - empty-state с CTA,
   - error-state с retry.

## Роли и доступ
1. `owner`:
   - полный доступ.
2. `admin`:
   - доступ ко всем операционным блокам,
   - без owner-only billing mutation.
3. Все owner-only действия явно помечены в UI.

## Performance и надежность
1. Dashboard endpoint должен быть `O(1)` по числу блоков (без N+1).
2. KPI-кэш (короткий TTL 15-30s) опционально, если нагрузка вырастет.
3. Запросы mapping делать батчем, не по услуге в цикле.
4. Добавить индексы/проверки для новых частых запросов dashboard/settings/mapping.

## Наблюдаемость
1. Метрики:
   - `admin_dashboard_fetch_total`,
   - `admin_dashboard_fetch_failed_total`,
   - `service_master_mapping_update_total`,
   - `service_master_mapping_update_failed_total`.
2. Логи:
   - tenantId, actorUserId, serviceId, mastersCountBefore/After.
3. Аудит:
   - изменения mapping и operational settings в `audit_logs`.

## Риски и меры
1. Риск: рассинхрон mapping после параллельного редактирования.
   - Мера: transactional replace + updated_at check.
2. Риск: перегруз dashboard SQL.
   - Мера: ограничить диапазон расчетов (today/7d), индексы.
3. Риск: UX путаница owner/admin.
   - Мера: явные бейджи owner-only в CTA.
4. Риск: конфликт с billing lock.
   - Мера: dashboard/settings учитывают состояния из этапа 36.
5. Риск: неконсистентный адресный формат между UI/API.
   - Мера: единый DTO адреса + server-side validation.

## Фазы реализации
1. Фаза A: миграция/индексы/backfill + backend dashboard endpoint + operational settings endpoints.
2. Фаза B: service-master mapping APIs + enforcement в booking/slots.
3. Фаза C: frontend dashboard + settings forms + mapping UI.
4. Фаза D: polish (styling consistency, mobile behavior, edge states).
5. Фаза E: smoke/regression и rollout.

## Тест-план
1. Unit:
   - KPI aggregators,
   - mapping replace validator.
2. Integration:
   - service->masters update reflects in booking availability.
   - master `inactive` removes mappings atomically.
   - active service without masters returns validation error.
3. E2E:
   - owner меняет mapping -> booking flow учитывает изменения.
   - dashboard alerts ведут в корректные разделы.
4. Regression:
   - billing block (этап 36) продолжает работать.
   - read-only/hard-lock не нарушаются.
   - KPI “today/week” соответствуют `tenant.timezone`.

## Definition of Done
1. Dashboard без заглушек, на реальных данных.
2. Mapping «услуга-мастер» полностью управляется из UI и хранится в `master_services`.
3. Booking/slots используют только разрешенные связки.
4. Settings содержит адрес/парковку/часы и не конфликтует с schedule.
5. Визуальная консистентность форм/селектов/модалок достигнута.
6. Owner/admin UX прозрачен, owner-only действия помечены.
7. Есть smoke-чеклист и runbook для поддержки.
8. Деактивация мастера автоматически очищает mapping и не ломает booking flow.
9. Активная услуга без мастеров не может быть сохранена.
10. Адрес хранится в структурированном виде и стабильно рендерится в UI.

## Исполняемый backlog
1. Добавить/мигрировать operational fields в `tenants` (структурный адрес + backfill).
2. Реализовать `GET /admin/dashboard`.
3. Реализовать `GET/PUT /admin/services/:id/masters`.
4. Подключить enforcement mapping в booking/slot services + cleanup mapping при `master inactive`.
5. Реализовать `GET/PATCH /admin/settings/operational`.
6. Собрать UI dashboard.
7. Собрать UI mapping в Services modal/page.
8. Обновить Settings page формами + интеграцией billing блока.
9. Прогнать e2e/smoke и подготовить release checklist.

## Статус реализации (2026-03-21)
1. Выполнено:
   - миграция `0013` + Drizzle schema для operational полей tenant;
   - backend `GET /api/v1/admin/dashboard`;
   - backend `GET/PUT /api/v1/admin/services/:id/masters`;
   - backend `GET/PATCH /api/v1/admin/settings/operational`;
   - hard-lock allowlist обновлен для `/admin/settings/operational`;
   - backend enforcement:
     - нельзя сохранить активную услугу без мастеров;
     - при деактивации мастера mapping удаляется атомарно;
     - booking create валидирует `service/master` mapping;
   - frontend:
     - Dashboard на реальных данных + attention/activity/quick actions;
     - Services modal: multi-select мастеров + запись mapping;
     - Settings: operational form (address/parking/hours note) + subscription блок сохранен;
   - i18n ключи для новых экранов и сообщений (EN/IT).
2. Проверки:
   - `pnpm --filter @genius/api typecheck` — OK.
   - `pnpm --filter @genius/web-vite typecheck` — OK.
3. Осталось:
   - smoke/e2e прогон в окружении с БД и деплоем (вне локального typecheck).
