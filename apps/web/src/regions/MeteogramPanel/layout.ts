// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Layout of the website's meteogram: the built-in power layout of @graupel/meteogram, limited to the quantities of
 * the registry of @graupel/model-data. Since CAPE, CIN and LPI left the registry (REQ-447, REQ-453), the convection
 * area has nothing left to draw and is left out. It is a layout of version 2 (REQ-661): the settings dew point,
 * relative humidity and "adjust axes when zooming" are values of its switches (`toggles`), not render options of their
 * own.
 */
import {
  axisLabelBox,
  axisLabelHeight,
  BUILTIN_LAYOUTS,
  computeChartGeometry,
  DIGIT_ASCENT,
  getCloudAltitudeY,
  LIGHT_THEME,
  METEOGRAM_VIEWBOX_WIDTH,
  MID_LABEL_GAP,
  POWER_DEFAULT_LAYOUT_ID,
  resolveChartLayout,
  sunriseBaselineY,
  toggleValues,
  withToggles,
  type ChartLayout,
  type DewPointMode,
  type LayoutAxis,
  type RelativeHumidityMode,
} from "@graupel/meteogram";
import type { MeteogramComponentOptions } from "@graupel/meteogram-react";
import { registry } from "../../services/modelData.ts";

/**
 * `layout` without the series, axes and backgrounds whose quantities are not in `known` (also a series whose snow
 * source or spread partner, `snowFrom` or `fillTo`, is unknown); areas left without series and background are dropped.
 */
export function layoutForQuantities(layout: ChartLayout, known: ReadonlySet<string>): ChartLayout {
  const axis = (value: LayoutAxis | null | undefined) =>
    value && (!value.quantity || known.has(value.quantity)) ? value : null;
  const areas = layout.areas.flatMap((area) => {
    const series = (area.series ?? []).filter(
      (entry) =>
        known.has(entry.quantity) &&
        (!entry.snowFrom || known.has(entry.snowFrom)) &&
        (!entry.fillTo || known.has(entry.fillTo)),
    );
    const background = area.background && known.has(area.background.kind) ? area.background : null;
    if (series.length === 0 && !background) return [];
    return [
      {
        ...area,
        axes: { left: axis(area.axes?.left), right: axis(area.axes?.right) },
        background,
        series,
      },
    ];
  });
  return { ...layout, areas };
}

const POWER_LAYOUT = BUILTIN_LAYOUTS.find((layout) => layout.id === POWER_DEFAULT_LAYOUT_ID) ?? BUILTIN_LAYOUTS[0]!;

/**
 * Layout of the website's meteogram, with model headers (version 2, REQ-661). Its temperature area carries the relative
 * humidity on a right axis (REQ-649); the library draws it only with the switch `relativeHumidity` "on" (REQ-650), and
 * the helpers below that measure the chart leave it out unless the switch in `toggles` of their `DrawnAs` is "on".
 */
export const WEB_LAYOUT: ChartLayout = layoutForQuantities(
  POWER_LAYOUT,
  new Set(registry.quantities.map((quantity) => quantity.id)),
);

/** The same layout without model headers, for `modelHeaders: false` in the configuration. */
export const WEB_LAYOUT_WITHOUT_HEADERS: ChartLayout = { ...WEB_LAYOUT, showModelHeaders: false };

/**
 * Values of the switches (`toggles`) of the website's layout (REQ-661, REQ-664 of the library), set by the settings:
 * the dew point (`off`, `on`, `auto`, REQ-593), the relative humidity (`off`, `on`, REQ-650) and whether the
 * precipitation and wind axes follow the visible range (`off`, `on`, REQ-656).
 */
export type MeteogramToggles = {
  dewPoint: DewPointMode;
  relativeHumidity: RelativeHumidityMode;
  scaleToVisibleRange: "on" | "off";
};

/**
 * The settings as values of the layout's switches (REQ-661): the chart on the page, the full-screen view and the
 * picture pass them as the render option `toggles` instead of the render options `dewPoint`, `relativeHumidity` and
 * `scaleToVisibleRange`; the stored settings and the settings file keep their values (`scaleToVisibleRange` a boolean).
 */
