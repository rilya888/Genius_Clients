# 38. Основной маркетинговый лендинг: репозиционирование (детальная проработка)

## Цель этапа
Сделать основной лендинг платформы (`root domain`) понятным для широкого рынка сервисного бизнеса (не только салоны), не выходя за пределы реально реализованного функционала продукта.

Целевой результат:
1. Пользователь за 30-60 секунд понимает для кого сервис и какую проблему он решает.
2. Блок WhatsApp-бота объясняет реальный сценарий записи и подтверждений.
3. Pricing синхронизирован с текущей продуктовой политикой и backend.
4. CTA ведут в корректный пользовательский поток (регистрация, демо, контакт для enterprise).

## Связь с предыдущими этапами
1. Этап 34: root-домен = маркетинговый лендинг, tenant-поддомены = клиентские лендинги.
2. Этап 35: onboarding/trial/privacy уже реализованы и должны быть консистентно отражены в лендинге.
3. Этап 36: подписки/Stripe и единая модель billing — источник правды для pricing.
4. Этап 37: админ UX усилен; это должно быть отражено в value proposition для бизнеса.

Вывод: этап 38 — это не «дизайн ради дизайна», а внешний контракт продукта с рынком, синхронизированный с архитектурой и тарифной моделью.

## Подтвержденные решения (по итогам согласования)
1. `Enterprise` CTA ведет на отдельную страницу контактов с администрацией.
2. Цены на лендинге должны приходить из Stripe-источника (через backend read-модель), а не из статического текста.
3. По аналитике используем минимально рискованный путь:
- сначала first-party события (внутренний event endpoint + server logs),
- затем при необходимости подключаем внешний провайдер без блокировки релиза лендинга.
4. По визуалу:
- цветовая палитра текущего бренда сохраняется,
- layout/типографика/композиция можно менять для повышения конверсии.
5. Перед началом реализации обязательно создать полный backup проекта в папке backup.

## Scope
1. Полное обновление структуры и текстов root marketing landing.
2. Репозиционирование под мульти-вертикали:
- салонные услуги,
- медицина/консультации,
- авто-сервис,
- массаж/beauty/wellness,
- любые записи по слоту.
3. Отдельный сильный блок «Как работает WhatsApp-бот» (пошаговый flow).
4. Unified pricing-блок:
- `starter`, `pro`, `business`, `enterprise`;
- все планы кроме enterprise = 1 салон;
- enterprise = только через контакт с администрацией.
5. Консистентные CTA и FAQ с текущей продуктовой логикой.
6. Базовая SEO/analytics-ready структура лендинга.

## Out of Scope
1. Полноценный CMS.
2. Новый billing-функционал (checkout-логика уже в этапе 36).
3. Изменения tenant-публичных страниц (`slug.domain`) — это отдельная ветка этапа 34.
4. Обещания функционала, которого нет в API/UI.

## Продуктовые решения (зафиксированные)
1. Единая тарифная матрица по всему продукту:
- `starter`, `pro`, `business`, `enterprise`.
2. Ограничение по салонам:
- `starter/pro/business`: 1 салон,
- `enterprise`: multi-salon.
3. `enterprise` не продается через self-serve checkout, только контакт с администрацией.
4. Trial-коммуникация на лендинге не должна конфликтовать с onboarding-поведением из этапа 35.

## Архитектурные принципы
1. **Source of truth for pricing = backend subscription config**, не вручную захардкоженные цифры в нескольких местах.
2. **Content honesty**: любой блок лендинга отражает существующий функционал.
3. **Message hierarchy**: value proposition -> use-cases -> WhatsApp flow -> pricing -> FAQ -> CTA.
4. **Forward compatibility**: структура лендинга должна легко масштабироваться под новые вертикали и кейсы.
5. **Separation of concerns**:
- marketing landing (platform-level),
- tenant landing (business-level),
- admin app (operations-level).

