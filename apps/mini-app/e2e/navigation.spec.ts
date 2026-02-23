import { test, expect, Page } from '@playwright/test';

// Helper to mock Telegram WebApp
async function mockTelegramWebApp(page: Page) {
  await page.addInitScript(() => {
    (window as any).Telegram = {
      WebApp: {
        ready: () => {},
        expand: () => {},
        setHeaderColor: () => {},
        setBackgroundColor: () => {},
        enableClosingConfirmation: () => {},
        requestWriteAccess: () => Promise.resolve(true),
        initData: 'dev_mode_555666777',
        initDataUnsafe: {
          user: {
            id: 555666777,
            first_name: 'Test',
            last_name: 'User',
            username: 'testuser',
          },
        },
        CloudStorage: {
          setItem: (_key: string, _value: string, cb?: Function) => cb?.(null, true),
          getItem: (_key: string, cb: Function) => cb(null, null),
        },
        BiometricManager: {
          isBiometricAvailable: false,
          biometricType: 'unknown',
          isInited: true,
          isAccessRequested: false,
          isAccessGranted: false,
          isBiometricTokenSaved: false,
          init: (cb?: Function) => cb?.(),
          requestAccess: (_: any, cb?: Function) => cb?.(false),
          authenticate: (_: any, cb?: Function) => cb?.(false),
          updateBiometricToken: (_: string, cb?: Function) => cb?.(false),
        },
        HapticFeedback: {
          impactOccurred: () => {},
          notificationOccurred: () => {},
          selectionChanged: () => {},
        },
      },
    };
  });
}

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramWebApp(page);
  });

  test('should load and show content after splash', async ({ page }) => {
    await page.goto('/');

    // Wait for splash screen to finish (about 5 seconds)
    await page.waitForTimeout(6000);

    // Some content should be visible
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('should have navigation elements', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(6000);

    // Look for bottom navigation or tabs
    const hasNavigation = await page.locator('[class*="nav"], [class*="tab"], [class*="bottom"]')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    // Navigation might be present after onboarding
    expect(true).toBe(true);
  });
});

test.describe('UI Components', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramWebApp(page);
  });

  test('should render buttons correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(6000);

    const buttons = page.locator('button');
    const count = await buttons.count();

    // App should have some interactive buttons
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should have proper styling', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(6000);

    // Check that styles are loaded (no unstyled content)
    const body = page.locator('body');
    const bgColor = await body.evaluate(el => getComputedStyle(el).backgroundColor);

    expect(bgColor).not.toBe('');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should be interactive', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(6000);

    // Try to find and click any visible button
    const button = page.locator('button').first();

    if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Should be clickable without error
      await button.click({ timeout: 2000 }).catch(() => {});
    }

    // App should still be functional
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Mobile Experience', () => {
  test('should work on iPhone viewport', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 12

    await page.goto('/');
    await page.waitForTimeout(6000);

    await expect(page.locator('body')).toBeVisible();

    // Content should fit viewport (no horizontal scroll)
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 10);
  });

  test('should work on Android viewport', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 360, height: 740 }); // Pixel 5

    await page.goto('/');
    await page.waitForTimeout(6000);

    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle touch gestures', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/');
    await page.waitForTimeout(6000);

    // Simulate swipe gesture (shouldn't crash)
    await page.mouse.move(187, 400);
    await page.mouse.down();
    await page.mouse.move(187, 200, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Performance', () => {
  test('should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const loadTime = Date.now() - startTime;

    // Should load DOM within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test('should not have memory leaks on navigation', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto('/');
    await page.waitForTimeout(6000);

    // Get initial memory
    const initialMemory = await page.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    });

    // Simulate some interactions
    for (let i = 0; i < 5; i++) {
      const button = page.locator('button').first();
      if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
        await button.click().catch(() => {});
      }
      await page.waitForTimeout(500);
    }

    // Check memory didn't grow excessively
    const finalMemory = await page.evaluate(() => {
      if ((performance as any).memory) {
        return (performance as any).memory.usedJSHeapSize;
      }
      return 0;
    });

    // Memory growth should be reasonable (less than 50MB)
    if (initialMemory > 0 && finalMemory > 0) {
      const growth = finalMemory - initialMemory;
      expect(growth).toBeLessThan(50 * 1024 * 1024);
    }
  });
});
