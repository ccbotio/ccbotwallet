import { randomBytes } from 'crypto';
import { writeFileSync, existsSync } from 'fs';

function generateSecret(length: number): string {
  return randomBytes(length).toString('hex');
}

function main() {
  if (existsSync('.env')) {
    console.log('.env already exists. Skipping.');
    return;
  }

  const appSecret = generateSecret(32);
  const encryptionKey = generateSecret(32);

  const envContent = `# App
NODE_ENV=development
LOG_LEVEL=debug

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=${generateSecret(16)}
TELEGRAM_MINI_APP_URL=http://localhost:5173

# Database
DATABASE_URL=postgresql://canton:canton_dev_pass@localhost:5432/canton_wallet
REDIS_URL=redis://localhost:6379

# Canton Network
CANTON_NETWORK=devnet
CANTON_LEDGER_API_URL=
CANTON_PARTICIPANT_ID=

# Security
APP_SECRET=${appSecret}
ENCRYPTION_KEY=${encryptionKey}

# External Services
BOTBASHER_API_KEY=
NOVES_API_KEY=
`;

  writeFileSync('.env', envContent);
  console.log('.env file generated successfully');
}

main();
