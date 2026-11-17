// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * No blue frame around the X of any dialog or popup (REQ-776, the rule of REQ-762 for all of them): installing,
 * information, settings, history, model info, error cards, legend and the full-screen view on every device that has
 * an X there. Neither when the dialog opens and focuses its X nor while a click or a tap presses it: no outline and no
 * box-shadow (getComputedStyle), no touch highlight. Only while the page is used with the keyboard does a subtle ring in
 * the icon's colour show the focus, not the system's blue; a pointer takes it away again.
 *
 * Each dialog is opened by a click or a tap, closed by its X, opened again and closed again. Where a dialog has an X
 * only in some classes, the test of the others stops at the start: the history dialog and the model info's dialog are
 * the phone's (the desktop and the tablet have a list and a popover without an X), the phone's full-screen view has no
 * X (REQ-537).
 */
import { expect, onlyIn, test, type DeviceClass, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Tuesday, 10 November 2026, 09:00 UTC; the earlier fetch of the history two days before. */
const FIXED_NOW = Date.UTC(2026, 10, 10, 9);
const EARLIER = Date.UTC(2026, 10, 8, 9, 30);

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];
/** The time the fake Open-Meteo answers from: the page's clock. */
let now = FIXED_NOW;
/** Whether the forecast fails (the error card's case). */
let failing = false;

test.beforeEach(async ({ page }) => {
  errors = [];
  now = FIXED_NOW;
  failing = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) =>
    failing ? route.abort() : fakeForecast(route, { now }),
  );
  // Like Safari and Firefox, which have no install prompt: the install button opens the dialog with the steps.
  await page.addInitScript(() => {
    delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
    delete (Window.prototype as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const chart = (page: Page) => page.locator('[data-region="meteogram"] svg.meteogram-svg-integrated');

/** Number of fetches in the page's archive (IndexedDB); 0 while it has none. Never creates the database itself. */
const archivedCount = (page: Page) =>
  page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === "graupel-archive")) return 0;
    return new Promise<number>((resolve) => {
      const request = indexedDB.open("graupel-archive");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("fetches")) {
          db.close();
          resolve(0);
          return;
        }
        const count = db.transaction("fetches").objectStore("fetches").count();
        count.onsuccess = () => {
          db.close();
          resolve(count.result);
        };
        count.onerror = () => resolve(0);
      };
      request.onerror = () => resolve(0);
    });
  });

/** The button that opens the full-screen view (the desktop's in the card's tools, the tablet's in the footer). */
const fullscreenOpener = (page: Page) =>
  page.getByRole("button", { name: "Show the meteogram full screen" }).filter({ visible: true }).first();

async function load(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
}

/** The X's frame as drawn: focus, ring, shadow and the touch highlight. */
function frame(button: Locator) {
  return button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focused: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      outline: style.outlineStyle === "none" || style.outlineWidth === "0px" ? "none" : style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      color: style.color,
      boxShadow: style.boxShadow,
      tapHighlight: style.getPropertyValue("-webkit-tap-highlight-color"),
    };
  });
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";
/** The page's focus colour (light #1f6fb2, dark #6cb2ec) and the browser's own rings. */
const SYSTEM_BLUES = ["rgb(31, 111, 178)", "rgb(108, 178, 236)", "rgb(0, 95, 204)", "rgb(16, 16, 16)"];

async function expectNoFrame(button: Locator) {
  const now = await frame(button);
  expect(now.outline, JSON.stringify(now)).toBe("none");
  expect(now.boxShadow, JSON.stringify(now)).toBe("none");
  expect(now.tapHighlight).toBe(TRANSPARENT);
  return now;
}

/** The keyboard's ring (REQ-776): 2 px in the icon's colour, not the system's blue, no shadow. */
async function expectRing(button: Locator) {
  const now = await frame(button);
  expect(now.focused).toBe(true);
  expect(now.focusVisible).toBe(true);
  expect(now.outline, JSON.stringify(now)).toBe("solid");
  expect(now.outlineWidth).toBe("2px");
  expect(now.outlineColor).toBe(now.color);
  expect(SYSTEM_BLUES).not.toContain(now.outlineColor);
  expect(now.boxShadow).toBe("none");
}

