// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Start with the start place "Current position (GPS)" (REQ-760), on a phone, a tablet and a desktop: the page always
 * shows a forecast and never stays at "Loading forecast…". The setting is chosen in the settings and the page loaded
 * anew. The page asks for the position only where the browser does not give it without a question (DEC-107).
 *
 * - Permission granted (Playwright grants it, fixed position): the forecast of "My location", read without a question.
 * - Permission still to be asked ("prompt"): the page asks at start. Playwright's Chromium shows no prompt that a test
 *   could answer, so the permission query is stubbed to say "prompt" and `getCurrentPosition` stands for the prompt:
 *   it records the request and the test answers it, allow (a position) or deny (code 1). Meanwhile the first
 *   favourite stands with its forecast.
 * - Permission denied (query stubbed to "denied"): no request at all, the fallback place with the card and the hint.
 * - No answer from the position (stubbed `getCurrentPosition`): the fallback place, the timeout's card after 20 s.
 * - No answer from the permission query (as in the installed app on iOS): the page asks after a moment anyway.
 *
 * The browser of the phone project is Chromium (WebKit is not installed), with the iPhone's window and touch screen.
 */
import { expect, test, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";
/** The device's fixed position; the page rounds it to four decimals. */
const HOME = { latitude: 51.180634, longitude: 7.509271 };
/** How long the page waits for the position at start (START_GPS_TIMEOUT_MS). */
const START_GPS_TIMEOUT_MS = 20_000;

/** Window of the page with the stand-in prompt: the requests `getCurrentPosition` got, to be answered by the test. */
type PromptWindow = Window & { gpsRequests: { allow: PositionCallback; deny: PositionErrorCallback }[] };

/** The permission query says `state` for the position; the other permissions as the browser has them. */
async function stubPermission(page: Page, state: PermissionState | "never") {
  await page.addInitScript((answer) => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) => {
      if (descriptor.name !== "geolocation") return query(descriptor);
      if (answer === "never") return new Promise<PermissionStatus>(() => {});
      return Promise.resolve({ state: answer, name: "geolocation" } as PermissionStatus);
    };
  }, state);
}

/** `getCurrentPosition` as the browser's prompt: each request waits for the test's answer. */
async function stubPrompt(page: Page) {
  await page.addInitScript(() => {
    const win = window as unknown as PromptWindow;
    win.gpsRequests = [];
    navigator.geolocation.getCurrentPosition = (allow, deny) => {
      win.gpsRequests.push({ allow, deny: deny! });
    };
  });
}

const gpsRequests = (page: Page) => page.evaluate(() => (window as unknown as PromptWindow).gpsRequests.length);

let errors: string[] = [];

test.use({ locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [327] } }),
  );
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const search = (page: Page) =>
  page.locator('[data-region="location"]').getByRole("combobox", { name: "Search for a place" });
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const loading = (page: Page) => page.getByTestId("forecast-loading");
const card = (page: Page) => page.getByTestId("error-card");

/** Chooses "Current position (GPS)" as start place in the settings and loads the page anew. */
async function startWithGps(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await (await headerControl(page, "button", "Settings")).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("tab", { name: "Start" }).click();
  await dialog.getByRole("combobox", { name: "Start place" }).selectOption({ label: "Current position (GPS)" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("graupel.startLocation"))).toBe("gps");
  await page.reload();
}

/** The fallback place's forecast: the first favourite, its chart, no lasting "Loading forecast…". */
async function expectFallback(page: Page, openMeteo: string[]) {
  await expect(search(page)).toHaveValue("Großglockner");
  await expect(chart(page)).toBeVisible();
  await expect(loading(page)).toHaveCount(0);
  expect(openMeteo.some((url) => url.includes("latitude=47.0742") && url.includes("longitude=12.6947"))).toBe(true);
}

test.describe("with the permission", () => {
  test.use({ geolocation: HOME, permissions: ["geolocation"] });

  test("loads the forecast of 'My location' (REQ-760)", async ({ page, openMeteo }) => {
    await startWithGps(page);
    await expect(search(page)).toHaveValue("My location");
    await expect(chart(page)).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    expect(openMeteo.some((url) => url.includes("latitude=51.1806") && url.includes("longitude=7.5093"))).toBe(true);
    await expect(card(page)).toHaveCount(0);
  });

  test("loads the fallback place when the position never answers, the card after the timeout (REQ-760)", async ({
    page,
    openMeteo,
  }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = () => {};
    });
    await startWithGps(page);
    // The fallback place's forecast does not wait for the position.
    await expectFallback(page, openMeteo);
    await expect(card(page)).toHaveCount(0);
    await page.clock.fastForward(START_GPS_TIMEOUT_MS);
    await expect(card(page).locator(".error-card__text")).toHaveText(
      "Determining your location took too long. Please try again.",
    );
    await expectFallback(page, openMeteo);
  });

  test("asks for the position anyway when the permission query never answers (REQ-760)", async ({ page }) => {
    await stubPermission(page, "never");
    await startWithGps(page);
    await expect(search(page)).toHaveValue("My location");
    await expect(chart(page)).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
  });
});

test.describe("with the permission still to be asked (DEC-107)", () => {
  test.beforeEach(async ({ page }) => {
    await stubPermission(page, "prompt");
    await stubPrompt(page);
  });

  test("asks at start; allowed: the forecast of 'My location' (REQ-760)", async ({ page, openMeteo }) => {
    await startWithGps(page);
    await expect.poll(() => gpsRequests(page)).toBe(1);
    // While the browser asks, the first favourite stands with its forecast.
    await expectFallback(page, openMeteo);
    await page.evaluate(
      ({ latitude, longitude }) =>
        (window as unknown as PromptWindow).gpsRequests[0]!.allow({
          coords: { latitude, longitude, accuracy: 10 },
          timestamp: Date.now(),
        } as GeolocationPosition),
      HOME,
    );
    await expect(search(page)).toHaveValue("My location");
    await expect(chart(page)).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    expect(openMeteo.some((url) => url.includes("latitude=51.1806") && url.includes("longitude=7.5093"))).toBe(true);
    await expect(card(page)).toHaveCount(0);
  });

  test("asks at start; denied: the fallback place with the card and where to allow it (REQ-760)", async ({
    page,
    openMeteo,
  }) => {
    await startWithGps(page);
    await expect.poll(() => gpsRequests(page)).toBe(1);
    await page.evaluate(() => {
      const denial = { code: 1, message: "denied" } as GeolocationPositionError;
      (window as unknown as PromptWindow).gpsRequests[0]!.deny(denial);
    });
    await expect(card(page).locator(".error-card__text")).toHaveText("Access to your location was denied.");
    await expect(card(page).getByTestId("error-card-detail")).toContainText("To allow it");
    await expectFallback(page, openMeteo);
  });
});

test("does not ask with a denied permission: the fallback place with the card and where to allow it (REQ-760)", async ({
  page,
  openMeteo,
}) => {
  await stubPermission(page, "denied");
  await stubPrompt(page);
  await startWithGps(page);
  await expectFallback(page, openMeteo);
  await expect(card(page).locator(".error-card__text")).toHaveText("Access to your location was denied.");
  await expect(card(page).getByTestId("error-card-detail")).toContainText("To allow it");
  // DEC-107: denied for good, not asked again.
  expect(await gpsRequests(page)).toBe(0);
});
