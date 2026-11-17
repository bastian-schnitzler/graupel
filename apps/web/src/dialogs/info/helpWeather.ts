// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The weather of the Help tab's meteogram pictures (REQ-864): four days of hourly values that look like a forecast,
 * not like sine waves. Day 0 mild with showers; day 1 (today) mild in the warm sector until a cold front passes in the
 * evening with the heaviest rain and the strongest gusts; day 2 cool and showery behind it; day 3 dry (REQ-848), a
 * clear and calm, cold night and a sunny afternoon. So each day has its own range and its own time of the highest
 * temperature, the wind is calmer at night, and the gusts lie unevenly far above it.
 *
 * Fixed values: hand-set keypoints joined by a smooth curve, plus a small irregular wobble from a generator with a fixed
 * seed. Everything is computed once when the module loads and is the same on every load, so the pictures and their
 * reference images never change. Hour 0 is midnight before day 0; the series have a value for every hour 0–96.
 */

/** Hours shown: four days. */
export const HOURS = 96;
export const DAY_HOURS = 24;

/** The temperature axis of the pictures (°C), bottom to top, and the wind axis' top (km/h; its bottom is calm). */
export const TEMPERATURE_RANGE = [-6, 15] as const;
export const WIND_MAX = 60;

type Keypoint = readonly [hour: number, value: number];

/** Air temperature (°C): the lowest at dawn and the highest in the afternoon, the front's drop on day 1 evening. */
const TEMPERATURE: readonly Keypoint[] = [
  [0, 9.4],
  [7, 7.5],
  [16, 12.1],
  [22, 10.4],
  [29, 9.8],
  [36, 13.8],
  [42, 12.3],
  [48, 6.9],
  [56, 4.1],
  [62, 7.0],
  [68, 5.1],
  [79, -1.6],
  [87, 9.8],
  [96, 3.0],
];

/** Relative humidity (%), for the felt temperature: damp in the rain, dry on the sunny afternoon. */
const HUMIDITY: readonly Keypoint[] = [
  [0, 86],
  [14, 74],
  [30, 90],
  [46, 97],
  [56, 86],
  [63, 72],
  [79, 88],
  [87, 62],
  [96, 76],
];

/** Mean wind 10 m above ground (km/h): calmer at night, rising ahead of the front, calm on the clear night. */
const WIND: readonly Keypoint[] = [
  [0, 9],
  [4, 7],
  [14, 15],
  [22, 10],
  [28, 12],
  [36, 19],
  [42, 24],
  [46, 30],
  [50, 22],
  [56, 16],
  [62, 20],
  [68, 13],
  [74, 6],
  [80, 3],
  [86, 11],
  [92, 5],
  [96, 4],
];

/** Gusts as a multiple of the mean wind: high at the front and in the showers, low on the calm night. */
const GUST_FACTOR: readonly Keypoint[] = [
  [0, 1.6],
  [14, 1.9],
  [28, 1.7],
  [40, 1.9],
  [46, 2.1],
  [52, 1.8],
  [62, 2.1],
  [70, 1.7],
  [80, 1.5],
  [86, 1.85],
  [96, 1.6],
];

/**
 * Where the wind comes from (degrees, 0 = north), every 12 hours from hour 6: south-west ahead of the front, veering to
 * north-west behind it and to north-east on the dry day.
 */
export const WIND_DIRECTION = [200, 210, 220, 235, 295, 320, 10, 40] as const;

/** Monotone cubic interpolation (Fritsch–Carlson) through `points` at every hour 0–HOURS: smooth, no overshoot. */
function interpolate(points: readonly Keypoint[]): number[] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const n = points.length;
  const delta = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!));
  const slope = xs.map((_, i) => {
    if (i === 0) return delta[0]!;
    if (i === n - 1) return delta[n - 2]!;
    const before = delta[i - 1]!;
    const after = delta[i]!;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    const d = delta[i]!;
    if (d === 0) {
      slope[i] = 0;
      slope[i + 1] = 0;
      continue;
    }
    const a = slope[i]! / d;
    const b = slope[i + 1]! / d;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      slope[i] = t * a * d;
      slope[i + 1] = t * b * d;
    }
  }
  return Array.from({ length: HOURS + 1 }, (_, hour) => {
    let i = 0;
    while (i < n - 2 && hour > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = (hour - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i]! +
      (t3 - 2 * t2 + t) * h * slope[i]! +
      (-2 * t3 + 3 * t2) * ys[i + 1]! +
      (t3 - t2) * h * slope[i + 1]!
    );
  });
}

