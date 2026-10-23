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
make -f Makefile.public setup      # uv sync --group dev, pnpm install
make -f Makefile.public run-fresh  # build the frontend and start the app
```

The React production build is written directly to `graupel/react/` and loaded
as package data at runtime. Build both wheel and source distributions with
`make -f Makefile.public package` (frontend build, then `uv build`). In the
private repository the root `Makefile` is the maintainer's local WSL variant;
in the public repository `Makefile.public` is the `Makefile`, so plain
`make setup`, `make run-fresh` etc. work there.

On Windows, configurations are stored in
`%LOCALAPPDATA%\graupel\meteogram.db` (falling back to
`%USERPROFILE%\AppData\Local\graupel\meteogram.db`). Keeping the SQLite
database on the Windows filesystem avoids locking errors when the source
directory is accessed through `\\wsl.localhost\...`.

On other platforms, the default database is `~/.graupel/meteogram.db`. An explicit `API(storage_path=...)` overrides the default,
including `":memory:"` for a temporary database.

## Tests

```bash
uv run pytest tests                 # Python (needs the built frontend)
pnpm --dir react test               # tsc -b + Vitest unit tests
pnpm --dir react run test:e2e       # Playwright browser tests
```

The Playwright suite (`react/e2e/`) starts its own Vite dev server on
`127.0.0.1:4173` and replaces the pywebview bridge with a deterministic
fixture (`react/e2e/bridgeFixture.ts`), so it needs no backend and no network.
Install the browser once with `pnpm --dir react exec playwright install chromium`.

## Normal and power mode

The mode is the app setting `mode` (`MeteogramAPI.get_settings` /
`update_settings`); new installations start in normal mode, 0.1.x installations
with own configurations once in power mode. Normal mode resolves a model chain
for the location (`graupel/data/auto_chain.py`, regions in
`graupel/models/regions.json`, model domains in `model_domains.json`) and
draws the fixed layout **Default**; power mode uses the saved configurations
(first entry **Auto**), their layouts and the Config pane. Both modes fetch the
same quantities (the fetch set of `graupel/data/quantities.py`), so switching
never needs new data. Behaviour and decisions are described in
`docs/system.md` (cited as `system.md §<n>` in comments); in the private
repository it is `plan/APP/system.md` on branch `plan`, and
`dev-tools/copy_release.sh` copies it to `docs/system.md`.

## Database format and 0.1.x migration

`meteogram.db` carries its format in the `db_meta` table (`app_version`,
`schema_version`, see `graupel/data/storage.py`). A database without `db_meta`
comes from 0.1.x: on opening it, `Storage` moves it to `meteogram.db.0.1.0.bak`
(with `-wal` / `-shm`), creates a fresh database and imports only the
configurations. Databases under the old Meteo/Cumulus folders are not read.
`tests/test_upgrade_0_1_0.py` upgrades a database written by the released
0.1.0 (`tests/fixtures/graupel-0.1.0.db`, see
`tests/fixtures/make_graupel_0_1_0_db.py`).

# Weather Model Catalogue

The app reads its weather models from `graupel/models/model_catalogue.json`. The models come from the `models` enum of Open-Meteo's OpenAPI file `forecast.yml` (cached in `dev-tools/forecast.yml`); there is one generator for the catalogue:

```bash
uv run python dev-tools/update_catalog.py
```

It probes every model for the quantities of the registry (`graupel/data/quantities.py`), its pressure levels and its longest run, and merges the result into the catalogue: models whose probe fails keep their entry, unchanged entries stay byte-identical, and curated fields (name, provider, region, resolution) are only derived for new models. `--horizons-only` re-measures only the horizons.

Model nicknames for the orange meteogram header (`short_name`) are curated in `graupel/data/model_short_names.py`. After changing that list, copy it into the catalogue without network access:

```bash
uv run python dev-tools/update_catalog.py --short-names-only
```

# Model domains and regions

Normal mode picks its model chain from two generated package files:

```bash
uv run python dev-tools/update_model_domains.py   # graupel/models/model_domains.json
uv run python dev-tools/update_regions.py         # regions.json, chain_zones.json
```

`update_model_domains.py` derives each catalogue model's domain (run it after
the catalogue changed), `update_regions.py` builds the regions and the chain
zones offered by "Start from auto configuration". Both also write the data of
the Model Domain Viewer (`docs/domain/*.js`) when `docs/domain/` exists; the
viewer is only in the private repository, so in the public one they skip it.
`tests/test_domain_viewer.py` (private only) checks that the viewer data match
the package files.

# Public repository

The public repository receives the app, the generators and the tests from the
private one with

```bash
dev-tools/copy_release.sh --dry-run ../graupel-public   # list what changes
dev-tools/copy_release.sh ../graupel-public
```

The destination must be the top of a Git checkout. The script copies only
files tracked by Git (`graupel/`, `react/`, `tests/`, `dev-tools/`,
`LICENSES/`, the workflows `tests.yml` and `release.yml`, the root
configuration and documentation files, `Makefile.public` as `Makefile`) plus
`APP/system.md` from branch `plan` as `docs/system.md`. It leaves out the map
viewer (`docs/`), the workflow files (`AGENTS*.md`, `workflow/`, `plan/`),
itself, `tests/test_copy_release.py` and `tests/test_domain_viewer.py`. Files
the destination tracks under those paths (and under `.github/`) that the
private repository no longer has are deleted; untracked files there, such as
`react/node_modules`, and everything else stay. `tests/test_copy_release.py`
checks this against a temporary repository.

Afterwards, in the destination: build the frontend, run `uv run pytest tests`
and `pnpm --dir react test`, review `git status`, then commit and push.

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