export function meteogramToggles(
  dewPoint: DewPointMode,
  relativeHumidity: RelativeHumidityMode,
  scaleToVisibleRange: boolean,
): MeteogramToggles {
  return { dewPoint, relativeHumidity, scaleToVisibleRange: scaleToVisibleRange ? "on" : "off" };
}

/**
 * Whether the precipitation and wind axes of a chart with the switches `toggles` follow the visible range (REQ-656,
 * REQ-661): unless the switch `scaleToVisibleRange` is "off" (default of the layout: "on").
 */
export function followsVisibleRange(toggles: Readonly<Record<string, string>> | null | undefined): boolean {
  return toggles?.scaleToVisibleRange !== "off";
}

/**
 * Render options of the copied or saved picture (REQ-539): with or without the model headers as the chart on screen
 * shows them (`modelHeaders`, DEC-094: the own choice in the settings, else `modelHeaders` of config.json;
 * `imageModelHeaders` has no effect for now). The picture stands on its own and keeps its legend beside the
 * plot, also when a narrow page draws the plot edge to edge (REQ-547): `padding` and `axisLabels` fall back to their
 * defaults. It keeps its own height for its width, also when the chart on a phone in portrait keeps the height of all
 * days (REQ-585): `viewBoxWidth` falls back to the default. Its switches (`toggles`, REQ-661) are those of the chart on
 * screen, as chosen in the settings: the dew point (REQ-593), the relative humidity (REQ-650) and whether its
 * precipitation and wind axes follow the visible range (REQ-656); the picture shows the range the chart shows.
 */
export function imageRenderOptions(modelHeaders: boolean, toggles: MeteogramToggles) {
  const plain = { padding: null, axisLabels: null, viewBoxWidth: null, toggles };
  return modelHeaders
    ? { layout: WEB_LAYOUT, forceModelHeaders: true, ...plain }
    : { layout: WEB_LAYOUT_WITHOUT_HEADERS, forceModelHeaders: false, ...plain };
}

/**
 * Embedded chart on a narrow page (REQ-542, REQ-547): each axis label shows its value and below it the unit (`11` /
 * `mm`). The plot reaches from the chart's left edge to its right edge without room beside it; the left legend stands
 * over it at the left edge, the right one (cloud altitudes) at the right edge, with a halo in the background colour.
 */
export const NARROW_CHART_OPTIONS = {
  padding: { left: 0, right: 0 },
  axisLabels: { unit: "below", align: "inside" },
} as const satisfies Pick<MeteogramComponentOptions, "padding" | "axisLabels">;

/**
 * Largest distance (viewBox units) of an axis' minimum from the bottom of its area in the library's presets
 * (`minLabelOffset`, the wind's): the minimum of NARROW_CHART_OPTIONS stands on it.
 */
const MAX_MIN_LABEL_OFFSET = 6;

/**
 * Least height (viewBox units) of a drawing area in which the axis labels of NARROW_CHART_OPTIONS (value with the unit
 * below) do not overlap (REQ-694): the two-line maximum hanging below the sunrise row (REQ-602), the one-line label of
 * the zero line (REQ-603) with a gap above and below it, and the two-line minimum standing above the area's bottom.
 * About 56 units at the library's axis font size of 9.
 */
export const NARROW_LABELS_MIN_AREA_HEIGHT = (() => {
  const fontSize = LIGHT_THEME.fontSizes.axis;
  const maximum = axisLabelBox(sunriseBaselineY(0) + 1 + DIGIT_ASCENT * fontSize, 2, fontSize, "top").bottom;
  const zero = axisLabelHeight(1, fontSize) + 2 * MID_LABEL_GAP;
  const minimum = axisLabelHeight(2, fontSize) + MAX_MIN_LABEL_OFFSET;
  return Math.ceil((maximum + zero + minimum) * 100) / 100;
})();

/** Days the embedded chart shows on the width of the screen on a phone in portrait (REQ-554). */
export const PORTRAIT_DAYS_ON_SCREEN = 4.5;

const DAY_MS = 86_400_000;

/**
 * Days of the full forecast with all models (about 49 h back and 360 h ahead) that set the scale of the embedded chart
 * on a phone in portrait (REQ-741): as wide as 4.5 days per screen width, the chart has the size, text, lines and
 * symbols it has with them, also when fewer days are loaded (e.g. only one model answered).
 */
