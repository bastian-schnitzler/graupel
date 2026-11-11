// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Info buttons in the meteogram's model header (REQ-643): while the weather chain card is hidden, each model header
 * gets a small info button right of the model's name that opens the same popover as the info button of a chain card
 * (`ModelInfoButton`). A model split into runs gets it only in its widest part; where the button does not fit beside
 * the name, that model has none. The buttons are HTML laid over the chart, placed at the core's header segments
 * (`model-label-segment` with `data-model`, `data-start-x`, `data-end-x`) and their labels (`model-header-label`);
 * they follow zoom, the day selection and sideways scrolling. They are not part of the SVG, so the copied or saved
 * image has none.
 */
import type { WeatherModel } from "@graupel/download";
import type { MeteogramInput } from "@graupel/meteogram";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { getModelMetadataWithFallback } from "../ModelChain/chain/chainUtils.ts";
import { ModelInfoButton } from "../ModelChain/chain/ModelInfo.tsx";
import { useChainCardsVisible, useChainSelection } from "../../state/index.ts";

/** Largest icon (CSS px), as on a chain card. */
const MAX_SIZE_PX = 16;
/** Smallest icon (CSS px): on a lower header the button gets smaller, down to this. */
const MIN_SIZE_PX = 10;

/** Box in viewport pixels, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One header segment of the chart, measured on the page. */
export interface MeasuredSegment {
  model: string;
  /** Start and end in chart units (`data-start-x`, `data-end-x`): picks the widest part of a split model. */
  startX: number;
  endX: number;
  /** The header's box (`model-header-shape`). */
  shape: Box;
  /** The name in it (`model-header-label`). */
  label: Box;
  /** Colour of the name, taken by the icon. */
  color: string | null;
}

/** Where a model's info button stands, relative to the layer the buttons are placed in. */
export interface InfoPlacement {
  model: string;
  left: number;
  top: number;
  size: number;
  color: string | null;
}

/**
 * The info buttons for the measured header segments (REQ-643): one per model, in its widest part, right of the name
 * and vertically centred in the header; none where it would not fit inside the header. `origin` is the layer's
 * top-left corner in viewport pixels. `reserveEnd` gives the room (px, by the header's height) kept free at the right
 * end of the last header, the rightmost one, e.g. for the full-screen view's close button (REQ-750).
 */
export function placeInfoButtons(
  segments: readonly MeasuredSegment[],
  origin: { left: number; top: number },
  reserveEnd?: (height: number) => number,
): InfoPlacement[] {
  const widest = new Map<string, MeasuredSegment>();
  let lastRight = -Infinity;
  for (const segment of segments) {
    lastRight = Math.max(lastRight, segment.shape.right);
    const best = widest.get(segment.model);
    if (!best || segment.endX - segment.startX > best.endX - best.startX) widest.set(segment.model, segment);
  }
  const placements: InfoPlacement[] = [];
  for (const segment of widest.values()) {
    const { shape, label } = segment;
    const height = shape.bottom - shape.top;
    if (shape.right - shape.left <= 0 || height <= 0) continue;
    const size = Math.round(Math.min(MAX_SIZE_PX, Math.max(MIN_SIZE_PX, height * 0.8)));
    const gap = size / 4;
    const left = label.right + gap;
    const end = shape.right - (reserveEnd && shape.right >= lastRight - 0.5 ? reserveEnd(height) : 0);
    if (left + size > end - gap) continue;
    placements.push({
      model: segment.model,
      left: Math.round((left - origin.left) * 10) / 10,
      top: Math.round((shape.top + (height - size) / 2 - origin.top) * 10) / 10,
      size,
      color: segment.color,
    });
  }
  return placements;
}

