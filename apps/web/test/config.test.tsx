// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SHIPPED from "../public/config.json";
import { App } from "../src/App.tsx";
import {
  ConfigProvider,
  DEFAULT_CONFIG,
  CONFIG_SCHEMA,
  DEFAULT_PLACE,
  HOSTING_PROVIDERS,
  LANGUAGES,
  loadConfig,
  mergeDeep,
  parseConfig,
  siteDomain,
  startPlace,
  useConfig,
  validateConfig,
  type GraupelConfig,
} from "../src/config/index.ts";
import { resetModelChainView, setModelChainVisible } from "../src/state/index.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetModelChainView();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function regions(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-region]")].map((el) => el.getAttribute("data-region"));
}

describe("config schema", () => {
  it("accepts the defaults, the shipped config.json and an empty object", () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    expect(validateConfig(SHIPPED)).toEqual([]);
    expect(validateConfig({})).toEqual([]);
  });

  it("offers the same languages as the TypeScript types", () => {
    expect(CONFIG_SCHEMA.$defs?.language?.enum).toEqual([...LANGUAGES]);
  });

  it("offers the same hosting providers as the TypeScript types (REQ-710)", () => {
    expect(CONFIG_SCHEMA.properties?.legal?.properties?.hosting?.enum).toEqual([...HOSTING_PROVIDERS]);
    for (const hosting of HOSTING_PROVIDERS) expect(validateConfig({ legal: { hosting } })).toEqual([]);
  });

  it("accepts a full domain-like config", () => {
    const config = {
      startLocation: "gps",
      modelChain: false,
      showWeatherChain: true,
      showCloudChain: false,
      modelHeaders: false,
      imageModelHeaders: true,
      daySlider: { enabled: true, days: 7 },
      favorites: { enabled: false, presets: [{ name: "Brussels", lat: 50.85, lon: 4.35 }] },
      map: "maptoolkit",
      languages: ["en", "fr", "de"],
      defaultLanguage: "en",
      timeZone: "Europe/Berlin",
      legal: {
        hosting: "all-inkl",
        imprint: { label: "Impressum", name: "Operator", residence: "Berlin", address: ["Street 1"], hoster: false },
        privacy: { controller: { name: "Operator", email: "operator@example.org" }, swissNotice: true },
      },
    };
    expect(validateConfig(config)).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ["not an object", [], "/: expected object"],
    ["unknown field", { colour: "red" }, '/: unknown field "colour"'],
    ["wrong type", { modelChain: "yes" }, "/modelChain: expected boolean, got string"],
    ["weather chain no boolean", { showWeatherChain: 1 }, "/showWeatherChain: expected boolean, got number"],
    ["cloud chain no boolean", { showCloudChain: "on" }, "/showCloudChain: expected boolean, got string"],
    ["image model headers no boolean", { imageModelHeaders: 1 }, "/imageModelHeaders: expected boolean, got number"],
    ["unknown start mode", { startLocation: "ip" }, "/startLocation:"],
    ["place without lon", { startLocation: { name: "X", lat: 1 } }, "/startLocation:"],
    ["latitude out of range", { favorites: { presets: [{ name: "X", lat: 91, lon: 0 }] } }, "/favorites/presets/0/lat: must be at most 90"],
    ["zero days", { daySlider: { days: 0 } }, "/daySlider/days:"],
    ["fractional days", { daySlider: { days: 2.5 } }, "/daySlider/days:"],
    ["unknown map", { map: "google" }, '/map: expected one of "opentopomap", "maptoolkit"'],
    ["unknown language", { languages: ["en", "xx"] }, "/languages/1: expected one of"],
    ["duplicate language", { languages: ["en", "en"] }, "/languages: entries must be unique"],
    ["no language", { languages: [] }, "/languages: must have at least 1 entries"],
    ["unknown imprint field", { legal: { imprint: { phone: "1" } } }, '/legal/imprint: unknown field "phone"'],
    ["unknown hosting provider", { legal: { hosting: "netlify" } }, '/legal/hosting: expected one of "github-pages", "all-inkl"'],
  ])("rejects %s", (_name, config, message) => {
    const errors = validateConfig(config);
    expect(errors.some((error) => error.startsWith(message))).toBe(true);
  });
});

