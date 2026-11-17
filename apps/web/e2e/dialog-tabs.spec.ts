// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Tabs of the popups with a tab bar (info and settings), in every device class:
 * - A newly chosen tab starts at its top (REQ-854): scrolled far down in the privacy policy, “About” shows its content
 *   at once, not an empty box above which it lies (the iPad of the report); likewise in the settings.
 * - The selected tab has no blue frame, only its underline (REQ-859, as the X of REQ-776): neither when the popup opens
 *   and focuses it nor while a tap or a click presses a tab. With the keyboard the focused tab shows its label in the
 *   accent colour, thinly underlined, still without a frame.
 */
import { expect, onlyIn, test, type DeviceClass, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 17 November 2026, 09:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 17, 9);
/** The accent colour of the light look (#1f6fb2). */
const ACCENT = "rgb(31, 111, 178)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

test.use({ locale: "en-GB", timezoneId: "UTC", colorScheme: "light" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) => route.fulfill({ json: { elevation: [200] } }));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

async function load(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

/** Presses `target`: a click on the desktop, a tap on a touch screen. */
async function press(target: Locator, deviceClass: DeviceClass) {
  if (deviceClass === "desktop") await target.click();
  else await target.tap();
}

/** Opens the popup `name` (“Info” or “Settings”) from the header or the phone's menu by a press. */
async function open(page: Page, deviceClass: DeviceClass, opener: string, name: string) {
  await press(await headerControl(page, "button", opener), deviceClass);
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  return dialog;
}

const openInfo = (page: Page, deviceClass: DeviceClass) => open(page, deviceClass, "Info", "Information");
const openSettings = (page: Page, deviceClass: DeviceClass) => open(page, deviceClass, "Settings", "Settings");

const tab = (dialog: Locator, name: string) => dialog.getByRole("tablist").getByRole("tab", { name, exact: true });
const body = (dialog: Locator) => dialog.locator(".dialog__body");

/** Scrolls the popup's body to its end; returns how far it scrolled. */
const scrollToEnd = (dialog: Locator) =>
  body(dialog).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });

/** The top of the selected panel's first element lies inside the body's box: the tab's content is in view. */
async function expectPanelTopInView(dialog: Locator) {
  const geometry = await body(dialog).evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    const first = (panel.firstElementChild as HTMLElement | null) ?? panel;
    const box = element.getBoundingClientRect();
    const top = first.getBoundingClientRect();
    return { scrollTop: element.scrollTop, bodyTop: box.top, bodyBottom: box.bottom, firstTop: top.top, height: top.height };
  });
  expect(geometry.scrollTop, JSON.stringify(geometry)).toBe(0);
  expect(geometry.firstTop, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.bodyTop);
  expect(geometry.firstTop, JSON.stringify(geometry)).toBeLessThan(geometry.bodyBottom);
  expect(geometry.height).toBeGreaterThan(0);
}

test.describe("a newly chosen tab starts at its top (REQ-854)", () => {
  test("info: far down in the privacy policy, then About shows its content", async ({ page, deviceClass }) => {
    await load(page);
    const dialog = await openInfo(page, deviceClass);
    await press(tab(dialog, "Privacy policy"), deviceClass);
    await expect(tab(dialog, "Privacy policy")).toHaveAttribute("aria-selected", "true");
    // The privacy policy is longer than the popup in every class.
    expect(await scrollToEnd(dialog)).toBeGreaterThan(200);
    await press(tab(dialog, "About"), deviceClass);
    await expect(tab(dialog, "About")).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("tabpanel", { name: "About" })).toBeVisible();
    await expectPanelTopInView(dialog);

    // Every other tab, chosen after scrolling to the end of the one before, starts at its top too.
    for (const name of ["Help", "Legal notice", "Privacy policy", "About"]) {
      await scrollToEnd(dialog);
      await press(tab(dialog, name), deviceClass);
      await expect(tab(dialog, name)).toHaveAttribute("aria-selected", "true");
      await expectPanelTopInView(dialog);
    }
  });

  test("settings: each tab chosen after scrolling down starts at its top", async ({ page, deviceClass }) => {
    await load(page);
    const dialog = await openSettings(page, deviceClass);
    for (const name of ["Start", "Models", "Meteogram", "Design"]) {
      await scrollToEnd(dialog);
      await press(tab(dialog, name), deviceClass);
      await expect(tab(dialog, name)).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => body(dialog).evaluate((element) => element.scrollTop)).toBe(0);
    }
  });
});

