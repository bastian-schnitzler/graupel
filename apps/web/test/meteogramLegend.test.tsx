// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Legend of the meteogram (REQ-639): it lists what the chart on the page draws, with the chart's colours and dashes
 * from @graupel/meteogram, only in the normal view. On the desktop it stands beside the meteogram card where the page's
 * margin has room for it, else (REQ-670) and on a narrow page it is a card of its own above the meteogram. Its X switches the new setting
 * "Show the legend" off (stored, exported and imported); the settings popup switches it back on. Its entries stand in
 * groups by the areas of the chart, the time marks last (REQ-674): weather model, now, sunrise and sunset, daylight
 * (REQ-679). The entry "Weather model" shows the first model's letters (up to three) in the first header's colour (REQ-678, DEC-071). The layout on screen is checked in
 * e2e/meteogram-legend.spec.ts. On the narrow page's card the wind arrows' entry is only "Direction", in every language
 * the short form; on the desktop it stays "Wind direction" (REQ-720). The PNG export of the core is mocked (jsdom has
 * no canvas). On a tablet in landscape the card's groups stand in four columns, with or without the dew point and the
 * relative humidity, in the legend's order: temperature, precipitation, wind, time marks (REQ-756, REQ-763).
 */
import { LIGHT_THEME, getSeriesDashArray } from "@graupel/meteogram";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider, LANGUAGES, MESSAGES, translate } from "../src/i18n/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  LEGEND_ITEMS,
  SIDE_LEGEND_GAP,
  SIDE_LEGEND_MAX_WIDTH,
  drawnLegend,
  MODEL_HEADER_LETTERS_SOURCE,
  legendCardFits,
  legendColumns,
  legendLabel,
  legendModelLetters,
  modelHeaderLetters,
} from "../src/regions/MeteogramPanel/MeteogramLegend.tsx";
import {
  COARSE_POINTER_QUERY,
  ChainProvider,
  DEFAULT_LEGEND,
  DaySelectionProvider,
  ForecastProvider,
  LANDSCAPE_QUERY,
  LEGEND_STORAGE_KEY,
  LocationProvider,
  SETTINGS_FILE_FORMAT,
  legendChoice,
  parseSettingsFile,
  readLegend,
  resetDisplaySettings,
  serializeSettingsFile,
  setDewPoint,
  setLegend,
  modelHeadersChoice,
  setRelativeHumidity,
  type ForecastLoader,
} from "../src/state/index.ts";
import { NARROW_PAGE_QUERY } from "../src/state/narrowPage.ts";
import { TEXT_LIGHT } from "../src/state/chainColors.ts";
import { forecastFixture } from "./forecastFixture.ts";

vi.mock("@graupel/meteogram/png", () => ({
  meteogramToPng: vi.fn(() => Promise.resolve(new Blob([], { type: "image/png" }))),
}));

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** matchMedia stand-in: only the narrow-page query matches, while `narrow` is set. */
function stubNarrowPage(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: narrow && query === NARROW_PAGE_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/** A desktop page whose meteogram card starts `left` px from the window's left edge (jsdom lays out nothing). */
function stubCardLeft(left: number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid !== "meteogram-card") return original.call(this);
    return DOMRect.fromRect({ x: left, y: 0, width: 800, height: 400 });
  });
}

/** Header (with the settings popup) and the meteogram of a forecast with dew point and relative humidity. */
async function renderPage() {
  const loader = vi.fn<ForecastLoader>(async () =>
    forecastFixture({ relativeHumidity: (hour) => 60 + 20 * Math.sin(hour / 5), dewPoint: (_hour, t) => t - 2 }),
  );
  render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <NoticesProvider>
          <DialogsProvider>
            <LocationProvider>
              <ChainProvider>
                <ForecastProvider loader={loader}>
                  <DaySelectionProvider>
                    <Header />
                    <MeteogramPanel />
                  </DaySelectionProvider>
                </ForecastProvider>
              </ChainProvider>
            </LocationProvider>
          </DialogsProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
  await screen.findByTestId("meteogram-attribution");
}

const legend = () => screen.queryByTestId("meteogram-legend");
const keys = () => [...(legend()?.querySelectorAll("li") ?? [])].map((item) => item.dataset.key);
/** Opens the settings popup at a tab (REQ-686). */
const openSettings = (tab: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = within(screen.getByRole("dialog", { name: "Settings" }));
  fireEvent.click(dialog.getByRole("tab", { name: tab }));
  return dialog;
};

