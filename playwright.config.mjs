import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, retries: 0, timeout: 30000,
  outputDir: './test-results/browser',
  webServer: { command: 'node scripts/ui-server.mjs', url: 'http://127.0.0.1:8877/api/v1/config', reuseExistingServer: false, timeout: 60000 },
  use: { baseURL: 'http://127.0.0.1:8877', channel: 'msedge', headless: true,
    viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  reporter: [['list']],
});
