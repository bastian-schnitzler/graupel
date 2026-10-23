# System: Graupel-Desktop-App (APP)

Stand nach APP-S1 (Release 0.2.0, 2026-10-23; Bestandsaufnahme bei der Übernahme auf `main` 5c62de3). Landkarte,
keine Detailspec: Einzelheiten zu Verhalten und Gründen stehen im Abschnitt „Verhalten, Datenmodell und
Entscheidungen“ (Code-Kommentare zitieren ihn als `system.md §<n>`) und in den gelernten Regeln von `AGENTS.project.md`.

## Zweck

Graupel ist eine lokale Desktop-App, die Meteogramme für das Bergwetter erzeugt. Sie verkettet mehrere numerische
Wettermodelle von [Open-Meteo](https://open-meteo.com/) zu einer durchgehenden Vorhersage (kurzfristig hochauflösend,
langfristig global) und zeichnet Temperatur, Niederschlag mit vertikalem Wolkenprofil, Wind, Gewitter, CAPE/CIN/LPI
und weitere Größen. Verteilt wird sie als Python-Paket `graupel` auf PyPI (`uv tool install graupel`), Start mit
`graupel`. Lizenz: React-Code MPL-2.0, alles andere GPL-3.0-or-later.

## Features

### Zwei Modi (§3)

- **Normal:** Ort wählen, Meteogramm sehen. Die Modellkette wird aus dem Ort bestimmt (Auto-Kette, Region als Text im
  Header), ein festes Layout (Temperatur, Niederschlag mit Wolkenprofil, Wind), keine Modell-Header und keine
  Konfiguration. Modelle ohne Daten am Ort fallen aus der Kette.
- **Power:** gespeicherte Modellketten-Konfigurationen (Hauptkette und Wolkenkette) mit Eintrag **Auto** an erster
  Stelle, Config-Ansicht mit den Tabs Basic, Model chains und Meteogram, Layout-Bibliothek mit Editor,
  Forecast-Archiv mit Aufbewahrungsdauer, Viewer für archivierte Vorhersagen (History), Datenordner wechselbar.
- Schalter im Header, in beiden Modi sichtbar, in der Zeile unter dem Logo rechts neben den Tabs Meteo/Config (bleibt
  dort, Q-010; `AppHeader.test.tsx` hält den Platz fest); neue Installationen starten normal, 0.1.x-Installationen mit
  eigenen Konfigurationen in Power.

### Festlegungen aus der 0.2.0-Spec (APP-S1)

- Schneeäquivalent: Der blaue Regenanteil in `snowfall_with_rain` rechnet 1 mm Wasser ≈ 0,7 cm Schnee
  (`SNOW_CM_PER_WATER_MM = 0.7`, `react/src/quantities/derivedQuantities.ts`; Q-011).
- Weitere Open-Meteo-Größen (Taupunkt, Luftfeuchte, Luftdruck, Nullgradgrenze, Sicht, Strahlung, 850 hPa u. a.) kommen
  nicht in 0.2.0; der Nutzer legt sie bei Bedarf als Requirements an (Q-012).
- Layout und Ort gelten je Modellketten-Konfiguration, nicht je Region (Q-013).

### Meteogramm-Ansicht

- Header: Konfigurations-Auswahl mit Grenzen-Reset (Power), Ortssuche mit Autovervollständigung, meistgenutzten Orten
  (Pfeil), Löschen-Knopf, Refresh, Kartenvorschau (MapLibre, Maptoolkit Hiking) und Vollbild-Kartenauswahl.
- Modellketten-Karten über dem Meteogramm (Power): Lauf, nutzbare/gesamte Stunden, Auflösung; Grenzen ziehbar
  (±33 %, nur flüchtig, nie in die Konfiguration gespeichert), einklappbar.
- Meteogramm (SVG, eingebettet und Vollbild): Tagesheader mit Tageslicht, orange Modell-Header mit Kurznamen und
  gestrichelten Grenzen, Bereiche nach Layout, Hover-Popup mit Werten und Summen, Mausrad-Zoom auf der Zeitachse,
  Tagesbereichs-Knöpfe 4/7/10/14/All, Sonnenauf- und -untergangszeiten, Kurven-Start- und Stoppmarken an Lücken,
  Gewittersymbole, Ortslabel mit Erstellungszeit, Open-Meteo-Attribution, Kopieren als PNG (Zwischenablage).
- Daten ab Mitternacht des Vortags; Zeitachse in der Zeitzone des Nutzers.
- Sitzungs-Cache im Speicher: gleicher Ort und gleiche Ketten laden ohne neue Anfrage; nur Refresh holt neu.

### Konfiguration (Power)

- **Basic:** Datenordner (wählen, im Dateimanager öffnen, live wechseln mit Kopierdialog), Archiv an/aus und
  Aufbewahrung (aus, 7, 30, 90, 365 Tage, für immer), Archiv löschen.
- **Model chains:** Liste (sortierbar, duplizieren, löschen), Editor mit Name, eigenem Ort samt Anzeigename,
  Layout-Auswahl, Ketten-Builder für Haupt- und Wolkenkette (+ Add Model fügt nach Horizont ein), „Start from auto
  configuration“ (Region, aktueller Ort, interkontinentale und sonstige Ketten aus `chain_zones.json`). Autosave.
- **Meteogram:** Layout-Bibliothek (fester Eintrag Default, Power default, eigene) und Editor für Bereiche, Serien,
  Achsen und Optionen, mit Live-Vorschau.

## Architektur

```
pywebview-Fenster ── React-App (graupel/react/index.html) ── window.pywebview.api ──> graupel/API.py (Bridge)
                                                                                     └─> graupel/data/api.py MeteogramAPI
                                                                                          ├─ service.py   ForecastService (Abruf, Stitching)
                                                                                          ├─ open_meteo.py OpenMeteoClient, Katalog
                                                                                          ├─ harmonizer.py, timeline.py
                                                                                          ├─ auto_chain.py, model_domains.py
                                                                                          ├─ quantities.py, layouts.py, settings.py
                                                                                          └─ storage.py   SQLite
```

