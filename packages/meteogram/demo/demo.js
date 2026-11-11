// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Vanilla demo of @graupel/meteogram: synthetic forecast, controller, day range, theme, PNG.
import { DAY_RANGE_CHOICES, createMeteogram } from "../dist/index.js";
import { meteogramToPng } from "../dist/png/index.js";

const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const round1 = (value) => Math.round(value * 10) / 10;

/** Five days of hourly values from yesterday 00 UTC; ICON-D2 for 48 h, then ICON-EU. */
function syntheticInput() {
  const start = Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR - 24 * HOUR;
  const now = Math.floor(Date.now() / HOUR) * HOUR;
  const hours = 24 * 6;
  const sinceNow = (hour) => (start + hour * HOUR - now) / HOUR;
  const modelAt = (hour) => (sinceNow(hour) < 48 ? "ICON-D2" : "ICON-EU");
  const temperature = (hour) => round1(6 + 7 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + Math.sin(hour / 17) * 3);
  const rain = (hour) => (hour % 31 > 24 ? round1(0.3 + (hour % 4) * 0.5) : 0);
  const specs = [
    ["temperature", "°C", temperature],
    ["apparent_temperature", "°C", (h) => round1(temperature(h) - 2.5)],
    ["precipitation", "mm", rain],
    ["snowfall", "cm", (h) => (rain(h) > 0 && temperature(h) < 1 ? round1(rain(h) * 0.7) : 0)],
    ["precipitation_probability", "%", (h) => Math.round(50 + 45 * Math.sin((h / 12) * Math.PI))],
    ["wind_speed", "km/h", (h) => round1(12 + 8 * Math.sin((h / 18) * Math.PI))],
    ["wind_gusts", "km/h", (h) => round1(25 + 12 * Math.sin((h / 18) * Math.PI))],
    ["wind_direction", "°", (h) => (200 + h * 7) % 360],
    ["cape", "J/kg", (h) => (h % 24 >= 12 && h % 24 < 18 ? 120 * (h % 24 - 11) : 0)],
    ["convective_inhibition", "J/kg", (h) => (h % 24 < 6 ? -15 * (h % 24) : 0)],
    ["lightning_potential", "J/kg", (h) => (modelAt(h) === "ICON-D2" && h % 24 === 15 ? 6 : 0)],
    ["weather_code", "wmo code", (h) => (h % 24 === 15 ? 95 : 3)],
    ["cloud_cover", "%", (h) => Math.round(50 + 50 * Math.sin(h / 7))],
  ];
  const series = [];
  for (let hour = 0; hour < hours; hour++) {
    for (const [variable, unit, value] of specs) {
      series.push({ timestamp: iso(start + hour * HOUR), variable, unit, value: value(hour), model: modelAt(hour) });
    }
  }
  return {
    location: { name: "Innsbruck", latitude: 47.27, longitude: 11.39, elevation: 574, timezone: "Europe/Vienna" },
    timezone: "Europe/Vienna",
    timeline: { start: iso(start), end: iso(start + hours * HOUR), now: iso(now) },
    chain: [
      {
        model: "ICON-D2",
        id: "icon_d2",
        shortName: "D2",
        sliceEndHours: 48,
        supportedVariables: ["lightning_potential"],
        runSegments: [{ run_init_time: iso(now - 3 * HOUR), valid_from: null, valid_until: null, run_length_hours: 48 }],
      },
      { model: "ICON-EU", id: "icon_eu", shortName: "EU", sliceEndHours: 120 },
    ],
    series,
    generatedAt: iso(Date.now()),
  };
}

const chart = document.getElementById("chart");
const status = document.getElementById("status");
const daysBox = document.getElementById("days");
const state = { theme: "light", zoom: true, layout: "power-default" };
const input = syntheticInput();
// The controller reports the first range while it is being created.
let meteogram = null;
let dayButtons = [];

const options = () => ({
  theme: state.theme,
  fallbackLayoutId: state.layout,
  interaction: { zoom: state.zoom, dayRange: 4 },
  onRangeChange: (range) => {
    status.textContent = range ? `Visible: ${new Date(range.start).toLocaleString()} – ${new Date(range.end).toLocaleString()}` : "";
    markDays();
  },
  onHover: (info) => {
    chart.dataset.hoverTimestamp = info?.timestamp ? iso(info.timestamp) : "";
  },
});

meteogram = createMeteogram(chart, input, options());
window.meteogram = meteogram;

// Day-range buttons are the host's: the controller offers setDayRange / getActiveDayRange.
dayButtons = DAY_RANGE_CHOICES.map((days) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = days === null ? "All" : `${days}d`;
  button.addEventListener("click", () => meteogram?.setDayRange(days));
  daysBox.append(button);
  return [days, button];
});
function markDays() {
  const active = meteogram?.getActiveDayRange();
  for (const [days, button] of dayButtons) button.setAttribute("aria-pressed", String(active === days));
}
markDays();

const themeButton = document.getElementById("theme");
themeButton.addEventListener("click", () => {
  state.theme = state.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  themeButton.textContent = state.theme === "light" ? "Dark theme" : "Light theme";
  meteogram?.update(input, options());
});

document.getElementById("layout").addEventListener("change", (event) => {
  state.layout = event.target.value;
  meteogram?.update(input, options());
});

const zoomButton = document.getElementById("zoom");
zoomButton.addEventListener("click", () => {
  state.zoom = !state.zoom;
  zoomButton.setAttribute("aria-pressed", String(state.zoom));
  meteogram?.update(input, options());
});

document.getElementById("png").addEventListener("click", async () => {
  if (!meteogram) return;
  const blob = await meteogramToPng(meteogram);
  const image = document.createElement("img");
  image.alt = "Exported meteogram";
  image.dataset.testid = "demo-png";
  image.src = URL.createObjectURL(blob);
  document.getElementById("export").replaceChildren(image);
});

document.getElementById("destroy").addEventListener("click", () => {
  meteogram?.destroy();
  meteogram = null;
  window.meteogram = null;
  status.textContent = "Destroyed";
});
