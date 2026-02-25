'use client';

import { motion } from 'framer-motion';

/**
 * SecurityAccessDenied - Shown when accessing security.ccbot.io without valid session
 *
 * This prevents direct access to the passkey creation page.
 * Users must be redirected from the main app with a valid session.
 */
export default function SecurityAccessDenied() {
  return (
    <div className="h-full flex flex-col bg-[#030206] text-[#FFFFFC] overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(ellipse at top, rgba(239, 68, 68, 0.1), transparent 50%)'
        }}
      />

      <div className="relative flex-1 flex flex-col items-center justify-center px-6 text-center">
        {/* Shield Icon */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center bg-red-500/10 border border-red-500/30">
            <span className="material-symbols-outlined text-5xl text-red-400">
              shield
            </span>
          </div>
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-bold mb-3 text-red-400"
        >
          Access Denied
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-[#FFFFFC]/60 mb-8 max-w-xs"
        >
          This page can only be accessed through the CC Bot Wallet app
        </motion.p>

        {/* Info Box */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="p-4 rounded-xl bg-[#FFFFFC]/5 border border-[#FFFFFC]/10 mb-8 max-w-xs"
        >
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-[#875CFF] mt-0.5">info</span>
            <div className="text-left">
              <p className="text-sm text-[#FFFFFC]/80 mb-2">
                This is a secure page for passkey creation.
              </p>
              <p className="text-xs text-[#FFFFFC]/50">
                To create a passkey, please start the wallet setup process from the CC Bot Wallet app in Telegram.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Instructions */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="space-y-3 mb-8"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm text-[#875CFF]">smartphone</span>
            </div>
            <span className="text-sm text-[#FFFFFC]/70">Open CC Bot in Telegram</span>
          </div>
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm text-[#875CFF]">account_balance_wallet</span>
            </div>
            <span className="text-sm text-[#FFFFFC]/70">Start wallet creation</span>
          </div>
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-full bg-[#875CFF]/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-sm text-[#875CFF]">fingerprint</span>
            </div>
            <span className="text-sm text-[#FFFFFC]/70">You'll be redirected here</span>
          </div>
        </motion.div>

        {/* Close Button */}
        <motion.button
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          onClick={() => window.close()}
          className="w-full max-w-xs py-4 rounded-2xl font-semibold text-lg bg-[#FFFFFC]/10 text-[#FFFFFC]/80"
        >
          Close This Page
        </motion.button>
      </div>

      {/* Footer */}
      <div className="p-4 text-center">
        <p className="text-xs text-[#FFFFFC]/30">
          security.ccbot.io - Secure authentication portal
        </p>
      </div>
    </div>
  );
}
