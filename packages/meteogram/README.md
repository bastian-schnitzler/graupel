# @graupel/meteogram

Framework-freier Kern der Meteogramm-Bibliothek (MET). Stand MET-S1: Rechenlogik, SVG-Renderer und
Design-Konfiguration, Interaktion (`createMeteogram`) und PNG-Export (`@graupel/meteogram/png`).

## Inhalt

| Ordner | Inhalt |
|---|---|
| `src/core/` | Zeitachse, Zoom, Tagesgruppen, Modell-Header, Geometrie, Pfade, Wind, Extremwerte, Sonnenzeiten, Konvektion, Tooltip- und Detaildaten |
| `src/layouts/` | Layout-Schema (`ChartLayout`), eingebaute Layouts, Prüfung und Auflösung, Serien-Voreinstellungen |
| `src/quantities/` | Größen-Registry, eingebaute Registry, abgeleitete Größen |
| `src/render/` | Virtueller SVG-Baum, `toSvgString`, `mount`/`patch`, Zeichenfunktionen (früher React-Komponenten) |
| `src/interaction/` | Controller `createMeteogram`, Hover-, Zoom- und Größenlogik (früher Hooks), Standard-Tooltip |
| `src/png/` | PNG-Export über Canvas, Subpath `@graupel/meteogram/png` (nur Browser) |
| `demo/` | Vanilla-Demo-Seite (`pnpm demo`, dann `http://localhost:4173/demo/`) |
| `e2e/` | Playwright-Smoke-Test der Demo-Seite (im Wurzelverzeichnis `pnpm test:e2e`) |

## Renderer

Die Zeichenfunktionen liefern einen kleinen virtuellen Baum `{ tag, attrs, children }`; Attribute tragen ihre
SVG-Namen (`stroke-width`, `clip-path`). Das Bild besteht aus zwei Ebenen: `static` (Achsen, Kurven, Header, Icons;
neu bei Daten, Layout, Zoom oder Größe) und `overlay` (Cursor; neu beim Hover).

```ts
import {
  createMeteogramScene, renderMeteogramSvg, renderStaticLayer, renderOverlayLayer,
  meteogramToSvgString, mount, patch,
} from "@graupel/meteogram";

// Node oder Browser, ohne DOM:
const svg = meteogramToSvgString(input, { layout, timezone: "Europe/Berlin", now: Date.now() });

// Im DOM: einmal einhängen, beim Hover nur das Overlay neu zeichnen.
const scene = createMeteogramScene(input, { size: { width: 800, height: 420 } });
const staticLayer = renderStaticLayer(scene);
let tree = renderMeteogramSvg(scene, { static: staticLayer });
const element = mount(tree, container);
const next = renderMeteogramSvg(scene, { static: staticLayer, overlay: renderOverlayLayer(scene, { time }) });
patch(element, tree, next);
tree = next;
```

`MeteogramInput` (`src/core/input.ts`) enthält Ort, Zeitzone, Zeitachse (`start`, `end`, `now`), Modellkette mit
Slice-Enden und Läufen, die zusammengesetzte Reihe, optional Rohdaten je Modell, Wolkenprofil, Wolkenübergänge,
Sonnenzeiten und den Erzeugungszeitpunkt. Die Ortsbeschriftung liefert die Szene als Text (`scene.locationLabel`);
sie steht außerhalb des SVG.

`test/fixtures/*.old.svg` sind Referenz-SVGs für dieselben Fixtures; `goldenSvg.test.ts` vergleicht den Renderer damit.

## Design-Konfiguration

Der Renderer enthält keine festen Farben; alle kommen aus dem Theme (`src/core/theme.ts`). `light` (Standard)
ist das helle Grundbild, `dark` das Gegenstück für dunkle Seiten. Abweichend von den Referenz-SVGs haben
Böen und gefühlte Temperatur in jedem Theme die Farbe von Wind bzw. Temperatur und sind fein gestrichelt (`2 2`,
feiner als die Modellgrenzen); die Detailzeilen markieren sie mit `dashed: true`. Ein Layout überschreibt Farbe und
Strichart je Kurve (`color`, `dashed: false`). Die Höhenangabe des Orts an der Geländelinie (`terrain.label`) liegt über
Wolkenprofil und Kurven, mit einem Rand in der Farbe von `background`; sie hat so überall eine Schriftfarbe (REQ-510).
Eigene Themes überschreiben
Tokens eines eingebauten Themes, je Gruppe einzeln:

```ts
meteogramToSvgString(input, {
  theme: { base: "dark", series: { temperature: "#ff0000" }, fontSizes: { axis: 10 } },
  locale: "de-DE",                    // Wochentage, Datumsangaben; Standard en-US
  texts: { emptyState: "Keine Daten." }, // eigene Texte statt der englischen
  fontFamily: "Inter, sans-serif",    // ohne Angabe erbt das SVG die Schrift der Seite
  background: true,                   // Theme-Hintergrund ins SVG malen (Standard: transparent)
});
```

| Token | Inhalt |
|---|---|
| `background` | Hintergrund (malt der Host oder das SVG mit `background: true`) |
| `grid` | Trennlinien (auch die Hilfslinie `midLine`), Mittagslinien, Tagestönung, Bereichstrenner, Nullgradlinie (`freezingLine`, hell `#3b82f6`, dunkel `#60a5fa`) |
| `dayHeader`, `modelHeader`, `daylight`, `sunTimes` | Tages- und Modell-Header (`modelHeader.contrastText`: zweite Schriftfarbe für Kopffarben je Modell), Modellgrenzen, Tageslicht, Sonnenzeiten |
| `axis`, `axisLabels`, `halfAxisLabels` | Achsenbeschriftung allgemein und je Größe; `axis.midLabel` (hell und dunkel `#64748b`) ist die etwas blassere Beschriftung der Hilfslinie `midLine` |
| `series`, `seriesFallback` | Serienfarben je Größe; Reihenfolge: Layout, Theme, Registry, Fallback |
| `snow`, `extremes`, `cursor`, `terrain`, `cloud`, `windIcon`, `thunderstormIcon` | Einzelne Zeichenelemente |
| `details` | Wertfarben der Detailzeilen (`buildFullscreenDetailRows`) |
| `emptyState`, `fontSizes` | Leertext, Schriftgrößen der festen Beschriftungen |

