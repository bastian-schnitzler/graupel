# Third-party data

`@graupel/model-data` contains data derived from these sources. The license of each file is in `LICENSE` and in its
`meta.license`; `meta.sources` names the sources and versions a file was made from.

| Source | License | Used in |
|---|---|---|
| [Open-Meteo.com](https://open-meteo.com/): Forecast API, model metadata (`/data/{path}/static/meta.json`), OpenAPI model list | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `model_catalogue.json`, `model_domains.json`, `chain_zones.json`, `chain_zones.geojson` |
| [Natural Earth](https://www.naturalearthdata.com/) 10 m Admin 0 Countries, v5.1.2 | Public domain ([terms of use](https://www.naturalearthdata.com/about/terms-of-use/)) | `regions.geojson`, `chain_zones.geojson`, `resolver_cases.json` |

Attribution for the Open-Meteo data, as written in `meta.attribution` of each of these files:

> Contains data derived from Open-Meteo.com (CC BY 4.0, https://open-meteo.com/). Modified: selected, combined and
> processed by graupel-gen; see meta.sources.
