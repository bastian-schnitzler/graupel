// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * The standard hover tooltip as plain DOM: rows, groups and dividers with
 * stable class names, so a page can restyle it. The default look comes from
 * inline styles with CSS custom properties (`--graupel-tooltip-*`).
 *
 * Every text and spacing is in `em` of the box's font size, so one value
 * sizes the whole tooltip: `--graupel-tooltip-font-size`, else the size the
 * controller sets (the left axis labels as rendered, REQ-487), else 0.78rem.
 */
import { formatTooltipHeaderDate, getCardinalDirection } from "../core/tooltip";
import { tooltipGroups } from "../layouts/tooltip";
import { renderedFontPx, type MeteogramLayout } from "../core/viewLayout";
import { LIGHT_THEME, type MeteogramTheme } from "../core/theme";
import { BUILTIN_QUANTITY_REGISTRY, type QuantityRegistry } from "../quantities/registry";
import type { MeteogramHoverInfo } from "./hover";

/** Texts of the tooltip; each can be overridden. */
export interface MeteogramTooltipTexts {
  temperature: string;
  apparentTemperature: string;
  /** Dew point, shown while drawn (REQ-676). */
  dewPoint: string;
  /** Dew point spread: temperature minus dew point (REQ-676). */
  dewPointSpread: string;
  /** Relative humidity, shown while drawn (REQ-676). */
  relativeHumidity: string;
  windSpeed: string;
  windGusts: string;
  windDirection: string;
  precipitationProbability: string;
  precipitation: string;
  accumulated: string;
  snowfall: string;
  snowDepth: string;
  accumulatedSnowfall: string;
  cape: string;
  cin: string;
  lpi: string;
  noModel: string;
}

export const DEFAULT_TOOLTIP_TEXTS: MeteogramTooltipTexts = {
  temperature: "Temperature:",
  apparentTemperature: "Apparent Temp:",
  dewPoint: "Dew Point:",
  dewPointSpread: "Dew Point Spread:",
  relativeHumidity: "Rel. Humidity:",
  windSpeed: "Wind Speed:",
  windGusts: "Wind Gusts:",
  windDirection: "Direction:",
  precipitationProbability: "Precip. Prob:",
  precipitation: "Precipitation:",
  accumulated: "Accumulated:",
  snowfall: "Snowfall:",
  snowDepth: "Snow depth:",
  accumulatedSnowfall: "Accumulated Snowfall:",
  cape: "CAPE:",
  cin: "CIN:",
  lpi: "LPI:",
  noModel: "N/A",
};

const v = (name: string, fallback: string) => `var(--graupel-tooltip-${name}, ${fallback})`;

/** Default look of the tooltip box (position is set separately). */
export const TOOLTIP_STYLE: Record<string, string> = {
  position: "absolute",
  "pointer-events": "none",
  "z-index": "1000",
  "font-size": v("font-size", "0.78rem"),
  "min-width": "17.5em",
  width: "max-content",
  "max-width": "22.5em",
  "box-sizing": "border-box",
  background: v("background", "#1e293b"),
  border: `1px solid ${v("border", "#475569")}`,
  "border-radius": "0.5rem",
  padding: "0.8em 0.95em",
  "box-shadow": "0 0.625rem 1.5625rem rgba(0, 0, 0, 0.6)",
  color: v("text", "#f8fafc"),
  "font-family": "inherit",
  margin: "0",
};

const TEMPERATURE_COLOUR = v("temperature", "#f43f5e");
const WIND_COLOUR = v("wind", "#0ea5e9");

// Value colours per row class; apparent
// temperature and gusts follow temperature and wind (REQ-442) unless their
// own variable is set.
const VALUE_COLOURS: Record<string, string> = {
  temp: TEMPERATURE_COLOUR,
  "apparent-temp": `var(--graupel-tooltip-apparent-temperature, ${TEMPERATURE_COLOUR})`,
  wind: WIND_COLOUR,
  gust: `var(--graupel-tooltip-gust, ${WIND_COLOUR})`,
  precip: v("precipitation", "#3b82f6"),
  prob: v("probability", "#38bdf8"),
  cape: v("cape", "#f59e0b"),
  cin: v("cin", "#0284c7"),
};

/**
 * Font size of the tooltip box (CSS value): the left axis labels as the chart
 * draws them on screen (`theme.fontSizes.axis` in viewBox units, scaled like
 * the chart, REQ-487), unless `--graupel-tooltip-font-size` sets one.
 */
export function tooltipFontSize(scene: { theme: MeteogramTheme; pixelLayout: MeteogramLayout }): string {
  const px = Math.round(renderedFontPx(scene.pixelLayout, scene.theme.fontSizes.axis) * 100) / 100;
  return v("font-size", `${px}px`);
}

function setStyle(element: HTMLElement, style: Record<string, string>) {
  for (const [name, value] of Object.entries(style)) element.style.setProperty(name, value);
}

