// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Wheel and keyboard zoom of the meteogram, without a framework; the range
 * maths live in `core/zoom`.
 */
import { createTimelineScale } from "../core/timeline";
import {
  calculateZoomedTimeRange,
  normalizeWheelZoomDirection,
  type TimeRange,
} from "../core/zoom";
import type { MeteogramScene } from "../render/scene";

export type ZoomDirection = "in" | "out";

/**
 * Next visible range for one zoom step, anchored at the hover time when it
 * lies inside the visible range. Null when nothing changes (no chart, at
 * the zoom limit).
 */
export function zoomStep(
  scene: MeteogramScene,
  direction: ZoomDirection,
  hoverTime: number | null,
): TimeRange | null {
  const { maximumRange, timeline } = scene;
  if (!scene.available || !maximumRange) return null;
  const range = { start: timeline.startMs, end: timeline.endMs };
  const anchor =
    hoverTime !== null && hoverTime > range.start && hoverTime < range.end ? hoverTime : null;
  const next = calculateZoomedTimeRange({ range, maximumRange, hoverTime: anchor, direction });
  return next.start === range.start && next.end === range.end ? null : next;
}

/** Zoom direction of a wheel event, null for a horizontal or tiny wheel. */
export function wheelDirection(event: { deltaY: number; deltaMode: number }): ZoomDirection | null {
  return normalizeWheelZoomDirection(event.deltaY, event.deltaMode);
}

/**
 * Horizontal shift (CSS pixels) of the cursor line at `time` when the
 * visible range changes from the scene's to `next`: the distance a host's
 * cursor warp moves the pointer so it stays on the line.
 */
export function cursorShiftAfterZoom(
  scene: MeteogramScene,
  next: TimeRange,
  time: number,
  renderedWidth: number,
): number {
  const nextScale = createTimelineScale(
    next.start,
    next.end,
    scene.paddingLeft,
    scene.svgWidth - scene.paddingRight,
  );
  const oldX = (scene.timeline.timestampToX(time) / scene.svgWidth) * renderedWidth;
  const newX = (nextScale.timestampToX(time) / scene.svgWidth) * renderedWidth;
  return newX - oldX;
}
