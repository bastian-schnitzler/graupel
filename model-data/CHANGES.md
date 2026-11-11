# Änderungen an den Modelldaten

## RRFS statt HRRR, 11.11.2026 (TASK-355, REQ-768)

Open-Meteo stellt HRRR (`ncep_hrrr_conus`) am 30.11.2026 ein; Nachfolger ist RRFS (`ncep_rrfs_conus`, 3 km,
stündlich, 84 h, alle 6 h neu). Das OpenAPI-`forecast.yml` nennt RRFS nicht, die Forecast-API liefert es; dafür gibt es
in `generator/sources/models.yaml` die neue Liste `extra_models`, deren Modelle wie Enum-Modelle geprüft und hinter
ihnen eingereiht werden. RRFS ist dort aktiv (3,0 km) mit Kurzname „RRFS“, HRRR bleibt im Katalog, aber
`active: false`. In `regions.yaml` steht RRFS statt HRRR in Haupt- und Wolkenkette von `usa` und `canada`. Erzeugt mit
`graupel-gen catalog --only ncep_rrfs_conus`, `graupel-gen domains --only ncep_rrfs_conus`, `graupel-gen regions` und
(für die neuen Prüfpunkte Chicago, Denver, Miami) `graupel-gen regions --offline`.

| Datei | Ergebnis |
|---|---|
| `model_catalogue.json` | neues Modell `ncep_rrfs_conus` am Ende (47 Modelle): 84 h, gemessen über die Single Runs API (sie lieferte RRFS ohne Ratenlimit), 39 Druckflächen mit Wolkenbedeckung (1000–50 hPa, damit wolkentauglich), alle Größen außer der Niederschlagswahrscheinlichkeit; `ncep_hrrr_conus` mit `active: false`. `meta.sources` unverändert |
| `model_domains.json` | `ncep_rrfs_conus`: Gitter aus `meta.json` (21,1–52,6° N, 134,1–60,9° W, dasselbe Lambert-Gitter wie HRRR), von den Rand-Proben der Forecast-API bestätigt (`source: grid`); übrige Gebiete unverändert |
| `regions.geojson` | Ketten von `usa` und `canada` mit RRFS statt HRRR; Geometrie unverändert |
| `chain_zones.json`, `chain_zones.geojson` | 38 statt 37 Zonen. USA: RRFS > NBM > IFS (Wolken RRFS > IFS 0,25°), RDPS fällt heraus, weil es RRFS' 84 h nicht verlängert; Domain-Fallback in Mexiko und der Karibik RRFS > IFS statt HRRR > IFS. Neu ist die Zone HRDPS > RRFS > IFS in Kanada (1 686 379 km², dort, wo RRFS reicht; vorher HRDPS > RDPS > IFS, denn HRRR verlängerte HRDPS' 48 h nicht). Sonst nur Abweichungen der Zonenzerlegung an Küsten und am Südrand des RRFS-Gitters in Mexiko: die globale Zone ist 17 628 km² kleiner, die Lücke zwischen ihr und der RRFS-Fallback-Zone in `chain_zones.geojson` (22,5–24,9° N, schon vorher 0,29 Quadratgrad) ist auf 0,93 Quadratgrad gewachsen |
| `resolver_cases.json` | New York mit RRFS > NBM > IFS; neue Prüfpunkte Chicago, Denver, Miami (Region `usa`, RRFS zuerst). `meta.sources` nach dem Lauf mit `--offline` von Hand ergänzt (Katalog und Gebiete wie im vollen Lauf) |
| `quantities.json` | unverändert |

## C-LAEF statt AROME Austria, 11.11.2026 (TASK-354, REQ-767)

