import type { FastifyPluginAsync } from 'fastify';
import { cantonService } from '../../services/canton/index.js';

// Cache price for 30 seconds
let cachedPrice: { price: string; round: number; timestamp: number } | null = null;
const CACHE_TTL = 30000;

/**
 * Convert number to string with proper precision for financial values
 */
function toAmountString(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return value.toString();
}

export const priceRoutes: FastifyPluginAsync = async (fastify) => {
  // Public endpoint - no auth required
  fastify.get('/cc', async (_request, reply) => {
    try {
      const now = Date.now();

      // Return cached price if still valid
      if (cachedPrice && now - cachedPrice.timestamp < CACHE_TTL) {
        return reply.send({
          success: true,
          data: {
            price: cachedPrice.price,
            round: cachedPrice.round,
            currency: 'USD',
            symbol: 'CC',
            cached: true,
          },
        });
      }

      // Fetch fresh price from Canton
      const priceData = await cantonService.getCCPrice();

      // Convert price to string for precision
      const priceString = toAmountString(priceData.price) ?? '0';

      // Update cache
      cachedPrice = {
        price: priceString,
        round: priceData.round,
        timestamp: now,
      };

      return reply.send({
        success: true,
        data: {
          price: priceString,
          round: priceData.round,
          amuletPriceUsd: toAmountString(priceData.amuletPriceUsd),
          rewardRate: toAmountString(priceData.rewardRate),
          currency: 'USD',
          symbol: 'CC',
          cached: false,
        },
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to fetch CC price');

      // Return default price on error
      return reply.send({
        success: true,
        data: {
          price: '2.0',
          round: 0,
          currency: 'USD',
          symbol: 'CC',
          error: 'Using fallback price',
        },
      });
    }
  });
};
