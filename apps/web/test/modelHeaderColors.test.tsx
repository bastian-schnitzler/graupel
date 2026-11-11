// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The meteogram's model headers in the shades of the weather chain (REQ-443, REQ-456), never in the meteogram's own
 * orange (REQ-770): the colours follow the models the chart draws, in their order. A replacement model (REQ-767) takes
 * the shade of the model it stands in for; the chart of the previous place during a place change and an archived fetch
 * (REQ-684) whose chain differs from the selected one take the shades of their own chain.
 */
import type { ChainModelResult, ForecastResult, WeatherModel } from "@graupel/download";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE, type Place } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import type { ModelData } from "../src/services/modelData.ts";
import { archiveId, createMemoryArchive, type ArchivedFetch } from "../src/services/fetchArchive.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  HistoryProvider,
  LocationProvider,
  chainShades,
  createAppModeStore,
  drawnModelHeaderColors,
  modelHeaderColors,
  placeKey,
  useChainSelection,
  useForecast,
  useHistory,
  useLocation,
  type AppModeWindow,
  type ChainSelection,
  type ForecastLoader,
  type ForecastState,
  type HistoryState,
  type PageTheme,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

/** The meteogram core's default header colours (light, dark): the app must never show them. */
const CORE_ORANGE = ["#f59e0b", "#d97706"];
const THEMES: PageTheme[] = ["light", "dark"];
/** Sölden (Austria): its chain starts with C-LAEF, unlike the start place's (Mont Blanc). */
const SOELDEN: Place = { name: "Sölden", lat: 46.9633, lon: 11.0071 };

const MODEL_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../model-data");
const read = (file: string) => readFileSync(resolve(MODEL_DATA_DIR, file), "utf8");
const DATA: ModelData = {
  catalogue: JSON.parse(read("model_catalogue.json")),
  registry: JSON.parse(read("quantities.json")),
  domains: JSON.parse(read("model_domains.json")),
  regions: JSON.parse(read("regions.geojson")),
};
const loadData = () => Promise.resolve(DATA);

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

let selection: ChainSelection;
let location: ReturnType<typeof useLocation>;
let forecast: ForecastState;
let history: HistoryState;

function Probe() {
  const chain = useChainSelection();
  const place = useLocation();
  const shown = useForecast();
  const value = useHistory();
  useEffect(() => {
    selection = chain;
    location = place;
    forecast = shown;
    history = value;
  });
  return null;
}

/** A loader whose loads stay pending until the test settles them. */
function pendingLoader() {
  const pending: ((result: ForecastResult) => void)[] = [];
  const loader = vi.fn<ForecastLoader>(() => new Promise<ForecastResult>((resolve) => pending.push(resolve)));
  return { loader, pending };
}

const installed = createAppModeStore({
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  navigator: { standalone: true } as AppModeWindow["navigator"],
});

function renderPage(loader: ForecastLoader, archive = createMemoryArchive()) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider loadData={loadData}>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <HistoryProvider archive={archive} appMode={installed}>
                  <Probe />
                  <MeteogramPanel />
                </HistoryProvider>
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

/** Ends of the slices after now: every model gets a header of its own within the fixture's days. */
const SLICE_ENDS = [30, 70, 400, 500, 600];

/** A chain entry of the result for a selected model. */
function entry(model: WeatherModel, index: number): ChainModelResult {
  const hours = SLICE_ENDS[index] ?? 600 + index;
  return {
    model: model.name,
    ...(model.id !== undefined ? { id: model.id } : {}),
    ...(model.short_name !== undefined ? { shortName: model.short_name } : {}),
    sliceEndHours: hours,
    configuredHours: hours,
  };
}

/** The fixture forecast of `place` with `chain` as its stitched weather chain. */
function result(place: Place, chain: ChainModelResult[]): ForecastResult {
  return { ...forecastFixture({ name: place.name, latitude: place.lat, longitude: place.lon }), chain };
}

/** Header fill per drawn model, in drawing order (one entry per model, not per run). */
function headers(container: HTMLElement): { model: string; fill: string }[] {
  const all = [...container.querySelectorAll('[data-region="meteogram"] [data-testid="model-label-segment"]')].map(
    (segment) => ({
      model: segment.getAttribute("data-model") ?? "",
      fill: segment.querySelector('[data-testid="model-header-shape"]')?.getAttribute("fill") ?? "",
    }),
  );
  return all.filter((header, index) => index === 0 || all[index - 1]!.model !== header.model);
}

