import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MockMap, MockMarker, maplibreMock } from '../test/maplibreMock';
vi.mock('maplibre-gl', () => maplibreMock);
import { HeaderMapPreview } from './HeaderMapPreview';

const location = {name:'Origin',latitude:50,longitude:8,elevation:100};
describe('MapLibre header preview', () => {
  it.each([undefined, 1000, 1001, 4478])('sets the initial elevation zoom for %s without accumulating on rerender', elevation => {
    const { rerender } = render(<HeaderMapPreview location={{...location, elevation}} onOpen={() => {}} />);
    const map = MockMap.instances.at(-1)!;
    expect(map.options.zoom).toBe(elevation != null && elevation > 1000 ? 12 : 8);
    const calls = map.jumpTo.mock.calls.length;
    rerender(<HeaderMapPreview location={{...location, elevation}} onOpen={() => {}} />);
    expect(map.jumpTo.mock.calls.length).toBe(calls);
    expect(map.jumpTo.mock.calls.at(-1)?.[0].zoom).toBe(elevation != null && elevation > 1000 ? 12 : 8);
  });
  it('updates coordinates and callbacks without recreating the map; disposes resources', () => {
    const first = vi.fn(), latest = vi.fn();
    const {rerender,unmount} = render(<HeaderMapPreview location={location} onOpen={first}/>);
    const map = MockMap.instances.at(-1)!, marker = MockMarker.instances.at(-1)!;
    expect(map.options.interactive).toBe(false);
    expect(map.options.zoom).toBe(8);
    const count = MockMap.instances.length;
    rerender(<HeaderMapPreview location={{...location,latitude:46,longitude:7}} onOpen={latest}/>);
    expect(MockMap.instances).toHaveLength(count);
    expect(map.options.center).toEqual([7,46]);
    expect(marker.coordinates).toEqual([7,46]);
    act(() => map.fire('click',{originalEvent:new MouseEvent('click')}));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    unmount();
    expect(map.remove).toHaveBeenCalledOnce();
    expect(marker.remove).toHaveBeenCalledOnce();
  });
});
