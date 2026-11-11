// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Design configuration: theme tokens (light, dark, overrides), switchable
 * parts of the layout, locale, texts and font family.
 */
import { describe, expect, it } from "vitest";
import { buildFullscreenDetailRows } from "../src/core/details";
import {
  DARK_THEME,
  LIGHT_THEME,
  resolveMeteogramTheme,
  type MeteogramTheme,
} from "../src/core/theme";
import { DEFAULT_TEXTS, resolveMeteogramTexts } from "../src/core/texts";
import { groupTimestampsByDay } from "../src/core/timelineUtils";
import { formatTooltipHeaderDate } from "../src/core/tooltip";
import { BUILTIN_LAYOUTS } from "../src/layouts/builtin";
import {
  DEFAULT_SERIES_DASH_ARRAY,
  PAIRED_SERIES_DASH_ARRAY,
  getSeriesColor,
  getSeriesDashArray,
} from "../src/layouts/seriesPresets";
import type { ChartLayout } from "../src/layouts/types";
import type { MeteogramInput } from "../src/core/input";
import { meteogramToSvgString, renderMeteogramSvg, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { findAll, textContent, type VNode } from "../src/render/vnode";
import { FIXTURES, powerInput, powerOptions } from "./fixtures/meteogramFixtures";
import { haloOf } from "./fixtures/halo";

const THEMES = ["light", "dark"] as const;

const byTestId = (root: VNode, testId: string) =>
  findAll(root, (node) => node.attrs["data-testid"] === testId);

/** Every colour a theme defines (nested token groups included). */
function themeColors(theme: MeteogramTheme): Set<string> {
  const colors = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") colors.add(value);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(theme);
  return colors;
}

/** Colour values of fill, stroke and stop-color attributes in SVG markup. */
function svgColors(markup: string): Set<string> {
  const colors = new Set<string>();
  for (const match of markup.matchAll(/ (?:fill|stroke|stop-color)="([^"]*)"/g)) {
    const value = match[1]!;
    if (value === "none" || value === "transparent" || value.startsWith("url(")) continue;
    colors.add(value);
  }
  return colors;
}

const powerLayout = (): ChartLayout =>
  structuredClone(BUILTIN_LAYOUTS.find((layout) => layout.id === "power-default")!);

describe("SVG snapshots per fixture and theme", () => {
  for (const [name, { input, options }] of Object.entries(FIXTURES)) {
    for (const theme of THEMES) {
      it(`fixture ${name}, theme ${theme}`, async () => {
        // The light theme is the default and has the snapshot of renderer.test.ts.
        const file = theme === "light" ? `${name}.svg` : `${name}.${theme}.svg`;
        await expect(
          meteogramToSvgString(input, { ...options, theme, xmlDeclaration: true }),
        ).toMatchFileSnapshot(`./__snapshots__/${file}`);
      });
    }
  }
});

