# 40. Исправления UI (Dashboard/Settings), явная ошибка verify-email и план подключения Resend

## Цель
Устранить текущие UX-недочеты и снять неясность для пользователя при блокировке write-операций из-за неподтвержденного email.

## Проблемы
1. В `Dashboard -> Attention center` кнопки визуально "съезжают" из блока.
2. В `Settings -> FAQ` кнопка растягивается неадекватно по ширине.
3. При попытке create/update (например мастер) пользователь не понимает, что причина — неподтвержденный email.
4. Подключение Resend должно быть доведено до операционно надежного состояния (переменные, домен отправителя, наблюдаемость).

## Scope
1. UI hotfix для `Dashboard` и `Settings`.
2. Централизованный маппинг backend reason `email_verification_required_for_write_operations` в понятное сообщение.
3. Глобальный баннер в `/app` для неподтвержденного email с CTA:
- `Verify email`
- `Resend verification email`
4. План внедрения/проверки Resend в production.

## Out of Scope
1. Изменение бизнес-правил verify/read-only.
2. Редизайн всего админ-UI.
3. Рефакторинг всех backend ошибок на новые error codes.

## Реализация

### 1) UI hotfix
1. `inline-actions`:
- включить `flex-wrap` и нормальную вертикальную раскладку на узких ширинах.
2. Карточки `settings-card`:
- не растягивать CTA-кнопки на всю ширину по умолчанию;
- закрепить `justify-self: start` для `a.btn`/`button.btn` внутри карточки.
3. Прогонить проверку страниц:
- Dashboard
- Settings
- FaqSettings
- Notifications

### 2) Явная причина ошибки verify-email
1. В frontend error formatter:
- считывать `error.details.reason`.
2. Для причины
`email_verification_required_for_write_operations`
возвращать понятный текст:
- EN: "Please verify your email to create or edit data."
- IT: "Verifica la tua email per creare o modificare i dati."
3. Сохранить `requestId` в сообщении для поддержки.

### 3) Глобальный баннер verify-email в `/app`
1. В `AppLayout` при `!isEmailVerified` показать:
- основной текст read-only,
- кнопку перехода на `/email-verification`,
- кнопку resend verification email.
2. Для resend использовать текущий email из scope-контекста.
3. Показывать success/error статус отправки в баннере.

### 4) План подключения Resend (production)
1. ENV:
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `APP_URL`
2. Настройка домена отправителя:
- SPF
- DKIM
- (опционально) DMARC policy.
3. Проверки доставки:
- регистрация -> verify email приходит;
- forgot-password -> reset email приходит.
4. Наблюдаемость:
- логирование success/failure отправки verify/reset;
- алерт при серии failures.
5. Fallback:
- если Resend недоступен, API не должен "падать молча";
- пользователю контролируемый ответ + `requestId`.

## Проверки
1. `pnpm --filter @genius/web-vite run typecheck`
2. Smoke сценарий:
- unverified user в `/app`;
- попытка создать мастера -> понятная ошибка про verify;
- resend из баннера -> success/failure message;
- после verify операция create проходит.

## Definition of Done
1. В Attention center кнопки корректно отображаются на desktop/mobile.
2. В Settings FAQ CTA не растянут на пол-экрана.
3. Ошибка неподтвержденного email всегда читаема и однозначна.
4. В `/app` есть явный verify/resend UX для неподтвержденного пользователя.
5. Есть операционный checklist по Resend (переменные, DNS, проверки доставки, fallback).