### Backend (`graupel/`)

| Modul | Aufgabe |
|---|---|
| `__main__.py` | typer-Einstieg `graupel`: AppUserModelID, `webview.create_window` mit `js_api=API`, Fenster-Icon, danach Startmenü-Verknüpfung (Windows) |
| `API.py` | pywebview-Bridge: delegiert an `MeteogramAPI`, dazu Datenordner (wählen, wechseln, öffnen), externe URLs, PNG in die Zwischenablage, Cursor setzen (Windows), Logging (`log.py.txt`, UI-Fehler in `log.ui.txt`) |
| `data/api.py` | `MeteogramAPI`: Konfigurationen, Forecasts (`get_forecast`, `get_auto_forecast`, `refresh_forecast`), Auto-Ketten, Orte, Settings, Layouts, Archiv; Standardkonfigurationen (Nordalpen, Ostalpen, …) und Startmodus |
| `data/service.py` | `ForecastService`: je Modell eine Anfrage mit allen registrierten Größen, Laufverfügbarkeit (`meta.json`, Run-Segmente), Stitching ohne Modellwechsel innerhalb eines Abschnitts, Wolkenprofile, Sonnenzeiten, Archivierung |
| `data/open_meteo.py` | HTTP-Client (httpx), Modellkatalog laden, Aliase und alte Modellnamen |
| `data/harmonizer.py`, `data/timeline.py` | Einheiten und Namen vereinheitlichen; kanonische UTC-Zeitachse, Prüfungen |
| `data/quantities.py` | Quantity-Registry: einzige Quelle aller Größen (Open-Meteo-Name, Einheit, Art, Stile, `requires`, `downloadable`), `fetch_set`, `display_set` |
| `data/layouts.py` | Pydantic-Schema `MeteogramLayout`, Built-in-Layouts `power-default` und `normal-default` |
| `data/auto_chain.py`, `data/model_domains.py` | Region am Punkt, Präferenzlisten, Domain-Fallback, `resolve_auto_chain`, `list_auto_chains` |
| `data/storage.py` | SQLite-Zugriff, Schema, Migration 0.1.x und Schema-Version 2, Archiv und Aufbewahrung, Datenordner kopieren |
| `data/settings.py` | App-Settings mit Defaults und Validierung (`mode`, `archive_enabled`, `archive_retention_days`) |
| `data/model_short_names.py` | kuratierte Kurznamen (Generator: `dev-tools/update_catalog.py`) |
| `data_location.py` | Zeiger auf den Datenordner außerhalb des Ordners (Registry, macOS defaults, `~/.config/graupel/config.toml`) |
| `file_manager.py`, `clipboard.py`, `resources.py`, `windows_integration.py`, `config.py` | Ordner öffnen, Zwischenablage, Paketressourcen (`importlib.resources`), Startmenü/Icon/AppUserModelID, Log-Pfade |

### Frontend (`react/src/`)

- `App.tsx` (+ `App.logic.ts`): Zustand der App (Modus, Konfigurationen, Auswahl, Ort, Anzeige-Ketten, Sitzungs-Cache,
  Zoom- und Einklapp-Zustand), Boot über die Bridge, veraltete Anfragen verwerfen.
- `services/apiService.ts`: alle Bridge-Aufrufe mit Fallbacks ohne Backend (Mock-Daten, Power-Modus).
- `views/`: `MeteogramView`, `ConfigView` und `views/config/` (Tabs, Editor, Sidebar, Basic, Layout-Bibliothek und
  -Editor, Auto-Dialog).
- `components/`: `MeteogramChart` (Diagramm, eingebettet und Vollbild), `drawing/` (Geometrie, Bereiche, Pfade,
  Tooltip, Zoom- und Hover-Hooks), `modelChain/` (Karten, Grenzen-Logik), `header/`, `meteogram/` (PNG, Labels,
  Attribution, Tagesbereich), `LocationSelector`, Karten (`HeaderMapPreview`, `FullscreenMapPicker`, `maps/`).
- `layouts/`, `quantities/`: TS-Spiegel von Layout-Schema und Registry; `*.generated.ts` erzeugt
  `dev-tools/export_quantity_registry.py` (Tests prüfen, dass die Kopie aktuell ist).
- `utils/`: reine Logik (Zeitachse, Zoom, Extreme, Sonnenzeiten, Gewitter, Auto-Kette, Cache-Schlüssel, Historie).
- Muster: Logik in `.logic.ts`/`Utils.ts` neben der Komponente, Hooks bleiben in der Komponente sichtbar.

### Daten und externe Dienste

- Open-Meteo: Forecast-API (je Modell), Single-Runs-API (Horizonte, Generator), `meta.json` je Modell (Laufzeiten),
  Geocoding und Höhe, Sonnenzeiten über `/v1/forecast`. Attribution CC BY 4.0 im Diagramm.
- Karten: Maptoolkit Hiking Style mit OpenStreetMap-Daten (Logo und Copyright Pflicht).
- Paketdaten `graupel/models/`: `model_catalogue.json` (Modellkatalog, Generator `dev-tools/update_catalog.py`),
  `model_domains.json` (Domain-Polygone), `regions.json` (GeoJSON-Regionen), `chain_zones.json` (Ketten ohne Region).

## Datenmodell

- **Konfiguration** (`MeteogramConfig`): `id`, `name`, `location` (Name, Koordinaten, Land, Region, Höhe, Zeitzone),
  `main_model_chain`, `cloud_model_chain` (Listen von `WeatherModel` mit kumulativem Horizont), `position`,
  `layout_id` (`null` = Default), `location_name_override`.
