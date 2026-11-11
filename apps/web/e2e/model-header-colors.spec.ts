// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The meteogram's model headers stay in the blue shades of the weather chain (REQ-443, REQ-456), never in the
 * meteogram's own orange (REQ-770): after a tap or click on a header, the info popup opened and closed, a dragged model
 * boundary, a new place (also while its forecast still loads and the previous place's chart stands, REQ-751) and a
 * pull to refresh (the desktop's refresh button, REQ-637), and with an archived fetch (REQ-684) of a chain other than
 * the selected one. A pixel probe in the first model's header reads the colour on screen.
 *
 * And the place of the bug report (51.0639° N, 7.5397° E, Sauerland): its chain has only models whose domain covers
 * the place.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./fixtures.ts";
import { fakeForecast } from "./openMeteo.ts";
import { Finger } from "./touch.ts";

const APP = "http://localhost:4175/";
/** Fixed time: Wednesday, 11 November 2026, 12:00 UTC. */
const FIXED_NOW = Date.UTC(2026, 10, 11, 12);
/** The meteogram core's default header colours (light, dark). */
const CORE_ORANGE = ["#f59e0b", "#d97706"];

test.use({ timezoneId: "UTC" });

let errors: string[] = [];
/** Forecast requests to Open-Meteo (models), and while set, a promise their answers wait for. */
let api: { models: string[]; hold: Promise<void> | null };

test.beforeEach(async ({ page }) => {
  errors = [];
  api = { models: [], hold: null };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.clock.setFixedTime(FIXED_NOW);
  await page.route("https://api.open-meteo.com/v1/forecast**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has("hourly")) api.models.push(params.get("models") ?? "");
    if (api.hold) await api.hold;
    return fakeForecast(route, { now: FIXED_NOW });
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const meteogram = (page: Page) => page.locator('[data-region="meteogram"]');
const chart = (page: Page) => meteogram(page).locator("svg.meteogram-svg-integrated");
const shapes = (page: Page) => chart(page).locator('[data-testid="model-header-shape"]');
const location = (page: Page) => page.locator('[data-region="location"]');
const weather = (page: Page) =>
  page.locator('[data-region="model-chain"]').getByRole("group", { name: "Weather chain" });
/** Model of the first header the chart draws. */
const firstModel = (page: Page) =>
  chart(page).locator('[data-testid="model-label-segment"]').first().getAttribute("data-model");

/** Lets Open-Meteo's answers wait until the returned function is called. */
function holdAnswers(): () => void {
  let release: () => void = () => {};
  api.hold = new Promise((resolve) => (release = resolve));
  return () => {
    api.hold = null;
    release();
  };
}

async function open(page: Page) {
  await page.goto(APP);
  await expect(chart(page)).toBeVisible();
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  await expect(shapes(page).first()).toBeVisible();
}

/** Fill of every header shape as the chart drew it: none is the core's orange. */
async function expectNoOrangeFill(page: Page) {
  const fills = await shapes(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("fill") ?? ""));
  expect(fills.length).toBeGreaterThanOrEqual(2);
  for (const fill of fills) expect(CORE_ORANGE).not.toContain(fill.toLowerCase());
}

/**
 * The colour on screen in the first model's header: the most frequent pixel of a strip through the upper part of its
 * visible box (the name and the info button cover only a part of it), read from a screenshot on a canvas in the page.
 */
async function headerPixel(page: Page): Promise<[number, number, number]> {
  const shape = (await shapes(page).first().boundingBox())!;
  const scroll = (await page.getByTestId("meteogram-scroll").boundingBox())!;
  const viewport = page.viewportSize()!;
  const left = Math.max(shape.x, scroll.x, 0) + 2;
  const right = Math.min(shape.x + shape.width, scroll.x + scroll.width, viewport.width) - 2;
  expect(right - left).toBeGreaterThan(8);
  const top = Math.round(shape.y + shape.height * 0.25);
  const clip = { x: Math.ceil(left), y: top, width: Math.floor(right - left), height: 2 };
  const png = await page.screenshot({ clip });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [mode] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return mode.split(",").map(Number) as [number, number, number];
  }, png.toString("base64"));
}

/** The first header is blue on screen: blue clearly above red, nothing yellow or orange (red above blue). */
async function expectBlueHeader(page: Page, step: string) {
  await expectNoOrangeFill(page);
  const [r, g, b] = await headerPixel(page);
  expect(b - r, `${step}: rgb(${r}, ${g}, ${b})`).toBeGreaterThan(40);
  expect(b, `${step}: rgb(${r}, ${g}, ${b})`).toBeGreaterThan(g);
}

/** Moves the mouse off the chart, so that no tooltip lies over the headers. */
async function leaveChart(page: Page) {
  await page.mouse.move(1, 1);
}

/** Chooses `name` from the favourites. */
async function chooseFavorite(page: Page, name: string) {
  await location(page).getByRole("button", { name: "Show favourites" }).click();
  await location(page).getByRole("menu", { name: "Favourites" }).getByRole("menuitem", { name }).click();
  await expect(location(page).getByRole("combobox")).toHaveValue(name);
}

/** Pulls the chart down on a touch screen (REQ-638); the desktop presses its refresh button (REQ-637). */
async function refresh(page: Page, touch: boolean) {
  const before = api.models.length;
  if (touch) {
    const box = (await page.getByTestId("meteogram-scroll").boundingBox())!;
    const finger = await Finger.down(page, Math.round(box.x + box.width * 0.4), Math.round(box.y + box.height * 0.3));
    await finger.move(0, 120, 12);
    await finger.up();
  } else {
    await page.getByRole("button", { name: "Reload the forecast" }).click();
  }
  await expect.poll(() => api.models.length).toBeGreaterThan(before);
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
}

test("model headers stay blue through taps, info, boundary drag, place change and refresh (REQ-770)", async ({
  page,
  hasTouch,
}) => {
  // Weather chain hidden (the default): the headers carry the info buttons (REQ-643).
  await open(page);
  await expectBlueHeader(page, "start");

  // A tap or click on the first header.
  const first = shapes(page).first();
  const box = (await first.boundingBox())!;
  const scroll = (await page.getByTestId("meteogram-scroll").boundingBox())!;
  const at = { x: Math.max(box.x, scroll.x) + 12, y: box.y + box.height / 2 };
  if (hasTouch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await leaveChart(page);
  await expectBlueHeader(page, "header tapped");

  // The info popup (on a phone the dialog) opened and closed.
  const info = meteogram(page).getByTestId("model-header-info").getByTestId("model-header-info-button").first();
  if (hasTouch) await info.tap();
  else await info.click();
  const popover = page.getByTestId("model-info-popover");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await leaveChart(page);
  await expectBlueHeader(page, "info closed");

  // The weather chain shown (the stored choice, after a reload): a model boundary dragged.
  await page.evaluate(() => window.localStorage.setItem("graupel.showWeatherChain", "true"));
  await page.reload();
  await expect(chart(page)).toBeVisible();
  await expect(shapes(page).first()).toBeVisible();
  await expectBlueHeader(page, "reloaded");
  const boundary = weather(page).getByRole("slider", { name: "Boundary between AROME HD and ICON-CH2" });
  const start = Number(await boundary.getAttribute("aria-valuenow"));
  const grip = (await boundary.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 40, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await boundary.getAttribute("aria-valuenow"))).toBeLessThan(start);
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  await leaveChart(page);
  await expectBlueHeader(page, "boundary dragged");

  // A new place with another chain (C-LAEF first): while its answers wait, the previous place's chart stands on a
  // phone and a tablet (REQ-751), its headers still blue; then the new chart.
  const release = holdAnswers();
  await chooseFavorite(page, "Großglockner");
  await expect(weather(page).getByTestId("model-card-geosphere_claef_austria")).toBeVisible();
  await expectNoOrangeFill(page);
  if (hasTouch) await expectBlueHeader(page, "place loading");
  release();
  await expect.poll(() => firstModel(page)).toBe("GeoSphere C-LAEF Austria");
  await expect(page.getByTestId("forecast-loading")).toHaveCount(0);
  await leaveChart(page);
  await expectBlueHeader(page, "place changed");

  // Pull to refresh (the desktop's refresh button).
  await refresh(page, hasTouch);
  await leaveChart(page);
  await expectBlueHeader(page, "refreshed");
});

/** The installed app: its display mode matches (Playwright cannot set it), as in history.spec.ts. */
async function installed(page: Page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === "(display-mode: standalone)"
        ? ({
            ...original(query),
            media: query,
            matches: true,
            addEventListener() {},
            removeEventListener() {},
          } as MediaQueryList)
        : original(query);
  });
}