/** The middle of an element in viewport pixels. */
async function middle(element: Locator) {
  const box = (await element.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Presses an opener: a click on the desktop, a tap on a touch screen. */
async function press(opener: Locator, deviceClass: DeviceClass) {
  if (deviceClass === "desktop") await opener.click();
  else await opener.tap();
}

/**
 * Presses the X with a finger (touch screens) or the mouse (desktop): no frame while it is held down, then the press
 * closes the dialog (`gone`).
 */
async function pressClose(page: Page, button: Locator, gone: Locator, deviceClass: DeviceClass) {
  const point = await middle(button);
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
  await expect(gone).toHaveCount(0);
}

interface Opened {
  /** The X. */
  close: Locator;
  /** What the X closes: gone after the press. */
  gone: Locator;
  /** Whether the dialog focuses its X when it opens (the error card and the legend do not). */
  focused: boolean;
}

/**
 * Opens a dialog by a click or a tap, checks its X without frame, closes it by the X, opens it again and closes it
 * again (REQ-776).
 */
async function openTwice(page: Page, deviceClass: DeviceClass, open: () => Promise<Opened>) {
  for (let round = 0; round < 2; round++) {
    const { close, gone, focused } = await open();
    await expect(close).toBeVisible();
    // After the open, also where it focused the X (the focus stays for screen readers).
    const opened = await expectNoFrame(close);
    if (focused) expect(opened.focused, `round ${round}`).toBe(true);
    await pressClose(page, close, gone, deviceClass);
  }
}

/** A dialog of the page, by its accessible name, and its X. */
function dialogOf(page: Page, name: string | RegExp): Opened {
  const dialog = page.getByRole("dialog", { name });
  return { close: dialog.getByRole("button", { name: "Close" }).first(), gone: dialog, focused: true };
}

test.describe("no blue frame around the X after a click or a tap (REQ-776)", () => {
  /*
   * As in Safari on the Mac, the iPhone and the iPad, a click or a tap does not focus the button it presses: the page
   * has no focus when the dialog opens and focuses its X, and the browser takes that focus for one to show (the blue
   * frame of REQ-776). Chromium would focus the button and then show no ring on the X.
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

  test("install dialog (REQ-776)", async ({ page, deviceClass }) => {
    await load(page);
    await openTwice(page, deviceClass, async () => {
      await press(await headerControl(page, "button", /^(Download|Install app)$/), deviceClass);
      return dialogOf(page, /^Install/);
    });
  });

  test("info dialog (REQ-776)", async ({ page, deviceClass }) => {
    await load(page);
    await openTwice(page, deviceClass, async () => {
      await press(await headerControl(page, "button", "Info"), deviceClass);
      // The info dialog focuses its chosen tab, not the X.
      return { ...dialogOf(page, "Info"), focused: false };
    });
  });

  test("settings dialog (REQ-776)", async ({ page, deviceClass }) => {
    await load(page);
    await openTwice(page, deviceClass, async () => {
      await press(await headerControl(page, "button", "Settings"), deviceClass);
      return dialogOf(page, "Settings");
    });
  });

  test("error card (REQ-776)", async ({ page, deviceClass }) => {
    failing = true;
    await openTwice(page, deviceClass, async () => {
      await page.goto(APP);
      const card = page.getByTestId("error-card");
      await expect(card).toHaveCount(1);
      return { close: card.getByRole("button", { name: "Close" }), gone: card, focused: false };
    });
  });

  test("legend (REQ-776)", async ({ page, deviceClass }) => {
    // Shown at each load, also after its X turned it off.
    await page.addInitScript(() => window.localStorage.setItem("graupel.legend", "true"));
    await openTwice(page, deviceClass, async () => {
      await load(page);
      const legend = page.getByTestId("meteogram-legend");
      await expect(legend).toBeVisible();
      return { close: legend.getByTestId("meteogram-legend-close"), gone: legend, focused: false };
    });
  });

  test.describe("full-screen view", () => {
    onlyIn(["desktop", "tablet"], "the phone's full-screen view has no X (REQ-537)");

    test("full-screen view (REQ-776)", async ({ page, deviceClass }) => {
      await load(page);
      await openTwice(page, deviceClass, async () => {
        await press(fullscreenOpener(page), deviceClass);
        const opened = dialogOf(page, "Meteogram (full screen)");
        await expect(opened.gone.locator('svg[data-render-mode="fullscreen"]')).toBeVisible();
        return opened;
      });
    });
  });

  test.describe("phone's dialogs", () => {
    onlyIn("phone", "the desktop and the tablet show the history as a list and the model info as a popover, no X");

    test("model info dialog (REQ-776)", async ({ page, deviceClass }) => {
      await page.addInitScript(() => window.localStorage.setItem("graupel.showWeatherChain", "true"));
      await load(page);
      await openTwice(page, deviceClass, async () => {
        // With the model headers shown the info buttons stand in the meteogram's headers, the weather chain's cards
        // have none on a phone (REQ-820).
        const info = page.locator('[data-region="meteogram"]').getByTestId("model-header-info-button");
        await press(info.first(), deviceClass);
        const dialog = page.getByTestId("model-info-popover");
        return { close: dialog.getByRole("button", { name: "Close" }), gone: dialog, focused: true };
      });
    });

    test("history dialog (REQ-776)", async ({ page, deviceClass }) => {
      // The installed app (Playwright cannot set its display mode) with an earlier fetch two days before.
      await page.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query: string) =>
          query === "(display-mode: standalone)"
            ? ({ ...original(query), media: query, matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList)
            : original(query);
      });
      now = EARLIER;
      await page.clock.setFixedTime(EARLIER);
      await load(page);
      // The installed app archives the fetch after the chart shows.
      await expect.poll(() => archivedCount(page)).toBeGreaterThan(0);
      now = FIXED_NOW;
      await page.clock.setFixedTime(FIXED_NOW);
      const menu = page.locator('[data-region="location"]').getByRole("button", { name: "Menu" });
      const item = page.getByTestId("phone-menu-panel").getByRole("button", { name: /^History/ });
      await page.reload();
      await expect(chart(page)).toBeVisible();
      await menu.tap();
      await expect(item).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(item).toBeHidden();
      await openTwice(page, deviceClass, async () => {
        await menu.tap();
        await item.tap();
        return dialogOf(page, "History");
      });
    });
  });
});

/**
 * With the keyboard (REQ-776): a dialog opened by a key shows the ring on its X at once, Tab round the dialog back to
 * the X shows it again, a mouse press on the X takes it away. Desktop only: the keyboard.
 */
test.describe("the X with the keyboard (REQ-776)", () => {
  onlyIn("desktop", "used with a keyboard");

  /** Tabs until the X has the focus. */
  async function tabTo(page: Page, close: Locator) {
    for (let i = 0; i < 60; i++) {
      if ((await frame(close)).focused) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("the X never got the focus");
  }

  for (const [name, opener, dialog] of [
    ["install", /^(Download|Install app)$/, /^Install/],
    ["info", "Info", "Info"],
    ["settings", "Settings", "Settings"],
  ] as const) {
    test(`${name} dialog opened by a key: ring on the X (REQ-776)`, async ({ page }) => {
      await load(page);
      const button = await headerControl(page, "button", opener);
      await button.focus();
      await page.keyboard.press("Enter");
      const { close, gone } = dialogOf(page, dialog);
      await expect(close).toBeVisible();
      await tabTo(page, close);
      await expectRing(close);
      // Once round the dialog.
      await page.keyboard.press("Tab");
      await tabTo(page, close);
      await expectRing(close);
      // A mouse press on it: the ring goes, the focus stays; the click closes the dialog.
      await pressClose(page, close, gone, "desktop");
    });
  }

  test("full-screen view opened by a key: ring on the X (REQ-776)", async ({ page }) => {
    await load(page);
    await fullscreenOpener(page).focus();
    await page.keyboard.press("Enter");
    const { close, gone } = dialogOf(page, "Meteogram (full screen)");
    await expect(close).toBeVisible();
    expect((await frame(close)).focused).toBe(true);
    await expectRing(close);
    await page.keyboard.press("Escape");
    await expect(gone).toHaveCount(0);
  });

  test("error card and legend: Tab to the X shows the ring (REQ-776)", async ({ page }) => {
    failing = true;
    await page.addInitScript(() => window.localStorage.setItem("graupel.legend", "true"));
    await page.goto(APP);
    const card = page.getByTestId("error-card");
    await expect(card).toHaveCount(1);
    const close = card.getByRole("button", { name: "Close" });
    await tabTo(page, close);
    await expectRing(close);
    await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);
    failing = false;
    await load(page);
    const legend = page.getByTestId("meteogram-legend");
    await expect(legend).toBeVisible();
    const legendClose = legend.getByTestId("meteogram-legend-close");
    await tabTo(page, legendClose);
    await expectRing(legendClose);
  });
});
