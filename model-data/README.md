# model-data

Modelldaten von Graupel, erzeugt von `graupel-gen` (`generator/`), eingecheckt, Workspace-Paket
`@graupel/model-data`. Nicht von Hand bearbeiten: Änderungen gehören in `generator/sources/` oder den Generator.

| Datei | Inhalt |
|---|---|
| `model_catalogue.json` | Modellkatalog; je Modell u. a. `documentation_url` (Modelldokumentation, https oder `null`) und `provider_url` (Homepage des Veröffentlichers) |
| `model_domains.json` | Modellgebiete (`"global"` oder Polygon) |
| `regions.geojson` | Regionen mit Präferenzketten |
| `chain_zones.json`, `chain_zones.geojson` | Gebiete gleicher aufgelöster Kette, ohne bzw. mit Geometrie |
| `quantities.json` | Größen-Registry |
| `resolver_cases.json` | Prüfpunkte des Resolvers mit aufgelösten Ketten |

Jede Datei hat ein Kopffeld `meta` mit Lizenz (`license`, `license_url`, bei Open-Meteo-Daten `attribution`),
Erzeuger, Zeitpunkt und Quellen; die Formate beschreibt `generator/README.md`.

## Lizenz

| Dateien | Lizenz |
|---|---|
| `model_catalogue.json`, `model_domains.json`, `chain_zones.json`, `chain_zones.geojson` | CC BY 4.0, „Contains data derived from Open-Meteo.com (CC BY 4.0)“, bearbeitet |
| `quantities.json`, `regions.geojson`, `resolver_cases.json` | MPL-2.0 |

Volltexte in `LICENSES/`, Übersicht in `LICENSE`, maschinenlesbar in `REUSE.toml`, Datenquellen in
`THIRD_PARTY_LICENSES.md`. Wer die CC-BY-Dateien weitergibt, behält die Namensnennung (`meta.attribution`) bei.
