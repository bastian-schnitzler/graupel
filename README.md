# Graupel

**A customizable desktop meteogram application for alpine weather forecasting.**

[![PyPI](https://img.shields.io/pypi/v/graupel?label=PyPI)](https://pypi.org/project/graupel/)
[![Python](https://img.shields.io/pypi/pyversions/graupel?logo=python\&logoColor=white)](https://pypi.org/project/graupel/)
[![License](https://img.shields.io/pypi/l/graupel)](LICENSE)
[![Open-Meteo](https://img.shields.io/badge/Open--Meteo-Weather_API-4285F4)](https://open-meteo.com/)
[![Maptoolkit](https://img.shields.io/badge/Maptoolkit-Maps-4A90E2)](https://www.maptoolkit.com/)
[![MapLibre](https://img.shields.io/badge/MapLibre-396CB2?logo=maplibre\&logoColor=white)](https://maplibre.org/)
[![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-7EBC6F?logo=openstreetmap\&logoColor=white)](https://www.openstreetmap.org/)

Graupel creates detailed, customizable meteograms by combining multiple numerical weather prediction models into continuous forecast chains.

Designed with alpine weather in mind, it provides detailed views of temperature, precipitation, wind, cloud structure, and other meteorological parameters while allowing different forecast models to be used for short-, medium-, and long-range forecasts.

Weather forecasts are provided through [Open-Meteo](https://open-meteo.com/).
Interactive maps use [Maptoolkit](https://www.maptoolkit.com/) and [MapLibre](https://maplibre.org/) with map data from [OpenStreetMap](https://www.openstreetmap.org/).

## Features

* Normal mode: pick a location, get a good meteogram; the model chain is chosen automatically for the region
* Power mode: custom model chains for short-, medium-, and long-range forecasts, with **Auto** as a starting point
* About 50 numerical weather prediction models from Open-Meteo
* Detailed alpine meteograms with a vertical cloud profile
* Temperature, precipitation and snow, wind, cloud, CAPE/CIN and other weather parameters
* Configurable meteogram layouts (power mode)
* Interactive time-range zoom and day ranges (4/7/10/14 days)
* Interactive maps for picking a location
* Copy the meteogram as a PNG image
* Optional local forecast archive with a viewer for past forecasts (power mode)
* Local desktop application with local configuration storage


# Graupel

Graupel is a desktop application to visualize freely available weather data from OpenMeteo as a meteogram, e.g. a graph with a timeframe on the x axis and weather-realted quantities such as temperature or precipitation on the y axis.

Graupel lets you select weather models of your choice, if available through the api. You can then choose the best local model for your forecast area.

It is free to use and open source. Project-authored React frontend code is
licensed under the Mozilla Public License 2.0 (`MPL-2.0`). All other
project-owned material—including Python code and icons—is licensed under the
GNU General Public License v3.0 or later (`GPL-3.0-or-later`). Bundled
third-party components retain their respective licenses. See [LICENSE](LICENSE)
for the exact file-level boundary and complete notices.

# Installation

## Windows

### No clue what uv is

If you do not know what uv is, it is probably not installed. Copy the following command:

```
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv tool install graupel
```

Now open a powershell by pressing `WinKey + R` typing `powershell` and hitting Enter.
Paste the copied command and execute it with a press of Enter.

After the installation of uv, start Graupel by typing

```
graupel
```

and hitting Enter. A startmenu item will be automatically created on the first run.

### uv is already installed

Install `graupel` via

```
uv tool install graupel
```

Afterwards you can run Graupel from the terminal via

```
graupel
```

## Linux

Install `uv`, a package manager for python, via your distros package manager. Install `graupel` via

```
uv tool install graupel
```

Afterwards you can run Graupel from the terminal via

```
graupel
```

## Mac OS X

Install uv via homebrew:

```
brew install uv
```

or directly, if you do not have homebrew installed:

```
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Restart your terminal and install Graupel:

```
uv tool install graupel
```

Afterwards you can run Graupel from the terminal via

```
graupel
```

# Usage

## Introduction to Weather models

Weather models are forecast algorithms that ingest a lot of sensor data and predict the configuration of the atmosphere within the forecast horizon.

Weather models have different spatial resolution (dividing the forecast area into smaller or larger rectangles), which makes a difference on how detailed geographic features, especially mountains, influence the weather physics within the model.

A higher resolution usually means more computing effort, why usually higher resolution models have lower forecast horizion. Also the atmosphere is a "chaotic" system, meaning small changes in state can have a butterfly effect the further you go in the prediction, therefore falsely assumed precision in longer forecast models may not value the outcome

Graupel allows you to "stack" weather models on top of each other, e.g. in a chain of models starting with a high resolution, but short horizon model, followed by one ore more less precise but longer horizon models. You can therefore create meteograms with a very long forecast horizon.

The longest models have a horizon of more than 14 days, giving you an effective visual forecast of two weeks. Be aware though, that usually a prediction of longer than a week can have a big uncertainty and should merely be seen as a trend.

## Normal and power mode

Graupel has two modes. The **Power mode** switch in the header (next to the logo) changes between them at any time;
switching never deletes configurations, layouts or archived forecasts.

* **Normal mode** (default for new installations): choose a location and you get a meteogram. Graupel picks the region
  of the location and a suitable chain of weather models for it; the header shows the region and the chain as text.
  Models without data at the location are skipped and the next model takes over.
* **Power mode**: everything for tuning the forecast. You select one of your saved configurations (or **Auto**, the
  chain normal mode would use), see the model chain cards above the meteogram, can drag the boundaries between models,
  and open the **Config** pane and the **History** of archived forecasts.

Installations upgraded from 0.1.x with own configurations start in power mode once; your configurations are kept and a
backup of the old database is written next to it (`meteogram.db.0.1.0.bak`).

## Meteo pane

### Header

1. The configuration selectbox (power mode) or the region and model chain (normal mode).
2. The location selector on the right. Click inside the textbox and begin typing the name of a place; an autocomplete
   shows matching places. The arrow next to the textbox lists the places you used most. Alternatively click on the
   small map to open it in fullscreen and select a location there.

After selecting a location you will see its coordinates and height above sea level below the textbox. Selecting a new
location or configuration reloads the meteogram; the refresh button next to the textbox forces a reload.

### Body

1. In power mode: the model chain for the basic meteo data and the model chain for the cloud profile, as cards with
   run time, usable hours and resolution. Drag the boundary between two cards to change which model covers which
   hours (only for the current session).
2. The meteogram itself. Hover to see the values, use the mouse wheel to zoom the time axis, or the buttons 4/7/10/14/All
   to pick a day range.

## Config pane (power mode)

* **Basic:** the data folder (where the database lives) and the forecast archive: off by default, or kept for 7, 30,
  90 or 365 days or forever.
* **Model chains:** your configurations. Each has a name, its own location, a layout and two model chains: one for the
  basic meteo data (temperature, precipitation, wind) and one for the detailed height profile of clouds, because the
  best models for meteo data do not always offer a cloud profile. "Start from auto configuration" fills the chains
  with the automatic chain of a region. Changes are saved automatically.
* **Meteogram:** the layout library. A layout defines the drawing areas of the meteogram and which quantities they show;
  edit it with a live preview.

## Share forecast

Click the copy button at the meteogram to copy it as a PNG image to the clipboard, then paste it into an email or a
messenger app. The image contains the location and the time it was created.
