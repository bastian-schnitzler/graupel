// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Hover logic of the meteogram, without a framework: pointer position to
 * chart time, the values shown for that time, and where the tooltip goes.
 */
import { calculateAccumulatedPrecipitation } from "../core/calculations";
import { chainRunSegments, type MeteogramInput } from "../core/input";
import { getSupportedPointAtTimestamp } from "../core/convective";
import { findTimestampAtOrBefore, getZonedDateParts } from "../core/timeline";
import { findRunAt } from "../core/timelineUtils";
import type { DataPoint, ModelInfo } from "../core/types";
import type { MeteogramScene } from "../render/scene";
import type { ResolvedTooltipGroup } from "../layouts/types";

/** Pointer position in the chart: time under the pointer and the data hour. */
export interface HoverPosition {
  /** Pointer time (epoch ms); the cursor line is drawn here. */
  time: number;
  /** Start of the data hour the pointer lies in (epoch ms), null without data. */
  timestamp: number | null;
}

/** Everything the tooltip (or a host's own tooltip) shows for a hover. */
export interface MeteogramHoverInfo extends HoverPosition {
  /** Index of `timestamp` in `scene.timestamps`, null without data. */
  index: number | null;
  /** Values of every quantity at `timestamp`. */
  data: Record<string, DataPoint> | null;
  /** x of the cursor line in viewBox units. */
  x: number;
  /** Local date parts of `timestamp` in the chart's time zone. */
  dateParts: { hour: string; minute: string } | null;
  /** Precipitation summed over the contiguous wet hours around `timestamp`. */
  accumulatedPrecip: number | null;
  /** Snowfall summed over the contiguous snowy, wet hours around `timestamp`. */
  accumulatedSnowfall: number | null;
  /** Lightning potential of a model that supports it (layout with LPI only). */
  lpiValue: number | null;
  /** Run of the hovered value, e.g. "Run 06.10. 08:00 + 144h". */
  runInfo: string | null;
  /** Model name of the hovered value. */
  model: string | null;
  /** Time zone the chart shows. */
  timezone: string;
  /** Locale of the date in the tooltip header. */
  locale: string;
  /** Quantities of the layout; the tooltip shows rows of these only. */
  quantities: Set<string>;
  /** Groups of popup rows in display order (`scene.tooltipGroups`); without them the default rows. */
  tooltip?: readonly ResolvedTooltipGroup[];
}

/**
 * Chart time under a pointer. `clientX` and `rect` are CSS pixels (the
 * rendered SVG); outside the plot (left and right padding) or without a
 * visible chart the result is null.
 */
export function hoverAtPointer(
  scene: MeteogramScene,
  clientX: number,
  rect: { left: number; width: number },
): HoverPosition | null {
  if (!scene.available || !(rect.width > 0)) return null;
  const scaledX = ((clientX - rect.left) / rect.width) * scene.svgWidth;
  if (scaledX < scene.paddingLeft || scaledX > scene.svgWidth - scene.paddingRight) {
    return null;
  }
  return hoverAtTime(scene, scene.timeline.xToTimestamp(scaledX, true));
}

/** Hover position for a chart time (keyboard, host). */
export function hoverAtTime(scene: MeteogramScene, time: number): HoverPosition {
  return { time, timestamp: findTimestampAtOrBefore(scene.timestamps, time) };
}

/**
 * Formats a model run start (UTC instant) as local "dd.mm. HH:MM".
 */
