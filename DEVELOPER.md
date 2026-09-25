# License

Project-authored React application code (`react/src` TypeScript/TSX/CSS,
`react/index.html`, and corresponding generated frontend code) is published
under MPL-2.0. All other project-owned files—including Python, tooling,
documentation, models, icons, and images—are published under
GPL-3.0-or-later. See `LICENSE` for the exact boundary and
`LICENSES/MPL-2.0.txt` for the complete MPL text. Third-party libraries and
services retain their own terms, including:

1. OpenMeteo
2. OpenStreeMap
3. MapToolkit
4. MapLibre GL JS

# Repo structure



# Build process

Build and run the desktop app with:

```bash
make run
```

The React production build is written directly to `graupel/react/` and loaded
as package data at runtime. Build both wheel and source distributions with
`make build`.

On Windows, configurations are stored in
`%LOCALAPPDATA%\graupel\meteogram.db` (falling back to
`%USERPROFILE%\AppData\Local\graupel\meteogram.db`). Keeping the SQLite
database on the Windows filesystem avoids locking errors when the source
directory is accessed through `\\wsl.localhost\...`.

On other platforms, the default database is `~/.graupel/meteogram.db`. An explicit `API(storage_path=...)` overrides the default,
including `":memory:"` for a temporary database.

## Rename migration

When the Graupel database does not exist on first use, legacy Meteo and Cumulus
database locations are checked in rename order and copied via SQLite backup.
The original database is retained.

# Weather Model Catalogue

The weather models availabel through OpenMeteo currently are not acccessible via the API, but only through a file `forecast.yaml`, which has to be translated into the model catalogue that can be used within the app.

To rebuild/regenerate the weather-model catalogue from authoritative upstream sources:

```bash
make build-catalogue
# or directly with uv:
uv run python -m graupel.data.build_catalogue
```

# Application icons and Windows shortcuts

`graupel/icons/graupel.svg` is the single cloud-only design source. Run
`python dev-tools/generate_icons.py` with Pillow installed to regenerate the
seven PNG sizes, multi-resolution ICO and React favicon/header asset, then
rebuild React. All icons are shipped as package data; installation does not
require Pillow.

On the first exit after launching an installed package (including pipx), Windows
creates or repairs `Graupel.lnk` in the current user's Start Menu. It targets the
installed `graupel.exe`, has empty arguments and the launcher's working directory.
Its icon is copied from package resources to a content-addressed file in
`%LOCALAPPDATA%\graupel\icons`, so upgrades, reinstalls and temporary zip
extraction do not leave a broken icon reference. Owned legacy `Meteo.lnk` and
`Cumulus.lnk` shortcuts are removed only after the Graupel shortcut succeeds.
The window uses the same ICO via `webview.start(icon=...)`, with the Graupel
AppUserModelID set before creation.
