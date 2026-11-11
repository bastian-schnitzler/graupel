# apps/web

WEB: Website und App (`@graupel/web`), React 19, Vite und TypeScript ohne UI-Bibliothek (DEC-025).

## Befehle (in `apps/web/` oder mit `pnpm --filter @graupel/web <befehl>`)

| Befehl | Zweck |
|---|---|
| `pnpm dev` | Entwicklungsserver (Port 5173) |
| `pnpm build` | Typprüfung und Build nach `dist/` |
| `pnpm preview` | gebaute Seite ausliefern (Port 4175) |
| `pnpm package` | Workspace-Pakete und Seite frisch bauen (`scripts/fresh-build.mjs`), dann `dist/` nach `release/graupel-site.zip` packen und prüfen |
| `pnpm licenses` | `THIRD_PARTY_LICENSES.md` neu schreiben (nach Änderungen an Abhängigkeiten) |
| `pnpm test` | Vitest mit Testing Library |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |

End-to-End-Tests liegen in `e2e/` und laufen mit `pnpm test:e2e` im Wurzelverzeichnis (Playwright baut die Seite und
startet `vite preview`).


## Aufbau

- `src/main.tsx` bindet `App` ein; `src/App.tsx` setzt die Bereiche in das Layout.
- `src/layout/AppLayout.tsx`: Grundlayout mit benannten Plätzen (`location`, `header`, `modelChain`, `daySlider`,
  `meteogram`, `footer`). Schmal untereinander, breit Ortsauswahl links und Kopfleiste rechts. Ein weggelassener
  Platz (z. B. Modellketten-Block per Konfiguration aus) wird nicht gerendert.
- `src/regions/<Name>/`: je Bereich ein Ordner mit Komponente, CSS und `index.ts`.
- Fehlermeldungen (REQ-492, `src/state/notices.ts`, `src/components/ErrorCards.tsx`): keine Meldungen mehr im
  Bereich, sondern Karten unten links, gestapelt (neueste unten), jede mit Schließen-Knopf („Meldung schließen“) und
  `role="alert"`, in der Region „Meldungen“. `NoticesProvider` (in `App` direkt unter `I18nProvider`) hält den Speicher
  und zeichnet die Karten. Bereiche melden mit `useNotices().notify({ id, message })` (Schlüssel der Übersetzung, so
  folgt die Karte einem Sprachwechsel) und nehmen die Meldung mit `dismiss(id)` zurück; `useErrorNotice(id, key | null)`
  zeigt eine Meldung, solange der Schlüssel gesetzt ist, und nimmt sie beim Zurücksetzen oder Aushängen zurück.
  Optional `detail` (zweiter Schlüssel, leiser darunter, `data-testid="error-card-detail"`); `params` gelten für beide.
  Dieselbe id ersetzt ihre Karte, derselbe Text unter anderer id erscheint nicht doppelt. Ids: `location.gps`
  (verweigert, nicht verfügbar, Zeitüberschreitung, kein GPS; weg beim nächsten Versuch), `location.search` (bis zur
  nächsten Suche), `location.map` (bis die Karte schließt), `forecast` (bis zum nächsten Laden), `modelChain`,
  `meteogram.image` (Kopieren/Speichern fehlgeschlagen; Erfolg bleibt die kurze Rückmeldung neben dem Knopf),
  `settings.transfer` (abgelehnte Datei; weg mit dem Popup). Ist ein modaler `Dialog` offen, zeichnen sich die Karten
  in ihm (`useNoticeHostElement`), denn die Seite dahinter ist inert. Position: `fixed`, Abstand der Seitenränder
  bzw. Safe-Area, höchstens 24rem breit, auf Telefonen Seitenbreite minus Ränder; über der Vollbildkarte höher,
  damit Abbrechen/OK frei bleiben. Wo ein Ladefehler den Inhalt ersetzt, bleibt ein Platzhalter (Meteogramm: nur
  „Erneut versuchen“, Modellkette: leere Karte).
- Footer (`regions/Footer/`, REQ-426): Links „Info“, Impressum und Datenschutz (Dateninformation); jeder öffnet das
  Info-Popup im passenden Tab (`useInfoDialog().open(tab)`), Impressum und Datenschutz tragen die Beschriftung ihres
  Tabs (`infoTabLabel()`, also auch `legal.imprint.label`). Am Anfang der Zeile steht ein Platz (`footer__start`,
  `useFooterSlotRef()` aus `src/state/footerSlot.tsx`, `FooterSlotProvider` in `App`), in den das Meteogramm auf
  Telefonen seine Knöpfe Kopieren und Speichern legt (Portal, REQ-541): links bündig in derselben Zeile, die Links
  bleiben rechts; ohne Knöpfe ist der Platz leer und unsichtbar.
- Farbmodus (REQ-426, `src/state/colorMode.ts`): System, Hell oder Dunkel als Abschnitt „Farbmodus“ der Einstellungen
  (`dialogs/settings/ColorModeSettings.tsx`). Die Wahl liegt in `localStorage` (`graupel.colorMode`, „System“ löscht
  den Eintrag) und wirkt als `data-theme="light|dark"` am `<html>` (System: ohne Attribut, also
  `prefers-color-scheme`). Ein kleines Skript in `index.html` setzt sie vor dem ersten Zeichnen, `initColorMode()` in
  `main.tsx` danach; `useColorMode()` liefert `[mode, setMode]` und folgt auch anderen Tabs. Tokens und Meteogramm
  (`src/state/pageTheme.ts`) folgen dem Attribut.
- `src/state/`: gemeinsamer Zustand der Seite. `LocationProvider` (in `App.tsx`) hält den gewählten Ort, Start mit
  `startPlace(config)`; `useLocation()` liefert `{ place, setLocation }` (Typ `Place` aus `src/config`, Zusatzfelder
  wie Land werden verworfen). Modellkette, Meteogramm und Export/Import lesen und setzen den Ort darüber.
- Vorhersage (REQ-436): `ForecastProvider` (`src/state/forecast.ts`, in `App.tsx` unter `LocationProvider` und
  `ChainProvider`) lädt mit `@graupel/download` (`createClient`, `downloadChain`) die Kette am gewählten Ort, im
  Modus `auto` mit `auto: true` (Katalog, Größen und Domains aus `@graupel/model-data` als JSON gebündelt,
  `regions.geojson` per `fetch` von seiner Asset-URL geladen und mit `JSON.parse` gelesen, `src/services/modelData.ts`),
  sonst mit `models`/`cloudModels` der Auswahl (Katalog-ID und Ende jedes Abschnitts, also auch gezogene Grenzen;
  abgeschaltete Wolkenkette: `cloudChain: null`). `useForecast()` liefert `{ status: "idle" | "loading" | "ready" | "error", result?,
  error?, reload }`; ein Ortswechsel bricht die laufende Anfrage ab, beim Laden bleibt das letzte Ergebnis stehen,
  `reload()` umgeht den Cache. Nur die Koordinaten lösen ein neues Laden aus (Name und nachgeladene Höhe nicht).
  Ein Client für die ganze Seite mit Speicher-Cache für ganze Ergebnisse (höchstens 64, `maxResults`) und darunter
  einem Gedächtnis der Open-Meteo-Antworten (REQ-497, `createResponseMemory` in `src/services/responseMemory.ts`, als
  `fetch` des Clients): jede erfolgreiche GET-Antwort (und ein fehlendes `meta.json`, 404) bleibt nach URL im
  Speicher, ohne Ablaufzeit (höchstens 128, die älteste fällt zuerst heraus, andere Fehler nie). Ein Ort wird einmal
  geladen (REQ-504): `downloadChain` holt jedes Modell der Ketten über seinen ganzen gelieferten Zeitraum bis zum
  Kettenende, und das „jetzt“ der Anfragen (`request.now`) ist der Moment, in dem der Ort (oder ein Neuladen)
  begann; es bleibt für alle Ketten dieses Orts, auch wenn die Stunde wechselt. Eine verschobene Modellgrenze ändert
  daher nur den Schlüssel des Ergebnisses, nicht die Anfragen je Modell, und die Seite baut die Kette aus den
  vorhandenen Antworten neu, ohne Download. Ein anderer Punkt und `reload()` (`refresh`) leeren Gedächtnis und
  Ergebnisse; erst dann gilt ein neues „jetzt“. `createForecastLoader({ fetch?, ttlMs?, maxEntries?, maxResults? })`
  baut diesen Lader, `createForecastLoader({ client })` einen mit eigenem Client ohne Gedächtnis.
  `setPreview({ models, cloudModels } | null)` von `useForecast()` nimmt die vorläufige Kette einer gezogenen Grenze
  (REQ-504): die Vorhersage folgt ihr aus dem Gedächtnis und meldet dabei `ready` mit `previewing: true`, das letzte
  Ergebnis bleibt stehen, bis das neue fertig ist (keine Meldung „wird aktualisiert“). Kommt die nächste Stunde,
  bevor ein Neubau fertig ist, wartet nur die jüngste und folgt danach. Der Schlüssel einer Vorschau ist derselbe wie
  der der Kette nach `setChain`, daher lädt das Loslassen nichts noch einmal. `useChainSelection()`
  (`src/state/chain.ts`): siehe Modellkette.