describe("setting “Show the legend” (REQ-639)", () => {
  it("is on without a stored choice; off is stored, on is not", () => {
    expect(DEFAULT_LEGEND).toBe(true);
    expect(readLegend()).toBe(true);
    setLegend(false);
    expect(window.localStorage.getItem(LEGEND_STORAGE_KEY)).toBe("false");
    expect(readLegend()).toBe(false);
    setLegend(true);
    expect(window.localStorage.getItem(LEGEND_STORAGE_KEY)).toBeNull();
    expect(legendChoice.read()).toBeNull();
    window.localStorage.setItem(LEGEND_STORAGE_KEY, "maybe");
    expect(readLegend()).toBe(true);
  });

  it("has its texts in every language", () => {
    const wanted = [
      "settings.meteogram.legend",
      "meteogram.legend.title",
      "meteogram.legend.close",
      ...LEGEND_ITEMS.map((item) => item.label),
    ];
    for (const messages of Object.values(MESSAGES)) {
      for (const key of wanted) expect(messages[key], key).toBeTruthy();
    }
    expect(MESSAGES.de["settings.meteogram.legend"]).toBe("Legende anzeigen");
    expect(MESSAGES.de["meteogram.legend.title"]).toBe("Legende");
  });

  it("goes into the settings file and comes back from it; a file without it leaves it as it is", () => {
    const text = serializeSettingsFile({ settings: { legend: false } });
    expect(parseSettingsFile(text)).toEqual({ ok: true, value: { settings: { legend: false } } });
    const file = (settings: unknown) => JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings });
    expect(parseSettingsFile(file({ legend: true }))).toEqual({ ok: true, value: { settings: { legend: true } } });
    expect(parseSettingsFile(file({}))).toEqual({ ok: true, value: { settings: {} } });
    expect(parseSettingsFile(file({ legend: "no" }))).toEqual({ ok: false, error: "content" });
  });

  it("stands first in the meteogram section of the tab Meteogram (REQ-686)", async () => {
    await renderPage();
    const section = openSettings("Meteogram").getByRole("heading", { name: "Meteogram" }).closest("section")!;
    const show = within(section).getByRole("checkbox", { name: "Show the legend" });
    expect(show).toHaveProperty("checked", true);
    // The first control of the section; the model headers moved to the tab Models.
    const group = within(section).getByRole("group", { name: "Meteogram" });
    expect(group.firstElementChild).toBe(show.closest("label"));
    expect(within(section).queryByRole("checkbox", { name: "Show model headers" })).toBeNull();
    fireEvent.click(show);
    expect(window.localStorage.getItem(LEGEND_STORAGE_KEY)).toBe("false");
    fireEvent.click(show);
    expect(window.localStorage.getItem(LEGEND_STORAGE_KEY)).toBeNull();
  });
});

describe("what the legend lists (REQ-639)", () => {
  /** A chart with a temperature line, a dew point without a path and the current-time line. */
  function chart() {
    const root = document.createElement("div");
    root.innerHTML = `<svg>
      <path data-testid="temperature-path" d="M0 0L10 10"></path>
      <path data-testid="dew-point-path" d=""></path>
      <rect data-testid="precip-bar" stroke="none"></rect>
      <g data-testid="current-time-crosshair-group">
        <line data-testid="current-time-cursor-line" stroke-dasharray="4 2" stroke-width="1.2"></line>
      </g>
    </svg>`;
    return root;
  }

  it("names what is drawn, in its order; an empty path is not drawn", () => {
    expect(drawnLegend(chart())).toEqual({
      keys: ["temperature", "precipitation", "now"],
      groups: [
        { id: "temperature", keys: ["temperature"] },
        { id: "precipitation", keys: ["precipitation"] },
        { id: "time", keys: ["now"] },
      ],
      now: { dashArray: "4 2", strokeWidth: "1.2" },
      header: null,
    });
  });

  it("keeps the current time while the mouse's cursor line stands in its place", () => {
    const root = chart();
    const before = drawnLegend(root);
    const group = root.querySelector('[data-testid="current-time-crosshair-group"]')!;
    group.innerHTML = '<line data-testid="hover-cursor-line"></line>';
    expect(drawnLegend(root, before.now)).toEqual(before);
    // Without a current-time line before, there is none during the hover either.
    expect(drawnLegend(root).keys).toEqual(["temperature", "precipitation"]);
  });

  it("snow bars and rain bars apart", () => {
    const root = document.createElement("div");
    root.innerHTML = '<svg><rect data-testid="precip-bar" stroke="#475569"></rect></svg>';
    expect(drawnLegend(root).keys).toEqual(["snow"]);
  });
});

