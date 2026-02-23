'use client';

import { useEffect, useState, ReactNode } from 'react';

interface TelegramGuardProps {
  children: ReactNode;
}

const BOT_URL = 'https://t.me/ccbotwallet_bot';

/**
 * TelegramGuard - Ensures the app is only accessible within Telegram WebApp
 *
 * On app.ccbot.io:
 * - If running inside Telegram: shows children
 * - If running in regular browser: redirects to Telegram bot
 */
export default function TelegramGuard({ children }: TelegramGuardProps) {
  const [isInTelegram, setIsInTelegram] = useState<boolean | null>(null);

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
      const hasPlatform = telegram?.WebApp?.platform !== undefined;

      if (hasValidInitData || hasUserData || hasPlatform) {
        setIsInTelegram(true);
        return;
      }

      attempts++;

      // Keep trying for a bit (Telegram Web might be slow)
      if (attempts < maxAttempts) {
        setTimeout(checkTelegram, 100);
      } else {
        // Not in Telegram after all attempts - redirect to bot
        window.location.href = BOT_URL;
      }
    };

    // Start checking after a small initial delay
    const timer = setTimeout(checkTelegram, 50);
    return () => clearTimeout(timer);
  }, []);

  // Loading state
  if (isInTelegram === null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#030206]">
        <div className="w-12 h-12 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
      </div>
    );
  }

  // In Telegram - render children
  return <>{children}</>;
}
