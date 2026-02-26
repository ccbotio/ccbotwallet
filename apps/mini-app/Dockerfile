# Build stage
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS builder

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages packages
COPY apps/mini-app apps/mini-app

# Install dependencies (with dev dependencies for build)
RUN pnpm install --frozen-lockfile

# Build shared packages first, then mini-app with production env
RUN pnpm turbo build --filter=@repo/shared
RUN cd apps/mini-app && NODE_ENV=production pnpm build

# Production stage - serve static files with nginx
FROM nginx:alpine AS runner

# Copy custom nginx config
COPY apps/mini-app/nginx.conf /etc/nginx/conf.d/default.conf

# Copy static export from builder
COPY --from=builder /app/apps/mini-app/out /usr/share/nginx/html

# Add health check (use 127.0.0.1 to avoid IPv6 issues)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/ || exit 1

EXPOSE 3001

CMD ["nginx", "-g", "daemon off;"]
