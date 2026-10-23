/**
 * Meteogram layout schema (system.md §4.1), mirrors `graupel/data/layouts.py`.
 * Optional fields default to today's chart; `ResolvedChartLayout` has every
 * default filled in.
 */

export type AxisRange = "auto" | "fixed" | "zero-based";
export type AxisSide = "left" | "right";
export type SeriesAxis = AxisSide | "hidden";
export type LocationLabelPosition = "top" | "bottom" | "none";

export interface LayoutAxis {
  /** Quantity whose unit and label format the axis uses. */
  quantity?: string | null;
  /** Unit text after the axis values ("°", "mm", "km/h"). */
  label?: string | null;
  range?: AxisRange;
  min?: number | null;
  max?: number | null;
  /** Reference line at 0 when it lies inside the range (0 °C line). */
  zeroLine?: boolean;
  showLabels?: boolean;
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
  /** Upper (positive) or lower (negative) half around a shared zero line. */
  half?: "upper" | "lower" | null;
  /** Icon footprint in screen pixels (arrows, icons): sets icon density. */
  iconFootprintPx?: number | null;
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
  areas: LayoutArea[];
}

export interface ResolvedAxis {
  quantity: string | null;
  label: string | null;
  range: AxisRange;
  min: number | null;
  max: number | null;
  zeroLine: boolean;
  showLabels: boolean;
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
  half: "upper" | "lower" | null;
  iconFootprintPx: number | null;
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
  areas: ResolvedArea[];
}
