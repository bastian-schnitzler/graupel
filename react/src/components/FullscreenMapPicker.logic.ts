import type {
  MapGeoJSONFeature,
  SymbolLayerSpecification,
  ExpressionSpecification,
} from "maplibre-gl";
import type { Location } from "../types";

export const sources = new Set(["place_label", "water_label", "poi_label"]);

export function featureLocation(f: MapGeoJSONFeature): Location | null {
  const p = f.properties;
  if (
    !sources.has(f.sourceLayer ?? "") ||
    !p ||
    ["tree", "entrance", "parking", "shop", "building"].includes(p.type) ||
    p.category === "shop" ||
    f.geometry.type !== "Point"
  )
    return null;
  const name = [p.name, p.name_de, p.name_en].find(
    (v) => typeof v === "string" && v.trim(),
  );
  const [longitude, latitude] = f.geometry.coordinates;
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude))
    return null;
  const raw = p.ele ?? p.elevation;
  const elevation =
    raw != null && String(raw).trim()
      ? Number(String(raw).replace(/\s*m\s*$/, ""))
      : NaN;
  return {
    name,
    latitude,
    longitude,
    ...(Number.isFinite(elevation) && elevation >= -500 && elevation <= 9000
      ? { elevation }
      : {}),
  };
}

export function identity(f: MapGeoJSONFeature): ExpressionSpecification {
  if (f.id !== undefined) return ["==", ["id"], f.id];
  return [
    "all",
    ...Object.entries(f.properties ?? {})
      .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
      .map(([k, v]) => ["==", ["get", k], v]),
  ] as ExpressionSpecification;
}

/**
 * MapLibre permits zoom only as the input of a top-level step/interpolate.
 * Insert the selection case into each output, preserving that original scale.
 */
export function highlightedPaint(
  base: unknown,
  condition: ExpressionSpecification,
  value: string | number,
): ExpressionSpecification {
  if (
    Array.isArray(base) &&
    ["interpolate", "interpolate-hcl", "interpolate-lab", "step"].includes(
      base[0],
    )
  ) {
    const inputIndex = base[0] === "step" ? 1 : 2;
    if (Array.isArray(base[inputIndex]) && base[inputIndex][0] === "zoom") {
      const result = [...base];
      const firstOutput = base[0] === "step" ? 2 : 4;
      for (let index = firstOutput; index < result.length; index += 2)
        result[index] = ["case", condition, value, result[index]];
      return result as ExpressionSpecification;
    }
  }
  return ["case", condition, value, base] as ExpressionSpecification;
}

export function buildCustomLocation(lngLat: {
  lng: number;
  lat: number;
}): Location {
  return {
    name: "Custom location",
    latitude: Number(lngLat.lat.toFixed(4)),
    longitude: Number(lngLat.lng.toFixed(4)),
  };
}

export function getFeatureKey(f: MapGeoJSONFeature | null): string | null {
  return f
    ? JSON.stringify([f.source, f.sourceLayer, f.id, f.properties])
    : null;
}

export function applyLayerHighlights(
  map: {
    setPaintProperty: (layerId: string, prop: string, val: unknown) => void;
  },
  layers: SymbolLayerSpecification[],
  selected: MapGeoJSONFeature | null,
  hovered: MapGeoJSONFeature | null,
) {
  for (const l of layers) {
    const matches = [selected, hovered].filter(
      (f): f is MapGeoJSONFeature =>
        !!f && f.source === l.source && f.sourceLayer === l["source-layer"],
    );
    const condition: ExpressionSpecification = matches.length
      ? ["any", ...matches.map(identity)]
      : ["==", 1, 0];
    for (const [property, value, fallback] of [
      ["text-halo-color", "#e879f9", "rgba(0,0,0,0)"],
      ["text-halo-width", 3, 0],
      ["text-halo-blur", 1, 0],
    ] as const) {
      map.setPaintProperty(
        l.id,
        property,
        highlightedPaint(l.paint?.[property] ?? fallback, condition, value),
      );
    }
  }
}
