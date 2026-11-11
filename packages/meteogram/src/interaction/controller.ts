// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * `createMeteogram`: the meteogram in a DOM element, with hover, tooltip,
 * wheel and keyboard zoom and resizing. The static layer is redrawn on new
 * data, layout, zoom or size; a hover patches only the overlay layer. Every
 * zoom step draws a new scene, so the precipitation and wind axes follow the
 * new range (`scaleToVisibleRange`, REQ-655). The controller has no pointer
 * gesture that pans the range; a host that pans it holds the axes with the
 * render option `axisRangeFrom` until the gesture ends (DEC-061).
 */
import type { MeteogramInput } from "../core/input";
import { HOUR_MS, canonicalTimestamp, normalizeTimestamp } from "../core/timeline";
import {
  calculateDayRange,
  findActiveDayRange,
  type DayRangeChoice,
  type TimeRange,
} from "../core/zoom";
import { patch, mount } from "../render/dom";
import {
  renderMeteogramSvg,
  renderOverlayLayer,
  renderStaticLayer,
} from "../render/meteogram";
import {
  createMeteogramScene,
  type MeteogramRenderOptions,
  type MeteogramScene,
} from "../render/scene";
import type { VNode } from "../render/vnode";
import type { ExportTimeLine } from "../png/exportPng";
import { observeSize, type ChartDimensions, type SizeObserver } from "./dimensions";
import {
  buildHoverInfo,
  calculatePopupPosition,
  hoverAtPointer,
  hoverAtTime,
  type HoverPosition,
  type MeteogramHoverInfo,
} from "./hover";
import { TOOLTIP_STYLE, renderTooltipContent, tooltipFontSize, type MeteogramTooltipTexts } from "./tooltip";
import { cursorShiftAfterZoom, wheelDirection, zoomStep, type ZoomDirection } from "./zoom";

/** Share of the viewBox width as a CSS percentage (`50` of 1000 → `5%`). */
const plotInsetPercent = (padding: number, viewBoxWidth: number) =>
  `${Math.round((padding / viewBoxWidth) * 100 * 1000) / 1000}%`;

/** Interaction switches and the start range. */
export interface MeteogramInteractionOptions {
  /** Mouse wheel zoom over the element and zoom keys (default true). */
  zoom?: boolean;
  /** Cursor line under the pointer (default true). */
  hover?: boolean;
  /** Tooltip next to the cursor line (default true; needs `hover`). */
  tooltip?: boolean;
  /** Arrow keys, + / - / 0 and Escape when the element has focus (default true). */
  keyboard?: boolean;
  /** Visible range at the start; clamped to the data. */
  initialRange?: TimeRange | null;
  /** Day range (4 / 7 / 10 / 14 days or null for all) at the start, if no `initialRange`. */
  dayRange?: DayRangeChoice;
}

/** Data attribution next to the location label. */
export interface MeteogramAttribution {
  /** Text before the link. */
  text?: string;
  /** Link text. */
  linkText?: string;
  href?: string;
}

/** Attribution of the Open-Meteo data (CC BY 4.0), the default. */
export const OPEN_METEO_ATTRIBUTION: MeteogramAttribution = {
  text: "Weather data by ",
  linkText: "Open-Meteo.com",
  href: "https://open-meteo.com/",
};