describe("themes", () => {
  it("light is the default", () => {
    for (const { input, options } of Object.values(FIXTURES)) {
      expect(meteogramToSvgString(input, { ...options, theme: "light" })).toBe(
        meteogramToSvgString(input, options),
      );
    }
    expect(resolveMeteogramTheme()).toBe(LIGHT_THEME);
    expect(resolveMeteogramTheme("dark")).toBe(DARK_THEME);
  });

  it("dark draws only colours of the dark theme", () => {
    const dark = themeColors(DARK_THEME);
    for (const { input, options } of Object.values(FIXTURES)) {
      const used = svgColors(meteogramToSvgString(input, { ...options, theme: "dark" }));
      expect(used.size).toBeGreaterThan(10);
      expect([...used].filter((color) => !dark.has(color))).toEqual([]);
    }
  });

  it("light draws only colours of the light theme and the registry", () => {
    const light = themeColors(LIGHT_THEME);
    for (const { input, options } of Object.values(FIXTURES)) {
      const used = svgColors(meteogramToSvgString(input, options));
      expect([...used].filter((color) => !light.has(color))).toEqual([]);
    }
  });

  it("has no colour literals in the renderer, the presets or the detail rows", () => {
    const sources = import.meta.glob<string>(
      ["../src/render/**/*.ts", "../src/layouts/seriesPresets.ts", "../src/core/details.ts"],
      { query: "?raw", import: "default", eager: true },
    );
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    for (const [file, source] of Object.entries(sources)) {
      expect(source.match(/["'](#[0-9a-fA-F]{3,8}|rgba?\()/g), file).toBeNull();
    }
  });

  it("merges overrides onto their base theme", () => {
    const theme = resolveMeteogramTheme({
      base: "dark",
      series: { temperature: "#123456" },
      cursor: "#abcdef",
    });
    expect(theme.series.temperature).toBe("#123456");
    expect(theme.series.wind_speed).toBe(DARK_THEME.series.wind_speed);
    expect(theme.cursor).toBe("#abcdef");
    expect(theme.background).toBe(DARK_THEME.background);
    expect(resolveMeteogramTheme({ grid: { line: "#000000" } }).grid).toEqual({
      ...LIGHT_THEME.grid,
      line: "#000000",
    });
  });

  it("draws with overridden tokens", () => {
    const markup = meteogramToSvgString(powerInput, {
      ...powerOptions,
      theme: { series: { temperature: "#123456" }, modelHeader: { background: "#654321" } },
    });
    expect(markup).toMatch(/stroke="#123456"[^>]*data-testid="temperature-path"/);
    expect(markup).toMatch(/fill="#654321"[^>]*data-testid="model-header-shape"/);
    expect(markup).not.toContain('fill="#f59e0b" data-testid="model-header-shape"');
  });

  it("orders series colours: layout, theme, registry, fallback", () => {
    expect(getSeriesColor("temperature", "#111111")).toBe("#111111");
    expect(getSeriesColor("temperature", null)).toBe(LIGHT_THEME.series.temperature);
    expect(getSeriesColor("temperature", null, undefined, DARK_THEME)).toBe(
      DARK_THEME.series.temperature,
    );
    expect(getSeriesColor("cloud_cover", null)).toBe("#64748b");
    expect(getSeriesColor("unknown", null, undefined, DARK_THEME)).toBe(DARK_THEME.seriesFallback);
  });

  it("paints the background only on request", () => {
    expect(meteogramToSvgString(powerInput, powerOptions)).not.toContain("meteogram-background");
    const scene = createMeteogramScene(powerInput, {
      ...powerOptions,
      theme: "dark",
      background: true,
    });
    const [rect] = byTestId(renderMeteogramSvg(scene), "meteogram-background");
    expect(rect!.attrs.fill).toBe(DARK_THEME.background);
    expect(rect!.attrs.height).toBe(scene.geometry.totalHeight);
  });

  it("draws snow in the background colour in both themes, dark included (REQ-486)", () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      expect(theme.snow.fill).toBe(theme.background);
      expect(theme.series.snowfall).toBe(theme.background);
      expect(theme.series.snowfall_with_rain).toBe(theme.background);
      // The outline keeps the bars visible.
      expect(theme.snow.outline).not.toBe(theme.background);
    }
    const scene = createMeteogramScene(powerInput, { ...powerOptions, theme: "dark" });
    const bars = byTestId(renderStaticLayer(scene), "precip-bar");
    const snowBars = bars.filter((bar) => bar.attrs.stroke === DARK_THEME.snow.outline);
    expect(snowBars.length).toBeGreaterThan(0);
    expect(snowBars.every((bar) => bar.attrs.fill === DARK_THEME.background)).toBe(true);
    // Snowfall bars of their own take the series colour, also the background.
    const layout = {
      ...BUILTIN_LAYOUTS.find((item) => item.id === "power-default")!,
      areas: [{ id: "snow", series: [{ quantity: "snowfall", style: "bars" as const }] }],
    } as ChartLayout;
    const snowfall = createMeteogramScene(powerInput, { ...powerOptions, theme: "dark", layout });
    const snowfallBars = byTestId(renderStaticLayer(snowfall), "snowfall-bar");
    expect(snowfallBars.length).toBeGreaterThan(0);
    expect(snowfallBars.every((bar) => bar.attrs.fill === DARK_THEME.background)).toBe(true);
    expect(snowfallBars.every((bar) => bar.attrs.stroke === DARK_THEME.snow.outline)).toBe(true);
  });

  it("lets snow follow an overridden background unless set itself", () => {
    const card = resolveMeteogramTheme({ base: "dark", background: "#1a2129" });
    expect(card.snow).toEqual({ fill: "#1a2129", outline: DARK_THEME.snow.outline });
    expect(card.series.snowfall).toBe("#1a2129");
    expect(card.series.snowfall_with_rain).toBe("#1a2129");
    expect(card.series.temperature).toBe(DARK_THEME.series.temperature);
    // The built-in themes stay as they are.
    expect(DARK_THEME.snow.fill).toBe("#0f172a");
    expect(DARK_THEME.series.snowfall).toBe("#0f172a");
    const own = resolveMeteogramTheme({
      base: "dark",
      background: "#1a2129",
      snow: { fill: "#ff0000" },
      series: { snowfall: "#00ff00" },
    });
    expect(own.snow.fill).toBe("#ff0000");
    expect(own.series.snowfall).toBe("#00ff00");
    expect(own.series.snowfall_with_rain).toBe("#1a2129");
    expect(resolveMeteogramTheme({ background: "#fafafa" }).snow.fill).toBe("#fafafa");

    const scene = createMeteogramScene(powerInput, {
      ...powerOptions,
      theme: { base: "dark", background: "#1a2129" },
    });
    const snowBars = byTestId(renderStaticLayer(scene), "precip-bar").filter(
      (bar) => bar.attrs.stroke === DARK_THEME.snow.outline,
    );
    expect(snowBars.length).toBeGreaterThan(0);
    expect(snowBars.every((bar) => bar.attrs.fill === "#1a2129")).toBe(true);
  });

  it("takes font sizes from the theme", () => {
    const scene = createMeteogramScene(powerInput, {
      ...powerOptions,
      theme: { fontSizes: { ...LIGHT_THEME.fontSizes, axis: 12, terrain: 6 } },
    });
    const layer = renderStaticLayer(scene);
    expect(byTestId(layer, "terrain-mask-label")[0]!.attrs["font-size"]).toBe(6);
    const axisMax = findAll(layer, (node) => node.key === "axis-max");
    expect(axisMax.length).toBeGreaterThan(0);
    expect(axisMax.every((node) => node.attrs["font-size"] === 12)).toBe(true);
  });

  describe("elevation label in one colour (REQ-510)", () => {
    const highInput: MeteogramInput = {
      ...powerInput,
      location: { ...powerInput.location!, elevation: 3158 },
    };

    for (const [base, background] of [
      ["light", "#ffffff"],
      ["dark", "#1a2129"],
    ] as const) {
      it(`theme ${base}: one text, drawn after the cloud profile and the series, halo in the background colour`, () => {
        const scene = createMeteogramScene(highInput, {
          ...powerOptions,
          theme: { base, background },
        });
        const layer = renderStaticLayer(scene);
        const labels = byTestId(layer, "terrain-mask-label");
        expect(labels).toHaveLength(1);
        const label = labels[0]!;
        expect(textContent(label)).toBe("3158 m");
        const theme = base === "light" ? LIGHT_THEME : DARK_THEME;
        expect(label.attrs.fill).toBe(theme.terrain.label);
        // REQ-747: the halo is its own element right before the label.
        const halo = haloOf(layer, label)!;
        expect(halo.attrs.stroke).toBe(background);
        expect(halo.attrs.fill).toBe("none");
        expect(label.attrs.stroke).toBeUndefined();

        // Nothing is painted over the label: it is the last child of the static layer.
        const children = layer.children.filter((child): child is VNode => typeof child === "object");
        const last = children[children.length - 1]!;
        expect(findAll(last, (node) => node === label)).toHaveLength(1);
        // The cloud cells come before it.
        const order = findAll(
          layer,
          (node) => node === label || node.attrs["data-testid"] === "vertical-cloud-cell",
        );
        expect(order.length).toBeGreaterThan(1);
        expect(order[order.length - 1]).toBe(label);
        // The terrain line is drawn with it, above the cloud cells and their grey columns without data (REQ-569); the
        // ground fill below it stays below the areas.
        const line = byTestId(last, "terrain-line");
        expect(line).toHaveLength(1);
        expect(line[0]!.attrs["stroke-dasharray"]).toBe("3 2");
        const mask = byTestId(layer, "terrain-mask")[0]!;
        expect(byTestId(mask, "terrain-mask-label")).toHaveLength(0);
        expect(byTestId(mask, "terrain-line")).toHaveLength(0);
      });
    }
  });

  it("theme colours reach the detail rows", () => {
    const rows = buildFullscreenDetailRows({
      hoverTimestamp: Date.UTC(2026, 0, 12, 12),
      hoverData: null,
      accumulatedPrecip: null,
      resolvedTimezone: "UTC",
      theme: DARK_THEME,
    }).flat();
    expect(rows.find((item) => item.testId === "fullscreen-detail-temp")!.color).toBe(
      DARK_THEME.details.temperature,
    );
  });
});

describe("paired curves: gusts and apparent temperature (REQ-442)", () => {
  const PAIRS = [
    { first: "temperature", second: "apparent_temperature", firstPath: "temperature-path", secondPath: "apparent-temperature-path" },
    { first: "wind_speed", second: "wind_gusts", firstPath: "wind-speed-path", secondPath: "wind-gusts-path" },
  ] as const;
  const renderWith = (options: Partial<typeof powerOptions> = {}) =>
    renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, ...options }));
  const pathOf = (layer: VNode, testId: string) => {
    const [path] = byTestId(layer, testId);
    expect(path, testId).toBeDefined();
    return path!;
  };

  for (const name of THEMES) {
    const theme = name === "light" ? LIGHT_THEME : DARK_THEME;

    it(`theme ${name}: the second curve of a pair has the colour of the first`, () => {
      for (const { first, second } of PAIRS) {
        expect(theme.series[second]).toBe(theme.series[first]);
        expect(theme.details[second]).toBe(theme.details[first]);
        expect(getSeriesColor(second, null, undefined, theme)).toBe(getSeriesColor(first, null, undefined, theme));
      }
    });

    it(`theme ${name}: the second curve is drawn dashed, the first solid`, () => {
      const layer = renderWith({ theme: name });
      for (const { firstPath, secondPath } of PAIRS) {
        const solid = pathOf(layer, firstPath);
        const dashed = pathOf(layer, secondPath);
        expect(dashed.attrs.stroke).toBe(solid.attrs.stroke);
        expect(solid.attrs["stroke-dasharray"]).toBeUndefined();
        expect(dashed.attrs["stroke-dasharray"]).toBe(PAIRED_SERIES_DASH_ARRAY);
        // Round caps would fill the gaps of the fine dash.
        expect(dashed.attrs["stroke-linecap"]).toBeUndefined();
      }
      expect(pathOf(layer, "wind-gusts-stops-path").attrs.stroke).toBe(theme.series.wind_speed);
    });

    it(`theme ${name}: detail rows show the colour of the pair and mark the second dashed`, () => {
      const rows = buildFullscreenDetailRows({
        hoverTimestamp: Date.UTC(2026, 0, 12, 12),
        hoverData: null,
        accumulatedPrecip: null,
        resolvedTimezone: "UTC",
        theme,
      }).flat();
      const item = (testId: string) => rows.find((entry) => entry.testId === testId)!;
      for (const [first, second] of [
        ["fullscreen-detail-temp", "fullscreen-detail-apparent-temp"],
        ["fullscreen-detail-wind", "fullscreen-detail-gusts"],
      ] as const) {
        expect(item(second).color).toBe(item(first).color);
        expect(item(second).dashed).toBe(true);
        expect(item(first).dashed).toBeUndefined();
      }
    });
  }

  it("draws the model boundaries as thin solid lines in the theme colour (REQ-524)", () => {
    const layer = renderWith({ theme: { base: "light", modelHeader: { boundary: "#1f6fd1", boundaryOpacity: 0.6 } } });
    const [boundary] = byTestId(layer, "model-boundary-line");
    expect(boundary).toBeDefined();
    expect(boundary!.attrs["stroke"]).toBe("#1f6fd1");
    expect(boundary!.attrs["stroke-width"]).toBe("1");
    expect(boundary!.attrs["opacity"]).toBe("0.6");
    expect(boundary!.attrs["stroke-dasharray"]).toBeUndefined();
  });

  it("draws the cloud-chain boundaries only with showCloudBoundaries (REQ-524)", () => {
    expect(byTestId(renderWith(), "cloud-model-boundary-line")).toHaveLength(0);
    const [line] = byTestId(renderWith({ showCloudBoundaries: true }), "cloud-model-boundary-line");
    expect(line).toBeDefined();
    expect(line!.attrs["stroke"]).toBe(LIGHT_THEME.cloud.boundary);
    expect(line!.attrs["stroke-width"]).toBe("1");
    expect(line!.attrs["stroke-dasharray"]).toBeUndefined();
  });

  it("layouts still override colour and dash per curve", () => {
    const layout = powerLayout();
    const seriesOf = (quantity: string) =>
      layout.areas.flatMap((area) => area.series ?? []).find((series) => series.quantity === quantity)!;
    Object.assign(seriesOf("wind_gusts"), { color: "#123456", dashed: false });
    Object.assign(seriesOf("apparent_temperature"), { color: "#654321" });
    Object.assign(seriesOf("temperature"), { dashed: true });
    const layer = renderWith({ layout });
    const gusts = pathOf(layer, "wind-gusts-path");
    expect(gusts.attrs.stroke).toBe("#123456");
    expect(gusts.attrs["stroke-dasharray"]).toBeUndefined();
    const apparent = pathOf(layer, "apparent-temperature-path");
    expect(apparent.attrs.stroke).toBe("#654321");
    expect(apparent.attrs["stroke-dasharray"]).toBe(PAIRED_SERIES_DASH_ARRAY);
    expect(pathOf(layer, "temperature-path").attrs["stroke-dasharray"]).toBe(DEFAULT_SERIES_DASH_ARRAY);
    expect(getSeriesDashArray("wind_gusts", false)).toBeUndefined();
    expect(getSeriesDashArray("wind_gusts", null)).toBe(PAIRED_SERIES_DASH_ARRAY);
    expect(getSeriesDashArray("wind_speed", null)).toBeUndefined();
  });

  it("theme overrides still set the colour of a paired curve", () => {
    const layer = renderWith({ theme: { base: "dark", series: { wind_gusts: "#abcdef" } } });
    expect(pathOf(layer, "wind-gusts-path").attrs.stroke).toBe("#abcdef");
    expect(pathOf(layer, "wind-speed-path").attrs.stroke).toBe(DARK_THEME.series.wind_speed);
  });
});