- **Wettermodell** (`WeatherModel`): Katalogeintrag mit Kurzname, Auflösung, maximalem Horizont,
  `supported_variables`, Wolkenprofil-Fähigkeit und Druckflächen; Wolkenkette nur mit ≥ 10 Druckflächen.
- **Layout** (`MeteogramLayout`): Optionen (Modell-Header, Tagesheader, Tageslicht, Ortslabel, Zeitstempel) und
  Bereiche mit `heightWeight`, Achsen, Hintergrund (Wolkenprofil) und Serien (Größe, Stil, Farbe, Achse, Optionen).
- **SQLite** `meteogram.db` im Datenordner (`%LOCALAPPDATA%\graupel`, sonst `~/.graupel`), `SCHEMA_VERSION = 2`:

  | Tabelle | Inhalt |
  |---|---|
  | `db_meta` | `app_version`, `schema_version` |
  | `meteogram_configs` | Modellketten-Konfigurationen |
  | `meteogram_layouts` | Layout-Bibliothek (`default`, `power-default`, eigene) |
  | `app_settings` | Modus, Archiv, Aufbewahrung |
  | `location_history` | gewählte Orte mit Zähler (Schlüssel auf 4 Nachkommastellen) |
  | `forecast_fetch`, `forecast_series` | strukturiertes Archiv je Abruf, Serien je Modell und Größe |
  | `model_chain_config_versions` | Versionen der Konfigurationen zu archivierten Abrufen |
  | `api_fetch_archive`, `model_run_availability` | Rohantworten und Laufverfügbarkeit (nur mit Archiv) |

  Live-Vorhersagen kommen nie aus SQLite; das Archiv liest nur der History-Viewer. Archiv standardmäßig aus.

## Build, Tests, Auslieferung

- Frontend-Build nach `graupel/react/` (nicht versioniert), dann `uv build`; Paketdaten über `pyproject.toml` und
  `MANIFEST.in`. Release: GitHub-Release mit Tag = `pyproject.toml`-Version → `release.yml` baut und veröffentlicht auf
  PyPI und hängt die Dateien an.
- Tests: `tests/` (pytest, rund 30 Module: Bridge, Storage, Migration, Service, Auto-Ketten, Katalog, Layouts,
  Verpackung, Lizenzen, Windows-Integration), `react/src/**/*.test.ts(x)` (Vitest), `react/e2e/` (Playwright mit
  Bridge-Fixture, ohne Netz). CI auf Linux, Windows, macOS.
- Upgrade: `tests/test_upgrade_0_1_0.py` öffnet eine mit dem veröffentlichten graupel 0.1.0 erzeugte Datenbank
  (`tests/fixtures/graupel-0.1.0.db`, Erzeugung in `tests/fixtures/make_graupel_0_1_0_db.py`).
- Versionen: `pyproject.toml` und `Makefile` 0.2.1, `DB_APP_VERSION` 0.2.0; Änderungen je Version in `CHANGELOG.md`.
- Öffentliches Repo (REQ-356): `dev-tools/copy_release.sh [--dry-run] <Ziel>` kopiert in einen Git-Checkout nur
  versionierte Dateien von `graupel/`, `react/`, `tests/`, `dev-tools/`, `LICENSES/`, den Workflows `tests.yml` und
  `release.yml` und den Wurzeldateien (Konfiguration, Doku, `CHANGELOG.md`), `Makefile.public` als `Makefile` und
  `APP/system.md` aus dem Branch `plan` als `docs/system.md` (Q-014). Nicht mit gehen der Model Domain Viewer
  (`docs/`), `AGENTS*.md`, `workflow/`, `plan/`, das Skript selbst, `tests/test_copy_release.py` und
  `tests/test_domain_viewer.py`. Was das Ziel unter den kopierten Pfaden (und `.github/`) versioniert, hier aber nicht
  mehr hat, wird gelöscht; unversionierte Dateien dort bleiben. Ablauf in `DEVELOPER.md` („Public repository“).
- Generatoren in `dev-tools/`: Katalog (`update_catalog.py`), Domains (`update_model_domains.py`), Regionen und Zonen
  (`update_regions.py`), Registry/Layouts nach TS (`export_quantity_registry.py`), Icons (`generate_icons.py`).
- Katalog (DEC-004): `update_catalog.py` ist der einzige Generator für `graupel/models/model_catalogue.json` (die
  Zweitdatei `model_catalog.json` und `graupel.data.build_catalogue` sind entfernt). Ein voller Lauf fragt jedes Modell
  aus dem `models`-Enum von `dev-tools/forecast.yml` nach allen herunterladbaren Größen der Registry und allen 44
  Druckflächen und führt das Ergebnis zusammen: `supported_variables` nur katalogisierte Größen, Druckflächen mit
  Wolkendaten, Horizont aus dem längsten Lauf (Single Runs API). Name, Anbieter, Region und Auflösung sind kuratiert und
  werden nur für neue Modelle abgeleitet; schlägt eine Probe fehl, bleibt der Eintrag; unveränderte Einträge bleiben
  byte-gleich (`tests/test_update_catalog.py` mit aus dem Katalog rekonstruierten Antworten). Danach bei neuen Modellen
  `update_model_domains.py --only <id>` und die Regionslisten.
- Domain- und Regionsgeneratoren schreiben die Viewer-Daten (`docs/domain/model_domains.js`, `chains.js`) nur, wenn
  `docs/domain/` existiert (im öffentlichen Repo fehlt der Viewer); die Paketdateien (`model_domains.json`,
  `regions.json`, `chain_zones.json`) immer. Der Abgleich Viewer gegen Paketdaten steht in
  `tests/test_domain_viewer.py`.

## Verhalten, Datenmodell und Entscheidungen (ehemals Release-Spec 0.2.0)

