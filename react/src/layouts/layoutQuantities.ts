import { getQuantity } from "../quantities/registry";
import type { ResolvedChartLayout } from "./types";

/**
 * Quantities a resolved layout shows anywhere (drawn, popup-only series,
 * `snowFrom` references, sources of derived quantities and backgrounds).
 * Hover popup and fullscreen footer list only these.
 */
export function getLayoutQuantities(layout: ResolvedChartLayout): Set<string> {
  const quantities = new Set<string>();
  for (const area of layout.areas) {
    if (area.background) quantities.add(area.background.kind);
    for (const series of area.series) {
      quantities.add(series.quantity);
      if (series.snowFrom) quantities.add(series.snowFrom);
      const definition = getQuantity(series.quantity);
      if (definition?.source === "derived") {
        definition.requires.forEach((id) => quantities.add(id));
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
