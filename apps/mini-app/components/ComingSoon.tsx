'use client';

import { motion } from 'framer-motion';

const TELEGRAM_URL = 'https://t.me/ccbotwallet';
const X_URL = 'https://x.com/ccbotio';

export default function ComingSoon() {
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
          <div className="w-28 h-28 mx-auto rounded-3xl flex items-center justify-center bg-gradient-to-br from-[#875CFF]/20 to-[#D5A5E3]/20 border border-[#875CFF]/30">
            <img
              src="/ccbotlogo.png"
              alt="CC Bot"
              className="w-20 h-20"
            />
          </div>
        </motion.div>

        {/* Coming Soon Title */}
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-4xl font-bold mb-4 bg-gradient-to-r from-[#875CFF] to-[#D5A5E3] bg-clip-text text-transparent"
        >
          Coming Soon
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-[#FFFFFC]/60 mb-12 max-w-xs text-lg"
        >
          We&apos;re building something amazing. Stay tuned!
        </motion.p>

        {/* Social Links */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex gap-6 mb-8"
        >
          {/* Telegram */}
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[#0088cc]/20 border border-[#0088cc]/30 hover:bg-[#0088cc]/30 transition-colors"
          >
            <svg
              className="w-8 h-8 text-[#0088cc]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.154.232.169.326.016.093.036.306.019.472z"/>
            </svg>
          </a>

          {/* X (Twitter) */}
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[#FFFFFC]/10 border border-[#FFFFFC]/20 hover:bg-[#FFFFFC]/20 transition-colors"
          >
            <svg
              className="w-7 h-7 text-[#FFFFFC]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>
        </motion.div>

        {/* Follow us text */}
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-[#FFFFFC]/40 text-sm"
        >
          Follow us for updates
        </motion.p>
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
