// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * `<Meteogram>`: React shell around the controller of `@graupel/meteogram`.
 * The controller is created once on mount, updated when `input` or
 * `options` change and destroyed on unmount; zoom, hover, tooltip and
 * resizing stay in the core.
 */
import {
  createMeteogram,
  type DayRangeChoice,
  type MeteogramController,
  type MeteogramHoverInfo,
  type MeteogramInput,
  type MeteogramOptions,
  type TimeRange,
} from "@graupel/meteogram";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

/** Callbacks of the controller; the component takes them as props. */
type CallbackKey =
  | "onRangeChange"
  | "onHover"
  | "renderTooltip"
  | "onOpenLink"
  | "warpCursor"
  | "onLayoutWarning";

/** Options of the controller without its callbacks (layout, theme, locale, interaction, …). */
export type MeteogramComponentOptions = Omit<MeteogramOptions, CallbackKey>;

export interface MeteogramProps {
  /** Data to draw. Keep the object stable: a new object redraws the chart. */
  input: MeteogramInput;
  /**
   * Options of the core (layout, theme, locale, timezone, interaction,
   * attribution, `dewPoint` with default `"off"`, `relativeHumidity` with default `"off"`, `scaleToVisibleRange`
   * with default `true`, `toggles` for the layout's switches (REQ-664), `axisRangeFrom` to hold the precipitation and
   * wind axes while the app pans the range, …),
   * passed on unchanged.
   * Compared by value, so an inline object does not redraw the chart on
   * every render.
   */
  options?: MeteogramComponentOptions;
  /**
   * Visible range. At the start it replaces `options.interaction.initialRange`;
   * later changes are applied. Zooming in the chart does not need it:
   * `onRangeChange` reports the range, and passing it back is a no-op.
   */
  visibleRange?: TimeRange | null;
  /** Day range (4, 7, 10, 14 or null for all); applied at the start and on change. */
  dayRange?: DayRangeChoice;
  /** Hover at a time (epoch ms), e.g. synchronised from another chart; null ends it. */
  hoverTime?: number | null;
  /** Visible range changed (zoom, day range, new data). */
  onRangeChange?: (range: TimeRange | null) => void;
  /** Hovered time changed; null when the hover ends. */
  onHover?: (info: MeteogramHoverInfo | null) => void;
  /**
   * Own tooltip content as a render prop; returning null, undefined or
   * false hides the tooltip. Without it the core draws its standard tooltip.
   * Called outside React's render: return elements, do not call hooks here.
   */
  renderTooltip?: (info: MeteogramHoverInfo) => ReactNode;
  /** Opens the attribution link instead of the browser (desktop shells). */
  onOpenLink?: (href: string) => void;
  /** Moves the system cursor after a wheel zoom (desktop shells). */
  warpCursor?: (screenX: number, screenY: number) => boolean | Promise<boolean>;
  /** Invalid layout: the fallback is drawn and this gets the warning (default `console.warn`). */
  onLayoutWarning?: (warning: string) => void;
  /** Receives the controller (PNG export, `setDayRange`, …); null on unmount. */
  ref?: Ref<MeteogramController | null>;
  /** Class and style of the host element the meteogram is mounted into. */
  className?: string;
  style?: CSSProperties;
  id?: string;
}

/** Structural equality of plain objects and arrays; everything else by identity. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  const plain = (value: object) => {
    const proto = Object.getPrototypeOf(value) as unknown;
    return proto === Object.prototype || proto === null;
  };
  if (!plain(a) || !plain(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

const sameRange = (a: TimeRange | null, b: TimeRange | null) =>
  a === b || (!!a && !!b && a.start === b.start && a.end === b.end);

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : undefined;
  }
  if (ref) ref.current = value;
  return undefined;
}

/** Calls `onCommit` after React committed the tooltip content. */
function TooltipContent({ children, onCommit }: { children: ReactNode; onCommit: () => void }) {
  useLayoutEffect(() => {
    onCommit();
  });
  return <>{children}</>;
}

interface Applied {
  input: MeteogramInput;
  options: MeteogramComponentOptions | undefined;
  callbacks: string;
  visibleRange: TimeRange | null | undefined;
  dayRange: DayRangeChoice | undefined;
  hoverTime: number | null | undefined;
}

