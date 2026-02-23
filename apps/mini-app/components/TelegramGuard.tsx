'use client';

import { useEffect, useState, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface TelegramGuardProps {
  children: ReactNode;
}

/**
 * TelegramGuard - Ensures the app is only accessible within Telegram WebApp
 *
 * On app.ccbot.io:
 * - If running inside Telegram: shows children
 * - If running in regular browser: shows "Open in Telegram" screen
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
      } else if (telegram?.WebApp?.platform) {
        // Some platforms may not have initData but still have platform
        setIsInTelegram(true);
      } else {
        // Development mode bypass
        if (process.env.NODE_ENV === 'development') {
          console.log('[TelegramGuard] Development mode - bypassing check');
          setIsInTelegram(true);
        } else {
          setIsInTelegram(false);
        }
      }
      setIsLoading(false);
    };

    // Small delay to ensure Telegram SDK is loaded
    const timer = setTimeout(checkTelegram, 100);
    return () => clearTimeout(timer);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#030206]">
        <div className="w-12 h-12 rounded-full border-2 border-[#875CFF]/30 border-t-[#875CFF] animate-spin" />
      </div>
    );
  }

  // Not in Telegram - show redirect screen
  if (!isInTelegram) {
    return <TelegramOnlyScreen />;
  }

  // In Telegram - render children
  return <>{children}</>;
}

/**
 * Screen shown when user tries to access outside Telegram
 */
function TelegramOnlyScreen() {
  const botUsername = 'ccbot_wallet_bot'; // TODO: Make this configurable

  const handleOpenTelegram = () => {
    window.location.href = `https://t.me/${botUsername}`;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#030206] text-[#FFFFFC]">
      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(ellipse at top, rgba(135, 92, 255, 0.15), transparent 50%)'
        }}
      />

      <div className="relative flex-1 flex flex-col items-center justify-center px-6 text-center">
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="w-24 h-24 mx-auto rounded-3xl flex items-center justify-center bg-gradient-to-br from-[#875CFF]/20 to-[#D5A5E3]/20 border border-[#875CFF]/30">
            <img
              src="/ccbotlogo.png"
              alt="CC Bot"
              className="w-16 h-16"
            />
          </div>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-bold mb-3"
        >
          CC Bot Wallet
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-[#FFFFFC]/60 mb-8 max-w-xs"
        >
          This app can only be accessed through Telegram
        </motion.p>

        {/* Telegram Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.4, type: 'spring' }}
          className="w-20 h-20 mb-8 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0088cc, #00aaff)' }}
        >
          <svg
            className="w-10 h-10 text-white"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.154.232.169.326.016.093.036.306.019.472z"/>
          </svg>
        </motion.div>

        {/* Instructions */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="space-y-4 mb-8"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center text-sm font-bold text-[#875CFF]">
              1
            </div>
            <span className="text-sm text-[#FFFFFC]/80">Open Telegram</span>
          </div>
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center text-sm font-bold text-[#875CFF]">
              2
            </div>
            <span className="text-sm text-[#FFFFFC]/80">Search for @{botUsername}</span>
          </div>
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center text-sm font-bold text-[#875CFF]">
              3
            </div>
            <span className="text-sm text-[#FFFFFC]/80">Tap "Open App" to start</span>
          </div>
        </motion.div>

        {/* CTA Button */}
        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          onClick={handleOpenTelegram}
          className="w-full max-w-xs py-4 rounded-2xl font-semibold text-lg text-white"
          style={{ background: 'linear-gradient(135deg, #0088cc, #00aaff)' }}
        >
          Open in Telegram
        </motion.button>
      </div>

      {/* Footer */}
      <div className="p-4 text-center">
        <p className="text-xs text-[#FFFFFC]/30">
          CC Bot Wallet - Secure crypto on Canton Network
        </p>
      </div>
    </div>
  );
}
