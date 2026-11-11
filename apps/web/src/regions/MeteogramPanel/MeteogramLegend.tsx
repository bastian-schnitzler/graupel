// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Legend of the meteogram (REQ-639): names the quantities the chart on the page draws right now, each with its line,
 * bars or symbol in the colour and dash of the chart. Which ones it lists follows the drawn chart (`useDrawnLegend`):
 * the dew point only while the chart shows it (also with Auto), the relative humidity only while it is on (REQ-650),
 * snow, thunderstorms or the current-time line only where the chart has them. Colours, stroke widths and dashes come
 * from the theme and the series presets of @graupel/meteogram, as the chart takes them.
 *
 * On the desktop it floats left of the meteogram card in the page's free margin (`side`), on a narrow page it is a
 * card of its own directly above the meteogram (`card`). Where the desktop's margin is too narrow for it, it is such a
 * card as well, as wide as the meteogram, its groups side by side (`wide`, REQ-670). An X at the top right closes it and
 * switches the setting "Show the legend" off; the settings popup switches it back on.
 *
 * Its entries stand in groups, one for each area of the chart in the chart's order (temperature, precipitation and
 * clouds, wind), each entry in the group of the area it is drawn in, and last the marks across the whole chart
 * (REQ-674): the weather model (the model headers), now, sunrise and sunset, daylight (REQ-679). The groups are set
 * apart in every place the legend stands.
 *
 * While the chart draws the model headers, the last group starts with an entry for them (REQ-677), "Weather model": a
 * box in the colour of the first header with white letters, "IFS" as an example (REQ-678, DEC-071).
 *
 * On a tablet in landscape the card is as wide as the page; there its groups stand in four columns side by side in the
 * legend's order, temperature, precipitation, wind and the time marks last, also without the dew point and the
 * relative humidity (`legendColumns`, REQ-756, REQ-763).
 */