GeoSphere hat AROME Austria am 04.11.2026 eingestellt (letzter Lauf 03 UTC, Daten bis 06.11.); Nachfolger ist C-LAEF
(`geosphere_claef_austria`, 1 km, stündlich, 60 h, alle 3 h neu). In `generator/sources/`: C-LAEF in `models.yaml`
(aktiv, 1,0 km) mit Kurzname „C-LAEF“, AROME Austria bleibt im Katalog, aber `active: false`; die Ketten von
`austria` und `central_eastern_europe` (und damit `eastern_alps`, `bavarian_alps_south`) beginnen mit C-LAEF. Der
Resolver nimmt inaktive Modelle nicht mehr in den Domain-Fallback, `geosphere_seamless` übernimmt das Gebiet von
C-LAEF (Open-Meteo mischt dort jetzt C-LAEF). Erzeugt mit `graupel-gen catalog --only geosphere_claef_austria`,
`graupel-gen domains --only geosphere_claef_austria,geosphere_seamless`, `graupel-gen regions` und (für die neuen
Prüfpunkte Sölden, Innsbruck, Großglockner) `graupel-gen regions --offline`.

| Datei | Ergebnis |
|---|---|
| `model_catalogue.json` | neues Modell `geosphere_claef_austria` (11 Druckflächen mit Wolkenbedeckung, ohne Wahrscheinlichkeit); `max_forecast_hours` von Hand auf 60 gesetzt: die Single Runs API antwortete mit 429 (Tageslimit), die Probe der Forecast-API sah nur die restlichen 55 h des laufenden Laufs; 60 h nennen Open-Meteo und `meta.json` (`data_end_time` − `last_run_initialisation_time`). `geosphere_arome_austria` mit `active: false`. `meta.sources`: forecast.yml mit neuem SHA-256, API-Stand 2026-11-11 |
| `model_domains.json` | `geosphere_claef_austria` und `geosphere_seamless`: Gitter-Rechteck aus `meta.json` (43,002–51,498° N, 5,032–22,568° O), von den Rand-Proben der Forecast-API bestätigt (`source: grid`); übrige Gebiete unverändert. `meta.sources` nennt nur noch den API-Lauf vom 2026-11-11 (so schreibt `--only` die Datei), die übrigen Gebiete bleiben unverändert |
| `regions.geojson` | Ketten der Regionen mit C-LAEF statt AROME Austria; Geometrie unverändert |
| `chain_zones.json`, `chain_zones.geojson` | Zonen mit C-LAEF statt AROME Austria; C-LAEF ist mit 1 km das feinste Modell seines Gebiets und hat genug Druckflächen für die Wolken, daher führt C-LAEF jetzt im Domain-Fallback außerhalb der Regionen im Westen Rumäniens und im Grenzgebiet Serbien/Rumänien (zwei Zonen, 12 065 km² und 8 330 km², bisher ICON-EU bzw. ICON-2I zuerst; Wolkenkette C-LAEF, ICON-EU, IFS) |
| `resolver_cases.json` | C-LAEF in den Ketten von Watzmann, Berchtesgaden und Wien; neue Prüfpunkte Sölden, Innsbruck, Großglockner (Region `austria`, C-LAEF zuerst) |
| `quantities.json` | unverändert |

## Modelldokumentation und Homepage des Veröffentlichers, 10.11.2026 (TASK-292, REQ-688)

Zwei neue Felder je Modell im Katalog: `documentation_url` (https-URL oder `null`), die Beschreibung des Modells beim
Veröffentlicher, ersatzweise die Seite des Anbieters in der Open-Meteo-Dokumentation, bei Seamless-Blends und
`best_match` immer die Open-Meteo-Dokumentation; `provider_url` (https-URL), die Haupt-Homepage des Veröffentlichers.
Beide sind kuratiert in `generator/sources/models.yaml` (`documentation_url` je Modell, `provider_urls` je
Veröffentlicher) und gehen dem bestehenden Katalog vor; ein neues Modell ohne Eintrag bekommt `documentation_url: null`
und die Homepage seines Veröffentlichers. Der Generator prüft nur die Form (https, Host) und ruft die URLs nicht ab.
Ohne Netz neu geschrieben (`graupel-gen catalog --offline`).

