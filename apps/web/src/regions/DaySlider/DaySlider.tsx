// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useI18n, useT } from "../../i18n/index.ts";
import { RefreshIcon } from "../../icons/index.ts";
import {
  dragEdge,
  moveSelection,
  resizeSelection,
  useForecastDays,
  type DaySelection,
  type ForecastDay,
} from "../../state/days.ts";
import { applyDayShortcut, dayShortcutAllowed, dayShortcutForCode } from "../../state/dayShortcuts.ts";
import { useForecast } from "../../state/forecast.ts";
import { useTablet } from "../../state/deviceClass.ts";
import { usePhone } from "../../state/phoneLandscape.ts";
import { useSliderCaptionRef } from "../../state/sliderCaption.tsx";
import { withoutTrailingDot } from "./dayNumbers.ts";
import { shortWeekdayFormat, weekdayLettersFormat } from "./weekdayLetters.ts";
import "./DaySlider.css";

type DragKind = "start" | "end" | "move" | "range";

interface Drag {
  kind: DragKind;
  pointerId: number;
  /** Selection when the drag began. */
  origin: DaySelection;
  /** Day under the pointer when the drag began (for moving; the fixed end of a range, REQ-490). */
  originDay: number;
  originX: number;
  /** Fractional day position of the pointer when the drag began (the fixed point of a phone edge drag, REQ-558). */
  originPosition: number;
  /** Whether the slider is the phone's strip (REQ-458): there edges follow the finger's travel (REQ-558). */
  phone: boolean;
  /** Whether the pointer moved far enough to count as a drag. */
  moved: boolean;
  /** Selection the drag shows now (the marker follows it); kept when the browser ends the drag without a release. */
  shown: DaySelection;
  /** Whether a tap (no drag) selects the day under the pointer here (on the marker; a card has its own click). */
  tapSelects: boolean;
}

/** What dragging an element of the marker does (its `data-drag`). */
function dragKind(element: HTMLElement): Exclude<DragKind, "range"> | null {
  const kind = element.dataset.drag;
  return kind === "start" || kind === "end" || kind === "move" ? kind : null;
}

/** Keys that move an edge or the marker by one day. */
const STEP_KEYS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

/** Width below which the slider is the phone's strip, as in its container query (40rem, REQ-458). */
const PHONE_WIDTH_PX = 640;

/** A pointer that moves less than this many pixels taps instead of dragging. */
const TAP_TOLERANCE_PX = 4;

/** Two taps on the same day within this many milliseconds are a double tap (REQ-485). */
const DOUBLE_TAP_MS = 400;

/** Two taps on the slider at most this many pixels apart can be a double tap anywhere on it (REQ-564). */
const DOUBLE_TAP_PX = 30;

/**
 * Long labels may shrink to these shares of their full size before the cards switch to short ones (REQ-520): the
 * weekday, the name of the card, not at all, so a longer weekday ("mar") switches earlier than a short one ("Di");
 * the date down to three quarters.
 */
const MIN_WEEKDAY_SCALE = 1;
const MIN_DATE_SCALE = 0.75;

/** How the long labels fit the cards: whether they are too long, and by how much they shrink (REQ-520). */
interface LabelFit {
  short: boolean;
  weekday: number;
  date: number;
  /** Width of the widest date at its scale, in pixels (room for today's badge). */
  dateText: number;
  /**
   * Width of each day's two-letter weekday in em of its font (REQ-626), 0 where not measured: with it a card limits the
   * font of its short weekday so the two letters fit.
   */
  letters: readonly number[];
}

const FULL_FIT: LabelFit = { short: false, weekday: 1, date: 1, dateText: 0, letters: [] };

/**
 * Measures whether the long labels of the page's language fit the cards (REQ-520): the widest weekday and date at full
 * size (hidden copies in `measure`) against the inner width of a card, again whenever the track changes its size, the
 * labels change or the fonts have loaded. In French "mar" needs more room than "Di" in German, so the switch to short
 * labels depends on the language instead of a fixed card width. With them it measures the two-letter weekdays of the
 * short labels (REQ-626) in em, which does not change the switch.
 */