Übernommen aus der früheren Release-Spec 0.2.0 (`docs/`, entfernt mit REQ-354). Die §-Nummern bleiben, damit
Verweise im Code (`system.md §3.1`) passen; §15 gab es nie. Landkarte, keine Detailspec: maßgeblich sind Code und Tests.

### §1 Ziele

Zwei Nutzermodi: **Normal** (Ort wählen, gutes Meteogramm, keine Konfiguration) und **Power** (alles aus 0.1.x plus
frei konfigurierbares Layout, Auto-Ketten als Startpunkt, Archiv- und Speicher-Settings, History-Viewer). In beiden:
Ortslabel mit Erstellungszeit, PNG-Export. Keine Ziele: Nutzerkonten, Cloud-Sync, Messdaten, Warnungen.

### §2 Begriffe

- **Größe** (Quantity): Vorhersagevariable, die die App abruft, normalisiert, speichert und zeichnet; definiert in §5.
- **Bereich** (Drawing area): ein horizontales Panel. **Layout**: geordnete Bereiche mit Größen, Achsen, Optionen.
- **Modellkette**: Modelle mit kumulativen Horizonten (`main_model_chain`, `cloud_model_chain`). **Region**: Polygon
  mit Auto-Kette.
- **Display set**: was das Layout zeichnet (Zeichnen, Hover, Footer). **Fetch set**: alle ladbaren Größen, in beiden
  Modi unabhängig vom Layout abgerufen (§9.3).

### §3 Modi

**§3.1 Umschalten:** Power-Schalter im Header, in beiden Modi sichtbar. Modus = App-Setting `mode` (§8.1), Default
normal; 0.1.x-Installationen mit eigenen Konfigurationen starten einmalig in power (§13). Umschalten löscht nie
Konfigurationen, Layouts oder Archivdaten, es ändert nur Sichtbarkeit und Abruf.

**§3.2 Sichtbarkeit:** Nur Power hat Config-Knopf und -Ansicht, Konfigurationsauswahl mit Grenzen-Reset (erster Eintrag
**Auto**, §16.4), Modellketten-Karten (einklappbar), Modell-Popovers und Laufangaben, History-Knopf (§10). Normal zeigt
an Stelle der Auswahl Region und Kette als Text (Q5). Ortssuche, Karte, PNG-Export und Ortslabel gibt es in beiden.
Layout: Normal zeichnet den Eintrag **Default** (§4.3), Power das Layout der Konfiguration, sonst Default; orange
Modell-Header und gestrichelte Grenzen zeichnet Power immer, Normal nach `showModelHeaders`.

**§3.3 Datenfluss Normal:** Ort → Backend bestimmt Region und Auto-Kette (§6) → Abruf aller registrierten Größen inkl.
Wolkenprofil → speichern nur mit Archiv (§9.3) → zeichnen; Modellgrenzen gelten fürs Stitching auch ungezeichnet. Ein
Modell ohne Daten am Ort fällt im Normalmodus (und bei Auto) aus der Kette, das nächste übernimmt seinen Horizont; bei
gespeicherten Konfigurationen bleibt ein leerer Abschnitt leer.

### §4 Modulares Meteogramm-Layout

**§4.1 Schema:** JSON in SQLite, geprüft per Pydantic (`MeteogramLayout`, `graupel/data/layouts.py`) und TS-Typ
(`react/src/layouts/types.ts`).

- Diagramm: `id`, `name`, `version`, `showModelHeaders`, `showDayHeader`, `showDaylight`, `showLocationLabel`
  (`"top"`/`"bottom"`/`"none"`), `showCreatedTimestamp`, `areas`.
- Bereich: `id`, `heightWeight`, `axes` (`left`/`right` mit `quantity`, `label`, `range`), optional `background`
  (`kind: "vertical_cloud_profile"`), `series`. Serie: `quantity`, `style`, `color`, `axis` (`left`/`right`/`hidden`),
  `enabled`, Optionen (`extremeLabels`, `snowFrom`, `curveStops`, …).
- Stil muss laut Registry erlaubt sein (line, bars, area, arrows, icons, profile). `range`: `"auto"` (global über alle
  Modelle, stabil beim Grenzenziehen), `"fixed"` mit `min`/`max`, `"zero-based"`. Bereichshöhe =
  `heightWeight / Σ heightWeight`; Abstände, Header, Footer konstant.
- Unbekannte Größe, unerlaubter Stil oder leere Bereichsliste → ungültig: Backend lehnt ab, Frontend zeichnet das
  Built-in mit Warnung, nie ein Absturz.
- Früher fest verdrahtet (Tages-Min/Max, Stoppmarken, Schneebalken, Windpfeil-Dichte, Gewitter, CAPE/CIN-Hälften,
  LPI-Achse 0–30, Wolkenhöhen-Labels) ist jetzt Serien- oder Bereichsoption mit altem Verhalten als Default.

**§4.2 Zeichnen:** `MeteogramChart` rechnet die Geometrie aus dem Layout (`components/drawing/chartGeometry.ts`);
`power-default` reproduziert das 0.1.x-Diagramm pixelgleich. Zeitachse, Clipping, Textskalierung und Hover bleiben
gemeinsam; Hover-Popup und Vollbild-Footer listen die Größen des Layouts nach Bereichen.

**§4.3 Layout-Bibliothek** (Meteogramm-Konfigurationen, Power): anlegen, duplizieren, umbenennen, löschen, sortieren.

- Fester erster Eintrag **Default** (id `default`), nicht löschbar oder umbenennbar: gilt im Normalmodus, für Auto und
  für jede Konfiguration mit `layout_id = null`; „Reset“ stellt `normal-default` her. `showModelHeaders` wirkt nur im
  Normalmodus.
