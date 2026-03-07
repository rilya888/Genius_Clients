# ADR 0001: Foundation Stack

## Status
Accepted

## Decisions

1. Package manager: `pnpm workspaces`
- Why: fast installs, strict workspace boundaries, good monorepo support.
- Consequence: all packages/apps use shared lockfile.

2. Frontend shell: `Next.js (App Router)`
- Why: BFF pattern support, robust routing for tenant-host model.
- Consequence: browser does not call API directly.

3. API framework: `Hono`
- Why: lightweight typed routes and easy Node runtime deployment.
- Consequence: middleware and contracts will be implemented in Hono style.

4. ORM layer: `Drizzle` (package shell prepared)
- Why: typed SQL-first model and predictable migrations workflow.
- Consequence: stage 02 will add concrete schema/migrations.

5. Hosting: `Railway`
- Why: fast setup for multi-service deployment in MVP.
- Consequence: web/api/bot/worker are deployed as separate services.
