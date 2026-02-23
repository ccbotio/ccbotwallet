'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchCCPrice,
  calculateUsdValue,
  calculatePortfolioChange,
  formatUsd,
  formatPercentage,
  type PriceData,
} from '../lib/price-service';

interface UsePriceResult {
  price: number | null;
  change24h: number;
  isLoading: boolean;
  lastUpdated: Date | null;
  getUsdValue: (ccBalance: string | number) => string;
  getPortfolioChange: (ccBalance: string | number) => { usd: string; percent: string; isPositive: boolean };
  refresh: () => Promise<void>;
}

export function usePrice(refreshInterval = 60000): UsePriceResult {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPrice = useCallback(async () => {
    try {
      const data = await fetchCCPrice();
      setPriceData(data);
    } catch (error) {
      console.error('Failed to fetch CC price:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    fetchPrice();

    const interval = setInterval(fetchPrice, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchPrice, refreshInterval]);

  const getUsdValue = useCallback(
    (ccBalance: string | number): string => {
      if (!priceData) return '$0.00';
      const value = calculateUsdValue(ccBalance, priceData.price);
      return formatUsd(value);
    },
    [priceData]
  );

  const getPortfolioChange = useCallback(
    (ccBalance: string | number): { usd: string; percent: string; isPositive: boolean } => {
      if (!priceData) {
        return { usd: '$0.00', percent: '0.0%', isPositive: true };
      }

      const change = calculatePortfolioChange(ccBalance, priceData.price, priceData.change24h);
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
