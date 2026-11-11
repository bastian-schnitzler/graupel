// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Rendered size of the chart: measured with `getBoundingClientRect`, followed
 * with a `ResizeObserver` where one exists.
 */

export interface ChartDimensions {
  width: number;
  height: number;
}

export interface SizeObserver {
  /** Measures now; calls `onChange` when the size changed. */
  measure(): void;
  /** Stops observing. */
  disconnect(): void;
}

/**
 * Measures `element` now and on every resize and calls `onChange` when the
 * size differs from the last one reported. A width of 0 (hidden, detached,
 * no layout) is ignored, so the last real size stays.
 */
export function observeSize(
  element: Element,
  onChange: (size: ChartDimensions) => void,
): SizeObserver {
  let current: ChartDimensions | null = null;
  const measure = () => {
    const { width, height } = element.getBoundingClientRect();
    if (!(width > 0)) return;
    if (current && current.width === width && current.height === height) return;
    current = { width, height };
    onChange(current);
  };
  measure();
  if (typeof ResizeObserver === "undefined") {
    return { measure, disconnect: () => undefined };
  }
  const observer = new ResizeObserver(() => measure());
  observer.observe(element);
  return { measure, disconnect: () => observer.disconnect() };
}