- Vorbelegt **Power default** (Built-in `power-default`), löschbar. Kein globales Layout-Setting mehr.
- Löschen eines benutzten Layouts → Default. Validierung beim Schreiben; ein ungültiges gespeichertes Layout zeichnet
  das Built-in mit Warnung. Tabelle `meteogram_layouts (id, name, position, layout_json, builtin_id)`.

**§4.4 Normal-Layout** `normal-default`: Temperatur (Temperatur, gefühlte Temperatur, Tagesextreme), Niederschlag
(Balken mit Schneefärbung, Wahrscheinlichkeit, **Wolkenprofil als Hintergrund**, das eigenes Höhengewicht mitbringt),
Wind (Geschwindigkeit, Böen, Richtung). Gewittersymbole an, keine Modell-Header, kein CAPE/CIN. Wegen des Wolkenprofils
(Q1) liefert die Auto-Kette auch eine Wolkenkette (§6.3).

### §5 Quantity-Registry

`graupel/data/quantities.py` ist die einzige Quelle aller Größen (ersetzt `DEFAULT_VARIABLES`, `CORE_VARIABLES`,
`CONVECTIVE_VARIABLES`, `WEATHER_ICON_VARIABLES`), TS-Spiegel generiert in `react/src/quantities/`.

- Je Größe: `id`, Open-Meteo-Name(n) (stündlich / Druckflächen-Muster), Einheit, Normalisierung; `kind` (`point` oder
  `interval`, stundenbeginn-gestempelt); `optional` (fehlt ohne Warnung); `allowedStyles`, Farbe, Label; `requires`
  (Schneebalken → `snowfall`, Wolkenprofil → `cloud_cover_*hPa` + `geopotential_height_*hPa`); `downloadable`.
- Umfang: alle Größen des 0.1.x-Diagramms plus **Schneehöhe** (Linie/Fläche) und **Schneefall** (Balken/Färbung).
- `display_set(layout)` = `quantity` + `requires` aller aktiven Serien und Hintergründe; `fetch_set()` = alle
  `downloadable`-Größen, ohne Layout.
- Letzte Regel: ein Modell wird nur nach Größen in seinen `supported_variables` gefragt.

**§5.1 Abgeleitete Größen** aus `precipitation` und `snowfall`, beim Zeichnen berechnet, nie abgerufen oder archiviert
(die Historie rechnet neu); Registry `source: "derived"`, `downloadable: false`, `requires: ["precipitation", "snowfall"]`.

- `precipitation_rain_snow` (mm): Niederschlagsbalken, Stunde mit Schneefall > 0 weiß mit dunklem Rand; ohne
  Schneefallwert normaler blauer Balken (braucht nur `precipitation`).
- `snowfall_with_rain` (cm): Schneefallbalken plus blauer Regenanteil in Schnee-cm:
  `rain_mm = max(0, precipitation − snowfall / 0.7)`, Höhe `rain_mm × 0.7` (`SNOW_CM_PER_WATER_MM`, Q6).
- Fehlender Quellwert → Lücke; liefert ein Modell eine Quelle gar nicht, warnt seine Kettenkarte (`⚠ no snowfall`).

### §6 Ortsabhängige Modellketten (Auto-Ketten)

**§6.1 Problem:** Länder sind zu grob (Zugspitze und Watzmann liegen beide in Bayern, brauchen andere Ketten), und
Modell-Domains folgen keinen Grenzen.

**§6.2 Daten:**

- Modell-Domains `graupel/models/model_domains.json` aus `dev-tools/update_model_domains.py`: je Katalogmodell
  `"global"` oder Lon/Lat-Polygon (getrennt vom Katalog). Quelle ist die API (`No data is available for this
  location`): Gitterrechteck aus `meta.json` `crs_wkt` mit Randproben; ICON-D2, ICON-EU, AROME France und RDPS entlang
  von Strahlen vermessen. Viewer `docs/domain/index.html`, Tab Chains aus `docs/domain/chains.js`.
- Regionen `graupel/models/regions.json` (GeoJSON) aus `dev-tools/update_regions.py`; Felder `id`, `name`, `priority`,
  `group`, `area_km2`, `chains_from`, `main_chain_ids`, `cloud_chain_ids`, `min_elevation_m`/`max_elevation_m`
  (reserviert, `null`), MultiPolygon. Priorität 30 handgezeichnet: `northern_alps`, `eastern_alps`, `dolomites`,
  `western_alps_ch`, `western_alps_fr`. Priorität 20: Natural-Earth-Länder (0,15° ins Meer erweitert), z. B. germany,
  austria, switzerland, france, italy, uk, nordic, iberia, usa, canada, japan. Keine Kontinent-Regionen.

**§6.3 Algorithmus** `resolve_auto_chain(latitude, longitude, elevation=None)` (`graupel/data/auto_chain.py`):

1. Regionen mit dem Punkt im Polygon (reines Python); höchste `priority`, bei Gleichstand kleinste Fläche.
2. Regionsketten sind **Präferenzlisten**: Modelle ohne Domain am Punkt (0,5° Rand) fallen weg, dann jedes Modell, das
   den Horizont nicht um mindestens 12 h verlängert.
3. **Domain-Fallback** ohne Region oder wenn nur das Endmodell bleibt: Katalogmodelle mit Domain am Punkt, ohne
   globale, Seamless, Ensembles, `best_match` und NBM, nur **feiner als `ecmwf_ifs` (9 km)**, nach Auflösung (dann
   längster Horizont), nur mit ≥ 12 h Gewinn; Wolkenkette nur mit Profil und ≥ 10 Druckflächen. Ende immer
   `ecmwf_ifs` / `ecmwf_ifs025`.
4. Sonst oder bei ungültiger Eingabe `global_fallback`: `[ecmwf_ifs]` / `[ecmwf_ifs025]`.
5. Ergebnis: Ketten (Horizonte streng steigend), `region_id`, `region_name`, `resolution_reason` (`region`,
   `domain_fallback`, `global_fallback`). Dazu `list_regions()`.

