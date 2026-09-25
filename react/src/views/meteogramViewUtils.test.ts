import { describe, it, expect, vi } from 'vitest';
import {
  calculateActiveTimelineEnd,
  calculateMeteogramScale,
  logTimelineDiagnostics,
  resolveActiveCombinedForecast,
  resolveActiveVerticalCloudData,
} from './meteogramViewUtils';
import type { WeatherModel, HarmonizedForecastResponse, Location } from '../types';

describe('meteogramViewUtils', () => {
  describe('calculateActiveTimelineEnd', () => {
    it('returns timelineEnd when model chain is empty or start time is missing', () => {
      expect(calculateActiveTimelineEnd(undefined, [], '2026-09-16T12:00:00Z')).toBe('2026-09-16T12:00:00Z');
      expect(calculateActiveTimelineEnd('2026-09-16T00:00:00Z', [], '2026-09-16T12:00:00Z')).toBe('2026-09-16T12:00:00Z');
    });

    it('calculates active boundary timestamp when chain is present', () => {
      const chain: WeatherModel[] = [{ name: 'ICON-D2', max_forecast_horizon_hours: 48 }];
      const result = calculateActiveTimelineEnd('2026-09-16T00:00:00Z', chain, '2026-09-19T00:00:00Z');
      expect(result).toBe('2026-09-18T00:00:00.000Z');
    });
  });

  describe('logTimelineDiagnostics', () => {
    it('warns in console for incomplete non-cape variables', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const diagnostics = {
        'icon-d2': {
          model: 'icon-d2',
          variables: {
            temperature: {
              variable: 'temperature',
              complete: false,
              expected_last_timestamp: '2026-09-18T00:00:00Z',
              expected_end_exclusive: '2026-09-18T01:00:00Z',
              last_valid_timestamp: '2026-09-17T20:00:00Z',
            },
            cape: {
              variable: 'cape',
              complete: false,
            },
          },
        },
      };

      logTimelineDiagnostics(diagnostics);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('icon-d2 / temperature: expected data through'),
      );
      warnSpy.mockRestore();
    });
  });

  describe('resolveActiveCombinedForecast', () => {
    it('falls back to combined_forecast if model_forecasts is missing', () => {
      const resp: Partial<HarmonizedForecastResponse> = {
        combined_forecast: [
          {
            timestamp: '2026-09-16T00:00:00Z',
            value: 20,
            unit: '°C',
            variable: 'temperature',
            model: 'ICON-D2',
          },
        ],
      };
      const result = resolveActiveCombinedForecast(resp as HarmonizedForecastResponse, []);
      expect(result).toEqual(resp.combined_forecast);
    });
  });

  describe('resolveActiveVerticalCloudData', () => {
    it('returns empty when cloud chain is empty or response missing', () => {
      const location: Location = { name: 'Berlin', latitude: 52.52, longitude: 13.405 };
      const res = resolveActiveVerticalCloudData(null, [], [], location);
      expect(res.verticalCloudForecast).toBeUndefined();
      expect(res.verticalCloudTransitions).toEqual([]);
    });
  });

  describe('calculateMeteogramScale', () => {
    it('returns scale 1 when available height exceeds or matches natural height', () => {
      expect(calculateMeteogramScale({ availableHeight: 600, naturalHeight: 450 })).toBe(1);
      expect(calculateMeteogramScale({ availableHeight: 450, naturalHeight: 450 })).toBe(1);
    });

    it('scales down proportionally when available height is less than natural height', () => {
      expect(calculateMeteogramScale({ availableHeight: 360, naturalHeight: 450 })).toBeCloseTo(0.8, 5);
      expect(calculateMeteogramScale({ availableHeight: 225, naturalHeight: 450 })).toBeCloseTo(0.5, 5);
    });

    it('clamps to minimum scale of 0.25 when available height is small', () => {
      expect(calculateMeteogramScale({ availableHeight: 50, naturalHeight: 450 })).toBe(0.25);
    });

    it('handles non-positive available height or natural height gracefully by defaulting to 1', () => {
      expect(calculateMeteogramScale({ availableHeight: 0, naturalHeight: 450 })).toBe(1);
      expect(calculateMeteogramScale({ availableHeight: 300, naturalHeight: 0 })).toBe(1);
    });
  });
});