describe("legend card on a phone in portrait (REQ-639, REQ-608)", () => {
  const space = (screen: number, rest: number, optional: number) => ({ screen, rest, optional, pxPerUnit: 0.4 });

  it("fits where the chart keeps at least 40 % of the screen with it", () => {
    // 844 px, 200 px for the rest of the page without the card, 140 px for the card: the chart keeps 504 px.
    expect(legendCardFits(space(844, 200, 0), 140)).toBe(true);
    expect(legendCardFits(space(844, 340, 140), 140)).toBe(true);
    // 500 px: 160 px left, less than 200 px.
    expect(legendCardFits(space(500, 200, 0), 140)).toBe(false);
    expect(legendCardFits(space(500, 340, 140), 140)).toBe(false);
    // Just 40 %.
    expect(legendCardFits(space(500, 160, 0), 140)).toBe(true);
  });

  it("fits without a measure", () => {
    expect(legendCardFits(null, 140)).toBe(true);
    expect(legendCardFits(space(500, 200, 0), null)).toBe(true);
  });
});

describe("groups of the legend (REQ-674)", () => {
  /** A chart like the built-in layout: the areas `temp`, `precip` and `wind` in `order`, with what each draws. */
  function chart(order: readonly string[] = ["temp", "precip", "wind"], windDrawn = true) {
    const areas: Record<string, string> = {
      temp: `
        <path data-testid="relative-humidity-path" d="M0 0L1 1"></path>
        <path data-testid="dew-point-path" d="M0 0L1 1"></path>
        <path data-testid="apparent-temperature-path" d="M0 0L1 1"></path>
        <path data-testid="temperature-path" d="M0 0L1 1"></path>
        <g data-testid="sun-time-labels"><text>07:14</text></g>`,
      precip: `
        <rect data-testid="vertical-cloud-cell"></rect>
        <rect data-testid="precip-bar" stroke="none"></rect>
        <rect data-testid="precip-bar" stroke="#475569"></rect>
        <path data-testid="precip-probability-path" d="M0 0L1 1"></path>
        <g data-testid="thunderstorm-icon"></g>`,
      wind: `
        <path data-testid="wind-gusts-path" d="${windDrawn ? "M0 0L1 1" : ""}"></path>
        <path data-testid="wind-speed-path" d="${windDrawn ? "M0 0L1 1" : ""}"></path>`,
    };
    const root = document.createElement("div");
    root.innerHTML = `<svg>
      <g class="daylight-stripe-group"><rect data-testid="daylight-stripe"></rect></g>
      ${order.map((id) => `<g class="panel" data-area-id="${id}">${areas[id]}</g>`).join("")}
      <g data-testid="current-time-crosshair-group"><line data-testid="current-time-cursor-line"></line></g>
    </svg>`;
    return root;
  }

  it("groups the entries by the chart's areas in their order, the time marks last", () => {
    const { keys, groups } = drawnLegend(chart());
    expect(groups).toEqual([
      // Dew point and relative humidity with the temperature, drawn in its area.
      { id: "temp", keys: ["temperature", "apparentTemperature", "dewPoint", "relativeHumidity"] },
      { id: "precip", keys: ["precipitation", "snow", "precipitationProbability", "clouds", "thunderstorm"] },
      { id: "wind", keys: ["wind", "gusts"] },
      // The sun times stand with now and daylight, although the temperature area draws them (REQ-679 orders them).
      { id: "time", keys: ["now", "sunTimes", "daylight"] },
    ]);
    expect(keys).toEqual(groups.flatMap((group) => group.keys));
  });

  it("follows the order of the areas in the chart, not a fixed one", () => {
    expect(drawnLegend(chart(["wind", "temp", "precip"])).groups.map((group) => group.id)).toEqual([
      "wind",
      "temp",
      "precip",
      "time",
    ]);
  });

  it("leaves out a group without an entry", () => {
    const { groups } = drawnLegend(chart(["temp", "precip", "wind"], false));
    expect(groups.map((group) => group.id)).toEqual(["temp", "precip", "time"]);
    // Without a current-time line, daylight or sun times there is no time group.
    const root = chart();
    root.querySelectorAll('[data-testid="daylight-stripe"], [data-testid="sun-time-labels"], line').forEach((element) =>
      element.remove(),
    );
    expect(drawnLegend(root).groups.map((group) => group.id)).toEqual(["temp", "precip", "wind"]);
  });

  it("keeps its fixed group for what is drawn outside every area, after the areas", () => {
    const root = chart(["temp", "precip"]);
    root.querySelector("svg")!.insertAdjacentHTML("beforeend", '<path data-testid="wind-speed-path" d="M0 0"></path>');
    expect(drawnLegend(root).groups.map((group) => [group.id, group.keys.join()])).toEqual([
      ["temp", "temperature,apparentTemperature,dewPoint,relativeHumidity"],
      ["precip", "precipitation,snow,precipitationProbability,clouds,thunderstorm"],
      ["wind", "wind"],
      ["time", "now,sunTimes,daylight"],
    ]);
  });
});

