import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.ts",
  workers: 1,
  use: {
    channel: process.env.CI ? "chromium" : "msedge",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
  webServer: [
    {
      command: "npm run dev -- --mode demo --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev -- --port 5175",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_APP_MODE: "live",
        VITE_SUPABASE_URL: "https://test-project.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      },
    },
  ],
});
