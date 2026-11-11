// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Info popover of a model (REQ-687): on top "model (publisher, coverage)"; the model's name opens its documentation,
 * the publisher its homepage, each in a new tab without access to the page; without a URL from the catalogue just the
 * text. The links come from the model catalogue (`documentation_url`, `provider_url`); older catalogues without them
 * keep working. Below the title the properties (grid spacing and "Max (from now)": hours left from now / catalogue
 * horizon, no time step, no probability end), then the main run and the ensemble run listed separately, then the
 * explanation of the horizon. The times of the runs stand in the device's time zone, else in that of the domain's
 * default place (REQ-733).
 */
import type { ForecastResult, ModelAvailability, ModelCatalogue, WeatherModel } from "@graupel/download";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, parseConfig, type GraupelConfig } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { ModelInfoButton, ModelInfoContent } from "../src/regions/ModelChain/chain/ModelInfo.tsx";
import {
  describeHorizon,
  describeRuns,
  isEnsembleStale,
  modelHorizon,
  runTimeFormat,
  runTimeZone,
  type RunTexts,
} from "../src/regions/ModelChain/chain/modelRuns.ts";
import { createTranslate } from "../src/i18n/index.ts";
import { catalogue } from "../src/services/modelData.ts";
import { ForecastOverride, availableModels, httpsUrl, type ModelMeta } from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Lets the device report `zone` as its time zone (`resolvedOptions().timeZone`); undefined: none (REQ-733). */
function deviceZone(zone: string | undefined) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone as string };
  });
}

const DOCS = "https://www.dwd.de/EN/research/weatherforecasting/num_modelling/icon_description.html";
const HOME = "https://www.dwd.de";

const ICON_EU: ModelMeta = {
  id: "icon_eu",
  name: "ICON-EU",
  max_forecast_horizon_hours: 120,
  provider: "DWD",
  region: "Europe",
  spatial_resolution_km: 7,
  documentation_url: DOCS,
  provider_url: HOME,
};

function wrap(ui: ReactElement, language = "en") {
  return <I18nProvider browserLanguages={[language]}>{ui}</I18nProvider>;
}

function renderContent(meta: ModelMeta, language = "en") {
  const model: WeatherModel = { name: meta.name, max_forecast_horizon_hours: 48 };
  render(wrap(<ModelInfoContent meta={meta} model={model} />, language));
  return screen.getByTestId("model-info-title");
}

