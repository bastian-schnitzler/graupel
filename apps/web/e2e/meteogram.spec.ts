// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Day slider and meteogram in a real browser with a fake Open-Meteo (REQ-436): the meteogram appears, dragging and
 * moving the marker changes the time axis, a double click resets it (REQ-640), the mouse wheel does not zoom. The slider
 * is a card of its own with the label "Horizon" above the meteogram card, which has no visible heading (REQ-499,
 * REQ-507); it fits its width without a scroll bar (REQ-446). On phones the slider is a compact strip with large grips (REQ-458),
 * without the period in words and without "All" (REQ-528), and neither it nor the meteogram is a card (REQ-529).
 */
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
const DAY_MS = 24 * 3_600_000;

// Days are local days; in UTC every day has 24 hours.
test.use({ timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function visibleRange(page: Page): Promise<[number, number]> {
  const svg = chart(page);
  const start = await svg.getAttribute("data-visible-start-time");
  const end = await svg.getAttribute("data-visible-end-time");
  return [Date.parse(start!), Date.parse(end!)];
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, right: box.x + box.width, left: box.x };
}

async function dragTo(page: Page, handle: Locator, x: number) {
  const from = await center(handle);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + x) / 2, from.y, { steps: 4 });
  await page.mouse.move(x, from.y, { steps: 4 });
  await page.mouse.up();
}

/**
 * Drags an edge grip so that the marker's edge moves to `x`: by the distance between the edge and `x`, since on phones
 * a grip follows the finger's travel rather than its place (REQ-558).
 */
async function dragEdgeTo(page: Page, handle: Locator, edge: "start" | "end", x: number) {
  const box = (await page.getByTestId("day-slider-marker").boundingBox())!;
  const from = await center(handle);
  await dragTo(page, handle, from.x + x - (edge === "start" ? box.x : box.x + box.width));
}

test("the slider changes the time axis of the meteogram", async ({ page, openMeteo }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("meteogram-attribution")).toHaveText("Weather data by Open-Meteo.com");
  expect(openMeteo.length).toBeGreaterThan(0);

  const cards = page.getByTestId("day-card");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(6);
  await expect(cards.nth(1)).toHaveAttribute("aria-current", "date");
  // No "All" (REQ-640): the marker over all days tells that the whole period is selected.
  await expect(page.getByRole("button", { name: "All" })).toHaveCount(0);
  const whole = page.getByTestId("day-slider-marker");
  await expect(whole).toHaveClass(/day-slider__marker--whole/);

  const [start, end] = await visibleRange(page);
  expect(start % DAY_MS).toBe(0);

  // End edge to the boundary after the third day: yesterday, today and tomorrow.
  await dragTo(page, page.getByTestId("day-slider-end"), (await center(cards.nth(2))).right + 2);
  await expect(whole).not.toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start, start + 3 * DAY_MS]);

  // Move the marker by three days.
  const from = await center(cards.nth(1));
  const to = await center(cards.nth(4));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => visibleRange(page)).toEqual([start + 3 * DAY_MS, start + 6 * DAY_MS]);

  // Start edge one day to the right.
  await dragTo(page, page.getByTestId("day-slider-start"), (await center(cards.nth(4))).left + 2);
  await expect.poll(() => visibleRange(page)).toEqual([start + 4 * DAY_MS, start + 6 * DAY_MS]);

  // No zoom with the mouse wheel.
  const svg = await center(chart(page));
  await page.mouse.move(svg.x, svg.y);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  expect(await visibleRange(page)).toEqual([start + 4 * DAY_MS, start + 6 * DAY_MS]);

  // A double click on the slider selects the whole period again (REQ-640).
  const day = await center(cards.nth(2));
  await page.mouse.dblclick(day.x, day.y);
  await expect(whole).toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start, end]);
});

test("phone width: the page does not scroll sideways and the handles work with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  const [start, end] = await visibleRange(page);
  const endHandle = page.getByRole("slider", { name: "End of the period" });
  await endHandle.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => visibleRange(page)).toEqual([start, start + DAY_MS]);
  // No "All" on phones (REQ-528): the end edge back to the last day.
  await page.keyboard.press("End");
  await expect.poll(() => visibleRange(page)).toEqual([start, end]);
});

