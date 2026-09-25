import { MaptoolkitLogoControl } from '@maptoolkit/maplibre-gl-logo';
import type { Map, StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { MouseEvent } from 'react';
import { apiService } from '../services/apiService';

export const MAPTOOLKIT_STYLE = 'https://styles.maptoolkit.org/hiking.json';
export const MAP_ATTRIBUTION_OPTIONS = { compact: false, customAttribution: '' };

// Scale evaluated sizes, preserving input thresholds and zoom as a top-level input.
export function scaleTextSize(value: unknown, factor: number): number | ExpressionSpecification {
  if (typeof value === 'number') return value * factor;
  if (Array.isArray(value)) {
    const result = [...value];
    const operator = value[0];
    if (operator === 'interpolate' || operator === 'step') {
      for (let i = operator === 'step' ? 2 : 4; i < result.length; i += 2)
        result[i] = scaleTextSize(result[i], factor);
      return result as ExpressionSpecification;
    }
    if (operator === 'case' || operator === 'match') {
      for (let i = operator === 'case' ? 2 : 3; i < result.length - 1; i += 2)
        result[i] = scaleTextSize(result[i], factor);
      result[result.length - 1] = scaleTextSize(result[result.length - 1], factor);
      return result as ExpressionSpecification;
    }
  }
  return ['*', value, factor] as ExpressionSpecification;
}

function readsName(value: unknown): boolean {
  return Array.isArray(value) && ((value[0] === 'get' && /^name(?:_|$)/.test(String(value[1]))) || value.some(readsName));
}

export function enlargeMapLabels(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map(layer => {
      if (layer.type !== 'symbol' || !layer.layout?.['text-field']) return layer;
      const factor = layer['source-layer'] === 'contours' ? 2 : readsName(layer.layout['text-field']) ? 1.5 : 1;
      if (factor === 1) return layer;
      return {
        ...layer,
        layout: { ...layer.layout, 'text-size': scaleTextSize(layer.layout['text-size'] ?? 16, factor) },
      };
    }),
  };
}

export function loadMaptoolkit(map: Map) {
  map.setStyle(MAPTOOLKIT_STYLE, { transformStyle: (_previous, next) => enlargeMapLabels(next) });
  map.addControl(new MaptoolkitLogoControl(), 'bottom-left');
}

// Capture before map controls stop bubbling; both maps use the desktop bridge.
export function handleMapAttributionClick(event: MouseEvent<HTMLDivElement>) {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>(
    '.maplibregl-ctrl-attrib a[href], .maptoolkit-logo-control a[href]',
  );
  if (!link || !event.currentTarget.contains(link)) return;
  event.preventDefault();
  event.stopPropagation();
  void apiService.openExternalUrl(link.href);
}
