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
  interactiveWidget: 'resizes-content',
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
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {/* Critical: Initialize viewport before React hydration */}
        <Script id="tg-viewport-init" strategy="beforeInteractive">
          {`
            (function() {
              function initViewport() {
                var tg = window.Telegram && window.Telegram.WebApp;
                var height = (tg && tg.viewportHeight) ? tg.viewportHeight : window.innerHeight;
                var stableHeight = (tg && tg.viewportStableHeight) ? tg.viewportStableHeight : height;

                document.documentElement.style.setProperty('--tg-viewport-height', height + 'px');
                document.documentElement.style.setProperty('--tg-viewport-stable-height', stableHeight + 'px');
                document.documentElement.style.height = height + 'px';
                document.body.style.height = height + 'px';
                document.body.style.minHeight = height + 'px';
                document.body.style.maxHeight = height + 'px';

                if (tg && tg.expand) {
                  tg.expand();
                }
              }

              // Run immediately
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initViewport);
              } else {
                initViewport();
              }

              // Also run on load
              window.addEventListener('load', initViewport);

              // Listen for Telegram viewport changes
              if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.onEvent) {
                window.Telegram.WebApp.onEvent('viewportChanged', initViewport);
              }

              // Window resize
              window.addEventListener('resize', initViewport);

              // Periodic updates for slow initialization
              var i = 0;
              var interval = setInterval(function() {
                initViewport();
                i++;
                if (i > 30) clearInterval(interval);
              }, 100);
            })();
          `}
        </Script>
      </head>
      <body suppressHydrationWarning>
        <div id="app-root">
          {children}
        </div>
      </body>
    </html>
  )
}
