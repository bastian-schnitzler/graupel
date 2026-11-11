// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Model chain cards (REQ-435, REQ-482) with the real data of `@graupel/model-data`: loading the files, the auto chain
 * of `@graupel/download` per place, moved boundaries (REQ-481) that a newly loaded place resets, and no edit mode on
 * the website (REQ-480).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig, type Place } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { I18nProvider } from "../src/i18n/index.ts";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { Header } from "../src/regions/Header/index.ts";
import { ModelChain } from "../src/regions/ModelChain/index.ts";
import { REGIONS_URL, fetchRegions, loadModelData, resetModelData, type ModelData } from "../src/services/modelData.ts";
import {
  ChainProvider,
  ForecastProvider,
  LocationProvider,
  CLOUD_CHAIN_STORAGE_KEY,
  LEGACY_MODEL_CHAIN_STORAGE_KEY,
  WEATHER_CHAIN_STORAGE_KEY,
  cloudChainChoice,
  effectiveChainCards,
  migrateModelChainChoice,
  deliveredSpans,
  isNewPlace,
  resetModelChainView,
  setModelChainVisible,
  useChainSelection,
  useLocation,
  useOptionalChainSelection,
  weatherChainChoice,
  type ChainSelection,
  type ForecastLoader,
} from "../src/state/index.ts";
import type { DataPoint, ForecastResult, VerticalCloudProfile } from "@graupel/download";
import { FIXTURE_NOW, HOUR, forecastFixture } from "./forecastFixture.ts";

const MODEL_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../model-data");
const read = (file: string) => readFileSync(resolve(MODEL_DATA_DIR, file), "utf8");
const DATA: ModelData = {
  catalogue: JSON.parse(read("model_catalogue.json")),
  registry: JSON.parse(read("quantities.json")),
  domains: JSON.parse(read("model_domains.json")),
  regions: JSON.parse(read("regions.geojson")),
};
const regionsResponse = (url: string) =>
  url === REGIONS_URL ? new Response(read("regions.geojson")) : new Response("", { status: 404 });
const CASES = (
  JSON.parse(read("resolver_cases.json")) as {
    cases: { name: string; lat: number; lon: number; region_id: string | null; main_chain_ids: string[]; cloud_chain_ids: string[] }[];
  }
).cases;

const ZUGSPITZE: Place = { name: "Zugspitze", lat: 47.421, lon: 10.985, elevation: 2962 };
const loadData = () => Promise.resolve(DATA);

// What the components see, copied after each render.
const probe: { selection: ChainSelection | null; location: ReturnType<typeof useLocation> | null } = {
  selection: null,
  location: null,
};
function Probe() {
  const selection = useChainSelection();
  const location = useLocation();
  useEffect(() => {
    probe.selection = selection;
    probe.location = location;
  });
  return null;
}

/** How the cards start: hidden (the default) or shown. */
type BlockView = "hidden" | "shown";

function renderBlock(
  {
    config = DEFAULT_CONFIG,
    place = ZUGSPITZE,
    load = loadData,
    view = "shown",
    forecast,
  }: {
    config?: GraupelConfig;
    place?: Place;
    load?: () => Promise<ModelData>;
    view?: BlockView;
    forecast?: ForecastLoader;
  } = {},
) {
  if (view === "shown") setModelChainVisible(true);
  const block = (
    <>
      <ModelChain />
      <Probe />
    </>
  );
  return render(
    <ConfigProvider config={config}>
      <I18nProvider browserLanguages={["en"]}>
        <NoticesProvider>
          <LocationProvider initial={place}>
            <ChainProvider loadData={load}>
              {forecast ? <ForecastProvider loader={forecast}>{block}</ForecastProvider> : block}
            </ChainProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(probe.selection?.status).toBe("ready"));
}

