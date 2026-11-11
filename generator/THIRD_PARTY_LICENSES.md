# Third-party licenses

graupel-gen is licensed under MPL-2.0 (`LICENSE`). It ships no third-party code; the Python packages below are
installed as dependencies and keep their own licenses. Versions as locked in `uv.lock`.

## Python dependencies

| Package | Version | License | Needed by |
|---|---|---|---|
| [httpx](https://github.com/encode/httpx) | 0.28.1 | BSD-3-Clause | graupel-gen |
| [httpcore](https://github.com/encode/httpcore) | 1.0.9 | BSD-3-Clause | httpx |
| [h11](https://github.com/python-hyper/h11) | 0.16.0 | MIT | httpcore |
| [anyio](https://github.com/agronholm/anyio) | 4.15.1 | MIT | httpx |
| [idna](https://github.com/kjd/idna) | 3.20 | BSD-3-Clause | httpx, anyio |
| [typing-extensions](https://github.com/python/typing_extensions) | 4.16.0 | PSF-2.0 | anyio |
| [certifi](https://github.com/certifi/python-certifi) | 2026.10.23 | MPL-2.0 | httpx, httpcore, pyproj |
| [pyproj](https://github.com/pyproj4/pyproj) | 3.8.0 | MIT | graupel-gen |
| [PyYAML](https://github.com/yaml/pyyaml) | 6.0.3 | MIT | graupel-gen |
| [shapely](https://github.com/shapely/shapely) | 2.2.0 | BSD-3-Clause | graupel-gen |
| [numpy](https://github.com/numpy/numpy) | 2.5.4 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | shapely |

Development only: [pytest](https://github.com/pytest-dev/pytest) (MIT) and its dependencies.

The binary wheels of pyproj, shapely and numpy contain native libraries (PROJ, GEOS, OpenBLAS and others) under their
own licenses; their license files are installed with the wheels. graupel-gen does not redistribute them.

## Data sources

The generator downloads these at run time; it stores none of them in the repository except the results in
`model-data/` (see `model-data/LICENSE` and `model-data/THIRD_PARTY_LICENSES.md`).

| Source | License | Use |
|---|---|---|
| [Open-Meteo.com](https://open-meteo.com/) Forecast API, `/data/{path}/static/meta.json`, Single Runs API | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | catalogue, horizons, domains; results under CC BY 4.0 with attribution |
| Open-Meteo OpenAPI `forecast.yml` from [open-meteo/open-meteo](https://github.com/open-meteo/open-meteo) | license of that repository | only the model list is read; the file is cached outside the repository and never checked in |
| [Natural Earth](https://www.naturalearthdata.com/) 10 m Admin 0 Countries, v5.1.2 | Public domain | country borders for `regions.geojson` and the chain zones |

`tests/fixtures/forecast_models.yml` is a minimal test input with the model IDs of the catalogue (CC BY 4.0, derived
from Open-Meteo.com, see its header).