| Datei | Ergebnis |
|---|---|
| `model_catalogue.json` | alle 45 Modelle mit `documentation_url` und `provider_url` (nach `short_name` bzw. `provider`); 14 Links zeigen auf Seiten der Veröffentlicher (DWD, ECMWF, NOAA, JMA, ECCC), 31 auf die Open-Meteo-Dokumentation; sonst unverändert, `meta.sources` bleibt, `generated_by` nennt 0.5.0 |
| `quantities.json`, `model_domains.json`, `regions.geojson`, `chain_zones.json`, `chain_zones.geojson`, `resolver_cases.json` | unverändert |

## Relative Luftfeuchte in der Größen-Registry, 03.11.2026 (TASK-246, REQ-648)

Neue Größe `relative_humidity` (Open-Meteo `relative_humidity_2m`, %, Punktwert) für die Luftfeuchte-Linie im
Meteogramm: optional, nicht im Katalog geprüft (`catalogued: false`) und bei einer abgelehnten Anfrage weggelassen
(`retry_without: true`), wie `dew_point`. Ohne Netz neu geschrieben (`graupel-gen quantities`, nur die Registry, keine
Katalog-Abfrage).

| Datei | Ergebnis |
|---|---|
| `quantities.json` | mit `relative_humidity` nach `dew_point`; die Download-Bibliothek fragt sie mit jeder Vorhersage an |
| `model_catalogue.json`, `model_domains.json`, `regions.geojson`, `chain_zones.json`, `chain_zones.geojson`, `resolver_cases.json` | unverändert |

## Taupunkt in der Größen-Registry, 31.10.2026 (TASK-179, REQ-596)

Neue Größe `dew_point` (Open-Meteo `dew_point_2m`, °C, Punktwert) für Taupunkt und Spread im Meteogramm: optional,
nicht im Katalog geprüft (`catalogued: false`) und bei einer abgelehnten Anfrage weggelassen (`retry_without: true`),
wie `snow_depth`. Ohne Netz neu geschrieben (`graupel-gen quantities`, nur die Registry, keine Katalog-Abfrage).

| Datei | Ergebnis |
|---|---|
| `quantities.json` | mit `dew_point` nach `apparent_temperature`; die Download-Bibliothek fragt sie mit jeder Vorhersage an |
| `model_catalogue.json`, `model_domains.json`, `regions.geojson`, `chain_zones.json`, `chain_zones.geojson`, `resolver_cases.json` | unverändert |

## Quantity-Katalog ohne Konvektionsgrößen, 26.10.2026 (TASK-068, REQ-453, REQ-447)

Die drei Größen der Konvektionsfläche des Meteogramms entfallen: `cape` (CAPE), `convective_inhibition` (CIN) und
`lightning_potential` (LPI). Ohne Netz neu geschrieben (`graupel-gen catalog --offline`).

| Datei | Ergebnis |
|---|---|
| `quantities.json` | ohne `cape`, `convective_inhibition`, `lightning_potential`; die Download-Bibliothek fragt sie nicht mehr an |
| `model_catalogue.json` | `supported_variables` ohne die drei Größen (der Offline-Lauf streicht Variablen, die keine katalogisierten Größen mehr sind); sonst unverändert, `meta.sources` bleibt |
| `model_domains.json`, `regions.geojson`, `chain_zones.json`, `chain_zones.geojson`, `resolver_cases.json` | unverändert: sie hängen nicht von den Größen ab |

## RDPS über dem Nordpol geschlossen, 26.10.2026 (TASK-059, REQ-441)

Der Umriss von `cmc_gem_rdps` umschließt den Nordpol. Beim Schließen über den Pol fehlte bisher der letzte Schritt
zwischen letztem und erstem Randpunkt (311,411° O = 48,589° W, 14,594° N → 316,451° O = 43,549° W, 19,881° N); der
Umriss umfasste nur 355° Länge, ein 5°-Streifen bei 43,5–48,6° W (Mittelgrönland, Labradorsee, Westatlantik bis
19,9° N) lag außerhalb von RDPS. Ursache war `close_ring` in `generator/src/graupel_gen/domains.py`: Es schloss den
Ring über den Pol vom letzten zum ersten Randpunkt, ohne den Randschritt dazwischen. Jetzt endet der Rand am ersten
Randpunkt um 360° verschoben (316,451° O) und kehrt erst dann über den Pol zurück. Andere Gebiete umschließen keinen
Pol und sind nicht betroffen.