- Tages-Slider (`regions/DaySlider/`, REQ-436): je Ortstag der Daten eine Karte (Wochentag, Datum in Seitensprache
  und Zeitzone der Vorhersage, heute hervorgehoben; ein nur teilweise abgedeckter Tag ist eine ganze Karte). Die
  Markierung über den gewählten Tagen ist an beiden Rändern ziehbar und verschiebbar, solange sie kleiner als der
  Gesamtzeitraum ist; ein Tippen auf die Markierung oder ein Klick auf eine Karte wählt den Tag, „Alle“
  setzt zurück. Tageskarten und „Alle“ stehen in einer Rasterzeile gleich breiter Spalten, der Slider passt so ohne
  Scrollleiste in jede Breite und „Alle“ ist genau so groß wie eine Tageskarte (REQ-446); sind die Karten für die
  langen Beschriftungen zu schmal, zeigen sie nur Anfangsbuchstaben des Wochentags und Tag des Monats (Klasse
  `day-slider--short`, `data-labels="short"` an der Spur). Wann das passiert, hängt von der Sprache ab (REQ-520): Die
  Seite misst versteckte Kopien der langen Beschriftungen (`.day-slider__measure`) gegen die Innenbreite einer Karte
  (`ResizeObserver`, nach dem Laden der Schriften erneut); der Wochentag behält seine volle Größe, das Datum darf auf
  drei Viertel schrumpfen (`--day-weekday-scale`, `--day-date-scale`). Französisch („mar.“) schaltet so früher um als
  Deutsch („Di“), Englisch noch später. „Alle“ läuft bei schmalen Karten per Container-Query senkrecht. Der Slider
  ist eine eigene Karte (REQ-499, `section[data-region="day-slider"]` mit dem Namen „Horizont“, Platz `daySlider` des
  Layouts) zwischen Modellkette und Meteogramm, so breit wie die anderen Karten und gebaut wie eine Karte der
  Modellkette: links die senkrechte Beschriftung „HORIZONT“ (`region.daySlider.title`, Stil von „Wetter“/„Wolken“),
  Tageskarten und „Alle“ wie Modellkarten (Balken oben, Wochentag fett wie der Modellname, Datum als schlichter Text
  ohne Plakette, REQ-505; heute mit orangem Balken und oranger Plakette, gewählte Tage hellgrau mit grauem Balken). Die ganze Auswahl ist grau
  statt blau, damit sie weniger hervorsticht (REQ-513: Grund, obere Balken, Rahmen und Griffe, hell wie dunkel; der
  orange Balken von heute bleibt obenauf).
  Die Griffe der Markierung sitzen auf ihrem Rahmen. Sind alle Tage gewählt, gleich wie (Klick auf „Alle“, Ziehen über
  alle Tage, Doppelklick, Tastatur), reicht die Markierung samt Rahmen, Griffen und hellgrauem Grund bis hinter
  „Alle“, das keine eigene blaue Plakette mehr bekommt (REQ-506, `.day-slider__marker--whole` mit `grid-column: 1 /
  -1`); ein Tippen auf die Markierung über „Alle“ behält alle Tage, der Endgriff lässt sich von dort zurückziehen.
  Auf Telefonen (Container-Query `day-slider` unter 40rem, REQ-458) ist der Slider ein kompakter Streifen mit großen
  Griffen unter den Tagen, ohne den gewählten Zeitraum in Worten und ohne „Alle“ (REQ-528); alle Tage wählt dort ein
  Doppeltippen auf einen Tag (REQ-485) oder Ziehen über alle Tage. Auf Telefonen (Container-Query `app` bis 40rem,
  REQ-529) ist der Slider keine Karte und hat keine Beschriftung „HORIZONT“; der Streifen reicht ohne Rand von der
  linken bis zur rechten Kante der oberen Karte (REQ-540), die Griffe ragen in den Seitenrand. Steht die Markierung am
  ersten bzw. letzten Tag (`.day-slider__marker--first`, `--last`), sitzt der Griff dort mittig auf der Kante und seine
  Tippfläche endet 0,25rem dahinter, damit beide im Bildschirm bleiben und die Seite nicht seitwärts scrollt; sonst
  hängen die Griffe wie bisher meist außerhalb der Markierung. Die Meteogramm-Karte hat keine
  sichtbare Überschrift (REQ-507) und ist auf Telefonen keine Karte (ohne Rahmen, Grund und Innenabstand, REQ-529);
  ist der Slider aus, fehlt die ganze Karte (`DaySliderCard` in `App.tsx`). Tastatur: Pfeile, Pos1 und Ende an Rändern und Markierung (`role="slider"`). `daySlider.days` der
  Konfiguration begrenzt die Karten auf die Tage vor heute und N Tage ab heute; ist der Slider aus (Konfiguration oder
  Einstellungen, REQ-473), begrenzen die gewählten Tage (ohne Wahl `daySlider.days`) so das Meteogramm. Die Auswahl hält
  `DaySelectionProvider`, `useForecastDays()` (`src/state/days.ts`) liefert Tage, Auswahl und `visibleRange`.
  Tastenkürzel der ganzen Seite (REQ-533, `src/state/dayShortcuts.ts`, solange der Slider gezeigt wird), nach der
  Lage der Taste (`KeyboardEvent.code`), also auf deutscher und englischer Tastatur dieselben Tasten:
  - Taste vor der 1 (`Backquote`: ^ bzw. `): alle Tage, wie „Alle“.
  - `1`–`9`: gestern bis heute + N − 1 (1 gestern und heute, 2 gestern bis morgen …); `0`: zehn Tage samt gestern und heute.
  - Taste nach der 0 (`Minus`: ß bzw. -): blendet gestern in der Auswahl ein oder aus; die Ziffern folgen dem (ohne gestern
    ist 1 nur heute, 0 zehn Tage ab heute). Ohne gestern in den Daten wirkt sie nicht.
  „Heute“ ist der Tag des „Jetzt“ der Vorhersage (rote Linie, Zeitpunkt des Abrufs), nicht der Tag der Uhr. Die Kürzel
  wirken nicht in Eingabefeldern, mit Strg, Alt oder Meta, bei offenem Dialog (auch Vollbild-Meteogramm) oder Popup;
  hat das Meteogramm den Fokus, bleiben ihm `0` und `-`. Die Auswahl läuft über `setSelection` wie Ziehen und „Alle“.
- Meteogramm (`regions/MeteogramPanel/`, REQ-436): Karte ohne sichtbare Überschrift, nur mit `aria-label`
  „Meteogramm“ (`region.meteogram.title`, REQ-507); rechts neben dem Diagramm eine schmale Spalte mit den Knöpfen
  Kopieren, Speichern (nur Touch) und Vollbild untereinander, oben bündig; die Rückmeldung „Kopiert“ erscheint links
  neben den Knöpfen. Auf Telefonen gibt es die Spalte nicht (REQ-541): Kopieren und Speichern stehen nebeneinander links
  in der Zeile des Footers (vor den Links, auch in der Tab-Reihenfolge, Rückmeldung darüber), das Diagramm nimmt die
  ganze Breite; ohne Footer (`useFooterSlot()` ist `null`) bleiben sie in der Spalte.
  Telefon heißt hier `PHONE_QUERY` aus `src/state/phoneLandscape.ts` (`usePhone()`): grober Zeiger und höchstens 30rem
  breit, oder Telefon im Querformat (`PHONE_LANDSCAPE_QUERY`); ein schmales Desktop-Fenster oder ein Tablet zählt nicht.
  Auf Telefonen zeigt das eingebettete Diagramm bei Berührung weder Cursorlinie noch Tooltip (`interaction.hover` und
  `interaction.tooltip: false`, REQ-531); es scrollt nur seitwärts.
- Vollbild (`MeteogramFullscreen.tsx`, REQ-454): Dialog ohne Titelleiste, rechts Schließen, Kopieren, Speichern. Auf dem
  Desktop öffnen ihn Doppelklick und Vollbild-Knopf; auf Telefonen nur das Drehen ins Querformat, das Zurückdrehen
  schließt ihn (REQ-532), Doppeltippen öffnet und schließt ihn dort nicht. Auf Telefonen hat er keine Knöpfe
  (REQ-537, `controls={false}`, `Dialog` mit `closeButton={false}`): keine rechte Spalte, das Diagramm hat links und
  rechts denselben Rand; Escape schließt ihn weiterhin. Ein Tipp setzt im Vollbild Cursorlinie und
  Tooltip an die Stelle (`hoverAtPointer` und `setHover` des Controllers), da ein Touch-Zeiger das Diagramm beim
  Abheben wieder verlässt. Keine Scrollleisten (REQ-530): Das Diagramm hat im Vollbild keine Mindestbreite und passt in
  beide Richtungen; solange er offen ist, trägt `<html>` die Klasse `meteogram-fullscreen-open`, die `html` und `body`
  auf Viewporthöhe mit `overflow: hidden` setzt, damit die Seite dahinter nicht scrollt (iOS zeigte sonst deren
  Scrollleiste über dem Vollbild); beim Schließen springt die Seite an ihre alte Stelle zurück.
  `<Meteogram>` aus `@graupel/meteogram-react` mit
  `toMeteogramInput(result)`, Texten aus `useMeteogramI18n()`, Theme nach `data-theme` von `<html>` bzw. der
  Systemeinstellung (`src/state/pageTheme.ts`) und `interaction.zoom: false` (kein Mausrad-Zoom). Ein neues Ergebnis
  desselben Orts und Zeitraums (verschobene oder gezogene Grenze, Neuladen in derselben Stunde) gibt dem Diagramm nur
  neue Daten; ein anderer Ort oder Zeitraum baut es neu (Schlüssel aus Koordinaten und `timeline`, REQ-504). Jeder Modellkopf hat
  den Orangeton seines Modells aus der Wetterkette (`modelHeaderColors` aus `useModelHeaderColors()`, Schrift schwarz
  oder weiß nach Kontrast, siehe „Farben der Modellkette“). Die Zeitachse folgt der
  Markierung, sobald das Ziehen endet. Lade- und Fehlerzustand (Meldung als Fehlerkarte, an Ort und Stelle nur „Erneut versuchen“);
  „Vorhersage wird aktualisiert …“ erscheint erst, wenn ein Neuladen bei vorhandenem Diagramm länger als 400 ms
  dauert (`UPDATING_DELAY_MS`), und liegt dann über dem oberen Rand des Diagramms, statt es nach unten zu schieben
  (REQ-497); ohne Diagramm steht „Vorhersage wird geladen …“ an seiner Stelle. Attribution von Open-Meteo
  mit Link aus `result.attribution` in der Fußzeile des Meteogramms („Weather data by Open-Meteo.com“, sonst nichts;
  Lizenz und Hinweis auf die Veränderung stehen im Info-Popup, Tab About, REQ-478).
  Die Fußzeile ist dreiteilig (REQ-464): links Ort und Zeit, in der Mitte die Domain in Kurzform (`centerLabel` des
  Meteogramms aus `siteDomain(config)`), rechts die Attribution.
  Das Diagramm skaliert mit seiner Breite (auch die Schrift); unter 40rem behält es diese Breite und scrollt im
  Bereich seitwärts, damit es auf Telefonen lesbar bleibt. Auf schmalen Seiten (bis 40rem, `useNarrowPage()` aus
  `src/state/narrowPage.ts`, wie die Container-Query `app`, REQ-542) bekommt das eingebettete Diagramm
  `NARROW_CHART_OPTIONS` aus `layout.ts`: die Achsbeschriftungen zeigen den Wert und darunter die Einheit (`11` /
  `mm`, `19°` bleibt einzeilig), die linke Legende beginnt an der linken Kante des Inhalts, die rechte (Wolkenhöhen)
  endet an der rechten Kante des Diagramms (Optionen `axisLabels: { unit: "below", align: "edge" }` und
  `padding: { left: 26, right: 16 }` von `@graupel/meteogram`). Das Bild zum Kopieren und Speichern übernimmt diese
  Beschriftung; das Vollbild und breite Seiten bleiben beim gewohnten Layout. Ist das Diagramm klein, weil ein
  Telefon hochkant seine Zeichenbereiche niedriger macht (REQ-608), und ist einer davon niedriger, als die zweizeiligen
  Beschriftungen brauchen (`NARROW_LABELS_MIN_AREA_HEIGHT`, etwa 56 viewBox-Einheiten), wird die Beschriftung kompakt
  (`compactAxisLabels`, Option `axisLabels.compact` des Kerns, REQ-694): die Einheit steht je Achse nur einmal unter
  dem Bereich, Höchst- und Tiefstwert (auch der Temperatur) stehen in seiner oberen und unteren Ecke, 1 px vom Rand;
  die Wolkenhöhen behalten ihre Einheit in einer Zeile (`6 km`). Große Diagramme bleiben unverändert. Den Lauf eines
  geteilten Modells schreibt der Modellkopf ohne Monat (`07 Z06`, bzw. nur das Datum `02/11` in der Reihenfolge der
  Seitensprache, Option `locale`, REQ-682). Layout (`layout.ts`, REQ-447): das Power-Layout des
  Meteogramms ohne Reihen, Achsen und Flächen, deren Größen nicht in `quantities.json` von `@graupel/model-data`
  stehen; seit CAPE, CIN und LPI dort fehlen, entfällt die Konvektionsfläche (Temperatur, Niederschlag, Wind).
  `modelHeaders: false` (bzw. die Wahl in den Einstellungen, REQ-472) zeichnet das Standardlayout ohne
  Modell-Kopfzeile.
- End-to-End-Tests ohne Netz: Die Specs nehmen `test` und `expect` aus `e2e/fixtures.ts`; dessen automatische Fixture
  `openMeteo` leitet jede Seite auf das Open-Meteo-Double `e2e/openMeteo.ts` (`mockOpenMeteo(page)`: Vorhersage,
  `meta.json` und Single Runs mit erzeugten Daten, immer Status 200, damit der Browser keine Fehler loggt).
- `src/services/geocoding.ts`: Ortssuche (`searchPlaces`, Open-Meteo Geocoding in der Seitensprache) und Höhe
  (`fetchElevation`, Open-Meteo Elevation); beide nehmen ein eigenes `fetch`.
- `src/i18n/`: Mehrsprachigkeit ohne Bibliothek (REQ-423, DEC-020, DEC-025). Je Sprache eine JSON-Datei
  (`de`, `en`, `fr`, `it`, `sl`, `cs`, `nl`, `da`) mit englischen, flachen Schlüsseln (`region.location.title`);
  `en.json` ist die Referenz, fehlende oder leere Texte fallen auf Englisch zurück, `{name}` wird ersetzt. Die
  Sprache wählt `I18nProvider` in der Reihenfolge gespeicherte Wahl (`localStorage`, Schlüssel `graupel.language`) >
  Browsersprache (`navigator.languages`) > Rückfallsprache der Domain (`defaultLanguage` der Konfiguration) >
  Englisch, jeweils nur unter den angebotenen `languages` der Konfiguration; er setzt auch `<html lang>`. In Komponenten: `useT()` für Texte, `useI18n()` für `language`, `locale`
  Die Sprachauswahl ordnet die angebotenen Sprachen fest nach `LANGUAGES`: Englisch zuerst, dann Deutsch (REQ-534).
  und `setLanguage` (speichert die Wahl, `null` vergisst sie), `useMeteogramI18n()` für `locale`, `texts` und
  `tooltipTexts` des Meteogramms. Neue Texte kommen in alle acht Dateien; ein Test prüft gleiche Schlüssel.
- `src/dialogs/`: Popups der Kopfleiste (REQ-434). `Dialog` ist das modale Grundgerüst auf dem nativen `<dialog>`
  (`showModal`, Tab bleibt im Dialog, Escape, Schließen-Knopf und Klick auf den Hintergrund schließen, der Fokus
  kehrt zurück). `DialogsProvider` (in `App.tsx`) hält die Popups und rendert das offene; `useInfoDialog()` liefert
  `open(tab?)`, `close()`, `selectTab(tab)`, `isOpen` und `tab` (`"about" | "imprint" | "privacy"`), z. B.
  `useInfoDialog().open("imprint")` für einen Footer-Link; `useSettingsDialog()` liefert `open()` und `close()`.
  Inhalte der Info-Tabs: `dialogs/info/AboutPanel.tsx`, `ImprintPanel.tsx`, `PrivacyPanel.tsx` (oder
  `DialogsProvider infoPanels={{ imprint: … }}`); die Beschriftung des Impressum-Tabs nimmt `legal.imprint.label`
  der Konfiguration, wenn gesetzt (`infoTabLabel()`, auch Überschrift des Panels). Die Tab-Leiste scrollt nie und
  zeigt keine Scrollbar (REQ-518, `InfoDialog.css`): Passen die Tabs nicht in eine Zeile, brechen sie um. Das
  Info-Popup hat in allen Tabs dieselbe feste Höhe (höchstens 44rem, sonst Fensterhöhe minus Rand) und behält beim
  Tabwechsel Größe und Oberkante; ein längerer Tab scrollt im Inhalt (REQ-525). Abschnitte der Einstellungen:
  Eintrag in `SETTINGS_SECTIONS` (`dialogs/settings/sections.tsx`) mit Titel-Schlüssel und Komponente: Farbmodus,
  Karte, Startort, Modellkette, Meteogramm. Die Sprache wählt nur die Kopfzeile (REQ-468).
- Einstellungen vor der Konfiguration (REQ-470, REQ-472, REQ-473, `src/state/displaySettings.ts`): jede eigene Wahl
  liegt in `localStorage` und geht in Export und Import; ohne eigene Wahl gilt der Wert aus config.json (Muster wie
  der Kartenanbieter; gemeinsamer Baustein `storedChoice()` in `src/state/storedChoice.ts`).
  - Startort (`graupel.startLocation`: `last`, `gps` oder der Ort als JSON; Abschnitt „Startort“,
    `dialogs/settings/StartLocationSettings.tsx`): Auswahl „Zuletzt gewählter Ort“ (erste Option und Standard ohne
    eigene Wahl, REQ-599), „Aktueller Standort (GPS)“ oder ein Ort aus den Favoriten (ein fester Startort der
    Konfiguration oder ein gewählter Ort, der kein Favorit ist, steht mit in der Liste). Gilt beim nächsten Start
    (`LocationProvider`, `useStartLocation()`, `effectiveStartLocation()`). Mit GPS zeigt die Seite zuerst den ersten
    eigenen Favoriten und liest den Standort nur, wenn der Browser die Erlaubnis schon erteilt hat (Permissions API
    `granted`); sonst fragt sie weiter erst auf Knopfdruck (DEC-021).
  - Zuletzt gewählter Ort (REQ-599, `state/location.tsx`): Der `LocationProvider` merkt sich jeden Ort, den die Seite
    nach dem Start zeigt (Suche, Favorit, Karte, GPS-Knopf, nachgeladene Höhe, GPS-Standort beim Start), unter
    `graupel.lastPlace` (`rememberPlace()`, `readLastPlace()`; ohne Speicher wird nichts gemerkt). Mit „Zuletzt
    gewählter Ort“ öffnet die Seite diesen Ort; ist keiner gemerkt (erster Besuch, gelöschte Daten), gilt
    `startLocation` der config.json wie bisher (bei `"gps"` wie die GPS-Option). Eine eigene Wahl GPS oder fester
    Ort bleibt. Export und Import tragen die Wahl (`"last"`), nicht den gemerkten Ort; `null` (keine eigene Wahl)
    bedeutet ebenfalls „Zuletzt gewählter Ort“.
  - Modellköpfe (`graupel.modelHeaders`, `useModelHeaders()`) und Tages-Slider (`graupel.daySlider`) als Schalter im
    Abschnitt „Meteogramm“ (`dialogs/settings/MeteogramSettings.tsx`). Ist der Slider aus, wählt der Nutzer dort die
    angezeigten Tage (1–16 oder „Alle Tage“, `graupel.days`; ohne Wahl `daySlider.days`); `useDaySlider()` liefert
    den wirksamen Stand, bei eingeschaltetem Slider mit `daySlider.days` der Konfiguration. Die Auswahl der Tage steht
    immer da und ist bei eingeschaltetem Slider ausgegraut, damit der Dialog beim Umschalten seine Höhe behält (REQ-500).
  - Taupunkt (REQ-593, REQ-621, `graupel.dewPoint`, `useDewPoint()`, `setDewPoint()`): Auto, An oder Aus als Auswahl
    wie beim Farbmodus am Ende des Abschnitts „Meteogramm“, darunter ein Hinweis zu Auto (mit der 5-°C-Regel der
    Bibliothek, REQ-620). Ohne Wahl gilt Aus (wird nicht gespeichert, wie „System“ beim Farbmodus); Auto und An werden
    gespeichert. Bis REQ-621 war Auto der Standard und wurde nicht gespeichert, gilt also seitdem als Aus, bis man es
    wieder wählt; ein gespeichertes An bleibt. config.json hat keinen Wert dafür. Die Seite reicht die Wahl als
    Render-Option `dewPoint` an `@graupel/meteogram` durch: Meteogramm der Seite und Vollbild (`MeteogramPanel`) sowie
    das kopierte oder gespeicherte Bild (`imageRenderOptions`). Linie, Spread-Fläche, Auto-Regel und Achse zeichnet die
    Bibliothek (REQ-595); Tooltip und Seitenleiste haben keine Taupunkt-Zeile. Der Taupunkt (`dew_point_2m`) wird mit
    jeder Vorhersage geladen, unabhängig von der Wahl (Fetch-Set der Registry, REQ-596).
- Export und Import (REQ-429, REQ-469): zwei Symbolknöpfe in der Titelzeile der Einstellungen zwischen Titel und
  Schließen (`Dialog`-Prop `tools`, `dialogs/settings/TransferSettings.tsx`), Name und Tooltip übersetzt
  („Einstellungen exportieren“/„Einstellungen importieren“; der Tooltip des Imports sagt, dass er die Favoriten
  ersetzt). Die Erfolgsmeldung des Imports steht oben im Dialog, eine Ablehnung als
  Fehlerkarte (REQ-492). Export lädt `graupel-settings-<Datum>.json` herunter, Import
  liest eine solche Datei (`state/settingsFile.ts`). Format: `{ "format": "graupel-settings", "version": 1, "exported": "<ISO-Zeit>",
  "settings": { "language": "de" | … | null, "colorMode": "system" | "light" | "dark", "showWeatherChain": true | false | null, "showCloudChain": true | false | null, "map": "opentopomap" | "maptoolkit" | null, "startLocation": "gps" | { name, lat, lon, elevation? } | null, "modelHeaders": true | false | null, "daySlider": true | false | null, "days": 1 … | "all" | null, "dewPoint": "auto" | "on" | "off" }, "favorites": [{ name, lat, lon, elevation?, mapPoint? }] }` (`mapPoint: true`: auf der Karte gewählter, umbenennbarer Favorit, REQ-489; sein Name steht auch in der Fußzeile des Meteogramms, REQ-535; `name: ""`: Punkt ohne Namen, angezeigt mit Koordinaten, REQ-536). Der Import prüft die
  ganze Datei, bevor er etwas ändert; keine Graupel-Datei, neuere Version oder ungültige Werte werden mit übersetzter
  Meldung abgelehnt. Fehlende Felder bleiben unverändert, unbekannte Einstellungen werden übersprungen; neue
  Einstellungen kommen als optionales Feld in `settings` dazu, die Version steigt nur bei inkompatiblen Änderungen.
  Favoriten ersetzt `replaceFavorites` (speichert und meldet die Liste an `useFavorites`).
- Favicon und Logo (REQ-424): die Graupel-Wolke aus `scripts/graupel-cloud.svg` (eigenes Werk,
  GPL-3.0-or-later). `node scripts/generate-icons.mjs` erzeugt einmalig mit dem Chromium von Playwright (Pfad über
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`) `public/favicon.svg` und `public/icons/`; die Dateien sind committet. Favicon und
  App-Symbole zeigen die Wolke auf deckendem Hellblau `#dbe8f5` (REQ-516, zugleich `background_color` im Manifest),
  auf dem ihr dunkler Umriss gut sichtbar ist: `favicon.svg` (abgerundetes Rechteck, dahinter eingebettetes PNG
  128 px) und `favicon-32.png` als abgerundetes Quadrat, `apple-touch-icon.png` 180 px randlos (iOS rundet selbst
  ab, Wolke 72 % breit), `icon-192.png`/`icon-512.png` (`purpose: any`) als abgerundetes Quadrat,
  `icon-192-maskable.png`/`icon-512-maskable.png` (`purpose: maskable`) randlos mit der Wolke (60 % breit) im
  sicheren Kreis von 80 % Durchmesser. Nur `logo-192.png` (Logo im Info-Popup) bleibt durchsichtig.
  `test/icons.test.ts` prüft Größen, Deckkraft, Hintergrund, sichere Zone, Manifest und Favicon. Das Logo
  steht nur im Info-Popup, Tab About (`dialogs/info/AboutPanel.tsx`: Logo, Name, Beschreibung, Version aus
  `package.json` über `src/version.ts`, Quellcode, Open-Meteo mit CC BY 4.0 und dem Hinweis, dass die Daten
  vereinheitlicht und zu einer Zeitachse zusammengesetzt wurden (REQ-478), beide Kartenanbieter (OpenTopoMap und Maptoolkit, unabhängig von der Wahl, REQ-517) mit
  © OpenStreetMap contributors, Lizenz mit Link auf `LICENSE` und dem Knopf „Lizenzen Dritter“).