describe("model header in the legend (REQ-677)", () => {
  /** A chart with the time marks and, with `headers`, two model headers: ICON-D2 in its colour, then ICON-EU. */
  function chart(headers: boolean) {
    const root = document.createElement("div");
    root.innerHTML = `<svg>
      ${
        headers
          ? `<g data-testid="model-label-segment" data-model="DWD ICON-D2" data-start-x="0" data-end-x="40">
               <path data-testid="model-header-shape" fill="#5e97de"></path>
               <text data-testid="model-header-label">ICON-D2</text>
             </g>
             <g data-testid="model-label-segment" data-model="ICON-EU" data-start-x="40" data-end-x="90">
               <path data-testid="model-header-shape" fill="#a5c5ed"></path>
             </g>`
          : ""
      }
      <g class="daylight-stripe-group"><rect data-testid="daylight-stripe"></rect></g>
      <g class="panel" data-area-id="temp">
        <path data-testid="temperature-path" d="M0 0L1 1"></path>
        <g data-testid="sun-time-labels"><text>07:14</text></g>
      </g>
      <g data-testid="current-time-crosshair-group"><line data-testid="current-time-cursor-line"></line></g>
    </svg>`;
    return root;
  }

  it("starts the last group, before now, sunrise and sunset and daylight, while the chart draws the headers", () => {
    const drawn = drawnLegend(chart(true));
    expect(drawn.groups).toEqual([
      { id: "temp", keys: ["temperature"] },
      // REQ-679: weather model, now, sunrise and sunset, daylight.
      { id: "time", keys: ["modelHeader", "now", "sunTimes", "daylight"] },
    ]);
    // The first header: its model and the colour the chart filled it with.
    expect(drawn.header).toEqual({ model: "DWD ICON-D2", color: "#5e97de" });
  });

  it("is left out without model headers", () => {
    const drawn = drawnLegend(chart(false));
    expect(drawn.keys).not.toContain("modelHeader");
    expect(drawn.groups.at(-1)).toEqual({ id: "time", keys: ["now", "sunTimes", "daylight"] });
    expect(drawn.header).toBeNull();
  });

  it("stands alone in the last group where the chart draws no time marks", () => {
    const root = chart(true);
    root.querySelectorAll('[data-testid="daylight-stripe"], [data-testid="sun-time-labels"], line').forEach((element) =>
      element.remove(),
    );
    expect(drawnLegend(root).groups.at(-1)).toEqual({ id: "time", keys: ["modelHeader"] });
  });

  it("takes one or two letters of the first word of the header's name", () => {
    expect(modelHeaderLetters("AROME HD")).toBe("AR");
    expect(modelHeaderLetters("ICON-D2")).toBe("IC");
    expect(modelHeaderLetters("D2")).toBe("D2");
    expect(modelHeaderLetters("MetNo SL")).toBe("Me");
    expect(modelHeaderLetters("Météo-France")).toBe("Mé");
    expect(modelHeaderLetters("X")).toBe("X");
    expect(modelHeaderLetters("")).toBe("");
    // Up to three letters, as the box has room for (REQ-678).
    expect(modelHeaderLetters("AROME HD", 3)).toBe("ARO");
    expect(modelHeaderLetters("ICON-D2", 3)).toBe("ICO");
    expect(modelHeaderLetters("IFS 0.25°", 3)).toBe("IFS");
    expect(modelHeaderLetters("D2", 3)).toBe("D2");
  });

  it("shows the first model's letters in its box, or the example IFS (REQ-678, DEC-071)", () => {
    // The choice of DEC-071: always the example, whichever model comes first.
    expect(MODEL_HEADER_LETTERS_SOURCE).toBe("firstModel");
    expect(legendModelLetters("ICON-D2")).toBe("ICO");
    expect(legendModelLetters("AROME HD")).toBe("ARO");
    expect(legendModelLetters("IFS 0.25°")).toBe("IFS");
    expect(legendModelLetters("ICON-D2", "example")).toBe("IFS");
    expect(legendModelLetters("", "example")).toBe("IFS");
    // The other choice: up to three letters of the first model's name.
    expect(legendModelLetters("ICON-D2", "firstModel")).toBe("ICO");
    expect(legendModelLetters("AROME HD", "firstModel")).toBe("ARO");
    expect(legendModelLetters("D2", "firstModel")).toBe("D2");
  });

  it("is named Weather model in every language (REQ-678)", () => {
    const names = {
      cs: "Model počasí",
      da: "Vejrmodel",
      de: "Wettermodell",
      en: "Weather model",
      fr: "Modèle météo",
      it: "Modello meteo",
      nl: "Weermodel",
      sl: "Vremenski model",
    };
    expect(Object.keys(MESSAGES).sort()).toEqual(Object.keys(names));
    for (const [language, messages] of Object.entries(MESSAGES)) {
      expect(messages["meteogram.legend.modelHeader"]).toBe(names[language as keyof typeof names]);
    }
  });

  it("on the page: a box in the first model's header colour with its letters in white, gone with the headers", async () => {
    stubNarrowPage(true);
    await renderPage();
    await waitFor(() => expect(keys()).toContain("modelHeader"));
    const lists = [...legend()!.querySelectorAll("ul")];
    // In the last group, first in it (REQ-679).
    expect(lists.at(-1)!.dataset.group).toBe("time");
    expect(lists.at(-1)!.querySelector("li")!.dataset.key).toBe("modelHeader");
    const item = legend()!.querySelector('[data-key="modelHeader"]')!;
    expect(item.querySelector(":scope > span")!.textContent).toBe("Weather model");
    // The colour of the chart's first header, as the chart filled it (the chain's shade is checked in the browser).
    const drawnShape = screen
      .getByTestId("meteogram-scroll")
      .querySelector('[data-testid="model-label-segment"] [data-testid="model-header-shape"]')!;
    const box = item.querySelector("svg path")!;
    expect(box.getAttribute("fill")).toBe(drawnShape.getAttribute("fill"));
    // The first model's letters in white: the fixture's first model is "ICON" (REQ-678, DEC-071).
    const letters = item.querySelector("svg text")!;
    expect(letters.textContent).toBe("ICO");
    expect(letters.getAttribute("fill")).toBe(TEXT_LIGHT);

    // Model headers off in the settings: no headers in the chart, no entry in the legend.
    act(() => modelHeadersChoice.set(false));
    await waitFor(() => expect(keys()).not.toContain("modelHeader"));
    expect(screen.getByTestId("meteogram-scroll").querySelector('[data-testid="model-label-segment"]')).toBeNull();
    expect(legend()!.querySelector('ul[data-group="time"]')).toBeNull();
    act(() => modelHeadersChoice.set(true));
    await waitFor(() => expect(keys()).toContain("modelHeader"));
  });
});

