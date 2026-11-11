// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Close button of the tablet's full-screen view (REQ-750): no column of its own beside the chart, which reaches the
 * screen's right edge. With model headers it stands in the right corner of the last model header: the rightmost header
 * box. The full-screen chart is as wide as the screen and draws only its visible range, so that is the box that ends at
 * the plot's right edge; after a pinch zoomed or moved the chart it is the header shown there then, and the button
 * follows it. Where it would overlap the header's heading there (the model's name with its run, and its info button),
 * as in a short last header with its name centred, it stands just 1 px from the screen's right edge instead (REQ-754).
 * Without model headers it stands in the row below the chart, left of the place name with a small gap: the row moves
 * right by the button and the gap, and a place name too long for the rest of the row ends in "…" (the core sets
 * `text-overflow: ellipsis` on it). The button is HTML laid over the chart, placed at the core's header shapes
 * (`model-header-shape`, the heading measured from `model-header-label`) or the row's place name
 * (`meteogram-footer-location`) and placed again whenever the chart redraws. It is not part of the SVG, so the copied
 * or saved image has none.
 */
import { useLayoutEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { useT } from "../../i18n/index.ts";
import { CloseIcon } from "../../icons/index.ts";
import type { Box } from "./ModelHeaderInfo.tsx";

/** Largest icon (CSS px). */
const MAX_SIZE_PX = 24;
/** Smallest icon (CSS px): in a low header or a small row the button gets smaller, down to this. */
const MIN_SIZE_PX = 12;
/** Share of the header's height the icon takes; the rest is the margin above, below and at the right. */
const HEADER_SHARE = 0.7;
/** Distance to the screen's right edge of a button that would overlap the header's heading in its corner (REQ-754). */
const EDGE_GAP_PX = 1;
/** Least free space between the button in the header's corner and the heading before it (px, REQ-754). */
const HEADING_CLEARANCE_PX = 2;

/** CSS property on the chart's container: room the row below the chart leaves for the button at its start (px). */
export const CLOSE_ROOM = "--fullscreen-close-room";

/** Where the close button stands, relative to the container it is placed in. */
export interface ClosePlacement {
  /** In the last model header, in the row below the chart before the place name, or (neither drawn) the top corner. */
  where: "header" | "footer" | "corner";
  left: number;
  top: number;
  size: number;
  /** Colour of the text beside it (the model's name, the place name), taken by the icon. */
  color: string | null;
  /** In the header, moved to 1 px from the screen's right edge, clear of the heading (REQ-754). */
  atEdge?: true;
}

/** What the button in the last header keeps clear of, if it can (REQ-754). */
export interface HeaderHeading {
  /** The heading's box (headerHeading); null: nothing to keep clear of. */
  heading: Box | null;
  /** The screen's right edge in viewport pixels. */
  edge: number;
}

const round = (value: number) => Math.round(value * 10) / 10;
const clampSize = (value: number) => Math.round(Math.min(MAX_SIZE_PX, Math.max(MIN_SIZE_PX, value)));

/** Size of the button in a model header `height` px high (REQ-750). */
export function headerCloseSize(height: number): number {
  return clampSize(height * HEADER_SHARE);
}

/**
 * Room at the right end of the last model header that the close button takes (REQ-750), from the header's right edge:
 * the button and its margin there. The header's info button keeps clear of it (ModelHeaderInfo).
 */
export function headerCloseReserve(height: number): number {
  const size = headerCloseSize(height);
  return size + Math.max(0, (height - size) / 2);
}

/** The rightmost of the model header boxes, the last one on screen; the narrower one when two end together. */
export function lastHeader<T extends Box>(headers: readonly T[]): T | null {
  let last: T | null = null;
  for (const box of headers) {
    if (box.right - box.left <= 0 || box.bottom - box.top <= 0) continue;
    if (!last || box.right > last.right + 0.5 || (Math.abs(box.right - last.right) <= 0.5 && box.left > last.left)) {
      last = box;
    }
  }
  return last;
}

/**
 * The heading of the last model header (REQ-754): the box around the model's name (`label`, run included) and the info
 * buttons standing in the `header` box (centre inside it); null without either.
 */
export function headerHeading(label: Box | null, buttons: readonly Box[], header: Box): Box | null {
  // Copied field by field: a DOMRect's fields are getters, which spreading leaves out.
  const copy = ({ left, top, right, bottom }: Box): Box => ({ left, top, right, bottom });
  let heading: Box | null = label && label.right > label.left ? copy(label) : null;
  for (const button of buttons) {
    const x = (button.left + button.right) / 2;
    const y = (button.top + button.bottom) / 2;
    if (x < header.left || x > header.right || y < header.top || y > header.bottom) continue;
    heading = heading
      ? {
          left: Math.min(heading.left, button.left),
          top: Math.min(heading.top, button.top),
          right: Math.max(heading.right, button.right),
          bottom: Math.max(heading.bottom, button.bottom),
        }
      : copy(button);
  }
  return heading;
}

/**
 * The close button in the right corner of the `header` box (REQ-750): vertically centred, as far from the box's right
 * edge as from its top and bottom; in a box narrower than that, closer to the edge, and in one narrower than the button
 * right-aligned with it. `origin` is the container's top-left corner in viewport pixels. With `avoid`, a button that
 * would overlap the heading there, or come closer to it than 2 px, stands 1 px from the screen's right edge instead
 * (REQ-754), vertically centred. Where the room between the heading and that edge is narrower than the button, it gets
 * smaller to fit, down to 12 px (its target for a finger stays, `::after` in MeteogramPanel.css). Where not even that
 * fits (a header hardly wider than its name), it overlaps the name's end: no place further right is left, and the name
 * is the core's to draw.
 */
export function headerClosePlacement(
  header: Box,
  origin: { left: number; top: number },
  color: string | null = null,
  avoid?: HeaderHeading,
): ClosePlacement {
  const height = header.bottom - header.top;
  const size = headerCloseSize(height);
  const margin = Math.max(0, (height - size) / 2);
  const side = Math.min(margin, Math.max(0, (header.right - header.left - size) / 2));
  const corner = header.right - side - size;
  const top = header.top + margin;
  const inCorner: ClosePlacement = {
    where: "header",
    left: round(corner - origin.left),
    top: round(top - origin.top),
    size,
    color,
  };
  const heading = avoid?.heading;
  if (!avoid || !heading) return inCorner;
  const near =
    corner < heading.right + HEADING_CLEARANCE_PX &&
    heading.left < corner + size &&
    top < heading.bottom &&
    heading.top < top + size;
  if (!near) return inCorner;
  // At the edge, smaller where the room between the heading and the edge is narrower than the button, down to 12 px.
  const right = avoid.edge - EDGE_GAP_PX;
  const edgeSize = Math.min(size, Math.max(MIN_SIZE_PX, Math.floor(right - heading.right - HEADING_CLEARANCE_PX)));
  // Never further left than the corner (an edge left of the header's end).
  if (right - edgeSize < corner) return inCorner;
  return {
    where: "header",
    left: round(right - edgeSize - origin.left),
    top: round(header.top + Math.max(0, (height - edgeSize) / 2) - origin.top),
    size: edgeSize,
    color,
    atEdge: true,
  };
}

/** Size of the button and the gap after it in the row below the chart, by the height of the place name's line. */
export function footerCloseSize(height: number): { size: number; gap: number } {
  const size = clampSize(height);
  return { size, gap: Math.round(size / 4) };
}

/**
 * The close button in the row below the chart (REQ-750): left of the place name, `location` (measured after the row
 * made room for it), with the gap between them, vertically centred on the name's line.
 */
export function footerClosePlacement(
  location: Box,
  origin: { left: number; top: number },
  color: string | null = null,
): ClosePlacement {
  const { size, gap } = footerCloseSize(location.bottom - location.top);
  return {
    where: "footer",
    left: round(location.left - gap - size - origin.left),
    top: round(location.top + (location.bottom - location.top - size) / 2 - origin.top),
    size,
    color,
  };
}

const samePlacement = (a: ClosePlacement | null, b: ClosePlacement | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.where === b.where &&
    a.left === b.left &&
    a.top === b.top &&
    a.size === b.size &&
    a.color === b.color &&
    a.atEdge === b.atEdge);

/** Measures the chart inside `root` and places the button; sets the row's room for it (CLOSE_ROOM). */
function measure(root: HTMLElement): ClosePlacement {
  const origin = root.getBoundingClientRect();
  const headers = [...root.querySelectorAll('[data-testid="model-label-segment"]')].flatMap((group) => {
    const shape = group.querySelector('[data-testid="model-header-shape"]');
    if (!shape) return [];
    const { left, top, right, bottom } = shape.getBoundingClientRect();
    const label = group.querySelector('[data-testid="model-header-label"]');
    return [{ left, top, right, bottom, color: label?.getAttribute("fill") ?? null, label }];
  });
  const header = lastHeader(headers);
  const location = root.querySelector<HTMLElement>('[data-testid="meteogram-footer-location"]');
  const room = !header && location ? footerCloseSize(location.getBoundingClientRect().height) : null;
  const value = room ? `${room.size + room.gap}px` : "";
  if (root.style.getPropertyValue(CLOSE_ROOM) !== value) {
    if (value) root.style.setProperty(CLOSE_ROOM, value);
    else root.style.removeProperty(CLOSE_ROOM);
  }
  if (header) {
    // The name's text box as drawn by the core, and the info buttons laid over the header (REQ-754).
    const buttons = [...root.querySelectorAll('[data-testid="model-header-info-button"]')].map((button) =>
      button.getBoundingClientRect(),
    );
    const heading = headerHeading(header.label?.getBoundingClientRect() ?? null, buttons, header);
    const viewport = document.documentElement.clientWidth || window.innerWidth;
    const edge = Math.min(origin.right, viewport || origin.right);
    return headerClosePlacement(header, origin, header.color, { heading, edge });
  }
  if (location) return footerClosePlacement(location.getBoundingClientRect(), origin, getComputedStyle(location).color);
  return { where: "corner", left: round(origin.width - MAX_SIZE_PX - 8), top: 8, size: MAX_SIZE_PX, color: null };
}

/**
 * Whether the last input was a key (true) or a pointer or touch (false), for the button's focus hint (REQ-762): a ring
 * only where the keyboard is in use. The browser's `:focus-visible` alone is not enough: Safari on an iPad matches it
 * when the view opened by a tap focuses the button, and draws the blue ring there. Kept from the page's start, so the
 * button focused by a view opened with a key shows it at once; the mounted buttons follow each change
 * (`data-keyboard`).
 */
let keyboardInput = false;
const hinted = new Set<HTMLElement>();
/** Keys pressed alone that are no keyboard use, as for the browser's own `:focus-visible`. */
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift", "CapsLock"]);

function setKeyboardInput(keyboard: boolean) {
  keyboardInput = keyboard;
  for (const button of hinted) button.toggleAttribute("data-keyboard", keyboard);
}

if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !MODIFIER_KEYS.has(event.key)) setKeyboardInput(true);
    },
    true,
  );
  for (const type of ["pointerdown", "mousedown", "touchstart"]) {
    document.addEventListener(type, () => setKeyboardInput(false), { capture: true, passive: true });
  }
}

