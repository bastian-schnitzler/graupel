// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * The meteogram as a virtual SVG tree, in two layers: `static` (axes,
 * curves, headers, icons; redrawn on new data, layout or zoom) and `overlay`
 * (cursor line; redrawn on hover).
 */
import { readableTextColor } from "../core/color";
import { chooseModelHeaderLabel } from "../core/modelHeaderLabel";
import type { MeteogramInput } from "../core/input";
import type { HeaderModelSegment } from "../core/timelineUtils";
import { DEFAULT_TEXTS } from "../core/texts";
import { canonicalTimestamp } from "../core/timeline";
import { getTextTransform } from "../core/viewLayout";
import { chartArea } from "./chartArea";
import {
  createMeteogramScene,
  type MeteogramRenderOptions,
  type MeteogramScene,
} from "./scene";
import { toSvgString, type SvgStringOptions } from "./svgString";
import { terrainMaskLabel, timelineOverlay } from "./timelineOverlay";
import { h, type VInput, type VNode } from "./vnode";

export const SVG_XMLNS = "http://www.w3.org/2000/svg";

/** Default text of the empty state (no data or no visible range); option `texts.emptyState`. */
export const EMPTY_STATE_TEXT = DEFAULT_TEXTS.emptyState;

/** Hover position the overlay draws the cursor at. */
export interface MeteogramHover {
  /** Pointer time (epoch ms); the cursor line is drawn here. */
  time: number;
  /** Data hour the hovered values belong to. */
  timestamp?: number | null;
}

/** Header colour of a model from option `modelHeaderColors` (by id, then by name); null: the theme's. */
function headerColor(scene: MeteogramScene, seg: HeaderModelSegment): string | null {
  const colors = scene.modelHeaderColors;
  const own = (key: string | undefined) =>
    key !== undefined && Object.prototype.hasOwnProperty.call(colors, key) && colors[key] ? colors[key] : null;
  return own(seg.modelId) ?? own(seg.modelName);
}

function modelHeaders(scene: MeteogramScene): VInput[] {
  const { geometry, pixelLayout, theme } = scene;
  if (!scene.layout.showModelHeaders) return [];
  return scene.modelSegments.map((seg, idx) => {
    if (scene.zeroSpanModelNames.has(seg.modelName.toLowerCase())) return null;
    const badgeWidth = seg.endX - seg.startX;
    if (badgeWidth <= 0) return null;
    const badgeX = seg.startX;
    const badgeY = geometry.modelHeaderBoxTop;
    const badgeHeight = geometry.modelHeaderBoxHeight;
    const badgeBottom = geometry.modelHeaderBoxBottom;
    const headerLabel = chooseModelHeaderLabel(seg.label, seg.shortLabel, badgeWidth, {
      runLabel: seg.runLabel ?? null,
      textScaleX: pixelLayout.textScaleX ?? 1,
    });
    const cornerRadius = Math.min(3, badgeWidth / 2, badgeHeight);
    const badgePath = [
      `M ${badgeX} ${badgeBottom}`,
      `V ${badgeY + cornerRadius}`,
      `Q ${badgeX} ${badgeY} ${badgeX + cornerRadius} ${badgeY}`,
      `H ${badgeX + badgeWidth - cornerRadius}`,
      `Q ${badgeX + badgeWidth} ${badgeY} ${badgeX + badgeWidth} ${badgeY + cornerRadius}`,
      `V ${badgeBottom}`,
      "Z",
    ].join(" ");
    const labelX = badgeX + badgeWidth / 2;
    const labelY = geometry.modelHeaderTop + 14;
    const color = headerColor(scene, seg);
    const textColor = color
      ? readableTextColor(color, [theme.modelHeader.text, theme.modelHeader.contrastText])
      : theme.modelHeader.text;

    return h(
      "g",
      {
        key: `model-seg-${idx}-${seg.label}`,
        class: "model-label-segment",
        "data-testid": "model-label-segment",
        "data-model": seg.modelName,
        "data-start-x": seg.startX,
        "data-end-x": seg.endX,
      },
      h("path", {
        d: badgePath,
        fill: color ?? theme.modelHeader.background,
        "data-testid": "model-header-shape",
        "data-x": badgeX,
        "data-y": badgeY,
        "data-width": badgeWidth,
        "data-height": badgeHeight,
        "data-top-radius": cornerRadius,
        "data-bottom-radius": "0",
      }),
      h(
        "text",
        {
          x: labelX,
          y: labelY,
          transform: getTextTransform(labelX, labelY, pixelLayout.textScaleX),
          fill: textColor,
          "font-size": headerLabel.fontSize,
          "font-weight": "800",
          "text-anchor": "middle",
          "data-testid": "model-header-label",
          "data-shortened": headerLabel.shortened ? "true" : undefined,
          "data-run-only": headerLabel.runOnly ? "true" : undefined,
        },
        headerLabel.text,
      ),
    );
  });
}

