import { afterEach, describe, expect, it } from "vitest";
import {
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  getBuiltinLayout,
  resolveChartLayout,
  validateChartLayout,
} from "./layoutResolution";
import { getLayoutQuantities } from "./layoutQuantities";
import { BUILTIN_LAYOUTS } from "./builtinLayouts.generated";
import {
  resetQuantityRegistry,
  setQuantityRegistry,
} from "../quantities/registry";
import type { ChartLayout } from "./types";

afterEach(() => resetQuantityRegistry());

const layout = (areas: unknown, extra: Record<string, unknown> = {}) => ({
  id: "custom",
  name: "Custom",
  areas,
  ...extra,
});

describe("validateChartLayout", () => {
  it("accepts both built-in layouts", () => {
    expect(BUILTIN_LAYOUTS.map((item) => item.id)).toEqual([
      POWER_DEFAULT_LAYOUT_ID,
      NORMAL_LAYOUT_ID,
    ]);
    for (const builtin of BUILTIN_LAYOUTS) {
      expect(validateChartLayout(builtin)).toEqual([]);
    }
  });

  it.each([
    [null, "layout must be an object"],
    [layout([]), "at least one area"],
    [layout([{ id: "a", series: [{ quantity: "nope", style: "line" }] }]), "unknown quantity: nope"],
    [layout([{ id: "a", series: [{ quantity: "temperature", style: "bars" }] }]), "style bars not allowed for temperature"],
    [layout([{ id: "a" }, { id: "a" }]), "area ids must be unique"],
    [layout([{ id: "a", enabled: false }]), "at least one enabled area"],
    [layout([{ id: "a", heightWeight: 0 }]), "heightWeight must be greater than 0"],
    [layout([{ id: "a", axes: { left: { range: "fixed", min: 1 } } }]), "fixed axis range needs min and max"],
    [layout([{ id: "a", background: { kind: "cloud_cover" } }]), "style profile not allowed for cloud_cover"],
    [layout([{ id: "a" }], { showLocationLabel: "left" }), "unknown location label position"],
  ])("rejects %j", (input, message) => {
    expect(validateChartLayout(input).join("\n")).toContain(message);
  });

  it("checks quantities against the loaded registry", () => {
    setQuantityRegistry([
      {
        id: "temperature",
        label: "Temperature",
        unit: "°C",
        kind: "point",
        source: "hourly",
        api_name: "temperature_2m",
        aliases: [],
        optional: false,
        catalogued: true,
        always_fetch: false,
        unit_from_api: true,
        retry_without: false,
        ensemble: false,
        allowed_styles: ["line"],
        requires: [],
        downloadable: true,
        color: null,
      },
    ]);
    expect(
      validateChartLayout(
        layout([{ id: "a", series: [{ quantity: "wind_speed", style: "line" }] }]),
      ),
    ).toEqual(["area 1 series 1: unknown quantity: wind_speed"]);
  });
});

describe("resolveChartLayout", () => {
  it("draws the fallback layout without a layout and without warning", () => {
    const { layout: resolved, warning } = resolveChartLayout(undefined);
    expect(resolved.id).toBe(POWER_DEFAULT_LAYOUT_ID);
    expect(warning).toBeNull();
    expect(resolveChartLayout(null, NORMAL_LAYOUT_ID).layout.id).toBe(
      NORMAL_LAYOUT_ID,
    );
  });

  it("falls back to the built-in layout with a warning for an invalid layout", () => {
    const { layout: resolved, warning } = resolveChartLayout(
      layout([{ id: "a", series: [{ quantity: "nope", style: "line" }] }]),
      NORMAL_LAYOUT_ID,
    );
    expect(resolved.id).toBe(NORMAL_LAYOUT_ID);
    expect(warning).toContain('showing "Standard"');
    expect(warning).toContain("unknown quantity: nope");
  });

  it("never throws, even for garbage input", () => {
    for (const input of [42, "layout", [], { areas: "x" }, { areas: [null] }]) {
      expect(() => resolveChartLayout(input)).not.toThrow();
      expect(resolveChartLayout(input).warning).not.toBeNull();
    }
  });

  it("fills defaults and drops disabled areas and series", () => {
    const { layout: resolved } = resolveChartLayout(
      layout([
        {
          id: "a",
          series: [
            { quantity: "temperature", style: "line" },
            { quantity: "apparent_temperature", style: "line", enabled: false },
          ],
        },
        { id: "b", enabled: false },
      ]),
    );
    expect(resolved).toMatchObject({
      showModelHeaders: true,
      showDayHeader: true,
      showDaylight: true,
      showLocationLabel: "bottom",
      showCreatedTimestamp: true,
    });
    expect(resolved.areas).toHaveLength(1);
    expect(resolved.areas[0]).toMatchObject({ heightWeight: 1, background: null });
    expect(resolved.areas[0].series).toEqual([
      expect.objectContaining({
        quantity: "temperature",
        axis: "left",
        curveStops: true,
        extremeLabels: false,
      }),
    ]);
  });

  it("lists every quantity a layout shows", () => {
    const power = resolveChartLayout(getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID)).layout;
    expect([...getLayoutQuantities(power)].sort()).toEqual(
      [
        "apparent_temperature",
        "cape",
        "convective_inhibition",
        "lightning_potential",
        "precipitation",
        "precipitation_probability",
        "precipitation_rain_snow",
        "snow_depth",
        "snowfall",
        "temperature",
        "vertical_cloud_profile",
        "weather_code",
        "wind_direction",
        "wind_gusts",
        "wind_speed",
      ].sort(),
    );
    const normal = resolveChartLayout(getBuiltinLayout(NORMAL_LAYOUT_ID)).layout;
    const normalQuantities = getLayoutQuantities(normal);
    expect(normalQuantities.has("cape")).toBe(false);
    expect(normalQuantities.has("vertical_cloud_profile")).toBe(true);
    expect(normal.showModelHeaders).toBe(false);
  });

  it("returns the power default for an unknown built-in id", () => {
    const fallback: ChartLayout = getBuiltinLayout("missing");
    expect(fallback.id).toBe(POWER_DEFAULT_LAYOUT_ID);
  });
});
