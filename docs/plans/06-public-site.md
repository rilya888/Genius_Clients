# Этап 06: Public Site (детальный план)

## Цель этапа

Собрать публичный клиентский сайт tenant-а, который стабильно конвертирует пользователя в запись через простой пошаговый сценарий и корректно работает с BFF/API, i18n и GDPR.

## Scope этапа

Входит:
- IA и маршруты публичного сайта.
- Полный booking funnel (выбор услуги/мастера/даты/слота/контактов/подтверждение).
- BFF-интеграция с `/api/v1/public/*`.
- Валидация пользовательских данных и GDPR consent.
- i18n (`it/en`) и адаптивный UI.

Не входит:
- CMS/редактор страниц.
- SEO-автоматизация beyond базовый минимум.
- Платежный шаг checkout (не в MVP).

## Архитектурные принципы

- **BFF-only:** браузер работает только с Next.js сервером; API вызывается серверной частью.
- **Tenant by host:** tenant определяется из `Host` subdomain.
- **Fast booking first:** каждый экран ориентирован на минимальное число кликов.
- **Resilient UX:** понятные состояния `loading/empty/error/retry`.
- **Privacy-first:** согласие на обработку данных обязательно перед отправкой записи.

## Поддомены и tenant-resolution

- Публичный сайт: `{slug}.yourapp.com`.
- Next.js middleware извлекает slug из `Host`.
- Если tenant не найден:
  - отдать tenant-friendly 404 страницу.
- API-запросы из BFF:
  - `X-Internal-Tenant-Id`
  - `X-Internal-Secret`

## Информационная архитектура (IA)

Маршруты:
- `/` или `/[locale]` — landing/entry.
- `/[locale]/book` — booking flow.
- `/[locale]/booking/confirmed` — успех (pending confirmation).
- `/[locale]/booking/error` — мягкая ошибка (опционально).

Навигация:
- Минимальная: logo/business name, locale switcher, CTA “Book now”.
- Без сложного меню (MVP-конверсия важнее).

## Booking flow (core)

### Шаг 1: Service selection

- Показ активных услуг из `/api/v1/public/services`.
- Отображать:
  - локализованное имя/описание;
  - длительность;
  - цену (если задана).
- Выбранная услуга фиксируется в state funnel.

### Шаг 2: Master selection

- Показ мастеров, доступных для выбранной услуги.
- Опция “Any master” обязательна в MVP.
- Показ локализованного display name.

### Шаг 3: Date selection

- Календарь с доступными датами в timezone tenant.
- Недоступные дни визуально отключены.
- Учитывать:
  - booking horizon;
  - min advance;
  - exceptions.

### Шаг 4: Slot selection

- Запрос слотов: `GET /api/v1/public/slots`.
- Отображение времени в tenant timezone.
- При пустом результате:
  - сообщение + быстрый выбор другой даты/мастера.

### Шаг 5: Contact form + consent

Поля:
- `client_name` (required),
- `client_phone` (required, сохраняется в E.164),
- `client_email` (optional),
- `client_locale` (из маршрута/selection),
- `client_consent` checkbox (required).

Валидация:
- телефон нормализуется в E.164 до submit,
- email format (если заполнен),
- submit блокируется без consent.

### Шаг 6: Review and submit

- Показывать резюме:
  - услуга,
  - мастер,
  - дата/время,
  - контакты.
- Submit -> `POST /api/v1/public/bookings` через BFF.
- Использовать `Idempotency-Key` на submit, чтобы избежать дублей при retry/double-click.
- На время submit кнопка подтверждения блокируется (UI lock), чтобы исключить повторную отправку.

### Шаг 7: Success

- Страница успеха:
  - статус “booking created, awaiting confirmation”.
  - краткие детали записи.
- Опционально CTA:
  - переход в WhatsApp/Telegram для коммуникации.

## Состояния UX и edge-cases

- Loading skeletons для списков услуг/мастеров/слотов.
- Empty states:
  - no services,
  - no masters,
  - no slots.
- Recoverable errors:
  - сетевые ошибки,
  - rate limit,
  - validation errors.
- Конфликт слота при submit (`BOOKING_SLOT_CONFLICT`):
  - предложить мгновенно выбрать новый слот.

