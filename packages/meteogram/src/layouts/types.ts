// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Meteogram layout schema (system.md §4.1), mirrors `graupel/data/layouts.py`.
 * Optional fields default to today's chart; `ResolvedChartLayout` has every
 * default filled in. Version 2 (REQ-663) adds the axis rules that used to be
 * fixed per quantity (`steps`, `step`, `padding`, `format`, `scope`, `guides`);
 * a layout without them, and every version 1 layout, draws as before.
 */

export type AxisRange = "auto" | "fixed" | "zero-based";
export type AxisSide = "left" | "right";
export type SeriesAxis = AxisSide | "hidden";
export type LocationLabelPosition = "top" | "bottom" | "none";
/** Time range an axis takes its extremes from: all data, or the visible range (REQ-663, REQ-655). */
export type AxisScope = "all" | "visible";

/**
 * Horizontal guide line across the plot of a left axis (REQ-663): at a value (`12`) or at a share of the axis range
 * (`"50%"`: `min + 0.5 · (max − min)`). Dashed and labelled with its value by default, like the wind guide line
 * (REQ-653). Guides outside the axis range are left out.
 */
export interface LayoutGuide {
  at: number | string;
  /** Default true: dashed (`4 3`); false: solid. */
  dashed?: boolean;
  /** Default true: the value rounded to a whole number with the unit at the left edge, a step fainter. */
  label?: boolean;
}

/** A switch of a layout (REQ-664): its values and the one it starts with. */
export interface LayoutToggle {
  values: string[];
  default: string;
}

/** Condition of a series or axis on switches: each named switch must have the value or one of the values. */
export type ShowWhen = Record<string, string | string[]>;

/** Label format of an axis maximum (REQ-663). Without it the quantity's own format applies. */
export interface LayoutAxisFormat {
  /** Decimals of the maximum label. */
  decimals?: number;
  /** Decimals of a maximum below 1 (e.g. 2 for "0.25"); default `decimals`. */
  below1Decimals?: number;
}

export interface LayoutAxis {
  /**
   * Quantity whose unit and label format the axis uses. Series and axes of `relative_humidity` (in the built-in
   * layouts the right axis of the temperature area, fixed 0 to 100 %) are drawn only with the render option
   * `relativeHumidity` "on" and values in the data, else left out (REQ-649).
   */
  quantity?: string | null;
  /** Unit text after the axis values ("°", "mm", "km/h"). */
  label?: string | null;
  range?: AxisRange;
  min?: number | null;
  max?: number | null;
  /** Reference line at 0 when it lies inside the range (0 °C line). */
  zeroLine?: boolean;
  /**
   * Left axis only: dashed guide line across the plot at half the axis range, `(min + max) / 2` (for a zero-based
   * axis half its maximum), in the grid colour behind the series, labelled on the left with its value rounded to a
   * whole number and the unit (REQ-653). The built-in layouts set it on the wind area. Ignored on a right axis.
   */
  midLine?: boolean;
  showLabels?: boolean;
  /**
   * Range "zero-based": steps the maximum is chosen from, the smallest that holds the data (`[2, 5, 10]` mm); above
   * the last step the next multiple of 100. Default: the quantity's steps (wind, precipitation) or 1.1 × the maximum.
   */
  steps?: number[] | null;
  /** Range "auto": minimum and maximum on multiples of this step (temperature: 5). */
  step?: number | null;
  /** Room (viewBox units) between the area edges and the axis extremes; default the quantity's. */
  padding?: { top?: number | null; bottom?: number | null } | null;
  /** Format of the maximum label; default the quantity's. */
  format?: LayoutAxisFormat | null;
  /**
   * `"visible"`: a left zero-based axis takes its maximum from the visible range while the render option
   * `scaleToVisibleRange` is on (REQ-655); `"all"`: from all data. Default: `"visible"` for precipitation and wind.
   */
  scope?: AxisScope | null;
  /** Guide lines (left axis only). `midLine: true` is short for `[{ at: "50%" }]`. */
  guides?: LayoutGuide[] | null;
  /** Drawn only while the layout's switches have these values (REQ-664); without it always. */
  showWhen?: ShowWhen | null;
}

export interface LayoutSeries {
  quantity: string;
  style: string;
  enabled?: boolean;
  color?: string | null;
  axis?: SeriesAxis;
  strokeWidth?: number | null;
  dashed?: boolean | null;
  /** `|` where a curve stops before the end of its model slice or resumes after a gap. */
  curveStops?: boolean;
  /** Daily min/max labels (line). */
  extremeLabels?: boolean;
  /** Bars drawn white with an outline when this quantity is positive. */
  snowFrom?: string | null;
  /**
   * Line of a spread (dew point, REQ-595): quantity of the line on the same axis (temperature) the area between the
   * two lines is filled to, in the series colour at `fillOpacity`, behind the lines. Such a series is drawn as the
   * render option `dewPoint` says (default `"off"`: not at all; `"auto"`: across the whole width when, in the visible
   * range, the spread is at most 5 K or the series reaches 15 °C somewhere and the `fillTo` line reaches 5 °C
   * somewhere, else not at all, REQ-604, REQ-620), does not widen its axis by its own values and lowers the axis
   * minimum only as far as a spread of 5 K below the `fillTo` line needs; lower values are cut off at the edge of the
   * area.
   */
  fillTo?: string | null;
  /** Opacity of the `fillTo` fill (0 to 1, default 0.18). */
  fillOpacity?: number | null;
  /** Upper (positive) or lower (negative) half around a shared zero line. */
  half?: "upper" | "lower" | null;
  /** Icon footprint in screen pixels (arrows, icons): sets icon density. */
  iconFootprintPx?: number | null;
  /** Drawn only while the layout's switches have these values (REQ-664); without it always. */
  showWhen?: ShowWhen | null;
  /**
   * Rule in code that decides where the series is drawn (REQ-664): `"spread"`, the dew point's (with `fillTo`,
   * REQ-595, REQ-604, REQ-620). The value of the switch `showWhen` names is its mode (`off`, `on`, `auto`); the series
   * stays in the layout and draws nothing at `off`.
   */
  autoRule?: "spread" | null;
}

