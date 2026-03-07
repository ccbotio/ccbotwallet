/**
 * Browser Detection Utility
 *
 * Detects browser type, version, OS, and WebAuthn/Passkey support.
 * Used for cross-browser passkey compatibility.
 */

export interface BrowserInfo {
  name: 'chrome' | 'safari' | 'firefox' | 'samsung' | 'edge' | 'opera' | 'unknown';
  version: number;
  os: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown';
  isWebView: boolean;
  isTelegramWebView: boolean;
  supportsPasskey: boolean;
  supportsPRF: boolean;
}

/**
 * Passkey Support Matrix:
 *
 * | Browser          | Min Version | Passkey | PRF Extension | Platform      |
 * |------------------|-------------|---------|---------------|---------------|
 * | Chrome           | 67+         | ✅      | 116+          | Android, Desktop |
 * | Safari           | 14+         | ✅      | 17+           | iOS, macOS    |
 * | Samsung Internet | 15+         | ✅      | ❌            | Android (Samsung) |
 * | Firefox          | 119+        | ✅      | ❌            | All           |
 * | Edge             | 79+         | ✅      | 116+          | Desktop       |
 * | Opera            | 54+         | ✅      | ❌            | All           |
 */

/**
 * Detect current browser and its capabilities.
 */
export function detectBrowser(): BrowserInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      name: 'unknown',
      version: 0,
      os: 'unknown',
      isWebView: false,
      isTelegramWebView: false,
      supportsPasskey: false,
      supportsPRF: false,
    };
  }

  const ua = navigator.userAgent;

  // Telegram WebView detection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const windowAny = window as any;
  const isTelegramWebView =
    ua.toLowerCase().includes('telegram') ||
    windowAny.TelegramWebviewProxy !== undefined ||
    (window.Telegram?.WebApp !== undefined &&
      window.Telegram.WebApp.platform !== 'tdesktop');

  // Browser detection - order matters (more specific first)
  let name: BrowserInfo['name'] = 'unknown';
  let version = 0;

  if (/SamsungBrowser/i.test(ua)) {
    name = 'samsung';
    const match = ua.match(/SamsungBrowser\/(\d+)/);
    version = match ? parseInt(match[1], 10) : 0;
  } else if (/Edg/i.test(ua)) {
    name = 'edge';
    const match = ua.match(/Edg\/(\d+)/);
    version = match ? parseInt(match[1], 10) : 0;
  } else if (/OPR|Opera/i.test(ua)) {
    name = 'opera';
    const match = ua.match(/(?:OPR|Opera)\/(\d+)/);
    version = match ? parseInt(match[1], 10) : 0;
  } else if (/Firefox/i.test(ua)) {
    name = 'firefox';
    const match = ua.match(/Firefox\/(\d+)/);
    version = match ? parseInt(match[1], 10) : 0;
  } else if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) {
    name = 'chrome';
    const match = ua.match(/Chrome\/(\d+)/);
    version = match ? parseInt(match[1], 10) : 0;
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    name = 'safari';
    const match = ua.match(/Version\/(\d+)/);
    version = match ? parseInt(match[1], 10) : 0;
  }

  // OS detection
  let os: BrowserInfo['os'] = 'unknown';
  if (/iPhone|iPad|iPod/i.test(ua)) {
    os = 'ios';
  } else if (/Android/i.test(ua)) {
    os = 'android';
  } else if (/Mac/i.test(ua)) {
    os = 'macos';
  } else if (/Windows/i.test(ua)) {
    os = 'windows';
  } else if (/Linux/i.test(ua)) {
    os = 'linux';
  }

  // Passkey support based on browser/version
  const supportsPasskey =
    (name === 'chrome' && version >= 67) ||
    (name === 'safari' && version >= 14) ||
    (name === 'samsung' && version >= 15) ||
    (name === 'firefox' && version >= 119) ||
    (name === 'edge' && version >= 79) ||
    (name === 'opera' && version >= 54);

  // PRF extension support (for key derivation)
  const supportsPRF =
    (name === 'chrome' && version >= 116) ||
    (name === 'safari' && version >= 17) ||
    (name === 'edge' && version >= 116);

  return {
    name,
    version,
    os,
    isWebView: isTelegramWebView,
    isTelegramWebView,
    supportsPasskey,
    supportsPRF,
  };
}

