// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Full screen without title bar (REQ-460); copy and save buttons in the card and the full-screen view (REQ-461). The
 * copy goes to the real clipboard (permissions granted) and is read back as a PNG; the share sheet of the phone is a
 * stand-in that records the shared files. On a desktop saving writes a PNG file (REQ-597): through the "Save as"
 * dialog, a stand-in that records the suggested name and the file, or, without it, as a download. The card has no
 * visible heading; its buttons stand in a column to the right of the chart (REQ-507). On a phone the copy and save
 * buttons stand in the page footer's row (REQ-541; at its right end since REQ-550, REQ-582; since REQ-729 at its start,
 * the data source after them), their message above them
 * within the screen (REQ-589), and the full-screen view has no buttons (REQ-537).
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, ownDevice } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";

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

const card = (page: Page) => page.getByTestId("meteogram-card");
const footer = (page: Page) => page.getByRole("contentinfo");
const fullscreen = (page: Page) => page.getByRole("dialog", { name: "Meteogram (full screen)" });
const COPY = "Copy the meteogram as a picture";
const SAVE = "Save the picture to the photos";
const SHARE = "Share the picture";
const FULLSCREEN = "Show the meteogram full screen";
/** Buttons in `scope` but the info buttons in the model headers, which stand in the chart also on a phone (REQ-643). */
const buttonsBesideModelInfo = (scope: Locator) =>
  scope.getByRole("button").and(scope.page().locator(':not([data-testid="model-header-info-button"])'));

/** Type and the first bytes of the picture on the clipboard. */
function readClipboardPng(page: Page) {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes("image/png"));
    if (!item) return null;
    const blob = await item.getType("image/png");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = await createImageBitmap(blob);
    return { size: bytes.length, signature: [...bytes.slice(1, 4)], width: image.width, height: image.height };
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("the card copies the meteogram as a PNG; the full-screen view has no title bar", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await page.goto(APP);
    const copy = card(page).getByRole("button", { name: COPY });
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAttribute("title", COPY);

    await copy.click();
    await expect(card(page).getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
    const png = await readClipboardPng(page);
    expect(png).not.toBeNull();
    // "PNG" after the first byte of the signature; at least the chart's size.
    expect(String.fromCharCode(...png!.signature)).toBe("PNG");
    expect(png!.width).toBeGreaterThan(1000);
    expect(png!.height).toBeGreaterThan(200);

    await page.getByRole("button", { name: "Show the meteogram full screen" }).click();
    const dialog = fullscreen(page);
    await expect(dialog).toBeVisible();
    // No title bar: no heading, the title only names the dialog; no divider below a header.
    await expect(dialog.getByRole("heading")).toHaveCount(0);
    await expect(dialog.getByText("Meteogram (full screen)")).toHaveCount(0);
    await expect(dialog.locator(".dialog__header")).toHaveCount(0);
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeFocused();
    // The chart starts at the top of the screen, the buttons sit at its side.
    const chart = dialog.locator('svg.meteogram-svg-integrated[data-render-mode="fullscreen"]');
    const chartBox = (await chart.boundingBox())!;
    expect(chartBox.y).toBeLessThan(20);
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.x).toBeGreaterThanOrEqual(chartBox.x + chartBox.width - 1);
    const dialogCopy = dialog.getByRole("button", { name: COPY });
    const copyBox = (await dialogCopy.boundingBox())!;
    expect(copyBox.y).toBeGreaterThan(closeBox.y);

    await page.evaluate(() => navigator.clipboard.writeText(""));
    await dialogCopy.click();
    await expect(dialog.getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
    const fullPng = await readClipboardPng(page);
    expect(fullPng).not.toBeNull();
    expect(fullPng!.height).toBeGreaterThan(png!.height);

    await close.click();
    await expect(fullscreen(page)).toHaveCount(0);
  });
});

/** Type, size and the first bytes of a saved PNG file. */
function pngInfo(bytes: Uint8Array) {
  return { signature: String.fromCharCode(...bytes.slice(1, 4)), size: bytes.length };
}

/** Date of the data and the place, no infix (REQ-683, REQ-766). */
const FILE_NAME = /^\d{6}_Mont_Blanc\.png$/;

