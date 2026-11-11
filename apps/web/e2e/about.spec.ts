// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Favicon and logo in a real browser (REQ-424), the About tab with its entries (one per map, REQ-646) and the license
 * popups (third-party licenses, REQ-514; the GPL as text instead of a download, REQ-647).
 */
import { expect, test } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { headerControl } from "./headerControls.ts";

const APP = "http://localhost:4175/";

test.use({ locale: "en-GB" });

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

test("favicon and touch icons resolve", async ({ page, request }) => {
  await page.goto(APP);
  const icons = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) => links.map((link) => [link.getAttribute("type"), (link as HTMLLinkElement).href]));
  expect(icons.map(([type]) => type)).toEqual(["image/svg+xml", "image/png", null]);
  for (const [type, href] of icons) {
    const response = await request.get(href!);
    expect(response.status(), href!).toBe(200);
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType, href!).toContain(type ?? "image/png");
  }
  for (const name of ["icon-192", "icon-512", "icon-192-maskable", "icon-512-maskable", "logo-192"]) {
    const response = await request.get(new URL(`icons/${name}.png`, APP).href);
    expect(response.status(), name).toBe(200);
  }
});

for (const width of [375, 1280]) {
  test(`About tab shows the logo, nowhere else (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    await expect(page.locator('[data-region="header"]')).toBeVisible();
    await expect(page.getByRole("img")).toHaveCount(0);

    await (await headerControl(page, "button", "Info")).click();
    const dialog = page.getByRole("dialog", { name: "Information" });
    const logo = dialog.getByRole("img", { name: "Graupel logo" });
    await expect(logo).toBeVisible();
    // The image may still be loading alongside the model data.
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(192);
    await expect(dialog.getByRole("heading", { name: "Graupel" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "github.com/bastian-schnitzler/graupel" })).toHaveAttribute(
      "href",
      "https://github.com/bastian-schnitzler/graupel",
    );
    await expect(dialog.getByRole("link", { name: "Open-Meteo.com" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
    await expect(dialog.getByTestId("about-data-license")).toHaveText(
      "Licence: CC BY 4.0. The data were harmonised (units, timestamps) and combined from several weather models into one timeline.",
    );
    await expect(dialog.getByTestId("about-data-license")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "OpenTopoMap" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "GPL-3.0-or-later" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Third-party licenses" })).toBeVisible();
    // The weather data are the last entry, after maps and license (REQ-491, REQ-646).
    await expect(dialog.locator(".about__facts > dt")).toHaveText([
      "Version",
      "Source code",
      "Map OpenTopoMap",
      "Map Maptoolkit",
      "License",
      "Weather data",
    ]);
    await expect(dialog.locator(".about__facts > dd").last()).toHaveAttribute("data-testid", "about-data");
    const lastLinks = await dialog
      .locator(".about__facts a")
      .evaluateAll((links) => links.slice(-2).map((link) => link.textContent));
    expect(lastLinks).toEqual(["Open-Meteo.com", "CC BY 4.0"]);
    const order = await dialog.evaluate((root) => {
      const top = (selector: string) => root.querySelector(selector)!.getBoundingClientRect().top;
      return { data: top('[data-testid="about-data"]'), license: top('button[aria-haspopup="dialog"]') };
    });
    expect(order.data).toBeGreaterThan(order.license);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

test("the meteogram names only Open-Meteo, the data licence is in the About tab (REQ-478)", async ({
  page,
  deviceClass,
}) => {
  await page.goto(APP);
  const card = page.getByTestId("meteogram-card");
  // The source stands in the meteogram's card on the desktop, in the footer's row in the phone's design, also a
  // tablet's (REQ-729), there with the time of the forecast.
  const attribution =
    deviceClass === "desktop" ? card.getByTestId("meteogram-attribution") : page.getByTestId("meteogram-source");
  await expect(attribution).toContainText("Weather data by Open-Meteo.com");
  await expect(attribution.getByRole("link", { name: "Open-Meteo.com" })).toBeVisible();
  await expect(card.getByRole("link", { name: "CC BY 4.0" })).toHaveCount(0);
  await expect(card).not.toContainText("CC BY");
  await expect(card).not.toContainText("harmonised");
  await expect(page.locator('[data-region="footer"]')).not.toContainText("CC BY");

  // Info in the desktop's footer; in the phone's design in the header bar or the phone's menu (REQ-582, REQ-731).
  const footerInfo = page.locator('[data-region="footer"]').getByRole("button", { name: "Info" });
  await (deviceClass === "desktop" ? footerInfo : await headerControl(page, "button", "Info")).click();
  const dialog = page.getByRole("dialog", { name: "Information" });
  await expect(dialog.getByTestId("about-data-license")).toHaveText(
    "Licence: CC BY 4.0. The data were harmonised (units, timestamps) and combined from several weather models into one timeline.",
  );
  await expect(dialog.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/",
  );
});

test("license files of the About tab resolve on the built site (REQ-431)", async ({ page, request }) => {
  await page.goto(APP);
  await (await headerControl(page, "button", "Info")).click();
  const dialog = page.getByRole("dialog", { name: "Information" });
  for (const row of ["about-map-opentopomap", "about-map-maptoolkit"]) {
    await expect(dialog.getByTestId(row).getByRole("link", { name: "OpenStreetMap contributors" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
  }
  // The popups load these files (REQ-514, REQ-647); they stay next to index.html.
  const licenseUrl = new URL("LICENSE", APP).href;
  const noticeUrl = new URL("THIRD_PARTY_LICENSES.md", APP).href;
  const gpl = await request.get(licenseUrl);
  expect(gpl.status()).toBe(200);
  expect(await gpl.text()).toContain("GNU GENERAL PUBLIC LICENSE");
  const notice = await request.get(noticeUrl);
  expect(notice.status()).toBe(200);
  expect(await notice.text()).toMatch(/### maplibre-gl 5\.\d+\.\d+/);
  for (const file of ["LICENSES/CC-BY-4.0.txt", "LICENSES/MPL-2.0.txt"]) {
    expect((await request.get(new URL(file, APP).href)).status(), file).toBe(200);
  }
});

for (const { width, scheme } of [
  { width: 375, scheme: "light" },
  { width: 1280, scheme: "dark" },
] as const) {
  test(`third-party licenses open in a popup over the About tab (REQ-514, ${width}px, ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(APP);
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await (await headerControl(page, "button", "Info")).click();
    const info = page.getByRole("dialog", { name: "Information" });
    const opener = info.getByRole("button", { name: "Third-party licenses" });
    await expect(info.locator('a[href$=".md"]')).toHaveCount(0);
    const loaded = page.waitForResponse((response) => response.url().endsWith("/THIRD_PARTY_LICENSES.md"));
    await opener.click();
    expect((await loaded).status()).toBe(200);

    const popup = page.getByRole("dialog", { name: "Third-party licenses" });
    await expect(popup).toBeVisible();
    const content = popup.getByTestId("third-party-licenses");
    await expect(content.getByRole("heading", { name: "Origin of the code and the logo" })).toBeVisible();
    await expect(content.getByRole("heading", { name: /^maplibre-gl 5\.\d+\.\d+$/ })).toHaveCount(1);
    await expect(content.getByRole("table").first()).toBeVisible();
    await expect(content).toContainText("Permission is hereby granted");
    // No Markdown syntax is left over.
    await expect(content).not.toContainText("```");
    await expect(content).not.toContainText("**License:**");
    expect(navigations).toEqual([]);
    expect(page.url()).toBe(APP);

    // The popup scrolls inside, the page does not get wider, and it follows the colour scheme.
    const metrics = await popup.evaluate((dialog) => {
      const body = dialog.querySelector(".dialog__body")!;
      const pre = dialog.querySelector("pre")!;
      const box = dialog.getBoundingClientRect();
      return {
        scrolls: body.scrollHeight > body.clientHeight,
        right: box.right,
        pageWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        background: getComputedStyle(dialog).backgroundColor,
        preBackground: getComputedStyle(pre).backgroundColor,
        color: getComputedStyle(pre).color,
      };
    });
    expect(metrics.scrolls).toBe(true);
    expect(metrics.right).toBeLessThanOrEqual(width);
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.preBackground).not.toBe(metrics.background);
    const dark = scheme === "dark";
    const luminance = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).reduce((sum, value) => sum + Number(value), 0);
    expect(luminance(metrics.background) < 384).toBe(dark);
    expect(luminance(metrics.color) > 384).toBe(dark);

    // Escape closes only the popup and gives the focus back to its opener in the About tab.
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(info).toBeVisible();
    await expect(opener).toBeFocused();

    // The close button does the same.
    await opener.click();
    await expect(popup.getByTestId("third-party-licenses")).toBeVisible();
    await popup.getByRole("button", { name: "Close" }).click();
    await expect(popup).toHaveCount(0);
    await expect(info.getByRole("tabpanel")).toContainText("GPL-3.0-or-later");
    await expect(opener).toBeFocused();
  });
}

