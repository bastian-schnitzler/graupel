// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The close button of the tablet's full-screen view (REQ-750): no column of its own beside the chart, which reaches the
 * screen's right edge. With model headers the X stands inside the box of the last (rightmost) model header, in its
 * right corner; without them it stands in the row below the chart, left of the place name with a small gap. A place
 * name too long for the row ends in "…" (`text-overflow: ellipsis`) and nothing in the row overlaps. The button has the
 * focus and closes the view, as Escape does. Where the X would overlap the header's heading in that corner (the model's
 * name with its run, and its info button), as in a short last header, it stands 1 px from the screen's right edge
 * instead (REQ-754); in a wide header it stays in the corner.
 *
 * Tablet upright and turned: only the tablet's view has a close button; a phone's has none (REQ-537), only turning it
 * back closes it, and its chart already reaches the right edge (REQ-553).
 */
import { expect, onlyIn, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 9);
const LONG_NAME = "Sehr langer Ortsname am Rand des Gletschers über dem Tal mit noch mehr Text dahinter";

onlyIn("tablet", "only the tablet's full-screen view has a close button; a phone's has none (REQ-537)");

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const dialog = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const close = (page: Page) => dialog(page).getByRole("button", { name: "Close" });

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Opens the page, `modelHeaders` the own choice in the settings, and its full-screen view by the footer's button;
 * `lastDayEarlier` days fewer at the end of the day slider's selection before (by its end grip's arrow key).
 */