/**
 * Get user-friendly passkey instructions based on detected browser.
 */
export function getPasskeyInstructions(browser: BrowserInfo): string {
  // Telegram WebView - always redirect to external browser
  if (browser.isTelegramWebView) {
    if (browser.os === 'ios') {
      return 'Telegram içinden passkey oluşturulamıyor. Linki Safari\'de açın.';
    }
    return 'Telegram içinden passkey oluşturulamıyor. Linki Chrome\'da açın.';
  }

  // Browser doesn't support passkeys at all
  if (!browser.supportsPasskey) {
    switch (browser.name) {
      case 'samsung':
        return `Samsung Internet ${browser.version} passkey desteklemiyor. Lütfen Chrome kullanın.`;
      case 'firefox':
        if (browser.version < 119) {
          return `Firefox ${browser.version} passkey desteklemiyor. Firefox 119+ veya Chrome kullanın.`;
        }
        return 'Firefox passkey desteği sınırlı. Chrome önerilir.';
      case 'opera':
        if (browser.version < 54) {
          return `Opera ${browser.version} passkey desteklemiyor. Chrome veya Safari kullanın.`;
        }
        break;
      case 'edge':
        if (browser.version < 79) {
          return `Edge ${browser.version} passkey desteklemiyor. Güncel Edge veya Chrome kullanın.`;
        }
        break;
      case 'chrome':
        if (browser.version < 67) {
          return `Chrome ${browser.version} passkey desteklemiyor. Lütfen Chrome'u güncelleyin.`;
        }
        break;
      case 'safari':
        if (browser.version < 14) {
          return `Safari ${browser.version} passkey desteklemiyor. Safari 14+ gerekli.`;
        }
        break;
      default:
        return 'Bu tarayıcı passkey desteklemiyor. Chrome veya Safari kullanın.';
    }
    return 'Bu tarayıcı passkey desteklemiyor. Chrome veya Safari kullanın.';
  }

  // Browser supports passkey but not PRF (still works, just uses fallback)
  if (!browser.supportsPRF) {
    switch (browser.name) {
      case 'samsung':
        return 'Samsung Internet ile devam edebilirsiniz. Parmak izi veya yüz tanıma kullanın.';
      case 'firefox':
        return 'Firefox ile devam edebilirsiniz. Parmak izi veya yüz tanıma kullanın.';
      case 'opera':
        return 'Opera ile devam edebilirsiniz. Parmak izi veya yüz tanıma kullanın.';
      default:
        return 'Passkey oluşturmak için parmak izi veya yüz tanıma kullanın.';
    }
  }

  // Full support
  return 'Passkey oluşturmak için parmak izi veya yüz tanıma kullanın.';
}

/**
 * Get browser name for display.
 */
export function getBrowserDisplayName(browser: BrowserInfo): string {
  const names: Record<BrowserInfo['name'], string> = {
    chrome: 'Chrome',
    safari: 'Safari',
    firefox: 'Firefox',
    samsung: 'Samsung Internet',
    edge: 'Edge',
    opera: 'Opera',
    unknown: 'Unknown Browser',
  };
  return names[browser.name];
}

/**
 * Get recommended browser for the current OS.
 */
export function getRecommendedBrowser(os: BrowserInfo['os']): string {
  switch (os) {
    case 'ios':
      return 'Safari';
    case 'android':
      return 'Chrome';
    case 'macos':
      return 'Safari veya Chrome';
    case 'windows':
      return 'Chrome veya Edge';
    case 'linux':
      return 'Chrome';
    default:
      return 'Chrome';
  }
}