for (const provider of ["opentopomap", "maptoolkit"] as const) {
  test(`the About tab has an entry per map provider when ${provider} is chosen (REQ-517, REQ-646)`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem("graupel.map", value), provider);
    await page.goto(APP);
    await (await headerControl(page, "button", "Info")).click();
    const dialog = page.getByRole("dialog", { name: "Information" });
    const topo = dialog.getByTestId("about-map-opentopomap");
    const mtk = dialog.getByTestId("about-map-maptoolkit");
    await expect(topo).toHaveText("OpenTopoMap, © OpenStreetMap contributors, SRTM, LeafletLicence: CC BY-SA 3.0");
    await expect(mtk).toHaveText("Maptoolkit, © OpenStreetMap contributors");
    for (const [row, links] of [
      [
        topo,
        [
          ["OpenTopoMap", "https://opentopomap.org/"],
          ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
          ["SRTM", "http://viewfinderpanoramas.org/"],
          ["Leaflet", "https://leafletjs.com/"],
          ["CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/"],
        ],
      ],
      [
        mtk,
        [
          ["Maptoolkit", "https://www.maptoolkit.org/"],
          ["OpenStreetMap contributors", "https://www.openstreetmap.org/copyright"],
        ],
      ],
    ] as const) {
      await expect(row.getByRole("link")).toHaveCount(links.length);
      for (const [name, href] of links) await expect(row.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
}

test.describe("with a fixed clock", () => {
  /** Tuesday, 3 November 2026, 12:00 UTC. */
  const FIXED_NOW = Date.UTC(2026, 10, 3, 12);

  test.use({ timezoneId: "UTC" });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  });

  for (const width of [1280, 375]) {
    test(`the OpenTopoMap licence is small below its entry, like that of the weather data (REQ-646, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(APP);
      await (await headerControl(page, "button", "Info")).click();
      const dialog = page.getByRole("dialog", { name: "Information" });
      const topo = dialog.getByTestId("about-map-opentopomap");
      const license = dialog.getByTestId("about-map-opentopomap-license");
      await expect(license).toHaveText("Licence: CC BY-SA 3.0");
      const look = await dialog.evaluate((root) => {
        const style = (selector: string) => {
          const element = root.querySelector(selector)!;
          const { display, fontSize, color } = getComputedStyle(element);
          return { display, fontSize, color };
        };
        const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
        const credits = root.querySelector('[data-testid="about-map-opentopomap"] a')!;
        return {
          map: style('[data-testid="about-map-opentopomap-license"]'),
          data: style('[data-testid="about-data-license"]'),
          creditSize: getComputedStyle(credits).fontSize,
          licenseTop: box('[data-testid="about-map-opentopomap-license"]').top,
          creditsBottom: credits.getBoundingClientRect().bottom,
          maptoolkitTop: box('[data-testid="about-map-maptoolkit"]').top,
          licenseBottom: box('[data-testid="about-map-opentopomap-license"]').bottom,
        };
      });
      expect(look.map).toEqual(look.data);
      expect(look.map.display).toBe("block");
      expect(parseFloat(look.map.fontSize)).toBeLessThan(parseFloat(look.creditSize));
      // Below the credits of OpenTopoMap and above the Maptoolkit entry.
      expect(look.licenseTop).toBeGreaterThanOrEqual(look.creditsBottom - 1);
      expect(look.maptoolkitTop).toBeGreaterThanOrEqual(look.licenseBottom - 1);
      await expect(topo.getByRole("link", { name: "CC BY-SA 3.0" })).toBeVisible();
    });
  }

  for (const { width, scheme } of [
    { width: 1280, scheme: "light" },
    { width: 375, scheme: "dark" },
  ] as const) {
    test(`GPL-3.0-or-later opens the license text in a popup, no download (REQ-647, ${width}px, ${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(APP);
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });
      const downloads: string[] = [];
      page.on("download", (download) => downloads.push(download.url()));
      const popups: string[] = [];
      page.on("popup", (popup) => popups.push(popup.url()));

      await (await headerControl(page, "button", "Info")).click();
      const info = page.getByRole("dialog", { name: "Information" });
      await expect(info.locator('a[href$="LICENSE"]')).toHaveCount(0);
      const opener = info.getByRole("button", { name: "GPL-3.0-or-later" });
      await expect(opener).toHaveAttribute("aria-haspopup", "dialog");
      const loaded = page.waitForResponse((response) => response.url() === new URL("LICENSE", APP).href);
      await opener.click();
      expect((await loaded).status()).toBe(200);

      const popup = page.getByRole("dialog", { name: "GPL-3.0-or-later" });
      await expect(popup.getByRole("heading", { name: "GPL-3.0-or-later" })).toBeVisible();
      const text = popup.getByTestId("license-text");
      await expect(text).toContainText("GNU GENERAL PUBLIC LICENSE");
      await expect(text).toContainText("Version 3, 29 June 2007");
      await expect(text).toContainText("END OF TERMS AND CONDITIONS");

      // Plain text, preformatted, in a body that scrolls; the popup stays within the page.
      const metrics = await popup.evaluate((dialog) => {
        const body = dialog.querySelector(".dialog__body")!;
        const pre = dialog.querySelector('[data-testid="license-text"]')!;
        const style = getComputedStyle(pre);
        const box = dialog.getBoundingClientRect();
        return {
          tag: pre.tagName,
          whiteSpace: style.whiteSpace,
          fontFamily: style.fontFamily,
          scrolls: body.scrollHeight > body.clientHeight,
          scrollTop: body.scrollTop,
          left: box.left,
          right: box.right,
          bottom: box.bottom,
          pageWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          background: getComputedStyle(dialog).backgroundColor,
          color: style.color,
        };
      });
      expect(metrics.tag).toBe("PRE");
      expect(metrics.whiteSpace).toBe("pre-wrap");
      expect(metrics.fontFamily).toMatch(/mono|Menlo|Consolas/i);
      expect(metrics.scrolls).toBe(true);
      expect(metrics.left).toBeGreaterThanOrEqual(0);
      expect(metrics.right).toBeLessThanOrEqual(width);
      expect(metrics.bottom).toBeLessThanOrEqual(800);
      expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.clientWidth);
      const dark = scheme === "dark";
      const luminance = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).reduce((sum, value) => sum + Number(value), 0);
      expect(luminance(metrics.background) < 384).toBe(dark);
      expect(luminance(metrics.color) > 384).toBe(dark);
      // The wheel scrolls the text.
      await text.hover();
      await page.mouse.wheel(0, 600);
      await expect
        .poll(() => popup.evaluate((dialog) => dialog.querySelector(".dialog__body")!.scrollTop))
        .toBeGreaterThan(0);

      // Escape closes only the popup and gives the focus back to its opener.
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(info).toBeVisible();
      await expect(opener).toBeFocused();

      // The close button (X) does the same.
      await opener.click();
      await expect(popup.getByTestId("license-text")).toBeVisible();
      await popup.getByRole("button", { name: "Close" }).click();
      await expect(popup).toHaveCount(0);
      await expect(info).toBeVisible();
      await expect(opener).toBeFocused();

      // A click beside the popup, on the backdrop, closes it too.
      await opener.click();
      await expect(popup.getByTestId("license-text")).toBeVisible();
      await page.mouse.click(2, 400);
      await expect(popup).toHaveCount(0);
      await expect(info).toBeVisible();

      expect(downloads).toEqual([]);
      expect(popups).toEqual([]);
      expect(navigations).toEqual([]);
      expect(page.url()).toBe(APP);
    });
  }

  test("the popup titles and the map entries are translated (REQ-646, REQ-647)", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("graupel.language", "de"));
    await page.goto(APP);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await (await headerControl(page, "button", /^Infos?$/)).click();
    const info = page.getByRole("dialog");
    await expect(info.locator(".about__facts > dt")).toHaveText([
      "Version",
      "Quellcode",
      "Karte OpenTopoMap",
      "Karte Maptoolkit",
      "Lizenz",
      "Wetterdaten",
    ]);
    await expect(info.getByTestId("about-map-opentopomap-license")).toHaveText("Lizenz: CC BY-SA 3.0");
    await info.getByRole("button", { name: "GPL-3.0-or-later" }).click();
    await expect(page.getByRole("dialog", { name: "GPL-3.0-or-later" }).getByTestId("license-text")).toContainText(
      "GNU GENERAL PUBLIC LICENSE",
    );
  });
});

