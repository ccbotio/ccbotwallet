/**
 * Cross-platform Clipboard Utility
 *
 * Handles clipboard operations across:
 * - Telegram WebApp (iOS/Android WebView)
 * - Standard browsers (Chrome, Firefox, Safari)
 * - Desktop apps
 *
 * Telegram WebApp has restricted clipboard access:
 * - Standard paste events don't fire
 * - navigator.clipboard requires HTTPS + user permission
 * - Telegram's readTextFromClipboard API requires user gesture
 */

// Type for Telegram WebApp clipboard methods (internal use only)
interface TelegramClipboardAPI {
  readTextFromClipboard?: (callback: (text: string | null) => void) => void;
  HapticFeedback?: {
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  };
  platform?: string;
}

// Helper to get Telegram WebApp with proper typing
function getTelegramWebApp(): TelegramClipboardAPI | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp as TelegramClipboardAPI | undefined;
}

export type ClipboardResult = {
  success: boolean;
  text?: string;
  error?: string;
  method?: 'telegram' | 'navigator' | 'execCommand' | 'none';
};

/**
 * Check if running inside Telegram WebApp
 */
export function isTelegramWebApp(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = getTelegramWebApp();
  return !!tg?.platform;
}

/**
 * Check if Telegram clipboard API is available
 */
export function hasTelegramClipboard(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = getTelegramWebApp();
  return typeof tg?.readTextFromClipboard === 'function';
}

/**
 * Read text from clipboard using the best available method
 *
 * IMPORTANT: This must be called from a user gesture (click, tap)
 * for Telegram's API to work.
 *
 * @returns Promise with clipboard text or error
 */
export async function readClipboard(): Promise<ClipboardResult> {
  // Method 1: Try Telegram's API first (most reliable in WebApp)
  const tg = getTelegramWebApp();
  if (tg?.readTextFromClipboard) {
    try {
      const result = await new Promise<ClipboardResult>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ success: false, error: 'Telegram clipboard timeout', method: 'telegram' });
        }, 3000);

        tg.readTextFromClipboard!((text) => {
          clearTimeout(timeout);
          if (text !== null && text !== undefined) {
            resolve({ success: true, text: text, method: 'telegram' });
          } else {
            resolve({ success: false, error: 'Clipboard empty or access denied', method: 'telegram' });
          }
        });
      });

      if (result.success) {
        return result;
      }
      // If Telegram API failed, try other methods
    } catch (e) {
      console.warn('Telegram clipboard failed:', e);
    }
  }

  // Method 2: Try navigator.clipboard API (modern browsers)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        return { success: true, text, method: 'navigator' };
      }
    } catch (e) {
      console.warn('Navigator clipboard failed:', e);
    }
  }

  // Method 3: Fallback using execCommand (legacy, might work in some contexts)
  try {
    // Create a temporary textarea to receive paste
    const textarea = document.createElement('textarea');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();

    const success = document.execCommand('paste');
    const text = textarea.value;
    document.body.removeChild(textarea);

    if (success && text) {
      return { success: true, text, method: 'execCommand' };
    }
  } catch (e) {
    console.warn('execCommand paste failed:', e);
  }

  return {
    success: false,
    error: 'Clipboard access not available. Please paste manually.',
    method: 'none'
  };
}

/**
 * Extract digits from text (for PIN/verification codes)
 * @param text - Input text
 * @param maxLength - Maximum number of digits to extract
 */
export function extractDigits(text: string, maxLength: number = 6): string {
  return text.replace(/\D/g, '').slice(0, maxLength);
}

/**
 * Trigger haptic feedback if available
 */
export function hapticSuccess(): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred('success');
  } catch {
    // Ignore haptic errors
  }
}

export function hapticError(): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred('error');
  } catch {
    // Ignore haptic errors
  }
}

export function hapticLight(): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.impactOccurred('light');
  } catch {
    // Ignore haptic errors
  }
}

/**
 * Create a paste handler for PIN/code inputs
 * Returns a function to be used in onClick for paste buttons
 *
 * @param onPaste - Callback with extracted digits
 * @param maxLength - Maximum digits to extract (default 6)
 */
export function createPasteHandler(
  onPaste: (digits: string) => void,
  maxLength: number = 6
): () => Promise<void> {
  return async () => {
    const result = await readClipboard();

    if (result.success && result.text) {
      const digits = extractDigits(result.text, maxLength);
      if (digits.length > 0) {
        onPaste(digits);
        hapticSuccess();
      } else {
        hapticError();
      }
    } else {
      hapticError();
    }
  };
}
