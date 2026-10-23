# Changelog

## 0.2.1

Tooling only; the app is unchanged.

- The public repository is now filled by `dev-tools/copy_release.sh`, which
  copies only tracked files and removes files that no longer exist.
- `docs/system.md` describes behaviour, data model and decisions (cited as
  `system.md §<n>` in the code).
- `update_model_domains.py` and `update_regions.py` run without the private
  map viewer and skip its data.

## 0.2.0

Graupel 0.2.0 splits the app into a simple normal mode and a power mode for
everything 0.1.x could do, and makes the meteogram configurable.

### New

- **Normal mode** (default for new installations): pick a location, get a
  meteogram. The model chain is chosen automatically from the region of the
  location and the domains of the models; models without data at the location
  drop out and the next one takes over. The header shows region and chain.
- **Power mode**: saved configurations with their own location, an **Auto**
  entry with the automatic chain, model chain cards with run, usable hours and
  resolution, the Config pane and the forecast history. The switch sits in the
  header next to the logo, in both modes.
- **Meteogram layouts**: drawing areas, quantities, axes and options are a
  layout. The library has the built-in **Default** and **Power default** plus
  your own layouts, edited with a live preview; each configuration picks one.
- New quantities: snowfall and snow depth (snow drawn on top of rain) and the
  weather code.
- **Forecast archive** (off by default; 7, 30, 90, 365 days or forever) and a
  **history viewer** that redraws an archived forecast with the current layout.
- **Data folder**: choose where the database lives and move it while the app
  runs.
- Copy the meteogram as a **PNG** to the clipboard, with location label,
  creation time and Open-Meteo attribution.
- Day ranges 4/7/10/14/All, sunrise and sunset times, start and stop marks at
  data gaps, short model names in the orange headers, a button that lists the
  most used locations in the location search, and an in-memory cache: the same location and chains
  load without a new request until you press refresh.

### Kept

- Your configurations: on the first start, a 0.1.x database is backed up to
  `meteogram.db.0.1.0.bak` (next to the database) and its configurations are
  imported, with their order. They use the **Power default** layout, which
  draws the full 0.1.x meteogram. If you changed or added configurations, the
  app starts in power mode.
- Model chains with a cloud chain for the vertical cloud profile, map location
  picker, time-axis zoom, the Windows start menu shortcut.

### Removed or changed

- Not carried over from 0.1.x: cached forecasts, the location history and
  other stored data apart from the configurations (they stay in the backup).
- Databases in the old Meteo and Cumulus folders are no longer looked for.
- Dragged boundaries between models only last for the session; they are never
  saved into the configuration.
- For developers: one model catalogue (`graupel/models/model_catalogue.json`)
  and one generator (`dev-tools/update_catalog.py`); `model_catalog.json`,
  `graupel.data.build_catalogue` and `make build-catalogue` are gone, as are
  the release spec under `docs/spec-0.2.0/` and the empty app template under
  `docs/empty_gui/`.
