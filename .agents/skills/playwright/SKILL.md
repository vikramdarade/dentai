---
name: playwright
description: End-to-end browser testing, automation, and test generation with Playwright. Use when creating, running, debugging, or fixing Playwright E2E tests, locators, page fixtures, network mocking, and browser automation workflows.
---

# Playwright Testing & Automation Skill

Comprehensive guide and operational procedures for writing, executing, debugging, and maintaining robust, reliable, and high-performance Playwright end-to-end tests and browser automations.

---

## 1. Quick Start & Execution

```bash
# Run all Playwright tests
npx playwright test

# Run tests in headed mode (visible browser)
npx playwright test --headed

# Run a specific test file
npx playwright test tests/e2e/clinical-flow.spec.ts

# Run tests matching a specific title grep
npx playwright test -g "patient session"

# Run with interactive UI mode
npx playwright test --ui

# Debug tests with Playwright Inspector
npx playwright test --debug

# View last HTML test report
npx playwright show-report
```

---

## 2. Core Best Practices & Testing Philosophy

### A. Prioritize User-Facing Locators
Always use user-facing locators that reflect how actual users navigate the page. Avoid brittle CSS classes or XPath.

```typescript
// ✅ BEST: Resilient user-facing locators
page.getByRole('button', { name: 'New session' });
page.getByRole('heading', { name: 'Verbatim Speech Transcript', level: 3 });
page.getByLabel('Patient Name');
page.getByPlaceholder('Type or dictate spoken utterance');
page.getByText('Listening & taking notes');

// ⚠️ SECOND BEST: Explicit test IDs when roles are ambiguous
page.getByTestId('stale-write-conflict');

// ❌ NEVER: Brittle CSS selectors or implementation details
page.locator('.px-4.py-2.bg-indigo-600.text-white');
page.locator('div > div:nth-child(2) > span');
```

### B. Use Web-First Auto-Waiting Assertions
Never use arbitrary `page.waitForTimeout(5000)` or manual sleep timers. Playwright's web-first assertions automatically wait and retry until conditions are satisfied or timeout is reached.

```typescript
// ✅ Auto-waits and retries until visible
await expect(page.getByRole('button', { name: 'Create note' })).toBeVisible();
await expect(page.getByRole('button', { name: 'Create note' })).toBeEnabled();
await expect(page.getByText('Saved')).toBeVisible();

// Asserting values and text
await expect(page.getByLabel('Patient Name')).toHaveValue('Sarah Jenkins');
await expect(page.getByTestId('note-editor')).toContainText('SUBJECTIVE');

// ❌ Flaky and anti-pattern:
await page.waitForTimeout(3000);
expect(await page.getByText('Saved').isVisible()).toBe(true);
```

---

## 3. Test Structure & Patterns

### Standard E2E Test Template
```typescript
import { test, expect } from '@playwright/test';

test.describe('Clinical Workspace Consultations', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to application root
    await page.goto('/');
  });

  test('records live transcript dialogue and creates clinical note', async ({ page }) => {
    // 1. Arrange / Verify initial clean operatory
    await expect(page.getByRole('heading', { name: 'Verbatim Speech Transcript' })).toBeVisible();

    // 2. Act: Add spoken dialogue line
    const input = page.getByPlaceholder(/type or dictate/i);
    await input.fill('Tooth 16 has recurrent distal caries under existing amalgam restoration.');
    await page.getByRole('button', { name: /add utterance/i }).click();

    // 3. Assert: Transcript feed displays the line
    await expect(page.getByText('Tooth 16 has recurrent distal caries')).toBeVisible();

    // 4. Act: Generate clinical progress note
    await page.getByRole('button', { name: /create note/i }).click();

    // 5. Assert: Note tab generated with AHPRA/ADA findings
    await expect(page.getByRole('tab', { name: /note/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox')).toContainText('Tooth 16');
  });
});
```

---

## 4. Network Interception & API Route Mocking

Use `page.route()` to mock backend endpoints, simulate failure modes (500, 429, 401), or test offline degradation without hitting live external APIs.

```typescript
test('handles server offline gracefully with offline note synthesis', async ({ page }) => {
  // Mock /api/generate-notes to return 503 Service Unavailable
  await page.route('**/api/generate-notes', route => {
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'AI Gateway offline' }),
    });
  });

  await page.goto('/');
  // Workspace should seamlessly fall back to deterministic template synthesis
});
```

---

## 5. Authentication & Storage State

Avoid logging in repeatedly on every test. Capture authenticated storage state once in a setup project, then reuse it across all tests:

```typescript
// playwright.config.ts setup
export default defineConfig({
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

---

## 6. Companion Playwright Skills

This workspace also includes specialized companion skills:
- **`playwright-cli`**: Direct command-line browser automation and element interactions (`playwright-cli open`, `click`, `fill`, `snapshot`).
- **`playwright-trace`**: Command-line `.zip` trace inspection without launching a full browser window (`npx playwright trace open`, `actions`, `errors`).
- **`playwright-component-testing`**: Isolated React component testing via lightweight story gallery mounts.