describe("title of the info popover (REQ-687)", () => {
  it("shows model (publisher, coverage), the name linked to the documentation, the publisher to its homepage", () => {
    const title = renderContent(ICON_EU);
    expect(title.textContent).toBe("ICON-EU (DWD, Europe)");
    const links = within(title).getAllByRole("link");
    expect(links).toHaveLength(2);
    const [name, publisher] = links as [HTMLAnchorElement, HTMLAnchorElement];
    expect(name.textContent).toBe("ICON-EU");
    expect(name.getAttribute("href")).toBe(DOCS);
    expect(publisher.textContent).toBe("DWD");
    expect(publisher.getAttribute("href")).toBe(HOME);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    // The name stays bold, the publisher does not.
    expect(name.closest("strong")).not.toBeNull();
    expect(publisher.closest("strong")).toBeNull();
    expect(name.getAttribute("title")).toBe("Documentation of ICON-EU (opens in a new tab)");
    expect(publisher.getAttribute("title")).toBe("Homepage of DWD (opens in a new tab)");
  });

  it("names the links in the page's language", () => {
    const title = renderContent(ICON_EU, "de");
    expect(within(title).getByRole("link", { name: "ICON-EU" }).getAttribute("title")).toBe(
      "Dokumentation zu ICON-EU (öffnet in neuem Tab)",
    );
    expect(within(title).getByRole("link", { name: "DWD" }).getAttribute("title")).toBe(
      "Homepage von DWD (öffnet in neuem Tab)",
    );
  });

  it("shows plain text without links when the catalogue has no URLs (older catalogue)", () => {
    const old: ModelMeta = { ...ICON_EU };
    delete old.documentation_url;
    delete old.provider_url;
    const title = renderContent(old);
    expect(title.textContent).toBe("ICON-EU (DWD, Europe)");
    expect(within(title).queryAllByRole("link")).toHaveLength(0);
  });

  it("links only what has a URL", () => {
    let title = renderContent({ ...ICON_EU, documentation_url: undefined });
    expect(within(title).getAllByRole("link").map((link) => link.textContent)).toEqual(["DWD"]);
    cleanup();
    title = renderContent({ ...ICON_EU, provider_url: undefined });
    expect(within(title).getAllByRole("link").map((link) => link.textContent)).toEqual(["ICON-EU"]);
  });

  it("links no URL that is not https", () => {
    const title = renderContent({
      ...ICON_EU,
      documentation_url: "javascript:alert(1)",
      provider_url: "http://www.dwd.de",
    });
    expect(title.textContent).toBe("ICON-EU (DWD, Europe)");
    expect(within(title).queryAllByRole("link")).toHaveLength(0);
  });

  it("leaves out the brackets' missing parts", () => {
    let title = renderContent({ ...ICON_EU, region: undefined });
    expect(title.textContent).toBe("ICON-EU (DWD)");
    cleanup();
    title = renderContent({ name: "Best match", max_forecast_horizon_hours: 48, region: "Global" });
    expect(title.textContent).toBe("Best match (Global)");
    cleanup();
    title = renderContent({ name: "Unknown", max_forecast_horizon_hours: 48, documentation_url: DOCS });
    expect(title.textContent).toBe("Unknown");
    expect(within(title).getByRole("link", { name: "Unknown" }).getAttribute("href")).toBe(DOCS);
  });

  it("is in the popover the info button opens", () => {
    const model: WeatherModel = { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 };
    const Toggle = ({ open }: { open: boolean }) => (
      <ModelInfoButton className="model-card__info" meta={ICON_EU} model={model} open={open} onToggle={() => {}} />
    );
    const { rerender } = render(wrap(<Toggle open={false} />));
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
    rerender(wrap(<Toggle open />));
    const popover = screen.getByTestId("model-info-popover");
    expect(within(popover).getByRole("link", { name: "ICON-EU" }).getAttribute("href")).toBe(DOCS);
    // A press on a link inside the popover does not close it (REQ-463).
    fireEvent.pointerDown(within(popover).getByRole("link", { name: "DWD" }));
    expect(screen.getByTestId("model-info-popover")).toBeTruthy();
  });
});

