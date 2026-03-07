FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm --filter @genius/db run build
RUN pnpm --filter @genius/shared run build
RUN pnpm --filter @genius/api run build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=base /app/node_modules /app/node_modules
COPY --from=base /app/apps/api /app/apps/api
COPY --from=base /app/packages /app/packages

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