/** The shades the headers of `models` must have when the chart draws a chain of `count` models. */
function shadesOf(models: readonly string[], theme: PageTheme, count = models.length) {
  const shades = chainShades(count, "main", theme);
  return models.map((model, index) => ({ model, fill: shades[index]!.color }));
}

async function chainOf(place: Place): Promise<WeatherModel[]> {
  await waitFor(() => {
    expect(selection.status).toBe("ready");
    expect(placeKey(location.place)).toBe(placeKey(place));
    expect(selection.models.length).toBeGreaterThanOrEqual(2);
  });
  return selection.models;
}

function expectNoOrange(container: HTMLElement) {
  const fills = headers(container).map((header) => header.fill);
  expect(fills.length).toBeGreaterThanOrEqual(2);
  for (const fill of fills) expect(CORE_ORANGE).not.toContain(fill.toLowerCase());
}

describe("model header colours follow the drawn chain (REQ-770)", () => {
  for (const theme of THEMES) {
    it(`keep the chain's shades, after a place change and a reload, in ${theme} mode`, async () => {
      document.documentElement.dataset.theme = theme;
      const { loader, pending } = pendingLoader();
      const { container, unmount } = renderPage(loader);
      const montBlanc = await chainOf(DEFAULT_PLACE);
      expect(montBlanc.map((model) => model.id)).not.toContain("geosphere_claef_austria");
      await act(async () => pending.at(-1)!(result(DEFAULT_PLACE, montBlanc.map(entry))));
      // The same chain as the cards: each header in its model's card shade (REQ-443).
      await waitFor(() => expect(headers(container)).toEqual(shadesOf(montBlanc.map((model) => model.name), theme)));

      // A new place: its chain (C-LAEF first) is selected at once, while the previous place's chart stands until the
      // new forecast is there (REQ-751). Its headers keep the shades of their own chain.
      act(() => location.setLocation(SOELDEN));
      const soelden = await chainOf(SOELDEN);
      expect(soelden[0]!.id).toBe("geosphere_claef_austria");
      expect(forecast.status).toBe("loading");
      expectNoOrange(container);
      expect(headers(container)).toEqual(shadesOf(montBlanc.map((model) => model.name), theme));
      await act(async () => pending.at(-1)!(result(SOELDEN, soelden.map(entry))));
      await waitFor(() => expect(headers(container)[0]?.model).toBe(soelden[0]!.name));
      expect(headers(container)).toEqual(shadesOf(soelden.map((model) => model.name), theme));

      // A reload (refresh button, pull to refresh) keeps them.
      act(() => forecast.reload());
      expect(forecast.status).toBe("loading");
      expect(headers(container)).toEqual(shadesOf(soelden.map((model) => model.name), theme));
      await act(async () => pending.at(-1)!(result(SOELDEN, soelden.map(entry))));
      await waitFor(() => expect(forecast.status).toBe("ready"));
      expect(headers(container)).toEqual(shadesOf(soelden.map((model) => model.name), theme));

      // Reloading the page (Sölden is the place shown last) draws them the same way.
      unmount();
      const again = pendingLoader();
      const next = renderPage(again.loader);
      await chainOf(SOELDEN);
      await act(async () => again.pending.at(-1)!(result(SOELDEN, soelden.map(entry))));
      await waitFor(() => expect(headers(next.container)).toEqual(shadesOf(soelden.map((m) => m.name), theme)));
    });

    it(`give a replacement model the shade of the model it replaces, in ${theme} mode (REQ-767)`, async () => {
      document.documentElement.dataset.theme = theme;
      const { loader, pending } = pendingLoader();
      const { container } = renderPage(loader);
      const chain = await chainOf(DEFAULT_PLACE);
      // AROME France (cloud chain only) takes the first model's slice, as in the fake of e2e/model-replacement.
      const [first, ...rest] = chain.map(entry);
      const replacement: ChainModelResult = {
        ...first!,
        model: "AROME France",
        id: "meteofrance_arome_france",
        shortName: "AROME FR",
        replaces: { model: first!.model, ...(first!.id ? { id: first!.id } : {}) },
      };
      await act(async () => pending.at(-1)!(result(DEFAULT_PLACE, [replacement, ...rest])));
      await waitFor(() => expect(headers(container)[0]?.model).toBe("AROME France"));
      expectNoOrange(container);
      const shades = chainShades(chain.length, "main", theme);
      expect(headers(container).map((header) => header.fill)).toEqual(shades.map((shade) => shade.color));
    });

    it(`colour an archived fetch with another chain in that chain's shades, in ${theme} mode (REQ-684)`, async () => {
      document.documentElement.dataset.theme = theme;
      // An earlier fetch archived under the start place whose chain differs from the selected one (C-LAEF first).
      const point = placeKey(DEFAULT_PLACE);
      const fetchedAt = Date.now() - 3_600_000;
      const other: ChainModelResult[] = [
        { model: "C-LAEF", id: "geosphere_claef_austria", sliceEndHours: 30, configuredHours: 30 },
        { model: "ICON-EU", id: "icon_eu", sliceEndHours: 70, configuredHours: 70 },
        { model: "IFS HRES", id: "ecmwf_ifs", sliceEndHours: 400, configuredHours: 400 },
      ];
      const archived: ArchivedFetch = {
        id: archiveId(point, fetchedAt),
        point,
        fetchedAt,
        result: result(DEFAULT_PLACE, other),
      };
      const { loader, pending } = pendingLoader();
      const { container } = renderPage(loader, createMemoryArchive([archived]));
      const chain = await chainOf(DEFAULT_PLACE);
      expect(chain.map((model) => model.id)).not.toContain("geosphere_claef_austria");
      await act(async () => pending.at(-1)!(result(DEFAULT_PLACE, chain.map(entry))));
      await waitFor(() => expect(history.fetches.map((fetch) => fetch.id)).toContain(archived.id));
      await act(async () => history.show(archived.id));
      await waitFor(() => expect(headers(container)[0]?.model).toBe("C-LAEF"));
      expect(forecast.archived).toBe(true);
      expectNoOrange(container);
      expect(headers(container)).toEqual(shadesOf(["C-LAEF", "ICON-EU", "IFS HRES"], theme));
    });
  }
});

