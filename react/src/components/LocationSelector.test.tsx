/// <reference types="node" />
import { MockMap, MockMarker, maplibreMock } from '../test/maplibreMock';
vi.mock('maplibre-gl', () => maplibreMock);
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocationSelector } from './LocationSelector';
import { apiService, sortLocationsByElevation } from '../services/apiService';
import type { Location } from '../types';
import { readFileSync } from 'node:fs';

const appCss = readFileSync('src/App.css', 'utf8');

describe('sortLocationsByElevation', () => {
  it('sorts high elevations (>= 1000m) descending and low elevations (< 1000m) ascending', () => {
    const locations: Location[] = [
      { name: '4034 m', latitude: 0, longitude: 0, elevation: 4034 },
      { name: '2331 m', latitude: 0, longitude: 0, elevation: 2331 },
      { name: '1300 m', latitude: 0, longitude: 0, elevation: 1300 },
      { name: '1000 m', latitude: 0, longitude: 0, elevation: 1000 },
      { name: '999 m', latitude: 0, longitude: 0, elevation: 999 },
      { name: '400 m', latitude: 0, longitude: 0, elevation: 400 },
      { name: '200 m', latitude: 0, longitude: 0, elevation: 200 }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.elevation)).toEqual([4034, 2331, 1300, 1000, 200, 400, 999]);
  });

  it('sorts all locations below 1000 m in ascending order', () => {
    const locations: Location[] = [
      { name: '999 m', latitude: 0, longitude: 0, elevation: 999 },
      { name: '650 m', latitude: 0, longitude: 0, elevation: 650 },
      { name: '400 m', latitude: 0, longitude: 0, elevation: 400 },
      { name: '200 m', latitude: 0, longitude: 0, elevation: 200 }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.elevation)).toEqual([200, 400, 650, 999]);
  });

  it('sorts all locations at or above 1000 m in descending order', () => {
    const locations: Location[] = [
      { name: '1000 m', latitude: 0, longitude: 0, elevation: 1000 },
      { name: '1300 m', latitude: 0, longitude: 0, elevation: 1300 },
      { name: '2331 m', latitude: 0, longitude: 0, elevation: 2331 },
      { name: '4034 m', latitude: 0, longitude: 0, elevation: 4034 }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.elevation)).toEqual([4034, 2331, 1300, 1000]);
  });

  it('treats exactly 1000 m as part of the high-elevation group', () => {
    const locations: Location[] = [
      { name: '999 m', latitude: 0, longitude: 0, elevation: 999 },
      { name: '1000 m', latitude: 0, longitude: 0, elevation: 1000 },
      { name: '1001 m', latitude: 0, longitude: 0, elevation: 1001 }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.elevation)).toEqual([1001, 1000, 999]);
  });

  it('sorts negative elevations in ascending order as part of < 1000 m group', () => {
    const locations: Location[] = [
      { name: '999 m', latitude: 0, longitude: 0, elevation: 999 },
      { name: '300 m', latitude: 0, longitude: 0, elevation: 300 },
      { name: '100 m', latitude: 0, longitude: 0, elevation: 100 },
      { name: '-20 m', latitude: 0, longitude: 0, elevation: -20 }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.elevation)).toEqual([-20, 100, 300, 999]);
  });

  it('handles zero elevation correctly in ascending low-elevation group', () => {
    const locations: Location[] = [
      { name: '500 m', latitude: 0, longitude: 0, elevation: 500 },
      { name: '0 m', latitude: 0, longitude: 0, elevation: 0 },
      { name: '-10 m', latitude: 0, longitude: 0, elevation: -10 }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.elevation)).toEqual([-10, 0, 500]);
  });

  it('preserves relative order for equal elevations and puts missing elevations last', () => {
    const locations: Location[] = [
      { name: 'A 500m', latitude: 1, longitude: 1, elevation: 500 },
      { name: 'B 500m', latitude: 2, longitude: 2, elevation: 500 },
      { name: 'High 2000m A', latitude: 3, longitude: 3, elevation: 2000 },
      { name: 'High 2000m B', latitude: 4, longitude: 4, elevation: 2000 },
      { name: 'Missing 1', latitude: 5, longitude: 5, elevation: null as any },
      { name: 'Missing 2', latitude: 6, longitude: 6, elevation: undefined }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.name)).toEqual([
      'High 2000m A',
      'High 2000m B',
      'A 500m',
      'B 500m',
      'Missing 1',
      'Missing 2'
    ]);
  });

  it('handles string elevations and NaN safely', () => {
    const locations: Location[] = [
      { name: 'Invalid NaN', latitude: 0, longitude: 0, elevation: NaN },
      { name: 'String 200', latitude: 0, longitude: 0, elevation: '200' as any },
      { name: 'String 1200', latitude: 0, longitude: 0, elevation: '1200' as any }
    ];

    const sorted = sortLocationsByElevation(locations);
    expect(sorted.map((l) => l.name)).toEqual(['String 1200', 'String 200', 'Invalid NaN']);
  });
});

