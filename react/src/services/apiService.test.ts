import { describe, it, expect } from 'vitest';
import { mergeForecastSegments } from './apiService';
import type { WeatherModel, DataPoint } from '../types';

describe('mergeForecastSegments', () => {
  it('hands over to subsequent model and includes its variables when previous model run ends', () => {
    const chain: WeatherModel[] = [
      { name: 'GeoSphere AROME Austria', max_forecast_horizon_hours: 10 },
      { name: 'ICON-EU', max_forecast_horizon_hours: 20 },
    ];

    // GeoSphere only produces 6 hours (0..5), and no precipitation_probability
    const geoPts: DataPoint[] = [];
    const iconPts: DataPoint[] = [];

    const baseDate = new Date('2026-09-12T00:00:00Z');
    for (let i = 0; i < 20; i++) {
      const ts = new Date(baseDate.getTime() + i * 3600 * 1000).toISOString();
      if (i < 6) {
        geoPts.push({
          timestamp: ts,
          variable: 'temperature',
          value: 10 + i,
          unit: '°C',
          model: 'GeoSphere AROME Austria',
        });
        geoPts.push({
          timestamp: ts,
          variable: 'precipitation_probability',
          value: null as any,
          unit: '%',
          model: 'GeoSphere AROME Austria',
        });
      }

      iconPts.push({
        timestamp: ts,
        variable: 'temperature',
        value: 15 + i,
        unit: '°C',
        model: 'ICON-EU',
      });
      iconPts.push({
        timestamp: ts,
        variable: 'precipitation_probability',
        value: 20 + i,
        unit: '%',
        model: 'ICON-EU',
      });
    }

    const modelForecasts = {
      'GeoSphere AROME Austria': geoPts,
      'ICON-EU': iconPts,
    };

    const targetVariables = ['temperature', 'precipitation_probability'];
    const merged = mergeForecastSegments(chain, modelForecasts, targetVariables);

    // Hours 0..5: GeoSphere active, prob is null
    for (let i = 0; i < 6; i++) {
      const ts = new Date(baseDate.getTime() + i * 3600 * 1000).toISOString();
      const tempPt = merged.find((p) => p.timestamp === ts && p.variable === 'temperature');
      const probPt = merged.find((p) => p.timestamp === ts && p.variable === 'precipitation_probability');

      expect(tempPt?.model).toBe('GeoSphere AROME Austria');
      expect(tempPt?.value).toBe(10 + i);
      expect(probPt?.model).toBe('GeoSphere AROME Austria');
      expect(probPt?.value).toBeNull();
    }

    // Hours 6..10: GeoSphere run ended, handed over to ICON-EU
    for (let i = 6; i <= 10; i++) {
      const ts = new Date(baseDate.getTime() + i * 3600 * 1000).toISOString();
      const tempPt = merged.find((p) => p.timestamp === ts && p.variable === 'temperature');
      const probPt = merged.find((p) => p.timestamp === ts && p.variable === 'precipitation_probability');

      expect(tempPt?.model).toBe('ICON-EU');
      expect(tempPt?.value).toBe(15 + i);
      expect(probPt?.model).toBe('ICON-EU');
      expect(probPt?.value).toBe(20 + i);
    }
  });
});

describe('isCloudCompatibleModel', () => {
  it('requires supports_vertical_cloud_profile and at least 10 pressure levels', async () => {
    const { isCloudCompatibleModel } = await import('./apiService');

    // Model with 13 levels (e.g. ECMWF IFS 0.25°)
    expect(
      isCloudCompatibleModel({
        name: 'ECMWF IFS 0.25°',
        supports_vertical_cloud_profile: true,
        pressure_levels_hpa: [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50]
      } as any)
    ).toBe(true);

    // Model with 19 levels (e.g. ICON-D2)
    expect(
      isCloudCompatibleModel({
        name: 'ICON-D2',
        supports_vertical_cloud_profile: true,
        pressure_levels_hpa: [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30]
      } as any)
    ).toBe(true);

    // Disqualified: ItaliaMeteo ICON-2i has only 6 pressure levels
    expect(
      isCloudCompatibleModel({
        name: 'ItaliaMeteo ICON-2I',
        supports_vertical_cloud_profile: true,
        pressure_levels_hpa: [1000, 925, 850, 700, 500, 250]
      } as any)
    ).toBe(false);

    // Disqualified: ICON-CH1 has 0 pressure levels
    expect(
      isCloudCompatibleModel({
        name: 'MeteoSwiss ICON-CH1',
        supports_vertical_cloud_profile: false,
        pressure_levels_hpa: []
      } as any)
    ).toBe(false);

    // Disqualified: model with null/undefined levels
    expect(
      isCloudCompatibleModel({
        name: 'Unknown',
        supports_vertical_cloud_profile: true
      } as any)
    ).toBe(false);
  });
});

