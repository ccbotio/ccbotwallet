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
      const telegram = (window as unknown as { Telegram?: { WebApp?: { initData?: string; platform?: string } } }).Telegram;

      // Check for Telegram WebApp
      if (telegram?.WebApp?.initData && telegram.WebApp.initData.length > 0) {
        setIsInTelegram(true);
        setIsLoading(false);
      } else if (telegram?.WebApp?.platform) {
        // Some platforms may not have initData but still have platform
        setIsInTelegram(true);
        setIsLoading(false);
      } else {
        // Development mode bypass
        if (process.env.NODE_ENV === 'development') {
          console.log('[TelegramGuard] Development mode - bypassing check');
          setIsInTelegram(true);
          setIsLoading(false);
        } else {
          // Not in Telegram - redirect immediately
          window.location.href = BOT_URL;
        }
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
