"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import QRCode from "react-qr-code";
import api from "../lib/api";
import { WalletProvider, useWalletContext } from "../context/WalletContext";
import { SecurityProvider, useSecurity } from "../context/SecurityContext";
import { ShieldCheck, KeyRound, Network } from "lucide-react";
import { usePrice } from "../hooks/usePrice";
import PasskeySetup from "../components/PasskeySetup";
import PasskeySetupWithWallet from "../components/PasskeySetupWithWallet";
import PasskeySetupMandatory from "../components/PasskeySetupMandatory";
import PasskeyRecovery from "../components/PasskeyRecovery";
import { clearLockState } from "../hooks/useActivityTracker";
import TelegramGuard from "../components/TelegramGuard";
import { isProduction } from "../lib/config";
import { readClipboard, extractDigits, hapticSuccess, hapticLight, hapticError } from "../lib/clipboard";
import { setupKeyboardListeners } from "../lib/keyboard";

// ==================== STARS (pre-computed space/sky effect) ====================
// Tiny twinkling stars
const STARS_TINY = [
  { left: 3, top: 8, size: 1, color: "#FFFFFC", duration: 3, delay: 0 },
  { left: 7, top: 22, size: 1, color: "#FFFFFC", duration: 4, delay: 0.5 },
  { left: 12, top: 5, size: 1, color: "#FFFFFC", duration: 3.5, delay: 1 },
  { left: 18, top: 35, size: 1, color: "#FFFFFC", duration: 2.8, delay: 0.3 },
  { left: 23, top: 12, size: 1, color: "#FFFFFC", duration: 4.2, delay: 1.5 },
  { left: 28, top: 48, size: 1, color: "#FFFFFC", duration: 3.2, delay: 0.8 },
  { left: 33, top: 28, size: 1, color: "#FFFFFC", duration: 3.8, delay: 2 },
  { left: 38, top: 62, size: 1, color: "#FFFFFC", duration: 2.5, delay: 0.2 },
  { left: 43, top: 18, size: 1, color: "#FFFFFC", duration: 4.5, delay: 1.2 },
  { left: 48, top: 72, size: 1, color: "#FFFFFC", duration: 3, delay: 0.7 },
  { left: 53, top: 42, size: 1, color: "#FFFFFC", duration: 3.6, delay: 1.8 },
  { left: 58, top: 8, size: 1, color: "#FFFFFC", duration: 4, delay: 0.4 },
  { left: 63, top: 55, size: 1, color: "#FFFFFC", duration: 2.7, delay: 2.2 },
  { left: 68, top: 32, size: 1, color: "#FFFFFC", duration: 3.4, delay: 0.9 },
  { left: 73, top: 78, size: 1, color: "#FFFFFC", duration: 4.3, delay: 1.6 },
  { left: 78, top: 15, size: 1, color: "#FFFFFC", duration: 3.1, delay: 0.1 },
  { left: 83, top: 65, size: 1, color: "#FFFFFC", duration: 3.9, delay: 2.5 },
  { left: 88, top: 38, size: 1, color: "#FFFFFC", duration: 2.9, delay: 1.1 },
  { left: 93, top: 85, size: 1, color: "#FFFFFC", duration: 4.1, delay: 0.6 },
  { left: 97, top: 25, size: 1, color: "#FFFFFC", duration: 3.3, delay: 1.9 },
  { left: 5, top: 92, size: 1, color: "#FFFFFC", duration: 3.7, delay: 2.3 },
  { left: 15, top: 58, size: 1, color: "#FFFFFC", duration: 2.6, delay: 0.15 },
  { left: 35, top: 88, size: 1, color: "#FFFFFC", duration: 4.4, delay: 1.4 },
  { left: 55, top: 95, size: 1, color: "#FFFFFC", duration: 3.05, delay: 2.1 },
  { left: 75, top: 52, size: 1, color: "#FFFFFC", duration: 3.85, delay: 0.85 },
];

// Small colored stars
const STARS_SMALL = [
  { left: 10, top: 15, size: 1.5, color: "#F3FF97", duration: 5, delay: 0 },
  { left: 22, top: 42, size: 1.5, color: "#D5A5E3", duration: 6, delay: 1 },
  { left: 35, top: 8, size: 1.5, color: "#875CFF", duration: 5.5, delay: 0.5 },
  { left: 47, top: 68, size: 1.5, color: "#F3FF97", duration: 4.8, delay: 1.5 },
  { left: 58, top: 25, size: 1.5, color: "#D5A5E3", duration: 6.2, delay: 0.8 },
  { left: 70, top: 82, size: 1.5, color: "#875CFF", duration: 5.3, delay: 2 },
  { left: 82, top: 45, size: 1.5, color: "#F3FF97", duration: 5.8, delay: 0.3 },
  { left: 92, top: 12, size: 1.5, color: "#D5A5E3", duration: 4.5, delay: 1.2 },
  { left: 8, top: 75, size: 1.5, color: "#875CFF", duration: 6.5, delay: 2.2 },
  { left: 42, top: 92, size: 1.5, color: "#F3FF97", duration: 5.2, delay: 0.7 },
  { left: 65, top: 5, size: 1.5, color: "#D5A5E3", duration: 5.7, delay: 1.8 },
  { left: 28, top: 55, size: 1.5, color: "#875CFF", duration: 4.9, delay: 2.5 },
];

// Medium bright stars
const STARS_MEDIUM = [
  { left: 15, top: 20, size: 2, color: "#F3FF97", duration: 8, delay: 0, glow: true },
  { left: 40, top: 35, size: 2, color: "#D5A5E3", duration: 9, delay: 1.5, glow: true },
  { left: 65, top: 60, size: 2, color: "#875CFF", duration: 7.5, delay: 0.8, glow: true },
  { left: 88, top: 28, size: 2, color: "#F3FF97", duration: 8.5, delay: 2, glow: true },
  { left: 25, top: 78, size: 2, color: "#D5A5E3", duration: 7, delay: 1, glow: true },
  { left: 52, top: 12, size: 2, color: "#875CFF", duration: 9.5, delay: 2.5, glow: true },
  { left: 78, top: 88, size: 2, color: "#F3FF97", duration: 8.2, delay: 0.5, glow: true },
  { left: 5, top: 45, size: 2, color: "#D5A5E3", duration: 7.8, delay: 1.8, glow: true },
];

// Large bright stars (rare)
const STARS_LARGE = [
  { left: 20, top: 30, size: 2.5, color: "#F3FF97", duration: 10, delay: 0, glow: true },
  { left: 75, top: 70, size: 2.5, color: "#D5A5E3", duration: 12, delay: 2, glow: true },
  { left: 50, top: 15, size: 2.5, color: "#875CFF", duration: 11, delay: 1, glow: true },
  { left: 85, top: 50, size: 2.5, color: "#FFFFFC", duration: 10.5, delay: 1.5, glow: true },
];

// Shooting stars (moving across screen)
const SHOOTING_STARS = [
  { startLeft: -5, startTop: 20, size: 2, color: "#F3FF97", duration: 4, delay: 5 },
  { startLeft: -5, startTop: 60, size: 1.5, color: "#D5A5E3", duration: 3.5, delay: 12 },
  { startLeft: -5, startTop: 40, size: 2, color: "#FFFFFC", duration: 3, delay: 20 },
];

// Combined particles for backward compatibility
const PARTICLES = [
  ...STARS_TINY.map(s => ({ left: s.left, top: s.top, width: s.size, height: s.size, color: s.color, duration: s.duration, delay: s.delay, type: 'twinkle' as const })),
  ...STARS_SMALL.map(s => ({ left: s.left, top: s.top, width: s.size, height: s.size, color: s.color, duration: s.duration, delay: s.delay, type: 'twinkle' as const })),
  ...STARS_MEDIUM.map(s => ({ left: s.left, top: s.top, width: s.size, height: s.size, color: s.color, duration: s.duration, delay: s.delay, type: 'glow' as const })),
  ...STARS_LARGE.map(s => ({ left: s.left, top: s.top, width: s.size, height: s.size, color: s.color, duration: s.duration, delay: s.delay, type: 'glow' as const })),
];

// ==================== TELEGRAM INIT ====================
declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        enableClosingConfirmation: () => void;
        requestWriteAccess: () => Promise<boolean>;
        initData: string;
        CloudStorage: {
          setItem: (key: string, value: string, callback?: (error: Error | null, success: boolean) => void) => void;
          getItem: (key: string, callback: (error: Error | null, value: string | null) => void) => void;
        };
        BiometricManager: {
          isBiometricAvailable: boolean;
          biometricType: 'finger' | 'face' | 'unknown';
          isInited: boolean;
          isAccessRequested: boolean;
          isAccessGranted: boolean;
          isBiometricTokenSaved: boolean;
          init: (callback?: () => void) => void;
          requestAccess: (params: { reason: string }, callback?: (granted: boolean) => void) => void;
          authenticate: (params: { reason: string }, callback?: (success: boolean, token?: string) => void) => void;
          updateBiometricToken: (token: string, callback?: (updated: boolean) => void) => void;
        };
        HapticFeedback: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
          };
        };
        openLink: (url: string) => void;
        viewportHeight: number;
        onEvent: (eventType: string, callback: () => void) => void;
        offEvent: (eventType: string, callback: () => void) => void;
        [key: string]: unknown;
      };
    };
  }
}

// ==================== TYPES ====================
type Screen =
  | "splash"
  | "onboarding"
  | "email-setup"
  | "email-verify"
  | "create-pin"
  | "confirm-pin"
  | "choose-username"
  | "passkey-setup"
  | "passkey-mandatory"  // New: mandatory passkey creation BEFORE wallet
  | "pin-setup"
  | "pin-confirm"
  | "wallet-creating"
  | "wallet-ready"
  | "locked"
  | "home"
  | "wallet"
  | "send"
  | "receive"
  | "swap"
  | "history"
  | "rewards"
  | "staking"
  | "nft"
  | "nft-detail"
  | "dapps"
  | "dapp-browser"
  | "settings"
  | "profile"
  | "security"
  | "pin"
  | "backup"
  | "notifications"
  | "help"
  | "cns"
  | "tasks"
  | "bridge"
  | "ai-assistant"
  | "discover"
  | "transaction-detail"
  | "confirm-transaction"
  | "passkey-recovery"
  | "recovery-code-input"
  | "recovery-email"
  | "recovery-code"
  | "recovery-passkey"
  | "forgot-pin-email"
  | "forgot-pin-code"
  | "forgot-pin-passkey"
  | "forgot-pin-new"
  | "forgot-pin-confirm";

// Passkey credential data stored during onboarding
interface PasskeyCredentialData {
  credentialId: string;
  publicKeySpki: string;
}

// Transaction confirmation pending data
interface PendingTransaction {
  recipientPartyId: string;
  recipientUsername?: string;
  amount: string;
}

interface NavigationState {
  screen: Screen;
  params?: any;
  fromTab?: boolean;
}

// ==================== QUANTUM VAULT SPLASH SCREEN ====================
// Pre-computed splash particles to avoid hydration mismatch
const SPLASH_PARTICLES = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  x: ((i * 37) % 100),
  y: ((i * 53) % 100),
  size: (i % 4) + 1,
  delay: (i % 20) / 10,
  color: ["#875CFF", "#D5A5E3", "#F3FF97", "#FFFFFC"][i % 4],
}));

const VAULT_RINGS = Array.from({ length: 3 }, (_, i) => ({
  id: i,
  radius: 60 + i * 30,
  segments: 6 + i * 2,
  rotationSpeed: (i % 2 === 0 ? 1 : -1) * (20 + i * 10),
  delay: i * 0.2,
}));

const DATA_STREAMS = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  angle: (i * 30) * (Math.PI / 180),
  length: 80 + (i * 3),
  delay: (i % 5) / 10,
}));

function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState(0);
  const particles = SPLASH_PARTICLES;
  const vaultRings = VAULT_RINGS;
  const dataStreams = DATA_STREAMS;

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 100),
      setTimeout(() => setPhase(2), 800),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 2400),
      setTimeout(() => setPhase(5), 3200),
      setTimeout(() => setPhase(6), 4000),
      setTimeout(() => onComplete(), 4800),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden rounded-[36px]"
      style={{ background: "radial-gradient(ellipse at center, #0a0a12 0%, #030206 100%)" }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Ambient glow */}
      <motion.div
        className="absolute inset-0"
        animate={{
          background: phase >= 4
            ? "radial-gradient(circle at 50% 50%, rgba(135, 92, 255, 0.15) 0%, transparent 60%)"
            : "radial-gradient(circle at 50% 50%, rgba(135, 92, 255, 0.05) 0%, transparent 40%)",
        }}
        transition={{ duration: 0.8 }}
      />

      {/* Floating particles - Phase 1 */}
      {phase >= 1 && particles.map((particle) => (
        <motion.div
          key={particle.id}
          className="absolute rounded-full"
          style={{
            width: particle.size,
            height: particle.size,
            backgroundColor: particle.color,
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            boxShadow: `0 0 ${particle.size * 2}px ${particle.color}`,
          }}
          initial={{ opacity: 0, scale: 0 }}
          animate={phase >= 2 ? {
            opacity: [1, 0],
            scale: [1, 0.5],
            left: "50%",
            top: "50%",
          } : {
            opacity: [0, 1, 0.5, 1],
            scale: 1,
            y: [0, -20, 0, 20, 0],
          }}
          transition={phase >= 2 ? {
            duration: 0.8,
            delay: particle.delay * 0.2,
          } : {
            duration: 3,
            delay: particle.delay,
            repeat: Infinity,
          }}
        />
      ))}

      {/* Data streams - Phase 3 */}
      {phase >= 3 && dataStreams.map((stream) => (
        <motion.div
          key={stream.id}
          className="absolute"
          style={{
            width: 2,
            height: stream.length,
            background: `linear-gradient(to bottom, transparent, #875CFF, #F3FF97, transparent)`,
            left: "50%",
            top: "50%",
            transformOrigin: "center top",
            transform: `rotate(${stream.angle}rad) translateY(-${stream.length / 2}px)`,
          }}
          initial={{ opacity: 0, scaleY: 0 }}
          animate={{
            opacity: phase >= 4 ? 0 : [0, 1, 0.5],
            scaleY: phase >= 4 ? 0 : 1,
          }}
          transition={{ duration: 0.5, delay: stream.delay }}
        />
      ))}

      {/* Vault rings - Phase 3 */}
      {phase >= 3 && vaultRings.map((ring) => (
        <motion.div
          key={ring.id}
          className="absolute"
          style={{
            width: ring.radius * 2,
            height: ring.radius * 2,
            left: "50%",
            top: "50%",
            marginLeft: -ring.radius,
            marginTop: -ring.radius,
          }}
          initial={{ opacity: 0, scale: 0, rotate: 0 }}
          animate={{
            opacity: phase >= 4 ? [1, 0] : 1,
            scale: phase >= 4 ? [1, 1.5] : 1,
            rotate: phase >= 4 ? ring.rotationSpeed * 2 : ring.rotationSpeed,
          }}
          transition={{
            opacity: { duration: phase >= 4 ? 0.5 : 0.3 },
            scale: { duration: phase >= 4 ? 0.5 : 0.5 },
            rotate: { duration: phase >= 4 ? 0.5 : 3, repeat: phase >= 4 ? 0 : Infinity, ease: "linear" },
            delay: ring.delay,
          }}
        >
          <svg width="100%" height="100%" viewBox={`0 0 ${ring.radius * 2} ${ring.radius * 2}`}>
            {Array.from({ length: ring.segments }).map((_, i) => {
              const angle = (i * 360) / ring.segments;
              const rad = (angle * Math.PI) / 180;
              const x1 = ring.radius + Math.cos(rad) * (ring.radius - 10);
              const y1 = ring.radius + Math.sin(rad) * (ring.radius - 10);
              const x2 = ring.radius + Math.cos(rad) * ring.radius;
              const y2 = ring.radius + Math.sin(rad) * ring.radius;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={i % 2 === 0 ? "#875CFF" : "#D5A5E3"}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })}
            <circle
              cx={ring.radius}
              cy={ring.radius}
              r={ring.radius - 5}
              fill="none"
              stroke="url(#vaultGradient)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          </svg>
        </motion.div>
      ))}

      {/* SVG Gradients */}
      <svg width="0" height="0">
        <defs>
          <linearGradient id="vaultGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#875CFF" />
            <stop offset="50%" stopColor="#D5A5E3" />
            <stop offset="100%" stopColor="#F3FF97" />
          </linearGradient>
        </defs>
      </svg>

      {/* Central energy core - Phase 2 */}
      {phase >= 2 && (
        <motion.div
          className="absolute"
          style={{
            width: 20,
            height: 20,
            left: "50%",
            top: "50%",
            marginLeft: -10,
            marginTop: -10,
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            scale: phase >= 4 ? [1, 15, 20] : [1, 1.2, 1],
            opacity: phase >= 4 ? [1, 0.8, 0] : 1,
          }}
          transition={{
            duration: phase >= 4 ? 0.6 : 1,
            repeat: phase >= 4 ? 0 : Infinity,
          }}
        >
          <div
            className="w-full h-full rounded-full"
            style={{
              background: "radial-gradient(circle, #F3FF97 0%, #875CFF 50%, transparent 70%)",
              boxShadow: "0 0 30px #875CFF, 0 0 60px #D5A5E3",
            }}
          />
        </motion.div>
      )}

      {/* Unlock burst - Phase 4 */}
      {phase >= 4 && (
        <>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute rounded-full border-2"
              style={{
                borderColor: i === 0 ? "#F3FF97" : i === 1 ? "#875CFF" : "#D5A5E3",
                left: "50%",
                top: "50%",
              }}
              initial={{ width: 0, height: 0, marginLeft: 0, marginTop: 0, opacity: 1 }}
              animate={{
                width: 400,
                height: 400,
                marginLeft: -200,
                marginTop: -200,
                opacity: 0,
              }}
              transition={{ duration: 1, delay: i * 0.15, ease: "easeOut" }}
            />
          ))}

          {Array.from({ length: 8 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute"
              style={{
                width: 3,
                height: 200,
                background: `linear-gradient(to bottom, ${i % 2 === 0 ? "#F3FF97" : "#875CFF"}, transparent)`,
                left: "50%",
                top: "50%",
                transformOrigin: "center top",
                transform: `rotate(${i * 45}deg)`,
              }}
              initial={{ scaleY: 0, opacity: 1 }}
              animate={{ scaleY: [0, 1, 0], opacity: [1, 1, 0] }}
              transition={{ duration: 0.6, delay: 0.1 }}
            />
          ))}
        </>
      )}

      {/* Logo reveal - Phase 5 */}
      {phase >= 5 && (
        <motion.div
          className="absolute flex flex-col items-center px-8"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.8 }}
        >
          <motion.div
            className="relative mb-8"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <div
              className="absolute -inset-4 rounded-full blur-2xl"
              style={{ background: "radial-gradient(circle, #875CFF 0%, transparent 70%)", opacity: 0.6 }}
            />
            <div
              className="absolute -inset-2 rounded-full blur-lg"
              style={{ background: "radial-gradient(circle, #F3FF97 0%, transparent 70%)", opacity: 0.3 }}
            />
            <motion.div
              className="relative flex items-center justify-center"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Image src="/ccbotlogo.png" alt="CC Bot" width={100} height={100} priority />
            </motion.div>
          </motion.div>

          <motion.h1
            className="text-white text-2xl font-bold mb-2 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {"CC Bot Wallet".split("").map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.05 }}
                style={{ textShadow: "0 0 20px rgba(135, 92, 255, 0.5)", display: "inline-block" }}
              >
                {char === " " ? "\u00A0" : char}
              </motion.span>
            ))}
          </motion.h1>

          <motion.p
            className="text-taupe text-sm text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            Your crypto, simplified
          </motion.p>
        </motion.div>
      )}
    </motion.div>
  );
}

// ==================== ONBOARDING SCREEN ====================
function OnboardingScreen({ onContinue, onExisting }: { onContinue: () => void; onExisting: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-6 pt-8 pb-6 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -100 }}
    >
      {/* Content area - scrollable if needed */}
      <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto min-h-0">
        <motion.div
          className="flex items-center justify-center mb-6"
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 4, repeat: Infinity }}
        >
          <Image src="/ccbotlogo.png" alt="CC Bot" width={140} height={140} priority />
        </motion.div>

        <h1 className="text-white text-3xl font-bold mb-3 text-center">
          Welcome to<br /><span className="text-yellow">CC Bot Wallet</span>
        </h1>

        <p className="text-taupe text-center mb-8 px-4 text-base leading-relaxed">
          No seed phrases — just your PIN.
        </p>
      </div>

      {/* Bottom buttons — always visible */}
      <div className="flex-shrink-0">
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white font-bold text-lg mb-3"
          whileTap={{ scale: 0.98 }}
          onClick={onContinue}
        >
          Create New Wallet
        </motion.button>

        <motion.button
          className="w-full py-4 bg-white/10 rounded-2xl text-white font-medium text-lg"
          whileTap={{ scale: 0.98 }}
          onClick={onExisting}
        >
          I Have a Wallet
        </motion.button>

        <p className="text-center text-taupe text-sm mt-4">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </motion.div>
  );
}

// ==================== EMAIL SCREENS ====================
function EmailSetupScreen({
  onComplete,
  onBack,
  onExistingWallet
}: {
  onComplete: (email: string) => void;
  onBack?: () => void;
  onExistingWallet?: (email: string, partyId: string) => void;
}) {
  const { isAuthLoading } = useWalletContext();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [existingWalletInfo, setExistingWalletInfo] = useState<{ partyId: string } | null>(null);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleContinue = async () => {
    // Wait for auth to complete before making API calls
    if (isAuthLoading) {
      setError("Please wait, loading...");
      return;
    }

    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Verify token is set before making API call
      if (!api.hasToken()) {
        console.error('[EmailSetupScreen] No auth token available!');
        setError("Authentication not ready. Please wait and try again.");
        setIsLoading(false);
        return;
      }

      // First check if email already has a wallet
      const emailCheck = await api.checkEmail(email);

      if (emailCheck.hasWallet && emailCheck.partyId) {
        // Email has existing wallet - show recovery option
        setExistingWalletInfo({ partyId: emailCheck.partyId });
        try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("warning"); } catch {}
        return;
      }

      // No existing wallet - proceed with verification code
      await api.sendEmailCode(email);
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
      onComplete(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoverWallet = () => {
    if (existingWalletInfo && onExistingWallet) {
      onExistingWallet(email, existingWalletInfo.partyId);
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-y-auto"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      {onBack && (
        <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <span className="material-symbols-outlined text-5xl text-purple mb-6">mail</span>
        <h2 className="text-white text-2xl font-bold mb-2">Verify Your Email</h2>
        <p className="text-taupe text-center mb-8">We'll send a verification code to your email for account recovery</p>

        <div className="w-full max-w-sm mb-4">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); setExistingWalletInfo(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && email && !isLoading && !existingWalletInfo) handleContinue(); }}
            onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }}
            placeholder="Enter your email"
            className="w-full px-4 py-4 bg-white/10 rounded-2xl text-white placeholder-taupe outline-none focus:ring-2 focus:ring-purple"
            disabled={isLoading || !!existingWalletInfo}
          />
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>

        {existingWalletInfo ? (
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 text-center">
              <span className="material-symbols-outlined text-yellow-400 text-2xl mb-2 block">info</span>
              <p className="text-yellow-200 text-sm">
                This email already has a wallet. Would you like to recover it?
              </p>
            </div>
            <motion.button
              className="w-full py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white font-bold text-lg"
              whileTap={{ scale: 0.98 }}
              onClick={handleRecoverWallet}
            >
              Recover My Wallet
            </motion.button>
            <motion.button
              className="w-full py-3 bg-white/10 rounded-2xl text-taupe font-medium"
              whileTap={{ scale: 0.98 }}
              onClick={() => { setExistingWalletInfo(null); setEmail(""); }}
            >
              Use Different Email
            </motion.button>
          </div>
        ) : (
          <motion.button
            className="w-full max-w-sm py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white font-bold text-lg disabled:opacity-50"
            whileTap={{ scale: 0.98 }}
            onClick={handleContinue}
            disabled={!email || isLoading || isAuthLoading}
          >
            {isAuthLoading ? "Loading..." : isLoading ? "Checking..." : "Continue"}
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

function EmailVerifyScreen({
  email,
  onComplete,
  onBack,
  onResend
}: {
  email: string;
  onComplete: () => void;
  onBack: () => void;
  onResend: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [resendTimer]);

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
            const result = await api.verifyEmailCode(email, code);
      if (result.verified) {
        try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
        onComplete();
      } else {
        setError("Invalid verification code");
        try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setCanResend(false);
    setResendTimer(60);
    onResend();
  };

  const handleCodeInput = (digit: string) => {
    if (code.length < 6) {
      const newCode = code + digit;
      setCode(newCode);
      setError("");
      try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}

      if (newCode.length === 6) {
        // Auto-verify when 6 digits entered
        setTimeout(() => {
          setCode(newCode);
          // Trigger verification
        }, 100);
      }
    }
  };

  const handleDelete = () => {
    setCode(code.slice(0, -1));
    setError("");
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  // Keyboard and paste support - uses refs to avoid stale closures
  const handleVerifyRef = useRef(handleVerify);
  handleVerifyRef.current = handleVerify;
  const codeRef = useRef(code);
  codeRef.current = code;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        setCode(prev => {
          if (prev.length >= 6) return prev;
          setError("");
          return prev + digit;
        });
      },
      onBackspace: () => {
        setCode(prev => prev.slice(0, -1));
        setError("");
      },
      onEnter: () => {
        if (codeRef.current.length === 6 && !isLoadingRef.current) {
          handleVerifyRef.current();
        }
      }
    });
  }, []);

  // Paste handler for button
  const handlePaste = async () => {
    const result = await readClipboard();
    if (result.success && result.text) {
      const digits = extractDigits(result.text, 6);
      if (digits.length > 0) {
        setCode(digits);
        setError("");
        hapticSuccess();
      } else {
        hapticError();
      }
    } else {
      hapticError();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-purple/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-purple">mark_email_read</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Enter Code</h2>
        <p className="text-taupe text-center text-sm mb-1">We sent a 6-digit code to</p>
        <p className="text-purple text-center text-sm mb-5">{email}</p>

        <div className="flex gap-2 mb-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-11 h-12 rounded-lg flex items-center justify-center text-xl font-bold ${
                error ? "bg-red-500/20 border-red-500" : i < code.length ? "bg-purple/20 border-purple" : "bg-white/10 border-white/20"
              } border-2`}
              animate={error ? { x: [-5, 5, -5, 5, 0] } : i < code.length ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.2 }}
            >
              <span className="text-white">{code[i] || ""}</span>
            </motion.div>
          ))}
        </div>

        {/* Paste button - uses Telegram clipboard API */}
        <button
          className="flex items-center gap-2 text-purple text-sm mb-4 px-4 py-2 bg-purple/10 rounded-xl active:bg-purple/20 transition-colors"
          onClick={handlePaste}
        >
          <span className="material-symbols-outlined text-base">content_paste</span>
          <span>Paste code</span>
        </button>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="grid grid-cols-3 gap-3 mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`w-[76px] h-[76px] rounded-2xl flex items-center justify-center text-2xl font-semibold
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handleCodeInput(key)}
              disabled={isLoading}
            >
              {key === "del" ? "DEL" : key}
            </motion.button>
          ))}
        </div>

        <motion.button
          className="w-full max-w-sm py-3 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white font-bold disabled:opacity-50 mb-3"
          whileTap={{ scale: 0.98 }}
          onClick={handleVerify}
          disabled={code.length !== 6 || isLoading}
        >
          {isLoading ? "Verifying..." : "Verify"}
        </motion.button>

        <button
          className={`text-sm ${canResend ? "text-purple" : "text-taupe"}`}
          onClick={handleResend}
          disabled={!canResend}
        >
          {canResend ? "Resend Code" : `Resend in ${resendTimer}s`}
        </button>
      </div>
    </motion.div>
  );
}