/** A tab as drawn: focus, ring, shadow, touch highlight, underline and the label's colour and decoration. */
function look(button: Locator) {
  return button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focused: document.activeElement === element,
      outline: style.outlineStyle === "none" || style.outlineWidth === "0px" ? "none" : style.outlineStyle,
      boxShadow: style.boxShadow,
      tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
      underline: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`,
      color: style.color,
      decoration: style.textDecorationLine,
      borders: [style.borderTopWidth, style.borderLeftWidth, style.borderRightWidth],
    };
  });
}

/** No frame around `button`: no outline, no shadow, no touch highlight, no border but the underline at the bottom. */
async function expectNoFrame(button: Locator) {
  const now = await look(button);
  const what = JSON.stringify(now);
  expect(now.outline, what).toBe("none");
  expect(now.boxShadow, what).toBe("none");
  expect(now.tapHighlight, what).toBe(TRANSPARENT);
  expect(now.borders, what).toEqual(["0px", "0px", "0px"]);
  return now;
}

/** The selected tab: no frame, only its underline in the accent colour. */
async function expectUnderlinedOnly(button: Locator) {
  await expect(button).toHaveAttribute("aria-selected", "true");
  const now = await expectNoFrame(button);
  expect(now.underline, JSON.stringify(now)).toBe(`2px solid ${ACCENT}`);
  return now;
}

/** Holds a finger (touch screens) or the mouse (desktop) on `button`, checks it has no frame meanwhile, lets go. */
async function pressAndCheck(page: Page, button: Locator, deviceClass: DeviceClass) {
  const box = (await button.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (deviceClass === "desktop") {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expectNoFrame(button);
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await expectNoFrame(button);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
}

test.describe("no blue frame around a tab, only its underline (REQ-859)", () => {
  /*
   * As in Safari on the iPhone and the iPad, a tap or a click does not focus the button it presses: the info popup
   * then focuses its selected tab from no focus, which Safari takes for one to show (the blue frame of the report).
   */
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener(
        "mousedown",
        (event) => {
          if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
        },
        true,
      );
    });
  });

  test("info: the selected tab after opening and after each press", async ({ page, deviceClass }) => {
    await load(page);
    const dialog = await openInfo(page, deviceClass);
    const about = tab(dialog, "About");
    const opened = await expectUnderlinedOnly(about);
    // The popup focuses its selected tab (for screen readers), without a frame.
    expect(opened.focused).toBe(true);
    for (const name of ["Help", "Legal notice", "Privacy policy", "About"]) {
      const button = tab(dialog, name);
      await pressAndCheck(page, button, deviceClass);
      await expectUnderlinedOnly(button);
      // The other tabs have no underline.
      for (const other of await dialog.getByRole("tab", { selected: false }).all()) {
        expect((await expectNoFrame(other)).underline).toBe(`2px solid ${TRANSPARENT}`);
      }
    }
  });

  test("settings: the selected tab after each press", async ({ page, deviceClass }) => {
    await load(page);
    const dialog = await openSettings(page, deviceClass);
    await expectUnderlinedOnly(tab(dialog, "Design"));
    for (const name of ["Start", "Models", "Meteogram", "Design"]) {
      const button = tab(dialog, name);
      await pressAndCheck(page, button, deviceClass);
      await expectUnderlinedOnly(button);
    }
  });
});

test.describe("the tabs with the keyboard (REQ-859)", () => {
  onlyIn("desktop", "used with a keyboard");

  test("the focused tab: accent colour and a thin underline, no frame; gone on a mouse press", async ({ page }) => {
    await load(page);
    const opener = await headerControl(page, "button", "Info");
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Information" });
    const about = tab(dialog, "About");
    const help = tab(dialog, "Help");
    let now = await expectUnderlinedOnly(about);
    expect(now.focused).toBe(true);
    expect(now.color).toBe(ACCENT);
    expect(now.decoration).toBe("underline");

    await page.keyboard.press("ArrowRight");
    now = await expectUnderlinedOnly(help);
    expect(now.focused).toBe(true);
    expect(now.color).toBe(ACCENT);
    expect(now.decoration).toBe("underline");
    const left = await expectNoFrame(about);
    expect(left.color).not.toBe(ACCENT);
    expect(left.decoration).toBe("none");

    // A mouse press: the keyboard's hint goes, the underline of the selection stays.
    await help.click();
    now = await expectUnderlinedOnly(help);
    expect(now.color).not.toBe(ACCENT);
    expect(now.decoration).toBe("none");
  });
});
