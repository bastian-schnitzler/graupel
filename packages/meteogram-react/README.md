# @graupel/meteogram-react

React-Hülle der Meteogramm-Bibliothek (MET). `<Meteogram>` kapselt den Controller von `@graupel/meteogram`
(`createMeteogram`): einmal beim Einhängen erzeugt, bei neuen Props aktualisiert, beim Aushängen mit `destroy()`
abgebaut. Zoom, Hover, Tooltip, Tastatur und Größenanpassung bleiben im Kern. React ≥ 19 ist peerDependency.

```tsx
import { useRef, useState } from "react";
import {
  Meteogram, type MeteogramController, type MeteogramInput, type TimeRange,
} from "@graupel/meteogram-react";
import { meteogramToPng } from "@graupel/meteogram/png";

const options = { theme: "dark", locale: "de-DE", fallbackLayoutId: "normal-default" } as const;

function Forecast({ input }: { input: MeteogramInput }) {
  const chart = useRef<MeteogramController | null>(null);
  const [range, setRange] = useState<TimeRange | null>(null);
  return (
    <>
      <Meteogram
        input={input}
        options={options}
        dayRange={7}
        onRangeChange={setRange}
        onHover={(info) => console.log(info?.timestamp)}
        renderTooltip={(info) => <MyTooltip info={info} />}
        ref={chart}
        style={{ height: 480 }}
      />
      <button onClick={async () => download(await meteogramToPng(chart.current!))}>PNG</button>
    </>
  );
}
```

## Props

| Prop | Bedeutung |
|---|---|
| `input` | `MeteogramInput` des Kerns. Ein neues Objekt zeichnet neu; die Daten daher stabil halten (`useMemo`). |
| `options` | Optionen des Kerns ohne Callbacks: `layout`, `fallbackLayoutId`, `forceModelHeaders`, `theme`, `modelHeaderColors` (Kopffarbe je Modell, siehe README von `@graupel/meteogram`), `locale`, `texts`, `timezone`, `quantities`, `availableModels`, `fontFamily`, `attribution`, `tooltipTexts`, `dewPoint` (Taupunkt und Spread: `"on"`, `"off"` oder `"auto"`, Standard `"off"`, unverändert an den Kern durchgereicht, siehe README von `@graupel/meteogram`), `relativeHumidity` (relative Luftfeuchte im Temperaturbereich mit Achse 0 bis 100 % rechts: `"on"` oder `"off"`, Standard `"off"`, unverändert an den Kern durchgereicht, siehe README von `@graupel/meteogram`), `axisLabels` (Beschriftung der Achsen, auch `compact: true` für kleine Diagramme: Einheit einmal je Achse unter dem Bereich, Höchst- und Tiefstwert in den Ecken, unverändert an den Kern durchgereicht, siehe „Ränder und Achsbeschriftungen“ im README von `@graupel/meteogram`), `scaleToVisibleRange` (Achsen von Niederschlag und Wind folgen beim Zoomen dem sichtbaren Bereich, Standard `true`, unverändert an den Kern durchgereicht), `axisRangeFrom` (hält diese Achsen auf einem Bereich fest, während die App den Bereich mit einer Geste verschiebt: zu Beginn der sichtbare Bereich, beim Loslassen `null`; siehe „Achsen folgen dem sichtbaren Bereich“ im README von `@graupel/meteogram`), `interaction` (`zoom`, `hover`, `tooltip`, `keyboard`, `initialRange`, `dayRange`), `now`, … Verglichen wird nach Wert (einfache Objekte und Arrays), ein Inline-Objekt zeichnet also nicht bei jedem Rendern neu. |
| `visibleRange` | Sichtbarer Bereich; am Anfang statt `interaction.initialRange`, danach bei jeder Änderung angewendet. Den über `onRangeChange` gemeldeten Bereich zurückzugeben ist ein No-op. `null` zeigt alles. |
| `dayRange` | Tagesbereich (4, 7, 10, 14 oder `null`); am Anfang und bei Änderung angewendet. Die Tasten dafür baut die App. |
| `hoverTime` | Hover zu einem Zeitpunkt (Epoch-ms), z. B. von einem zweiten Diagramm; `null` beendet ihn. |
| `onRangeChange(range)` | Sichtbarer Bereich geändert (Zoom, Tagesbereich, neue Daten). |
| `onHover(info)` | Hover-Zeitpunkt geändert; `null` am Ende. |
| `renderTooltip(info)` | Eigener Tooltip-Inhalt als Render-Prop (React-Knoten); `null`, `undefined` oder `false` blendet aus. Ohne die Prop zeichnet der Kern seinen Standard-Tooltip. Wird außerhalb des Renderns aufgerufen: Elemente zurückgeben, keine Hooks darin. |
| `onOpenLink(href)`, `warpCursor(x, y)` | Link der Quellenangabe selbst öffnen, Systemcursor nach dem Zoom nachführen (Desktop-Hülle). |
| `onLayoutWarning(text)` | Ungültiges Layout; ohne die Prop `console.warn`. |
| `ref` | Erhält den `MeteogramController` (PNG-Export, `setDayRange`, `getScene`, …), beim Aushängen `null`. |
| `className`, `style`, `id` | Für das Host-Element, in das der Kern sein `div.graupel-meteogram` hängt. |

Callbacks dürfen bei jedem Rendern neue Funktionen sein; die Hülle reicht immer die aktuellen weiter, ohne den Kern
neu zu zeichnen. Den Tooltip-Inhalt rendert sie per Portal in den positionierten Container des Kerns und lässt ihn
nach dem Commit neu platzieren (`refreshTooltip()`).

Nicht in der Hülle (bleibt der App, WEB): Vollbild, Tasten für den Tagesbereich, Kopieren in die Zwischenablage,
sichtbarer Hinweis bei ungültigem Layout.

## Tests

`test/` enthält die Komponententests: Hover und
Tooltip, Zoom und Bereiche, Layout-Varianten, Sonnenzeiten, Gewitter-Icons, Konvektion. `test/helpers.tsx` übersetzt die alten Props (`data`, `modelChain`,
`timelineStart`, …) in `MeteogramInput`. Weggefallen sind Fälle, die nur die App betreffen (Vollbild, Tasten des
Tagesbereichs, globaler Zoom am Fenster, der durch DEC-012 nur noch über dem Element wirkt); die reine Zeichnung prüft
der Kern mit Golden-SVGs und Snapshots.

## Befehle

Im Paketordner: `pnpm build` (tsup, ESM und `.d.ts` nach `dist/`; braucht den gebauten Kern, `pnpm -r build` baut in
der richtigen Reihenfolge), `pnpm test` (Vitest mit jsdom und @testing-library/react), `pnpm lint`, `pnpm typecheck`.
Tests und Typprüfung laufen gegen die Quellen des Kerns und brauchen keinen Build.

## Lizenz

MPL-2.0 (`LICENSE`, `"license": "MPL-2.0"` in `package.json`, SPDX-Header in jeder Quelldatei unter `src/` und
`test/`). Fremdes Material enthält das Paket nicht, keine Fonts und keine GPL-Assets (`THIRD_PARTY_LICENSES.md`);
`test/license.test.ts` prüft das.
