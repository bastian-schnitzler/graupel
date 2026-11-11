// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Deterministic meteogram inputs for the renderer tests. The golden files
 * next to this module (`*.old.svg`) are the reference SVGs for the same
 * inputs.
 */
import type { MeteogramInput } from "../../src/core/input";
import type { DataPoint, VerticalCloudProfile } from "../../src/core/types";
import type { MeteogramRenderOptions } from "../../src/render/scene";

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (value: number) => Math.round(value * 10) / 10;

interface QuantitySpec {
  variable: string;
  unit: string;
  value: (hour: number) => number | null;
}

function buildSeries(
  startMs: number,
  hours: number,
  modelAt: (hour: number) => string,
  specs: QuantitySpec[],
): DataPoint[] {
  const points: DataPoint[] = [];
  for (let hour = 0; hour < hours; hour++) {
    for (const spec of specs) {
      points.push({
        timestamp: iso(startMs + hour * HOUR),
        variable: spec.variable,
        unit: spec.unit,
        value: spec.value(hour),
        model: modelAt(hour),
      });
    }
  }
  return points;
}

// --- "power": power-default layout, two models, clouds, all area kinds ---

const POWER_START = Date.UTC(2026, 9, 15, 0);
const POWER_HOURS = 72;
// Slices count from the forecast start (06Z): ICON-D2 up to +30 h.
const powerModelAt = (hour: number) => (hour < 36 ? "ICON-D2" : "ICON-EU");
const temperatureAt = (hour: number) =>
  round1(4 + 7 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) - hour * 0.05);

const powerSpecs: QuantitySpec[] = [
  { variable: "temperature", unit: "°C", value: temperatureAt },
  {
    variable: "apparent_temperature",
    unit: "°C",
    value: (hour) => round1(temperatureAt(hour) - 2.5),
  },
  {
    variable: "precipitation",
    unit: "mm",
    value: (hour) =>
      (hour >= 10 && hour < 16) || (hour >= 44 && hour < 50)
        ? round1(0.4 + (hour % 4) * 0.6)
        : 0,
  },
  {
    variable: "snowfall",
    unit: "cm",
    value: (hour) => (hour >= 46 && hour < 49 ? round1(0.3 * (hour - 45)) : 0),
  },
  {
    variable: "precipitation_probability",
    unit: "%",
    value: (hour) => Math.round(50 + 45 * Math.sin((hour / 12) * Math.PI)),
  },
  {
    variable: "wind_speed",
    unit: "km/h",
    value: (hour) => round1(12 + 8 * Math.sin((hour / 18) * Math.PI)),
  },
  {
    variable: "wind_gusts",
    unit: "km/h",
    // Gap inside the ICON-D2 slice: the curve gets stop and start markers.
    value: (hour) =>
      hour >= 20 && hour < 23 ? null : round1(25 + 12 * Math.sin((hour / 18) * Math.PI)),
  },
  {
    variable: "wind_direction",
    unit: "°",
    value: (hour) => (200 + hour * 7) % 360,
  },
  {
    variable: "cape",
    unit: "J/kg",
    value: (hour) => (hour >= 12 && hour < 18 ? 150 * (hour - 11) : 0),
  },
  {
    variable: "convective_inhibition",
    unit: "J/kg",
    value: (hour) => (hour >= 40 && hour < 46 ? -20 * (hour - 39) : 0),
  },
  {
    variable: "lightning_potential",
    unit: "J/kg",
    // Only ICON-D2 delivers LPI.
    value: (hour) => (hour < 36 ? (hour >= 13 && hour < 17 ? 4 * (hour - 12) : 0) : null),
  },
  {
    variable: "weather_code",
    unit: "wmo code",
    value: (hour) => (hour === 14 ? 95 : hour === 40 ? 96 : hour === 52 ? 99 : 3),
  },
  {
    variable: "snow_depth",
    unit: "m",
    value: (hour) => (hour >= 47 ? 0.02 : 0),
  },
];

const cloudProfiles: VerticalCloudProfile[] = Array.from({ length: 36 }, (_, hour) => ({
  timestamp: iso(POWER_START + hour * HOUR),
  source_model_id: hour < 30 ? "icon_d2" : "icon_eu",
  levels: [
    { pressure_hpa: 900, altitude_m_asl: 1000, cloud_cover_percent: (hour * 13) % 100 },
    { pressure_hpa: 700, altitude_m_asl: 3000, cloud_cover_percent: (hour * 29) % 90 },
    { pressure_hpa: 500, altitude_m_asl: 5600, cloud_cover_percent: hour % 3 === 0 ? 60 : 0 },
    { pressure_hpa: 300, altitude_m_asl: 9200, cloud_cover_percent: 20 },
  ],
}));

const powerSeries = buildSeries(POWER_START, POWER_HOURS, powerModelAt, powerSpecs);

