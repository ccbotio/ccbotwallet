#!/bin/bash
set -e

echo "Setting up Canton Telegram Wallet..."

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "Error: Node.js 22+ required. Current: $(node -v)"
  exit 1
fi

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm@9
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Copy environment file
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "Please update .env with your configuration"
fi

# Setup husky
echo "Setting up git hooks..."
pnpm prepare

# Start Docker services
echo "Starting Docker services..."
docker compose -f docker/docker-compose.yml up -d

# Wait for services
echo "Waiting for services to be ready..."
sleep 5

# Run migrations
echo "Running database migrations..."
pnpm db:migrate

echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update .env with your Telegram bot token"
echo "2. Run 'pnpm dev' to start development"
