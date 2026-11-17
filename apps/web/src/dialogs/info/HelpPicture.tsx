// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pictures of the Help tab (REQ-819), drawn like the install steps (REQ-775, InstallPicture.tsx): inline SVG in the
 * colours of the page, so they follow the light and dark design, with the controls the text explains highlighted in
 * the app's orange. Each shows the part of the page its section explains, as the page shows it: the place row with
 * the clock of the installed app (on a phone its menu), only the model chains shown, the day slider of the device and
 * the meteogram with its three areas, numbered as in the text. Decorative: the text beside each says the same.
 */
import type { ReactNode } from "react";
import { HitCircle, HitRect, Label, useSvgId } from "../install/InstallPicture.tsx";
import type { HelpContext, HelpSection } from "./HelpPanel.tsx";
import {
  CLOUD_COLUMN_HOURS,
  CLOUD_LAYERS,
  CLOUDS,
  DAY_HOURS,
  HELP_WEATHER,
  HOURS,
  TEMPERATURE_RANGE,
  valueAt,
  WIND_DIRECTION,
  WIND_MAX,
} from "./helpWeather.ts";
import "../pictures.css";

/** Width of every picture (user units); the height depends on the section. */
const WIDTH = 200;

/** An hourly `series` from `x0` to `x1` (one point per hour), its values placed by `y`, as an SVG path. */
export function seriesPath(series: readonly number[], x0: number, x1: number, y: (value: number) => number): string {
  return series
    .map((value, hour) => `${hour === 0 ? "M" : "L"}${(x0 + ((x1 - x0) * hour) / HOURS).toFixed(1)} ${y(value).toFixed(1)}`)
    .join("");
}

/** A frame like the install pictures': the page's background, rounded, with a thin border. */
function Frame({ section, height, children }: { section: HelpSection; height: number; children: ReactNode }) {
  const clip = useSvgId();
  return (
    <svg
      className="help__picture"
      viewBox={`0 0 ${WIDTH} ${height}`}
      aria-hidden="true"
      focusable="false"
      data-help-picture={section}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={0} y={0} width={WIDTH} height={height} rx={9} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width={WIDTH} height={height} className="ip-screen" />
        {children}
      </g>
      <rect x={0.75} y={0.75} width={WIDTH - 1.5} height={height - 1.5} rx={8.5} className="ip-frame" />
    </svg>
  );
}

/** Glyphs of the page's controls, centred on 0,0 and about 10 units large. */
type GlyphName = "gps" | "close" | "map" | "chevron" | "pencil" | "clock" | "menu";

const GLYPHS: Readonly<Record<GlyphName, string>> = {
  gps: "M0 -5.5V-3M0 3V5.5M-5.5 0H-3M3 0H5.5M3 0A3 3 0 1 1 -3 0A3 3 0 1 1 3 0",
  close: "M-3 -3L3 3M3 -3L-3 3",
  map: "M-5 -3.5L-1.7 -5L1.7 -3.5L5 -5V3.5L1.7 5L-1.7 3.5L-5 5ZM-1.7 -5V3.5M1.7 -3.5V5",
  // The favourites' dropdown arrow, smaller than the other glyphs as on the page (REQ-857).
  chevron: "M-2.2 -1.1L0 1.1L2.2 -1.1",
  pencil: "M-4 4L-3.5 1.5L2 -4L4 -2L-1.5 3.5ZM0.5 -2.5L2.5 -0.5",
  clock: "M4.5 0A4.5 4.5 0 1 1 -4.5 0A4.5 4.5 0 1 1 4.5 0M0 -2.8V0L2 1.4",
  menu: "M-4.5 -3H4.5M-4.5 0H4.5M-4.5 3H4.5",
};

function Glyph({ name, x, y }: { name: GlyphName; x: number; y: number }) {
  return <path transform={`translate(${x} ${y})`} className="ip-glyph" d={GLYPHS[name]} data-glyph={name} />;
}

