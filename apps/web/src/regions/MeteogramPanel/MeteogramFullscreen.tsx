// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { Meteogram, type MeteogramComponentOptions } from "@graupel/meteogram-react";
import {
  DEFAULT_TOOLTIP_TEXTS,
  MINIMUM_VISIBLE_DURATION_MS,
  ZOOM_BASE_FACTOR,
  clampTimeRange,
  formatTooltipHeaderDate,
  hoverAtPointer,
  wheelDirection,
  type MeteogramChainModel,
  type MeteogramController,
  type MeteogramInput,
  type MeteogramTooltipTexts,
  type TimeRange,
} from "@graupel/meteogram";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Dialog } from "../../dialogs/Dialog.tsx";
import { useT } from "../../i18n/index.ts";
import { useExtremesFontSize } from "../../state/chartFontSize.ts";
import { useCameraSide } from "../../state/phoneLandscape.ts";
import { FullscreenClose, headerCloseReserve } from "./FullscreenClose.tsx";
import { followsVisibleRange } from "./layout.ts";
import { MeteogramImageActions } from "./MeteogramImageActions.tsx";
import { ModelHeaderInfo } from "./ModelHeaderInfo.tsx";
import {
  enterSystemFullscreen,
  exitSystemFullscreen,
  isDoubleTap,
  useBackButtonHold,
  type Tap,
} from "./phoneFullscreen.ts";

export interface MeteogramFullscreenProps {
  input: MeteogramInput;
  /** Options of the embedded chart; the full-screen chart draws in the core's `fullscreen` mode. */
  options: MeteogramComponentOptions;
  /** Range the view opens with; on the desktop the wheel zooms no further out (REQ-636). Null: the whole forecast. */
  visibleRange: TimeRange | null;
  /** Key of the forecast: a new forecast starts a new chart, as in the embedded view. */
  chartKey: string;
  onClose: () => void;
  /** Whether a double-click on the chart closes the view; not on a phone, where taps move the cursor line (REQ-532). */
  closeOnDoubleClick?: boolean;
  /**
   * Whether the view shows the close, copy and save buttons; not on a phone (REQ-537), where turning it back closes the
   * view.
   */
  controls?: boolean;
  /**
   * Tablet (REQ-728): the phone's view without copy and save (`controls` false), but with the close button, closing on
   * Escape and the back button as well, since a turn does not close it there. The close button has no column of its
   * own: it stands in the last model header or before the place name below the chart (REQ-750). Default false.
   */
  closable?: boolean;
}

/** Class on `<html>` while the full-screen view is open: the page behind can not scroll (REQ-530). */
export const SCROLL_LOCK_CLASS = "meteogram-fullscreen-open";

/**
 * Locks the page behind the open view (REQ-530): the modal dialog covers the viewport, but a swipe on it would still
 * scroll the page below and show its scroll bar (iOS shows it over the view). The page keeps its place: the scroll
 * position is put back on closing.
 */
function useDocumentScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    const { scrollX, scrollY } = window;
    root.classList.add(SCROLL_LOCK_CLASS);
    return () => {
      root.classList.remove(SCROLL_LOCK_CLASS);
      if (typeof window.scrollTo === "function") {
        try {
          window.scrollTo(scrollX, scrollY);
        } catch {
          // jsdom has no scrolling.
        }
      }
    };
  }, []);
}

/**
 * The meteogram on the whole screen (REQ-454), on the modal Dialog without title bar and dividers (REQ-460): the title
 * is only its accessible name; the close button, with the copy and save buttons below it (REQ-461), sits in a narrow
 * column at the side and gets the focus, and the focus goes back on closing. Closes on the close button, Escape and a
 * double-click on the chart (not on a phone, REQ-532). On a phone it has no buttons at all (REQ-537): only turning it
 * back to portrait closes it. On a tablet only the close button, without a column: in the last model header or before
 * the place name below the chart (REQ-750). It fits the screen without scroll bars (REQ-530): the chart
 * shrinks to the width there, and the page behind is locked.
 * @graupel/meteogram-react has no full-screen view of its own, only the core's `fullscreen` render mode.
 */
/**
 * A tap puts the cursor line and the tooltip at the tapped time (REQ-531): the chart follows the pointer only while it
 * moves, and a touch pointer leaves the chart when the finger lifts (Chromium also ends a moving touch for scrolling),
 * so without this a tap shows nothing. A mouse click is left to the chart, which already follows the mouse.
 */
