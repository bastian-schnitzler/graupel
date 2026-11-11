// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The sunrise time of the first day with the website's chart options (REQ-723, from @graupel/meteogram MET-S14,
 * REQ-734): with the narrow page's compact labels over the plot (phone upright, REQ-694) a sunrise time that would
 * stand over the temperature's maximum in the upper left corner starts at its line instead, right of the maximum,
 * which keeps its corner 1 px below the area's top; the picture (labels beside the plot) keeps every sunrise time
 * centred. The chart is drawn as SVG markup from a 16-day forecast with a sunrise at 07:35 and a sunset at 16:50 UTC.
 */
import { describe, expect, it } from "vitest";
import { toMeteogramInput } from "@graupel/download";
import {
  meteogramToSvgString,
  type MeteogramSvgOptions,
} from "@graupel/meteogram";
import {
  imageRenderOptions,
  meteogramToggles,
  NARROW_CHART_OPTIONS,
  narrowAxisLabels,
  scaleLayoutAreas,
  WEB_LAYOUT,
} from "../src/regions/MeteogramPanel/layout.ts";
import { forecastFixture } from "./forecastFixture.ts";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 10, 9);
const DAYS = 16;

/** The fixture over 16 days from Monday, 9 November 2026, with sun times on every day. */
function input() {
  const result = forecastFixture({
    start: new Date(START).toISOString(),
    now: new Date(START + DAY_MS + 11 * 3_600_000).toISOString(),
    end: new Date(START + DAYS * DAY_MS).toISOString(),
    timezone: "UTC",
  });
  result.sunPhases = Array.from({ length: DAYS }, (_, i) => {
    const day = new Date(START + i * DAY_MS).toISOString().slice(0, 10);
    return { day, sunrise: `${day}T07:35:00Z`, sunset: `${day}T16:50:00Z` };
  });
  return toMeteogramInput(result);
}

/** The temperature area's sunrise times and left labels of the SVG `markup`, in viewBox units. */
function temperature(markup: string) {
  const svg = new DOMParser().parseFromString(
    markup,
    "image/svg+xml",
  ).documentElement;
  const panel = svg.querySelector('g[data-area-id="temp"]')!;
  const clip = panel.querySelector(":scope > defs > clipPath > rect")!;
  const texts = (selector: string) =>
    [...panel.querySelectorAll(selector)].map((text) => ({
      text: text.textContent ?? "",
      x: Number(text.getAttribute("x")),
      y: Number(text.getAttribute("y")),
      fontSize: Number(text.getAttribute("font-size")),
      anchor: text.getAttribute("text-anchor"),
      day: text.getAttribute("data-day"),
    }));
  // A label with a halo stands in a group after its stroked copy (REQ-746).
  const left = texts(":scope > text, :scope > g.label-halo > text:not([data-halo])").filter((text) =>
    /°$/.test(text.text),
  );
  return {
    top: Number(clip.getAttribute("y")),
    sunrises: texts('[data-testid="sunrise"]').sort((a, b) =>
      (a.day ?? "").localeCompare(b.day ?? ""),
    ),
    max: left.sort((a, b) => a.y - b.y)[0]!,
  };
}

/** Estimated width of a text (viewBox units): about 0.6 of the font size per character, as the library estimates. */
const width = (text: { text: string; fontSize: number }) =>
  text.text.length * text.fontSize * 0.6;

describe("sunrise time of the first day with the website's options (REQ-723)", () => {
  it("compact labels over the plot: it starts right of the maximum, which keeps its corner", () => {
    const options: MeteogramSvgOptions = {
      layout: scaleLayoutAreas(WEB_LAYOUT, 0.5),
      forceModelHeaders: true,
      ...NARROW_CHART_OPTIONS,
      axisLabels: narrowAxisLabels(true),
    };
    const { top, sunrises, max } = temperature(
      meteogramToSvgString(input(), options),
    );
    expect(max.anchor).toBe("start");
    // The top of the maximum's digits 1 unit (1 px at scale 1) below the area's top (REQ-694).
    expect(max.y - 0.72 * max.fontSize).toBeCloseTo(top + 1, 1);
    const [first, ...others] = sunrises;
    expect(first!.anchor).toBe("start");
    expect(first!.x).toBeGreaterThan(max.x + width(max));
    // The other sunrise time (the chart writes them on its first and last day) stays centred over its line.
    expect(others.length).toBeGreaterThan(0);
    for (const sunrise of others)
      expect(sunrise.anchor, sunrise.day ?? "").toBe("middle");
  });

  it("the picture with its labels beside the plot keeps every sunrise time centred", () => {
    const { sunrises, max } = temperature(
      meteogramToSvgString(
        input(),
        imageRenderOptions(true, meteogramToggles("off", "off", true)),
      ),
    );
    expect(max.anchor).toBe("end");
    expect(sunrises.length).toBeGreaterThan(1);
    for (const sunrise of sunrises)
      expect(sunrise.anchor, sunrise.day ?? "").toBe("middle");
    expect(sunrises[0]!.x - width(sunrises[0]!) / 2).toBeGreaterThan(max.x);
  });
});
