// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The sunrise time of the first day and the axis labels (REQ-723): where the sunrise time would stand over the
 * maximum of the left axis (on a phone held upright the "07:35" of the first day over "10°" in the chart's upper left
 * corner), it stands right of its line instead, starting at the line, as the sunset time stands next to its line; the
 * other sunrise times stay centred over their lines. The drawing belongs to @graupel/meteogram (MET-S14, REQ-734);
 * here that the website shows it on the phone (iPhone and Android, compact axis labels), in the turned full-screen
 * view, on the desktop and in the copied picture. With compact labels the topmost label of each area keeps 1 px off
 * the area's top edge (REQ-694), also with sun times in the chart. Pictures of the upper left corner on both phones
 * catch unintended moves; after an intended change they are taken again with `pnpm test:e2e --update-snapshots`.
 *
 * The shared fake forecast has no sun times; these tests answer the request for them with a sunrise at 07:35 and a
 * sunset at 16:50 GMT on every day, as on the phone in REQ-723's picture.
 */
import { devices } from "@playwright/test";
import {
  expect,
  IPHONE_SAFARI,
  test,
  type Locator,
  type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import {
  axisLabelAreas,
  expectAxisLabelsApart,
  leftExtremes,
  type AxisArea,
  type AxisLabel,
} from "./phoneLayout.ts";

const APP = "http://localhost:4175/";
const DAY_MS = 24 * 3_600_000;
/** Fixed time: Tuesday, 10 November 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 11);
/** Same query as src/state/phoneLandscape.ts. */
const PHONE_LANDSCAPE =
  "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)";
const COPY = "Copy the meteogram as a picture";

let errors: string[] = [];

test.use({ timezoneId: "UTC", locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => {
    if (!new URL(route.request().url()).searchParams.has("daily"))
      return fakeForecast(route, { now: FIXED_NOW });
    const today = Math.floor(FIXED_NOW / DAY_MS) * DAY_MS;
    const days = Array.from({ length: 20 }, (_, i) =>
      new Date(today + (i - 3) * DAY_MS).toISOString().slice(0, 10),
    );
    return route.fulfill({
      json: {
        timezone: "GMT",
        daily: {
          time: days,
          sunrise: days.map((day) => `${day}T07:35`),
          sunset: days.map((day) => `${day}T16:50`),
        },
      },
    });
  });
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  // Every SVG the page serialises: the last one is the chart of the picture (as in meteogram-image-margin.spec.ts).
  await page.addInitScript(() => {
    const serialize = XMLSerializer.prototype.serializeToString;
    const captured: string[] = [];
    Object.assign(window, { __exportSvgs: captured });
    XMLSerializer.prototype.serializeToString = function (node: Node) {
      const markup = serialize.call(this, node);
      if (markup.startsWith("<svg")) captured.push(markup);
      return markup;
    };
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) =>
  page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');
const fullscreenChart = (page: Page) =>
  page
    .getByRole("dialog", { name: "Meteogram (full screen)" })
    .locator('svg[data-render-mode="fullscreen"]');
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

/** Opens the page and waits for the sun times and until the chart keeps its height on two rendering steps in a row. */
async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(
    chart(page).locator('[data-testid="sunrise"]').first(),
  ).toBeAttached();
  let previous = -1;
  await expect
    .poll(async () => {
      await frames(page);
      const height = await chart(page).evaluate(
        (svg) => svg.getBoundingClientRect().height,
      );
      const steady = height === previous;
      previous = height;
      return steady;
    })
    .toBe(true);
}

/** A sunrise time on screen: its anchor and box, and the x of its line (the left edge of its day's daylight). */
interface Sunrise {
  day: string;
  anchor: string | null;
  left: number;
  right: number;
  top: number;
  bottom: number;
  line: number;
}

/** The sunrise times of the chart `svg` by day, the first day first. */
function sunrises(svg: Locator): Promise<Sunrise[]> {
  return svg.evaluate((root: SVGSVGElement) => {
    // One daylight stripe per day and area: the left edges of the first area's stripes, from left to right.
    const lines = [
      ...new Set(
        [...root.querySelectorAll('[data-testid="daylight-stripe"]')].map(
          (rect) => rect.getBoundingClientRect().left,
        ),
      ),
    ].sort((a, b) => a - b);
    return [...root.querySelectorAll<SVGTextElement>('[data-testid="sunrise"]')]
      .map((text) => {
        const box = text.getBoundingClientRect();
        const middle = (box.left + box.right) / 2;
        // Its line: the stripe edge nearest to the label's start (anchored at its start) or its middle.
        const at =
          text.getAttribute("text-anchor") === "start" ? box.left : middle;
        const line = lines.reduce(
          (best, x) => (Math.abs(x - at) < Math.abs(best - at) ? x : best),
          Infinity,
        );
        return {
          day: text.getAttribute("data-day") ?? "",
          anchor: text.getAttribute("text-anchor"),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          line,
        };
      })
      .sort((a, b) => a.day.localeCompare(b.day));
  });
}

const temperature = (areas: AxisArea[]) =>
  areas.find((area) => area.id === "temp")!;

/** Axis labels of `labels` the sunrise time's box covers (half a pixel of rounding allowed). */
const covered = (sunrise: Sunrise, labels: AxisLabel[]) =>
  labels
    .filter((label) => {
      const across =
        Math.min(sunrise.right, label.right) -
        Math.max(sunrise.left, label.left);
      const down =
        Math.min(sunrise.bottom, label.bottom) -
        Math.max(sunrise.top, label.top);
      return across > 0.5 && down > 0.5;
    })
    .map((label) => label.lines.join(" "));

/**
 * The first day's sunrise time covers no axis label of the temperature area and does not stand over its maximum: it
 * starts right of the maximum's end. Returns it and the maximum.
 */
async function expectFirstSunriseClear(svg: Locator) {
  const [first] = await sunrises(svg);
  expect(first, "a sunrise time on the first day").toBeDefined();
  const temp = temperature(await axisLabelAreas(svg));
  expect(covered(first!, temp.labels), `sunrise ${first!.day}`).toEqual([]);
  const max = leftExtremes(temp).max!;
  expect(first!.left, "sunrise right of the maximum").toBeGreaterThanOrEqual(
    max.right - 0.5,
  );
  return { first: first!, max };
}

/** The other days' sunrise times stay centred over their lines. */
function expectCentred(list: Sunrise[]) {
  expect(list.length).toBeGreaterThan(0);
  for (const sunrise of list) {
    expect(sunrise.anchor, sunrise.day).toBe("middle");
    expect(
      Math.abs((sunrise.left + sunrise.right) / 2 - sunrise.line),
      sunrise.day,
    ).toBeLessThanOrEqual(1);
  }
}

const PHONES = [
  // iPhone 13 with Safari's bars: the chart's areas get low, the axis labels compact (REQ-694).
  {
    name: "iphone-13",
    userAgent: IPHONE_SAFARI,
    deviceScaleFactor: 3,
    viewport: devices["iPhone 13"].viewport,
  },
  // An Android phone with Chrome, 360 × 640 below its address bar (Moto G4 of Playwright's device list): compact
  // labels as well.
  {
    name: "android-360",
    userAgent: devices["Moto G4"].userAgent,
    deviceScaleFactor: devices["Moto G4"].deviceScaleFactor,
    viewport: devices["Moto G4"].viewport,
  },
];

for (const phone of PHONES) {
  test.describe(`${phone.name} upright (REQ-723)`, () => {
    test.use({
      isMobile: true,
      hasTouch: true,
      userAgent: phone.userAgent,
      deviceScaleFactor: phone.deviceScaleFactor,
      viewport: phone.viewport,
    });
    ownDevice();

    test("the first sunrise time right of its line, not over the maximum; the top labels 1 px below the area's edge", async ({
      page,
    }) => {
      await open(page);
      const areas = await axisLabelAreas(chart(page));
      // Compact labels: the unit of precipitation and wind once below its area (REQ-694).
      for (const id of ["precip", "wind"]) {
        const area = areas.find((entry) => entry.id === id)!;
        expect(
          area.labels.filter((label) => label.testid === "axis-unit"),
          id,
        ).toHaveLength(1);
      }
      // The topmost label of each area (its maximum): the top of its digits 1 px below the area's top edge (±1 px).
      for (const area of areas) {
        const max = leftExtremes(area).max!;
        expect(
          Math.abs(max.top - (area.top + 1)),
          `${area.id} maximum`,
        ).toBeLessThanOrEqual(1);
      }

      // The first day's sunrise time starts at its line, right of the maximum in the corner (REQ-734).
      const { first, max } = await expectFirstSunriseClear(chart(page));
      expect(first.anchor).toBe("start");
      expect(
        first.left - first.line,
        "starts at its line",
      ).toBeGreaterThanOrEqual(-0.5);
      expect(first.left - first.line, "starts at its line").toBeLessThanOrEqual(
        1,
      );
      // In the same row as the maximum, which stays in the corner.
      expect(first.bottom).toBeGreaterThan(max.top);
      expectCentred((await sunrises(chart(page))).slice(1));
      await expectAxisLabelsApart(chart(page));

      // Picture of the temperature area's upper left corner: maximum, first sunrise time and its line.
      const temp = temperature(areas);
      const box = (await chart(page).boundingBox())!;
      await expect(page).toHaveScreenshot(`sunrise-${phone.name}.png`, {
        clip: {
          x: box.x,
          y: temp.top - 2,
          width: 120,
          height: temp.bottom - temp.top + 4,
        },
        maxDiffPixelRatio: 0.002,
      });
    });

    test("the copied picture: the first sunrise time covers no axis label", async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: APP,
      });
      await open(page);
      await page.getByRole("button", { name: COPY }).first().click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Meteogram copied" })
          .first(),
      ).toBeVisible();
      const picture = await showPicture(page);
      await expectFirstSunriseClear(picture);
      expectCentred((await sunrises(picture)).slice(1));
      await expectAxisLabelsApart(picture);
    });
  });
}

