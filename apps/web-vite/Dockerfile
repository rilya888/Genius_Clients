FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web-vite/package.json apps/web-vite/package.json
COPY packages/i18n/package.json packages/i18n/package.json
RUN pnpm install --no-frozen-lockfile --prod=false

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @genius/web-vite run build:prerender

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /app/apps/web-vite ./apps/web-vite
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 4173
CMD ["pnpm", "--filter", "@genius/web-vite", "run", "start"]
