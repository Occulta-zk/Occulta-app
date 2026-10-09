import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (`pnpm build` first). They run fully
 * locally: nothing here talks to testnet until a registry is deployed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
