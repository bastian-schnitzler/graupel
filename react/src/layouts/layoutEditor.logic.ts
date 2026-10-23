import { getQuantityRegistry, getQuantity } from "../quantities/registry";
import type { QuantityDefinition } from "../quantities/registry";
import type { StoredLayout } from "../types";
import {
  getBuiltinLayout,
  NORMAL_LAYOUT_ID,
  POWER_DEFAULT_LAYOUT_ID,
  validateChartLayout,
} from "./layoutResolution";
import type {
  AxisSide,
  ChartLayout,
  LayoutArea,
  LayoutAxis,
  LayoutSeries,
} from "./types";

/**
 * Pure edit operations of the layout editor (Config → Meteogram tab, system.md
 * §4.3, #142). Every operation returns a new layout and leaves its input
 * untouched, so the editor can keep the draft in React state.
 */

/** Chart-wide switches shown as checkboxes. */
export type LayoutToggle =
  | "showModelHeaders"
  | "showDayHeader"
  | "showDaylight"
  | "showCreatedTimestamp";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Built-in layout drawn instead of the entry when it is invalid. */
export function getEntryFallbackId(entry: StoredLayout): string {
  return (
    entry.builtin_id ??
    (entry.fixed ? NORMAL_LAYOUT_ID : POWER_DEFAULT_LAYOUT_ID)
  );
}

/**
 * Editable copy of a stored entry. An invalid stored layout starts from the
 * built-in layout it is drawn as, so the editor never works on broken data.
 */
export function toEditableLayout(entry: StoredLayout): ChartLayout {
  const usable =
    !entry.error && validateChartLayout(entry.layout).length === 0
      ? (entry.layout as ChartLayout)
      : getBuiltinLayout(getEntryFallbackId(entry));
  return { ...clone(usable), id: entry.id, name: entry.name };
}

/** First problem of the layout, or null when it can be saved. */
export function getLayoutError(layout: ChartLayout): string | null {
  return validateChartLayout(layout)[0] ?? null;
}

/** Quantities a series can draw: registry entries with a series style. */
export function getSeriesQuantities(): QuantityDefinition[] {
  return getQuantityRegistry().filter((quantity) =>
    quantity.allowed_styles.some((style) => style !== "profile"),
  );
}

export function getSeriesStyles(quantityId: string): string[] {
  return (getQuantity(quantityId)?.allowed_styles ?? []).filter(
    (style) => style !== "profile",
  );
}

export function setLayoutToggle(
  layout: ChartLayout,
  key: LayoutToggle,
  value: boolean,
): ChartLayout {
  return { ...layout, [key]: value };
}

export function setLocationLabel(
  layout: ChartLayout,
  value: ChartLayout["showLocationLabel"],
): ChartLayout {
  return { ...layout, showLocationLabel: value };
}

function mapArea(
  layout: ChartLayout,
  areaIndex: number,
  change: (area: LayoutArea) => LayoutArea,
): ChartLayout {
  return {
    ...layout,
    areas: layout.areas.map((area, index) =>
      index === areaIndex ? change(area) : area,
    ),
  };
}

function move<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length) return items;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function updateArea(
  layout: ChartLayout,
  areaIndex: number,
  patch: Partial<Pick<LayoutArea, "enabled" | "heightWeight" | "sunTimes">>,
): ChartLayout {
  return mapArea(layout, areaIndex, (area) => ({ ...area, ...patch }));
}

/** Unused area id `area-<n>`. */
export function getNextAreaId(layout: ChartLayout): string {
  const ids = new Set(layout.areas.map((area) => area.id));
  let n = 1;
  while (ids.has(`area-${n}`)) n += 1;
  return `area-${n}`;
}

/** Appends an area with one temperature line on its own left axis. */
export function addArea(layout: ChartLayout): ChartLayout {
  const area: LayoutArea = {
    id: getNextAreaId(layout),
    heightWeight: 1,
    axes: { left: { quantity: "temperature", range: "auto" } },
    series: [{ quantity: "temperature", style: "line" }],
  };
  return { ...layout, areas: [...layout.areas, area] };
}

export function removeArea(
  layout: ChartLayout,
  areaIndex: number,
): ChartLayout {
  return {
    ...layout,
    areas: layout.areas.filter((_, index) => index !== areaIndex),
  };
}

export function moveArea(
  layout: ChartLayout,
  areaIndex: number,
  delta: number,
): ChartLayout {
  return { ...layout, areas: move(layout.areas, areaIndex, delta) };
}

/** Sets (`patch`), adds (no axis yet) or removes (`null`) an axis. */
export function updateAxis(
  layout: ChartLayout,
  areaIndex: number,
  side: AxisSide,
  patch: Partial<LayoutAxis> | null,
): ChartLayout {
  return mapArea(layout, areaIndex, (area) => {
    const current = area.axes?.[side] ?? null;
    let next: LayoutAxis | null;
    if (patch === null) {
      next = null;
    } else {
      next = { ...(current ?? { range: "auto" }), ...patch };
      // A fixed range needs bounds; start from 0..100 instead of an error.
      if (next.range === "fixed") {
        next.min = next.min ?? 0;
        next.max = next.max ?? 100;
      }
    }
    return { ...area, axes: { ...area.axes, [side]: next } };
  });
}

/** Switches the vertical cloud profile background of an area. */
export function setCloudProfile(
  layout: ChartLayout,
  areaIndex: number,
  enabled: boolean,
): ChartLayout {
  return mapArea(layout, areaIndex, (area) => ({
    ...area,
    background: area.background
      ? { ...area.background, enabled }
      : enabled
        ? { kind: "vertical_cloud_profile", enabled: true, heightWeight: 0.3 }
        : null,
  }));
}

function mapSeries(
  layout: ChartLayout,
  areaIndex: number,
  change: (series: LayoutSeries[]) => LayoutSeries[],
): ChartLayout {
  return mapArea(layout, areaIndex, (area) => ({
    ...area,
    series: change(area.series ?? []),
  }));
}

/**
 * Changes one series. A new quantity keeps the style when allowed, else
 * takes the quantity's first style, and drops the color override.
 */
export function updateSeries(
  layout: ChartLayout,
  areaIndex: number,
  seriesIndex: number,
  patch: Partial<LayoutSeries>,
): ChartLayout {
  return mapSeries(layout, areaIndex, (series) =>
    series.map((entry, index) => {
      if (index !== seriesIndex) return entry;
      const next: LayoutSeries = { ...entry, ...patch };
      if (patch.quantity !== undefined && patch.quantity !== entry.quantity) {
        const styles = getSeriesStyles(patch.quantity);
        if (!styles.includes(next.style)) next.style = styles[0] ?? next.style;
        delete next.color;
      }
      return next;
    }),
  );
}

export function addSeries(
  layout: ChartLayout,
  areaIndex: number,
  quantityId = "temperature",
): ChartLayout {
  const style = getSeriesStyles(quantityId)[0] ?? "line";
  return mapSeries(layout, areaIndex, (series) => [
    ...series,
    { quantity: quantityId, style },
  ]);
}

export function removeSeries(
  layout: ChartLayout,
  areaIndex: number,
  seriesIndex: number,
): ChartLayout {
  return mapSeries(layout, areaIndex, (series) =>
    series.filter((_, index) => index !== seriesIndex),
  );
}

export function moveSeries(
  layout: ChartLayout,
  areaIndex: number,
  seriesIndex: number,
  delta: number,
): ChartLayout {
  return mapSeries(layout, areaIndex, (series) =>
    move(series, seriesIndex, delta),
  );
}
