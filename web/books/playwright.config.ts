import { defineConfig } from "@playwright/test";

// End-to-end tests against the live API (books). They never write: e2e/fixtures.ts fails any
// test whose page sends a write frame, so the user's books are never changed by a run.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  // Outside `/app` (the frontend folder): results written inside it set off the watch
  // build, whose new `dist/` reloads the page under test, in a loop.
  outputDir: "/tmp/playwright-results",
  reporter: [["list"], ["html", { outputFolder: "/tmp/playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.VANTAGE_URL, viewport: { width: 1600, height: 1000 },
    // The container's /dev/shm is small: Chromium crashed ("Target crashed") painting the
    // full-screen splash. This makes it use /tmp instead.
    launchOptions: { args: ["--disable-dev-shm-usage"] },
  },
});