/**
 * Copies the newest archived fetch of `from` (a place key) to `to`, an hour earlier: the archive then holds a fetch of
 * `to` with the chain of `from`, as after a chain that changed between two fetches.
 */
function copyArchivedFetch(page: Page, from: string, to: string) {
  return page.evaluate(
    ([source, target]) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("graupel-archive");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction(["fetches", "results"]);
          const rows = read.objectStore("fetches").index("point").getAll(IDBKeyRange.only(source));
          rows.onsuccess = () => {
            const found = rows.result as { id: string; fetchedAt: number }[];
            const row = found.sort((a, b) => b.fetchedAt - a.fetchedAt)[0]!;
            const result = read.objectStore("results").get(row.id);
            result.onsuccess = () => {
              const fetchedAt = row.fetchedAt - 3_600_000;
              const id = `${target}@${fetchedAt}`;
              const write = db.transaction(["fetches", "results"], "readwrite");
              write.objectStore("fetches").put({ id, point: target, fetchedAt });
              write.objectStore("results").put(result.result, id);
              write.oncomplete = () => {
                db.close();
                resolve();
              };
              write.onerror = () => reject(write.error);
            };
          };
        };
      }),
    [from, to],
  );
}

/** Ids of the archived fetches of `point`. */
const archivedIds = (page: Page, point: string) =>
  page.evaluate(
    (key) =>
      new Promise<string[]>((resolve) => {
        const request = indexedDB.open("graupel-archive");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("fetches")) {
            db.close();
            resolve([]);
            return;
          }
          const index = db.transaction("fetches").objectStore("fetches").index("point");
          const rows = index.getAllKeys(IDBKeyRange.only(key));
          rows.onsuccess = () => {
            db.close();
            resolve(rows.result.map(String));
          };
          rows.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      }),
    point,
  );