/** A small generator of numbers in [0, 1) (mulberry32): the same sequence for the same seed, on every load. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An irregular wobble of about ±`amplitude` per hour, gently smoothed, from the fixed `seed`. */
function wobble(seed: number, amplitude: number): number[] {
  const next = generator(seed);
  const raw = Array.from({ length: HOURS + 3 }, () => next() * 2 - 1);
  return Array.from({ length: HOURS + 1 }, (_, hour) => amplitude * (0.25 * raw[hour]! + 0.5 * raw[hour + 1]! + 0.25 * raw[hour + 2]!));
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Felt (apparent) temperature after Steadman, as weather services give it: warmer with humid air, colder with wind.
 * `temperature` in °C, `humidity` in %, `wind` in km/h.
 */
export function apparentTemperature(temperature: number, humidity: number, wind: number): number {
  const vapourPressure = (humidity / 100) * 6.105 * Math.exp((17.27 * temperature) / (237.7 + temperature));
  return temperature + 0.33 * vapourPressure - 0.7 * (wind / 3.6) - 4;
}

/** Hourly values of the pictures: temperature and felt temperature (°C), mean wind and gusts (km/h). */
export interface HelpWeather {
  readonly temperature: readonly number[];
  readonly felt: readonly number[];
  readonly wind: readonly number[];
  readonly gusts: readonly number[];
}

function build(): HelpWeather {
  const temperatureWobble = wobble(864, 0.5);
  const windWobble = wobble(8640, 1.6);
  const gustWobble = wobble(86400, 4.5);
  const humidity = interpolate(HUMIDITY);
  const factor = interpolate(GUST_FACTOR);
  const temperature = interpolate(TEMPERATURE).map((value, hour) => round(value + temperatureWobble[hour]!));
  const wind = interpolate(WIND).map((value, hour) => round(Math.max(1, value + windWobble[hour]!)));
  const gusts = wind.map((value, hour) => round(Math.max(value + 2, value * factor[hour]! + gustWobble[hour]!)));
  const felt = temperature.map((value, hour) => round(apparentTemperature(value, humidity[hour]!, wind[hour]!)));
  return { temperature, felt, wind, gusts };
}

export const HELP_WEATHER: HelpWeather = build();

/** The clouds' height steps: one per kilometre from the ground to 12 km, as the meteogram's cloud profile reaches. */
export const CLOUD_LAYERS = 12;
export const CLOUD_TOP_KM = 12;
/** Hours per column of the clouds (as the page draws one per forecast step, here two hours wide). */
export const CLOUD_COLUMN_HOURS = 2;

/**
 * A cloud body: from hour `from` to `to`, between the heights `base` and `top` (km, either a number or the height at
 * `from` and at `to`, in between linear), with `cover` (0–1). `patchy` clouds (showers) vary from column to column.
 */
interface CloudBody {
  readonly from: number;
  readonly to: number;
  readonly base: number | readonly [number, number];
  readonly top: number | readonly [number, number];
  readonly cover: number;
  readonly patchy?: boolean;
}

/**
 * The weather's clouds: stratocumulus in the first night, shower clouds on day 0; ahead of the cold front cirrus, then
 * altostratus lowering, then the deep nimbostratus of the front's rain; shower clouds behind it on day 2; on the dry
 * day (REQ-848) a single faint cirrus at its start.
 */
const CLOUD_BODIES: readonly CloudBody[] = [
  { from: 0, to: 6, base: 1, top: 2.8, cover: 0.45, patchy: true },
  { from: 4, to: 22, base: 1, top: 7, cover: 0.8, patchy: true },
  { from: 20, to: 36, base: 8.5, top: 11, cover: 0.45 },
  { from: 28, to: 44, base: [7, 3], top: 9.5, cover: 0.7 },
  { from: 34, to: 52, base: [2.5, 0.3], top: [6, 9], cover: 0.95 },
  { from: 52, to: 70, base: 0.8, top: 6.5, cover: 0.85, patchy: true },
  { from: 72, to: 74, base: 10, top: 11, cover: 0.22 },
];

/** Cloud cover (0–1) per column (CLOUD_COLUMN_HOURS each) and height step (0 the lowest), fixed like the curves. */
function buildClouds(): number[][] {
  const next = generator(86_400_864);
  const columns = HOURS / CLOUD_COLUMN_HOURS;
  return Array.from({ length: columns }, (_, column) => {
    const hour = (column + 0.5) * CLOUD_COLUMN_HOURS;
    // One chance per column for the shower clouds' height, one per cell for their gaps.
    const tower = next();
    return Array.from({ length: CLOUD_LAYERS }, (_, layer) => {
      const gap = next();
      const km = ((layer + 0.5) * CLOUD_TOP_KM) / CLOUD_LAYERS;
      let cover = 0;
      for (const body of CLOUD_BODIES) {
        if (hour < body.from || hour > body.to) continue;
        const along = (hour - body.from) / (body.to - body.from);
        const height = (value: CloudBody["base"]) =>
          typeof value === "number" ? value : value[0] + (value[1] - value[0]) * along;
        const base = height(body.base);
        // Shower clouds tower to different heights, down to half their depth.
        const top = height(body.top) - (body.patchy ? tower * 0.5 * (height(body.top) - base) : 0);
        if (km < base || km > top) continue;
        cover = Math.max(cover, body.patchy ? body.cover * (0.3 + 0.7 * gap) : body.cover);
      }
      return Math.round(cover * 100) / 100;
    });
  });
}

/** The clouds behind the precipitation: `CLOUDS[column][layer]`, cover 0–1. */
export const CLOUDS: readonly (readonly number[])[] = buildClouds();

/** The value of an hourly `series` at `hour` (fractions between two hours interpolated). */
export function valueAt(series: readonly number[], hour: number): number {
  const clamped = Math.min(HOURS, Math.max(0, hour));
  const before = Math.floor(clamped);
  const after = Math.min(HOURS, before + 1);
  return series[before]! + (series[after]! - series[before]!) * (clamped - before);
}
