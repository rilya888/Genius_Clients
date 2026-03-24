# Этап 44: WhatsApp onboarding numbers для нового салона

## Цель

После регистрации новый пользователь должен сразу видеть в своей админке два WhatsApp-поля:

1. номер телефона, который будет ботом салона;
2. номер телефона оператора / администратора, на который бот:
   - отправляет запросы на подтверждение записей;
   - переводит клиента, если нужен человек в чате.

Эти же данные должны быть видны в super-admin, чтобы платформа могла подключить и активировать салонный номер через Meta без ручного поиска информации.

## Что уже есть в проекте

1. Есть экран `Dashboard`, куда можно добавить onboarding block.
2. Есть `Settings -> Operational settings`, куда можно добавить постоянную форму редактирования.
3. Есть `TenantRepository.updateSettings`, через который уже сохраняются tenant-level operational поля.
4. Есть `Super Admin` и новый `WhatsApp Numbers` registry.
5. Есть `channel_endpoints_v2`, который хранит фактический Meta / routing binding.

Это означает, что дополнение нужно строить не как отдельный изолированный модуль, а как связку:

- tenant business inputs;
- computed setup status;
- super-admin visibility;
- future Meta connection workflow.

## Архитектурный принцип

Нужно разделить два класса данных:

### 1. Business input от салона

То, что вводит сам владелец салона:

- `desired_whatsapp_bot_e164`
- `operator_whatsapp_e164`

### 2. Technical connected state

То, что реально подключено в Meta и участвует в routing:

- `phone_number_id`
- `waba_id`
- `display_phone_number`
- `binding_status`
- `token_source`
- `connected endpoint`

Это разделение обязательно.

Пользователь вводит желаемые номера раньше, чем super-admin реально подключит номер в Meta.

## Изменения в модели данных

## 44.1 Поля в tenants

Добавить в `tenants` два новых поля:

1. `desired_whatsapp_bot_e164`
2. `operator_whatsapp_e164`

Почему именно так:

- не смешиваем старую notification-логику с новой;
- имена отражают бизнес-смысл;
- позже можно будет перенести их на salon-level entity, если появится полноценная multi-salon модель.

## 44.2 Что не нужно хранить как ручной truth

Не нужно хранить в БД отдельный “магический” итоговый статус вроде `whatsapp_connected=true`, если он может вычисляться.

Нужно вычислять status на backend из:

1. заполненности tenant-полей;
2. наличия endpoint binding в `channel_endpoints_v2`;
3. состояния binding;
4. token coverage / health;
5. конфликтов данных.

## Целевой computed status

Нужен единый computed status `whatsappSetupStatus`:

1. `not_started`
- оба номера пустые

2. `incomplete`
- заполнен только один номер

3. `numbers_provided`
- оба номера заполнены
- но Meta binding еще не создан

4. `pending_meta_connection`
- endpoint уже есть
- но статус еще `draft` или `pending_verification`

5. `connected`
- endpoint активен и `binding_status=connected`

6. `action_required`
- конфликт номера
- endpoint отключен
- нет token coverage
- или есть другая операционная проблема

Этот status должен использоваться везде одинаково:

- Dashboard
- Settings
- Super Admin
- будущий onboarding

## Backend план

## 44.3 Миграция БД

Добавить миграцию, которая расширит `tenants`:

- `desired_whatsapp_bot_e164 VARCHAR(32)`
- `operator_whatsapp_e164 VARCHAR(32)`

## 44.4 TenantRepository

Расширить:

- `findById`
- `updateSettings`

чтобы repository возвращал и обновлял эти поля.

## 44.5 AdminService

### Dashboard

Расширить `getDashboard()`:

добавить блок `whatsappSetup`, где backend возвращает:

- `desiredBotNumber`
- `operatorNumber`
- `status`
- `connectedEndpointId`
- `connectedDisplayPhoneNumber`
- `requiresAction`
- `statusReason`

### Operational settings

Расширить:

- `getOperationalSettings()`
- `updateOperationalSettings()`

чтобы они читали и сохраняли оба WhatsApp-поля.

### Validation

Добавить проверки:

1. номера должны быть валидными E.164;
2. bot number и operator number не должны совпадать;
3. если bot number уже связан с другим tenant через registry, нужно вернуть конфликт;
4. operator number может быть пустым только если бизнес-решение это допускает.

Для текущей задачи лучше сделать оба поля обязательными для полноценного onboarding status `numbers_provided`.

## 44.6 Super Admin API

Расширить `GET /api/v1/super-admin/tenants`.

Для каждого tenant возвращать:

