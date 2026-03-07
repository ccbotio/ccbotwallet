import type { FastifyPluginAsync } from 'fastify';
import { cantonService } from '../../services/canton/index.js';
import { createLogger } from '@repo/shared/logger';

const logger = createLogger('price-api');

// Cache price for 30 seconds
let cachedPrice: { price: string; round: number; timestamp: number } | null = null;
const CACHE_TTL = 30000;

// BTC price cache (60 seconds)
let cachedBtcPrice: { price: string; change24h: string; timestamp: number } | null = null;
const BTC_CACHE_TTL = 60000;

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

  // BTC Price endpoint - fetches from CoinGecko
  fastify.get('/btc', async (_request, reply) => {
    const now = Date.now();

    // Return cached price if still valid
    if (cachedBtcPrice && now - cachedBtcPrice.timestamp < BTC_CACHE_TTL) {
      logger.debug('Returning cached BTC price', { price: cachedBtcPrice.price });
      return reply.send({
        success: true,
        data: {
          price: cachedBtcPrice.price,
          change24h: cachedBtcPrice.change24h,
          currency: 'USD',
          symbol: 'BTC',
          cached: true,
        },
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json() as {
        bitcoin: {
          usd: number;
          usd_24h_change?: number;
        };
      };

      cachedBtcPrice = {
        price: data.bitcoin.usd.toString(),
        change24h: (data.bitcoin.usd_24h_change ?? 0).toFixed(2),
        timestamp: now,
      };

      logger.debug('BTC price fetched from CoinGecko', { price: cachedBtcPrice.price });

      return reply.send({
        success: true,
        data: {
          price: cachedBtcPrice.price,
          change24h: cachedBtcPrice.change24h,
          currency: 'USD',
          symbol: 'BTC',
          cached: false,
        },
      });
    } catch (error) {
      logger.warn('BTC price fetch failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return fallback price on error
      return reply.send({
        success: true,
        data: {
          price: '97000',
          change24h: '0',
          currency: 'USD',
          symbol: 'BTC',
          fallback: true,
        },
      });
    }
  });
};
