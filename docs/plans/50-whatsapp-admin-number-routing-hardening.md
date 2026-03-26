# План 50: Жесткая валидация WhatsApp-конфига администратора и routing-согласованности

## Цель
Исключить инциденты, когда команды администратора в WhatsApp перестают работать из-за рассинхрона tenant-данных (admin/operator номера) и фактической channel routing-привязки endpoint.

## Область
- API (`/api/v1/admin/settings/operational`)
- Web (обработка ошибок сохранения WhatsApp-блока)
- Ops-процедуры (чеклист проверки после изменения номеров)

## Проблема
Сейчас команда admin-digest авторизуется только при точном совпадении номера отправителя с `adminNotificationWhatsappE164` или `operatorWhatsappE164` в tenant.
Если данные рассинхронизированы с routing-контекстом/настройками, бот получает 403 и молчит для администратора.

## Решение

### 1) Серверная блокировка сохранения (hard block)
В `AdminService.updateOperationalSettings` добавить обязательные проверки:
- Нормализация/валидация E.164 уже сохраняется.
- Рассчитать эффективные значения (с учетом текущих данных tenant, если поле не передано в PATCH).
- Если есть активный `connected` WhatsApp endpoint у tenant:
  - должен быть задан `desiredBotNumber`;
  - `desiredBotNumber` обязан совпадать с `e164` одного из активных connected endpoint этого tenant;
  - должен быть задан `operatorNumber`.
- При нарушении выбрасывать `VALIDATION_ERROR` с отдельными reason-кодами.

### 2) Синхронизация admin/operator номера
При сохранении `operatorNumber` через operational settings автоматически синхронизировать:
- `adminNotificationWhatsappE164 = operatorNumber`

Это фиксирует единый номер для:
- входящих admin-команд
- уведомлений на подтверждение
- handoff к человеку

### 3) UI-ошибки с понятным текстом
В `formatApiError` добавить маппинг новых reason-кодов на понятные сообщения (EN/IT), чтобы администратор видел, почему сохранение заблокировано.

### 4) Ops-check после изменения номера
Обновить runbook:
- После изменения номера выполнить проверку `oggi/domani` в чате.
- Убедиться, что растет `adminDigestHandled`, а `adminDigestErrors` не растет.

## Коды ошибок (планируемые)
- `whatsapp_desired_bot_required_for_connected_endpoint`
- `whatsapp_operator_required_for_connected_endpoint`
- `whatsapp_routing_mismatch_for_tenant`

## Критерии готовности
- Неконсистентные данные не сохраняются.
- После валидного сохранения admin-команды отвечают стабильно.
- UI показывает причину блокировки без "тихих" сбоев.
