// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Popup of a layout (layout version 2, REQ-665): each area names the rows the hover popup shows, in groups with a
 * divider between them. A row is a quantity of the registry (label, unit) or one of the popup's own rows
 * (`TOOLTIP_SUM_ROWS`, `TOOLTIP_DERIVED_ROWS`). Without `tooltip` in any area the popup shows `DEFAULT_TOOLTIP_GROUPS`
 * and, after them, the other quantities of the layout (`getExtraTooltipQuantities`). A row of a quantity the layout
 * draws only under a switch (`showWhen`, `autoRule`) appears only while the quantity is drawn (REQ-676).
 */
import { getExtraTooltipQuantities } from "../core/tooltip";
import type { QuantityRegistry } from "../quantities/registry";
import type {
  LayoutArea,
  LayoutTooltipGroup,
  ResolvedArea,
  ResolvedChartLayout,
  ResolvedSeries,
  ResolvedTooltipGroup,
} from "./types";

/** Rows of the popup that are no quantity: the sums over the wet hours around the hovered hour. */
export const TOOLTIP_SUM_ROWS = ["precipitation_sum", "snowfall_sum"] as const;

/**
 * Rows of the popup computed from quantities, with the quantities they need (REQ-676): the dew point spread is the
 * temperature minus the dew point, the green area between the two lines.
 */
export const TOOLTIP_DERIVED_ROWS: Readonly<Record<string, readonly string[]>> = {
  dew_point_spread: ["temperature", "dew_point"],
};

/** Rows of the popup that are no quantity of the registry: the sums and the derived rows. */
export const TOOLTIP_OWN_ROWS: readonly string[] = [...TOOLTIP_SUM_ROWS, ...Object.keys(TOOLTIP_DERIVED_ROWS)];

/**
 * The popup of the built-in areas; after the apparent temperature the dew point, its spread
 * and the relative humidity, shown only while they are drawn (REQ-676).
 */