import {
  DEFAULT_FILL_OPACITY,
  getSeriesColor,
  getSeriesDashArray,
  getSeriesPreset,
  resolveMeteogramTheme,
  WIND_ICON_RADIUS_PX,
  type MeteogramInput,
  type MeteogramTheme,
  type MeteogramThemeInput,
} from "@graupel/meteogram";
import { useId, useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { useI18n, type MessageKey } from "../../i18n/index.ts";
import { CloseIcon } from "../../icons/index.ts";
import { TEXT_LIGHT } from "../../state/index.ts";
import { PORTRAIT_MIN_SCREEN_SHARE } from "./layout.ts";
import type { PortraitSpace } from "./usePortraitSpace.ts";

/** What the legend can name (REQ-674); their order within a group is that of `LEGEND_ITEMS`. */
export type LegendKey =
  | "temperature"
  | "apparentTemperature"
  | "dewPoint"
  | "relativeHumidity"
  | "precipitation"
  | "snow"
  | "precipitationProbability"
  | "clouds"
  | "thunderstorm"
  | "wind"
  | "gusts"
  | "windDirection"
  | "daylight"
  | "sunTimes"
  | "now"
  | "modelHeader";

/**
 * Group of an entry where the chart does not say it (REQ-674): the area it is drawn in, as the built-in layouts have
 * it, for a drawing outside every area; `time` for the time marks across the whole chart, always the last group.
 */
export type LegendFallbackGroup = "temperature" | "precipitation" | "wind" | "time";

interface LegendItem {
  key: LegendKey;
  /** What the chart draws for it (the chart's own test ids): listed while one of them is in the chart. */
  selector: string;
  label: MessageKey;
  group: LegendFallbackGroup;
}

/** The current-time line; while the mouse is over the chart its cursor line takes that place. */
const NOW_LINE = '[data-testid="current-time-cursor-line"]';
const HOVER_LINE = '[data-testid="hover-cursor-line"]';

export const LEGEND_ITEMS: readonly LegendItem[] = [
  {
    key: "temperature",
    selector: '[data-testid="temperature-path"]',
    label: "meteogram.legend.temperature",
    group: "temperature",
  },
  {
    key: "apparentTemperature",
    selector: '[data-testid="apparent-temperature-path"]',
    label: "meteogram.legend.apparentTemperature",
    group: "temperature",
  },
  {
    key: "dewPoint",
    selector: '[data-testid="dew-point-path"]',
    label: "meteogram.legend.dewPoint",
    group: "temperature",
  },
  {
    key: "relativeHumidity",
    selector: '[data-testid="relative-humidity-path"]',
    label: "meteogram.legend.relativeHumidity",
    group: "temperature",
  },
  // Rain bars; the snow hours of the same bars are white with an outline.
  {
    key: "precipitation",
    selector: '[data-testid="precip-bar"][stroke="none"], [data-testid$="-bar-rain"]',
    label: "meteogram.legend.precipitation",
    group: "precipitation",
  },
  {
    key: "snow",
    selector: '[data-testid="precip-bar"]:not([stroke="none"]), [data-testid="snowfall-bar"]',
    label: "meteogram.legend.snow",
    group: "precipitation",
  },
  {
    key: "precipitationProbability",
    selector: '[data-testid="precip-probability-path"]',
    label: "meteogram.legend.precipitationProbability",
    group: "precipitation",
  },
  {
    key: "clouds",
    selector: '[data-testid="vertical-cloud-cell"]',
    label: "meteogram.legend.clouds",
    group: "precipitation",
  },
  {
    key: "thunderstorm",
    selector: '[data-testid="thunderstorm-icon"]',
    label: "meteogram.legend.thunderstorm",
    group: "precipitation",
  },
  { key: "wind", selector: '[data-testid="wind-speed-path"]', label: "meteogram.legend.wind", group: "wind" },
  { key: "gusts", selector: '[data-testid="wind-gusts-path"]', label: "meteogram.legend.gusts", group: "wind" },
  {
    key: "windDirection",
    selector: '[data-testid="wind-arrow"]',
    label: "meteogram.legend.windDirection",
    group: "wind",
  },
  // The marks across the whole chart, in this order (REQ-679): the model headers above the chart (REQ-677), the current
  // time, sunrise and sunset, daylight.
  {
    key: "modelHeader",
    selector: '[data-testid="model-label-segment"]',
    label: "meteogram.legend.modelHeader",
    group: "time",
  },
  { key: "now", selector: NOW_LINE, label: "meteogram.legend.now", group: "time" },
  {
    key: "sunTimes",
    selector: '[data-testid="sun-time-labels"] text',
    label: "meteogram.legend.sunTimes",
    group: "time",
  },
  { key: "daylight", selector: '[data-testid="daylight-stripe"]', label: "meteogram.legend.daylight", group: "time" },
];

/** Text of each entry. */
const LABELS = Object.fromEntries(LEGEND_ITEMS.map(({ key, label }) => [key, label])) as Record<LegendKey, MessageKey>;

/**
 * Shorter texts in the narrow page's card, where its two columns have little room: "Direction" for the wind arrows,
 * in every language the short form (REQ-720).
 */
const NARROW_LABELS: Partial<Record<LegendKey, MessageKey>> = {
  windDirection: "meteogram.legend.windDirectionShort",
};

/** Text of an entry: on the narrow page's card its short form where it has one (REQ-720), else the full text. */
export function legendLabel(key: LegendKey, narrowCard: boolean): MessageKey {
  return (narrowCard && NARROW_LABELS[key]) || LABELS[key];
}

/** Whether `element` draws something: a path needs a path. */
const draws = (element: Element) => element.tagName.toLowerCase() !== "path" || Boolean(element.getAttribute("d"));

/** Line style of the current-time line as the chart draws it. */
export interface NowLineStyle {
  dashArray: string | null;
  strokeWidth: string | null;
}

/** A group of the legend (REQ-674): its entries in order, and the area of the chart they are drawn in. */
export interface LegendGroup {
  /** The area's id in the chart's layout (`data-area-id`), else the entries' `LegendFallbackGroup`. */
  id: string;
  keys: readonly LegendKey[];
}

/**
 * The first model header the chart draws (REQ-677): its model (`data-model`, the chain's model name) and the colour of
 * its box, as the chart filled it.
 */
export interface DrawnModelHeader {
  model: string;
  color: string | null;
}

/**
 * What the chart in `root` draws: the legend's keys in order, in groups, the style of its current-time line and its
 * first model header.
 */
export interface DrawnLegend {
  keys: readonly LegendKey[];
  groups: readonly LegendGroup[];
  now: NowLineStyle | null;
  header: DrawnModelHeader | null;
}

/** An area of the chart: the group of the chart's panel, with the id of its area in the layout. */
const AREA = "[data-area-id]";
const FALLBACK_ORDER: readonly LegendFallbackGroup[] = ["temperature", "precipitation", "wind", "time"];

/**
 * The legend's entries for the chart in `root`. While the mouse is over the chart its cursor line stands in place of
 * the current-time line, which then counts as drawn when it was before (`nowBefore`).
 *
 * The entries are grouped by the area of the chart they are drawn in, the groups in the order of the areas in the chart
 * (REQ-674): so the dew point and the relative humidity stand with the temperature, the cloud cover with the
 * precipitation, as the layout draws them. The marks across the whole chart (model headers, now, sunrise and sunset,
 * daylight) form the last group, even where an area draws one of them (the sun times in the temperature area). An entry
 * drawn outside every area keeps the group of its `LEGEND_ITEMS` entry, after the chart's areas. Groups without an
 * entry are left out; within a group the entries keep the order of `LEGEND_ITEMS`: the model headers (REQ-677) first in
 * the last group, then the current time, the sun times and daylight (REQ-679).
 */
export function drawnLegend(root: ParentNode, nowBefore: NowLineStyle | null = null): DrawnLegend {
  const areas = [...root.querySelectorAll(AREA)].map((area) => area.getAttribute("data-area-id") ?? "");
  const groups = new Map<string, { rank: number; keys: LegendKey[] }>();
  const add = (key: LegendKey, id: string, rank: number) => {
    const group = groups.get(id) ?? { rank, keys: [] };
    group.keys.push(key);
    groups.set(id, group);
  };
  /** Rank of a group without an area of the chart: after the chart's areas, the time marks last. */
  const fallbackRank = (group: LegendFallbackGroup) => areas.length + FALLBACK_ORDER.indexOf(group);
  const line = root.querySelector(NOW_LINE);
  const now: NowLineStyle | null = line
    ? { dashArray: line.getAttribute("stroke-dasharray"), strokeWidth: line.getAttribute("stroke-width") }
    : root.querySelector(HOVER_LINE)
      ? nowBefore
      : null;
  for (const { key, selector, group } of LEGEND_ITEMS) {
    if (key === "now") {
      if (now) add("now", "time", fallbackRank("time"));
      continue;
    }
    const first = root.querySelector(selector);
    if (first === null) continue;
    const drawn = draws(first) ? first : [...root.querySelectorAll(selector)].find(draws);
    if (!drawn) continue;
    const area = group === "time" ? null : drawn.closest(AREA);
    const id = area?.getAttribute("data-area-id");
    if (area && id != null) add(key, id, areas.indexOf(id));
    else add(key, group, fallbackRank(group));
  }
  const sorted = [...groups].sort(([, a], [, b]) => a.rank - b.rank).map(([id, { keys }]) => ({ id, keys }));
  return { keys: sorted.flatMap((group) => group.keys), groups: sorted, now, header: firstHeader(root) };
}

/** The first model header the chart in `root` draws (the chain's first model with a span), if any (REQ-677). */
function firstHeader(root: ParentNode): DrawnModelHeader | null {
  const segment = root.querySelector('[data-testid="model-label-segment"]');
  const model = segment?.getAttribute("data-model");
  if (!segment || !model) return null;
  return { model, color: segment.querySelector('[data-testid="model-header-shape"]')?.getAttribute("fill") ?? null };
}

/**
 * Letters from the name a model header shows (REQ-677): the first `max` letters or digits of its first word, e.g. "AR"
 * for "AROME HD", "IC" for "ICON-D2", "D2" for "D2"; with `max` 3 "ARO", "ICO".
 */
export function modelHeaderLetters(name: string, max = 2): string {
  const word = name.trim().split(/\s+/)[0] ?? "";
  return [...word]
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .slice(0, max)
    .join("");
}

/**
 * What the box of the legend's entry "Weather model" shows (REQ-678, DEC-071): always the example "IFS"
 * (`"example"`), or the letters of the first model's name, up to three (`"firstModel"`).
 */
export type ModelHeaderLettersSource = "example" | "firstModel";

/** The choice of DEC-071: the first model's letters, up to three (e.g. IFS, ICO, ARO). */
export const MODEL_HEADER_LETTERS_SOURCE: ModelHeaderLettersSource = "firstModel";
/** The example in the box (REQ-678). */
export const MODEL_HEADER_EXAMPLE = "IFS";
/** Most letters in the box: as many as the example has. */
export const MODEL_HEADER_MAX_LETTERS = 3;

/** The letters in the box of the entry "Weather model" for a first header named `firstName` (REQ-678, DEC-071). */
export function legendModelLetters(
  firstName: string,
  source: ModelHeaderLettersSource = MODEL_HEADER_LETTERS_SOURCE,
): string {
  return source === "example" ? MODEL_HEADER_EXAMPLE : modelHeaderLetters(firstName, MODEL_HEADER_MAX_LETTERS);
}

/** Area of the chart each entry is drawn in where the chart does not say it. */
const FALLBACK_GROUPS = Object.fromEntries(LEGEND_ITEMS.map(({ key, group }) => [key, group])) as Record<
  LegendKey,
  LegendFallbackGroup
>;

/** The columns of the card on a tablet in landscape, by the area of their groups (REQ-763). */
const COLUMN_ORDER: readonly LegendFallbackGroup[] = ["temperature", "precipitation", "wind", "time"];

/**
 * The groups of the card on a tablet in landscape in their columns: always four, with or without the dew point and
 * the relative humidity (REQ-763, replacing the three columns of REQ-756), in the order of the legend elsewhere
 * (REQ-674): the temperature, the precipitation, the wind, the time marks (weather model, now, sunrise and sunset,
 * daylight) last. A group is placed by the area of its first entry (the time marks by their id); the groups keep their
 * entries, columns without a group are left out.
 */
export function legendColumns(groups: readonly LegendGroup[]): LegendGroup[][] {
  const kind = (group: LegendGroup): LegendFallbackGroup =>
    group.id === "time" ? "time" : FALLBACK_GROUPS[group.keys[0] ?? "temperature"];
  return COLUMN_ORDER.map((wanted) => groups.filter((group) => kind(group) === wanted)).filter(
    (column) => column.length > 0,
  );
}

/** The groups of `drawn` as text, to tell a change. */
const groupsText = (drawn: DrawnLegend) => drawn.groups.map((group) => `${group.id}:${group.keys.join()}`).join("|");

const sameNow = (a: NowLineStyle | null, b: NowLineStyle | null) =>
  a === b || (a !== null && b !== null && a.dashArray === b.dashArray && a.strokeWidth === b.strokeWidth);

const sameHeader = (a: DrawnModelHeader | null, b: DrawnModelHeader | null) =>
  a === b || (a !== null && b !== null && a.model === b.model && a.color === b.color);

const EMPTY: DrawnLegend = { keys: [], groups: [], now: null, header: null };

/**
 * What the chart in `containerRef` draws, while `active`; follows every change of the chart (a new forecast, the dew
 * point or the relative humidity switched, another time range). `chartKey` names the chart shown, so a new container
 * is observed.
 */
export function useDrawnLegend(containerRef: RefObject<HTMLElement | null>, active: boolean, chartKey: string) {
  const [drawn, setDrawn] = useState<DrawnLegend>(EMPTY);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!active || !container) {
      setDrawn(EMPTY);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      setDrawn((current) => {
        const next = drawnLegend(container, current.now);
        return groupsText(next) === groupsText(current) &&
          sameNow(next.now, current.now) &&
          sameHeader(next.header, current.header)
          ? current
          : next;
      });
    };
    update();
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    });
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["d", "fill"] });
    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [containerRef, active, chartKey]);
  return active ? drawn : EMPTY;
}

