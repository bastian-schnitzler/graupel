// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * @graupel/meteogram/png: PNG export of a mounted meteogram (browser only).
 */
import { WIND_ICON_FOOTPRINT_PX } from "../core/viewLayout";
import type { MeteogramController, MeteogramExportOptions } from "../interaction/controller";
import { exportLabelFontPx, renderMeteogramPng, type RenderMeteogramPngOptions } from "./exportPng";

export * from "./exportPng";

/** Background of `element`, or null when it is transparent. */
function backgroundOf(element: Element): string | null {
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = view.getComputedStyle(node).backgroundColor;
    if (colour && colour !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(colour)) return colour;
  }
  return null;
}

/**
 * Least width of a day the icons of the picture are spaced for: three wind
 * arrows a day. A narrow chart (a phone) showing many days has fewer on
 * screen; its picture is laid out wider, so it shows as many as a wide one.
 */
export const EXPORT_MIN_DAY_WIDTH_PX = 3 * WIND_ICON_FOOTPRINT_PX;

/** Options of `meteogramToPng`. */
export interface MeteogramPngOptions
  extends Pick<RenderMeteogramPngOptions, "scale" | "background" | "labelFontPx">,
    MeteogramExportOptions {}

/**
 * The visible meteogram as PNG: chart, location label and attribution as on
 * screen, the live cursor replaced by a line at the forecast generation
 * time. The background is the element's (or its nearest painted ancestor's),
 * else the theme's. `render` draws the picture with other render options
 * (e.g. a layout without model headers); its icons are spaced for days of at
 * least `minDayWidthPx` (default `EXPORT_MIN_DAY_WIDTH_PX`, 0: as on
 * screen). Rejects when nothing is drawn (no data).
 */
export function meteogramToPng(meteogram: MeteogramController, options: MeteogramPngOptions = {}): Promise<Blob> {
  const { render, minDayWidthPx = EXPORT_MIN_DAY_WIDTH_PX } = options;
  const sources = meteogram.getExportSources({ ...(render ? { render } : {}), minDayWidthPx });
  try {
    if (!sources.svg) return Promise.reject(new Error("Meteogram has no chart to export"));
    const background = options.background ?? backgroundOf(sources.element) ?? sources.background;
    const labelFontPx = options.labelFontPx ?? exportLabelFontPx(sources.svg);
    // Reads the page before it returns, so the chart can be put back right away.
    return renderMeteogramPng({
      svg: sources.svg,
      textRows: sources.textRows,
      timeLine: sources.timeLine,
      ...(labelFontPx !== undefined ? { labelFontPx } : {}),
      ...(options.scale !== undefined ? { scale: options.scale } : {}),
      background,
    });
  } finally {
    sources.release?.();
  }
}
