// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Built-in layouts. The dew point with its spread to the temperature is new (REQ-595); it is
// drawn only as the render option `dewPoint` says (default off, REQ-620; auto: across the whole width when, in the
// visible range, the spread is at most 5 K or the dew point at least 15 °C somewhere and the temperature reaches 5 °C
// somewhere, else not at all, REQ-604, REQ-620). The relative humidity on the right axis of the temperature area
// (fixed 0 to 100 %, a thin line) is drawn only with the render option `relativeHumidity` "on" (default off; without
// values in the data off as well): otherwise its series and axis are left out and the area is drawn as before
// (REQ-649). The wind area draws a dashed guide line at half its axis maximum (REQ-653). Layout version 2 (REQ-663):
// the axes name their rules (steps, step, scope; `midLine` is the guide at 50 %) with the values the quantities have by default
// (REQ-590 to REQ-592, REQ-651, REQ-655), so the chart is drawn as before. Dew point, relative humidity and the axes
// following the visible range are switches (`toggles`, `showWhen`, REQ-664) that the render options of the same name
// set. Each area names its popup rows (`tooltip`, REQ-665): the standard groups, in their order; after the
// apparent temperature the dew point, its spread and the relative humidity, shown while drawn (REQ-676).
import type { ChartLayout } from "./types";

