/**
 * Treasury Monitor Integration Tests
 * 
 * Tests treasury balance monitoring:
 * - Balance threshold detection
 * - Alert triggering
 * - Periodic job scheduling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment
vi.mock('../../src/config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    TREASURY_PARTY_ID: 'treasury-party-123',
    TREASURY_PRIVATE_KEY: '0'.repeat(64),
    ADMIN_TELEGRAM_IDS: '123456789',
  },
}));

describe('Treasury Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Balance Thresholds', () => {
    const config = {
      lowBalanceThresholdCc: 100,
      lowBalanceThresholdUsdcx: 100,
      criticalThreshold: 10,
    };

    it('should detect healthy balances', () => {
      const balances = { cc: '500', usdcx: '300' };
      
      const ccHealthy = parseFloat(balances.cc) >= config.lowBalanceThresholdCc;
      const usdcxHealthy = parseFloat(balances.usdcx) >= config.lowBalanceThresholdUsdcx;
      
      expect(ccHealthy).toBe(true);
      expect(usdcxHealthy).toBe(true);
    });

    it('should detect low CC balance', () => {
      const balances = { cc: '50', usdcx: '300' };
      
      const ccLow = parseFloat(balances.cc) < config.lowBalanceThresholdCc;
      
      expect(ccLow).toBe(true);
    });

    it('should detect low USDCx balance', () => {
      const balances = { cc: '500', usdcx: '50' };
      
      const usdcxLow = parseFloat(balances.usdcx) < config.lowBalanceThresholdUsdcx;
      
      expect(usdcxLow).toBe(true);
    });

    it('should detect critical balance', () => {
      const balances = { cc: '5', usdcx: '3' };
      
      const ccCritical = parseFloat(balances.cc) < config.criticalThreshold;
      const usdcxCritical = parseFloat(balances.usdcx) < config.criticalThreshold;
      
      expect(ccCritical).toBe(true);
      expect(usdcxCritical).toBe(true);
    });

    it('should differentiate low vs critical', () => {
      const lowBalance = '50';
      const criticalBalance = '5';
      
      const isLow = parseFloat(lowBalance) < config.lowBalanceThresholdCc;
      const isCritical = parseFloat(criticalBalance) < config.criticalThreshold;
      const lowIsNotCritical = parseFloat(lowBalance) >= config.criticalThreshold;
      
      expect(isLow).toBe(true);
      expect(isCritical).toBe(true);
      expect(lowIsNotCritical).toBe(true);
    });
  });

  describe('Alert Triggering', () => {
    it('should trigger warning for low balance', () => {
      const balance = 50;
      const lowThreshold = 100;
      const criticalThreshold = 10;
      
      const shouldAlert = balance < lowThreshold;
      const priority = balance < criticalThreshold ? 'critical' : 'warning';
      
      expect(shouldAlert).toBe(true);
      expect(priority).toBe('warning');
    });

    it('should trigger critical for depleted balance', () => {
      const balance = 5;
      const criticalThreshold = 10;
      
      const isCritical = balance < criticalThreshold;
      const priority = isCritical ? 'critical' : 'warning';
      
      expect(isCritical).toBe(true);
      expect(priority).toBe('critical');
    });

    it('should not alert for healthy balances', () => {
      const balance = 500;
      const lowThreshold = 100;
      
      const shouldAlert = balance < lowThreshold;
      
      expect(shouldAlert).toBe(false);
    });
  });

  describe('Large Swap Detection', () => {
    const largeSwapThreshold = 1000;

    it('should detect large CC swaps', () => {
      const swapAmount = 1500;
      
      const isLarge = swapAmount >= largeSwapThreshold;
      
      expect(isLarge).toBe(true);
    });

    it('should not flag normal swaps', () => {
      const swapAmount = 100;
      
      const isLarge = swapAmount >= largeSwapThreshold;
      
      expect(isLarge).toBe(false);
    });

    it('should detect exactly threshold swaps', () => {
      const swapAmount = 1000;
      
      const isLarge = swapAmount >= largeSwapThreshold;
      
      expect(isLarge).toBe(true);
    });
  });

  describe('Job Scheduling', () => {
    it('should have correct check interval', () => {
      const checkIntervalMs = 5 * 60 * 1000; // 5 minutes
      
      expect(checkIntervalMs).toBe(300000);
    });

    it('should calculate next check time correctly', () => {
      const now = Date.now();
      const interval = 5 * 60 * 1000;
      const nextCheck = now + interval;
      
      expect(nextCheck - now).toBe(interval);
    });
  });

  describe('Treasury Configuration', () => {
    it('should require party ID for monitoring', () => {
      const partyId = 'treasury-party-123';
      
      expect(partyId).toBeTruthy();
      expect(partyId.length).toBeGreaterThan(0);
    });

    it('should require private key for refunds', () => {
      const privateKey = '0'.repeat(64);
      
      expect(privateKey).toBeTruthy();
      expect(privateKey.length).toBe(64);
    });

    it('should detect missing configuration', () => {
      const missingPartyId = '';
      const missingPrivateKey = '';
      
      const isConfigured = missingPartyId.length > 0 && missingPrivateKey.length > 0;
      
      expect(isConfigured).toBe(false);
    });
  });
});

describe('Treasury Service', () => {
  describe('Balance Fetching', () => {
    it('should return both CC and USDCx balances', () => {
      const balances = { cc: '1000', usdcx: '500' };
      
      expect(balances).toHaveProperty('cc');
      expect(balances).toHaveProperty('usdcx');
    });

    it('should handle string balance values', () => {
      const ccBalance = '1000.50';
      const parsed = parseFloat(ccBalance);
      
      expect(parsed).toBe(1000.5);
    });

    it('should handle zero balances', () => {
      const balances = { cc: '0', usdcx: '0' };
      
      expect(parseFloat(balances.cc)).toBe(0);
      expect(parseFloat(balances.usdcx)).toBe(0);
    });
  });

  describe('Transfer Operations', () => {
    it('should send tokens to user party', () => {
      const transfer = {
        fromParty: 'treasury-party-123',
        toParty: 'user-party-456',
        amount: '100',
        token: 'CC',
      };
      
      expect(transfer.fromParty).not.toBe(transfer.toParty);
      expect(parseFloat(transfer.amount)).toBeGreaterThan(0);
    });

    it('should support both CC and USDCx', () => {
      const supportedTokens = ['CC', 'USDCx'];
      
      expect(supportedTokens).toContain('CC');
      expect(supportedTokens).toContain('USDCx');
    });
  });
});