for (const width of [375, 1280]) {
  test(`width ${width}px: the slider in its own card above the meteogram, without a scroll bar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();

    // The meteogram card has no visible heading, only its name (REQ-507); the slider is a card of its own above it
    // (REQ-499).
    const card = page.getByTestId("meteogram-card");
    await expect(card.getByRole("heading")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Meteogram" })).toHaveAttribute("data-testid", "meteogram-card");
    await expect(card.locator('[data-region="day-slider"]')).toHaveCount(0);
    await expect(card.locator('[data-region="meteogram"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Days" })).toHaveCount(0);
    const sliderCard = page.getByRole("region", { name: "Horizon" });
    await expect(sliderCard).toHaveAttribute("data-region", "day-slider");
    await expect(sliderCard.getByRole("heading")).toHaveCount(0);
    const slider = (await sliderCard.boundingBox())!;
    const meteogramBox = (await card.boundingBox())!;
    expect(meteogramBox.y).toBeGreaterThan(slider.y + slider.height);
    if (width === 375) {
      // The meteogram reaches over the page's side margins to the screen's edges (REQ-547), the slider stays inside.
      expect(Math.abs(meteogramBox.x)).toBeLessThan(1);
      expect(Math.abs(meteogramBox.width - width)).toBeLessThan(1);
      expect(slider.x).toBeGreaterThan(8);
    } else {
      expect(Math.abs(slider.x - meteogramBox.x)).toBeLessThan(1);
      expect(Math.abs(slider.width - meteogramBox.width)).toBeLessThan(1);
    }

    // The label "HORIZON" runs up the left edge, inside the card and left of the first day; none on phones (REQ-529).
    const label = page.getByTestId("day-slider-label");
    if (width < 600) await expect(label).toBeHidden();
    else {
    await expect(label).toHaveText("Horizon");
    expect(await label.evaluate((element) => getComputedStyle(element).textTransform)).toBe("uppercase");
    const labelBox = (await label.boundingBox())!;
    expect(labelBox.x).toBeGreaterThanOrEqual(slider.x);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual((await page.getByTestId("day-card").first().boundingBox())!.x + 0.5);
    // The whole word fits: not cut off at the top or bottom.
    expect(await label.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    }

    // No scroll bar: nothing in the slider is wider than its box, and every card lies inside the slider.
    const overflowing = await page.locator('[data-region="day-slider"]').evaluate((root) =>
      [root, ...root.querySelectorAll("*")]
        .filter((element) => element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0)
        .filter((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowX))
        .map((element) => element.className),
    );
    expect(overflowing).toEqual([]);
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(6);
    const left = (await cards.first().boundingBox())!;
    expect(left.x).toBeGreaterThanOrEqual(slider.x - 0.5);
    const last = (await cards.last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(slider.x + slider.width + 0.5);

    // No "All", on phones (REQ-528) nor on the desktop (REQ-640).
    await expect(page.getByTestId("day-slider-whole")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All" })).toHaveCount(0);
    if (width > 600) {
      // The last day ends the slider.
      const track = (await page.getByTestId("day-slider-track").boundingBox())!;
      expect(Math.abs(last.x + last.width - (track.x + track.width))).toBeLessThan(1);
    }

    // The labels fit their cards.
    const clipped = await cards.evaluateAll((elements) =>
      elements
        .flatMap((element) => [...element.querySelectorAll<HTMLElement>("span span")])
        .filter((span) => span.offsetParent !== null)
        .filter((span) => {
          const box = span.getBoundingClientRect();
          const parent = span.closest(".day-card")!.getBoundingClientRect();
          return box.left < parent.left - 0.5 || box.right > parent.right + 0.5;
        }).length,
    );
    expect(clipped).toBe(0);
  });
}

for (const width of [360, 375, 430]) {
  test(`width ${width}px: the slider is a readable strip with large grips (REQ-458)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(6);

    // Readable labels: at least 11 px, inside their cards.
    const sizes = await cards.evaluateAll((elements) =>
      elements.flatMap((element) =>
        [...element.querySelectorAll<HTMLElement>("span span")]
          .filter((span) => span.offsetParent !== null)
          .map((span) => parseFloat(getComputedStyle(span).fontSize)),
      ),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);

    // No selected period in words above the strip (REQ-528).
    await expect(page.getByTestId("day-slider-period")).toHaveCount(0);

    // Grips: visibly larger than before, with a touch area of at least 44 px across and down, below the cards.
    const firstCard = (await cards.first().boundingBox())!;
    for (const testId of ["day-slider-start", "day-slider-end"]) {
      const grip = page.getByTestId(testId);
      const box = (await grip.boundingBox())!;
      // Tabs below the strip (REQ-548): wide, flatter than the old round grips; the touch area stays 44 px.
      expect(box.width).toBeGreaterThanOrEqual(20);
      expect(box.height).toBeGreaterThanOrEqual(12);
      expect(box.y + box.height / 2).toBeGreaterThan(firstCard.y + firstCard.height);
      const hit = await grip.evaluate((element, viewport) => {
        const box = element.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        const hits = (x: number, y: number) =>
          x >= 0 && x < viewport && element.contains(document.elementFromPoint(x, y));
        const span = (dx: number, dy: number) => {
          let n = 0;
          for (let i = 1; i < 60 && hits(cx + dx * i, cy + dy * i); i++) n++;
          return n;
        };
        return { across: span(-1, 0) + span(1, 0) + 1, down: span(0, -1) + span(0, 1) + 1 };
      }, width);
      expect(hit.across).toBeGreaterThanOrEqual(44);
      expect(hit.down).toBeGreaterThanOrEqual(44);
    }

    // Touch drag on the end grip: the period ends after the third day.
    const [start] = await visibleRange(page);
    await dragEdgeTo(page, page.getByTestId("day-slider-end"), "end", (await center(cards.nth(2))).right + 1);
    await expect.poll(() => visibleRange(page)).toEqual([start, start + 3 * DAY_MS]);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

// REQ-485, REQ-640: a double click or double tap on a day selects all days.
test("desktop: a double click on a day card selects all days", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const cards = page.getByTestId("day-card");
  const whole = page.getByTestId("day-slider-marker");
  const [start, end] = await visibleRange(page);
  // The marker lies over the selected cards, so click where the card is, not on the element.
  const click = async (index: number, clickCount = 1) => {
    const { x, y } = await center(cards.nth(index));
    if (clickCount === 2) await page.mouse.dblclick(x, y);
    else await page.mouse.click(x, y);
  };

  // A single click selects one day; a later click on the same day keeps it.
  await click(3);
  await expect(whole).not.toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start + 3 * DAY_MS, start + 4 * DAY_MS]);
  await page.waitForTimeout(600);
  await click(3);
  await expect.poll(() => visibleRange(page)).toEqual([start + 3 * DAY_MS, start + 4 * DAY_MS]);

  // A double click on that day, and on a day while the whole period is shown, selects all days.
  await page.waitForTimeout(600);
  await click(3, 2);
  await expect(whole).toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start, end]);
  await page.waitForTimeout(600);
  await click(2, 2);
  await expect(whole).toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start, end]);

  // Dragging still works afterwards.
  await dragTo(page, page.getByTestId("day-slider-end"), (await center(cards.nth(2))).right + 2);
  await expect.poll(() => visibleRange(page)).toEqual([start, start + 3 * DAY_MS]);
});