## Интеграция с API (контракт)

- Используем только `/api/v1/public/*`.
- Маппинг ошибок по `error.code` -> локализованные UI-сообщения.
- Все запросы идут через BFF server layer.
- Для slots/bookings использовать request tracing (`X-Request-Id` passthrough).

## i18n на публичном сайте

- Только `it/en` для MVP.
- URL-driven locale: `/it/...`, `/en/...`.
- Переключение языка сохраняет текущий шаг funnel, если возможно.
- Тексты только из `public.json` и `common.json`.
- Тон коммуникации формальный.

## GDPR и privacy

- Обязательный consent checkbox перед созданием записи.
- Текст consent локализуется и содержит ссылку на политику.
- Передача в API:
  - `client_consent = true`.
- UI не показывает и не логирует лишние PII.

## Anti-abuse policy (MVP)

- В MVP используем только API rate-limit для защиты публичного flow.
- Captcha/challenge intentionally не включаем в MVP.

## SEO и базовый маркетинговый минимум

- Server-rendered entry page.
- Уникальные `title/description` по tenant.
- Canonical URL.
- `robots.txt` и `sitemap.xml` базового уровня (опционально для MVP, но желательно).

## Performance and reliability targets

- Core Web Vitals baseline (ориентир):
  - LCP <= 2.5s (типичный мобильный 4G кейс),
  - CLS <= 0.1.
- Booking funnel должен выдерживать retry без дублей (Idempotency-Key).
- Slot screen response UX:
  - perceived load < 1s (skeleton + async fetch).

## Accessibility baseline (A11y)

- Навигация с клавиатуры по всем шагам.
- Корректный focus management при переходе шагов и модалок.
- aria-label для ключевых form elements.
- Достаточный контраст и читаемые error messages.

## Analytics (MVP-lite)

- События funnel:
  - `public_flow_started`,
  - `service_selected`,
  - `master_selected`,
  - `slot_selected`,
  - `booking_submit_clicked`,
  - `booking_created`,
  - `booking_submit_failed`.
- Никаких чувствительных данных в analytics payload.

## Тестовая стратегия этапа

- Unit:
  - form validation logic,
  - step state transitions.
- Integration:
  - BFF handlers -> `/api/v1/public/*`,
  - error mapping by `error.code`.
- E2E:
  - happy path full booking,
  - slot conflict path,
  - no slots path,
  - locale switch (`it <-> en`) во время funnel.

## Ownership

- Public UX/UI: `Frontend Lead`.
- BFF integration: `Frontend + Backend`.
- Validation/GDPR wording: `Product/Owner`.
- QA/E2E: `Frontend + QA`.

## Риски и профилактика

- Риск: drop-off из-за длинного flow.  
  Мера: минимальное число полей, явный прогресс шагов, быстрый retry.
- Риск: устаревшие слоты при долгом заполнении формы.  
  Мера: финальная проверка и conflict handling на submit.
- Риск: неверная локаль/формат даты.  
  Мера: URL-driven locale + timezone-aware форматирование.
- Риск: ошибки из-за tenant host misconfiguration.  
  Мера: явная 404 tenant page + health checks для доменов.

## Definition of Done (детально)

- [ ] Работают маршруты public сайта и tenant resolution по subdomain.
- [ ] Реализован полный booking flow (service -> master -> date -> slot -> contacts -> confirm).
- [ ] Создание записи работает через `/api/v1/public/bookings` с `Idempotency-Key`.
- [ ] GDPR consent обязателен и передается в API.
- [ ] Обработаны ключевые error/empty/conflict сценарии.
- [ ] Полная локализация `it/en` (формальный стиль) без hardcoded строк.
- [ ] Минимальные E2E сценарии (happy + edge paths) проходят.
- [ ] Контракты синхронизированы с OpenAPI и этапами 03/04/11/14.

## Definition of Ready для Этапов 08/11/12

- [ ] Public booking создает корректные `pending` записи для последующей обработки ботом/уведомлениями.
- [ ] `client_locale` и consent корректно сохраняются в booking.
- [ ] Ошибки и статусы API стандартизированы для интеграций и тестов.
- [ ] Funnel стабильный и пригоден для production testing/deployment этапа.