function showHoverAtTap(controller: MeteogramController | null, event: MouseEvent<HTMLElement>) {
  const pointerType = (event.nativeEvent as Partial<PointerEvent>).pointerType;
  if (!controller || pointerType === "mouse" || event.detail === 0) return;
  const svg = controller.element.querySelector("svg.meteogram-svg-integrated");
  if (!svg || !(event.target instanceof Node) || !svg.contains(event.target)) return;
  const position = hoverAtPointer(controller.getScene(), event.clientX, svg.getBoundingClientRect());
  controller.setHover(position ? position.time : null);
}

/** CSS property that sizes the whole tooltip box: every text and spacing in it is in em (@graupel/meteogram). */
const TOOLTIP_FONT_SIZE = "--graupel-tooltip-font-size";
/** CSS properties with the side bar's content width and side padding (REQ-584): in em while fitting, then in px. */
const SIDE_BAR_WIDTH = "--side-bar-width";
const SIDE_BAR_PADDING = "--side-bar-padding";
/** Padding at the side bar's sides in em, as in the tooltip (@graupel/meteogram); a notch's inset comes on top. */
const SIDE_BAR_PADDING_EM = 0.95;

/** Largest font size of the side bar, as a multiple of the tooltip's own (REQ-576): a sparse domain has few rows. */
export const SIDE_BAR_MAX_SCALE = 2.5;

/** Largest width of the side bar, as a part of the screen's width; a notch's inset comes on top (REQ-584). */
export const SIDE_BAR_MAX_WIDTH = 1 / 4;

/**
 * Long values of the side bar's rows (REQ-584): every label stands on one line with its value (REQ-588), and the bar is
 * as wide as the widest of them next to its label, so the values of other time points fit as well, e.g. "Temperatur:
 * -21.5 °C", "Richtung: 337° NNW" or "Niederschl.: 12.5 mm". Wide digits, a minus sign and the widest direction.
 */
const SIDE_BAR_SAMPLE_VALUES: Readonly<Partial<Record<keyof MeteogramTooltipTexts, string>>> = {
  temperature: "-88.8 °C",
  apparentTemperature: "-88.8 °C",
  windSpeed: "188.8 km/h",
  windGusts: "188.8 km/h",
  windDirection: "888° WNW",
  precipitationProbability: "100 %",
  precipitation: "88.8 mm",
  accumulated: "888.8 mm",
  snowfall: "88.8 cm",
  snowDepth: "8.88 m",
  accumulatedSnowfall: "888.8 cm",
};

/** Lines the side bar's width is measured from (REQ-584, REQ-588): its rows and its date, each at a long value. */
export interface SideBarWidthSamples {
  /** Every row the bar can show, as label and long value. */
  rows: (readonly [label: string, value: string])[];
  /** The date with every weekday, two-digit day, month and time in wide digits. */
  headers: string[];
}

/**
 * What the side bar's width is measured from (REQ-584, REQ-588): every row with its long value next to its label, the
 * long labels too, and the date of every weekday with wide digits, so a later date does not wrap either. The model name
 * is left out, it is fitted to the width (sideBarModelName); so is the run, which in its smaller font is shorter than
 * the rows (were it longer, it would end in "…").
 */
export function sideBarWidthSamples(texts: MeteogramTooltipTexts, locale?: string): SideBarWidthSamples {
  const rows = Object.entries(SIDE_BAR_SAMPLE_VALUES).map(
    ([name, value]) => [texts[name as keyof MeteogramTooltipTexts], value] as const,
  );
  // A week from 20 December: two-digit days of a two-digit month, written as the tooltip writes its date
  // (@graupel/meteogram), then every digit an 8.
  const headers = Array.from({ length: 7 }, (_, day) => {
    const date = formatTooltipHeaderDate(new Date(Date.UTC(2026, 11, 20 + day, 12)), "UTC", locale || undefined);
    return `${date} — 88:88`.replace(/\d/gu, "8");
  });
  return { rows, headers };
}

/**
 * Model name of the side bar on one line (REQ-588): the full name when it `fits`, else the short one of the model
 * catalogue, else the short one (or the full one without it) cut at the end with "…", as long as it fits.
 */
