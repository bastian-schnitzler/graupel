// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Install steps with pictures (REQ-775): in a browser without install prompt, "Install" shows the numbered steps of
 * exactly this device and browser, each with a drawn picture, in light and dark. Each class runs with the user agents
 * of its devices, set on the project's own device (the page reads `navigator`): the phone as an iPhone in Safari
 * (iOS 18, and iOS 26 with its own reference pictures, REQ-808) and in Chrome, the tablet as an iPad in Safari (which
 * asks for desktop pages with a Mac's user agent and tells itself apart by its touch screen), the desktop as a Mac in
 * Safari and as Windows in Firefox, which cannot install and keeps the hint without pictures (REQ-658). Each starts
 * with why to install (REQ-806), a list without heading (REQ-843), also part of the reference pictures. Safari from
 * iOS 26 on the iPhone has four steps, with "Show More" in the share sheet (REQ-844). Firefox on Android (phone and
 * tablet) has four steps too, with "More" in its menu sheet before "Add app to Home screen" (REQ-847). The second
 * reason names the browser's address and navigation bars (REQ-852); no hint or footnote "Show More" (DEC-179).
 */
import { expect, test, type DeviceClass, type Locator, type Page } from "./fixtures.ts";
import { headerControl } from "./headerControls.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Thursday, 12 November 2026, 10:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 12, 10);

const AGENTS = {
  iphoneSafari18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  // iOS 26 keeps the OS at 18_6 in Safari's user agent; the real version is in Version/.
  iphoneSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  // Safari on the iPad and on the Mac send the same user agent; only the iPad has a touch screen.
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  androidFirefox: "Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0",
  androidFirefoxTablet: "Mozilla/5.0 (Android 14; Tablet; rv:145.0) Gecko/145.0 Firefox/145.0",
  // iOS 26 in Chrome (OS not frozen) and Safari on the iPad (real version in Version/): the share sheet of iOS 26.
  iphoneChrome26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.128 Mobile/15E148 Safari/604.1",
  ipadSafari26:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
} as const;

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  // Like Safari and Firefox, which do not know beforeinstallprompt.
  await page.addInitScript(() => {
    delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
    delete (Window.prototype as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** The browser's user agent and touch points as the page reads them, on the project's device. */
async function asBrowser(page: Page, userAgent: string, maxTouchPoints: number) {
  await page.addInitScript(
    ([ua, touch]) => {
      Object.defineProperty(navigator, "userAgent", { get: () => ua });
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => touch });
      // Safari and Firefox have no client hints.
      Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
    },
    [userAgent, maxTouchPoints] as const,
  );
}

/** Opens "Install" (the header's download button, on the phone the menu's entry) and returns its dialog. */
async function openInstall(page: Page) {
  await page.goto(APP);
  await (await headerControl(page, "button", /^(Download|Install app)$/)).click();
  const dialog = page.getByRole("dialog", { name: "Install Graupel as an app" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const pictures = (dialog: Locator) => dialog.locator("li svg[data-picture]");

/**
 * Why install (REQ-806): two points at the top of the dialog, above `below` (the steps or the hint); since REQ-843 a
 * list without heading, the dialog's title its only heading. The dialog stays on the screen and scrolls inside if it
 * must.
 */
async function expectReasonsFirst(dialog: Locator, below: Locator) {
  const why = dialog.getByTestId("install-why");
  await expect(why).toBeVisible();
  await expect(dialog.getByRole("heading")).toHaveText(["Install Graupel as an app"]);
  await expect(dialog).not.toContainText("Why install?");
  expect(await why.evaluate((list) => list.tagName === "UL" && list.parentElement?.firstElementChild === list)).toBe(true);
  await expect(why.getByRole("listitem")).toHaveCount(2);
  await expect(why.getByRole("listitem").first()).toContainText("offline");
  // REQ-852: the second reason names the browser's address and navigation bars.
  await expect(why.getByRole("listitem").last()).toHaveText(
    "A better view on phone and tablet, without the browser’s address and navigation bars.",
  );
  const whyBox = (await why.boundingBox())!;
  const belowBox = (await below.boundingBox())!;
  expect(whyBox.y + whyBox.height).toBeLessThanOrEqual(belowBox.y);
  const viewport = dialog.page().viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

/** Checks the steps of a guide: three (or four) pictures, each with its highlight, numbered, with a line of text. */
async function expectSteps(dialog: Locator, guide: string, first: string, count = 3) {
  await expect(dialog.locator("[data-guide]")).toHaveAttribute("data-guide", guide);
  await expect(pictures(dialog)).toHaveCount(count);
  await expect(pictures(dialog).first()).toHaveAttribute("data-picture", first);
  for (const picture of await pictures(dialog).all()) {
    await expect(picture).toBeVisible();
    const box = (await picture.boundingBox())!;
    expect(box.width).toBeGreaterThan(80);
    await expect(picture.locator("[data-hit]").first()).toBeAttached();
  }
  await expect(dialog.locator(".install-step__number")).toHaveText(Array.from({ length: count }, (_, index) => String(index + 1)));
  // Nothing wider than the dialog.
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectReasonsFirst(dialog, dialog.locator("[data-guide]"));
}

/** Colours of the picture's screen and frame: the page's own, so they follow the light or dark design. */
async function pictureColours(dialog: Locator) {
  return pictures(dialog)
    .first()
    .evaluate((svg) => ({
      screen: getComputedStyle(svg.querySelector(".ip-screen")!).fill,
      frame: getComputedStyle(svg.querySelector(".ip-frame")!).stroke,
      page: getComputedStyle(document.body).backgroundColor,
    }));
}

/** Per class the user agent whose dialog is the reference picture, light and dark. */
const REFERENCE: Record<DeviceClass, { agent: string; touch: number; guide: string }> = {
  phone: { agent: AGENTS.iphoneChrome, touch: 5, guide: "iosChrome" },
  tablet: { agent: AGENTS.ipadSafari, touch: 5, guide: "ipadSafari" },
  desktop: { agent: AGENTS.macSafari, touch: 0, guide: "macSafari" },
};

test.describe("install steps with pictures (REQ-775)", () => {
  test("phone: iPhone Safari up to iOS 18, Share in the bar at the bottom", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "phone", "an iPhone's user agent on the phone");
    await asBrowser(page, AGENTS.iphoneSafari18, 5);
    const dialog = await openInstall(page);
    await expectSteps(dialog, "iphoneSafari", "safariBarBottom");
    await expect(dialog.getByText("How to do it in Safari on the iPhone:")).toBeVisible();
    await expect(dialog.getByText("Tap Share in the bar at the bottom")).toBeVisible();
    await expect(dialog.getByText("Choose “Add to Home Screen”, then “Add”")).toBeVisible();
    // No footnote "Show More" (DEC-179).
    await expect(dialog.locator("sup, .install-dialog__footnote")).toHaveCount(0);
  });

  // REQ-808: the page cannot tell Safari's bars apart (Compact with Share in "…", Bottom and Top with Share in the bar),
  // so step 1 names Share in the bar first and "…" second; its picture highlights Share in the toolbar at the bottom.
  // REQ-844: the share sheet of iOS 26 lists Add to Home Screen only after "Show More", step 2 with its own picture.
  for (const scheme of ["light", "dark"] as const) {
    test(`phone: iPhone Safari from iOS 26 (OS frozen at 18_6), Share in the bar first, then “…” (REQ-808), then “Show More” (REQ-844), ${scheme}`, async ({
      page,
      deviceClass,
    }) => {
      test.skip(deviceClass !== "phone", "an iPhone's user agent on the phone");
      await page.emulateMedia({ colorScheme: scheme });
      await asBrowser(page, AGENTS.iphoneSafari26, 5);
      const dialog = await openInstall(page);
      await expectSteps(dialog, "iphoneSafari26", "safariShareOrMore", 4);
      expect(await pictures(dialog).evaluateAll((svgs) => svgs.map((svg) => svg.getAttribute("data-picture")))).toEqual([
        "safariShareOrMore",
        "shareSheetMore",
        "shareSheet",
        "homeScreen",
      ]);
      await expect(dialog.locator(".install-step__text")).toHaveText([
        "Tap Share in the bar at the bottom (with the compact bar, tap “…” first)",
        "In the row with “Copy”, tap “Show More”",
        "Choose “Add to Home Screen”, then “Add”",
        "Graupel starts from the Home Screen",
      ]);
      // The step replaces the note that said to look under "More", so no footnote either (DEC-179).
      await expect(dialog.locator(".install-dialog__note")).toHaveCount(0);
      await expect(dialog.locator("sup")).toHaveCount(0);
      // The highlight sits on Share, the middle button of the toolbar at the bottom of the picture; "…" is the smaller,
      // dashed hint in its inset above.
      const picture = pictures(dialog).first();
      const frame = (await picture.boundingBox())!;
      const hits = picture.locator("[data-hit]");
      await expect(hits).toHaveCount(1);
      const hit = (await hits.boundingBox())!;
      expect(Math.abs(hit.x + hit.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(1);
      expect(hit.y + hit.height).toBeGreaterThan(frame.y + frame.height * 0.9);
      const hint = (await picture.locator("[data-hint]").boundingBox())!;
      expect(hint.width).toBeLessThan(hit.width);
      expect(hint.y + hint.height).toBeLessThan(hit.y);
      // Step 2 (REQ-844): "Show More" named in the picture, highlighted at the right end of the row of actions.
      const more = pictures(dialog).nth(1);
      await expect(more).toContainText("Show");
      await expect(more).toContainText("More");
      const moreFrame = (await more.boundingBox())!;
      const moreHit = (await more.locator("[data-hit]").boundingBox())!;
      expect(moreHit.x + moreHit.width / 2).toBeGreaterThan(moreFrame.x + moreFrame.width * 0.75);
      expect(moreHit.y).toBeGreaterThan(moreFrame.y + moreFrame.height * 0.55);
      // Two by two on the phone, the dialog scrolling inside if it must.
      const boxes = await Promise.all((await pictures(dialog).all()).map(async (svg) => (await svg.boundingBox())!));
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
      expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height);
      await expect(dialog).toHaveScreenshot(`install-steps-phone-ios26-${scheme}.png`, { animations: "disabled", caret: "hide" });
      // Steps 3 and 4 below: the dialog's body scrolled to its end, also a reference picture.
      await dialog.locator(".dialog__body").evaluate((body) => body.scrollTo(0, body.scrollHeight));
      await expect(dialog.locator(".install-step").last()).toBeInViewport();
      await expect(dialog).toHaveScreenshot(`install-steps-phone-ios26-end-${scheme}.png`, { animations: "disabled", caret: "hide" });
    });
  }

  /** Firefox on Android (REQ-847): menu "⋮", "More" in its sheet, "Add app to Home screen", the home screen. */
  async function expectFirefoxAndroid(dialog: Locator) {
    await expectSteps(dialog, "androidFirefox", "androidMenu", 4);
    expect(await pictures(dialog).evaluateAll((svgs) => svgs.map((svg) => svg.getAttribute("data-picture")))).toEqual([
      "androidMenu",
      "firefoxMore",
      "firefoxAdd",
      "androidHome",
    ]);
    await expect(dialog.getByText("How to do it in Firefox on Android:")).toBeVisible();
    await expect(dialog.locator(".install-step__text")).toHaveText([
      "Tap the menu “⋮”",
      "In the menu, tap “More”",
      "Choose “Add app to Home screen”",
      "Graupel starts from the Home screen",
    ]);
    await expect(dialog).not.toContainText(/Safari|iPhone|iPad/);
    // Step 1: "⋮" at the top right.
    const menu = pictures(dialog).first();
    const menuFrame = (await menu.boundingBox())!;
    const menuHit = (await menu.locator("[data-hit]").boundingBox())!;
    expect(menuHit.x).toBeGreaterThan(menuFrame.x + menuFrame.width * 0.8);
    expect(menuHit.y + menuHit.height).toBeLessThan(menuFrame.y + menuFrame.height * 0.2);
    // Steps 2 and 3: the highlighted card of the sheet carries the entry's name.
    for (const [index, name] of [
      [1, "More"],
      [2, "Add app to Home screen"],
    ] as const) {
      const picture = pictures(dialog).nth(index);
      await picture.scrollIntoViewIfNeeded();
      const hits = picture.locator("[data-hit]");
      await expect(hits).toHaveCount(1);
      const entry = picture.locator("[data-entry]");
      expect((await entry.textContent())?.replace(/\s/g, "")).toBe(name.replace(/\s/g, ""));
      const frame = (await picture.boundingBox())!;
      const hit = (await hits.boundingBox())!;
      const label = (await entry.locator("text").boundingBox())!;
      expect(hit.width).toBeGreaterThan(frame.width * 0.8);
      expect(hit.y).toBeGreaterThan(frame.y + frame.height * 0.55);
      expect(label.x).toBeGreaterThanOrEqual(hit.x);
      expect(label.y).toBeGreaterThanOrEqual(hit.y);
      expect(label.x + label.width).toBeLessThanOrEqual(hit.x + hit.width);
      expect(label.y + label.height).toBeLessThanOrEqual(hit.y + hit.height);
    }
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`phone: Firefox on Android, menu › “More” › “Add app to Home screen” (REQ-847), ${scheme}`, async ({ page, deviceClass }) => {
      test.skip(deviceClass !== "phone", "an Android phone's user agent on the phone");
      await page.emulateMedia({ colorScheme: scheme });
      await asBrowser(page, AGENTS.androidFirefox, 5);
      const dialog = await openInstall(page);
      await expectFirefoxAndroid(dialog);
      // All four steps fit on the phone without scrolling.
      await expect(dialog.locator(".install-step").last()).toBeInViewport();
      await expect(dialog).toHaveScreenshot(`install-steps-phone-firefox-android-${scheme}.png`, { animations: "disabled", caret: "hide" });
    });
  }

  test("tablet: Firefox on an Android tablet, the same four steps (REQ-847)", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "tablet", "an Android tablet's user agent on the tablet");
    await asBrowser(page, AGENTS.androidFirefoxTablet, 10);
    const dialog = await openInstall(page);
    await expectFirefoxAndroid(dialog);
  });

  test("German page, Firefox on Android: “Mehr” and “App zum Startbildschirm hinzufügen” as in the browser (REQ-847)", async ({
    page,
    deviceClass,
  }) => {
    test.skip(deviceClass !== "phone", "an Android phone's user agent on the phone");
    await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
    await asBrowser(page, AGENTS.androidFirefox, 5);
    await page.goto(APP);
    await (await headerControl(page, "button", /^(Download|App installieren)$/)).click();
    const dialog = page.getByRole("dialog", { name: "Graupel als App installieren" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".install-step__text")).toHaveText([
      "Auf das Menü „⋮“ tippen",
      "Im Menü auf „Mehr“ tippen",
      "„App zum Startbildschirm hinzufügen“ wählen",
      "Graupel startet vom Startbildschirm",
    ]);
    await expect(dialog.locator('svg[data-picture="firefoxMore"] [data-entry]')).toHaveText("Mehr");
    expect((await dialog.locator('svg[data-picture="firefoxAdd"] [data-entry]').textContent())?.replace(/\s/g, "")).toBe(
      "AppzumStartbildschirmhinzufügen",
    );
  });

  test("phone: iPhone Chrome, Share in the address bar, no word of Safari", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "phone", "an iPhone's user agent on the phone");
    await asBrowser(page, AGENTS.iphoneChrome, 5);
    const dialog = await openInstall(page);
    await expectSteps(dialog, "iosChrome", "addressShare");
    await expect(dialog.getByText("How to do it in Chrome on the iPhone:")).toBeVisible();
    await expect(dialog.getByText("Tap Share on the right of the address bar")).toBeVisible();
    await expect(dialog).not.toContainText("Safari");
    // No footnote "Show More" (DEC-179).
    await expect(dialog.locator("sup")).toHaveCount(0);
  });

  test("tablet: iPad Safari with the Mac's user agent, Share at the top right", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "tablet", "an iPad's user agent on the tablet");
    await asBrowser(page, AGENTS.ipadSafari, 5);
    const dialog = await openInstall(page);
    await expectSteps(dialog, "ipadSafari", "safariBarTop");
    await expect(dialog.getByText("How to do it in Safari on the iPad:")).toBeVisible();
    await expect(dialog.getByText("Tap Share at the top right")).toBeVisible();
    await expect(dialog).not.toContainText(/Mac|Dock/);
  });

  test("desktop: Mac Safari, File › Add to Dock", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "desktop", "a Mac's user agent on the desktop");
    await asBrowser(page, AGENTS.macSafari, 0);
    const dialog = await openInstall(page);
    await expectSteps(dialog, "macSafari", "macMenuBar");
    await expect(dialog.getByText("How to do it in Safari on the Mac:")).toBeVisible();
    await expect(dialog.getByText("Choose “Add to Dock…”, then “Add”")).toBeVisible();
    // The menu and its entry are named in the picture, in the page's language.
    await expect(dialog.locator('svg[data-picture="macFileMenu"]')).toContainText("File");
    await expect(dialog.locator('svg[data-picture="macFileMenu"]')).toContainText("Dock");
    await expect(dialog).not.toContainText(/iPhone|iPad/);
  });

  // REQ-847 leaves Firefox on the desktop as it was: the hint without pictures.
  test("desktop: Windows Firefox cannot install, the hint without pictures (REQ-658, REQ-847)", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "desktop", "a Windows user agent on the desktop");
    await asBrowser(page, AGENTS.windowsFirefox, 0);
    const dialog = await openInstall(page);
    await expect(dialog.locator("[data-platform]")).toHaveAttribute("data-platform", "desktop");
    await expect(dialog.locator("[data-platform]")).toHaveText(
      "This browser cannot install Graupel as an app. Open the page in Chrome or Edge and use “Install” in the address bar or the menu.",
    );
    await expect(dialog.locator("svg[data-picture]")).toHaveCount(0);
    await expectReasonsFirst(dialog, dialog.locator("[data-platform]"));
  });

  test("German page: menu names of the pictures in German", async ({ page, deviceClass }) => {
    const { agent, touch } = REFERENCE[deviceClass];
    await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
    await asBrowser(page, agent, touch);
    await page.goto(APP);
    await (await headerControl(page, "button", /^(Download|App installieren)$/)).click();
    const dialog = page.getByRole("dialog", { name: "Graupel als App installieren" });
    await expect(dialog).toBeVisible();
    const words = { phone: "Home-", tablet: "Home-", desktop: "Ablage" }[deviceClass];
    await expect(dialog.locator("svg[data-picture]").nth(deviceClass === "desktop" ? 0 : 1)).toContainText(words);
  });

  test("German page, iPhone Safari from iOS 26: “Mehr anzeigen” in step 2 and its picture (REQ-844)", async ({ page, deviceClass }) => {
    test.skip(deviceClass !== "phone", "an iPhone's user agent on the phone");
    await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
    await asBrowser(page, AGENTS.iphoneSafari26, 5);
    await page.goto(APP);
    await (await headerControl(page, "button", /^(Download|App installieren)$/)).click();
    const dialog = page.getByRole("dialog", { name: "Graupel als App installieren" });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("Warum installieren?");
    await expect(dialog.locator(".install-step__text").nth(1)).toHaveText("In der Reihe mit „Kopieren“ auf „Mehr anzeigen“ tippen");
    await expect(dialog.locator('svg[data-picture="shareSheetMore"]')).toContainText("Mehr");
    await expect(dialog.locator('svg[data-picture="shareSheetMore"]')).toContainText("anzeigen");
    await expect(dialog.locator(".install-step__text").nth(2)).toHaveText("„Zum Home-Bildschirm“ wählen, dann „Hinzufügen“");
  });

  /**
   * DEC-179: the share sheet of iOS 26 gets no hint "Show More", neither as a note nor as a footnote (Safari on the
   * iPhone has the step of its own since REQ-844). Per class the user agent of its devices with iOS 26, Chrome on the
   * iPhone and Safari on the iPad; the desktop window shows the iPad's dialog at its widest.
   */
  const IOS26: Record<DeviceClass, { agent: string; guide: string; first: string; browser: string; device: string }> = {
    phone: { agent: AGENTS.iphoneChrome26, guide: "iosChrome", first: "addressShare", browser: "Chrome", device: "iPhone" },
    tablet: { agent: AGENTS.ipadSafari26, guide: "ipadSafari", first: "safariBarTop", browser: "Safari", device: "iPad" },
    desktop: { agent: AGENTS.ipadSafari26, guide: "ipadSafari", first: "safariBarTop", browser: "Safari", device: "iPad" },
  };

  /** No superscript number and no footnote line anywhere in the dialog, no step pointing to one (DEC-179). */
  async function expectNoFootnote(dialog: Locator) {
    await expect(dialog.locator("sup, .install-dialog__footnote, [data-footnote], [data-footnote-ref]")).toHaveCount(0);
    await expect(dialog.locator(".install-step[aria-describedby]")).toHaveCount(0);
  }

  test("iOS 26 share sheet without a step “Show More”: no footnote, three plain steps (REQ-852, DEC-179)", async ({
    page,
    deviceClass,
  }) => {
    const { agent, guide, first, browser, device } = IOS26[deviceClass];
    await asBrowser(page, agent, 5);
    const dialog = await openInstall(page);
    await expectSteps(dialog, guide, first);
    await expect(dialog.getByText(`How to do it in ${browser} on the ${device}:`)).toBeVisible();
    await expect(dialog.locator(".install-step__text").nth(1)).toHaveText("Choose “Add to Home Screen”, then “Add”");
    await expectNoFootnote(dialog);
    await expect(dialog).not.toContainText("Show More");
  });

  test("German page: “Adress- und Navigationsleiste”, no footnote “Mehr anzeigen” (REQ-852, DEC-179)", async ({ page, deviceClass }) => {
    const { agent } = IOS26[deviceClass];
    await page.addInitScript(() => localStorage.setItem("graupel.language", "de"));
    await asBrowser(page, agent, 5);
    await page.goto(APP);
    await (await headerControl(page, "button", /^(Download|App installieren)$/)).click();
    const dialog = page.getByRole("dialog", { name: "Graupel als App installieren" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("install-why").getByRole("listitem").last()).toHaveText(
      "Bessere Darstellung auf Telefon und Tablet, ohne Adress- und Navigationsleiste des Browsers.",
    );
    await expect(dialog.locator(".install-step__text").nth(1)).toHaveText("„Zum Home-Bildschirm“ wählen, dann „Hinzufügen“");
    await expectNoFootnote(dialog);
    await expect(dialog).not.toContainText("Mehr anzeigen");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`reference picture of the dialog, ${scheme}`, async ({ page, deviceClass }, testInfo) => {
      const { agent, touch, guide } = REFERENCE[deviceClass];
      await page.emulateMedia({ colorScheme: scheme });
      await asBrowser(page, agent, touch);
      const dialog = await openInstall(page);
      await expectSteps(dialog, guide, { phone: "addressShare", tablet: "safariBarTop", desktop: "macMenuBar" }[deviceClass]);
      // The drawing takes the page's colours: its screen is the page's background, light or dark.
      const colours = await pictureColours(dialog);
      expect(colours.screen).toBe(colours.page);
      expect(colours.frame).toBe(scheme === "dark" ? "rgb(47, 58, 70)" : "rgb(213, 219, 226)");
      await expect(dialog).toHaveScreenshot(`install-steps-${testInfo.project.name}-${scheme}.png`, {
        animations: "disabled",
        caret: "hide",
      });
    });
  }
});