describe("links of the model catalogue (REQ-687)", () => {
  it("takes documentation_url and provider_url of each model", () => {
    const models = availableModels({
      models: [
        { id: "icon_eu", name: "ICON-EU", provider: "DWD", documentation_url: DOCS, provider_url: HOME },
        { id: "seamless", name: "Seamless", provider: "DWD", documentation_url: null, provider_url: HOME },
      ],
    });
    expect(models.icon_eu).toMatchObject({ documentation_url: DOCS, provider_url: HOME });
    expect(models.seamless!.provider_url).toBe(HOME);
    expect("documentation_url" in models.seamless!).toBe(false);
  });

  it("loads an older catalogue without the fields", () => {
    const old: ModelCatalogue = [{ id: "icon_eu", name: "ICON-EU", provider: "DWD", max_forecast_hours: 120 }];
    const models = availableModels(old);
    expect(models.icon_eu).toMatchObject({ name: "ICON-EU", provider: "DWD", max_forecast_horizon_hours: 120 });
    expect(models.icon_eu!.documentation_url).toBeUndefined();
    expect(models.icon_eu!.provider_url).toBeUndefined();
  });

  it("drops a URL that is not https", () => {
    const models = availableModels([
      { id: "x", name: "X", documentation_url: "ftp://example.org/x", provider_url: "not a url" },
    ]);
    expect(models.x!.documentation_url).toBeUndefined();
    expect(models.x!.provider_url).toBeUndefined();
  });

  it("has both links for the models of the bundled catalogue", () => {
    const models = availableModels(catalogue);
    expect(models.icon_eu!.documentation_url).toMatch(/^https:\/\/www\.dwd\.de\//);
    expect(models.icon_eu!.provider_url).toBe("https://www.dwd.de");
    // Every active model names its publisher's homepage.
    for (const model of Object.values(models)) expect(model.provider_url, model.id).toMatch(/^https:\/\//);
  });

  it("httpsUrl accepts only absolute https URLs", () => {
    expect(httpsUrl(HOME)).toBe(HOME);
    expect(httpsUrl("http://www.dwd.de")).toBeUndefined();
    expect(httpsUrl("/docs")).toBeUndefined();
    expect(httpsUrl(null)).toBeUndefined();
    expect(httpsUrl(undefined)).toBeUndefined();
    expect(httpsUrl(42)).toBeUndefined();
  });
});

// --- runs and horizon -----------------------------------------------------------------------------------------------

/** Now: Monday, 9 November 2026, 00:00 UTC (the picture of REQ-687). */
const NOW = "2026-11-09T00:00:00Z";
const TEXTS: RunTexts = { t: createTranslate("en"), time: runTimeFormat("en-GB", "UTC") };

/** ICON-EU as in the picture of REQ-687: run 08.11. 19:00, 120 h long, 116 h left from now. */
const ICON_EU_AVAILABILITY: ModelAvailability = {
  model: "ICON-EU",
  model_id: "icon_eu",
  chain: "main",
  available_hours: 116,
  valid_until: "2026-11-13T20:00:00Z",
  last_run_init_time: "2026-11-08T19:00:00Z",
  run_segments: [{ run_init_time: "2026-11-08T19:00:00Z", valid_from: null, valid_until: null, run_length_hours: 120 }],
  ensemble: {
    model_id: "dwd_icon_eu_eps_native",
    run_init_time: "2026-11-08T19:00:00Z",
    run_availability_time: "2026-11-08T22:37:00Z",
    data_end_time: "2026-11-13T20:00:00Z",
  },
  probability_valid_until: "2026-11-13T20:00:00Z",
};

const horizonOf = (availability: ModelAvailability, catalogue = 120) => modelHorizon(catalogue, availability, NOW)!;

describe("runs of a model (REQ-687)", () => {
  it("takes Max (from now) and the catalogue horizon from the run availability", () => {
    const info = horizonOf(ICON_EU_AVAILABILITY);
    expect(info).toMatchObject({ catalogueHours: 120, availableHours: 116, limitedByRun: true, start: NOW });
    // Not limited: the whole catalogue horizon; never more than it.
    expect(horizonOf({ ...ICON_EU_AVAILABILITY, available_hours: null })).toMatchObject({
      availableHours: 120,
      limitedByRun: false,
    });
    expect(horizonOf({ ...ICON_EU_AVAILABILITY, available_hours: 200 }).availableHours).toBe(120);
    expect(modelHorizon(120, undefined, NOW)).toBeNull();
    expect(modelHorizon(120, ICON_EU_AVAILABILITY, undefined)).toBeNull();
  });

  it("lists the main run and the ensemble run separately", () => {
    expect(describeRuns(horizonOf(ICON_EU_AVAILABILITY), TEXTS)).toEqual({
      main: [{ run: "08/11, 19:00", detail: "120 h run, until 13/11, 20:00" }],
      ensemble: {
        modelId: "dwd_icon_eu_eps_native",
        lines: [{ run: "08/11, 19:00", detail: "available 08/11, 22:37, until 13/11, 20:00" }],
      },
    });
  });

  it("lists every run of a mixed series, newest first, and earlier ensemble runs", () => {
    const info = horizonOf({
      ...ICON_EU_AVAILABILITY,
      available_hours: 120,
      run_segments: [
        { run_init_time: "2026-11-08T21:00:00Z", valid_until: "2026-11-11T21:00:00Z", run_length_hours: 72 },
        { run_init_time: "2026-11-08T18:00:00Z", valid_from: "2026-11-11T21:00:00Z", run_length_hours: 126 },
      ],
      probability_valid_until: "2026-11-14T00:00:00Z",
    });
    const runs = describeRuns(info, TEXTS);
    expect(runs.main).toEqual([
      { run: "08/11, 21:00", detail: "72 h run, until 11/11, 21:00" },
      { run: "08/11, 18:00", detail: "126 h run, 11/11, 21:00 – 14/11, 00:00" },
    ]);
    expect(runs.ensemble!.lines[1]).toEqual({ run: "earlier run(s)", detail: "13/11, 20:00 – 14/11, 00:00" });
    expect(describeHorizon(info, TEXTS)).toEqual([
      "Max (from now) 120 h / 120 h: the model’s longest run is 120 h long (catalogue horizon); from the current hour on, the data reaches 120 h.",
      "Open-Meteo keeps one continuous series per model: a new run only overwrites the hours it computes. The latest run (08/11, 21:00) is shorter than what earlier runs still have, so it only covers until 11/11, 21:00 (69 h from now).",
      "The earlier run 08/11, 18:00 reaches further, so its hours from 11/11, 21:00 until 14/11, 00:00 complete the picture.",
      "Together they deliver 120 h from now (09/11, 00:00).",
    ]);
  });

  it("says when Open-Meteo's ensemble information is stuck", () => {
    const stuck = horizonOf({
      ...ICON_EU_AVAILABILITY,
      ensemble: { model_id: "dwd_icon_eu_eps_native", run_init_time: "2026-11-01T00:00:00Z", data_end_time: "2026-11-06T00:00:00Z" },
    });
    expect(isEnsembleStale(stuck)).toBe(true);
    expect(describeRuns(stuck, TEXTS).ensemble!.lines).toEqual([
      {
        run: "run unknown",
        detail: "until 13/11, 20:00; Open-Meteo’s run information is outdated (last 01/11, 00:00)",
      },
    ]);
    expect(isEnsembleStale(horizonOf(ICON_EU_AVAILABILITY))).toBe(false);
  });

  it("explains Max (from now) of a run that started before the current hour", () => {
    expect(describeHorizon(horizonOf(ICON_EU_AVAILABILITY), TEXTS)).toEqual([
      "Max (from now) 116 h / 120 h: the model’s longest run is 120 h long (catalogue horizon); from the current hour on, the data reaches 116 h.",
      "The latest run started 08/11, 19:00 and is 120 h long; it started 5 h before the current hour (09/11, 00:00), so its data ends 13/11, 20:00: only 116 h are left from now.",
    ]);
    const noLength = horizonOf({ ...ICON_EU_AVAILABILITY, run_segments: [] });
    expect(describeHorizon(noLength, TEXTS)[1]).toBe(
      "The latest run started 08/11, 19:00, 5 h before the current hour (09/11, 00:00), so its data ends 13/11, 20:00: only 116 h are left from now.",
    );
    const noRun = horizonOf({ ...ICON_EU_AVAILABILITY, run_segments: [], last_run_init_time: null });
    expect(describeRuns(noRun, TEXTS).main).toEqual([]);
    expect(describeHorizon(noRun, TEXTS)[1]).toBe(
      "The latest run started before the current hour, so only 116 h of it are left from now.",
    );
    const full = horizonOf({ ...ICON_EU_AVAILABILITY, available_hours: null });
    expect(describeHorizon(full, TEXTS)[1]).toBe("The data reaches the full catalogue horizon from now.");
  });

  it("formats times in the place's time zone and the page's language", () => {
    expect(runTimeFormat("de", "Europe/Vienna")("2026-11-08T19:00:00Z")).toBe("08.11., 20:00");
    expect(runTimeFormat("en-GB", "Not/AZone")("2026-11-08T19:00:00Z")).toMatch(/^08\/11, \d\d:00$/);
    expect(runTimeFormat("en-GB", "UTC")(null)).toBe("?");
  });
});

/** The popover of ICON-EU with a loaded forecast for a place in `placeZone`, with the configuration `config`. */
function renderWithForecast(
  availability: Record<string, ModelAvailability>,
  language = "en",
  { config = DEFAULT_CONFIG, placeZone = "UTC" }: { config?: GraupelConfig; placeZone?: string } = {},
) {
  const result: ForecastResult = {
    ...forecastFixture({ now: NOW, start: "2026-11-08T00:00:00Z", end: "2026-11-14T00:00:00Z" }),
    timezone: placeZone,
    availability,
  };
  const model: WeatherModel = { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 48 };
  render(
    wrap(
      <ConfigProvider config={config}>
        <ForecastOverride value={{ status: "ready", result, reload: () => {}, setPreview: () => {} }}>
          <ModelInfoContent meta={{ ...ICON_EU, temporal_resolution_hours: 1 }} model={model} />
        </ForecastOverride>
      </ConfigProvider>,
      language,
    ),
  );
}

describe("popover with the loaded forecast (REQ-687)", () => {
  // Times in the device's time zone (REQ-733), here UTC.
  beforeEach(() => deviceZone("UTC"));

  it("shows title, properties, main run, ensemble run and the explanation, in this order", () => {
    renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY });
    const title = screen.getByTestId("model-info-title");
    const specs = screen.getByTestId("model-info-specs");
    const main = screen.getByTestId("model-info-main-runs");
    const ensemble = screen.getByTestId("model-info-ensemble-runs");
    const explanation = screen.getByTestId("model-info-explanation");
    const order = [title, specs, main, ensemble, explanation];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Grid spacing stays; Max (from now) instead of time step, catalogue horizon and probability end.
    expect([...specs.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Grid spacing", "Max (from now)"]);
    expect(within(specs).getByText("Max (from now)").nextElementSibling?.textContent).toBe("116 h / 120 h");
    expect(screen.queryByText(/Time step|Catalogue horizon:|Probability until|Forecast length/)).toBeNull();
    expect(main.textContent).toBe("Main run08/11, 19:00 · 120 h run, until 13/11, 20:00");
    expect(ensemble.textContent).toBe(
      "Ensemble run (dwd_icon_eu_eps_native)08/11, 19:00 · available 08/11, 22:37, until 13/11, 20:00",
    );
    expect(explanation.querySelectorAll("p")).toHaveLength(2);
    expect(explanation.textContent).toContain("Max (from now) 116 h / 120 h");
  });

  it("is translated", () => {
    renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY }, "de");
    expect(within(screen.getByTestId("model-info-specs")).getByText("Max (ab jetzt)").nextElementSibling?.textContent).toBe(
      "116 h / 120 h",
    );
    expect(screen.getByTestId("model-info-main-runs").textContent).toBe(
      "Hauptlauf08.11., 19:00 · 120-h-Lauf, bis 13.11., 20:00",
    );
  });

  it("has no runs for a model without run availability: the catalogue's forecast length", () => {
    renderWithForecast({});
    expect(within(screen.getByTestId("model-info-specs")).getByText("Forecast length").nextElementSibling?.textContent)
      .toBe("120 h");
    expect(screen.queryByTestId("model-info-main-runs")).toBeNull();
    expect(screen.queryByTestId("model-info-explanation")).toBeNull();
  });
});

