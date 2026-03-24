# Командный шаблон для подключения нового салона к WhatsApp-боту

## Как ставить задачу

Пиши в таком формате:

- салон: `Название салона`
- tenant slug: `tenant-slug`
- tenant id: `если есть`
- номер: `+39...`
- display name: `...`
- план: `starter | pro | business | enterprise`
- язык: `it | en`
- часовой пояс: `Europe/Rome`
- страна номера: `Italy`
- контакт для verification code: `имя / телефон`
- номер новый и не используется как обычный WhatsApp: `да`

## Короткая команда для запуска работы

Используй такой текст:

`Подключи WhatsApp-номер для салона. Салон: ... Tenant slug: ... Tenant id: ... Номер: ... Display name: ... План: ... Язык: ... Часовой пояс: ... Страна: ... Контакт для verification code: ... Номер новый и не используется как обычный WhatsApp: да. Используй playbook из docs/plans/42-whatsapp-salon-number-connection-playbook.md и registry из super-admin.`

## Что должен сделать исполнитель

1. Проверить tenant и plan.
2. Открыть Meta App `GeniusClients`.
3. Добавить номер в нужный WABA.
4. Получить `phone_number_id`.
5. Проверить webhook и `messages` subscription.
6. Обновить token mapping в Railway.
7. Создать или обновить WhatsApp endpoint binding в super-admin registry.
8. Проверить internal routing по `phone_number_id`.
9. Прогнать inbound/outbound smoke.
10. Зафиксировать результат и возможные ограничения.

## Что может потребовать твоего вмешательства

1. Ввод SMS/voice verification code.
2. Подтверждение display name, если Meta его отклоняет.
3. Решение по rollback, если номер не проходит verification или routing.

## Что должно быть в результате ответа

1. Какой номер подключен.
2. Какой `phone_number_id` получен.
3. К какому tenant он привязан.
4. Обновлены ли env и registry.
5. Прошел ли smoke.
6. Нужны ли еще действия с твоей стороны.
