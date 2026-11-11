// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Embedded chart on a phone in portrait (REQ-554, REQ-583, REQ-585, REQ-741): 4.5 days on the screen, starting at the
 * first selected day (with all days yesterday), at the fixed scale of the full forecast whatever the selection and
 * however many days are loaded. The room above
 * its model headers, which it gives back to the gap below the day slider (REQ-615).
 */
import { METEOGRAM_VIEWBOX_WIDTH, MODEL_HEADER_BOX_OFFSET } from "@graupel/meteogram";
import { describe, expect, it } from "vitest";
import {
  chartTopRoom,
  PORTRAIT_DAYS_ON_SCREEN,
  PORTRAIT_REFERENCE_DAYS,
  portraitChart,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "../src/regions/MeteogramPanel/layout.ts";

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 29);
/** All 18 days of the slider, the first one yesterday. */
const WHOLE = { start: START, end: START + 18 * DAY };
const days = (from: number, to: number) => ({ start: START + from * DAY, end: START + to * DAY });

/** Screen width and viewBox height (any: the chart scales uniformly with its width). */
const SCREEN = 375;
const VIEWBOX_HEIGHT = 640;

/** Size of the chart on the screen, the days it shows per screen width and its scale (CSS px per viewBox unit). */
function onScreen(range: { start: number; end: number }) {
  const { widthFactor, viewBoxWidth } = portraitChart(range);
  const width = SCREEN * widthFactor;
  const scale = width / viewBoxWidth;
  return {
    width,
    height: VIEWBOX_HEIGHT * scale,
    scale,
    daysPerScreen: ((range.end - range.start) / DAY) * (SCREEN / width),
  };
}

describe("portraitChart (REQ-554, REQ-583, REQ-585, REQ-741)", () => {
  /** viewBox width of the full forecast's scale for a chart `screens` screen widths wide. */
  const atReference = (screens: number) => (METEOGRAM_VIEWBOX_WIDTH * screens * 4.5) / PORTRAIT_REFERENCE_DAYS;

  it("is as wide as 4.5 days per screen width and starts at the first day with all days", () => {
    expect(PORTRAIT_DAYS_ON_SCREEN).toBe(4.5);
    expect(PORTRAIT_REFERENCE_DAYS).toBe(17);
    // All 18 days: only a width, no scroll offset, so the chart starts at its left edge.
    const all = portraitChart(WHOLE);
    expect(all.widthFactor).toBe(4);
    expect(all.viewBoxWidth).toBeCloseTo(atReference(4), 9);
    // The full forecast of 17 days: the default viewBox.
    expect(portraitChart(days(0, 17)).viewBoxWidth).toBeCloseTo(METEOGRAM_VIEWBOX_WIDTH, 9);
  });

  it("follows the selected time range and starts at its first day", () => {
    // From today (day 1) on, and a selection further on: the chart starts at the first selected day.
    expect(portraitChart(days(1, 10)).widthFactor).toBe(2);
    expect(portraitChart(days(5, 14)).viewBoxWidth).toBeCloseTo(atReference(2), 9);
  });

  it("is at least the screen's width", () => {
    expect(portraitChart(days(0, 3)).widthFactor).toBe(1);
    expect(portraitChart(days(2, 3)).viewBoxWidth).toBeCloseTo(atReference(1), 9);
  });

  it("keeps the height and scale of the full forecast with 7 days and with fewer than 4.5 days (REQ-585)", () => {
    const all = onScreen(WHOLE);
    const week = onScreen(days(1, 8));
    const two = onScreen(days(2, 4));
    expect(all).toMatchObject({ width: 4 * SCREEN, daysPerScreen: 4.5 });

    // 7 days: narrower, still 4.5 days per screen width, as high and at the same scale.
    expect(week.width).toBeCloseTo((7 / 4.5) * SCREEN, 6);
    expect(week.daysPerScreen).toBeCloseTo(4.5, 6);
    expect(week.height).toBeCloseTo(all.height, 6);
    expect(week.scale).toBeCloseTo(all.scale, 6);

    // 2 days: the screen's width, wider days, as high and at the same scale.
    expect(two.width).toBe(SCREEN);
    expect(two.daysPerScreen).toBe(2);
    expect(two.height).toBeCloseTo(all.height, 6);
    expect(two.scale).toBeCloseTo(all.scale, 6);
  });

  it("keeps the scale of the full forecast however many days are loaded (REQ-741)", () => {
    // The full forecast: 17 days on 17 / 4.5 screen widths, drawn into the default viewBox.
    const full = onScreen(days(0, 17)).scale;
    expect(full).toBeCloseTo((SCREEN * 17) / 4.5 / METEOGRAM_VIEWBOX_WIDTH, 6);
    // Only one model with 4 days, 9 days without the long-range model, the full 17 and 18 days, and selections in
    // them: the same scale, so the chart is as high and its text as large.
    for (const loaded of [4, 9, 17, 18]) {
      for (const [from, to] of [
        [0, loaded],
        [1, Math.min(loaded, 3)],
        [0, Math.min(loaded, 7)],
      ] as const) {
        expect(onScreen(days(from, to)).scale, `${loaded} days loaded, ${from}–${to}`).toBeCloseTo(full, 6);
      }
    }
  });
});

describe("chartTopRoom (REQ-615)", () => {
  it("is the room above the model headers as a share of the chart's width, nothing without them", () => {
    for (const backgroundHasData of [false, true]) {
      const headed = { forceModelHeaders: true, backgroundHasData };
      expect(chartTopRoom(WEB_LAYOUT, headed)).toBeCloseTo(MODEL_HEADER_BOX_OFFSET / METEOGRAM_VIEWBOX_WIDTH, 9);
      // Model headers switched off: the day row starts at the chart's top edge.
      expect(chartTopRoom(WEB_LAYOUT_WITHOUT_HEADERS, { forceModelHeaders: false, backgroundHasData })).toBe(0);
    }
  });

  it("keeps its height on the screen on a phone in portrait, whatever the selection (as REQ-585)", () => {
    const headed = { forceModelHeaders: true, backgroundHasData: false };
    for (const range of [WHOLE, days(1, 8), days(2, 4)]) {
      const chart = portraitChart(range);
      // CSS px on the screen: the share of the chart's width times its width.
      const room = chartTopRoom(WEB_LAYOUT, headed, chart.viewBoxWidth) * SCREEN * chart.widthFactor;
      expect(room).toBeCloseTo(MODEL_HEADER_BOX_OFFSET * onScreen(WHOLE).scale, 6);
    }
  });
});