export const powerInput: MeteogramInput = {
  location: {
    name: "Testort",
    latitude: 47.5,
    longitude: 11,
    elevation: 1200,
    timezone: "Europe/Berlin",
  },
  timezone: "Europe/Berlin",
  timeline: {
    start: iso(POWER_START),
    end: iso(POWER_START + POWER_HOURS * HOUR),
    now: iso(POWER_START + 6 * HOUR),
  },
  chain: [
    {
      model: "ICON-D2",
      id: "icon_d2",
      shortName: "D2",
      sliceEndHours: 30,
      supportedVariables: ["lightning_potential"],
      // Two runs: the header splits at +18 h.
      runSegments: [
        {
          run_init_time: iso(POWER_START),
          valid_from: null,
          valid_until: iso(POWER_START + 18 * HOUR),
          run_length_hours: 48,
        },
        {
          run_init_time: iso(POWER_START + 3 * HOUR),
          valid_from: iso(POWER_START + 18 * HOUR),
          valid_until: null,
          run_length_hours: 48,
        },
      ],
    },
    { model: "ICON-EU", id: "icon_eu", shortName: "EU", sliceEndHours: 66 },
  ],
  series: powerSeries,
  modelSeries: {
    // Raw ICON-EU values beyond the stitched series widen the temperature axis.
    "ICON-EU": buildSeries(POWER_START, POWER_HOURS, () => "ICON-EU", [
      { variable: "temperature", unit: "°C", value: (hour) => (hour === 5 ? 15 : 3) },
    ]),
  },
  cloudProfile: {
    location: { name: "Testort", latitude: 47.5, longitude: 11 },
    profiles: cloudProfiles,
  },
  cloudTransitions: [
    { timestamp: iso(POWER_START + 30 * HOUR), from_model: "icon_d2", to_model: "icon_eu" },
  ],
  sunPhases: [15, 16, 17].map((day) => ({
    day: `2026-10-${day}`,
    sunrise: iso(Date.UTC(2026, 9, day, 5, 31 + (day - 15))),
    sunset: iso(Date.UTC(2026, 9, day, 16, 12 - 2 * (day - 15))),
  })),
  generatedAt: iso(POWER_START + 6 * HOUR + 17 * 60_000),
};

export const powerOptions: MeteogramRenderOptions = {
  now: POWER_START + 9.5 * HOUR,
  idPrefix: "fixture",
};

// --- "normal": normal-default layout, one model, zoomed, narrow chart ---

const NORMAL_START = Date.UTC(2026, 0, 10, 0);
const NORMAL_HOURS = 48;

export const normalInput: MeteogramInput = {
  location: { name: "Custom location", latitude: -33.8688, longitude: 151.2093 },
  timezone: "UTC",
  timeline: {
    start: iso(NORMAL_START),
    end: iso(NORMAL_START + NORMAL_HOURS * HOUR),
    now: iso(NORMAL_START),
  },
  chain: [{ model: "ECMWF IFS", id: "ecmwf_ifs025", sliceEndHours: 48 }],
  series: buildSeries(NORMAL_START, NORMAL_HOURS, () => "ECMWF IFS", [
    {
      variable: "temperature",
      unit: "°C",
      // Early stop: the model slice still covers the missing hours.
      value: (hour) => (hour >= 30 && hour < 34 ? null : round1(22 + 6 * Math.sin(hour / 4))),
    },
    {
      variable: "apparent_temperature",
      unit: "°C",
      value: (hour) => round1(23 + 6 * Math.sin(hour / 4)),
    },
    { variable: "precipitation", unit: "mm", value: (hour) => (hour % 7 === 0 ? 1.2 : 0) },
    { variable: "snowfall", unit: "cm", value: () => 0 },
    {
      variable: "precipitation_probability",
      unit: "%",
      value: (hour) => (hour % 7 === 0 ? 80 : 10),
    },
    { variable: "wind_speed", unit: "km/h", value: (hour) => round1(30 + hour / 2) },
    { variable: "wind_gusts", unit: "km/h", value: (hour) => round1(45 + hour / 2) },
    { variable: "wind_direction", unit: "°", value: (hour) => (90 + hour * 11) % 360 },
    { variable: "weather_code", unit: "wmo code", value: () => 1 },
  ]),
  sunPhases: [10, 11].map((day) => ({
    day: `2026-01-${day}`,
    sunrise: iso(Date.UTC(2026, 0, day - 1, 18, 55)),
    sunset: iso(Date.UTC(2026, 0, day, 9, 10)),
  })),
  generatedAt: iso(NORMAL_START + 2 * HOUR),
};

export const normalOptions: MeteogramRenderOptions = {
  fallbackLayoutId: "normal-default",
  now: NORMAL_START + 5 * HOUR,
  visibleRange: { start: NORMAL_START + 3 * HOUR, end: NORMAL_START + 33 * HOUR },
  size: { width: 640, height: 300 },
  idPrefix: "fixture",
};

export const FIXTURES = {
  power: { input: powerInput, options: powerOptions },
  normal: { input: normalInput, options: normalOptions },
} as const;
