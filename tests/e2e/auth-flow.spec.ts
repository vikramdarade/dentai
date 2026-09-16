import { test, expect } from '@playwright/test';

test.describe('DentAI Authentication Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure clean login state
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/');
    await expect(page.locator('input[placeholder*="Clinician ID"]')).toBeVisible({ timeout: 10000 });
  });

  test('Displays Clinician Access sign-in screen when unauthenticated', async ({ page }) => {
    await expect(page.locator('text=DentAI').first()).toBeVisible();
    await expect(page.locator('input[placeholder*="Clinician ID"]')).toBeVisible();
    await expect(page.locator('text=4-Digit Passcode')).toBeVisible();
  });

  test('Shows error notice when entering invalid practitioner credentials', async ({ page }) => {
    const input = page.locator('input[placeholder*="Clinician ID"]');
    await input.fill('NonExistentPractitioner999');

    // Click keypad digits: 9, 9, 9, 9
    for (let i = 0; i < 4; i++) {
      await page.locator('button', { hasText: /^9$/ }).click();
    }

    // Expect error notice to appear
    await expect(
      page.locator('[data-testid="login-error-banner"]')
        .or(page.locator('text=Authentication failed'))
        .or(page.locator('text=not found'))
        .first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('Signs in successfully with Dr. Sarah Jenkins and PIN 1234', async ({ page }) => {
    const input = page.locator('input[placeholder*="Clinician ID"]');
    await input.fill('Dr. Sarah Jenkins');

    // Enter 1-2-3-4
    await page.locator('button', { hasText: /^1$/ }).click();
    await page.locator('button', { hasText: /^2$/ }).click();
    await page.locator('button', { hasText: /^3$/ }).click();
    await page.locator('button', { hasText: /^4$/ }).click();

    // After entering 4 digits, should transition to practice cockpit
    await expect(
      page.locator('text=Day Schedule Roster')
        .or(page.locator('text=Consultation Queue'))
        .or(page.locator('[data-testid="dentist-profile-avatar"]'))
        .first()
    ).toBeVisible({ timeout: 10000 });

    // Verify localStorage has authenticated token
    const token = await page.waitForFunction(() => {
      return localStorage.getItem('dentai_token') || localStorage.getItem('dentai_auth_token');
    }, { timeout: 10000 });
    expect(await token.jsonValue()).toBeTruthy();
  });
});