// REQ-490: pressing on a day and dragging sideways marks the days in between.
test("desktop: dragging from a day to the right or left marks the days in between", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const cards = page.getByTestId("day-card");
  const marker = page.getByTestId("day-slider-marker");
  const whole = marker;
  const [start, end] = await visibleRange(page);
  const markDays = async (from: number, to: number, release = true) => {
    const a = await center(cards.nth(from));
    const b = await center(cards.nth(to));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
    await page.mouse.move(b.x, a.y, { steps: 4 });
    if (release) await page.mouse.up();
  };

  // From the whole period: day 2 to day 4, live while dragging, the meteogram follows on release.
  await markDays(1, 3, false);
  await expect(marker).toHaveAttribute("data-start", "1");
  await expect(marker).toHaveAttribute("data-end", "3");
  expect(await visibleRange(page)).toEqual([start, end]);
  await page.mouse.up();
  await expect.poll(() => visibleRange(page)).toEqual([start + DAY_MS, start + 4 * DAY_MS]);
  await expect(whole).not.toHaveClass(/day-slider__marker--whole/);

  // From an unselected day to the left.
  await page.waitForTimeout(600);
  await markDays(5, 4);
  await expect.poll(() => visibleRange(page)).toEqual([start + 4 * DAY_MS, start + 6 * DAY_MS]);

  // A click still selects one day, a double click all days.
  await page.waitForTimeout(600);
  const { x, y } = await center(cards.nth(2));
  await page.mouse.click(x, y);
  await expect.poll(() => visibleRange(page)).toEqual([start + 2 * DAY_MS, start + 3 * DAY_MS]);
  // From the one selected day to the left.
  await page.waitForTimeout(600);
  await markDays(2, 0);
  await expect.poll(() => visibleRange(page)).toEqual([start, start + 3 * DAY_MS]);
  // The marker over several days still moves.
  await dragTo(page, page.getByTestId("day-slider-body"), (await center(cards.nth(3))).x);
  await expect.poll(() => visibleRange(page)).toEqual([start + 2 * DAY_MS, start + 5 * DAY_MS]);
  await page.waitForTimeout(600);
  await page.mouse.dblclick(x, y);
  await expect(whole).toHaveClass(/day-slider__marker--whole/);
  await expect.poll(() => visibleRange(page)).toEqual([start, end]);
});

test.describe("phone touch", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("two quick taps on a day select all days, one tap selects the day", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    // The marker over all days tells whether all days are selected.
    const whole = page.getByTestId("day-slider-marker");
    const [start, end] = await visibleRange(page);

    const tap = async (index: number) => {
      const { x, y } = await center(cards.nth(index));
      await page.touchscreen.tap(x, y);
    };

    await tap(4);
    await expect.poll(() => visibleRange(page)).toEqual([start + 4 * DAY_MS, start + 5 * DAY_MS]);
    await expect(whole).not.toHaveClass(/day-slider__marker--whole/);

    await page.waitForTimeout(600);
    await tap(2);
    await tap(2);
    await expect(whole).toHaveClass(/day-slider__marker--whole/);
    await expect.poll(() => visibleRange(page)).toEqual([start, end]);

    // Slow taps each select the day.
    await tap(1);
    await page.waitForTimeout(600);
    await tap(1);
    await expect.poll(() => visibleRange(page)).toEqual([start + DAY_MS, start + 2 * DAY_MS]);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  // REQ-490: a sideways touch drag from a day marks the days in between; a vertical one scrolls the page.
  test("dragging sideways from a day marks the days in between", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const marker = page.getByTestId("day-slider-marker");
    const [start] = await visibleRange(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }],
      });
    const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }, release = true) => {
      await touch("touchStart", from.x, from.y);
      for (let i = 1; i <= 8; i++) {
        await touch("touchMove", from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
      }
      if (release) await touch("touchEnd", to.x, to.y);
    };

    // To the right from the whole period, live while the finger is down.
    await swipe(await center(cards.nth(1)), await center(cards.nth(4)), false);
    await expect(marker).toHaveAttribute("data-start", "1");
    await expect(marker).toHaveAttribute("data-end", "4");
    await touch("touchEnd", 0, 0);
    await expect.poll(() => visibleRange(page)).toEqual([start + DAY_MS, start + 5 * DAY_MS]);

    // To the left from an unselected day.
    const from = await center(cards.nth(6));
    await swipe(from, { x: (await center(cards.nth(5))).x, y: from.y });
    await expect.poll(() => visibleRange(page)).toEqual([start + 5 * DAY_MS, start + 7 * DAY_MS]);

    // The page may still scroll up and down over the days; a vertical swipe leaves the selection alone.
    expect(await cards.nth(2).evaluate((element) => getComputedStyle(element).touchAction)).toBe("pan-y pinch-zoom");
    const card = await center(cards.nth(2));
    await swipe(card, { x: card.x, y: card.y - 200 });
    await expect(marker).toHaveAttribute("data-start", "5");
    await expect(marker).toHaveAttribute("data-end", "6");
  });
});

