/**
 * Phase 31: Type Safety Tests
 *
 * Tests for Zod schema validation and type-safe parameter parsing.
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  sendCCParamsSchema,
  swapParamsSchema,
  parseSendCCParams,
  parseSwapParams,
} from '../../src/services/ai-agent/types.js';

describe('Type Safety - AI Agent Params', () => {
  describe('sendCCParamsSchema', () => {
    it('should validate valid send params', () => {
      const validParams = {
        amount: '10.5',
        recipient: 'party123::namespace',
      };

      const result = sendCCParamsSchema.parse(validParams);

      expect(result.amount).toBe('10.5');
      expect(result.recipient).toBe('party123::namespace');
      expect(result.memo).toBeUndefined();
    });

    it('should accept optional memo', () => {
      const paramsWithMemo = {
        amount: '5',
        recipient: '@alice.canton',
        memo: 'Payment for coffee',
      };

      const result = sendCCParamsSchema.parse(paramsWithMemo);

      expect(result.memo).toBe('Payment for coffee');
    });

    it('should reject missing amount', () => {
      const invalidParams = {
        recipient: 'party123',
      };

      expect(() => sendCCParamsSchema.parse(invalidParams)).toThrow(ZodError);
    });

    it('should reject missing recipient', () => {
      const invalidParams = {
        amount: '10',
      };

      expect(() => sendCCParamsSchema.parse(invalidParams)).toThrow(ZodError);
    });

    it('should reject non-string amount', () => {
      const invalidParams = {
        amount: 10, // number instead of string
        recipient: 'party123',
      };

      expect(() => sendCCParamsSchema.parse(invalidParams)).toThrow(ZodError);
    });
  });

  describe('swapParamsSchema', () => {
    it('should validate valid swap params', () => {
      const validParams = {
        fromToken: 'CC',
        toToken: 'USDCx',
        amount: '100',
      };

      const result = swapParamsSchema.parse(validParams);

      expect(result.fromToken).toBe('CC');
      expect(result.toToken).toBe('USDCx');
      expect(result.amount).toBe('100');
    });

    it('should reject missing fromToken', () => {
      const invalidParams = {
        toToken: 'USDCx',
        amount: '100',
      };

      expect(() => swapParamsSchema.parse(invalidParams)).toThrow(ZodError);
    });

    it('should reject missing toToken', () => {
      const invalidParams = {
        fromToken: 'CC',
        amount: '100',
      };

      expect(() => swapParamsSchema.parse(invalidParams)).toThrow(ZodError);
    });

    it('should reject missing amount', () => {
      const invalidParams = {
        fromToken: 'CC',
        toToken: 'USDCx',
      };

      expect(() => swapParamsSchema.parse(invalidParams)).toThrow(ZodError);
    });
  });

  describe('parseSendCCParams', () => {
    it('should parse valid params from unknown record', () => {
      const rawParams: Record<string, unknown> = {
        amount: '25.5',
        recipient: 'party::ns',
        memo: 'test',
      };

      const result = parseSendCCParams(rawParams);

      expect(result.amount).toBe('25.5');
      expect(result.recipient).toBe('party::ns');
      expect(result.memo).toBe('test');
    });

    it('should throw ZodError for invalid params', () => {
      const rawParams: Record<string, unknown> = {
        amount: 123, // wrong type
        recipient: 'party',
      };

      expect(() => parseSendCCParams(rawParams)).toThrow(ZodError);
    });

    it('should throw ZodError for empty object', () => {
      const rawParams: Record<string, unknown> = {};

      expect(() => parseSendCCParams(rawParams)).toThrow(ZodError);
    });
  });

  describe('parseSwapParams', () => {
    it('should parse valid params from unknown record', () => {
      const rawParams: Record<string, unknown> = {
        fromToken: 'CC',
        toToken: 'USDCx',
        amount: '50',
      };

      const result = parseSwapParams(rawParams);

      expect(result.fromToken).toBe('CC');
      expect(result.toToken).toBe('USDCx');
      expect(result.amount).toBe('50');
    });

    it('should throw ZodError for invalid params', () => {
      const rawParams: Record<string, unknown> = {
        fromToken: 'CC',
        // missing toToken and amount
      };

      expect(() => parseSwapParams(rawParams)).toThrow(ZodError);
    });

    it('should throw for non-string token values', () => {
      const rawParams: Record<string, unknown> = {
        fromToken: 1,
        toToken: 2,
        amount: '100',
      };

      expect(() => parseSwapParams(rawParams)).toThrow(ZodError);
    });
  });
});

describe('Type Safety - Bridge Status', () => {
  // Import the bridge status enum to verify it matches service type
  it('should have all valid BridgeStatus values', async () => {
    // Dynamically import to test the const array
    const { BRIDGE_STATUS_VALUES } = await import('../../src/api/routes/bridge.js');

    // Verify all required statuses are present
    const expectedStatuses = [
      'deposit_initiated',
      'eth_tx_pending',
      'eth_tx_confirmed',
      'attestation_pending',
      'attestation_received',
      'mint_pending',
      'mint_completed',
      'withdrawal_initiated',
      'burn_pending',
      'burn_completed',
      'eth_release_pending',
      'eth_release_completed',
      'completed',
      'failed',
    ];

    expect(BRIDGE_STATUS_VALUES).toEqual(expectedStatuses);
  });
});
