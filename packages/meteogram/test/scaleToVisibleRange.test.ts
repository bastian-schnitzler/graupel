// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Axes of precipitation and wind follow the visible range (REQ-655, option `scaleToVisibleRange`, default true): in a
 * zoomed chart the maxima of their zero-based axes come from the values of all models in the visible range (with the
 * hour at each edge), on the usual steps; off or unzoomed the axes span all data. `axisRangeFrom` holds them at another
 * range while a gesture pans the chart (DEC-061).
 */
import { describe, expect, it } from "vitest";
import { valueToY, type ValueScale } from "../src/core/chartGeometry";
import type { MeteogramInput } from "../src/core/input";
import type { TimeRange } from "../src/core/zoom";
import { getAxisPreset } from "../src/layouts/seriesPresets";
import { getBuiltinLayout, POWER_DEFAULT_LAYOUT_ID } from "../src/layouts/resolution";
import type { ChartLayout } from "../src/layouts/types";
import { meteogramToSvgString, renderStaticLayer } from "../src/render/meteogram";
import {
  createMeteogramScene,
  VISIBLE_RANGE_AXIS_QUANTITIES,
  type MeteogramRenderOptions,
} from "../src/render/scene";
import { findAll, textContent } from "../src/render/vnode";
import { normalInput, normalOptions, powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const HOUR = 3_600_000;
const POWER_START = Date.UTC(2026, 9, 15, 0);
/** Hours `from` to `to` after the start of the power fixture. */
const hours = (from: number, to: number): TimeRange => ({
  start: POWER_START + from * HOUR,
  end: POWER_START + to * HOUR,
});
/** A calm part of the power fixture: no precipitation, gusts up to about 21 km/h. */
const CALM = hours(24, 36);

function chart(options: MeteogramRenderOptions = {}, input: MeteogramInput = powerInput) {
  const scene = createMeteogramScene(input, { ...powerOptions, ...options });
  const scaleOf = (name: string) => scene.areaScales[scene.geometry.areas.findIndex((area) => area.name === name)]!;
  return {
    scene,
    temperature: scaleOf("temperature").left!,
    precipitation: scaleOf("precipitation").left!,
    wind: scaleOf("wind").left!,
    convective: scaleOf("convective").bySeries.map((scale) => (scale ? [scale.min, scale.max] : null)),
    scaleOf,
  };
}

/** Text of the labels with `key` in the panel of an area. */
function labels(options: MeteogramRenderOptions, area: string, key: string) {
  const layer = renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, ...options }));
  const panel = findAll(layer, (node) => node.attrs["data-area-id"] === area)[0]!;
  return findAll(panel, (node) => node.tag === "text" && node.key === key).map(textContent);
}

/** The power fixture with extra points of one model (`modelSeries`). */
function withModelPoints(points: { hour: number; variable: string; value: number }[]): MeteogramInput {
  return {
    ...powerInput,
    modelSeries: {
      ...powerInput.modelSeries,
      "ICON-D2": points.map(({ hour, variable, value }) => ({
        timestamp: new Date(POWER_START + hour * HOUR).toISOString(),
        variable,
        value,
        unit: "",
        model: "ICON-D2",
      })),
    },
  };
}

