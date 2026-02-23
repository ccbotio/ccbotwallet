'use client';

import { useEffect, useState, ReactNode } from 'react';

interface TelegramGuardProps {
  children: ReactNode;
}

const BOT_URL = 'https://t.me/ccbot_wallet_bot';

/**
 * TelegramGuard - Ensures the app is only accessible within Telegram WebApp
 *
 * On app.ccbot.io:
 * - If running inside Telegram: shows children
 * - If running in regular browser: redirects to Telegram bot
 */
export default function TelegramGuard({ children }: TelegramGuardProps) {
  const [isInTelegram, setIsInTelegram] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if running inside Telegram WebApp
    const checkTelegram = () => {
      const telegram = (window as unknown as { Telegram?: { WebApp?: { initData?: string; initDataUnsafe?: { user?: unknown } } } }).Telegram;

      // Only valid if initData has actual content (not empty string)
      // initData is only populated when running inside Telegram
      const hasValidInitData = telegram?.WebApp?.initData && telegram.WebApp.initData.length > 0;
      const hasUserData = telegram?.WebApp?.initDataUnsafe?.user !== undefined;

      if (hasValidInitData || hasUserData) {
        setIsInTelegram(true);
        setIsLoading(false);
      } else {
        // Not in Telegram - redirect to bot
        window.location.href = BOT_URL;
      }
    };

    // Small delay to ensure Telegram SDK is loaded
    const timer = setTimeout(checkTelegram, 100);
    return () => clearTimeout(timer);
  }, []);

  // Loading state (also shown briefly before redirect)
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030206]">
        <div className="w-12 h-12 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
      </div>
    );
  }

  // In Telegram - render children
  return <>{children}</>;
}
