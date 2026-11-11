// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
export const METEOGRAM_VIEWBOX_WIDTH = 1000;
export const WIND_ICON_RADIUS_PX = 7.2;
export const WIND_ICON_FOOTPRINT_PX = 18;

export type MeteogramRenderMode = 'embedded' | 'fullscreen';

export interface MeteogramLayout {
  mode: MeteogramRenderMode;
  renderedWidth: number;
  renderedHeight: number;
  windIconScaleX: number;
  windIconScaleY: number;
  windIconFootprint: number;
  textScaleX?: number;
}

/**
 * Creates an SVG transform string that scales text horizontally around its anchor point (x, y)
 * to counteract non-uniform viewBox stretching, restoring natural font glyph proportions.
 */
export function getTextTransform(
  x: number,
  y: number,
  textScaleX?: number,
): string | undefined {
  if (!textScaleX || Math.abs(textScaleX - 1) < 0.001) {
    return undefined;
  }
  return `translate(${x} ${y}) scale(${textScaleX} 1) translate(${-x} ${-y})`;
}

/**
 * On-screen size (CSS px) of text drawn with `fontSize` viewBox units: the
 * vertical viewBox scale (`textScaleX` keeps the glyph proportions, so the
 * height decides). Embedded the chart scales with its width, full-screen with
 * its height as well.
 */
export function renderedFontPx(layout: MeteogramLayout, fontSize: number): number {
  return layout.windIconScaleY > 0 ? fontSize / layout.windIconScaleY : fontSize;
}

/**
 * Derive pixel-sensitive values for one chart instance. Keeping this pure and
 * view-scoped prevents fullscreen measurements from reconfiguring the embedded
 * chart (and vice versa).
 */
export function getMeteogramLayout({
  mode,
  width,
  height,
  viewBoxHeight,
  viewBoxWidth = METEOGRAM_VIEWBOX_WIDTH,
}: {
  mode: MeteogramRenderMode;
  width: number;
  height?: number;
  viewBoxHeight: number;
  /** Width of the viewBox (render option `viewBoxWidth`); default `METEOGRAM_VIEWBOX_WIDTH`. */
  viewBoxWidth?: number;
}): MeteogramLayout {
  const renderedWidth =
    Number.isFinite(width) && width > 0 ? width : viewBoxWidth;
  const renderedHeight =
    Number.isFinite(height) && height && height > 0
      ? height
      : (renderedWidth * viewBoxHeight) / viewBoxWidth;
  const windIconScaleX = viewBoxWidth / renderedWidth;
  const windIconScaleY = viewBoxHeight / renderedHeight;
  const textScaleX = windIconScaleY > 0 ? windIconScaleX / windIconScaleY : 1;

  return {
    mode,
    renderedWidth,
    renderedHeight,
    windIconScaleX,
    windIconScaleY,
    windIconFootprint: WIND_ICON_FOOTPRINT_PX * windIconScaleX,
    textScaleX,
  };
}