function useLabelFit(
  track: RefObject<HTMLDivElement | null>,
  measure: RefObject<HTMLDivElement | null>,
  labelsKey: string,
): LabelFit {
  const [fit, setFit] = useState<LabelFit>(FULL_FIT);
  useLayoutEffect(() => {
    let active = true;
    const update = () => {
      const trackElement = track.current;
      const measureElement = measure.current;
      const card = trackElement?.querySelector<HTMLElement>("[data-day]");
      if (!active || !measureElement || !card) return;
      const style = getComputedStyle(card);
      const inner =
        card.getBoundingClientRect().width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const widest = (selector: string) =>
        Math.max(0, ...[...measureElement.querySelectorAll<HTMLElement>(selector)].map((e) => e.getBoundingClientRect().width));
      const weekdayWidth = widest(".day-slider__measure-weekday");
      const dateWidth = widest(".day-slider__measure-date");
      // Nothing laid out (e.g. without a layout engine): the long labels as they are.
      if (!(inner > 0) || !(weekdayWidth > 0) || !(dateWidth > 0)) return;
      const round = (value: number) => Math.floor(value * 100) / 100;
      const weekday = round(Math.min(1, inner / weekdayWidth));
      const date = round(Math.min(1, inner / dateWidth));
      // Each two-letter weekday's width in em of its font, rounded up, so a font limited by it never overflows.
      const letters = [...measureElement.querySelectorAll<HTMLElement>(".day-slider__measure-letters")].map((element) => {
        const size = parseFloat(getComputedStyle(element).fontSize);
        const width = element.getBoundingClientRect().width;
        return size > 0 && width > 0 ? Math.ceil((width / size) * 1000) / 1000 : 0;
      });
      const next: LabelFit = {
        short: weekday < MIN_WEEKDAY_SCALE || date < MIN_DATE_SCALE,
        weekday,
        date,
        dateText: Math.ceil(dateWidth * date),
        letters,
      };
      setFit((previous) =>
        previous.short === next.short &&
        previous.weekday === next.weekday &&
        previous.date === next.date &&
        previous.dateText === next.dateText &&
        previous.letters.join() === next.letters.join()
          ? previous
          : next,
      );
    };
    update();
    void document.fonts?.ready.then(update);
    const trackElement = track.current;
    if (!trackElement || typeof ResizeObserver === "undefined") {
      return () => {
        active = false;
      };
    }
    const observer = new ResizeObserver(update);
    observer.observe(trackElement);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [track, measure, labelsKey]);
  return fit;
}

/**
 * Page-wide keyboard shortcuts of the day slider (REQ-533, `state/dayShortcuts.ts`): ^/` all days, 1–9 and 0 from
 * yesterday (or today) on, ß/- shows or removes yesterday. Active while the slider is shown; the selection goes through
 * `setSelection` like a drag or a double click, so the meteogram follows.
 */
function useDayShortcuts(
  days: readonly ForecastDay[],
  selection: DaySelection,
  setSelection: (selection: DaySelection | null) => void,
) {
  // Whether the digit keys include yesterday; ß/- switches it.
  const withYesterday = useRef(true);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const shortcut = dayShortcutForCode(event.code);
      if (!shortcut || !dayShortcutAllowed(event, shortcut)) return;
      const result = applyDayShortcut(shortcut, days, selection, withYesterday.current);
      if (!result) return;
      event.preventDefault();
      withYesterday.current = result.withYesterday;
      setSelection(result.selection);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [days, selection, setSelection]);
}

/**
 * Day labels in the page's language and the forecast's time zone. The weekday's abbreviation ends without a dot in
 * every language (REQ-667), on the cards and in the hidden copy that measures the switch to short labels (REQ-520). On a
 * phone the day number and the date end without a dot in every language as well (REQ-629); the text read out (`full`)
 * stays.
 */
