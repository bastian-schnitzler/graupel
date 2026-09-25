import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeteogramChart } from './MeteogramChart';
import { mergeForecastSegments } from '../services/apiService';
import { aggregateThunderstorms, buildIconSlots } from '../utils/thunderstormIcons';
import type { DataPoint } from '../types';
const start = '2026-01-01T00:00:00Z';
const origin = Date.parse(start);
const hour = 3600000;
const chain = [{ name: 'A', max_forecast_horizon_hours: 10 }, { name: 'B', max_forecast_horizon_hours: 24 }];
const point = (h: number, value: number | null, model = 'A', variable = 'weather_code'): DataPoint => ({ timestamp: new Date(origin + h*hour).toISOString(), variable, value, model, unit: '' });
const data = Array.from({length:48}, (_,h) => [point(h,95),point(h,10,'A','temperature'),point(h,90,'A','wind_direction')]).flat();
describe('thunderstorm chart integration', () => {
  it('uses both active models across a slot and excludes inactive-model codes and fallback', () => {
    const raw = { A: Array.from({length:24}, (_,h) => [point(h,h===9?95:h>=10?99:3),point(h,10,'A','temperature')]).flat(),
      B: Array.from({length:24}, (_,h) => [point(h,h===10?96:h<10?99:null,'B'),point(h,10,'B','temperature')]).flat() };
    const merged = mergeForecastSegments(chain, raw, ['weather_code','temperature'], start);
    const slots = buildIconSlots([{id:'day',start:origin,end:origin+24*hour}],origin,origin+24*hour,54/(24*hour),18);
    expect(aggregateThunderstorms(slots,merged).map(icon=>icon.code)).toEqual([96]);
    expect(merged.find(p=>p.variable==='weather_code' && p.timestamp===point(11,0).timestamp)?.value).toBe(null);
  });
  it('shares wind centers and renders above cloud/precipitation without changing height', () => {
    const {container,rerender} = render(<MeteogramChart data={data} modelChain={chain} forecastStartTime={start} />);
    const svg = container.querySelector('svg')!;
    const height = svg.getAttribute('viewBox');
    const centers = Array.from(container.querySelectorAll('[data-testid="wind-arrow-group"]')).map(el=>el.getAttribute('data-center-x'));
    for (const icon of container.querySelectorAll('[data-testid="thunderstorm-icon"]')) expect(centers).toContain(icon.getAttribute('data-center-x'));
    const layer = screen.getByTestId('thunderstorm-layer');
    expect(screen.getByTestId('precipitation-probability-layer').compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<MeteogramChart data={data.filter(p=>p.variable!=='weather_code')} modelChain={chain} forecastStartTime={start} />);
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe(height);
    expect(container.querySelectorAll('[data-testid="thunderstorm-icon"]').length).toBe(0);
  });
  it('keeps identical slots in equally sized normal/fullscreen views and responds to wheel zoom', () => {
    const {container} = render(<MeteogramChart data={data} modelChain={chain} forecastStartTime={start} />);
    const signature = (mode: string) => Array.from(document.querySelectorAll(`[data-testid="thunderstorm-icon"][data-render-mode="${mode}"]`)).map(el=>[el.getAttribute('data-interval-start'),el.getAttribute('data-interval-end'),el.getAttribute('data-weather-code')]);
    const before = signature('embedded');
    fireEvent.doubleClick(container.querySelector('svg')!);
    expect(signature('fullscreen')).toEqual(signature('embedded'));
    act(()=>fireEvent.wheel(document.querySelector('.fullscreen-meteogram-overlay svg') || container.querySelector('svg')!, {deltaY:-100}));
    expect(signature('embedded')).not.toEqual(before);
    expect(signature('fullscreen')).toEqual(signature('embedded'));
  });
  it('does not warn for absent weather codes', () => {
    const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
    render(<MeteogramChart data={data.filter(p=>p.variable!=='weather_code')} modelChain={chain} />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
