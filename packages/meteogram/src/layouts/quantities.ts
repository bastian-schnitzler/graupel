// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import {
  BUILTIN_QUANTITY_REGISTRY,
  type QuantityRegistry,
} from "../quantities/registry";
import { TOOLTIP_OWN_ROWS } from "./tooltip";
import type { ResolvedChartLayout } from "./types";

/**
 * Quantities a resolved layout shows anywhere (drawn, popup-only series,
 * `snowFrom` and `fillTo` references, sources of derived quantities,
 * backgrounds and the rows of the popup).
 * Hover popup and fullscreen footer list only these.
 */
export function getLayoutQuantities(
  layout: ResolvedChartLayout,
  registry: QuantityRegistry = BUILTIN_QUANTITY_REGISTRY,
): Set<string> {
  const quantities = new Set<string>();
  for (const area of layout.areas) {
    if (area.background) quantities.add(area.background.kind);
    for (const series of area.series) {
      quantities.add(series.quantity);
      if (series.snowFrom) quantities.add(series.snowFrom);
      if (series.fillTo) quantities.add(series.fillTo);
      const definition = registry.get(series.quantity);
      if (definition?.source === "derived") {
        definition.requires.forEach((id) => quantities.add(id));
      }
    }
    // Rows of the popup (REQ-665), without its own sum and derived rows (REQ-676).
    for (const group of area.tooltip ?? []) {
      for (const row of group.rows) {
        if (!TOOLTIP_OWN_ROWS.includes(row)) quantities.add(row);
      }
    }
  }
  return quantities;
}

/** Quantities a resolved layout draws (popup-only series excluded). */
export function getDrawnQuantities(layout: ResolvedChartLayout): Set<string> {
  return new Set(
    layout.areas.flatMap((area) =>
      area.series
        .filter((series) => series.style !== "tooltip")
        .map((series) => series.quantity),
    ),
  );
}