describe("switchable parts of the layout", () => {
  const render = (layout: ChartLayout) =>
    renderStaticLayer(createMeteogramScene(powerInput, { ...powerOptions, layout }));

  it("model headers and boundaries", () => {
    const shown = render(powerLayout());
    expect(byTestId(shown, "model-label-segment").length).toBeGreaterThan(0);
    expect(byTestId(shown, "model-boundary-line").length).toBeGreaterThan(0);
    const hidden = render({ ...powerLayout(), showModelHeaders: false });
    expect(byTestId(hidden, "model-label-segment")).toHaveLength(0);
    expect(byTestId(hidden, "model-boundary-line")).toHaveLength(0);
  });

  it("drawing areas", () => {
    const areaIds = (layer: VNode) =>
      findAll(layer, (node) => node.attrs["data-area-id"] !== undefined).map(
        (node) => node.attrs["data-area-id"],
      );
    expect(areaIds(render(powerLayout()))).toEqual(["temp", "precip", "wind", "convective"]);
    const layout = powerLayout();
    layout.areas.find((area) => area.id === "wind")!.enabled = false;
    layout.areas.find((area) => area.id === "convective")!.enabled = false;
    expect(areaIds(render(layout))).toEqual(["temp", "precip"]);
  });

  it("day header and daylight", () => {
    const layer = render({ ...powerLayout(), showDayHeader: false, showDaylight: false });
    expect(byTestId(layer, "day-label-cell")).toHaveLength(0);
    expect(byTestId(layer, "daylight-stripe")).toHaveLength(0);
    expect(byTestId(render(powerLayout()), "daylight-stripe").length).toBeGreaterThan(0);
  });

  it("axis labels", () => {
    const labelsOf = (layer: VNode, areaId: string) => {
      const [panel] = findAll(layer, (node) => node.attrs["data-area-id"] === areaId);
      return findAll(panel!, (node) => node.tag === "text").map(textContent);
    };
    expect(labelsOf(render(powerLayout()), "temp").length).toBeGreaterThan(0);
    const layout = powerLayout();
    const temp = layout.areas.find((area) => area.id === "temp")!;
    temp.axes!.left!.showLabels = false;
    temp.sunTimes = false;
    temp.series = temp.series!.map((series) => ({ ...series, extremeLabels: false }));
    expect(labelsOf(render(layout), "temp")).toEqual([]);

    const withRight = powerLayout();
    const convective = withRight.areas.find((area) => area.id === "convective")!;
    expect(labelsOf(render(withRight), "convective")).toEqual(
      expect.arrayContaining(["CAPE", "LPI", "30 J/kg"]),
    );
    convective.axes!.right!.showLabels = false;
    const labels = labelsOf(render(withRight), "convective");
    expect(labels).toContain("CAPE");
    expect(labels).not.toContain("LPI");
    expect(labels).not.toContain("30 J/kg");
  });
});