describe("drawnModelHeaderColors (REQ-770)", () => {
  const selected: WeatherModel[] = [
    { id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { id: "ecmwf_ifs", name: "IFS HRES", max_forecast_horizon_hours: 360 },
  ];
  const drawn = (models: WeatherModel[]): ChainModelResult[] =>
    models.map((model) => ({ model: model.name, id: model.id!, sliceEndHours: 1, configuredHours: 1 }));

  it("equals the selected chain's colours when the chart draws that chain", () => {
    for (const theme of THEMES) {
      expect(drawnModelHeaderColors(drawn(selected), selected, theme)).toEqual({
        ...modelHeaderColors(selected, theme),
        "ICON-D2": chainShades(3, "main", theme)[0]!.color,
        "ICON-EU": chainShades(3, "main", theme)[1]!.color,
        "IFS HRES": chainShades(3, "main", theme)[2]!.color,
      });
    }
  });

  it("keeps the card shades when the result leaves a model of the chain out", () => {
    const shades = chainShades(3, "main", "light");
    const colors = drawnModelHeaderColors(drawn([selected[0]!, selected[2]!]), selected, "light");
    expect(colors.icon_d2).toBe(shades[0]!.color);
    expect(colors.ecmwf_ifs).toBe(shades[2]!.color);
  });

  it("gives a replacement the shade of the model it replaces", () => {
    const shades = chainShades(3, "main", "dark");
    const chain = drawn(selected);
    chain[0] = { ...chain[0]!, model: "ICON-D2-RUC", id: "icon_d2_ruc", replaces: { model: "ICON-D2", id: "icon_d2" } };
    const colors = drawnModelHeaderColors(chain, selected, "dark");
    expect(colors.icon_d2_ruc).toBe(shades[0]!.color);
    expect(colors["ICON-D2-RUC"]).toBe(shades[0]!.color);
  });

  it("shades another chain over its own models, in its order", () => {
    const other: WeatherModel[] = [
      { id: "geosphere_claef_austria", name: "C-LAEF", max_forecast_horizon_hours: 60 },
      { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { id: "ecmwf_ifs", name: "IFS HRES", max_forecast_horizon_hours: 360 },
    ];
    for (const theme of THEMES) {
      const shades = chainShades(3, "main", theme);
      const colors = drawnModelHeaderColors(drawn(other), selected, theme);
      expect([colors.geosphere_claef_austria, colors.icon_eu, colors.ecmwf_ifs]).toEqual(
        shades.map((shade) => shade.color),
      );
    }
  });

  it("falls back to the selected chain without a drawn one", () => {
    expect(drawnModelHeaderColors([], selected, "light")).toEqual(modelHeaderColors(selected, "light"));
    expect(drawnModelHeaderColors(undefined, selected, "light")).toEqual(modelHeaderColors(selected, "light"));
  });
});