describe("parseConfig", () => {
  it("merges a partial config with the defaults", () => {
    const { config, warnings } = parseConfig({ modelChain: false, daySlider: { days: 5 }, legal: { imprint: { name: "A" } } });
    expect(warnings).toEqual([]);
    expect(config.modelChain).toBe(false);
    expect(config.daySlider).toEqual({ enabled: true, days: 5 });
    expect(config.legal).toEqual({ hosting: "github-pages", imprint: { name: "A" }, privacy: { swissNotice: false } });
    expect(config.favorites).toEqual(DEFAULT_CONFIG.favorites);
    expect(config.map).toBe("opentopomap");
  });

  it("takes legal.hosting, without it GitHub Pages (REQ-710)", () => {
    expect(DEFAULT_CONFIG.legal.hosting).toBe("github-pages");
    expect(parseConfig({ legal: { hosting: "all-inkl" } }).config.legal.hosting).toBe("all-inkl");
    const { config, warnings } = parseConfig({ legal: { hosting: "netlify" } });
    expect(config.legal.hosting).toBe("github-pages");
    expect(warnings.some((warning) => warning.startsWith("/legal/hosting:"))).toBe(true);
  });

  it("hides both chain cards by default and takes showWeatherChain / showCloudChain separately (REQ-503)", () => {
    expect(DEFAULT_CONFIG.showWeatherChain).toBe(false);
    expect(DEFAULT_CONFIG.showCloudChain).toBe(false);
    const { config, warnings } = parseConfig({ showWeatherChain: true });
    expect(warnings).toEqual([]);
    expect(config.showWeatherChain).toBe(true);
    expect(config.showCloudChain).toBe(false);
    expect(config.modelChain).toBe(true);
    const invalid = parseConfig({ showCloudChain: "yes", showWeatherChain: true });
    expect(invalid.config.showCloudChain).toBe(false);
    expect(invalid.config.showWeatherChain).toBe(true);
    expect(invalid.warnings.some((warning) => warning.startsWith("/showCloudChain"))).toBe(true);
  });

  it("keeps imageModelHeaders as a valid option, default false, currently without effect (REQ-539, DEC-094)", () => {
    expect(DEFAULT_CONFIG.imageModelHeaders).toBe(false);
    expect(parseConfig({}).config.imageModelHeaders).toBe(false);
    const { config, warnings } = parseConfig({ imageModelHeaders: true, modelHeaders: false });
    expect(warnings).toEqual([]);
    expect(config.imageModelHeaders).toBe(true);
    expect(config.modelHeaders).toBe(false);
    const invalid = parseConfig({ imageModelHeaders: "yes" });
    expect(invalid.config.imageModelHeaders).toBe(false);
    expect(invalid.warnings.some((warning) => warning.startsWith("/imageModelHeaders"))).toBe(true);
  });

  it("takes the time zone of the default place, Europe/Paris by default, and drops an unknown one (REQ-733)", () => {
    expect(DEFAULT_CONFIG.timeZone).toBe("Europe/Paris");
    expect(parseConfig({}).config.timeZone).toBe("Europe/Paris");
    const { config, warnings } = parseConfig({ timeZone: "Europe/Vienna" });
    expect(warnings).toEqual([]);
    expect(config.timeZone).toBe("Europe/Vienna");
    const unknown = parseConfig({ timeZone: "Mars/Olympus" });
    expect(unknown.config.timeZone).toBe("Europe/Paris");
    expect(unknown.warnings).toEqual(['/timeZone: "Mars/Olympus" is no known time zone, using "Europe/Paris"']);
    const invalid = parseConfig({ timeZone: 1 });
    expect(invalid.config.timeZone).toBe("Europe/Paris");
    expect(invalid.warnings.some((warning) => warning.startsWith("/timeZone"))).toBe(true);
  });

  it("replaces arrays instead of merging them", () => {
    const presets = [{ name: "Brussels", lat: 50.85, lon: 4.35 }];
    const { config } = parseConfig({ favorites: { presets }, languages: ["fr"], defaultLanguage: "fr" });
    expect(config.favorites).toEqual({ enabled: true, presets });
    expect(config.languages).toEqual(["fr"]);
  });

  it("keeps valid fields and falls back to the default for invalid ones, with warnings", () => {
    const { config, warnings } = parseConfig({ modelChain: false, map: "google", extra: 1 });
    expect(config.modelChain).toBe(false);
    expect(config.map).toBe("opentopomap");
    expect(warnings.join("\n")).toContain("/map: invalid, using the default");
    expect(warnings.join("\n")).toContain('unknown field "extra" ignored');
  });

  it("falls back to the defaults for a non-object", () => {
    for (const input of [null, 3, "x", []]) {
      const { config, warnings } = parseConfig(input);
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(warnings).toHaveLength(1);
    }
  });

  it("fixes a default language that is not offered", () => {
    const { config, warnings } = parseConfig({ languages: ["de", "fr"], defaultLanguage: "it" });
    expect(config.defaultLanguage).toBe("de");
    expect(warnings[0]).toContain('"it" is not in languages');
  });

  it("does not change the defaults", () => {
    const before = JSON.stringify(DEFAULT_CONFIG);
    parseConfig({ daySlider: { enabled: false }, languages: ["da"], defaultLanguage: "de" });
    expect(JSON.stringify(DEFAULT_CONFIG)).toBe(before);
  });

  it("ignores $schema", () => {
    expect(parseConfig({ $schema: "./config.schema.json" })).toEqual({ config: DEFAULT_CONFIG, warnings: [] });
  });
});

