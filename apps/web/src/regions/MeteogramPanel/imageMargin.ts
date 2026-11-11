// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Margin of the copied, shared or saved picture (REQ-714): above the model headers and below the footer row ("place,
 * elevation (time) · domain · weather data by …") the picture gets a band in its background colour, so that neither
 * stands at the edge of the picture. The core's PNG export draws chart and footer row edge to edge; this module puts
 * that PNG on a taller canvas. The helpers take the window as a parameter so tests can pass stand-ins.
 */

/** Height of the band above and below the picture in CSS pixels (REQ-714); the PNG has it times its scale. */
export const IMAGE_MARGIN_PX = 12;

/** Background of the picture where the page has none: white, as the core's export. */
const FALLBACK_BACKGROUND = "#ffffff";

/** Whether a computed colour paints nothing. */
function transparent(colour: string): boolean {
  return !colour || colour === "transparent" || /^rgba\(.*,\s*0\)$/.test(colour);
}

/**
 * Background colour of the picture of the chart `element` (REQ-714): that of the element or its nearest painted
 * ancestor, as the core's export takes it (the page background, light or dark), else white. The picture and its
 * margin get this colour, so the band does not stand out.
 */
export function pictureBackground(element: Element): string {
  const view = element.ownerDocument.defaultView;
  if (!view) return FALLBACK_BACKGROUND;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = view.getComputedStyle(node).backgroundColor;
    if (!transparent(colour)) return colour;
  }
  return FALLBACK_BACKGROUND;
}

/** Device pixels per CSS pixel of the picture: at least 2, as the core's export (it is passed to it explicitly). */
export function pictureScale(win: Pick<Window, "devicePixelRatio"> = window): number {
  return Math.max(2, win.devicePixelRatio || 1);
}

/** The parts of `window` `withImageMargin` uses. */
export interface ImageMarginWindow {
  document: Document;
  createImageBitmap?: (image: Blob) => Promise<ImageBitmap>;
}

/** Options of `withImageMargin`. */
export interface ImageMarginOptions {
  /** Colour of the band, the picture's background (`pictureBackground`). */
  background: string;
  /** Height of the band above and below in pixels of the PNG. */
  margin: number;
}

/**
 * The PNG `png` with a band of `margin` pixels in the colour `background` above and below it (REQ-714), as a new PNG
 * of the same width. Where the browser cannot decode a PNG into a bitmap (`createImageBitmap`), the picture stays as
 * it is.
 */
export async function withImageMargin(
  png: Blob,
  { background, margin }: ImageMarginOptions,
  win: ImageMarginWindow = window,
): Promise<Blob> {
  if (margin <= 0 || typeof win.createImageBitmap !== "function") return png;
  const image = await win.createImageBitmap(png);
  try {
    const canvas = win.document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height + 2 * margin;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, margin);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
    });
  } finally {
    image.close?.();
  }
}