// REQ-464: the footer row of the meteogram has three parts: place and time, the domain, the attribution.
test("the meteogram footer shows the domain between place and attribution", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { domain: "graupel.eu" } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const row = page.locator('[data-region="meteogram"]').getByTestId("meteogram-footer-row");
  const location = row.getByTestId("meteogram-footer-location");
  const domain = row.getByTestId("meteogram-footer-center");
  const attribution = row.getByTestId("meteogram-attribution");
  await expect(domain).toHaveText("graupel.eu");
  const [l, d, a, r] = await Promise.all([location, domain, attribution, row].map((item) => item.boundingBox()));
  // In this order, without overlap, the domain in the middle of the row.
  expect(l!.x + l!.width).toBeLessThanOrEqual(d!.x);
  expect(d!.x + d!.width).toBeLessThanOrEqual(a!.x);
  expect(Math.abs(d!.x + d!.width / 2 - (r!.x + r!.width / 2))).toBeLessThan(2);

  // On a phone the row keeps the chart's minimum width, so all three parts fit side by side.
  await page.setViewportSize({ width: 375, height: 812 });
  const [l2, d2, a2] = await Promise.all([location, domain, attribution].map((item) => item.boundingBox()));
  expect(l2!.x + l2!.width).toBeLessThanOrEqual(d2!.x);
  expect(d2!.x + d2!.width).toBeLessThanOrEqual(a2!.x);
  expect(Math.abs(d2!.y - a2!.y)).toBeLessThan(2);
});

test("without a domain in the configuration the footer shows none on localhost", async ({ page, deviceClass }) => {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  // The source in the card's footer on the desktop, in the page's footer row in the phone's design (REQ-729).
  await expect(page.getByTestId(deviceClass === "desktop" ? "meteogram-attribution" : "meteogram-source")).toBeVisible();
  await expect(page.getByTestId("meteogram-footer-center")).toHaveCount(0);
});

