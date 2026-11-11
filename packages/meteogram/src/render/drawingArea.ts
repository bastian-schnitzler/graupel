// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import type { PanelBounds } from "../core/drawingTypes";
import { LIGHT_THEME } from "../core/theme";
import { h, type VInput } from "./vnode";

export interface DrawingAreaProps {
  bounds: PanelBounds;
  clipId?: string;
  /** Also emit the clip path definition (callers usually define it once). */
  renderClipDef?: boolean;
  className?: string;
  testId?: string;
  showSeparator?: boolean;
  separatorY?: number;
  separatorStroke?: string;
  separatorStrokeWidth?: number;
  separatorOpacity?: number;
  separatorDashArray?: string;
  separatorLeft?: number;
  separatorRight?: number;
}

/** Clipped group of one plot region, optionally with a separator line below. */
export function drawingArea(
  {
    bounds,
    clipId,
    renderClipDef = false,
    className,
    testId,
    showSeparator = false,
    separatorY,
    separatorStroke = LIGHT_THEME.grid.panelSeparator,
    separatorStrokeWidth = 1,
    separatorOpacity = 1,
    separatorDashArray,
    separatorLeft,
    separatorRight,
  }: DrawingAreaProps,
  children: VInput[],
): VInput[] {
  const lineY = separatorY !== undefined ? separatorY : bounds.top + bounds.height;
  const x1 = separatorLeft !== undefined ? separatorLeft : bounds.left;
  const x2 =
    separatorRight !== undefined ? separatorRight : bounds.left + bounds.width;

  return [
    clipId &&
      renderClipDef &&
      h(
        "defs",
        null,
        h(
          "clipPath",
          { id: clipId },
          h("rect", {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
          }),
        ),
      ),
    h(
      "g",
      {
        class: className,
        "data-testid": testId,
        "clip-path": clipId ? `url(#${clipId})` : undefined,
      },
      children,
    ),
    showSeparator &&
      h("line", {
        x1,
        y1: lineY,
        x2,
        y2: lineY,
        stroke: separatorStroke,
        "stroke-width": separatorStrokeWidth,
        opacity: separatorOpacity,
        "stroke-dasharray": separatorDashArray,
        "data-testid": "panel-separator-line",
      }),
  ];
}