export interface MeteogramOptions extends Omit<MeteogramRenderOptions, "visibleRange" | "size"> {
  interaction?: MeteogramInteractionOptions;
  /** Attribution in the label row; null hides it. Default: Open-Meteo. */
  attribution?: MeteogramAttribution | string | null;
  /**
   * Short text in the middle of the label row, between the location label
   * and the attribution (e.g. the site's domain). Default: none.
   */
  centerLabel?: string | null;
  /** Tooltip texts to override. */
  tooltipTexts?: Partial<MeteogramTooltipTexts>;
  /** Called when the visible range changes (zoom, day range, new data). */
  onRangeChange?: (range: TimeRange | null) => void;
  /** Called when the hovered time changes; null when the hover ends. */
  onHover?: (info: MeteogramHoverInfo | null) => void;
  /**
   * Own tooltip content: fill `container` (positioned like the standard
   * tooltip). Returning false hides the tooltip.
   */
  renderTooltip?: (info: MeteogramHoverInfo, container: HTMLElement) => boolean | void;
  /** Opens the attribution link instead of the browser (e.g. in a desktop shell). */
  onOpenLink?: (href: string) => void;
  /**
   * Moves the system cursor to screen coordinates (desktop shells), so it
   * stays on the hover line after a wheel zoom. Returns whether it moved.
   */
  warpCursor?: (screenX: number, screenY: number) => boolean | Promise<boolean>;
  /** Called with the warning when the given layout is invalid (default: `console.warn`). */
  onLayoutWarning?: (warning: string) => void;
}

/** What the PNG export needs from a mounted meteogram. */
export interface MeteogramExportSources {
  svg: SVGSVGElement | null;
  textRows: Element[];
  timeLine: ExportTimeLine | null;
  /** Element whose background the image takes. */
  element: HTMLElement;
  /** Theme background, for an element without one. */
  background: string;
  /**
   * Puts the chart on screen back when `svg` is a picture drawn for the export (see `MeteogramExportOptions`): call it
   * right after reading the sources, in the same task, so the browser never paints the swap.
   */
  release?: () => void;
}

/** How the picture of `getExportSources` differs from the chart on screen. */
export interface MeteogramExportOptions {
  /** Render options in place of the chart's own for the picture, e.g. a layout without model headers. */
  render?: Omit<MeteogramRenderOptions, "visibleRange" | "size">;
  /**
   * Least width (CSS px) of a day that the icons (wind arrows, thunderstorm icons) are spaced for. A chart whose days
   * are narrower is laid out as if it were wider and drawn at its own size: the picture shows the icons as densely as
   * a wide chart, only smaller. Default 0: spaced as on screen.
   */
  minDayWidthPx?: number;
}

export interface MeteogramController {
  /** Root element the meteogram put into the given element. */
  readonly element: HTMLElement;
  /** New data and/or options (options replace the previous ones). */
  update(input: MeteogramInput, options?: MeteogramOptions): void;
  /** Measures the chart again (also done by a `ResizeObserver`). */
  resize(): void;
  /** Visible range; null shows everything. */
  setVisibleRange(range: TimeRange | null): void;
  getVisibleRange(): TimeRange | null;
  getMaximumRange(): TimeRange | null;
  /** Shows the given number of days from the start (null: all). */
  setDayRange(days: DayRangeChoice): void;
  /** Day range whose span the visible range equals, if any. */
  getActiveDayRange(): DayRangeChoice | undefined;
  /** Hover at a time (epoch ms), e.g. synchronised from another chart; null ends it. */
  setHover(time: number | null): void;
  getHover(): MeteogramHoverInfo | null;
  /**
   * Measures and places the shown tooltip again, e.g. after a framework
   * filled the `renderTooltip` container later than the callback returned.
   */
  refreshTooltip(): void;
  getScene(): MeteogramScene;
  getExportSources(options?: MeteogramExportOptions): MeteogramExportSources;
  /** Removes the meteogram, its listeners, observers and timers. */
  destroy(): void;
}

/** Minimum time a programmatic cursor move is waited for. */
const CURSOR_WARP_MS = 250;
const NOW_REFRESH_MS = 60_000;

/** Options of the controller itself; all others go to the renderer. */
const CONTROLLER_OPTION_KEYS = [
  "interaction",
  "attribution",
  "centerLabel",
  "tooltipTexts",
  "onRangeChange",
  "onHover",
  "renderTooltip",
  "onOpenLink",
  "warpCursor",
  "onLayoutWarning",
] as const satisfies readonly (keyof MeteogramOptions)[];

const DAY_MS = 24 * HOUR_MS;

/** Inline styles of the chart SVG (also of a picture drawn for the export). */
const SVG_STYLES = {
  display: "block",
  width: "100%",
  height: "auto",
  flex: "1 1 auto",
  "min-height": "0",
  "user-select": "none",
};