describe("run times in the user's time zone (REQ-733)", () => {
  const FILES = import.meta.glob<unknown>("../domains/*/config.json", { eager: true, import: "default" });
  const DOMAINS = Object.fromEntries(
    Object.entries(FILES).map(([path, config]) => [/domains\/([^/]+)\//.exec(path)![1]!, config]),
  );
  /** Time zone of each domain's default place. */
  const DOMAIN_ZONES: Record<string, string> = {
    at: "Europe/Vienna",
    ch: "Europe/Zurich",
    eu: "Europe/Brussels",
    fr: "Europe/Paris",
    it: "Europe/Rome",
  };
  const main = () => screen.getByTestId("model-info-main-runs").textContent;
  const ensemble = () => screen.getByTestId("model-info-ensemble-runs").textContent;

  it("shows the runs in the device's time zone Europe/Berlin, not in the place's", () => {
    deviceZone("Europe/Berlin");
    renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY }, "de", { placeZone: "Asia/Tokyo" });
    expect(main()).toBe("Hauptlauf08.11., 20:00 · 120-h-Lauf, bis 13.11., 21:00");
    expect(ensemble()).toBe(
      "Ensemble-Lauf (dwd_icon_eu_eps_native)08.11., 20:00 · verfügbar 08.11., 23:37, bis 13.11., 21:00",
    );
  });

  it("shows the runs in the device's time zone America/New_York, whatever the domain's", () => {
    deviceZone("America/New_York");
    const config = parseConfig(DOMAINS.at).config;
    renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY }, "en", { config, placeZone: "Europe/Vienna" });
    expect(main()).toBe("Main run08/11, 14:00 · 120 h run, until 13/11, 15:00");
    expect(ensemble()).toBe(
      "Ensemble run (dwd_icon_eu_eps_native)08/11, 14:00 · available 08/11, 17:37, until 13/11, 15:00",
    );
    // The explanation names the run and the current hour in the same zone.
    expect(screen.getByTestId("model-info-explanation").textContent).toContain("08/11, 14:00");
    expect(screen.getByTestId("model-info-explanation").textContent).toContain("(08/11, 19:00)");
  });

  it.each(Object.keys(DOMAIN_ZONES))(
    "falls back to the zone of the default place of graupel.%s without a determinable device zone",
    (tld) => {
      deviceZone(undefined);
      const { config, warnings } = parseConfig(DOMAINS[tld]);
      expect(warnings).toEqual([]);
      expect(config.timeZone).toBe(DOMAIN_ZONES[tld]);
      renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY }, "en", { config, placeZone: "Asia/Tokyo" });
      // In November all five zones are one hour ahead of UTC.
      expect(main()).toBe("Main run08/11, 20:00 · 120 h run, until 13/11, 21:00");
    },
  );

  it("falls back to the domain's zone for an unknown device zone, and to the default place's without configuration", () => {
    deviceZone("Etc/Unknown");
    renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY }, "en", { config: parseConfig({ timeZone: "Asia/Tokyo" }).config });
    expect(main()).toBe("Main run09/11, 04:00 · 120 h run, until 14/11, 05:00");
    cleanup();
    renderWithForecast({ "ICON-EU": ICON_EU_AVAILABILITY }, "en", { placeZone: "Asia/Tokyo" });
    // Mont Blanc: Europe/Paris.
    expect(main()).toBe("Main run08/11, 20:00 · 120 h run, until 13/11, 21:00");
  });

  it("chooses the device's zone, else the domain's, else none", () => {
    expect(runTimeZone("Europe/Vienna", "America/New_York")).toBe("America/New_York");
    expect(runTimeZone("Europe/Vienna", null)).toBe("Europe/Vienna");
    expect(runTimeZone("Europe/Vienna", "Etc/Unknown")).toBe("Europe/Vienna");
    expect(runTimeZone("Europe/Vienna", "Not/AZone")).toBe("Europe/Vienna");
    expect(runTimeZone("Not/AZone", null)).toBeUndefined();
    deviceZone("Europe/Berlin");
    expect(runTimeZone("Europe/Vienna")).toBe("Europe/Berlin");
    deviceZone(undefined);
    expect(runTimeZone("Europe/Vienna")).toBe("Europe/Vienna");
  });
});
