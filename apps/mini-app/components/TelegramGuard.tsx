'use client';

import { useEffect, useState, ReactNode } from 'react';
import Image from 'next/image';

interface TelegramGuardProps {
  children: ReactNode;
}

const BOT_URL = 'https://t.me/ccbotwallet_bot';

// Blocked platforms - web versions of Telegram
const BLOCKED_PLATFORMS = ['weba', 'webk', 'web'];

/**
 * TelegramGuard - Ensures the app is only accessible within Telegram native apps
 *
 * Allowed: ios, android, tdesktop (desktop app)
 * Blocked: weba, webk, web (browser versions)
 */
export default function TelegramGuard({ children }: TelegramGuardProps) {
  const [status, setStatus] = useState<'loading' | 'allowed' | 'blocked' | 'redirect'>(
    'loading'
  );

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 20; // Try for 2 seconds (20 x 100ms)

    const checkTelegram = () => {
      const telegram = (window as unknown as {
        Telegram?: {
          WebApp?: {
            initData?: string;
            initDataUnsafe?: { user?: unknown };
            platform?: string;
          }
        }
      }).Telegram;

      // Check for valid Telegram environment
      const hasValidInitData = telegram?.WebApp?.initData && telegram.WebApp.initData.length > 0;
      const hasUserData = telegram?.WebApp?.initDataUnsafe?.user !== undefined;
      const platform = telegram?.WebApp?.platform;

      // Debug log
      console.log('[TelegramGuard] Platform:', platform, 'InitData:', !!hasValidInitData, 'User:', !!hasUserData);

      // First check if we're in Telegram at all
      if (hasValidInitData || hasUserData || platform) {
        // ALWAYS check platform - block web versions
        if (platform && BLOCKED_PLATFORMS.includes(platform)) {
          console.log('[TelegramGuard] BLOCKED - Web platform:', platform);
          setStatus('blocked');
          return;
        }

        console.log('[TelegramGuard] ALLOWED - Platform:', platform || 'unknown');
        setStatus('allowed');
        return;
      }

      attempts++;

      // Keep trying for a bit (Telegram might be slow to initialize)
      if (attempts < maxAttempts) {
        setTimeout(checkTelegram, 100);
      } else {
        // Not in Telegram after all attempts - redirect to bot
        setStatus('redirect');
        window.location.href = BOT_URL;
      }
    };

    // Start checking after a small initial delay
    const timer = setTimeout(checkTelegram, 50);
    return () => clearTimeout(timer);
  }, []);

  // Loading state
  if (status === 'loading' || status === 'redirect') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#030206]">
        <div className="w-12 h-12 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
      </div>
    );
  }

  // Blocked - web version of Telegram
  if (status === 'blocked') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#030206] p-6 text-center">
        <Image src="/ccbotlogo.png" alt="CC Bot" width={64} height={64} className="mb-6" />

        <h1 className="text-[#FFFFFC] text-xl font-bold mb-3">
          Telegram App Required
        </h1>

        <p className="text-[#A89F91] text-sm mb-6 max-w-xs">
          For security reasons, CC Bot Wallet only works in the Telegram app.
          Please open this bot in Telegram on your phone or desktop app.
        </p>

        <div className="space-y-3 w-full max-w-xs">
          <a
            href={BOT_URL}
            className="block w-full py-3 px-6 rounded-xl font-semibold text-center"
            style={{ background: 'linear-gradient(135deg, #875CFF, #D5A5E3)' }}
          >
            Open in Telegram App
          </a>

          <p className="text-[#A89F91]/60 text-xs">
            Telegram Web is not supported
          </p>
        </div>
      </div>
    );
  }

  // Allowed - render children
  return <>{children}</>;
}