for (const width of [1280, 360]) {
  test(`today's bar stays on top of the marker when today is selected, ${width} px (REQ-502)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const today = page.locator('[data-testid="day-card"][aria-current="date"]');
    await today.focus();
    await page.keyboard.press("Enter");
    await expect(today).toHaveAttribute("aria-pressed", "true");
    const card = (await today.boundingBox())!;
    if (width < 600) {
      // Phones (REQ-548, REQ-559): no bar; today's date inside the filled selection keeps today's colour, no underline.
      await expect(page.getByTestId("day-slider-today-bar")).toBeHidden();
      const date = today.locator(".day-card__date");
      const style = await date.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--color-today)";
        document.body.append(probe);
        const todayColor = getComputedStyle(probe).color;
        probe.remove();
        return { color: getComputedStyle(element).color, todayColor, line: getComputedStyle(element).textDecorationLine };
      });
      expect(style.color).toBe(style.todayColor);
      expect(style.line).not.toContain("underline");
      return;
    }
    // Today's bar lies over the top edge of its card, where the marker's frame runs, and is stacked above the frame.
    const bar = page.getByTestId("day-slider-today-bar");
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(Math.abs(box.y - card.y)).toBeLessThan(1);
    expect(Math.abs(box.x - card.x)).toBeLessThan(1);
    expect(box.height).toBeGreaterThanOrEqual(3);
    const marker = (await page.getByTestId("day-slider-marker").boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(marker.y);
    const zIndex = (locator: Locator) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex));
    expect(await zIndex(bar)).toBeGreaterThan(await zIndex(page.getByTestId("day-slider-marker")));
  });
}

const background = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).backgroundColor);
const TRANSPARENT = "rgba(0, 0, 0, 0)";

for (const width of [1280, 360]) {
  test(`dates without a badge except today's, ${width} px (REQ-505)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const dates = page.locator('[data-testid="day-card"]:not([aria-current="date"]) .day-card__date');
    expect(await dates.count()).toBeGreaterThanOrEqual(5);
    for (const color of await dates.evaluateAll((elements) => elements.map((e) => getComputedStyle(e).backgroundColor))) {
      expect(color).toBe(TRANSPARENT);
    }
    const today = page.locator('[data-testid="day-card"][aria-current="date"] .day-card__date');
    if (width < 600) {
      // Phones (REQ-548, REQ-559): today's date without a badge; inside the selection (all days at the start) in its
      // own colour, unlike the other dates, and without an underline.
      expect(await background(today)).toBe(TRANSPARENT);
      const look = (locator: Locator) =>
        locator.evaluate((element) => [getComputedStyle(element).color, getComputedStyle(element).textDecorationLine]);
      const [todayColor, todayLine] = await look(today);
      const [otherColor] = await look(dates.first());
      expect(todayColor).not.toBe(otherColor);
      expect(todayLine).not.toContain("underline");
      return;
    }
    // Today's date keeps its orange badge.
    expect(await background(today)).not.toBe(TRANSPARENT);
  });

  test(`over all days the marker frames all days, without "All", ${width} px (REQ-506, REQ-640)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    const marker = page.getByTestId("day-slider-marker");
    const endGrip = page.getByTestId("day-slider-end");
    const [start, end] = await visibleRange(page);

    /** Checks the look over all days: the marker over all days up to the last one's edge; no "All" (REQ-640). */
    const expectAll = async () => {
      await page.mouse.move(0, 0);
      await expect(marker).toHaveClass(/day-slider__marker--whole/);
      await expect(marker).toHaveAttribute("data-end", String(count - 1));
      await expect(page.getByTestId("day-slider-whole")).toHaveCount(0);
      const box = (await marker.boundingBox())!;
      const last = (await cards.last().boundingBox())!;
      expect(Math.abs(box.x + box.width - (last.x + last.width))).toBeLessThan(2);
    };
    /** Checks the look over fewer days: the marker over the days only. */
    const expectDays = async () => {
      await page.mouse.move(0, 0);
      await expect(marker).not.toHaveClass(/day-slider__marker--whole/);
      if (width < 600) return;
      const box = (await marker.boundingBox())!;
      const last = (await cards.last().boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(last.x + 1);
    };

    // At the start all days are selected.
    await expectAll();

    // Back from the last day with the end grip: fewer days, the marker over the days only.
    await dragEdgeTo(page, endGrip, "end", (await center(cards.nth(count - 3))).right + 2);
    await expect(marker).toHaveAttribute("data-end", String(count - 3));
    await expect.poll(() => visibleRange(page)).not.toEqual([start, end]);
    await expectDays();

    // A double click on a day selects all days again (REQ-485, REQ-640).
    await page.waitForTimeout(600);
    const day = await center(cards.nth(1));
    await page.mouse.dblclick(day.x, day.y);
    await expectAll();
    await expect.poll(() => visibleRange(page)).toEqual([start, end]);

    // One day with the keyboard, then all days by moving the end edge with the keyboard.
    const first = cards.first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(marker).toHaveAttribute("data-end", "0");
    await expectDays();
    await endGrip.focus();
    await page.keyboard.press("End");
    await expect(marker).toHaveAttribute("data-start", "0");
    await expectAll();

    // Marking all days by dragging over them.
    await first.focus();
    await page.keyboard.press("Enter");
    await expectDays();
    await page.waitForTimeout(600);
    const a = await center(cards.first());
    const b = await center(cards.last());
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
    await page.mouse.move(b.x, a.y, { steps: 4 });
    await page.mouse.up();
    await expectAll();
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the selection is grey, not the accent blue, in ${colorScheme} mode (REQ-513)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const accent = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-accent)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    /** Whether a colour like "rgb(140, 148, 158)" is a grey: its channels differ by little. */
    const isGrey = (color: string) => {
      const [r, g, b] = color.match(/\d+(\.\d+)?/g)!.map(Number);
      return Math.max(r!, g!, b!) - Math.min(r!, g!, b!) <= 24;
    };
    const style = (testId: string, property: string) =>
      page.getByTestId(testId).evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

    // A few days selected, today not among them.
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    await cards.nth(count - 1).focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("day-slider-start").focus();
    await page.keyboard.press("ArrowLeft");
    await page.mouse.move(0, 0);
    const colors = [
      await style("day-slider-marker", "border-top-color"),
      await style("day-slider-start", "background-color"),
      await style("day-slider-end", "background-color"),
      await cards.nth(count - 1).evaluate((element) => getComputedStyle(element).borderTopColor),
    ];
    await expect
      .poll(async () => isGrey(await cards.nth(count - 1).evaluate((element) => getComputedStyle(element).backgroundColor)))
      .toBe(true);
    for (const color of colors) {
      expect(color).not.toBe(accent);
      expect(isGrey(color), color).toBe(true);
    }
    // Today's bar stays orange.
    const today = page.locator('[data-testid="day-card"][aria-current="date"]');
    expect(isGrey(await today.evaluate((element) => getComputedStyle(element).borderTopColor))).toBe(false);
  });
}

// REQ-520: the cards switch from long to short labels where the long labels of the page's language stop fitting.
// At a fixed time: how many days the slider shows depends on the hour (at night yesterday is gone, 16 instead of 17
// days, wider cards), and with wider cards the long English labels fit down to 600 px (REQ-666).
const SWITCH_NOW = Date.UTC(2026, 10, 3, 12);
test("the switch to short day labels depends on the language", async ({ page }) => {
  test.setTimeout(240_000);
  await page.clock.setFixedTime(SWITCH_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: SWITCH_NOW }));
  const track = page.getByTestId("day-slider-track");
  const switchWidth: Record<string, number> = {};
  const modes: Record<string, Map<number, string>> = {};
  const widths = Array.from({ length: 81 }, (_, index) => 1240 - index * 8);
  for (const language of ["de", "fr", "en"]) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(APP);
    await page.evaluate((value) => window.localStorage.setItem("graupel.language", value), language);
    await page.reload();
    await expect(chart(page)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    // Wide enough for the long labels in every language.
    await expect(track).toHaveAttribute("data-labels", "long");
    modes[language] = new Map();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await track.evaluate((element) => {
        const cards = [...element.querySelectorAll<HTMLElement>("[data-day]")];
        const fits = cards.every((card) => {
          const style = getComputedStyle(card);
          const right = card.getBoundingClientRect().right - parseFloat(style.paddingRight);
          const left = card.getBoundingClientRect().left + parseFloat(style.paddingLeft);
          return [...card.querySelectorAll<HTMLElement>("span span")]
            .filter((span) => span.offsetParent !== null)
            .every((span) => span.getBoundingClientRect().left >= left - 0.5 && span.getBoundingClientRect().right <= right + 0.5);
        });
        const weekday = parseFloat(getComputedStyle(cards[0]!.querySelector(".day-card__weekday")!).fontSize);
        const full = parseFloat(getComputedStyle(document.querySelector(".day-slider__measure-weekday")!).fontSize);
        return { mode: element.dataset.labels!, fits, weekday, full };
      });
      modes[language].set(width, state.mode);
      // Long labels fit their cards, the weekday at its full size.
      if (state.mode === "long") {
        expect(state.fits, `${language} ${width}`).toBe(true);
        expect(state.weekday).toBeGreaterThanOrEqual(state.full - 0.1);
      }
      if (state.mode === "short" && switchWidth[language] === undefined) switchWidth[language] = width;
    }
    expect(switchWidth[language], language).toBeDefined();
  }
  // Each language switches once, at its own width. Without the weekday's dot (REQ-667, "mar" instead of "mar.") the
  // date sets the switch: German "03.11." needs more room than French "03/11". Between the two widths the language that
  // switches at the larger width already has short labels while the other still has long ones.
  expect(switchWidth.de).not.toBe(switchWidth.fr);
  const [earlier, later] = switchWidth.de! > switchWidth.fr! ? (["de", "fr"] as const) : (["fr", "de"] as const);
  const between = widths.filter((width) => modes[earlier]!.get(width) === "short" && modes[later]!.get(width) === "long");
  expect(between.length).toBeGreaterThan(0);
  // Below its switch the slider keeps the short labels, down to the phone layout (REQ-458), whose cards have more room
  // of their own (no column for "All", no padding, smaller fonts) and measure again.
  for (const language of ["de", "fr", "en"]) {
    const below = widths.filter((width) => width <= switchWidth[language]! && width >= 700);
    expect(below.length).toBeGreaterThan(0);
    expect(below.every((width) => modes[language]!.get(width) === "short"), language).toBe(true);
  }
});

// REQ-548: on phones each day shows its weekday's abbreviation over the day of the month, both centred; the selected
// days are one filled area in the accent colour and the grips are tabs in that colour below the strip.
for (const width of [360, 390]) {
  test(`phone ${width} px: centred day labels, filled selection, tabs below the strip (REQ-548)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");

    // Weekday and day of the month centred in every column, to half a pixel; the day as a plain number.
    const offsets = await cards.evaluateAll((elements) =>
      elements.flatMap((card) => {
        const box = card.getBoundingClientRect();
        const middle = (box.left + box.right) / 2;
        return [...card.querySelectorAll<HTMLElement>("span span")]
          .filter((span) => span.offsetParent !== null)
          .map((span) => {
            const text = span.getBoundingClientRect();
            return Math.abs((text.left + text.right) / 2 - middle);
          });
      }),
    );
    expect(offsets.length).toBe((await cards.count()) * 2);
    expect(Math.max(...offsets)).toBeLessThan(0.5);
    const dates = await cards.evaluateAll((elements) =>
      elements.map((card) => [...card.querySelectorAll<HTMLElement>(".day-card__date span")].find((span) => span.offsetParent !== null)!.textContent),
    );
    for (const date of dates) expect(date).toMatch(/^\d{1,2}$/);

    // Three days from the second one: filled in the accent colour, the ends rounded, the others not filled.
    await cards.nth(1).focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("day-slider-end").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.mouse.move(0, 0);
    const accent = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-accent)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    const fill = (index: number) => cards.nth(index).evaluate((element) => getComputedStyle(element).backgroundColor);
    for (const index of [1, 2, 3]) await expect.poll(() => fill(index)).toBe(accent);
    expect(await fill(0)).not.toBe(accent);
    expect(await fill(4)).not.toBe(accent);
    const radius = (index: number, corner: "borderTopLeftRadius" | "borderTopRightRadius") =>
      cards.nth(index).evaluate((element, name) => parseFloat(getComputedStyle(element)[name]), corner);
    expect(await radius(1, "borderTopLeftRadius")).toBeGreaterThan(0);
    expect(await radius(2, "borderTopLeftRadius")).toBe(0);
    expect(await radius(3, "borderTopRightRadius")).toBeGreaterThan(0);

    // The grips: tabs in the accent colour right below the strip, at the selection's start and end.
    const strip = (await cards.first().boundingBox())!;
    const first = (await cards.nth(1).boundingBox())!;
    const last = (await cards.nth(3).boundingBox())!;
    for (const [testId, edge] of [["day-slider-start", first.x], ["day-slider-end", last.x + last.width]] as const) {
      const grip = page.getByTestId(testId);
      const box = (await grip.boundingBox())!;
      expect(await grip.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(accent);
      expect(box.y).toBeGreaterThanOrEqual(strip.y + strip.height);
      expect(box.y).toBeLessThan(strip.y + strip.height + 8);
      // Inside the selection, the outer side flush with its edge (REQ-555).
      const outer = testId === "day-slider-start" ? box.x : box.x + box.width;
      expect(Math.abs(outer - edge)).toBeLessThan(1);
    }
  });
}

