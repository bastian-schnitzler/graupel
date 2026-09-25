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

* Custom model chains for short-, medium-, and long-range forecasts
* Multiple numerical weather prediction models
* Detailed alpine meteograms
* Vertical cloud profile visualization
* Temperature, precipitation, wind, cloud, CAPE/CIN and other weather parameters
* Interactive time-range zoom
* Configurable locations and forecast presets
* Interactive maps
* Local desktop application
* Local configuration and forecast storage


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

## Overview

The app has two panes between which you can switch:

1. meteo, showing the actual meteogram
2. config, configure model chains for weather data

A configuration holds two model chains (e.g. a stack of models from smaller to bigger horizon, see Introduction to weather models), one for the basic meteo data (temperature, precipitation, wind) and one for a detailed height profile of clouds (because the best models for meteo data do not always offer detailed cloud profile).

You select a configuration and a location and the program will construct a meteogram from the weather data received from OpenMeteo.

### Meteogram pane

#### Header

In the header you have

1. a configuration selectbox in the lower left corner
2. a location selector in the right header part

Click inside the location selector's textbox and begin typing the name of a place. An autocomplete will show you known places starting with your typing.

Alternatively you can click on the map to open it in fullscreen an select a location by clicking on the map.

After selecting a location you will see its coordinates and height as meters above see level below the textbox

You can change the configuration, and therefore the models which will supply the data for your meteogram, by selecting one in the dropdown.

Selecting a new location or configuration will automatically reload the meteogram. You can force it to reload by clicking the refresh button next to the textbox.

#### Body

Below the header you will find

1. The model chain for basic meteo data
2. The model chain for the cloud profile
3. The meteogram itself

## Share forecast

On Windows, make a screenshot of the meteogram area via the snipping tool or greenshot and copy it into email or messenger app.

On Linux, the easiest way depends on your desktop environment:

- GNOME: press `Shift + Print Screen` and drag over the area you want. On newer GNOME versions, just `Print Screen` opens the screenshot UI where you can choose a rectangular region.
- KDE Plasma: press `Meta + Shift + S` to select a rectangular region with Spectacle.
- XFCE: usually `Shift + Print Screen` for selecting a region.

On macOS, select part of the screen with:

```
⌘ Command + ⇧ Shift + 4
```

Then drag over the area you want to capture.
Press Esc to cancel.
