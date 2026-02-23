# Deployment Guide

## Prerequisites

- Docker and Docker Compose v2+
- Domain name with DNS configured
- Telegram Bot Token (from @BotFather)
- Access to Canton Network validator

## Quick Start

```bash
# 1. Clone and setup
git clone <repo>
cd canton-telegram-wallet

# 2. Configure environment
cp docker/.env.production.example docker/.env.production
# Edit docker/.env.production with your values

# 3. Setup SSL (self-signed for testing)
./scripts/deploy.sh ssl

# 4. Deploy
./scripts/deploy.sh up
```

## Environment Configuration

Copy `docker/.env.production.example` to `docker/.env.production` and configure:

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_USER` | PostgreSQL username | `ccbot` |
| `DB_PASSWORD` | PostgreSQL password | Strong random password |
| `DB_NAME` | Database name | `canton_wallet` |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | `1234567890:ABC...` |
| `TELEGRAM_WEBHOOK_URL` | Your domain + /webhook | `https://wallet.example.com/webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | Random secret for verification | `openssl rand -hex 32` |
| `TELEGRAM_MINI_APP_URL` | Your domain | `https://wallet.example.com` |
| `APP_SECRET` | JWT signing secret (128 hex chars) | `openssl rand -hex 64` |
| `ENCRYPTION_KEY` | Shamir share encryption (64 hex chars) | `openssl rand -hex 32` |

### Canton Network Variables

| Variable | Description |
|----------|-------------|
| `CANTON_NETWORK` | `devnet`, `testnet`, or `mainnet` |
| `CANTON_LEDGER_API_URL` | Canton JSON Ledger API URL |
| `CANTON_VALIDATOR_API_URL` | Canton Validator API URL |
| `CANTON_PARTICIPANT_ID` | Your party hint |
| `CANTON_LEDGER_API_USER` | Ledger API user (default: `ledger-api-user`) |
| `CANTON_VALIDATOR_AUDIENCE` | JWT audience for validator |

## Deployment Commands

The `deploy.sh` script provides all deployment operations:

```bash
# Start all services
./scripts/deploy.sh up

# Stop all services
./scripts/deploy.sh down

# Restart services
./scripts/deploy.sh restart

# View logs (all services)
./scripts/deploy.sh logs

# View specific service logs
./scripts/deploy.sh logs bot

# Check service status
./scripts/deploy.sh status

# Build/rebuild images
./scripts/deploy.sh build

# Run database migrations
./scripts/deploy.sh migrate

# Setup SSL certificates
./scripts/deploy.sh ssl
```

## SSL Certificates

### Self-Signed (Testing)

```bash
./scripts/deploy.sh ssl
```

### Let's Encrypt (Production)

```bash
# Stop nginx first (port 80 needed)
docker stop ccbot-nginx

# Get certificate
./scripts/setup-ssl.sh -d wallet.example.com -e admin@example.com

# Restart services
./scripts/deploy.sh restart
```

### Manual SSL

Place your certificates in `docker/nginx/ssl/`:
- `fullchain.pem` - Full certificate chain
- `privkey.pem` - Private key

## Telegram Webhook Setup

After deployment, set up the webhook:

```bash
# Set webhook
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/webhook",
    "secret_token": "YOUR_WEBHOOK_SECRET"
  }'

# Verify webhook
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## Architecture

```
                    ┌─────────────┐
                    │   Internet  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Nginx    │ :80, :443
                    │  (SSL/TLS)  │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
   ┌─────▼─────┐    ┌──────▼──────┐   ┌─────▼─────┐
   │ Mini App  │    │   Bot API   │   │  Webhook  │
   │  (React)  │    │  (Fastify)  │   │ (Telegram)│
   └───────────┘    └──────┬──────┘   └───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌───▼───┐ ┌──────▼──────┐
       │  PostgreSQL │ │ Redis │ │   Canton    │
       │  (Database) │ │(Cache)│ │  (Network)  │
       └─────────────┘ └───────┘ └─────────────┘
```

## Monitoring

### Health Check

```bash
curl https://your-domain.com/health
```

Response:
```json
{
  "status": "healthy",
  "checks": {
    "redis": "ok",
    "server": "ok"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Logs

```bash
# All logs
./scripts/deploy.sh logs

# Specific service
./scripts/deploy.sh logs bot
./scripts/deploy.sh logs nginx
./scripts/deploy.sh logs postgres

# Nginx access logs
docker exec ccbot-nginx cat /var/log/nginx/access.log
```

### Service Status

```bash
./scripts/deploy.sh status
```

## Backup & Restore

### Database Backup

```bash
# Backup
docker exec ccbot-postgres pg_dump -U $DB_USER $DB_NAME > backup.sql

# Restore
docker exec -i ccbot-postgres psql -U $DB_USER $DB_NAME < backup.sql
```

### Full Data Backup

```bash
# Stop services
./scripts/deploy.sh down

# Backup volumes
docker run --rm -v canton-telegram-wallet_postgres_data:/data -v $(pwd):/backup \
  alpine tar cvf /backup/postgres_backup.tar /data

docker run --rm -v canton-telegram-wallet_redis_data:/data -v $(pwd):/backup \
  alpine tar cvf /backup/redis_backup.tar /data

# Start services
./scripts/deploy.sh up
```

## Troubleshooting

### Services won't start

```bash
# Check logs
./scripts/deploy.sh logs

# Check container status
docker ps -a

# Verify environment
docker compose -f docker/docker-compose.prod.yml config
```

### Database connection issues

```bash
# Test database connection
docker exec ccbot-api sh -c 'wget -q -O- http://localhost:3000/health'

# Check PostgreSQL
docker exec ccbot-postgres pg_isready -U $DB_USER
```

### Webhook not working

```bash
# Check webhook info
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"

# Check nginx logs
docker exec ccbot-nginx cat /var/log/nginx/error.log

# Test webhook endpoint
curl -X POST https://your-domain.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### SSL certificate issues

```bash
# Check certificate
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Check nginx SSL config
docker exec ccbot-nginx nginx -t
```

## Security Checklist

- [ ] Strong, unique passwords in `.env.production`
- [ ] SSL certificate installed and valid
- [ ] Webhook secret configured
- [ ] Rate limiting enabled in nginx
- [ ] Firewall rules (only 80, 443 open)
- [ ] Regular backups configured
- [ ] Log rotation configured
- [ ] Monitoring alerts set up