describe("locale, texts and font family", () => {
  it("writes weekday names in the locale", () => {
    const english = renderStaticLayer(createMeteogramScene(powerInput, powerOptions));
    const german = renderStaticLayer(
      createMeteogramScene(powerInput, { ...powerOptions, locale: "de-DE" }),
    );
    const dayLabels = (layer: VNode) =>
      findAll(layer, (node) => node.tag === "text" && node.attrs["font-weight"] === "700")
        .map(textContent)
        .filter((text) => /\d+\.\d+$/.test(text));
    expect(dayLabels(english).some((text) => text.startsWith("Fri "))).toBe(true);
    // Without a period after the weekday, whatever the ICU data of the runtime write (REQ-668).
    expect(dayLabels(german).some((text) => /^Fr 16\.10$/.test(text))).toBe(true);
    expect(groupTimestampsByDay([Date.UTC(2026, 0, 12, 12)], "UTC", "fr-FR")[0]!.weekdayLabel).toBe(
      "lun",
    );
  });

  it("formats dates of the detail rows and the tooltip in the locale", () => {
    const date = new Date(Date.UTC(2026, 8, 16, 12));
    expect(formatTooltipHeaderDate(date, "UTC")).toBe("Wed, 9/16");
    expect(formatTooltipHeaderDate(date, "UTC", "de-DE")).toBe("Mi., 16.9.");
    const rows = buildFullscreenDetailRows({
      hoverTimestamp: date.getTime(),
      hoverData: null,
      accumulatedPrecip: null,
      resolvedTimezone: "UTC",
      locale: "de-DE",
      texts: { time: "Zeit", temperature: "Temperatur" },
    }).flat();
    const time = rows.find((item) => item.testId === "fullscreen-detail-time")!;
    expect(time.label).toBe("Zeit");
    expect(time.value).toBe("Mi., 16.9. — 12:00");
    expect(rows.find((item) => item.testId === "fullscreen-detail-temp")!.label).toBe("Temperatur");
    expect(rows.find((item) => item.testId === "fullscreen-detail-gusts")!.label).toBe("Gusts");
  });

  it("formats the location label in the locale", () => {
    const scene = createMeteogramScene(powerInput, { ...powerOptions, locale: "de-DE" });
    expect(scene.locale).toBe("de-DE");
    expect(scene.locationLabel).toMatch(/\(\d\d\.\d\d\.\d\d, \d\d:\d\d\)$/);
    expect(createMeteogramScene(powerInput, powerOptions).locale).toBe("en-US");
  });

  it("replaces the empty-state text", () => {
    const empty = { ...powerInput, series: [], timeline: undefined };
    expect(meteogramToSvgString(empty, powerOptions)).toContain(DEFAULT_TEXTS.emptyState);
    const markup = meteogramToSvgString(empty, {
      ...powerOptions,
      texts: { emptyState: "Keine Vorhersagedaten." },
      theme: "dark",
    });
    expect(markup).toContain("Keine Vorhersagedaten.");
    expect(markup).toContain(`fill="${DARK_THEME.emptyState}"`);
    expect(resolveMeteogramTexts({ cape: "KE" }).cin).toBe("CIN");
  });

  it("sets the font family on the SVG when given", () => {
    expect(meteogramToSvgString(powerInput, powerOptions)).not.toContain("font-family");
    const markup = meteogramToSvgString(powerInput, {
      ...powerOptions,
      fontFamily: "Inter, sans-serif",
    });
    expect(markup).toMatch(/^<svg [^>]*font-family="Inter, sans-serif"/);
  });
});