Schnee hat die Farbe des Hintergrunds (REQ-486): In `light` und `dark` sind `snow.fill` und die Serienfarben von
`snowfall` und `snowfall_with_rain` gleich `background` (weiße Balken auf Weiß, dunkle auf Dunkel); sichtbar macht sie
der Rand `snow.outline`. Überschreibt ein Theme `background`, gehen diese Schneefarben mit, sofern es sie nicht selbst
setzt: `{ base: "dark", background: "#1a2129" }` zeichnet Schnee in `#1a2129`.

### Kopffarbe je Modell

`modelHeaderColors` gibt einzelnen Modellen eine eigene Kopffarbe, als Objekt Modell → Farbe. Schlüssel ist die
Katalog-ID (`id` des Kettenglieds) oder der Modellname; die ID geht vor. Die Schrift nimmt von `modelHeader.text` und
`modelHeader.contrastText` die mit dem höheren Kontrast (WCAG) zur Kopffarbe; ausgewertet werden Hex-Farben und
`rgb()`, bei anderen Angaben bleibt `modelHeader.text`. Modelle ohne Eintrag und Aufrufe ohne die Option behalten
`modelHeader.background`. Die Option gilt für `meteogramToSvgString`, `createMeteogram` und `<Meteogram options>` aus
`@graupel/meteogram-react` gleichermaßen.

```ts
createMeteogram(container, input, {
  theme: "dark",
  modelHeaderColors: { icon_d2: "#ea580c", icon_eu: "#f59e57", "ECMWF IFS": "#fdba74" },
});
```

`readableTextColor(background, candidates)` und `contrastRatio(a, b)` sind exportiert, damit eine Seite ihre eigenen
Flächen in derselben Farbe gleich beschriften kann.

### Modell-Header mit Läufen

Setzt Open-Meteo die Reihe eines Modells aus mehreren Läufen zusammen, bekommt jeder Lauf einen eigenen Header mit
Name und Lauf, z. B. `IFS HRES (29 Z06)` (`HeaderModelSegment.runLabel`: `29 Z06`). Passt Name mit Lauf nicht in
seinen Abschnitt, zeigt dieser Abschnitt nur den Lauf ohne Klammern, `29 Z06` (REQ-515, `data-run-only="true"` am
Text); jeder Abschnitt entscheidet für sich.

Der Lauf steht ohne Monat als Tag, Leerzeichen, `Z` und Stunde in UTC (`formatRunLabel`: `29 Z06`, REQ-695). Wie die
Läufe eines Modells beschriftet werden, hängt von allen Läufen ab, die sein Kopf zeigt (`formatRunLabels(runs,
locale)`, Tage in UTC, REQ-697):

| Läufe | Beschriftung |
|---|---|
| jeder an einem eigenen Tag | nur das Datum: `31/10`, `01/11` (Option `locale`: Tag zuerst z. B. für `de`, `fr`, `it`; Monat zuerst für `en-US`, den Standard: `10/31`) |
| in verschiedenen Monaten, mehrere an einem Tag | ein Tag mit nur einem Lauf als Datum, die Läufe eines Tags mit mehreren in der Grundform: `31/10`, `01 Z06`, `01 Z12` |
| sonst | Grundform: `29 Z00`, `29 Z06` |

Das gilt in langer und kurzer Form, für den Lauf allein und im Bild (SVG/PNG). Die Breite schätzt `estimateModelHeaderLabelWidth` ohne DOM: Zeichenzahl
mal `MODEL_HEADER_CHAR_WIDTH` (0,62) mal Schriftgröße mal `textScaleX` der Ansicht, gegen die Breite des Abschnitts
abzüglich `MODEL_HEADER_LABEL_PADDING` je Seite. Passt auch der Lauf nicht, bleibt er stehen und ragt wie bisher über
den Rand; weiter gekürzt wird nicht. Modelle aus nur einem Lauf zeigen unverändert ihren Namen.

### Ränder und Achsbeschriftungen

Für schmale Bildschirme (REQ-542) und kleine Diagramme (REQ-696) gibt es zwei Optionen des Renderers (gelten auch für `createMeteogram` und
`<Meteogram options>`); ohne sie zeichnet das SVG unverändert.