export const PORTRAIT_REFERENCE_DAYS = 17;

/** Width of `range` in screen widths at `daysOnScreen` days per screen, at least one. */
const screens = (range: { start: number; end: number }, daysOnScreen: number) =>
  Math.max(1, (range.end - range.start) / DAY_MS / daysOnScreen);

/**
 * Width (CSS px) of the phone whose embedded chart sets the scale on a tablet (REQ-742, REQ-744, REQ-750): an iPhone 13
 * in portrait. A tablet's chart has the scale this phone's has, with as many more days on its screen as it is wider,
 * upright and in landscape.
 */
export const REFERENCE_PHONE_WIDTH = 390;

/**
 * Days the embedded chart shows on a tablet's screen (REQ-742, REQ-744, REQ-750): `chartWidth` (CSS px, the chart's
 * visible width, the page's whole width upright and in landscape) at the scale of REFERENCE_PHONE_WIDTH with
 * PORTRAIT_DAYS_ON_SCREEN; that many without a measure.
 */
export function tabletDaysOnScreen(chartWidth: number | null): number {
  return chartWidth !== null && chartWidth > 0
    ? (PORTRAIT_DAYS_ON_SCREEN * chartWidth) / REFERENCE_PHONE_WIDTH
    : PORTRAIT_DAYS_ON_SCREEN;
}

/**
 * Embedded chart on a phone in portrait (REQ-554, REQ-583, REQ-585, REQ-741): `widthFactor` makes it as wide as 4.5
 * days on the screen per its time range `range` (at least the screen's width). Its scale (CSS px per viewBox unit) is
 * fixed, that of the full forecast (PORTRAIT_REFERENCE_DAYS): `viewBoxWidth` follows the chart's width, so it keeps its
 * height, text, lines and symbols whatever the selection and however many days are loaded; fewer days only make it
 * narrower, and with fewer than 4.5 days it fills the screen's width with wider days. The chart starts at the left
 * edge, so the first selected day is fully in view (with all days yesterday); MeteogramPanel scrolls back there for a
 * new chart or time range. A tablet shows `daysOnScreen` days on its screen, with the phone's scale on its wider
 * screen (`tabletDaysOnScreen`, REQ-742, REQ-744).
 */
export function portraitChart(
  range: { start: number; end: number },
  daysOnScreen = PORTRAIT_DAYS_ON_SCREEN,
): { widthFactor: number; viewBoxWidth: number } {
  const widthFactor = screens(range, daysOnScreen);
  return {
    widthFactor,
    viewBoxWidth: (METEOGRAM_VIEWBOX_WIDTH * widthFactor * daysOnScreen) / PORTRAIT_REFERENCE_DAYS,
  };
}

/**
 * `layout` with its areas `scale` times as high (DEC-053): the temperature, precipitation and wind areas (with a cloud
 * background) shrink in the same ratio; headers, gaps, text, lines and symbols keep their size.
 */
export function scaleLayoutAreas(layout: ChartLayout, scale: number): ChartLayout {
  if (scale === 1) return layout;
  return {
    ...layout,
    areas: layout.areas.map((area) => ({
      ...area,
      heightWeight: (area.heightWeight ?? 1) * scale,
      ...(area.background
        ? { background: { ...area.background, heightWeight: (area.background.heightWeight ?? 0) * scale } }
        : {}),
    })),
  };
}

interface DrawnAs {
  forceModelHeaders: boolean;
  backgroundHasData: boolean;
  /** Render option `toggles` of the chart (REQ-661); a switch left out has the layout's default, as in the library. */
  toggles?: Readonly<Record<string, string>>;
}

/**
 * Geometry of a chart of `layout` as drawn (viewBox units): series and axes only where the layout's switches at
 * `toggles` show them (`showWhen`, REQ-661), as the library draws it; so the relative humidity and its right axis only
 * with its switch "on" (REQ-649, REQ-650).
 */
function drawnGeometry(layout: ChartLayout, { forceModelHeaders, backgroundHasData, toggles }: DrawnAs) {
  const resolved = resolveChartLayout(layout).layout;
  const headed = forceModelHeaders && !resolved.showModelHeaders ? { ...resolved, showModelHeaders: true } : resolved;
  const shown = withToggles(headed, toggleValues(headed, toggles));
  return computeChartGeometry(shown, { backgroundHasData });
}

