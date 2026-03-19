FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm --filter @genius/i18n run build
RUN pnpm --filter @genius/shared run build
RUN pnpm --filter @genius/bot run build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/apps/bot /app/apps/bot
COPY --from=base /app/packages /app/packages

ENV NODE_ENV=production
EXPOSE 3002
CMD ["pnpm", "--filter", "@genius/bot", "run", "start:runtime"]