describe("option scaleToVisibleRange (REQ-655)", () => {
  it("names precipitation and wind as the quantities that follow", () => {
    expect([...VISIBLE_RANGE_AXIS_QUANTITIES].sort()).toEqual(
      ["precipitation", "precipitation_rain_snow", "wind_gusts", "wind_speed"].sort(),
    );
  });

  it("zoomed into a calm part gives smaller precipitation and wind axes (default on)", () => {
    const whole = chart();
    expect([whole.precipitation.max, whole.wind.max]).toEqual([5, 40]);
    const zoomed = chart({ visibleRange: CALM });
    expect(zoomed.scene.axisRange).toEqual(CALM);
    expect(zoomed.precipitation.max).toBe(2);
    expect(zoomed.wind.max).toBe(30);
    expect(chart({ visibleRange: CALM, scaleToVisibleRange: true }).wind.max).toBe(30);
    expect(labels({ visibleRange: CALM }, "precip", "axis-max")).toEqual(["2 mm"]);
    expect(labels({ visibleRange: CALM }, "wind", "axis-max")).toEqual(["30 km/h"]);
  });

  it("moves the guide line of the wind area along: 15 km/h at a 30 km/h axis", () => {
    expect(labels({}, "wind", "axis-mid")).toEqual(["20 km/h"]);
    expect(labels({ visibleRange: CALM }, "wind", "axis-mid")).toEqual(["15 km/h"]);
    const layer = renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, visibleRange: CALM }));
    const line = findAll(layer, (node) => node.attrs["data-testid"] === "wind-mid-line")[0]!;
    expect(Number(line.attrs["data-value"])).toBe(15);
  });

  it("keeps the axes over all data when switched off", () => {
    const whole = chart();
    const off = chart({ visibleRange: CALM, scaleToVisibleRange: false });
    expect(off.scene.axisRange).toBeNull();
    expect([off.precipitation.max, off.wind.max]).toEqual([whole.precipitation.max, whole.wind.max]);
    expect(labels({ visibleRange: CALM, scaleToVisibleRange: false }, "wind", "axis-mid")).toEqual(["20 km/h"]);
  });

  it("changes nothing while everything is visible", () => {
    for (const visibleRange of [undefined, null, hours(0, 72), hours(-10, 100)]) {
      const scene = createMeteogramScene(powerInput, { ...powerOptions, visibleRange });
      expect(scene.axisRange).toBeNull();
      expect(meteogramToSvgString(powerInput, { ...powerOptions, visibleRange })).toBe(
        meteogramToSvgString(powerInput, { ...powerOptions, visibleRange, scaleToVisibleRange: false }),
      );
    }
  });

  it("leaves the temperature, CAPE and other axes alone", () => {
    const whole = chart();
    for (const options of [{ visibleRange: CALM }, { visibleRange: hours(50, 60) }]) {
      const zoomed = chart(options);
      expect([zoomed.temperature.min, zoomed.temperature.max]).toEqual([whole.temperature.min, whole.temperature.max]);
      expect(zoomed.convective).toEqual(whole.convective);
      // The hidden precipitation probability keeps its fixed 0 to 100.
      const probability = zoomed
        .scaleOf("precipitation")
        .bySeries.find((scale) => scale?.quantity === "precipitation_probability");
      expect([probability?.min, probability?.max]).toEqual([0, 100]);
    }
  });

  it("leaves right axes and axes without range zero-based alone", () => {
    const power = getBuiltinLayout(POWER_DEFAULT_LAYOUT_ID);
    const layout: ChartLayout = {
      ...power,
      areas: power.areas.map((area) =>
        area.id === "wind"
          ? {
              ...area,
              axes: {
                left: { quantity: "wind_speed", range: "auto" },
                right: { quantity: "wind_gusts", range: "zero-based" },
              },
              series: (area.series ?? []).map((series) =>
                series.quantity === "wind_gusts" ? { ...series, axis: "right" } : series,
              ),
            }
          : area,
      ),
    } as ChartLayout;
    const whole = chart({ layout });
    const zoomed = chart({ layout, visibleRange: CALM });
    const pair = (scale: ValueScale | null) => [scale?.min, scale?.max];
    // An auto axis keeps its range over all data.
    expect(pair(zoomed.scaleOf("wind").left)).toEqual(pair(whole.scaleOf("wind").left));
    // Right axes never follow, even a zero-based wind axis.
    expect(pair(zoomed.scaleOf("wind").right)).toEqual(pair(whole.scaleOf("wind").right));
    // On the left the same axis does.
    const left: ChartLayout = {
      ...layout,
      areas: layout.areas.map((area) =>
        area.id === "wind"
          ? {
              ...area,
              axes: { left: { quantity: "wind_gusts", range: "zero-based" } },
              series: (area.series ?? []).map((series) => ({ ...series, axis: "left" as const })),
            }
          : area,
      ),
    };
    expect(chart({ layout: left, visibleRange: CALM }).wind.max).toBe(30);
  });

  it("counts the hour at each edge of the visible range", () => {
    // Precipitation of the power fixture: 1.6 mm at 46 h and 2.2 mm at 47 h; 2.2 mm also at 15 h.
    expect(chart({ visibleRange: hours(16, 46) }).precipitation.max).toBe(2);
    // The range ends inside the 46 h bar; the first hour at or after its end (47 h) counts.
    expect(chart({ visibleRange: hours(16, 46.5) }).precipitation.max).toBe(5);
    // The range starts inside the 15 h bar: the last hour at or before its start counts.
    expect(chart({ visibleRange: hours(15.5, 30) }).precipitation.max).toBe(5);
    expect(chart({ visibleRange: hours(16, 30) }).precipitation.max).toBe(2);
  });

  it("takes the values of all models in the visible range, not those outside", () => {
    const inside = withModelPoints([
      { hour: 30, variable: "wind_gusts", value: 90 },
      { hour: 30, variable: "precipitation", value: 12 },
    ]);
    const zoomed = chart({ visibleRange: CALM }, inside);
    expect([zoomed.precipitation.max, zoomed.wind.max]).toEqual([15, 100]);
    const outside = withModelPoints([
      { hour: 60, variable: "wind_gusts", value: 90 },
      { hour: 60, variable: "precipitation", value: 12 },
    ]);
    const calm = chart({ visibleRange: CALM }, outside);
    expect([calm.precipitation.max, calm.wind.max]).toEqual([2, 30]);
    // Unzoomed the axes span them.
    expect([chart({}, outside).precipitation.max, chart({}, outside).wind.max]).toEqual([15, 100]);
  });

  it("counts a model's values only up to an hour beyond the edges, not those of a model that ends earlier", () => {
    // A model whose data end at 47 h with strong gusts: zoomed to 50 to 72 h they do not count.
    const ended = withModelPoints([{ hour: 47, variable: "wind_gusts", value: 90 }]);
    const late = hours(50, 72);
    expect(chart({ visibleRange: late }, ended).wind.max).toBe(chart({ visibleRange: late }).wind.max);
    // Within the hour before the start they do.
    expect(chart({ visibleRange: hours(47.5, 72) }, ended).wind.max).toBe(100);
    expect(chart({ visibleRange: hours(48, 72) }, ended).wind.max).toBeLessThan(100);
    // Likewise after the end.
    const later = withModelPoints([{ hour: 37, variable: "wind_gusts", value: 90 }]);
    expect(chart({ visibleRange: hours(24, 36.5) }, later).wind.max).toBe(100);
    expect(chart({ visibleRange: CALM }, later).wind.max).toBe(30);
  });

  it("keeps the wind curves below the arrows on the smaller axis", () => {
    const zoomed = chart({ visibleRange: CALM });
    const { wind } = zoomed;
    const area = zoomed.scene.geometry.areas.find((item) => item.name === "wind")!;
    const clearance = getAxisPreset("wind_speed").arrowClearance!(zoomed.scene.pixelLayout.windIconScaleY);
    // Gusts in the calm part (with the edge hours) reach about 21 km/h.
    const visibleMax = Math.max(
      ...powerInput.series
        .filter((point) => point.variable === "wind_gusts" && point.value !== null)
        .filter((point) => Date.parse(point.timestamp) >= CALM.start && Date.parse(point.timestamp) <= CALM.end)
        .map((point) => point.value!),
    );
    expect(visibleMax).toBeLessThan(30);
    expect(valueToY(wind, visibleMax)).toBeGreaterThanOrEqual(area.top + clearance - 1e-6);
  });

  it("takes the axis maximum maxPrecipitation only while the axes span all data", () => {
    // Off: the host's maximum, as before.
    expect(chart({ visibleRange: CALM, scaleToVisibleRange: false, maxPrecipitation: 18 }).precipitation.max).toBe(20);
    // Unzoomed: also the host's maximum.
    expect(chart({ maxPrecipitation: 18 }).precipitation.max).toBe(20);
    // On and zoomed: the maximum in the visible range replaces it.
    expect(chart({ visibleRange: CALM, maxPrecipitation: 18 }).precipitation.max).toBe(2);
    expect(chart({ visibleRange: hours(10, 16), maxPrecipitation: 18 }).precipitation.max).toBe(5);
  });

  it("does not change the zoomed normal fixture, whose visible maxima reach the same steps", () => {
    const on = createMeteogramScene(normalInput, normalOptions);
    expect(on.axisRange).not.toBeNull();
    expect(meteogramToSvgString(normalInput, normalOptions)).toBe(
      meteogramToSvgString(normalInput, { ...normalOptions, scaleToVisibleRange: false }),
    );
  });

  it("matches the SVG snapshot of the power fixture zoomed into the calm part", async () => {
    await expect(
      meteogramToSvgString(powerInput, { ...powerOptions, visibleRange: CALM, xmlDeclaration: true }),
    ).toMatchFileSnapshot("./__snapshots__/power.zoomed.svg");
  });
});