const sameRange = (a: TimeRange | null, b: TimeRange | null) =>
  a === b || (!!a && !!b && a.start === b.start && a.end === b.end);

function setStyles(element: HTMLElement | SVGElement, styles: Record<string, string>) {
  for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value);
}

/**
 * Mounts a meteogram into `element` and returns its controller. The element
 * keeps its other content; `destroy()` removes everything this call added.
 */
export function createMeteogram(
  element: HTMLElement,
  input: MeteogramInput,
  options: MeteogramOptions = {},
): MeteogramController {
  const doc = element.ownerDocument;
  const view = doc.defaultView ?? window;

  let currentInput = input;
  let currentOptions = options;
  let destroyed = false;

  let range: TimeRange | null = options.interaction?.initialRange ?? null;
  let chosenDayRange: DayRangeChoice | undefined = options.interaction?.dayRange;
  let rangeInitialised = range !== null;
  let reportedRange: TimeRange | null | undefined;
  let reportedWarning: string | null = null;

  let size: ChartDimensions | null = null;
  let nowMs = Date.now();
  let scene!: MeteogramScene;
  let staticLayer!: VNode;
  let tree: VNode | null = null;
  let svgNode: Element | null = null;
  let labelRow: HTMLElement | null = null;

  let hover: HoverPosition | null = null;
  let hoverInfo: MeteogramHoverInfo | null = null;
  let reportedHover: string | null = null;
  let cursorClientX: number | null = null;
  let popupHiddenByZoom = false;
  let tooltipTimestamp: number | null | undefined;
  let programmaticMove: { timeoutId: number; expiresAt: number; expectedScreenX: number } | null =
    null;

  const interaction = () => currentOptions.interaction ?? {};
  const zoomEnabled = () => interaction().zoom !== false;
  const hoverEnabled = () => interaction().hover !== false;
  const tooltipEnabled = () => hoverEnabled() && interaction().tooltip !== false;
  const keyboardEnabled = () => interaction().keyboard !== false;

  // --- DOM skeleton --------------------------------------------------------

  const root = doc.createElement("div");
  root.className = "graupel-meteogram";
  root.dataset.testid = "meteogram";
  setStyles(root, {
    position: "relative",
    display: "flex",
    "flex-direction": "column",
    width: "100%",
    height: "100%",
    "min-height": "0",
    "box-sizing": "border-box",
  });
  const tooltip = doc.createElement("div");
  tooltip.className = "hover-unified-tooltip";
  tooltip.dataset.testid = "meteogram-tooltip";
  tooltip.setAttribute("role", "tooltip");
  setStyles(tooltip, { ...TOOLTIP_STYLE, display: "none" });
  root.appendChild(tooltip);
  element.appendChild(root);

  // --- listeners (all removed by destroy) -----------------------------------

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions | undefined][] = [];
  const listen = <E extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    listenerOptions?: AddEventListenerOptions,
  ) => {
    const fn = handler as EventListener;
    target.addEventListener(type, fn, listenerOptions);
    listeners.push([target, type, fn, listenerOptions]);
  };

  // --- scene and rendering ---------------------------------------------------

  const renderOptions = (visibleRange: TimeRange | null): MeteogramRenderOptions => {
    const rest: Record<string, unknown> = { ...currentOptions };
    for (const key of CONTROLLER_OPTION_KEYS) delete rest[key];
    return {
      ...(rest as MeteogramRenderOptions),
      now: currentOptions.now ?? nowMs,
      visibleRange,
      ...(size ? { size } : {}),
    };
  };

  const buildScene = () => {
    let next = createMeteogramScene(currentInput, renderOptions(range));
    if (!rangeInitialised && next.maximumRange) {
      rangeInitialised = true;
      if (chosenDayRange !== undefined) {
        range = calculateDayRange(next.maximumRange, chosenDayRange, next.timezone);
        next = createMeteogramScene(currentInput, renderOptions(range));
      }
    }
    // Keep the clamped range, so a later larger maximum does not bring back
    // an old, larger viewport.
    if (next.visibleRange) range = next.visibleRange;
    scene = next;
  };

  const overlayHover = () =>
    hover && hoverEnabled() ? { time: hover.time, timestamp: hover.timestamp } : null;

  const renderSvg = () => {
    const next = renderMeteogramSvg(scene, {
      static: staticLayer,
      overlay: renderOverlayLayer(scene, overlayHover()),
    });
    if (tree && svgNode) {
      svgNode = patch(svgNode, tree, next) as Element;
    } else {
      svgNode = mount(next) as Element;
      setStyles(svgNode as SVGElement, SVG_STYLES);
      root.insertBefore(svgNode, tooltip);
      listen<PointerEvent>(svgNode, "pointermove", onPointerMove);
      listen<PointerEvent>(svgNode, "pointerleave", onPointerLeave);
    }
    tree = next;
  };

  const attributionNode = (): HTMLElement | null => {
    const value =
      currentOptions.attribution === undefined ? OPEN_METEO_ATTRIBUTION : currentOptions.attribution;
    if (!value) return null;
    const attribution = typeof value === "string" ? { text: value } : value;
    const block = doc.createElement("div");
    block.className = "meteogram-attribution";
    block.dataset.testid = "meteogram-attribution";
    setStyles(block, { "white-space": "nowrap", "flex-shrink": "0" });
    const text = doc.createElement("span");
    if (attribution.text) text.append(attribution.text);
    if (attribution.linkText || attribution.href) {
      const link = doc.createElement("a");
      link.textContent = attribution.linkText ?? attribution.href ?? "";
      if (attribution.href) link.href = attribution.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "meteogram-attribution-link";
      setStyles(link, { color: "inherit", "text-decoration": "underline" });
      text.append(link);
    }
    block.append(text);
    return block;
  };

  const renderLabelRow = () => {
    labelRow?.remove();
    labelRow = null;
    const position = scene.layout.showLocationLabel === "top" ? "top" : "bottom";
    const label = scene.locationLabel;
    const attribution = attributionNode();
    const centerText = currentOptions.centerLabel?.trim() ?? "";
    if (!label && !attribution && !centerText) return;
    const row = doc.createElement("div");
    row.className = `meteogram-footer-row${position === "top" ? " meteogram-footer-row--top" : ""}`;
    row.dataset.testid = "meteogram-footer-row";
    setStyles(row, {
      display: "flex",
      "justify-content": "space-between",
      "align-items": "baseline",
      gap: "1rem",
      // Insets of the plot (5 % each by default), so the row lines up with it.
      padding: `2px ${plotInsetPercent(scene.paddingRight, scene.svgWidth)} 3px ${plotInsetPercent(
        scene.paddingLeft,
        scene.svgWidth,
      )}`,
      "font-size": "11px",
      "line-height": "14px",
      color: `var(--graupel-label-color, ${scene.theme.axis.label})`,
      "font-family": scene.fontFamily ?? "inherit",
      "user-select": "none",
      "flex-shrink": "0",
    });
    const labelEl = doc.createElement("span");
    labelEl.className = "meteogram-location-label";
    labelEl.dataset.testid = "meteogram-footer-location";
    setStyles(labelEl, {
      "min-width": "0",
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    });
    if (label) {
      labelEl.textContent = label;
      labelEl.title = label;
    }
    row.append(labelEl);
    if (centerText) {
      // Three parts: both sides share the space equally, so the middle text sits in the centre of the row
      // as long as the sides fit into their halves.
      const center = doc.createElement("span");
      center.className = "meteogram-center-label";
      center.dataset.testid = "meteogram-footer-center";
      center.dataset.exportAlign = "center";
      center.textContent = centerText;
      setStyles(center, { "white-space": "nowrap", "flex-shrink": "0" });
      setStyles(labelEl, { flex: "1 1 0%" });
      row.append(center);
      const end = attribution ?? doc.createElement("span");
      setStyles(end, { flex: "1 0 0%", "text-align": "right" });
      row.append(end);
    } else if (attribution) row.append(attribution);
    root.insertBefore(row, position === "top" ? svgNode : tooltip);
    labelRow = row;
  };

  const reportRange = () => {
    const visible = scene.visibleRange;
    if (reportedRange !== undefined && sameRange(reportedRange, visible)) return;
    reportedRange = visible ? { ...visible } : null;
    currentOptions.onRangeChange?.(reportedRange);
  };

  const reportWarning = () => {
    const warning = scene.layoutWarning;
    if (warning && warning !== reportedWarning) {
      if (currentOptions.onLayoutWarning) currentOptions.onLayoutWarning(warning);
      else console.warn(warning);
    }
    reportedWarning = warning;
  };

  const updateKeyboard = () => {
    if (keyboardEnabled()) {
      root.tabIndex = 0;
      root.setAttribute("role", "group");
      root.setAttribute("aria-label", scene.locationLabel ?? "Meteogram");
    } else {
      root.removeAttribute("tabindex");
      root.removeAttribute("role");
      root.removeAttribute("aria-label");
    }
  };

  /** Full redraw: new scene and static layer, then overlay and tooltip. */
  const renderAll = () => {
    buildScene();
    staticLayer = renderStaticLayer(scene);
    if (hover && !scene.available) hover = null;
    renderSvg();
    renderLabelRow();
    updateKeyboard();
    tooltipTimestamp = undefined;
    refreshHover();
    reportWarning();
    reportRange();
  };

  // --- hover and tooltip -----------------------------------------------------

  const hideTooltip = () => {
    tooltip.style.setProperty("display", "none");
    tooltip.replaceChildren();
    tooltipTimestamp = undefined;
  };

  const placeTooltip = () => {
    if (!hoverInfo || !svgNode) return;
    const rootRect = root.getBoundingClientRect();
    const svgRect = svgNode.getBoundingClientRect();
    const popup = {
      width: tooltip.offsetWidth || tooltip.getBoundingClientRect().width || 220,
      height: tooltip.offsetHeight || tooltip.getBoundingClientRect().height || 230,
    };
    const { top, left } = calculatePopupPosition({
      container: rootRect,
      svg: svgRect,
      popup,
      clientX: cursorClientX,
      hoverX: hoverInfo.x,
      svgWidth: scene.svgWidth,
      dayHeaderBottom: scene.geometry.dayHeaderBottom,
      totalSvgHeight: scene.geometry.totalHeight,
    });
    tooltip.style.setProperty("left", `${left - rootRect.left}px`);
    tooltip.style.setProperty("top", `${top - rootRect.top}px`);
  };

  const updateTooltip = () => {
    if (!tooltipEnabled() || !hoverInfo || popupHiddenByZoom || !hoverInfo.data) {
      hideTooltip();
      return;
    }
    // Text as large as the left axis labels on screen (REQ-487); follows resize and full-screen.
    tooltip.style.setProperty("font-size", tooltipFontSize(scene));
    if (tooltipTimestamp !== hoverInfo.timestamp) {
      tooltip.replaceChildren();
      const shown = currentOptions.renderTooltip
        ? currentOptions.renderTooltip(hoverInfo, tooltip) !== false
        : renderTooltipContent(tooltip, hoverInfo, {
            quantities: scene.quantities,
            theme: scene.theme,
            ...(currentOptions.tooltipTexts ? { texts: currentOptions.tooltipTexts } : {}),
          });
      if (!shown) {
        hideTooltip();
        return;
      }
      tooltipTimestamp = hoverInfo.timestamp;
      tooltip.style.setProperty("display", "block");
    }
    placeTooltip();
  };

  /** Recomputes hover info from `hover` and the scene; reports changes. */
  const refreshHover = () => {
    hoverInfo =
      hover && hoverEnabled() && scene.available
        ? buildHoverInfo(scene, hover, currentInput, currentOptions.availableModels)
        : null;
    updateTooltip();
    const key = hoverInfo ? `${hoverInfo.time}|${hoverInfo.timestamp}` : null;
    if (key !== reportedHover) {
      reportedHover = key;
      currentOptions.onHover?.(hoverInfo);
    }
  };

  const setHoverPosition = (next: HoverPosition | null) => {
    const changed =
      (hover === null) !== (next === null) ||
      (hover && next && (hover.time !== next.time || hover.timestamp !== next.timestamp));
    hover = next;
    if (changed) renderSvg();
    refreshHover();
  };

  const clearProgrammaticMove = () => {
    if (programmaticMove) view.clearTimeout(programmaticMove.timeoutId);
    programmaticMove = null;
  };

  function onPointerMove(event: PointerEvent) {
    if (!hoverEnabled() || !svgNode) return;
    if (programmaticMove) {
      const now = view.performance.now();
      if (
        now <= programmaticMove.expiresAt &&
        Math.abs(event.screenX - programmaticMove.expectedScreenX) <= 2
      ) {
        // The move the cursor warp caused: the hover already sits there.
        clearProgrammaticMove();
        return;
      }
      if (now > programmaticMove.expiresAt) clearProgrammaticMove();
    }
    popupHiddenByZoom = false;
    cursorClientX = event.clientX;
    setHoverPosition(hoverAtPointer(scene, event.clientX, svgNode.getBoundingClientRect()));
  }

  function onPointerLeave() {
    if (programmaticMove && view.performance.now() <= programmaticMove.expiresAt) return;
    popupHiddenByZoom = false;
    cursorClientX = null;
    setHoverPosition(null);
  }

  // --- zoom ----------------------------------------------------------------------

  const applyRange = (next: TimeRange | null) => {
    range = next ? { ...next } : scene.maximumRange ? { ...scene.maximumRange } : null;
    renderAll();
  };

  const zoom = (direction: ZoomDirection, anchor: number | null) => {
    const next = zoomStep(scene, direction, anchor);
    if (next) applyRange(next);
    return next;
  };

  function onWheel(event: WheelEvent) {
    if (!zoomEnabled() || !scene.available || !scene.maximumRange) return;
    const direction = wheelDirection(event);
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    // The tooltip hides while zooming and returns on the next real move.
    popupHiddenByZoom = true;
    const target = event.target instanceof view.Node ? (event.target as Node) : null;
    const insideChart = !!svgNode && !!target && svgNode.contains(target);
    const anchor =
      insideChart && hover && hover.time > scene.timeline.startMs && hover.time < scene.timeline.endMs
        ? hover.time
        : null;
    const previousScene = scene;
    const next = zoom(direction, anchor);
    if (!next) {
      updateTooltip();
      return;
    }
    if (anchor !== null && svgNode && currentOptions.warpCursor) {
      const shift = cursorShiftAfterZoom(
        previousScene,
        next,
        anchor,
        svgNode.getBoundingClientRect().width,
      );
      const expectedScreenX = event.screenX + shift;
      clearProgrammaticMove();
      const timeoutId = view.setTimeout(() => {
        programmaticMove = null;
      }, CURSOR_WARP_MS);
      programmaticMove = {
        expectedScreenX,
        expiresAt: view.performance.now() + CURSOR_WARP_MS,
        timeoutId,
      };
      const settle = (moved: boolean) => {
        if (!moved && programmaticMove?.timeoutId === timeoutId) clearProgrammaticMove();
      };
      try {
        const result = currentOptions.warpCursor(expectedScreenX, event.screenY);
        if (typeof result === "boolean") settle(result);
        else void Promise.resolve(result).then(settle, () => settle(false));
      } catch {
        settle(false);
      }
    }
  }

  // --- keyboard ------------------------------------------------------------------

  const moveHoverBy = (hours: number) => {
    if (!scene.available) return;
    const { startMs, endMs } = scene.timeline;
    const base =
      hover?.timestamp ??
      hover?.time ??
      (scene.currentTimeX !== null ? scene.nowMs - (hours > 0 ? HOUR_MS : 0) : startMs - HOUR_MS);
    const time = Math.min(endMs - 1, Math.max(startMs, base + hours * HOUR_MS));
    popupHiddenByZoom = false;
    cursorClientX = null;
    setHoverPosition(hoverAtTime(scene, time));
  };

  function onKeyDown(event: KeyboardEvent) {
    if (!keyboardEnabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    let handled = true;
    switch (event.key) {
      case "ArrowLeft":
        if (hoverEnabled()) moveHoverBy(-1);
        else handled = false;
        break;
      case "ArrowRight":
        if (hoverEnabled()) moveHoverBy(1);
        else handled = false;
        break;
      case "+":
      case "=":
        if (zoomEnabled()) zoom("in", hover?.time ?? null);
        else handled = false;
        break;
      case "-":
      case "_":
        if (zoomEnabled()) zoom("out", hover?.time ?? null);
        else handled = false;
        break;
      case "0":
        if (zoomEnabled()) applyRange(null);
        else handled = false;
        break;
      case "Escape":
        if (hover) {
          cursorClientX = null;
          setHoverPosition(null);
        } else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  function onClick(event: MouseEvent) {
    const handler = currentOptions.onOpenLink;
    if (!handler) return;
    const target = event.target instanceof view.Element ? (event.target as Element) : null;
    const link = target?.closest("a.meteogram-attribution-link");
    if (!link || !root.contains(link)) return;
    event.preventDefault();
    event.stopPropagation();
    handler(link.getAttribute("href") ?? "");
  }

  // --- timers --------------------------------------------------------------------

  let nowTimer: number | null = null;
  const updateNowTimer = () => {
    const wanted = currentOptions.now === undefined;
    if (wanted && nowTimer === null) {
      nowTimer = view.setInterval(() => {
        nowMs = Date.now();
        renderAll();
      }, NOW_REFRESH_MS);
    } else if (!wanted && nowTimer !== null) {
      view.clearInterval(nowTimer);
      nowTimer = null;
    }
  };

  // --- start -------------------------------------------------------------------------

  renderAll();
  listen<WheelEvent>(root, "wheel", onWheel, { passive: false });
  listen<KeyboardEvent>(root, "keydown", onKeyDown);
  listen<MouseEvent>(root, "click", onClick);
  const sizeObserver: SizeObserver = observeSize(svgNode!, (measured) => {
    size = measured;
    if (!destroyed) renderAll();
  });
  updateNowTimer();

  const exportTimeLine = (scene: MeteogramScene): ExportTimeLine | null => {
    if (!scene.available) return null;
    const generatedMs = currentInput.generatedAt
      ? normalizeTimestamp(currentInput.generatedAt)
      : NaN;
    const lineMs = Number.isFinite(generatedMs) ? generatedMs : scene.nowMs;
    const { timeline, geometry } = scene;
    const inRange = lineMs >= timeline.startMs && lineMs <= timeline.endMs;
    return {
      x: inRange ? timeline.timestampToX(lineMs) : null,
      y1: geometry.dayHeaderTop,
      y2: geometry.plotBottom,
      timestamp: canonicalTimestamp(lineMs),
      stroke: scene.theme.cursor,
    };
  };

  const exportSources = (
    from: MeteogramScene,
    svg: Element | null,
    release?: () => void,
  ): MeteogramExportSources => ({
    svg: svg && from.available ? (svg as SVGSVGElement) : null,
    textRows: labelRow ? [labelRow] : [],
    timeLine: exportTimeLine(from),
    element: root,
    background: from.theme.background,
    ...(release ? { release } : {}),
  });

  /**
   * Sources of a picture that differs from the chart on screen: a second SVG, drawn with the export's render options,
   * takes the chart's place in the page (the chart is hidden) until `release`. Its size is measured there; days
   * narrower than `minDayWidthPx` lay the picture out wider by that factor, scaled back by the viewBox.
   */
  const pictureSources = (options: MeteogramExportOptions): MeteogramExportSources => {
    const live = svgNode;
    const render = options.render ?? {};
    const minDayWidthPx = options.minDayWidthPx ?? 0;
    // How much wider than `width` the picture of `from` is laid out.
    const widening = (from: MeteogramScene, width: number) => {
      const { timeline } = from;
      const span = timeline.endMs - timeline.startMs;
      if (!(width > 0 && span > 0 && minDayWidthPx > 0)) return 1;
      const dayWidthPx = ((timeline.rightX - timeline.leftX) * width * DAY_MS) / (from.svgWidth * span);
      return Math.max(1, minDayWidthPx / dayWidthPx);
    };
    const sameLayout = Object.keys(render).length === 0;
    if (!live || !scene.available || (sameLayout && widening(scene, live.getBoundingClientRect().width) === 1)) {
      return exportSources(scene, live);
    }
    const sceneAt = (sized: ChartDimensions | null) =>
      createMeteogramScene(currentInput, {
        ...renderOptions(range),
        ...render,
        visibleRange: range,
        ...(sized ? { size: sized } : {}),
      });
    const draw = (from: MeteogramScene) => {
      const node = mount(
        renderMeteogramSvg(from, { static: renderStaticLayer(from), overlay: renderOverlayLayer(from, null) }),
      ) as Element;
      setStyles(node as SVGElement, SVG_STYLES);
      return node;
    };
    let picture = sceneAt(size);
    let node = draw(picture);
    const liveDisplay = (live as SVGElement).style.getPropertyValue("display");
    root.insertBefore(node, live);
    (live as SVGElement).style.setProperty("display", "none");
    const release = () => {
      node.remove();
      (live as SVGElement).style.setProperty("display", liveDisplay || SVG_STYLES.display);
    };
    const { width, height } = node.getBoundingClientRect();
    if (width > 0) {
      const factor = widening(picture, width);
      const sized = { width: width * factor, height: height * factor };
      if (!size || sized.width !== size.width || sized.height !== size.height) {
        picture = sceneAt(sized);
        const next = draw(picture);
        node.replaceWith(next);
        node = next;
      }
    }
    return exportSources(picture, picture.available ? node : null, release);
  };

  return {
    element: root,
    update(nextInput, nextOptions) {
      if (destroyed) return;
      currentInput = nextInput;
      if (nextOptions) currentOptions = nextOptions;
      updateNowTimer();
      renderAll();
    },
    resize() {
      if (!destroyed) sizeObserver.measure();
    },
    setVisibleRange(next) {
      if (!destroyed) applyRange(next);
    },
    getVisibleRange: () => (scene.visibleRange ? { ...scene.visibleRange } : null),
    getMaximumRange: () => (scene.maximumRange ? { ...scene.maximumRange } : null),
    setDayRange(days) {
      if (destroyed || !scene.maximumRange) return;
      chosenDayRange = days;
      applyRange(calculateDayRange(scene.maximumRange, days, scene.timezone));
    },
    getActiveDayRange: () =>
      scene.maximumRange && scene.visibleRange
        ? findActiveDayRange(scene.visibleRange, scene.maximumRange, chosenDayRange, scene.timezone)
        : undefined,
    setHover(time) {
      if (destroyed) return;
      cursorClientX = null;
      popupHiddenByZoom = false;
      setHoverPosition(time === null || !scene.available ? null : hoverAtTime(scene, time));
    },
    getHover: () => hoverInfo,
    refreshTooltip() {
      if (!destroyed && hoverInfo && tooltip.style.getPropertyValue("display") !== "none") {
        placeTooltip();
      }
    },
    getScene: () => scene,
    getExportSources: (options) => (options ? pictureSources(options) : exportSources(scene, svgNode)),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [target, type, fn, listenerOptions] of listeners) {
        target.removeEventListener(type, fn, listenerOptions);
      }
      listeners.length = 0;
      sizeObserver.disconnect();
      clearProgrammaticMove();
      if (nowTimer !== null) view.clearInterval(nowTimer);
      nowTimer = null;
      root.remove();
      hover = null;
      hoverInfo = null;
    },
  };
}