// ==================== PIN SCREENS ====================
function CreatePinScreen({ onComplete, onBack }: { onComplete: (pin: string) => void; onBack?: () => void }) {
  const [pin, setPin] = useState("");

  const handlePress = (digit: string) => {
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
      } catch {}
      if (newPin.length === 6) {
        setTimeout(() => onComplete(newPin), 300);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  // Ref for onComplete to avoid stale closure
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        setPin(prev => {
          if (prev.length >= 6) return prev;
          const next = prev + digit;
          if (next.length === 6) setTimeout(() => onCompleteRef.current(next), 300);
          return next;
        });
      },
      onBackspace: () => setPin(prev => prev.slice(0, -1))
    });
  }, []);

  // Paste handler
  const handlePinPaste = async () => {
    const result = await readClipboard();
    if (result.success && result.text) {
      const digits = extractDigits(result.text, 6);
      if (digits.length > 0) {
        setPin(digits);
        hapticSuccess();
        if (digits.length === 6) setTimeout(() => onCompleteRef.current(digits), 300);
      }
    } else {
      hapticError();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      {onBack && (
        <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>
      )}

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-purple/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-purple">lock</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Create PIN</h2>
        <p className="text-taupe text-center text-sm mb-6">Enter a 6-digit PIN to secure your wallet</p>

        <div className="flex gap-3 mb-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-3 h-3 rounded-full ${i < pin.length ? "bg-yellow" : "bg-white/20"}`}
              animate={i < pin.length ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.2 }}
            />
          ))}
        </div>

        {/* Paste button - uses Telegram clipboard API */}
        <button
          className="flex items-center gap-2 text-purple text-sm mb-4 px-4 py-2 bg-purple/10 rounded-xl active:bg-purple/20 transition-colors"
          onClick={handlePinPaste}
        >
          <span className="material-symbols-outlined text-base">content_paste</span>
          <span>Paste PIN</span>
        </button>

        <div className="grid grid-cols-3 gap-4 w-full max-w-[280px]">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`aspect-square rounded-full flex items-center justify-center text-3xl font-medium
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handlePress(key)}
            >
              {key === "del" ? <span className="material-symbols-outlined text-2xl">backspace</span> : key}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function ConfirmPinScreen({ originalPin, onComplete, onBack, isLoading }: { originalPin: string; onComplete: () => void; onBack: () => void; isLoading?: boolean }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handlePress = (digit: string) => {
    if (isLoading) return;
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
      try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}

      if (newPin.length === 6) {
        if (newPin === originalPin) {
          try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
          // PIN is used to encrypt the user share - never store it
          setTimeout(() => onComplete(), 300);
        } else {
          try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
          setError("PINs don't match");
          setTimeout(() => setPin(""), 500);
        }
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError("");
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  // Refs to avoid stale closures
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const originalPinRef = useRef(originalPin);
  originalPinRef.current = originalPin;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // PIN verification logic
  const verifyPin = (digits: string) => {
    if (digits.length === 6) {
      if (digits === originalPinRef.current) {
        hapticSuccess();
        setTimeout(() => onCompleteRef.current(), 300);
      } else {
        hapticError();
        setError("PINs don't match");
        setTimeout(() => setPin(""), 500);
      }
    }
  };

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        if (isLoadingRef.current) return;
        setPin(prev => {
          if (prev.length >= 6) return prev;
          const next = prev + digit;
          setError("");
          verifyPin(next);
          return next;
        });
      },
      onBackspace: () => {
        if (isLoadingRef.current) return;
        setPin(prev => prev.slice(0, -1));
        setError("");
      }
    });
  }, []);

  // Paste handler
  const handlePinPaste = async () => {
    if (isLoading) return;
    const result = await readClipboard();
    if (result.success && result.text) {
      const digits = extractDigits(result.text, 6);
      if (digits.length > 0) {
        setPin(digits);
        setError("");
        verifyPin(digits);
      }
    } else {
      hapticError();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-purple/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-purple">{isLoading ? "hourglass_top" : "shield_lock"}</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">{isLoading ? "Creating Wallet..." : "Confirm PIN"}</h2>
        <p className="text-taupe text-center text-sm mb-6">{isLoading ? "Setting up your Canton wallet" : "Re-enter your PIN to confirm"}</p>

        <div className="flex gap-3 mb-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-3 h-3 rounded-full ${error ? "bg-red-500" : i < pin.length ? "bg-yellow" : "bg-white/20"}`}
              animate={error ? { x: [-5, 5, -5, 5, 0] } : i < pin.length ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.3 }}
            />
          ))}
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* Paste button - uses Telegram clipboard API */}
        {!isLoading && (
          <button
            className="flex items-center gap-2 text-purple text-sm mb-3 px-4 py-2 bg-purple/10 rounded-xl active:bg-purple/20 transition-colors"
            onClick={handlePinPaste}
          >
            <span className="material-symbols-outlined text-base">content_paste</span>
            <span>Paste PIN</span>
          </button>
        )}

        <div className="grid grid-cols-3 gap-4 w-full max-w-[280px] mt-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`aspect-square rounded-full flex items-center justify-center text-3xl font-medium
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handlePress(key)}
            >
              {key === "del" ? <span className="material-symbols-outlined text-2xl">backspace</span> : key}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== LOCK SCREEN ====================
interface LockScreenProps {
  onUnlock: () => void;
  userName?: string;
  userPhotoUrl?: string;
  onForgotPin?: () => void;
}