/** Presses on the button stay there: no cursor line by a tap, no zoom reset by a double tap, no full screen asked. */
const stop = (event: SyntheticEvent) => event.stopPropagation();

export interface FullscreenCloseProps {
  /** The button, focused when the view opens (Dialog's `initialFocus`). */
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/**
 * The close button, a child of the element around the chart, which is positioned (`position: relative`): the button is
 * placed in it.
 */
export function FullscreenClose({ buttonRef, onClose }: FullscreenCloseProps) {
  const t = useT();
  const itemRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<ClosePlacement | null>(null);

  useLayoutEffect(() => {
    // The focus hint follows the last input (REQ-762), from before the view opened on.
    const button = itemRef.current?.querySelector("button");
    if (!button) return;
    button.toggleAttribute("data-keyboard", keyboardInput);
    hinted.add(button);
    return () => {
      hinted.delete(button);
    };
  }, []);

  useLayoutEffect(() => {
    // The button's parent is the container (its own ref is set only after this effect ran).
    const item = itemRef.current;
    const root = item?.parentElement;
    if (!root || !item) return;
    let frame = 0;
    const update = () => {
      const next = measure(root);
      setPlacement((current) => (samePlacement(current, next) ? current : next));
      // The room set on the container needs no new measurement.
      mutations.takeRecords();
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    // The core redraws the headers and the row on zoom, new data or a new size: measured again each time.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !item.contains(record.target))) schedule();
    });
    update();
    mutations.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(root);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      root.style.removeProperty(CLOSE_ROOM);
    };
  }, []);

  return (
    <div
      ref={itemRef}
      className="fullscreen-close"
      data-testid="fullscreen-close"
      data-place={placement?.where}
      data-at-edge={placement?.atEdge ? "true" : undefined}
      style={
        placement
          ? {
              left: placement.left,
              right: "auto",
              top: placement.top,
              width: placement.size,
              height: placement.size,
              ...(placement.color ? { color: placement.color } : {}),
            }
          : undefined
      }
      onClick={stop}
      onDoubleClick={stop}
    >
      <button
        ref={buttonRef}
        type="button"
        className="icon-button fullscreen-close__button"
        aria-label={t("dialog.close")}
        title={t("dialog.close")}
        onClick={onClose}
      >
        <CloseIcon width="100%" height="100%" />
      </button>
    </div>
  );
}