test.describe("galaxy-s24 upright, areas high enough for two-line labels (REQ-723)", () => {
  // Galaxy S24 with Chrome's address bar (as in phone-devices.spec.ts): the labels keep value and unit below each
  // other, the maximum hangs below the sunrise row (REQ-602).
  test.use({
    isMobile: true,
    hasTouch: true,
    userAgent: devices["Galaxy S24"].userAgent,
    deviceScaleFactor: devices["Galaxy S24"].deviceScaleFactor,
    viewport: { width: 360, height: 700 },
  });
  ownDevice();

  test("the first sunrise time right of its line, covering no axis label", async ({
    page,
  }) => {
    await open(page);
    const areas = await axisLabelAreas(chart(page));
    expect(
      areas
        .flatMap((area) => area.labels)
        .filter((label) => label.testid === "axis-unit"),
    ).toEqual([]);
    // Two-line labels as well (REQ-738 of the core): the maximum of each area 1 px below its top edge (±1 px).
    for (const area of areas) {
      const max = leftExtremes(area).max!;
      expect(Math.abs(max.top - (area.top + 1)), `${area.id} maximum`).toBeLessThanOrEqual(1);
    }
    const { first } = await expectFirstSunriseClear(chart(page));
    expect(first.anchor).toBe("start");
    expect(
      first.left - first.line,
      "starts at its line",
    ).toBeGreaterThanOrEqual(-0.5);
    expectCentred((await sunrises(chart(page))).slice(1));
    await expectAxisLabelsApart(chart(page));
  });
});

