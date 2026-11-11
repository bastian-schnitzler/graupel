# @graupel/download

Bibliothek (DL), die Wettermodellketten von Open-Meteo lädt, Einheiten und Zeitstempel vereinheitlicht und zu einer
stündlichen Zeitachse zusammensetzt. ESM-JavaScript mit Typen, ohne Laufzeitabhängigkeiten, für Browser und
Node ≥ 20. Zunächst nicht auf npm veröffentlicht.

## Stand

- Typen des Ergebnisses (`HarmonizedForecastResponse`, `DataPoint`, `ModelAvailability`, `RunSegment`, …), Feldnamen
  wie im bisherigen Backend.
- Zeitachse: `normalizeTimestamp`, `canonicalTimestamp` (UTC-ISO mit „Z“, z. B. `2026-09-14T13:00:00Z`),
  `resolveTimezone`, `getUserTimezone`, `buildHourlyTimeline` (halboffen), `modelEndTimestamp`,
  `validateTimestampSequence` (`TimelineIntegrityError` bei nicht streng steigenden Zeitstempeln) u. a. Zeitstempel
  ohne Versatz gelten als UTC, sofern keine IANA-Zeitzone angegeben ist.
- Open-Meteo-Client: `createClient({ fetch?, forecastUrl?, singleRunsUrl?, metaUrl?, apiKey?, timeoutMs?,
  maxRetries?, retryBackoffMs?, concurrency?, cache? })` mit `fetchForecast` (immer `timezone=GMT`), `fetchModelMeta` und
  `fetchEnsembleMeta` (`meta.json`, `{}` bei Mischmodellen und 404), `fetchSingleRun` (Single-Runs-API) und
  `fetchSunPhases` (Sonnenauf- und -untergang ab vorgestern, UTC). Standard ist das globale `fetch`; jede Anfrage
  hat eine Zeitgrenze, wird bei 500–504, Netzfehlern und Zeitüberschreitung mit exponentiellem Backoff wiederholt
  (`maxRetries`; Anfragen an die Single-Runs-API nie, REQ-633), lässt sich per `AbortSignal` abbrechen und zählt zur
  Parallelitätsgrenze (Standard 4). `fetchSingleRun` meldet einen Ausfall (5xx, Netzfehler, Zeitüberschreitung) über
  `onUnavailable`, bevor eine wartende Anfrage startet. Unquotiertes `nan` wird
  zu `null`. Fehler: `ApiError` (`status`, `reason`, `url`), `OutOfDomainError` („No data is available …“),
  `AllModelsFailedError`. Dazu `toOpenMeteoModel`, `canonicalModelId`, `modelMetaPath`, `ensembleMetaPath`
  (Pfade aus dem Katalog haben Vorrang vor den eingebauten Tabellen).
- Größen und Harmonisierung: Registry (`quantities.json`) und Katalog (`model_catalogue.json`) aus
  `@graupel/model-data` übergibt der Aufrufer (geparstes JSON oder nur die Listen). `createQuantityRegistry`,
  `normalizeVariable` (Open-Meteo-Name oder Alias → Größen-ID), `openMeteoName`, `fetchSet`/`hourlyFetchSet`,
  `expandRequires`, `expectedQuantities`, `requestedFromModel` (optionale katalogisierte Größen nur, wenn das Modell
  sie in `supported_variables` führt), `modelHourlyVariables`, `findCatalogueModel`. `convertValueAndUnit` rechnet
  K/°F → °C und m/s, mph, kn → km/h um; `harmonize` macht aus einer Rohreihe `DataPoint`s mit kanonischen
  UTC-Zeitstempeln, meldet Lücken und Längenfehler über `onWarning` und füllt nichts auf. `fetchModelDatasets` lädt
  die Größen eines Modells und wiederholt eine abgelehnte Anfrage einmal ohne die `retry_without`-Größen (Schnee).