/** Lowest scale of the areas, only for screens so low that 40 % of them leave no room for the areas at all. */
const MIN_AREA_SCALE = 0.05;

/**
 * Margin (viewBox units) the library keeps inside an area with a cloud background: its altitudes and the ground of the
 * terrain mask stand within the area's height less this margin, so a lower area draws a mask of negative height
 * (REQ-749). Read from the library: in an area 0 high the highest altitude stands this margin below its bottom.
 */
export const CLOUD_BACKGROUND_MARGIN = getCloudAltitudeY({ top: 0, height: 0 }, 1, 1);

/** Heights of a chart in viewBox units (`chartHeights`). */
export interface ChartHeights {
  /** Height of the whole chart. */
  total: number;
  /** Height of its areas together. */
  areas: number;
  /**
   * Lowest scale of the areas (`scaleLayoutAreas`) at which every shape in them keeps a height of at least 0 (REQ-749):
   * an area with a cloud background stays as high as the library's margin in it, any other area at least 5 % of its
   * height.
   */
  leastScale: number;
}

/** Height of a chart of `layout` in viewBox units, in all (`total`) and of its areas (`areas`), as drawn. */
export function chartHeights(layout: ChartLayout, drawnAs: DrawnAs): ChartHeights {
  const geometry = drawnGeometry(layout, drawnAs);
  const leastScale = geometry.areas.reduce(
    (least, area) =>
      area.hasBackground && area.height > 0 ? Math.max(least, CLOUD_BACKGROUND_MARGIN / area.height) : least,
    MIN_AREA_SCALE,
  );
  return {
    total: geometry.totalHeight,
    areas: geometry.areas.reduce((sum, area) => sum + area.height, 0),
    leastScale: Math.min(1, Math.ceil(leastScale * 1000) / 1000),
  };
}

/**
 * Whether the embedded chart on a narrow page, drawn with `layout` (its areas maybe lowered by `scaleLayoutAreas`), is
 * small and gets compact axis labels (REQ-694, option `axisLabels.compact` of the library, REQ-696): one of its drawn
 * areas is lower than the labels of NARROW_CHART_OPTIONS need (`NARROW_LABELS_MIN_AREA_HEIGHT`). Then each axis writes
 * its unit once below its area and its maximum and minimum stand in the area's upper and lower corner, the
 * temperature's minimum included. Charts with areas of their full height (desktop, full-screen view, picture) keep
 * their labels.
 */
export function compactAxisLabels(layout: ChartLayout, drawnAs: DrawnAs): boolean {
  return drawnGeometry(layout, drawnAs).areas.some((area) => area.height < NARROW_LABELS_MIN_AREA_HEIGHT);
}

/**
 * Axis labels of the embedded chart on a narrow page (REQ-542, REQ-547), compact where it is small (REQ-694). Compact,
 * `unit` only sets the cloud altitudes: they keep the unit in their line ("6 km"), since two lines each would overlap
 * in a low cloud area.
 */
export function narrowAxisLabels(compact: boolean): NonNullable<MeteogramComponentOptions["axisLabels"]> {
  return compact ? { unit: "inline", align: "inside", compact: true } : NARROW_CHART_OPTIONS.axisLabels;
}

/**
 * Room above the chart's first row, where it draws nothing, as a share of the chart's width (REQ-615): its model headers
 * start a little below its top edge; without them the day row starts at that edge (0). `viewBoxWidth` is the width of
 * the chart's viewBox, on a phone in portrait narrower than by default (`portraitChart`).
 */
export function chartTopRoom(
  layout: ChartLayout,
  drawnAs: DrawnAs,
  viewBoxWidth: number = METEOGRAM_VIEWBOX_WIDTH,
): number {
  const geometry = drawnGeometry(layout, drawnAs);
  return geometry.showModelHeaders ? (geometry.modelHeaderBoxTop - geometry.modelHeaderTop) / viewBoxWidth : 0;
}

/**
 * Top (viewBox units) of the first area with labels right of the plot: a right axis or the cloud altitudes of a cloud
 * background; null if the chart has none.
 */