describe('mergeVerticalCloudSegments', () => {
  it('correctly stitches vertical cloud profiles and generates handover transitions', async () => {
    const { mergeVerticalCloudSegments } = await import('./apiService');

    const cloudChain: WeatherModel[] = [
      { name: 'ICON-D2', id: 'icon_d2', max_forecast_horizon_hours: 5 },
      { name: 'ECMWF IFS 0.25°', id: 'ecmwf_ifs025', max_forecast_horizon_hours: 10 }
    ];

    const timestamps = [
      '2026-09-12T00:00',
      '2026-09-12T01:00',
      '2026-09-12T02:00',
      '2026-09-12T03:00',
      '2026-09-12T04:00',
      '2026-09-12T05:00',
      '2026-09-12T06:00',
      '2026-09-12T07:00'
    ];

    const iconProfiles = timestamps.slice(0, 6).map((ts) => ({
      timestamp: ts,
      source_model_id: 'icon_d2',
      source_model_name: 'ICON-D2',
      levels: [{ pressure_hpa: 1000, altitude_m_asl: 100, cloud_cover_percent: 50 }]
    }));

    const ifsProfiles = timestamps.map((ts) => ({
      timestamp: ts,
      source_model_id: 'ecmwf_ifs025',
      source_model_name: 'ECMWF IFS 0.25°',
      levels: [{ pressure_hpa: 1000, altitude_m_asl: 100, cloud_cover_percent: 80 }]
    }));

    const modelForecasts = {
      'ICON-D2': { location: { name: 'Berlin', latitude: 52, longitude: 13 }, profiles: iconProfiles },
      'ECMWF IFS 0.25°': { location: { name: 'Berlin', latitude: 52, longitude: 13 }, profiles: ifsProfiles }
    };

    const result = mergeVerticalCloudSegments(
      cloudChain,
      modelForecasts,
      timestamps,
      '2026-09-12T00:00'
    );

    expect(result.verticalCloudForecast).toBeDefined();
    expect(result.verticalCloudForecast?.profiles.length).toBe(8);

    // A 5-hour horizon is the half-open interval [0h, 5h).
    for (let i = 0; i < 5; i++) {
      expect(result.verticalCloudForecast?.profiles[i].source_model_name).toBe('ICON-D2');
      expect(result.verticalCloudForecast?.profiles[i].levels[0].cloud_cover_percent).toBe(50);
    }

    // The exact +5h boundary and later profiles use ECMWF IFS 0.25°.
    for (let i = 5; i <= 7; i++) {
      expect(result.verticalCloudForecast?.profiles[i].source_model_name).toBe('ECMWF IFS 0.25°');
      expect(result.verticalCloudForecast?.profiles[i].levels[0].cloud_cover_percent).toBe(80);
    }

    // Transition occurs at the exact configured +5h boundary.
    expect(result.verticalCloudTransitions.length).toBe(1);
    expect(result.verticalCloudTransitions[0]).toEqual({
      timestamp: '2026-09-12T05:00:00.000Z',
      from_model: 'icon_d2',
      to_model: 'ecmwf_ifs025'
    });
  });

  it('returns undefined when cloudChain is empty', async () => {
    const { mergeVerticalCloudSegments } = await import('./apiService');

    const result = mergeVerticalCloudSegments([], {}, ['2026-09-12T00:00']);
    expect(result.verticalCloudForecast).toBeUndefined();
    expect(result.verticalCloudTransitions).toEqual([]);
  });
});

describe('timestamp-keyed model joins', () => {
  it('aligns differently sized model arrays by absolute timestamp', () => {
    const start = '2026-09-14T00:00:00.000Z';
    const hour = (offset: number) => new Date(Date.parse(start) + offset * 3600_000).toISOString();
    const chain: WeatherModel[] = [
      { name: 'Regional', max_forecast_horizon_hours: 2 },
      { name: 'Global', max_forecast_horizon_hours: 4 },
    ];
    const modelForecasts: Record<string, DataPoint[]> = {
      Regional: [0, 1].map((offset) => ({
        timestamp: hour(offset), variable: 'temperature', value: 10 + offset,
        unit: '°C', model: 'Regional',
      })),
      Global: [1, 2, 3].map((offset) => ({
        timestamp: hour(offset), variable: 'temperature', value: 20 + offset,
        unit: '°C', model: 'Global',
      })),
    };

    const merged = mergeForecastSegments(
      chain,
      modelForecasts,
      ['temperature'],
      start,
      start,
      hour(4),
    );

    expect(merged.map((point) => [point.timestamp, point.model, point.value])).toEqual([
      [hour(0), 'Regional', 10],
      [hour(1), 'Regional', 11],
      [hour(2), 'Global', 22],
      [hour(3), 'Global', 23],
    ]);
  });
});

describe('apiService.getForecast mock fallback', () => {
  it('generates mock forecast including weather_code without undefined property errors', async () => {
    const { apiService } = await import('./apiService');
    delete (window as any).pywebview;

    const forecast = await apiService.getForecast({
      name: 'Offenbach am Main',
      latitude: 50.0956,
      longitude: 8.7761,
      elevation: 98,
    });

    expect(forecast).toBeDefined();
    expect(forecast.combined_forecast.length).toBeGreaterThan(0);
    const weatherCodePts = forecast.combined_forecast.filter(
      (p) => p.variable === 'weather_code',
    );
    expect(weatherCodePts.length).toBeGreaterThan(0);
    expect(weatherCodePts[0].value).toBeDefined();
    expect(typeof weatherCodePts[0].value).toBe('number');
  });
});

