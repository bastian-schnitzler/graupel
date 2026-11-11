// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Quantities of the download (display set and layouts belong to the meteogram), the variable filter and the retry
// without snow. Registry and catalogue come from @graupel/model-data.
import { describe, expect, it, vi } from "vitest";
import registry from "@graupel/model-data/quantities.json";
import catalogue from "@graupel/model-data/model_catalogue.json";
import { GATED, gatedCatalogue, gatedRegistry } from "./modelData";
import {
  ApiError,
  OutOfDomainError,
  createClient,
  createQuantityRegistry,
  ensembleQuantities,
  expandRequires,
  expectedQuantities,
  fetchModelDatasets,
  fetchSet,
  findCatalogueModel,
  hourlyFetchSet,
  mainRunExcludedQuantities,
  modelHourlyVariables,
  normalizeVariable,
  openMeteoName,
  optionalQuantities,
  requestedFromModel,
  retryWithoutNames,
  targetUnit,
  type FetchLike,
} from "../src/index";

const KINDS = ["point", "interval"];
const STYLES = ["line", "bars", "area", "arrows", "icons", "profile", "tooltip"];
const DERIVED = ["precipitation_rain_snow", "snowfall_with_rain"];

describe("quantity registry (test_quantities.py)", () => {
  const reg = createQuantityRegistry(registry);

  it("has consistent entries", () => {
    for (const q of reg.quantities) {
      expect(KINDS).toContain(q.kind);
      for (const style of q.allowed_styles ?? []) expect(STYLES).toContain(style);
      for (const required of q.requires ?? []) expect(reg.byId.has(required)).toBe(true);
      if (q.source === "hourly") {
        expect(q.api_name).toBeTruthy();
        expect(q.api_name).not.toContain("{");
      }
    }
  });

  it("builds the lookup once per document", () => {
    expect(createQuantityRegistry(registry)).toBe(reg);
    expect(createQuantityRegistry(reg)).toBe(reg);
    expect(createQuantityRegistry(registry.quantities).byId.size).toBe(reg.byId.size);
  });

  it("expects the former default variables", () => {
    expect(expectedQuantities(registry)).toEqual([
      "temperature",
      "apparent_temperature",
      "wind_speed",
      "wind_gusts",
      "wind_direction",
      "cloud_cover",
      "precipitation",
      "precipitation_probability",
    ]);
  });

  it("fetches every downloadable quantity", () => {
    expect(fetchSet(registry)).toEqual([
      "temperature",
      "apparent_temperature",
      "dew_point",
      "relative_humidity",
      "wind_speed",
      "wind_gusts",
      "wind_direction",
      "cloud_cover",
      "precipitation",
      "precipitation_probability",
      "snowfall",
      "snow_depth",
      "weather_code",
      "cloud_cover_pressure_level",
      "geopotential_height_pressure_level",
      "vertical_cloud_profile",
    ]);
  });

  it("matches the former target variables with the hourly fetch set", () => {
    expect(hourlyFetchSet(registry)).toEqual([
      "temperature",
      "apparent_temperature",
      "dew_point",
      "relative_humidity",
      "wind_speed",
      "wind_gusts",
      "wind_direction",
      "cloud_cover",
      "precipitation",
      "precipitation_probability",
      "snowfall",
      "snow_depth",
      "weather_code",
    ]);
  });

  it("expands requirements transitively and without duplicates", () => {
    expect(expandRequires(["vertical_cloud_profile", "cloud_cover_pressure_level"], registry)).toEqual([
      "cloud_cover_pressure_level",
      "geopotential_height_pressure_level",
      "vertical_cloud_profile",
    ]);
    expect(() => expandRequires(["nope"], registry)).toThrow(/unknown quantity/);
  });

  it("requests optional catalogued quantities only from models that support them", () => {
    expect(requestedFromModel(GATED, ["temperature", GATED], gatedRegistry)).toBe(true);
    expect(requestedFromModel(GATED, ["temperature"], gatedRegistry)).toBe(false);
    expect(requestedFromModel(GATED, null, gatedRegistry)).toBe(false);
    // Optional but not probed by the catalogue: always requested.
    expect(requestedFromModel("snowfall", [], registry)).toBe(true);
    expect(requestedFromModel("weather_code", null, registry)).toBe(true);
    expect(requestedFromModel("precipitation_probability", [], registry)).toBe(true);
    expect(requestedFromModel("temperature_2m", [], registry)).toBe(true);
  });

  it("derives names and units from the registry", () => {
    expect(openMeteoName("temperature", registry)).toBe("temperature_2m");
    expect(openMeteoName("temp", registry)).toBe("temperature_2m");
    expect(openMeteoName("unknown_var", registry)).toBe("unknown_var");
    expect(normalizeVariable("wind_gusts_10m", registry)).toBe("wind_gusts");
    expect(normalizeVariable("POP", registry)).toBe("precipitation_probability");
    expect(normalizeVariable("feels_like", registry)).toBe("apparent_temperature");
    expect(targetUnit("snow_depth", registry)).toBe("m");
    expect(targetUnit("vertical_cloud_profile", registry)).toBeUndefined();
  });

  it("drops only snow, the dew point and the relative humidity on a rejected request", () => {
    expect(retryWithoutNames(registry)).toEqual(
      new Set(["snowfall", "snow_depth", "dew_point_2m", "relative_humidity_2m"]),
    );
  });

  it("fetches the relative humidity with every forecast, optional and not gated by the catalogue (REQ-648)", () => {
    expect(hourlyFetchSet(registry)).toContain("relative_humidity");
    expect(openMeteoName("relative_humidity", registry)).toBe("relative_humidity_2m");
    expect(normalizeVariable("relative_humidity_2m", registry)).toBe("relative_humidity");
    expect(normalizeVariable("relativehumidity_2m", registry)).toBe("relative_humidity");
    expect(targetUnit("relative_humidity", registry)).toBe("%");
    expect(optionalQuantities(registry)).toContain("relative_humidity");
    expect(expectedQuantities(registry)).not.toContain("relative_humidity");
    expect(requestedFromModel("relative_humidity", [], registry)).toBe(true);
    expect(requestedFromModel("relative_humidity", null, registry)).toBe(true);
  });

  it("fetches the dew point with every forecast, optional and not gated by the catalogue (REQ-596)", () => {
    expect(hourlyFetchSet(registry)).toContain("dew_point");
    expect(openMeteoName("dew_point", registry)).toBe("dew_point_2m");
    expect(normalizeVariable("dew_point_2m", registry)).toBe("dew_point");
    expect(normalizeVariable("dewpoint_2m", registry)).toBe("dew_point");
    expect(targetUnit("dew_point", registry)).toBe("°C");
    expect(optionalQuantities(registry)).toContain("dew_point");
    expect(expectedQuantities(registry)).not.toContain("dew_point");
    expect(requestedFromModel("dew_point", [], registry)).toBe(true);
    expect(requestedFromModel("dew_point", null, registry)).toBe(true);
  });

  it("never lets ensemble quantities define delivered hours", () => {
    expect(ensembleQuantities(registry)).toEqual(["precipitation_probability"]);
    expect(new Set(mainRunExcludedQuantities(registry))).toEqual(
      new Set([...optionalQuantities(registry), "precipitation_probability"]),
    );
    // Still warned about when missing: the ensemble is not optional.
    expect(optionalQuantities(registry)).not.toContain("precipitation_probability");
  });

  it("never fetches derived snow quantities", () => {
    for (const id of DERIVED) {
      const q = reg.byId.get(id);
      expect(q?.source).toBe("derived");
      expect(q?.downloadable).toBe(false);
      expect(q?.requires).toEqual(["precipitation", "snowfall"]);
      expect(q?.allowed_styles).toEqual(["bars"]);
      expect(expectedQuantities(registry)).not.toContain(id);
      expect(fetchSet(registry)).not.toContain(id);
      expect(reg.openMeteoNames.has(id)).toBe(false);
    }
    expect(fetchSet(registry)).toEqual(expect.arrayContaining(["precipitation", "snowfall"]));
  });
});

