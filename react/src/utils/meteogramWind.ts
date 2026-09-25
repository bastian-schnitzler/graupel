import { canonicalTimestamp } from './timeline';

export interface TimedWindDirection {
  timeMs: number;
  direction: number;
  model: string;
}

export interface WindIconItem {
  id: string;
  x: number;
  timestamp: string;
  dir: number;
  arrowAngle: number;
}

/**
 * Circular vector interpolation for wind directions (in degrees [0, 360)).
 * Correctly interpolates across 0° / 360° (e.g. 350° and 10° interpolate through 0°).
 */
export function interpolateWindDirection(
  dir0: number,
  dir1: number,
  weight0: number,
  weight1: number,
): number {
  if (weight0 <= 0) return ((dir1 % 360) + 360) % 360;
  if (weight1 <= 0) return ((dir0 % 360) + 360) % 360;
  if (dir0 === dir1) return ((dir0 % 360) + 360) % 360;

  const rad0 = (dir0 * Math.PI) / 180;
  const rad1 = (dir1 * Math.PI) / 180;

  const vx = weight0 * Math.cos(rad0) + weight1 * Math.cos(rad1);
  const vy = weight0 * Math.sin(rad0) + weight1 * Math.sin(rad1);

  if (Math.hypot(vx, vy) < 1e-9) {
    return ((dir0 % 360) + 360) % 360;
  }

  let deg = (Math.atan2(vy, vx) * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  if (Math.abs(deg) < 1e-9 || Math.abs(deg - 360) < 1e-9) {
    return 0;
  }
  return deg;
}

/**
 * Binary searches and interpolates wind direction at a specific timestamp.
 */
export function getWindDirectionAtTime(
  samples: TimedWindDirection[],
  targetTimeMs: number,
): number | null {
  if (samples.length === 0) return null;

  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].timeMs < targetTimeMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const next = samples[low];
  const previous = low > 0 ? samples[low - 1] : undefined;

  if (next?.timeMs === targetTimeMs) return next.direction;
  if (!previous) return next?.direction ?? null;
  if (!next) return previous.direction;

  // Never blend observations across a model handover. The value immediately
  // before the absolute boundary belongs to the previous half-open segment;
  // the value at the boundary belongs to the next one.
  if (previous.model !== next.model) return previous.direction;

  const intervalMs = next.timeMs - previous.timeMs;
  if (intervalMs <= 0) return previous.direction;

  const nextWeight = (targetTimeMs - previous.timeMs) / intervalMs;
  return interpolateWindDirection(
    previous.direction,
    next.direction,
    1 - nextWeight,
    nextWeight,
  );
}

/**
 * Calculates rendered wind icon arrows for given timeline slots.
 */
export function calculateWindIcons(
  slots: { id: string; center: number }[],
  samples: TimedWindDirection[],
  getX: (ts: number) => number,
): WindIconItem[] {
  return slots.flatMap((slot) => {
    const direction = getWindDirectionAtTime(samples, slot.center);
    if (direction === null) return [];
    const dir = Math.round(direction * 10) / 10;
    return [
      {
        id: `wind-arrow-${slot.id}`,
        x: getX(slot.center),
        timestamp: canonicalTimestamp(slot.center),
        dir,
        arrowAngle: Math.round(((dir + 180) % 360) * 10) / 10,
      },
    ];
  });
}