async function openView(page: Page, modelHeaders: boolean, lastDayEarlier = 0) {
  await page.addInitScript((value) => window.localStorage.setItem("graupel.modelHeaders", value), String(modelHeaders));
  await page.goto(APP);
  await expect(page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated")).toBeVisible();
  if (lastDayEarlier) {
    const end = page.getByTestId("day-slider-end");
    const last = Number(await end.getAttribute("aria-valuenow"));
    await end.focus();
    for (let i = 0; i < lastDayEarlier; i++) await end.press("ArrowLeft");
    await expect(end).toHaveAttribute("aria-valuenow", String(last - lastDayEarlier));
  }
  await page.getByTestId("footer-slot").getByTestId("meteogram-fullscreen-open").tap();
  await expect(dialog(page).locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
  await expect(dialog(page).getByTestId("fullscreen-close")).toHaveAttribute(
    "data-place",
    modelHeaders ? "header" : "footer",
  );
}

/** The view as it stands: the X, the chart, the header boxes and the parts of the row below the chart. */
function measure(page: Page) {
  return dialog(page).evaluate((view) => {
    const rect = (element: Element | null): Rect | null => {
      if (!element) return null;
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    const location = view.querySelector<HTMLElement>('[data-testid="meteogram-footer-location"]')!;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      close: rect(view.querySelector(".fullscreen-close button"))!,
      chart: rect(view.querySelector("svg.meteogram-svg-integrated"))!,
      tools: view.querySelectorAll(".dialog__tools").length,
      headers: [...view.querySelectorAll('[data-testid="model-header-shape"]')].map((shape) => rect(shape)!),
      // The model's name in each header (same order), as the core draws it, and the info buttons over the headers.
      labels: [...view.querySelectorAll('[data-testid="model-label-segment"]')].map(
        (segment) => rect(segment.querySelector('[data-testid="model-header-label"]'))!,
      ),
      infos: [...view.querySelectorAll('[data-testid="model-header-info-button"]')].map((button) => rect(button)!),
      atEdge: view.querySelector('[data-testid="fullscreen-close"]')?.getAttribute("data-at-edge") ?? null,
      location: rect(location)!,
      center: rect(view.querySelector('[data-testid="meteogram-footer-center"]')),
      attribution: rect(view.querySelector('[data-testid="meteogram-attribution"]')),
      textOverflow: getComputedStyle(location).textOverflow,
      cut: location.scrollWidth > location.clientWidth,
      focused: document.activeElement?.getAttribute("aria-label") ?? null,
    };
  });
}

/** Positions settle after the chart drew itself and the button was placed: measured until two in a row agree. */
async function settled(page: Page) {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await measure(page));
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return measure(page);
}

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

type View = Awaited<ReturnType<typeof measure>>;

/** The last (rightmost) header and its heading: the model's name and the info buttons standing in the header. */
function lastHeading(view: View) {
  const index = view.headers.reduce((best, header, i) => (header.right > view.headers[best]!.right ? i : best), 0);
  const last = view.headers[index]!;
  const inside = (box: Rect) => {
    const x = (box.left + box.right) / 2;
    return x >= last.left && x <= last.right;
  };
  const parts = [view.labels[index]!, ...view.infos.filter(inside)];
  return { last, parts };
}

test("with model headers the X stands in the last model header's right corner, no own column (REQ-750)", async ({
  page,
}) => {
  await openView(page, true);
  const view = await settled(page);
  // No column beside the chart: it reaches the screen's right edge.
  expect(view.tools).toBe(0);
  expect(Math.abs(view.chart.right - view.width)).toBeLessThanOrEqual(0.5);
  // The last header is the rightmost box; it ends at the chart's right edge.
  expect(view.headers.length).toBeGreaterThan(0);
  const last = view.headers.reduce((best, header) => (header.right > best.right ? header : best));
  expect(Math.abs(last.right - view.chart.right)).toBeLessThanOrEqual(1);
  // The X inside its box, in its right corner: as far from the right edge as from top and bottom, centred.
  const { close: x } = view;
  expect(x.left).toBeGreaterThanOrEqual(last.left);
  expect(x.right).toBeLessThanOrEqual(last.right);
  expect(x.top).toBeGreaterThanOrEqual(last.top);
  expect(x.bottom).toBeLessThanOrEqual(last.bottom);
  const margin = x.top - last.top;
  expect(Math.abs(last.bottom - x.bottom - margin)).toBeLessThanOrEqual(1);
  expect(Math.abs(last.right - x.right - margin)).toBeLessThanOrEqual(1);
  expect(x.bottom - x.top).toBeGreaterThanOrEqual(12);
  // In no other header box, and clear of the last header's heading: it stays in the corner (REQ-754).
  for (const header of view.headers) if (header !== last) expect(overlaps(x, header)).toBe(false);
  for (const part of lastHeading(view).parts) expect(overlaps(x, part)).toBe(false);
  expect(view.atEdge).toBeNull();
  // The X has the focus and closes the view.
  expect(view.focused).toBe("Close");
  await close(page).tap();
  await expect(dialog(page)).toHaveCount(0);
});

test.describe("tablet upright", () => {
  test.skip(({ viewport }) => !viewport || viewport.width > viewport.height, "a short last header upright");

  test("in a short last header the X stands 1 px from the right edge, clear of the heading (REQ-754)", async ({
    page,
  }) => {
    // The selection ends on the 16th: the last header, "IFS HRES" from the 15th, is short, its name centred in it.
    await openView(page, true, 9);
    const view = await settled(page);
    const { last, parts } = lastHeading(view);
    const { close: x } = view;
    expect(Math.abs(last.right - view.width)).toBeLessThanOrEqual(1);
    // In the header's corner (24 px, as far from its right edge as from its top) the X would overlap the name.
    const height = last.bottom - last.top;
    const corner = last.right - (height - 24) / 2 - 24;
    const heading = parts.reduce((right, part) => Math.max(right, part.right), -Infinity);
    expect(heading).toBeGreaterThan(corner);
    // It stands 1 px from the screen's right edge instead, vertically centred, clear of the heading; smaller only where
    // the room beside the heading is narrower.
    expect(view.atEdge).toBe("true");
    expect(Math.abs(view.width - x.right - 1)).toBeLessThanOrEqual(0.5);
    for (const part of parts) expect(overlaps(x, part), JSON.stringify({ x, part })).toBe(false);
    expect(x.right - x.left).toBeGreaterThanOrEqual(12);
    expect(x.right - x.left).toBeLessThanOrEqual(24);
    expect(x.top).toBeGreaterThanOrEqual(last.top);
    expect(x.bottom).toBeLessThanOrEqual(last.bottom);
    expect(Math.abs(x.top - last.top - (last.bottom - x.bottom))).toBeLessThanOrEqual(1);
    // It still closes the view.
    expect(view.focused).toBe("Close");
    await close(page).tap();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test("without model headers the X stands in the row below the chart, left of the place name (REQ-750)", async ({
  page,
}) => {
  await openView(page, false);
  const view = await settled(page);
  expect(view.headers).toEqual([]);
  expect(view.tools).toBe(0);
  expect(Math.abs(view.chart.right - view.width)).toBeLessThanOrEqual(0.5);
  const { close: x, location } = view;
  // Left of the place name with a small gap, on its line, within the screen.
  const gap = location.left - x.right;
  expect(gap).toBeGreaterThanOrEqual(2);
  expect(gap).toBeLessThanOrEqual(10);
  expect(Math.abs((x.top + x.bottom) / 2 - (location.top + location.bottom) / 2)).toBeLessThanOrEqual(1);
  expect(x.left).toBeGreaterThanOrEqual(0);
  expect(x.bottom).toBeLessThanOrEqual(view.height);
  expect(x.top).toBeGreaterThanOrEqual(view.chart.bottom - 0.5);
  // Nothing in the row runs into the X or the data source.
  expect(overlaps(x, location)).toBe(false);
  expect(overlaps(location, view.attribution!)).toBe(false);
  expect(view.focused).toBe("Close");
  // Escape still closes the view.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});

test("a place name too long for the row ends in an ellipsis, nothing in the row overlaps (REQ-750)", async ({
  page,
}) => {
  // The start location with a long name, and the domain in the middle of the row.
  await page.route("**/config.json", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.domain = "graupel.at";
    json.startLocation = { ...json.startLocation, name: LONG_NAME };
    await route.fulfill({ response, json });
  });
  await openView(page, false);
  const view = await settled(page);
  expect(view.center).not.toBeNull();
  expect(view.attribution).not.toBeNull();
  // Shortened with "…".
  expect(view.textOverflow).toBe("ellipsis");
  expect(view.cut).toBe(true);
  // X, place name, domain and data source side by side, none over another, all within the screen.
  const parts = [view.close, view.location, view.center!, view.attribution!];
  for (let i = 0; i < parts.length; i++) {
    expect(parts[i]!.left).toBeGreaterThanOrEqual(-0.5);
    expect(parts[i]!.right).toBeLessThanOrEqual(view.width + 0.5);
    for (let j = i + 1; j < parts.length; j++) expect(overlaps(parts[i]!, parts[j]!), `${i} ${j}`).toBe(false);
  }
  expect(view.location.left - view.close.right).toBeGreaterThanOrEqual(2);
});

/**
 * No blue frame around the X (REQ-762): neither when the view opens and focuses it nor on a tap or a click, no focus
 * ring (outline, box-shadow) and no touch highlight. Only after a key a ring of its own shows the keyboard's focus, in
 * the icon's colour instead of the system's blue (`--color-focus` light #1f6fb2, dark #6cb2ec, or the browser's own).
 */
test.describe("no blue frame around the X (REQ-762)", () => {
  /** The X's frame as drawn: focus, ring, shadow and the touch highlight of the button and the element around it. */
  function frame(page: Page) {
    return close(page).evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        focused: document.activeElement === button,
        focusVisible: button.matches(":focus-visible"),
        outline: style.outlineStyle === "none" || style.outlineWidth === "0px" ? "none" : style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        color: style.color,
        boxShadow: style.boxShadow,
        tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
        itemTapHighlight: getComputedStyle(button.parentElement!).getPropertyValue("-webkit-tap-highlight-color"),
      };
    });
  }

  const TRANSPARENT = "rgba(0, 0, 0, 0)";
  const SYSTEM_BLUES = ["rgb(31, 111, 178)", "rgb(108, 178, 236)", "rgb(0, 95, 204)", "rgb(16, 16, 16)"];

  async function expectNoFrame(page: Page) {
    const now = await frame(page);
    expect(now.outline, JSON.stringify(now)).toBe("none");
    expect(now.boxShadow).toBe("none");
    expect(now.tapHighlight).toBe(TRANSPARENT);
    expect(now.itemTapHighlight).toBe(TRANSPARENT);
    return now;
  }

  /** The middle of the X in viewport pixels. */
  async function middle(page: Page) {
    const box = (await close(page).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  test("opened by a tap, then tapped or clicked: no frame (REQ-762)", async ({ page }) => {
    await openView(page, true);
    await settled(page);
    // Focused when the view opens, without a frame.
    expect((await expectNoFrame(page)).focused).toBe(true);
    // A finger on the X: none while it is pressed, and the tap closes the view.
    const cdp = await page.context().newCDPSession(page);
    const point = await middle(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    expect((await expectNoFrame(page)).focused).toBe(true);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(dialog(page)).toHaveCount(0);
    // Opened again and clicked: none while the button is held down, and the click closes the view.
    await page.getByTestId("footer-slot").getByTestId("meteogram-fullscreen-open").tap();
    await expect(dialog(page).getByTestId("fullscreen-close")).toHaveAttribute("data-place", "header");
    await settled(page);
    await expectNoFrame(page);
    const again = await middle(page);
    await page.mouse.move(again.x, again.y);
    await page.mouse.down();
    expect((await expectNoFrame(page)).focused).toBe(true);
    await page.mouse.up();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("used with the keyboard: a ring of its own, not the system's blue, gone on a touch (REQ-762)", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem("graupel.modelHeaders", "true"));
    await page.goto(APP);
    await expect(page.getByTestId("meteogram-scroll").locator("svg.meteogram-svg-integrated")).toBeVisible();
    // Opened by a key: the X has the focus and shows it.
    const open = page.getByTestId("footer-slot").getByTestId("meteogram-fullscreen-open");
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByTestId("fullscreen-close")).toHaveAttribute("data-place", "header");
    await settled(page);
    const ring = async () => {
      const now = await frame(page);
      expect(now.focused).toBe(true);
      expect(now.focusVisible).toBe(true);
      expect(now.outline, JSON.stringify(now)).toBe("solid");
      expect(now.outlineWidth).toBe("2px");
      // In the icon's colour, not the system's blue.
      expect(now.outlineColor).toBe(now.color);
      expect(SYSTEM_BLUES).not.toContain(now.outlineColor);
      expect(now.boxShadow).toBe("none");
      expect(now.tapHighlight).toBe(TRANSPARENT);
    };
    await ring();
    // Tab round the view back to the X: the ring again.
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if ((await frame(page)).focused) break;
    }
    await ring();
    // A finger on it: the ring goes, the focus stays; lifted elsewhere, nothing is closed. The browser still matches
    // `:focus-visible` there, as Safari does for the X focused by a view opened with a tap: no ring all the same.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [await middle(page)] });
    const touched = await expectNoFrame(page);
    expect(touched.focused).toBe(true);
    expect(touched.focusVisible).toBe(true);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expectNoFrame(page);
    // The next key shows it again, Escape closes the view.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await ring();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  });
});