beforeEach(() => {
  window.localStorage.clear();
  resetModelChainView();
  probe.selection = null;
  probe.location = null;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetModelChainView();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("model data", () => {
  it("fetches regions.geojson from its asset URL once and adds the bundled documents", async () => {
    const fetchFn = vi.fn(async (url: string) => regionsResponse(url));
    vi.stubGlobal("fetch", fetchFn);
    resetModelData();
    expect(REGIONS_URL).toMatch(/regions.*\.geojson/);
    const data = await loadModelData();
    await loadModelData();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect((data.regions as { features: unknown[] }).features.length).toBeGreaterThan(10);
    expect(data.catalogue).toEqual(DATA.catalogue);
    expect(data.domains).toEqual(DATA.domains);
  });

  it("rejects a document without features", async () => {
    const fetchFn = async () => new Response("{}");
    await expect(fetchRegions(fetchFn as unknown as typeof fetch, "/r")).rejects.toThrow("no features");
  });
});

describe("chain selection (resolver of @graupel/download)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("resolves the auto chain at %s like the generator", async (_, c) => {
    render(
      <LocationProvider initial={{ name: c.name, lat: c.lat, lon: c.lon }}>
        <ChainProvider loadData={loadData}>
          <Probe />
        </ChainProvider>
      </LocationProvider>,
    );
    await ready();
    expect(probe.selection!.mode).toBe("auto");
    expect(probe.selection!.chain).toEqual(c.main_chain_ids);
    expect(probe.selection!.cloudChain).toEqual(c.cloud_chain_ids);
    expect(probe.selection!.resolved?.region_id ?? null).toBe(c.region_id);
    // Horizons strictly increase and are the catalogue horizons.
    const hours = probe.selection!.models.map((m) => m.max_forecast_horizon_hours);
    expect(hours).toEqual([...hours].sort((a, b) => a - b));
    expect(new Set(hours).size).toBe(hours.length);
  });

  it("follows the place in auto mode", async () => {
    renderBlock();
    await ready();
    expect(probe.selection!.chain).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs"]);
    act(() => probe.location!.setLocation({ name: "New York", lat: 40.71, lon: -74.01 }));
    expect(probe.selection!.chain).not.toContain("icon_d2");
    expect(probe.selection!.chain.at(-1)).toBe("ecmwf_ifs");
  });

  it("keeps a manual chain, drops unknown ids, and goes back to auto", async () => {
    renderBlock();
    await ready();
    act(() => probe.selection!.setChain(["icon_eu", "nonexistent", { id: "ecmwf_ifs", max_forecast_horizon_hours: 200 }]));
    expect(probe.selection!.mode).toBe("manual");
    expect(probe.selection!.chain).toEqual(["icon_eu", "ecmwf_ifs"]);
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([120, 200]);
    expect(probe.selection!.models[1]!.name).toBe("ECMWF IFS HRES 9km");
    // The cloud chain stays the auto one and follows the place.
    expect(probe.selection!.cloudChain).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs025"]);

    act(() => probe.selection!.setChain(["icon_d2"], null));
    expect(probe.selection!.cloudChain).toBeUndefined();
    expect(probe.selection!.cloudModels).toEqual([]);
    act(() => probe.selection!.setChain(["icon_eu"]));
    expect(probe.selection!.cloudChain).toBeUndefined();

    act(() => probe.selection!.setAuto());
    expect(probe.selection!.mode).toBe("auto");
    expect(probe.selection!.chain).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs"]);
  });

  it("starts a newly loaded place from its auto chain; its elevation arriving later keeps the chain (REQ-481)", async () => {
    renderBlock({ place: { name: "Zugspitze", lat: 47.421, lon: 10.985 } });
    await ready();
    act(() => probe.selection!.setChain([{ id: "icon_d2", max_forecast_horizon_hours: 30 }, "icon_eu", "ecmwf_ifs"]));
    expect(probe.selection!.mode).toBe("manual");

    // The same place completed with its elevation: still the moved chain.
    act(() => probe.location!.setLocation({ name: "Zugspitze", lat: 47.421, lon: 10.985, elevation: 2962 }));
    expect(probe.selection!.mode).toBe("manual");
    // The same place loaded again: back to automatic.
    act(() => probe.location!.setLocation({ name: "Zugspitze", lat: 47.421, lon: 10.985, elevation: 2962 }));
    expect(probe.selection!.mode).toBe("auto");
    expect(probe.selection!.models[0]!.max_forecast_horizon_hours).toBe(48);

    // Another place: back to automatic, with that place's chain.
    act(() => probe.selection!.setChain(["icon_eu", "ecmwf_ifs"]));
    act(() => probe.location!.setLocation({ name: "New York", lat: 40.71, lon: -74.01 }));
    expect(probe.selection!.mode).toBe("auto");
    expect(probe.selection!.chain).not.toContain("icon_d2");
  });

  it("tells a newly loaded place from one completed with its elevation", () => {
    const place: Place = { name: "A", lat: 1, lon: 2 };
    expect(isNewPlace(place, place)).toBe(false);
    expect(isNewPlace(place, { ...place, elevation: 5 })).toBe(false);
    expect(isNewPlace(place, { ...place })).toBe(true);
    expect(isNewPlace(place, { ...place, name: "B", elevation: 5 })).toBe(true);
    expect(isNewPlace(place, { name: "A", lat: 1.5, lon: 2, elevation: 5 })).toBe(true);
    expect(isNewPlace({ ...place, elevation: 5 }, { ...place, elevation: 5 })).toBe(true);
  });

  it("takes a manual chain from the bundled catalogue while the regions load", () => {
    renderBlock({ load: () => new Promise(() => {}) });
    expect(probe.selection!.status).toBe("loading");
    expect(probe.selection!.chain).toEqual([]);
    act(() => probe.selection!.setChain(["icon_d2", { id: "ecmwf_ifs", max_forecast_horizon_hours: 99 }], null));
    expect(probe.selection!.models).toMatchObject([
      { id: "icon_d2", max_forecast_horizon_hours: 48 },
      { id: "ecmwf_ifs", max_forecast_horizon_hours: 99 },
    ]);
  });

  it("reports a failed load; outside a provider it is empty", async () => {
    renderBlock({ load: () => Promise.reject(new Error("offline")) });
    await waitFor(() => expect(probe.selection!.status).toBe("error"));
    // The message is an error card (REQ-492); the region keeps an empty placeholder.
    expect(screen.getByTestId("error-card").textContent).toBe(
      "The model data could not be loaded. Check your connection and reload the page.",
    );
    expect(screen.getByRole("region", { name: "Model chain" }).textContent).toBe("");
    cleanup();

    const seen: { optional?: ChainSelection | null } = {};
    function Outside() {
      const optional = useOptionalChainSelection();
      useEffect(() => {
        seen.optional = optional;
      });
      return <Probe />;
    }
    render(<Outside />);
    expect(seen.optional).toBeNull();
    expect(probe.selection!).toMatchObject({ mode: "auto", chain: [], status: "loading" });
  });
});

