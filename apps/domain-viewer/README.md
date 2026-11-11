# apps/domain-viewer

Model Domain Viewer (DOM): statische Seite mit den Gebieten der Wettermodelle und den Zonen der Auto-Ketten auf einer
Karte, für Entwickler und Interessierte, nicht Teil der normalen App (DEC-003). HTML/JS mit Leaflet, MapLibre GL und
maplibre-gl-leaflet, Grundkarte von OpenFreeMap (DEC-009, DEC-010).

## Inhalt

| Datei/Ordner | Inhalt |
|---|---|
| `index.html` | Seite und Stile |
| `src/viewer.js` | Karte, Seitenleiste, Tabs „Domains“ und „Chains“ (ES-Modul, nutzt das Leaflet-Global `L`) |
| `src/lib.js` | Daten ohne DOM: Modelle und Zonen aufbereiten, Ringe normalisieren (Antimeridian, Pol), Treffertests, Region am Punkt |
| `src/schema.js` | Prüfung der Dateien aus `model-data/` |
| `sw.js` | Service Worker: Kacheln, Schriften und Sprites von OpenFreeMap 90 Tage im Cache |
| `scripts/` | `prebuild.mjs` (Daten nach `public/data/` kopieren und prüfen), `build.mjs` (`dist/`), `vendor.mjs` (Liste der Bibliotheken in `dist/vendor/`), `third-party.mjs` (`THIRD_PARTY_LICENSES.md`), `serve.mjs` (statischer Server) |
| `test/` | Vitest: Schema, Normalisierung, Gruppen, Zonen und Regionen gegen `resolver_cases.json`, Lizenzen |
| `LICENSE`, `LICENSES/`, `THIRD_PARTY_LICENSES.md` | Lizenztexte und Hinweise (siehe „Lizenz“) |
| `e2e/` | Playwright-Smoke-Test ohne Netz (im Wurzelverzeichnis `pnpm test:e2e`) |

## Daten

Die Seite lädt zur Laufzeit `data/model_domains.json`, `model_catalogue.json`, `chain_zones.json`,
`chain_zones.geojson` und `regions.geojson`. Der Prebuild nimmt sie unverändert aus `@graupel/model-data` und bricht
ab, wenn sie nicht zum Viewer passen. Abgeleitet werden im Browser:

- Gruppe eines Modells (Europe, North America, Asia, Intercontinental, Global) aus seinem Gebiet; `model-data/`
  liefert sie nicht mit.
- Wolkenprofil: mindestens 10 Druckflächen im Katalog, wie im Resolver von `graupel-gen`.
- Region am Mauszeiger im Tab „Chains“ wie `Resolver.region_at` (Priorität, dann Fläche, 0,02° Fang).

Ringe über ±180° werden zusammenhängend gezeichnet; Ringe um einen Pol werden über den Pol geschlossen und spannen
genau 360° (RDPS: in `model_domains.json` fehlt zwischen dem letzten und ersten Randpunkt ein Keil von 5°
bei 43,5° bis 48,6° W).

## Lizenz

Code: GPL-3.0-or-later (`LICENSE`), Copyright 2026 Bastian Schnitzler; jede Quelldatei trägt die SPDX-Header
`SPDX-FileCopyrightText` und `SPDX-License-Identifier: GPL-3.0-or-later`. Teile von `src/lib.js` folgen dem Resolver
von graupel-gen (MPL-2.0) und werden nach Abschnitt 3.3 der MPL-2.0 unter der GPL als Secondary License
weitergegeben. Daten: aus Open-Meteo.com abgeleitete Dateien unter CC BY 4.0 (`LICENSES/CC-BY-4.0.txt`),
`regions.geojson` unter MPL-2.0 (`LICENSES/MPL-2.0.txt`); der Prebuild legt `LICENSE`, `LICENSES/` und
`THIRD_PARTY_LICENSES.md` von `model-data/` mit nach `data/`.

`THIRD_PARTY_LICENSES.md` erzeugt `pnpm --filter @graupel/domain-viewer licenses` aus dem, was der Build ausliefert
(Pakete in `dist/vendor/` und, laut ihren Source Maps, was darin gebündelt ist); der Build schreibt dieselbe Datei nach
`dist/`, ein Test prüft, dass die eingecheckte aktuell ist. Die Seite nennt Kartenanbieter (OpenFreeMap,
OpenMapTiles), © OpenStreetMap contributors, Open-Meteo, Natural Earth und die Lizenzen sichtbar in der Seitenleiste.

## Befehle

```sh
pnpm --filter @graupel/domain-viewer build   # dist/ (statisch)
pnpm --filter @graupel/domain-viewer start   # bauen und http://localhost:4174/ starten
pnpm --filter @graupel/domain-viewer test    # Vitest
pnpm --filter @graupel/domain-viewer licenses # THIRD_PARTY_LICENSES.md neu schreiben
```

`dist/` braucht einen http(s)-Server; von der Platte (`file://`) lädt der Browser weder ES-Module noch die Daten.
