import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'

export const metadata: Metadata = {
  title: 'CC Bot Wallet',
  description: 'Your crypto, simplified',
  icons: {
    icon: '/ccbotlogo.png',
    apple: '/ccbotlogo.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#030206',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var isLocalhost = window.location.hostname === 'localhost';
                if (isLocalhost) {
                  // Dev mode - set up complete mock Telegram WebApp
                  var eventHandlers = {};
                  window.Telegram = {
                    WebApp: {
                      initData: 'dev_mode_555666777',
                      initDataUnsafe: { user: { id: 555666777, first_name: 'Dev', username: 'devuser', language_code: 'en' } },
                      ready: function() {},
                      expand: function() {},
                      close: function() {},
                      setHeaderColor: function() {},
                      setBackgroundColor: function() {},
                      enableClosingConfirmation: function() {},
                      disableClosingConfirmation: function() {},
                      isVersionAtLeast: function() { return true; },
                      openLink: function(url) { window.open(url, '_blank'); },
                      openTelegramLink: function(url) { window.open(url, '_blank'); },
                      showPopup: function(params, cb) { if(cb) cb(); },
                      showAlert: function(msg, cb) { alert(msg); if(cb) cb(); },
                      showConfirm: function(msg, cb) { if(cb) cb(confirm(msg)); },
                      onEvent: function(event, cb) { eventHandlers[event] = eventHandlers[event] || []; eventHandlers[event].push(cb); },
                      offEvent: function(event, cb) { if(eventHandlers[event]) eventHandlers[event] = eventHandlers[event].filter(function(h){return h!==cb;}); },
                      sendData: function(data) { console.log('[TG Mock] sendData:', data); },
                      switchInlineQuery: function(query) { console.log('[TG Mock] switchInlineQuery:', query); },
                      HapticFeedback: { impactOccurred: function(){}, notificationOccurred: function(){}, selectionChanged: function(){} },
                      MainButton: { show: function(){}, hide: function(){}, setText: function(){}, onClick: function(){}, offClick: function(){}, setParams: function(){}, enable: function(){}, disable: function(){}, showProgress: function(){}, hideProgress: function(){}, isVisible: false, isActive: true, isProgressVisible: false, text: '', color: '#875CFF', textColor: '#ffffff' },
                      BackButton: { show: function(){}, hide: function(){}, onClick: function(){}, offClick: function(){}, isVisible: false },
                      themeParams: { bg_color: '#0a0812', text_color: '#ffffff', hint_color: '#999999', button_color: '#875CFF', button_text_color: '#ffffff', secondary_bg_color: '#1a1a2e' },
                      colorScheme: 'dark',
                      isExpanded: true,
                      viewportHeight: 800,
                      viewportStableHeight: 800,
                      headerColor: '#0a0812',
                      backgroundColor: '#0a0812',
                      platform: 'tdesktop',
                      version: '7.0'
                    }
                  };
                  console.log('[DEV] Telegram mock initialized for localhost');
                } else {
                  // Production - load real Telegram SDK
                  var script = document.createElement('script');
                  script.src = 'https://telegram.org/js/telegram-web-app.js';
                  document.head.appendChild(script);
                }
              })();
            `
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <div id="app-root" style={{ width: '100%' }}>
          {/* Loading overlay - hidden by CSS when .hydrated class is added */}
          <div className="loading-overlay">
            <div className="animate-spin w-8 h-8 border-2 border-[#875CFF] border-t-transparent rounded-full"></div>
          </div>
          {children}
        </div>
      </body>
    </html>
  )
}