| Datei | Ergebnis |
|---|---|
| `model_domains.json` | RDPS geometrisch korrigiert, nicht neu vermessen (`graupel-gen domains --offline`): Punkt `[316.451, 19.881]` vor der Polkappe, die Polkappe reicht von 316,451° O bis −43,549° O (genau 360°); alle anderen Gebiete unverändert |
| `regions.geojson` | unverändert |
| `chain_zones.json`, `chain_zones.geojson` | neu gerechnet (`graupel-gen regions`, nur Natural Earth, keine Anfrage an Open-Meteo); dieselben Zonen mit denselben Ketten und Stichpunkten, nur Flächen und Ränder verschieben sich leicht, weil RDPS die Stücke an der früheren Lücke nicht mehr zerschneidet (z. B. „nur IFS“: Land +5 889 km², Meer −10 312 km²) |
| `resolver_cases.json` | neu gerechnet, Ergebnisse unverändert |

Im früheren Streifen liegt RDPS jetzt vor (z. B. 72° N, 46° W). Die Kette dort bleibt `ecmwf_ifs`: RDPS ist außerhalb
der Regionen gröber als IFS und wird im Gebiets-Fallback nicht genommen. Der Model Domain Viewer schloss die Lücke
beim Zeichnen schon selbst; mit den korrigierten Daten ändert `normalizeRing` RDPS nicht mehr.

## Neulauf gegen Open-Meteo, 26.10.2026 (TASK-016, REQ-090)

Erster voller Lauf von `graupel-gen` nach DEC-008; verglichen mit den vorherigen Dateien. Gelaufen von einem Rechner mit eigener IP (DEC-030), ohne 429.

| Datei | Ergebnis |
|---|---|
| `model_catalogue.json` | neu gemessen am 26.10.2026 13:40 UTC, ohne die entfernten Modelle neu geschrieben (`generated_at` 2026-10-26T14:13:50Z); Abweichungen unten |
| `quantities.json` | unverändert |
| `model_domains.json` | nicht neu vermessen: kein Modell ist neu oder hat geänderte Gebietsfelder (DEC-008); die fünf entfernten Modelle fehlen |
| `regions.geojson` | Kette der Region Korea ohne `kma_ldps` |
| `chain_zones.json`, `chain_zones.geojson`, `resolver_cases.json` | neu gerechnet; Zonen in Korea ohne `kma_ldps` |

### Katalog

Dieselben Modelle in derselben Reihenfolge wie zuvor, ohne die fünf entfernten; Name, Kurzname, Anbieter,
Region, Auflösung, Horizont, Zeitschritt, Metadaten-Pfade und `active` sind unverändert. Abweichungen gibt es nur bei
den gemessenen Feldern `pressure_levels_hpa` und `supported_variables`.

**Entfernte Modelle** (DEC-033, REQ-440). Für fünf Modelle rechnet Open-Meteo keine neuen Läufe mehr; die
Forecast-API liefert nur Nullwerte, die Single Runs API antwortet mit 400. Sie stehen jetzt in `excluded_models` in
`generator/sources/models.yaml` und fehlen in Katalog, Modellgebieten und Ketten. Der Katalog hat damit 45 Modelle.

| Modell | letzter Lauf laut `meta.json` |
|---|---|
| `bom_access_global` | 26.06.2025 18 UTC |
| `kma_ldps` | 31.03.2026 12 UTC |
| `kma_gdps` | 31.03.2026 18 UTC |
| `kma_seamless` | kein Zeitpunkt in `meta.json` |
| `ncep_gfs_graphcast025` | 05.05.2026 00 UTC |

Die Region Korea rechnet jetzt mit der Kette `jma_msm > ecmwf_ifs` statt `kma_ldps > jma_msm > ecmwf_ifs`.