// REQ-558: on phones an edge follows the finger's travel and moves on after a third of a day; dragged outwards into the
// outer half of the last day it snaps there, so the end needs no reach to the screen's edge.
for (const width of [360, 390]) {
  test(`phone ${width} px: the end grip reaches the last day with a short way (REQ-558)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const count = await cards.count();
    const marker = page.getByTestId("day-slider-marker");
    const end = page.getByTestId("day-slider-end");
    // Days 2 to count - 5.
    await cards.nth(2).focus();
    await page.keyboard.press("Enter");
    await end.focus();
    for (let i = 0; i < count - 7; i++) await page.keyboard.press("ArrowRight");
    await expect(marker).toHaveAttribute("data-end", String(count - 5));
    const day = (await cards.first().boundingBox())!.width;

    // Wherever the grip is taken, 0.4 days of travel move the end on by one day.
    const grip = (await end.boundingBox())!;
    await dragTo(page, end, grip.x + grip.width / 2 + 0.4 * day);
    await expect(marker).toHaveAttribute("data-end", String(count - 4));
    const grip2 = (await end.boundingBox())!;
    await page.mouse.move(grip2.x + 2, grip2.y + grip2.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip2.x + 2 + 0.4 * day, grip2.y + grip2.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(marker).toHaveAttribute("data-end", String(count - 3));

    // Into the outer half of the last day, well short of the screen's edge: the end snaps to the last day.
    const last = (await cards.last().boundingBox())!;
    await dragTo(page, end, last.x + last.width * 0.55);
    await expect(marker).toHaveAttribute("data-end", String(count - 1));
    expect(last.x + last.width * 0.55).toBeLessThan(width - 16);
  });
}

// REQ-559, REQ-642: on phones and on the desktop today's label in the meteogram's day header has today's colour from
// the day slider, also on the whole screen; the copied image draws its own markup without the page's style.
for (const width of [390, 1280]) {
  test(`today's day label in the meteogram, ${width} px (REQ-559, REQ-642)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const labels = page.locator('[data-region="meteogram"] text.day-label-text');
    await expect(labels.first()).toBeAttached();
    const fills = await labels.evaluateAll((elements) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-today)";
      document.body.append(probe);
      const today = getComputedStyle(probe).color;
      probe.remove();
      return { today, fills: elements.map((element) => getComputedStyle(element).fill) };
    });
    const golden = fills.fills.filter((fill) => fill === fills.today);
    await expect(page.getByTestId("meteogram-today-style")).toBeAttached();
    expect(golden).toHaveLength(1);
    expect(fills.fills.length).toBeGreaterThan(1);
    if (width >= 600) {
      // On the whole screen as well (desktop: a double click opens it).
      await chart(page).dblclick();
      const full = page.locator('[data-testid="meteogram-fullscreen"] text.day-label-text');
      await expect(full.first()).toBeAttached();
      const fullFills = await full.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fill));
      expect(fullFills.filter((fill) => fill === fills.today)).toHaveLength(1);
    }
  });
}

