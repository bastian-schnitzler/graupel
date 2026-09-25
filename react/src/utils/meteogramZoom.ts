import { HOUR_MS } from './timeline';

export interface TimeRange {
  start: number;
  end: number;
}

export interface ZoomContext {
  range: TimeRange;
  maximumRange: TimeRange;
  hoverTime: number | null;
  direction: 'in' | 'out';
}

export const ZOOM_BASE_FACTOR = 0.82;
const ZOOM_ASYMMETRY = 0.12;
export const MINIMUM_VISIBLE_DURATION_MS = 6 * HOUR_MS;
const RANGE_EPSILON_MS = 0.01;

function isValidRange(range: TimeRange): boolean {
  return Number.isFinite(range.start)
    && Number.isFinite(range.end)
    && range.end > range.start;
}

export function clampTimeRange(range: TimeRange, maximumRange: TimeRange): TimeRange {
  if (!isValidRange(maximumRange)) return range;
  if (!isValidRange(range)) return { ...maximumRange };
  const start = Math.max(maximumRange.start, range.start);
  const end = Math.min(maximumRange.end, range.end);
  return end > start ? { start, end } : { ...maximumRange };
}

function zoomInFactors(position: number): { left: number; right: number } {
  const offsetFromCenter = 0.5 - position;
  return {
    left: ZOOM_BASE_FACTOR + ZOOM_ASYMMETRY * offsetFromCenter * 2,
    right: ZOOM_BASE_FACTOR - ZOOM_ASYMMETRY * offsetFromCenter * 2,
  };
}

function positionAfterZoomIn(position: number): number {
  const factors = zoomInFactors(position);
  const left = position * factors.left;
  const right = (1 - position) * factors.right;
  return left / (left + right);
}

/** Find the pre-zoom position whose zoom-in result is `position`. */
function positionBeforeZoomIn(position: number): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middle = (low + high) / 2;
    if (positionAfterZoomIn(middle) < position) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function clampAnchoredRange(
  start: number,
  end: number,
  maximumRange: TimeRange,
  hoverTime: number,
): TimeRange {
  let nextStart = Math.max(maximumRange.start, start);
  let nextEnd = Math.min(maximumRange.end, end);

  if (nextStart >= hoverTime) nextStart = Math.max(maximumRange.start, hoverTime - 1);
  if (nextEnd <= hoverTime) nextEnd = Math.min(maximumRange.end, hoverTime + 1);
  if (nextEnd <= nextStart) return { ...maximumRange };

  if (Math.abs(nextStart - maximumRange.start) <= RANGE_EPSILON_MS) {
    nextStart = maximumRange.start;
  }
  if (Math.abs(nextEnd - maximumRange.end) <= RANGE_EPSILON_MS) {
    nextEnd = maximumRange.end;
  }
  return { start: nextStart, end: nextEnd };
}

/**
 * Pure timestamp-only meteogram zoom calculation. Off-centre hover anchors
 * contract their shorter side more slowly and their longer side more quickly.
 * Zoom-out numerically reverses that mapping before maximum-range clamping.
 */
export function calculateZoomedTimeRange(context: ZoomContext): TimeRange {
  const maximumRange = context.maximumRange;
  const range = clampTimeRange(context.range, maximumRange);
  if (!isValidRange(range) || !isValidRange(maximumRange)) return range;

  const duration = range.end - range.start;
  const maximumDuration = maximumRange.end - maximumRange.start;
  if (context.direction === 'out'
    && range.start === maximumRange.start
    && range.end === maximumRange.end) {
    return range;
  }

  const hoverTime = context.hoverTime;
  if (hoverTime === null || hoverTime <= range.start || hoverTime >= range.end) {
    if (context.direction === 'in') {
      const nextDuration = Math.max(
        Math.min(MINIMUM_VISIBLE_DURATION_MS, maximumDuration),
        duration * ZOOM_BASE_FACTOR,
      );
      return { start: range.start, end: range.start + nextDuration };
    }
    return {
      start: range.start,
      end: Math.min(maximumRange.end, range.start + duration / ZOOM_BASE_FACTOR),
    };
  }

  const leftDistance = hoverTime - range.start;
  const rightDistance = range.end - hoverTime;
  const position = leftDistance / duration;

  if (context.direction === 'in') {
    if (duration <= Math.min(MINIMUM_VISIBLE_DURATION_MS, maximumDuration)) return range;
    const factors = zoomInFactors(position);
    let newLeft = leftDistance * factors.left;
    let newRight = rightDistance * factors.right;
    const newDuration = newLeft + newRight;
    const minimumDuration = Math.min(MINIMUM_VISIBLE_DURATION_MS, maximumDuration);
    if (newDuration < minimumDuration) {
      const adjustment = minimumDuration / newDuration;
      newLeft *= adjustment;
      newRight *= adjustment;
    }
    return clampAnchoredRange(
      hoverTime - newLeft,
      hoverTime + newRight,
      maximumRange,
      hoverTime,
    );
  }

  const priorPosition = positionBeforeZoomIn(position);
  const factors = zoomInFactors(priorPosition);
  return clampAnchoredRange(
    hoverTime - leftDistance / factors.left,
    hoverTime + rightDistance / factors.right,
    maximumRange,
    hoverTime,
  );
}

export function normalizeWheelZoomDirection(
  deltaY: number,
  deltaMode: number,
): 'in' | 'out' | null {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  if (!Number.isFinite(pixels) || Math.abs(pixels) < 0.01) return null;
  return pixels < 0 ? 'in' : 'out';
}

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** Return the UTC instant representing 00:00 of the previous local day. */
export function getPreviousLocalMidnight(now: number, timeZone = 'UTC'): number {
  const current = zonedParts(now, timeZone === 'auto' ? 'UTC' : timeZone);
  const desired = Date.UTC(
    Number(current.year),
    Number(current.month) - 1,
    Number(current.day) - 1,
  );
  let candidate = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(candidate, timeZone === 'auto' ? 'UTC' : timeZone);
    const representedAsUtc = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
    );
    candidate += desired - representedAsUtc;
  }
  return candidate;
}