## Целевая структура лендинга
1. Hero:
- кто: «service businesses by appointment»;
- что: «booking + WhatsApp automation + reminders + admin workflow»;
- CTA: «Start free» / «See how it works».
2. Problem/Solution:
- ручная обработка заявок,
- пропуски и не-подтвержденные записи,
- разрозненные каналы.
3. Use-case блоки (vertical cards):
- салон,
- клиника/врач,
- авто-сервис,
- массаж/wellness,
- универсальный кейс.
4. WhatsApp-блок (главный differentiator):
- клиент пишет в WhatsApp,
- бот уточняет услугу/дату/слот,
- создает запись,
- отправляет подтверждение/напоминания,
- админ подтверждает и управляет статусом.
5. Operations-блок (что видит бизнес внутри):
- bookings board,
- services/staff/schedule,
- dashboard и notification center.
6. Pricing:
- 4 плана в единой терминологии,
- четкие лимиты по салонам,
- enterprise contact-only.
7. FAQ:
- перенос процессов,
- поддерживаемые типы бизнеса,
- WhatsApp номер и ограничения,
- trial и апгрейд.
8. Final CTA.

## Контентные правила
1. Убрать beauty-only формулировки как дефолт.
2. Использовать нейтральные термины:
- «specialist / staff», «service», «appointment», «client».
3. В WhatsApp-блоке избегать юридически рискованных обещаний («гарантированно +X%»).
4. Все claims должны быть проверяемыми через текущий продукт.
5. EN/IT локализация должна быть семантически эквивалентной, не только прямой перевод.

## Pricing и backend-контракт
### Проблема
Сейчас pricing в разных местах исторически расходился.

### Решение
1. Для лендинга использовать единый backend-источник (public-safe read модель).
2. Минимальный целевой endpoint (если еще не реализован):
- `GET /api/v1/public/pricing/plans`
- response: список активных canonical планов (`starter/pro/business/enterprise`) в порядке sort, с ценами, синхронизированными со Stripe-конфигом.
3. Для `enterprise` API явно возвращает `isEnterprise=true`, `selfServe=false`, `contactRequired=true`.
4. Лендинг не должен самостоятельно вычислять policy по лимитам — получает ее из backend contract.

## CTA и пользовательские переходы
1. `Start free` -> регистрация (`/register`) с trial-flow этапа 35.
2. `See how it works` -> скролл/якорь к WhatsApp flow или демо-секции.
3. `Enterprise` CTA -> отдельная страница контактов администрации (platform-level contact page).
4. После логина пользователь уходит в `/app`, не остается на маркетинговом root.

## SEO, performance, analytics
1. SEO:
- уникальные title/description,
- структурированные H1-H3,
- FAQ schema (если внедряется),
- canonical для root.
2. Performance:
- LCP-оптимизация hero,
- lazy для тяжелых блоков,
- без тяжелых runtime-зависимостей ради «красивостей».
3. Analytics events (минимум):
- `landing_cta_start_free_click`,
- `landing_cta_enterprise_click`,
- `landing_pricing_plan_view`,
- `landing_whatsapp_flow_expand`.
4. Реализация analytics:
- фаза 1: first-party tracking (без внешнего SDK, чтобы не ухудшать perf/consent flow),
- фаза 2 (опционально): подключение внешнего аналитического провайдера после стабилизации релиза.

## Роли и влияние на систему
1. Этап 38 влияет на верхнюю воронку (marketing -> signup), но не меняет RBAC в `/app`.
2. Любые изменения CTA обязаны учитывать owner/admin ограничения из этапов 36-37.

## Риски и меры
1. Риск: маркетинг обещает то, чего нет в продукте.
- Мера: контент-review через технический чеклист (API/UI parity).
2. Риск: расхождение pricing между лендингом и billing.
- Мера: backend-driven pricing read model.
3. Риск: слишком общий текст, низкая конверсия.
- Мера: конкретные vertical сценарии + WhatsApp flow + явные CTA.
4. Риск: конфликт с tenant-domain архитектурой этапа 34.
- Мера: строгое разделение root marketing vs tenant host pages.