export function sideBarModelName(
  full: string,
  short: string | null | undefined,
  fits: (text: string) => boolean,
): string {
  if (fits(full)) return full;
  const name = short?.trim() || full;
  if (name !== full && fits(name)) return name;
  const letters = [...name];
  const cut = (length: number) => `${letters.slice(0, length).join("").trimEnd()}…`;
  // The longest start that fits with the ellipsis; at least the first letter.
  let low = 1;
  let high = letters.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(cut(middle))) low = middle;
    else high = middle - 1;
  }
  return letters.length > 1 ? cut(low) : name;
}

/** Short names of the chain's models from the model catalogue (`short_name`), by the name the tooltip shows. */
export function modelShortNames(chain: readonly MeteogramChainModel[]): Map<string, string> {
  return new Map(chain.flatMap(({ model, shortName }) => (shortName ? [[model, shortName] as const] : [])));
}

/**
 * Font size (px) of the side bar (REQ-576, REQ-584): its content fills the height `available`, from the height it
 * `needs` at the tooltip's own font size `base` (all sizes in the box are in em, so its content grows with the font
 * size); at least `base`, at most SIDE_BAR_MAX_SCALE times it, and no larger than `widest`, the size at which the bar
 * reaches its largest width (sideBarWidestFontSize). Rounded down to 0.1 px.
 */
export function sideBarFontSize(base: number, needed: number, available: number, widest = Infinity): number {
  if (!(base > 0)) return base;
  let size = base;
  if (needed > 0 && available > 0) {
    size = Math.max(base, Math.floor(Math.min(base * SIDE_BAR_MAX_SCALE, (base * available) / needed) * 10) / 10);
  }
  return widest > 0 ? Math.min(size, Math.floor(widest * 10) / 10) : size;
}

/**
 * Largest font size (px) of the side bar by its width (REQ-584): the content's `width` (em) with the padding at both
 * sides and the `border` (px) take at most SIDE_BAR_MAX_WIDTH of the `screen`'s width (px).
 */
export function sideBarWidestFontSize(screen: number, width: number, border = 0): number {
  return (screen * SIDE_BAR_MAX_WIDTH - border) / (width + 2 * SIDE_BAR_PADDING_EM);
}

/**
 * Font size (px) of the side bar after its rows changed while the view is open (REQ-584): smaller when the content
 * `needs` more than the `available` height at the `current` size, but not below `least`; never larger, so the text
 * changes at most once while the finger moves and the width not at all.
 */
export function shrunkSideBarFontSize(current: number, needed: number, available: number, least = 0): number {
  if (!(current > 0) || !(available > 0) || !(needed > available) || current <= least) return current;
  const scaled = Math.floor(((current * available) / needed) * 10) / 10;
  return Math.max(least, scaled < current ? scaled : Math.round(current * 10 - 1) / 10);
}

/** Height (px) the side bar's content takes with the padding; the bar itself is as high as the screen (REQ-557). */
function neededHeight(tooltip: HTMLElement): number {
  const last = tooltip.lastElementChild;
  if (!last) return 0;
  const top = tooltip.getBoundingClientRect().top;
  return last.getBoundingClientRect().bottom - top + parseFloat(getComputedStyle(tooltip).paddingBottom);
}

/**
 * Width (px) of the side bar's content at its current font size (REQ-584, REQ-588): its widest line, with every row and
 * the date at a long value (sideBarWidthSamples). Measured on copies of the first row and of the date, taken out again;
 * the model name and the run do not count (MeteogramPanel.css).
 */
export function sideBarContentWidth(tooltip: HTMLElement, samples: SideBarWidthSamples): number {
  tooltip.style.removeProperty(SIDE_BAR_WIDTH);
  const added: Element[] = [];
  /** Copies of `template` after it, the texts of its `parts` (in their order) set to each of `texts`. */
  const addCopies = (template: Element | null, parts: string, texts: readonly (readonly string[])[]) => {
    if (!template) return;
    const copies = texts.flatMap((text) => {
      const copy = template.cloneNode(true) as Element;
      const elements = copy.querySelectorAll(parts);
      if (elements.length !== text.length) return [];
      text.forEach((value, index) => (elements[index]!.textContent = value));
      return [copy];
    });
    template.after(...copies);
    added.push(...copies);
  };
  addCopies(tooltip.querySelector(".tooltip-row"), ".label, .val", samples.rows);
  addCopies(tooltip.querySelector(".tooltip-header"), "strong", samples.headers.map((header) => [header]));
  // Without a set width the bar is as wide as its content (MeteogramPanel.css).
  const width = parseFloat(getComputedStyle(tooltip).width);
  for (const copy of added) copy.remove();
  return width;
}