/** Narrowest and widest legend beside the card on the desktop (CSS px), and its gap to the card and the window. */
export const SIDE_LEGEND_MIN_WIDTH = 120;
export const SIDE_LEGEND_MAX_WIDTH = 208;
export const SIDE_LEGEND_GAP = 8;

/**
 * Width of the legend in the free margin left of the card `cardRef` on the desktop, while `active`: the room between
 * the window's left edge (the page's, clear of a notch) and the card, less a gap on each side, at most
 * `SIDE_LEGEND_MAX_WIDTH`. Null where it would be narrower than `SIDE_LEGEND_MIN_WIDTH`: there it is left out.
 */
export function useSideLegendWidth(cardRef: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!active || !card) {
      setWidth(null);
      return;
    }
    const measure = () => {
      const page = card.closest(".app") ?? document.documentElement;
      const left = page.getBoundingClientRect().left + (parseFloat(getComputedStyle(page).paddingLeft) || 0);
      const room = Math.floor(card.getBoundingClientRect().left - left - 2 * SIDE_LEGEND_GAP);
      setWidth(room >= SIDE_LEGEND_MIN_WIDTH ? Math.min(SIDE_LEGEND_MAX_WIDTH, room) : null);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(card);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [cardRef, active]);
  return active ? width : null;
}

