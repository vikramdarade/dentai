import { test, expect } from '@playwright/test';
import { loginAsDentist } from './helpers';

test.describe('DentAI Daily Patient Roster - Complete Functionality Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Automatically accept dialogs if encountered
    page.on('dialog', dialog => dialog.accept());

    await loginAsDentist(page, 'Dr. Sarah Jenkins');

    // Ensure we are explicitly on the Roster Schedule screen
    const rosterNav = page.locator('aside button', { hasText: 'Roster' });
    if (await rosterNav.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rosterNav.click();
    }

    // Cancel any active island recording to start each test completely clean
    const cancelIsland = page.locator('button[title*="Cancel recording"]').or(page.locator('button', { hasText: 'Cancel recording' })).first();
    if (await cancelIsland.isVisible({ timeout: 800 }).catch(() => false)) {
      await cancelIsland.click();
      await page.waitForTimeout(300);
    }

    await expect(page.locator('text=Operatory Cockpit • Day Schedule Roster').first()).toBeVisible({ timeout: 12000 });

    // Ensure sample day is populated so test fixtures exist
    const sampleBtn = page.locator('button', { hasText: 'Populate with Sample Day' });
    if (await sampleBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await sampleBtn.click();
      await page.waitForTimeout(600);
    }
  });

  test('Roster Header, Statistics Bar & Metric Badges', async ({ page }) => {
    // Top stats bar
    await expect(page.locator('text=/Total Appointments/i').first()).toBeVisible({ timeout: 6000 });
    await expect(page.locator('text=/Ready for D4W|Remaining/i').first()).toBeVisible();

    // Verify date title contains TODAY
    await expect(page.locator('text=/TODAY/i').first()).toBeVisible();
  });

  test('Date Navigator - Shift Days and Reset to Today', async ({ page }) => {
    const todayIndicator = page.locator('text=/TODAY/i').first();
    await expect(todayIndicator).toBeVisible();

    // Click Next Day chevron button
    const nextDayBtn = page.locator('button[title*="Next day"]').or(page.locator('button:has(svg.lucide-chevron-right)')).first();
    await nextDayBtn.click();
    await page.waitForTimeout(400);

    // Click "Today" button to return
    const todayBtn = page.locator('button', { hasText: /^Today$/i }).first();
    await expect(todayBtn).toBeVisible();
    await todayBtn.click();
    await page.waitForTimeout(400);

    // Verify back on TODAY
    await expect(todayIndicator).toBeVisible();
  });

  test('Patient Search and Status Filter Pills', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search by patient name"]').first();
    await expect(searchInput).toBeVisible();

    // Filter by patient name "Emma"
    await searchInput.fill('Emma');
    await page.waitForTimeout(300);
    await expect(page.locator('h4', { hasText: 'Emma Watson' }).first()).toBeVisible();
    await expect(page.locator('div[data-patient-name="David Miller"]')).not.toBeVisible();

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(300);

    // Test Ready Status Filter Tab
    const readyFilter = page.locator('button', { hasText: /^Ready/i }).first();
    await readyFilter.click();
    await page.waitForTimeout(300);
    await expect(page.locator('h4', { hasText: 'Emma Watson' }).first()).toBeVisible();

    // Reset to All Filter Tab
    const allFilter = page.locator('button', { hasText: /^All/i }).first();
    await allFilter.click();
    await page.waitForTimeout(300);
    await expect(page.locator('h4', { hasText: 'David Miller' }).first()).toBeVisible();
  });

  test('Add Walk-in Patient Modal Flow', async ({ page }) => {
    const addWalkInBtn = page.locator('button', { hasText: 'Add Walk-in' }).first();
    await expect(addWalkInBtn).toBeVisible();
    await addWalkInBtn.click();

    // Verify Walk-in Modal appears
    await expect(page.locator('text=Add Unscheduled Walk-in').first()).toBeVisible({ timeout: 5000 });

    // Fill form
    await page.locator('input[placeholder*="John Doe"]').fill('Arthur Dent');
    await page.locator('input[placeholder*="Broken tooth"]').fill('Chipped Incisor Tooth #11');

    // Submit
    const submitBtn = page.locator('button', { hasText: 'Add to Roster' }).first();
    await submitBtn.click();

    // Verify new patient appears in the roster
    await expect(page.locator('h4', { hasText: 'Arthur Dent' }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Chipped Incisor Tooth #11').first()).toBeVisible();
  });

  test('Verbal Consent Guard Dialog & Consent Toggle', async ({ page }) => {
    // If island is active, cancel it to ensure clean operatory state
    const cancelIsland = page.locator('button[title*="Cancel recording"]').or(page.locator('button', { hasText: 'Cancel recording' })).first();
    if (await cancelIsland.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cancelIsland.click();
      await page.waitForTimeout(400);
    }

    // Locate David Miller card directly via data-patient-name
    const patientCard = page.locator('div[data-patient-name="David Miller"]').first();
    await expect(patientCard).toBeVisible();

    // If already has verbal consent, toggle it off to test guard dialog
    const consentToggle = patientCard.locator('button', { hasText: /Verbal Consent|Consent/ }).first();
    if (await patientCard.locator('text=Verbal Consent ✓').isVisible().catch(() => false)) {
      await consentToggle.click();
      await page.waitForTimeout(300);
    }

    // Locate the Record button for this patient card
    const recordBtn = patientCard.locator('button[title*="Record consultation"]').first();
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // Verify Consent Guard dialog appears
    await expect(page.locator('text=Confirm Verbal Recording Consent').first()).toBeVisible({ timeout: 5000 });

    // Confirm consent
    const confirmConsentBtn = page.locator('button', { hasText: 'Confirm Consent & Record' }).first();
    await expect(confirmConsentBtn).toBeVisible();
    await confirmConsentBtn.click();

    await page.waitForTimeout(600);

    // Cancel recording if island active to clean up
    const cancelBtn = page.locator('button[title*="Cancel recording"]').or(page.locator('button:has-text("Cancel")')).first();
    if (await cancelBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cancelBtn.click();
    }
  });

  test('Operatory Patient Inspection Drawer - SOAP Breakdown & Pre-Op Brief', async ({ page }) => {
    // Select Emma Watson card
    const emmaCard = page.locator('div', { hasText: 'Emma Watson' }).first();
    await expect(emmaCard).toBeVisible();
    await emmaCard.click();

    // Verify Inspection Drawer shows Emma Watson
    await expect(page.locator('text=Live Charting & SOAP View').first()).toBeVisible();
    await expect(page.locator('text=Adult Hygiene Scale & Clean').first()).toBeVisible();

    // Check ADA item codes rendered
    await expect(page.locator('text=114').first()).toBeVisible();
    await expect(page.locator('text=121').first()).toBeVisible();

    // Check Pre-Op clinical instructions or details
    await expect(page.locator('text=/Pre-Op Clinical Instructions|Pre-Op/i').first()).toBeVisible();
  });

  test('Side-by-Side Verification Modal - Grounding Audit, Discrepancies & Sign', async ({ page }) => {
    // Find Emma Watson's card
    const emmaCard = page.locator('div', { hasText: 'Emma Watson' }).first();
    await expect(emmaCard).toBeVisible();

    // Click "Verify Note" or "Audio Verified 100%" button
    const verifyBtn = emmaCard.locator('button', { hasText: /Verify Note|Audio Verified/i }).first();
    await expect(verifyBtn).toBeVisible();
    await verifyBtn.click();

    // Assert SideBySideVerificationModal is open
    await expect(page.locator('text=Clinical Note Verification & Grounding').first()).toBeVisible({ timeout: 6000 });
    await expect(page.locator('text=/Exact Spoken Words/i').first()).toBeVisible();
    await expect(page.locator('text=/Structured Clinical Note/i').first()).toBeVisible();

    // Switch to Discrepancy Audit tab
    const auditTabBtn = page.locator('button', { hasText: /Discrepancy Audit/i }).first();
    await expect(auditTabBtn).toBeVisible();
    await auditTabBtn.click();
    await page.waitForTimeout(300);

    // Verify discrepancy audit heading is displayed
    await expect(page.locator('text=/Audit of Stated Spoken Findings/i').first()).toBeVisible();

    // Switch back to Side-by-Side Comparison tab
    const comparisonTabBtn = page.locator('button', { hasText: /Side-by-Side Comparison/i }).first();
    await comparisonTabBtn.click();
    await page.waitForTimeout(300);

    // Confirm & Save Note
    const confirmSaveBtn = page.locator('button', { hasText: 'Confirm & Save Note' }).first();
    await expect(confirmSaveBtn).toBeVisible();
    await confirmSaveBtn.click();

    // Verify SideBySide modal closes and ReviewConfirmationSheet appears
    await expect(page.locator('text=Clinical Note Verification & Grounding')).not.toBeVisible();
    const confirmSheet = page.locator('[data-testid="review-confirmation-sheet"]');
    await expect(confirmSheet).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Clinical Note Signed & Sealed')).toBeVisible();

    // Dismiss sheet
    const stayBtn = confirmSheet.locator('button', { hasText: /Stay on/i }).first();
    await stayBtn.click();
    await expect(confirmSheet).not.toBeVisible();
  });

  test('Express PMS Copy Note & Aftercare SMS', async ({ page }) => {
    const emmaCard = page.locator('div', { hasText: 'Emma Watson' }).first();
    await expect(emmaCard).toBeVisible();

    // Locate Copy button
    const copyBtn = emmaCard.locator('button[title*="Express copy note"]').or(emmaCard.locator('button', { hasText: /Copy/i })).first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Check Aftercare SMS button
    const smsBtn = emmaCard.locator('button', { hasText: /SMS/i }).first();
    if (await smsBtn.isVisible()) {
      await smsBtn.click();
    }
  });

  test('Calm Chairside Hero - Active Patient Focus & High-Contrast Medical Alerts', async ({ page }) => {
    // Assert Active Patient Hero is rendered prominently
    const hero = page.locator('[data-testid="active-patient-hero"]');
    await expect(hero).toBeVisible({ timeout: 6000 });
    await expect(hero.locator('text=/Operatory Chair 1 · Current Patient Focus/i')).toBeVisible();

    // Check large-target primary action button
    const primaryBtn = hero.locator('[data-testid="hero-start-scribe-btn"], [data-testid="hero-review-note-btn"], [data-testid="hero-view-signed-btn"]').first();
    await expect(primaryBtn).toBeVisible();

    // Quick switch chair to David Miller to verify High-Contrast Medical Safety Banner
    const chairSelector = hero.locator('[data-testid="chair-patient-selector"]');
    if (await chairSelector.isVisible()) {
      const davidOption = await chairSelector.locator('option', { hasText: /David Miller/i }).first().getAttribute('value');
      if (davidOption) {
        await chairSelector.selectOption(davidOption);
        await page.waitForTimeout(300);

        // Verify High-Contrast Medical Safety Banner displays Penicillin / Warfarin warning
        const medicalBanner = page.locator('[data-testid="medical-safety-banner"]');
        await expect(medicalBanner).toBeVisible();
        await expect(medicalBanner.locator('text=/Penicillin Allergy/i')).toBeVisible();
      }
    }
  });

  test('Review Confirmation Sheet - Next Patient Chairside Progression', async ({ page }) => {
    // Select Emma Watson in the chair
    const chairSelector = page.locator('[data-testid="chair-patient-selector"]');
    const emmaOption = await chairSelector.locator('option', { hasText: /Emma Watson/i }).first().getAttribute('value');
    if (emmaOption) {
      await chairSelector.selectOption(emmaOption);
      await page.waitForTimeout(300);
    }

    // Open verification modal from hero
    const reviewBtn = page.locator('[data-testid="hero-review-note-btn"], [data-testid="hero-view-signed-btn"]').first();
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();

    // Confirm & Save Note to trigger ReviewConfirmationSheet
    await expect(page.locator('text=Clinical Note Verification & Grounding')).toBeVisible({ timeout: 6000 });
    const confirmSaveBtn = page.locator('button', { hasText: 'Confirm & Save Note' }).first();
    await confirmSaveBtn.click();

    // Verify ReviewConfirmationSheet
    const confirmSheet = page.locator('[data-testid="review-confirmation-sheet"]');
    await expect(confirmSheet).toBeVisible({ timeout: 5000 });

    // Test Advance Next Patient Button
    const advanceBtn = page.locator('[data-testid="advance-next-patient-btn"]');
    if (await advanceBtn.isVisible()) {
      await advanceBtn.click();
      await page.waitForTimeout(400);

      // Verify sheet closed and active patient hero advanced
      await expect(confirmSheet).not.toBeVisible();
      await expect(page.locator('[data-testid="active-patient-hero"]')).toBeVisible();
    }
  });
});