describe("model chain cards (REQ-482)", () => {
  it("shows a loading state, then the weather and the cloud chain of the place as two cards", async () => {
    let resolve!: (data: ModelData) => void;
    renderBlock({ load: () => new Promise((r) => (resolve = r)) });
    expect(screen.getByRole("status").textContent).toBe("Loading model data…");
    await act(async () => resolve(DATA));

    const region = screen.getByRole("region", { name: "Model chain" });
    const cards = region.querySelectorAll(".model-chain-row");
    expect([...cards].map((card) => card.getAttribute("aria-label"))).toEqual(["Weather chain", "Cloud chain"]);
    const weather = within(region).getByRole("group", { name: "Weather chain" });
    expect(within(weather).getByTestId("border-label").textContent).toBe("Weather");
    expect(within(weather).getByTestId("model-card-icon_d2").textContent).toContain("ICON-D2");
    expect(within(weather).getByTestId("model-card-ecmwf_ifs").textContent).toContain("IFS HRES");
    expect(within(weather).getByTestId("model-card-icon_d2").textContent).toContain("0–48 h");
    const clouds = within(region).getByRole("group", { name: "Cloud chain" });
    expect(within(clouds).getByTestId("cloud-model-card-ecmwf_ifs025")).toBeTruthy();
    // Nothing left of the old card: no heading, region text, buttons other than the info buttons, or hint.
    expect(within(region).queryByRole("heading")).toBeNull();
    expect(region.textContent).not.toContain("Automatic");
    expect(region.textContent).not.toContain("hours from now");
    expect(
      within(region)
        .getAllByRole("button")
        .every((button) => button.getAttribute("aria-label")!.startsWith("Details for ")),
    ).toBe(true);
  });

  it("moving a boundary makes a custom chain; a newly loaded place resets it", async () => {
    renderBlock();
    await ready();
    const weather = screen.getByRole("group", { name: "Weather chain" });
    const boundary = within(weather).getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    fireEvent.keyDown(boundary, { key: "ArrowLeft", shiftKey: true });
    expect(probe.selection!.mode).toBe("auto");
    fireEvent.keyUp(boundary, { key: "ArrowLeft" });

    expect(probe.selection!.mode).toBe("manual");
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([36, 120, 360]);
    expect(within(weather).getByTestId("model-card-icon_d2").textContent).toContain("0–36 h");
    // The cloud chain stays the automatic one.
    expect(probe.selection!.cloudChain).toEqual(["icon_d2", "icon_eu", "ecmwf_ifs025"]);

    // The cloud chain moves on its own; the weather chain keeps its boundary.
    const clouds = screen.getByRole("group", { name: "Cloud chain" });
    const cloudBoundary = within(clouds).getByRole("slider", { name: "Boundary between ICON-EU and IFS" });
    // At its limit (ICON-EU runs 120 hours) it does not move on.
    fireEvent.keyDown(cloudBoundary, { key: "ArrowRight" });
    fireEvent.keyUp(cloudBoundary, { key: "ArrowRight" });
    expect(cloudBoundary.getAttribute("aria-valuenow")).toBe("120");
    fireEvent.keyDown(cloudBoundary, { key: "ArrowLeft" });
    fireEvent.keyDown(cloudBoundary, { key: "ArrowLeft" });
    fireEvent.keyUp(cloudBoundary, { key: "ArrowLeft" });
    expect(probe.selection!.cloudModels.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 118, 360]);
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([36, 120, 360]);

    act(() => probe.location!.setLocation({ ...ZUGSPITZE }));
    expect(probe.selection!.mode).toBe("auto");
    expect(within(weather).getByTestId("model-card-icon_d2").textContent).toContain("0–48 h");
    expect(boundary.getAttribute("aria-valuenow")).toBe("48");
  });

  it("a double-click resets only that boundary; with none moved left it is the auto chain again (REQ-498)", async () => {
    renderBlock();
    await ready();
    const weather = screen.getByRole("group", { name: "Weather chain" });
    const first = within(weather).getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    const second = within(weather).getByRole("slider", { name: "Boundary between ICON-EU and IFS HRES" });
    fireEvent.keyDown(first, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyUp(first, { key: "ArrowLeft" });
    fireEvent.keyDown(second, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyUp(second, { key: "ArrowLeft" });
    const clouds = screen.getByRole("group", { name: "Cloud chain" });
    const cloudBoundary = within(clouds).getByRole("slider", { name: "Boundary between ICON-EU and IFS" });
    fireEvent.keyDown(cloudBoundary, { key: "ArrowLeft" });
    fireEvent.keyUp(cloudBoundary, { key: "ArrowLeft" });
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([36, 108, 360]);
    expect(probe.selection!.cloudModels.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 119, 360]);

    // Only the double-clicked boundary goes back; the other moved ones stay.
    fireEvent.doubleClick(first);
    expect(probe.selection!.mode).toBe("manual");
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 108, 360]);
    expect(probe.selection!.cloudModels.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 119, 360]);
    expect(first.getAttribute("aria-valuenow")).toBe("48");
    expect(second.getAttribute("aria-valuenow")).toBe("108");
    // A boundary that was not moved: nothing changes.
    const before = probe.selection!.models;
    fireEvent.doubleClick(first);
    expect(probe.selection!.models).toBe(before);

    fireEvent.doubleClick(cloudBoundary);
    expect(probe.selection!.cloudModels.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 120, 360]);
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 108, 360]);
    expect(probe.selection!.mode).toBe("manual");
    // The last moved boundary back: the auto chain again.
    fireEvent.doubleClick(second);
    expect(probe.selection!.mode).toBe("auto");
    expect(second.getAttribute("aria-valuenow")).toBe("120");
  });
});