/** Shrinks the side bar's font when its content no longer fits the height (REQ-584); returns the new size. */
function shrinkSideBar(tooltip: HTMLElement, size: number, least: number): number {
  // Borders and rounded line heights do not shrink with the font: checked again.
  for (let step = 0; step < 3; step++) {
    const next = shrunkSideBarFontSize(size, neededHeight(tooltip), tooltip.clientHeight, least);
    if (next === size) break;
    size = next;
    tooltip.style.setProperty(TOOLTIP_FONT_SIZE, `${size}px`);
  }
  return size;
}

/**
 * Fits the side bar to the screen (REQ-576, REQ-584): its width and font size. With its width in em the whole box
 * scales with the font size, so the size that fills the height is measured at the tooltip's own size and scaled, but
 * only as large as SIDE_BAR_MAX_WIDTH allows. The width and the side padding are then fixed in px, measured at that
 * size: when the font shrinks later for more rows, the bar keeps its width. Returns the font size and the smallest it
 * may shrink to: the tooltip's own (REQ-576), unless the width already needs a smaller one; then as far as the height
 * needs.
 */
function fitSideBar(tooltip: HTMLElement, samples: SideBarWidthSamples) {
  const { style } = tooltip;
  for (const name of [TOOLTIP_FONT_SIZE, SIDE_BAR_WIDTH, SIDE_BAR_PADDING]) style.removeProperty(name);
  const computed = getComputedStyle(tooltip);
  const base = parseFloat(computed.fontSize);
  // A px more for rounding the width up below.
  const border = parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth) + 1;
  const widest = (width: number, size: number) => sideBarWidestFontSize(window.innerWidth, width / size, border);
  let width = sideBarContentWidth(tooltip, samples);
  style.setProperty(SIDE_BAR_WIDTH, `${width / base}em`);
  let size = sideBarFontSize(base, neededHeight(tooltip), tooltip.clientHeight, widest(width, base));
  style.setProperty(TOOLTIP_FONT_SIZE, `${size}px`);
  width = sideBarContentWidth(tooltip, samples);
  // Text does not grow exactly with the font size: measured again at the new size, which may still be too wide.
  const narrower = Math.floor(widest(width, size) * 10) / 10;
  if (narrower < size) {
    size = narrower;
    style.setProperty(TOOLTIP_FONT_SIZE, `${size}px`);
    width = sideBarContentWidth(tooltip, samples);
  }
  style.setProperty(SIDE_BAR_WIDTH, `${Math.ceil(width)}px`);
  style.setProperty(SIDE_BAR_PADDING, `${SIDE_BAR_PADDING_EM * size}px`);
  const least = size < base ? 0 : base;
  return { size: shrinkSideBar(tooltip, size, least), least };
}

/**
 * Puts the side bar's model name on one line (REQ-588): the full name, the short one or a cut one (sideBarModelName),
 * measured against the bar's width. `fullNames` keeps the full name of a name already shortened.
 */
function fitModelName(tooltip: HTMLElement, shortNames: ReadonlyMap<string, string>, fullNames: WeakMap<Text, string>) {
  const title = tooltip.querySelector(".tooltip-section-title");
  const name = title?.firstChild;
  if (!title || !(name instanceof Text)) return;
  const range = document.createRange();
  // jsdom has no layout.
  if (typeof range.getBoundingClientRect !== "function") return;
  let full = fullNames.get(name);
  if (full === undefined) fullNames.set(name, (full = name.data));
  const available = title.getBoundingClientRect().width;
  const fits = (text: string) => {
    if (name.data !== text) name.data = text;
    range.selectNodeContents(name);
    return range.getBoundingClientRect().width <= available;
  };
  const text = sideBarModelName(full, shortNames.get(full), fits);
  if (name.data !== text) name.data = text;
}