| Option | Bedeutung |
|---|---|
| `padding: { left, right }` | Platz links und rechts der Zeichenfläche in viewBox-Einheiten (viewBox 1000 breit bzw. `viewBoxWidth`), Standard je 50 (`DEFAULT_PLOT_PADDING`); Werte unter 0 oder ab der halben Breite der viewBox (500) fallen auf den Standard zurück. Die Beschriftungszeile unter dem Diagramm rückt um denselben Anteil ein. |
| `axisLabels.unit` | `"inline"` (Standard): Wert und Einheit in einer Zeile (`11 mm`); `"below"`: Einheit in einer zweiten Zeile unter dem Wert (`11` / `mm`, zwei `tspan`, `data-lines="2"` am `text`). Ein Gradzeichen bleibt am Wert (`19°`). Gilt für linke und rechte Achsen, Halbachsen und die Wolkenhöhen. Höchst- und Tiefstwert stehen dann in den Ecken des Bereichs wie bei `compact` (REQ-738): der Höchstwert mit der Oberkante seiner Ziffern 1 px unter dem oberen Rand, die Einheitenzeile des Tiefstwerts 1 px über dem unteren Rand; bei einer rechten Achse mit Namen steht der Name eine Zeile unter der Einheit des Höchstwerts. Bei Wolkenhöhen steht der Wert über, die Einheit unter der Höhenlinie. Zeilenabstand `AXIS_LABEL_LINE_HEIGHT` (1,1) mal Schriftgröße. |
| `axisLabels.align` | `"plot"` (Standard): links rechtsbündig 8 Einheiten vor der Zeichenfläche, rechts dahinter; `"edge"`: linke Labels beginnen bei x = 0, rechte Labels und Wolkenhöhen enden am rechten Rand der viewBox (x = 1000 bzw. `viewBoxWidth`); `"inside"`: wie `"edge"`, für eine Zeichenfläche ohne Rand (`padding` 0): die Labels stehen über der Zeichenfläche, nach den Daten gezeichnet, mit einem Halo in der Hintergrundfarbe. Die linken Labels beginnen dabei 1 Einheit vom Rand (x = 1, `INSIDE_LEFT_LABEL_X`); in einem Bereich mit Sonnenzeiten (`sunTimes`) hängt das linke Maximum 1 Einheit unter der Zeile der Sonnenaufgangszeit (REQ-602), bei kompakter oder zweizeiliger Beschriftung nur, wenn eine Sonnenaufgangszeit über ihm steht. |
| `axisLabels.compact` | Kompakte Beschriftung für kleine Diagramme (REQ-696), Standard `false` (Beschriftung wie bisher, jedes SVG unverändert). Mit `true` steht je Achse (links, rechts, Halbachsen) die Einheit nur einmal, unter dem Zeichenbereich (im Abstand zum nächsten Bereich bzw. unter dem letzten: Oberkante der Schrift 1 px unter dem Rand, `data-testid` `axis-unit`, `right-unit` bzw. `half-unit`), in Farbe und Schriftgröße der Achse, an ihrer Seite ausgerichtet, ohne Halo. Der Höchstwert steht in der oberen Ecke des Bereichs (Oberkante der Ziffern 1 px unter dem Rand), der Tiefstwert in der unteren Ecke (Unterkante 1 px über dem Rand), auch der der Temperatur; die Werte stehen ohne Einheit, ein Gradzeichen bleibt am Wert (`-35°`), eine Achse mit Gradzeichen schreibt keine Einheit darunter. Bei einer rechten Achse mit Namen (z. B. LPI) steht der Name eine Zeile unter dem Höchstwert. 1 px ist ein CSS-Pixel des gezeichneten Diagramms: der senkrechte Maßstab viewBox ↔ px (`windIconScaleY` des Layouts, `verticalPixel`), ohne Maßstab 1 Einheit. Über der Zeichenfläche (`"inside"`) hängt der Höchstwert in einem Bereich mit Sonnenzeiten nur dann 1 Einheit unter der Zeile der Sonnenaufgangszeit (REQ-602), wenn eine Sonnenaufgangszeit über ihm steht (geschätzte Textbreiten), sonst in der Ecke; seit REQ-734 rückt eine solche Sonnenaufgangszeit rechts neben ihre Linie, so dass das Maximum in der Ecke bleibt. Beschriftung der Nulllinie (REQ-603), der Hilfslinien (REQ-653) und die Wolkenhöhen behalten ihre Regeln (die Wolkenhöhen auch ihre Einheit); eine Beschriftung, die Höchst- oder Tiefstwert überdeckt, entfällt nach diesen Regeln. `axisLabels.unit` wirkt dann nur noch auf die Wolkenhöhen, `axisLabels.align` bleibt wirksam. Gilt in der Ansicht und im Bild. |

```ts
createMeteogram(container, input, {
  padding: { left: 28, right: 18 },
  axisLabels: { unit: "below", align: "edge" },
});
```

`axisLabelLines(value, unit, unitBelow, compact)` liefert die Zeilen eines Labels, `compactAxisUnit(unit)` die Einheit
unter dem Bereich (oder `null`). Der PNG-Export übernimmt das SVG, wie es
auf dem Bildschirm steht, also auch diese Beschriftung.

Höhen der Labels (REQ-602, REQ-603): Ein Label aus Ziffern reicht von `DIGIT_ASCENT` (0,72) mal Schriftgröße über
seiner Grundlinie bis zur Grundlinie, bei zwei Zeilen bis zur Grundlinie der zweiten (`axisLabelBox`); so misst auch
die Sonnenaufgangszeit ihre Zeile (Grundlinie `sunriseBaselineY(top)`, Ziffern 1 Einheit unter der Oberkante des
Bereichs). Über der Zeichenfläche liegt die Oberkante des linken Maximums in einem Bereich mit `sunTimes` 1 Einheit
unter dieser Grundlinie; ohne Sonnenzeiten und bei `"plot"` und `"edge"` (neben der Zeichenfläche) bleibt es, wo es war.

Halo als eigenes Element (REQ-747): Beschriftungen mit Halo (Achsen- und Wolkenhöhenbeschriftung über der
Zeichenfläche, Tageshöchst- und Tiefstwerte, Geländehöhe) zeichnen den Halo nicht mehr als `stroke` mit
`paint-order: stroke` am Text selbst, denn Safari malte diesen Rand bei gestreckter Schrift über die Füllung. Stattdessen
steht jede solche Beschriftung in einer Gruppe `g.label-halo`: zuerst eine Kopie nur mit Rand (`fill="none"`,
`aria-hidden`, `data-halo="true"`, ohne Test-ID), dann der Text mit Füllung ohne Rand (`withHalo`, `labelHalo` in
`render/halo.ts`). Test-IDs und Schlüssel bleiben am Text mit Füllung; in Chromium sieht das Bild gleich aus.

Sonnenaufgangszeit neben ihrer Linie (REQ-734): Stünde eine Sonnenaufgangszeit mittig über ihrem Zeitpunkt über dem
Maximum der linken Achse (geschätzte Breiten, `sunTimeLabelSpan`), steht sie stattdessen rechts neben ihrer Linie:
linksbündig (`text-anchor="start"`) an der Linie oder 2 Einheiten hinter dem Label, je nachdem, was weiter rechts liegt,
und im Tag gehalten (`moveSunriseOffAxisLabel`). Mit kompakter und mit zweizeiliger Beschriftung (REQ-738) bleibt das Maximum dann in der Ecke. Ohne
Überlappung und neben der Zeichenfläche bleibt sie mittig; die Untergangszeit ändert sich nicht.

