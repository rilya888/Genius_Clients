FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/web-vite/package.json apps/web-vite/package.json
COPY packages/i18n/package.json packages/i18n/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm --filter @genius/i18n run build
RUN pnpm --filter @genius/web run build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/apps/web /app/apps/web
COPY --from=base /app/apps/web-vite /app/apps/web-vite
COPY --from=base /app/packages /app/packages

ENV NODE_ENV=production
EXPOSE 4173
CMD ["pnpm", "--filter", "@genius/web", "run", "start"]
