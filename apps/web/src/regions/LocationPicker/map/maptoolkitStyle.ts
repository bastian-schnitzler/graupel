// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Maptoolkit hiking style for MapLibre and picking named places
 * from its labels. Only types come from maplibre-gl, so this
 * module does not load the library.
 */
import type {
  ExpressionSpecification,
  MapGeoJSONFeature,
  RequestParameters,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import type { Place } from "../../../config/index.ts";

export const MAPTOOLKIT_STYLE = "https://styles.maptoolkit.org/hiking.json";
export const MAP_ATTRIBUTION_OPTIONS = { compact: false, customAttribution: "" };

/**
 * Identification at Maptoolkit (REQ-698, DEC-075): Maptoolkit tells applications apart by Referer (and User-Agent, IP),
 * not by a URL parameter (maptoolkit.org/tos, section 9). The browser sends the page's domain (graupel.eu, graupel.at,
 * …) as Origin; the Referer carries it too, cut down to the domain by this policy, so no path or place leaves the
 * page. index.html sets the same policy for the whole page. A fork serves its own domain and so gets its own
 * identification without any change here (README, REQ-699).
 */
export const MAPTOOLKIT_REFERRER_POLICY: ReferrerPolicy = "strict-origin-when-cross-origin";

/** Whether a URL goes to Maptoolkit (styles, tiles, fonts, sprites on maptoolkit.org and its subdomains). */
export function isMaptoolkitUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (hostname === "maptoolkit.org" || hostname.endsWith(".maptoolkit.org"));
  } catch {
    return false;
  }
}

/** MapLibre's transformRequest: every request to Maptoolkit carries the page's domain as Referer (REQ-698). */
export function maptoolkitRequest(url: string): RequestParameters {
  return isMaptoolkitUrl(url) ? { url, referrerPolicy: MAPTOOLKIT_REFERRER_POLICY } : { url };
}

let prefetchedStyle: Promise<StyleSpecification> | null = null;

/**
 * Starts loading the Maptoolkit style while the map library (about 290 kB compressed) still loads (REQ-771): without
 * it, MapLibre asks for the style only once the library has loaded and run, which a slow device such as an iPad Air 2
 * takes a while for. The request is the one MapLibre would make, with the page's domain as Referer (REQ-698).
 */
export function prefetchMaptoolkitStyle(): void {
  if (prefetchedStyle || typeof fetch !== "function") return;
  const { url, referrerPolicy } = maptoolkitRequest(MAPTOOLKIT_STYLE);
  const loading = fetch(url, { referrerPolicy }).then((response) => {
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json() as Promise<StyleSpecification>;
  });
  // Nobody may take it (the map closed first); a failure is then not an unhandled rejection.
  loading.catch(() => {});
  prefetchedStyle = loading;
}

/** The style `prefetchMaptoolkitStyle` started loading, once; `null` when none was started. */
export function takeMaptoolkitStyle(): Promise<StyleSpecification> | null {
  const style = prefetchedStyle;
  prefetchedStyle = null;
  return style;
}

/** Scales evaluated text sizes, keeping input thresholds and zoom as top-level input. */
export function scaleTextSize(value: unknown, factor: number): number | ExpressionSpecification {
  if (typeof value === "number") return value * factor;
  if (Array.isArray(value)) {
    const result: unknown[] = [...value];
    const operator = value[0];
    if (operator === "interpolate" || operator === "step") {
      for (let i = operator === "step" ? 2 : 4; i < result.length; i += 2) result[i] = scaleTextSize(result[i], factor);
      return result as ExpressionSpecification;
    }
    if (operator === "case" || operator === "match") {
      for (let i = operator === "case" ? 2 : 3; i < result.length - 1; i += 2)
        result[i] = scaleTextSize(result[i], factor);
      result[result.length - 1] = scaleTextSize(result[result.length - 1], factor);
      return result as ExpressionSpecification;
    }
  }
  return ["*", value, factor] as ExpressionSpecification;
}

function readsName(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    ((value[0] === "get" && /^name(?:_|$)/.test(String(value[1]))) || value.some(readsName))
  );
}

