# Canton Telegram Wallet

Telegram Mini App and Bot for Canton Network wallet operations.

## Requirements

- Node.js 22+
- pnpm 9+
- Docker and Docker Compose

## Quick Start

```bash
# Clone and setup
git clone <repo>
cd canton-telegram-wallet
chmod +x scripts/setup.sh
./scripts/setup.sh

# Configure
cp .env.example .env
# Edit .env with your values

# Start development
pnpm dev
```

## Project Structure

```
├── apps/
│   ├── bot/          # Telegram Bot + API
│   └── mini-app/     # React Mini App
├── packages/
│   ├── shared/       # Shared code
│   ├── canton-client/# Canton API client
│   └── crypto/       # Cryptography utils
└── docker/           # Docker configs
```

## Scripts

```bash
pnpm dev          # Start development
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm lint         # Lint code
pnpm typecheck    # Type check
pnpm db:migrate   # Run migrations
```

## Documentation

- [Architecture](docs/architecture.md)
- [API](docs/api.md)
- [Deployment](docs/deployment.md)

## License

MIT
