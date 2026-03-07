import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { authRoutes } from './routes/auth.js';
import { walletRoutes } from './routes/wallet.js';
import { transferRoutes } from './routes/transfer.js';
import { userRoutes } from './routes/user.js';
import { emailRoutes } from './routes/email.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';
import { priceRoutes } from './routes/price.js';
import { usernameRoutes } from './routes/username.js';
import { notificationRoutes } from './routes/notifications.js';
import { passkeyRoutes } from './routes/passkey.js';
import { passkeySessionRoutes } from './routes/passkey-session.js';
import { sessionRoutes } from './routes/session.js';
import { pinRoutes } from './routes/pin.js';
import { recoveryRoutes } from './routes/recovery.js';
import bridgeRoutes from './routes/bridge.js';
import ansRoutes from './routes/ans.js';
import agentRoutes from './routes/agent.js';
import swapRoutes from './routes/swap.js';
import adminRoutes from './routes/admin.js';
import dappRoutes from './routes/dapp.js';
import { errorHandler } from './middleware/error-handler.js';

export const server = Fastify({
  logger: false,
});

export async function initServer() {
  // CORS - allow all origins in development, specific origins in production
  await server.register(cors, {
    origin: true, // Allow all origins for now (Cloudflare tunnels change URLs)
    credentials: true,
  });

  // Global error handler
  server.setErrorHandler(errorHandler);

  // Routes
  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(walletRoutes, { prefix: '/api/wallet' });
  await server.register(transferRoutes, { prefix: '/api/transfer' });
  await server.register(userRoutes, { prefix: '/api/user' });
  await server.register(emailRoutes, { prefix: '/api/email' });
  await server.register(healthRoutes, { prefix: '/health' });
  await server.register(webhookRoutes, { prefix: '/webhook' });
  await server.register(priceRoutes, { prefix: '/api/price' });
  await server.register(usernameRoutes, { prefix: '/api/username' });
  await server.register(notificationRoutes, { prefix: '/api/notifications' });
  await server.register(passkeyRoutes, { prefix: '/api/passkey' });
  await server.register(passkeySessionRoutes, { prefix: '/api/passkey-session' });
  await server.register(sessionRoutes, { prefix: '/api/session' });
  await server.register(pinRoutes, { prefix: '/api/pin' });
  await server.register(recoveryRoutes, { prefix: '/api/recovery' });
  await server.register(bridgeRoutes, { prefix: '/api/bridge' });
  await server.register(ansRoutes, { prefix: '/api/ans' });
  await server.register(agentRoutes, { prefix: '/api/agent' });
  await server.register(swapRoutes, { prefix: '/api/swap' });
  await server.register(adminRoutes, { prefix: '/api/admin' });
  await server.register(dappRoutes, { prefix: '/api/dapp' });

  await server.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT }, 'Server started');
}
