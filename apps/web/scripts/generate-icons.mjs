// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
// Erzeugt Favicon, App-Symbole und Logo der Website aus der Graupel-Wolke (REQ-424, REQ-516).
//
// Quelle: scripts/graupel-cloud.svg (eigenes Werk des Projekts, GPL-3.0-or-later). Die SVG enthält nur ein eingebettetes PNG (1024 px, gut 1 MB); daraus
// entstehen ein kleines favicon.svg und die PNGs in public/icons/. Einmalig von Hand ausführen und die Dateien
// committen; der Build braucht das Skript nicht:
//
//   node apps/web/scripts/generate-icons.mjs
//
// Zum Verkleinern dient das Chromium von Playwright (keine zusätzliche Abhängigkeit); ein anderes Chromium setzt
// PLAYWRIGHT_CHROMIUM_EXECUTABLE.
//
// Die App-Symbole zeigen die Wolke auf deckendem Hellblau ICON_BACKGROUND (REQ-516), auf dem ihr dunkler Umriss gut
// sichtbar ist; background_color im Manifest ist seit REQ-750 die Hintergrundfarbe der Seite. Das Favicon
// (favicon.svg, favicon-32.png) und das Logo im Info-Popup (icons/logo-192.png) bleiben durchsichtig (REQ-662).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ICON_BACKGROUND = "#dbe8f5";
/** Eckenradius der abgerundeten Quadrate (Favicon, Manifest-Symbole „any“) als Anteil der Kantenlänge. */
const CORNER_RADIUS = 0.22;

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));

const source = readFileSync(new URL("./graupel-cloud.svg", import.meta.url), "utf8");
const master = /href="(data:image\/png;base64,[^"]+)"/.exec(source)?.[1];
if (!master) throw new Error("Kein eingebettetes PNG in graupel-cloud.svg gefunden");

/**
 * name, Kantenlänge, Breite der Wolke (Anteil der Kantenlänge; null: ganzes Quellbild wie bisher), Form des
 * Hintergrunds: null (durchsichtig), "square" (randlos, deckend) oder "rounded" (abgerundetes Quadrat).
 */
const ICONS = [
  // Favicon ohne Hintergrund (REQ-662): wird in favicon.svg eingebettet
  ["favicon-svg", 128, 0.86, null],
  ["icons/favicon-32.png", 32, 0.86, null],
  // iOS rundet die Ecken selbst und füllt Transparenz schwarz: randlos deckend.
  ["icons/apple-touch-icon.png", 180, 0.72, "square"],
  ["icons/icon-192.png", 192, 0.78, "rounded"],
  ["icons/icon-512.png", 512, 0.78, "rounded"],
  // maskable: Android schneidet bis auf den Kreis mit 80 % Durchmesser ab; die Wolke bleibt mit 60 % darin.
  ["icons/icon-192-maskable.png", 192, 0.6, "square"],
  ["icons/icon-512-maskable.png", 512, 0.6, "square"],
  // Logo im Info-Popup (About), durchsichtig
  ["icons/logo-192.png", 192, null, null],
];

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
);
const page = await browser.newPage();
const rendered = await page.evaluate(
  async ({ master, icons, background, radius }) => {
    const image = new Image();
    image.src = master;
    await image.decode();

    // Umriss der Wolke (nicht durchsichtige Pixel) im Quellbild
    const probe = document.createElement("canvas");
    probe.width = image.naturalWidth;
    probe.height = image.naturalHeight;
    const probeContext = probe.getContext("2d");
    probeContext.drawImage(image, 0, 0);
    const { data } = probeContext.getImageData(0, 0, probe.width, probe.height);
    let left = probe.width,
      top = probe.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if (data[(y * probe.width + x) * 4 + 3] > 8) {
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y + 1);
        }
      }
    }
    const cloud = document.createElement("canvas");
    cloud.width = right - left;
    cloud.height = bottom - top;
    cloud.getContext("2d").drawImage(image, left, top, cloud.width, cloud.height, 0, 0, cloud.width, cloud.height);

    // Schrittweise halbieren, dann auf das Ziel: scharf und ohne Treppen.
    function shrink(sourceCanvas, width) {
      let current = sourceCanvas;
      let currentWidth = sourceCanvas.width;
      const ratio = sourceCanvas.height / sourceCanvas.width;
      while (currentWidth / 2 >= width) {
        currentWidth = Math.round(currentWidth / 2);
        const step = document.createElement("canvas");
        step.width = currentWidth;
        step.height = Math.round(currentWidth * ratio);
        const context = step.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(current, 0, 0, step.width, step.height);
        current = step;
      }
      return current;
    }

    function render(size, cloudWidth, shape) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d");
      if (shape) {
        context.fillStyle = background;
        context.beginPath();
        if (shape === "rounded") context.roundRect(0, 0, size, size, size * radius);
        else context.rect(0, 0, size, size);
        context.fill();
      }
      context.imageSmoothingQuality = "high";
      if (cloudWidth === null) {
        context.drawImage(shrink(probe, size), 0, 0, size, size);
      } else {
        const width = size * cloudWidth;
        const height = (width * cloud.height) / cloud.width;
        context.drawImage(shrink(cloud, width), (size - width) / 2, (size - height) / 2, width, height);
      }
      return canvas.toDataURL("image/png");
    }
    return icons.map(([name, size, cloudWidth, shape]) => [name, render(size, cloudWidth, shape)]);
  },
  { master, icons: ICONS, background: ICON_BACKGROUND, radius: CORNER_RADIUS },
);
await browser.close();

mkdirSync(`${publicDir}icons`, { recursive: true });
for (const [name, dataUrl] of rendered) {
  if (name === "favicon-svg") {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">' +
      "<title>Graupel</title>" +
      `<image width="128" height="128" href="${dataUrl}"/></svg>\n`;
    writeFileSync(`${publicDir}favicon.svg`, svg);
    console.log("favicon.svg", svg.length, "Bytes");
  } else {
    const png = Buffer.from(dataUrl.split(",")[1], "base64");
    writeFileSync(`${publicDir}${name}`, png);
    console.log(name, png.length, "Bytes");
  }
}
