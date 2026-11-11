// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Day header: the abbreviated weekday without a period in every language
 * (REQ-668) and day labels that never reach past their day (REQ-669).
 */
import { describe, expect, it } from "vitest";
import { buildFullscreenDetailRows } from "../src/core/details";
import type { DayGroupRenderItem } from "../src/core/drawingTypes";
import type { MeteogramInput } from "../src/core/input";
import { formatWeekdayShort } from "../src/core/texts";
import { formatTooltipHeaderDate } from "../src/core/tooltip";
import { meteogramToSvgString, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene, type MeteogramRenderOptions } from "../src/render/scene";
import {
  chooseDayLabel,
  DAY_LABEL_PADDING,
  estimateDayLabelWidth,
  timelineOverlay,
} from "../src/render/timelineOverlay";
import { findAll, h, textContent, type VNode } from "../src/render/vnode";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

const HOUR = 3_600_000;
const LOCALES = ["de", "en", "fr", "it", "nl", "cs", "da", "sl"];
// Monday 2026-11-02 to Sunday 2026-11-08, noon UTC.
const WEEK = Array.from({ length: 7 }, (_, day) => Date.UTC(2026, 10, 2 + day, 12));

const intlWeekday = (timestamp: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(timestamp);

const dayLabelNodes = (root: VNode) => findAll(root, (node) => node.attrs.class === "day-label-text");
const dayCells = (root: VNode) => findAll(root, (node) => node.attrs["data-testid"] === "day-label-cell");

describe("weekday in the day header without a period (REQ-668)", () => {
  it.each(LOCALES)("formatWeekdayShort drops only the period at the end (%s)", (locale) => {
    for (const timestamp of WEEK) {
      const weekday = formatWeekdayShort(timestamp, "UTC", locale);
      expect(weekday).not.toMatch(/\.$/);
      expect(weekday).toBe(intlWeekday(timestamp, locale).replace(/\.$/, ""));
    }
  });

  it("writes the examples of the request without a period", () => {
    // Thursday 2026-11-05, Tuesday 2026-11-03.
    expect(formatWeekdayShort(Date.UTC(2026, 10, 5, 12), "UTC", "sl")).toBe("čet");
    expect(formatWeekdayShort(Date.UTC(2026, 10, 3, 12), "UTC", "fr")).toBe("mar");
    expect(formatWeekdayShort(Date.UTC(2026, 10, 3, 12), "UTC", "da")).toBe("tirs");
    // Languages without a period stay as they are.
    expect(formatWeekdayShort(Date.UTC(2026, 10, 3, 12), "UTC", "it")).toBe("mar");
    expect(formatWeekdayShort(Date.UTC(2026, 10, 3, 12), "UTC", "en-US")).toBe("Tue");
  });

  it.each(LOCALES)("draws the day header without a period and with the date unchanged (%s)", (locale) => {
    const input: MeteogramInput = { ...powerInput, timezone: "UTC" };
    const layer = renderStaticLayer(createMeteogramScene(input, { ...powerOptions, locale }));
    const labels = dayLabelNodes(layer).map(textContent);
    // Thursday to Saturday, 15 to 17 October 2026, at full width.
    const days = [15, 16, 17];
    expect(labels).toEqual(
      days.map((day) => `${formatWeekdayShort(Date.UTC(2026, 9, day, 12), "UTC", locale)} ${day}.10`),
    );
    for (const label of labels) {
      expect(label).not.toMatch(/\. /);
      expect(label).toMatch(/ \d\d\.10$/);
    }
  });

  it("shortened forms are without a period as well", () => {
    const weekdayLabel = formatWeekdayShort(Date.UTC(2026, 10, 5, 12), "UTC", "sl");
    expect(chooseDayLabel({ blockWidth: 50, dateLabel: "05.11", weekdayLabel })?.text).toBe("čet 05");
    expect(chooseDayLabel({ blockWidth: 120, dateLabel: "05.11", weekdayLabel })?.text).toBe("čet 05.11");
  });

  it("the image (SVG) has no period after the weekday", () => {
    const input: MeteogramInput = { ...powerInput, timezone: "UTC" };
    const svg = meteogramToSvgString(input, { ...powerOptions, locale: "sl" });
    expect(svg).toContain(">čet 15.10<");
    expect(svg).not.toContain("čet.");
    expect(svg).not.toContain("pet.");
    expect(svg).not.toContain("sob.");
  });

  it.each(LOCALES)("keeps whole dates of the popup and the details as Intl writes them (%s)", (locale) => {
    const date = new Date(Date.UTC(2026, 10, 4, 12));
    const intlDate = date.toLocaleDateString(locale, {
      weekday: "short",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(formatTooltipHeaderDate(date, "UTC", locale)).toBe(intlDate);
    const time = buildFullscreenDetailRows({
      hoverTimestamp: date.getTime(),
      hoverData: null,
      accumulatedPrecip: null,
      resolvedTimezone: "UTC",
      locale,
    })
      .flat()
      .find((item) => item.testId === "fullscreen-detail-time")!;
    expect(time.value).toBe(`${intlDate} — 12:00`);
  });

  it("the popup date keeps the period of a whole date (fr)", () => {
    expect(formatTooltipHeaderDate(new Date(Date.UTC(2026, 10, 4, 12)), "UTC", "fr")).toMatch(/^mer\./);
  });
});

describe("day labels of narrow days (REQ-669)", () => {
  /** Every drawn label lies within its day, with the padding to each edge. */
  const expectLabelsInsideTheirDays = (root: VNode, textScaleX: number) => {
    const cells = dayCells(root);
    const cellOfLabel = (label: VNode) =>
      cells.find(
        (cell) => Math.abs(Number(cell.attrs.x) + Number(cell.attrs.width) / 2 - Number(label.attrs.x)) < 0.001,
      );
    for (const label of dayLabelNodes(root)) {
      const cell = cellOfLabel(label);
      expect(cell).toBeDefined();
      const left = Number(cell!.attrs.x);
      const right = left + Number(cell!.attrs.width);
      const half = estimateDayLabelWidth(textContent(label), Number(label.attrs["font-size"]), textScaleX) / 2;
      expect(Number(label.attrs.x) - half).toBeGreaterThanOrEqual(left + DAY_LABEL_PADDING - 0.001);
      expect(Number(label.attrs.x) + half).toBeLessThanOrEqual(right - DAY_LABEL_PADDING + 0.001);
    }
  };

  // 15 Oct 21:00 to 17 Oct 03:00 UTC: 3 hours of the first day, the whole second day, 3 hours of the last day.
  const input: MeteogramInput = { ...powerInput, timezone: "UTC" };
  const options = (width: number): MeteogramRenderOptions => ({
    ...powerOptions,
    visibleRange: { start: Date.UTC(2026, 9, 15, 21), end: Date.UTC(2026, 9, 17, 3) },
    size: { width, height: 574 },
  });

  it("a narrow first and last day (3 hours) have no label, the day of 24 hours keeps its label", () => {
    // 100 px wide: text is stretched tenfold, a 3-hour day is narrower than its day number.
    const scene = createMeteogramScene(input, options(100));
    const textScaleX = scene.pixelLayout.textScaleX ?? 1;
    expect(textScaleX).toBeGreaterThan(5);
    const layer = renderStaticLayer(scene);
    // Cells (and with them the tint and the separators) stay.
    expect(dayCells(layer).map((cell) => cell.attrs.width)).toEqual([90, 720, 90]);
    expect(findAll(layer, (node) => node.attrs["data-testid"] === "day-separator-line").length).toBeGreaterThan(0);
    const labels = dayLabelNodes(layer);
    expect(labels.map((label) => label.attrs["data-day"])).toEqual(["2026-10-16"]);
    expect(labels.map(textContent)).toEqual(["Fri 16.10"]);
    expectLabelsInsideTheirDays(layer, textScaleX);
    // Likewise in the image (SVG).
    const svg = meteogramToSvgString(input, options(100));
    expect(svg).not.toContain('data-day="2026-10-15"');
    expect(svg).not.toContain('data-day="2026-10-17"');
    expect(svg).toContain('data-day="2026-10-16"');
  });

  it("a narrow day whose number fits keeps its label within its day", () => {
    const scene = createMeteogramScene(input, options(300));
    const layer = renderStaticLayer(scene);
    expect(dayLabelNodes(layer).map(textContent)).toEqual(["15", "Fri 16.10", "17"]);
    expectLabelsInsideTheirDays(layer, scene.pixelLayout.textScaleX ?? 1);
  });

  /** 16 days in 900 viewBox units, the first and last of them 3 hours (as the website at 03 UTC). */
  const sixteenDays = (): DayGroupRenderItem[] => {
    const hourWidth = 900 / (16 * 24);
    const hours = [3, ...Array.from({ length: 15 }, () => 24), 3];
    let x = 50;
    return hours.map((count, index) => {
      const firstX = x;
      x += count * hourWidth;
      const day = String(index + 1).padStart(2, "0");
      return {
        dayKey: `2026-11-${day}`,
        firstX,
        rightX: x,
        blockWidth: x - firstX,
        isEven: index % 2 === 0,
        isBoundaryVisible: index > 0,
        boundaryX: firstX,
        dateLabel: `${day}.11`,
        weekdayLabel: "Mon",
      };
    });
  };

  it("in a chart of 16 days the 3-hour days at both edges have no label", () => {
    const groups = sixteenDays();
    const root = h(
      "g",
      null,
      timelineOverlay({
        dayGroups: groups,
        noonPositions: [],
        modelSegments: [],
        dayHeaderTop: 22,
        dayHeaderBottom: 44,
        dayHeaderHeight: 22,
        areas: [{ name: "temp", top: 44, bottom: 200 }],
        outerLeftX: 50,
        outerRightX: 950,
        paddingLeft: 50,
        paddingRight: 50,
        svgWidth: 1000,
        modelHeaderBoxBottom: 20,
        graphWidth: 900,
        timeline: { xToTimestamp: (x) => x * HOUR },
      }),
    );
    expect(dayCells(root)).toHaveLength(17);
    const days = dayLabelNodes(root).map((label) => label.attrs["data-day"]);
    expect(days).toEqual(groups.slice(1, -1).map((group) => group.dayKey));
    // The whole days keep the label they had (56 units: weekday and date at 9.5).
    expect(dayLabelNodes(root).map(textContent)[0]).toBe("Mon 02.11");
    expectLabelsInsideTheirDays(root, 1);
  });

  it("wide days keep their label and font size", () => {
    const group = { dateLabel: "16.10", weekdayLabel: "Fri" };
    expect(chooseDayLabel({ ...group, blockWidth: 300 })).toEqual({ text: "Fri 16.10", fontSize: 11 });
    expect(chooseDayLabel({ ...group, blockWidth: 65 })).toEqual({ text: "Fri 16.10", fontSize: 11 });
    expect(chooseDayLabel({ ...group, blockWidth: 55 })).toEqual({ text: "Fri 16.10", fontSize: 9.5 });
    expect(chooseDayLabel({ ...group, blockWidth: 45 })).toEqual({ text: "Fri 16", fontSize: 9.5 });
    expect(chooseDayLabel({ ...group, blockWidth: 38 })).toEqual({ text: "Fri 16", fontSize: 8 });
    expect(chooseDayLabel({ ...group, blockWidth: 25 })).toEqual({ text: "16", fontSize: 8 });
  });

  it("gives way to a shorter form, and drops the label when not even the day number fits", () => {
    const group = { dateLabel: "16.10", weekdayLabel: "Fri" };
    // Stretched text: the weekday with the date is wider than the day.
    expect(chooseDayLabel({ ...group, blockWidth: 120 }, 2.5)).toEqual({ text: "Fri 16", fontSize: 11 });
    expect(chooseDayLabel({ ...group, blockWidth: 13 })).toBeNull();
    expect(chooseDayLabel({ ...group, blockWidth: 7 })).toBeNull();
  });
});
