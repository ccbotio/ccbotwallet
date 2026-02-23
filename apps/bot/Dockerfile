# Build stage
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS builder
# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy all packages and bot
COPY packages packages
COPY apps/bot apps/bot

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build all packages first
RUN cd packages/shared && pnpm build
RUN cd packages/crypto && pnpm build
RUN cd packages/canton-client && pnpm build

# Build bot
RUN cd apps/bot && pnpm build

# Production stage
FROM base AS runner

# Install wget for health checks
RUN apk add --no-cache wget

ENV NODE_ENV=production

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy built packages
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/crypto/package.json ./packages/crypto/package.json
COPY --from=builder /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=builder /app/packages/canton-client/package.json ./packages/canton-client/package.json
COPY --from=builder /app/packages/canton-client/dist ./packages/canton-client/dist

# Copy built bot
COPY --from=builder /app/apps/bot/dist ./apps/bot/dist
COPY --from=builder /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=builder /app/apps/bot/drizzle.config.ts ./apps/bot/drizzle.config.ts
COPY --from=builder /app/apps/bot/src/db/migrations ./apps/bot/src/db/migrations

# Install production dependencies only (ignore-scripts to skip husky)
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Set working directory
WORKDIR /app/apps/bot

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
