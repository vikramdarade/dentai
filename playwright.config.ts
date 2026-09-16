import { defineConfig, devices } from '@playwright/test';

const targetBaseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const isRemoteTarget = targetBaseURL !== 'http://localhost:3000' && !targetBaseURL.includes('127.0.0.1');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45 * 1000,
  expect: {
    timeout: 10 * 1000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: targetBaseURL,
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream'
          ]
        }
      },
    }
  ],
  webServer: isRemoteTarget ? undefined : {
    command: 'npm.cmd run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 60 * 1000,
  },
});
