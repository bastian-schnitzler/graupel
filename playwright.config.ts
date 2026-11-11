import { defineConfig, devices, type PlaywrightTestOptions } from "@playwright/test";
import type { DeviceClassOptions } from "./apps/web/e2e/fixtures.ts";

// Vorinstalliertes Chromium, wenn dessen Version nicht zu @playwright/test passt (z. B. Cloud-Umgebung).
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
  : {};

/** Gerät aus Playwrights Liste in Chromium (WebKit ist nicht installiert), hochkant oder gedreht. */
function device(name: string, turned = false): Partial<PlaywrightTestOptions> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...options } = devices[name]!;
  const upright = options.viewport;
  const viewport = turned ? { width: upright.height, height: upright.width } : upright;
  // Der Bildschirm so groß wie die Seite: daran erkennt die Seite das Tablet (DEC-090).
  return { ...options, viewport, screen: viewport, browserName: "chromium" };
}

// Website-Tests der Geräteklassen (REQ-745).
const WEB_TESTS = "apps/web/e2e/**/*.spec.ts";

// End-to-End-Tests der Apps liegen in apps/*/e2e/, die der Pakete in packages/*/e2e/. Die Website-Tests laufen in den
// drei Geräteklassen (REQ-745): Desktop, Telefon (iPhone 13 hochkant) und Tablet (iPad Pro 11 hochkant und quer, nach
// DEC-090 mit grobem Zeiger und kürzerer Seite ab 600 px). Tests, die es nur für eine Klasse gibt, begrenzen sich selbst
// mit Grund (`onlyIn` in apps/web/e2e/fixtures.ts); die Demo- und Domain-Viewer-Tests bleiben beim Desktop.
export default defineConfig<DeviceClassOptions>({
  reporter: "list",
  // Reference pictures without the project's name: a test that takes one pins its class, so one project takes it.
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-chromium-{platform}{ext}",
  projects: [
    {
      name: "desktop",
      testMatch: ["apps/*/e2e/**/*.spec.ts", "packages/*/e2e/**/*.spec.ts"],
      use: { ...devices["Desktop Chrome"], ...launchOptions, deviceClass: "desktop" },
    },
    {
      name: "phone",
      testMatch: WEB_TESTS,
      use: { ...device("iPhone 13"), ...launchOptions, deviceClass: "phone" },
    },
    {
      name: "tablet",
      testMatch: WEB_TESTS,
      use: { ...device("iPad Pro 11"), ...launchOptions, deviceClass: "tablet" },
    },
    {
      name: "tablet-landscape",
      testMatch: WEB_TESTS,
      use: { ...device("iPad Pro 11", true), ...launchOptions, deviceClass: "tablet" },
    },
  ],
  webServer: [
    {
      // Demo-Seite des Meteogramm-Kerns (baut den Kern und startet den statischen Server).
      command: "pnpm --filter @graupel/meteogram demo",
      url: "http://localhost:4173/demo/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Website (apps/web): baut die Seite und liefert sie mit vite preview aus.
      command: "pnpm --filter @graupel/web build && pnpm --filter @graupel/web preview",
      url: "http://localhost:4175/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Model Domain Viewer (builds dist/ and starts the static server).
      command: "pnpm --filter @graupel/domain-viewer start",
      url: "http://localhost:4174/",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