/**
 * On a phone the tooltip is a side bar at the screen's edge over the whole height (REQ-557). The chart places the
 * tooltip on the side away from the pointer; this marks that side on it (`data-side`), the stylesheet puts it at that
 * edge. Every label stands on one line with its value and nothing wraps (REQ-588); a model name too long for the width
 * gives way to its short name from the `chain`. The bar's width and font size are fitted when it first shows and when
 * the screen's size changes (or the tooltip's own font size, the chart's); while the finger moves the width stays, and
 * the font only shrinks when a row more no longer fits the height (REQ-576, REQ-584).
 */
function useSideBar(
  scrollRef: RefObject<HTMLElement | null>,
  texts: Partial<MeteogramTooltipTexts> | undefined,
  locale: string | undefined,
  chain: readonly MeteogramChainModel[],
  enabled: boolean,
) {
  // Read at each update: a new forecast of the same chart keeps the bar's width and font.
  const shortNames = useRef<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    shortNames.current = modelShortNames(chain);
  }, [chain]);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!enabled || !scroll || typeof MutationObserver === "undefined") return;
    const samples = sideBarWidthSamples({ ...DEFAULT_TOOLTIP_TEXTS, ...texts }, locale);
    const fullNames = new WeakMap<Text, string>();
    // What the bar was fitted to: the screen's size and the tooltip's own font size (the chart's).
    const fitKey = (tooltip: HTMLElement) =>
      `${window.innerWidth}x${tooltip.clientHeight}|${tooltip.style.getPropertyValue("font-size")}`;
    let fitted: { tooltip: HTMLElement; key: string; size: number; least: number } | null = null;
    const update = () => {
      const tooltip = scroll.querySelector<HTMLElement>(".hover-unified-tooltip");
      if (!tooltip) return;
      const side = parseFloat(tooltip.style.left || "0") < scroll.clientWidth / 2 ? "left" : "right";
      if (tooltip.dataset.side !== side) tooltip.dataset.side = side;
      if (tooltip.style.display === "none") return;
      const key = fitKey(tooltip);
      if (fitted?.tooltip !== tooltip || fitted.key !== key) {
        fitted = { tooltip, key, ...fitSideBar(tooltip, samples) };
      } else {
        fitted.size = shrinkSideBar(tooltip, fitted.size, fitted.least);
      }
      fitModelName(tooltip, shortNames.current, fullNames);
      // The bar's own changes need no update.
      observer.takeRecords();
    };
    const observer = new MutationObserver(update);
    observer.observe(scroll, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [scrollRef, texts, locale, enabled]);
}

/** Shortest time span a pinch zooms in to (REQ-563). */
export const PINCH_MIN_SPAN_MS = 6 * 3_600_000;

/**
 * Two fingers zoom the time axis (REQ-563): the times under the fingers stay under them, so spreading zooms in,
 * pinching zooms out and moving both pans; the height stays. From the range the view opened with (`bounds`) down to
 * PINCH_MIN_SPAN_MS. The browser's own page zoom is held back. One finger keeps placing the cursor line (REQ-531).
 *
 * While the fingers move, the precipitation and wind axes stay as they were when the gesture began, and adapt to the
 * new range once it ends (DEC-061, REQ-656): `holdAxes` gets the range at the start (drawn before the first move) and
 * null at the end. Only with `holdAxes` set, i.e. while the axes follow the visible range at all.
 */
