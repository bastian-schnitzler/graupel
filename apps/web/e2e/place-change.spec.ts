// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Change of place (REQ-751): on a phone and a tablet the place field shows a turning refresh symbol instead of the GPS
 * symbol (crosshair) until the new place's forecast is there; no box over the meteogram, the previous place's slider,
 * legend and chart stay meanwhile. The first load and the pull to refresh keep the day slider's box (REQ-737). With
 * `prefers-reduced-motion` the symbol stands still. The desktop keeps "Updating forecast…" over the chart (REQ-497).
 */
import { expect, onlyIn, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { Finger } from "./touch.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);

test.use({ timezoneId: "UTC" });

let errors: string[] = [];
/** While set, forecast answers wait for it. */
let hold: Promise<void> | null = null;
let release: () => void = () => {};

/** Lets Open-Meteo's answers wait until `release()`. */
function holdAnswers() {
  hold = new Promise((resolve) => (release = resolve));
}

test.beforeEach(async ({ page }) => {
  errors = [];
  hold = null;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    if (hold) await hold;
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  release();
  expect(errors).toEqual([]);
});

const location = (page: Page) => page.locator('[data-region="location"]');
const gps = (page: Page) => location(page).locator(".location__gps");
/** The symbol in the place field: the crosshair (`gps`) or the refresh symbol (`refresh`). */
const fieldIcon = (page: Page) => gps(page).locator("svg");
const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const box = (page: Page) => page.getByTestId("day-slider-loading");
const message = (page: Page) => page.getByTestId("forecast-loading");

/** How the field's symbol moves: its animation and its transform. */
const motion = (page: Page) =>
  fieldIcon(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, transform: style.transform };
  });

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(message(page)).toHaveCount(0);
  await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
}

/** Chooses Matterhorn from the favourites. */
async function chooseMatterhorn(page: Page) {
  await location(page).getByRole("button", { name: "Show favourites" }).click();
  await location(page).getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name: "Matterhorn" }).click();
  await expect(location(page).getByRole("combobox")).toHaveValue("Matterhorn");
}

test.describe("phone and tablet (REQ-751)", () => {
  onlyIn(["phone", "tablet"], "the turning symbol in the place field belongs to the phone's design (REQ-728)");

  test("a new place turns the field's symbol; no box over the chart, the previous chart stays", async ({ page }) => {
    await open(page);
    const place = page.getByTestId("meteogram-place");
    const before = await place.textContent();
    expect(before).not.toContain("Matterhorn");
    const legend = page.getByTestId("meteogram-legend");
    const legendShown = await legend.isVisible();
    const slider = (await page.locator('[data-region="day-slider"]').boundingBox())!;

    holdAnswers();
    await chooseMatterhorn(page);
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "refresh");
    await expect(gps(page)).toHaveAttribute("data-loading", "");
    await expect(fieldIcon(page)).toBeVisible();
    expect((await motion(page)).animation).toBe("location-loading-turn");
    // Also once the load takes a while (REQ-497's delay is 400 ms): no box or message over the slider or the chart.
    await page.waitForTimeout(600);
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "refresh");
    await expect(message(page)).toHaveCount(0);
    await expect(page.locator(".meteogram__status")).toHaveCount(0);
    await expect(box(page)).toBeHidden();
    await expect(page.getByText("Updating forecast…")).toHaveCount(0);
    await expect(page.getByText("Loading forecast…")).toHaveCount(0);
    // The previous place's slider, legend and chart stand as they were.
    await expect(chart(page)).toBeVisible();
    await expect(place).toHaveText(before!);
    await expect(page.getByTestId("day-slider-track")).toBeVisible();
    expect(await page.locator('[data-region="day-slider"]').boundingBox()).toEqual(slider);
    if (legendShown) await expect(legend).toBeVisible();

    release();
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
    await expect(gps(page)).not.toHaveAttribute("data-loading");
    await expect(place).toContainText("Matterhorn");
    await expect(chart(page)).toBeVisible();
    await expect(message(page)).toHaveCount(0);
  });

  test("the first load and a pull to refresh keep the box over the days (REQ-737)", async ({ page }) => {
    holdAnswers();
    await page.goto(APP);
    await expect(message(page)).toHaveText("Loading forecast…");
    await expect(page.locator('[data-region="day-slider"]').getByTestId("forecast-loading")).toBeVisible();
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
    release();
    await expect(chart(page)).toBeVisible();
    await expect(message(page)).toHaveCount(0);

    // Pulled down on the chart and released after 80 px: the box says it loads, the field keeps the crosshair.
    holdAnswers();
    const area = (await page.getByTestId("meteogram-scroll").boundingBox())!;
    const [x, y] = [Math.round(area.x + area.width * 0.4), Math.round(area.y + area.height * 0.3)];
    const finger = await Finger.down(page, x, y);
    await finger.move(0, 80);
    await finger.up();
    await expect(message(page)).toHaveText("Loading forecast…");
    await expect(box(page)).toHaveAttribute("data-loading", "");
    await page.waitForTimeout(600);
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
    release();
    await expect(message(page)).toHaveCount(0);
    await expect(box(page)).toBeHidden();
  });

  test("with prefers-reduced-motion the field's symbol stands still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    holdAnswers();
    await chooseMatterhorn(page);
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "refresh");
    expect(await motion(page)).toEqual({ animation: "none", transform: "none" });
    // Still after a while.
    await page.waitForTimeout(300);
    expect(await motion(page)).toEqual({ animation: "none", transform: "none" });
    release();
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
  });
});

test.describe("desktop (REQ-497)", () => {
  onlyIn("desktop", "the desktop keeps its message over the chart; the place field's symbol is the phone design's");

  test("a new place keeps the crosshair and shows \"Updating forecast…\" over the chart", async ({ page }) => {
    await open(page);
    holdAnswers();
    await chooseMatterhorn(page);
    await expect(message(page)).toHaveText("Updating forecast…");
    await expect(page.locator('[data-region="meteogram"]').getByTestId("forecast-loading")).toBeVisible();
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
    await expect(gps(page)).not.toHaveAttribute("data-loading");
    release();
    await expect(message(page)).toHaveCount(0);
    await expect(fieldIcon(page)).toHaveAttribute("data-icon", "gps");
  });
});
