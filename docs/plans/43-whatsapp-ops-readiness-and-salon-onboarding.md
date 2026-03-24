# Этап 43: WhatsApp Ops Readiness и подготовка проекта к подключению новых салонов

## Цель

Подготовить проект так, чтобы подключение нового салона к WhatsApp-боту не требовало ручного исследования кода и окружения.

После завершения этапа платформа должна иметь:

1. production-ready реестр WhatsApp-номеров;
2. явную привязку номера к tenant / salon;
3. internal routing API для бота по `phone_number_id`;
4. super-admin UI для ведения реестра;
5. multi-number-aware operational status;
6. документацию для будущих подключений по короткой команде.

## Что должно быть реализовано

### 1. Data layer

Добавить persistency для WhatsApp endpoint registry:

- реестр активных и неактивных номеров;
- тип окружения: `sandbox` / `production`;
- привязка к tenant;
- технические Meta-поля;
- операционные поля readiness;
- история изменений.

### 2. Routing layer

Реализовать internal API resolution:

- bot передает `provider + externalEndpointId`;
- API возвращает routing context;
- для WhatsApp `externalEndpointId = phone_number_id`.

### 3. Super-admin control plane

Добавить super-admin блок для WhatsApp numbers:

- список номеров;
- tenant binding;
- status;
- token source;
- token health;
- readiness flags;
- редактирование / деактивация.

### 4. Integrations readiness

Убрать single-number assumptions:

- status WhatsApp должен учитывать `WA_ACCESS_TOKEN_BY_PHONE_JSON`;
- наличие активных endpoint bindings;
- bot token health.

### 5. Documentation

Подготовить:

- расширенный playbook подключения;
- короткий command-template для будущих задач;
- checklist smoke / rollback.

## Definition of Done

Этап считается выполненным, когда:

1. в БД есть реестр WhatsApp endpoints;
2. API умеет резолвить tenant по `phone_number_id`;
3. super-admin видит и редактирует registry;
4. bot-ready status учитывает multi-number режим;
5. можно подготовить salon binding заранее, даже до фактического Meta-подключения;
6. есть отдельный `.md` с короткой инструкцией для будущих подключений.
