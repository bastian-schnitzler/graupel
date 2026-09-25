/// <reference types="node" />
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { enlargeMapLabels, scaleTextSize } from './maptoolkit';

const require = createRequire(import.meta.url);
const spec = createRequire(require.resolve('maplibre-gl'))('@maplibre/maplibre-gl-style-spec');
// Representative expressions from https://styles.maptoolkit.org/hiking.json.
const poiSize = ['interpolate', ['linear'], ['zoom'], 1,
  ['interpolate', ['linear'], ['get', 'rank_new'], 1, 6.51, 25, 1.18], 18,
  ['interpolate', ['linear'], ['get', 'rank_new'], 1, 38.27, 25, 6.96]];
const contourSize = ['interpolate', ['linear'], ['zoom'], 9, 6.58, 14,
  ['case', ['>', ['get', 'divisor'], 100], 11.14, 10.02], 16,
  ['case', ['>', ['get', 'divisor'], 100], 13.75, 12.38]];
function compiled(value: unknown) {
  const result = spec.createPropertyExpression(value, spec.latest.layout_symbol['text-size']);
  expect(result.result).toBe('success');
  return result.value;
}

describe('shared Maptoolkit label scaling', () => {
  it('scales sizes while keeping zoom stops, ranking thresholds and exponential bases', () => {
    expect(scaleTextSize(12, 1.5)).toBe(18);
    expect(scaleTextSize(['interpolate', ['exponential', 0.97], ['zoom'], 8, 12, 14, 16], 1.5))
      .toEqual(['interpolate', ['exponential', 0.97], ['zoom'], 8, 18, 14, 24]);
    expect(scaleTextSize(['step', ['zoom'], 10, 8, 12, 14, 16], 2))
      .toEqual(['step', ['zoom'], 20, 8, 24, 14, 32]);
  });

  it('evaluates real nested POI sizes at exactly 1.5 times the original', () => {
    const original = compiled(poiSize), enlarged = compiled(scaleTextSize(poiSize, 1.5));
    for (const zoom of [1, 8, 12, 18]) {
      for (const rank_new of [1, 10, 25]) {
        const feature = { properties: { rank_new } };
        expect(enlarged.evaluate({ zoom }, feature)).toBeCloseTo(original.evaluate({ zoom }, feature) * 1.5);
      }
    }
  });

  it('doubles contour text without changing the divisor condition or zoom thresholds', () => {
    const original = compiled(contourSize), enlarged = compiled(scaleTextSize(contourSize, 2));
    for (const zoom of [9, 12, 14, 16]) {
      for (const divisor of [100, 200, 1000]) {
        const feature = { properties: { divisor } };
        expect(enlarged.evaluate({ zoom }, feature)).toBeCloseTo(original.evaluate({ zoom }, feature) * 2);
      }
    }
  });

  it('preserves all non-size style properties, contour geometry and technical labels', () => {
    const style = {
      version: 8, sources: {mtk: {type:'vector',url:'https://tiles.maptoolkit.org/mtk.json'}},
      layers: [
        {id:'peak',type:'symbol',source:'mtk','source-layer':'poi_label',minzoom:8,filter:['==','type','peak'],layout:{'text-field':['get','name'],'text-size':poiSize,'text-font':['Noto Sans Regular'],'text-allow-overlap':false},paint:{'text-color':'black','text-halo-color':'white'}},
        {id:'contour-label',type:'symbol',source:'contours','source-layer':'contours',layout:{'text-field':['get','ele'],'text-size':contourSize}},
        {id:'contour-line',type:'line',source:'contours','source-layer':'contours',paint:{'line-width':1}},
        {id:'house-number',type:'symbol',source:'mtk','source-layer':'housenum_label',layout:{'text-field':['get','housenumber'],'text-size':10}},
        {id:'trail-shield',type:'symbol',source:'mtk','source-layer':'road_label',layout:{'text-field':['get','ref'],'text-size':10}},
        {id:'trail-name',type:'symbol',source:'mtk','source-layer':'road_label',layout:{'text-field':['get','name'],'text-size':10}},
      ],
    } as unknown as StyleSpecification;
    const before = structuredClone(style), enlarged = enlargeMapLabels(style);
    expect(style).toEqual(before);
    expect(enlarged.sources).toBe(style.sources);
    expect(enlarged.layers.slice(2,5)).toEqual(style.layers.slice(2,5));
    for (const index of [0,1,5]) {
      const layer = enlarged.layers[index];
      expect(layer.type).toBe('symbol');
      if (layer.type !== 'symbol') throw new Error('Expected symbol');
      expect({...layer,layout:{...layer.layout,'text-size':(before.layers[index] as any).layout['text-size']}}).toEqual(before.layers[index]);
    }
    expect((enlarged.layers[5] as any).layout['text-size']).toBe(15);
  });
});
