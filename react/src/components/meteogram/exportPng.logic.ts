/**
 * PNG export of the visible meteogram: the chart SVG plus the HTML label row
 * (location / generation time and Open-Meteo attribution), composed on a
 * canvas in the same arrangement as on screen.
 */

import { DAY_HEADER_FONT_SIZE } from "../drawing/chartGeometry";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Font size (CSS px) of the label rows in the exported PNG: the full size
 * of the weekday labels in the day header (the model header shrinks in
 * narrow slices), so the label stays readable when the image is scaled
 * down (#170).
 */
export function exportLabelFontPx(svg: SVGSVGElement): number | undefined {
  const viewBoxHeight = svg.viewBox?.baseVal?.height;
  const renderedHeight = svg.getBoundingClientRect().height;
  if (!viewBoxHeight || !renderedHeight) return undefined;
  return (
    (DAY_HEADER_FONT_SIZE * renderedHeight) /
    viewBoxHeight
  );
}

/** Vertical stacking of the chart and the (rescaled) label rows. */
export interface StackItem {
  top: number;
  height: number;
}

/**
 * Stack items in their on-screen order, keeping the gaps between them but
 * using new heights (label rows grow with their font).
 */
export function stackItems(
  items: { rect: StackItem; height: number }[],
): number[] {
  const order = items
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => a.rect.top - b.rect.top);
  const tops = new Array<number>(items.length);
  let cursor = 0;
  let previousBottom: number | null = null;
  for (const item of order) {
    const gap =
      previousBottom === null ? 0 : Math.max(0, item.rect.top - previousBottom);
    tops[item.index] = cursor + gap;
    cursor = tops[item.index] + item.height;
    previousBottom = item.rect.top + item.rect.height;
  }
  return tops;
}

/**
 * Scale for a label row: the target font size, reduced when the
 * left-aligned and right-aligned blocks would otherwise overlap.
 */
export function rowFontScale(
  targetScale: number,
  blockWidthsAtScale1: number[],
  availableWidth: number,
  minGap = 16,
): number {
  const total = blockWidthsAtScale1.reduce((sum, width) => sum + width, 0);
  const gaps = Math.max(0, blockWidthsAtScale1.length - 1) * minGap;
  if (total <= 0) return targetScale;
  return Math.min(targetScale, Math.max(0, availableWidth - gaps) / total);
}

/** Computed styles copied inline so the detached SVG renders like on screen. */
const INLINED_STYLE_PROPERTIES = [
  "display",
  "visibility",
  "opacity",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "paint-order",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
];

/** Live cursor lines that must not appear in the exported picture. */
const LIVE_CURSOR_SELECTORS = [
  '[data-testid="hover-crosshair-group"]',
  '[data-testid="current-time-crosshair-group"]',
];

/** Red time line of the export, in viewBox units; `x: null` draws none. */
export interface ExportTimeLine {
  x: number | null;
  y1: number;
  y2: number;
  timestamp?: string;
}

/**
 * Clone the chart SVG for rasterising: computed styles inlined, live hover /
 * current-time lines replaced by one line at the forecast generation time,
 * and an explicit pixel size (the viewBox stretches like on screen).
 */
export function buildExportSvg(
  source: SVGSVGElement,
  width: number,
  height: number,
  timeLine: ExportTimeLine | null,
): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const sourceElements = [source, ...Array.from(source.querySelectorAll("*"))];
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll("*"))];
  sourceElements.forEach((element, index) => {
    const target = cloneElements[index] as SVGElement | undefined;
    if (!target?.style) return;
    const computed = window.getComputedStyle(element);
    for (const property of INLINED_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });

  for (const selector of LIVE_CURSOR_SELECTORS) {
    clone.querySelectorAll(selector).forEach((node) => node.remove());
  }
  if (timeLine && timeLine.x !== null && Number.isFinite(timeLine.x)) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(timeLine.x));
    line.setAttribute("x2", String(timeLine.x));
    line.setAttribute("y1", String(timeLine.y1));
    line.setAttribute("y2", String(timeLine.y2));
    line.setAttribute("stroke", "#f43f5e");
    line.setAttribute("stroke-width", "1.2");
    line.setAttribute("stroke-dasharray", "4 2");
    line.setAttribute("data-testid", "export-time-line");
    if (timeLine.timestamp) {
      line.setAttribute("data-timestamp", timeLine.timestamp);
    }
    clone.appendChild(line);
  }

  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("class");
  clone.style.removeProperty("display");
  return clone;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Smallest rectangle containing all given rectangles. */
