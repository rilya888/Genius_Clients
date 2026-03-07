# Environment Matrix

## Environments

- development: local developers
- staging: integration validation and QA
- production: live tenant traffic

## Services by Environment

- development: web, api, bot, worker (local processes)
- staging: web, api, bot, worker, postgres, redis
- production: web, api, bot, worker, postgres, redis

## Secret Source

- development: local env files (never committed)
- staging/production: Railway secret manager

## Deployment Policy

- development: local manual
- staging: automated from main branch
- production: manual approval after staging smoke
