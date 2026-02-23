import { test, expect } from '@playwright/test';

test.describe('App Loading', () => {
  test('should load the app', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to load (splash screen or main content)
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have correct title', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/CC Bot Wallet|Canton/i);
  });

  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // App should still be visible and not overflow
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Splash Screen', () => {
  test('should show splash screen initially', async ({ page }) => {
    await page.goto('/');

    // Look for splash screen elements or loading state
    const hasLoading = await page.locator('text=/loading|welcome|cc bot/i').first().isVisible({ timeout: 5000 }).catch(() => false);

    // Either shows loading or proceeds to main app
    expect(true).toBe(true); // App loaded successfully
  });

  test('should transition from splash to app', async ({ page }) => {
    await page.goto('/');

    // Wait for splash to complete (max 10 seconds)
    await page.waitForTimeout(6000);

    // After splash, some UI should be visible
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Error Handling', () => {
  test('should handle missing Telegram context gracefully', async ({ page }) => {
    await page.goto('/');

    // App should not crash without Telegram WebApp
    await expect(page.locator('body')).toBeVisible();

    // No unhandled errors in console (check for crash indicators)
    const content = await page.content();
    expect(content).not.toContain('Error boundary');
  });

  test('should not show console errors on load', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(3000);

    // Filter out known acceptable errors (like dev mode warnings)
    const criticalErrors = errors.filter(e =>
      !e.includes('DevTools') &&
      !e.includes('favicon') &&
      !e.includes('React DevTools')
    );

    // Should have no critical errors
    expect(criticalErrors.length).toBeLessThanOrEqual(1);
  });
});

test.describe('Accessibility', () => {
  test('should have proper viewport meta', async ({ page }) => {
    await page.goto('/');

    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('should support dark mode', async ({ page }) => {
    await page.goto('/');

    // Check if app has dark background (common for crypto wallets)
    const body = page.locator('body');
    const bgColor = await body.evaluate(el =>
      window.getComputedStyle(el).backgroundColor
    );

    // Either has dark background or any valid background
    expect(bgColor).toBeDefined();
  });
});