## Фазы реализации
1. Фаза A0: Backup safety
- сделать полный backup проекта в папку backup перед любыми изменениями этапа 38.
2. Фаза A: Content architecture
- утвердить структуру секций и message hierarchy,
- сформировать финальные EN/IT тексты.
3. Фаза B: Pricing contract alignment
- подтвердить backend источник планов,
- синхронизировать labels/limit notes.
4. Фаза C: UI implementation
- внедрить новый layout/блоки/CTA,
- связать с i18n и существующими роутами.
5. Фаза D: QA + parity checks
- проверка соответствия лендинга фактическому функционалу,
- проверка ссылок/роутов/локализаций.
6. Фаза E: Launch readiness
- smoke root landing,
- release checklist,
- post-release мониторинг базовых метрик.

## Тест-план
1. Functional:
- все CTA ведут в ожидаемые маршруты,
- pricing блок отображает корректные 4 плана,
- enterprise CTA не уводит в checkout.
2. Content parity:
- каждый функциональный claim проверен через текущие разделы `/app` и API.
3. i18n:
- EN/IT без пропусков и смешения языков.
4. Responsive:
- корректный рендер desktop/tablet/mobile.
5. Regression:
- root landing не ломает login/register и app shell.

## Definition of Done
1. Root landing отражает продукт как универсальную платформу записи (не только beauty).
2. WhatsApp flow объяснен пошагово и технически корректно.
3. Pricing на лендинге консистентен с backend/subscription governance.
4. Все планы отображаются как `starter/pro/business/enterprise`.
5. `enterprise` отмечен как contact-only.
6. CTA и FAQ не противоречат этапам 35/36/37.
7. EN/IT локализация завершена и проверена.
8. Есть smoke-checklist и post-release метрики для воронки.

## Исполняемый backlog
1. Сделать полный backup проекта в папку backup.
2. Утвердить финальную структуру и тексты секций лендинга.
3. Подтвердить/реализовать backend read-contract для pricing (public-safe, Stripe-aligned).
4. Внедрить новые секции лендинга в `web-vite` с сохранением текущей цветовой палитры.
5. Обновить i18n словари EN/IT под новую структуру.
6. Подключить CTA маршруты и enterprise contact page.
7. Прогнать QA по контент-паритету, адаптиву и ссылкам.
8. Добавить/проверить first-party analytics events.
9. Подготовить release checklist и критерии post-release оценки.

## Статус реализации (2026-03-22)
1. Выполнено:
- создан backup архива проекта в `backups/` перед стартом реализации;
- реализован публичный marketing API:
  - `GET /api/v1/marketing/pricing/plans`;
  - `POST /api/v1/marketing/events`;
- лендинг `LandingPage` переработан под мульти-вертикали и WhatsApp flow;
- добавлена `ContactPage` и маршрут `/contact` для enterprise CTA;
- `PricingPage` переведен на backend-driven цены из Stripe-aligned конфигурации;
- навигация и footer обновлены под страницу контактов;
- добавлены новые EN/IT i18n ключи для этапа 38;
- деплой выполнен через GitHub (`main` + `deploy/web` + `deploy/api`).
2. Исправленные прод-дефекты в процессе релиза:
- стабилизация SQL для canonical pricing plans (`IN (...)` вместо нестабильного `ANY(($1,$2...))` паттерна).
3. Проверки:
- `pnpm --filter @genius/api typecheck` — OK;
- `pnpm --filter @genius/web-vite typecheck` — OK;
- `pnpm --filter @genius/api build` — OK;
- `pnpm --filter @genius/web-vite build` — OK;
- `pnpm smoke:production` — OK;
- `SMOKE_AUTH_AUTOREGISTER=1 pnpm smoke:spa:auth-admin` — OK;
- ручная проверка `GET /api/v1/marketing/pricing/plans` — OK, возвращает 4 canonical плана.