function useDayLabels(days: readonly ForecastDay[], timeZone: string) {
  const { locale } = useI18n();
  const phone = usePhone();
  return useMemo(() => {
    const ending = phone ? withoutTrailingDot : (text: string) => text;
    // "mar", not "mar." (REQ-667).
    const weekday = shortWeekdayFormat(locale, timeZone);
    // Two letters at least on narrow cards (REQ-626), e.g. "Mo", "Út", "sr".
    const weekdayLetters = weekdayLettersFormat(locale, timeZone);
    const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone });
    const dayOfMonth = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone });
    const full = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone });
    return days.map((day) => ({
      weekday: weekday(day.start),
      weekdayLetters: weekdayLetters(day.start),
      date: ending(date.format(day.start)),
      day: ending(dayOfMonth.format(day.start)),
      full: full.format(day.start),
    }));
  }, [days, timeZone, locale, phone]);
}

/**
 * "Loading forecast…" with a turning refresh symbol before it (REQ-737), the one message of a load on the page; without
 * `text` only the symbol (while the chart is pulled down, before a reload). The symbol stands still with
 * `prefers-reduced-motion`.
 */
function LoadingMessage({ text = false }: { text?: boolean }) {
  const t = useT();
  return (
    <span
      className="day-slider__loading-message"
      role={text ? "status" : undefined}
      aria-hidden={text ? undefined : true}
      data-testid={text ? "forecast-loading" : undefined}
    >
      <RefreshIcon className="icon day-slider__loading-icon" data-testid="forecast-loading-icon" />
      {text && t("forecast.loading")}
    </span>
  );
}

/**
 * Day slider (REQ-436): one card per forecast day (weekday, date; today highlighted) and a marker over the selected
 * days whose edges can be dragged and which can be moved while it is smaller than the whole period. The meteogram's
 * time axis follows the marker once a drag ends. There is no button for the whole period (REQ-640): a double click on
 * the slider selects it, and a tooltip over the grips and the selection says so. The dates are plain text, only
 * today's has a badge (REQ-505).
 *
 * The cards share one grid row of equal columns, so the slider always fits its width without a scroll bar (REQ-446).
 * Cards too narrow for the long labels
 * of the page's language show shorter ones; the switch point is measured per language (REQ-520). The short weekday has
 * at least two letters in every language ("Mo", "Út", "sr"), smaller only where they would not fit the card (REQ-626).
 * The slider is a card of its own between the model chain and the meteogram, built like a model chain card: the
 * label "Horizon" runs up its left edge, and the day cards look like the model cards (REQ-499).
 *
 * On phones (REQ-458) the cards form a compact strip and the marker's edges get large grips below the strip with a
 * touch area of at least 44 px. There the slider shows no selected period in words (REQ-528); a double tap on a day or
 * a drag across all days selects the whole period. It is no card there and
 * has no label "Horizon" (REQ-529). Each day shows its weekday's abbreviation over the day of the month, both centred
 * (where the abbreviation does not fit, the weekday's first two letters, REQ-626);
 * the selected days are one filled area and the grips are tabs below the strip (REQ-548). A grip there follows the
 * finger's travel instead of its place, moves on after a third of a day and snaps to the first or last day in that
 * day's outer half, so the ends are in reach of the thumb (REQ-558).
 *
 * A double click or double tap on a day selects the whole period (REQ-485, REQ-640); so does one anywhere else on the
 * slider, on the grips and the border too (REQ-564). The first tap selects the
 * day and puts the marker over its card, so the second tap may land on the marker instead of the card: both count as
 * taps on that day.
 *
 * Pressing on a day and dragging sideways marks the days from that day to the one under the pointer (REQ-490); the
 * marker follows live and the selection is taken over when the pointer is released. Dragging the marker itself moves
 * it as before, unless it covers the whole period or a single day: then there is nothing sensible to move, so the drag
 * marks days as well. On touch the cards let the page scroll vertically only, so a sideways move marks days and an
 * upward or downward one still scrolls the page.
 *
 * While the slider is shown, keys select days on the whole page (REQ-533, `useDayShortcuts`).
 */