function el(
  doc: Document,
  tag: string,
  className: string | null,
  style: Record<string, string> | null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElement {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (style) setStyle(element, style);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

/** Unit of a quantity from the registry, else from the built-in one. */
const unitOf = (quantity: string, registry: QuantityRegistry) =>
  registry.get(quantity)?.unit ?? BUILTIN_QUANTITY_REGISTRY.get(quantity)?.unit ?? "";

const formatValue = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : String(value);

/** A value rounded to one decimal, as the temperature shows (REQ-676). */
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Fills `container` with the tooltip content for `info`. Returns false (and
 * leaves the container empty) when there is nothing to show. `theme` gives the
 * colours of the dew point and relative humidity rows, those of their lines
 * (default `light`, REQ-676); `--graupel-tooltip-dew-point` and
 * `--graupel-tooltip-relative-humidity` override them.
 */
export function renderTooltipContent(
  container: HTMLElement,
  info: MeteogramHoverInfo,
  options: { quantities: QuantityRegistry; texts?: Partial<MeteogramTooltipTexts>; theme?: MeteogramTheme },
): boolean {
  container.replaceChildren();
  const { data, dateParts, timestamp } = info;
  if (!data || !dateParts || timestamp === null) return false;
  const texts = { ...DEFAULT_TOOLTIP_TEXTS, ...options.texts };
  const doc = container.ownerDocument;
  const layout = info.quantities;
  const has = (quantity: string) => layout.has(quantity);
  // Dew point and relative humidity in the colours of their lines (REQ-676).
  const lines = (options.theme ?? LIGHT_THEME).series;
  const colours: Record<string, string> = {
    ...VALUE_COLOURS,
    "dew-point": v("dew-point", lines["dew_point"] ?? LIGHT_THEME.series["dew_point"]!),
    humidity: v("relative-humidity", lines["relative_humidity"] ?? LIGHT_THEME.series["relative_humidity"]!),
  };

  const row = (
    label: string,
    value: string,
    valueClass: string | null,
    testId?: string,
    valueTestId?: string,
    colour: string | null = valueClass,
  ) => {
    const valueEl = el(
      doc,
      "span",
      `val${valueClass ? ` ${valueClass}` : ""}`,
      { "font-weight": "600", color: (colour && colours[colour]) || v("text", "#f8fafc") },
      value,
    );
    if (valueTestId) valueEl.dataset.testid = valueTestId;
    const rowEl = el(
      doc,
      "div",
      "tooltip-row",
      { display: "flex", "justify-content": "space-between", "align-items": "center", gap: "1em" },
      el(doc, "span", "label", { color: v("label", "#94a3b8") }, label),
      valueEl,
    );
    if (testId) rowEl.dataset.testid = testId;
    return rowEl;
  };
  const divider = (group: string) => {
    const div = el(doc, "div", "tooltip-group-divider", {
      height: "0",
      "border-top": `1px solid ${v("divider", "#475569")}`,
      margin: "0.15em 0",
    });
    div.dataset.testid = `tooltip-divider-${group}`;
    return div;
  };
  const value = (quantity: string) => data[quantity]?.value;
  const unit = (quantity: string) => unitOf(quantity, options.quantities);

  const header = el(
    doc,
    "div",
    "tooltip-header",
    {
      "padding-bottom": "0.5em",
      "margin-bottom": "0.5em",
      "border-bottom": `1px solid ${v("divider", "#334155")}`,
    },
    el(
      doc,
      "strong",
      null,
      null,
      `${formatTooltipHeaderDate(new Date(timestamp), info.timezone, info.locale)} — ${dateParts.hour}:${dateParts.minute}`,
    ),
  );
  const runInfo = info.runInfo
    ? el(doc, "div", "tooltip-run-info", { "font-weight": "400", "font-size": "0.85em", opacity: "0.8" }, info.runInfo)
    : null;
  if (runInfo) runInfo.dataset.testid = "tooltip-run-info";
  const title = el(
    doc,
    "div",
    "tooltip-section-title",
    { "font-weight": "700", "margin-bottom": "0.3em" },
    info.model ?? texts.noModel,
    runInfo,
  );

  // One popup row of a layout entry: shown or not, and whether it shows its group (a group with no such row stays
  // hidden with its divider, REQ-495; the snow depth shows only with snow, the sums never alone).
  type Entry = { row: HTMLElement | null; opens: boolean };
  const shown = (element: HTMLElement): Entry => ({ row: element, opens: true });
  const hidden: Entry = { row: null, opens: false };
  const entry = (quantity: string): Entry => {
    switch (quantity) {
      case "temperature":
        return has(quantity) ? shown(row(texts.temperature, `${formatValue(value(quantity))} ${unit(quantity)}`, "temp")) : hidden;
      case "apparent_temperature":
        return has(quantity) && value(quantity) != null
          ? shown(row(texts.apparentTemperature, `${value(quantity)} ${unit(quantity)}`, "temp", undefined, undefined, "apparent-temp"))
          : hidden;
      // Dew point, its spread and the relative humidity (REQ-676): the scene leaves their rows out while they are not
      // drawn; an hour without a value (a gap in the line) has no row.
      case "dew_point":
        return has(quantity) && value(quantity) != null
          ? shown(row(texts.dewPoint, `${value(quantity)} ${unit(quantity)}`, "dew-point", `tooltip-row-${quantity}`))
          : hidden;
      case "dew_point_spread": {
        const temperature = value("temperature");
        const dewPoint = value("dew_point");
        return has("temperature") && has("dew_point") && temperature != null && dewPoint != null
          ? shown(
              row(texts.dewPointSpread, `${round1(temperature - dewPoint)} ${unit("temperature")}`, "spread", `tooltip-row-${quantity}`),
            )
          : hidden;
      }
      case "relative_humidity":
        return has(quantity) && value(quantity) != null
          ? shown(
              row(texts.relativeHumidity, `${Math.round(value(quantity)!)} ${unit(quantity)}`, "humidity", `tooltip-row-${quantity}`),
            )
          : hidden;
      case "wind_speed":
        return has(quantity) ? shown(row(texts.windSpeed, `${formatValue(value(quantity))} ${unit(quantity)}`, "wind")) : hidden;
      case "wind_gusts":
        return has(quantity) ? shown(row(texts.windGusts, `${formatValue(value(quantity))} ${unit(quantity)}`, "gust")) : hidden;
      case "wind_direction":
        return has(quantity) ? shown(row(texts.windDirection, getCardinalDirection(value(quantity) ?? null), "dir")) : hidden;
      case "precipitation_probability":
        return has(quantity)
          ? shown(row(texts.precipitationProbability, `${formatValue(value(quantity))} ${unit(quantity)}`, "prob"))
          : hidden;
      case "precipitation":
        return has(quantity)
          ? shown(row(texts.precipitation, `${formatValue(value(quantity))} ${unit(quantity)}`, "precip"))
          : hidden;
      case "precipitation_sum":
        return has("precipitation") && info.accumulatedPrecip !== null
          ? shown(
              row(
                texts.accumulated,
                `${parseFloat(info.accumulatedPrecip.toFixed(2))} ${unit("precipitation")}`,
                "precip",
                "accumulated-precip-row",
                "accumulated-precip-val",
              ),
            )
          : hidden;
      case "snowfall":
        return has(quantity) && (value(quantity) ?? 0) > 0
          ? shown(row(texts.snowfall, `${value(quantity)} ${unit(quantity)}`, null, "snowfall-row"))
          : hidden;
      case "snow_depth":
        return has(quantity) && value(quantity) != null
          ? {
              row: row(texts.snowDepth, `${value(quantity)} ${unit(quantity)}`, null, "snow-depth-row"),
              opens: (value(quantity) ?? 0) > 0,
            }
          : hidden;
      case "snowfall_sum":
        return info.accumulatedSnowfall != null
          ? {
              row: row(
                texts.accumulatedSnowfall,
                `${parseFloat(info.accumulatedSnowfall.toFixed(2))} ${unit("snowfall")}`,
                null,
                "accumulated-snowfall-row",
                "accumulated-snowfall-val",
              ),
              opens: false,
            }
          : hidden;
      case "cape":
      case "convective_inhibition": {
        if (!has(quantity)) return hidden;
        const raw = value(quantity);
        // CIN is an energy that holds convection back: shown negative.
        const text = raw != null ? (quantity === "cape" ? raw : -Math.abs(raw)) : "—";
        const isCape = quantity === "cape";
        return shown(
          row(isCape ? texts.cape : texts.cin, `${text} ${unit(quantity)}`, isCape ? "cape" : "cin", undefined, `tooltip-val-${quantity}`),
        );
      }
      case "lightning_potential":
        return info.lpiValue != null
          ? shown(row(texts.lpi, `${info.lpiValue} ${unit(quantity)}`, null, "tooltip-lpi"))
          : hidden;
      default: {
        // Any other quantity: label and unit from the registry.
        if (!has(quantity)) return hidden;
        const definition = options.quantities.get(quantity);
        return shown(
          row(
            `${definition?.label ?? quantity}:`,
            `${formatValue(value(quantity))} ${definition?.unit ?? ""}`.trimEnd(),
            null,
            `tooltip-row-${quantity}`,
          ),
        );
      }
    }
  };

  // Groups in display order; the divider after a group is named after it (`tooltip-divider-<group>`) and goes
  // only between groups that show rows (REQ-495): never after the last visible group, never twice.
  const groups = info.tooltip ?? tooltipGroups(null, layout);
  const rows: HTMLElement[] = [];
  let previous: string | null = null;
  for (const group of groups) {
    const entries = group.rows.map(entry);
    if (!entries.some((item) => item.opens)) continue;
    if (previous) rows.push(divider(previous));
    for (const item of entries) if (item.row) rows.push(item.row);
    previous = group.group;
  }

  container.append(
    header,
    title,
    el(doc, "div", "tooltip-grid", { display: "flex", "flex-direction": "column", gap: "0.3em" }, ...rows),
  );
  return true;
}