- `desiredWhatsappBotE164`
- `operatorWhatsappE164`
- `whatsappSetupStatus`
- `connectedWhatsappPhoneNumberId`
- `connectedWhatsappDisplayPhone`

Это нужно, чтобы super-admin видел входные business numbers рядом с tenant.

Опционально затем можно расширить `GET /api/v1/super-admin/whatsapp/endpoints`, чтобы он тоже показывал tenant-side desired numbers, но first step лучше сделать через tenant overview.

## Frontend план

## 44.7 Dashboard

На главной странице админки добавить новый блок:

### `WhatsApp Setup`

Показывать:

1. `Bot number`
2. `Operator / confirmation number`
3. текущий `whatsappSetupStatus`
4. краткое пояснение следующего шага
5. кнопку `Save`
6. ссылку на `Settings`, если нужен полный edit flow

### Поведение

1. Если оба поля пустые:
- блок должен быть заметным;
- это onboarding priority item.

2. Если поля заполнены, но Meta binding нет:
- показывать `Waiting for connection by administration`.

3. Если binding connected:
- показывать `WhatsApp bot connected`.

4. Если есть проблема:
- показывать понятное сообщение и next action.

## 44.8 Settings

В `Settings -> Operational settings` добавить постоянную форму:

1. `Bot number`
2. `Operator / confirmation number`
3. hint-пояснения по обоим полям
4. validation messages
5. save flow через уже существующий `updateOperationalSettings()`

### Почему и Dashboard, и Settings

- Dashboard нужен как onboarding surface;
- Settings нужен как canonical edit screen.

Оставить только один из них было бы слабее по UX.

## 44.9 Super Admin UI

Расширить tenant overview на странице super-admin.

Для tenant списка показать:

1. desired bot number
2. operator number
3. computed setup status
4. есть ли connected endpoint

Дополнительно в `WhatsApp Numbers` registry желательно дать возможность super-admin быстро понимать:

- какой tenant уже дал номера;
- какой еще не дал;
- какой готов к Meta connection.

### Следующий UX-шаг

После этого можно будет добавить `prefill from tenant` в WhatsApp registry form.

Но для первого этапа достаточно visibility и статуса.

## Валидация и UX-сообщения

Нужны понятные сообщения.

Примеры:

1. `Enter a valid WhatsApp number in international format.`
2. `Bot number and operator number must be different.`
3. `This bot number is already assigned to another salon.`
4. `Numbers saved. Administration can now connect your WhatsApp bot.`
5. `WhatsApp bot is connected.`
6. `Action required: update your WhatsApp numbers or contact administration.`

## Перспектива и совместимость

## 44.10 Future multi-salon

Сейчас поля можно хранить на `tenant`, потому что в текущем MVP tenant фактически соответствует салону.

Но в коде нужно помнить:

- это временно salon-level semantics на tenant-level storage;
- в enterprise будущем возможно вынесение на salon entity.

Поэтому naming должен быть бизнес-осмысленным, а не привязанным к временному storage layer.

## 44.11 Handoff / operator use

`operator_whatsapp_e164` в будущем должен использоваться не только как display field, но и как:

1. destination для handoff;
2. destination для admin confirmation logic;
3. контакт для связи на public side;
4. возможно для notification routing.

Это значит, что поле надо внедрять аккуратно, как future operational contact, а не как одноразовую форму.

## QA / Smoke plan

Нужно проверить:

1. Новый tenant регистрируется.
2. На Dashboard виден `WhatsApp Setup` block.
3. Владелец вводит оба номера.
4. Номера сохраняются.
5. В Settings они отображаются и редактируются.
6. В super-admin tenant list они отображаются.
7. Computed status меняется корректно.
8. Конфликт bot number с другим tenant отрабатывает корректно.
9. После создания endpoint binding в registry статус меняется на `pending_meta_connection` / `connected`.

## Порядок реализации

Рекомендуемая последовательность:

1. Миграция `tenants` под 2 новых поля.
2. Расширение `TenantRepository`.
3. Расширение `AdminService`:
- `getDashboard`
- `getOperationalSettings`
- `updateOperationalSettings`
- computed WhatsApp status helper.
4. Расширение admin API contracts.
5. Расширение super-admin tenants API.
6. Dashboard block.
7. Settings form.
8. Super-admin tenant visibility.
9. Validation polish.
10. Smoke test.

## Definition of Done

Дополнение считается завершенным, когда:

1. новый пользователь после регистрации видит на Dashboard два WhatsApp-поля;
2. он может сохранить bot number и operator number;
3. эти номера видны в Settings;
4. эти номера видны в super-admin;
5. super-admin понимает readiness салона к подключению номера;
6. computed status работает одинаково во всех слоях;
7. валидация и conflict handling работают корректно.
