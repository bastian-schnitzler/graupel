// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Top card and info popup at phone and desktop width, light and dark (TASK-121):
 * - the info popup keeps its height and top edge when the tab changes (REQ-525);
 * - the globe sits inside the language field, the field is as high as the icon buttons, and on phones the globe stands
 *   centred above the GPS button of the search field (REQ-526);
 * - on phones elevation and coordinates share one line without labels, the coordinates right-aligned; on desktop the
 *   labels stay (REQ-527).
 * With SHOT_DIR set, each case also saves a screenshot there.
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";

const APP = "http://localhost:4175/";
const SHOT_DIR = process.env.SHOT_DIR;

test.use({ locale: "en-GB" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1200] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

const centreX = (b: { x: number; width: number }) => b.x + b.width / 2;
const centreY = (b: { y: number; height: number }) => b.y + b.height / 2;

async function shot(page: Page, name: string) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

for (const scheme of ["light", "dark"] as const) {
  for (const { name, width, height } of [
    { name: "phone", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    test.describe(`${scheme}, ${width}px`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height } });
      ownDevice();

      test.beforeEach(async ({ page }) => {
        await page.goto(APP);
      });

      test("info popup keeps its height and top edge in every tab (REQ-525)", async ({ page }) => {
        await page.getByRole("banner").getByRole("button", { name: "Info" }).click();
        const dialog = page.getByRole("dialog", { name: "Information" });
        await expect(dialog).toBeVisible();
        const boxes = [];
        for (const tab of ["About", "Legal notice", "Privacy policy", "About"]) {
          await dialog.getByRole("tab", { name: tab }).click();
          await expect(dialog.getByRole("tabpanel", { name: tab })).toBeVisible();
          boxes.push(await box(dialog));
          await shot(page, `info-${width}-${scheme}-${tab.replace(/ /g, "-").toLowerCase()}`);
        }
        const [first, ...rest] = boxes;
        for (const b of rest) {
          expect(Math.abs(b.y - first!.y)).toBeLessThan(1);
          expect(Math.abs(b.height - first!.height)).toBeLessThan(1);
        }
        // The popup stays on the screen; a long tab scrolls inside the body, the page does not.
        expect(first!.y).toBeGreaterThanOrEqual(0);
        expect(first!.y + first!.height).toBeLessThanOrEqual(height);
        const scroll = await dialog.evaluate((el) => {
          const body = el.querySelector(".dialog__body")!;
          return { overflow: getComputedStyle(body).overflowY, dialog: el.scrollHeight - el.clientHeight };
        });
        expect(scroll.overflow).toBe("auto");
        expect(scroll.dialog).toBeLessThanOrEqual(1);
      });

      test("globe inside the language field, field as high as the buttons (REQ-526)", async ({ page }) => {
        const header = page.locator('[data-region="header"]');
        const language = header.getByRole("combobox", { name: "Language" });
        const globe = header.locator(".header__globe");
        await expect(language).toBeVisible();
        await expect(globe).toBeVisible();
        const languageBox = await box(language);
        const globeBox = await box(globe);
        // Inside the field, on its left, before the text.
        expect(globeBox.x).toBeGreaterThan(languageBox.x);
        expect(globeBox.x + globeBox.width).toBeLessThan(languageBox.x + languageBox.width / 2);
        expect(globeBox.y).toBeGreaterThan(languageBox.y);
        expect(globeBox.y + globeBox.height).toBeLessThan(languageBox.y + languageBox.height);
        expect(Math.abs(centreY(globeBox) - centreY(languageBox))).toBeLessThan(1);
        const textStart = await language.evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineStart));
        expect(globeBox.x + globeBox.width).toBeLessThanOrEqual(languageBox.x + textStart);

        // As high as settings and info, centred on the same line.
        for (const label of ["Settings", "Info"]) {
          const b = await box(header.getByRole("button", { name: label }));
          expect(Math.abs(b.height - languageBox.height)).toBeLessThan(0.5);
          expect(Math.abs(centreY(b) - centreY(languageBox))).toBeLessThan(0.5);
        }

        // Clicking the globe still opens the field (it does not take the pointer).
        expect(await globe.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");

        if (name === "phone") {
          const gps = await box(page.getByRole("region", { name: "Location" }).getByRole("button", { name: "Current location" }));
          expect(Math.abs(centreX(globeBox) - centreX(gps))).toBeLessThanOrEqual(2);
          expect(globeBox.y).toBeLessThan(gps.y);
        }
        await shot(page, `top-${width}-${scheme}`);
      });

      test("elevation and coordinates (REQ-527)", async ({ page }) => {
        const location = page.getByRole("region", { name: "Location" });
        const elevation = location.getByTestId("location-elevation");
        const coordinates = location.getByTestId("location-coordinates");
        await expect(elevation).toHaveText(/\d m$/);
        const facts = await box(location.locator(".location__facts"));
        const elevationBox = await box(elevation);
        const coordinatesBox = await box(coordinates);
        const labels = location.locator(".location__facts dt");
        await expect(labels).toHaveText(["Elevation", "Coordinates"]);
        const labelWidths = await labels.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
        if (name === "phone") {
          // No visible labels (still read by screen readers), one line, elevation left, coordinates right.
          for (const w of labelWidths) expect(w).toBeLessThanOrEqual(1);
          expect(Math.abs(centreY(elevationBox) - centreY(coordinatesBox))).toBeLessThan(1);
          expect(Math.abs(elevationBox.x - facts.x)).toBeLessThan(1);
          expect(Math.abs(coordinatesBox.x + coordinatesBox.width - (facts.x + facts.width))).toBeLessThan(1);
          expect(coordinatesBox.x).toBeGreaterThan(elevationBox.x + elevationBox.width);
        } else {
          // Desktop unchanged: labels visible, elevation first, coordinates right behind it (not pushed to the edge).
          for (const w of labelWidths) expect(w).toBeGreaterThan(20);
          await expect(location.getByText("Elevation", { exact: true })).toBeVisible();
          expect(coordinatesBox.x).toBeGreaterThan(elevationBox.x + elevationBox.width);
          expect(coordinatesBox.x + coordinatesBox.width).toBeLessThan(facts.x + facts.width - 50);
        }
      });
    });
  }
}