export function rightLabelsTop(layout: ChartLayout, drawnAs: DrawnAs): number | null {
  const tops = drawnGeometry(layout, drawnAs)
    .areas.filter((area) => area.area.axes.right !== null || area.hasBackground)
    .map((area) => area.top);
  return tops.length > 0 ? Math.min(...tops) : null;
}

/**
 * Room left and right of the plot in the desktop card (viewBox units, REQ-613): the library's default, as much as the
 * widest left labels need (a wind speed such as "120 km/h", right-aligned 8 units off the plot).
 */
export const DESKTOP_LABEL_ROOM = 50;

/** Gap (CSS px) between the button column and the plot beside it or the right labels below it (REQ-613). */
export const DESKTOP_TOOLS_GAP = 4;

/**
 * Room left and right of the plot in the desktop card (REQ-613), in viewBox units: as wide on both sides, as much as
 * the left labels need, and on the right enough for the button column, which stands in that room at the top right.
 * The chart then takes the card's whole width (`content`, CSS px). Null where the chart scrolls sideways (narrower than
 * its least width `minChart`), so the buttons keep their column beside the chart as before. Right labels that reach up
 * to the buttons, such as the relative humidity's axis, no longer narrow the chart: they stand under the buttons, which
 * are then translucent (REQ-672, `toolsOverRightLabels`).
 */
export function desktopSideRoom(card: {
  content: number;
  minChart: number;
  toolsWidth: number;
}): number | null {
  const { content, minChart, toolsWidth } = card;
  if (!(content > 0) || content < minChart || !(toolsWidth > 0)) return null;
  const pxPerUnit = content / METEOGRAM_VIEWBOX_WIDTH;
  return Math.max(DESKTOP_LABEL_ROOM, Math.ceil((toolsWidth + DESKTOP_TOOLS_GAP) / pxPerUnit));
}

/**
 * Whether the right labels of the chart, which takes the card's whole width `content` (CSS px), reach up beside the
 * button column standing over them (REQ-672): their top (`rightTop`, viewBox units, from `rightLabelsTop`) is less than
 * the column's height and gap below the chart's top. Then the buttons are translucent until pointed at or focused.
 */
export function toolsOverRightLabels(card: { content: number; toolsHeight: number; rightTop: number | null }): boolean {
  const { content, toolsHeight, rightTop } = card;
  if (rightTop === null || !(content > 0)) return false;
  return rightTop * (content / METEOGRAM_VIEWBOX_WIDTH) < toolsHeight + DESKTOP_TOOLS_GAP;
}

/** Least share of the screen's height the embedded chart keeps on a phone in portrait (REQ-608). */
export const PORTRAIT_MIN_SCREEN_SHARE = 0.4;


/**
 * Scale of the areas of the embedded chart on a phone in portrait (REQ-608, DEC-053): the chart, `heights` in viewBox
 * units at `pxPerUnit` CSS px each, gets the height `available` (px) that the rest of the page leaves on the screen
 * (`screen`, the smallest visible height), so the page does not scroll. At least 40 % of the screen (then the page
 * scrolls), at most its own height; only the areas get lower, at most to `heights.leastScale` (REQ-749).
 */
export function portraitAreaScale(
  heights: { total: number; areas: number; leastScale?: number },
  pxPerUnit: number,
  available: number,
  screen: number,
): number {
  if (!(heights.areas > 0) || !(pxPerUnit > 0) || !Number.isFinite(available) || !(screen > 0)) return 1;
  const natural = heights.total * pxPerUnit;
  const target = Math.min(natural, Math.max(PORTRAIT_MIN_SCREEN_SHARE * screen, available));
  const fixed = (heights.total - heights.areas) * pxPerUnit;
  const scale = (target - fixed) / (heights.areas * pxPerUnit);
  // Never so low that a shape in an area gets a negative height (REQ-749): then the page scrolls.
  return Math.min(1, Math.max(heights.leastScale ?? MIN_AREA_SCALE, scale));
}

/** Height (CSS px) of the embedded chart, `heights` in viewBox units at `pxPerUnit` CSS px each, with areas `scale` times as high. */
export function portraitChartHeight(heights: { total: number; areas: number }, pxPerUnit: number, scale: number): number {
  return (heights.total - heights.areas * (1 - scale)) * pxPerUnit;
}