// REQ-564: a double tap or double click anywhere on the day slider selects all days, on the grips and the border too.
test.describe("double tap anywhere on the day slider (REQ-564)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("phone: a double tap on a grip or on the strip's border selects all days", async ({ page }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const marker = page.getByTestId("day-slider-marker");
    const count = await cards.count();
    const pick = async () => {
      await cards.nth(3).focus();
      await page.keyboard.press("Enter");
      await page.getByTestId("day-slider-end").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(marker).toHaveAttribute("data-end", "5");
      await page.waitForTimeout(500);
    };
    const doubleTap = async (x: number, y: number) => {
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(100);
      await page.touchscreen.tap(x, y);
    };

    for (const testId of ["day-slider-end", "day-slider-start"]) {
      await pick();
      const grip = await center(page.getByTestId(testId));
      await doubleTap(grip.x, grip.y);
      await expect(marker).toHaveAttribute("data-start", "0");
      await expect(marker).toHaveAttribute("data-end", String(count - 1));
    }

    // Below the strip, beside the grips.
    await pick();
    const strip = (await page.getByTestId("day-slider-track").boundingBox())!;
    const last = (await cards.nth(10).boundingBox())!;
    await doubleTap(last.x + last.width / 2, last.y + last.height + 8);
    expect(strip.y + strip.height).toBeGreaterThan(last.y + last.height + 8);
    await expect(marker).toHaveAttribute("data-end", String(count - 1));

    // One tap on a grip selects nothing new.
    await pick();
    const grip = await center(page.getByTestId("day-slider-end"));
    await page.touchscreen.tap(grip.x, grip.y);
    await page.waitForTimeout(600);
    await expect(marker).toHaveAttribute("data-end", "5");
    await expect(marker).toHaveAttribute("data-start", "3");
  });
});

test("desktop: a double click on a grip selects all days (REQ-564)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const cards = page.getByTestId("day-card");
  const marker = page.getByTestId("day-slider-marker");
  await cards.nth(3).focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("day-slider-end").focus();
  await page.keyboard.press("ArrowRight");
  await expect(marker).toHaveAttribute("data-end", "4");
  await page.waitForTimeout(500);
  const grip = await center(page.getByTestId("day-slider-end"));
  await page.mouse.dblclick(grip.x, grip.y);
  await expect(marker).toHaveAttribute("data-start", "0");
  await expect(marker).toHaveAttribute("data-end", String((await cards.count()) - 1));
});

/** Background of each day card and the colours of its weekday and date (REQ-598). */
const dayColours = (page: Page) =>
  page.getByTestId("day-card").evaluateAll((cards) =>
    cards.map((card) => {
      const colour = (selector: string) => getComputedStyle(card.querySelector(selector)!).color;
      return {
        background: getComputedStyle(card).backgroundColor,
        weekday: colour(".day-card__weekday"),
        date: colour(".day-card__date"),
      };
    }),
  );

/** The day cards' colours over the whole period chosen with a double click on the first day (REQ-485, REQ-640). */
async function wholePeriodColours(page: Page) {
  await page.getByTestId("day-card").first().dispatchEvent("dblclick");
  await expect(page.getByTestId("day-slider-marker")).toHaveAttribute("data-start", "0");
  // After the cards' background transition.
  await page.waitForTimeout(500);
  return dayColours(page);
}