Beschriftung der Nulllinie (REQ-603): Hat die linke Achse eines Bereichs `zeroLine` und liegt 0 in ihrem Bereich,
bekommt die Nulllinie ein Label „0“ mit der Einheit der Achse wie Minimum und Maximum (`0°`, `data-testid="axis-zero"`),
auf der Seite und mit der Ausrichtung der linken Labels, in der Farbe der Linie (`grid.freezingLine`, hell und dunkel)
und der Schriftgröße `fontSizes.axis`, über der Zeichenfläche mit demselben Halo. Es steht senkrecht mittig auf der
Linie und bleibt ganz im Bereich, über der Zeichenfläche eines Bereichs mit Sonnenzeiten auch unter der
Sonnenaufgangszeit. Überdeckt es das Maximum oder Minimum um mehr als 20 % von dessen Höhe
(`ZERO_LABEL_MAX_OVERLAP`, `zeroLabelCovers`), entfällt dieses; bis 20 % bleiben beide, das Nulllabel liegt oben.
Ein Maximum oder Minimum, das selbst 0 ist (0 °C an der Ober- oder Unterkante), entfällt ebenfalls. Achsen ohne
`zeroLine` oder ohne 0 im Bereich bleiben unverändert; `axes.left.showLabels: false` blendet auch dieses Label aus.

Hilfslinie beim halben Achsenmaximum (REQ-653, DEC-060): Hat die linke Achse eines Bereichs `midLine: true` (die
eingebauten Layouts setzen es am Bereich `wind`), zieht sich bei `(min + max) / 2` der gezeichneten Achse, bei der
Windachse also beim halben Maximum, eine dünne gestrichelte Linie über die ganze Zeichenfläche (Strichstärke 1,
`MID_LINE_DASH_ARRAY` `4 3`, Farbe `grid.line`, hell und dunkel), hinter Kurven und Windpfeilen
(`data-testid="wind-mid-line"`, allgemein `<Bereich>-mid-line`, Wert in `data-value`). Sie folgt der Achse, die der
Bereich gerade zeichnet. Links steht ihr Wert mit Einheit, wie die übrigen Labels auf eine ganze Zahl gerundet: „38 km/h“
bei 75 km/h (die Linie liegt bei 37,5 km/h), „15 km/h“ bei 30 km/h, „8 km/h“ bei 15 km/h (`data-testid="axis-mid"`).
Das Label hat die Schriftgröße `fontSizes.axis`, die etwas blassere Farbe `axis.midLabel`, Seite, Ausrichtung,
Einheit-Option und Halo der übrigen linken Labels (bei `"inside"` 1 Einheit vom Rand) und steht senkrecht mittig auf der
Linie. Passt es nicht mit mindestens 1 Einheit Abstand (`MID_LABEL_GAP`) zwischen Maximum und Minimum (ein niedriger
Bereich) oder käme es dem Label einer Nulllinie zu nahe (`midLabelCrowds`), entfällt es; die Linie bleibt.
`axes.left.showLabels: false` blendet das Label aus, nicht die Linie. An einer rechten Achse hat `midLine` keine
Wirkung.

Schaltbar über das Layout (`ChartLayout`): Model-Header (`showModelHeaders`), Tages-Header, Tageslicht, Drawing
Areas (`enabled`), Achsbeschriftungen (`axes.left/right.showLabels`), Nulllinie (`axes.left.zeroLine`), Hilfslinie beim
halben Achsenmaximum (`axes.left.midLine`), Sonnenzeiten, Tagesextreme.

### Breite der viewBox

Die viewBox ist 1000 Einheiten breit (`METEOGRAM_VIEWBOX_WIDTH`) und so hoch, wie das Layout es verlangt; eingebettet
skaliert das SVG mit seiner Breite, auch in der Höhe. `viewBoxWidth` (Option des Renderers, auch für `createMeteogram`
und `<Meteogram options>`) setzt eine andere Breite; die Höhe bleibt. Schrift, Linien, Symbole und `padding` sind in
viewBox-Einheiten angegeben und behalten so ihre Größe auf dem Bildschirm, wenn das Diagramm um denselben Anteil
schmaler wird wie die viewBox. Zeigt eine Seite einen Teil der Vorhersage im Maßstab der ganzen, setzt sie
`viewBoxWidth` auf `1000 * gezeigte Zeitspanne / ganze Zeitspanne` und macht das Diagramm um denselben Anteil
schmaler: Es wird schmaler, nicht niedriger (REQ-585). Werte, die keine positive Zahl sind (`null`, 0, `NaN`), stehen
für den Standard.

```ts
// Ein Viertel der ganzen Vorhersage auf einem Viertel der Breite, gleich hoch.
createMeteogram(container, input, { interaction: { initialRange: quarter }, viewBoxWidth: 250 });
```

### Achsenstufen

Die Achsen von Wind, Niederschlag und Temperatur enden auf festen Stufen (REQ-590 bis REQ-592), sofern
das Layout keinen festen Bereich (`range: "fixed"`) setzt:

| Bereich | Regel |
|---|---|
| Wind und Böen | 0 bis zur kleinsten Stufe aus `WIND_AXIS_STEPS` (10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400 km/h), bei der der höchste Wert aller Modelle unter den Windpfeilen bleibt; die Pfeilgröße folgt der dargestellten Höhe (`windIconScaleY`). Darüber das nächste Vielfache von 100, ohne Daten 50. |
| Niederschlag | 0 bis zur kleinsten Stufe aus `PRECIPITATION_AXIS_STEPS` (2, 5, 10, 15, 20, 30, 50 … 400 mm), die das Maximum fasst, ohne Niederschlag 2 mm; ein vom Host gegebenes `maxPrecipitation` geht durch dieselben Stufen. Beschriftung ganzzahlig. Schneefall (cm) behält seine freie Achse. |
| Temperatur | Grenzen auf Vielfachen von 5 (`temperatureAxisRange`); 0 °C bleibt eingeschlossen, wenn die Werte bis 15 °C heranreichen. |