export const BUILTIN_LAYOUTS: readonly ChartLayout[] = [
  {
    "id": "power-default",
    "name": "Power default",
    "version": 2,
    "showModelHeaders": true,
    "showDayHeader": true,
    "showDaylight": true,
    "showLocationLabel": "bottom",
    "showCreatedTimestamp": true,
    "toggles": {
      "dewPoint": { "values": ["off", "on", "auto"], "default": "off" },
      "relativeHumidity": { "values": ["off", "on"], "default": "off" },
      "scaleToVisibleRange": { "values": ["off", "on"], "default": "on" }
    },
    "areas": [
      {
        "id": "temp",
        "tooltip": [
          {
            "group": "temperature",
            "order": 1,
            "rows": [
              "temperature",
              "apparent_temperature",
              "dew_point",
              "dew_point_spread",
              "relative_humidity"
            ]
          }
        ],
        "heightWeight": 1.15,
        "sunTimes": true,
        "axes": {
          "left": {
            "quantity": "temperature",
            "label": "°",
            "range": "auto",
            "step": 5,
            "zeroLine": true
          },
          "right": {
            "quantity": "relative_humidity",
            "label": "%",
            "range": "fixed",
            "min": 0,
            "max": 100,
            "showWhen": { "relativeHumidity": "on" }
          }
        },
        "series": [
          {
            "quantity": "dew_point",
            "style": "line",
            "fillTo": "temperature",
            "showWhen": { "dewPoint": ["on", "auto"] },
            "autoRule": "spread"
          },
          {
            "quantity": "relative_humidity",
            "style": "line",
            "axis": "right",
            "showWhen": { "relativeHumidity": "on" }
          },
          {
            "quantity": "apparent_temperature",
            "style": "line"
          },
          {
            "quantity": "temperature",
            "style": "line",
            "extremeLabels": true
          }
        ]
      },
      {
        "id": "precip",
        "tooltip": [
          {
            "group": "precipitation",
            "order": 3,
            "rows": [
              "precipitation_probability",
              "precipitation",
              "precipitation_sum"
            ]
          },
          {
            "group": "snow",
            "order": 4,
            "rows": [
              "snowfall",
              "snow_depth",
              "snowfall_sum"
            ]
          }
        ],
        "heightWeight": 0.95,
        "axes": {
          "left": {
            "quantity": "precipitation",
            "label": "mm",
            "range": "zero-based",
            "steps": [2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 400],
            "scope": "visible"
          }
        },
        "background": {
          "kind": "vertical_cloud_profile",
          "enabled": true,
          "heightWeight": 0.3
        },
        "series": [
          {
            "quantity": "precipitation_rain_snow",
            "style": "bars"
          },
          {
            "quantity": "precipitation_probability",
            "style": "line",
            "axis": "hidden"
          },
          {
            "quantity": "snow_depth",
            "style": "tooltip"
          },
          {
            "quantity": "weather_code",
            "style": "icons"
          }
        ]
      },
      {
        "id": "wind",
        "tooltip": [
          {
            "group": "wind",
            "order": 2,
            "rows": [
              "wind_speed",
              "wind_gusts",
              "wind_direction"
            ]
          }
        ],
        "heightWeight": 1.05,
        "axes": {
          "left": {
            "quantity": "wind_speed",
            "label": "km/h",
            "range": "zero-based",
            "steps": [10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400],
            "scope": "visible",
            "midLine": true
          }
        },
        "series": [
          {
            "quantity": "wind_gusts",
            "style": "line"
          },
          {
            "quantity": "wind_speed",
            "style": "line"
          },
          {
            "quantity": "wind_direction",
            "style": "arrows"
          }
        ]
      },
      {
        "id": "convective",
        "tooltip": [
          {
            "group": "convective",
            "order": 5,
            "rows": [
              "cape",
              "convective_inhibition",
              "lightning_potential"
            ]
          }
        ],
        "heightWeight": 1.3,
        "axes": {
          "left": {
            "quantity": "cape",
            "label": "J/kg",
            "range": "zero-based"
          },
          "right": {
            "quantity": "lightning_potential",
            "label": "J/kg",
            "range": "fixed",
            "min": 0,
            "max": 30
          }
        },
        "series": [
          {
            "quantity": "cape",
            "style": "area",
            "half": "upper"
          },
          {
            "quantity": "convective_inhibition",
            "style": "area",
            "half": "lower"
          },
          {
            "quantity": "lightning_potential",
            "style": "line",
            "axis": "right",
            "half": "upper"
          }
        ]
      }
    ]
  },
  {
    "id": "normal-default",
    "name": "Standard",
    "version": 2,
    "showModelHeaders": false,
    "showDayHeader": true,
    "showDaylight": true,
    "showLocationLabel": "bottom",
    "showCreatedTimestamp": true,
    "toggles": {
      "dewPoint": { "values": ["off", "on", "auto"], "default": "off" },
      "relativeHumidity": { "values": ["off", "on"], "default": "off" },
      "scaleToVisibleRange": { "values": ["off", "on"], "default": "on" }
    },
    "areas": [
      {
        "id": "temp",
        "tooltip": [
          {
            "group": "temperature",
            "order": 1,
            "rows": [
              "temperature",
              "apparent_temperature",
              "dew_point",
              "dew_point_spread",
              "relative_humidity"
            ]
          }
        ],
        "heightWeight": 1.15,
        "sunTimes": true,
        "axes": {
          "left": {
            "quantity": "temperature",
            "label": "°",
            "range": "auto",
            "step": 5,
            "zeroLine": true
          },
          "right": {
            "quantity": "relative_humidity",
            "label": "%",
            "range": "fixed",
            "min": 0,
            "max": 100,
            "showWhen": { "relativeHumidity": "on" }
          }
        },
        "series": [
          {
            "quantity": "dew_point",
            "style": "line",
            "fillTo": "temperature",
            "showWhen": { "dewPoint": ["on", "auto"] },
            "autoRule": "spread"
          },
          {
            "quantity": "relative_humidity",
            "style": "line",
            "axis": "right",
            "showWhen": { "relativeHumidity": "on" }
          },
          {
            "quantity": "apparent_temperature",
            "style": "line"
          },
          {
            "quantity": "temperature",
            "style": "line",
            "extremeLabels": true
          }
        ]
      },
      {
        "id": "precip",
        "tooltip": [
          {
            "group": "precipitation",
            "order": 3,
            "rows": [
              "precipitation_probability",
              "precipitation",
              "precipitation_sum"
            ]
          },
          {
            "group": "snow",
            "order": 4,
            "rows": [
              "snowfall",
              "snowfall_sum"
            ]
          }
        ],
        "heightWeight": 0.95,
        "axes": {
          "left": {
            "quantity": "precipitation",
            "label": "mm",
            "range": "zero-based",
            "steps": [2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 400],
            "scope": "visible"
          }
        },
        "background": {
          "kind": "vertical_cloud_profile",
          "enabled": true,
          "heightWeight": 0.3
        },
        "series": [
          {
            "quantity": "precipitation_rain_snow",
            "style": "bars"
          },
          {
            "quantity": "precipitation_probability",
            "style": "line",
            "axis": "hidden"
          },
          {
            "quantity": "weather_code",
            "style": "icons"
          }
        ]
      },
      {
        "id": "wind",
        "tooltip": [
          {
            "group": "wind",
            "order": 2,
            "rows": [
              "wind_speed",
              "wind_gusts",
              "wind_direction"
            ]
          }
        ],
        "heightWeight": 1.05,
        "axes": {
          "left": {
            "quantity": "wind_speed",
            "label": "km/h",
            "range": "zero-based",
            "steps": [10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400],
            "scope": "visible",
            "midLine": true
          }
        },
        "series": [
          {
            "quantity": "wind_gusts",
            "style": "line"
          },
          {
            "quantity": "wind_speed",
            "style": "line"
          },
          {
            "quantity": "wind_direction",
            "style": "arrows"
          }
        ]
      }
    ]
  }
];