// REQ-598: after a double tap no day of the filled strip is white. iOS Safari keeps a tapped card under :hover, and the
// hover look of the phone's strip outranked the selection's fill: white background, white label.
test.describe("double tap leaves no white day (REQ-598)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("phone: after a tap and a double tap on a day or between days every day looks like after 'All'", async ({
    page,
  }) => {
    await page.goto(APP);
    await expect(chart(page)).toBeVisible();
    const cards = page.getByTestId("day-card");
    const marker = page.getByTestId("day-slider-marker");
    const count = await cards.count();
    const whole = await wholePeriodColours(page);
    expect(whole).toHaveLength(count);
    // Every day filled alike, its label in another colour than the fill.
    expect(new Set(whole.map((day) => day.background))).toEqual(new Set([whole[0]!.background]));
    expect(whole[0]!.background).not.toBe("rgba(0, 0, 0, 0)");
    for (const day of whole) {
      expect(day.weekday).not.toBe(day.background);
      expect(day.date).not.toBe(day.background);
    }

    // iOS keeps the tapped card under :hover; the emulated touch screen cannot hover, as on an iPhone.
    expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const stickHover = async (index: number) => {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `[data-testid="day-card"][data-day="${index}"]`,
      });
      await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
    };
    const box = async (index: number) => (await cards.nth(index).boundingBox())!;
    const tapDay = async (index: number) => {
      const card = await box(index);
      await page.touchscreen.tap(card.x + card.width / 2, card.y + card.height / 2);
    };
    const doubleTap = async (x: number, y: number) => {
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(100);
      await page.touchscreen.tap(x, y);
    };

    // One tap selects a day, which looks like the same day over the whole period; also a day the tap leaves under
    // :hover (one beside the marker, as on iOS).
    await tapDay(3);
    await expect(marker).toHaveAttribute("data-end", "3");
    await expect.poll(async () => (await dayColours(page))[3]).toEqual(whole[3]);
    await page.waitForTimeout(500);
    await tapDay(6);
    await expect(marker).toHaveAttribute("data-start", "6");
    await expect.poll(async () => (await dayColours(page))[6]).toEqual(whole[6]);

    // A double tap on a day, which keeps :hover like on iOS.
    await page.waitForTimeout(500);
    await stickHover(8);
    const eight = await box(8);
    await doubleTap(eight.x + eight.width / 2, eight.y + eight.height / 2);
    await expect(marker).toHaveAttribute("data-start", "0");
    await expect(marker).toHaveAttribute("data-end", String(count - 1));
    await expect.poll(() => dayColours(page)).toEqual(whole);

    // A double tap on the border between two days; both keep :hover.
    await tapDay(3);
    await expect(marker).toHaveAttribute("data-end", "3");
    await page.waitForTimeout(500);
    await stickHover(10);
    await stickHover(11);
    const ten = await box(10);
    await doubleTap(ten.x + ten.width, ten.y + ten.height / 2);
    await expect(marker).toHaveAttribute("data-start", "0");
    await expect(marker).toHaveAttribute("data-end", String(count - 1));
    await expect.poll(() => dayColours(page)).toEqual(whole);
  });
});

test("desktop: a double click on a day selects all days, no day white; a day lights up under the mouse (REQ-598)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  const cards = page.getByTestId("day-card");
  const marker = page.getByTestId("day-slider-marker");
  const count = await cards.count();
  const whole = await wholePeriodColours(page);

  const three = await center(cards.nth(3));
  await page.mouse.click(three.x, three.y);
  await expect(marker).toHaveAttribute("data-end", "3");
  // A day beside the selection lights up under the mouse like a selected one.
  const six = await center(cards.nth(6));
  await page.mouse.move(six.x, six.y);
  await expect.poll(async () => (await dayColours(page))[6]!.background).toBe(whole[6]!.background);

  await page.waitForTimeout(500);
  await page.mouse.dblclick(six.x, six.y);
  await expect(marker).toHaveAttribute("data-start", "0");
  await expect(marker).toHaveAttribute("data-end", String(count - 1));
  await expect.poll(() => dayColours(page)).toEqual(whole);
});

/**
 * Fixed time for REQ-565: Wednesday, 28 October 2026, 11:00 UTC, so the test does not depend on the day it runs. German
 * "Mi" is among the widest two letters and fits its column at 360 px; wide pairs such as "Mo" may stick out by up to
 * about 1 px (REQ-627, parked).
 */
const WEEKDAY_NOW = Date.UTC(2026, 9, 28, 11);

// REQ-565: on phones today's weekday, at most two letters, is as large as the date and stays inside its column.
for (const width of [360, 390]) {
  test(`phone ${width} px: today's weekday as large as the date (REQ-565)`, async ({ page }) => {
    await page.clock.setFixedTime(WEEKDAY_NOW);
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: WEEKDAY_NOW }));
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await page.evaluate(() => window.localStorage.setItem("graupel.language", "de"));
    await page.reload();
    await expect(chart(page)).toBeVisible();
    const size = (locator: Locator) => locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const today = page.locator('[data-testid="day-card"][aria-current="date"]');
    const weekday = today.locator(".day-card__weekday");
    expect(await size(weekday)).toBe(await size(today.locator(".day-card__date")));
    const other = page.locator('[data-testid="day-card"]:not([aria-current="date"])').first();
    expect(await size(other.locator(".day-card__weekday"))).toBeLessThan(await size(other.locator(".day-card__date")));
    // Inside its column.
    const column = (await today.boundingBox())!;
    const text = await weekday.evaluate((element) => {
      const span = [...element.querySelectorAll<HTMLElement>("span")].find((item) => item.offsetParent !== null)!;
      const box = span.getBoundingClientRect();
      return { left: box.left, right: box.right };
    });
    expect(text.left).toBeGreaterThanOrEqual(column.x - 0.5);
    expect(text.right).toBeLessThanOrEqual(column.x + column.width + 0.5);
  });
}