- Ketten zusammensetzen: `downloadChain(client, { location, chain | auto, cloudChain?, quantities?, now?,
  timezone?, runSegments?, refresh?, signal?, onWarning? }, { catalogue, registry, domains?, regions? })` lädt die
  Hauptkette und die Wolkenkette und gibt ein `ForecastResult` zurück: `timeline { start, now, end }` (gestern 00:00
  in `timezone`, volle Stunde, Kettenende), `chain`/`cloudChain` (zusammengesetzte Ketten mit `sliceEndHours`,
  `runSegments`, Form wie `MeteogramChainModel`), `combined`, `byModel`, `cloud`, `cloudByModel`,
  `cloudTransitions`, `sunPhases`, `availability`, `cloudAvailability`, `runSegments`, `diagnostics`, `autoChain`,
  `raw`, `errors`, `warnings`, `generatedAt`. Kettenglieder sind Katalog-IDs oder -Namen (Horizont aus dem Katalog)
  oder Objekte mit `max_forecast_horizon_hours`. Regeln: jedes Modell wird bis zu seiner Fähigkeit, höchstens bis
  zum Kettenende geladen; eine Stunde gehört dem ersten Modell, dessen Horizont dahinter liegt (vergangene Stunden
  dem ersten Modell); ein Abschnitt endet, wo der neueste Lauf endet (`meta.json` und Daten), in der Hauptkette nach
  der letzten Stunde mit Temperatur (`SLICE_END_QUANTITY`; ohne Temperatur zählen alle Hauptgrößen), Lücken bleiben null
  und werden nie aus einem anderen Modell aufgefüllt; ein fehlerhaftes Modell leert nur seinen Abschnitt, schlagen
  alle fehl, kommt `AllModelsFailedError`. Antwortet ein Modell der Hauptkette ohne aktuelle Daten (kein Wert ab
  jetzt, z. B. ein eingestelltes Modell), während ein anderes Modell der Kette aktuelle Daten hat, übernimmt ein
  feines Modell mit aktuellen Daten seinen Abschnitt bis zum eigenen Datenende (REQ-767, mit `domains` und
  `regions`): zuerst aus der Wolkenkette der Region am Ort, höchstens 2,5 km gröber als das ausgefallene Modell, sonst
  das feinste Modell, das den Ort abdeckt (`replacementCandidates`; aktiv, kein Blend oder Ensemble, feiner als
  `FALLBACK_MAX_RESOLUTION_KM`, nicht schon in der Kette); es wird wie ein Kettenmodell geladen, höchstens
  `MAX_REPLACEMENT_ATTEMPTS` Kandidaten. Sein Eintrag in `chain` nennt das ersetzte Modell (`replaces`),
  `autoChain.replaced_models` beide. Ohne `cloudChain` dient ECMWF IFS 0.25° über die Länge der Hauptkette
  als Wolkenmodell, `cloudChain: []` schaltet die Wolken ab. Run-Segmente (Single-Runs-API) werden standardmäßig
  geladen, `runSegments: false` schaltet sie ab (REQ-414). Scheitert eine Anfrage an die Single-Runs-API mit 5xx,
  Zeitüberschreitung oder Netzfehler, bricht die Laufsuche für den ganzen Ladevorgang ab (alle Modelle, laufende und
  noch nicht gestartete Suchen, keine weitere Anfrage dorthin): das Ergebnis kommt sofort mit den bis dahin bekannten
  Run-Segmenten, alle anderen Modelle wie bei `runSegments: false`, und eine Warnung nennt den Ausfall
  (`SingleRunsUnavailableError`, REQ-633). Ein fehlender Lauf (z. B. 404, leere Antwort) ist kein Ausfall und wird
  wie bisher übersprungen. Dazu Ensemble-Läufe hinter `precipitation_probability`
  und Sonnenzeiten. `toMeteogramInput(result)` liefert die Eingabe des Meteogramms, `toHarmonizedResponse(result)`
  die Form des alten Backends. Bausteine: `mergeForecastSegments` (aus `react/src`), `mergeVerticalCloudSegments`,
  `fetchCloudModelForecast`, `capChainToAvailability`, `computeAvailableHours`, `getFetchHorizon`,
  `yesterdayMidnightUtc`, `pastHoursForYesterday`, `fetchRunInfo`, `resolveRunSegments`, `fetchEnsembleInfo`.
- Auto-Chain: `resolveAutoChain(lat, lon, { catalogue, domains, regions })` bzw. `createResolver(...)` mit
  `resolve`, `regionAt`, `regionChains`, `domainContains`, `fallbackCandidates`, `listRegions`; dieselben Regeln wie der Resolver des
  Generators (geprüft gegen `resolver_cases.json`). `downloadChain` mit `auto: true` löst die Ketten am Ort auf
  und lässt Modelle ohne Daten weg (`autoChain.dropped_models`).
- Cache: `createClient({ cache })` nimmt ein `ForecastCache` (`get`/`set`, synchron oder mit Promises); Standard
  ist `createMemoryCache()` (im Speicher, optional `maxAgeMs`, `maxEntries`), `cache: null` schaltet ab. Der
  Schlüssel enthält Ort (4 Nachkommastellen), Ketten, Größen, Optionen und die volle Stunde; innerhalb einer Stunde
  liefert ein gleicher Aufruf dasselbe Ergebnisobjekt (nur lesen), `refresh: true` lädt neu.
- Attribution: jedes `ForecastResult` trägt `attribution` (`text`, `url`, `license`, `licenseUrl`,
  `modifications`), `toHarmonizedResponse` dasselbe als `attribution` mit `license_url`. Vorlage:
  `OPEN_METEO_ATTRIBUTION`.

## Lizenz

- Code: [MPL-2.0](LICENSE). Jede Quelldatei trägt den SPDX-Header `MPL-2.0`.
- Daten: Die geladenen Wetterdaten stammen von [Open-Meteo](https://open-meteo.com/) und stehen unter
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Die Bibliothek vereinheitlicht sie (Einheiten,
  Zeitstempel) und setzt sie aus mehreren Modellen zu einer Zeitachse zusammen; das Ergebnis ist damit eine
  veränderte Fassung.
- Attributionspflicht: Wer die Daten oder daraus Abgeleitetes (Meteogramm, Bild, Export) anzeigt oder weitergibt,
  zeigt die Attribution aus `result.attribution`: „Weather data by Open-Meteo.com“ mit Link auf
  https://open-meteo.com/, die Lizenz CC BY 4.0 mit Link und den Hinweis auf die Veränderung (`modifications`).
- API-Bedingungen von Open-Meteo: Die freie API (Standard-URLs) ist nur für nicht-kommerzielle Nutzung und bis
  10 000 Anfragen am Tag erlaubt. Eine Kette lädt je Modell, Wolkenmodell, `meta.json`, Single Run und
  Sonnenzeiten eigene Anfragen; der Cache spart Wiederholungen innerhalb einer Stunde. Kommerzielle Nutzung
  braucht ein Open-Meteo-Abo: `createClient({ apiKey, forecastUrl, singleRunsUrl })` mit dem Schlüssel und den
  Kunden-URLs (z. B. `https://customer-api.open-meteo.com/v1/forecast`); `apiKey` wird als `apikey` an Vorhersage-
  und Single-Runs-Anfragen gehängt.

## Befehle

Im Paketordner oder per `pnpm --filter @graupel/download <befehl>`:

- `pnpm build` – tsup, ESM und `.d.ts` nach `dist/`
- `pnpm test` – Vitest
- `pnpm lint` – ESLint
- `pnpm typecheck` – TypeScript ohne Ausgabe
