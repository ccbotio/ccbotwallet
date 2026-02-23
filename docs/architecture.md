# Architecture

## Overview

Canton Telegram Wallet is a monorepo project that provides a Telegram Mini App and Bot for wallet operations on the Canton network.

## Structure

```
canton-telegram-wallet/
├── apps/
│   ├── bot/          # Telegram Bot + API Server
│   └── mini-app/     # React Mini App
├── packages/
│   ├── shared/       # Shared types, utils, validation
│   ├── canton-client/# Canton Ledger API client
│   ├── crypto/       # Cryptography utilities
│   ├── eslint-config/# Shared ESLint config
│   └── typescript-config/ # Shared TS config
└── docker/           # Docker configurations
```

## Tech Stack

### Backend (Bot)
- **Runtime**: Node.js 22
- **Bot Framework**: grammy
- **HTTP Server**: Fastify
- **ORM**: Drizzle
- **Database**: PostgreSQL 16
- **Cache**: Redis
- **Queue**: BullMQ

### Frontend (Mini App)
- **Framework**: React 19
- **Build**: Vite 6
- **State**: Zustand
- **Styling**: Tailwind CSS 4
- **UI**: Radix UI

## Key Flows

### Wallet Creation
1. User sends /start command
2. Bot creates user record in DB
3. Key is derived from Telegram ID + APP_SECRET
4. Party ID is generated and stored
5. Wallet record created

### Transaction Flow
1. User initiates send via bot or mini app
2. Request validated and rate-limited
3. Transaction signed with derived key
4. Submitted to Canton Ledger
5. Status tracked via BullMQ job
6. User notified on confirmation
