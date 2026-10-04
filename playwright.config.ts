import { defineConfig } from '@playwright/test';

// End-to-end against the built site, in the installed Chrome (no browser download). The Anthropic API is
// intercepted in the test: no request leaves the machine and nothing is spent.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4173', channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'pnpm build && pnpm exec vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