- Lizenzen Dritter als Popup (REQ-514): Der Knopf im Tab About öffnet über dem Info-Popup einen zweiten `Dialog`
  (`dialogs/info/ThirdPartyDialog.tsx`, per `React.lazy` ein eigener kleiner Chunk). Er lädt erst dann
  `THIRD_PARTY_LICENSES.md` neben `index.html` per `fetch` (`loadNotice`; HTTP-Fehler und eine HTML-Seite statt der
  Datei gelten als Fehler, Meldung `info.about.thirdPartyError`) und zeigt sie lesbar an. `dialogs/info/markdown.ts`
  ist ein kleiner Parser genau für das, was `scripts/third-party.mjs` schreibt (Überschriften, Absätze, `-`-Listen,
  Tabellen, Codeblöcke, Inline-Code, Fett, Links; HTML-Kommentare entfallen); `MarkdownView` rendert das Ergebnis als
  React-Elemente, nichts aus der Datei wird als HTML eingefügt, Links nur mit `http(s):`/`mailto:`. Die Datei bleibt
  englisch und ist weiter direkt abrufbar; `LICENSE` (Klartext) bleibt ein Link. Escape oder Schließen kehrt zum Tab
  About zurück, der Fokus geht auf den Knopf. Im Dev-Server liefert `licenseDevPlugin` (`vite.config.ts`) die Datei.
