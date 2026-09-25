/// <reference types="node" />
import { createRequire } from "node:module";
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMap, MockMarker, maplibreMock } from '../test/maplibreMock';
vi.mock('maplibre-gl', () => maplibreMock);
import { FullscreenMapPicker, MAPTOOLKIT_STYLE, featureLocation, highlightedPaint } from './FullscreenMapPicker';
import { apiService } from '../services/apiService';
const origin = {name:'Origin',latitude:50,longitude:8,elevation:100};
const feature = (id = 1, name = 'Matterhorn', ele: unknown = 4478) => ({id,source:'mtk',sourceLayer:'poi_label',properties:{name,type:'peak',ele},geometry:{type:'Point',coordinates:[7.6586,45.9763]}});
const event = () => ({lngLat:{lat:46.123456,lng:9.234567},point:{x:100,y:50},preventDefault:vi.fn()});
function open() {
  const onAccept = vi.fn(), onCancel = vi.fn();
  const result = render(<FullscreenMapPicker initialLocation={origin} onAccept={onAccept} onCancel={onCancel}/>);
  const map = MockMap.instances.at(-1)!;
  act(() => map.fire('load'));
  return {...result,map,onAccept,onCancel,marker:MockMarker.instances.at(-1)!};
}
describe('MapLibre fullscreen picker',() => {
  beforeEach(() => {vi.restoreAllMocks();MockMap.instances = [];MockMarker.instances = [];vi.spyOn(apiService,'getElevationForCoords').mockResolvedValue(2300);});
  it.each([undefined, 1000, 1001, 4478])('uses elevation %s only for the opening zoom', elevation => {
    const props = {initialLocation:{...origin,elevation},onAccept:vi.fn(),onCancel:vi.fn()};
    const {rerender} = render(<FullscreenMapPicker {...props}/>);
    const map = MockMap.instances.at(-1)!;
    expect(map.options.zoom).toBe(elevation != null && elevation > 1000 ? 14 : 10);
    map.options.zoom = 14; // Simulate the user choosing a closer view.
    rerender(<FullscreenMapPicker {...props}/>);
    expect(MockMap.instances.at(-1)).toBe(map);
    expect(map.options.zoom).toBe(14);
  });
  it('loads Maptoolkit hiking with expanded attribution and official logo; preserves opening location',() => {
    const {map,container} = open();
    expect(map.options).toMatchObject({center:[8,50],doubleClickZoom:false,attributionControl:{compact:false}});
    expect(container.querySelector('.maplibregl-ctrl-attrib')!.textContent).toContain('© Maptoolkit');
    expect(map.styleUrl).toBe(MAPTOOLKIT_STYLE);
    expect(map.getStyle().layers[0].layout["text-size"]).toBe(18);
    expect(map.controls).toHaveLength(2);
    const logo = container.querySelector<HTMLImageElement>('img[alt="Maptoolkit"]')!;
    expect(logo.height).toBe(24);
    expect(logo.closest('a')!.href).toBe('https://www.maptoolkit.org/');
  });
  it('selects free coordinates without acceptance, then OK looks up their elevation',async () => {
    const {map,onAccept,marker} = open();act(() => map.fire('click',event()));
    expect(onAccept).not.toHaveBeenCalled();expect(marker.coordinates).toEqual([9.2346,46.1235]);
    fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith({name:'Custom location',latitude:46.1235,longitude:9.2346,elevation:2300}));
  });
  it('accepts free coordinates directly on double click and prevents zoom',async () => {
    const {map,onAccept} = open();const e = event();act(() => map.fire('dblclick',e));
    expect(e.preventDefault).toHaveBeenCalled();await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
  });
  it('highlights native labels on hover, preserves selected halo on leave and replaces selection',async () => {
    const {map,onAccept,marker} = open();map.features = [feature()];
    act(() => map.fire('mousemove',event()));
    expect(map.canvas.style.cursor).toBe('pointer');
    expect(map.setPaintProperty).toHaveBeenCalledWith('poi_label_peak_rank_1','text-halo-color',['case',['any',['==',['id'],1]],'#e879f9','white']);
    act(() => map.fire('mouseout'));expect(map.setPaintProperty.mock.calls.at(-3)![2][1]).toEqual(['==',1,0]);
    act(() => map.fire('click',event()));act(() => map.fire('mouseout'));
    expect(marker.coordinates).toEqual([7.6586,45.9763]);expect(onAccept).not.toHaveBeenCalled();
    expect(map.setPaintProperty.mock.calls.at(-3)![2][1]).toEqual(['any',['==',['id'],1]]);
    map.features = [feature(2,'Another peak')];act(() => map.fire('mousemove',event()));
    expect(map.setPaintProperty.mock.calls.at(-3)![2][1]).toEqual(['any',['==',['id'],1],['==',['id'],2]]);
    act(() => map.fire('click',event()));act(() => map.fire('mouseout'));
    expect(map.setPaintProperty.mock.calls.at(-3)![2][1]).toEqual(['any',['==',['id'],2]]);
    fireEvent.click(screen.getByText('OK'));await waitFor(() => expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({name:'Another peak',elevation:4478})));
    expect(apiService.getElevationForCoords).not.toHaveBeenCalled();
  });
  it('feature double click uses feature name/anchor rather than underlying map coordinate',async () => {
    const {map,onAccept} = open();map.features = [feature()];act(() => map.fire('dblclick',event()));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith({name:'Matterhorn',latitude:45.9763,longitude:7.6586,elevation:4478}));
  });
  it('looks up missing feature elevation and retains its name',async () => {
    const {map,onAccept} = open();map.features = [feature(1,'Hut',null)];act(() => map.fire('click',event()));fireEvent.click(screen.getByText('OK'));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({name:'Hut',elevation:2300})));
  });
  it('clears selected highlight on free click and never retains old elevation',async () => {
    const {map,onAccept} = open();map.features = [feature()];act(() => map.fire('click',event()));map.features = [];act(() => map.fire('click',event()));
    expect(map.setPaintProperty.mock.calls.at(-3)![2][1]).toEqual(['==',1,0]);
    fireEvent.click(screen.getByText('OK'));await waitFor(() => expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({name:'Custom location',elevation:2300})));
  });
  it('cancels pending edits and disposes map/marker',() => {
    const {map,onAccept,onCancel,unmount,marker} = open();act(() => map.fire('click',event()));fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();expect(onAccept).not.toHaveBeenCalled();unmount();expect(map.remove).toHaveBeenCalledOnce();expect(marker.remove).toHaveBeenCalledOnce();
  });
  it('does not accept late elevation after cancellation/unmount',async () => {
    let resolve!: (value: number) => void;
    vi.mocked(apiService.getElevationForCoords).mockReturnValue(new Promise(r => {resolve = r;}));
    const {map,onAccept,unmount} = open();act(() => map.fire('dblclick',event()));unmount();await act(async () => resolve(800));expect(onAccept).not.toHaveBeenCalled();
  });
  it('lets a newer feature double click supersede a pending elevation request', async () => {
    let resolve!: (value: number) => void;
    vi.mocked(apiService.getElevationForCoords).mockReturnValue(new Promise(r => {resolve = r;}));
    const {map,onAccept} = open();
    act(() => map.fire('dblclick',event()));
    map.features = [feature()];
    act(() => map.fire('dblclick',event()));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith(expect.objectContaining({name:'Matterhorn',elevation:4478})));
    await act(async () => resolve(800));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
  it('opens attribution links externally',() => {
    const external = vi.spyOn(apiService,'openExternalUrl').mockResolvedValue(true);
    const {container} = open();
    for (const link of container.querySelectorAll('a')) {
      fireEvent.click(link);
      expect(external).toHaveBeenLastCalledWith(link.href);
    }
  });
  it('compiles zoom-dependent halos with the real MapLibre expression validator', () => {
    const require = createRequire(import.meta.url);
    const spec = createRequire(require.resolve('maplibre-gl'))('@maplibre/maplibre-gl-style-spec');
    const base = ['interpolate', ['linear'], ['zoom'], 1, 'hsla(-9, 0%, 100%, 0.8)', 13,
      ['interpolate', ['linear'], ['get', 'rank'], 1, 'hsla(-9, 0%, 85%, 0.8)', 25, 'hsla(-9, 0%, 100%, 0.8)']];
    const expression = highlightedPaint(base, ['==', ['id'], 1], '#e879f9');
    const result = spec.createPropertyExpression(expression, spec.latest.paint_symbol['text-halo-color']);
    expect(result.result).toBe('success');
    const selected = result.value.evaluate({zoom: 8}, {id: 1, properties: {rank: 5}});
    const normal = result.value.evaluate({zoom: 8}, {id: 2, properties: {rank: 5}});
    expect(selected).not.toEqual(normal);
  });
  it('ignores unnamed, technical and line features; supports named lakes/places/huts',() => {
    expect(featureLocation({...feature(),properties:{name:'',type:'peak'}} as any)).toBeNull();
    expect(featureLocation({...feature(),properties:{name:'Tree',type:'tree'}} as any)).toBeNull();
    expect(featureLocation({...feature(),geometry:{type:'LineString',coordinates:[[1,2],[3,4]]}} as any)).toBeNull();
    for (const [sourceLayer,type] of [['water_label','lake'],['place_label','village'],['poi_label','alpine_hut'],['poi_label','mountain_pass'],['poi_label','station']])
      expect(featureLocation({...feature(),sourceLayer,properties:{name:'Named',type}} as any)?.name).toBe('Named');
  });
});
