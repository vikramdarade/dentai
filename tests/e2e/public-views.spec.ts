import { test, expect } from '@playwright/test';

test.describe('DentAI Public Views & External Interfaces E2E', () => {
  test('Public Marketing Landing Page at #/landing', async ({ page }) => {
    await page.goto('/#/landing');
    await page.waitForLoadState('domcontentloaded');

    // Verify DentAI marketing heading & elements
    await expect(page.locator('text=How it works').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Revenue Engine').first()).toBeVisible();
    await expect(page.locator('text=Watch 3-Min Demo').first()).toBeVisible();
  });

  test('Public Narrated Demo Movie at #/demo', async ({ page }) => {
    await page.goto('/#/demo');
    await page.waitForLoadState('domcontentloaded');

    // Verify Demo Player container exists
    await expect(page.locator('text=DentAI').or(page.locator('video')).or(page.locator('text=Demo')).or(page.locator('text=Exit')).first()).toBeVisible({ timeout: 10000 });
  });

  test('Operatory Phone Beacon PWA View at #/beacon', async ({ page }) => {
    await page.goto('/#/beacon');
    await page.waitForLoadState('domcontentloaded');

    // Verify Phone Beacon interface
    await expect(page.locator('text=DentAI Phone Beacon')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Enter 4-Digit Chair PIN')).toBeVisible();
    await expect(page.locator('input[placeholder="4921"]')).toBeVisible();
  });
});
