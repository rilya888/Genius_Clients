# План 46: Window-aware WhatsApp delivery (session/template)

## Цель
Перед отправкой WhatsApp-уведомлений определять состояние 24h окна и автоматически выбирать режим доставки:
1. Окно открыто -> обычное сообщение (`text`/`interactive`).
2. Окно закрыто -> шаблон (`template`).

Покрытие этого этапа:
1. `booking_created_admin`.
2. `booking_reminder_24h`.
3. `booking_reminder_2h`.

## Зафиксированные решения
1. Для `booking_created_admin` при закрытом окне используем template с кнопками.
2. Язык template берем из `last_known_locale` контакта; fallback `it`.
3. Quiet-hours не добавляем.
4. Если tenant-specific template не настроен, используем глобальный template (вариант B).

## Данные и схема
1. Добавить таблицу `whatsapp_contact_windows`:
- `tenant_id` (uuid)
- `sender_phone_number_id` (varchar)
- `recipient_e164` (varchar)
- `last_inbound_at` (timestamptz)
- `last_known_locale` (varchar(5), nullable)
- `updated_at` (timestamptz)
- уникальный индекс `(tenant_id, sender_phone_number_id, recipient_e164)`.
2. Расширить `notification_deliveries` диагностическими полями:
- `wa_delivery_mode` (`session` | `template`)
- `wa_template_name` (nullable)
- `wa_template_lang` (nullable)
- `wa_window_checked_at` (nullable)
- `wa_window_open` (nullable bool)
- `wa_policy_reason` (nullable text)
3. Расширить `channel_endpoints_v2` tenant-specific template полями (nullable):
- `booking_created_admin_template_name`
- `booking_reminder_24h_template_name`
- `booking_reminder_2h_template_name`

## API: inbound touch endpoint
1. Добавить internal endpoint в `public` роуты:
- `POST /api/v1/public/whatsapp/window-touch`
2. Защита:
- обязательный `x-internal-secret`
- tenant context через существующие internal headers.
3. Payload:
- `senderPhoneNumberId`
- `recipientE164`
- `locale` (`it|en`, optional)
- `inboundAtIso` (optional; default `now`).
4. Поведение:
- `upsert` в `whatsapp_contact_windows`
- обновление `last_inbound_at` по max(timestamp)
- обновление `last_known_locale`, если передан валидный locale.

## Bot: запись окна
1. В обработке inbound webhook после успешного route resolution вызывать `window-touch` endpoint.
2. Передавать:
- tenant headers из `routeContext`
- `item.phoneNumberId`
- `item.from`
- `item.locale`.
3. Ошибки touch не блокируют основную обработку диалога, только warning-log.

## Worker: policy engine
1. Добавить policy-resolver:
- вход: `tenantId`, `senderPhoneNumberId`, `recipient`, `notificationType`, fallback locale.
- выход: `mode=session|template`, `templateName?`, `templateLang`, `reason`.
2. Окно открыто, если `last_inbound_at >= now - 24h`.
3. Сопоставление template name:
- сначала tenant-specific из `channel_endpoints_v2`;
- затем global env fallback.
4. Language mapping:
- `it -> WA_TEMPLATE_LANG_IT` (fallback `it`)
- `en -> WA_TEMPLATE_LANG_EN` (fallback `en`).

## Worker: отправка
1. `booking_created_admin`:
- `session`: текущий interactive CTA.
- `template`: template + quick reply buttons с payload (`cta:<token>`).
2. `booking_reminder_24h`/`booking_reminder_2h`:
- `session`: текущий text.
- `template`: template message.
3. Заполнять новые поля диагностики в `notification_deliveries` перед/после попытки отправки.
4. При policy-ошибке (нет template config) фиксировать controlled failure с понятным кодом.

## Конфиг окружения
1. Добавить env для глобальных template fallback:
- `WA_TEMPLATE_BOOKING_CREATED_ADMIN`
- `WA_TEMPLATE_BOOKING_REMINDER_24H`
- `WA_TEMPLATE_BOOKING_REMINDER_2H`
- `WA_TEMPLATE_LANG_IT`
- `WA_TEMPLATE_LANG_EN`

## Тесты и проверка
1. Typecheck: `api`, `bot`, `worker`, `db`.
2. Smoke сценарии:
- с открытым окном -> `session` mode.
- с закрытым окном -> `template` mode.
- без tenant template и с global template -> fallback работает.
3. Проверка БД:
- `notification_deliveries.wa_*` поля заполнены корректно.

## Риски и контроль
1. Если template не APPROVED в Meta -> ожидаемый fail доставки, видимый в `error_message`.
2. Если нет `phoneNumberId` во входящем webhook, touch пропускается и policy может чаще уходить в template.
3. Rollout рекомендуется поэтапный: сначала reminders, затем admin CTA.
