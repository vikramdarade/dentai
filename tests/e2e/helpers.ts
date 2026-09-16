import { Page, expect } from '@playwright/test';

export async function loginAsDentist(page: Page, name: string = 'Dr. Sarah Jenkins') {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const cockpitIndicator = page.locator('[data-testid="dentist-profile-avatar"]')
    .or(page.locator('text=Day Schedule Roster'))
    .or(page.locator('text=Dr. Sarah Jenkins'))
    .first();

  const isAlreadyLoggedIn = await cockpitIndicator.isVisible({ timeout: 2000 }).catch(() => false);
  if (isAlreadyLoggedIn) {
    return;
  }

  const input = page.locator('input[placeholder*="Clinician ID"]');
  const isLoginVisible = await input.isVisible({ timeout: 5000 }).catch(() => false);

  if (isLoginVisible) {
    await input.fill(name);
    await page.locator('button', { hasText: /^1$/ }).click();
    await page.locator('button', { hasText: /^2$/ }).click();
    await page.locator('button', { hasText: /^3$/ }).click();
    await page.locator('button', { hasText: /^4$/ }).click();
  }

  // Ensure dashboard or roster is loaded
  await expect(cockpitIndicator).toBeVisible({ timeout: 15000 });
}
