// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { LIGHT_THEME, type MeteogramTheme } from "../core/theme";
import type { WindIconItem } from "../core/wind";
import {
  WIND_ICON_RADIUS_PX,
  type MeteogramLayout,
  type MeteogramRenderMode,
} from "../core/viewLayout";
import { h, type VNode } from "./vnode";

export interface WindArrowIconsProps {
  icons: WindIconItem[];
  /** Vertical center of the icon row. */
  y: number;
  layout: MeteogramLayout;
  instance: MeteogramRenderMode;
  theme?: MeteogramTheme;
}

/** Wind-direction arrows in fixed-size circles, pointing where wind blows. */
export function windArrowIcons({
  icons,
  y,
  layout,
  instance,
  theme = LIGHT_THEME,
}: WindArrowIconsProps): VNode[] {
  const colors = theme.windIcon;
  return icons.map((icon) =>
    h(
      "g",
      {
        key: icon.id,
        transform: `translate(${icon.x}, ${y})`,
        "data-testid": "wind-arrow-group",
        "data-timestamp": icon.timestamp,
        "data-center-x": icon.x,
      },
      h(
        "g",
        {
          transform: `scale(${layout.windIconScaleX} ${layout.windIconScaleY})`,
          "data-testid": "wind-icon-glyph",
          "data-render-mode": instance,
          "data-rendered-width": layout.renderedWidth,
          "data-rendered-height": layout.renderedHeight,
        },
        h("circle", {
          cx: "0",
          cy: "0",
          r: WIND_ICON_RADIUS_PX,
          fill: colors.background,
          stroke: colors.outline,
          "stroke-width": "0.9",
        }),
        h(
          "g",
          {
            transform: `rotate(${icon.arrowAngle})`,
            "data-testid": "wind-arrow",
            "data-direction": icon.dir ?? undefined,
            "data-arrow-angle": icon.arrowAngle,
          },
          h("line", {
            x1: "0",
            y1: "4.5",
            x2: "0",
            y2: "-4.5",
            stroke: colors.arrow,
            "stroke-width": "1.62",
          }),
          h("polygon", { points: "0,-6.3 -2.7,-1.8 2.7,-1.8", fill: colors.arrow }),
        ),
      ),
    ),
  );
}