**§6.4 Abnahmepunkte** (Unit-Tests): Zugspitze, Garmisch → `northern_alps`; Watzmann, Berchtesgaden → `eastern_alps`;
Ortler → `dolomites`; Matterhorn → `western_alps_ch`; Mont Blanc → `western_alps_fr`; München → `germany`; Wien →
`austria`; Paris → `france`; New York → `usa`; Mittelatlantik 40, −35 → `global_fallback`.

**§6.5 Power-Modus:** Tab Model chains, „Start from auto configuration“ kopiert die Ketten einer Region (ohne Punkt,
`get_region_chains`: nur die Horizontregel, ganze Präferenzliste) oder „from current location“ (`resolve_auto_chain`
am Ort der Meteogramm-Ansicht) in eine neue Konfiguration. Ort = Meteogramm-Ort beim Öffnen der Config-Ansicht, Name =
Regionsname (nummeriert), sonst Ortsname; der Editor zeigt die Region des Orts (nur Info). Danach Ketten ohne eigene
Region aus `graupel/models/chain_zones.json` über `list_auto_chains`: **Intercontinental**, **Other chains ·
<Kontinent>**, **Global (IFS only)**, beschriftet mit Kurznamen der Hauptkette und Geltungsbereich, ohne Duplikate.

### §7 Konfigurations-Oberfläche (Power)

1. **Basic:** Datenordner (§8.2), Archiv an/aus und Aufbewahrung (§9.3).
2. **Model chains:** Sidebar und Editor, „Start from auto configuration“, Ortsfeld mit Anzeigename (§16.12),
   Layout-Auswahl unter dem Namen („Default“ = `layout_id = null`, oder ein Bibliothekseintrag).
3. **Meteogram:** Bibliothek (§4.3) und Editor (Bereiche, Serien mit Größe/Stil/Farbe/Achse, Header- und
   Label-Schalter) mit Live-Vorschau; keine Archiv-Set-Liste.

Autosave entprellt, Fehler-Badge.

### §8 App-Settings

**§8.1 Speicherung:** `app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`, JSON-Werte: `mode`,
`archive_enabled` (Default `false`), `archive_retention_days` (`global_layout_id` bis Schema-Version 2). `db_meta (key,
value)` mit `app_version`, `schema_version`, geschrieben bei Anlage und Formatwechsel. Schema-Version 2 (einmal beim
Öffnen, vor dem Seeding): `normal-mode` wird `default`; Konfigurationen, die ein anderes globales Layout zeichneten,
bekommen es als `layout_id`, auf `normal-mode` gesetzte folgen Default; archivierte `layout_id`s umbenannt.

**§8.2 Datenordner:**

- Zeiger außerhalb des Ordners: Windows `HKEY_CURRENT_USER\Software\Graupel` Wert `DataDir` (`winreg`); macOS Domain
  `io.github.bastian-schnitzler.graupel` Schlüssel `DataDir` (nur `defaults read`/`write`); Linux
  `$XDG_CONFIG_HOME/graupel/config.toml` Schlüssel `data_dir`. Modul `graupel/data_location.py` mit `read_data_dir()`,
  `write_data_dir(path)`, `clear_data_dir()`.
- Fehlender oder unbrauchbarer Eintrag → Default (`%LOCALAPPDATA%\graupel`, sonst `~/.graupel`) mit Log-Warnung.
  Deinstallation fasst den Datenordner nie an.
- Wechsel im Basic-Tab **live** (Q4): Schreibbarkeit prüfen; Dialog mit *Configuration data* (Konfigurationen,
  Layouts, Settings, `location_history`) und *Meteogram data* (Archiv, `api_fetch_archive`, `model_run_availability`),
  beide an; neue Datenbank mit `db_meta`, Auswahl kopieren (Verbindungen vorher schließen), prüfen, Storage live
  umschalten. Die alte Datei bleibt.
- „Open folder“: `open_data_dir` (ohne Pfad) öffnet den Ordner aus `get_data_dir` im Dateimanager; ohne Bridge versteckt.

### §9 Forecast-Archiv

**§9.1 Zweck:** Historische Vorhersagen später mit dem aktuellen Layout neu zeichnen; `api_fetch_archive` (Roh-JSON)
ist nicht je Größe abfragbar.

**§9.2 Schema:**

```
forecast_fetch   (id, fetched_at, location_key, latitude, longitude, location_name, location_json, mode, region_id,
                  chain_json, layout_id, config_id, config_version_id, meta_json)
model_chain_config_versions (version_id, config_id, valid_from, valid_to, name, location_json, location_name_override,
                              main_model_chain_json, cloud_model_chain_json, layout_id)
forecast_series  (id, fetch_id, chain, model, model_id, run_init_time, variable, unit, timestamps_json, values_json)
```

Ein `forecast_fetch` je Abruf, Serien je Modell und Größe (normalisiert, UTC), Wolkenprofil als eine Serie
(`variable = vertical_cloud_profile`). `meta_json`: Erstellungszeit, Zeitfenster, Zeitzone, Sonnenphasen,
Wolkenübergänge, Run-Segmente; `run_init_time` = neuester Lauf; `location_key` 4 Nachkommastellen.

**§9.3 Abrufen und Speichern:** eine Anfrage je Modell mit allen Größen → zeichnen → alle Serien unter einer
`fetch_id`, keine zweite Phase (13 Zusatzgrößen kosten etwa +0,3 s je Anfrage). Default in beiden Modi **kein Archiv**
(Q2): `archive_enabled = false` speichert nichts, auch kein `api_fetch_archive`. Aufbewahrung (Power): aus, 7, 30, 90,
365 Tage, für immer; Pruning beim Start und täglich. Ausschalten von Power behält sie. Wechsel auf aus fragt nach, mit
Schalter „Delete archived data“ (Default aus).