export const DEFAULT_TOOLTIP_GROUPS: readonly ResolvedTooltipGroup[] = [
  {
    group: "temperature",
    rows: ["temperature", "apparent_temperature", "dew_point", "dew_point_spread", "relative_humidity"],
    order: 1,
  },
  { group: "wind", rows: ["wind_speed", "wind_gusts", "wind_direction"], order: 2 },
  { group: "precipitation", rows: ["precipitation_probability", "precipitation", "precipitation_sum"], order: 3 },
  { group: "snow", rows: ["snowfall", "snow_depth", "snowfall_sum"], order: 4 },
  { group: "convective", rows: ["cape", "convective_inhibition", "lightning_potential"], order: 5 },
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === "string" && value !== "";
const isRow = (value: unknown, registry: QuantityRegistry) =>
  isName(value) && (TOOLTIP_OWN_ROWS.includes(value) || registry.get(value) !== undefined);

/** Problems of an area's `tooltip`; `groups` collects the group names of the layout (unique across it). */
export function tooltipErrors(
  where: string,
  tooltip: unknown,
  area: string,
  registry: QuantityRegistry,
  groups: Set<string>,
): string[] {
  if (tooltip === undefined || tooltip === null) return [];
  if (!Array.isArray(tooltip)) return [`${where}: tooltip must be a list`];
  const errors: string[] = [];
  const rowErrors = (rows: unknown[], at: string) => {
    for (const row of rows) {
      if (!isRow(row, registry)) errors.push(`${at}: unknown tooltip row ${String(row)}`);
    }
  };
  const named = (group: string) => {
    if (groups.has(group)) errors.push(`${where}: tooltip group names must be unique (${group})`);
    groups.add(group);
  };
  if (tooltip.every((entry) => typeof entry === "string")) {
    named(area);
    rowErrors(tooltip, where);
    return errors;
  }
  tooltip.forEach((entry: unknown, index) => {
    const at = `${where} tooltip group ${index + 1}`;
    if (!isObject(entry) || !isName(entry.group) || !Array.isArray(entry.rows)) {
      errors.push(`${at}: needs a group name and a list of rows`);
      return;
    }
    named(entry.group);
    rowErrors(entry.rows, at);
    if (entry.order !== undefined && !(typeof entry.order === "number" && Number.isFinite(entry.order))) {
      errors.push(`${at}: order must be a number`);
    }
  });
  return errors;
}

/** An area's `tooltip` as groups (a plain list is one group named after the area), or null without one. */
export function resolveTooltip(area: LayoutArea): ResolvedTooltipGroup[] | null {
  const tooltip = area.tooltip;
  if (!tooltip) return null;
  if (tooltip.every((entry): entry is string => typeof entry === "string")) {
    return [{ group: area.id, rows: [...tooltip], order: null }];
  }
  return (tooltip as readonly LayoutTooltipGroup[]).map((group) => ({
    group: group.group,
    rows: [...group.rows],
    order: group.order ?? null,
  }));
}

/**
 * Groups of the popup in display order: the groups of all areas, those with `order` first by it, then the others
 * in area order. Without `tooltip` in any area, `DEFAULT_TOOLTIP_GROUPS` and a group `extra` with the other
 * quantities of the layout (`quantities`).
 */
export function tooltipGroups(
  layout: { areas: readonly Pick<ResolvedArea, "tooltip">[] } | null,
  quantities: Set<string> | undefined,
): ResolvedTooltipGroup[] {
  const named = (layout?.areas ?? []).flatMap((area) => area.tooltip ?? []);
  if (!layout || !layout.areas.some((area) => area.tooltip)) {
    return [...DEFAULT_TOOLTIP_GROUPS, { group: "extra", rows: getExtraTooltipQuantities(quantities), order: null }];
  }
  const key = (group: ResolvedTooltipGroup) => group.order ?? Number.POSITIVE_INFINITY;
  return named
    .map((group, index) => ({ group, index }))
    .sort((a, b) => key(a.group) - key(b.group) || a.index - b.index)
    .map(({ group }) => group);
}

/**
 * Quantities the layout `before` draws with a series of which `after` draws none (REQ-676): series left out by their
 * switch (`showWhen`, the relative humidity without values) or, by `drawn`, drawn nowhere (a dew point whose mode is
 * off, or auto without the condition in the visible range).
 */
export function undrawnQuantities(
  before: Pick<ResolvedChartLayout, "areas">,
  after: Pick<ResolvedChartLayout, "areas">,
  drawn: (series: ResolvedSeries) => boolean = () => true,
): Set<string> {
  const shown = new Set(
    after.areas.flatMap((area) => area.series.filter((series) => drawn(series)).map((series) => series.quantity)),
  );
  return new Set(
    before.areas.flatMap((area) => area.series.map((series) => series.quantity)).filter((id) => !shown.has(id)),
  );
}

/** Groups without the rows of `hidden` quantities and the derived rows that need one of them (REQ-676). */
export function withoutTooltipRows(
  groups: readonly ResolvedTooltipGroup[],
  hidden: ReadonlySet<string>,
): ResolvedTooltipGroup[] {
  const shows = (row: string) => !hidden.has(row) && !(TOOLTIP_DERIVED_ROWS[row] ?? []).some((id) => hidden.has(id));
  return groups.map((group) => (group.rows.every(shows) ? group : { ...group, rows: group.rows.filter(shows) }));
}

/** The layout with the popup rows of `hidden` quantities left out of its areas' `tooltip` (REQ-676). */
export function withoutLayoutTooltipRows(layout: ResolvedChartLayout, hidden: ReadonlySet<string>): ResolvedChartLayout {
  if (hidden.size === 0 || !layout.areas.some((area) => area.tooltip)) return layout;
  return {
    ...layout,
    areas: layout.areas.map((area) => (area.tooltip ? { ...area, tooltip: withoutTooltipRows(area.tooltip, hidden) } : area)),
  };
}
