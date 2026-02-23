import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock bot
vi.mock('../../../bot/index.js', () => ({
  bot: {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
    },
  },
}));

// Mock logger
vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock email service
vi.mock('../../email/index.js', () => ({
  emailService: {
    sendRawEmail: vi.fn().mockResolvedValue(true),
  },
}));

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendTelegramNotification', () => {
    it('should send notification successfully', async () => {
      const { sendTelegramNotification } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      const result = await sendTelegramNotification('123456', 'Test message');

      expect(result).toBe(true);
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        'Test message',
        expect.objectContaining({ parse_mode: 'Markdown' })
      );
    });

    it('should handle send failure', async () => {
      const { sendTelegramNotification } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      vi.mocked(bot.api.sendMessage).mockRejectedValueOnce(new Error('Network error'));

      const result = await sendTelegramNotification('123456', 'Test message');

      expect(result).toBe(false);
    });

    it('should use HTML parse mode when specified', async () => {
      const { sendTelegramNotification } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      await sendTelegramNotification('123456', '<b>Test</b>', { parseMode: 'HTML' });

      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        '<b>Test</b>',
        expect.objectContaining({ parse_mode: 'HTML' })
      );
    });
  });

  describe('notifyIncomingTransfer', () => {
    it('should send incoming transfer notification', async () => {
      const { notifyIncomingTransfer } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      const result = await notifyIncomingTransfer('123456', '100.5', 'party::sender123');

      expect(result).toBe(true);
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('Incoming Transfer'),
        expect.any(Object)
      );
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('100.5 CC'),
        expect.any(Object)
      );
    });

    it('should truncate long party IDs', async () => {
      const { notifyIncomingTransfer } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      const longPartyId = 'party::verylongpartyidthatshouldbetruncat123456789';
      await notifyIncomingTransfer('123456', '50', longPartyId);

      const call = vi.mocked(bot.api.sendMessage).mock.calls[0];
      const message = call?.[1] as string;

      expect(message).toContain('...');
      expect(message.length).toBeLessThan(longPartyId.length + 100);
    });
  });

  describe('notifyOutgoingTransfer', () => {
    it('should send outgoing transfer notification', async () => {
      const { notifyOutgoingTransfer } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      const result = await notifyOutgoingTransfer('123456', '25.0', 'party::receiver');

      expect(result).toBe(true);
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('Transfer Sent'),
        expect.any(Object)
      );
    });
  });

  describe('notifyWelcome', () => {
    it('should send welcome notification with commands', async () => {
      const { notifyWelcome } = await import('../index.js');
      const { bot } = await import('../../../bot/index.js');

      const result = await notifyWelcome('123456');

      expect(result).toBe(true);
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('Welcome'),
        expect.any(Object)
      );
      expect(bot.api.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('/balance'),
        expect.any(Object)
      );
    });
  });

  describe('processNotificationJob', () => {
    it('should process incoming_transfer job', async () => {
      const { processNotificationJob } = await import('../index.js');

      const jobData = {
        type: 'incoming_transfer' as const,
        telegramId: '123456',
        data: { amount: '100', fromParty: 'sender' },
      };

      await processNotificationJob(jobData);

      const { bot } = await import('../../../bot/index.js');
      expect(bot.api.sendMessage).toHaveBeenCalled();
    });

    it('should process outgoing_transfer job with email', async () => {
      const { processNotificationJob } = await import('../index.js');
      const { emailService } = await import('../../email/index.js');

      const jobData = {
        type: 'outgoing_transfer' as const,
        telegramId: '123456',
        email: 'test@example.com',
        data: { amount: '50', toParty: 'receiver' },
      };

      await processNotificationJob(jobData);

      expect(emailService.sendRawEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('50 CC'),
        expect.any(String)
      );
    });

    it('should handle unknown notification type', async () => {
      const { processNotificationJob } = await import('../index.js');
      const { logger } = await import('../../../lib/logger.js');

      const jobData = {
        type: 'unknown_type' as never,
        telegramId: '123456',
        data: {},
      };

      await processNotificationJob(jobData);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'unknown_type' }),
        'Unknown notification type'
      );
    });
  });
});