describe("quantities per model (catalogue)", () => {
  it("finds catalogue models by id, name and former alias", () => {
    expect(findCatalogueModel("icon_d2", catalogue)?.id).toBe("icon_d2");
    expect(findCatalogueModel("ICON-EU", catalogue)?.id).toBe("icon_eu");
    expect(findCatalogueModel("ICON-EU", catalogue.models)?.id).toBe("icon_eu");
    expect(findCatalogueModel("no_such_model", catalogue)).toBeNull();
    expect(findCatalogueModel("icon_d2", null)).toBeNull();
  });

  it("reads the documentation and publisher links, optional for older catalogues (REQ-688)", () => {
    const iconD2 = findCatalogueModel("icon_d2", catalogue);
    expect(iconD2?.provider_url).toBe("https://www.dwd.de");
    expect(iconD2?.documentation_url).toMatch(/^https:\/\/www\.dwd\.de\//);
    const older = [{ id: "icon_d2", name: "ICON-D2", provider: "DWD" }];
    expect(findCatalogueModel("icon_d2", older)?.documentation_url).toBeUndefined();
    expect(findCatalogueModel("icon_d2", older)?.provider_url).toBeUndefined();
  });

  it("requests the whole hourly fetch set except unsupported optional catalogued quantities", () => {
    const all = hourlyFetchSet(registry).map((id) => openMeteoName(id, registry));
    // The registry has no optional catalogued quantity any more: every model gets the whole set.
    expect(modelHourlyVariables("ICON-D2", { catalogue, registry })).toEqual(all);
    expect(modelHourlyVariables("no_such_model", { catalogue, registry })).toEqual(all);
    // With one, only models that list it are asked for it.
    const gated = { catalogue: gatedCatalogue, registry: gatedRegistry };
    expect(modelHourlyVariables("ICON-D2", gated)).toEqual([...all, GATED]);
    expect(modelHourlyVariables("ICON-EU", gated)).toEqual(all);
    // Unknown models get no optional catalogued quantities at all.
    expect(modelHourlyVariables("no_such_model", gated)).toEqual(all);
  });

  it("maps given quantities to Open-Meteo names without duplicates", () => {
    const gated = { catalogue: gatedCatalogue, registry: gatedRegistry };
    expect(modelHourlyVariables("ICON-EU", gated, ["temperature", "temp", "gix", "wind_gusts", "foo"])).toEqual([
      "temperature_2m",
      "wind_gusts_10m",
      "foo",
    ]);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hourlyParam(url: string): string[] {
  return (new URL(url).searchParams.get("hourly") ?? "").split(",");
}

const berlin = { latitude: 52.52, longitude: 13.405 };

const forecastAnswer = {
  timezone: "GMT",
  hourly: {
    time: ["2026-10-26T00:00", "2026-10-26T01:00"],
    temperature_2m: [5.5, 5.1],
    precipitation: [0, Number.NaN],
  },
  hourly_units: { temperature_2m: "°C", precipitation: "mm" },
};

describe("fetchModelDatasets (service.py)", () => {
  it("requests the model's variables in GMT and returns one series per variable", async () => {
    const urls: string[] = [];
    const fetch = vi.fn<FetchLike>(async (url) => {
      urls.push(url);
      return json(forecastAnswer);
    });
    const client = createClient({ fetch });
    const datasets = await fetchModelDatasets(
      client,
      { ...berlin, model: "ICON-D2", forecastHours: 48, pastHours: 24, quantities: ["temperature", "precipitation", "snowfall"], now: "2026-10-26T10:30:00Z" },
      { catalogue, registry },
    );
    const params = new URL(urls[0] as string).searchParams;
    expect(params.get("models")).toBe("icon_d2");
    expect(params.get("timezone")).toBe("GMT");
    expect(params.get("forecast_hours")).toBe("48");
    expect(params.get("past_hours")).toBe("24");
    expect(hourlyParam(urls[0] as string)).toEqual(["temperature_2m", "precipitation", "snowfall"]);
    expect(datasets.map((d) => [d.variable, d.values, d.unit])).toEqual([
      ["temperature_2m", [5.5, 5.1], "°C"],
      ["precipitation", [0, null], "mm"],
      // Omitted by the answer: kept as an empty series.
      ["snowfall", [], ""],
    ]);
    expect(datasets[0]).toMatchObject({
      model_name: "ICON-D2",
      fetch_time: "2026-10-26T10:30:00Z",
      forecast_run_time: null,
      timestamps: ["2026-10-26T00:00:00Z", "2026-10-26T01:00:00Z"],
      max_horizon_hours: 48,
    });
  });

  it("repeats a rejected request without the snow quantities, the dew point and the relative humidity", async () => {
    const urls: string[] = [];
    const fetch = vi.fn<FetchLike>(async (url) => {
      urls.push(url);
      return urls.length === 1
        ? json({ error: true, reason: "Cannot initialize snowfall for model" }, 400)
        : json(forecastAnswer);
    });
    const client = createClient({ fetch });
    const datasets = await fetchModelDatasets(client, { ...berlin, model: "ICON-EU", forecastHours: 120 }, { catalogue, registry });
    expect(urls).toHaveLength(2);
    const first = hourlyParam(urls[0] as string);
    const second = hourlyParam(urls[1] as string);
    const dropped = ["snowfall", "snow_depth", "dew_point_2m", "relative_humidity_2m"];
    expect(first).toEqual(expect.arrayContaining(dropped));
    expect(second).toEqual(first.filter((v) => !dropped.includes(v)));
    expect(datasets.map((d) => d.variable)).toEqual(second);
  });

  it("does not repeat a rejected request without snow quantities", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ error: true, reason: "Invalid" }, 400));
    const client = createClient({ fetch });
    const error = await fetchModelDatasets(
      client,
      { ...berlin, model: "ICON-EU", forecastHours: 120, quantities: ["temperature"] },
      { catalogue, registry },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a request outside the model's domain", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json({ error: true, reason: "No data is available for this location" }, 400),
    );
    const client = createClient({ fetch });
    const error = await fetchModelDatasets(client, { ...berlin, model: "ICON-D2", forecastHours: 48 }, { catalogue, registry }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(OutOfDomainError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes the error of the repeated request on", async () => {
    const fetch = vi.fn<FetchLike>(async () => json({ error: true, reason: "Invalid" }, 400));
    const client = createClient({ fetch });
    const error = await fetchModelDatasets(client, { ...berlin, model: "ICON-EU", forecastHours: 120 }, { catalogue, registry }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