/** Opens the history (the desktop's and tablet's split button, else the phone's menu with its dialog). */
async function openHistory(page: Page) {
  const button = page.getByTestId("history-button");
  const menu = page.getByTestId("phone-menu").getByRole("button", { name: "Menu" });
  await expect(button.or(menu).first()).toBeVisible();
  if ((await button.count()) > 0) {
    await page.getByTestId("history-arrow").click();
    const list = button.getByTestId("history-list");
    await expect(list).toBeVisible();
    return list;
  }
  await menu.click();
  await page.getByTestId("phone-menu-panel").getByRole("button", { name: /^History/ }).click();
  const dialog = page.getByRole("dialog", { name: "History" });
  await expect(dialog).toBeVisible();
  return dialog.getByTestId("history-list");
}

test("an archived fetch with another chain keeps blue headers (REQ-770, REQ-684)", async ({ page }) => {
  await installed(page);
  // Großglockner (C-LAEF first) is fetched and archived, its fetch copied to Mont Blanc (AROME HD first).
  await open(page);
  const montBlanc = "45.8326,6.8652";
  const glockner = "47.0742,12.6947";
  await chooseFavorite(page, "Großglockner");
  await expect.poll(() => firstModel(page)).toBe("GeoSphere C-LAEF Austria");
  await expect.poll(async () => (await archivedIds(page, glockner)).length).toBeGreaterThan(0);
  await copyArchivedFetch(page, glockner, montBlanc);
  await chooseFavorite(page, "Mont Blanc");
  await expect.poll(() => firstModel(page)).not.toBe("GeoSphere C-LAEF Austria");
  await expectBlueHeader(page, "current values");

  // The archived fetch shown: C-LAEF's chain over Mont Blanc's selected chain, in blue.
  const list = await openHistory(page);
  await list.getByTestId("history-fetch").first().click();
  await expect(page.getByTestId("history-list")).toHaveCount(0);
  if (await page.getByTestId("phone-menu-panel").isVisible()) await page.keyboard.press("Escape");
  await expect.poll(() => firstModel(page)).toBe("GeoSphere C-LAEF Austria");
  await leaveChart(page);
  await expectBlueHeader(page, "archived fetch");
});

