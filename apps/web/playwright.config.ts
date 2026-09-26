import { defineConfig } from "@playwright/test";

const viewports = [
  { name: "mobile-320", viewport: { width: 320, height: 740 } },
  { name: "mobile-375", viewport: { width: 375, height: 812 } },
  { name: "mobile-390", viewport: { width: 390, height: 844 } },
  { name: "tablet", viewport: { width: 768, height: 1024 } },
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "large-desktop", viewport: { width: 1920, height: 1080 } },
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: viewports.map(({ name, viewport }) => ({ name, use: { viewport } })),
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