### Achsenregeln im Layout (Version 2)

Seit Layout-Version 2 (REQ-663) kann eine Achse (`axes.left`/`axes.right`) die Regeln selbst festlegen, die
sonst je Größe gelten (`layouts/seriesPresets.ts`). Fehlt eine Regel, gilt die der Größe; Layouts der Version 1 und
Achsen ohne Regeln zeichnen unverändert. `axisPresetFor(quantity, resolvedAxis)` liefert die Regeln einer Achse.

| Feld | Wirkung |
|---|---|
| `steps` | `range: "zero-based"`: Maximum ist die kleinste Stufe, die die Daten fasst; darüber das nächste Vielfache von 100; ohne Daten der Wert der Größe bzw. die erste Stufe. Steigende positive Zahlen. |
| `step` | `range: "auto"`: Grenzen auf Vielfachen von `step`; bei der Temperatur mit ihren Regeln um 0 °C und für den Taupunkt-Boden (`temperatureAxisRange`, `temperatureSpreadFloor`). |
| `padding` | `{ top, bottom }`: Abstand der Extreme zum Bereichsrand (viewBox-Einheiten, ≥ 0). |
| `format` | `{ decimals, below1Decimals }`: Nachkommastellen der Maximum-Beschriftung (unter 1 `below1Decimals`). |
| `scope` | `"visible"` (Standard bei Niederschlag und Wind) oder `"all"`: ob die linke zero-based Achse bei `scaleToVisibleRange` dem sichtbaren Bereich folgt. |
| `guides` | Hilfslinien der linken Achse: `{ at: 12 }` bei einem Wert oder `{ at: "25%" }` bei einem Anteil des Bereichs, gestrichelt (`dashed: false`: durchgezogen) und links beschriftet (`label: false`: ohne); außerhalb des Bereichs entfallen sie. `midLine: true` ist die Kurzform für die Linie bei 50 % und steht als erste. Die erste Hilfslinie trägt die Test-IDs `<Bereich>-mid-line` und `axis-mid`, weitere `<Bereich>-guide-<n>-line` und `axis-guide-<n>` (ab 2). |

Die eingebauten Layouts sind Version 2 und nennen ihre Regeln mit den Werten der Größen (Temperatur `step: 5`,
Niederschlag `steps` ab 2 mm, Wind `steps` ab 10 km/h, beide `scope: "visible"`, Wind `midLine`); sie zeichnen
dasselbe SVG wie ohne die Regeln.

### Schalter im Layout

Seit Layout-Version 2 (REQ-664) nennt ein Layout seine Schalter selbst: `toggles` gibt jedem Schalter
seine Werte und den Standard (`{ values: ["off", "on"], default: "off" }`, mindestens zwei verschiedene Texte, der
Standard ist einer davon). `showWhen` an einer Reihe oder Achse sagt, bei welchen Werten sie gezeichnet wird
(`{ relativeHumidity: "on" }` oder eine Liste `{ dewPoint: ["on", "auto"] }`; mehrere Schalter müssen alle passen).
Gilt `showWhen` nicht, entfällt die Reihe oder Achse, und der Bereich zeichnet genau wie ein Layout ohne sie.

Die Render-Option `toggles` (`{ name: wert }`) setzt die Werte; unbekannte Schalter und Werte gelten nicht, es bleibt
der Standard. Die älteren Optionen `dewPoint`, `relativeHumidity` und `scaleToVisibleRange` setzen den Schalter
gleichen Namens und gehen `toggles` vor. `scene.toggles` nennt die Werte, mit denen gezeichnet wurde.

`autoRule: "spread"` an einer Reihe mit `fillTo` (der Taupunkt) lässt die Reihe im Layout; der Wert ihres Schalters
(`"off"`, `"on"` oder `"auto"`) ist der Modus, mit dem `calculateSpreadStretches` entscheidet, wo sie erscheint
(siehe unten). Die eingebauten Layouts haben die Schalter `dewPoint` (off, on, auto; Standard off),
`relativeHumidity` (off, on; off) und `scaleToVisibleRange` (off, on; on) und zeichnen für jeden Wert der älteren
Optionen dasselbe SVG wie ohne Schalter. Ein Layout ohne Schalter zeichnet wie bisher, die älteren Optionen wirken dort
wie vorher. `toggleValues`, `showWhenHolds`, `spreadModeOf` und `withToggles` (`layouts/toggles.ts`) liefern Werte,
Bedingungen, Modus und das Layout mit den Schaltern.

### Popup aus dem Layout

Seit Layout-Version 2 (REQ-665) nennt jeder Bereich mit `tooltip` die Zeilen des Popups beim Überfahren:
eine Liste von Größen (eine Gruppe, benannt nach dem Bereich) oder Gruppen `{ group, rows, order? }`. Zwischen Gruppen
mit sichtbaren Zeilen steht ein Trennstrich (Test-ID `tooltip-divider-<group>`), nach der letzten keiner; Gruppen mit
`order` stehen nach ihr zuerst, die übrigen folgen in der Reihenfolge der Bereiche. Gruppennamen sind im Layout
eindeutig.

Eine Zeile ist eine Größe der Registry, eine der Summen `precipitation_sum` (Niederschlag über die nassen Stunden
um die Stunde) und `snowfall_sum` (Schneefall ebenso) oder die abgeleitete Zeile `dew_point_spread` (Temperatur minus
Taupunkt, `TOOLTIP_DERIVED_ROWS`). Eine Größe, die ein Layout nennt, gehört zu seinen Größen
(`getLayoutQuantities`) und erscheint mit Bezeichnung und Einheit aus der Registry (`Cloud cover: 40 %`, Test-ID
`tooltip-row-<Größe>`). Die bekannten Größen behalten ihre Darstellung, ihre Texte (`tooltipTexts`) und Test-IDs, die
Einheit kommt aus der Registry: Windrichtung als Himmelsrichtung, gefühlte Temperatur nur mit Wert, Schneefall nur über
0, Schneehöhe nur mit Schnee (über 0 oder Schneefall), die Summe des Schneefalls nie allein, CIN negativ, LPI nur bei
Modellen mit LPI; gefühlte Temperatur und Böen in der Farbe ihres Partners (REQ-442).