function usePinchZoom(
  scrollRef: RefObject<HTMLElement | null>,
  meteogram: RefObject<MeteogramController | null>,
  bounds: TimeRange | null,
  enabled: boolean,
  holdAxes: ((range: TimeRange | null) => void) | null,
) {
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!enabled || !scroll) return;
    let gesture: { t1: number; t2: number } | null = null;
    // A move bubbles from its target to the page, where it is heard as well: handled once.
    let handled: TouchEvent | null = null;
    const svgX = (controller: MeteogramController, clientX: number) => {
      const svg = controller.element.querySelector("svg.meteogram-svg-integrated");
      const rect = svg?.getBoundingClientRect();
      if (!rect || !(rect.width > 0)) return null;
      return ((clientX - rect.left) / rect.width) * controller.getScene().svgWidth;
    };
    // A touch stays with the element it started on, even after the redraw took that element out of the page: its moves
    // and its end are heard there, not only where they bubble to.
    const targets = new Set<EventTarget>();
    const listen = (target: EventTarget | null) => {
      if (!target || targets.has(target)) return;
      targets.add(target);
      target.addEventListener("touchmove", onTouchMove as EventListener, { passive: false });
      target.addEventListener("touchend", onTouchEnd as EventListener);
      target.addEventListener("touchcancel", onTouchEnd as EventListener);
    };
    const unlisten = () => {
      for (const target of targets) {
        target.removeEventListener("touchmove", onTouchMove as EventListener);
        target.removeEventListener("touchend", onTouchEnd as EventListener);
        target.removeEventListener("touchcancel", onTouchEnd as EventListener);
      }
      targets.clear();
    };
    const onTouchStart = (event: TouchEvent) => {
      listen(event.target);
      const controller = meteogram.current;
      if (event.touches.length !== 2 || !controller) return;
      const scene = controller.getScene();
      const x1 = svgX(controller, event.touches[0]!.clientX);
      const x2 = svgX(controller, event.touches[1]!.clientX);
      if (!scene.available || x1 === null || x2 === null) return;
      gesture = { t1: scene.timeline.xToTimestamp(x1, false), t2: scene.timeline.xToTimestamp(x2, false) };
      controller.setHover(null);
      // Drawn at once, so the first move already keeps the axes.
      const held = scene.visibleRange ?? scene.maximumRange;
      if (holdAxes && held) flushSync(() => holdAxes({ ...held }));
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2 || !gesture || handled === event) return;
      handled = event;
      event.preventDefault();
      const controller = meteogram.current;
      if (!gesture || !controller) return;
      const scene = controller.getScene();
      const limits = bounds ?? scene.maximumRange;
      const x1 = svgX(controller, event.touches[0]!.clientX);
      const x2 = svgX(controller, event.touches[1]!.clientX);
      if (!limits || x1 === null || x2 === null || Math.abs(x2 - x1) < 1) return;
      const { timeline } = scene;
      const left = timeline.timestampToX(timeline.startMs);
      const width = timeline.timestampToX(timeline.endMs) - left;
      if (!(width > 0)) return;
      const maxSpan = limits.end - limits.start;
      const span = Math.min(maxSpan, Math.max(PINCH_MIN_SPAN_MS, ((gesture.t2 - gesture.t1) * width) / (x2 - x1)));
      const wanted = gesture.t1 - ((x1 - left) / width) * span;
      const start = Math.min(limits.end - span, Math.max(limits.start, wanted));
      controller.setVisibleRange({ start, end: start + span });
      controller.setHover(null);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2 && gesture) {
        gesture = null;
        // The axes adapt to the range the gesture left.
        holdAxes?.(null);
      }
      if (event.touches.length === 0) unlisten();
    };
    // Safari's own pinch gesture.
    const onGesture = (event: Event) => event.preventDefault();
    scroll.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    scroll.addEventListener("gesturestart", onGesture);
    scroll.addEventListener("gesturechange", onGesture);
    return () => {
      scroll.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      scroll.removeEventListener("gesturestart", onGesture);
      scroll.removeEventListener("gesturechange", onGesture);
      unlisten();
    };
  }, [scrollRef, meteogram, bounds, enabled, holdAxes]);
}

/**
 * Visible range after one zoom step of the wheel or a zoom key on the desktop (REQ-636): the span shrinks or grows by
 * the core's step (`ZOOM_BASE_FACTOR`), from `bounds` (the range the view
 * opened with) down to `MINIMUM_VISIBLE_DURATION_MS`. The time `anchor` (under the mouse pointer) stays where it is on
 * the axis, so the pointer stays on it (a page cannot move the pointer itself). Without
 * an anchor inside the range the start stays, as in the core. The range stays within `bounds`.
 */
export function zoomedRange(
  range: TimeRange,
  bounds: TimeRange,
  direction: "in" | "out",
  anchor: number | null,
): TimeRange {
  const maxSpan = bounds.end - bounds.start;
  if (!(maxSpan > 0)) return range;
  const current = clampTimeRange(range, bounds);
  const span = current.end - current.start;
  const minSpan = Math.min(MINIMUM_VISIBLE_DURATION_MS, maxSpan);
  const next =
    direction === "in"
      ? Math.min(span, Math.max(minSpan, span * ZOOM_BASE_FACTOR))
      : Math.min(maxSpan, span / ZOOM_BASE_FACTOR);
  const at = anchor !== null && anchor > current.start && anchor < current.end ? anchor : current.start;
  const wanted = at - ((at - current.start) / span) * next;
  const start = Math.min(bounds.end - next, Math.max(bounds.start, wanted));
  return { start, end: start + next };
}