export function unionRect(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Baseline of a single text line inside its line box: the font box is
 * centred in the line box, like CSS does for inline text.
 */
export function textBaselineY(
  lineTop: number,
  lineHeight: number,
  ascent: number,
  descent: number,
): number {
  return lineTop + (lineHeight - (ascent + descent)) / 2 + ascent;
}

interface TextPiece {
  text: string;
  style: CSSStyleDeclaration;
}

/** Text nodes of a block element, in document order. */
function textPieces(block: Element): TextPiece[] {
  const pieces: TextPiece[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (!text.trim() || !parent) continue;
    pieces.push({ text, style: window.getComputedStyle(parent) });
  }
  return pieces;
}

function fontFor(style: CSSStyleDeclaration, scale: number): string {
  const size = parseFloat(style.fontSize) * scale;
  return `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
}

/**
 * Draw a label row at `top` with its text scaled by `scale`. Each child
 * block (location label, attribution) keeps its side: blocks left of the
 * row centre stay left-aligned, the others right-aligned.
 */
function drawLabelRow(
  ctx: CanvasRenderingContext2D,
  row: Element,
  region: Rect,
  top: number,
  height: number,
  targetScale: number,
) {
  const rowRect = row.getBoundingClientRect();
  // Controls in the row (day-range buttons) are not part of the image.
  const children = Array.from(row.children).filter(
    (child) => !child.hasAttribute("data-export-skip"),
  ).filter(
    (child) => child.getBoundingClientRect().width > 0,
  );
  const blocks = (children.length ? children : [row]).map((element) => ({
    rect: element.getBoundingClientRect(),
    pieces: textPieces(element),
  }));
  const widthAt = (pieces: TextPiece[], scale: number) =>
    pieces.reduce((sum, piece) => {
      ctx.font = fontFor(piece.style, scale);
      return sum + ctx.measureText(piece.text).width;
    }, 0);
  const rowStyle = window.getComputedStyle(row);
  const inner =
    rowRect.width -
    (parseFloat(rowStyle.paddingLeft) || 0) -
    (parseFloat(rowStyle.paddingRight) || 0);
  const scale = rowFontScale(
    targetScale,
    blocks.map((block) => widthAt(block.pieces, 1)),
    inner,
  );
  const rowCentre = rowRect.left + rowRect.width / 2;
  for (const block of blocks) {
    const width = widthAt(block.pieces, scale);
    const blockCentre = block.rect.left + block.rect.width / 2;
    let x =
      blockCentre < rowCentre
        ? block.rect.left - region.left
        : block.rect.right - region.left - width;
    for (const piece of block.pieces) {
      ctx.save();
      ctx.font = fontFor(piece.style, scale);
      ctx.fillStyle = piece.style.color;
      ctx.textBaseline = "alphabetic";
      const metrics = ctx.measureText(piece.text);
      const ascent =
        metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
      const descent =
        metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
      const baseline = textBaselineY(top, height, ascent, descent);
      ctx.fillText(piece.text, x, baseline);
      if (piece.style.textDecorationLine.includes("underline")) {
        ctx.fillRect(x, baseline + 1, metrics.width, Math.max(1, scale));
      }
      ctx.restore();
      x += metrics.width;
    }
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Meteogram SVG could not be rendered"));
    image.src = src;
  });
}

/**
 * Render the chart SVG and the label row(s) to a PNG, at least at 2x for a
 * sharp image. Areas outside the chart and labels (e.g. buttons) are not
 * drawn.
 */
export async function renderMeteogramPng({
  svg,
  textRows,
  timeLine,
  labelFontPx,
  scale = Math.max(2, window.devicePixelRatio || 1),
}: {
  svg: SVGSVGElement;
  textRows: Element[];
  timeLine: ExportTimeLine | null;
  /** Font size of the label rows in the PNG; default: as on screen. */
  labelFontPx?: number;
  scale?: number;
}): Promise<Blob> {
  const svgRect = svg.getBoundingClientRect();
  const region = unionRect([
    svgRect,
    ...textRows.map((row) => row.getBoundingClientRect()),
  ]);
  // Label rows take the weekday labels' font size (larger or smaller than
  // on screen) and their height follows; the chart keeps its size.
  const rowScales = textRows.map((row) => {
    const fontPx = parseFloat(window.getComputedStyle(row).fontSize);
    return labelFontPx && fontPx ? labelFontPx / fontPx : 1;
  });
  const rowRects = textRows.map((row) => row.getBoundingClientRect());
  const tops = stackItems([
    { rect: svgRect, height: svgRect.height },
    ...rowRects.map((rect, i) => ({
      rect,
      height: rect.height * rowScales[i],
    })),
  ]);
  const totalHeight = Math.max(
    tops[0] + svgRect.height,
    ...rowRects.map(
      (rect, i) => tops[i + 1] + rect.height * rowScales[i],
    ),
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(totalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, region.width, totalHeight);

  // Size the SVG in device pixels and draw it unscaled: some engines
  // (WebView2) rasterise an SVG image at its intrinsic size and would then
  // upscale that bitmap, which blurs lines and text.
  const svgPixelWidth = Math.round(svgRect.width * scale);
  const svgPixelHeight = Math.round(svgRect.height * scale);
  const exportSvg = buildExportSvg(
    svg,
    svgPixelWidth,
    svgPixelHeight,
    timeLine,
  );
  const markup = new XMLSerializer().serializeToString(exportSvg);
  const image = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
  );
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    Math.round((svgRect.left - region.left) * scale),
    Math.round(tops[0] * scale),
    svgPixelWidth,
    svgPixelHeight,
  );
  ctx.restore();

  textRows.forEach((row, i) =>
    drawLabelRow(
      ctx,
      row,
      region,
      tops[i + 1],
      rowRects[i].height * rowScales[i],
      rowScales[i],
    ),
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png",
    );
  });
}
