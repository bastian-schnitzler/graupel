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
 * Derive pixel-sensitive values for one chart instance. Keeping this pure and
 * view-scoped prevents fullscreen measurements from reconfiguring the embedded
 * chart (and vice versa).
 */
export function getMeteogramLayout({
  mode,
  width,
  height,
  viewBoxHeight,
}: {
  mode: MeteogramRenderMode;
  width: number;
  height?: number;
  viewBoxHeight: number;
}): MeteogramLayout {
  const renderedWidth =
    Number.isFinite(width) && width > 0 ? width : METEOGRAM_VIEWBOX_WIDTH;
  const renderedHeight =
    Number.isFinite(height) && height && height > 0
      ? height
      : (renderedWidth * viewBoxHeight) / METEOGRAM_VIEWBOX_WIDTH;
  const windIconScaleX = METEOGRAM_VIEWBOX_WIDTH / renderedWidth;
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