function LockScreen({ onUnlock, userName, userPhotoUrl, onForgotPin }: LockScreenProps) {
  const security = useSecurity();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [remainingTime, setRemainingTime] = useState<string>("");

  // Get lockout state from security context
  const isLockedOut = security.isLockedOut;
  const lockoutEndsAt = security.lockoutEndsAt;
  const pinAttempts = security.pinAttempts;

  // Countdown timer for lockout
  useEffect(() => {
    if (!lockoutEndsAt) {
      setRemainingTime("");
      return;
    }

    const updateTimer = () => {
      const remaining = lockoutEndsAt.getTime() - Date.now();
      if (remaining <= 0) {
        setRemainingTime("");
        setError("");
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setRemainingTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockoutEndsAt]);

  // Update error message when lockout state changes
  useEffect(() => {
    if (isLockedOut && lockoutEndsAt) {
      setError("Too many attempts. Try again in 15 minutes.");
    }
  }, [isLockedOut, lockoutEndsAt]);

  const handlePress = async (digit: string) => {
    if (isVerifying || isLockedOut || showSuccess) return;
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
      try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}

      if (newPin.length === 6) {
        setIsVerifying(true);
        try {
          // Use security context for unlock
          const success = await security.unlock(newPin);

          if (success) {
            setShowSuccess(true);
            // Small delay for success animation
            setTimeout(() => {
              onUnlock();
            }, 600);
          } else {
            // Check if now locked out
            if (security.pinAttempts >= 5) {
              setError("Too many attempts. Try again in 15 minutes.");
            } else {
              setError(`Incorrect PIN. ${5 - security.pinAttempts} attempts remaining.`);
            }
            setTimeout(() => setPin(""), 300);
          }
        } finally {
          setIsVerifying(false);
        }
      }
    }
  };

  const handleDelete = () => {
    if (showSuccess) return;
    setPin(pin.slice(0, -1));
    setError("");
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  const handlePressRef = useRef(handlePress);
  handlePressRef.current = handlePress;

  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => handlePressRef.current(digit),
      onBackspace: () => {
        setPin(prev => prev.slice(0, -1));
        setError("");
      }
    });
  }, []);

  // Paste handler
  const handlePinPaste = async () => {
    const result = await readClipboard();
    if (result.success && result.text) {
      const digits = extractDigits(result.text, 6);
      for (const digit of digits) {
        handlePressRef.current(digit);
      }
      if (digits.length > 0) hapticSuccess();
    } else {
      hapticError();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 h-full flex flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Blurred background overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(3, 2, 6, 0.95) 0%, rgba(13, 11, 20, 0.98) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      />

      {/* Ambient glow effects */}
      <motion.div
        className="absolute top-1/4 left-1/2 w-64 h-64 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(135, 92, 255, 0.15) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto min-h-0">
        {/* User avatar/icon */}
        <motion.div
          className="relative mb-6"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
        >
          {userPhotoUrl ? (
            <div className="relative">
              <motion.div
                className="absolute -inset-1 rounded-full"
                style={{
                  background: "linear-gradient(135deg, #875CFF 0%, #D5A5E3 50%, #F3FF97 100%)",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              />
              <Image
                src={userPhotoUrl}
                alt="User"
                width={64}
                height={64}
                className="relative rounded-full border-2 border-transparent"
              />
            </div>
          ) : (
            <motion.div
              className="w-18 h-18 rounded-full flex items-center justify-center relative overflow-hidden"
              style={{
                width: 72,
                height: 72,
                background: "linear-gradient(135deg, rgba(135, 92, 255, 0.3) 0%, rgba(213, 165, 227, 0.2) 100%)",
                border: "2px solid rgba(135, 92, 255, 0.5)",
              }}
              animate={showSuccess ? { scale: [1, 1.2, 1] } : { scale: [1, 1.03, 1] }}
              transition={showSuccess ? { duration: 0.3 } : { duration: 3, repeat: Infinity }}
            >
              <motion.span
                className="material-symbols-outlined text-4xl"
                style={{ color: showSuccess ? "#F3FF97" : "#875CFF" }}
                animate={showSuccess ? { rotate: [0, -10, 10, 0] } : {}}
                transition={{ duration: 0.3 }}
              >
                {showSuccess ? "lock_open" : "lock"}
              </motion.span>
            </motion.div>
          )}
        </motion.div>

        {/* Welcome text */}
        <motion.h2
          className="text-white text-xl font-bold mb-1 text-center"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          {showSuccess ? "Welcome!" : `Welcome Back${userName ? `, ${userName}` : ""}`}
        </motion.h2>
        <motion.p
          className="text-taupe text-center text-sm mb-5"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.25 }}
        >
          {showSuccess ? "Unlocking your wallet..." : isLockedOut ? `Try again in ${remainingTime}` : "Enter your PIN to unlock"}
        </motion.p>

        {/* PIN dots */}
        <motion.div
          className="flex gap-3 mb-3"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className="relative"
              animate={
                showSuccess
                  ? { scale: [1, 1.5, 1], y: [0, -10, 0] }
                  : error
                    ? { x: [-5, 5, -5, 5, 0] }
                    : i < pin.length
                      ? { scale: [1, 1.3, 1] }
                      : {}
              }
              transition={
                showSuccess
                  ? { duration: 0.4, delay: i * 0.05 }
                  : { duration: 0.3 }
              }
            >
              <div
                className={`w-3 h-3 rounded-full transition-colors duration-200 ${
                  showSuccess
                    ? "bg-green-400"
                    : error
                      ? "bg-red-500"
                      : i < pin.length
                        ? "bg-yellow"
                        : "bg-white/20"
                }`}
              />
              {i < pin.length && !error && !showSuccess && (
                <motion.div
                  className="absolute inset-0 rounded-full bg-yellow"
                  initial={{ scale: 1.5, opacity: 0.5 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 0.5 }}
                />
              )}
            </motion.div>
          ))}
        </motion.div>

        {/* Paste button - uses Telegram clipboard API */}
        {!showSuccess && !isLockedOut && (
          <motion.button
            className="flex items-center gap-2 text-purple text-sm mb-4 px-4 py-2 bg-purple/10 rounded-xl active:bg-purple/20 transition-colors"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.32 }}
            onClick={handlePinPaste}
          >
            <span className="material-symbols-outlined text-base">content_paste</span>
            <span>Paste PIN</span>
          </motion.button>
        )}

        {/* Error message */}
        <AnimatePresence>
          {error && (
            <motion.p
              className="text-red-400 text-sm mb-4 text-center"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Verifying indicator */}
        {isVerifying && (
          <motion.div
            className="mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="w-6 h-6 border-2 border-purple border-t-transparent rounded-full animate-spin" />
          </motion.div>
        )}

        {/* PIN keypad */}
        <motion.div
          className="grid grid-cols-3 gap-4 w-full max-w-[280px] mt-4"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key, index) => (
            <motion.button
              key={key || "empty"}
              className={`aspect-square rounded-full flex items-center justify-center text-3xl font-medium transition-all
                ${key === ""
                  ? "invisible"
                  : key === "del"
                    ? "text-taupe hover:text-white active:scale-95"
                    : "bg-white/10 text-white hover:bg-white/15 active:bg-white/20 active:scale-95"
                }
                ${(isLockedOut || showSuccess) && key !== "" ? "opacity-50 pointer-events-none" : ""}
              `}
              style={{ touchAction: "manipulation" }}
              whileTap={key !== "" ? { scale: 0.92 } : {}}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + index * 0.02 }}
              disabled={isLockedOut || showSuccess}
              onClick={() => key === "del" ? handleDelete() : key && handlePress(key)}
            >
              {key === "del" ? (
                <span className="material-symbols-outlined text-2xl">backspace</span>
              ) : (
                key
              )}
            </motion.button>
          ))}
        </motion.div>

        {/* Forgot PIN link */}
        {onForgotPin && !showSuccess && (
          <motion.button
            className="mt-4 text-taupe hover:text-purple transition-colors text-sm"
            onClick={onForgotPin}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            whileTap={{ scale: 0.98 }}
          >
            Forgot PIN?
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// ==================== CHOOSE USERNAME ====================
function ChooseUsernameScreen({ onComplete, onBack }: { onComplete: (username: string) => void; onBack: () => void }) {
  const [username, setUsername] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Debounced username check
  useEffect(() => {
    if (username.length < 3) {
      setIsAvailable(null);
      setError("");
      return;
    }

    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/username/check/${encodeURIComponent(username.toLowerCase())}`);
        const data = await res.json();
        setIsAvailable(data.data?.available ?? false);
        setError(data.data?.reason || "");
      } catch {
        setError("Could not check availability");
      } finally {
        setIsChecking(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  const handleSubmit = async () => {
    if (!isAvailable || isSubmitting) return;

    setIsSubmitting(true);
    try {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      onComplete(username.toLowerCase());
    } catch {
      setError("Failed to set username");
      setIsSubmitting(false);
    }
  };

  const isValidFormat = /^[a-z][a-z0-9_]{2,14}$/.test(username.toLowerCase());

  return (
    <motion.div
      className="h-full flex flex-col p-6"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-purple/20 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-3xl text-purple">alternate_email</span>
        </div>
        <h2 className="text-white text-2xl font-bold mb-2">Choose Username</h2>
        <p className="text-taupe text-center mb-8">Pick a unique name for your wallet</p>

        <div className="w-full max-w-xs">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-taupe text-lg">@</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15))}
              placeholder="username"
              className="w-full pl-10 pr-12 py-4 rounded-2xl bg-white/10 text-white placeholder-white/30 outline-none focus:ring-2 focus:ring-purple"
              autoFocus
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              {isChecking && <span className="material-symbols-outlined text-taupe animate-spin">progress_activity</span>}
              {!isChecking && isAvailable === true && <span className="material-symbols-outlined text-green-500">check_circle</span>}
              {!isChecking && isAvailable === false && <span className="material-symbols-outlined text-red-500">cancel</span>}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
          {username.length > 0 && username.length < 3 && (
            <p className="text-taupe text-sm mt-2 text-center">At least 3 characters</p>
          )}
          {username.length >= 3 && !isValidFormat && (
            <p className="text-taupe text-sm mt-2 text-center">Must start with a letter</p>
          )}

          <p className="text-taupe/60 text-xs mt-4 text-center">
            3-15 characters • letters, numbers, underscore
          </p>
        </div>

        <motion.button
          className={`mt-8 px-12 py-4 rounded-2xl font-bold text-lg transition-all ${
            isAvailable && !isSubmitting
              ? "bg-gradient-to-r from-purple to-yellow text-black"
              : "bg-white/10 text-white/30 cursor-not-allowed"
          }`}
          whileTap={isAvailable ? { scale: 0.98 } : {}}
          onClick={handleSubmit}
          disabled={!isAvailable || isSubmitting}
        >
          {isSubmitting ? "Setting..." : "Continue"}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== RECOVERY CODE INPUT SCREEN ====================
function RecoveryCodeInputScreen({ onRecovered, onBack }: {
  onRecovered: () => void;
  onBack: () => void;
}) {
  const { recoverWithCode } = useWalletContext();
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [step, setStep] = useState<"code" | "pin" | "confirm" | "recovering">("code");
  const [error, setError] = useState<string | null>(null);

  const handleCodeSubmit = () => {
    if (recoveryCodeInput.length < 10) {
      setError("Please enter a valid recovery code");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
      return;
    }
    setError(null);
    setStep("pin");
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  const handlePinSubmit = () => {
    if (newPin.length !== 6) {
      setError("PIN must be 6 digits");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
      return;
    }
    setError(null);
    setStep("confirm");
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  const handleConfirmSubmit = async () => {
    if (confirmPin !== newPin) {
      setError("PINs do not match");
      setConfirmPin("");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
      return;
    }

    setError(null);
    setStep("recovering");

    try {
      const result = await recoverWithCode(recoveryCodeInput, newPin);
      if (result.success) {
        try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
        onRecovered();
      } else {
        setError(result.error || "Recovery failed. Please check your recovery code.");
        setStep("code");
        try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
      setStep("code");
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error"); } catch {}
    }
  };

  const handlePinDigit = (digit: string) => {
    if (step === "pin" && newPin.length < 6) {
      setNewPin(prev => prev + digit);
      try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
    } else if (step === "confirm" && confirmPin.length < 6) {
      setConfirmPin(prev => prev + digit);
      try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
    }
  };

  const handlePinBackspace = () => {
    if (step === "pin") {
      setNewPin(prev => prev.slice(0, -1));
    } else if (step === "confirm") {
      setConfirmPin(prev => prev.slice(0, -1));
    }
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <div className="flex items-center gap-4 mb-6 flex-shrink-0">
        <motion.button
          className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center"
          whileTap={{ scale: 0.95 }}
          onClick={step === "code" ? onBack : () => setStep(step === "confirm" ? "pin" : "code")}
        >
          <span className="material-symbols-outlined text-taupe">arrow_back</span>
        </motion.button>
        <h1 className="text-xl font-bold text-white">
          {step === "code" && "Enter Recovery Code"}
          {step === "pin" && "Create New PIN"}
          {step === "confirm" && "Confirm PIN"}
          {step === "recovering" && "Recovering Wallet"}
        </h1>
      </div>

      {/* Recovery Code Step */}
      {step === "code" && (
        <div className="flex-1 flex flex-col overflow-y-auto min-h-0">
          <div className="flex-1">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-purple">key</span>
            </div>
            <p className="text-taupe text-center mb-6">
              Enter the recovery code you saved when you created your wallet.
            </p>
            <textarea
              className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-white font-mono text-sm resize-none focus:outline-none focus:border-purple"
              placeholder="Enter your recovery code..."
              value={recoveryCodeInput}
              onChange={(e) => setRecoveryCodeInput(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && recoveryCodeInput.length >= 10) { e.preventDefault(); handleCodeSubmit(); } }}
            />
            {error && (
              <p className="text-red-400 text-sm mt-2 text-center">{error}</p>
            )}
          </div>
          <motion.button
            className={`w-full py-4 rounded-2xl font-bold text-lg flex-shrink-0 mt-4 ${
              recoveryCodeInput.length >= 10
                ? "bg-gradient-to-r from-purple to-yellow text-black"
                : "bg-white/10 text-taupe"
            }`}
            whileTap={recoveryCodeInput.length >= 10 ? { scale: 0.98 } : {}}
            onClick={handleCodeSubmit}
            disabled={recoveryCodeInput.length < 10}
          >
            Continue
          </motion.button>
        </div>
      )}

      {/* PIN Entry Steps */}
      {(step === "pin" || step === "confirm") && (
        <div className="flex-1 flex flex-col items-center overflow-y-auto min-h-0">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-purple/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-purple">lock</span>
          </div>
          <p className="text-taupe text-center mb-8">
            {step === "pin" ? "Choose a new 6-digit PIN to secure your wallet" : "Enter the PIN again to confirm"}
          </p>

          {/* PIN Dots */}
          <div className="flex gap-4 mb-8">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full ${
                  (step === "pin" ? newPin : confirmPin).length > i
                    ? "bg-purple"
                    : "bg-white/20"
                }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-4 w-full max-w-xs">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map((key) => (
              <motion.button
                key={key}
                className={`h-16 rounded-2xl text-2xl font-bold ${
                  key === "" ? "invisible" : "bg-white/5 text-white"
                }`}
                whileTap={key !== "" ? { scale: 0.95, backgroundColor: "rgba(135, 92, 255, 0.3)" } : {}}
                onClick={() => {
                  if (key === "back") handlePinBackspace();
                  else if (key !== "") handlePinDigit(key);
                }}
              >
                {key === "back" ? (
                  <span className="material-symbols-outlined">backspace</span>
                ) : (
                  key
                )}
              </motion.button>
            ))}
          </div>

          {/* Auto-submit when PIN is complete */}
          {step === "pin" && newPin.length === 6 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4"
            >
              <motion.button
                className="px-8 py-3 bg-gradient-to-r from-purple to-yellow rounded-2xl text-black font-bold"
                whileTap={{ scale: 0.98 }}
                onClick={handlePinSubmit}
              >
                Continue
              </motion.button>
            </motion.div>
          )}

          {step === "confirm" && confirmPin.length === 6 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4"
            >
              <motion.button
                className="px-8 py-3 bg-gradient-to-r from-purple to-yellow rounded-2xl text-black font-bold"
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirmSubmit}
              >
                Recover Wallet
              </motion.button>
            </motion.div>
          )}
        </div>
      )}

      {/* Recovering Step */}
      {step === "recovering" && (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto min-h-0">
          <div className="w-20 h-20 mb-6 relative">
            <motion.div
              className="absolute inset-0 rounded-full border-4 border-purple/30"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              style={{ borderTopColor: "#875CFF" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-purple">sync</span>
            </div>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Recovering Wallet</h2>
          <p className="text-taupe text-center">Please wait while we restore your wallet...</p>
        </div>
      )}
    </motion.div>
  );
}

// ==================== EMAIL-BASED WALLET RECOVERY ====================
function WalletRecoveryEmailScreen({ onContinue, onBack }: {
  onContinue: (email: string, partyId: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<{ hasWallet: boolean; hasPasskey: boolean; partyId?: string } | null>(null);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleCheckEmail = async () => {
    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      hapticError();
      return;
    }

    setIsLoading(true);
    setError("");

    try {
            const result = await api.recoveryCheckEmail(email);

      if (!result.hasWallet) {
        setError("No wallet found for this email address");
        hapticError();
        setIsLoading(false);
        return;
      }

      if (!result.hasPasskey) {
        setError("This wallet doesn't have passkey. Please use recovery code.");
        hapticError();
        setIsLoading(false);
        return;
      }

      setWalletInfo(result);

      // Send verification code
      const sendResult = await api.recoverySendCode(email);
      if (!sendResult.message.includes("sent")) {
        setError(sendResult.message);
        hapticError();
        setIsLoading(false);
        return;
      }

      hapticSuccess();
      onContinue(email, result.partyId!);
    } catch (err) {
      console.error("Recovery check failed:", err);
      setError("Failed to check email. Please try again.");
      hapticError();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-y-auto"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-16 h-16 rounded-full bg-purple/20 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-3xl text-purple">account_circle</span>
        </div>
        <h2 className="text-white text-2xl font-bold mb-2">Recover Your Wallet</h2>
        <p className="text-taupe text-center mb-8">Enter the email address associated with your wallet</p>

        <div className="w-full max-w-sm mb-4">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && email && !isLoading) handleCheckEmail(); }}
            onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }}
            placeholder="Enter your email"
            className="w-full px-4 py-4 bg-white/10 rounded-2xl text-white placeholder-taupe outline-none focus:ring-2 focus:ring-purple"
            disabled={isLoading}
          />
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>

        <motion.button
          className="w-full max-w-sm py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white font-bold text-lg disabled:opacity-50"
          whileTap={{ scale: 0.98 }}
          onClick={handleCheckEmail}
          disabled={!email || isLoading}
        >
          {isLoading ? "Checking..." : "Continue"}
        </motion.button>
      </div>
    </motion.div>
  );
}

function WalletRecoveryCodeScreen({ email, partyId, onContinue, onBack }: {
  email: string;
  partyId: string;
  onContinue: (sessionId: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

  // Resend countdown
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(r => r - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [resendTimer]);

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        setCode(prev => {
          if (prev.length >= 6) return prev;
          setError("");
          return prev + digit;
        });
      },
      onBackspace: () => {
        setCode(prev => prev.slice(0, -1));
        setError("");
      },
      onEnter: () => {
        if (code.length === 6 && !isLoading) handleVerify();
      }
    });
  }, [code, isLoading]);

  const handleCodeInput = (digit: string) => {
    if (code.length < 6) {
      setCode(code + digit);
      setError("");
      hapticLight();
    }
  };

  const handleDelete = () => {
    setCode(code.slice(0, -1));
    setError("");
    hapticLight();
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      hapticError();
      return;
    }

    setIsLoading(true);
    setError("");

    try {
            const result = await api.recoveryVerifyCode(email, code);

      hapticSuccess();
      onContinue(result.sessionId);
    } catch (err) {
      console.error("Code verification failed:", err);
      setError("Invalid code. Please try again.");
      setCode("");
      hapticError();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setCanResend(false);
    setResendTimer(60);
    setError("");

    try {
            const result = await api.recoverySendCode(email);
      if (result.message?.includes("sent")) {
        hapticSuccess();
      } else {
        setError(result.message || "Failed to resend code");
        hapticError();
      }
    } catch (err) {
      console.error("Resend failed:", err);
      setError("Failed to resend code. Please try again later.");
      hapticError();
    }
  };

  const handlePaste = async () => {
    const result = await readClipboard();
    if (result.success && result.text) {
      const digits = extractDigits(result.text, 6);
      if (digits.length > 0) {
        setCode(digits);
        setError("");
        hapticSuccess();
      }
    } else {
      hapticError();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-purple/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-purple">mark_email_read</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Enter Code</h2>
        <p className="text-taupe text-center text-sm mb-1">We sent a 6-digit code to</p>
        <p className="text-purple text-center text-sm mb-5">{email}</p>

        {/* Code dots */}
        <div className="flex gap-3 mb-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-11 h-12 rounded-xl ${error ? "bg-red-500/20 border-red-500" : code[i] ? "bg-purple/20 border-purple" : "bg-white/5 border-white/20"} border flex items-center justify-center`}
              animate={error ? { x: [-5, 5, -5, 5, 0] } : i < code.length ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.2 }}
            >
              <span className="text-white">{code[i] || ""}</span>
            </motion.div>
          ))}
        </div>

        {/* Paste button - uses Telegram clipboard API */}
        <button
          className="flex items-center gap-2 text-purple text-sm mb-4 px-4 py-2 bg-purple/10 rounded-xl active:bg-purple/20 transition-colors"
          onClick={handlePaste}
        >
          <span className="material-symbols-outlined text-base">content_paste</span>
          <span>Paste code</span>
        </button>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`w-[76px] h-[76px] rounded-2xl flex items-center justify-center text-2xl font-semibold
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handleCodeInput(key)}
              disabled={isLoading}
            >
              {key === "del" ? "DEL" : key}
            </motion.button>
          ))}
        </div>

        <motion.button
          className="w-full max-w-sm py-3 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white font-bold disabled:opacity-50 mb-3"
          whileTap={{ scale: 0.98 }}
          onClick={handleVerify}
          disabled={code.length !== 6 || isLoading}
        >
          {isLoading ? "Verifying..." : "Verify"}
        </motion.button>

        <button
          className={`text-sm ${canResend ? "text-purple" : "text-taupe"}`}
          onClick={handleResend}
          disabled={!canResend}
        >
          {canResend ? "Resend Code" : `Resend in ${resendTimer}s`}
        </button>
      </div>
    </motion.div>
  );
}

function WalletRecoveryPasskeyScreen({ email, partyId, sessionId, onRecovered, onBack }: {
  email: string;
  partyId: string;
  sessionId: string;
  onRecovered: () => void;
  onBack: () => void;
}) {
  const { refreshBalance } = useWalletContext();
  const [step, setStep] = useState<"ready" | "authenticating" | "decrypting" | "success" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [credentialCount, setCredentialCount] = useState(0);

  useEffect(() => {
    checkPasskeys();
  }, [partyId, sessionId]);

  const checkPasskeys = async () => {
    try {
            const challengeData = await api.recoveryChallenge(sessionId, partyId);
      setCredentialCount(challengeData.allowCredentials?.length || 0);
    } catch (err) {
      console.error("Failed to check passkeys:", err);
    }
  };

  const handleAuthenticate = async () => {
    setStep("authenticating");
    setError(null);

    try {
      
      // Get challenge
      const challengeData = await api.recoveryChallenge(sessionId, partyId);

      // Convert challenge to ArrayBuffer
      const challengeBuffer = Uint8Array.from(atob(challengeData.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

      // Prepare credential IDs
      const allowCredentials = challengeData.allowCredentials.map(cred => ({
        id: Uint8Array.from(atob(cred.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
        type: 'public-key' as const,
      }));

      // Request passkey authentication
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBuffer,
          allowCredentials,
          userVerification: 'preferred',
          timeout: 60000,
        },
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error("No credential selected");
      }

      setStep("decrypting");

      const response = credential.response as AuthenticatorAssertionResponse;

      // Convert to base64url
      const toBase64Url = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      };

      // Verify passkey with backend
      const verifyResult = await api.recoveryVerifyPasskey({
        sessionId,
        partyId,
        credentialId: toBase64Url(credential.rawId),
        authenticatorData: toBase64Url(response.authenticatorData),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        signature: toBase64Url(response.signature),
      });

      // Recovery successful - mark as complete on backend
      await api.recoveryComplete(sessionId);

      // Refresh wallet state from backend
      // The backend has marked the recovery as complete
      await refreshBalance();

      setStep("success");
      hapticSuccess();

      setTimeout(() => {
        onRecovered();
      }, 1000);

    } catch (err) {
      console.error("Passkey authentication failed:", err);
      setError(err instanceof Error ? err.message : "Authentication failed");
      setStep("error");
      hapticError();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] rounded-3xl p-6 max-w-sm w-full"
      >
        {step === "ready" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center space-y-6"
          >
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple to-lilac rounded-2xl flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-white">fingerprint</span>
            </div>

            <div>
              <h2 className="text-xl font-bold text-white mb-2">Authenticate with Passkey</h2>
              <p className="text-taupe text-sm">
                Use Face ID, Touch ID, or your device PIN to access your wallet.
              </p>
            </div>

            {credentialCount > 0 && (
              <div className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-taupe text-sm">Registered passkeys</span>
                  <span className="text-white font-medium">{credentialCount}</span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleAuthenticate}
                className="w-full py-3.5 bg-gradient-to-r from-purple to-lilac text-white font-semibold rounded-xl flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">lock_open</span>
                Authenticate with Passkey
              </button>
              <button
                onClick={onBack}
                className="w-full py-3 text-taupe text-sm"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {step === "authenticating" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 bg-purple/20 rounded-full animate-ping" />
              <div className="relative w-full h-full bg-gradient-to-br from-purple to-lilac rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-white">fingerprint</span>
              </div>
            </div>
            <p className="text-white font-medium mb-2">Complete on your device</p>
            <p className="text-taupe text-sm">Use Face ID, Touch ID, or PIN when prompted</p>
          </motion.div>
        )}

        {step === "decrypting" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <div className="w-12 h-12 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-medium mb-2">Restoring wallet...</p>
            <p className="text-taupe text-sm">Decrypting your wallet data</p>
          </motion.div>
        )}

        {step === "success" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-8"
          >
            <div className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-400">check_circle</span>
            </div>
            <p className="text-white font-medium mb-2">Recovery Successful!</p>
            <p className="text-taupe text-sm">Opening your wallet...</p>
          </motion.div>
        )}

        {step === "error" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6 space-y-4"
          >
            <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-400">error</span>
            </div>
            <div>
              <p className="text-white font-medium mb-1">Authentication Failed</p>
              <p className="text-taupe text-sm">{error}</p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => { setError(null); setStep("ready"); }}
                className="w-full py-3 bg-white/10 text-white font-medium rounded-xl"
              >
                Try Again
              </button>
              <button
                onClick={onBack}
                className="w-full py-3 text-taupe text-sm"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

// ==================== FORGOT PIN FLOW ====================

/**
 * Forgot PIN - Email Input Screen
 * Step 1: User enters email to start recovery
 */
function ForgotPinEmailScreen({ onContinue, onBack }: {
  onContinue: (email: string, partyId: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleCheckEmail = async () => {
    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      hapticError();
      return;
    }

    setIsLoading(true);
    setError("");

    try {
            const result = await api.recoveryCheckEmail(email);

      if (!result.hasWallet) {
        setError("No wallet found for this email address");
        hapticError();
        setIsLoading(false);
        return;
      }

      if (!result.hasPasskey) {
        setError("No passkey registered. Cannot reset PIN without passkey.");
        hapticError();
        setIsLoading(false);
        return;
      }

      // Send verification code
      const sendResult = await api.recoverySendCode(email);
      if (!sendResult.message.includes("sent")) {
        setError(sendResult.message);
        hapticError();
        setIsLoading(false);
        return;
      }

      hapticSuccess();
      onContinue(email, result.partyId!);
    } catch (err) {
      console.error("Email check failed:", err);
      setError("Failed to verify email. Please try again.");
      hapticError();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-start pt-8 overflow-y-auto min-h-0">
        <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-3xl text-amber-400">lock_reset</span>
        </div>
        <h2 className="text-white text-2xl font-bold mb-2">Reset Your PIN</h2>
        <p className="text-taupe text-center mb-8">Enter your email to verify your identity</p>

        <div className="w-full max-w-sm mb-4">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && email && !isLoading) handleCheckEmail(); }}
            placeholder="Enter your email"
            className="w-full px-4 py-4 bg-white/10 rounded-2xl text-white placeholder-taupe outline-none focus:ring-2 focus:ring-amber-500"
            disabled={isLoading}
          />
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>

        <motion.button
          className="w-full max-w-sm py-4 bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl text-white font-bold text-lg disabled:opacity-50"
          whileTap={{ scale: 0.98 }}
          onClick={handleCheckEmail}
          disabled={!email || isLoading}
        >
          {isLoading ? "Verifying..." : "Continue"}
        </motion.button>
      </div>
    </motion.div>
  );
}

/**
 * Forgot PIN - Code Verification Screen
 * Step 2: User enters 6-digit code sent to email
 */
function ForgotPinCodeScreen({ email, onContinue, onBack }: {
  email: string;
  onContinue: (sessionId: string, partyId: string, walletId: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(r => r - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [resendTimer]);

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        setCode(prev => {
          if (prev.length >= 6) return prev;
          setError("");
          return prev + digit;
        });
      },
      onBackspace: () => {
        setCode(prev => prev.slice(0, -1));
        setError("");
      },
      onEnter: () => {
        if (code.length === 6 && !isLoading) handleVerify();
      }
    });
  }, [code, isLoading]);

  const handleCodeInput = (digit: string) => {
    if (code.length < 6) {
      setCode(code + digit);
      setError("");
      hapticLight();
    }
  };

  const handleDelete = () => {
    setCode(code.slice(0, -1));
    setError("");
    hapticLight();
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      hapticError();
      return;
    }

    setIsLoading(true);
    setError("");

    try {
            const result = await api.recoveryVerifyCode(email, code);
      hapticSuccess();
      onContinue(result.sessionId, result.partyId, result.walletId);
    } catch (err) {
      console.error("Code verification failed:", err);
      setError("Invalid code. Please try again.");
      setCode("");
      hapticError();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setCanResend(false);
    setResendTimer(60);
    setError("");

    try {
            const result = await api.recoverySendCode(email);
      if (result.message?.includes("sent")) {
        hapticSuccess();
      } else {
        setError(result.message || "Failed to resend code");
        hapticError();
      }
    } catch (err) {
      console.error("Resend failed:", err);
      setError("Failed to resend code. Please try again later.");
      hapticError();
    }
  };

  const handlePaste = async () => {
    const result = await readClipboard();
    if (result.success && result.text) {
      const digits = extractDigits(result.text, 6);
      if (digits.length > 0) {
        setCode(digits);
        setError("");
        hapticSuccess();
      }
    } else {
      hapticError();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-amber-500/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-amber-400">mark_email_read</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Enter Verification Code</h2>
        <p className="text-taupe text-center text-sm mb-1">We sent a 6-digit code to</p>
        <p className="text-amber-400 text-center text-sm mb-5">{email}</p>

        {/* Code dots */}
        <div className="flex gap-3 mb-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-11 h-12 rounded-xl ${error ? "bg-red-500/20 border-red-500" : code[i] ? "bg-amber-500/20 border-amber-500" : "bg-white/5 border-white/20"} border flex items-center justify-center`}
              animate={error ? { x: [-5, 5, -5, 5, 0] } : i < code.length ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.2 }}
            >
              <span className="text-white">{code[i] || ""}</span>
            </motion.div>
          ))}
        </div>

        {/* Paste button - uses Telegram clipboard API */}
        <button
          className="flex items-center gap-2 text-amber-400 text-sm mb-4 px-4 py-2 bg-amber-500/10 rounded-xl active:bg-amber-500/20 transition-colors"
          onClick={handlePaste}
        >
          <span className="material-symbols-outlined text-base">content_paste</span>
          <span>Paste code</span>
        </button>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`w-[76px] h-[76px] rounded-2xl flex items-center justify-center text-2xl font-semibold
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handleCodeInput(key)}
              disabled={isLoading}
            >
              {key === "del" ? "DEL" : key}
            </motion.button>
          ))}
        </div>

        <motion.button
          className="w-full max-w-sm py-3 bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl text-white font-bold disabled:opacity-50 mb-3"
          whileTap={{ scale: 0.98 }}
          onClick={handleVerify}
          disabled={code.length !== 6 || isLoading}
        >
          {isLoading ? "Verifying..." : "Verify"}
        </motion.button>

        <button
          className={`text-sm ${canResend ? "text-amber-400" : "text-taupe"}`}
          onClick={handleResend}
          disabled={!canResend}
        >
          {canResend ? "Resend Code" : `Resend in ${resendTimer}s`}
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Forgot PIN - Passkey Verification Screen
 * Step 3: User authenticates with existing passkey and recovers share
 */
function ForgotPinPasskeyScreen({ partyId, sessionId, onVerified, onBack }: {
  partyId: string;
  sessionId: string;
  onVerified: (recoveredShareHex: string) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState<"ready" | "authenticating" | "decrypting" | "success" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [credentialCount, setCredentialCount] = useState(0);

  useEffect(() => {
    checkPasskeys();
  }, [partyId, sessionId]);

  const checkPasskeys = async () => {
    try {
            const challengeData = await api.recoveryChallenge(sessionId, partyId);
      setCredentialCount(challengeData.allowCredentials?.length || 0);
    } catch (err) {
      console.error("Failed to check passkeys:", err);
    }
  };

  const handleAuthenticate = async () => {
    setStep("authenticating");
    setError(null);

    try {
            const { recoverWithPasskey } = await import("../crypto/passkey");

      // Get challenge and encrypted share from backend
      const challengeData = await api.recoveryChallenge(sessionId, partyId);

      // Convert to base64url format for passkey recovery
      const toBase64Url = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      };

      // First, do WebAuthn authentication to verify with backend
      const challengeBuffer = Uint8Array.from(atob(challengeData.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const allowCredentials = challengeData.allowCredentials.map(cred => ({
        id: Uint8Array.from(atob(cred.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
        type: 'public-key' as const,
      }));

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: challengeBuffer,
          allowCredentials,
          userVerification: 'preferred',
          timeout: 60000,
        },
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error("No credential selected");
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      // Verify passkey with backend and get encrypted share
      const verifyResult = await api.recoveryVerifyPasskey({
        sessionId,
        partyId,
        credentialId: toBase64Url(credential.rawId),
        authenticatorData: toBase64Url(response.authenticatorData),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        signature: toBase64Url(response.signature),
      });

      setStep("decrypting");

      // Now use recoverWithPasskey to decrypt the share with PRF
      const { recoveryShareHex } = await recoverWithPasskey(
        challengeData.challenge,
        challengeData.allowCredentials.map(c => ({ credentialId: c.id })),
        {
          ciphertext: verifyResult.encryptedShare,
          nonce: verifyResult.nonce,
        },
        partyId
      );

      setStep("success");
      hapticSuccess();

      setTimeout(() => {
        onVerified(recoveryShareHex);
      }, 500);

    } catch (err) {
      console.error("Passkey authentication failed:", err);
      setError(err instanceof Error ? err.message : "Authentication failed");
      setStep("error");
      hapticError();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] rounded-3xl p-6 max-w-sm w-full"
      >
        {step === "ready" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center space-y-6"
          >
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl text-white">fingerprint</span>
            </div>

            <div>
              <h2 className="text-xl font-bold text-white mb-2">Verify Your Identity</h2>
              <p className="text-taupe text-sm">
                Authenticate with your passkey to reset your PIN.
              </p>
            </div>

            {credentialCount > 0 && (
              <div className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-taupe text-sm">Available passkeys</span>
                  <span className="text-white font-medium">{credentialCount}</span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={handleAuthenticate}
                className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined">lock_open</span>
                Authenticate
              </button>
              <button
                onClick={onBack}
                className="w-full py-3 text-taupe text-sm"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}

        {step === "authenticating" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <div className="w-16 h-16 mx-auto mb-4 relative">
              <div className="absolute inset-0 bg-amber-500/20 rounded-full animate-ping" />
              <div className="relative w-full h-full bg-gradient-to-br from-amber-500 to-orange-500 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-white">fingerprint</span>
              </div>
            </div>
            <p className="text-white font-medium mb-2">Authenticating...</p>
            <p className="text-taupe text-sm">Use Face ID, Touch ID, or PIN when prompted</p>
          </motion.div>
        )}

        {step === "decrypting" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <div className="w-12 h-12 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white font-medium mb-2">Recovering wallet...</p>
            <p className="text-taupe text-sm">Decrypting your wallet data</p>
          </motion.div>
        )}

        {step === "success" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-8"
          >
            <div className="w-16 h-16 mx-auto mb-4 bg-green-500/20 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-400">check_circle</span>
            </div>
            <p className="text-white font-medium mb-2">Identity Verified!</p>
            <p className="text-taupe text-sm">Creating new PIN...</p>
          </motion.div>
        )}

        {step === "error" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6 space-y-4"
          >
            <div className="w-16 h-16 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-400">error</span>
            </div>
            <div>
              <p className="text-white font-medium mb-1">Verification Failed</p>
              <p className="text-taupe text-sm">{error}</p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => { setError(null); setStep("ready"); }}
                className="w-full py-3 bg-white/10 text-white font-medium rounded-xl"
              >
                Try Again
              </button>
              <button
                onClick={onBack}
                className="w-full py-3 text-taupe text-sm"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Forgot PIN - New PIN Screen
 * Step 4: User creates new 6-digit PIN
 */
function ForgotPinNewScreen({ onContinue, onBack }: {
  onContinue: (pin: string) => void;
  onBack: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        setPin(prev => {
          if (prev.length >= 6) return prev;
          setError("");
          const newPin = prev + digit;
          if (newPin.length === 6) {
            setTimeout(() => onContinue(newPin), 200);
          }
          return newPin;
        });
      },
      onBackspace: () => {
        setPin(prev => prev.slice(0, -1));
        setError("");
      },
    });
  }, [onContinue]);

  const handlePinInput = (digit: string) => {
    if (pin.length < 6) {
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
      hapticLight();
      if (newPin.length === 6) {
        setTimeout(() => onContinue(newPin), 200);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError("");
    hapticLight();
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0">← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-green-400">lock</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Create New PIN</h2>
        <p className="text-taupe text-center text-sm mb-6">Enter a 6-digit PIN to secure your wallet</p>

        {/* PIN dots */}
        <div className="flex gap-4 mb-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-4 h-4 rounded-full ${error ? "bg-red-500" : i < pin.length ? "bg-green-400" : "bg-white/20"}`}
              animate={error ? { x: [-5, 5, -5, 5, 0] } : i < pin.length ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.2 }}
            />
          ))}
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-4 w-full max-w-[280px] mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`aspect-square rounded-full flex items-center justify-center text-3xl font-medium
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handlePinInput(key)}
            >
              {key === "del" ? <span className="material-symbols-outlined text-2xl">backspace</span> : key}
            </motion.button>
          ))}
        </div>

        <p className="text-taupe/60 text-xs text-center">
          Choose a PIN you'll remember.<br />
          Don't use simple patterns like 123456.
        </p>
      </div>
    </motion.div>
  );
}

/**
 * Forgot PIN - Confirm PIN Screen
 * Step 5: User confirms new PIN and saves encrypted share
 */
function ForgotPinConfirmScreen({ originalPin, sessionId, recoveredShareHex, onComplete, onBack }: {
  originalPin: string;
  sessionId: string;
  recoveredShareHex: string;
  onComplete: () => void;
  onBack: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Keyboard support (desktop only, no hidden input to avoid mobile keyboard)
  useEffect(() => {
    return setupKeyboardListeners({
      onDigit: (digit) => {
        if (isProcessing) return;
        setPin(prev => {
          if (prev.length >= 6) return prev;
          setError("");
          const newPin = prev + digit;
          if (newPin.length === 6) {
            handlePinComplete(newPin);
          }
          return newPin;
        });
      },
      onBackspace: () => {
        if (isProcessing) return;
        setPin(prev => prev.slice(0, -1));
        setError("");
      },
    });
  }, [isProcessing, originalPin]);

  const handlePinComplete = async (confirmPin: string) => {
    if (confirmPin !== originalPin) {
      setError("PINs don't match. Try again.");
      setPin("");
      hapticError();
      return;
    }

    setIsProcessing(true);

    try {
            const { encryptWithPin } = await import("../crypto/pin");
      const { storeEncryptedShare, storePinCheck, PIN_CHECK_VALUE } = await import("../crypto/keystore");

      // Get user ID for storage
      const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString() || 'dev-user';

      // Encrypt recovered share with new PIN
      const encrypted = await encryptWithPin(recoveredShareHex, confirmPin);
      await storeEncryptedShare(
        userId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.salt
      );

      // Store PIN check value
      const pinCheckEncrypted = await encryptWithPin(PIN_CHECK_VALUE, confirmPin);
      await storePinCheck(
        userId,
        pinCheckEncrypted.ciphertext,
        pinCheckEncrypted.iv,
        pinCheckEncrypted.salt
      );

      // Notify backend about PIN reset (for audit)
      await api.pinReset(sessionId);

      hapticSuccess();
      onComplete();
    } catch (err) {
      console.error("PIN reset failed:", err);
      setError("Failed to reset PIN. Please try again.");
      setPin("");
      hapticError();
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePinInput = (digit: string) => {
    if (pin.length < 6 && !isProcessing) {
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
      hapticLight();
      if (newPin.length === 6) {
        handlePinComplete(newPin);
      }
    }
  };

  const handleDelete = () => {
    if (!isProcessing) {
      setPin(pin.slice(0, -1));
      setError("");
      hapticLight();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button onClick={onBack} className="text-taupe mb-4 self-start flex-shrink-0" disabled={isProcessing}>← Back</button>

      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-2xl text-green-400">check_circle</span>
        </div>
        <h2 className="text-white text-xl font-bold mb-1">Confirm New PIN</h2>
        <p className="text-taupe text-center text-sm mb-6">Re-enter your new PIN to confirm</p>

        {/* PIN dots */}
        <div className="flex gap-4 mb-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <motion.div
              key={i}
              className={`w-4 h-4 rounded-full ${error ? "bg-red-500" : i < pin.length ? "bg-green-400" : "bg-white/20"}`}
              animate={error ? { x: [-5, 5, -5, 5, 0] } : i < pin.length ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.2 }}
            />
          ))}
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        {isProcessing && <p className="text-green-400 text-sm mb-4">Resetting PIN...</p>}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-4 w-full max-w-[280px] mb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key) => (
            <motion.button
              key={key}
              className={`aspect-square rounded-full flex items-center justify-center text-3xl font-medium
                ${key === "" ? "invisible" : key === "del" ? "text-taupe" : "bg-white/10 text-white active:bg-white/20"}`}
              whileTap={{ scale: 0.95 }}
              onClick={() => key === "del" ? handleDelete() : key && handlePinInput(key)}
              disabled={isProcessing}
            >
              {key === "del" ? <span className="material-symbols-outlined text-2xl">backspace</span> : key}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== WALLET READY ====================
function WalletReadyScreen({ onComplete, recoveryCode, onClearRecovery, partyId }: {
  onComplete: () => void;
  recoveryCode?: string | null;
  onClearRecovery?: () => void;
  partyId?: string;
}) {
  const [showRecovery, setShowRecovery] = useState(!!recoveryCode);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  const handleCopyRecovery = () => {
    if (recoveryCode) {
      navigator.clipboard.writeText(recoveryCode);
      setCopiedRecovery(true);
      try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
      setTimeout(() => setCopiedRecovery(false), 2000);
    }
  };

  const handleContinue = () => {
    if (onClearRecovery) onClearRecovery();
    onComplete();
  };

  if (showRecovery && recoveryCode) {
    return (
      <motion.div
        className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto min-h-0">
          <div className="w-16 h-16 rounded-full bg-yellow/20 flex items-center justify-center text-3xl mb-6">
            🔐
          </div>

          <h2 className="text-white text-2xl font-bold mb-2 text-center">Save Your Recovery Code</h2>
          <p className="text-taupe text-center mb-6 text-sm">
            Write this down and keep it safe. You'll need it to recover your wallet.
          </p>

          <div className="w-full bg-white/5 rounded-2xl p-4 mb-4 border border-yellow/30">
            <p className="text-yellow font-mono text-xs break-all text-center">
              {recoveryCode}
            </p>
          </div>

          <button
            className="flex items-center gap-2 text-purple mb-8"
            onClick={handleCopyRecovery}
          >
            <span className="material-symbols-outlined text-sm">content_copy</span>
            <span>{copiedRecovery ? "Copied!" : "Copy to clipboard"}</span>
          </button>

          <div className="w-full p-4 bg-red-500/10 border border-red-500/30 rounded-xl mb-6">
            <p className="text-red-400 text-sm text-center">
              Warning: This code will only be shown once. Make sure to save it!
            </p>
          </div>
        </div>

        <motion.button
          className="w-full py-4 bg-gradient-to-r from-yellow to-purple rounded-2xl text-black font-bold text-lg flex-shrink-0"
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowRecovery(false)}
        >
          I've Saved It
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="absolute inset-0 flex flex-col px-5 pt-4 pb-5 overflow-hidden"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto min-h-0">
        <motion.div
          className="w-32 h-32 rounded-full bg-gradient-to-br from-yellow to-purple flex items-center justify-center mb-8"
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", duration: 0.8 }}
        >
          <span className="material-symbols-outlined text-6xl text-black">check</span>
        </motion.div>

        <motion.h2
          className="text-white text-3xl font-bold mb-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          Wallet Ready!
        </motion.h2>

        <motion.p
          className="text-taupe text-center mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          Your CC Bot Wallet is set up on Canton Network
        </motion.p>

        {partyId && (
          <motion.div
            className="w-full bg-white/5 rounded-xl p-3 mb-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55 }}
          >
            <p className="text-taupe text-xs mb-1">Your Party ID:</p>
            <p className="text-white/70 text-xs font-mono break-all">{partyId}</p>
          </motion.div>
        )}

        <motion.div
          className="w-full space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          {[
            "Passkey protection enabled",
            "PIN protection enabled",
            "Recovery backup ready",
            "Canton Network connected"
          ].map((text, i) => (
            <div key={i} className="flex items-center gap-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
              <span className="material-symbols-outlined text-green-500 text-xl">check_circle</span>
              <p className="text-white">{text}</p>
            </div>
          ))}
        </motion.div>
      </div>

      <motion.button
        className="w-full py-4 bg-gradient-to-r from-yellow to-purple rounded-2xl text-black font-bold text-lg flex-shrink-0"
        whileTap={{ scale: 0.98 }}
        onClick={handleContinue}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        Start Using Wallet
      </motion.button>
    </motion.div>
  );
}

// ==================== AI LOGO COMPONENT ====================
function AIAssistantLogo({ size = 28 }: { size?: number; isActive?: boolean }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Image
        src="/aichatlogo.png"
        alt="AI Assistant"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="object-contain"
      />
    </div>
  );
}

// ==================== TAB BAR ====================
function TabBar({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: Screen) => void }) {
  const tabs = [
    { id: "home", icon: "home", label: "Home" },
    { id: "discover", icon: "explore", label: "Discover" },
    { id: "ai-assistant", icon: "assistant", label: "CC Bot", isCenter: true },
    { id: "rewards", icon: "redeem", label: "Rewards" },
    { id: "settings", icon: "person", label: "Profile" },
  ];

  return (
    <div className="absolute bottom-0 left-0 right-0 px-2 pb-8 pt-3 z-50" style={{ background: "linear-gradient(to top, rgba(3, 2, 6, 0.98) 0%, rgba(3, 2, 6, 0.95) 100%)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(135, 92, 255, 0.15)" }}>
      <div className="flex justify-around items-end">
        {tabs.map((tab: { id: string; icon: string; label: string; isCenter?: boolean }) => (
          tab.isCenter ? (
            // AI Assistant Center Button - Special Design
            <motion.button
              key={tab.id}
              className="flex flex-col items-center relative -mt-6 press-glow-gradient"
              style={{ touchAction: "manipulation" }}
              whileTap={{ scale: 0.9 }}
              onTouchEnd={(e) => {
                e.preventDefault();
                try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium"); } catch {}
                onTabChange(tab.id as Screen);
              }}
              onClick={() => {
                try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium"); } catch {}
                onTabChange(tab.id as Screen);
              }}
            >
              <motion.div
                className="w-14 h-14 rounded-2xl flex items-center justify-center relative overflow-hidden"
                style={{
                  background: activeTab === tab.id
                    ? "linear-gradient(135deg, rgba(135, 92, 255, 0.3) 0%, rgba(213, 165, 227, 0.2) 100%)"
                    : "linear-gradient(135deg, rgba(135, 92, 255, 0.15) 0%, rgba(213, 165, 227, 0.1) 100%)",
                  border: activeTab === tab.id ? "2px solid rgba(243, 255, 151, 0.5)" : "2px solid rgba(135, 92, 255, 0.3)",
                  boxShadow: activeTab === tab.id
                    ? "0 0 25px rgba(135, 92, 255, 0.6), 0 0 50px rgba(243, 255, 151, 0.2), 0 4px 15px rgba(0, 0, 0, 0.3)"
                    : "0 4px 15px rgba(0, 0, 0, 0.3)"
                }}
                animate={activeTab === tab.id ? {
                  boxShadow: [
                    "0 0 25px rgba(135, 92, 255, 0.6), 0 0 50px rgba(243, 255, 151, 0.2)",
                    "0 0 35px rgba(243, 255, 151, 0.4), 0 0 60px rgba(135, 92, 255, 0.3)",
                    "0 0 25px rgba(135, 92, 255, 0.6), 0 0 50px rgba(243, 255, 151, 0.2)"
                  ]
                } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <AIAssistantLogo size={32} isActive={activeTab === tab.id} />
              </motion.div>
              <span className={`text-xs font-medium mt-1 ${activeTab === tab.id ? "text-[#F3FF97]" : "text-[#A89F91]"}`}>{tab.label}</span>
            </motion.button>
          ) : (
            // Regular Tab Buttons
            <motion.button
              key={tab.id}
              className="flex flex-col items-center py-2 px-4 rounded-xl relative press-glow-purple"
              style={{ touchAction: "manipulation" }}
              whileTap={{ scale: 0.9 }}
              onTouchEnd={(e) => {
                e.preventDefault();
                console.log('[TabBar] TouchEnd on:', tab.id);
                try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {}
                onTabChange(tab.id as Screen);
              }}
              onClick={() => {
                console.log('[TabBar] Click on:', tab.id);
                try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch {}
                onTabChange(tab.id as Screen);
              }}
            >
              {activeTab === tab.id && (
                <motion.div
                  className="absolute inset-0 rounded-xl"
                  layoutId="activeTab"
                  style={{ background: "rgba(135, 92, 255, 0.15)", border: "1px solid rgba(135, 92, 255, 0.3)" }}
                  transition={{ type: "spring", duration: 0.5 }}
                />
              )}
              <span className={`material-symbols-outlined text-xl mb-1 relative z-10 ${activeTab === tab.id ? "text-[#F3FF97]" : "text-[#A89F91]"}`}>{tab.icon}</span>
              <span className={`text-xs font-medium relative z-10 ${activeTab === tab.id ? "text-[#F3FF97]" : "text-[#A89F91]"}`}>{tab.label}</span>
            </motion.button>
          )
        ))}
      </div>
    </div>
  );
}

// ==================== HEADER ====================
function Header({ title, onBack, rightAction }: { title: string; onBack?: () => void; rightAction?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between p-4 pt-2">
      {onBack ? (
        <motion.button
          className="w-10 h-10 rounded-full flex items-center justify-center press-glow-purple"
          style={{ background: "rgba(135, 92, 255, 0.15)", border: "1px solid rgba(135, 92, 255, 0.25)" }}
          whileTap={{ scale: 0.9 }}
          whileHover={{ background: "rgba(135, 92, 255, 0.25)" }}
          onClick={onBack}
        >
          <span className="material-symbols-outlined text-[#FFFFFC]">arrow_back</span>
        </motion.button>
      ) : <div className="w-10" />}
      <h1 className="text-[#FFFFFC] font-bold text-lg">{title}</h1>
      {rightAction || <div className="w-10" />}
    </div>
  );
}

// ==================== DASHBOARD ====================
function Dashboard({ onNavigate }: { onNavigate: (screen: Screen, params?: any) => void }) {
  const { user, wallet, transactions, loadTransactions, refreshBalance } = useWalletContext();
  const { price, getUsdValue, getPortfolioChange } = usePrice(30000); // Update every 30s
  const tgUser = window.Telegram?.WebApp.initDataUnsafe?.user;
  const [isBalanceHidden, setIsBalanceHidden] = useState(false);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // Format balance for display
  const ccBalance = wallet?.balance ? parseFloat(wallet.balance).toFixed(2) : "0.00";
  const totalBalance = `${ccBalance} CC`;

  // Calculate USD value and 24h change
  const usdValue = getUsdValue(ccBalance);
  const portfolioChange = getPortfolioChange(ccBalance);

  const tokens = [
    { symbol: "CC", name: "Canton Coin", balance: ccBalance, value: usdValue, change: portfolioChange.percent, icon: "logo", color: "#875CFF" },
  ];

  const recentTxs = transactions.slice(0, 4).map(tx => ({
    id: tx.id,
    txHash: tx.txHash || tx.id,
    type: tx.type,
    amount: `${tx.type === 'send' ? '-' : '+'}${tx.amount} CC`,
    address: tx.counterparty ? tx.counterparty.slice(0, 12) + '...' : 'Unknown',
    date: new Date(tx.timestamp).toLocaleDateString(),
  }));

  const openTxInExplorer = (txHash: string) => {
    const explorerUrl = `https://devnet.ccview.io/tx/${txHash}`;
    window.open(explorerUrl, '_blank');
  };

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <motion.div
              className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-[#030206]"
              style={{
                background: "linear-gradient(135deg, #875CFF 0%, #D5A5E3 50%, #F3FF97 100%)",
                boxShadow: "0 0 20px rgba(135, 92, 255, 0.4)"
              }}
              animate={{ boxShadow: ["0 0 20px rgba(135, 92, 255, 0.4)", "0 0 30px rgba(243, 255, 151, 0.3)", "0 0 20px rgba(135, 92, 255, 0.4)"] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              {tgUser?.first_name?.[0] || user?.firstName?.[0] || "U"}
            </motion.div>
            <div>
              <p className="text-[#A89F91] text-sm">Welcome back</p>
              <p className="text-[#FFFFFC] font-bold">{tgUser?.first_name || user?.firstName || "User"}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <motion.button
              className="w-10 h-10 rounded-full flex items-center justify-center press-glow-purple"
              style={{ background: "rgba(255, 255, 252, 0.05)", border: "1px solid rgba(255, 255, 252, 0.1)" }}
              whileTap={{ scale: 0.9 }}
              whileHover={{ background: "rgba(135, 92, 255, 0.2)", borderColor: "rgba(135, 92, 255, 0.3)" }}
              onClick={() => onNavigate("notifications")}
            >
              <span className="material-symbols-outlined text-[#FFFFFC]">notifications</span>
            </motion.button>
            <motion.button
              className="w-10 h-10 rounded-full flex items-center justify-center press-glow-purple"
              style={{ background: "rgba(255, 255, 252, 0.05)", border: "1px solid rgba(255, 255, 252, 0.1)" }}
              whileTap={{ scale: 0.9 }}
              whileHover={{ background: "rgba(135, 92, 255, 0.2)", borderColor: "rgba(135, 92, 255, 0.3)" }}
              onClick={() => onNavigate("settings")}
            >
              <span className="material-symbols-outlined text-[#FFFFFC]">settings</span>
            </motion.button>
          </div>
        </div>

        {/* Balance Card */}
        <motion.div
          className="rounded-3xl p-6 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
          style={{
            background: "linear-gradient(135deg, rgba(135, 92, 255, 0.2) 0%, rgba(213, 165, 227, 0.1) 50%, rgba(243, 255, 151, 0.05) 100%)",
            border: "1.5px solid rgba(243, 255, 151, 0.35)",
            boxShadow: "0 0 60px rgba(135, 92, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)"
          }}
        >
          {/* Animated gradient overlay */}
          <motion.div
            className="absolute inset-0 opacity-30"
            animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            style={{
              background: "linear-gradient(90deg, transparent, rgba(243, 255, 151, 0.1), transparent)",
              backgroundSize: "200% 100%"
            }}
          />
          <div className="flex items-center gap-2 mb-1 relative z-10">
            <p className="text-[#A89F91] text-sm">Total Balance</p>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
                setIsBalanceHidden(!isBalanceHidden);
              }}
              className="p-1 rounded-full press-glow-yellow"
            >
              <span className="material-symbols-outlined text-[#A89F91] text-lg">
                {isBalanceHidden ? "visibility_off" : "visibility"}
              </span>
            </motion.button>
          </div>
          <p className="text-[#FFFFFC] text-4xl font-bold mb-1 relative z-10">
            {isBalanceHidden ? "••••••" : totalBalance}
          </p>
          <p className="text-[#A89F91] text-xs mb-1 relative z-10">
            {isBalanceHidden ? "••••••" : usdValue}
          </p>
          <p className={`text-sm relative z-10 ${portfolioChange.isPositive ? 'text-[#F3FF97]' : 'text-red-400'}`}>
            {isBalanceHidden ? "••••••" : `${portfolioChange.usd} (${portfolioChange.percent}) today`}
          </p>

          {/* Action Buttons */}
          <div className="flex justify-center gap-3 mt-6 relative z-10">
            {[
              { icon: "arrow_upward", label: "Send", screen: "send" },
              { icon: "arrow_downward", label: "Receive", screen: "receive" },
              { icon: "swap_horiz", label: "Swap", screen: "swap" },
              { icon: "link", label: "Bridge", screen: "bridge" },
            ].map((action) => (
              <motion.button
                key={action.label}
                className="action-btn"
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
                  onNavigate(action.screen as Screen);
                }}
              >
                <div className="action-btn-icon">
                  <span className="material-symbols-outlined">{action.icon}</span>
                </div>
                <span className="action-btn-label">{action.label}</span>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Tokens */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[#FFFFFC] font-bold">Your Tokens</h2>
          <button className="text-[#875CFF] text-sm" onClick={() => onNavigate("wallet")}>See all</button>
        </div>

        <div className="space-y-3">
          {tokens.map((token) => (
            <motion.div
              key={token.symbol}
              className="rounded-2xl p-4 flex items-center gap-4 press-glow-purple"
              style={{
                background: "rgba(255, 255, 252, 0.03)",
                border: "1px solid rgba(255, 255, 252, 0.08)"
              }}
              whileTap={{ scale: 0.98 }}
              whileHover={{ background: "rgba(135, 92, 255, 0.08)", borderColor: "rgba(135, 92, 255, 0.2)" }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${token.color}20` }}
              >
                {token.icon === "logo" ? (
                  <Image src="/ccbotlogo.png" alt="CC" width={28} height={28} />
                ) : (
                  <span className="material-symbols-outlined" style={{ color: token.color }}>{token.icon}</span>
                )}
              </div>
              <div className="flex-1">
                <p className="text-[#FFFFFC] font-medium">{token.name}</p>
                <p className="text-[#A89F91] text-sm">{token.balance} {token.symbol}</p>
              </div>
              <div className="text-right">
                <p className="text-[#FFFFFC] font-medium">{token.value}</p>
                <p className={`text-sm ${token.change.startsWith("+") ? "text-[#F3FF97]" : "text-red-400"}`}>
                  {token.change}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="px-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[#FFFFFC] font-bold">Recent Activity</h2>
          <button className="text-[#875CFF] text-sm" onClick={() => onNavigate("history")}>See all</button>
        </div>

        <div className="space-y-2">
          {recentTxs.length === 0 ? (
            <p className="text-[#A89F91] text-sm text-center py-4">No transactions yet</p>
          ) : recentTxs.map((tx) => (
            <motion.div
              key={tx.id}
              className="rounded-xl p-3 flex items-center gap-3 cursor-pointer press-glow-purple"
              style={{ background: "rgba(255, 255, 252, 0.03)", border: "1px solid rgba(255, 255, 252, 0.06)" }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
                openTxInExplorer(tx.txHash);
              }}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                tx.type === "receive" ? "bg-[#F3FF97]/20" : "bg-[#D5A5E3]/20"
              }`}>
                <span className={`material-symbols-outlined ${
                  tx.type === "receive" ? "text-[#F3FF97]" : "text-[#D5A5E3]"
                }`}>
                  {tx.type === "receive" ? "arrow_downward" : "arrow_upward"}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-[#FFFFFC] text-sm font-medium">{tx.address}</p>
                <p className="text-[#A89F91] text-xs">{tx.date}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-medium ${
                  tx.amount.startsWith("+") ? "text-[#F3FF97]" : "text-[#D5A5E3]"
                }`}>
                  {tx.amount}
                </p>
                <span className="material-symbols-outlined text-[#A89F91] text-sm">open_in_new</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== WALLET SCREEN ====================
function WalletScreen({ onNavigate }: { onNavigate: (screen: Screen, params?: any) => void }) {
  const { wallet, refreshBalance } = useWalletContext();

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  const ccBalance = wallet?.balance ? parseFloat(wallet.balance).toFixed(2) : "0.00";
  const lockedBalance = wallet?.locked ? parseFloat(wallet.locked).toFixed(2) : "0.00";

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header title="Wallet" />

      <div className="px-4">
        {/* Balance */}
        <div className="text-center py-4">
          <p className="text-taupe text-sm mb-1">Total Balance</p>
          <p className="text-white text-4xl font-bold">{ccBalance} CC</p>
          {parseFloat(lockedBalance) > 0 && (
            <p className="text-taupe text-sm mt-1">Locked: {lockedBalance} CC</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-6">
          <motion.button
            className="flex-1 py-3 bg-purple rounded-xl text-white font-medium"
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate("send")}
          >
            Send
          </motion.button>
          <motion.button
            className="flex-1 py-3 bg-white/10 rounded-xl text-white font-medium"
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate("receive")}
          >
            Receive
          </motion.button>
        </div>

        {/* Token */}
        <h3 className="text-white font-bold mb-3">Tokens</h3>
        <div className="space-y-3 mb-6">
          <motion.div
            className="bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#875CFF20" }}
            >
              <Image src="/ccbotlogo.png" alt="CC" width={32} height={32} />
            </div>
            <div className="flex-1">
              <p className="text-white font-medium text-lg">Canton Coin</p>
              <p className="text-taupe">{ccBalance} CC</p>
            </div>
            <div className="text-right">
              <p className="text-white font-medium text-lg">{ccBalance} CC</p>
            </div>
          </motion.div>
        </div>

        {/* Party ID */}
        <h3 className="text-white font-bold mb-3">Wallet Address</h3>
        <div className="bg-white/5 rounded-2xl p-4 mb-6">
          <p className="text-taupe text-xs mb-2">Party ID</p>
          <p className="text-white text-sm font-mono break-all">{wallet?.partyId || "No wallet"}</p>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== TRANSACTION CONFIRMATION COMPONENT ====================
interface TransactionConfirmationProps {
  pendingTransaction: PendingTransaction;
  onConfirm: () => void;
  onCancel: () => void;
}

function TransactionConfirmation({ pendingTransaction, onConfirm, onCancel }: TransactionConfirmationProps) {
  const { getUsdValue } = usePrice();
  const ESTIMATED_NETWORK_FEE = 0.001; // Estimated network fee in CC

  const amount = parseFloat(pendingTransaction.amount) || 0;
  const total = amount + ESTIMATED_NETWORK_FEE;
  const usdAmount = getUsdValue(amount);
  const usdTotal = getUsdValue(total);

  // Format recipient display
  const formatRecipient = () => {
    if (pendingTransaction.recipientUsername) {
      return `@${pendingTransaction.recipientUsername}`;
    }
    const partyId = pendingTransaction.recipientPartyId;
    if (partyId.length > 24) {
      return `${partyId.slice(0, 12)}...${partyId.slice(-8)}`;
    }
    return partyId;
  };

  const handleConfirm = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium");
    } catch {}
    onConfirm();
  };

  const handleCancel = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
    } catch {}
    onCancel();
  };

  return (
    <AnimatePresence>
      {/* Blur Background Overlay */}
      <motion.div
        className="absolute inset-0 z-40"
        style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleCancel}
      >
        <div className="absolute inset-0 bg-black/60" />
      </motion.div>

      {/* Slide-up Modal */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-50"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        <div className="bg-[#0a0812] rounded-t-[32px] border-t border-purple/30 p-6 pb-10">
          {/* Handle Bar */}
          <div className="flex justify-center mb-4">
            <div className="w-12 h-1 bg-white/20 rounded-full" />
          </div>

          {/* Title */}
          <h2 className="text-white text-xl font-bold text-center mb-6">Confirm Transaction</h2>

          {/* Transaction Details */}
          <div className="space-y-4 mb-6">
            {/* Recipient */}
            <div className="bg-white/5 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-purple">
                    {pendingTransaction.recipientUsername ? "alternate_email" : "person"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-taupe text-sm">Sending to</p>
                  <p className="text-white font-medium truncate">{formatRecipient()}</p>
                </div>
              </div>
            </div>

            {/* Amount */}
            <div className="bg-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-taupe">Amount</span>
                <div className="text-right">
                  <p className="text-white font-bold text-lg">{amount.toFixed(2)} CC</p>
                  <p className="text-taupe text-sm">{usdAmount}</p>
                </div>
              </div>
            </div>

            {/* Network Fee */}
            <div className="bg-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-taupe">Network Fee</span>
                  <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">estimated</span>
                </div>
                <p className="text-white font-medium">~{ESTIMATED_NETWORK_FEE.toFixed(4)} CC</p>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/10 my-2" />

            {/* Total */}
            <div className="bg-gradient-to-r from-purple/10 to-lilac/10 rounded-2xl p-4 border border-purple/20">
              <div className="flex items-center justify-between">
                <span className="text-white font-semibold">Total</span>
                <div className="text-right">
                  <p className="text-white font-bold text-xl">{total.toFixed(4)} CC</p>
                  <p className="text-taupe text-sm">{usdTotal}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <motion.button
              className="flex-1 py-4 rounded-2xl bg-white/10 text-taupe font-semibold"
              whileTap={{ scale: 0.98 }}
              onClick={handleCancel}
            >
              Cancel
            </motion.button>
            <motion.button
              className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-purple to-lilac text-white font-bold press-glow-gradient"
              whileTap={{ scale: 0.98 }}
              onClick={handleConfirm}
            >
              Confirm & Continue
            </motion.button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ==================== SEND SCREEN ====================
function SendScreen({ onBack }: { onBack: () => void }) {
  const { wallet, sendTransfer, isTransferring, transferError, refreshBalance } = useWalletContext();
  const security = useSecurity();
  const [recipient, setRecipient] = useState("");
  const [recipientPartyId, setRecipientPartyId] = useState("");
  const [recipientUsername, setRecipientUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | undefined>();
  const [searchResults, setSearchResults] = useState<Array<{ username: string; partyId: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const balance = wallet?.balance ? parseFloat(wallet.balance) : 0;

  // Search usernames when input starts with @
  useEffect(() => {
    const query = recipient.startsWith("@") ? recipient.slice(1) : "";
    if (query.length < 1) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    // If it's a party ID (contains ::), don't search
    if (recipient.includes("::")) {
      setRecipientPartyId(recipient);
      setRecipientUsername("");
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
                const users = await api.searchUsernames(query, 5);
        setSearchResults(users);
        setShowResults(users.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [recipient]);

  const handleSelectUser = (user: { username: string; partyId: string }) => {
    setRecipient(`@${user.username}`);
    setRecipientPartyId(user.partyId);
    setRecipientUsername(user.username);
    setShowResults(false);
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  };

  const handlePercentage = (pct: number) => {
    const amt = (balance * pct / 100).toFixed(2);
    setAmount(amt);
  };

  const handleSend = async () => {
    // Resolve username to party ID if needed
    let resolvedPartyId = recipientPartyId;

    if (recipient.startsWith("@") && !recipientPartyId) {
      try {
                const resolved = await api.resolveUsername(recipient.slice(1));
        resolvedPartyId = resolved.partyId;
        setRecipientPartyId(resolved.partyId);
      } catch {
        setPinError("Username not found");
        return;
      }
    } else if (!recipient.startsWith("@") && recipient.includes("::")) {
      resolvedPartyId = recipient;
      setRecipientPartyId(recipient);
    }

    if (!resolvedPartyId && !recipient.includes("::")) {
      setPinError("Invalid recipient");
      return;
    }

    if (!amount) return;

    // Show confirmation screen first (new flow)
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
    } catch {}
    setShowConfirmation(true);
  };

  // Handle confirmation accepted - proceed to PIN entry
  const handleConfirmationAccepted = () => {
    setShowConfirmation(false);
    // Set pending transaction in security context
    const targetPartyId = recipientPartyId || recipient;
    security.setPendingTransaction({
      recipientPartyId: targetPartyId,
      recipientUsername: recipientUsername || undefined,
      amount,
    });
    setShowPinModal(true);
  };

  // Handle confirmation cancelled - return to send screen
  const handleConfirmationCancelled = () => {
    setShowConfirmation(false);
    security.setPendingTransaction(null);
  };

  const handleConfirmPin = async () => {
    setPinError("");

    // Use security context to confirm transaction
    const result = await security.confirmTransaction(pin);

    if (result.success) {
      setSuccess(true);
      setTxHash(result.txHash);
      setShowPinModal(false);
      // Refresh balance after successful transfer
      refreshBalance();
      setTimeout(() => onBack(), 2000);
    } else {
      setPinError(result.error || "Transfer failed");
    }
  };

  // Keyboard and paste support for PIN modal on PC/desktop
  const handleConfirmPinRef = useRef(handleConfirmPin);
  handleConfirmPinRef.current = handleConfirmPin;
  useEffect(() => {
    if (!showPinModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        setPin(prev => {
          if (prev.length >= 6) return prev;
          const next = prev + e.key;
          if (next.length === 6) setTimeout(() => handleConfirmPinRef.current(), 100);
          return next;
        });
      } else if (e.key === "Backspace" || e.key === "Delete") {
        setPin(prev => prev.slice(0, -1));
      } else if (e.key === "Escape") {
        setShowPinModal(false); setPin(""); setPinError("");
      }
    };

    // Paste support for PIN
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedText = e.clipboardData?.getData("text") || "";
      const digits = pastedText.replace(/\D/g, "").slice(0, 6);
      if (digits.length > 0) {
        setPin(digits);
        if (digits.length === 6) setTimeout(() => handleConfirmPinRef.current(), 100);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [showPinModal]);

  if (success) {
    return (
      <motion.div className="h-full flex flex-col items-center justify-center p-6">
        <motion.div
          className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        >
          <span className="material-symbols-outlined text-green-500 text-5xl">check</span>
        </motion.div>
        <h2 className="text-white text-2xl font-bold mb-2">Transfer Sent!</h2>
        <p className="text-taupe">{amount} CC sent successfully</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="h-full flex flex-col"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Send" onBack={onBack} />

      <div className="flex-1 px-4 pb-40">
        <div className="mb-6 relative">
          <label className="text-taupe text-sm mb-2 block">Recipient</label>
          <div className="bg-white/5 rounded-2xl p-4 flex items-center gap-3">
            <span className="material-symbols-outlined text-purple">
              {recipientUsername ? "alternate_email" : "person"}
            </span>
            <input
              type="text"
              placeholder="@username or party ID"
              className="flex-1 bg-transparent text-white outline-none text-sm"
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setRecipientPartyId("");
                setRecipientUsername("");
              }}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && recipient && amount) handleSend();
              }}
            />
            {isSearching && <span className="material-symbols-outlined text-taupe animate-spin text-sm">progress_activity</span>}
            {recipientUsername && <span className="material-symbols-outlined text-green-500 text-sm">check_circle</span>}
            <button className="text-purple"><span className="material-symbols-outlined">qr_code_scanner</span></button>
          </div>

          {/* Username Autocomplete Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-[#1a1a2e] rounded-xl border border-white/10 overflow-hidden z-50 shadow-xl">
              {searchResults.map((user) => (
                <button
                  key={user.username}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left"
                  onClick={() => handleSelectUser(user)}
                >
                  <div className="w-10 h-10 rounded-full bg-purple/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-purple">person</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">@{user.username}</p>
                    <p className="text-taupe text-xs truncate">{user.partyId.slice(0, 20)}...</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {recipientUsername && (
            <p className="text-green-400 text-xs mt-2">Sending to @{recipientUsername}</p>
          )}
        </div>

        <div className="mb-6">
          <label className="text-taupe text-sm mb-2 block">Amount</label>
          <div className="bg-white/5 rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <input
                type="text"
                placeholder="0.00"
                className="flex-1 bg-transparent text-white text-3xl font-bold outline-none"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && recipient && amount) handleSend();
                }}
              />
              <button className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl">
                <Image src="/ccbotlogo.png" alt="CC" width={20} height={20} />
                <span className="text-white font-medium">CC</span>
              </button>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-taupe">Canton Coin</span>
              <span className="text-taupe">Balance: {balance.toFixed(2)} CC</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              className="flex-1 py-2 bg-white/10 rounded-xl text-taupe text-sm hover:bg-white/20 press-glow-white"
              onClick={() => handlePercentage(pct)}
            >
              {pct === 100 ? "MAX" : `${pct}%`}
            </button>
          ))}
        </div>

        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-taupe">Network</span>
            <span className="text-white">Canton Network</span>
          </div>
          <div className="flex justify-between">
            <span className="text-taupe">Estimated Time</span>
            <span className="text-white">~2 seconds</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-32 left-0 right-0 px-4 z-10">
        <motion.button
          className={`w-full py-4 rounded-2xl text-lg font-bold press-glow-gradient ${
            recipient && amount && parseFloat(amount) > 0 && parseFloat(amount) <= balance
              ? "bg-gradient-to-r from-purple to-lilac text-white"
              : "bg-white/10 text-taupe"
          }`}
          whileTap={{ scale: 0.98 }}
          onClick={handleSend}
          disabled={!recipient || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > balance}
        >
          {isTransferring ? "Sending..." : "Send CC"}
        </motion.button>
      </div>

      {/* Transaction Confirmation Modal */}
      {showConfirmation && (
        <TransactionConfirmation
          pendingTransaction={{
            recipientPartyId: recipientPartyId || recipient,
            recipientUsername: recipientUsername || undefined,
            amount: amount,
          }}
          onConfirm={handleConfirmationAccepted}
          onCancel={handleConfirmationCancelled}
        />
      )}

      {/* PIN Modal */}
      <AnimatePresence>
        {showPinModal && (
          <motion.div
            className="absolute inset-0 bg-black/80 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-[#0a0812] rounded-3xl p-6 mx-4 w-full max-w-sm border border-purple/30"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <h3 className="text-white text-xl font-bold mb-2 text-center">Enter PIN</h3>
              <p className="text-taupe text-sm text-center mb-6">Confirm transfer of {amount} CC</p>

              <div className="flex justify-center gap-3 mb-6">
                {[0,1,2,3,4,5].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full ${pin.length > i ? 'bg-purple' : 'bg-white/20'}`}
                  />
                ))}
              </div>

              {pinError && (
                <p className="text-red-500 text-sm text-center mb-4">{pinError}</p>
              )}

              <div className="grid grid-cols-3 gap-3">
                {[1,2,3,4,5,6,7,8,9,'',0,'del'].map((key, i) => (
                  <button
                    key={i}
                    className={`py-4 rounded-xl text-xl font-bold ${key === '' ? 'invisible' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    onClick={() => {
                      if (key === 'del') {
                        setPin(p => p.slice(0, -1));
                      } else if (key !== '' && pin.length < 6) {
                        const newPin = pin + key;
                        setPin(newPin);
                        if (newPin.length === 6) {
                          setTimeout(handleConfirmPin, 100);
                        }
                      }
                    }}
                  >
                    {key === 'del' ? 'DEL' : key}
                  </button>
                ))}
              </div>

              <button
                className="w-full mt-4 py-3 text-taupe"
                onClick={() => { setShowPinModal(false); setPin(""); setPinError(""); }}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ==================== RECEIVE SCREEN ====================
function ReceiveScreen({ onBack }: { onBack: () => void }) {
  const { wallet } = useWalletContext();
  const address = wallet?.partyId || "No wallet";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const shareText = `Send CC to my Canton Wallet:\n${address}`;

    // Try Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Canton Wallet Address',
          text: shareText,
        });
        try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
        return;
      } catch {
        // User cancelled or share failed, fall through to copy
      }
    }

    // Fallback: copy to clipboard
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success"); } catch {}
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      className="h-full flex flex-col"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Receive" onBack={onBack} />

      <div className="flex-1 px-4 flex flex-col items-center justify-center">
        <motion.div
          className="bg-white rounded-3xl p-6 mb-6"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
        >
          <div className="w-48 h-48 flex items-center justify-center">
            {wallet?.partyId ? (
              <QRCode
                value={wallet.partyId}
                size={176}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                viewBox="0 0 256 256"
                fgColor="#875CFF"
                bgColor="#FFFFFF"
              />
            ) : (
              <span className="material-symbols-outlined text-6xl text-purple">qr_code_2</span>
            )}
          </div>
        </motion.div>

        <div className="w-full bg-white/5 rounded-2xl p-4 mb-4">
          <p className="text-taupe text-sm mb-2 text-center">Your Canton Address</p>
          <p className="text-white text-sm text-center font-mono break-all">{address}</p>
        </div>

        <motion.button
          className="w-full py-4 bg-purple rounded-2xl text-white font-bold flex items-center justify-center gap-2 press-glow-purple"
          whileTap={{ scale: 0.98 }}
          onClick={handleCopy}
        >
          {copied ? (
            <><span className="material-symbols-outlined text-sm mr-1">check</span> Copied!</>
          ) : (
            <><span className="material-symbols-outlined text-sm mr-1">content_copy</span> Copy Address</>
          )}
        </motion.button>

        <motion.button
          className="w-full py-4 bg-white/10 rounded-2xl text-white font-medium mt-3 press-glow-white"
          whileTap={{ scale: 0.98 }}
          onClick={handleShare}
        >
          <span className="material-symbols-outlined text-sm mr-1">share</span> Share
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== SWAP SCREEN ====================
function SwapScreen({ onBack }: { onBack: () => void }) {
  const { wallet } = useWalletContext();
  const { price } = usePrice();
  const [fromAmount, setFromAmount] = useState("");

  const ccBalance = wallet?.balance ? parseFloat(wallet.balance).toFixed(2) : "0.00";

  return (
    <motion.div
      className="h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header title="Swap" onBack={onBack} />

      <div className="flex-1 px-4 pb-40">
        <div className="bg-white/5 rounded-2xl p-4 mb-2">
          <div className="flex justify-between mb-2">
            <span className="text-taupe text-sm">From</span>
            <span className="text-taupe text-sm">Balance: {ccBalance} CC</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 bg-transparent text-white text-2xl font-bold outline-none min-w-0"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
            />
            <button className="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-xl shrink-0">
              <Image src="/cantonlogo.png" alt="CC" width={20} height={20} className="rounded-full" />
              <span className="text-white font-medium">CC</span>
              <span className="text-taupe text-xs">▼</span>
            </button>
          </div>
        </div>

        <div className="flex justify-center -my-3 z-10 relative">
          <motion.button
            className="w-12 h-12 rounded-full bg-purple flex items-center justify-center text-xl shadow-lg"
            whileTap={{ scale: 0.9, rotate: 180 }}
          >
            <span className="material-symbols-outlined text-white">swap_vert</span>
          </motion.button>
        </div>

        <div className="bg-white/5 rounded-2xl p-4 mt-2 mb-6">
          <div className="flex justify-between mb-2">
            <span className="text-taupe text-sm">To</span>
            <span className="text-taupe text-sm">Balance: 0.00 USDC</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 bg-transparent text-white text-2xl font-bold outline-none min-w-0"
              readOnly
            />
            <button className="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-xl shrink-0">
              <div className="w-5 h-5 rounded-full bg-[#2775CA] flex items-center justify-center">
                <span className="text-white text-xs font-bold">$</span>
              </div>
              <span className="text-white font-medium">USDC</span>
              <span className="text-taupe text-xs">▼</span>
            </button>
          </div>
        </div>

        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex justify-between mb-2">
            <span className="text-taupe">Rate</span>
            <span className="text-white">1 CC = ${price?.toFixed(4) || "0.00"} USD</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-taupe">Slippage</span>
            <span className="text-white">0.5%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-taupe">Network Fee</span>
            <span className="text-white">~0.001 CC</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-32 left-0 right-0 px-4 z-10">
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white text-lg font-bold"
          whileTap={{ scale: 0.98 }}
        >
          Swap
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== BRIDGE SCREEN ====================
function BridgeScreen({ onBack }: { onBack: () => void }) {
  const { wallet } = useWalletContext();
  const [amount, setAmount] = useState("");
  const [selectedFromChain, setSelectedFromChain] = useState("canton");
  const [selectedToChain, setSelectedToChain] = useState("ethereum");

  const ccBalance = wallet?.balance ? parseFloat(wallet.balance).toFixed(2) : "0.00";

  const chains = [
    { id: "canton", name: "Canton", icon: "hexagon", color: "#875CFF" },
    { id: "ethereum", name: "Ethereum", icon: "currency_exchange", color: "#627EEA" },
    { id: "polygon", name: "Polygon", icon: "change_history", color: "#8247E5" },
    { id: "arbitrum", name: "Arbitrum", icon: "architecture", color: "#28A0F0" },
    { id: "base", name: "Base", icon: "lens_blur", color: "#0052FF" },
  ];

  const handleSwapChains = () => {
    const temp = selectedFromChain;
    setSelectedFromChain(selectedToChain);
    setSelectedToChain(temp);
  };

  return (
    <motion.div
      className="h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header title="Bridge" onBack={onBack} />

      <div className="flex-1 px-4 pb-40">
        {/* From Chain */}
        <div className="bg-white/5 rounded-2xl p-4 mb-2">
          <div className="flex justify-between mb-3">
            <span className="text-taupe text-sm">From</span>
            <span className="text-taupe text-sm">Balance: {ccBalance} CC</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 bg-transparent text-white text-2xl font-bold outline-none"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl">
              <Image src="/ccbotlogo.png" alt="CC" width={20} height={20} />
              <span className="text-white font-medium">CC</span>
              <span className="text-taupe">▼</span>
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {chains.map((chain) => (
              <motion.button
                key={chain.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                  selectedFromChain === chain.id
                    ? "bg-white/20 border border-white/30"
                    : "bg-white/5 border border-transparent"
                }`}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedFromChain(chain.id)}
              >
                <span
                  className="material-symbols-outlined text-sm"
                  style={{ color: chain.color }}
                >
                  {chain.icon}
                </span>
                <span className="text-white text-sm">{chain.name}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center -my-3 z-10 relative">
          <motion.button
            className="w-12 h-12 rounded-full bg-purple flex items-center justify-center text-xl shadow-lg"
            whileTap={{ scale: 0.9, rotate: 180 }}
            onClick={handleSwapChains}
          >
            <span className="material-symbols-outlined text-white">swap_vert</span>
          </motion.button>
        </div>

        {/* To Chain */}
        <div className="bg-white/5 rounded-2xl p-4 mt-2 mb-6">
          <div className="flex justify-between mb-3">
            <span className="text-taupe text-sm">To</span>
            <span className="text-taupe text-sm">You will receive</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 bg-transparent text-white text-2xl font-bold outline-none"
              value={amount ? (parseFloat(amount) * 0.998).toFixed(2) : ""}
              readOnly
            />
            <button className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl">
              <Image src="/ccbotlogo.png" alt="CC" width={20} height={20} />
              <span className="text-white font-medium">CC</span>
              <span className="text-taupe">▼</span>
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {chains.map((chain) => (
              <motion.button
                key={chain.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap transition-all ${
                  selectedToChain === chain.id
                    ? "bg-white/20 border border-white/30"
                    : "bg-white/5 border border-transparent"
                }`}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedToChain(chain.id)}
              >
                <span
                  className="material-symbols-outlined text-sm"
                  style={{ color: chain.color }}
                >
                  {chain.icon}
                </span>
                <span className="text-white text-sm">{chain.name}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Bridge Details */}
        <div className="bg-white/5 rounded-2xl p-4 mb-4">
          <div className="flex justify-between mb-2">
            <span className="text-taupe">Route</span>
            <span className="text-white flex items-center gap-1">
              <span className="material-symbols-outlined text-sm" style={{ color: chains.find(c => c.id === selectedFromChain)?.color }}>
                {chains.find(c => c.id === selectedFromChain)?.icon}
              </span>
              →
              <span className="material-symbols-outlined text-sm" style={{ color: chains.find(c => c.id === selectedToChain)?.color }}>
                {chains.find(c => c.id === selectedToChain)?.icon}
              </span>
            </span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-taupe">Est. Time</span>
            <span className="text-white">~2-5 min</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-taupe">Bridge Fee</span>
            <span className="text-white">0.2%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-taupe">Network Fee</span>
            <span className="text-white">~0.001 CC</span>
          </div>
        </div>

        {/* Security Notice */}
        <div className="bg-purple/10 border border-purple/20 rounded-2xl p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-purple">verified_user</span>
          <div>
            <p className="text-white text-sm font-medium">Secure Cross-Chain Transfer</p>
            <p className="text-taupe text-xs">Assets are secured by Canton Network&apos;s privacy-preserving protocol</p>
          </div>
        </div>
      </div>

      <div className="absolute bottom-32 left-0 right-0 px-4 z-10">
        <motion.button
          className="w-full py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white text-lg font-bold"
          whileTap={{ scale: 0.98 }}
        >
          Bridge Assets
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== AI ASSISTANT SCREEN ====================
function AIAssistantScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const { wallet } = useWalletContext();
  const { price, getUsdValue, getPortfolioChange } = usePrice();
  const [messages, setMessages] = useState([
    { id: 1, type: "assistant", text: "Hello! I'm your CC Wallet AI Assistant. How can I help you today?", time: "Just now" }
  ]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const ccBalance = wallet?.balance ? parseFloat(wallet.balance).toFixed(2) : "0.00";
  const usdValue = getUsdValue(ccBalance);
  const portfolioChange = getPortfolioChange(ccBalance);

  const quickActions = [
    { icon: "send", label: "Send Tokens", action: "send" },
    { icon: "swap_horiz", label: "Swap Assets", action: "swap" },
    { icon: "analytics", label: "Check Portfolio", action: "portfolio" },
    { icon: "help", label: "Get Help", action: "help" },
  ];

  const handleSend = () => {
    if (!inputText.trim()) return;

    const userMessage = {
      id: messages.length + 1,
      type: "user",
      text: inputText,
      time: "Just now"
    };

    setMessages([...messages, userMessage]);
    setInputText("");
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const responses: { [key: string]: string } = {
        default: "I understand you're asking about that. Let me help you with your request. You can use the quick actions below or describe what you'd like to do in more detail.",
        send: `To send CC tokens, I can help you set up a transfer. You have ${ccBalance} CC available. Just tell me the amount and recipient address or username.`,
        swap: `I can help you swap tokens. You currently have ${ccBalance} CC (${usdValue}). Swap feature is coming soon!`,
        balance: `Your current portfolio: ${ccBalance} CC (${usdValue}). ${portfolioChange.usd} (${portfolioChange.percent}) today.`,
        stake: `Staking CC tokens is coming soon! You currently have ${ccBalance} CC available. Stay tuned for staking rewards.`
      };

      const lowerInput = inputText.toLowerCase();
      let responseText = responses.default;
      if (lowerInput.includes("send") || lowerInput.includes("transfer")) responseText = responses.send;
      else if (lowerInput.includes("swap") || lowerInput.includes("exchange")) responseText = responses.swap;
      else if (lowerInput.includes("balance") || lowerInput.includes("portfolio") || lowerInput.includes("how much")) responseText = responses.balance;
      else if (lowerInput.includes("stake") || lowerInput.includes("earn") || lowerInput.includes("apy")) responseText = responses.stake;

      setMessages(prev => [...prev, {
        id: prev.length + 1,
        type: "assistant",
        text: responseText,
        time: "Just now"
      }]);
      setIsTyping(false);
    }, 1500);
  };

  const handleQuickAction = (action: string) => {
    if (action === "send") onNavigate("send");
    else if (action === "swap") onNavigate("swap");
    else if (action === "portfolio") {
      setMessages(prev => [...prev, {
        id: prev.length + 1,
        type: "assistant",
        text: `Your Portfolio Summary:\n\n• Canton Coin: ${ccBalance} CC (${usdValue})\n\nTotal Value: ${usdValue}\n${portfolioChange.usd} (${portfolioChange.percent}) today`,
        time: "Just now"
      }]);
    } else {
      setMessages(prev => [...prev, {
        id: prev.length + 1,
        type: "assistant",
        text: "I can help you with:\n\n• Sending & receiving tokens\n• Swapping between assets\n• Checking balances & portfolio\n• Staking for rewards\n• Understanding transactions\n• Navigating the wallet\n\nJust ask me anything!",
        time: "Just now"
      }]);
    }
  };

  return (
    <motion.div
      className="h-full flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center gap-3">
          <motion.div
            className="w-12 h-12 rounded-2xl flex items-center justify-center relative"
            style={{
              background: "linear-gradient(135deg, rgba(135, 92, 255, 0.2) 0%, rgba(213, 165, 227, 0.15) 100%)",
              border: "2px solid rgba(135, 92, 255, 0.4)",
              boxShadow: "0 0 20px rgba(135, 92, 255, 0.3)"
            }}
            animate={{
              boxShadow: ["0 0 20px rgba(135, 92, 255, 0.3)", "0 0 30px rgba(243, 255, 151, 0.2)", "0 0 20px rgba(135, 92, 255, 0.3)"]
            }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <AIAssistantLogo size={28} isActive={true} />
          </motion.div>
          <div className="flex-1">
            <h1 className="text-white font-bold text-lg">CC Bot</h1>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-green-400 text-xs">Online</span>
            </div>
          </div>
          <motion.button
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255, 255, 252, 0.05)", border: "1px solid rgba(255, 255, 252, 0.1)" }}
            whileTap={{ scale: 0.9 }}
            onClick={() => onNavigate("settings")}
          >
            <span className="material-symbols-outlined text-[#A89F91]">more_vert</span>
          </motion.button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-4 ${
                  message.type === "user"
                    ? "bg-purple text-white rounded-br-md"
                    : "bg-white/5 text-white rounded-bl-md border border-white/10"
                }`}
              >
                {message.type === "assistant" && (
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-5 h-5">
                      <AIAssistantLogo size={20} isActive={true} />
                    </div>
                    <span className="text-purple text-xs font-medium">CC Bot</span>
                  </div>
                )}
                <p className="text-sm whitespace-pre-line">{message.text}</p>
                <p className={`text-xs mt-2 ${message.type === "user" ? "text-white/60" : "text-taupe"}`}>{message.time}</p>
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="bg-white/5 rounded-2xl rounded-bl-md p-4 border border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5">
                    <AIAssistantLogo size={20} isActive={true} />
                  </div>
                  <div className="flex gap-1">
                    <motion.span
                      className="w-2 h-2 bg-purple rounded-full"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                    />
                    <motion.span
                      className="w-2 h-2 bg-purple rounded-full"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                    />
                    <motion.span
                      className="w-2 h-2 bg-purple rounded-full"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Quick Actions */}
        {messages.length <= 2 && (
          <div className="mt-6">
            <p className="text-taupe text-sm mb-3">Quick Actions</p>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map((action, i) => (
                <motion.button
                  key={i}
                  className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center gap-2"
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ background: "rgba(135, 92, 255, 0.1)", borderColor: "rgba(135, 92, 255, 0.3)" }}
                  onClick={() => handleQuickAction(action.action)}
                >
                  <span className="material-symbols-outlined text-purple">{action.icon}</span>
                  <span className="text-white text-sm">{action.label}</span>
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 pb-24" style={{ background: "linear-gradient(to top, rgba(3, 2, 6, 0.98) 0%, transparent 100%)" }}>
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-2xl p-2 pl-4">
          <input
            type="text"
            placeholder="Ask me anything..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-white/40"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <motion.button
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{
              background: inputText.trim() ? "linear-gradient(135deg, #875CFF 0%, #D5A5E3 100%)" : "rgba(255, 255, 252, 0.1)"
            }}
            whileTap={{ scale: 0.9 }}
            onClick={handleSend}
          >
            <span className="material-symbols-outlined text-white">send</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== REWARDS SCREEN ====================
function RewardsScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [kycCompleted, setKycCompleted] = useState(false);
  const [kycInProgress, setKycInProgress] = useState(false);
  const [kycRewardClaimed, setKycRewardClaimed] = useState(false);

  const handleStartKYC = () => {
    setKycInProgress(true);
    // Simulate KYC process
    setTimeout(() => {
      setKycInProgress(false);
      setKycCompleted(true);
    }, 2000);
  };

  // KYC Required Screen
  if (!kycCompleted) {
    return (
      <motion.div
        className="h-full flex flex-col"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <Header title="Rewards" />

        <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-16">
          {/* Verification Icon */}
          <motion.div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6 relative"
            style={{
              background: "linear-gradient(135deg, rgba(135, 92, 255, 0.2) 0%, rgba(213, 165, 227, 0.15) 100%)",
              border: "2px solid rgba(135, 92, 255, 0.3)"
            }}
            animate={kycInProgress ? { rotate: 360 } : {}}
            transition={kycInProgress ? { duration: 2, repeat: Infinity, ease: "linear" } : {}}
          >
            <span className="material-symbols-outlined text-4xl text-[#D5A5E3]">
              {kycInProgress ? "sync" : "shield_person"}
            </span>
          </motion.div>

          <h2 className="text-white text-2xl font-bold mb-2 text-center">
            {kycInProgress ? "Verifying..." : "KYC Required"}
          </h2>
          <p className="text-taupe text-center mb-8 max-w-xs">
            {kycInProgress
              ? "Please wait while we verify your identity"
              : "Complete identity verification to unlock rewards and start earning CC tokens"
            }
          </p>

          {/* KYC Reward Preview */}
          <div className="w-full bg-gradient-to-br from-yellow/10 to-purple/10 border border-yellow/20 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-yellow/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-yellow">card_giftcard</span>
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">KYC Completion Bonus</p>
                <p className="text-taupe text-sm">One-time reward</p>
              </div>
              <p className="text-yellow font-bold">+50 CC</p>
            </div>
          </div>

          {/* Unlockable Rewards Preview */}
          <div className="w-full bg-white/5 rounded-2xl p-4 mb-6">
            <p className="text-taupe text-sm mb-3">After KYC, you can access:</p>
            <div className="space-y-3">
              {[
                { icon: "calendar_today", text: "Daily Login Rewards" },
                { icon: "trending_up", text: "Staking Rewards (up to 12% APY)" },
                { icon: "people", text: "Referral Bonuses" },
                { icon: "check_circle", text: "Task Completion Rewards" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(135, 92, 255, 0.15)" }}>
                    <span className="material-symbols-outlined text-base text-[#D5A5E3]">{item.icon}</span>
                  </div>
                  <span className="text-white text-sm">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {!kycInProgress && (
            <motion.button
              className="w-full py-4 bg-gradient-to-r from-purple to-lilac rounded-2xl text-white text-lg font-bold"
              whileTap={{ scale: 0.98 }}
              onClick={handleStartKYC}
            >
              <span className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined">verified_user</span>
                Start KYC Verification
              </span>
            </motion.button>
          )}
        </div>
      </motion.div>
    );
  }

  // KYC Completed - Show Rewards
  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header title="Rewards" />

      <div className="px-4">
        {/* KYC Reward Banner - Show if not claimed */}
        {!kycRewardClaimed && (
          <motion.div
            className="bg-gradient-to-br from-green-500/20 to-yellow/20 rounded-2xl p-4 mb-4 border border-green-500/30"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl text-green-400">verified</span>
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">KYC Verified!</p>
                <p className="text-taupe text-sm">Claim your welcome bonus</p>
              </div>
              <p className="text-yellow font-bold text-xl">+50 CC</p>
            </div>
            <motion.button
              className="w-full py-3 bg-green-500 rounded-xl text-white font-bold"
              whileTap={{ scale: 0.98 }}
              onClick={() => setKycRewardClaimed(true)}
            >
              Claim KYC Bonus
            </motion.button>
          </motion.div>
        )}

        {/* Daily Streak */}
        <div className="bg-gradient-to-br from-yellow/20 to-purple/20 rounded-3xl p-6 mb-4 border border-yellow/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-taupe text-sm">Daily Streak</p>
              <p className="text-yellow text-3xl font-bold flex items-center gap-1">7 Days <span className="material-symbols-outlined text-orange-500">local_fire_department</span></p>
            </div>
            <div className="w-16 h-16 rounded-full bg-yellow/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-yellow">redeem</span>
            </div>
          </div>
          <motion.button
            className="w-full py-3 bg-yellow rounded-xl text-black font-bold"
            whileTap={{ scale: 0.98 }}
          >
            Claim Daily Reward
          </motion.button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white/5 rounded-2xl p-4 text-center">
            <p className="text-taupe text-sm mb-1">Total Earned</p>
            <p className="text-white text-xl font-bold">{kycRewardClaimed ? "1,300" : "1,250"} CC</p>
          </div>
          <div className="bg-white/5 rounded-2xl p-4 text-center">
            <p className="text-taupe text-sm mb-1">This Week</p>
            <p className="text-green-400 text-xl font-bold">+{kycRewardClaimed ? "175" : "125"} CC</p>
          </div>
        </div>

        {/* Staking Card */}
        <motion.button
          className="w-full bg-purple/20 border border-purple/30 rounded-2xl p-4 mb-4 flex items-center gap-4"
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("staking")}
        >
          <div className="w-12 h-12 rounded-full bg-purple/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl text-purple">analytics</span>
          </div>
          <div className="flex-1 text-left">
            <p className="text-white font-medium">Stake CC Tokens</p>
            <p className="text-taupe text-sm">Earn up to 12% APY</p>
          </div>
          <span className="text-purple">→</span>
        </motion.button>

        {/* Reward History */}
        <h3 className="text-white font-bold mb-3">Reward History</h3>
        <div className="space-y-2">
          {kycRewardClaimed ? (
            <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-green-400">verified</span>
              </div>
              <div className="flex-1">
                <p className="text-white text-sm font-medium">KYC Completion Bonus</p>
                <p className="text-taupe text-xs">Just now</p>
              </div>
              <p className="text-green-400 font-medium">+50 CC</p>
            </div>
          ) : (
            <div className="bg-white/5 rounded-xl p-6 text-center">
              <span className="material-symbols-outlined text-taupe text-3xl mb-2">redeem</span>
              <p className="text-taupe text-sm">No rewards yet</p>
              <p className="text-taupe text-xs">Complete tasks to earn CC rewards</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== STAKING SCREEN ====================
function StakingScreen({ onBack }: { onBack: () => void }) {
  const { wallet } = useWalletContext();
  const [amount, setAmount] = useState("");

  const ccBalance = wallet?.balance ? parseFloat(wallet.balance).toFixed(2) : "0.00";

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Staking" onBack={onBack} />

      <div className="px-4">
        {/* Coming Soon Banner */}
        <div className="bg-yellow/10 border border-yellow/30 rounded-2xl p-4 mb-4 text-center">
          <span className="material-symbols-outlined text-yellow text-2xl mb-2">construction</span>
          <p className="text-yellow font-medium">Staking Coming Soon</p>
          <p className="text-taupe text-sm">Earn rewards by staking your CC tokens</p>
        </div>

        <div className="bg-gradient-to-br from-purple/30 to-lilac/20 rounded-3xl p-6 mb-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <p className="text-taupe text-sm">Your Staked</p>
              <p className="text-white text-2xl font-bold">0.00 CC</p>
            </div>
            <div>
              <p className="text-taupe text-sm">Rewards Earned</p>
              <p className="text-green-400 text-2xl font-bold">+0.00 CC</p>
            </div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="flex justify-between mb-1">
              <span className="text-taupe text-sm">Current APY</span>
              <span className="text-yellow font-bold">12.5%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div className="bg-gradient-to-r from-yellow to-purple h-full rounded-full w-3/4" />
            </div>
          </div>
        </div>

        <div className="bg-white/5 rounded-2xl p-4 mb-4">
          <p className="text-white font-medium mb-3">Stake More CC</p>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="0.00"
              className="flex-1 bg-white/10 rounded-xl px-4 py-3 text-white text-xl font-bold outline-none"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="text-white font-medium">CC</span>
          </div>
          <div className="flex gap-2 mb-4">
            {["25%", "50%", "75%", "MAX"].map((pct) => (
              <button key={pct} className="flex-1 py-2 bg-white/10 rounded-lg text-taupe text-sm">
                {pct}
              </button>
            ))}
          </div>
          <motion.button
            className="w-full py-3 bg-purple rounded-xl text-white font-bold"
            whileTap={{ scale: 0.98 }}
          >
            Stake CC
          </motion.button>
        </div>

        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white font-medium">Available to Stake</p>
            <p className="text-yellow font-bold">{ccBalance} CC</p>
          </div>
          <motion.button
            className="w-full py-3 bg-white/10 rounded-xl text-taupe font-medium opacity-50"
            whileTap={{ scale: 0.98 }}
            disabled
          >
            Coming Soon
          </motion.button>
          <p className="text-taupe text-xs text-center mt-2">Staking will be available soon</p>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== NFT SCREEN ====================
function NFTScreen({ onNavigate, onBack }: { onNavigate: (screen: Screen, params?: any) => void; onBack: () => void }) {
  const nfts = [
    { id: "1", name: "Canton Genesis #001", collection: "Canton Originals", image: "palette" },
    { id: "2", name: "CC Bot Avatar #42", collection: "CC Bot Collection", image: "smart_toy" },
    { id: "3", name: "DeFi Pioneer Badge", collection: "Achievement NFTs", image: "emoji_events" },
    { id: "4", name: "Early Adopter #123", collection: "CC Bot Collection", image: "star" },
  ];

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="NFT Gallery" onBack={onBack} />

      <div className="px-4 grid grid-cols-2 gap-3">
        {nfts.map((nft) => (
          <motion.div
            key={nft.id}
            className="bg-white/5 rounded-2xl p-3"
            whileTap={{ scale: 0.95 }}
            onClick={() => onNavigate("nft-detail", { nft })}
          >
            <div className="w-full aspect-square bg-gradient-to-br from-purple/30 to-lilac/30 rounded-xl flex items-center justify-center mb-3">
              <span className="material-symbols-outlined text-5xl text-purple">{nft.image}</span>
            </div>
            <p className="text-white font-medium truncate">{nft.name}</p>
            <p className="text-taupe text-sm truncate">{nft.collection}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ==================== DAPPS SCREEN ====================
function DAppsScreen({ onBack }: { onBack: () => void }) {
  const dapps = [
    { id: "1", name: "Canton DEX", desc: "Decentralized Exchange", icon: "swap_horiz", category: "DeFi" },
    { id: "2", name: "Canton Lend", desc: "Lending Protocol", icon: "account_balance", category: "DeFi" },
    { id: "3", name: "NFT Market", desc: "NFT Marketplace", icon: "image", category: "NFT" },
    { id: "4", name: "Canton Bridge", desc: "Cross-chain Bridge", icon: "link", category: "Bridge" },
  ];

  const [category, setCategory] = useState("All");
  const categories = ["All", "DeFi", "NFT", "Bridge"];

  const filtered = category === "All" ? dapps : dapps.filter(d => d.category === category);

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="dApps" onBack={onBack} />

      <div className="px-4">
        <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3 mb-4">
          <span className="material-symbols-outlined text-taupe">search</span>
          <input
            type="text"
            placeholder="Search dApps..."
            className="flex-1 bg-transparent text-white outline-none"
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${
                category === cat ? "bg-purple text-white" : "bg-white/10 text-taupe"
              }`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {filtered.map((dapp) => (
            <motion.div
              key={dapp.id}
              className="bg-white/5 rounded-2xl p-4 flex items-center gap-4"
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple/30 to-lilac/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl text-purple">{dapp.icon}</span>
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">{dapp.name}</p>
                <p className="text-taupe text-sm">{dapp.desc}</p>
              </div>
              <span className="text-purple">→</span>
            </motion.div>
          ))}
        </div>

        <motion.button
          className="w-full mt-6 p-4 bg-blue-500/20 border border-blue-500/30 rounded-2xl flex items-center gap-4"
          whileTap={{ scale: 0.98 }}
        >
          <div className="w-12 h-12 rounded-full bg-blue-500/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-xl text-blue-400">link</span>
          </div>
          <div className="flex-1 text-left">
            <p className="text-white font-medium">WalletConnect</p>
            <p className="text-taupe text-sm">Connect to any dApp</p>
          </div>
          <span className="text-blue-400">→</span>
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== SETTINGS SCREEN ====================
function SettingsScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const user = window.Telegram?.WebApp.initDataUnsafe?.user;

  const items = [
    { icon: "person", label: "Profile", desc: "Manage your account", screen: "profile" },
    { icon: "shield_lock", label: "Security", desc: "PIN, backup", screen: "security" },
    { icon: "alternate_email", label: "Canton Name", desc: "Manage your CNS", screen: "cns" },
    { icon: "notifications", label: "Notifications", desc: "Alert preferences", screen: "notifications" },
    { icon: "help", label: "Help Center", desc: "FAQ and support", screen: "help" },
  ];

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <Header title="Settings" />

      <div className="px-4">
        <motion.div
          className="bg-gradient-to-br from-purple/20 to-lilac/10 rounded-2xl p-4 mb-6 flex items-center gap-4"
          whileTap={{ scale: 0.98 }}
          onClick={() => onNavigate("profile")}
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple to-lilac flex items-center justify-center text-2xl font-bold">
            {user?.first_name?.[0] || "U"}
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-lg">{user?.first_name || "User"}</p>
            <p className="text-taupe">@{user?.username || "username"}</p>
          </div>
          <span className="text-purple">→</span>
        </motion.div>

        <div className="space-y-2">
          {items.map((item) => (
            <motion.button
              key={item.label}
              className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
              whileTap={{ scale: 0.98 }}
              onClick={() => onNavigate(item.screen as Screen)}
            >
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-xl text-purple">{item.icon}</span>
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-medium">{item.label}</p>
                <p className="text-taupe text-sm">{item.desc}</p>
              </div>
              <span className="text-taupe">→</span>
            </motion.button>
          ))}
        </div>

        <div className="mt-6 text-center">
          <p className="text-taupe text-sm">CC Bot Wallet v1.0.0</p>
          <p className="text-taupe text-xs mt-1">Built on Canton Network</p>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== SECURITY SCREEN ====================
function SecurityScreen({ onNavigate, onBack }: { onNavigate: (screen: Screen) => void; onBack: () => void }) {
  const { utxoStatus, isMerging, checkUtxoStatus, mergeUtxos, hasWallet } = useWalletContext();
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState("");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null);
  const [lockTimeout, setLockTimeout] = useState<number>(300);
  const [availableTimeouts, setAvailableTimeouts] = useState<Array<{ value: number; label: string }>>([]);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);

  // Load session settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const { default: api } = await import("../lib/api");
        const settings = await api.getSessionSettings();
        setLockTimeout(settings.lockTimeoutSeconds);
        setAvailableTimeouts(settings.availableTimeouts);
      } catch (err) {
        console.error('Failed to load session settings:', err);
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (hasWallet) {
      checkUtxoStatus();
    }
  }, [hasWallet, checkUtxoStatus]);

  const handleTimeoutChange = async (seconds: number) => {
    setIsLoadingSettings(true);
    try {
      const { default: api } = await import("../lib/api");
      await api.updateSessionSettings(seconds);
      setLockTimeout(seconds);
      setShowTimeoutModal(false);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (err) {
      console.error('Failed to update timeout:', err);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    } finally {
      setIsLoadingSettings(false);
    }
  };

  const formatTimeout = (seconds: number): string => {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds === 60) return '1 minute';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    return '1 hour';
  };

  const handleMergeClick = () => {
    setPin("");
    setMergeError(null);
    setMergeSuccess(null);
    setShowPinModal(true);
  };

  const handleMergeSubmit = async () => {
    if (pin.length !== 6) return;

    setMergeError(null);
    const result = await mergeUtxos(pin);

    if (result.success) {
      setShowPinModal(false);
      setMergeSuccess(`${result.mergedCount} UTXO merged successfully!`);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } else {
      setMergeError(result.error || "Merge failed");
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
    }
    setPin("");
  };

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Security" onBack={onBack} />

      <div className="px-4">
        <div className="bg-gradient-to-br from-green-500/20 to-green-500/10 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-taupe text-sm">Security Score</p>
              <p className="text-green-400 text-3xl font-bold">Excellent</p>
            </div>
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-400">verified_user</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <motion.button
            className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate("pin")}
          >
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">pin</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Change PIN</p>
              <p className="text-taupe text-sm">Update your 6-digit PIN</p>
            </div>
            <span className="text-taupe">→</span>
          </motion.button>

          <motion.button
            className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate("backup")}
          >
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">cloud</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Cloud Backup</p>
              <p className="text-green-400 text-sm">Enabled via Telegram</p>
            </div>
            <span className="text-taupe">→</span>
          </motion.button>

          {/* Lock Timeout Setting */}
          <motion.button
            className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowTimeoutModal(true)}
          >
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">timer</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Auto-Lock Timeout</p>
              <p className="text-taupe text-sm">{formatTimeout(lockTimeout)}</p>
            </div>
            <span className="text-taupe">→</span>
          </motion.button>

          {/* Future: Biometric Toggle (placeholder) */}
          <div className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4 opacity-50">
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">fingerprint</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Biometric Unlock</p>
              <p className="text-taupe text-sm">Coming soon</p>
            </div>
            <span className="text-taupe text-xs">Soon</span>
          </div>
        </div>

        {/* UTXO Management Section */}
        {hasWallet && (
          <div className="mt-6">
            <p className="text-taupe text-sm mb-3 px-1">Wallet Optimization</p>
            <div className={`rounded-2xl p-4 ${
              utxoStatus?.needsMerge
                ? "bg-orange-500/10 border border-orange-500/30"
                : "bg-white/5"
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    utxoStatus?.needsMerge ? "bg-orange-500/20" : "bg-purple/20"
                  }`}>
                    <span className={`material-symbols-outlined text-xl ${
                      utxoStatus?.needsMerge ? "text-orange-400" : "text-purple"
                    }`}>merge</span>
                  </div>
                  <div>
                    <p className="text-white font-medium">UTXO Count</p>
                    <p className={`text-sm ${utxoStatus?.needsMerge ? "text-orange-400" : "text-taupe"}`}>
                      {utxoStatus ? `${utxoStatus.utxoCount} fragments` : "Loading..."}
                    </p>
                  </div>
                </div>
                {utxoStatus && utxoStatus.utxoCount > 1 && (
                  <motion.button
                    className={`px-4 py-2 rounded-xl text-sm font-medium ${
                      utxoStatus.needsMerge
                        ? "bg-orange-500 text-white"
                        : "bg-purple/20 text-purple"
                    }`}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleMergeClick}
                    disabled={isMerging}
                  >
                    {isMerging ? "Merging..." : "Merge"}
                  </motion.button>
                )}
              </div>
              {utxoStatus?.needsMerge && (
                <p className="text-orange-400 text-xs">
                  Your wallet has {utxoStatus.utxoCount} fragments. Merging will optimize transactions and reduce fees.
                </p>
              )}
              {mergeSuccess && (
                <p className="text-green-400 text-xs mt-2">{mergeSuccess}</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 p-4 bg-yellow/10 border border-yellow/30 rounded-2xl">
          <p className="text-yellow text-sm font-medium mb-1 flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">lock</span> Seedless Security
          </p>
          <p className="text-taupe text-xs">
            Your private keys are encrypted and stored securely. No seed phrase needed.
          </p>
        </div>
      </div>

      {/* PIN Modal for Merge */}
      <AnimatePresence>
        {showPinModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPinModal(false)}
          >
            <motion.div
              className="bg-[#1a1a2e] rounded-3xl p-6 w-[85%] max-w-sm"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-white text-xl font-bold text-center mb-2">Enter PIN</h3>
              <p className="text-taupe text-sm text-center mb-6">
                Enter your PIN to merge UTXOs
              </p>

              <div className="flex justify-center gap-3 mb-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full ${
                      pin.length > i ? "bg-purple" : "bg-white/20"
                    }`}
                  />
                ))}
              </div>

              {mergeError && (
                <p className="text-red-400 text-sm text-center mb-4">{mergeError}</p>
              )}

              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "del"].map((num, idx) => (
                  <motion.button
                    key={idx}
                    className={`h-14 rounded-xl text-2xl font-medium ${
                      num === "" ? "invisible" : "bg-white/10 text-white"
                    }`}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      if (num === "del") {
                        setPin((p) => p.slice(0, -1));
                      } else if (num !== "" && pin.length < 6) {
                        const newPin = pin + num;
                        setPin(newPin);
                        if (newPin.length === 6) {
                          setTimeout(() => handleMergeSubmit(), 100);
                        }
                      }
                      window.Telegram?.WebApp.HapticFeedback?.selectionChanged();
                    }}
                  >
                    {num === "del" ? "DEL" : num}
                  </motion.button>
                ))}
              </div>

              <motion.button
                className="w-full mt-4 py-3 rounded-xl bg-white/10 text-taupe"
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowPinModal(false)}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeout Selection Modal */}
      <AnimatePresence>
        {showTimeoutModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowTimeoutModal(false)}
          >
            <motion.div
              className="bg-[#1a1a2e] rounded-3xl p-6 w-[85%] max-w-sm"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-white text-xl font-bold text-center mb-2">Auto-Lock Timeout</h3>
              <p className="text-taupe text-sm text-center mb-6">
                Choose how long before your wallet auto-locks
              </p>

              <div className="space-y-2">
                {availableTimeouts.map((option) => (
                  <motion.button
                    key={option.value}
                    className={`w-full p-4 rounded-xl flex items-center justify-between ${
                      lockTimeout === option.value
                        ? "bg-purple/20 border border-purple"
                        : "bg-white/5"
                    }`}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTimeoutChange(option.value)}
                    disabled={isLoadingSettings}
                  >
                    <span className="text-white">{option.label}</span>
                    {lockTimeout === option.value && (
                      <span className="material-symbols-outlined text-purple">check</span>
                    )}
                  </motion.button>
                ))}
              </div>

              {isLoadingSettings && (
                <div className="mt-4 flex items-center justify-center gap-2 text-purple">
                  <div className="w-4 h-4 border-2 border-purple border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Updating...</span>
                </div>
              )}

              <motion.button
                className="w-full mt-4 py-3 rounded-xl bg-white/10 text-taupe"
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowTimeoutModal(false)}
              >
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ==================== PROFILE SCREEN ====================
function ProfileScreen({ onNavigate, onBack }: { onNavigate: (screen: Screen) => void; onBack: () => void }) {
  const { user, wallet } = useWalletContext();
  const tgUser = window.Telegram?.WebApp.initDataUnsafe?.user;
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    setTimeout(() => setCopied(null), 2000);
  };

  const truncateMiddle = (str: string, startChars = 12, endChars = 8) => {
    if (str.length <= startChars + endChars) return str;
    return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
  };

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Profile" onBack={onBack} />

      <div className="px-4">
        {/* Profile Header */}
        <div className="flex flex-col items-center mb-6">
          <motion.div
            className="w-24 h-24 rounded-full flex items-center justify-center text-4xl font-bold mb-4"
            style={{
              background: "linear-gradient(135deg, #875CFF 0%, #D5A5E3 50%, #F3FF97 100%)",
              boxShadow: "0 0 40px rgba(135, 92, 255, 0.4)"
            }}
          >
            {tgUser?.first_name?.[0] || user?.firstName?.[0] || "U"}
          </motion.div>
          <h2 className="text-white text-2xl font-bold">
            {tgUser?.first_name || user?.firstName || "User"} {tgUser?.last_name || user?.lastName || ""}
          </h2>
          {tgUser?.username && (
            <p className="text-purple text-lg">@{tgUser.username}</p>
          )}
        </div>

        {/* Account Details */}
        <div className="space-y-3">
          {/* Party ID */}
          {wallet?.partyId && (
            <motion.div
              className="bg-white/5 rounded-2xl p-4"
              whileTap={{ scale: 0.98 }}
              onClick={() => copyToClipboard(wallet.partyId, "partyId")}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-taupe text-sm mb-1">Party ID</p>
                  <p className="text-white font-mono text-sm">{truncateMiddle(wallet.partyId)}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-sm text-purple">
                    {copied === "partyId" ? "check" : "content_copy"}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Public Key */}
          {wallet?.publicKey && (
            <motion.div
              className="bg-white/5 rounded-2xl p-4"
              whileTap={{ scale: 0.98 }}
              onClick={() => copyToClipboard(wallet.publicKey, "publicKey")}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-taupe text-sm mb-1">Public Key</p>
                  <p className="text-white font-mono text-sm">{truncateMiddle(wallet.publicKey, 16, 12)}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-sm text-purple">
                    {copied === "publicKey" ? "check" : "content_copy"}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Telegram ID */}
          <div className="bg-white/5 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-taupe text-sm mb-1">Telegram ID</p>
                <p className="text-white">{user?.telegramId || tgUser?.id || "Unknown"}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-sm text-green-400">verified</span>
              </div>
            </div>
          </div>

          {/* Account Created */}
          <div className="bg-white/5 rounded-2xl p-4">
            <p className="text-taupe text-sm mb-1">Account Status</p>
            <p className="text-green-400 font-medium">Active</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-6 space-y-3">
          <p className="text-taupe text-sm px-1">Quick Actions</p>

          <motion.button
            className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate("pin")}
          >
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">pin</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Change PIN</p>
              <p className="text-taupe text-sm">Update your security PIN</p>
            </div>
            <span className="text-taupe">→</span>
          </motion.button>

          <motion.button
            className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate("backup")}
          >
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">key</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Recovery Code</p>
              <p className="text-taupe text-sm">View your backup code</p>
            </div>
            <span className="text-taupe">→</span>
          </motion.button>

          <motion.button
            className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate("cns")}
          >
            <div className="w-12 h-12 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl text-purple">alternate_email</span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-white font-medium">Canton Name</p>
              <p className="text-taupe text-sm">Manage your @name.canton</p>
            </div>
            <span className="text-taupe">→</span>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== PIN CHANGE SCREEN ====================
function PinChangeScreen({ onBack }: { onBack: () => void }) {
  const { user, verifyPin } = useWalletContext();
  const [step, setStep] = useState<"current" | "new" | "confirm">("current");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [attempts, setAttempts] = useState(0);

  // Log audit event to backend
  const logAuditEvent = async (status: 'success' | 'failed', failureReason?: string) => {
    try {
      const { default: api } = await import("../lib/api");
      await api.logPinChangeAudit(status, failureReason);
    } catch (err) {
      console.error('Failed to log audit event:', err);
    }
  };

  const handlePinInput = async (digit: string) => {
    setError("");
    window.Telegram?.WebApp.HapticFeedback?.selectionChanged();

    if (digit === "del") {
      if (step === "current") setCurrentPin(p => p.slice(0, -1));
      else if (step === "new") setNewPin(p => p.slice(0, -1));
      else setConfirmPin(p => p.slice(0, -1));
      return;
    }

    let pin = "";
    if (step === "current") {
      pin = currentPin + digit;
      setCurrentPin(pin);
    } else if (step === "new") {
      pin = newPin + digit;
      setNewPin(pin);
    } else {
      pin = confirmPin + digit;
      setConfirmPin(pin);
    }

    if (pin.length === 6) {
      if (step === "current") {
        setIsProcessing(true);
        const valid = await verifyPin(pin);
        setIsProcessing(false);
        if (valid) {
          setStep("new");
          setAttempts(0);
          window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
        } else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          if (newAttempts >= 5) {
            setError("Too many attempts. Please try again later.");
            await logAuditEvent('failed', 'Too many incorrect PIN attempts');
          } else {
            setError(`Incorrect PIN. ${5 - newAttempts} attempts remaining.`);
          }
          setCurrentPin("");
          window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
        }
      } else if (step === "new") {
        // Validate new PIN is different from current PIN
        if (pin === currentPin) {
          setError("New PIN must be different from current PIN");
          setNewPin("");
          window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
          return;
        }
        setStep("confirm");
        window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      } else {
        if (pin === newPin) {
          // Re-encrypt share with new PIN
          setIsProcessing(true);
          try {
            const { getEncryptedShare, storeEncryptedShare, storePinCheck, PIN_CHECK_VALUE } = await import("../crypto/keystore");
            const { decryptWithPin, encryptWithPin } = await import("../crypto/pin");

            if (!user?.telegramId) throw new Error("User not found");

            const stored = await getEncryptedShare(user.telegramId);
            if (!stored) throw new Error("No stored share");

            // Decrypt with current PIN
            const share = await decryptWithPin(
              stored.encryptedShare,
              stored.iv,
              stored.salt,
              currentPin
            );

            // Re-encrypt with new PIN
            const encrypted = await encryptWithPin(share, pin);
            await storeEncryptedShare(
              user.telegramId,
              encrypted.ciphertext,
              encrypted.iv,
              encrypted.salt
            );

            // Also update PIN check value for unlock verification
            const pinCheck = await encryptWithPin(PIN_CHECK_VALUE, pin);
            await storePinCheck(
              user.telegramId,
              pinCheck.ciphertext,
              pinCheck.iv,
              pinCheck.salt
            );

            // Log successful PIN change
            await logAuditEvent('success');

            setSuccess(true);
            window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
            setTimeout(() => onBack(), 2000);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to change PIN";
            setError(errorMsg);
            await logAuditEvent('failed', errorMsg);
            window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
          } finally {
            setIsProcessing(false);
          }
        } else {
          setError("PINs don't match. Please try again.");
          setConfirmPin("");
          window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("error");
        }
      }
    }
  };

  const getStepNumber = () => {
    if (step === "current") return 1;
    if (step === "new") return 2;
    return 3;
  };

  const getTitle = () => {
    if (success) return "PIN Changed!";
    if (step === "current") return "Enter Current PIN";
    if (step === "new") return "Create New PIN";
    return "Confirm New PIN";
  };

  const getSubtitle = () => {
    if (step === "current") return "Enter your current 6-digit PIN to continue";
    if (step === "new") return "Choose a new 6-digit PIN for your wallet";
    return "Re-enter your new PIN to confirm";
  };

  const currentValue = step === "current" ? currentPin : step === "new" ? newPin : confirmPin;

  const handleCancel = () => {
    if (step !== "current" && !success) {
      // If not on first step, go back to previous step
      if (step === "confirm") {
        setStep("new");
        setConfirmPin("");
        setNewPin("");
        setError("");
      } else if (step === "new") {
        setStep("current");
        setNewPin("");
        setCurrentPin("");
        setError("");
      }
    } else {
      onBack();
    }
  };

  // Keyboard and paste support for PC/desktop
  const handlePinInputRef = useRef(handlePinInput);
  handlePinInputRef.current = handlePinInput;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (success || isProcessing || attempts >= 5) return;
      if (e.key >= "0" && e.key <= "9") handlePinInputRef.current(e.key);
      else if (e.key === "Backspace" || e.key === "Delete") handlePinInputRef.current("del");
      else if (e.key === "Escape") handleCancel();
    };

    // Paste support for PIN
    const onPaste = (e: ClipboardEvent) => {
      if (success || isProcessing || attempts >= 5) return;
      e.preventDefault();
      const pastedText = e.clipboardData?.getData("text") || "";
      const digits = pastedText.replace(/\D/g, "").slice(0, 6);
      // Input each digit sequentially
      for (const digit of digits) {
        handlePinInputRef.current(digit);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [success, isProcessing, attempts]);

  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Blurred background overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(3, 2, 6, 0.98) 0%, rgba(13, 11, 20, 0.99) 100%)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      />

      {/* Ambient glow effects */}
      <motion.div
        className="absolute top-1/4 left-1/2 w-80 h-80 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: success
            ? "radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(135, 92, 255, 0.15) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Header with back button */}
      <div className="relative z-10 flex items-center justify-between p-4 pt-6">
        <motion.button
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"
          whileTap={{ scale: 0.9 }}
          onClick={handleCancel}
        >
          <span className="material-symbols-outlined text-white">
            {step === "current" || success ? "close" : "arrow_back"}
          </span>
        </motion.button>

        {/* Progress indicator */}
        {!success && (
          <div className="flex items-center gap-2">
            <span className="text-taupe text-sm">Step {getStepNumber()}/3</span>
            <div className="flex gap-1">
              {[1, 2, 3].map((s) => (
                <motion.div
                  key={s}
                  className={`h-1 rounded-full ${
                    s <= getStepNumber() ? "bg-purple w-6" : "bg-white/20 w-4"
                  }`}
                  animate={{ width: s <= getStepNumber() ? 24 : 16 }}
                  transition={{ duration: 0.3 }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="w-10" /> {/* Spacer for centering */}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              className="flex flex-col items-center"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", duration: 0.5 }}
            >
              {/* Success animation */}
              <motion.div
                className="relative mb-6"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              >
                <motion.div
                  className="absolute -inset-4 rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(34, 197, 94, 0.3) 0%, transparent 70%)" }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center">
                  <motion.span
                    className="material-symbols-outlined text-5xl text-green-400"
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.3, type: "spring" }}
                  >
                    check_circle
                  </motion.span>
                </div>
              </motion.div>

              <motion.h2
                className="text-white text-2xl font-bold mb-2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                {getTitle()}
              </motion.h2>
              <motion.p
                className="text-taupe text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                Your PIN has been updated successfully.
                <br />
                <span className="text-sm">Redirecting you back...</span>
              </motion.p>
            </motion.div>
          ) : (
            <motion.div
              key={step}
              className="w-full flex flex-col items-center"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              {/* Icon for current step */}
              <motion.div
                className="w-16 h-16 rounded-full bg-purple/20 flex items-center justify-center mb-6"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200 }}
              >
                <span className="material-symbols-outlined text-3xl text-purple">
                  {step === "current" ? "lock" : step === "new" ? "pin" : "check_circle"}
                </span>
              </motion.div>

              <h2 className="text-white text-xl font-bold mb-2">{getTitle()}</h2>
              <p className="text-taupe text-sm mb-8 text-center max-w-xs">{getSubtitle()}</p>

              {/* PIN Dots with enhanced animation */}
              <div className="flex justify-center gap-4 mb-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <motion.div
                    key={i}
                    className={`w-4 h-4 rounded-full border-2 ${
                      currentValue.length > i
                        ? "bg-purple border-purple"
                        : currentValue.length === i
                        ? "border-purple bg-transparent"
                        : "border-white/30 bg-transparent"
                    }`}
                    animate={{
                      scale: currentValue.length === i ? 1.3 : 1,
                      borderWidth: currentValue.length === i ? 3 : 2,
                    }}
                    transition={{ type: "spring", stiffness: 300 }}
                  />
                ))}
              </div>

              {/* Error message with animation */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="flex items-center gap-2 text-red-400 text-sm mb-4"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <span className="material-symbols-outlined text-lg">error</span>
                    <span>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* PIN Keypad */}
              <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "del"].map((num, idx) => (
                  <motion.button
                    key={idx}
                    className={`h-16 rounded-2xl text-2xl font-medium ${
                      num === ""
                        ? "invisible"
                        : "bg-white/10 text-white active:bg-white/20"
                    }`}
                    whileTap={{ scale: 0.9 }}
                    whileHover={{ backgroundColor: "rgba(255,255,255,0.15)" }}
                    onClick={() => num !== "" && handlePinInput(String(num))}
                    disabled={isProcessing || attempts >= 5}
                  >
                    {num === "del" ? (
                      <span className="material-symbols-outlined">backspace</span>
                    ) : (
                      num
                    )}
                  </motion.button>
                ))}
              </div>

              {/* Processing indicator */}
              <AnimatePresence>
                {isProcessing && (
                  <motion.div
                    className="mt-6 flex items-center gap-3 text-purple"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                  >
                    <div className="w-5 h-5 border-2 border-purple border-t-transparent rounded-full animate-spin" />
                    <span>
                      {step === "current" ? "Verifying..." : "Updating PIN..."}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cancel button at bottom */}
      {!success && (
        <div className="relative z-10 p-6 pb-8">
          <motion.button
            className="w-full py-4 rounded-2xl bg-white/5 text-taupe font-medium"
            whileTap={{ scale: 0.98 }}
            onClick={handleCancel}
          >
            {step === "current" ? "Cancel" : "Go Back"}
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}

// ==================== BACKUP SCREEN ====================
function BackupScreen({ onBack }: { onBack: () => void }) {
  const { recoveryCode } = useWalletContext();
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localRecoveryCode, setLocalRecoveryCode] = useState<string | null>(null);

  // Try to get recovery code from Telegram Cloud Storage if not in context
  useEffect(() => {
    if (recoveryCode) {
      setLocalRecoveryCode(recoveryCode);
      return;
    }

    // Try Telegram Cloud Storage
    window.Telegram?.WebApp.CloudStorage?.getItem("recovery_code", (err, value) => {
      if (!err && value) {
        setLocalRecoveryCode(value);
      }
    });
  }, [recoveryCode]);

  const copyToClipboard = () => {
    if (localRecoveryCode) {
      navigator.clipboard.writeText(localRecoveryCode);
      setCopied(true);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hasRecoveryCode = localRecoveryCode || recoveryCode;

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Backup & Recovery" onBack={onBack} />

      <div className="px-4">
        {/* Warning Banner */}
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-orange-400">warning</span>
            <div>
              <p className="text-orange-400 font-medium mb-1">Keep Your Recovery Code Safe</p>
              <p className="text-taupe text-sm">
                Your recovery code is the only way to restore your wallet if you lose access. Never share it with anyone.
              </p>
            </div>
          </div>
        </div>

        {/* Recovery Code Section */}
        <div className="bg-white/5 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-white font-medium">Recovery Code</p>
              <p className="text-taupe text-sm">
                {hasRecoveryCode ? "Your backup code is stored" : "No recovery code available"}
              </p>
            </div>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              hasRecoveryCode ? "bg-green-500/20" : "bg-red-500/20"
            }`}>
              <span className={`material-symbols-outlined text-xl ${
                hasRecoveryCode ? "text-green-400" : "text-red-400"
              }`}>
                {hasRecoveryCode ? "check_circle" : "error"}
              </span>
            </div>
          </div>

          {hasRecoveryCode && (
            <>
              <motion.button
                className="w-full py-3 rounded-xl bg-purple/20 text-purple font-medium mb-3"
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowCode(!showCode)}
              >
                {showCode ? "Hide Recovery Code" : "View Recovery Code"}
              </motion.button>

              <AnimatePresence>
                {showCode && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-black/30 rounded-xl p-4 mb-3">
                      <p className="text-white font-mono text-sm break-all select-all">
                        {localRecoveryCode || recoveryCode}
                      </p>
                    </div>
                    <motion.button
                      className={`w-full py-3 rounded-xl font-medium ${
                        copied ? "bg-green-500/20 text-green-400" : "bg-white/10 text-white"
                      }`}
                      whileTap={{ scale: 0.98 }}
                      onClick={copyToClipboard}
                    >
                      {copied ? "Copied!" : "Copy to Clipboard"}
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* How Recovery Works */}
        <div className="bg-white/5 rounded-2xl p-4 mb-6">
          <p className="text-white font-medium mb-4">How Recovery Works</p>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple/20 flex items-center justify-center flex-shrink-0">
                <span className="text-purple text-sm font-bold">1</span>
              </div>
              <div>
                <p className="text-white text-sm font-medium">2-of-3 Key Sharing</p>
                <p className="text-taupe text-xs">Your private key is split into 3 parts. Any 2 can restore your wallet.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple/20 flex items-center justify-center flex-shrink-0">
                <span className="text-purple text-sm font-bold">2</span>
              </div>
              <div>
                <p className="text-white text-sm font-medium">Your PIN + Server</p>
                <p className="text-taupe text-xs">Part 1 is encrypted with your PIN. Part 2 is securely stored on our server.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-purple/20 flex items-center justify-center flex-shrink-0">
                <span className="text-purple text-sm font-bold">3</span>
              </div>
              <div>
                <p className="text-white text-sm font-medium">Recovery Code</p>
                <p className="text-taupe text-xs">Part 3 is your recovery code. Use it if you forget your PIN.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Cloud Backup Status */}
        <div className="bg-white/5 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-xl text-blue-400">cloud</span>
              </div>
              <div>
                <p className="text-white font-medium">Telegram Cloud Backup</p>
                <p className="text-green-400 text-sm">Enabled</p>
              </div>
            </div>
          </div>
          <p className="text-taupe text-xs mt-3">
            Your encrypted key share is backed up to Telegram Cloud. This allows wallet recovery on new devices with your PIN.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== NOTIFICATIONS SCREEN ====================
function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    data?: { amount?: string; from?: string; to?: string };
    read: boolean;
    createdAt: string;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    setIsLoading(true);
    try {
            const result = await api.request<{
        success: boolean;
        data: { notifications: typeof notifications; total: number };
      }>("/api/notifications");
      setNotifications(result.data.notifications || []);
    } catch (err) {
      console.error("Failed to load notifications:", err);
      // Show empty state on error
      setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
            await api.request(`/api/notifications/${id}/read`, { method: "POST" });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
            await api.request("/api/notifications/read-all", { method: "POST" });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "transfer_received": return { icon: "arrow_downward", color: "text-green-400", bg: "bg-green-500/20" };
      case "transfer_sent": return { icon: "arrow_upward", color: "text-red-400", bg: "bg-red-500/20" };
      default: return { icon: "notifications", color: "text-purple", bg: "bg-purple/20" };
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header
        title="Notifications"
        onBack={onBack}
        rightAction={
          unreadCount > 0 ? (
            <motion.button
              className="text-purple text-sm font-medium"
              whileTap={{ scale: 0.95 }}
              onClick={markAllAsRead}
            >
              Mark all read
            </motion.button>
          ) : undefined
        }
      />

      <div className="px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-3xl text-taupe">notifications_off</span>
            </div>
            <p className="text-white font-medium mb-1">No notifications yet</p>
            <p className="text-taupe text-sm text-center">
              You'll see transaction alerts and updates here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => {
              const { icon, color, bg } = getIcon(notification.type);
              return (
                <motion.div
                  key={notification.id}
                  className={`rounded-2xl p-4 flex items-start gap-3 ${
                    notification.read ? "bg-white/5" : "bg-purple/10 border border-purple/20"
                  }`}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => !notification.read && markAsRead(notification.id)}
                >
                  <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0`}>
                    <span className={`material-symbols-outlined text-xl ${color}`}>{icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`font-medium ${notification.read ? "text-white" : "text-white"}`}>
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <div className="w-2 h-2 rounded-full bg-purple flex-shrink-0 mt-2" />
                      )}
                    </div>
                    <p className="text-taupe text-sm mt-1">{notification.body}</p>
                    <p className="text-taupe text-xs mt-2">{formatDate(notification.createdAt)}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ==================== HELP SCREEN ====================