/**
 * The mouse wheel and the zoom keys zoom the time axis in the desktop's full-screen view (REQ-636): the wheel at the mouse pointer, `+` and `-` at the cursor line (else from the start), `0` back to the range the
 * view opened with (`bounds`, else the whole forecast). It zooms no further out than that range. The core's own zoom
 * stays off: it would zoom out to the whole forecast. Every step draws the chart anew, so the precipitation and wind
 * axes follow it when the settings say so (REQ-656, DEC-061: after each step; nothing is held).
 */
function useWheelZoom(
  scrollRef: RefObject<HTMLElement | null>,
  meteogram: RefObject<MeteogramController | null>,
  bounds: TimeRange | null,
  enabled: boolean,
) {
  // Compared by its bounds, not by object identity.
  const from = bounds?.start ?? null;
  const to = bounds?.end ?? null;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!enabled || !scroll) return;
    /** The chart, its scene and the range it may show, while it has data. */
    const chart = () => {
      const controller = meteogram.current;
      const scene = controller?.getScene();
      if (!controller || !scene?.available || !scene.maximumRange) return null;
      const limits =
        from !== null && to !== null ? clampTimeRange({ start: from, end: to }, scene.maximumRange) : scene.maximumRange;
      return { controller, scene, limits };
    };
    const step = (direction: "in" | "out", anchor: number | null) => {
      const shown = chart();
      if (!shown) return;
      const { timeline } = shown.scene;
      const range = { start: timeline.startMs, end: timeline.endMs };
      const next = zoomedRange(range, shown.limits, direction, anchor);
      if (next.start !== range.start || next.end !== range.end) shown.controller.setVisibleRange(next);
    };
    const onWheel = (event: WheelEvent) => {
      const direction = wheelDirection(event);
      const shown = chart();
      if (!direction || !shown) return;
      // Neither the page nor the browser's zoom (a pinch on a touchpad comes as a wheel with Ctrl).
      event.preventDefault();
      const svg = shown.controller.element.querySelector("svg.meteogram-svg-integrated");
      const rect = svg?.getBoundingClientRect();
      // Over the plot, also over the info buttons laid over the model headers (REQ-643).
      const anchor =
        rect && event.clientY >= rect.top && event.clientY <= rect.bottom
          ? (hoverAtPointer(shown.scene, event.clientX, rect)?.time ?? null)
          : null;
      step(direction, anchor);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const shown = chart();
      if (!shown) return;
      const hover = shown.controller.getHover()?.time ?? null;
      if (event.key === "+" || event.key === "=") step("in", hover);
      else if (event.key === "-" || event.key === "_") step("out", hover);
      else if (event.key === "0") shown.controller.setVisibleRange({ ...shown.limits });
      else return;
      event.preventDefault();
    };
    scroll.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      scroll.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [scrollRef, meteogram, from, to, enabled]);
}

/**
 * A double tap in the phone's view zooms back out to the range the view opened with, as far as two fingers zoom out
 * (REQ-715, REQ-563): `onClick` gets every tap and tells whether it was the second of a double tap and reset the zoom.
 * A mouse click and a click without a pointer (keyboard) do not count.
 */
function useDoubleTapReset(meteogram: RefObject<MeteogramController | null>, bounds: TimeRange | null) {
  const last = useRef<Tap | null>(null);
  return (event: MouseEvent<HTMLElement>) => {
    const pointerType = (event.nativeEvent as Partial<PointerEvent>).pointerType;
    if (pointerType === "mouse" || event.detail === 0) return;
    const tap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    if (!isDoubleTap(last.current, tap)) {
      last.current = tap;
      return;
    }
    // A third tap starts anew.
    last.current = null;
    const controller = meteogram.current;
    const scene = controller?.getScene();
    const range = bounds ?? scene?.maximumRange;
    if (!controller || !scene?.available || !range) return;
    const { timeline } = scene;
    if (timeline.startMs !== range.start || timeline.endMs !== range.end) controller.setVisibleRange({ ...range });
  };
}

