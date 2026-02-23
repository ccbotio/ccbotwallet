/**
 * CC Price Service
 *
 * Provides CC token price data and USD calculations.
 * Fetches real price from Canton Network via backend API.
 */

import api from './api';

export interface PriceData {
  price: number;           // Current CC price in USD
  change24h: number;       // 24h change percentage
  change24hUsd: number;    // 24h change in USD (for portfolio)
  round: number;           // Current Canton round
  lastUpdated: Date;
}

// Store for tracking price history (for 24h change calculation)
let priceHistory: { timestamp: number; price: number }[] = [];
let lastFetchedPrice: number | null = null;

/**
 * Parse price from string or number (backend may return either)
 */
function parsePrice(price: string | number): number {
  if (typeof price === 'number') return price;
  const parsed = parseFloat(price);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Get 24h price change based on history
 */
function get24hChange(currentPrice: number): { percentage: number; usdChange: number } {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  // Find price from ~24h ago
  const oldPriceEntry = priceHistory.find(p => p.timestamp <= dayAgo);
  const oldPrice = oldPriceEntry?.price || lastFetchedPrice || currentPrice;

  const percentage = oldPrice > 0 ? ((currentPrice - oldPrice) / oldPrice) * 100 : 0;
  const usdChange = currentPrice - oldPrice;

  return { percentage, usdChange };
}

/**
 * Fetch current CC price data from Canton Network
 */
export async function fetchCCPrice(): Promise<PriceData> {
  try {
    // Fetch from backend API
    const priceData = await api.getCCPrice();

    // Parse price as number (API returns string for precision)
    const price = parsePrice(priceData.price);
    const round = priceData.round || 0;

    // Record in history for 24h change tracking
    const now = Date.now();
    priceHistory.push({ timestamp: now, price });

    // Keep only last 24h + buffer
    const cutoff = now - 25 * 60 * 60 * 1000;
    priceHistory = priceHistory.filter(p => p.timestamp > cutoff);

    // Store for reference
    if (lastFetchedPrice === null) {
      lastFetchedPrice = price;
    }

    const { percentage, usdChange } = get24hChange(price);

    return {
      price,
      change24h: percentage,
      change24hUsd: usdChange,
      round,
      lastUpdated: new Date(),
    };
  } catch (error) {
    console.error('Failed to fetch CC price from API:', error);

    // Return fallback values
    return {
      price: lastFetchedPrice || 2.0,
      change24h: 0,
      change24hUsd: 0,
      round: 0,
      lastUpdated: new Date(),
    };
  }
}

/**
 * Calculate USD value of CC balance
 */
export function calculateUsdValue(ccBalance: string | number, price: number): number {
  const balance = typeof ccBalance === 'string' ? parseFloat(ccBalance) : ccBalance;
  return balance * price;
}

/**
 * Calculate portfolio change in USD
 */
export function calculatePortfolioChange(
  ccBalance: string | number,
  price: number,
  change24hPercent: number
): number {
  const balance = typeof ccBalance === 'string' ? parseFloat(ccBalance) : ccBalance;
  const currentValue = balance * price;
  const previousValue = currentValue / (1 + change24hPercent / 100);
  return currentValue - previousValue;
}

/**
 * Format USD value
 */
export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format percentage change
 */
export function formatPercentage(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}