describe("axisRangeFrom: axes held while the range moves (DEC-061)", () => {
  it("takes the maxima from the given range instead of the visible one", () => {
    // Panned from the calm part into the first shower: the axes stay those of the calm part.
    const panned = chart({ visibleRange: hours(8, 20), axisRangeFrom: CALM });
    expect(panned.scene.axisRange).toEqual(CALM);
    expect([panned.precipitation.max, panned.wind.max]).toEqual([2, 30]);
    expect(labels({ visibleRange: hours(8, 20), axisRangeFrom: CALM }, "wind", "axis-mid")).toEqual(["15 km/h"]);
    // Released: the visible range decides again.
    const released = chart({ visibleRange: hours(8, 20) });
    expect(released.scene.axisRange).toEqual(hours(8, 20));
    expect(released.precipitation.max).toBe(5);
    expect(chart({ visibleRange: hours(8, 20), axisRangeFrom: null }).precipitation.max).toBe(5);
  });

  it("is clamped to the whole range and does nothing with the option off or a whole range", () => {
    expect(chart({ visibleRange: CALM, axisRangeFrom: hours(-24, 100) }).scene.axisRange).toBeNull();
    expect(chart({ visibleRange: CALM, axisRangeFrom: hours(-24, 100) }).precipitation.max).toBe(5);
    expect(chart({ visibleRange: hours(30, 50), axisRangeFrom: hours(-5, 36) }).scene.axisRange).toEqual(hours(0, 36));
    const off = chart({ visibleRange: hours(8, 20), axisRangeFrom: CALM, scaleToVisibleRange: false });
    expect(off.scene.axisRange).toBeNull();
    expect([off.precipitation.max, off.wind.max]).toEqual([5, 40]);
  });
});
