# generator

GEN: erzeugt die Modelldaten in `model-data/` (Workspace-Paket `@graupel/model-data`): Modellkatalog, Modellgebiete,
Regionen mit Modellketten, Chain-Zonen, Größen-Registry und Prüfpunkte des Resolvers. Python-Paket mit uv, CLI
`graupel-gen`.

```sh
uv sync
uv run pytest                      # offline
uv run graupel-gen catalog         # Katalog und quantities.json (Open-Meteo)
uv run graupel-gen domains --only icon_d2,icon_eu   # Modellgebiete (Open-Meteo, einige tausend Anfragen)
uv run graupel-gen regions         # Regionen, Chain-Zonen, resolver_cases.json (Natural Earth, offline rechnen)
uv run graupel-gen all             # alles nacheinander
```

Optionen: `--out DIR` (Standard `model-data/`), `--sources DIR` (Standard `generator/sources/`), `--cache-dir DIR`
(Downloads, Standard `~/.cache/graupel-gen`), `--only IDS` (catalog, domains), `--offline` (catalog, domains: keine
Anfrage, nur bestehende Datei mit kuratierten Feldern im aktuellen Format neu schreiben; mit `--existing FILE` aus
einer anderen Datei; regions: ohne Geometrie-Rechnung nur die Zonenliste aus `--existing` übernehmen und
`resolver_cases.json` schreiben, `chain_zones.geojson` bleibt), `--horizons-only` (catalog), `--forecast-yml FILE`, `--openapi-ref REF`,
`--countries FILE`, `--natural-earth TAG`.

Anfragen an Open-Meteo sind auf 8 je Sekunde gedrosselt und werden begrenzt wiederholt.

## Eingaben

- `sources/models.yaml`: kuratierte Katalogfelder (Name, Anbieter, Region, Auflösung, aktiv, `documentation_url`),
  Metadaten-Pfade (`meta_path`, `ensemble_meta_path`), Probe-Punkte; Anbieter neuer Modelle nach ID-Präfix;
  `provider_urls`: Homepage je Anbieter; `excluded_models`: Modelle der Open-Meteo-Enum, die nicht in den Katalog
  kommen (auch nicht mit `--offline`); `extra_models`: Modelle, die die Forecast-API liefert, obwohl die Enum sie
  nicht nennt (z. B. RRFS); sie werden wie Enum-Modelle geprüft und hinter den Enum-Modellen eingereiht. Alle URLs
  müssen https mit Host sein, jeder genannte Anbieter braucht eine Homepage; der Generator prüft nur die Form und ruft
  die URLs nicht ab. Inaktive Modelle (`active: false`, z. B. das eingestellte AROME Austria oder HRRR) nimmt der
  Resolver nicht in den Domain-Fallback.
- `sources/short_names.yaml`: Kurznamen (`short_name`) für Modelle mit Namen über 10 Zeichen.
- `sources/regions.yaml`: Regionen mit Präferenzketten und die gezeichneten Alpenregionen. Länderregionen umfassen
  ihre Küstengewässer bis 1,0° vor der Küste, an der Mittellinie zwischen Nachbarn geteilt.
- `sources/resolver_points.yaml`: Prüfpunkte mit erwarteter Region.
- Open-Meteo: OpenAPI `forecast.yml` (nur geladen, nicht eingecheckt), Forecast-API, `meta.json`, Single Runs API.
- Natural Earth 10 m Admin-0 in der gepinnten Version `v5.1.2` (SHA-256 geprüft).

## Ausgabe

Jede Datei hat ein Kopffeld `meta` (`license`, `license_url`, bei Open-Meteo-Daten `attribution`, dann
`generated_by`, `generated_at`, `sources` mit Version). Die Lizenzfelder setzt `write_document` nach dem Dateinamen
(`FILE_LICENSES` in `output.py`), sie bleiben also bei jedem Lauf erhalten. Eine Datei, deren Inhalt sich außer
`generated_at` nicht ändert, wird nicht neu geschrieben.

| Datei | Inhalt |
|---|---|
| `model_catalogue.json` | Modelle: id, name, short_name, documentation_url, provider, provider_url, region, spatial_resolution_km, temporal_resolution_hours, max_forecast_hours, supported_variables, pressure_levels_hpa, meta_path, ensemble_meta_path, active (Felder unten) |
| `model_domains.json` | id → `"global"` oder `{source: grid\|measured, polygon: [[lon, lat], …]}`, nicht am Antimeridian geteilt |
| `regions.geojson` | Regionen: id, name, priority, group, area_km2, main_chain_ids, cloud_chain_ids |
| `chain_zones.json` | Zonen gleicher Kette ohne Geometrie |
| `chain_zones.geojson` | dieselben Zonen mit Geometrie, je Zone und Teil (`land`, `coast`, `sea`) ein Feature |
| `quantities.json` | Größen-Registry für Download und Meteogramm |
| `resolver_cases.json` | Prüfpunkte mit aufgelösten Ketten |

### Felder eines Modells in `model_catalogue.json`

| Feld | Typ | Inhalt |
|---|---|---|
| `id` | Text | Modell-ID von Open-Meteo (`models=`) |
| `name`, `short_name` | Text, Text oder `null` | Anzeigename, Kurzname für Namen über 10 Zeichen |
| `documentation_url` | https-URL oder `null` | Beschreibung des Modells beim Veröffentlicher, ersatzweise die Seite des Anbieters in der Open-Meteo-Dokumentation; Seamless-Blends und `best_match` zeigen auf die Open-Meteo-Dokumentation. Kuratiert (`models.yaml`) vor bestehendem Katalog; neues Modell ohne Eintrag: `null` |
| `provider` | Text | Veröffentlicher |
| `provider_url` | https-URL | Haupt-Homepage des Veröffentlichers (`provider_urls` in `models.yaml`); `null` nur beim abgeleiteten Anbieter `Unknown` |
| `region` | Text | Gebiet in Worten |
| `spatial_resolution_km`, `temporal_resolution_hours` | Zahl | Gitterweite, Zeitschritt |
| `max_forecast_hours` | Zahl | Länge des längsten Laufs |
| `supported_variables`, `pressure_levels_hpa` | Liste | katalogisierte Größen, Druckflächen mit Wolkenbedeckung |
| `meta_path`, `ensemble_meta_path` | Text oder `null` | Pfade der Open-Meteo-Metadaten des Modells und des Ensembles |
| `active` | Wahrheitswert | Modell aktiv (kuratiert) |

## Lizenz

Der Generator steht unter der Mozilla Public License 2.0 (`LICENSE`); jede Quelldatei trägt den SPDX-Header,
Dateien ohne Kommentarmöglichkeit stehen in `REUSE.toml`. Abhängigkeiten und Datenquellen: `THIRD_PARTY_LICENSES.md`.

Die Daten in `model-data/` (DEC-006): aus Open-Meteo abgeleitete Dateien (`model_catalogue.json`, `model_domains.json`,
`chain_zones.json`, `chain_zones.geojson`) unter CC BY 4.0 mit Namensnennung von Open-Meteo.com, die übrigen
(`quantities.json`, `regions.geojson`, `resolver_cases.json`) und `sources/` unter MPL-2.0. Neue Ausgabedateien
brauchen einen Eintrag in `FILE_LICENSES` und in `model-data/REUSE.toml`; `tests/test_license.py` prüft das.
