'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchCCPrice,
  fetchBTCPrice,
  calculateUsdValue,
  calculatePortfolioChange,
  formatUsd,
  formatPercentage,
  type PriceData,
} from '../lib/price-service';

export type PriceToken = 'cc' | 'btc';

interface UsePriceResult {
  price: number | null;
  change24h: number;
  isLoading: boolean;
  lastUpdated: Date | null;
  getUsdValue: (balance: string | number) => string;
  getPortfolioChange: (balance: string | number) => { usd: string; percent: string; isPositive: boolean };
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching and caching token prices.
 *
 * @param tokenOrInterval - Token type ('cc' | 'btc') or refresh interval (number for backwards compatibility)
 * @param refreshInterval - Refresh interval in ms (default: 60000)
 */
export function usePrice(
  tokenOrInterval: PriceToken | number = 'cc',
  refreshInterval = 60000
): UsePriceResult {
  // Handle backwards compatibility: if first arg is a number, it's the interval
  const token: PriceToken = typeof tokenOrInterval === 'number' ? 'cc' : tokenOrInterval;
  const interval = typeof tokenOrInterval === 'number' ? tokenOrInterval : refreshInterval;
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPrice = useCallback(async () => {
    try {
      const data = token === 'btc' ? await fetchBTCPrice() : await fetchCCPrice();
      setPriceData(data);
    } catch (error) {
      console.error(`Failed to fetch ${token.toUpperCase()} price:`, error);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Initial fetch and polling
  useEffect(() => {
    fetchPrice();

    const pollInterval = setInterval(fetchPrice, interval);
    return () => clearInterval(pollInterval);
  }, [fetchPrice, interval]);

  const getUsdValue = useCallback(
    (balance: string | number): string => {
      if (!priceData) return '$0.00';
      const value = calculateUsdValue(balance, priceData.price);
      return formatUsd(value);
    },
    [priceData]
  );

  const getPortfolioChange = useCallback(
    (balance: string | number): { usd: string; percent: string; isPositive: boolean } => {
      if (!priceData) {
        return { usd: '$0.00', percent: '0.0%', isPositive: true };
      }

      const change = calculatePortfolioChange(balance, priceData.price, priceData.change24h);
      const isPositive = change >= 0;

      return {
        usd: `${isPositive ? '+' : ''}${formatUsd(Math.abs(change))}`,
        percent: formatPercentage(priceData.change24h),
        isPositive,
      };
    },
    [priceData]
  );

  return {
    price: priceData?.price ?? null,
    change24h: priceData?.change24h ?? 0,
    isLoading,
    lastUpdated: priceData?.lastUpdated ?? null,
    getUsdValue,
    getPortfolioChange,
    refresh: fetchPrice,
  };
}
