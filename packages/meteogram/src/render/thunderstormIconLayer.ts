// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { LIGHT_THEME, type MeteogramTheme } from "../core/theme";
import type { IconSlot } from "../core/thunderstormIcons";
import { canonicalTimestamp } from "../core/timeline";
import type { MeteogramLayout, MeteogramRenderMode } from "../core/viewLayout";
import { h, type VNode } from "./vnode";

export type ThunderstormIcon = IconSlot & { code: number };

/*!
 * Glyphs "cloud-lightning" and "cloud-hail" from Lucide (https://lucide.dev),
 * @license ISC, Copyright (c) 2026 Lucide Icons and Contributors. Inlined so
 * the core has no dependencies; full notice in THIRD_PARTY_LICENSES.md.
 */
const CLOUD_LIGHTNING_PATHS = [
  "M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973",
  "m13 12-3 5h4l-3 5",
];
const CLOUD_HAIL_PATHS = [
  "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",
  "M16 14v2",
  "M8 14v2",
  "M16 20h.01",
  "M8 20h.01",
  "M12 16v2",
  "M12 22h.01",
];

/** A 24×24 line icon drawn into a 14×14 box centred on the origin. */
function lineIcon(
  name: string,
  paths: string[],
  color: string,
  strokeWidth: number,
): VNode {
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: 14,
      height: 14,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      "stroke-width": strokeWidth,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: `lucide lucide-${name}`,
      "aria-hidden": "true",
      x: -7,
      y: -7,
    },
    paths.map((d) => h("path", { d })),
  );
}

export interface ThunderstormIconLayerProps {
  icons: ThunderstormIcon[];
  /** Top of the area; glyphs sit just below it. */
  top: number;
  getX: (ts: number) => number;
  layout: MeteogramLayout;
  instance: MeteogramRenderMode;
  theme?: MeteogramTheme;
}

/** Fixed-size thunderstorm glyphs (weather codes 95, 96, 99) per icon slot. */
export function thunderstormIconLayer({
  icons,
  top,
  getX,
  layout,
  instance,
  theme = LIGHT_THEME,
}: ThunderstormIconLayerProps): VNode[] {
  const colors = theme.thunderstormIcon;
  return icons.map((icon) =>
    h(
      "g",
      {
        key: icon.id,
        "data-testid": "thunderstorm-icon",
        "data-weather-code": icon.code,
        "data-interval-start": canonicalTimestamp(icon.start),
        "data-interval-end": canonicalTimestamp(icon.end),
        "data-center-x": getX(icon.center),
        "data-render-mode": instance,
        transform: `translate(${getX(icon.center)}, ${top + 11 * layout.windIconScaleY})`,
      },
      h(
        "g",
        { transform: `scale(${layout.windIconScaleX} ${layout.windIconScaleY})` },
        h("circle", {
          r: "8",
          fill: colors.background,
          stroke: colors.outline,
          "stroke-width": "0.6",
        }),
        lineIcon("cloud-lightning", CLOUD_LIGHTNING_PATHS, colors.glyph, 1.8),
        icon.code !== 95 &&
          lineIcon("cloud-hail", CLOUD_HAIL_PATHS, colors.glyph, icon.code === 99 ? 2.4 : 1.4),
      ),
    ),
  );
}
