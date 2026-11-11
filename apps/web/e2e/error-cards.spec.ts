// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Error messages as closable cards in the bottom-left corner (REQ-492), on a desktop and a phone width: a denied
 * location shows a card instead of a message in the location region, with where Chromium allows it again (REQ-509),
 * and a failed forecast shows one too.
 */
import { expect, test, type Page } from "./fixtures.ts";

const APP = "http://localhost:4175/";

test.use({ locale: "en-GB" });

test.beforeEach(async ({ page, context }) => {
  await context.clearPermissions();
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) => route.fulfill({ json: { elevation: [200] } }));
});

async function expectBottomLeft(page: Page, width: number) {
  const card = page.getByTestId("error-card");
  const box = (await card.boundingBox())!;
  const viewport = page.viewportSize()!;
  // In the corner, inside the page gutter (16 px), and on phones as wide as the page minus its gutters.
  expect(box.x).toBeGreaterThanOrEqual(15);
  expect(box.x).toBeLessThanOrEqual(17);
  expect(viewport.height - (box.y + box.height)).toBeGreaterThanOrEqual(15);
  expect(viewport.height - (box.y + box.height)).toBeLessThanOrEqual(17);
  if (width < 400) expect(Math.round(box.width)).toBe(width - 32);
  else expect(box.width).toBeLessThanOrEqual(24 * 16 + 1);
}

for (const width of [1280, 375]) {
  test(`denied location shows a closable card bottom-left, not inline (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    const region = page.locator('[data-region="location"]');
    await region.getByRole("button", { name: "Current location" }).click();

    const card = page.getByTestId("error-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("role", "alert");
    await expect(card.locator(".error-card__text")).toHaveText("Access to your location was denied.");
    // Where Chromium on the desktop allows it again (REQ-509).
    await expect(card.getByTestId("error-card-detail")).toHaveText(
      "To allow it, click the site information icon left of the address, allow “Location” and reload the page.",
    );
    await expectBottomLeft(page, width);
    // Nothing inside the location region.
    await expect(region.getByRole("alert")).toHaveCount(0);
    await expect(region).not.toContainText("denied");

    // Pressing again does not stack the same message.
    await region.getByRole("button", { name: "Current location" }).click();
    await expect(page.getByTestId("error-card")).toHaveCount(1);

    await card.getByRole("button", { name: "Close message" }).click();
    await expect(page.getByTestId("error-card")).toHaveCount(0);
  });

  test(`a failed forecast shows a card and keeps the retry button in place (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => route.abort());
    await page.goto(APP);
    const card = page.getByTestId("error-card");
    await expect(card.locator(".error-card__text")).toHaveText("The forecast could not be loaded.");
    // With the reason in its second line (REQ-632).
    await expect(card.getByTestId("error-card-detail")).toHaveText(
      "No connection to Open-Meteo, or the request was blocked. Check your connection.",
    );
    await expectBottomLeft(page, width);
    const placeholder = page.getByTestId("forecast-error");
    await expect(placeholder.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(placeholder).not.toContainText("could not be loaded");
  });
}
