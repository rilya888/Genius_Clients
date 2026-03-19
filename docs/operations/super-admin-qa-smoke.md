# Super Admin QA Smoke

## Цель

Проверить ключевые сценарии супер-админки перед релизом:
- auth/session;
- edit + publish + rollback тарифов;
- CSRF и базовый security контур.

## Переменные окружения

- `SMOKE_API_URL` — базовый URL API (например, `http://localhost:8787`)
- `SMOKE_SUPER_ADMIN_SECRET` — значение `SUPER_ADMIN_LOGIN_SECRET`
- `SMOKE_SUPER_ADMIN_MUTATION=1` — обязательный флаг для мутационного flow smoke
- `SMOKE_SUPER_ADMIN_RATE_LIMIT=1` — опционально включить проверку login rate-limit

## Команды

```bash
pnpm test:super-admin
pnpm smoke:super-admin:security
SMOKE_SUPER_ADMIN_MUTATION=1 pnpm smoke:super-admin:flow
```

## Что валидирует flow smoke

1. Login по super-admin secret.
2. Изменение цены одного тарифа.
3. Проверка diff перед publish.
4. Publish новой версии.
5. Проверка, что новая версия стала актуальной.
6. Rollback к предыдущей версии и верификация восстановления цены.

## Что валидирует security smoke

1. `POST /super-admin/auth/login` без CSRF -> `403`.
2. Login с неверным secret -> `401`.
3. Login с валидным secret -> `200`.
4. State-changing endpoint без CSRF (с валидной cookie) -> `403`.
5. Опционально: rate-limit на login возвращает `429`.