- Impressum (REQ-430, DEC-023): `dialogs/info/ImprintPanel.tsx` zeigt `legal.imprint` der Domain mit Texten unter
  `info.imprint.*`: Betreiber mit Name und Adresse oder sonst Wohnort (und E-Mail, wenn gesetzt), ohne Namen der
  Hinweis, dass die Angaben beim Hosting-Anbieter liegen; mit `hoster` den Hosting-Anbieter (`imprintHoster()`, bei
  `true` der Anbieter aus `legal.hosting` nach `HOSTERS`, ohne das Feld GitHub) mit Adresse und Telefon. Angaben als
  Objekt bleiben auf jedem Ziel gleich; so zeigt .fr ALL-INKL auch in der Vorschau (DEC-086). `test/imprint.test.tsx` und `e2e/imprint.spec.ts` prüfen jede Domain.
- Datenschutzerklärung (REQ-432): `dialogs/info/PrivacyPanel.tsx` mit Texten unter `privacy.*` in allen acht
  Sprachen; sprachunabhängige Angaben (Stand `PRIVACY_UPDATED`, Links, Abschnitt je Hoster in `HOSTING` und je
  Kartenanbieter) in `dialogs/info/privacy.ts`. Der Abschnitt Hosting nennt den Anbieter aus `legal.hosting`
  (REQ-710: `github-pages` mit den Absätzen zur Übermittlung in die USA, oder `all-inkl` mit Servern in Deutschland;
  ohne das Feld `github-pages`); danach richtet sich auch der Satz zur Übermittlung im Hinweis für die Schweiz. Der Abschnitt Karte nennt immer beide Anbieter (OpenTopoMap und Maptoolkit) mit dem Hinweis, dass die Wahl in den
  Einstellungen entscheidet (REQ-493); der Verantwortliche kommt
  aus `legal.privacy.controller` (nur Name und E-Mail, ohne Adresse; für Domains mit anonymem Impressum wie .fr,
  DEC-028; das Impressum bleibt unverändert), sonst aus `legal.imprint` (Name, Adresse oder Wohnort, E-Mail); ohne
  beides steht ein Verweis auf das Impressum und mit `hoster` die Adresse des Hosting-Anbieters (`imprintHoster()`,
  dieselbe Quelle wie im Impressum). Den Hinweis für die Schweiz (revDSG, EDÖB) zeigt nur
  `legal.privacy.swissNotice: true` (Standard `false`, gesetzt nur auf .ch, DEC-029). Wer Texte ändert,
  setzt `PRIVACY_UPDATED` neu. **Vor dem Veröffentlichen prüfen** (Quellen im Kopfkommentar von `privacy.ts`, Stand
  26.10.2026, ALL-INKL 10.11.2026): ALL-INKL-Datenschutzinformationen (<https://all-inkl.com/en/privacy-policy>,
  Löschfrist der Server-Logs) und Impressum (<https://all-inkl.com/en/legal-notice>), GitHub auf der DPF-Liste
  (<https://www.dataprivacyframework.gov/list>, Status „Active“), GitHub-Datenschutzerklärung
  (<https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement>), Open-Meteo
  (<https://open-meteo.com/en/terms>), Maptoolkit (<https://www.maptoolkit.org/privacy>) und OpenTopoMap
  (<https://opentopomap.org/about>).
- `src/regions/Header/`: Sprachauswahl (`components/LanguageSelect.tsx`, Sprachen aus `config.languages`, bei nur
  einer Sprache samt Globus ausgeblendet), Knöpfe Einstellungen und Info, Download-Knopf nur mit `showDownload` (Klick ruft
  `onDownload`). Einstellungen, Info und Download zeigen nur ihr Symbol (Name als Tooltip); Download steht hervorgehoben
  rechts neben Info in derselben Zeile, auch auf Telefonen (REQ-501). Der Globus steht links im Sprachfeld (eigener
  Pfeil rechts, `appearance: none`), das Feld ist so hoch wie die Knöpfe (2.5rem); die Mitte des Globus liegt dort, wo
  der GPS-Knopf im Suchfeld seine Mitte hat, auf Telefonen steht er also genau darüber (REQ-526). Symbole als Inline-SVG in `src/icons/`.
- `src/state/`: Website oder installierte App (REQ-425). `useAppMode()` liefert `"website"` oder `"installed"`
  (`display-mode: standalone` oder `window-controls-overlay`, auf iOS `navigator.standalone`) und folgt Wechseln;
  spätere App-Funktionen verzweigen darauf. `installPromptStore` hält ab dem Laden des Moduls (vor `config.json`)
  das Ereignis `beforeinstallprompt`; `useInstallAvailability()` liefert `"prompt"` (Chromium bietet die
  Installation an), `"manual"` (Browser ohne Installationsabfrage: Safari, Firefox) oder `"none"` (Chromium ohne
  Angebot, also schon installiert oder nicht installierbar, oder nach `appinstalled`). `HeaderContainer` (in
  `App.tsx`) zeigt den Download-Knopf nur auf der Website und nicht bei `"none"`: mit Abfrage ruft er `prompt()`,
  sonst öffnet er `InstallDialog` mit der Anleitung für die erkannte Plattform (iOS, Android, Safari auf dem Mac,
  andere).
- `public/manifest.webmanifest`: Web-App-Manifest (Name, `start_url` und `scope` `./`, `display: standalone`,
  `theme_color` aus den Tokens, `background_color` `#dbe8f5` wie der Grund der Symbole). Die Symbole
  `icons/icon-192.png` und `icons/icon-512.png` (`any`) sowie ihre `maskable`-Fassungen kommen mit dem Logo (REQ-424,
  REQ-516); ohne sie ist die Seite nicht installierbar. Chromium verlangt keinen Service Worker mehr; Offline-Betrieb folgt
  mit den App-Funktionen.
- Tests: `test/setup.ts` ergänzt jsdom um `showModal`/`close` für `<dialog>`.
- `src/styles/tokens.css`: Design-Tokens als CSS-Variablen, hell und dunkel (System über
  `prefers-color-scheme`, fest über `data-theme="light|dark"` am `<html>`). `src/styles/global.css`: Grundstil.
- Responsiv über Container-Queries (`.app` ist der Container) und Media-Queries, Umbruch ab 48rem. Ab 64rem
  (Desktop, REQ-465) ist der Rand zwischen Karten und Fensterrand halb so groß wie zuvor: 0,5rem plus ein Viertel
  der Breite über 80rem (statt 1rem und der Hälfte bei höchstens 80rem Seitenbreite).


## Lizenz (REQ-431, DEC-024)

Code: GPL-3.0-or-later (`LICENSE`), Copyright 2026 Bastian Schnitzler; jede Quelldatei trägt die SPDX-Header
`SPDX-FileCopyrightText` und `SPDX-License-Identifier: GPL-3.0-or-later` (`test/license.test.ts` prüft das). Logo
und Favicon stammen aus `scripts/graupel-cloud.svg` (eigenes Werk, GPL-3.0-or-later). Gebündelt sind außerdem die Workspace-Pakete (MPL-2.0) und Daten aus `@graupel/model-data`
(CC BY 4.0 für aus Open-Meteo abgeleitete Dateien, sonst MPL-2.0); die Texte liegen in `LICENSES/`.

`THIRD_PARTY_LICENSES.md` erzeugt `pnpm licenses` (`scripts/third-party.mjs`): Herkunft von Code und Logo,
Workspace-Pakete, genutzte Dienste (Open-Meteo, OpenTopoMap, Maptoolkit, GitHub Pages) und jedes gebündelte
npm-Paket mit Lizenztext, bei MapLibre auch die laut Source Map eingebauten Pakete. Alle Lizenzen sind mit der GPL
vereinbar (MIT, ISC, BSD-2/3-Clause, 0BSD, MIT OR Apache-2.0; MPL-2.0 als Secondary License). Der Build
(`licensePlugin` in `vite.config.ts`) bricht ab, wenn er andere npm-Pakete bündelt als `SHIPPED` nennt, und legt
`LICENSE`, `LICENSES/` und `THIRD_PARTY_LICENSES.md` neben `index.html`; `pnpm package` verlangt sie im Archiv. Ein
Test prüft, dass die eingecheckte Datei aktuell ist. Sichtbar nennt die Seite die Lizenzen im Info-Popup (About; die
Lizenzen Dritter als eigenes Popup, REQ-514),
Open-Meteo unter dem Meteogramm (nur „Weather data by Open-Meteo.com“) und die Kartenanbieter auf der Karte.

## Kartendaten und Kennung bei Maptoolkit (REQ-698, REQ-699)

Für die Kartendaten der Maptoolkit-Karte gilt die **Maptoolkit-Community-Lizenz**
(<https://www.maptoolkit.org/tos>), für die OpenStreetMap-Daten darin die ODbL. Gebunden ist immer, wer eine App
betreibt oder veröffentlicht. Ein Fork ist ein eigenständiger Nutzer und hält sich selbst an diese Bedingungen
(Berechtigung, Attribution, Grenzen für Anfragen).

Maptoolkit erkennt Anwendungen am Referer (dazu User-Agent und IP), nicht an einem URL-Parameter (Bedingungen § 9).
Die Website schickt deshalb ihre Domain mit (graupel.eu, graupel.at, graupel.ch, graupel.fr, graupel.it): Der
Browser setzt sie bei jeder Kartenanfrage als `Origin`, und `index.html` legt mit
`<meta name="referrer" content="strict-origin-when-cross-origin">` fest, dass auch der `Referer` nur die Domain
enthält, ohne Pfad, Parameter oder Ort. Für jede Anfrage an `*.maptoolkit.org` setzt `maptoolkitRequest`
(`src/regions/LocationPicker/map/maptoolkitStyle.ts`, als `transformRequest` der MapLibre-Karte) dieselbe Policy.
`test/maptoolkitIdentification.test.ts` und `e2e/maptoolkit-identification.spec.ts` prüfen das; der e2e-Test liefert
die Seite unter jeder Domain aus und liest die Header, die der Browser an Maptoolkit schickt.

**Forks:** Bitte eine eigene Kennung verwenden: eine eigene Domain, bei einer anderen Art App einen eigenen
User-Agent bzw. einen eigenen Token. So kann Maptoolkit einen Fork, der die Regeln bricht, gezielt drosseln, ohne
graupel zu treffen. Eine Website unter eigener Domain braucht dafür keine Änderung im Code; sie schickt ihre eigene
Domain mit. Wer die Seite anders ausliefert (ohne eigene Domain, als App mit eigener Webview), setzt in
`maptoolkitRequest` eine eigene Kennung und registriert sie bei Maptoolkit.

## Ortsauswahl (REQ-433)

`src/regions/LocationPicker/`: Eingabefeld mit Vorschlägen (Combobox, Pfeiltasten, Enter, Escape; Suche 300 ms nach
der letzten Eingabe), Knopf „Aktueller Standort“ (Browser-Geolocation nur auf Knopfdruck, DEC-021; Fehler wie
verweigerte Erlaubnis übersetzt als Fehlerkarte unten links, REQ-492), Knopf „Karte“ und Stern für den Favoriten; darunter Höhe und Koordinaten. Auf Telefonen (Container `app` unter
48rem, REQ-527) ohne sichtbare Beschriftungen „Höhe“ und „Koordinaten“ (nur für Screenreader) in einer Zeile: Höhe
links, Koordinaten rechtsbündig; auf breiten Bildschirmen mit Beschriftung nebeneinander. Fehlt die
Höhe eines Orts (GPS, Kartenpunkt, manche Suchtreffer), holt sie die Elevation-API und ergänzt den Ort.

- Verweigerter Standort (REQ-509, `locationHint.ts`): Die Karte sagt „Der Zugriff auf den Standort wurde
  verweigert.“ und darunter, wo dieser Browser ihn wieder erlaubt. `detectBrowser(navigator)` liest `userAgent`,
  `maxTouchPoints` (iPad mit Mac-Kennung) und `userAgentData` (Plattform, Marken); die iOS-Version kommt aus `OS 17_4`
  bzw. Safaris `Version/` (iOS 26 friert `OS 18_6` ein). `locationHint(info)` wählt den Schlüssel
  `location.gps.hint.*`:
  - `iosSafari` (iOS ≥ 18: Einstellungen › Apps › Safari › Standort; Ortungsdienste › „Safari-Websites“),
    `iosSafariLegacy` (bis iOS 17: Einstellungen › Safari › Standort);
  - `iosApp` / `iosAppLegacy` mit `{app}` für Chrome, Firefox, Edge, Opera auf iOS (alle WebKit, daher die
    iOS-Einstellung der App: Einstellungen › [Apps ›] {app} › Standort „Beim Verwenden der App“); `ios` für
    unbekannte iOS-Browser (In-App-Browser): Datenschutz & Sicherheit › Ortungsdienste;
  - `androidChrome` (⋮ › Einstellungen › Website-Einstellungen › Standort), `androidSamsung` (Menü ☰ ›
    Einstellungen, Website-Berechtigungen), `androidFirefox` (Schloss links der Adresse), `android` (Edge, WebView,
    andere), jeweils mit dem Hinweis auf den Android-Standort;
  - `chromium` (Chrome, Edge, Opera, Brave am Desktop: Symbol der Website-Informationen links der Adresse ›
    Standort, neu laden), `firefox` (durchgestrichenes Standort-Symbol, Sperre mit ✕ aufheben), `safariMac`
    (Safari › Einstellungen … › Websites › Standort; Systemeinstellungen › Datenschutz & Sicherheit ›
    Ortungsdienste), `generic` (Browser-Einstellungen).
  Menünamen in de/en nach den aktuellen Systemen; in den übrigen Sprachen nur die sicheren oberen Ebenen
  (Einstellungen › Apps › Safari, Datenschutz & Sicherheit), der Rest beschrieben. Tests ersetzen den Hinweis über
  `services.locationHint`. Nicht verfügbar, Zeitüberschreitung und kein GPS bleiben ohne Hinweis.

- Favoriten: zuerst `favorites.presets` der Konfiguration; sobald der Nutzer markiert oder entfernt, gilt seine Liste
  in `localStorage` (`graupel.favorites`). `favorites.enabled: false` blendet Stern und Liste aus.
- Kartenpunkt ohne Namen (REQ-536): Ein auf der Karte gewählter Punkt, der kein benannter Ort ist (`pointPlace`), hat
  keinen festen Namen, sondern den leeren Namen. Angezeigt wird ein Ort überall gleich (`placeLabel` in
  `state/placeLabel.ts`): der Name eines umbenannten Kartenpunkt-Favoriten an seinen Koordinaten (Alias, REQ-489),
  sonst sein eigener Name, sonst seine Koordinaten wie in der Koordinatenzeile, in der aktiven Sprache formatiert
  (z. B. „46,9263° N · 10,9261° O“; ein Sprachwechsel formatiert sie neu). Das gilt für Suchfeld, Favoritenmenü (auch
  Stern- und Stift-Beschriftung), Startort in den Einstellungen und die Fußzeile des Meteogramms, die so
  „<Koordinaten>, 3158 m (Datum)“ zeigt (Name und, wenn die Prognose keine hat, die nachgeladene Höhe kommen vom
  gewählten Ort, nicht aus der Prognose bzw. ihrem Cache).
  Früher gespeicherte Orte mit dem allgemeinen Kartenpunkt-Namen einer der acht Sprachen („Point on the map“,
  „Punkt auf der Karte“, „Point sur la carte“, …, `LEGACY_MAP_POINT_NAMES` in `state/place.ts`) gelten als namenlos:
  `ownName` liefert für sie nichts, `toPlace` macht ihren Namen beim Lesen (Favoriten, Startort, Import) leer. Der
  Name geht nicht in den Schlüssel der Prognose ein; ein Wechsel der Anzeige lädt nichts neu.
- Favorit umbenennen (REQ-489): Ein auf der Karte gewählter Punkt ohne Namen wird beim Markieren mit
  `mapPoint: true` gespeichert; ältere Favoriten ohne eigenen Namen gelten ebenso als Kartenpunkt
  (`isMapPointFavorite` in `state/favorites.ts`). Nur solche Einträge haben im Favoritenmenü
  rechts einen Stift (`menuitem` „<Name> umbenennen“; Pfeil rechts erreicht ihn, Pfeil links führt zurück, F2 auf dem
  Eintrag benennt direkt um). Die Hervorhebung folgt dem Fokus, und der Zeiger zieht den Fokus mit: über einem Eintrag
  auf diesen, über einem Stift auf den Stift; so bleibt kein anderer Eintrag hervorgehoben (REQ-508), solange kein
  Name getippt wird. Der Stift ersetzt die Beschriftung durch ein Textfeld: Enter oder Verlassen speichert,
  Escape bricht ab, ein leerer Name wird nicht übernommen; ein Punkt ohne Namen beginnt mit leerem Feld. Der Name wird mit dem Favoriten gespeichert (und
  exportiert) und immer angezeigt, wenn der gewählte Ort dieselben Koordinaten hat (auf vier Nachkommastellen,
  `favoriteName`), also auch nach Wahl aus dem Menü, und dann allein (ohne Koordinaten). Der Ort selbst bleibt dabei
  ohne Namen; wird der Favorit entfernt, zeigt das Feld wieder die Koordinaten.
- Karte (`MapDialog`, Vollbild wie in der Desktop-App, REQ-475): Karte über die ganze Fläche, Zoom oben rechts,
  Abbrechen und OK unten rechts, keine Kopfzeile. `map: "opentopomap"` zeigt OpenTopoMap-Kacheln mit Leaflet,
  `map: "maptoolkit"` die Maptoolkit-Wanderkarte mit MapLibre (Logo unten links). Mit beiden setzt ein Klick den
  Ortsmarker (OK übernimmt), ein Doppelklick übernimmt sofort, ohne zu zoomen (REQ-476); bei Maptoolkit leuchten
  Ortsnamen unter der Maus auf und lassen sich anklicken. Die Maptoolkit-Karte ist immer nach Norden ausgerichtet
  (REQ-511): Drehen und Kippen sind gesperrt (Maus, Touch, Tastatur; `dragRotate`, `pitchWithRotate`, `touchPitch`
  aus, `maxPitch: 0`, `touchZoomRotate`/`keyboard.disableRotation()`, Zoomen per Pinch bleibt), die Navigation zeigt
  nur Zoom, keinen Kompass/Nordknopf. Die Vollbildkarte hat keine Scrollleisten (REQ-512): Sie ist genau so groß wie
  der Viewport (`position: fixed`, `inset: 0`, `100dvh`, ohne Rand und Innenabstand, Inhalt abgeschnitten), und
  solange sie offen ist, sperrt die Klasse `map-dialog-open` an `<html>` das Scrollen der Seite dahinter; beim
  Schließen bleibt die Scrollposition erhalten. Der Hinweis von OpenTopoMap nennt nur OpenStreetMap und
  OpenTopoMap, Leaflet nur auf dem Desktop; SRTM und Leaflet stehen unter About (REQ-474). Leaflet und MapLibre liegen in eigenen Chunks und werden erst
  beim Öffnen geladen; der Maptoolkit-Stil lädt beim ersten Öffnen parallel zur Bibliothek (REQ-771). Die
  Fehlerkarte „Die Karte konnte nicht geladen werden“ kommt nur, wenn die Karte wirklich nicht lädt (REQ-771,
  `map/loadWatch.ts`): Kartenmodul oder Maptoolkit-Stil nicht ladbar, kein WebGL, bei OpenTopoMap alle ersten Kacheln
  fehlgeschlagen, oder nach 20 s noch nicht geladen. Einzelne Kacheln, Glyphen oder Sprites, die fehlschlagen, zeigen
  keine Karte; lädt die Karte nach der Fehlerkarte doch, verschwindet diese. Den Anbieter kann der Nutzer im Abschnitt „Karte“ der Einstellungen wählen (REQ-467,
  `state/mapProvider.ts`, `dialogs/settings/MapProviderSettings.tsx`); die Wahl liegt in `localStorage`
  (`graupel.map`) und geht in Export und Import (`settings.map`). Ohne eigene Wahl gilt `map` aus der Konfiguration.
  `useMapProvider()` liefert den wirksamen Anbieter für Kartenauswahl und Datenschutz; About nennt immer beide
  Anbieter mit Links (REQ-517), die Karte selbst zeigt die Attribution ihres Anbieters.
- Tests ersetzen Suche, Höhe und Geolocation über `services` von `LocationPicker`.
- Die Stile von `MapDialog` liegen in `MapDialog.css`.

## Modellkette (REQ-435)

### Auswahl der Kette (`src/state/chain.ts`)

`ChainProvider` (in `App.tsx` innerhalb von `LocationProvider`, über `ForecastProvider`) lädt beim Start die
Modelldaten und hält die gewählte Kette, auch wenn der Block per `modelChain: false` ausgeblendet ist. `useChainSelection()` liefert (stabile
Schnittstelle, auch für das Meteogramm):

| Feld | Bedeutung |
|---|---|
| `mode` | `"auto"`: Auto-Kette des gewählten Orts; `"manual"`: mit `setChain` gesetzte Kette (auf der Website die Auto-Kette mit vom Nutzer verschobenen Grenzen) |
| `chain` | Katalog-IDs der Wetterkette in Übergabe-Reihenfolge (leer, solange die Daten laden) |
| `cloudChain` | Katalog-IDs der Wolkenkette; `undefined`, wenn sie abgeschaltet ist |
| `models`, `cloudModels` | dieselben Ketten als `WeatherModel[]` von `@graupel/download` mit dem Ende jedes Abschnitts in Stunden ab jetzt (`max_forecast_horizon_hours`, im Auto-Modus die Katalog-Horizonte); so an `downloadChain` übergeben (`chain: models`, `cloudChain: cloudModels.length ? cloudModels : null`) |
| `resolved` | Ergebnis des Resolvers für den Ort (`region_id`, `region_name`, `resolution_reason`, Ketten), auch im manuellen Modus; `null` bis geladen |
| `status` | `"loading"`, `"ready"` oder `"error"` (Regionen nicht ladbar); eine manuelle Kette geht schon vorher (gebündelter Katalog) |
| `available` | Katalogmodelle nach ID (aktive Modelle, Katalog-Horizont) als `ModelMeta` (`WeatherModel` mit den https-Links `documentation_url` und `provider_url` des Katalogs, wo vorhanden; REQ-687) |
| `data` | geladene Modelldaten (`catalogue`, `registry`, `domains`, `regions`) oder `null` |
| `setChain(chain, cloudChain?)` | wechselt auf `manual`; Einträge sind Katalog-IDs oder Modelle mit eigenem Horizont, unbekannte fallen weg; `cloudChain` weggelassen behält die aktuelle Wolkenkette (aus dem Auto-Modus die Auto-Wolkenkette, die dem Ort folgt), `null` schaltet sie ab |
| `setAuto()` | zurück zur Auto-Kette |

Außerhalb eines Providers liefert `useChainSelection()` eine leere Auswahl mit `status: "loading"`,
`useOptionalChainSelection()` dagegen `null`. Die manuelle Kette wird nicht gespeichert. Ein neu geladener Ort (auch
derselbe noch einmal gewählt) setzt sie zurück auf die Auto-Kette (REQ-481, `isNewPlace(previous, next)`); nur die
später nachgeladene Höhe desselben Orts lässt sie stehen.

### Modelldaten (`src/services/modelData.ts`)

Katalog, Größen und Domains aus `@graupel/model-data` sind als JSON gebündelt; `regions.geojson` (gut 0,5 MB) liegt
als Asset neben der Seite (`?url`-Import, `REGIONS_URL`) und wird beim Start per `fetch` geladen und mit
`JSON.parse` gelesen (kein JSON-Modul). `loadModelData()` lädt einmal je Seite (nach einem Fehler erneut) und
liefert alle vier Dokumente für Resolver und `downloadChain`; `fetchRegions(fetch, url)` nimmt ein eigenes `fetch`,
`resetModelData()` vergisst die Regionen (Tests). Der Resolver ist `createResolver` von `@graupel/download`.

### Karten (`src/regions/ModelChain/`)

Texte übersetzt (`modelChain.*`), Stile in `ModelChain.css`:

- Zwei eigene Karten (REQ-482), „Wetter“ und „Wolken“ (senkrechte Beschriftung links), so breit wie die anderen
  Karten, zwischen Ort und Meteogramm; auf Telefonen (Container-Query `app` bis 40rem, REQ-529) ohne Karte und ohne
  die Beschriftungen, die Modellkarten stehen als Streifen mit runden Enden auf der Seite (`ModelChain.tsx`, je Kette `chain/ModelChainRow.tsx`; Hülle
  `section[data-region="model-chain"]` mit dem Namen „Modellkette“). Kein Titel, keine Herkunft der Kette, kein
  Hinweis, kein Einklappen. Solange die Modelldaten laden, steht dort eine Karte mit der
  Meldung; bei einem Fehler bleibt sie leer und die Meldung kommt als Fehlerkarte (REQ-492). Die Breite jedes Modells folgt seinen Stunden (`chain/modelChainLayout.ts`, ein Modell mit 0 h behält ein
  Drittel der Grundbreite). Info-Knopf (`chain/ModelInfo.tsx`, REQ-687): oben „Name (Anbieter, Gebiet)“; der Name
  verlinkt auf `documentation_url`, der Anbieter auf `provider_url` des Katalogs, je in neuem Tab mit
  `rel="noopener noreferrer"`, ohne https-URL (ältere Kataloge) nur Text. Darunter die Eigenschaften: Gitterweite und
  „Max (ab jetzt)“ (verbleibende Stunden ab jetzt / Katalog-Horizont, aus `ForecastResult.availability`; ohne
  geladene Vorhersage die Vorhersagedauer des Katalogs), kein Zeitschritt. Darunter Hauptlauf und Ensemble-Lauf je
  für sich, darunter die Erklärung zu „Max (ab jetzt)“ (`chain/modelRuns.ts`);
  Zeiten in der Zeitzone des Geräts (`resolvedOptions().timeZone`), ist sie nicht bestimmbar, in der des Standardorts
  der Domain (`timeZone` der config.json, `runTimeZone`, REQ-733). Der Laufzeitpunkt im Modellkopf bleibt UTC mit „Z“
  (REQ-682).
- Ein- und ausblenden (REQ-445, REQ-471, REQ-503, `src/state/modelChainView.ts`): Im Abschnitt „Modellkette“ der
  Einstellungen (`dialogs/settings/ModelChainSettings.tsx`) stehen zwei Schalter, „Wetterkette anzeigen“ und
  „Wolkenkette anzeigen“; jeder blendet nur seine Karte ein und aus. Sind beide aus, hat die Seite keine Karte für die
  Modellkette, auch keinen leeren Rahmen; ist nur eine an, steht nur diese Karte zwischen Ort und Meteogramm. Jede
  Wahl ist eine eigene `storedChoice` (`weatherChainChoice` unter `graupel.showWeatherChain`, `cloudChainChoice` unter
  `graupel.showCloudChain`, `true`/`false`) und geht in Export und Import (`settings.showWeatherChain`,
  `settings.showCloudChain`, `null`: keine eigene Wahl); ohne eigene Wahl gilt `showWeatherChain` bzw.
  `showCloudChain` der config.json (Standard: beide aus). `useChainCardsVisible()` liefert den wirksamen Stand
  (`effectiveChainCards`; mit `modelChain: false` beide aus). Ausblenden ist nur Anzeige: Beide Ketten werden weiter
  geladen, die Wolkenkette liefert weiter die Wolken des Meteogramms.
  Übergang vom früheren einen Schalter: `migrateModelChainChoice()` (in `main.tsx`) übernimmt ein gespeichertes
  `graupel.showModelChain` für beide Schalter, sofern sie noch keine eigene Wahl haben, und löscht den alten Schlüssel;
  eine ältere Exportdatei mit `settings.showModelChain` setzt beim Import beide Schalter (getrennte Felder derselben
  Datei gehen vor).
- Nicht bearbeitbar (REQ-480): Die Website hat keinen Bearbeitungsmodus, kein Hinzufügen oder Entfernen von Modellen
  und keine Karte der Modellgebiete. Eine spätere PWA kann `setChain` von `useChainSelection()` nutzen.
- Grenzen verschieben (REQ-481) wie in der Desktop-App: Die Grenze zwischen zwei Modellen (`chain/ModelBoundaryHandle.tsx`,
  `role="slider"` mit dem Namen „Grenze zwischen A und B“, Wert = Stunde, ab der B übernimmt) lässt sich mit Maus,
  Stift oder Finger ziehen (Pointer-Events, `touch-action: none`, auf Touch-Geräten breiterer Griff) und mit den
  Tasten verschieben: Pfeile 1 h, mit Umschalt oder Bild auf/ab 12 h, Pos1/Ende an die Grenzen. Während des
  Verschiebens folgen die Karten sofort (`chain/useModelChainLayout.ts`); die Kette geht erst beim Loslassen
  (Zeiger, Taste, Fokusverlust) einmal an `setChain`. Das Meteogramm folgt schon während des Ziehens wie in der
  Desktop-App (REQ-504): bei jedem Stundenschritt geht die gezogene Kette (höchstens einmal je Frame,
  `requestAnimationFrame`) als `onPreview` an `setPreview` von `useForecast()`, die Vorhersage wird aus den Antworten
  im Speicher neu zusammengesetzt, ohne Anfrage, und das Diagramm bekommt nur neue Daten (kein neues Diagramm, der
  Schlüssel des Diagramms ist Ort und Zeitraum). Beim Loslassen endet die Vorschau. Die Tasten übergeben jeden
  Schritt ohnehin. Mit geladener Vorhersage steht jede Grenze dort, wo der letzte Lauf des Modells endet, und lässt
  sich höchstens bis dahin schieben; unverschobene Grenzen behalten ihren angeforderten Horizont
  (`chain/chainBoundaries.ts`: `displayedChain`, `boundaryLimits`, `mergeMovedChain`). Wetter- und Wolkenkette werden getrennt verschoben. Ein neu geladener Ort setzt die
  Verschiebungen zurück (siehe oben); gespeichert werden sie nicht.
- Grenze zurücksetzen (REQ-498): Ein Doppelklick auf eine Grenze, auf Telefonen ein Doppeltippen (zwei Tipps mit
  Finger oder Stift binnen 300 ms auf derselben Grenze, ohne sie zu verschieben, `DOUBLE_TAP_MS` in
  `chain/useModelChainLayout.ts`), setzt nur diese Grenze auf ihre Stelle in der Auto-Kette des Orts zurück
  (`resetBoundary(requested, auto, index)` in `chain/chainBoundaries.ts`); andere verschobene Grenzen bleiben, das
  Meteogramm lädt die Kette neu. Ist danach keine Grenze mehr verschoben, gilt wieder der Auto-Modus (`setAuto`).
  Der Tooltip der Grenze (`modelChain.boundaryHint`) nennt den Doppelklick.
- Zeitraum der Karten (REQ-448): der Zeitraum der gelieferten Daten, `deliveredSpans(result, "main" | "cloud")` aus
  `src/state/chain.ts`: je Modell erste bis letzte Stunde ab jetzt, in der das Ergebnis von `useForecast()` einen
  Wert dieses Modells hat (`combined` bzw. die Wolkenprofile mit Bedeckung); ein Modell ohne Daten zeigt „Keine
  Daten“. Solange geladen wird, ohne Daten und während eine Grenze verschoben wird, der geplante Abschnitt der Kette
  (`data-span` an der Plakette: `delivered`, `planned` oder `none`).
- Farben (REQ-443, `src/state/chainColors.ts`): die Modelle jeder Kette in den Tönen ihrer Kette, von links nach
  rechts verblassend (siehe „Farben der Modellkette“).
- Abschaltbar mit `modelChain: false` (der Platz `modelChain` bleibt dann leer, die Einstellungen haben keinen
  Abschnitt dafür; `showWeatherChain` und `showCloudChain` gelten dann nicht).
- Nicht übernommen: Ziehen ganzer Karten zum Umordnen, Hinzufügen und Entfernen von Modellen, Einklappen, die
  Hinweise auf fehlende Größen und die Lauf-Informationen im Info-Popup.
- Tests: `test/modelChainLayout.test.ts`, `test/modelChainUtils.test.ts` (Metadaten und Grenzlogik),
  `test/modelChainRow.test.tsx` (Karte einer Kette, Ziehen und Tasten), `test/modelChain.test.tsx` (Resolver mit
  den echten Modelldaten, alle Fälle aus `resolver_cases.json`, Zurücksetzen bei neuem Ort, Karten, Einstellungen,
  getrennte Schalter, config.json, Übernahme des alten Schalters) und `e2e/model-chain.spec.ts` (zwei Karten zwischen
  Ort und Meteogramm, je nur Wetter- oder nur Wolkenkette, Ziehen mit Maus, Finger und Tasten mit Modellköpfen des
  Meteogramms, Zurücksetzen, 375 px).

### Farben der Modellkette (REQ-443)

`chainShades(count, kind, theme)` verteilt `count` Töne gleichmäßig über eine HSL-Rampe je Kette (`main`: Wetter,
`cloud`: Wolken) und Farbmodus (`CHAIN_RAMPS`): das erste Modell bekommt den kräftigsten Ton, das letzte den
blassesten. Im hellen Modus verblassen die Töne zu Weiß hin, im dunklen zur dunklen Fläche hin. Jeder Ton hat eine
Schriftfarbe (`TEXT_DARK` Schwarz oder `TEXT_LIGHT` Weiß, die mit dem höheren Kontrast; mindestens 4,5:1).

| Kette, Modus | erstes Modell | letztes Modell |
|---|---|---|
| Wetter, hell | `hsl(24 95% 48%)` = `#ef6306` | `hsl(34 92% 80%)` = `#fbd29d` |
| Wetter, dunkel | `hsl(26 92% 54%)` = `#f67b1e` | `hsl(30 48% 30%)` = `#714d28` |
| Wolken, hell | `hsl(271 76% 50%)` = `#831fe0` | `hsl(268 80% 86%)` = `#d9bff8` |
| Wolken, dunkel | `hsl(270 80% 64%)` = `#a35aed` | `hsl(268 36% 32%)` = `#50346f` |

Die Karte nimmt den Ton für den oberen Rand und als Hintergrund der Stunden-Plakette (`data-chain-color`).
`useChainShades(count, kind)` folgt dem Farbmodus der Seite; `useModelHeaderColors()` gibt dem Meteogramm die Töne
der Wetterkette je Katalog-ID (sonst Name) als `modelHeaderColors` (`@graupel/meteogram`, REQ-444). Tests:
`test/chainColors.test.tsx`, `e2e/chain-colors.spec.ts`.

## Konfiguration (REQ-427)

Ein Build für alle Domains (DEC-019): Die Seite lädt beim Start `./config.json` (relativ zur Seite, also unter jeder
Domain und jedem Unterpfad). Schema: `config.schema.json`; Typen und Standardwerte: `src/config/types.ts` und
`src/config/defaults.ts`. Alle Felder sind optional; Objekte werden feldweise mit den Standardwerten gemischt, Listen
ersetzen sie. `public/config.json` ist die allgemeine Standardkonfiguration (Englisch, Mont Blanc); die Konfigurationen
der Domains liegen in `domains/<tld>/config.json` und werden in deren Repos kopiert.

- Prüfung ohne zusätzliche Bibliothek (`src/config/jsonSchema.ts` wertet die genutzte Teilmenge von JSON Schema aus).
  Fehlt die Datei oder ist sie kein JSON, gelten die Standardwerte; ein ungültiges oder unbekanntes Feld fällt auf
  seinen Standardwert zurück. Probleme meldet die Konsole als Warnung, die Seite läuft weiter.
- `ConfigProvider` (in `main.tsx`) lädt die Datei und rendert erst danach; `useConfig()` liefert die fertige
  Konfiguration (ohne Provider die Standardwerte). `startPlace(config)` liefert den Ort beim Start (bei `"gps"` den
  ersten Favoriten; GPS nur auf Knopfdruck oder mit schon erteilter Erlaubnis, DEC-021).
- `modelChain: false` bzw. `daySlider.enabled: false` lassen den Bereich weg.
- `startLocation`, `modelHeaders` und `daySlider` sind Standardwerte: eine eigene Wahl in den Einstellungen geht vor
  (REQ-470, REQ-472, REQ-473; `startLocation` gilt ohne eigene Wahl nur, solange kein zuletzt gezeigter Ort gemerkt
  ist, REQ-599), ebenso bei `map` (REQ-467) und bei `showWeatherChain` / `showCloudChain` (REQ-503:
  ob die Karte der Wetter- bzw. Wolkenkette ohne eigene Wahl angezeigt wird, Standard `false`; nur wirksam mit
  `modelChain: true`).
- `imageModelHeaders` (Standard `false`): derzeit ohne Wirkung, für später; das Bild folgt den Modellköpfen am
  Bildschirm (DEC-094). Das kopierte, gespeicherte oder geteilte Bild des Meteogramms hat die Modell-Kopfzeile genau
  dann, wenn das Diagramm auf dem Bildschirm sie zeigt: eigene Wahl in den Einstellungen, sonst `modelHeaders`
  (REQ-539, `useModelHeaders()`). Die Option bleibt im Schema und in config.json erlaubt. Das Bild zeichnet der Kern
  mit `meteogramToPng(…, { render })` neu (`imageRenderOptions` in `layout.ts`). Seine
  Windpfeile stehen so dicht wie auf einem breiten Bildschirm, auch wenn das Diagramm schmal ist (REQ-538, Standard
  `minDayWidthPx` des Kerns).
- `timeZone` (IANA-Name, Standard `"Europe/Paris"` für den Mont Blanc): Zeitzone des Standardorts der Domain. Die
  Modell-Info zeigt die Laufzeiten darin, wenn die Zeitzone des Geräts nicht bestimmbar ist (REQ-733); ein Name, den
  der Browser nicht kennt, fällt mit Warnung auf den Standard zurück.
- `domain` (z. B. `"graupel.eu"`) steht in der Mitte der Meteogramm-Fußzeile (REQ-464). Ohne das Feld zeigt
  `siteDomain(config)` den Hostnamen der Seite ohne `www.`, auf `localhost` und IP-Adressen nichts.

## Domains und Auslieferung (REQ-422, REQ-437)

- `domains/<tld>/config.json` für at, ch, fr, it und eu (DEC-018): Rückfallsprache (at, ch → de, fr → fr, it → it,
  eu → en, DEC-027), fester Startort (Großglockner, Matterhorn, Mont Blanc, Ortler, Brüssel; den aktuellen
  Standort gibt es auf Knopfdruck, DEC-021) mit seiner Zeitzone (`timeZone`: Europe/Vienna, Europe/Zurich,
  Europe/Paris, Europe/Rome, Europe/Brussels; REQ-733), keine vorgegebenen Favoriten (`favorites.presets` leer, auch der Startort
  nicht, REQ-708) und das Impressum nach DEC-023
  (`legal.imprint`; `hoster` ist `true` für den Anbieter aus `legal.hosting` oder ein Objekt mit Name, Adresse,
  Telefon, auf .fr ALL-INKL; `imprintHoster()` liefert die Angaben; at, ch, it und eu nennen die Kontakt-E-Mail, DEC-032). In `legal.privacy` nennt .fr den
  Verantwortlichen der Datenschutzerklärung mit Name und E-Mail (`controller`, DEC-028, DEC-032; das Impressum bleibt
  anonym) und nur .ch zeigt den Hinweis für die Schweiz (`swissNotice: true`, DEC-029). Alle Domains setzen
  `legal.hosting: "all-inkl"` (REQ-710); die Vorschau (`previewConfig` in `scripts/build-preview.mjs`) setzt dort
  `github-pages`, weil sie auf GitHub Pages läuft, und lässt das Impressum unverändert (DEC-086). `test/domains.test.tsx` prüft jede Datei und rendert die Seite damit, `e2e/domains.spec.ts`
  lädt sie im Browser.
- Release: `scripts/package-site.mjs` (ohne Abhängigkeiten) packt die gebaute Seite als `graupel-site.zip` (mit
  Standard-`config.json`); ausgeliefert wird sie je Domain mit deren `config.json`. Die gebaute Seite ist statisch und
  läuft auf jedem Webspace.
