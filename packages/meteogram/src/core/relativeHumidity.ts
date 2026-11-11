// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Relative humidity in the temperature area (REQ-649): whether the layout's `relative_humidity` series and its axis
 * are drawn (render option `relativeHumidity`, default `"off"`).
 */
import type { ResolvedChartLayout } from "../layouts/types";

/** Quantity of the relative humidity (the built-in layouts draw it on the right axis of the temperature area). */
export const RELATIVE_HUMIDITY_QUANTITY = "relative_humidity";

/**
 * Visibility of the relative humidity (render option `relativeHumidity`, default `"off"`): `"on"` draws its line and
 * axis wherever the layout has them and the data has values, `"off"` leaves both out.
 */
export type RelativeHumidityMode = "on" | "off";

export const RELATIVE_HUMIDITY_MODES: readonly RelativeHumidityMode[] = ["on", "off"];

export function isRelativeHumidityMode(value: unknown): value is RelativeHumidityMode {
  return typeof value === "string" && (RELATIVE_HUMIDITY_MODES as readonly string[]).includes(value);
}

/**
 * The layout as drawn with the relative humidity `shown` or not: when not shown, every series of the quantity and
 * every axis of the quantity are left out, so each area is drawn exactly as a layout without them. When shown, or
 * when the layout has none of them, the layout itself.
 */
export function withRelativeHumidity(layout: ResolvedChartLayout, shown: boolean): ResolvedChartLayout {
  if (shown) return layout;
  const isHumidity = (quantity: string | null) => quantity === RELATIVE_HUMIDITY_QUANTITY;
  const touches = layout.areas.some(
    (area) =>
      area.series.some((series) => isHumidity(series.quantity)) ||
      isHumidity(area.axes.left?.quantity ?? null) ||
      isHumidity(area.axes.right?.quantity ?? null),
  );
  if (!touches) return layout;
  return {
    ...layout,
    areas: layout.areas.map((area) => ({
      ...area,
      axes: {
        left: area.axes.left && isHumidity(area.axes.left.quantity) ? null : area.axes.left,
        right: area.axes.right && isHumidity(area.axes.right.quantity) ? null : area.axes.right,
      },
      series: area.series.filter((series) => !isHumidity(series.quantity)),
    })),
  };
}