export interface LayoutBackground {
  kind: "vertical_cloud_profile";
  enabled?: boolean;
  /** Extra height weight of the area while the background has data. */
  heightWeight?: number;
  maxAltitudeKm?: number;
  altitudeLabels?: boolean;
  terrainMask?: boolean;
}

export interface LayoutArea {
  id: string;
  enabled?: boolean;
  heightWeight?: number;
  /** Sunrise / sunset times on the first and last complete day (#171). */
  sunTimes?: boolean;
  axes?: { left?: LayoutAxis | null; right?: LayoutAxis | null };
  background?: LayoutBackground | null;
  series?: LayoutSeries[];
  /**
   * Rows of the hover popup (layout version 2, REQ-665): quantity ids (or `precipitation_sum`, `snowfall_sum`) as
   * one group named after the area, or a list of groups. Without it in every area the popup shows its default rows.
   */
  tooltip?: string[] | LayoutTooltipGroup[] | null;
}

/** One group of popup rows; a divider separates groups that show rows (`tooltip-divider-<group>`). */
export interface LayoutTooltipGroup {
  /** Name of the group, unique in the layout. */
  group: string;
  /** Quantity ids (or `precipitation_sum`, `snowfall_sum`, `dew_point_spread`) in display order. */
  rows: string[];
  /** Position among the groups of the layout (lower first); groups without follow in area order. */
  order?: number;
}

/** A group of popup rows with its position (null: after the positioned ones, in area order). */
export interface ResolvedTooltipGroup {
  group: string;
  rows: string[];
  order: number | null;
}

export interface ChartLayout {
  id: string;
  name: string;
  version?: number;
  /** Orange model headers and dashed model boundaries. */
  showModelHeaders?: boolean;
  showDayHeader?: boolean;
  showDaylight?: boolean;
  showLocationLabel?: LocationLabelPosition;
  showCreatedTimestamp?: boolean;
  /**
   * Switches by name (REQ-664), set with the render option `toggles`; `dewPoint`, `relativeHumidity` and
   * `scaleToVisibleRange` are also set by the render options of the same name. `scaleToVisibleRange` (`off`, `on`)
   * decides whether axes with `scope: "visible"` follow the visible range.
   */
  toggles?: Record<string, LayoutToggle> | null;
  areas: LayoutArea[];
}

export interface ResolvedAxis {
  quantity: string | null;
  label: string | null;
  range: AxisRange;
  min: number | null;
  max: number | null;
  zeroLine: boolean;
  midLine: boolean;
  showLabels: boolean;
  steps: number[] | null;
  step: number | null;
  paddingTop: number | null;
  paddingBottom: number | null;
  format: LayoutAxisFormat | null;
  scope: AxisScope | null;
  /** Guides with defaults; `midLine` adds `{ at: "50%" }` in front unless a guide already sits at 50 %. */
  guides: ResolvedGuide[];
  /** Conditions as lists; null: always drawn. */
  showWhen: Record<string, string[]> | null;
}

export interface ResolvedGuide {
  at: number | string;
  dashed: boolean;
  label: boolean;
}

export interface ResolvedSeries {
  quantity: string;
  style: string;
  color: string | null;
  axis: SeriesAxis;
  strokeWidth: number | null;
  dashed: boolean | null;
  curveStops: boolean;
  extremeLabels: boolean;
  snowFrom: string | null;
  fillTo: string | null;
  fillOpacity: number;
  half: "upper" | "lower" | null;
  iconFootprintPx: number | null;
  /** Conditions as lists; null: always drawn. */
  showWhen: Record<string, string[]> | null;
  autoRule: "spread" | null;
}

export interface ResolvedBackground {
  kind: "vertical_cloud_profile";
  heightWeight: number;
  maxAltitudeKm: number;
  altitudeLabels: boolean;
  terrainMask: boolean;
}

/** Enabled area with defaults; disabled series/backgrounds are dropped. */
export interface ResolvedArea {
  id: string;
  heightWeight: number;
  sunTimes: boolean;
  axes: { left: ResolvedAxis | null; right: ResolvedAxis | null };
  background: ResolvedBackground | null;
  series: ResolvedSeries[];
  /** Groups of popup rows, or null without `tooltip`. */
  tooltip: ResolvedTooltipGroup[] | null;
}

export interface ResolvedChartLayout {
  id: string;
  name: string;
  version: number;
  showModelHeaders: boolean;
  showDayHeader: boolean;
  showDaylight: boolean;
  showLocationLabel: LocationLabelPosition;
  showCreatedTimestamp: boolean;
  /** Switches of the layout (empty without). */
  toggles: Record<string, LayoutToggle>;
  areas: ResolvedArea[];
}