test.describe("desktop, saving the picture (REQ-597)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("without a “Save as” dialog the card and the full-screen view download the PNG", async ({ page }) => {
    // A browser without the dialog (Firefox, Safari): the PNG lands in the downloads.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, "showSaveFilePicker");
    });
    await page.goto(APP);
    const save = card(page).getByRole("button", { name: SAVE });
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute("title", SAVE);
    // The same button as on a phone.
    await expect(save).toHaveAttribute("data-testid", "meteogram-save");

    const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
    expect(download.suggestedFilename()).toMatch(FILE_NAME);
    await expect(card(page).getByRole("status").filter({ hasText: "Picture saved" })).toBeVisible();
    const file = pngInfo(new Uint8Array(await readFile(await download.path())));
    expect(file.signature).toBe("PNG");
    expect(file.size).toBeGreaterThan(10_000);

    await page.getByRole("button", { name: FULLSCREEN }).click();
    const dialog = fullscreen(page);
    await expect(dialog).toBeVisible();
    const fullSave = dialog.getByRole("button", { name: SAVE });
    // Below the copy button in the side column.
    const copyBox = (await dialog.getByRole("button", { name: COPY }).boundingBox())!;
    const saveBox = (await fullSave.boundingBox())!;
    expect(saveBox.y).toBeGreaterThanOrEqual(copyBox.y + copyBox.height);
    expect(Math.abs(saveBox.x - copyBox.x)).toBeLessThan(1);
    const [fullDownload] = await Promise.all([page.waitForEvent("download"), fullSave.click()]);
    expect(fullDownload.suggestedFilename()).toMatch(FILE_NAME);
    await expect(dialog.getByRole("status").filter({ hasText: "Picture saved" })).toBeVisible();
  });
});

