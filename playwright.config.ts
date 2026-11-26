import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.test", override: true, quiet: true });
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false, // one shared test database
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/New_York",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { ...process.env, ENABLE_DEV_MAILBOX: "1", PORT: String(PORT) } as Record<string, string>,
  },
});
