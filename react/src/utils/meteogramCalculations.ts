/**
 * Pure calculation functions for meteogram charts.
 */

/**
 * Calculates accumulated precipitation across contiguous adjacent hours with precipitation (> 0)
 * around a given hovered index. Stops if a dry hour or a timestamp gap (> 1 hour) is encountered.
 *
 * @param hoverIndex The index of the currently hovered column, or null.
 * @param precipValues The array of precipitation values.
 * @param timestamps The array of hourly timestamps (in epoch milliseconds).
 * @returns The accumulated sum in mm, or null if the hovered hour is dry/unavailable.
 */
export function calculateAccumulatedPrecipitation(
  hoverIndex: number | null,
  precipValues: (number | null | undefined)[],
  timestamps: number[],
): number | null {
  if (
    hoverIndex === null ||
    hoverIndex < 0 ||
    hoverIndex >= precipValues.length
  ) {
    return null;
  }

  const current = precipValues[hoverIndex];
  if (typeof current !== "number" || isNaN(current) || current <= 0) {
    return null;
  }

  let sum = current;

  // Scan left (earlier in time)
  let left = hoverIndex - 1;
  while (left >= 0) {
    const val = precipValues[left];
    if (typeof val !== "number" || isNaN(val) || val <= 0) break;
    const tsCurr = timestamps[left + 1];
    const tsPrev = timestamps[left];
    const diffHours = (tsCurr - tsPrev) / (1000 * 3600);
    if (Math.round(diffHours) !== 1) break;
    sum += val;
    left--;
  }

  // Scan right (later in time)
  let right = hoverIndex + 1;
  while (right < precipValues.length) {
    const val = precipValues[right];
    if (typeof val !== "number" || isNaN(val) || val <= 0) break;
    const tsNext = timestamps[right];
    const tsCurr = timestamps[right - 1];
    const diffHours = (tsNext - tsCurr) / (1000 * 3600);
    if (Math.round(diffHours) !== 1) break;
    sum += val;
    right++;
  }

  return sum;
}