// --- the place of the bug report -----------------------------------------------------------------------------------

type Ring = [number, number][];
const DOMAINS = (
  JSON.parse(readFileSync(new URL("../../../model-data/model_domains.json", import.meta.url), "utf8")) as {
    models: Record<string, "global" | { polygon: Ring }>;
  }
).models;
const CATALOGUE = (
  JSON.parse(readFileSync(new URL("../../../model-data/model_catalogue.json", import.meta.url), "utf8")) as {
    models: { id: string; name: string }[];
  }
).models;

/** Even-odd ray casting on lon/lat, as the resolver does it. */
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    if (y1 > lat !== y2 > lat && x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1) > lon) inside = !inside;
  }
  return inside;
}

/** Whether the model's domain covers the point; a model without a known domain does not count as covering. */
function covers(id: string, lat: number, lon: number): boolean {
  const domain = DOMAINS[id];
  if (domain === "global") return true;
  return domain !== undefined && inRing(lon, lat, domain.polygon);
}

test("at 51.0639° N, 7.5397° E the chain has only models covering the place (REQ-770)", async ({ page }) => {
  const SAUERLAND = { name: "51.0639, 7.5397", lat: 51.0639, lon: 7.5397 };
  // The place has no elevation: answer the lookup here instead of asking Open-Meteo.
  await page.route("https://api.open-meteo.com/v1/elevation**", (route) =>
    route.fulfill({ json: { elevation: [420] } }),
  );
  await page.addInitScript((place) => {
    window.localStorage.setItem("graupel.lastPlace", JSON.stringify(place));
    window.localStorage.setItem("graupel.showWeatherChain", "true");
    window.localStorage.setItem("graupel.showCloudChain", "true");
  }, SAUERLAND);
  await open(page);
  const block = page.locator('[data-region="model-chain"]');
  // The cards of both chains.
  const ids = async (prefix: string) =>
    block.locator(`[data-testid^="${prefix}model-card-"]`).evaluateAll(
      (nodes, start) => nodes.map((node) => node.getAttribute("data-testid")!.slice(start.length)),
      `${prefix}model-card-`,
    );
  await expect.poll(async () => (await ids("")).length).toBeGreaterThanOrEqual(2);
  const main = await ids("");
  const cloud = await ids("cloud-");
  // Germany: ICON-D2 first. C-LAEF's rectangle (43.0–51.5 N, 5.03–22.57 E) holds the point, so it would be allowed.
  expect(main[0]).toBe("icon_d2");
  expect(covers("geosphere_claef_austria", SAUERLAND.lat, SAUERLAND.lon)).toBe(true);
  for (const id of [...main, ...cloud]) expect(covers(id, SAUERLAND.lat, SAUERLAND.lon), id).toBe(true);

  // The meteogram draws those models, and Open-Meteo was asked for no other.
  const names = new Map(CATALOGUE.map((model) => [model.name, model.id]));
  const drawn = await chart(page)
    .locator('[data-testid="model-label-segment"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-model") ?? ""));
  expect(drawn.length).toBeGreaterThanOrEqual(2);
  for (const name of drawn) {
    const id = names.get(name);
    expect(id, name).toBeDefined();
    expect(covers(id!, SAUERLAND.lat, SAUERLAND.lon), name).toBe(true);
  }
  expect(api.models.length).toBeGreaterThan(0);
  for (const id of new Set(api.models.flatMap((models) => models.split(",")))) {
    expect(covers(id, SAUERLAND.lat, SAUERLAND.lon), id).toBe(true);
  }
  await expectBlueHeader(page, "Sauerland");
});