/**
 * The browser's own full screen around the phone's view (REQ-717, DEC-089): asked for on opening and again on every
 * tap, since Android's back button leaves it first and the browser only grants it after a touch; left on closing.
 */
function useSystemFullscreen(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    enterSystemFullscreen();
    return exitSystemFullscreen;
  }, [enabled]);
  return enabled ? enterSystemFullscreen : undefined;
}

export function MeteogramFullscreen({
  input,
  options,
  visibleRange,
  chartKey,
  onClose,
  closeOnDoubleClick = true,
  controls = true,
  closable = false,
}: MeteogramFullscreenProps) {
  const t = useT();
  useDocumentScrollLock();
  // Range the precipitation and wind axes are held at while two fingers move the chart (DEC-061, REQ-656).
  const [axisRangeFrom, setAxisRangeFrom] = useState<TimeRange | null>(null);
  const fullscreenOptions = useMemo<MeteogramComponentOptions>(
    () => ({ ...options, mode: "fullscreen", ...(axisRangeFrom ? { axisRangeFrom } : {}) }),
    [options, axisRangeFrom],
  );
  const meteogram = useRef<MeteogramController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The tablet's close button, laid over the chart (REQ-750), gets the focus on opening.
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const overlaidClose = closable && !controls;
  useSideBar(scrollRef, options.tooltipTexts, options.locale, input.chain, !controls);
  // The axes follow the visible range unless the settings turned it off (REQ-656); only then is there anything to hold.
  // The setting is a value of the layout's switches (REQ-661).
  const holdAxes = followsVisibleRange(options.toggles) ? setAxisRangeFrom : null;
  usePinchZoom(scrollRef, meteogram, visibleRange, !controls, holdAxes);
  // On the desktop the mouse wheel and the zoom keys zoom, no further out than the range the view opened with (REQ-636).
  useWheelZoom(scrollRef, meteogram, visibleRange, controls);
  // On a phone the row below the chart is as large as the temperature extremes in it (REQ-587).
  useExtremesFontSize(meteogram, !controls, chartKey);
  // On a phone a double tap zooms back out (REQ-715), the back button keeps the view open (REQ-716) and the browser
  // hides its bars where it can (REQ-717). On a tablet, which no turn closes, the back button closes it (REQ-728).
  const resetOnDoubleTap = useDoubleTapReset(meteogram, visibleRange);
  const held = !controls && !closable;
  useBackButtonHold(held);
  const requestSystemFullscreen = useSystemFullscreen(!controls);
  // On a phone the chart keeps clear of the camera only on its side and reaches the screen's other edge (REQ-606).
  const camera = useCameraSide();
  const cameraClass = camera ? [`meteogram-fullscreen--camera-${camera}`] : [];
  const phoneClasses = [
    "meteogram-fullscreen--no-controls",
    ...(closable ? ["meteogram-fullscreen--closable"] : []),
    ...cameraClass,
  ];
  const className = ["meteogram-fullscreen", ...(controls ? [] : phoneClasses)].join(" ");
  return (
    <Dialog
      title={t("meteogram.fullscreen.title")}
      onClose={onClose}
      className={className}
      bare
      closeButton={controls}
      initialFocus={overlaidClose ? closeRef : undefined}
      holdOpen={held}
      tools={controls ? <MeteogramImageActions meteogram={meteogram} input={input} placement="fullscreen" /> : undefined}
    >
      <div
        ref={scrollRef}
        className="meteogram-fullscreen__scroll"
        data-testid="meteogram-fullscreen"
        onDoubleClick={closeOnDoubleClick ? onClose : undefined}
        onClick={(event) => {
          showHoverAtTap(meteogram.current, event);
          if (controls) return;
          requestSystemFullscreen?.();
          resetOnDoubleTap(event);
        }}
      >
        {overlaidClose && <FullscreenClose buttonRef={closeRef} onClose={onClose} />}
        <Meteogram
          key={chartKey}
          ref={meteogram}
          className="meteogram-fullscreen__chart"
          input={input}
          options={fullscreenOptions}
          visibleRange={visibleRange}
        />
        {/* While the weather chain is hidden: info buttons in the model headers, also here (REQ-643). */}
        <ModelHeaderInfo
          containerRef={scrollRef}
          chain={input.chain}
          reserveEnd={overlaidClose ? headerCloseReserve : undefined}
        />
      </div>
    </Dialog>
  );
}