**Wegfallende Variablen**

| Modell | entfällt |
|---|---|
| `ncep_aigfs025` | apparent_temperature |
| `ncep_hgefs025_ensemble_mean` | apparent_temperature |

**Druckflächen** (hPa). Open-Meteo führt bei vielen Modellen inzwischen mehr Flächen; bei einigen fehlen Flächen, die
das Modell im Probe-Punkt nicht mehr liefert.

| Modell | Anzahl | neu | entfällt |
|---|---|---|---|
| `best_match` | 15 → 44 | 975, 875, 825, 775, 750, 725, 675, 650, 625, 575, 550, 525, 475, 450, 425, 375, 350, 325, 275, 225, 175, 125, 70, 50, 40, 30, 20, 15, 10 | – |
| `ecmwf_ifs025` | 13 → 14 | 10 | – |
| `cma_grapes_global` | 12 → 30 | 975, 950, 900, 800, 750, 650, 550, 450, 350, 275, 225, 175, 125, 70, 50, 30, 20, 10 | – |
| `ncep_hrrr_conus` | 44 → 38 | – | 70, 40, 30, 20, 15, 10 |
| `ncep_aigfs025` | 44 → 13 | – | 975, 950, 900, 875, 825, 800, 775, 750, 725, 675, 650, 625, 575, 550, 525, 475, 450, 425, 375, 350, 325, 275, 225, 175, 125, 70, 40, 30, 20, 15, 10 |
| `ncep_hgefs025_ensemble_mean` | 0 → 13 | 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50 | – |
| `jma_seamless` | 16 → 12 | – | 250, 200, 150, 100 |
| `jma_msm` | 16 → 12 | – | 250, 200, 150, 100 |
| `jma_gsm` | 16 → 8 | – | 975, 950, 900, 800, 250, 200, 150, 100 |
| `icon_eu` | 19 → 18 | – | 30 |
| `icon_d2` | 19 → 14 | – | 150, 100, 70, 50, 30 |
| `cmc_gem_seamless` | 14 → 28 | 925, 875, 750, 650, 550, 450, 350, 275, 225, 175, 50, 30, 20, 10 | – |
| `cmc_gem_gdps` | 14 → 28 | 925, 875, 750, 650, 550, 450, 350, 275, 225, 175, 50, 30, 20, 10 | – |
| `cmc_gem_rdps` | 14 → 28 | 925, 875, 750, 650, 550, 450, 350, 275, 225, 175, 50, 30, 20, 10 | – |
| `cmc_gem_hrdps` | 14 → 25 | 925, 875, 750, 650, 550, 450, 350, 275, 225, 175, 50 | – |
| `cmc_gem_hrdps_west` | 14 → 0 | – | 1000, 950, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100 |
| `meteofrance_arpege_europe` | 29 → 24 | – | 70, 50, 30, 20, 10 |
| `meteofrance_arome_france` | 29 → 24 | – | 70, 50, 30, 20, 10 |
| `metno_seamless` | 0 → 14 | 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 | – |
| `knmi_seamless` | 0 → 14 | 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 | – |
| `knmi_harmonie_arome_europe` | 0 → 5 | 925, 850, 700, 500, 300 | – |
| `dmi_seamless` | 0 → 14 | 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 | – |
| `ukmo_seamless` | 14 → 33 | 975, 900, 750, 650, 550, 450, 375, 350, 325, 275, 225, 175, 125, 70, 50, 40, 30, 20, 10 | – |
| `ukmo_global_deterministic_10km` | 14 → 33 | 975, 900, 750, 650, 550, 450, 375, 350, 325, 275, 225, 175, 125, 70, 50, 40, 30, 20, 10 | – |
| `ukmo_uk_deterministic_2km` | 14 → 33 | 975, 900, 750, 650, 550, 450, 375, 350, 325, 275, 225, 175, 125, 70, 50, 40, 30, 20, 10 | – |
| `geosphere_seamless` | 0 → 14 | 1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50, 10 | – |