**§9.4 Regel:** Live-Vorhersagen kommen nie aus SQLite; einziger Leser ist der History-Viewer (§10). Live-Daten werden
nur über den Sitzungs-Cache wiederverwendet (§16.13).

**§9.5 Konfigurationsversionen:** `forecast_fetch.config_version_id` → `model_chain_config_versions`, `fetched_at` liegt
in der Gültigkeit. Eine Version hält Name, Ort, `location_name_override`, beide Ketten und `layout_id` (nicht den
Layout-Inhalt); `valid_from`/`valid_to` = Speicherzeit. Neue Version nur beim Abruf mit geändertem Stand (Autosave allein
nie), die vorige bekommt `valid_to`; Löschen setzt `valid_to`. Normalmodus und Auto: `config_version_id = null`. Nur mit
Archiv geschrieben; Pruning entfernt unreferenzierte Versionen.

### §10 History-Viewer (Power)

- Knopf „History“ neben dem Grenzen-Reset: Abrufe zum aktuellen Ort (~1 km), neueste zuerst, mit Zeit und Kette.
- Zeichnet mit dem **aktuellen** Layout und den gespeicherten Ketten; fehlende Größen sind Lücken mit Hinweis
  (Wolkenprofil nur, wenn eine Wolkenkette dabei war).
- Badge „historic: fetched dd.mm. HH:MM“, Refresh aus, Grenzen flüchtig, „Back to live“; Auswahl von Konfiguration,
  Auto oder Ort und Moduswechsel kehren zu live zurück. Version (Q9) als Name + Gültigkeit
  (`Alpen · 18.10. 12:00 – now`), kein Diff.

### §11 Ortslabel und Erstellungszeit

Im SVG, oben oder unten nach Layout: Ortsname, Höhe, Koordinaten, „created dd.mm.yyyy HH:MM (tz)“ = Abrufzeit
(historisch: archivierte). Keine Überlappung mit Tagesheader oder Attribution.

### §12 PNG-Export

Aktuelles SVG (×2) mit eingebetteten Stilen über Canvas als PNG, über die Bridge in die Zwischenablage
(`copy_png_to_clipboard`). Ortslabel und Open-Meteo-Attribution (CC BY 4.0) in voller Schriftgröße der Wochentage,
Zeilenhöhe folgt; die Tagesbereichs-Knöpfe gehören nicht dazu.

### §13 Migration aus 0.1.x

Datenbank ohne `db_meta` = 0.1.x. Erster Start: Konfigurationen samt Position lesen, alte Datei nach
`meteogram.db.0.1.0.bak`, neue Datenbank mit `db_meta` (`app_version = 0.2.0`), Konfigurationen mit
`layout_id = power-default`. Archiv, Ortshistorie und Settings werden nicht übernommen. Modus = power, wenn die
Konfigurationen von den Standardkonfigurationen abweichen. Kein weiterer Kompatibilitätscode (keine Suche nach
Meteo/Cumulus).

### §14 Offene Fragen (geklärt in APP-S1)

Entschieden: Q1 Wolkenprofil im Normal-Layout, Q2 kein Archiv als Default, Q3 Layout und Ort je Konfiguration (Q-013),
Q4 Datenordner live, Q5 Region als Text, Q6 Faktor 0,7 (Q-011), Q7 keine weiteren Größen in 0.2.0 (Q-012), Q8 Power-
Schalter bleibt an seinem Platz (Q-010, §16.10), Q9 Version als Name + Gültigkeit.

### §16 Verfeinerungen in Meteogramm-Ansicht und Header

- **§16.1 Tagesbereich:** 4 / 7 / 10 / 14 Tage / All ab Zeitachsenbeginn (begrenzt), eingebettet und Vollbild, mittig in
  der Labelzeile. Lokale Kalendertage (`addLocalDays`). Hervorgehoben, solange der Bereich passt (sonst All);
  Mausrad-Zoom hebt auf. Die Wahl lebt in `App` für die Sitzung und gilt für jede neue Vorhersage.
- **§16.2 Kettenkarten:** Laufzeile nur mit gezeichneten Läufen; `Max: usable/total h` (z. B. `123/140h`); im Popup
  CAPE und CIN in Balkenfarben. (§16.3 abgelöst durch §16.12.)
- **§16.4 Auto-Eintrag:** erster Eintrag der Konfigurationsauswahl mit der Normalmodus-Kette, nicht editierbar; Label
  `✦ Auto · <name>` kursiv (gespeicherte Konfiguration mit gleichen Modellen, sonst Region bzw. „Regional models“ /
  „Global“), bei jedem Ortswechsel neu aufgelöst. Abruf wie Normal (`get_auto_forecast`), gleicher Cache-Eintrag;
  Default-Layout mit Modell-Headern. Normal → Power wählt Auto; die Wahl wird nicht gespeichert.
- **§16.5 Ortssuche:** Pfeil am Feldende oder Alt+ArrowDown öffnet alle gespeicherten Orte nach Häufigkeit (scrollbar),
  auch mit Text im Feld; eigener Löschen-Knopf (X), deaktiviert bei leerem Feld; Escape, zweiter Klick oder Klick
  daneben schließt; ohne Orte „No saved locations yet“. Auswahl zählt in `location_history`.
- **§16.6 Meteogramm-Konfigurationen:** siehe §4.3.
- **§16.7 Kurznamen:** Katalogfeld `short_name` für Modelle mit über 10 Zeichen (`AROME AT`, `IFS`, `KNMI HARM NL`;
  „SL“ = Seamless) aus `graupel/data/model_short_names.py` (`dev-tools/update_catalog.py --short-names-only`). Der orange
  Header zeigt ihn immer, Schrift nach Boxbreite (10 / 8,5 / 7), Suffix `(MM/DDZhh)` bleibt; Karten und Popups voll.
