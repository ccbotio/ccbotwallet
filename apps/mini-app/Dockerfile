# Build stage
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS builder

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages packages
COPY apps/mini-app apps/mini-app

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared packages first, then mini-app
RUN pnpm turbo build --filter=@repo/shared
RUN cd apps/mini-app && pnpm build

# Production stage
FROM base AS runner

# Install wget for health checks
RUN apk add --no-cache wget

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

WORKDIR /app

# Copy standalone output
COPY --from=builder /app/apps/mini-app/.next/standalone ./
COPY --from=builder /app/apps/mini-app/.next/static ./apps/mini-app/.next/static
COPY --from=builder /app/apps/mini-app/public ./apps/mini-app/public

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Start Next.js standalone server
CMD ["node", "apps/mini-app/server.js"]
