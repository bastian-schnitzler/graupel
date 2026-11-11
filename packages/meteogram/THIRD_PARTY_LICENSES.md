# Lizenzen und Herkunft

`@graupel/meteogram` steht unter der Mozilla Public License 2.0 (`MPL-2.0`, Volltext in `LICENSE`). Jede Quelldatei
trägt den SPDX-Header `SPDX-License-Identifier: MPL-2.0`. Diese Datei nennt fremdes Material im Paket und die Herkunft
übernommener Teile. Die Lizenzen des fremden Materials gelten unverändert neben der MPL-2.0.

## Fremdes Material

### Lucide-Icons `CloudLightning` und `CloudHail`

- **Wo:** `src/render/thunderstormIconLayer.ts` (Pfaddaten der Glyphen `cloud-lightning` und `cloud-hail`, inline,
  damit der Kern keine Abhängigkeiten hat); im Build in `dist/index.js` samt Hinweis.
- **Quelle:** Lucide (<https://lucide.dev>, <https://github.com/lucide-icons/lucide>), übernommen aus `lucide-react`
  1.44.0. Beide Icons gehören nicht zu den aus Feather (MIT) abgeleiteten Lucide-Icons.
- **Lizenz:** ISC

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Sonst enthält das Paket keinen fremden Code und keine Fonts, Bilder oder Icons als Dateien: Schriften kommen aus der
Seite (`font-family: inherit` bzw. die Option `fontFamily`), alle übrigen Symbole (Windpfeile, Wolkenprofil) zeichnet
der Renderer selbst. Laufzeitabhängigkeiten gibt es keine; `jsdom` und `tsup` sind nur Entwicklungswerkzeuge und nicht
im Paket.

## Eingebaute Registry und Layouts

Registry und Layouts sind eigene, kuratierte Daten ohne Bezug zu heruntergeladenen Open-Meteo-Daten (die Registry
nennt nur die Variablennamen der API); sie stehen deshalb wie der Code unter MPL-2.0 und nicht unter CC BY 4.0.
Sobald `@graupel/model-data` die Registry und die Layouts liefert, ersetzen diese die eingebauten Kopien; die Lizenz
ändert sich dadurch nicht. Die Golden-SVGs enthalten die Pfade der Lucide-Icons oben (ISC).
