/**
 * Cross-platform Keyboard Utility
 *
 * Handles keyboard events across:
 * - Telegram WebApp (iOS/Android WebView)
 * - Standard browsers
 * - Desktop apps
 *
 * Key issues addressed:
 * - Telegram WebApp may not fire keyboard events on window
 * - Input focus is critical for capturing keys
 * - Mobile virtual keyboards behave differently
 */

import { hapticLight } from './clipboard';

export type KeyHandler = {
  onDigit?: (digit: string) => void;
  onBackspace?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
};

/**
 * Create keyboard event handlers for PIN/code input
 * Returns an object with event listeners to attach
 *
 * @param handlers - Callbacks for different key events
 * @param enabled - Whether to process events (use refs to avoid stale closures)
 */
export function createKeyboardHandlers(
  handlers: KeyHandler,
  getEnabled: () => boolean = () => true
) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!getEnabled()) return;

    // Digit keys (0-9)
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      handlers.onDigit?.(e.key);
      hapticLight();
      return;
    }

    // Numpad keys
    if (e.code >= 'Numpad0' && e.code <= 'Numpad9') {
      e.preventDefault();
      const digit = e.code.replace('Numpad', '');
      handlers.onDigit?.(digit);
      hapticLight();
      return;
    }

    // Backspace/Delete
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      handlers.onBackspace?.();
      hapticLight();
      return;
    }

    // Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      handlers.onEnter?.();
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      handlers.onEscape?.();
      return;
    }
  };

  return { onKeyDown };
}

/**
 * Hook-style keyboard listener setup
 * Use in useEffect to set up and clean up listeners
 *
 * @example
 * useEffect(() => {
 *   return setupKeyboardListeners({
 *     onDigit: (d) => setPin(p => p + d),
 *     onBackspace: () => setPin(p => p.slice(0, -1)),
 *     onEnter: () => handleSubmit()
 *   });
 * }, []);
 */
export function setupKeyboardListeners(
  handlers: KeyHandler,
  getEnabled: () => boolean = () => true
): () => void {
  const { onKeyDown } = createKeyboardHandlers(handlers, getEnabled);

  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * Create a hidden input for capturing keyboard and paste events
 * This is especially useful in Telegram WebApp where window-level
 * events may not fire properly.
 *
 * Returns an input element that should be added to the DOM
 * and focused when the component mounts.
 */
export function createHiddenInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.pattern = '[0-9]*';
  input.autocomplete = 'one-time-code';
  input.style.position = 'absolute';
  input.style.left = '-9999px';
  input.style.top = '0';
  input.style.opacity = '0';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.pointerEvents = 'none';
  // Keep it accessible for screen readers
  input.setAttribute('aria-hidden', 'true');
  input.setAttribute('tabindex', '-1');
  return input;
}

/**
 * Check if the current platform likely has a hardware keyboard
 */
export function hasHardwareKeyboard(): boolean {
  if (typeof window === 'undefined') return false;

  // Telegram WebApp platform detection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platform = (window as any).Telegram?.WebApp?.platform as string | undefined;
  if (platform) {
    // Desktop platforms have hardware keyboards
    return ['macos', 'tdesktop', 'webk', 'weba'].includes(platform);
  }

  // Fallback: check screen width (rough heuristic)
  return window.innerWidth >= 768;
}
