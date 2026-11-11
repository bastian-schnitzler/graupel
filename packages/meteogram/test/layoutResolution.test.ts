// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, expect, it } from "vitest";
import {
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  getBuiltinLayout,
  resolveChartLayout,
  validateChartLayout,
} from "../src";
import { getLayoutQuantities } from "../src";
import { BUILTIN_LAYOUTS } from "../src";
import { createQuantityRegistry } from "../src";
import type { ChartLayout } from "../src";

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
    [
      layout([{ id: "a", series: [{ quantity: "dew_point", style: "line", fillTo: "nope" }] }]),
      "unknown quantity: nope",
    ],
    [
      layout([{ id: "a", series: [{ quantity: "precipitation", style: "bars", fillTo: "temperature" }] }]),
      "fillTo needs style line",
    ],
    [
      layout([{ id: "a", series: [{ quantity: "dew_point", style: "line", fillTo: "temperature", fillOpacity: 2 }] }]),
      "fillOpacity must be between 0 and 1",
    ],
  ])("rejects %j", (input, message) => {
    expect(validateChartLayout(input).join("\n")).toContain(message);
  });

  it("checks quantities against the given registry", () => {
    const quantities = createQuantityRegistry([
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
    const input = layout([
      { id: "a", series: [{ quantity: "wind_speed", style: "line" }] },
    ]);
    expect(validateChartLayout(input, { quantities })).toEqual([
      "area 1 series 1: unknown quantity: wind_speed",
    ]);
    // The built-in registry is untouched by another meteogram's registry.
    expect(validateChartLayout(input)).toEqual([]);
    expect(resolveChartLayout(input, { quantities }).warning).toContain(
      "unknown quantity: wind_speed",
    );
  });
});

describe("resolveChartLayout", () => {
  it("draws the fallback layout without a layout and without warning", () => {
    const { layout: resolved, warning } = resolveChartLayout(undefined);
    expect(resolved.id).toBe(POWER_DEFAULT_LAYOUT_ID);
    expect(warning).toBeNull();
    expect(resolveChartLayout(null, { fallbackId: NORMAL_LAYOUT_ID }).layout.id).toBe(
      NORMAL_LAYOUT_ID,
    );
  });

  it("falls back to the built-in layout with a warning for an invalid layout", () => {
    const { layout: resolved, warning } = resolveChartLayout(
      layout([{ id: "a", series: [{ quantity: "nope", style: "line" }] }]),
      { fallbackId: NORMAL_LAYOUT_ID },
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

  it("resolves the spread of the dew point with its fill defaults (REQ-593)", () => {
    const power = resolveChartLayout(getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID)).layout;
    // First series of the temperature area: its fill lies behind every line.
    expect(power.areas[0]!.series[0]).toMatchObject({
      quantity: "dew_point",
      style: "line",
      axis: "left",
      fillTo: "temperature",
      fillOpacity: 0.18,
    });
    expect(power.areas[0]!.series[1]).toMatchObject({ quantity: "relative_humidity", fillTo: null });
    expect(power.areas[0]!.series[2]).toMatchObject({ quantity: "apparent_temperature", fillTo: null });
    const own = resolveChartLayout(
      layout([{ id: "a", series: [{ quantity: "dew_point", style: "line", fillTo: "temperature", fillOpacity: 0.3 }] }]),
    );
    expect(own.warning).toBeNull();
    expect(own.layout.areas[0]!.series[0]!.fillOpacity).toBe(0.3);
    expect([...getLayoutQuantities(own.layout)].sort()).toEqual(["dew_point", "temperature"]);
  });

  it("lists every quantity a layout shows", () => {
    const power = resolveChartLayout(getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID)).layout;
    expect([...getLayoutQuantities(power)].sort()).toEqual(
      [
        "apparent_temperature",
        "cape",
        "convective_inhibition",
        "dew_point",
        "lightning_potential",
        "precipitation",
        "precipitation_probability",
        "precipitation_rain_snow",
        "relative_humidity",
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

  it("takes its built-in layouts as an option", () => {
    const own: ChartLayout = {
      id: "own",
      name: "Own",
      areas: [{ id: "a", series: [{ quantity: "temperature", style: "line" }] }],
    };
    const { layout: resolved, warning } = resolveChartLayout("broken", {
      layouts: [own],
      fallbackId: "own",
    });
    expect(resolved.id).toBe("own");
    expect(warning).toContain('showing "Own"');
    expect(getBuiltinLayout("missing", [own]).id).toBe("own");
  });
});