/**
 * Whether the legend card fits on a phone in portrait (REQ-639, REQ-608): the page with the card, `room` CSS px high
 * with its gap, still fits the screen with the chart at least 40 % of it. `space` is measured with or without the card
 * (`optional`); `room` is the card's room when it was last shown. Where it does not fit (a low screen, the model
 * chains shown, a keyboard that makes the page lower), the card is left out and the chart keeps its room; the setting
 * stays. Without a measure yet it fits.
 */
export function legendCardFits(space: PortraitSpace | null, room: number | null): boolean {
  if (space === null || room === null) return true;
  const rest = space.rest - space.optional + room;
  return space.screen - rest >= PORTRAIT_MIN_SCREEN_SHARE * space.screen - 0.5;
}

/** Size of a swatch (CSS px). */
const SWATCH_WIDTH = 22;
const SWATCH_HEIGHT = 12;
const MIDDLE = SWATCH_HEIGHT / 2;

/** A line of the series `quantity` as the chart draws it: colour, width, dash and cap. */
function SeriesLine({ quantity, theme, y = MIDDLE }: { quantity: string; theme: MeteogramTheme; y?: number }) {
  const preset = getSeriesPreset(quantity);
  return (
    <line
      x1={1}
      y1={y}
      x2={SWATCH_WIDTH - 1}
      y2={y}
      stroke={getSeriesColor(quantity, null, undefined, theme)}
      strokeWidth={preset.strokeWidth ?? 1.5}
      strokeDasharray={getSeriesDashArray(quantity, undefined)}
      strokeLinecap={preset.lineCap}
    />
  );
}