describe("legend of the meteogram on the page (REQ-639)", () => {
  it("is a card above the meteogram on a narrow page and follows dew point and relative humidity", async () => {
    stubNarrowPage(true);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    const card = screen.getByTestId("meteogram-card");
    expect(legend()!.dataset.variant).toBe("card");
    // Outside the meteogram card (a pull to refresh moves only that, REQ-638), right before it.
    expect(card.contains(legend())).toBe(false);
    expect(legend()!.nextElementSibling).toBe(card);
    expect(screen.getByRole("complementary", { name: "Legend" })).toBe(legend());
    // Dew point and relative humidity off without a choice: not in chart and legend.
    expect(keys()).toEqual(
      expect.arrayContaining(["temperature", "precipitation", "precipitationProbability", "wind", "gusts"]),
    );
    expect(keys()).not.toContain("dewPoint");
    expect(keys()).not.toContain("relativeHumidity");

    act(() => setRelativeHumidity("on"));
    await waitFor(() => expect(keys()).toContain("relativeHumidity"));
    expect(keys()).not.toContain("dewPoint");
    act(() => setDewPoint("on"));
    await waitFor(() => expect(keys()).toContain("dewPoint"));
    expect(keys().indexOf("dewPoint")).toBe(keys().indexOf("temperature") + 1);
    act(() => setRelativeHumidity("off"));
    await waitFor(() => expect(keys()).not.toContain("relativeHumidity"));
  });

  it("draws each symbol with the chart's colour and dash", async () => {
    stubNarrowPage(true);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    const line = (key: string) => legend()!.querySelector(`[data-key="${key}"] svg line`)!;
    expect(line("temperature").getAttribute("stroke")).toBe(LIGHT_THEME.series.temperature);
    expect(line("temperature").getAttribute("stroke-dasharray")).toBeNull();
    expect(line("gusts").getAttribute("stroke")).toBe(LIGHT_THEME.series.wind_gusts);
    expect(line("gusts").getAttribute("stroke-dasharray")).toBe(getSeriesDashArray("wind_gusts", undefined));
    const drawnGusts = screen.getByTestId("meteogram-scroll").querySelector('[data-testid="wind-gusts-path"]')!;
    expect(line("gusts").getAttribute("stroke-dasharray")).toBe(drawnGusts.getAttribute("stroke-dasharray"));
  });

  it("stands beside the card on the desktop where the margin has room, else as a card above it (REQ-670)", async () => {
    stubNarrowPage(false);
    stubCardLeft(400);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    expect(legend()!.dataset.variant).toBe("side");
    expect(screen.getByTestId("meteogram-card").contains(legend())).toBe(true);
    expect(legend()!.style.width).toBe(`${SIDE_LEGEND_MAX_WIDTH}px`);
    expect(screen.getByRole("heading", { name: "Legend" })).toBeTruthy();
    cleanup();
    vi.restoreAllMocks();

    // 120 px of room: as narrow as it gets; 119 px: a card above the meteogram instead, with more columns.
    stubCardLeft(120 + 2 * SIDE_LEGEND_GAP);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    expect(legend()!.style.width).toBe("120px");
    cleanup();
    vi.restoreAllMocks();
    stubCardLeft(119 + 2 * SIDE_LEGEND_GAP);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    const card = screen.getByTestId("meteogram-card");
    expect(legend()!.dataset.variant).toBe("card");
    expect(legend()!.classList.contains("meteogram-legend--wide")).toBe(true);
    expect(card.contains(legend())).toBe(false);
    expect(legend()!.nextElementSibling).toBe(card);
    expect(legend()!.style.width).toBe("");
    expect(readLegend()).toBe(true);
  });

  it("is a card of two columns on a narrow page, not the desktop's", async () => {
    stubNarrowPage(true);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    expect(legend()!.classList.contains("meteogram-legend--wide")).toBe(false);
  });

  it("groups its entries by the chart's areas, dew point and humidity with the temperature (REQ-674)", async () => {
    stubNarrowPage(true);
    act(() => {
      setDewPoint("on");
      setRelativeHumidity("on");
    });
    await renderPage();
    await waitFor(() => expect(keys()).toContain("relativeHumidity"));
    const groups = () =>
      [...legend()!.querySelectorAll("ul")].map((list) => ({
        id: list.dataset.group,
        keys: [...list.querySelectorAll("li")].map((item) => item.dataset.key),
      }));
    // The chart's areas from the built-in layout: temperature, precipitation and clouds, wind. This chart draws no
    // time marks (no daylight here, the current time outside it), only the model headers in the last group (REQ-677);
    // the time marks are checked above and in the browser.
    expect(groups().map((group) => group.id)).toEqual(["temp", "precip", "wind", "time"]);
    expect(groups()[3]!.keys).toEqual(["modelHeader"]);
    expect(groups()[0]!.keys).toEqual(["temperature", "dewPoint", "relativeHumidity"]);
    expect(groups()[1]!.keys).toEqual(["precipitation", "precipitationProbability"]);
    expect(groups()[2]!.keys).toEqual(["wind", "gusts", "windDirection"]);
    // Relative humidity off: gone from its group, the group stays.
    act(() => setRelativeHumidity("off"));
    await waitFor(() => expect(keys()).not.toContain("relativeHumidity"));
    expect(groups()[0]!.keys).toEqual(["temperature", "dewPoint"]);
  });

  it("closes with its X, stays closed and comes back with the setting", async () => {
    stubNarrowPage(true);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    fireEvent.click(within(legend()!).getByRole("button", { name: "Close the legend" }));
    expect(legend()).toBeNull();
    expect(window.localStorage.getItem(LEGEND_STORAGE_KEY)).toBe("false");
    const show = openSettings("Meteogram").getByRole("checkbox", { name: "Show the legend" });
    expect(show).toHaveProperty("checked", false);
    fireEvent.click(show);
    await waitFor(() => expect(legend()).not.toBeNull());
  });

  it("is not shown with the full-screen view open", async () => {
    stubNarrowPage(false);
    stubCardLeft(400);
    await renderPage();
    await waitFor(() => expect(legend()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    expect(screen.getByTestId("meteogram-fullscreen")).toBeTruthy();
    expect(legend()).toBeNull();
    expect(screen.getByTestId("meteogram-fullscreen").querySelector('[data-testid="meteogram-legend"]')).toBeNull();
  });
});

describe("short texts on the narrow page's card (REQ-720)", () => {
  const SHORT = {
    cs: "Směr",
    da: "Retning",
    de: "Richtung",
    en: "Direction",
    fr: "Direction",
    it: "Direzione",
    nl: "Richting",
    sl: "Smer",
  };
  const FULL = {
    cs: "Směr větru",
    da: "Vindretning",
    de: "Windrichtung",
    en: "Wind direction",
    fr: "Direction du vent",
    it: "Direzione del vento",
    nl: "Windrichting",
    sl: "Smer vetra",
  };

  it("names the wind arrows Direction on the narrow card and Wind direction elsewhere, in every language", () => {
    expect([...LANGUAGES].sort()).toEqual(Object.keys(SHORT));
    for (const language of LANGUAGES) {
      expect(translate(language, legendLabel("windDirection", true))).toBe(SHORT[language]);
      expect(translate(language, legendLabel("windDirection", false))).toBe(FULL[language]);
      // Each language has its own short text, shorter than the full one.
      expect(MESSAGES[language]["meteogram.legend.windDirectionShort"]).toBe(SHORT[language]);
      expect(SHORT[language].length).toBeLessThan(FULL[language].length);
    }
  });

  it("keeps the other entries' texts on the narrow card", () => {
    for (const { key, label } of LEGEND_ITEMS) {
      if (key !== "windDirection") expect(legendLabel(key, true)).toBe(label);
    }
  });

  const windDirection = () => legend()!.querySelector('[data-key="windDirection"] > span')!.textContent;

  it("on the page: Direction on a narrow page", async () => {
    stubNarrowPage(true);
    await renderPage();
    await waitFor(() => expect(keys()).toContain("windDirection"));
    expect(legend()!.dataset.variant).toBe("card");
    expect(windDirection()).toBe("Direction");
  });

  it("on the page: Wind direction on the desktop, beside the card and as the wide card above it", async () => {
    stubNarrowPage(false);
    stubCardLeft(400);
    await renderPage();
    await waitFor(() => expect(keys()).toContain("windDirection"));
    expect(legend()!.dataset.variant).toBe("side");
    expect(windDirection()).toBe("Wind direction");
    cleanup();
    vi.restoreAllMocks();

    stubCardLeft(119 + 2 * SIDE_LEGEND_GAP);
    await renderPage();
    await waitFor(() => expect(keys()).toContain("windDirection"));
    expect(legend()!.dataset.variant).toBe("card");
    expect(windDirection()).toBe("Wind direction");
  });
});

describe("columns of the card on a tablet in landscape (REQ-756, REQ-763)", () => {
  const TIME = { id: "time", keys: ["modelHeader", "now", "sunTimes", "daylight"] } as const;
  const TEMP = { id: "temp", keys: ["temperature", "apparentTemperature"] } as const;
  const PRECIP = { id: "precip", keys: ["precipitation", "precipitationProbability", "clouds"] } as const;
  const WIND = { id: "wind", keys: ["wind", "gusts", "windDirection"] } as const;

  it("always four columns: temperature, precipitation, wind, time marks, with or without dew point and humidity", () => {
    for (const extra of [[], ["dewPoint"], ["relativeHumidity"], ["dewPoint", "relativeHumidity"]] as const) {
      const temp = { id: "temp", keys: [...TEMP.keys, ...extra] };
      expect(legendColumns([temp, PRECIP, WIND, TIME])).toEqual([[temp], [PRECIP], [WIND], [TIME]]);
    }
  });

  it("places a group by its entries, whatever the order or ids of the chart's areas; leaves out empty columns", () => {
    const wind = { id: "w", keys: ["wind"] } as const;
    const temp = { id: "t", keys: ["temperature"] } as const;
    expect(legendColumns([TIME, wind, PRECIP, temp])).toEqual([[temp], [PRECIP], [wind], [TIME]]);
    // Two groups of one kind (an entry drawn outside every area) share their column.
    const snow = { id: "precipitation", keys: ["snow"] } as const;
    expect(legendColumns([TEMP, PRECIP, WIND, snow, TIME])).toEqual([[TEMP], [PRECIP, snow], [WIND], [TIME]]);
    expect(legendColumns([TEMP, PRECIP])).toEqual([[TEMP], [PRECIP]]);
    expect(legendColumns([])).toEqual([]);
  });

  /** matchMedia and screen of an iPad Pro 11, turned or upright: a coarse pointer, landscape while turned. */
  function stubTablet(turned: boolean) {
    vi.stubGlobal("screen", turned ? { width: 1194, height: 834 } : { width: 834, height: 1194 });
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === COARSE_POINTER_QUERY || (turned && query === LANDSCAPE_QUERY),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  }

  const columns = () =>
    [...legend()!.querySelectorAll(".meteogram-legend__column")].map((column) =>
      [...column.querySelectorAll("ul")].map((list) => list.dataset.group),
    );

  it("on the page: four columns on a turned tablet, also without the dew point, none upright", async () => {
    stubTablet(true);
    act(() => setRelativeHumidity("off"));
    await renderPage();
    await waitFor(() => expect(keys()).toContain("windDirection"));
    expect(legend()!.dataset.variant).toBe("card");
    expect(legend()!.classList.contains("meteogram-legend--columns")).toBe(true);
    expect(legend()!.dataset.columns).toBe("4");
    // This chart draws no time marks but the model headers (see above).
    expect(columns()).toEqual([["temp"], ["precip"], ["wind"], ["time"]]);
    act(() => setDewPoint("on"));
    await waitFor(() => expect(keys()).toContain("dewPoint"));
    expect(legend()!.dataset.columns).toBe("4");
    expect(columns()).toEqual([["temp"], ["precip"], ["wind"], ["time"]]);
    // The entries keep their texts, as on the narrow page's card (REQ-720).
    expect(legend()!.querySelector('[data-key="windDirection"] > span')!.textContent).toBe("Direction");
    cleanup();

    stubTablet(false);
    await renderPage();
    await waitFor(() => expect(keys()).toContain("windDirection"));
    expect(legend()!.classList.contains("meteogram-legend--columns")).toBe(false);
    expect(legend()!.dataset.columns).toBeUndefined();
    expect(columns()).toEqual([]);
    expect([...legend()!.querySelectorAll("ul")].map((list) => list.dataset.group)).toEqual([
      "temp",
      "precip",
      "wind",
      "time",
    ]);
  });

  it("not on the desktop's cards", async () => {
    stubNarrowPage(false);
    stubCardLeft(119 + 2 * SIDE_LEGEND_GAP);
    await renderPage();
    await waitFor(() => expect(keys()).toContain("windDirection"));
    expect(legend()!.classList.contains("meteogram-legend--wide")).toBe(true);
    expect(legend()!.dataset.columns).toBeUndefined();
    expect(columns()).toEqual([]);
  });
});