Zeilen einer Größe, die das Layout nur unter einem Schalter zeichnet (`showWhen`, `autoRule`), erscheinen nur, solange
sie gezeichnet ist (REQ-676): Taupunkt und Spread bei `dewPoint` „on“ oder bei „auto“ mit erfüllter
Bedingung im dargestellten Zeitraum, die relative Luftfeuchte bei `relativeHumidity` „on“ (und mit Werten in den
Daten). Die eingebauten Layouts nennen sie in der Temperatur-Gruppe nach der gefühlten Temperatur: Taupunkt (°C, Farbe
der Taupunkt-Linie, Test-ID `tooltip-row-dew_point`), Taupunktdifferenz (Temperatur minus Taupunkt, eine
Nachkommastelle, `tooltip-row-dew_point_spread`) und relative Luftfeuchte (ganzzahlig in %, Farbe ihrer Linie,
`tooltip-row-relative_humidity`); eine Stunde ohne Wert (Lücke der Linie) hat keine Zeile. Die Farben sind die der
Linien im Theme des Diagramms und lassen sich mit `--graupel-tooltip-dew-point` und
`--graupel-tooltip-relative-humidity` überschreiben; die Texte sind `dewPoint`, `dewPointSpread` und
`relativeHumidity` in `tooltipTexts` (Standard Englisch). `undrawnQuantities` und `withoutTooltipRows`
(`layouts/tooltip.ts`) liefern die nicht gezeichneten Größen und die Gruppen ohne ihre Zeilen.

Ohne `tooltip` in allen Bereichen zeigt das Popup die bisherigen Zeilen (`DEFAULT_TOOLTIP_GROUPS`: Temperatur, Wind,
Niederschlag, Schnee, Konvektion) und danach die übrigen Größen des Layouts. Die eingebauten Layouts nennen diese Zeilen
ausdrücklich und zeigen dasselbe Popup wie ohne `tooltip`; beide nennen in der Temperatur-Gruppe auch Taupunkt,
Taupunktdifferenz und relative Luftfeuchte (REQ-676). `scene.tooltipGroups` und `tooltipGroups(layout,
quantities)` liefern die Gruppen in der Reihenfolge des Popups.

### Achsen folgen dem sichtbaren Bereich

Mit der Option `scaleToVisibleRange` (boolean, Standard `true`, REQ-655) folgen die Achsen von
Niederschlag und Wind dem sichtbaren Bereich: Ist `visibleRange` kleiner als der ganze Bereich (`maximumRange`),
ergeben sich die Maxima der linken Achsen mit `range: "zero-based"` für `precipitation`, `precipitation_rain_snow`,
`wind_speed` und `wind_gusts` (`VISIBLE_RANGE_AXIS_QUANTITIES`; im Layout `scope`, siehe oben) aus den Werten aller Modelle (zusammengesetzte Reihe
und `modelSeries`) im sichtbaren Bereich, einschließlich der Stunde an jedem Rand (Werte weniger als eine Stunde vor
dem Anfang oder nach dem Ende, so zählt ein angeschnittener Balken oder Kurvenabschnitt), auf den Stufen oben (Wind
10, 15, 20 … km/h, Niederschlag 2, 5, 10 … mm). Ruhiges Wetter im gezoomten Ausschnitt zeigt so z. B. „2 mm“ und
„30 km/h“ statt „10 mm“ und „75 km/h“; die Windpfeile bleiben über den Kurven, und die Hilfslinie `midLine` folgt der
gezeichneten Achse („15 km/h“). `scene.axisRange` nennt den Bereich, aus dem die Maxima stammen (`null`, solange die
Achsen alle Daten fassen).

Ist die Option `false` oder alles sichtbar, fassen die Achsen wie bisher alle Daten (SVG unverändert). Andere Achsen
(Temperatur, CAPE, rechte Achsen, Luftfeuchte, Schneefall) und Achsen mit anderem `range` folgen dem Bereich nie. Ein
vom Host gegebenes `maxPrecipitation` gilt nur, solange die Achsen alle Daten fassen; gezoomt mit eingeschalteter
Option ersetzt das Maximum im sichtbaren Bereich den Wert.

Ziehen (DEC-061): Der Controller passt die Achsen nach jedem Zoomschritt (Mausrad, Tasten) an, denn jeder Schritt
zeichnet mit dem neuen Bereich neu. Eine Zeigergeste, die den Bereich verschiebt, hat der Controller selbst nicht;
verschiebt ein Host den Bereich mit einer Geste (Ziehen, Wischen), hält er die Achsen mit der Option `axisRangeFrom`
fest: zu Beginn der Geste der Bereich, der gerade sichtbar ist, beim Loslassen `null` (oder weglassen), dann rechnet
das Diagramm die Achsen für den neuen Bereich aus. `axisRangeFrom` wird wie `visibleRange` auf den ganzen Bereich
begrenzt.

```ts
// Geste beginnt: Achsen festhalten, Bereich verschieben, beim Loslassen freigeben.
meteogram.update(input, { ...options, axisRangeFrom: meteogram.getVisibleRange() });
meteogram.setVisibleRange(moved);           // bei jeder Bewegung
meteogram.update(input, options);           // Loslassen: Achsen folgen wieder dem sichtbaren Bereich
```

Der erste Bereich ist auch oben mit einer grauen Linie begrenzt; die Nullgradlinie hat die Theme-Farbe
`grid.freezingLine`.

### Taupunkt und Spread