test.describe("iphone-13 turned, full screen (REQ-723)", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_SAFARI,
    deviceScaleFactor: 3,
    viewport: devices["iPhone 13"].viewport,
  });
  ownDevice();

  test("the first sunrise time covers no axis label", async ({ page }) => {
    await open(page);
    await page.setViewportSize({ width: 844, height: 340 });
    await expect
      .poll(() =>
        page.evaluate((query) => matchMedia(query).matches, PHONE_LANDSCAPE),
      )
      .toBe(true);
    await expect(fullscreenChart(page)).toBeVisible();
    await expect(
      fullscreenChart(page).locator('[data-testid="sunrise"]').first(),
    ).toBeAttached();
    await frames(page);
    await expectFirstSunriseClear(fullscreenChart(page));
    await expectAxisLabelsApart(fullscreenChart(page));
  });
});

test.describe("desktop (REQ-723)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("the labels beside the plot: every sunrise time centred over its line, none over an axis label", async ({
    page,
  }) => {
    await open(page);
    await expectFirstSunriseClear(chart(page));
    expectCentred(await sunrises(chart(page)));
    await expectAxisLabelsApart(chart(page));
  });

  test("the copied picture: every sunrise time centred, none over an axis label", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: APP,
    });
    await open(page);
    await page
      .getByTestId("meteogram-card")
      .getByRole("button", { name: COPY })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Meteogram copied" }).first(),
    ).toBeVisible();
    const picture = await showPicture(page);
    await expectFirstSunriseClear(picture);
    expectCentred(await sunrises(picture));
    await expectAxisLabelsApart(picture);
  });
});

/**
 * Shows the chart of the last picture (its serialised SVG) in the page, so its texts can be measured as drawn;
 * returns its locator.
 */
async function showPicture(page: Page) {
  await page.evaluate(() => {
    const markup =
      (window as unknown as { __exportSvgs: string[] }).__exportSvgs.at(-1) ??
      "";
    const holder = document.createElement("div");
    holder.id = "picture-chart";
    holder.style.cssText =
      "position: absolute; left: 0; top: 0; z-index: 10000; background: white;";
    holder.innerHTML = markup;
    document.body.append(holder);
  });
  const picture = page.locator("#picture-chart > svg");
  await expect(
    picture.locator('[data-testid="sunrise"]').first(),
  ).toBeAttached();
  return picture;
}