/** The favourite's star, filled in gold as on a favourite place. */
function Star({ x, y, r = 4.5 }: { x: number; y: number; r?: number }) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(x + radius * Math.cos(angle)).toFixed(2)},${(y + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return <polygon points={points.join(" ")} className="hp-star" />;
}

/** A square button with a glyph. */
function Button({ x, y, size, glyph, hit = false }: { x: number; y: number; size: number; glyph: GlyphName; hit?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={4} className="ip-field" />
      {hit && <HitRect x={x - 2} y={y - 2} width={size + 4} height={size + 4} />}
      <Glyph name={glyph} x={x + size / 2} y={y + size / 2} />
    </g>
  );
}

/**
 * 1. The place row: the search field with the current position at its start, the map, the favourites' split button
 * (star and arrow, highlighted as a whole like the map, REQ-857; its list with the pencil that renames a favourite)
 * and, in the installed app, the clock of the history (on a phone the menu, where the history is).
 */
function PlacePicture({ context }: { context: HelpContext }) {
  const height = 84;
  const row = 10;
  const size = 20;
  const gap = 4;
  // Between two highlighted buttons (map, favourites, clock), so that their highlights stay apart.
  const hitGap = 7;
  const right = WIDTH - 8;
  const phone = context.device === "phone";
  // From the right: the clock (installed app) or the phone's menu, the favourites, the map; the field takes the rest.
  const end = context.installed || phone ? right - size : right + gap;
  const splitWidth = 33;
  const starWidth = 21;
  const splitX = end - (context.installed ? hitGap : gap) - splitWidth;
  const mapX = splitX - hitGap - size;
  const fieldRight = mapX - gap;
  const middle = row + size / 2;
  const listY = row + size + 4;
  return (
    <Frame section="place" height={height}>
      <rect x={8} y={row} width={fieldRight - 8} height={size} rx={4} className="ip-field" />
      <HitCircle x={19} y={middle} r={7.5} />
      <Glyph name="gps" x={19} y={middle} />
      <Label x={30} y={middle} text="Mont Blanc" max={fieldRight - 44} anchor="start" size={7.5} />
      <Glyph name="close" x={fieldRight - 10} y={middle} />
      <Button x={mapX} y={row} size={size} glyph="map" hit />
      <rect x={splitX} y={row} width={splitWidth} height={size} rx={4} className="ip-field" data-favourites="" />
      <rect
        x={splitX + starWidth}
        y={row + 0.4}
        width={splitWidth - starWidth - 0.4}
        height={size - 0.8}
        rx={3.6}
        className="ip-pressed"
      />
      <line x1={splitX + starWidth} y1={row} x2={splitX + starWidth} y2={row + size} className="hp-divider" />
      <HitRect x={splitX - 2} y={row - 2} width={splitWidth + 4} height={size + 4} />
      <Star x={splitX + starWidth / 2} y={middle} />
      <Glyph name="chevron" x={splitX + (starWidth + splitWidth) / 2} y={middle} />
      {/* The favourites' list below the arrow: the favourites, the place shown with its pencil. */}
      <rect x={splitX - 34} y={listY} width={splitWidth + 34} height={height - listY - 6} rx={4} className="ip-menu" />
      {[0, 1, 2].map((index) => {
        const y = listY + 9 + index * 13;
        return (
          <g key={index}>
            <Star x={splitX - 26} y={y} r={3} />
            <rect x={splitX - 19} y={y - 1.5} width={index === 0 ? 30 : 24 + index * 4} height={3} rx={1.5} className="ip-line" />
            {index === 0 && (
              <g>
                <HitCircle x={splitX + splitWidth - 9} y={y} r={6} />
                <Glyph name="pencil" x={splitX + splitWidth - 9} y={y} />
              </g>
            )}
          </g>
        );
      })}
      {context.installed ? (
        <Button x={right - size} y={row} size={size} glyph={phone ? "menu" : "clock"} hit />
      ) : phone ? (
        <Button x={right - size} y={row} size={size} glyph="menu" />
      ) : null}
    </Frame>
  );
}

/** Spans of the models in a chain (shares of the width) and their hours. */
const CHAIN = [
  { share: 0.3, hours: "0–51 h" },
  { share: 0.28, hours: "51–120 h" },
  { share: 0.42, hours: "120–360 h" },
] as const;

/** One chain card: three models, their spans and the boundaries between them, highlighted. */
function ChainRow({ y, kind }: { y: number; kind: "weather" | "cloud" }) {
  const left = 22;
  const width = WIDTH - 8 - left;
  const height = 26;
  const segments = CHAIN.map((model, index) => ({
    x: left + width * CHAIN.slice(0, index).reduce((sum, before) => sum + before.share, 0),
    width: width * model.share,
    index,
    hours: model.hours,
  }));
  return (
    <g data-chain={kind}>
      <rect x={8} y={y} width={WIDTH - 16} height={height} rx={4} className="ip-field" />
      {/* The card's name, upright at its start ("Weather", "Clouds"), as a bar. */}
      <rect x={13} y={y + 5} width={3} height={height - 10} rx={1.5} className="ip-line" />
      {segments.map((segment) => (
        <g key={segment.index}>
          <rect x={segment.x + 4} y={y + 5} width={Math.min(26, segment.width - 14)} height={3} rx={1.5} className="ip-line" />
          <rect
            x={segment.x + 3}
            y={y + 12}
            width={segment.width - 6}
            height={9}
            rx={2}
            className={`hp-chain hp-chain--${kind} hp-chain--${segment.index}`}
          />
          <Label x={segment.x + segment.width / 2} y={y + 16.5} text={segment.hours} max={segment.width - 10} size={5.5} />
        </g>
      ))}
      {segments.slice(1).map((segment) => (
        <g key={`b${segment.index}`}>
          <HitRect x={segment.x - 4} y={y + 2} width={8} height={height - 4} />
          <rect x={segment.x - 1} y={y + 4} width={2} height={height - 8} rx={1} className="hp-grip" />
        </g>
      ))}
    </g>
  );
}

/** 2. The model chains shown: the weather's, the clouds' or both, with arrows at a boundary that can be moved. */
function ChainsPicture({ context }: { context: HelpContext }) {
  const rows = (["weather", "cloud"] as const).filter((kind) => context.chains[kind]);
  const top = 8;
  const step = 32;
  const height = top + rows.length * step + 8;
  const boundary = 22 + (WIDTH - 30) * CHAIN[0].share;
  const arrowY = top + rows.length * step + 2;
  return (
    <Frame section="chains" height={height}>
      {rows.map((kind, index) => (
        <ChainRow key={kind} y={top + index * step} kind={kind} />
      ))}
      {/* Back and forth: the boundary moves. */}
      <path
        className="ip-glyph"
        d={`M${boundary - 12} ${arrowY}H${boundary + 12}M${boundary - 9} ${arrowY - 2.5}L${boundary - 12} ${arrowY}L${boundary - 9} ${arrowY + 2.5}M${boundary + 9} ${arrowY - 2.5}L${boundary + 12} ${arrowY}L${boundary + 9} ${arrowY + 2.5}`}
      />
    </Frame>
  );
}

/** 3. The day slider: the days, the period chosen and its grips (beside it on the desktop, below it on a touch screen). */
function DaysPicture({ context }: { context: HelpContext }) {
  const desktop = context.device === "desktop";
  const days = 16;
  const left = 14;
  const right = WIDTH - 14;
  const column = (right - left) / days;
  const top = 10;
  const stripHeight = 24;
  const from = 3;
  const to = 10;
  const height = desktop ? 46 : 54;
  const startX = left + from * column;
  const endX = left + (to + 1) * column;
  return (
    <Frame section="days" height={height}>
      <rect x={left} y={top} width={right - left} height={stripHeight} rx={4} className={desktop ? "ip-field" : "hp-strip"} />
      {Array.from({ length: days }, (_, index) => {
        const x = left + (index + 0.5) * column;
        const inside = index >= from && index <= to;
        return (
          <g key={index} className={inside ? undefined : "hp-day--out"}>
            <rect x={x - 3} y={top + 5} width={6} height={2.5} rx={1.25} className={desktop ? "ip-line" : "hp-strip-line"} />
            <text x={x} y={top + 17.5} textAnchor="middle" className={desktop ? "ip-label" : "hp-strip-text"} style={{ fontSize: 6.5 }}>
              {9 + index}
            </text>
          </g>
        );
      })}
      {desktop ? (
        <g>
          {/* The marker of the period, its grips at both sides. */}
          <rect x={startX} y={top - 2} width={endX - startX} height={stripHeight + 4} rx={4} className="hp-marker" />
          {[startX, endX].map((x) => (
            <g key={x}>
              <HitRect x={x - 3.5} y={top + 2} width={7} height={stripHeight - 4} />
              <rect x={x - 1.25} y={top + 5} width={2.5} height={stripHeight - 10} rx={1.25} className="hp-grip" />
            </g>
          ))}
        </g>
      ) : (
        <g>
          {/* The phone's grips below the strip, at the ends of the period. */}
          {[startX, endX].map((x, index) => {
            const gripX = index === 0 ? x : x - 14;
            return (
              <g key={x}>
                <HitRect x={gripX - 2} y={top + stripHeight + 1} width={18} height={12} />
                <rect x={gripX} y={top + stripHeight + 3} width={14} height={8} rx={3} className="hp-strip" />
                <path
                  className="hp-strip-glyph"
                  d={`M${gripX + 5} ${top + stripHeight + 5}v4M${gripX + 7} ${top + stripHeight + 5}v4M${gripX + 9} ${top + stripHeight + 5}v4`}
                />
              </g>
            );
          })}
        </g>
      )}
    </Frame>
  );
}

/** A number in the app's orange, as the install steps are numbered. */
function Badge({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g data-badge={n}>
      <circle cx={x} cy={y} r={5} className="hp-badge" />
      <text x={x} y={y + 2.3} textAnchor="middle" className="hp-badge-text">
        {n}
      </text>
    </g>
  );
}

/** Days of the mini meteogram, and the dry one (REQ-848): no bars, a low probability, (almost) no clouds behind. */
const DAYS = 4;
export const DRY_DAY = 3;

/**
 * Precipitation per bar (eighths of the bars' height), 18 bars over the four days: showers on day 0, the cold front's
 * heavy rain on day 1 evening, showers behind it on day 2 (helpWeather.ts, REQ-864); none on the dry day.
 */
const RAIN = [0, 2, 5, 3, 0, 0, 1, 4, 7, 6, 2, 3, 4, 0, 0, 0, 0, 0] as const;

/** Millimetres of one eighth of the bars' height (the full height 3.2 mm), for the side bar's value. */
const RAIN_MM_PER_EIGHTH = 0.4;

/** The probability's points: share of the width, share of the area's height; high in the rain, low on the dry day. */
const PROBABILITY = [
  [0, 0.35],
  [0.07, 0.55],
  [0.14, 0.7],
  [0.25, 0.3],
  [0.34, 0.45],
  [0.45, 0.9],
  [0.52, 0.85],
  [0.59, 0.55],
  [0.66, 0.6],
  [0.71, 0.5],
  [0.75, 0.12],
  [0.86, 0.05],
  [1, 0.07],
] as const;

/** The probability at `share` of the width (0–1), between its points. */
function probabilityAt(share: number): number {
  const after = PROBABILITY.findIndex(([at]) => at >= share);
  if (after <= 0) return PROBABILITY[Math.max(0, after)]![1];
  const [x0, y0] = PROBABILITY[after - 1]!;
  const [x1, y1] = PROBABILITY[after]!;
  return y0 + ((y1 - y0) * (share - x0)) / (x1 - x0);
}

/**
 * A meteogram from `left` to `right`: the days on its time axis, the red dashed line of `now` and its three areas,
 * temperature (felt temperature dashed), precipitation (bars, probability, clouds by height behind; a dry day with
 * neither) and wind (gusts dotted, the direction's arrows). `numbers`: the areas numbered at the left, as in the text.
 */
function MiniMeteogram({
  left,
  right,
  top,
  bottom,
  now,
  numbers = false,
}: {
  left: number;
  right: number;
  top: number;
  bottom: number;
  now: number;
  numbers?: boolean;
}) {
  const width = right - left;
  const axis = 10;
  const areas = bottom - top - axis;
  const temperature = { top: top + axis + 2, height: areas * 0.3 };
  const precipitation = { top: temperature.top + temperature.height + 3, height: areas * 0.34 };
  const wind = { top: precipitation.top + precipitation.height + 3, height: bottom - (precipitation.top + precipitation.height + 3) };
  const days = DAYS;
  const day = width / days;
  const pBottom = precipitation.top + precipitation.height;
  const bars = RAIN.length;
  const bar = width / bars;
  const layerHeight = precipitation.height / CLOUD_LAYERS;
  const wBottom = wind.top + wind.height;
  // The temperature's axis fills its area; the wind's leaves the top to the arrows, which the strongest gusts touch.
  const [low, high] = TEMPERATURE_RANGE;
  const temperatureY = (value: number) =>
    temperature.top + temperature.height - 1.5 - ((value - low) / (high - low)) * (temperature.height - 3);
  const arrowsY = wind.top + 4.5;
  const windY = (value: number) => wBottom - 1.5 - (value / WIND_MAX) * (wind.height - 8.5);
  return (
    <g>
      {/* Time axis: the days, today's in orange. */}
      {Array.from({ length: days }, (_, index) => (
        <g key={index}>
          <rect
            x={left + index * day + 0.5}
            y={top}
            width={day - 1}
            height={axis - 1}
            rx={1.5}
            className="ip-chart"
            data-day={index}
          />
          <rect
            x={left + index * day + day / 2 - 9}
            y={top + axis / 2 - 2}
            width={18}
            height={3}
            rx={1.5}
            className={index === 1 ? "hp-today" : "ip-line"}
          />
        </g>
      ))}
      {(
        [
          ["temperature", temperature],
          ["precipitation", precipitation],
          ["wind", wind],
        ] as const
      ).map(([name, area]) => (
        <rect key={name} x={left} y={area.top} width={width} height={area.height} className="ip-chart" data-area={name} />
      ))}
      {/*
        Clouds by height behind the precipitation, as the page's cloud profile draws them: a column per forecast step,
        a cell per height step (REQ-864), the darker, the denser; (almost) none on the dry day (REQ-848).
      */}
      {CLOUDS.map((column, index) =>
        column.map((cover, layer) => {
          if (cover < 0.15) return null;
          const hour = index * CLOUD_COLUMN_HOURS;
          return (
            <rect
              key={`${index}-${layer}`}
              x={left + (width * hour) / HOURS}
              y={pBottom - (layer + 1) * layerHeight}
              width={(width * CLOUD_COLUMN_HOURS) / HOURS}
              height={layerHeight}
              className="hp-cloud"
              style={{ fillOpacity: Math.round((0.05 + 0.45 * cover) * 1000) / 1000 }}
              data-day={Math.floor(hour / DAY_HOURS)}
              data-layer={layer}
            />
          );
        }),
      )}
      {RAIN.map((amount, index) => {
        if (!amount) return null;
        const barHeight = (amount / 8) * precipitation.height * 0.8;
        return (
          <rect
            key={index}
            x={left + index * bar + bar * 0.3}
            y={pBottom - barHeight}
            width={bar * 0.4}
            height={barHeight}
            className="hp-rain"
            data-day={Math.floor(((index + 0.5) * days) / bars)}
          />
        );
      })}
      <path
        className="hp-probability"
        d={PROBABILITY.map(
          ([share, value], index) =>
            `${index === 0 ? "M" : "L"}${(left + width * share).toFixed(1)} ${(pBottom - precipitation.height * value).toFixed(1)}`,
        ).join("")}
      />
      {/* Temperature and felt temperature (dashed) as a forecast has them (REQ-864), the zero line. */}
      <line x1={left} y1={temperatureY(0)} x2={right} y2={temperatureY(0)} className="hp-zero" />
      <path className="hp-temperature hp-temperature--felt" d={seriesPath(HELP_WEATHER.felt, left, right, temperatureY)} />
      <path className="hp-temperature" d={seriesPath(HELP_WEATHER.temperature, left, right, temperatureY)} />
      {/* Wind and gusts (dotted), the gusts unevenly far above the wind (REQ-864); the direction's arrows. */}
      <path className="hp-wind hp-wind--gust" d={seriesPath(HELP_WEATHER.gusts, left, right, windY)} />
      <path className="hp-wind" d={seriesPath(HELP_WEATHER.wind, left, right, windY)} />
      {WIND_DIRECTION.map((from, index) => {
        const x = left + (index + 0.5) * (width / WIND_DIRECTION.length);
        // Pointing where the wind blows, as on the page.
        return (
          <g key={index} transform={`translate(${x} ${arrowsY}) rotate(${(from + 180) % 360})`}>
            <circle r={3.4} className="hp-arrow-circle" />
            <path d="M0 2V-2M-1.3 -0.8L0 -2L1.3 -0.8" className="hp-arrow" />
          </g>
        );
      })}
      {/* Now: the red dashed line through all areas. */}
      <line x1={now} y1={top} x2={now} y2={bottom} className="hp-now" data-now="" />
      {numbers && (
        <g>
          <Badge x={left - 7} y={temperature.top + temperature.height / 2} n={1} />
          <Badge x={left - 7} y={precipitation.top + precipitation.height / 2} n={2} />
          <Badge x={left - 7} y={wind.top + wind.height / 2} n={3} />
        </g>
      )}
    </g>
  );
}

/** 4. The meteogram with its time axis, the line of now and its three areas, numbered as in the text. */
function MeteogramPicture() {
  return (
    <Frame section="meteogram" height={124}>
      <MiniMeteogram left={22} right={WIDTH - 8} top={7} bottom={117} now={72} numbers />
    </Frame>
  );
}

/**
 * 5. Full screen: the meteogram on the whole screen with the side bar of the values at the time pressed. The red dashed
 * line stands at that time, through the finger or the mouse, so that it is clear that moving it changes the values
 * (REQ-858, DEC-178); there is no other line. The side bar's values are the curves' at that time (REQ-864).
 */
function FullscreenPicture() {
  const height = 112;
  const bar = { x: 6, y: 6, width: 52, height: height - 12 };
  const left = 64;
  const right = WIDTH - 6;
  const cursor = 150;
  const share = (cursor - left) / (right - left);
  const hour = share * HOURS;
  const rain = RAIN[Math.min(RAIN.length - 1, Math.floor(share * RAIN.length))]! * RAIN_MM_PER_EIGHTH;
  const rounded = (series: readonly number[]) => Math.round(valueAt(series, hour));
  const rows = [
    { className: "hp-value--temperature", value: `${rounded(HELP_WEATHER.temperature)}°C` },
    { className: "hp-value--temperature", value: `${rounded(HELP_WEATHER.felt)}°C` },
    { className: "hp-value--rain", value: `${rain.toFixed(1)} mm` },
    { className: "hp-value--probability", value: `${Math.round(probabilityAt(share) * 20) * 5} %` },
    { className: "hp-value--wind", value: `${rounded(HELP_WEATHER.wind)} km/h` },
    { className: "hp-value--wind", value: `${rounded(HELP_WEATHER.gusts)} km/h` },
  ];
  return (
    <Frame section="fullscreen" height={height}>
      <MiniMeteogram left={left} right={right} top={6} bottom={height - 6} now={cursor} />
      {/* The finger or the mouse at the time pressed, on the red dashed line. */}
      <HitCircle x={cursor} y={46} r={6} />
      {/* The side bar with the values at that time. */}
      <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={4} className="ip-menu" data-side-bar="" />
      <rect x={bar.x + 5} y={bar.y + 6} width={30} height={3} rx={1.5} className="ip-line" />
      {rows.map((row, index) => {
        const y = bar.y + 20 + index * 13;
        return (
          <g key={index}>
            <rect x={bar.x + 5} y={y - 1.25} width={12} height={2.5} rx={1.25} className="ip-line" />
            <text x={bar.x + bar.width - 4} y={y + 2.2} textAnchor="end" className={`hp-value ${row.className}`}>
              {row.value}
            </text>
          </g>
        );
      })}
      <HitRect x={bar.x - 1} y={bar.y - 1} width={bar.width + 2} height={bar.height + 2} />
    </Frame>
  );
}

/** The picture of `section` for `context`. */
export function HelpPicture({ section, context }: { section: HelpSection; context: HelpContext }) {
  switch (section) {
    case "place":
      return <PlacePicture context={context} />;
    case "chains":
      return <ChainsPicture context={context} />;
    case "days":
      return <DaysPicture context={context} />;
    case "meteogram":
      return <MeteogramPicture />;
    case "fullscreen":
      return <FullscreenPicture />;
  }
}