Die eingebauten Layouts zeichnen im Temperaturbereich den Taupunkt (`dew_point`, 2 m, °C) als Linie mit der Option
`fillTo: "temperature"`: Die Fläche zwischen Taupunkt und Temperatur (der Spread) ist in der Farbe des Taupunkts
transparent gefüllt (`fillOpacity`, Standard 0,18). Fehlt der Taupunkt in den Daten, bleibt das Diagramm unverändert.

| Option `dewPoint` | Bedeutung |
|---|---|
| `"auto"` | wie `"on"` über die ganze Breite, sobald im dargestellten Zeitraum beides gilt: Der Spread beträgt irgendwo höchstens 5 K oder der Taupunkt erreicht 15 °C, und eine Temperatur (2 m) erreicht irgendwo 5 °C oder mehr (zu einer Stunde oder zwischen zwei Stunden, linear interpoliert); sonst gar nicht, wie `"off"` |
| `"on"` | überall |
| `"off"` (Standard) | nirgends, wie ohne Taupunkt |

Ohne die Option `dewPoint` gilt `"off"`: Taupunkt und Spread erscheinen nur, wenn `"on"` oder `"auto"` ausdrücklich
gesetzt ist.

`"auto"` entscheidet also nur, ob Taupunkt und Spread erscheinen, nicht wo; Lücken gibt es nur, wo Werte fehlen. Ein
anderer dargestellter Zeitraum (Zoom, andere Tage) entscheidet neu.

Der Taupunkt erweitert die Temperaturachse nicht mit seinen eigenen Werten. Ist er sichtbar, reicht die Achse nur so
weit nach unten, dass ein Spread von 5 K zu sehen ist, auf 5er-Stufen und höchstens bis zur Stufe, die nicht mehr als
5 K unter der tiefsten Temperatur liegt (`temperatureSpreadFloor`); ein tieferer Taupunkt wird am Rand abgeschnitten.
`calculateSpreadStretches(timestamps, upper, lower, mode, range?)` liefert die Abschnitte, in denen Temperatur
(`upper`) und Taupunkt (`lower`) beide Werte haben, bei `"auto"` die von `"on"` oder keine, entschieden im
dargestellten Zeitraum `range` (ohne ihn über alle Stunden); die Temperaturbedingung prüft `upper` dort, wo es Werte hat,
auch ohne Taupunkt (Schwelle `TEMPERATURE_AUTO_MIN_C`). `spreadAxisFloor` liefert die Untergrenze der Achse.

### Relative Luftfeuchte

Die eingebauten Layouts haben im Temperaturbereich eine rechte Achse für die relative Luftfeuchte
(`relative_humidity`, 2 m, %, fest von 0 bis 100) und eine dünne Linie (Strichstärke 1,5) in ihrer Farbe (Theme
`series.relative_humidity`, hell Indigo `#4f46e5`). Gezeichnet werden beide nur mit der Option `relativeHumidity`
(REQ-649):

| Option `relativeHumidity` | Bedeutung |
|---|---|
| `"on"` | Linie und rechte Achse, beschriftet oben mit „100 %“ und unten mit „0 %“ in der Farbe der Linie, auf der Höhe der Temperaturbeschriftungen und ohne Namen der Größe; fehlende Werte ergeben Lücken |
| `"off"` (Standard) | weder Linie noch Achse, das Diagramm ist dasselbe wie ohne Luftfeuchte |

Fehlt die Luftfeuchte in den Daten ganz, gilt `"off"`. Die Beschriftung folgt `axisLabels` wie die anderen rechten
Achsen (bei `"inside"` endet sie 1 Einheit vor dem rechten Rand); die Temperaturachse links bleibt unverändert. Wie der
Taupunkt zeigen Popup und Seitenleiste die Luftfeuchte nur, solange sie gezeichnet ist (REQ-676, siehe „Popup aus dem
Layout“). `RELATIVE_HUMIDITY_MODES` und
`isRelativeHumidityMode` prüfen den Wert der Option; `withRelativeHumidity(layout, shown)` liefert das Layout ohne
Reihen und Achsen der Luftfeuchte, wenn sie nicht gezeigt wird.

## Controller

`createMeteogram(element, input, options)` hängt das Meteogramm in `element` ein (ein `div.graupel-meteogram` mit
SVG, Beschriftungszeile und Tooltip) und gibt den Controller zurück. Optionen sind die des Renderers (Layout, Theme,
Locale, Zeitzone, …) plus:

| Option | Bedeutung |
|---|---|
| `interaction` | `zoom`, `hover`, `tooltip`, `keyboard` (je Standard `true`), `initialRange`, `dayRange` (4, 7, 10, 14 Tage oder `null`) |
| `attribution` | Text und Link rechts in der Beschriftungszeile; Standard Open-Meteo, `null` blendet aus |
| `centerLabel` | kurzer Text in der Mitte der Beschriftungszeile zwischen Ort und Attribution (z. B. die Domain der Website); Standard keiner |
| `tooltipTexts` | Beschriftungen des Standard-Tooltips |
| `renderTooltip(info, container)` | eigener Tooltip-Inhalt im positionierten Container; `false` blendet aus ; füllt ein Framework den Container später, platziert `refreshTooltip()` ihn neu |
| `onHover(info)`, `onRangeChange(range)` | Rückmeldungen bei Hover (`null` am Ende) und sichtbarem Bereich |
| `onOpenLink(href)`, `warpCursor(screenX, screenY)` | Link öffnen und Systemcursor nach dem Zoom nachführen (Desktop-Hülle) |
| `onLayoutWarning(text)` | ungültiges Layout (Standard `console.warn`) |

```ts
import { createMeteogram } from "@graupel/meteogram";
import { meteogramToPng } from "@graupel/meteogram/png";

const meteogram = createMeteogram(container, input, { theme: "dark", interaction: { dayRange: 7 } });
meteogram.update(nextInput);          // neue Daten; Optionen als zweites Argument ersetzen die alten
meteogram.setDayRange(4);             // Tagesbereich; Tasten dafür baut die Seite selbst
const blob = await meteogramToPng(meteogram);
meteogram.destroy();                  // entfernt DOM, Listener, ResizeObserver und Timer
```