describe("mergeDeep", () => {
  it("merges objects recursively and replaces scalars and arrays", () => {
    expect(mergeDeep({ a: { b: 1, c: 2 }, d: [1, 2] }, { a: { c: 3 }, d: [9] })).toEqual({ a: { b: 1, c: 3 }, d: [9] });
    expect(mergeDeep({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe("startPlace", () => {
  it("uses the fixed place, or for gps the first favorite, else the default place", () => {
    const brussels = { name: "Brussels", lat: 50.85, lon: 4.35 };
    expect(startPlace({ ...DEFAULT_CONFIG, startLocation: brussels })).toEqual(brussels);
    const ortler = { name: "Ortler", lat: 46.5086, lon: 10.5447 };
    expect(startPlace({ ...DEFAULT_CONFIG, startLocation: "gps", favorites: { enabled: true, presets: [ortler] } })).toEqual(
      ortler,
    );
    expect(startPlace({ ...DEFAULT_CONFIG, startLocation: "gps", favorites: { enabled: true, presets: [] } })).toEqual(
      DEFAULT_PLACE,
    );
  });
});

describe("siteDomain (REQ-464)", () => {
  it("prefers the configured domain", () => {
    expect(siteDomain({ domain: "graupel.eu" }, "bastian-schnitzler.github.io")).toBe("graupel.eu");
    expect(siteDomain({ domain: " graupel.at " }, "")).toBe("graupel.at");
  });

  it("falls back to the host name without www.", () => {
    expect(siteDomain({}, "www.graupel.example")).toBe("graupel.example");
    expect(siteDomain({}, "Graupel.Example.")).toBe("graupel.example");
    expect(siteDomain({ domain: "  " }, "bastian-schnitzler.github.io")).toBe("bastian-schnitzler.github.io");
  });

  it("shows nothing on localhost, an IP address or without a host", () => {
    for (const host of ["localhost", "127.0.0.1", "192.168.1.20", "[::1]", ""]) expect(siteDomain({}, host)).toBe("");
  });

  it("accepts a domain in the schema and rejects an empty one", () => {
    expect(parseConfig({ domain: "graupel.eu" })).toEqual({
      config: { ...DEFAULT_CONFIG, domain: "graupel.eu" },
      warnings: [],
    });
    expect(parseConfig({ domain: "" }).config.domain).toBeUndefined();
  });
});

describe("loadConfig", () => {
  it("fetches ./config.json relative to the page", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ map: "maptoolkit" }));
    const { config, warnings } = await loadConfig(undefined, fetchMock);
    expect(fetchMock).toHaveBeenCalledWith("./config.json", expect.anything());
    expect(config.map).toBe("maptoolkit");
    expect(warnings).toEqual([]);
  });

  it.each<[string, () => Promise<Response>]>([
    ["a missing file", async () => jsonResponse("not found", 404)],
    ["invalid JSON", async () => jsonResponse("{ nope")],
    ["a network error", async () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("falls back to the defaults on %s", async (_name, impl) => {
    const { config, warnings } = await loadConfig("./config.json", vi.fn(impl));
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("using the defaults");
  });
});

describe("ConfigProvider", () => {
  function ShowMap() {
    return <p>{useConfig().map}</p>;
  }

  it("provides the defaults without a provider", () => {
    render(<ShowMap />);
    expect(screen.getByText("opentopomap")).toBeTruthy();
  });

  it("loads config.json, warns about problems and then renders", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ map: "maptoolkit", modelChain: "no" })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ConfigProvider fallback={<p>loading</p>}>
        <ShowMap />
      </ConfigProvider>,
    );
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("maptoolkit")).toBeTruthy();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain("/modelChain");
    vi.unstubAllGlobals();
  });

  it("renders the app with defaults when config.json cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("", 404)));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(
      <ConfigProvider>
        <App />
      </ConfigProvider>,
    );
    await screen.findByRole("main");
    // The model chain is hidden by default (REQ-445) and then has no card (REQ-471).
    expect(regions(container)).toEqual(["location", "header", "day-slider", "meteogram", "footer"]);
    vi.unstubAllGlobals();
  });
});

describe("switches in the app", () => {
  function renderWith(overrides: Partial<GraupelConfig>) {
    return render(
      <ConfigProvider config={{ ...DEFAULT_CONFIG, ...overrides }}>
        <App />
      </ConfigProvider>,
    );
  }

  it("leaves out the model chain when modelChain is false", () => {
    const { container } = renderWith({ modelChain: false });
    expect(regions(container)).toEqual(["location", "header", "day-slider", "meteogram", "footer"]);
  });

  it("leaves out the day slider when daySlider.enabled is false", () => {
    setModelChainVisible(true);
    const { container } = renderWith({ daySlider: { enabled: false, days: 7 } });
    expect(regions(container)).toEqual(["location", "header", "model-chain", "meteogram", "footer"]);
  });

  it("shows both when switched on", () => {
    setModelChainVisible(true);
    const { container } = renderWith({});
    expect(regions(container)).toContain("model-chain");
    expect(regions(container)).toContain("day-slider");
  });
});