/** The chart's header segments inside `root`, measured. */
function measureSegments(root: Element): MeasuredSegment[] {
  const segments: MeasuredSegment[] = [];
  for (const group of root.querySelectorAll('[data-testid="model-label-segment"]')) {
    const shape = group.querySelector('[data-testid="model-header-shape"]');
    const label = group.querySelector('[data-testid="model-header-label"]');
    const model = group.getAttribute("data-model");
    if (!shape || !label || !model) continue;
    segments.push({
      model,
      startX: Number(group.getAttribute("data-start-x")),
      endX: Number(group.getAttribute("data-end-x")),
      shape: shape.getBoundingClientRect(),
      label: label.getBoundingClientRect(),
      color: label.getAttribute("fill"),
    });
  }
  return segments;
}

const samePlacements = (a: readonly InfoPlacement[], b: readonly InfoPlacement[]) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index]!;
    return (
      item.model === other.model &&
      item.left === other.left &&
      item.top === other.top &&
      item.size === other.size &&
      item.color === other.color
    );
  });

/** Presses on the buttons and their popovers stay there: no full-screen view by double-click, no cursor by a tap. */
const stop = (event: SyntheticEvent) => event.stopPropagation();

export interface ModelHeaderInfoProps {
  /**
   * The element around the chart and this layer, positioned (`position: relative`); the buttons are placed in it and
   * scroll with it. Their popovers stay inside its visible box.
   */
  containerRef: RefObject<HTMLElement | null>;
  /** The chart's weather chain, for the models behind the headers. */
  chain: MeteogramInput["chain"];
  /** Room kept free at the right end of the last header (placeInfoButtons); a stable function. */
  reserveEnd?: (height: number) => number;
}

export function ModelHeaderInfo({ containerRef, chain, reserveEnd }: ModelHeaderInfoProps) {
  // Only while the weather chain card is hidden; with the card shown its own info buttons are there.
  const shown = !useChainCardsVisible().weather;
  const { available } = useChainSelection();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [placements, setPlacements] = useState<InfoPlacement[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useLayoutEffect(() => {
    // The layer's parent is the container (its own ref is set only after this effect ran).
    const layer = layerRef.current;
    const root = layer?.parentElement;
    if (!shown || !layer || !root) return;
    const measure = () => {
      const origin = layer.getBoundingClientRect();
      const next = placeInfoButtons(measureSegments(root), origin, reserveEnd);
      setPlacements((current) => (samePlacements(current, next) ? current : next));
    };
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    // The core redraws the headers on zoom, a new day selection, new data or a new size: measured again each time.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !layer.contains(record.target))) schedule();
    });
    mutations.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(root);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [shown, reserveEnd]);

  // The models behind the headers, by name, with their catalogue entries.
  const models = useMemo(() => {
    const byName = new Map<string, { model: WeatherModel; meta: WeatherModel }>();
    for (const entry of chain) {
      const model: WeatherModel = { name: entry.model, max_forecast_horizon_hours: entry.sliceEndHours };
      if (entry.id !== undefined) model.id = entry.id;
      byName.set(entry.model, { model, meta: getModelMetadataWithFallback(model, available) });
    }
    return byName;
  }, [chain, available]);

  const toggle = useCallback((model: string) => setOpen((current) => (current === model ? null : model)), []);

  if (!shown) return null;
  return (
    <div
      ref={layerRef}
      className="model-header-info"
      data-testid="model-header-info"
      onClick={stop}
      onDoubleClick={stop}
    >
      {placements.map((placement) => {
        const entry = models.get(placement.model);
        if (!entry) return null;
        return (
          <ModelInfoButton
            key={placement.model}
            className="model-header-info__item"
            style={{
              left: placement.left,
              top: placement.top,
              width: placement.size,
              height: placement.size,
              ...(placement.color ? { color: placement.color } : {}),
            }}
            meta={entry.meta}
            model={entry.model}
            open={open === placement.model}
            onToggle={() => toggle(placement.model)}
            iconSize={placement.size}
            bounds={containerRef}
            testId="model-header-info-button"
          />
        );
      })}
    </div>
  );
}