/** Larger place names (1.5×) and contour labels (2×) than the Maptoolkit style. */
export function enlargeMapLabels(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (layer.type !== "symbol" || !layer.layout?.["text-field"]) return layer;
      const factor =
        layer["source-layer"] === "contours" ? 2 : readsName(layer.layout["text-field"]) ? 1.5 : 1;
      if (factor === 1) return layer;
      return {
        ...layer,
        layout: { ...layer.layout, "text-size": scaleTextSize(layer.layout["text-size"] ?? 16, factor) },
      } as SymbolLayerSpecification;
    }),
  };
}

/** Label layers whose features can be picked as named places. */
export const PICK_SOURCES = new Set(["place_label", "water_label", "poi_label"]);

/** The named place of a label feature, or `null` when it is not a pickable place. */
export function featurePlace(feature: MapGeoJSONFeature): Place | null {
  const p = feature.properties as Record<string, unknown> | null;
  if (
    !PICK_SOURCES.has(feature.sourceLayer ?? "") ||
    !p ||
    ["tree", "entrance", "parking", "shop", "building"].includes(String(p.type)) ||
    p.category === "shop" ||
    feature.geometry.type !== "Point"
  )
    return null;
  const name = [p.name, p.name_de, p.name_en].find((v): v is string => typeof v === "string" && v.trim() !== "");
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const raw = p.ele ?? p.elevation;
  const elevation = raw != null && String(raw).trim() ? Number(String(raw).replace(/\s*m\s*$/, "")) : NaN;
  return {
    name,
    lat,
    lon,
    ...(Number.isFinite(elevation) && elevation >= -500 && elevation <= 9000 ? { elevation } : {}),
  };
}

/**
 * A point picked on the map that is no named place: no own name (REQ-536, it is shown by its coordinates), coordinates
 * rounded to four decimals.
 */
export function pointPlace(lngLat: { lng: number; lat: number }): Place {
  return { name: "", lat: Number(lngLat.lat.toFixed(4)), lon: Number(lngLat.lng.toFixed(4)) };
}

function identity(feature: MapGeoJSONFeature): ExpressionSpecification {
  if (feature.id !== undefined) return ["==", ["id"], feature.id];
  return [
    "all",
    ...Object.entries(feature.properties ?? {})
      .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
      .map(([k, v]) => ["==", ["get", k], v]),
  ] as ExpressionSpecification;
}

/**
 * MapLibre permits zoom only as the input of a top-level step/interpolate: the selection case goes into
 * each output, keeping the original scale.
 */
export function highlightedPaint(
  base: unknown,
  condition: ExpressionSpecification,
  value: string | number,
): ExpressionSpecification {
  if (Array.isArray(base) && ["interpolate", "interpolate-hcl", "interpolate-lab", "step"].includes(base[0])) {
    const inputIndex = base[0] === "step" ? 1 : 2;
    if (Array.isArray(base[inputIndex]) && base[inputIndex][0] === "zoom") {
      const result: unknown[] = [...base];
      const firstOutput = base[0] === "step" ? 2 : 4;
      for (let index = firstOutput; index < result.length; index += 2)
        result[index] = ["case", condition, value, result[index]];
      return result as ExpressionSpecification;
    }
  }
  return ["case", condition, value, base] as ExpressionSpecification;
}

export function featureKey(feature: MapGeoJSONFeature | null): string | null {
  return feature ? JSON.stringify([feature.source, feature.sourceLayer, feature.id, feature.properties]) : null;
}

/** Halo around the selected and the hovered label. */
export function applyLayerHighlights(
  map: { setPaintProperty: (layerId: string, property: string, value: unknown) => void },
  layers: readonly SymbolLayerSpecification[],
  selected: MapGeoJSONFeature | null,
  hovered: MapGeoJSONFeature | null,
): void {
  for (const layer of layers) {
    const matches = [selected, hovered].filter(
      (f): f is MapGeoJSONFeature => !!f && f.source === layer.source && f.sourceLayer === layer["source-layer"],
    );
    const condition: ExpressionSpecification = matches.length ? ["any", ...matches.map(identity)] : ["==", 1, 0];
    for (const [property, value, fallback] of [
      ["text-halo-color", "#e879f9", "rgba(0,0,0,0)"],
      ["text-halo-width", 3, 0],
      ["text-halo-blur", 1, 0],
    ] as const) {
      map.setPaintProperty(
        layer.id,
        property,
        highlightedPaint(layer.paint?.[property] ?? fallback, condition, value),
      );
    }
  }
}