function daylightStripes(scene: MeteogramScene): VInput[] {
  if (!scene.layout.showDaylight) return [];
  const { daylight } = scene.theme;
  return scene.daylightSpans.map((span, idx) =>
    h(
      "g",
      { key: `daylight-stripe-${span.dayKey || idx}`, class: "daylight-stripe-group" },
      scene.geometry.areas.map((area) =>
        h("rect", {
          key: area.name,
          x: span.x,
          y: area.top,
          width: span.width,
          height: area.height,
          fill: daylight.fill,
          opacity: daylight.opacity,
          "pointer-events": "none",
          "data-testid": "daylight-stripe",
        }),
      ),
    ),
  );
}

/** Static layer: everything but the cursor. */
export function renderStaticLayer(scene: MeteogramScene): VNode {
  const { geometry, pixelLayout, theme } = scene;
  if (!scene.available) {
    return h("g", { "data-layer": "static" });
  }
  const gradientColor = theme.temperatureGradient;
  const temperatureGradientId = `temperature-gradient-${scene.chartId}-${scene.mode}`;
  return h(
    "g",
    { "data-layer": "static" },
    h(
      "defs",
      null,
      h(
        "linearGradient",
        { id: temperatureGradientId, x1: "0", y1: "0", x2: "0", y2: "1" },
        h("stop", { offset: "0%", "stop-color": gradientColor, "stop-opacity": "0.25" }),
        h("stop", { offset: "100%", "stop-color": gradientColor, "stop-opacity": "0.0" }),
      ),
    ),
    modelHeaders(scene),
    daylightStripes(scene),
    timelineOverlay({
      dayGroups: scene.dayGroups,
      noonPositions: scene.noonPositions,
      modelSegments: scene.modelSegments,
      dayHeaderTop: geometry.dayHeaderTop,
      dayHeaderBottom: geometry.dayHeaderBottom,
      dayHeaderHeight: geometry.dayHeaderHeight,
      areas: scene.overlayAreas,
      outerLeftX: scene.outerLeftX,
      outerRightX: scene.outerRightX,
      paddingLeft: scene.paddingLeft,
      paddingRight: scene.paddingRight,
      svgWidth: scene.svgWidth,
      modelHeaderBoxBottom: geometry.modelHeaderBoxBottom,
      showModelBoundaries: scene.layout.showModelHeaders,
      showDayHeader: scene.layout.showDayHeader,
      terrainMask: scene.terrainMask,
      graphWidth: scene.graphWidth,
      timeline: scene.timeline,
      separatorStroke: scene.areaContext.separatorStroke,
      separatorStrokeWidth: scene.areaContext.separatorStrokeWidth,
      separatorOpacity: scene.areaContext.separatorOpacity,
      theme,
      ...(pixelLayout.textScaleX !== undefined ? { textScaleX: pixelLayout.textScaleX } : {}),
    }),
    geometry.areas.map((area, index) =>
      chartArea({ geometry: area, scales: scene.areaScales[index]!, context: scene.areaContext }),
    ),
    // Above the areas: the cloud profile would otherwise cover parts of the line and the label (REQ-510, REQ-569).
    terrainMaskLabel({
      terrainMask: scene.terrainMask,
      paddingLeft: scene.paddingLeft,
      paddingRight: scene.paddingRight,
      svgWidth: scene.svgWidth,
      theme,
      ...(pixelLayout.textScaleX !== undefined ? { textScaleX: pixelLayout.textScaleX } : {}),
    }),
  );
}

