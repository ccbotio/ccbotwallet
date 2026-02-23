import type { FastifyPluginAsync } from 'fastify';
import { walletHandlers } from '../handlers/wallet.js';
import { jwtAuthMiddleware } from '../middleware/jwt-auth.js';

export const walletRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT auth middleware to all wallet routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  fastify.post('/create', walletHandlers.createWallet);
  fastify.post('/create-with-passkey', walletHandlers.createWalletWithPasskey);
  fastify.get('/balance', walletHandlers.getBalance);
  fastify.get('/details', walletHandlers.getDetails);
  fastify.get('/transactions', walletHandlers.getTransactions);
  fastify.post('/send', walletHandlers.send);
  fastify.get('/utxos', walletHandlers.getUtxoCount);
  fastify.post('/merge', walletHandlers.mergeUtxos);
  fastify.post('/sync', walletHandlers.syncTransactions);
  fastify.post('/faucet', walletHandlers.requestFaucet);
  fastify.post('/recover', walletHandlers.recoverWallet);
};