describe("model chain hidden by default, not editable on the website (REQ-445, REQ-480)", () => {
  const region = () => document.querySelector<HTMLElement>('[data-region="model-chain"]')!;
  const editingControls = (within_: ReturnType<typeof within>) => [
    ...within_.queryAllByRole("button", { name: /^Add model/ }),
    ...within_.queryAllByRole("button", { name: /^Remove / }),
    ...within_.queryAllByRole("button", { name: "Model areas" }),
    ...within_.queryAllByRole("button", { name: "Automatic" }),
    ...within_.queryAllByRole("button", { name: "Hide" }),
    ...within_.queryAllByRole("button", { name: /chain$/ }),
    ...within_.queryAllByRole("searchbox"),
  ];

  it("is hidden by default: no card at all, not even an empty frame (REQ-471)", async () => {
    const { container } = renderBlock({ view: "hidden" });
    await ready();
    expect(region()).toBeNull();
    expect(container.querySelector(".model-chain-row")).toBeNull();
    expect(screen.queryByRole("region", { name: "Model chain" })).toBeNull();
    expect(window.localStorage.getItem(WEATHER_CHAIN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(CLOUD_CHAIN_STORAGE_KEY)).toBeNull();
  });

  it("switched on it shows the two chain cards with movable boundaries, nothing to edit", async () => {
    renderBlock({ view: "hidden" });
    await ready();
    act(() => setModelChainVisible(true));

    const block = within(region());
    expect(block.getByRole("group", { name: "Weather chain" })).toBeTruthy();
    expect(block.getByRole("group", { name: "Cloud chain" })).toBeTruthy();
    expect(block.getAllByRole("button", { name: "Details for ICON-D2" }).length).toBeGreaterThan(0);
    expect(block.getAllByRole("slider").length).toBe(4);
    expect(editingControls(block)).toEqual([]);
    expect(window.localStorage.getItem(WEATHER_CHAIN_STORAGE_KEY)).toBe("true");
    expect(window.localStorage.getItem(CLOUD_CHAIN_STORAGE_KEY)).toBe("true");

    // A new visit starts with the stored choice; switched off in the settings the cards go.
    cleanup();
    resetModelChainView();
    renderBlock({ view: "hidden" });
    await ready();
    expect(within(region()).getByRole("group", { name: "Weather chain" })).toBeTruthy();
    act(() => setModelChainVisible(false));
    expect(region()).toBeNull();
    expect(window.localStorage.getItem(WEATHER_CHAIN_STORAGE_KEY)).toBe("false");
    expect(window.localStorage.getItem(CLOUD_CHAIN_STORAGE_KEY)).toBe("false");
  });

  it("shows each card on its own; a hidden cloud card still feeds the cloud chain (REQ-503)", async () => {
    const { container } = renderBlock({ view: "hidden" });
    await ready();
    act(() => weatherChainChoice.set(true));
    expect(within(region()).getByRole("group", { name: "Weather chain" })).toBeTruthy();
    expect(within(region()).queryByRole("group", { name: "Cloud chain" })).toBeNull();
    expect(container.querySelectorAll(".model-chain-row")).toHaveLength(1);
    // Display only: the cloud chain is still chosen and handed to the download.
    expect(probe.selection?.cloudModels.length).toBeGreaterThan(0);

    act(() => {
      weatherChainChoice.set(false);
      cloudChainChoice.set(true);
    });
    expect(within(region()).queryByRole("group", { name: "Weather chain" })).toBeNull();
    expect(within(region()).getByRole("group", { name: "Cloud chain" })).toBeTruthy();
    expect(container.querySelectorAll(".model-chain-row")).toHaveLength(1);
    expect(probe.selection?.models.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(WEATHER_CHAIN_STORAGE_KEY)).toBe("false");
    expect(window.localStorage.getItem(CLOUD_CHAIN_STORAGE_KEY)).toBe("true");
  });

  it("follows showWeatherChain / showCloudChain of config.json without an own choice (REQ-503)", async () => {
    renderBlock({ view: "hidden", config: { ...DEFAULT_CONFIG, showWeatherChain: false, showCloudChain: true } });
    await ready();
    expect(within(region()).queryByRole("group", { name: "Weather chain" })).toBeNull();
    expect(within(region()).getByRole("group", { name: "Cloud chain" })).toBeTruthy();
    // An own choice goes first; removing it brings back the configured value.
    act(() => cloudChainChoice.set(false));
    expect(region()).toBeNull();
    act(() => cloudChainChoice.set(null));
    expect(within(region()).getByRole("group", { name: "Cloud chain" })).toBeTruthy();
  });

  it("works out the cards from the own choices, config.json and modelChain (REQ-503)", () => {
    const config = { modelChain: true, showWeatherChain: true, showCloudChain: false };
    expect(effectiveChainCards(null, null, config)).toEqual({ weather: true, cloud: false });
    expect(effectiveChainCards(false, true, config)).toEqual({ weather: false, cloud: true });
    expect(effectiveChainCards(null, true, config)).toEqual({ weather: true, cloud: true });
    expect(effectiveChainCards(true, true, { ...config, modelChain: false })).toEqual({ weather: false, cloud: false });
  });

  it("moves the stored single switch from before REQ-503 to both switches (REQ-503)", () => {
    window.localStorage.setItem(LEGACY_MODEL_CHAIN_STORAGE_KEY, "true");
    migrateModelChainChoice();
    expect(weatherChainChoice.read()).toBe(true);
    expect(cloudChainChoice.read()).toBe(true);
    expect(window.localStorage.getItem(LEGACY_MODEL_CHAIN_STORAGE_KEY)).toBeNull();

    // An own choice of a new switch is kept.
    window.localStorage.clear();
    cloudChainChoice.set(false);
    window.localStorage.setItem(LEGACY_MODEL_CHAIN_STORAGE_KEY, "true");
    migrateModelChainChoice();
    expect(weatherChainChoice.read()).toBe(true);
    expect(cloudChainChoice.read()).toBe(false);

    // Nothing stored: nothing changes.
    window.localStorage.clear();
    migrateModelChainChoice();
    expect(weatherChainChoice.read()).toBeNull();
    expect(cloudChainChoice.read()).toBeNull();
  });

  function renderPage(config: GraupelConfig = DEFAULT_CONFIG) {
    return render(
      <ConfigProvider config={config}>
        <I18nProvider browserLanguages={["en"]}>
          <DialogsProvider>
            <LocationProvider initial={ZUGSPITZE}>
              <ChainProvider loadData={loadData}>
                <Header />
                {config.modelChain && <ModelChain />}
                <Probe />
              </ChainProvider>
            </LocationProvider>
          </DialogsProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
  }

  it("the settings popup only shows or hides the chains; it has no edit mode", async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = within(screen.getByRole("dialog", { name: "Settings" }));
    // In the tab Models (REQ-686).
    fireEvent.click(dialog.getByRole("tab", { name: "Models" }));
    const section = dialog.getByRole("group", { name: "Model chain" });
    const checkbox = within(section).getByRole("checkbox", { name: "Show the weather chain" }) as HTMLInputElement;
    const cloudBox = within(section).getByRole("checkbox", { name: "Show the cloud chain" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(cloudBox.checked).toBe(false);
    expect(within(section).queryAllByRole("button")).toEqual([]);
    expect(dialog.queryByRole("button", { name: "Edit model chain" })).toBeNull();
    expect(section.textContent).toContain("Drag the boundaries between the models to shift their time ranges");
    expect(section.textContent).not.toContain("edit mode");

    fireEvent.click(checkbox);
    expect(region()).not.toBeNull();
    expect(window.localStorage.getItem(WEATHER_CHAIN_STORAGE_KEY)).toBe("true");
    expect(window.localStorage.getItem(CLOUD_CHAIN_STORAGE_KEY)).toBeNull();
    expect(within(region()).getByRole("group", { name: "Weather chain" })).toBeTruthy();
    expect(within(region()).queryByRole("group", { name: "Cloud chain" })).toBeNull();
    expect(editingControls(within(region()))).toEqual([]);
    // Each switch on its own (REQ-503).
    fireEvent.click(cloudBox);
    expect(cloudBox.checked).toBe(true);
    expect(within(region()).getByRole("group", { name: "Cloud chain" })).toBeTruthy();
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    expect(cloudBox.checked).toBe(true);
    expect(within(region()).queryByRole("group", { name: "Weather chain" })).toBeNull();
    expect(within(region()).getByRole("group", { name: "Cloud chain" })).toBeTruthy();
    fireEvent.click(cloudBox);
    expect(region()).toBeNull();
    expect(window.localStorage.getItem(WEATHER_CHAIN_STORAGE_KEY)).toBe("false");
    expect(window.localStorage.getItem(CLOUD_CHAIN_STORAGE_KEY)).toBe("false");
  });

  it("offers no model chain section when the block is switched off", () => {
    renderPage({ ...DEFAULT_CONFIG, modelChain: false });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = within(screen.getByRole("dialog", { name: "Settings" }));
    // The tab Models keeps the model headers (REQ-686).
    fireEvent.click(dialog.getByRole("tab", { name: "Models" }));
    expect(dialog.queryByRole("group", { name: "Model chain" })).toBeNull();
    expect(dialog.queryByRole("group", { name: "Model chain", hidden: true })).toBeNull();
    expect(dialog.getByRole("checkbox", { name: "Show model headers" })).toBeTruthy();
  });
});

/** Hourly temperature points of `model` from `from` to `to` (exclusive) hours after the fixture's now. */
function points(model: string, from: number, to: number, value: number | null = 5): DataPoint[] {
  const now = Date.parse(FIXTURE_NOW);
  const result: DataPoint[] = [];
  for (let h = from; h < to; h++) {
    const timestamp = new Date(now + h * HOUR).toISOString().replace(".000Z", "Z");
    result.push({ timestamp, variable: "temperature", value, unit: "°C", model });
  }
  return result;
}

/** Cloud profiles of `model` from `from` to `to` (exclusive) hours after the fixture's now. */
function profiles(model: string, from: number, to: number, cover: number | null = 40): VerticalCloudProfile[] {
  const now = Date.parse(FIXTURE_NOW);
  const result: VerticalCloudProfile[] = [];
  for (let h = from; h < to; h++) {
    result.push({
      timestamp: new Date(now + h * HOUR).toISOString().replace(".000Z", "Z"),
      source_model_id: model.toLowerCase(),
      source_model_name: model,
      levels: [{ pressure_hpa: 700, cloud_cover_percent: cover }],
    });
  }
  return result;
}

function resultWith(combined: DataPoint[], cloud: VerticalCloudProfile[] = []): ForecastResult {
  const base = forecastFixture();
  return { ...base, combined, cloud: cloud.length ? { location: base.location, profiles: cloud } : null };
}

describe("time span of the delivered data (REQ-448)", () => {
  it("takes each model's first to last hour with values after now from the result", () => {
    const result = resultWith(
      [
        // Past hours (before now) do not count.
        ...points("A", -5, 0),
        ...points("A", 0, 30),
        // A gap at the end of A's slice: A delivered only up to hour 30.
        ...points("A", 30, 40, null),
        ...points("B", 40, 50),
      ],
      [...profiles("C", 0, 10), ...profiles("C", 10, 12, null)],
    );
    expect(deliveredSpans(result, "main")).toEqual({ A: { start: 0, end: 30 }, B: { start: 40, end: 50 } });
    expect(deliveredSpans(result, "cloud")).toEqual({ C: { start: 0, end: 10 } });
    expect(deliveredSpans(resultWith([]), "cloud")).toEqual({});
  });

  it("cards show the delivered spans; the planned ones while loading and while a boundary moves", async () => {
    const pending: ((result: ForecastResult) => void)[] = [];
    const loader: ForecastLoader = () => new Promise((resolve) => pending.push(resolve));
    renderBlock({ forecast: loader });
    await ready();
    const range = (key: string) => screen.getByTestId(`model-range-${key}`);
    const boundary = (name: string) =>
      within(screen.getByRole("group", { name: "Weather chain" })).getByRole("slider", { name });

    // Loading: the planned slices.
    expect(range("icon_d2").textContent).toBe("0–48 h");
    expect(range("icon_d2").getAttribute("data-span")).toBe("planned");
    expect(screen.queryByTestId("model-chain-span-note")).toBeNull();

    const [d2, eu] = probe.selection!.models.map((m) => m.name);
    const cloudModel = probe.selection!.cloudModels[0]!.name;
    // ICON-D2's run ends after 30 hours, ICON-EU takes over there; IFS delivers nothing.
    const delivered = {
      ...resultWith([...points(d2!, 0, 30), ...points(eu!, 30, 120)], profiles(cloudModel, 0, 100)),
      availability: { [d2!]: { model: d2!, chain: "main" as const, available_hours: 30 } },
    };
    await act(async () => pending.at(-1)!(delivered));

    expect(range("icon_d2").textContent).toBe("0–30 h");
    expect(range("icon_d2").getAttribute("data-span")).toBe("delivered");
    expect(range("icon_eu").textContent).toBe("30–120 h");
    expect(range("ecmwf_ifs").textContent).toBe("No data");
    expect(range("ecmwf_ifs").getAttribute("data-span")).toBe("none");
    expect(screen.getByTestId("model-card-ecmwf_ifs").getAttribute("title")).toMatch(/: no data \(planned 120–360 h\)$/);
    expect(screen.getByTestId(`cloud-model-range-${probe.selection!.cloudModels[0]!.id}`).textContent).toBe("0–100 h");
    // The boundary sits where ICON-D2's run ends and can go no further.
    const first = boundary("Boundary between ICON-D2 and ICON-EU");
    expect(first.getAttribute("aria-valuenow")).toBe("30");
    expect(first.getAttribute("aria-valuemax")).toBe("30");

    // While a boundary moves the cards show the planned slices of the moved chain.
    const second = boundary("Boundary between ICON-EU and IFS HRES");
    fireEvent.keyDown(second, { key: "ArrowLeft", shiftKey: true });
    expect(range("icon_eu").textContent).toBe("30–108 h");
    expect(range("icon_eu").getAttribute("data-span")).toBe("planned");
    const loads = pending.length;
    fireEvent.keyUp(second, { key: "ArrowLeft" });
    // The unmoved boundary of ICON-D2 keeps its requested 48 hours; the meteogram loads the moved chain once.
    expect(probe.selection!.models.map((m) => m.max_forecast_horizon_hours)).toEqual([48, 108, 360]);
    await waitFor(() => expect(pending.length).toBe(loads + 1));
    expect(range("icon_eu").textContent).toBe("48–108 h");
  });

  it("falls back to the planned spans when the forecast failed", async () => {
    renderBlock({ forecast: () => Promise.reject(new Error("offline")) });
    await ready();
    await waitFor(() => expect(screen.getByTestId("model-range-icon_d2").getAttribute("data-span")).toBe("planned"));
    expect(screen.getByTestId("model-range-icon_d2").textContent).toBe("0–48 h");
  });
});

describe("App", () => {
  it("loads the model data next to the page and shows the auto chain of the start place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => regionsResponse(url)),
    );
    resetModelData();
    setModelChainVisible(true);
    render(
      <ConfigProvider config={{ ...DEFAULT_CONFIG, startLocation: ZUGSPITZE }}>
        <App />
      </ConfigProvider>,
    );
    const region = screen.getByRole("region", { name: "Model chain" });
    await waitFor(() => expect(within(region).getByTestId("model-card-icon_d2")).toBeTruthy());
  });
});