export function DaySlider() {
  const t = useT();
  // Hint over the grips and the selection: a double click selects the whole period (REQ-640).
  const wholeHint = t("daySlider.wholeHint");
  const { status, result, refreshing = false } = useForecast();
  // A reload the user asked for (refresh button, REQ-637; pull to refresh, REQ-638): the box says so over the days.
  const reloading = refreshing && result !== undefined;
  const { days, timeZone, selection, whole, setSelection } = useForecastDays();
  const labels = useDayLabels(days, timeZone);
  const tablet = useTablet();
  const phone = usePhone();
  useDayShortcuts(days, selection, setSelection);
  const trackRef = useRef<HTMLDivElement>(null);
  const captionRef = useSliderCaptionRef();
  const measureRef = useRef<HTMLDivElement>(null);
  const labelFit = useLabelFit(
    trackRef,
    measureRef,
    labels.map((label) => `${label.weekday}|${label.date}`).join(","),
  );
  const drag = useRef<Drag | null>(null);
  // Selection while dragging; committed when the pointer is released.
  const [draft, setDraft] = useState<DaySelection | null>(null);
  // Last tap on a day, to recognise a double tap (REQ-485).
  const lastTap = useRef<{ day: number; time: number } | null>(null);
  // Any tap on the slider, to recognise a double tap anywhere on it, grips and border included (REQ-564).
  const sliderTap = useRef<{ down: { x: number; y: number } | null; last: { x: number; y: number; time: number } | null }>({
    down: null,
    last: null,
  });
  // Whether the last pointer gesture on the marker was a drag (then a double click there does nothing).
  const lastDragged = useRef(false);
  // Whether the last pointer gesture on a card marked days; its click then selects nothing (REQ-490).
  const suppressClick = useRef(false);
  const shown = draft ?? selection;
  const shownWhole = shown.start === 0 && shown.end === days.length - 1;
  const count = days.length;

  /** Fractional day position of a pointer over the track (0 = left edge of the first day). */
  const dayPosition = (clientX: number) => {
    const track = trackRef.current;
    if (!track || count === 0) return 0;
    // From the first card's left to the last card's right edge; the track itself as fallback.
    const cards = track.querySelectorAll<HTMLElement>("[data-day]");
    const first = cards[0]?.getBoundingClientRect();
    const last = cards[cards.length - 1]?.getBoundingClientRect();
    let left = first?.left ?? 0;
    let right = last?.right ?? 0;
    if (!(right > left)) {
      const rect = track.getBoundingClientRect();
      left = rect.left;
      right = rect.right;
    }
    return right > left ? ((clientX - left) / (right - left)) * count : 0;
  };

  /**
   * Whether the slider is the phone's strip, like its container query (REQ-458): narrow enough, or on a tablet whatever
   * its width (REQ-728).
   */
  const isPhone = () => {
    if (tablet) return true;
    const slider = trackRef.current?.closest<HTMLElement>(".day-slider");
    return !!slider && slider.clientWidth > 0 && slider.clientWidth < PHONE_WIDTH_PX;
  };

  /** Index of the day under a pointer, clamped to the days. */
  const dayAt = (clientX: number) => Math.min(count - 1, Math.max(0, Math.floor(dayPosition(clientX))));

  const next = (kind: DragKind, current: Drag, clientX: number): DaySelection => {
    if (kind === "range") {
      const day = dayAt(clientX);
      return { start: Math.min(current.originDay, day), end: Math.max(current.originDay, day) };
    }
    const position = dayPosition(clientX);
    if ((kind === "start" || kind === "end") && current.phone) {
      return dragEdge(current.origin, kind, position - current.originPosition, position, count);
    }
    if (kind === "start") return resizeSelection(current.origin, "start", Math.round(position), count);
    if (kind === "end") return resizeSelection(current.origin, "end", Math.round(position) - 1, count);
    return moveSelection(current.origin, Math.floor(position) - current.originDay, count);
  };

  /** A tap or click on a day: selects that day, or the whole period when it is the second tap on it (REQ-485). */
  const tapDay = (day: number, now: number) => {
    const previous = lastTap.current;
    if (previous && previous.day === day && now - previous.time <= DOUBLE_TAP_MS) {
      lastTap.current = null;
      setSelection(null);
      return;
    }
    lastTap.current = { day, time: now };
    setSelection({ start: day, end: day });
  };

  /** A double click (REQ-485, REQ-640): the whole period. */
  const selectAll = () => {
    lastTap.current = null;
    setSelection(null);
  };

  const startDrag = (event: PointerEvent<HTMLElement>, kind: DragKind, tapSelects: boolean) => {
    suppressClick.current = false;
    drag.current = {
      kind,
      pointerId: event.pointerId,
      origin: selection,
      originDay: kind === "range" ? dayAt(event.clientX) : Math.floor(dayPosition(event.clientX)),
      originX: event.clientX,
      originPosition: dayPosition(event.clientX),
      phone: isPhone(),
      moved: false,
      shown: selection,
      tapSelects,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraft(selection);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    let kind: DragKind | null = dragKind(event.currentTarget);
    if (!kind || event.button !== 0 || count === 0) return;
    event.preventDefault();
    event.stopPropagation();
    // Over the whole period or a single day the marker cannot sensibly move: dragging it marks days (REQ-490).
    if (kind === "move" && (whole || selection.start === selection.end)) kind = "range";
    startDrag(event, kind, kind === "move" || kind === "range");
  };

  /** Pressing on a day card: dragging sideways marks days (REQ-490); a tap is the card's click. */
  const onCardPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || count === 0) return;
    startDrag(event, "range", false);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.abs(event.clientX - current.originX) < TAP_TOLERANCE_PX) return;
    current.moved = true;
    // The marker moves only while it is smaller than the whole period.
    if (current.kind === "move" && whole) return;
    current.shown = next(current.kind, current, event.clientX);
    setDraft(current.shown);
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraft(null);
    lastDragged.current = current.moved;
    if (!current.moved) {
      // A tap on the marker selects the day under it; a second one on the same day the whole period.
      if (!current.tapSelects) return;
      tapDay(dayAt(event.clientX), event.timeStamp);
      return;
    }
    // The click that may follow a drag on a card does not select its day.
    suppressClick.current = current.kind === "range";
    lastTap.current = null;
    if (current.kind === "move" && whole) return;
    setSelection(next(current.kind, current, event.clientX));
  };

  /**
   * The browser ends a drag without a release (REQ-752): Chrome on Android sends `pointercancel` instead of `pointerup`
   * when the system takes the touch over, and a pointer whose capture is lost sends its release elsewhere. A grip or the
   * marker (`touch-action: none`, so the page never scrolls from them) then keeps the selection it shows, as at a
   * release; it does not jump back to the one before the drag. Marking days from a card is dropped: there the browser
   * cancels because the finger scrolls the page up or down (REQ-490).
   */
  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraft(null);
    if (!current.moved || current.kind === "range") return;
    lastDragged.current = true;
    lastTap.current = null;
    setSelection(current.shown);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const kind = dragKind(event.currentTarget);
    if (!kind) return;
    const step = STEP_KEYS[event.key] ?? 0;
    let result: DaySelection | null = null;
    if (kind === "move") {
      if (step) result = moveSelection(selection, step, count);
      else if (event.key === "Home") result = moveSelection(selection, -count, count);
      else if (event.key === "End") result = moveSelection(selection, count, count);
    } else {
      const edge = kind === "start" ? selection.start : selection.end;
      if (step) result = resizeSelection(selection, kind, edge + step, count);
      else if (event.key === "Home") result = resizeSelection(selection, kind, 0, count);
      else if (event.key === "End") result = resizeSelection(selection, kind, count - 1, count);
    }
    if (!result) return;
    event.preventDefault();
    setSelection(result);
  };

  /**
   * A double tap or double click anywhere on the slider selects the whole period (REQ-564), on the grips and the border
   * as on a day (REQ-485). The press is seen in the capture phase, before the marker stops it; the release after the
   * slider's own handling of the tap, which it then cannot undo. A drag is no tap.
   */
  const sliderTapHandlers = {
    onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
      sliderTap.current.down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const { down, last } = sliderTap.current;
      sliderTap.current.down = null;
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) >= TAP_TOLERANCE_PX || count === 0) return;
      const now = event.timeStamp;
      const second =
        last && now - last.time <= DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_TAP_PX;
      sliderTap.current.last = second ? null : { x: event.clientX, y: event.clientY, time: now };
      if (second) selectAll();
    },
  };

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture: onPointerCancel,
    onKeyDown,
  };
  const cardHandlers = { onPointerDown: onCardPointerDown, onPointerMove, onPointerUp, onPointerCancel };

  const rangeText = (from: number, to: number) =>
    from === to
      ? (labels[from]?.full ?? "")
      : t("daySlider.rangeText", { from: labels[from]?.full ?? "", to: labels[to]?.full ?? "" });

  return (
    <section
      // Without days on a phone, also turned to landscape, no card and no label "Horizon" around the message (REQ-740):
      // the label belongs to the slider, the message stands alone as upright.
      className={phone && count === 0 ? "day-slider-card day-slider-card--bare" : "day-slider-card"}
      data-region="day-slider"
      aria-label={t("region.daySlider.title")}
      {...sliderTapHandlers}
    >
      <div className="day-slider-card__label" data-testid="day-slider-label" aria-hidden="true">
        {t("region.daySlider.title")}
      </div>
      <div className="day-slider" role="group" aria-label={t("daySlider.label")}>
        {count === 0 ? (
          <p className="day-slider__empty" data-testid="day-slider-empty">
            {status === "loading" ? <LoadingMessage text /> : t("daySlider.noData")}
          </p>
        ) : (
          <div
            className={[
              "day-slider__track",
              labelFit.short && "day-slider--short",
              // On phones the weekday's abbreviation where it fits (REQ-548), otherwise its first two letters (REQ-626).
              labelFit.weekday < 1 && "day-slider--narrow-weekday",
            ]
              .filter(Boolean)
              .join(" ")}
            ref={trackRef}
            data-testid="day-slider-track"
            data-labels={labelFit.short ? "short" : "long"}
            // One column per day, all of equal width (REQ-640: no column for a whole-period button); the scale of the
            // long labels in the page's language (REQ-520).
            style={
              {
                "--day-count": count,
                "--day-weekday-scale": labelFit.weekday,
                "--day-date-scale": labelFit.date,
                "--day-date-text": `${labelFit.dateText}px`,
              } as CSSProperties
            }
          >
            {days.map((day, index) => {
              const selected = index >= shown.start && index <= shown.end;
              const className = [
                "day-card",
                day.isToday && "day-card--today",
                selected && "day-card--selected",
                // The ends of the selection, rounded on phones (REQ-548).
                selected && index === shown.start && "day-card--first",
                selected && index === shown.end && "day-card--last",
                // Today's weekday as large as the date on phones, where it has at most two letters (REQ-565).
                day.isToday &&
                  [...((labelFit.weekday < 1 ? labels[index]?.weekdayLetters : labels[index]?.weekday) ?? "")].length <= 2 &&
                  "day-card--large-weekday",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={day.start}
                  type="button"
                  className={className}
                  // The width of its two-letter weekday in em, which limits that label's font (REQ-626).
                  style={
                    {
                      gridColumn: index + 1,
                      "--day-letters-em": (labelFit.letters[index] ?? 0) > 0 ? labelFit.letters[index] : undefined,
                    } as CSSProperties
                  }
                  aria-current={day.isToday ? "date" : undefined}
                  aria-pressed={selected && !shownWhole}
                  aria-label={labels[index]?.full}
                  data-testid="day-card"
                  data-day={index}
                  // A click from the keyboard (detail 0) only selects the day; repeated Enter is no double click.
                  onClick={(event) => {
                    if (event.detail === 0) setSelection({ start: index, end: index });
                    else if (suppressClick.current) suppressClick.current = false;
                    else tapDay(index, event.timeStamp);
                  }}
                  onDoubleClick={selectAll}
                  {...cardHandlers}
                >
                  <span className="day-card__weekday">
                    <span className="day-card__long">{labels[index]?.weekday}</span>
                    <span className="day-card__short" aria-hidden="true">
                      {labels[index]?.weekdayLetters}
                    </span>
                  </span>
                  <span className="day-card__date">
                    <span className="day-card__long">{labels[index]?.date}</span>
                    <span className="day-card__short" aria-hidden="true">
                      {labels[index]?.day}
                    </span>
                  </span>
                </button>
              );
            })}
            {/* Today's bar on top of the marker's frame, so it stays visible when today is selected (REQ-502). */}
            {days.map((day, index) =>
              day.isToday ? (
                <span
                  key="today-bar"
                  className="day-slider__today-bar"
                  style={{ gridColumn: index + 1 }}
                  data-testid="day-slider-today-bar"
                  aria-hidden="true"
                />
              ) : null,
            )}
            <div
              className={[
                "day-slider__marker",
                shownWhole && "day-slider__marker--whole",
                // The selection reaches the strip's first or last day (REQ-540).
                shown.start === 0 && "day-slider__marker--first",
                shown.end === count - 1 && "day-slider__marker--last",
                draft && "day-slider__marker--dragging",
              ]
                .filter(Boolean)
                .join(" ")}
              // Its columns.
              style={{ "--marker-start": shown.start + 1, "--marker-end": shown.end + 2 } as CSSProperties}
              data-testid="day-slider-marker"
              data-start={shown.start}
              data-end={shown.end}
            >
              <span
                className="day-slider__handle day-slider__handle--start"
                role="slider"
                tabIndex={0}
                aria-label={t("daySlider.start")}
                aria-valuemin={0}
                aria-valuemax={count - 1}
                aria-valuenow={shown.start}
                aria-valuetext={labels[shown.start]?.full}
                data-testid="day-slider-start"
                title={wholeHint}
                data-drag="start"
                {...handlers}
              />
              <span
                className="day-slider__body"
                role="slider"
                tabIndex={shownWhole ? -1 : 0}
                aria-label={t("daySlider.period")}
                aria-valuemin={0}
                aria-valuemax={count - 1 - (shown.end - shown.start)}
                aria-valuenow={shown.start}
                aria-valuetext={rangeText(shown.start, shown.end)}
                aria-disabled={shownWhole}
                data-testid="day-slider-body"
                title={wholeHint}
                data-drag="move"
                onDoubleClick={() => {
                  if (!lastDragged.current) selectAll();
                }}
                {...handlers}
              />
              <span
                className="day-slider__handle day-slider__handle--end"
                role="slider"
                tabIndex={0}
                aria-label={t("daySlider.end")}
                aria-valuemin={0}
                aria-valuemax={count - 1}
                aria-valuenow={shown.end}
                aria-valuetext={labels[shown.end]?.full}
                data-testid="day-slider-end"
                title={wholeHint}
                data-drag="end"
                {...handlers}
              />
            </div>
            {/* On a phone place and elevation, centred in the row of the grips (REQ-562); the meteogram fills it. */}
            <div className="day-slider__caption" ref={captionRef} data-testid="day-slider-caption" />
            {/*
             * The same box as at the first load, over the days, so nothing moves (REQ-737): with the turning symbol and
             * "Loading forecast…" while a reload runs; while the chart is pulled down only the symbol, which turns with
             * the pull (DaySlider.css, `data-meteogram-pull` of usePullToRefresh.ts).
             */}
            <div
              className="day-slider__loading"
              data-testid="day-slider-loading"
              data-loading={reloading ? "" : undefined}
            >
              <LoadingMessage text={reloading} />
            </div>
          </div>
        )}
        {count > 0 && (
          <div className="day-slider__measure" ref={measureRef} aria-hidden="true" data-testid="day-slider-measure">
            {labels.map((label, index) => (
              <span key={`w${index}`} className="day-slider__measure-weekday">
                {label.weekday}
              </span>
            ))}
            {labels.map((label, index) => (
              <span key={`d${index}`} className="day-slider__measure-date">
                {label.date}
              </span>
            ))}
            {labels.map((label, index) => (
              <span key={`l${index}`} className="day-slider__measure-letters">
                {label.weekdayLetters}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
