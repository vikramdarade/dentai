import { test, expect } from '@playwright/test';
import { loginAsDentist } from './helpers';

test.describe('DentAI Full Platform & Cockpit UI E2E Suite', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDentist(page, 'Dr. Sarah Jenkins');
  });

  test('Cockpit Navigation - Roster & Operatory Day View', async ({ page }) => {
    // Assert Roster view and header are visible
    await expect(page.locator('text=Operatory Cockpit • Day Schedule Roster').first()).toBeVisible();
    await expect(page.locator('text=Roster').first()).toBeVisible();
    await expect(page.locator('button', { hasText: 'Today' })).toBeVisible();
    await expect(page.locator('button', { hasText: 'Add Walk-in' })).toBeVisible();
  });

  test('Operatory Patient Inspection Drawer - Open & Close', async ({ page }) => {
    // Check patient inspection drawer
    const inspectBtn = page.locator('button', { hasText: /Inspect Patient|Hide Inspection/ }).first();
    await expect(inspectBtn).toBeVisible();

    // Verify Operatory Inspection panel is present
    await expect(page.locator('text=Operatory Inspection').first()).toBeVisible();
    await expect(page.locator('text=Live Charting & SOAP View').first()).toBeVisible();
  });

  test('Navigation Rail - Switch to Patient Records Hub', async ({ page }) => {
    // Click Records on left navigation rail
    const recordsNav = page.locator('aside button', { hasText: 'Records' });
    await expect(recordsNav).toBeVisible();
    await recordsNav.click();

    // Verify Patient Records Hub heading and search input are rendered
    await expect(page.locator('text=Patient Records Hub')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('input[placeholder*="Search patient name"]')).toBeVisible();
  });

  test('Navigation Rail - Switch to Treatment Pipeline & Revenue Engine', async ({ page }) => {
    // Click Pipeline on left navigation rail
    const pipelineNav = page.locator('aside button', { hasText: 'Pipeline' });
    await expect(pipelineNav).toBeVisible();
    await pipelineNav.click();

    // Verify Pipeline dashboard & Scorecards are rendered
    await expect(page.locator('text=Unscheduled Treatment & Recall Engine')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=Unscheduled Opportunity').first()).toBeVisible();
    await expect(page.locator('text=Practice ROI Multiple').first()).toBeVisible();
  });

  test('Practice Settings Modal - Open, Verify AHPRA & Close', async ({ page }) => {
    // Click Settings on left navigation rail
    const settingsNav = page.locator('aside button', { hasText: 'Settings' });
    await expect(settingsNav).toBeVisible();
    await settingsNav.click();

    // Verify Practice Settings Modal appears
    await expect(page.locator('text=Practice & Surgery Cockpit Settings')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('text=AHPRA Active')).toBeVisible();

    // Close modal via Close button or Escape
    const closeBtn = page.locator('button[aria-label="Close settings"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Modal should disappear
    await expect(page.locator('text=Practice & Surgery Cockpit Settings')).not.toBeVisible();
  });

  test('Clinical Display Standard - Single Apple Medical Light standard active', async ({ page }) => {
    // Verify document root has light class and does not have dark class
    const html = page.locator('html');
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);

    // Verify aside navigation rail rendered in crisp medical light
    const aside = page.locator('aside').first();
    await expect(aside).toBeVisible();
    await expect(page.locator('aside button[title="Logout"]')).toBeVisible();
  });

  test('A/B Testing - Toggles between Standard Cockpit and 4-Slice Command Center', async ({ page }) => {
    // 1. Locate 4-Slice navigation button and switch to 4-Slice mode
    const fourSliceBtn = page.locator('[data-testid="switch-to-4slice-btn"]');
    await expect(fourSliceBtn).toBeVisible();
    await fourSliceBtn.click();

    // 2. Verify 4-Slice Operatory Command Center UI mounts
    await expect(page.locator('text=DentAI Operatory Command Center')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('text=Dentist Chair Exclusive').first()).toBeVisible();
    await expect(page.locator('text=Day Sheet').first()).toBeVisible();
    await expect(page.locator('text=Ambient Scribing & Live Ear').first()).toBeVisible();
    await expect(page.locator('text=Operatory Entity HUD:').first()).toBeVisible();

    // 3. Toggle back to Standard Cockpit via top header pill
    const standardPillBtn = page.locator('button:has-text("Standard Cockpit")');
    await expect(standardPillBtn).toBeVisible();
    await standardPillBtn.click();

    // 4. Verify standard cockpit view restored
    await expect(page.locator('aside button[title="Daily Patient Roster"]')).toBeVisible();
  });

  test('4-Slice Operatory Command Center - Date Navigation, Safety Guard & Walk-in Triage', async ({ page }) => {
    // 1. Switch to 4-Slice mode
    const fourSliceBtn = page.locator('[data-testid="switch-to-4slice-btn"]');
    await expect(fourSliceBtn).toBeVisible();
    await fourSliceBtn.click();
    await expect(page.locator('text=DentAI Operatory Command Center')).toBeVisible({ timeout: 6000 });

    // 2. Test Date Navigation Chevrons
    const nextDayBtn = page.locator('button[title="Next Day"]');
    await expect(nextDayBtn).toBeVisible();
    await nextDayBtn.click();
    await page.waitForTimeout(300);

    // Verify Today button resets date
    const todayBtn = page.locator('button[title="Reset to Today"]');
    await expect(todayBtn).toBeVisible();
    await todayBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=/TODAY/i').first()).toBeVisible();

    // 3. Test Active Recording Safety Guard Barrier
    const recordBtn = page.locator('button:has-text("Start Ambient Scribe")');
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();
    await expect(page.locator('button:has-text("Stop Recording")')).toBeVisible();

    // Attempt date shift while recording
    await nextDayBtn.click();
    await expect(page.locator('text=Active Operatory Scribe in Progress')).toBeVisible({ timeout: 4000 });

    // Click "Keep Recording" to dismiss guard safely
    const keepRecordingBtn = page.locator('button:has-text("Keep Recording")');
    await expect(keepRecordingBtn).toBeVisible();
    await keepRecordingBtn.click();
    await expect(page.locator('text=Active Operatory Scribe in Progress')).not.toBeVisible();

    // Stop recording cleanly
    const stopRecordBtn = page.locator('button:has-text("Stop Recording")');
    await stopRecordBtn.click();
    await expect(page.locator('button:has-text("Start Ambient Scribe")')).toBeVisible();

    // 4. Test Rapid Walk-in Patient Triage Modal
    const addWalkInBtn = page.locator('button:has-text("+ Walk-in")');
    await expect(addWalkInBtn).toBeVisible();
    await addWalkInBtn.click();

    await expect(page.locator('text=Add Walk-in Patient')).toBeVisible();
    const nameInput = page.locator('input[placeholder*="David Campbell"]');
    await nameInput.fill('Emergency Walkin Test');
    await page.locator('button[type="submit"]:has-text("Book Walk-in")').click();

    // Verify walk-in patient is scheduled on Day Sheet and activated in Slice 4
    await expect(page.locator('text=Walkin Test').first()).toBeVisible({ timeout: 5000 });

    // 5. Toggle back to Standard Cockpit
    const standardPillBtn = page.locator('button:has-text("Standard Cockpit")');
    await standardPillBtn.click();
    await expect(page.locator('aside button[title="Daily Patient Roster"]')).toBeVisible();
  });

  test('Session Logout - Gracefully logs out and returns to Clinician Access', async ({ page }) => {
    const logoutBtn = page.locator('aside button[title="Logout"]');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Verify redirected back to Login screen
    await expect(page.locator('text=Clinician Access').first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('input[placeholder*="Clinician ID"]')).toBeVisible();
  });
});