describe('LocationSelector Component', () => {
  const initialLoc: Location = {
    name: 'Offenbach am Main',
    latitude: 50.0956,
    longitude: 8.7761,
    country: 'Germany',
    admin1: 'Hessen',
    elevation: 98
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders selected location with latitude, longitude, and elevation below search input', () => {
    render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Search location...') as HTMLInputElement;
    expect(searchInput.value).toBe('Offenbach am Main');
    expect(screen.getByText('50.0956° N · 8.7761° E')).toBeTruthy();
    expect(screen.getByText('98 m a.s.l.')).toBeTruthy();
  });

  it('aligns normal-weight elevation left and unchanged coordinates right', () => {
    const { container } = render(<LocationSelector location={{
      name: 'Lausanne', latitude: 46.5160, longitude: 6.6328, elevation: 453,
    }} onChange={vi.fn()} />);
    const row = container.querySelector('.coords-elevation-display')!;
    expect(row.firstElementChild?.className).toBe('elevation-text');
    expect(row.firstElementChild?.textContent).toBe('453 m a.s.l.');
    expect(row.lastElementChild?.className).toBe('coords-text');
    expect(row.lastElementChild?.textContent).toBe('46.5160° N · 6.6328° E');
    expect(appCss).toMatch(/\.coords-elevation-display\s*\{[^}]*justify-content: space-between/s);
    expect(appCss).toMatch(/\.elevation-text\s*\{[^}]*font-weight: 400/s);
    expect(appCss).toMatch(/\.coords-text\s*\{[^}]*font-weight: 400/s);
  });

  it('prevents attribution navigation and uses the same Python bridge on both maps', async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    // The bridge is injected by pywebview at runtime.
    window.pywebview = { api: { open_external_url: openExternal } } as unknown as Window['pywebview'];
    const onChange = vi.fn();
    try {
      const { container } = render(<LocationSelector location={initialLoc} onChange={onChange} />);
      const clickAttributions = (mapSelector: string) => {
        const links = container.querySelectorAll<HTMLAnchorElement>(
          mapSelector + ' a',
        );
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          // A nested target also resolves to the enclosing attribution anchor.
          const child = document.createElement('span');
          child.textContent = link.textContent;
          link.replaceChildren(child);
          const event = new MouseEvent('click', { bubbles: true, cancelable: true });
          child.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          expect(openExternal).toHaveBeenLastCalledWith(link.href);
        }
      };
      clickAttributions('.header-maplibre-map');
      expect(container.querySelector('.fullscreen-map-modal')).toBeNull();
      fireEvent.click(container.querySelector('.map-wrapper')!);
      clickAttributions('.fullscreen-maplibre-map');
      expect(container.querySelector('.fullscreen-map-modal')).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();
      await act(async () => {});
    } finally {
      delete window.pywebview;
    }
  });

  it('blocks unsafe attribution schemes and never falls back to a webview popup', async () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    const popup = vi.spyOn(window, 'open');
    window.pywebview = { api: { open_external_url: openExternal } } as unknown as Window['pywebview'];
    try {
      expect(await apiService.openExternalUrl('file:///tmp/test')).toBe(false);
      expect(await apiService.openExternalUrl('javascript:alert(1)')).toBe(false);
      expect(openExternal).not.toHaveBeenCalled();
      openExternal.mockRejectedValue(new Error('Bridge failed'));
      expect(await apiService.openExternalUrl('https://www.maptoolkit.org/')).toBe(false);
      expect(popup).not.toHaveBeenCalled();
    } finally {
      delete window.pywebview;
    }
  });

  it('the original MapLibre listener opens at the updated displayed location after rerender', () => {
    const zugspitze = {
      name: 'Zugspitze', latitude: 47.4211, longitude: 10.9853, elevation: 2962,
    };
    const lausanne = {
      name: 'Lausanne', latitude: 46.5160, longitude: 6.6328, elevation: 453,
    };
    const change = vi.fn();
    const { rerender } = render(<LocationSelector location={zugspitze} onChange={change} />);
    const preview = MockMap.instances.at(-1)!;
    const headerMarker = MockMarker.instances.at(-1)!;
    rerender(<LocationSelector location={lausanne} onChange={change} />);
    expect(screen.getByText('46.5160° N · 6.6328° E')).toBeTruthy();
    expect(headerMarker.coordinates).toEqual([lausanne.longitude, lausanne.latitude]);
    act(() => { preview.fire('click', { originalEvent: new MouseEvent('click') }); });
    expect(preview.jumpTo).toHaveBeenLastCalledWith({center:[lausanne.longitude, lausanne.latitude],zoom:8});
    expect(MockMap.instances.at(-1)!.options.center).toEqual([lausanne.longitude, lausanne.latitude]);
    expect(headerMarker.coordinates).toEqual([lausanne.longitude, lausanne.latitude]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByText('453 m a.s.l.')).toBeTruthy();
  });

  it('renders neutral fallback when elevation is missing', () => {
    const noElevationLoc: Location = {
      name: 'Unknown Place',
      latitude: 10.0,
      longitude: 20.0
    };

    render(<LocationSelector location={noElevationLoc} onChange={vi.fn()} />);

    expect(screen.getByText('Elevation unavailable')).toBeTruthy();
  });

  it('places the map first, location search below it, Refresh Forecast beside the search, and coordinates/elevation last', () => {
    const handleRefresh = vi.fn();
    const { container } = render(
      <LocationSelector
        location={initialLoc}
        onChange={vi.fn()}
        onRefreshForecast={handleRefresh}
      />
    );

    const mapBox = container.querySelector('.map-wrapper');
    const controlsRow = container.querySelector('.location-controls-row');
    const coordsDisplay = container.querySelector('.coords-elevation-display');

    expect(container.querySelector('.location-header')).toBeNull();
    expect(screen.queryByText('Selected location')).toBeNull();
    expect(screen.queryByText('Default location')).toBeNull();
    expect(mapBox).toBeTruthy();
    expect(controlsRow).toBeTruthy();
    expect(coordsDisplay).toBeTruthy();

    // Verify DOM layout order: Map -> controlsRow -> coordsDisplay
    expect(mapBox!.compareDocumentPosition(controlsRow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controlsRow!.compareDocumentPosition(coordsDisplay!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const searchInput = screen.getByPlaceholderText('Search location...');
    const refreshBtn = screen.getByRole('button', { name: /Refresh Forecast/i });

    expect(searchInput).toBeTruthy();
    expect(refreshBtn).toBeTruthy();

    fireEvent.click(refreshBtn);
    expect(handleRefresh).toHaveBeenCalledTimes(1);
  });

  it('displays elevation and region/country in autocomplete suggestions', async () => {
    const mockSuggestions: Location[] = [
      {
        name: 'Offenbach am Main',
        latitude: 50.0956,
        longitude: 8.7761,
        admin1: 'Hessen',
        country: 'Germany',
        elevation: 98
      },
      {
        name: 'Offenbach an der Queich',
        latitude: 49.196,
        longitude: 8.197,
        admin1: 'Rheinland-Pfalz',
        country: 'Germany',
        elevation: 131
      }
    ];

    vi.spyOn(apiService, 'searchLocations').mockResolvedValue(mockSuggestions);

    render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Search location...');
    fireEvent.change(searchInput, { target: { value: 'Offenbach' } });

    await waitFor(() => {
      expect(screen.getAllByText('Offenbach am Main').length).toBeGreaterThan(0);
      expect(screen.getByText('Offenbach an der Queich')).toBeTruthy();
    });

    expect(screen.getAllByText('98 m a.s.l.').length).toBeGreaterThan(0);
    expect(screen.getByText('131 m a.s.l.')).toBeTruthy();
    expect(screen.getByText(/Hessen, Germany/)).toBeTruthy();
    expect(screen.getByText(/Rheinland-Pfalz, Germany/)).toBeTruthy();
  });

  it('displays "Elevation unavailable" in suggestion if location has no elevation', async () => {
    vi.spyOn(apiService, 'searchLocations').mockResolvedValue([
      {
        name: 'Test City',
        latitude: 12.34,
        longitude: 56.78,
        country: 'Testland'
      }
    ]);

    render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Search location...');
    fireEvent.change(searchInput, { target: { value: 'Test' } });

    await waitFor(() => {
      expect(screen.getByText('Test City')).toBeTruthy();
    });

    const elevationElements = screen.getAllByText('Elevation unavailable');
    expect(elevationElements.length).toBeGreaterThan(0);
  });

  it('supports keyboard navigation (ArrowDown, ArrowUp, Enter, Escape) in autocomplete dropdown', async () => {
    const handleChange = vi.fn();
    const mockSuggestions: Location[] = [
      { name: 'City Alpha', latitude: 10, longitude: 20, elevation: 100 },
      { name: 'City Beta', latitude: 30, longitude: 40, elevation: 200 }
    ];

    vi.spyOn(apiService, 'searchLocations').mockResolvedValue(mockSuggestions);

    render(<LocationSelector location={initialLoc} onChange={handleChange} />);

    const searchInput = screen.getByPlaceholderText('Search location...');
    fireEvent.change(searchInput, { target: { value: 'City' } });

    await waitFor(() => {
      expect(screen.getByText('City Alpha')).toBeTruthy();
    });

    // ArrowDown -> highlight Alpha
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    // ArrowDown -> highlight Beta
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    // Enter -> select Beta
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(handleChange).toHaveBeenCalledWith(mockSuggestions[1]);

    // Escape closes dropdown
    fireEvent.change(searchInput, { target: { value: 'City' } });
    await waitFor(() => {
      expect(screen.getByText('City Alpha')).toBeTruthy();
    });
    fireEvent.keyDown(searchInput, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('displays loading indicator during active search', async () => {
    let resolveSearch: (value: Location[]) => void;
    const searchPromise = new Promise<Location[]>((resolve) => {
      resolveSearch = resolve;
    });

    vi.spyOn(apiService, 'searchLocations').mockReturnValue(searchPromise);

    render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Search location...');
    fireEvent.change(searchInput, { target: { value: 'Searching...' } });

    await waitFor(() => {
      expect(screen.getByText('Searching locations...')).toBeTruthy();
    });

    act(() => {
      resolveSearch!([]);
    });

    await waitFor(() => {
      expect(screen.getByText('No locations found')).toBeTruthy();
    });
  });

  it('handles search API failure gracefully with error state', async () => {
    vi.spyOn(apiService, 'searchLocations').mockRejectedValue(new Error('Network failure'));

    render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

    const searchInput = screen.getByPlaceholderText('Search location...');
    fireEvent.change(searchInput, { target: { value: 'Fail' } });

    await waitFor(() => {
      expect(screen.getByText('Failed to load location suggestions')).toBeTruthy();
    });
  });

  it('synchronizes autocomplete selection to Location state and map coordinates', async () => {
    const handleChange = vi.fn();
    const selected: Location = {
      name: 'Hamburg',
      latitude: 53.55,
      longitude: 9.99,
      country: 'Germany',
      elevation: 6
    };

    vi.spyOn(apiService, 'searchLocations').mockResolvedValue([selected]);

    render(<LocationSelector location={initialLoc} onChange={handleChange} />);

    const searchInput = screen.getByPlaceholderText('Search location...');
    fireEvent.change(searchInput, { target: { value: 'Hamburg' } });

    await waitFor(() => {
      expect(screen.getByText('Hamburg')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Hamburg'));

    expect(handleChange).toHaveBeenCalledWith(selected);
    expect((searchInput as HTMLInputElement).value).toBe('Hamburg');
  });

  it('fetches and displays elevation for coordinates if location elevation is missing', async () => {
    vi.spyOn(apiService, 'getElevationForCoords').mockResolvedValue(453);

    const locWithoutElevation: Location = {
      name: 'Lausanne',
      latitude: 46.516,
      longitude: 6.6328
    };

    render(<LocationSelector location={locWithoutElevation} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('453 m a.s.l.')).toBeTruthy();
    });
  });

  it('displays elevation below search field when location with elevation is passed or selected', async () => {
    const lausanneLoc: Location = {
      name: 'Lausanne',
      latitude: 46.516,
      longitude: 6.6328,
      country: 'Switzerland',
      admin1: 'Canton of Vaud',
      elevation: 453
    };

    const { rerender } = render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);
    expect(screen.getByText('98 m a.s.l.')).toBeTruthy();

    rerender(<LocationSelector location={lausanneLoc} onChange={vi.fn()} />);
    expect(screen.getByText('453 m a.s.l.')).toBeTruthy();
    expect(screen.queryByText('Elevation unavailable')).toBeNull();
  });

  describe('Full-Screen Map Location Picker Mode', () => {
    it('clicking embedded map preview opens full-screen picker modal with OK and Cancel buttons', () => {
      const { container } = render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

      expect(screen.queryByText('Cancel')).toBeNull();
      expect(screen.queryByText('OK')).toBeNull();

      const mapWrapper = container.querySelector('.map-wrapper')!;
      fireEvent.click(mapWrapper);

      expect(screen.getByText('Cancel')).toBeTruthy();
      expect(screen.getByText('OK')).toBeTruthy();
      expect(container.querySelector('.fullscreen-map-modal')).toBeTruthy();
    });

    it('feature double click updates the location input and closes fullscreen in Config view', async () => {
      const change = vi.fn(), navigate = vi.fn();
      const {container,rerender} = render(<LocationSelector location={initialLoc} onChange={change} currentView="config" onNavigateView={navigate}/>);
      fireEvent.click(container.querySelector('.map-wrapper')!);
      const map = MockMap.instances.at(-1)!;
      map.features = [{id:1,source:'mtk',sourceLayer:'poi_label',properties:{name:'Matterhorn',type:'peak',ele:4478},geometry:{type:'Point',coordinates:[7.6586,45.9763]}}];
      act(() => {map.fire('load');map.fire('dblclick',{point:{x:1,y:1},lngLat:{lat:40,lng:5},preventDefault:vi.fn()});});
      await waitFor(() => expect(change).toHaveBeenCalledWith({name:'Matterhorn',latitude:45.9763,longitude:7.6586,elevation:4478}));
      expect(container.querySelector('.fullscreen-map-modal')).toBeNull();
      expect(navigate).toHaveBeenCalledWith('config');
      rerender(<LocationSelector location={change.mock.calls[0][0]} onChange={change} currentView="config"/>);
      expect((screen.getByRole('textbox',{name:'Search location'}) as HTMLInputElement).value).toBe('Matterhorn');
      expect(screen.getByText('4478 m a.s.l.')).toBeTruthy();
    });

    it('Cancel button closes full-screen map without changing location', () => {
      const handleChange = vi.fn();
      const { container } = render(<LocationSelector location={initialLoc} onChange={handleChange} />);

      const mapWrapper = container.querySelector('.map-wrapper')!;
      fireEvent.click(mapWrapper);

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);

      expect(container.querySelector('.fullscreen-map-modal')).toBeNull();
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('OK preserves the opening location when no new point was selected', async () => {
      const handleChange = vi.fn();
      vi.spyOn(apiService, 'getElevationForCoords').mockResolvedValue(450);

      const { container } = render(<LocationSelector location={initialLoc} onChange={handleChange} />);

      const mapWrapper = container.querySelector('.map-wrapper')!;
      fireEvent.click(mapWrapper);

      const fullscreenMap = container.querySelector('.fullscreen-maplibre-map')!;
      expect(fullscreenMap).toBeTruthy();

      const okBtn = screen.getByRole('button', { name: 'OK' });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith(initialLoc);
      });

      expect(container.querySelector('.fullscreen-map-modal')).toBeNull();
    });

    it('repeated OK/Cancel cycles do not leak temporary state', async () => {
      const handleChange = vi.fn();
      vi.spyOn(apiService, 'getElevationForCoords').mockResolvedValue(120);

      const { container } = render(<LocationSelector location={initialLoc} onChange={handleChange} />);

      // Cycle 1: Open and Cancel
      fireEvent.click(container.querySelector('.map-wrapper')!);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(handleChange).not.toHaveBeenCalled();

      // Cycle 2: Open and OK
      fireEvent.click(container.querySelector('.map-wrapper')!);
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));

      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledTimes(1);
        expect(handleChange).toHaveBeenCalledWith(
          expect.objectContaining({
            name: initialLoc.name,
            latitude: initialLoc.latitude,
            longitude: initialLoc.longitude
          })
        );
      });
    });

    it('positions zoom controls in upper-right, logo in lower-left and copyright in lower-right, and Action buttons in lower-right in full-screen map', () => {

      const { container } = render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

      // Open fullscreen map
      fireEvent.click(container.querySelector('.map-wrapper')!);

      expect(MockMap.instances.at(-1)!.controls.map(c => c.position)).toEqual(['top-right', 'bottom-left']);

      const actionsContainer = container.querySelector('.fullscreen-map-actions')!;
      expect(actionsContainer).toBeTruthy();

      const buttons = actionsContainer.querySelectorAll('button');
      expect(buttons.length).toBe(2);
      expect(buttons[0].textContent?.trim()).toBe('Cancel');
      expect(buttons[0].classList.contains('fullscreen-map-btn-cancel')).toBe(true);
      expect(buttons[1].textContent?.trim()).toBe('OK');
      expect(buttons[1].classList.contains('fullscreen-map-btn-ok')).toBe(true);
    });

    it('uses the same Hiking style, complete copyright and 24px logo on both maps', () => {
      const {container} = render(<LocationSelector location={initialLoc} onChange={vi.fn()}/>);
      const header = MockMap.instances.at(-1)!;
      expect(header.options.interactive).toBe(false);
      expect(header.options.attributionControl.compact).toBe(false);
      fireEvent.click(container.querySelector('.map-wrapper')!);
      const fullscreen = MockMap.instances.at(-1)!;
      expect(header.styleUrl).toBe('https://styles.maptoolkit.org/hiking.json');
      expect(fullscreen.styleUrl).toBe(header.styleUrl);
      expect(header.getStyle().layers[0].layout['text-size']).toBe(18);
      expect(fullscreen.getStyle().layers[0].layout['text-size']).toBe(18);
      for (const selector of ['.header-maplibre-map','.fullscreen-maplibre-map']) {
        const mapContainer = container.querySelector(selector)!;
        expect(mapContainer.querySelector<HTMLImageElement>('img[alt="Maptoolkit"]')!.height).toBe(24);
        const copyright = mapContainer.querySelector('.maplibregl-ctrl-attrib')!;
        expect(copyright.textContent).toBe('© Maptoolkit © Openstreetmap');
        expect(Array.from(copyright.querySelectorAll('a')).map(a => a.href)).toEqual([
          'https://www.maptoolkit.com/copyright/', 'https://www.openstreetmap.org/copyright',
        ]);
      }
      expect(appCss).toMatch(/\.header-maplibre-map \.maptoolkit-logo-control\s*\{[^}]*left: 4px !important;[^}]*bottom: 4px !important;/s);
      expect(appCss).toMatch(/\.header-maplibre-map \.maplibregl-ctrl-attrib,\s*\.fullscreen-map-picker \.maplibregl-ctrl-attrib\s*\{[^}]*color:\s*rgba\(0,\s*0,\s*0,\s*0\.75\);/s);
      expect(appCss).toMatch(/\.header-maplibre-map \.maplibregl-ctrl-attrib a:hover[^}]*color:\s*inherit;[^}]*text-decoration:\s*underline;/s);
      expect(appCss).toMatch(/\.fullscreen-map-picker \.maplibregl-ctrl-attrib a:hover[^}]*color:\s*inherit;[^}]*text-decoration:\s*underline;/s);
    });

    it('pressing ESC in full-screen map modal acts like Cancel and discards temporary location changes', () => {
      const handleChange = vi.fn();
      const onNavigateView = vi.fn();
      const { container } = render(
        <LocationSelector
          location={initialLoc}
          onChange={handleChange}
          currentView="config"
          onNavigateView={onNavigateView}
        />
      );

      // Open fullscreen map
      fireEvent.click(container.querySelector('.map-wrapper')!);
      expect(container.querySelector('.fullscreen-map-modal')).toBeTruthy();

      // Press ESC
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(container.querySelector('.fullscreen-map-modal')).toBeNull();
      expect(handleChange).not.toHaveBeenCalled();
      expect(onNavigateView).toHaveBeenCalledWith('config');
    });

    it('double-clicking in full-screen map selects exact double-click coordinates, disables doubleClickZoom, and accepts location immediately', async () => {
      const handleChange = vi.fn();
      const onNavigateView = vi.fn();
      vi.spyOn(apiService, 'getElevationForCoords').mockResolvedValue(1800);


      const { container } = render(
        <LocationSelector
          location={initialLoc}
          onChange={handleChange}
          currentView="meteogram"
          onNavigateView={onNavigateView}
        />
      );

      // Open fullscreen map
      fireEvent.click(container.querySelector('.map-wrapper')!);
      expect(container.querySelector('.fullscreen-map-modal')).toBeTruthy();

      const fullscreenMapInstance = MockMap.instances.at(-1)!;
      expect(fullscreenMapInstance.options.doubleClickZoom).toBe(false);
      act(() => fullscreenMapInstance.fire('dblclick', {
        lngLat: {lat:46.5,lng:10.5}, point:{x:1,y:1}, preventDefault:vi.fn()
      }));
      await waitFor(() => {
        expect(handleChange).toHaveBeenCalledWith({
          name: 'Custom location',
          latitude: 46.5,
          longitude: 10.5,
          elevation: 1800
        });
      });

      expect(container.querySelector('.fullscreen-map-modal')).toBeNull();
      expect(onNavigateView).toHaveBeenCalledWith('meteogram');
    });
  });

  describe('Location History and Suggestions', () => {
    it('focusing empty input queries top locations and displays them', async () => {
      const topLocations: Location[] = [
        { name: 'Munich', latitude: 48.1351, longitude: 11.582, elevation: 519 },
        { name: 'Berlin', latitude: 52.52, longitude: 13.405, elevation: 34 },
      ];
      const getTopSpy = vi.spyOn(apiService, 'getMostUsedLocations').mockResolvedValue(topLocations);

      render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

      const searchInput = screen.getByPlaceholderText('Search location...');
      // Clear input so query is empty
      fireEvent.change(searchInput, { target: { value: '' } });
      fireEvent.focus(searchInput);

      await waitFor(() => {
        expect(getTopSpy).toHaveBeenCalledWith(10);
        expect(screen.getByText('Munich')).toBeTruthy();
        expect(screen.getByText('Berlin')).toBeTruthy();
      });
    });

    it('clicking an autocomplete suggestion records location selection', async () => {
      const recordSpy = vi.spyOn(apiService, 'recordLocationSelection').mockResolvedValue(true as any);
      const selected: Location = {
        name: 'Innsbruck',
        latitude: 47.2692,
        longitude: 11.4041,
        elevation: 574,
      };
      vi.spyOn(apiService, 'searchLocations').mockResolvedValue([selected]);

      render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

      const searchInput = screen.getByPlaceholderText('Search location...');
      fireEvent.change(searchInput, { target: { value: 'Innsbruck' } });

      await waitFor(() => {
        expect(screen.getByText('Innsbruck')).toBeTruthy();
      });

      fireEvent.click(screen.getByText('Innsbruck'));

      expect(recordSpy).toHaveBeenCalledWith(selected);
    });

    it('clearing input with clear button re-queries top locations', async () => {
      const topLocations: Location[] = [
        { name: 'Vienna', latitude: 48.2082, longitude: 16.3738, elevation: 190 },
      ];
      const getTopSpy = vi.spyOn(apiService, 'getMostUsedLocations').mockResolvedValue(topLocations);

      const { container } = render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

      const clearBtn = container.querySelector('.clear-btn')!;
      expect(clearBtn).toBeTruthy();
      fireEvent.click(clearBtn);

      await waitFor(() => {
        expect(getTopSpy).toHaveBeenCalledWith(10);
        expect(screen.getByText('Vienna')).toBeTruthy();
      });
    });

    it('accepting location from fullscreen map records location selection', async () => {
      const recordSpy = vi.spyOn(apiService, 'recordLocationSelection').mockResolvedValue(true as any);
      vi.spyOn(apiService, 'getElevationForCoords').mockResolvedValue(1200);

      const { container } = render(<LocationSelector location={initialLoc} onChange={vi.fn()} />);

      // Open fullscreen map
      fireEvent.click(container.querySelector('.map-wrapper')!);
      expect(container.querySelector('.fullscreen-map-modal')).toBeTruthy();

      const okBtn = screen.getByRole('button', { name: 'OK' });
      fireEvent.click(okBtn);

      await waitFor(() => {
        expect(recordSpy).toHaveBeenCalledWith(initialLoc);
      });
    });
  });
});
