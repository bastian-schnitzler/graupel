// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Room beside the plot in the desktop meteogram card (REQ-613): as wide on both sides, as much as the left labels
 * need, and enough on the right for the button column; where the chart scrolls the column stays beside it. Right labels
 * that reach up to the column stand under it and no longer narrow the chart; the buttons are then translucent (REQ-672).
 */
import { MODEL_HEADER_HEIGHT } from "@graupel/meteogram";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_LABEL_ROOM,
  DESKTOP_TOOLS_GAP,
  desktopSideRoom,
  rightLabelsTop,
  toolsOverRightLabels,
  WEB_LAYOUT,
  WEB_LAYOUT_WITHOUT_HEADERS,
} from "../src/regions/MeteogramPanel/layout.ts";

describe("rightLabelsTop", () => {
  it("is the top of the area with the cloud background, below the model and day headers", () => {
    const headed = rightLabelsTop(WEB_LAYOUT, { forceModelHeaders: true, backgroundHasData: true });
    const plain = rightLabelsTop(WEB_LAYOUT_WITHOUT_HEADERS, { forceModelHeaders: false, backgroundHasData: true });
    expect(headed).toBeGreaterThan(100);
    expect(headed! - plain!).toBe(MODEL_HEADER_HEIGHT);
  });

  it("is null without cloud data: then nothing stands right of the plot", () => {
    expect(rightLabelsTop(WEB_LAYOUT, { forceModelHeaders: true, backgroundHasData: false })).toBeNull();
  });
});

describe("desktopSideRoom", () => {
  // A 1280 px window: 1230 px of card content, a column of three 32 px buttons.
  const card = { content: 1230, minChart: 640, toolsWidth: 32, toolsHeight: 104, rightTop: 176 };

  it("is the labels' room on a wide card, where the column fits beside the plot", () => {
    expect(desktopSideRoom(card)).toBe(DESKTOP_LABEL_ROOM);
    expect(desktopSideRoom({ ...card, content: 2000 })).toBe(DESKTOP_LABEL_ROOM);
  });

  it("grows on a narrower card so the column keeps its gap to the plot", () => {
    const room = desktopSideRoom({ ...card, content: 660 })!;
    expect(room).toBeGreaterThan(DESKTOP_LABEL_ROOM);
    expect((room * 660) / 1000).toBeGreaterThanOrEqual(card.toolsWidth + DESKTOP_TOOLS_GAP);
  });

  it("leaves the column beside the chart where the chart scrolls", () => {
    expect(desktopSideRoom({ ...card, content: 600 })).toBeNull();
    expect(desktopSideRoom({ ...card, toolsWidth: 0 })).toBeNull();
  });

  it("keeps the chart's whole width where the right labels reach up to the buttons (REQ-672)", () => {
    // The relative humidity's axis begins with the temperature area, right below the day header.
    const rightTop = rightLabelsTop(WEB_LAYOUT, {
      forceModelHeaders: true,
      backgroundHasData: true,
      toggles: { relativeHumidity: "on" },
    });
    const humid = { ...card, rightTop };
    expect(desktopSideRoom(humid)).toBe(DESKTOP_LABEL_ROOM);
    const narrow = { ...card, content: 650, rightTop: 160 };
    expect(desktopSideRoom(narrow)).not.toBeNull();
    expect(desktopSideRoom(narrow)).toBe(desktopSideRoom({ ...card, content: 650 }));
  });
});

describe("toolsOverRightLabels (REQ-672)", () => {
  const card = { content: 1230, toolsHeight: 140 };

  it("is true where the right labels begin beside the button column", () => {
    const rightTop = rightLabelsTop(WEB_LAYOUT, {
      forceModelHeaders: true,
      backgroundHasData: true,
      toggles: { relativeHumidity: "on" },
    });
    expect(toolsOverRightLabels({ ...card, rightTop })).toBe(true);
    expect(toolsOverRightLabels({ ...card, content: 650, rightTop: 160 })).toBe(true);
  });

  it("is false where the right labels begin below the column or there are none", () => {
    const rightTop = rightLabelsTop(WEB_LAYOUT, { forceModelHeaders: true, backgroundHasData: true });
    expect(toolsOverRightLabels({ ...card, rightTop })).toBe(false);
    expect(toolsOverRightLabels({ ...card, rightTop: null })).toBe(false);
    expect(toolsOverRightLabels({ ...card, content: 0, rightTop: 10 })).toBe(false);
  });

  it("measures the labels' top at the chart's scale against the column's height and gap", () => {
    // 1000 px of chart: one viewBox unit per px.
    expect(toolsOverRightLabels({ content: 1000, toolsHeight: 100, rightTop: 100 + DESKTOP_TOOLS_GAP - 1 })).toBe(true);
    expect(toolsOverRightLabels({ content: 1000, toolsHeight: 100, rightTop: 100 + DESKTOP_TOOLS_GAP })).toBe(false);
  });
});