/**
 * Overlay layer: the hover cursor, or without hover the current-time line
 * (when now lies in the visible range).
 */
export function renderOverlayLayer(
  scene: MeteogramScene,
  hover: MeteogramHover | null = null,
): VNode {
  const { geometry } = scene;
  const overlay = (...children: VInput[]) =>
    h("g", { "data-layer": "overlay", "pointer-events": "none" }, ...children);
  if (!scene.available) return overlay();
  const cursor = (x: number, attrs: Record<string, string | undefined>) =>
    h("line", {
      x1: x,
      y1: geometry.dayHeaderTop,
      x2: x,
      y2: geometry.plotBottom,
      stroke: scene.theme.cursor,
      "stroke-width": "1.2",
      "stroke-dasharray": "4 2",
      ...attrs,
    });
  if (hover) {
    return overlay(
      h(
        "g",
        { class: "hover-crosshair-group", "data-testid": "hover-crosshair-group" },
        cursor(scene.getX(hover.time), {
          "data-testid": "hover-cursor-line",
          "data-timestamp":
            hover.timestamp !== null && hover.timestamp !== undefined
              ? canonicalTimestamp(hover.timestamp)
              : undefined,
          "data-hover-time": canonicalTimestamp(hover.time),
        }),
      ),
    );
  }
  if (scene.currentTimeX !== null) {
    return overlay(
      h(
        "g",
        { class: "current-time-crosshair-group", "data-testid": "current-time-crosshair-group" },
        cursor(scene.currentTimeX, {
          "data-testid": "current-time-cursor-line",
          "data-timestamp": canonicalTimestamp(scene.nowMs),
        }),
      ),
    );
  }
  return overlay();
}

/** Root `svg` element around both layers. */
export function renderMeteogramSvg(
  scene: MeteogramScene,
  layers: { static?: VNode; overlay?: VNode; hover?: MeteogramHover | null } = {},
): VNode {
  const { timeline, maximumRange, svgWidth, geometry, theme } = scene;
  const fontFamily = scene.fontFamily ?? undefined;
  const background = (height: number) =>
    scene.paintBackground &&
    h("rect", {
      x: "0",
      y: "0",
      width: svgWidth,
      height,
      fill: theme.background,
      "data-testid": "meteogram-background",
    });
  if (!scene.available) {
    return h(
      "svg",
      {
        xmlns: SVG_XMLNS,
        viewBox: `0 0 ${svgWidth} 60`,
        class: "meteogram-svg-integrated meteogram-empty-state",
        "font-family": fontFamily,
        "data-render-mode": scene.mode,
        "data-testid": "meteogram-empty-state",
      },
      background(60),
      h(
        "text",
        {
          x: svgWidth / 2,
          y: 34,
          "text-anchor": "middle",
          "font-size": theme.fontSizes.emptyState,
          fill: theme.emptyState,
        },
        scene.texts.emptyState,
      ),
    );
  }
  return h(
    "svg",
    {
      xmlns: SVG_XMLNS,
      viewBox: `0 0 ${svgWidth} ${geometry.totalHeight}`,
      class: "meteogram-svg-integrated",
      preserveAspectRatio: "none",
      "font-family": fontFamily,
      "data-render-mode": scene.mode,
      "data-visible-start-time": canonicalTimestamp(timeline.startMs),
      "data-visible-end-time": canonicalTimestamp(timeline.endMs),
      "data-maximum-start-time": maximumRange ? canonicalTimestamp(maximumRange.start) : undefined,
      "data-maximum-end-time": maximumRange ? canonicalTimestamp(maximumRange.end) : undefined,
    },
    background(geometry.totalHeight),
    layers.static ?? renderStaticLayer(scene),
    layers.overlay ?? renderOverlayLayer(scene, layers.hover ?? null),
  );
}

export interface MeteogramSvgOptions extends MeteogramRenderOptions, SvgStringOptions {
  hover?: MeteogramHover | null;
}

/** Input to SVG markup in one step (Node, server rendering, files). */
export function meteogramToSvgString(
  input: MeteogramInput,
  options: MeteogramSvgOptions = {},
): string {
  const scene = createMeteogramScene(input, options);
  return toSvgString(renderMeteogramSvg(scene, { hover: options.hover ?? null }), options);
}