/** Three bars of different height. */
function Bars(props: { fill: string; stroke?: string; opacity?: number }) {
  return (
    <>
      {[5, 9, 7].map((height, index) => (
        <rect
          key={index}
          x={2.5 + index * 6}
          y={SWATCH_HEIGHT - 0.5 - height}
          width={5}
          height={height}
          fill={props.fill}
          stroke={props.stroke ?? "none"}
          strokeWidth={props.stroke ? 1 : 0}
          opacity={props.opacity}
        />
      ))}
    </>
  );
}

/** The model header entry's box (REQ-677): its colour and letters. */
interface HeaderSwatch {
  color: string;
  letters: string;
}

/** The symbol of an entry, drawn with the theme of the chart. */
function swatch(key: LegendKey, theme: MeteogramTheme, now: NowLineStyle | null, header: HeaderSwatch): ReactNode {
  switch (key) {
    case "temperature":
      return <SeriesLine quantity="temperature" theme={theme} />;
    case "apparentTemperature":
      return <SeriesLine quantity="apparent_temperature" theme={theme} />;
    case "dewPoint":
      // The line with the spread to the temperature above it.
      return (
        <>
          <rect
            x={1}
            y={1}
            width={SWATCH_WIDTH - 2}
            height={MIDDLE + 2}
            fill={getSeriesColor("dew_point", null, undefined, theme)}
            opacity={DEFAULT_FILL_OPACITY}
          />
          <SeriesLine quantity="dew_point" theme={theme} y={MIDDLE + 3} />
        </>
      );
    case "relativeHumidity":
      return <SeriesLine quantity="relative_humidity" theme={theme} />;
    case "precipitation":
      return (
        <Bars
          fill={getSeriesColor("precipitation_rain_snow", null, undefined, theme)}
          opacity={getSeriesPreset("precipitation_rain_snow").opacity}
        />
      );
    case "snow":
      return <Bars fill={theme.snow.fill} stroke={theme.snow.outline} />;
    case "precipitationProbability":
      return <SeriesLine quantity="precipitation_probability" theme={theme} />;
    case "clouds":
      // Cells of the cloud profile, denser the more cloud.
      return (
        <>
          {[0.2, 0.45, 0.7].map((opacity, index) => (
            <rect
              key={index}
              x={1 + index * 7}
              y={1}
              width={6.5}
              height={SWATCH_HEIGHT - 2}
              fill={theme.cloud.fill}
              opacity={opacity}
            />
          ))}
        </>
      );
    case "wind":
      return <SeriesLine quantity="wind_speed" theme={theme} />;
    case "gusts":
      return <SeriesLine quantity="wind_gusts" theme={theme} />;
    case "windDirection": {
      // The chart's circle with the arrow, pointing to the north-east, scaled to the swatch's height.
      const scale = (MIDDLE - 0.5) / WIND_ICON_RADIUS_PX;
      return (
        <g transform={`translate(${SWATCH_WIDTH / 2} ${MIDDLE}) scale(${scale})`}>
          <circle
            r={WIND_ICON_RADIUS_PX}
            fill={theme.windIcon.background}
            stroke={theme.windIcon.outline}
            strokeWidth={0.9}
          />
          <g transform="rotate(45)">
            <line x1={0} y1={4.5} x2={0} y2={-4.5} stroke={theme.windIcon.arrow} strokeWidth={1.62} />
            <polygon points="0,-6.3 -2.7,-1.8 2.7,-1.8" fill={theme.windIcon.arrow} />
          </g>
        </g>
      );
    }
    case "thunderstorm":
      return (
        <g transform={`translate(${SWATCH_WIDTH / 2} ${MIDDLE})`}>
          <circle
            r={MIDDLE - 0.5}
            fill={theme.thunderstormIcon.background}
            stroke={theme.thunderstormIcon.outline}
            strokeWidth={0.6}
          />
          <path
            d="M0.8 -3.6 L-1.4 0.3 H1.4 L-0.8 3.9"
            fill="none"
            stroke={theme.thunderstormIcon.glyph}
            strokeWidth={1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case "daylight":
      return (
        <rect
          x={1}
          y={0}
          width={SWATCH_WIDTH - 2}
          height={SWATCH_HEIGHT}
          fill={theme.daylight.fill}
          opacity={theme.daylight.opacity}
        />
      );
    case "sunTimes":
      return (
        <text
          x={SWATCH_WIDTH / 2}
          y={MIDDLE}
          dominantBaseline="central"
          textAnchor="middle"
          fontSize={7.5}
          fill={theme.sunTimes}
        >
          07:14
        </text>
      );
    case "now":
      return (
        <line
          x1={SWATCH_WIDTH / 2}
          y1={0}
          x2={SWATCH_WIDTH / 2}
          y2={SWATCH_HEIGHT}
          stroke={theme.cursor}
          strokeWidth={now?.strokeWidth ?? undefined}
          strokeDasharray={now?.dashArray ?? undefined}
        />
      );
    case "modelHeader":
      // A small header: the box with rounded top corners in the first header's colour, its letters in white (REQ-678).
      return (
        <>
          <path
            d={`M0 ${SWATCH_HEIGHT} V2 Q0 0 2 0 H${SWATCH_WIDTH - 2} Q${SWATCH_WIDTH} 0 ${SWATCH_WIDTH} 2 V${SWATCH_HEIGHT} Z`}
            fill={header.color}
          />
          <text
            x={SWATCH_WIDTH / 2}
            y={MIDDLE + 0.5}
            dominantBaseline="central"
            textAnchor="middle"
            fontSize={8}
            fontWeight={800}
            fill={TEXT_LIGHT}
          >
            {header.letters}
          </text>
        </>
      );
  }
}

/**
 * The model header entry's box (REQ-677, REQ-678): the colour the chart filled its first header with (else the theme's
 * header colour) and its letters (`legendModelLetters`): the example "IFS", or those of the name the first header
 * shows, the model's short name from the chain, else its name.
 */
function headerSwatch(
  header: DrawnModelHeader | null,
  chain: MeteogramInput["chain"],
  theme: MeteogramTheme,
): HeaderSwatch {
  const entry = header ? chain.find((model) => model.model === header.model) : undefined;
  return {
    color: header?.color ?? theme.modelHeader.background,
    letters: legendModelLetters(entry?.shortName || header?.model || ""),
  };
}

export interface MeteogramLegendProps {
  /** What the chart draws (`useDrawnLegend`). */
  drawn: DrawnLegend;
  /** Theme option of the chart (`theme` of its render options). */
  theme: MeteogramThemeInput | null | undefined;
  /** Beside the card on the desktop, or a card of its own above the meteogram on a narrow page. */
  variant: "side" | "card";
  /**
   * The card on a page wider than a narrow one, i.e. on the desktop: as wide as the meteogram (REQ-670), its groups
   * side by side (REQ-674).
   */
  wide?: boolean;
  /** Width beside the card (`useSideLegendWidth`). */
  width?: number;
  /** The narrow page's card on a tablet in landscape: its groups in four columns (REQ-756, REQ-763). */
  columns?: boolean;
  /** The chart's weather chain: the short names of the models behind the headers (REQ-677). */
  chain?: MeteogramInput["chain"];
  onClose: () => void;
}

const NO_CHAIN: MeteogramInput["chain"] = [];

export function MeteogramLegend({
  drawn,
  theme,
  variant,
  wide = false,
  width,
  columns = false,
  chain = NO_CHAIN,
  onClose,
}: MeteogramLegendProps) {
  const { t } = useI18n();
  const titleId = useId();
  const resolved = useMemo(() => resolveMeteogramTheme(theme), [theme]);
  const header = useMemo(() => headerSwatch(drawn.header, chain, resolved), [drawn.header, chain, resolved]);
  const wideCard = wide && variant === "card";
  const narrowCard = !wide && variant === "card";
  const tabletColumns = narrowCard && columns ? legendColumns(drawn.groups) : null;
  const list = (group: LegendGroup) => (
    <ul key={group.id} className="meteogram-legend__items" data-group={group.id}>
      {group.keys.map((key) => (
        <li key={key} className="meteogram-legend__item" data-key={key}>
          <svg
            className="meteogram-legend__swatch"
            width={SWATCH_WIDTH}
            height={SWATCH_HEIGHT}
            viewBox={`0 0 ${SWATCH_WIDTH} ${SWATCH_HEIGHT}`}
            aria-hidden="true"
            focusable="false"
          >
            {swatch(key, resolved, drawn.now, header)}
          </svg>
          <span>{t(legendLabel(key, narrowCard))}</span>
        </li>
      ))}
    </ul>
  );
  const modifier = wideCard ? " meteogram-legend--wide" : tabletColumns ? " meteogram-legend--columns" : "";
  return (
    <aside
      className={`meteogram-legend meteogram-legend--${variant}${modifier}`}
      aria-labelledby={titleId}
      style={width !== undefined ? { width } : undefined}
      data-testid="meteogram-legend"
      data-variant={variant}
      data-columns={tabletColumns?.length}
      // The phone's chart may take the card's room back where the page would not fit the screen otherwise.
      data-portrait-optional={variant === "card" ? "" : undefined}
    >
      {/* On the narrow page's card the title is only read out; the card keeps its height for the chart (REQ-608). */}
      <h2 id={titleId} className={variant === "card" ? "visually-hidden" : "meteogram-legend__title"}>
        {t("meteogram.legend.title")}
      </h2>
      <button
        type="button"
        className="icon-button meteogram-legend__close"
        aria-label={t("meteogram.legend.close")}
        title={t("meteogram.legend.close")}
        onClick={onClose}
        data-testid="meteogram-legend-close"
      >
        <CloseIcon width={16} height={16} />
      </button>
      {/* One list for each area of the chart, set apart from each other (REQ-674); on a tablet turned, in columns. */}
      <div className="meteogram-legend__groups">
        {tabletColumns
          ? tabletColumns.map((column) => (
              <div key={column[0]!.id} className="meteogram-legend__column">
                {column.map(list)}
              </div>
            ))
          : drawn.groups.map(list)}
      </div>
    </aside>
  );
}