test.describe("desktop in a frame of another origin, saving the picture (REQ-597)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  ownDevice();

  test("the browser refuses the “Save as” dialog there: the PNG is downloaded", async ({ page, context }) => {
    // Records how the browser's own dialog ended in the frame.
    await page.addInitScript(() => {
      const picker = (window as { showSaveFilePicker?: (...args: unknown[]) => Promise<unknown> }).showSaveFilePicker;
      const outcomes: string[] = [];
      Object.assign(window, { __pickerOutcomes: outcomes });
      if (typeof picker !== "function") return;
      Object.assign(window, {
        showSaveFilePicker(this: Window, ...args: unknown[]) {
          return picker.apply(this, args).then(
            (handle) => (outcomes.push("opened"), handle),
            (error: DOMException) => {
              outcomes.push(error.name);
              throw error;
            },
          );
        },
      });
    });
    // A page of another origin on the same machine (127.0.0.1 instead of localhost) shows the site in a frame.
    const host = "http://127.0.0.1:4175/frame.html";
    await page.route(host, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><iframe src="${APP}" style="width: 1200px; height: 850px; border: 0"></iframe>`,
      }),
    );
    // The routed page counts as one from the internet: it may load the site from this machine only with permission.
    await context.grantPermissions(["local-network-access"]);
    await page.goto(host);
    const frame = page.frameLocator("iframe");
    const frameCard = frame.getByTestId("meteogram-card");
    const save = frameCard.getByRole("button", { name: SAVE });
    await expect(save).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
    expect(download.suggestedFilename()).toMatch(FILE_NAME);
    await expect(frameCard.getByRole("status").filter({ hasText: "Picture saved" })).toBeVisible();
    const outcomes = await page
      .frames()
      .find((candidate) => candidate.url() === APP)!
      .evaluate(() => (window as unknown as { __pickerOutcomes: string[] }).__pickerOutcomes);
    expect(outcomes).toEqual(["SecurityError"]);
  });
});

test.describe("desktop, German, saving the picture (REQ-597)", () => {
  test.use({ viewport: { width: 1280, height: 900 }, locale: "de-DE" });
  ownDevice();

  test("the “Save as” dialog opens with the suggested file name and gets the PNG, without share sheet", async ({
    page,
  }) => {
    // "Save as" dialog stand-in (Chrome, Edge): records the options and the written file; no share sheet on a desktop.
    await page.addInitScript(() => {
      const calls: { suggestedName?: string; types?: unknown }[] = [];
      const written: { signature: string; size: number }[] = [];
      let cancel = false;
      Object.assign(window, {
        __picker: { calls, written, cancelNext: () => (cancel = true) },
        showSaveFilePicker: async (options: { suggestedName?: string; types?: unknown }) => {
          calls.push({ suggestedName: options.suggestedName, types: options.types });
          if (cancel) {
            cancel = false;
            throw new DOMException("The user aborted a request.", "AbortError");
          }
          return {
            createWritable: async () => ({
              write: async (blob: Blob) => {
                const bytes = new Uint8Array(await blob.arrayBuffer());
                written.push({ signature: String.fromCharCode(...bytes.slice(1, 4)), size: bytes.length });
              },
              close: async () => undefined,
              abort: async () => undefined,
            }),
          };
        },
      });
      Object.assign(navigator, {
        canShare: () => true,
        share: async () => {
          throw new Error("no share sheet on a desktop");
        },
      });
    });
    let downloads = 0;
    page.on("download", () => downloads++);
    await page.goto(APP);
    type Picker = {
      calls: { suggestedName?: string; types?: unknown }[];
      written: { signature: string; size: number }[];
    };
    const picker = () => page.evaluate(() => (window as unknown as { __picker: Picker }).__picker);
    const save = card(page).getByRole("button", { name: "Bild in den Fotos speichern" });

    await save.click();
    await expect(card(page).getByRole("status").filter({ hasText: "Bild gespeichert" })).toBeVisible();
    const { calls, written } = await picker();
    expect(calls).toEqual([
      { suggestedName: expect.stringMatching(FILE_NAME), types: [{ accept: { "image/png": [".png"] } }] },
    ]);
    expect(written).toHaveLength(1);
    expect(written[0]!.signature).toBe("PNG");
    expect(written[0]!.size).toBeGreaterThan(10_000);

    // Closing the dialog saves nothing and shows no message.
    const feedback = card(page).getByTestId("meteogram-image-feedback");
    await expect(feedback).toBeEmpty({ timeout: 5_000 });
    await page.evaluate(() => (window as unknown as { __picker: { cancelNext: () => void } }).__picker.cancelNext());
    await save.click();
    await expect.poll(async () => (await picker()).calls.length).toBe(2);
    // A moment for a message that must not come.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)));
    await expect(feedback).toBeEmpty();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await picker()).written).toHaveLength(1);
    expect(downloads).toBe(0);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ownDevice();

  test("the footer row offers saving the picture through the share sheet; the full-screen view has no buttons", async ({
    page,
  }) => {
    // Share sheet stand-in: accepts PNG files and records them.
    await page.addInitScript(() => {
      const shared: { name: string; type: string; size: number }[] = [];
      Object.assign(window, { __shared: shared });
      Object.assign(navigator, {
        canShare: (data?: ShareData) => !!data?.files?.length && data.files.every((file) => file.type === "image/png"),
        share: async (data: ShareData) => {
          for (const file of data.files ?? []) shared.push({ name: file.name, type: file.type, size: file.size });
        },
      });
    });
    await page.goto(APP);
    const shared = () => page.evaluate(() => (window as unknown as { __shared: { name: string }[] }).__shared);

    await expect(footer(page).getByRole("button", { name: COPY })).toBeVisible();
    await expect(buttonsBesideModelInfo(card(page))).toHaveCount(0);
    // Where files can be shared, the button shares the picture (REQ-680).
    const save = footer(page).getByRole("button", { name: SHARE });
    await expect(save).toBeVisible();
    await save.click();
    await expect(footer(page).getByRole("status").filter({ hasText: "Picture shared" })).toBeVisible();
    const files = await shared();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ type: "image/png", name: expect.stringMatching(FILE_NAME) });

    // No full-screen button on a phone: turning it to landscape opens the view (REQ-532).
    await expect(page.getByRole("button", { name: FULLSCREEN })).toHaveCount(0);
    await page.setViewportSize({ width: 844, height: 390 });
    const dialog = fullscreen(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveCount(0);
    // No close, copy or save buttons on a phone (REQ-537): turning back closes the view.
    await expect(dialog.locator(".meteogram-fullscreen__chart svg.meteogram-svg-integrated")).toBeVisible();
    await expect(buttonsBesideModelInfo(dialog)).toHaveCount(0);
    await expect(dialog.locator(".dialog__tools")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(fullscreen(page)).toHaveCount(0);
    await expect(footer(page).getByRole("button", { name: SHARE })).toBeVisible();
    expect(await shared()).toHaveLength(1);
  });
});

test.describe("phone, German", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "de-DE" });
  ownDevice();

  test("the message after copying and saving stands whole on the screen, above the buttons at the left (REQ-589, REQ-729)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
    await page.addInitScript(() => {
      Object.assign(navigator, {
        canShare: (data?: ShareData) => !!data?.files?.length && data.files.every((file) => file.type === "image/png"),
        share: async () => undefined,
      });
    });
    await page.goto(APP);
    const copy = footer(page).getByRole("button", { name: "Meteogramm als Bild kopieren" });
    const save = footer(page).getByRole("button", { name: "Bild teilen" });
    for (const [button, text] of [
      [copy, "Meteogramm kopiert"],
      [save, "Bild geteilt"],
    ] as const) {
      await button.tap();
      const message = footer(page).getByRole("status").filter({ hasText: text });
      await expect(message).toBeVisible();
      const box = (await message.boundingBox())!;
      const buttons = (await copy.boundingBox())!;
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // On a phone the buttons stand at the row's start (REQ-729): left-aligned with the copy button, the first one,
      // and above the buttons.
      expect(Math.abs(box.x - buttons.x)).toBeLessThan(1);
      expect(box.y + box.height).toBeLessThanOrEqual(buttons.y);
      // On one line, nothing cut off.
      expect(await message.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(box.height).toBeLessThan(40);
    }
  });
});

/** Fixed time: Saturday, 7 November 2026, 10:00 UTC; the forecast is fetched then (REQ-683). */
const FIXED_NOW = Date.UTC(2026, 10, 7, 10);

/** Share sheet stand-in: accepts PNG files and records name, type and size of each shared file. */
async function fakeShareSheet(page: Page) {
  await page.addInitScript(() => {
    const shared: { name: string; type: string; size: number; files: number }[] = [];
    Object.assign(window, { __shared: shared });
    Object.assign(navigator, {
      canShare: (data?: ShareData) => !!data?.files?.length && data.files.every((file) => file.type === "image/png"),
      share: async (data: ShareData) => {
        const files = data.files ?? [];
        for (const file of files) shared.push({ name: file.name, type: file.type, size: file.size, files: files.length });
      },
    });
  });
}

const sharedFiles = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __shared: { name: string; type: string; size: number; files: number }[] }).__shared,
  );

/** The symbol of the save button: share or save (REQ-680). */
const buttonAction = (button: Locator) => button.getAttribute("data-action");

test.describe("file name with date and place, share on a phone or tablet (REQ-680, REQ-683, REQ-766)", () => {
  test.use({ timezoneId: "UTC" });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  });

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1280, height: 900 } });
    ownDevice();

    test("keeps the save symbol, also where files could be shared, and downloads YYMMDD_<place>.png", async ({
      page,
    }) => {
      await fakeShareSheet(page);
      await page.addInitScript(() => {
        Reflect.deleteProperty(window, "showSaveFilePicker");
      });
      await page.goto(APP);
      const save = card(page).getByRole("button", { name: SAVE });
      await expect(save).toBeVisible();
      expect(await buttonAction(save)).toBe("save");
      await expect(page.getByRole("button", { name: SHARE })).toHaveCount(0);
      const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
      expect(download.suggestedFilename()).toBe("261107_Mont_Blanc.png");
      await expect(card(page).getByRole("status").filter({ hasText: "Picture saved" })).toBeVisible();
      expect(await sharedFiles(page)).toEqual([]);
    });
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "de-DE" });
    ownDevice();

    test("shows the share symbol and shares the PNG named after date and place", async ({ page }) => {
      // A place with an umlaut, ß and a space: replaced in the file name (REQ-683).
      await page.route("**/config.json", (route) =>
        route.fulfill({
          json: { startLocation: { name: "Großglockner Hütte", lat: 47.0742, lon: 12.6947, elevation: 3798 } },
        }),
      );
      await fakeShareSheet(page);
      let downloads = 0;
      page.on("download", () => downloads++);
      await page.goto(APP);
      const share = footer(page).getByRole("button", { name: "Bild teilen" });
      await expect(share).toBeVisible();
      await expect(share).toHaveAttribute("title", "Bild teilen");
      expect(await buttonAction(share)).toBe("share");
      await expect(footer(page).getByRole("button", { name: "Bild in den Fotos speichern" })).toHaveCount(0);
      // The share symbol: an arrow up out of an open box, not the picture with the arrow down.
      await expect(share.locator("svg path")).toHaveCount(3);
      await share.tap();
      await expect(footer(page).getByRole("status").filter({ hasText: "Bild geteilt" })).toBeVisible();
      const files = await sharedFiles(page);
      expect(files).toEqual([
        { name: "261107_Grossglockner_Huette.png", type: "image/png", size: expect.any(Number), files: 1 },
      ]);
      expect(files[0]!.size).toBeGreaterThan(10_000);
      expect(downloads).toBe(0);
    });

    test("without the Web Share API keeps the save symbol and downloads the PNG", async ({ page }) => {
      await page.addInitScript(() => {
        Reflect.deleteProperty(Navigator.prototype, "share");
        Reflect.deleteProperty(Navigator.prototype, "canShare");
      });
      await page.goto(APP);
      const save = footer(page).getByRole("button", { name: "Bild in den Fotos speichern" });
      await expect(save).toBeVisible();
      expect(await buttonAction(save)).toBe("save");
      await expect(footer(page).getByRole("button", { name: "Bild teilen" })).toHaveCount(0);
      const [download] = await Promise.all([page.waitForEvent("download"), save.tap()]);
      expect(download.suggestedFilename()).toBe("261107_Mont_Blanc.png");
      await expect(footer(page).getByRole("status").filter({ hasText: "Bild gespeichert" })).toBeVisible();
      const file = pngInfo(new Uint8Array(await readFile(await download.path())));
      expect(file.signature).toBe("PNG");
    });
  });

  test.describe("tablet", () => {
    test.use({ viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true, locale: "de-DE" });
    ownDevice();

    test("shares the PNG named YYMMDD_<place>.png without an infix (REQ-766)", async ({ page }) => {
      await fakeShareSheet(page);
      await page.goto(APP);
      const share = page.getByRole("button", { name: "Bild teilen" }).first();
      await expect(share).toBeVisible();
      await share.tap();
      await expect(page.getByRole("status").filter({ hasText: "Bild geteilt" }).first()).toBeVisible();
      expect(await sharedFiles(page)).toEqual([
        { name: "261107_Mont_Blanc.png", type: "image/png", size: expect.any(Number), files: 1 },
      ]);
    });
  });
});

/**
 * The card's buttons stand top-aligned, one below the other, to the right of the chart (REQ-507); on the desktop in
 * the room right of the plot (REQ-613), on a narrow window beside the chart's scrolling region.
 */
async function expectButtonColumn(page: Page, names: string[]) {
  const scroll = (await card(page).getByTestId("meteogram-scroll").boundingBox())!;
  const plotRight = await card(page)
    .locator("svg.meteogram-svg-integrated .temperature-plot-area")
    .evaluate((element) => element.getBoundingClientRect().right);
  const boxes = [];
  for (const name of names) {
    const button = card(page).getByRole("button", { name });
    await expect(button).toBeVisible();
    boxes.push((await button.boundingBox())!);
  }
  for (const box of boxes) expect(box.x).toBeGreaterThanOrEqual(Math.min(plotRight, scroll.x + scroll.width));
  expect(boxes[0]!.y).toBeLessThan(scroll.y + 8);
  for (let index = 1; index < boxes.length; index++) {
    expect(Math.abs(boxes[index]!.x - boxes[0]!.x)).toBeLessThan(1);
    expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height);
  }
}

for (const { name, viewport, isMobile, buttons } of [
  // Copy, save (REQ-597), full screen.
  {
    name: "desktop 1280 px",
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    buttons: [COPY, SAVE, FULLSCREEN],
  },
  // A narrow desktop window is no phone: the column stays.
  {
    name: "narrow desktop 360 px",
    viewport: { width: 360, height: 780 },
    isMobile: false,
    buttons: [COPY, SAVE, FULLSCREEN],
  },
]) {
  test.describe(name, () => {
    test.use({ viewport, isMobile, hasTouch: isMobile });
    ownDevice();

    test("no visible heading; the buttons stand in a column right of the chart (REQ-507)", async ({ page }) => {
      await page.goto(APP);
      await expect(card(page).getByTestId("meteogram-scroll")).toBeVisible();
      // The card keeps its name for assistive technology, but shows no heading.
      await expect(card(page).getByRole("heading")).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Meteogram" })).toHaveAttribute("data-testid", "meteogram-card");
      await expectButtonColumn(page, buttons);

      // The page does not scroll sideways; the chart scrolls inside its region and the buttons stay in place.
      const widths = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
      const cardBox = (await card(page).boundingBox())!;
      const lastBox = (await card(page).getByRole("button", { name: buttons.at(-1)! }).boundingBox())!;
      expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      await card(page).getByTestId("meteogram-scroll").evaluate((element) => (element.scrollLeft = 200));
      await expectButtonColumn(page, buttons);
      // Not in the footer row (REQ-541 is for phones only).
      await expect(footer(page).getByRole("button", { name: COPY })).toHaveCount(0);

      await card(page).getByRole("button", { name: FULLSCREEN }).click();
      await expect(fullscreen(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(fullscreen(page)).toHaveCount(0);
      await expect(card(page).getByRole("button", { name: FULLSCREEN })).toBeFocused();
    });
  });
}

/**
 * On a phone the copy and save buttons stand in the footer's row (REQ-541), at its right edge (REQ-550); since REQ-582
 * alone: info, imprint and privacy are in the menu at the end of the place row (REQ-580). The chart takes the card's
 * whole width. In light and dark mode.
 */
for (const scheme of ["light", "dark"] as const) {
  for (const { viewport, locale, menu: menuName, links: names } of [
    { viewport: { width: 375, height: 812 }, locale: "en-GB", menu: "Menu", links: ["Info", "Legal notice", "Privacy"] },
    { viewport: { width: 375, height: 812 }, locale: "de-DE", menu: "Menü", links: ["Info", "Impressum", "Datenschutz"] },
  ]) {
    test.describe(`phone ${viewport.width} px, ${locale}, ${scheme}`, () => {
      test.use({ viewport, locale, isMobile: true, hasTouch: true, colorScheme: scheme });
      ownDevice();
      const copyName = locale === "de-DE" ? "Meteogramm als Bild kopieren" : COPY;
      const saveName = locale === "de-DE" ? "Bild in den Fotos speichern" : SAVE;

      test("copy and save at the start of the footer row, the source after them, the links in the menu (REQ-541, REQ-582, REQ-729)", async ({
        page,
      }) => {
        await page.goto(APP);
        await expect(card(page).getByTestId("meteogram-scroll")).toBeVisible();
        const row = footer(page);
        const copy = row.getByRole("button", { name: copyName });
        const save = row.getByRole("button", { name: saveName });
        await expect(copy).toBeVisible();
        await expect(copy).toHaveAttribute("title", copyName);
        await expect(save).toBeVisible();
        await expect(page.getByTestId("meteogram-tools")).toHaveCount(0);
        await expect(buttonsBesideModelInfo(card(page))).toHaveCount(0);
        await expect(row.getByRole("button")).toHaveCount(2);
        await expect(row.getByRole("navigation")).toHaveCount(0);

        const footerBox = (await row.boundingBox())!;
        const copyBox = (await copy.boundingBox())!;
        const saveBox = (await save.boundingBox())!;
        // The buttons at the left edge, side by side on one line; the data source after them, right-aligned (REQ-729).
        expect(Math.abs(copyBox.x - footerBox.x)).toBeLessThan(2);
        expect(saveBox.x).toBeGreaterThanOrEqual(copyBox.x + copyBox.width);
        expect(Math.abs(saveBox.y - copyBox.y)).toBeLessThan(2);
        const sourceBox = (await row.getByTestId("meteogram-source").boundingBox())!;
        expect(sourceBox.x).toBeGreaterThanOrEqual(saveBox.x + saveBox.width);
        expect(Math.abs(sourceBox.x + sourceBox.width - (footerBox.x + footerBox.width))).toBeLessThan(2);

        // Info, imprint and privacy are in the menu of the place row.
        await page.locator('[data-region="location"]').getByRole("button", { name: menuName }).click();
        const panel = page.getByTestId("phone-menu-panel");
        await expect(panel.getByRole("button").last()).toHaveText(names.at(-1)!);
        for (const name of names) await expect(panel.getByRole("button", { name, exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();

        // The chart takes the card's whole width.
        const cardBox = (await card(page).boundingBox())!;
        const scrollBox = (await card(page).getByTestId("meteogram-scroll").boundingBox())!;
        expect(Math.abs(scrollBox.x - cardBox.x)).toBeLessThan(1);
        expect(Math.abs(scrollBox.width - cardBox.width)).toBeLessThan(1);

        // Focus order as on screen: copy, then save.
        await copy.focus();
        await page.keyboard.press("Tab");
        await expect(save).toBeFocused();

        const widths = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
      });
    });
  }
}

/** Captures the chart markup the PNG export rasterises (the serialised export SVG). */
async function captureExportSvg(page: Page) {
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
}

const lastExportSvg = (page: Page) =>
  page.evaluate(() => (window as unknown as { __exportSvgs: string[] }).__exportSvgs.at(-1) ?? "");
const count = (markup: string, testId: string) => markup.split(`data-testid="${testId}"`).length - 1;

test.describe("picture of the whole forecast on a phone", () => {
  test.use({ viewport: { width: 375, height: 780 }, isMobile: true, hasTouch: true });
  ownDevice();

  for (const modelHeaders of [true, false]) {
    test(`has wind arrows as dense as a wide screen; model headers as on screen, ${modelHeaders ? "with" : "without"} (REQ-538, REQ-539, DEC-094)`, async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
      // imageModelHeaders has no effect for now: the picture follows the model headers on screen (DEC-094).
      await page.route("**/config.json", (route) =>
        route.fulfill({
          json: { daySlider: { enabled: false, days: "all" }, modelHeaders, imageModelHeaders: !modelHeaders },
        }),
      );
      await captureExportSvg(page);
      await page.goto(APP);
      const chart = card(page).locator("svg.meteogram-svg-integrated");
      await expect(chart).toBeVisible();
      const start = Date.parse((await chart.getAttribute("data-visible-start-time"))!);
      const end = Date.parse((await chart.getAttribute("data-visible-end-time"))!);
      const days = (end - start) / 86_400_000;
      expect(days).toBeGreaterThan(10);
      // In portrait the chart is as wide as 4.5 days a screen (REQ-554), so it already has room for its arrows; it
      // shows the model headers as modelHeaders says.
      const onScreen = await chart.locator('[data-testid="wind-arrow"]').count();
      const headers = chart.locator('[data-testid="model-header-label"]');
      if (modelHeaders) await expect(headers.first()).toBeAttached();
      else await expect(headers).toHaveCount(0);

      // On a phone the button stands in the footer row (REQ-541).
      await page.getByRole("button", { name: COPY }).click();
      await expect(page.getByRole("status").filter({ hasText: "Meteogram copied" })).toBeVisible();
      const markup = await lastExportSvg(page);
      expect(count(markup, "wind-arrow") / days).toBeGreaterThanOrEqual(2.5);
      expect(count(markup, "model-header-label") > 0).toBe(modelHeaders);
      const png = await readClipboardPng(page);
      expect(png).not.toBeNull();

      // The chart on screen is unchanged.
      await expect(card(page).locator("svg.meteogram-svg-integrated")).toHaveCount(1);
      expect(await chart.locator('[data-testid="wind-arrow"]').count()).toBe(onScreen);
      expect((await headers.count()) > 0).toBe(modelHeaders);
    });
  }
});