export function Meteogram(props: MeteogramProps) {
  const { input, options, visibleRange, dayRange, hoverTime, renderTooltip, ref } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<MeteogramController | null>(null);
  const latest = useRef(props);
  const applied = useRef<Applied | null>(null);
  const portalHost = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<{ host: HTMLElement; node: ReactNode } | null>(null);
  // Which optional callbacks are set; a change re-creates the controller options.
  const callbacks = [
    renderTooltip !== undefined && "renderTooltip",
    props.onOpenLink !== undefined && "onOpenLink",
    props.warpCursor !== undefined && "warpCursor",
  ]
    .filter(Boolean)
    .join(",");

  // The callbacks handed to the controller read the latest props.
  useLayoutEffect(() => {
    latest.current = props;
  });

  /** Full controller options from the latest props. */
  const controllerOptions = (): MeteogramOptions => {
    const current = latest.current;
    const base = current.options ?? {};
    const interaction = { ...base.interaction };
    if (current.visibleRange !== undefined) interaction.initialRange = current.visibleRange;
    if (current.dayRange !== undefined) interaction.dayRange = current.dayRange;
    const result: MeteogramOptions = {
      ...base,
      interaction,
      onRangeChange: (range) => latest.current.onRangeChange?.(range),
      onHover: (info) => {
        if (!info) setTooltip(null);
        latest.current.onHover?.(info);
      },
      onLayoutWarning: (warning) => {
        const handler = latest.current.onLayoutWarning;
        if (handler) handler(warning);
        else console.warn(warning);
      },
    };
    // Optional callbacks only when given: without them the core keeps its defaults.
    if (current.onOpenLink) {
      result.onOpenLink = (href) => latest.current.onOpenLink?.(href);
    }
    if (current.warpCursor) {
      result.warpCursor = (x, y) => latest.current.warpCursor?.(x, y) ?? false;
    }
    if (current.renderTooltip) {
      result.renderTooltip = (info, container) => {
        const render = latest.current.renderTooltip;
        const node = render ? render(info) : null;
        if (node === null || node === undefined || node === false) {
          setTooltip(null);
          return false;
        }
        let host = portalHost.current;
        if (!host || host.ownerDocument !== container.ownerDocument) {
          host = container.ownerDocument.createElement("div");
          host.className = "graupel-meteogram-tooltip-content";
          portalHost.current = host;
        }
        // The core empties the container before each call; React owns only `host`.
        container.appendChild(host);
        setTooltip({ host, node });
        return true;
      };
    }
    return result;
  };

  // Create once, destroy on unmount.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const current = latest.current;
    const controller = createMeteogram(host, current.input, controllerOptions());
    controllerRef.current = controller;
    if (current.hoverTime !== undefined && current.hoverTime !== null) {
      controller.setHover(current.hoverTime);
    }
    applied.current = {
      input: current.input,
      options: current.options,
      callbacks,
      visibleRange: current.visibleRange,
      dayRange: current.dayRange,
      hoverTime: current.hoverTime,
    };
    return () => {
      controller.destroy();
      controllerRef.current = null;
      applied.current = null;
      setTooltip(null);
    };
    // Created once; later props go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the controller to `ref`.
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const cleanup = assignRef(ref, controller);
    return () => {
      if (cleanup) cleanup();
      else assignRef(ref, null);
    };
  }, [ref]);

  // New data or options.
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    const last = applied.current;
    if (!controller || !last) return;
    if (
      last.input === input &&
      last.callbacks === callbacks &&
      sameValue(last.options, options)
    ) {
      return;
    }
    last.input = input;
    last.options = options;
    last.callbacks = callbacks;
    controller.update(input, controllerOptions());
  }, [input, options, callbacks]);

  // Visible range from the host.
  const rangeStart = visibleRange?.start;
  const rangeEnd = visibleRange?.end;
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    const last = applied.current;
    if (!controller || !last || visibleRange === undefined) return;
    if (last.visibleRange !== undefined && sameRange(last.visibleRange, visibleRange)) return;
    last.visibleRange = visibleRange;
    // Already shown (e.g. the host passes back what onRangeChange reported).
    if (sameRange(controller.getVisibleRange(), visibleRange ?? controller.getMaximumRange())) return;
    controller.setVisibleRange(visibleRange);
    // The range is compared by its bounds, not by object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd, visibleRange === null, visibleRange === undefined]);

  // Day range from the host.
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    const last = applied.current;
    if (!controller || !last || dayRange === undefined || last.dayRange === dayRange) return;
    last.dayRange = dayRange;
    controller.setDayRange(dayRange);
  }, [dayRange]);

  // Hover from the host (e.g. a synchronised second chart).
  useLayoutEffect(() => {
    const controller = controllerRef.current;
    const last = applied.current;
    if (!controller || !last || hoverTime === undefined || last.hoverTime === hoverTime) return;
    last.hoverTime = hoverTime;
    controller.setHover(hoverTime);
  }, [hoverTime]);

  const placeTooltip = () => controllerRef.current?.refreshTooltip();

  return (
    <div ref={hostRef} id={props.id} className={props.className} style={props.style}>
      {tooltip &&
        createPortal(
          <TooltipContent onCommit={placeTooltip}>{tooltip.node}</TooltipContent>,
          tooltip.host,
        )}
    </div>
  );
}
