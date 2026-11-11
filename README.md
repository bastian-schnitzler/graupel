# Graupel

Wettervorhersagen als Meteogramm: Modellketten aus Open-Meteo-Daten, ein Katalog der Wettermodelle und ihrer
Gebiete, Bibliotheken zum Laden und Darstellen und eine Web-App. Die Website läuft unter <https://graupel.eu> und
den Länder-Domains graupel.at, graupel.ch, graupel.fr und graupel.it.

| Ordner | Inhalt |
|---|---|
| `generator/` | Katalog- und Chain-Generator (Python) |
| `model-data/` | erzeugte Modelldaten (`@graupel/model-data`) |
| `packages/download/` | Download-Bibliothek (`@graupel/download`) |
| `packages/meteogram/`, `packages/meteogram-react/` | Meteogramm-Bibliothek |
| `apps/domain-viewer/` | Model Domain Viewer |
| `apps/web/` | Website und App |

Entwicklung: `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`; Generator in `generator/` mit `uv run pytest`.
Die gebaute Website (`apps/web/dist`) ist statisch und läuft auf jedem Webspace; je Domain kommt eine eigene
`config.json` dazu (`apps/web/domains/`).

## Lizenzen

Jedes Paket nennt seine Lizenz in `LICENSE` und `package.json`: die Website und der Domain Viewer stehen unter
GPL-3.0-or-later (Lizenztext auch in [`LICENSE`](LICENSE) im Wurzelverzeichnis), die Bibliotheken unter MPL-2.0, die
aus Open-Meteo abgeleiteten Modelldaten unter CC BY 4.0. Fremde Bestandteile und ihre Lizenzen stehen in den Dateien
`THIRD_PARTY_LICENSES.md` der Pakete; die Übersicht mit Links steht in
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
