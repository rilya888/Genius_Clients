# Railway Environment Checklist

## Create/Verify Services

- [ ] web service exists
- [ ] api service exists
- [ ] bot service exists
- [ ] worker service exists
- [ ] postgres is provisioned
- [ ] redis is provisioned

## Configure Variables

- [ ] core variables configured (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `INTERNAL_API_SECRET`)
- [ ] integration variables configured (OpenAI, Stripe, WA, TG, Email)
- [ ] Sentry DSN configured for web/api/bot/worker

## Domain Setup

- [ ] `app.yourapp.com` mapped to web
- [ ] `api.yourapp.com` mapped to api
- [ ] `*.yourapp.com` wildcard mapped for tenant routing

## Post-Deploy Verification

- [ ] `GET /api/v1/health` returns ok
- [ ] `GET /api/v1/ready` returns ready
- [ ] worker heartbeat visible in logs
- [ ] webhook routes reachable via HTTPS