- Hover: Zeiger über dem SVG; nur die Ebene `overlay` wird gepatcht. Der Tooltip (DOM,
  Farben über `--graupel-tooltip-*`) steht auf der dem Cursor gegenüberliegenden Seite unter dem Tageskopf. Gefühlte
  Temperatur und Böen folgen `--graupel-tooltip-temperature` bzw. `--graupel-tooltip-wind`, solange
  `--graupel-tooltip-apparent-temperature` bzw. `--graupel-tooltip-gust` nicht gesetzt sind.
  Seine Schrift ist so groß wie die linken Achsenbeschriftungen auf dem Bildschirm (REQ-487): `fontSizes.axis` mal
  der senkrechten Skalierung des SVG (`tooltipFontSize(scene)`, `renderedFontPx`), eingebettet wie im Vollbild
  (`mode: "fullscreen"`), nach jeder Größenänderung neu. Alle Texte und Abstände der Box sind in `em`;
  `--graupel-tooltip-font-size` setzt eine feste Größe.
  Die Werte stehen in Gruppen (Temperatur, Wind, Niederschlag, Schnee, Konvektion, weitere Größen); ein Trennstrich
  (`.tooltip-group-divider`) steht nur zwischen zwei sichtbaren Gruppen, nie nach der letzten und nie für eine
  Gruppe ohne Zeilen zur Stunde, z. B. Schnee ohne Schneefall (REQ-495).
- Zoom: Mausrad nur über dem Element, am Hover-Zeitpunkt verankert; der Tooltip kehrt mit der nächsten echten
  Bewegung zurück. Nach jedem Zoomschritt folgen die Achsen von Niederschlag und Wind dem neuen Bereich
  (`scaleToVisibleRange`, siehe „Achsen folgen dem sichtbaren Bereich“; beim Verschieben durch den Host hält
  `axisRangeFrom` sie fest).
- Tastatur (Element fokussierbar): Pfeil links/rechts verschiebt den Cursor um eine Stunde, `+`/`-` zoomen, `0`
  zeigt alles, `Escape` beendet den Hover.
- Größe: ein `ResizeObserver` misst das SVG; Text und Icons behalten ihre Proportionen. Ohne festes `now` wird die
  aktuelle Zeit jede Minute neu gezeichnet.
- Nicht im Kern (bleibt der App): Vollbild per Doppelklick, Kopieren in die Zwischenablage, Tasten für den
  Tagesbereich, sichtbarer Hinweis bei ungültigem Layout.

`meteogramToPng(meteogram, { scale, background, render, minDayWidthPx })` zeichnet SVG und Beschriftungszeile wie
auf dem Bildschirm in ein Canvas (mindestens 2-fach), ersetzt den Live-Cursor durch eine Linie zum
Erzeugungszeitpunkt und liefert ein PNG-`Blob`. Die Einzelteile (`renderMeteogramPng`, `buildExportSvg`, …) sind
ebenfalls exportiert.

- `render`: Render-Optionen nur für das Bild (z. B. `layout` ohne Modellköpfe); das Diagramm auf dem Bildschirm bleibt.
- `minDayWidthPx` (Standard `EXPORT_MIN_DAY_WIDTH_PX` = 54, drei Windpfeile je Tag; `0`: wie auf dem Bildschirm):
  Ist ein Tag im Diagramm schmaler, wird das Bild für eine entsprechend größere Breite angeordnet und auf die eigene
  Größe gezeichnet. Windpfeile und Gewitter-Icons stehen dann so dicht wie in einem breiten Diagramm, nur kleiner;
  alles andere sieht aus wie auf dem Bildschirm.
- Weicht das Bild ab, zeichnet `getExportSources({ render, minDayWidthPx })` ein zweites SVG und setzt es kurz an die
  Stelle des Diagramms (Maße, Beschriftungszeile); `release()` stellt den Bildschirm sofort wieder her, bevor der
  Browser zeichnet.

## Registry als Option

Es gibt keinen globalen Zustand. Funktionen, die Größen oder eingebaute Layouts brauchen, nehmen sie als Parameter;
ohne Angabe gelten die eingebauten Kopien (`BUILTIN_QUANTITY_REGISTRY`, `BUILTIN_LAYOUTS`).

```ts
import { createQuantityRegistry, resolveChartLayout } from "@graupel/meteogram";

const quantities = createQuantityRegistry(myDefinitions);
const { layout, warning } = resolveChartLayout(storedLayout, { quantities, fallbackId: "normal-default" });
```

`parseQuantityRegistry(json)` prüft geladene Daten und gibt `null` zurück, wenn sie unbrauchbar sind.

## Befehle

Im Paketordner: `pnpm build` (tsup, ESM und `.d.ts` nach `dist/`), `pnpm test` (Vitest), `pnpm lint`,
`pnpm typecheck` (Quellen streng, Tests ohne `noUncheckedIndexedAccess`), `pnpm demo` (Build und Demo-Server). Im Wurzelverzeichnis
startet `pnpm test:e2e` den Demo-Server und prüft Rendern, Tooltip, Zoom, Dark Theme und PNG-Export in Chromium;
passt das vorinstallierte Chromium nicht zur Version von `@playwright/test`, zeigt
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` auf das vorhandene Programm. DOM-Tests laufen in jsdom
(`// @vitest-environment jsdom`), alle anderen in Node.

## Lizenz

MPL-2.0 (`LICENSE`, `"license": "MPL-2.0"` in `package.json`, SPDX-Header in jeder Quelldatei unter `src/`, `test/`,
`demo/` und `e2e/`). Die inline übernommenen Lucide-Icons `CloudLightning` und `CloudHail` stehen unter ISC; Hinweis
und Lizenztext in `THIRD_PARTY_LICENSES.md`. Das Paket enthält keine Fonts und keine
GPL-Assets; `test/license.test.ts` prüft Header, `LICENSE`, `package.json` und das Fehlen von GPL-Material.