- **§16.8 Sonnenzeiten:** Bereichsoption `sunTimes` (an im `temp`-Bereich beider Built-ins): am ersten und letzten
  vollständigen lokalen Tag Aufgang (`HH:MM`) oben, Untergang unten, an der x-Position des Zeitpunkts; im Hintergrund
  in `#cbd5e1` hinter Kurven und Labels, nie weggelassen.
- **§16.9 CI:** `.github/workflows/tests.yml` (tsc + Vitest, pytest, Playwright) auf Linux, Windows, macOS; Branch-Schutz
  auf `main` verlangt alle sechs Jobs.
- **§16.10 Power-Schalter:** bleibt in der Zeile unter dem Logo rechts neben den Tabs (Q8, Q-010).
- **§16.11 Add Model:** fügt vor dem ersten Kettenmodell mit größerer Kapazität (Katalog-Horizont) ein, sonst ans Ende
  (`tryAddModelToChain`); nur die neue Grenze wird berechnet, `H_new = clamp(cap_new, H_previous, H_next)`. Gleiche
  Kapazität ist der einzige Fehler; ein Folgemodell darf 0 h behalten. Haupt- und Wolkenkette.
- **§16.12 Ort je Konfiguration:** Ortsfeld im Tab Model chains (gleiche Suche, Autosave), Stift für
  `location_name_override` (leer = Ortsname, neuer Ort leert ihn); Anzeige in Klammern in der Auswahl
  (`Alpen (INSB)`). Header-Ortsfeld in der Config-Ansicht deaktiviert. Orange Nadel öffnet die Kartenauswahl.
  Konfigurationswahl springt zu ihrem Ort, außer der Nutzer hat seit Start manuell einen Ort gewählt.
- **§16.13 Sitzungs-Cache:** jede seit Programmstart abgerufene Vorhersage im Speicher (`utils/forecastCache.ts`),
  beide Modi, ohne Limit, auch ohne Archiv. Schlüssel: Ort (4 Nachkommastellen) + Inhalt beider Ketten; Treffer ohne
  Anfrage mit ursprünglicher Abrufzeit. Neu nur per Refresh oder neuem Schlüssel; Name, Anzeigename, Layout nie.
  Fehlschläge nicht gecacht.
- **§16.14 Startmarke:** eine Linie nach einer Lücke bekommt am ersten Punkt `|` (Gegenstück zur Stoppmarke), nicht am
  Zeitachsenbeginn und nicht an lückenlosen Modellgrenzen; Serienoption `curveStops`, alle Layouts.

## Geschichte (Stichworte)

- 0.1.x: erste PyPI-Version (Paket zuerst Meteo, dann Cumulus, jetzt Graupel); fester Meteogramm-Aufbau, zwei
  Modellketten, vertikales Wolkenprofil, Karten mit Maptoolkit, Windows-Integration.
- 0.2.0 (auf `main`, noch nicht veröffentlicht): Normal-/Power-Modus, modulare Layouts und Layout-Bibliothek,
  Quantity-Registry, Auto-Ketten mit Regionen und Domains, Archiv und History-Viewer, Datenordner, Migration aus
  0.1.x, PNG-Export, Tagesbereich, Sonnenzeiten, Kurznamen, Sitzungs-Cache, CI auf drei Systemen. Planung bis zur
  Übernahme in GitHub-Issues (#132 bis #212) und der Release-Spec (jetzt Abschnitt „Verhalten, Datenmodell und
  Entscheidungen“).
- Offen bei der Übernahme (als Entwürfe importiert): Release 0.2.0 (#147, REQ-087), Sammel-Issue #148 (REQ-088),
  Katalog-Generator (#151, REQ-089), Platz des Power-Schalters (#173, REQ-090), Grenzen an den Modell-Headern ziehen
  (#88, REQ-091, geparkt). TODO-Kommentare gibt es im Code nicht.
- APP-S1 (0.2.0): ein Katalog-Generator (REQ-089), Platz des Power-Schalters bestätigt (REQ-090), Spec-Fragen geklärt
  (REQ-088), Release-Spec in diese Datei überführt (REQ-354), Vorlage `docs/empty_gui/` entfernt (REQ-355), Release
  vorbereitet mit Upgradetest, CHANGELOG und geprüften Paketen (REQ-087). Veröffentlichen (GitHub-Release, PyPI) macht
  der Nutzer nach dem Merge.
- APP-S2 (0.2.1): `copy_release.sh` kopiert genau den Open-Source-Teil ins öffentliche Repo, mit Kopiertest; die
  Generatoren laufen ohne Viewer (REQ-356).

## Auffälligkeiten (Bestandsaufnahme, Stand nach APP-S2)

- `graupel/data/api.py` definiert die Klasse `MeteogramAPI` zweimal (Zeile 20 und 273); die erste ist toter Code.
- Die Projekt-URLs in `pyproject.toml` zeigen auf `bastian-schnitzler/graupel`, das Repo heißt `meteo`.
- Das Wurzel-`Makefile` ist auf die lokale WSL-Umgebung zugeschnitten (`python.exe`, `uv.exe`) und enthält Reste
  einer anderen Vorlage (`lint`/`type` auf `./*.py ./llm/`, `LLM_API_TEST`, `index`); `Makefile.public` ist die
  allgemeine Variante.
- Die mitkopierte `.gitignore` enthält die Workflow-Zeile `/plan/` (harmlos im öffentlichen Repo).
- Lint ist nicht Teil der CI und nicht sauber: ESLint 125 Meldungen (meist `no-explicit-any`), flake8 390 (meist
  E501). Tests grün nach APP-S2: pytest 455, Vitest 718; im kopierten öffentlichen Baum pytest 447
  (2026-10-23). GitHub Actions starten seit 2026-10-23 keine Runner (Jobs scheitern nach 1 s, auch auf `main`).