function HelpScreen({ onBack }: { onBack: () => void }) {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const faqs = [
    {
      q: "How does the seedless wallet work?",
      a: "Your private key is split into 3 parts using Shamir Secret Sharing. Part 1 is encrypted with your PIN and stored locally, Part 2 is on our secure server, and Part 3 is your recovery code. Any 2 parts can restore your wallet."
    },
    {
      q: "What happens if I forget my PIN?",
      a: "You can recover your wallet using your recovery code combined with the server share. Go to the recovery flow and enter your recovery code to set a new PIN."
    },
    {
      q: "Are my funds safe?",
      a: "Yes! Your private key is never stored in one place. We use industry-standard encryption (AES-256-GCM) and cryptographic key splitting. Even if our server is compromised, attackers can't access your funds without your PIN or recovery code."
    },
    {
      q: "What is a Party ID?",
      a: "A Party ID is your unique identifier on the Canton Network. It's like a wallet address - you share it with others to receive transfers."
    },
    {
      q: "What are UTXOs and why should I merge them?",
      a: "UTXOs (Unspent Transaction Outputs) are individual 'coins' in your wallet. Having too many can slow down transactions. Merging combines them into fewer, larger UTXOs for better performance."
    },
    {
      q: "How do I get a Canton Name?",
      a: "Go to Settings > Canton Name to register your @name.canton. This gives you a human-readable address that others can use to send you funds instead of your Party ID."
    },
  ];

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Help Center" onBack={onBack} />

      <div className="px-4">
        {/* Contact Support */}
        <motion.a
          href="https://t.me/CCBotSupport"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-gradient-to-br from-purple/20 to-lilac/10 rounded-2xl p-4 mb-6 flex items-center gap-4 block"
          whileTap={{ scale: 0.98 }}
        >
          <div className="w-14 h-14 rounded-full bg-purple/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl text-purple">support_agent</span>
          </div>
          <div className="flex-1">
            <p className="text-white font-bold">Need Help?</p>
            <p className="text-taupe text-sm">Chat with our support team on Telegram</p>
          </div>
          <span className="text-purple">→</span>
        </motion.a>

        {/* FAQ Section */}
        <div className="mb-6">
          <p className="text-white font-bold mb-4">Frequently Asked Questions</p>
          <div className="space-y-2">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                className="bg-white/5 rounded-2xl overflow-hidden"
              >
                <motion.button
                  className="w-full p-4 flex items-center justify-between text-left"
                  onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                >
                  <p className="text-white font-medium pr-4">{faq.q}</p>
                  <motion.span
                    className="material-symbols-outlined text-taupe flex-shrink-0"
                    animate={{ rotate: expandedFaq === index ? 180 : 0 }}
                  >
                    expand_more
                  </motion.span>
                </motion.button>
                <AnimatePresence>
                  {expandedFaq === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <p className="px-4 pb-4 text-taupe text-sm">{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Resources */}
        <div className="mb-6">
          <p className="text-white font-bold mb-4">Resources</p>
          <div className="space-y-2">
            <motion.a
              href="https://docs.canton.network"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white/5 rounded-2xl p-4 flex items-center gap-4 block"
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-purple">menu_book</span>
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">Documentation</p>
                <p className="text-taupe text-sm">Learn about Canton Network</p>
              </div>
              <span className="text-taupe">→</span>
            </motion.a>

            <motion.a
              href="https://twitter.com/CantonNetwork"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white/5 rounded-2xl p-4 flex items-center gap-4 block"
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-purple">tag</span>
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">Twitter / X</p>
                <p className="text-taupe text-sm">Follow for updates</p>
              </div>
              <span className="text-taupe">→</span>
            </motion.a>
          </div>
        </div>

        {/* App Info */}
        <div className="bg-white/5 rounded-2xl p-4 text-center">
          <p className="text-white font-medium">CC Bot Wallet</p>
          <p className="text-taupe text-sm">Version 1.0.0</p>
          <p className="text-taupe text-xs mt-2">Built on Canton Network</p>
          <p className="text-taupe text-xs">Using Canton SDK v0.21.0</p>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== TRANSACTION DETAIL SCREEN ====================
function TransactionDetailScreen({
  transaction,
  onBack
}: {
  transaction: {
    id: string;
    type: 'send' | 'receive';
    amount: string;
    counterparty: string;
    timestamp: string;
    status: string;
    txHash?: string;
  };
  onBack: () => void
}) {
  const { wallet } = useWalletContext();
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    setTimeout(() => setCopied(null), 2000);
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateMiddle = (str: string, startChars = 12, endChars = 8) => {
    if (!str) return 'Unknown';
    if (str.length <= startChars + endChars) return str;
    return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'confirmed': return 'text-green-400 bg-green-500/20';
      case 'pending': return 'text-yellow bg-yellow/20';
      case 'failed': return 'text-red-400 bg-red-500/20';
      default: return 'text-taupe bg-white/10';
    }
  };

  const formattedAmount = parseFloat(transaction.amount).toFixed(6);
  const isReceive = transaction.type === 'receive';

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Transaction Details" onBack={onBack} />

      <div className="px-4">
        {/* Amount Card */}
        <div className="bg-gradient-to-br from-purple/20 to-lilac/10 rounded-2xl p-6 mb-6 text-center">
          <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
            isReceive ? "bg-green-500/20" : "bg-red-500/20"
          }`}>
            <span className={`material-symbols-outlined text-3xl ${
              isReceive ? "text-green-400" : "text-red-400"
            }`}>
              {isReceive ? "arrow_downward" : "arrow_upward"}
            </span>
          </div>
          <p className={`text-3xl font-bold mb-2 ${
            isReceive ? "text-green-400" : "text-red-400"
          }`}>
            {isReceive ? "+" : "-"}{formattedAmount} CC
          </p>
          <p className="text-taupe">{isReceive ? "Received" : "Sent"}</p>
        </div>

        {/* Status Badge */}
        <div className="flex justify-center mb-6">
          <div className={`px-4 py-2 rounded-full flex items-center gap-2 ${getStatusColor(transaction.status)}`}>
            <span className="material-symbols-outlined text-sm">
              {transaction.status === 'confirmed' ? 'check_circle' :
               transaction.status === 'pending' ? 'schedule' : 'error'}
            </span>
            <span className="capitalize font-medium">{transaction.status}</span>
          </div>
        </div>

        {/* Transaction Details */}
        <div className="space-y-3">
          {/* From */}
          <motion.div
            className="bg-white/5 rounded-2xl p-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              const fromAddress = isReceive ? transaction.counterparty : (wallet?.partyId || '');
              if (fromAddress) copyToClipboard(fromAddress, "from");
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-taupe text-sm mb-1">From</p>
                <p className="text-white font-mono text-sm">
                  {isReceive
                    ? truncateMiddle(transaction.counterparty)
                    : truncateMiddle(wallet?.partyId || 'Your Wallet')
                  }
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-sm text-purple">
                  {copied === "from" ? "check" : "content_copy"}
                </span>
              </div>
            </div>
          </motion.div>

          {/* To */}
          <motion.div
            className="bg-white/5 rounded-2xl p-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              const toAddress = isReceive ? (wallet?.partyId || '') : transaction.counterparty;
              if (toAddress) copyToClipboard(toAddress, "to");
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-taupe text-sm mb-1">To</p>
                <p className="text-white font-mono text-sm">
                  {isReceive
                    ? truncateMiddle(wallet?.partyId || 'Your Wallet')
                    : truncateMiddle(transaction.counterparty)
                  }
                </p>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-sm text-purple">
                  {copied === "to" ? "check" : "content_copy"}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Date & Time */}
          <div className="bg-white/5 rounded-2xl p-4">
            <p className="text-taupe text-sm mb-1">Date & Time</p>
            <p className="text-white">{formatDate(transaction.timestamp)}</p>
          </div>

          {/* Transaction ID */}
          <motion.div
            className="bg-white/5 rounded-2xl p-4"
            whileTap={{ scale: 0.98 }}
            onClick={() => copyToClipboard(transaction.id, "txId")}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-taupe text-sm mb-1">Transaction ID</p>
                <p className="text-white font-mono text-sm">{truncateMiddle(transaction.id, 10, 10)}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-sm text-purple">
                  {copied === "txId" ? "check" : "content_copy"}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Transaction Hash (if available) */}
          {transaction.txHash && (
            <motion.div
              className="bg-white/5 rounded-2xl p-4"
              whileTap={{ scale: 0.98 }}
              onClick={() => copyToClipboard(transaction.txHash!, "txHash")}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-taupe text-sm mb-1">Transaction Hash</p>
                  <p className="text-white font-mono text-sm">{truncateMiddle(transaction.txHash, 10, 10)}</p>
                </div>
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-sm text-purple">
                    {copied === "txHash" ? "check" : "content_copy"}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Network Info */}
          <div className="bg-white/5 rounded-2xl p-4">
            <p className="text-taupe text-sm mb-1">Network</p>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-purple/20 flex items-center justify-center">
                <span className="text-purple text-xs font-bold">C</span>
              </div>
              <p className="text-white">Canton Network</p>
            </div>
          </div>
        </div>

        {/* Explorer Link (placeholder for future) */}
        <div className="mt-6 p-4 bg-white/5 rounded-2xl text-center">
          <p className="text-taupe text-sm">
            View on Canton Explorer (Coming Soon)
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ==================== HISTORY SCREEN ====================
function HistoryScreen({ onBack, onNavigate }: { onBack: () => void; onNavigate?: (screen: Screen, params?: any) => void }) {
  const { transactions, loadTransactions } = useWalletContext();
  const [filter, setFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    loadTransactions().finally(() => setIsLoading(false));
  }, [loadTransactions]);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else {
      return `${diffDays} days ago`;
    }
  };

  const formatAmount = (type: string, amount: string) => {
    const num = parseFloat(amount).toFixed(2);
    return type === 'receive' ? `+${num} CC` : `-${num} CC`;
  };

  const shortenAddress = (address: string) => {
    if (address.length > 20) {
      return `${address.slice(0, 8)}...${address.slice(-8)}`;
    }
    return address;
  };

  const filtered = filter === "all" ? transactions : transactions.filter(tx => tx.type === filter);

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="History" onBack={onBack} />

      <div className="px-4">
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {["all", "send", "receive"].map((f) => (
            <button
              key={f}
              className={`px-4 py-2 rounded-xl text-sm font-medium capitalize whitespace-nowrap ${
                filter === f ? "bg-purple text-white" : "bg-white/10 text-taupe"
              }`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-4xl text-taupe mb-2">receipt_long</span>
            <p className="text-taupe">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((tx) => (
              <motion.div
                key={tx.id}
                className="bg-white/5 rounded-2xl p-4 flex items-center gap-4 cursor-pointer"
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate?.("transaction-detail", { transaction: tx })}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                  tx.type === "receive" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                }`}>
                  <span className="material-symbols-outlined">
                    {tx.type === "receive" ? "arrow_downward" : "arrow_upward"}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium">{shortenAddress(tx.counterparty || 'Unknown')}</p>
                  <p className="text-taupe text-sm">{formatDate(tx.timestamp)}</p>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${tx.type === "receive" ? "text-green-400" : "text-red-400"}`}>
                    {formatAmount(tx.type, tx.amount)}
                  </p>
                  <p className="text-taupe text-xs capitalize">{tx.status}</p>
                </div>
                <span className="text-taupe">→</span>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ==================== CNS SCREEN ====================
function CNSScreen({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Debounced name availability check
  useEffect(() => {
    if (name.length < 3) {
      setAvailable(null);
      setError("");
      return;
    }

    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/username/check/${encodeURIComponent(name)}`);
        const data = await res.json();
        setAvailable(data.data?.available ?? false);
        // Don't set error for check reasons - only for actual registration errors
        setError("");
      } catch {
        setError("Failed to check availability");
        setAvailable(null);
      } finally {
        setIsChecking(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [name]);

  const handleRegister = async () => {
    if (!available || name.length < 3) return;
    setIsRegistering(true);
    setError("");
    try {
      
      // Re-authenticate to ensure fresh token (handles expired token in dev mode)
      const tg = window.Telegram?.WebApp;
      const initData = tg?.initData || (process.env.NODE_ENV === 'development' ? 'dev_mode_555666777' : '');
      if (initData) {
        const authResult = await api.authenticate(initData);
        api.setTokens(authResult.token, authResult.refreshToken);
      }

      await api.setUsername(name);
      setSuccessMessage(`@${name}.canton registered permanently!`);
      setTimeout(() => onBack(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Canton Name" onBack={onBack} />

      <div className="px-4">
        <div className="bg-gradient-to-br from-yellow/20 to-purple/20 rounded-2xl p-4 mb-6">
          <h3 className="text-yellow font-bold mb-2">Get Your @name.canton</h3>
          <p className="text-taupe text-sm">
            Choose a permanent name for your wallet. This cannot be changed later.
          </p>
        </div>

        <div className="mb-4">
          <label className="text-taupe text-sm mb-2 block">Choose your name</label>
          <div className="bg-white/5 rounded-2xl p-4 flex items-center gap-3">
            <span className="text-yellow text-xl">@</span>
            <input
              type="text"
              placeholder="yourname"
              className="flex-1 bg-transparent text-white text-xl outline-none"
              value={name}
              onChange={(e) => {
                setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 15));
              }}
            />
            <span className="text-taupe">.canton</span>
            {isChecking && <span className="material-symbols-outlined text-taupe animate-spin text-sm">progress_activity</span>}
          </div>
        </div>

        {successMessage && (
          <motion.div
            className="p-4 rounded-xl mb-4 bg-green-500/20 border border-green-500/30"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-green-400">{successMessage}</p>
          </motion.div>
        )}

        {!successMessage && error && available && (
          <motion.div
            className="p-4 rounded-xl mb-4 bg-red-500/20 border border-red-500/30"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className="text-red-400">{error}</p>
          </motion.div>
        )}

        {!successMessage && !error && available !== null && (
          <motion.div
            className={`p-4 rounded-xl mb-4 ${available ? "bg-green-500/20 border border-green-500/30" : "bg-red-500/20 border border-red-500/30"}`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <p className={available ? "text-green-400" : "text-red-400"}>
              {available ? `@${name}.canton is available!` : `@${name}.canton is taken`}
            </p>
          </motion.div>
        )}

      </div>

      <div className="absolute bottom-32 left-0 right-0 px-4 z-10">
        <motion.button
          className={`w-full py-4 rounded-2xl text-lg font-bold ${
            available && !isRegistering ? "bg-gradient-to-r from-yellow to-purple text-black" : "bg-white/10 text-taupe"
          }`}
          whileTap={{ scale: 0.98 }}
          disabled={!available || isRegistering}
          onClick={handleRegister}
        >
          {isRegistering ? "Registering..." : `Register @${name || "name"}.canton`}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== DISCOVER SCREEN ====================
function DiscoverScreen({ onNavigate }: { onNavigate: (screen: Screen, params?: any) => void }) {
  const categories = [
    { id: "dapps", icon: "apps", title: "DApps", desc: "Explore decentralized applications", color: "#875CFF" },
    { id: "nft", icon: "image", title: "NFTs", desc: "Browse NFT collections", color: "#D5A5E3" },
    { id: "staking", icon: "trending_up", title: "Staking", desc: "Earn rewards on your CC", color: "#F3FF97" },
    { id: "cns", icon: "alternate_email", title: "Canton Names", desc: "Get your @name.canton", color: "#22C55E" },
  ];

  const featured = [
    { id: "1", title: "Canton DEX", desc: "Swap tokens with low fees", icon: "swap_horiz", category: "DeFi" },
    { id: "2", title: "CC Staking Pool", desc: "Up to 12% APY", icon: "savings", category: "Staking" },
    { id: "3", title: "Canton Bridge", desc: "Cross-chain transfers", icon: "link", category: "Bridge" },
  ];

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Header */}
      <div className="p-4">
        <h1 className="text-[#FFFFFC] text-2xl font-bold mb-1">Discover</h1>
        <p className="text-[#A89F91] text-sm">Explore the Canton ecosystem</p>
      </div>

      {/* Search Bar */}
      <div className="px-4 mb-4">
        <div className="flex items-center gap-3 p-3 rounded-2xl" style={{ background: "rgba(255, 255, 252, 0.05)", border: "1px solid rgba(255, 255, 252, 0.1)" }}>
          <span className="material-symbols-outlined text-[#A89F91]">search</span>
          <input
            type="text"
            placeholder="Search DApps, tokens, NFTs..."
            className="flex-1 bg-transparent text-[#FFFFFC] placeholder-[#A89F91] outline-none text-sm"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="px-4 mb-6">
        <h2 className="text-[#FFFFFC] font-bold mb-3">Categories</h2>
        <div className="grid grid-cols-2 gap-3">
          {categories.map((cat) => (
            <motion.button
              key={cat.id}
              className="p-4 rounded-2xl text-left press-glow-purple"
              style={{ background: "rgba(255, 255, 252, 0.03)", border: "1px solid rgba(255, 255, 252, 0.08)" }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onNavigate(cat.id as Screen)}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                style={{ background: `${cat.color}20` }}
              >
                <span className="material-symbols-outlined" style={{ color: cat.color }}>{cat.icon}</span>
              </div>
              <p className="text-[#FFFFFC] font-medium text-sm">{cat.title}</p>
              <p className="text-[#A89F91] text-xs mt-1">{cat.desc}</p>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Featured */}
      <div className="px-4">
        <h2 className="text-[#FFFFFC] font-bold mb-3">Featured</h2>
        <div className="space-y-3">
          {featured.map((item) => (
            <motion.div
              key={item.id}
              className="p-4 rounded-2xl flex items-center gap-4 press-glow-purple"
              style={{ background: "rgba(255, 255, 252, 0.03)", border: "1px solid rgba(255, 255, 252, 0.08)" }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(135, 92, 255, 0.15)" }}>
                <span className="material-symbols-outlined text-[#875CFF]">{item.icon}</span>
              </div>
              <div className="flex-1">
                <p className="text-[#FFFFFC] font-medium">{item.title}</p>
                <p className="text-[#A89F91] text-sm">{item.desc}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-lg text-[#A89F91]" style={{ background: "rgba(255, 255, 252, 0.05)" }}>{item.category}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ==================== TASKS SCREEN ====================
function TasksScreen({ onBack }: { onBack: () => void }) {
  const [tasks, setTasks] = useState([
    { id: "1", title: "Complete KYC verification", desc: "Verify your identity to unlock all features", status: "pending", priority: "high" },
    { id: "2", title: "Set up 2FA authentication", desc: "Add extra security to your account", status: "completed", priority: "high" },
    { id: "3", title: "Claim daily reward", desc: "Don't forget to claim your daily CC tokens", status: "pending", priority: "medium" },
    { id: "4", title: "Stake CC tokens", desc: "Earn up to 12% APY by staking", status: "pending", priority: "low" },
    { id: "5", title: "Register Canton Name", desc: "Get your unique @name.canton identity", status: "pending", priority: "medium" },
  ]);

  const [filter, setFilter] = useState("all");

  const toggleTask = (id: string) => {
    setTasks(tasks.map(task =>
      task.id === id
        ? { ...task, status: task.status === "completed" ? "pending" : "completed" }
        : task
    ));
  };

  const filteredTasks = filter === "all"
    ? tasks
    : filter === "completed"
      ? tasks.filter(t => t.status === "completed")
      : tasks.filter(t => t.status === "pending");

  const completedCount = tasks.filter(t => t.status === "completed").length;
  const progress = (completedCount / tasks.length) * 100;

  return (
    <motion.div
      className="h-full flex flex-col overflow-y-auto pb-32"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <Header title="Tasks" onBack={onBack} />

      <div className="px-4">
        {/* Progress Card */}
        <div className="bg-gradient-to-br from-purple/30 to-lilac/20 rounded-3xl p-6 mb-4 border border-purple/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-taupe text-sm">Progress</p>
              <p className="text-white text-2xl font-bold">{completedCount}/{tasks.length} Tasks</p>
            </div>
            <div className="w-16 h-16 rounded-full bg-purple/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-purple">task_alt</span>
            </div>
          </div>
          <div className="w-full bg-white/10 rounded-full h-3">
            <motion.div
              className="bg-gradient-to-r from-yellow to-purple h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <p className="text-taupe text-sm mt-2">{Math.round(progress)}% completed</p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-4">
          {["all", "pending", "completed"].map((f) => (
            <button
              key={f}
              className={`px-4 py-2 rounded-xl text-sm font-medium capitalize ${
                filter === f ? "bg-purple text-white" : "bg-white/10 text-taupe"
              }`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Task List */}
        <div className="space-y-3">
          {filteredTasks.map((task) => (
            <motion.div
              key={task.id}
              className={`bg-white/5 rounded-2xl p-4 flex items-start gap-4 border ${
                task.status === "completed" ? "border-green-500/30" : "border-white/5"
              }`}
              whileTap={{ scale: 0.98 }}
              onClick={() => toggleTask(task.id)}
            >
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center mt-1 ${
                task.status === "completed"
                  ? "bg-green-500 border-green-500"
                  : "border-taupe"
              }`}>
                {task.status === "completed" && (
                  <span className="material-symbols-outlined text-sm text-white">check</span>
                )}
              </div>
              <div className="flex-1">
                <p className={`font-medium ${task.status === "completed" ? "text-taupe line-through" : "text-white"}`}>
                  {task.title}
                </p>
                <p className="text-taupe text-sm mt-1">{task.desc}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    task.priority === "high" ? "bg-red-500/20 text-red-400" :
                    task.priority === "medium" ? "bg-yellow/20 text-yellow" :
                    "bg-white/10 text-taupe"
                  }`}>
                    {task.priority}
                  </span>
                </div>
              </div>
              <span className="material-symbols-outlined text-taupe">
                {task.status === "completed" ? "check_circle" : "radio_button_unchecked"}
              </span>
            </motion.div>
          ))}
        </div>

        {/* Add Task Button */}
        <motion.button
          className="w-full mt-6 py-4 bg-purple/20 border border-purple/30 rounded-2xl flex items-center justify-center gap-2"
          whileTap={{ scale: 0.98 }}
        >
          <span className="material-symbols-outlined text-purple">add</span>
          <span className="text-purple font-medium">Add New Task</span>
        </motion.button>
      </div>
    </motion.div>
  );
}

// ==================== MAIN APP ====================
function TelegramAppContent() {
  const { isAuthLoading, hasWallet, isWalletLoading, wallet, createWallet, createWalletWithPasskeyCredential, recoveryCode, userShareHex, clearRecoveryCode, user } = useWalletContext();
  const security = useSecurity();

  const [showSplash, setShowSplash] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [navigation, setNavigation] = useState<NavigationState>({ screen: "onboarding" });
  const [navHistory, setNavHistory] = useState<NavigationState[]>([]);
  const [tempPin, setTempPin] = useState("");
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [showPasskeySetup, setShowPasskeySetup] = useState(false);
  const [isInPasskeyFlow, setIsInPasskeyFlow] = useState(false);
  const [recoveryPartyId, setRecoveryPartyId] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState<string>("");
  const [recoverySessionId, setRecoverySessionId] = useState<string | null>(null);
  // Forgot PIN flow state
  const [forgotPinEmail, setForgotPinEmail] = useState<string>("");
  const [forgotPinPartyId, setForgotPinPartyId] = useState<string | null>(null);
  const [forgotPinSessionId, setForgotPinSessionId] = useState<string | null>(null);
  const [forgotPinWalletId, setForgotPinWalletId] = useState<string | null>(null);
  const [forgotPinNewPin, setForgotPinNewPin] = useState<string>("");
  const [forgotPinRecoveredShare, setForgotPinRecoveredShare] = useState<string | null>(null);
  // NEW: State to store passkey credential data (created BEFORE wallet)
  const [passkeyCredential, setPasskeyCredential] = useState<PasskeyCredentialData | null>(null);

  // Use security context for lock state
  const isLocked = security.isLocked;
  const isPinSet = security.isPinSet;

  // Handle unlock - use security context
  const handleUnlock = useCallback(() => {
    // Unlock is handled by security context's unlock method
    // This callback is called after successful PIN verification in LockScreen
    clearLockState();
    security.resetActivityTimer();
  }, [security]);

  // Handle "Forgot PIN?" - navigate to recovery
  const handleForgotPin = useCallback(() => {
    // Navigate to forgot PIN flow (email → code → passkey → new PIN)
    // Reset forgot pin state
    setForgotPinEmail("");
    setForgotPinPartyId(null);
    setForgotPinSessionId(null);
    setForgotPinWalletId(null);
    setForgotPinNewPin("");
    setNavigation({ screen: "forgot-pin-email" });
  }, []);

  // Track viewport height for proper rendering
  const [viewportKey, setViewportKey] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#030206");
      tg.setBackgroundColor("#030206");
      tg.enableClosingConfirmation();

      // Only apply fullscreen and disable swipes on mobile (not web/desktop)
      const platform = tg.platform;
      const isMobile = platform === 'ios' || platform === 'android';

      if (isMobile) {
        // Request fullscreen to hide bot username footer (mobile only)
        if ((tg as any).requestFullscreen) {
          (tg as any).requestFullscreen();
        }
        // Disable vertical swipes to prevent accidental close (mobile only)
        if ((tg as any).disableVerticalSwipes) {
          (tg as any).disableVerticalSwipes();
        }
      }

      // Set viewport height CSS variable for proper sizing
      const setViewportHeight = () => {
        const vh = tg.viewportHeight || window.innerHeight;
        document.documentElement.style.setProperty('--tg-viewport-height', `${vh}px`);
        // Force re-render by updating key
        setViewportKey(prev => prev + 1);
      };

      setViewportHeight();

      // Handle viewport stable event (when expansion animation completes)
      const handleViewportStable = () => {
        setViewportHeight();
      };

      // Update on viewport change
      tg.onEvent('viewportChanged', setViewportHeight);
      window.addEventListener('resize', setViewportHeight);

      // Also handle orientation change
      window.addEventListener('orientationchange', () => {
        setTimeout(setViewportHeight, 100);
      });

      return () => {
        tg.offEvent('viewportChanged', setViewportHeight);
        window.removeEventListener('resize', setViewportHeight);
      };
    }
  }, []);

  // Check wallet state when auth/wallet loading completes
  useEffect(() => {
    if (isAuthLoading || isWalletLoading) return;

    if (hasWallet) {
      // Don't change onboarded state or navigate if we're in the middle of passkey/onboarding flow
      // The passkey setup component will handle navigation when complete
      const tabScreens = ["home", "discover", "ai-assistant", "rewards", "settings"];
      const validSubScreens = ["send", "receive", "swap", "bridge", "wallet", "history", "transaction-detail", "staking", "nft", "dapps", "security", "profile", "pin", "backup", "notifications", "help", "cns", "tasks", "forgot-pin-email", "forgot-pin-code", "forgot-pin-passkey", "forgot-pin-new", "forgot-pin-confirm"];
      const isOnTabScreen = tabScreens.includes(navigation.screen);
      const isOnValidSubScreen = validSubScreens.includes(navigation.screen);
      const isInOnboardingFlow = ["passkey-setup", "passkey-mandatory", "pin-setup", "pin-confirm", "wallet-creating", "wallet-ready", "passkey-recovery", "recovery-code-input", "email-setup", "email-verify", "recovery-email", "recovery-code", "recovery-passkey"].includes(navigation.screen);

      if (!isInPasskeyFlow && !isInOnboardingFlow) {
        setIsOnboarded(true);
        // Only set to home if not already on a valid screen (tab or sub-screen)
        if (!isOnTabScreen && !isOnValidSubScreen) {
          setNavigation({ screen: "home" });
        }
      }
    } else {
      setIsOnboarded(false);
    }
  }, [isAuthLoading, isWalletLoading, hasWallet, navigation.screen, isInPasskeyFlow]);

  // PIN status is now managed by SecurityContext
  // No need for local state - use security.isPinSet

  // Handle wallet creation with PIN
  const handleCreateWallet = useCallback(async (pin: string) => {
    setIsCreatingWallet(true);
    const success = await createWallet(pin);
    setIsCreatingWallet(false);
    if (success) {
      // Go to username selection before wallet-ready
      setNavigation({ screen: "choose-username" });
    }
  }, [createWallet]);

  // Handle username selection
  const handleSetUsername = useCallback(async (username: string) => {
    try {
            await api.setUsername(username);
      // Show passkey setup after username selection
      setNavigation({ screen: "passkey-setup" });
    } catch (err) {
      console.error("Failed to set username:", err);
      // Continue anyway - username can be set later
      setNavigation({ screen: "passkey-setup" });
    }
  }, []);

  // Handle passkey + wallet creation completion (OLD FLOW - kept for compatibility)
  const handlePasskeyWalletComplete = useCallback((success: boolean, walletData?: { walletId: string; partyId: string; recoveryCode: string }) => {
    setIsInPasskeyFlow(false);
    if (success && walletData) {
      // Go to PIN setup after passkey
      setNavigation({ screen: "pin-setup" });
    } else {
      // If passkey setup failed, go back to onboarding
      setNavigation({ screen: "onboarding" });
    }
  }, []);

  // Handle mandatory passkey creation completion (NEW FLOW: passkey BEFORE wallet)
  const handlePasskeyMandatoryComplete = useCallback((credentialData: { credentialId: string; publicKeySpki: string }) => {
    console.log("[Onboarding] Passkey created successfully:", credentialData.credentialId);
    setPasskeyCredential(credentialData);
    setIsInPasskeyFlow(false);
    // Now go to PIN setup
    setNavigation({ screen: "pin-setup" });
  }, []);

  // Handle PIN setup completion (NEW FLOW: creates wallet with passkey credential)
  const handlePinSetupComplete = useCallback(async (pin: string) => {
    try {
      const { storePinCheck, PIN_CHECK_VALUE } = await import("../crypto/keystore");
      const { encryptWithPin } = await import("../crypto/pin");

      // If we have a passkey credential, create wallet with it (NEW FLOW)
      if (passkeyCredential) {
        console.log("[Onboarding] Creating wallet with passkey credential...");
        setIsCreatingWallet(true);
        setNavigation({ screen: "wallet-creating" });

        const result = await createWalletWithPasskeyCredential(
          pin,
          passkeyCredential.credentialId,
          passkeyCredential.publicKeySpki
        );

        setIsCreatingWallet(false);

        if (!result.success) {
          console.error("[Onboarding] Wallet creation failed:", result.error);
          // Go back to onboarding on failure
          setNavigation({ screen: "onboarding" });
          return;
        }

        console.log("[Onboarding] Wallet created successfully");
      }

      // Encrypt check value with PIN
      const encrypted = await encryptWithPin(PIN_CHECK_VALUE, pin);
      const telegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id?.toString() || "dev-user";

      // Store encrypted check
      await storePinCheck(telegramId, encrypted.ciphertext, encrypted.iv, encrypted.salt);

      // PIN is now set - security context will detect this on next check
      // Clear any lock state since we just set up the PIN
      clearLockState();
      setIsOnboarded(true);
      setNavigation({ screen: "wallet-ready" });
    } catch (error) {
      console.error("Failed to complete wallet setup:", error);
      setIsCreatingWallet(false);
    }
  }, [passkeyCredential, createWalletWithPasskeyCredential]);

  const navigate = useCallback((screen: Screen, params?: any) => {
    setNavHistory((prev) => [...prev, navigation]);
    setNavigation({ screen, params });
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
  }, [navigation]);

  const goBack = useCallback(() => {
    if (navHistory.length > 0) {
      const prev = navHistory[navHistory.length - 1];
      setNavHistory((h) => h.slice(0, -1));
      setNavigation(prev);
      try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light"); } catch {}
    }
  }, [navHistory]);

  const handleTabChange = useCallback((tab: Screen) => {
    console.log('[TabChange] Switching to:', tab);
    setNavHistory([]);
    setNavigation({ screen: tab, fromTab: true });
  }, []);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem("cc_wallet_onboarded", "true");
    setIsOnboarded(true);
    setNavigation({ screen: "home" });
  }, []);

  const currentTab = ["home", "discover", "ai-assistant", "rewards", "settings"].includes(navigation.screen)
    ? navigation.screen
    : navHistory.find(n => ["home", "discover", "ai-assistant", "rewards", "settings"].includes(n.screen))?.screen || "home";

  const handleResendCode = useCallback(async () => {
    if (!userEmail) return;
    try {
            await api.sendEmailCode(userEmail);
    } catch (err) {
      console.error("Failed to resend code:", err);
    }
  }, [userEmail]);

  const renderScreen = () => {
    if (!isOnboarded) {
      switch (navigation.screen) {
        case "onboarding":
          return <OnboardingScreen onContinue={() => navigate("email-setup")} onExisting={() => navigate("recovery-email")} />;
        case "email-setup":
          return (
            <EmailSetupScreen
              onComplete={(email) => { setUserEmail(email); navigate("email-verify"); }}
              onBack={goBack}
              onExistingWallet={(email, partyId) => {
                setUserEmail(email);
                setRecoveryPartyId(partyId);
                navigate("passkey-recovery");
              }}
            />
          );
        case "email-verify":
          // NEW FLOW: After email verification, go to mandatory passkey creation
          return <EmailVerifyScreen email={userEmail} onComplete={() => { setIsEmailVerified(true); setIsInPasskeyFlow(true); navigate("passkey-mandatory"); }} onBack={goBack} onResend={handleResendCode} />;
        case "passkey-recovery":
          return (
            <PasskeyRecovery
              partyId={recoveryPartyId || ""}
              onRecovered={async () => {
                // Wallet recovered via passkey - navigate to home
                setIsOnboarded(true);
                setNavigation({ screen: "home" });
              }}
              onCancel={goBack}
            />
          );
        case "recovery-code-input":
          return (
            <RecoveryCodeInputScreen
              onRecovered={() => {
                // Recovery completed - wallet state is updated by recoverWithCode in context
                // Navigate to wallet-ready to show new recovery code
                setIsOnboarded(true);
                setNavigation({ screen: "wallet-ready" });
              }}
              onBack={goBack}
            />
          );
        case "recovery-email":
          return (
            <WalletRecoveryEmailScreen
              onContinue={(email, partyId) => {
                setRecoveryEmail(email);
                setRecoveryPartyId(partyId);
                navigate("recovery-code");
              }}
              onBack={goBack}
            />
          );
        case "recovery-code":
          return (
            <WalletRecoveryCodeScreen
              email={recoveryEmail}
              partyId={recoveryPartyId || ""}
              onContinue={(sessionId) => {
                setRecoverySessionId(sessionId);
                navigate("recovery-passkey");
              }}
              onBack={goBack}
            />
          );
        case "recovery-passkey":
          return (
            <WalletRecoveryPasskeyScreen
              email={recoveryEmail}
              partyId={recoveryPartyId || ""}
              sessionId={recoverySessionId || ""}
              onRecovered={() => {
                setIsOnboarded(true);
                setNavigation({ screen: "home" });
              }}
              onBack={goBack}
            />
          );
        case "passkey-mandatory":
          // NEW FLOW: Mandatory passkey creation BEFORE wallet
          return (
            <PasskeySetupMandatory
              email={userEmail}
              onComplete={handlePasskeyMandatoryComplete}
              onBack={goBack}
            />
          );
        case "passkey-setup":
          // OLD FLOW: Passkey setup with wallet creation (kept for compatibility)
          return (
            <PasskeySetupWithWallet
              email={userEmail}
              onComplete={handlePasskeyWalletComplete}
              onBack={goBack}
            />
          );
        case "wallet-creating":
          // Show wallet creation loading screen
          return (
            <motion.div
              className="h-full flex flex-col items-center justify-center p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <motion.div
                className="w-24 h-24 mx-auto mb-6 rounded-full flex items-center justify-center relative"
                style={{ background: 'linear-gradient(135deg, rgba(135, 92, 255, 0.2), rgba(213, 165, 227, 0.2))' }}
              >
                <motion.div
                  className="absolute inset-0 rounded-full border-2 border-[#875CFF]/30"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  style={{ borderTopColor: '#875CFF' }}
                />
                <span className="material-symbols-outlined text-4xl text-[#875CFF]">account_balance_wallet</span>
              </motion.div>
              <h2 className="text-white text-xl font-bold mb-2">Creating Your Wallet...</h2>
              <p className="text-taupe text-center text-sm">
                Setting up your secure wallet on Canton Network
              </p>
            </motion.div>
          );
        case "pin-setup":
          return (
            <CreatePinScreen
              onComplete={(pin) => {
                setTempPin(pin);
                setNavigation({ screen: "pin-confirm" });
              }}
              onBack={goBack}
            />
          );
        case "pin-confirm":
          return (
            <ConfirmPinScreen
              originalPin={tempPin}
              onComplete={() => handlePinSetupComplete(tempPin)}
              onBack={() => {
                setTempPin("");
                setNavigation({ screen: "pin-setup" });
              }}
            />
          );
        case "wallet-ready":
          return <WalletReadyScreen onComplete={completeOnboarding} recoveryCode={recoveryCode} onClearRecovery={clearRecoveryCode} partyId={wallet?.partyId} />;
        default:
          return <OnboardingScreen onContinue={() => navigate("email-setup")} onExisting={() => navigate("recovery-email")} />;
      }
    }

    switch (navigation.screen) {
      case "home": return <Dashboard onNavigate={navigate} />;
      case "wallet": return <WalletScreen onNavigate={navigate} />;
      case "send": return <SendScreen onBack={goBack} />;
      case "receive": return <ReceiveScreen onBack={goBack} />;
      case "swap": return <SwapScreen onBack={goBack} />;
      case "bridge": return <BridgeScreen onBack={goBack} />;
      case "history": return <HistoryScreen onBack={goBack} onNavigate={navigate} />;
      case "transaction-detail": return <TransactionDetailScreen transaction={navigation.params?.transaction} onBack={goBack} />;
      case "rewards": return <RewardsScreen onNavigate={navigate} />;
      case "ai-assistant": return <AIAssistantScreen onNavigate={navigate} />;
      case "staking": return <StakingScreen onBack={goBack} />;
      case "nft": return <NFTScreen onNavigate={navigate} onBack={goBack} />;
      case "dapps": return <DAppsScreen onBack={goBack} />;
      case "settings": return <SettingsScreen onNavigate={navigate} />;
      case "security": return <SecurityScreen onNavigate={navigate} onBack={goBack} />;
      case "profile": return <ProfileScreen onNavigate={navigate} onBack={goBack} />;
      case "pin": return <PinChangeScreen onBack={goBack} />;
      case "backup": return <BackupScreen onBack={goBack} />;
      case "notifications": return <NotificationsScreen onBack={goBack} />;
      case "help": return <HelpScreen onBack={goBack} />;
      case "cns": return <CNSScreen onBack={goBack} />;
      case "tasks": return <TasksScreen onBack={goBack} />;
      case "discover": return <DiscoverScreen onNavigate={navigate} />;
      // Forgot PIN flow (when user is locked out and forgot PIN)
      case "forgot-pin-email":
        return (
          <ForgotPinEmailScreen
            onContinue={(email, partyId) => {
              setForgotPinEmail(email);
              setForgotPinPartyId(partyId);
              navigate("forgot-pin-code");
            }}
            onBack={() => {
              // Go back to lock screen
              setNavigation({ screen: "home" });
            }}
          />
        );
      case "forgot-pin-code":
        return (
          <ForgotPinCodeScreen
            email={forgotPinEmail}
            onContinue={(sessionId, partyId, walletId) => {
              setForgotPinSessionId(sessionId);
              setForgotPinPartyId(partyId);
              setForgotPinWalletId(walletId);
              navigate("forgot-pin-passkey");
            }}
            onBack={goBack}
          />
        );
      case "forgot-pin-passkey":
        return (
          <ForgotPinPasskeyScreen
            partyId={forgotPinPartyId || ""}
            sessionId={forgotPinSessionId || ""}
            onVerified={(recoveredShare) => {
              // Passkey verified, save recovered share and create new PIN
              setForgotPinRecoveredShare(recoveredShare);
              navigate("forgot-pin-new");
            }}
            onBack={goBack}
          />
        );
      case "forgot-pin-new":
        return (
          <ForgotPinNewScreen
            onContinue={(pin) => {
              setForgotPinNewPin(pin);
              navigate("forgot-pin-confirm");
            }}
            onBack={goBack}
          />
        );
      case "forgot-pin-confirm":
        return (
          <ForgotPinConfirmScreen
            originalPin={forgotPinNewPin}
            sessionId={forgotPinSessionId || ""}
            recoveredShareHex={forgotPinRecoveredShare || ""}
            onComplete={() => {
              // PIN reset successful - clear forgot pin state and unlock
              setForgotPinRecoveredShare(null);
              setForgotPinNewPin("");
              clearLockState();
              security.resetActivityTimer();
              setNavigation({ screen: "home" });
            }}
            onBack={() => {
              setForgotPinNewPin("");
              navigate("forgot-pin-new");
            }}
          />
        );
      default: return <Dashboard onNavigate={navigate} />;
    }
  };

  // Check if running inside Telegram
  const isTelegram = typeof window !== "undefined" && window.Telegram?.WebApp?.initData;

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#030206]">
      {/* App Content */}
      <div className="absolute inset-0 overflow-hidden bg-[#030206]">
          {/* Starfield - Space/Sky Effect */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
            {/* Static twinkling stars */}
            {PARTICLES.map((p, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full"
                style={{
                  left: `${p.left}%`,
                  top: `${p.top}%`,
                  width: p.width,
                  height: p.height,
                  background: p.color,
                  boxShadow: p.type === 'glow' ? `0 0 ${p.width * 4}px ${p.color}, 0 0 ${p.width * 2}px ${p.color}` : 'none',
                }}
                animate={p.type === 'glow' ? {
                  opacity: [0.4, 1, 0.4],
                  scale: [0.8, 1.2, 0.8],
                  boxShadow: [
                    `0 0 ${p.width * 2}px ${p.color}`,
                    `0 0 ${p.width * 6}px ${p.color}, 0 0 ${p.width * 3}px ${p.color}`,
                    `0 0 ${p.width * 2}px ${p.color}`,
                  ],
                } : {
                  opacity: [0.2, 0.8, 0.2],
                }}
                transition={{
                  duration: p.duration,
                  delay: p.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            ))}

            {/* Shooting Stars */}
            {SHOOTING_STARS.map((star, i) => (
              <motion.div
                key={`shooting-${i}`}
                className="absolute"
                style={{
                  width: star.size * 20,
                  height: star.size,
                  background: `linear-gradient(90deg, ${star.color}, transparent)`,
                  borderRadius: '50%',
                  filter: `blur(0.5px)`,
                }}
                initial={{ left: '-5%', top: `${star.startTop}%`, opacity: 0 }}
                animate={{
                  left: ['-5%', '110%'],
                  top: [`${star.startTop}%`, `${star.startTop + 30}%`],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: star.duration,
                  delay: star.delay,
                  repeat: Infinity,
                  repeatDelay: 15,
                  ease: "easeIn",
                }}
              />
            ))}
          </div>

          <div className="absolute inset-0 z-10 flex justify-center safe-top">
            <div className="relative w-full h-full" style={{ maxWidth: '430px' }}>
              <AnimatePresence mode="wait">
                {showSplash ? (
                  <SplashScreen key="splash" onComplete={() => setShowSplash(false)} />
                ) : isLocked && hasWallet && !navigation.screen.startsWith("forgot-pin") ? (
                  <motion.div
                    key="locked"
                    className="h-full w-full relative"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <LockScreen
                      userName={user?.firstName}
                      userPhotoUrl={window.Telegram?.WebApp?.initDataUnsafe?.user?.photo_url}
                      onUnlock={handleUnlock}
                      onForgotPin={handleForgotPin}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="app"
                    className="h-full w-full"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    {renderScreen()}
                    {isOnboarded && !navigation.screen.startsWith("forgot-pin") && <TabBar activeTab={currentTab} onTabChange={handleTabChange} />}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
  );
}

// Allowed Telegram usernames (whitelist)
const ALLOWED_USERS = ['bihruze', 'ferhat_n', 'martinedermi', 'serhateth', 'thehaneth'];

// Coming Soon screen for non-whitelisted users
function ComingSoonScreen() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center p-6"
      style={{ background: 'linear-gradient(180deg, #030206 0%, #0d0b14 100%)' }}
    >
      {/* Logo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <Image src="/ccbotlogo.png" alt="CC Bot" width={80} height={80} />
      </motion.div>

      {/* Title */}
      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-3xl font-bold text-white mb-4 text-center"
      >
        Coming Soon
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-[#FFFFFC]/60 text-center mb-8 max-w-sm"
      >
        CC Bot Wallet is currently in private beta. Stay tuned for updates!
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
          href="https://t.me/ccbotwallet"
          target="_blank"
          rel="noopener noreferrer"
          className="w-14 h-14 rounded-2xl flex items-center justify-center bg-[#0088cc]/20 border border-[#0088cc]/30 hover:bg-[#0088cc]/30 transition-colors"
        >
          <svg className="w-7 h-7 text-[#0088cc]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.121.099.154.232.169.326.016.093.036.306.019.472z"/>
          </svg>
        </a>

        {/* X (Twitter) */}
        <a
          href="https://x.com/ccbotio"
          target="_blank"
          rel="noopener noreferrer"
          className="w-14 h-14 rounded-2xl flex items-center justify-center bg-[#FFFFFC]/10 border border-[#FFFFFC]/20 hover:bg-[#FFFFFC]/20 transition-colors"
        >
          <svg className="w-6 h-6 text-[#FFFFFC]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
      </motion.div>

      {/* Follow us text */}
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-[#FFFFFC]/50 text-sm mb-12"
      >
        Follow us for updates
      </motion.p>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-[#FFFFFC]/30 text-xs"
      >
        CC Bot Wallet - Canton Network
      </motion.p>
    </div>
  );
}

// Wrap with WalletProvider
export default function TelegramApp() {
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null);

  // Mark app as hydrated to hide loading overlay and show content
  useEffect(() => {
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      requestAnimationFrame(() => {
        appRoot.classList.add('hydrated');
      });
    }
  }, []);

  useEffect(() => {
    // Check if user is in whitelist
    const tg = (window as any).Telegram?.WebApp;

    // Always expand to full screen
    if (tg?.expand) {
      tg.expand();
    }

    const username = tg?.initDataUnsafe?.user?.username?.toLowerCase();

    if (username && ALLOWED_USERS.includes(username)) {
      setIsAllowed(true);
    } else if (tg?.initDataUnsafe?.user) {
      // User exists but not in whitelist
      setIsAllowed(false);
    } else {
      // No Telegram context (development mode) - allow access
      setIsAllowed(true);
    }
  }, []);

  // Loading state
  if (isAllowed === null) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: 'linear-gradient(180deg, #030206 0%, #0d0b14 100%)' }}
      >
        <div className="animate-spin w-8 h-8 border-2 border-[#875CFF] border-t-transparent rounded-full" />
      </div>
    );
  }

  // Not allowed - show Coming Soon
  if (!isAllowed) {
    return <ComingSoonScreen />;
  }

  // Allowed - show app
  const appContent = (
    <WalletProvider>
      <SecurityProvider>
        <TelegramAppContent />
      </SecurityProvider>
    </WalletProvider>
  );

  // In production, wrap with TelegramGuard for extra security
  if (isProduction) {
    return <TelegramGuard>{appContent}</TelegramGuard>;
  }

  return appContent;
}