export function formatModelRunTime(
  runTime?: string | null,
  timeZone?: string,
): string | null {
  if (!runTime) return null;
  const date = new Date(runTime);
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("day")}.${part("month")}. ${part("hour")}:${part("minute")}`;
}

/** The values and sums the tooltip shows for a hover position. */
export function buildHoverInfo(
  scene: MeteogramScene,
  position: HoverPosition,
  input: Pick<MeteogramInput, "chain">,
  availableModels?: Record<string, ModelInfo>,
): MeteogramHoverInfo {
  const { timestamps, timeMap, timezone } = scene;
  const timestamp = position.timestamp;
  const found = timestamp === null ? -1 : timestamps.indexOf(timestamp);
  const index = found < 0 ? null : found;
  const data = timestamp !== null ? (timeMap.get(timestamp) ?? null) : null;
  const precipValues = scene.areaContext.valuesOf("precipitation");
  const snowfallValues = scene.areaContext.valuesOf("snowfall");
  const accumulatedPrecip = calculateAccumulatedPrecipitation(index, precipValues, timestamps);
  const accumulatedSnowfall = calculateAccumulatedPrecipitation(
    index,
    timestamps.map((_, i) =>
      (precipValues[i] ?? 0) > 0 && (snowfallValues[i] ?? 0) > 0 ? snowfallValues[i] : null,
    ),
    timestamps,
  );
  const model = data?.["temperature"]?.model || data?.["wind_speed"]?.model || null;
  const run =
    model && timestamp !== null
      ? findRunAt(chainRunSegments(input.chain)[model], timestamp)
      : undefined;
  const runTime = formatModelRunTime(run?.run_init_time, timezone);
  const runInfo = runTime
    ? `Run ${runTime}` +
      (typeof run?.run_length_hours === "number" ? ` + ${run.run_length_hours}h` : "")
    : null;
  const lpiValue =
    timestamp !== null && scene.layoutQuantities.has("lightning_potential")
      ? (getSupportedPointAtTimestamp(
          "lightning_potential",
          timestamp,
          timeMap,
          scene.modelChain,
          availableModels,
        )?.value ?? null)
      : null;
  const zoned = timestamp !== null ? getZonedDateParts(timestamp, timezone) : null;
  return {
    time: position.time,
    timestamp,
    index,
    data,
    x: scene.getX(position.time),
    dateParts: zoned ? { hour: zoned.hour, minute: zoned.minute } : null,
    accumulatedPrecip,
    accumulatedSnowfall,
    lpiValue,
    runInfo,
    model,
    timezone,
    locale: scene.locale,
    quantities: scene.layoutQuantities,
    tooltip: scene.tooltipGroups,
  };
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PopupPlacement {
  /** Box the tooltip stays in (the meteogram element), viewport pixels. */
  container: Rect;
  /** Rendered SVG, viewport pixels. */
  svg: Rect;
  /** Tooltip size in pixels. */
  popup: { width: number; height: number };
  /** Pointer x (viewport); without it the cursor line position is used. */
  clientX: number | null;
  /** Cursor line x in viewBox units. */
  hoverX: number;
  svgWidth: number;
  /** Bottom of the day header and height of the viewBox (viewBox units). */
  dayHeaderBottom: number;
  totalSvgHeight: number;
  /** Distance to the container edges. */
  inset?: number;
}

/**
 * Tooltip position (viewport pixels): on the side of the container opposite
 * the cursor, just below the day header, shifted up only as far as needed to
 * stay inside the container.
 */
export function calculatePopupPosition(placement: PopupPlacement): {
  top: number;
  left: number;
} {
  const { container, svg, popup, hoverX, svgWidth } = placement;
  const inset = placement.inset ?? 12;
  const right = container.left + container.width;
  const bottom = container.top + container.height;
  const centreX = container.left + container.width / 2;
  const clientX = placement.clientX ?? container.left + (hoverX / svgWidth) * container.width;
  let left = clientX < centreX ? right - inset - popup.width : container.left + inset;
  left = Math.max(container.left + inset, Math.min(right - inset - popup.width, left));

  const svgHeight = placement.totalSvgHeight > 0 ? placement.totalSvgHeight : 450;
  const dayHeaderBottomScreen = svg.top + (placement.dayHeaderBottom / svgHeight) * svg.height;
  const preferredTop = dayHeaderBottomScreen + 4;
  const minTop = container.top + inset;
  const maxTop = bottom - inset - popup.height;
  const top = preferredTop <= maxTop ? preferredTop : Math.max(minTop, maxTop);
  return { top: Math.round(top), left: Math.round(left) };
}
