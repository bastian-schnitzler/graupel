// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Renderer in Node, without a DOM: SVG snapshots per fixture and the
 * structure of the static and overlay layers.
 */
import { describe, expect, it } from "vitest";
import { canonicalTimestamp } from "../src/core/timeline";
import {
  EMPTY_STATE_TEXT,
  meteogramToSvgString,
  renderMeteogramSvg,
  renderOverlayLayer,
  renderStaticLayer,
} from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { toSvgString } from "../src/render/svgString";
import { findAll, textContent, type VNode } from "../src/render/vnode";
import { FIXTURES, powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const byTestId = (root: VNode, testId: string) =>
  findAll(root, (node) => node.attrs["data-testid"] === testId);

describe("renderer without a DOM", () => {
  it("runs in Node", () => {
    expect(typeof document).toBe("undefined");
    expect(meteogramToSvgString(powerInput, powerOptions)).toMatch(/^<svg xmlns=/);
  });

  for (const [name, { input, options }] of Object.entries(FIXTURES)) {
    it(`matches the SVG snapshot of fixture ${name}`, async () => {
      await expect(
        meteogramToSvgString(input, { ...options, xmlDeclaration: true }),
      ).toMatchFileSnapshot(`./__snapshots__/${name}.svg`);
    });
  }
});

describe("layers", () => {
  const scene = createMeteogramScene(powerInput, powerOptions);

  it("puts the static layer first and the overlay on top", () => {
    const svg = renderMeteogramSvg(scene);
    expect(svg.tag).toBe("svg");
    expect(svg.attrs.viewBox).toBe(`0 0 1000 ${scene.geometry.totalHeight}`);
    expect(svg.children.map((child) => (child as VNode).attrs["data-layer"])).toEqual([
      "static",
      "overlay",
    ]);
  });

  it("draws the current-time line in the overlay without hover", () => {
    const overlay = renderOverlayLayer(scene);
    const [line] = byTestId(overlay, "current-time-cursor-line");
    expect(line!.attrs.x1).toBe(scene.currentTimeX);
    expect(line!.attrs["data-timestamp"]).toBe(canonicalTimestamp(powerOptions.now!));
    expect(byTestId(renderStaticLayer(scene), "current-time-cursor-line")).toHaveLength(0);
  });

  it("draws the hover cursor instead of the current-time line", () => {
    const time = Date.UTC(2026, 9, 16, 12, 30);
    const timestamp = Date.UTC(2026, 9, 16, 12);
    const overlay = renderOverlayLayer(scene, { time, timestamp });
    expect(byTestId(overlay, "current-time-cursor-line")).toHaveLength(0);
    const [line] = byTestId(overlay, "hover-cursor-line");
    expect(line!.attrs.x1).toBe(scene.getX(time));
    expect(line!.attrs.y1).toBe(scene.geometry.dayHeaderTop);
    expect(line!.attrs.y2).toBe(scene.geometry.plotBottom);
    expect(line!.attrs["data-timestamp"]).toBe(canonicalTimestamp(timestamp));
    expect(line!.attrs["data-hover-time"]).toBe(canonicalTimestamp(time));
  });

  it("keeps the static layer independent of the hover", () => {
    const hovered = renderMeteogramSvg(scene, { hover: { time: Date.UTC(2026, 9, 16, 3) } });
    expect(hovered.children[0]).toEqual(renderStaticLayer(scene));
  });

  it("leaves the overlay empty when now lies outside the visible range", () => {
    const later = createMeteogramScene(powerInput, { ...powerOptions, now: Date.UTC(2027, 0, 1) });
    expect(renderOverlayLayer(later).children).toHaveLength(0);
  });
});

describe("static layer", () => {
  it("shows only the run in split headers too narrow for name and run (REQ-515)", () => {
    const narrow = createMeteogramScene(powerInput, { ...powerOptions, size: { width: 200, height: 400 } });
    const labels = byTestId(renderStaticLayer(narrow), "model-header-label");
    expect(labels.map(textContent)).toEqual(["15 Z00", "15 Z03", "EU"]);
    expect(labels.map((node) => node.attrs["data-run-only"])).toEqual(["true", "true", undefined]);
  });

  it("draws model headers per run, areas in layout order and the time grid", () => {
    const scene = createMeteogramScene(powerInput, powerOptions);
    const layer = renderStaticLayer(scene);
    expect(byTestId(layer, "model-header-label").map(textContent)).toEqual([
      "D2 (15 Z00)",
      "D2 (15 Z03)",
      "EU",
    ]);
    expect(
      findAll(layer, (node) => node.attrs["data-area-id"] !== undefined).map(
        (node) => node.attrs["data-area-id"],
      ),
    ).toEqual(["temp", "precip", "wind", "convective"]);
    expect(byTestId(layer, "day-label-cell")).toHaveLength(4);
    expect(byTestId(layer, "thunderstorm-icon").map((node) => node.attrs["data-weather-code"])).toEqual([
      95, 96, 99,
    ]);
    expect(byTestId(layer, "terrain-mask-label").map(textContent)).toEqual(["1200 m"]);
  });

  it("uses the id prefix and the render mode in clip and gradient ids", () => {
    const markup = meteogramToSvgString(powerInput, {
      ...powerOptions,
      idPrefix: "chart7",
      mode: "fullscreen",
    });
    expect(markup).toContain('id="temperature-gradient-chart7-fullscreen"');
    expect(markup).toContain('id="temperature-clip-chart7-fullscreen"');
    expect(markup).toContain('clip-path="url(#wind-clip-chart7-fullscreen)"');
    expect(markup).toContain('data-render-mode="fullscreen"');
  });

  it("scales text and icons for a rendered size that stretches the viewBox", () => {
    const scene = createMeteogramScene(powerInput, {
      ...powerOptions,
      size: { width: 500, height: 574 },
    });
    expect(scene.pixelLayout.textScaleX).toBe(2);
    const [label] = byTestId(renderStaticLayer(scene), "terrain-mask-label");
    expect(label!.attrs.transform).toMatch(/scale\(2 1\)/);
  });

  it("draws the fallback layout and reports an invalid layout", () => {
    const scene = createMeteogramScene(powerInput, {
      ...powerOptions,
      layout: { id: "broken" },
      fallbackLayoutId: "normal-default",
    });
    expect(scene.layout.id).toBe("normal-default");
    expect(scene.layoutWarning).toMatch(/Invalid meteogram layout/);
    expect(byTestId(renderStaticLayer(scene), "panel-convective")).toHaveLength(0);
  });

  it("forces model headers on request", () => {
    const scene = createMeteogramScene(powerInput, {
      ...powerOptions,
      fallbackLayoutId: "normal-default",
      forceModelHeaders: true,
    });
    expect(byTestId(renderStaticLayer(scene), "model-label-segment")).toHaveLength(3);
  });

  it("draws the last model header up to the right edge when its series ends earlier (REQ-466)", () => {
    const [d2, eu] = powerInput.chain!;
    // ICON-EU ends 16 h before the end of the timeline.
    const scene = createMeteogramScene(
      { ...powerInput, chain: [d2!, { ...eu!, sliceEndHours: 50 }] },
      powerOptions,
    );
    const segments = byTestId(renderStaticLayer(scene), "model-label-segment");
    const last = segments[segments.length - 1]!;
    expect(last.attrs["data-model"]).toBe("ICON-EU");
    expect(last.attrs["data-end-x"]).toBe(scene.outerRightX);
    const [shape] = byTestId(last, "model-header-shape");
    expect(Number(shape!.attrs["data-x"]) + Number(shape!.attrs["data-width"])).toBe(scene.outerRightX);
    const [edge] = byTestId(renderStaticLayer(scene), "outer-right-day-separator-line");
    expect(edge!.attrs.x1).toBe(last.attrs["data-end-x"]);
  });

  it("leaves the last model header unchanged when the series reaches the edge", () => {
    const scene = createMeteogramScene(powerInput, powerOptions);
    const segments = byTestId(renderStaticLayer(scene), "model-label-segment");
    expect(segments[segments.length - 1]!.attrs["data-end-x"]).toBe(scene.outerRightX);
  });

  it("offers the location label text for the surrounding page", () => {
    const scene = createMeteogramScene(powerInput, powerOptions);
    expect(scene.locationLabel).toMatch(/^Testort, 1200 m \(.+\)$/);
    expect(createMeteogramScene(FIXTURES.normal.input, FIXTURES.normal.options).locationLabel).toMatch(
      /^33\.8688° S · 151\.2093° E/,
    );
  });
});

describe("empty state", () => {
  it("draws a message instead of the chart without data", () => {
    const input = { ...powerInput, series: [], timeline: {} };
    const scene = createMeteogramScene(input, powerOptions);
    expect(scene.available).toBe(false);
    const markup = toSvgString(renderMeteogramSvg(scene));
    expect(markup).toContain('data-testid="meteogram-empty-state"');
    expect(markup).toContain(EMPTY_STATE_TEXT);
  });
});