for (const width of [1280, 360]) {
  for (const locale of ["de-DE", "en-GB", "fr-FR", "it-IT", "nl-NL", "da-DK", "cs-CZ", "sl-SI"]) {
    test.describe(() => {
      test.use({ locale });
      test(`the info tab bar never scrolls (REQ-518, ${width}px, ${locale})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(APP);
        await (await headerControl(page, "button", /^Infos?$/)).click();
        const tabs = page.getByRole("tablist");
        await expect(tabs.getByRole("tab")).toHaveCount(3);
        const box = await tabs.evaluate((bar: HTMLElement) => {
          const style = getComputedStyle(bar);
          const right = Math.max(...[...bar.children].map((tab) => tab.getBoundingClientRect().right));
          return {
            scrollHeight: bar.scrollHeight,
            clientHeight: bar.clientHeight,
            scrollWidth: bar.scrollWidth,
            clientWidth: bar.clientWidth,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            // A visible scrollbar takes room from the box: offset size minus borders differs from the client size.
            scrollbar: bar.offsetWidth - bar.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
            scrollbarY: bar.offsetHeight - bar.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth),
            tabsRight: right,
            barRight: bar.getBoundingClientRect().right,
          };
        });
        expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
        expect([box.overflowX, box.overflowY]).toEqual(["visible", "visible"]);
        expect(box.scrollbar).toBe(0);
        expect(box.scrollbarY).toBe(0);
        // Every tab is within the bar, none is cut off.
        expect(box.tabsRight).toBeLessThanOrEqual(box.barRight + 0.5);
      });
    });
  }
}
