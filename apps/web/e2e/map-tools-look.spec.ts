// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The favourites beside the search field in the full-screen map (REQ-761, REQ-764): star and arrow have the search
 * field's background (white in the light design, the field's colour in the dark one), no frame, background or blur
 * lies around them, and they are exactly as high as the field, flush with it at the top and the bottom. On the desktop
 * and on a tablet, upright and turned; a phone's map has no search field (REQ-641), so there is nothing beside it.
 * Pictures of the top-left corner of the map in both designs. No network: OpenTopoMap tiles are a transparent pixel.
 */
import { expect, test, type Locator, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 28 October 2026, 11:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 9, 28, 11);
// 1×1 transparent PNG for map tiles.
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
/** Background of the search field (`--color-surface`) in either design. */
const SURFACE = { light: "rgb(255, 255, 255)", dark: "rgb(26, 33, 41)" };

test.use({ locale: "en-GB", timezoneId: "UTC" });

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", (route) => fakeForecast(route, { now: FIXED_NOW }));
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [1234] } }),
  );
  await page.route("https://*.tile.opentopomap.org/**", (route) =>
    route.fulfill({ body: TILE, contentType: "image/png" }),
  );
  await page.route(/maptoolkit\.(org|net)/, (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("graupel.map", "opentopomap"));
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function openMap(page: Page) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Map" });
  await expect(dialog.locator('[data-map="opentopomap"] .leaflet-map-pane')).toHaveCount(1);
  return dialog;
}

/** The background an element draws, as computed: colour, picture and blur of what lies behind. */
function look(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      backdropFilter: style.backdropFilter,
    };
  });
}

/**
 * Elements between the favourites' buttons and the tools' corner, each with what it draws: none of them may draw a
 * frame or a background of its own around the buttons (REQ-764).
 */
function wrappers(button: Locator) {
  return button.evaluate((element) => {
    const nodes: HTMLElement[] = [];
    for (let node = element.parentElement; node && !node.classList.contains("map-dialog"); node = node.parentElement) {
      nodes.push(node);
    }
    return nodes.map((node) => {
      const style = getComputedStyle(node);
      const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
      return {
        name: node.className,
        background: style.backgroundColor,
        image: style.backgroundImage,
        border: border.join(" "),
        backdrop: style.backdropFilter,
        shadow: style.boxShadow,
      };
    });
  });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`favourites beside the search field in the map, ${theme} (REQ-761, REQ-764)`, () => {
    test.use({ colorScheme: theme });

    test("in the search field's colour, as high as it, without a frame around them", async ({ page, deviceClass }) => {
      const dialog = await openMap(page);
      if (deviceClass === "phone") {
        // A phone's map has no room for the search field and the favourites (REQ-641).
        await expect(dialog.getByRole("combobox")).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: "Show favourites" })).toHaveCount(0);
        return;
      }
      const field = dialog.locator(".location__field");
      const star = dialog.getByRole("button", { name: "Remove Mont Blanc from favourites" });
      const arrow = dialog.getByRole("button", { name: "Show favourites" });
      await expect(field).toBeVisible();

      // REQ-761: star and arrow in the field's background, white in the light design.
      const fieldLook = await look(field);
      expect(fieldLook.background).toBe(SURFACE[theme]);
      for (const button of [star, arrow]) {
        const buttonLook = await look(button);
        expect(buttonLook.background).toBe(fieldLook.background);
        expect(buttonLook.backgroundImage).toBe("none");
        expect(buttonLook.backdropFilter).toBe("none");
      }

      // REQ-764: nothing around them draws a background, a frame, a shadow of its own or blurs the map.
      for (const wrapper of await wrappers(star)) {
        expect(wrapper.background, wrapper.name).toBe("rgba(0, 0, 0, 0)");
        expect(wrapper.image, wrapper.name).toBe("none");
        expect(wrapper.border, wrapper.name).toBe("0px 0px 0px 0px");
        expect(wrapper.backdrop, wrapper.name).toBe("none");
        expect(wrapper.shadow, wrapper.name).toBe("none");
      }

      // REQ-764: exactly as high as the field, flush with it at the top and the bottom.
      const fieldBox = (await field.boundingBox())!;
      for (const button of [star, arrow]) {
        const box = (await button.boundingBox())!;
        expect(Math.abs(box.height - fieldBox.height)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.y - fieldBox.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.y + box.height - (fieldBox.y + fieldBox.height))).toBeLessThanOrEqual(1);
      }

      const viewport = page.viewportSize()!;
      const name =
        deviceClass === "desktop" ? "desktop" : viewport.width > viewport.height ? "tablet-landscape" : "tablet";
      // The top-left corner of the map with the tools and their shadows.
      const tools = (await dialog.locator(".map-dialog__tools").boundingBox())!;
      const corner = { x: 0, y: 0, width: tools.x + tools.width + 8, height: tools.y + tools.height + 8 };
      await expect(page).toHaveScreenshot(`map-tools-${name}-${theme}.png`, { clip: corner });
    });
  });
}
