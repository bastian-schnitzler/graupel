import { describe, it, expect } from 'vitest';
import { mergeForecastSegments } from './apiService';
import { capChainToAvailability } from '../views/meteogramViewUtils';
import type { WeatherModel, DataPoint } from '../types';

describe('mergeForecastSegments', () => {
  it('never hands over inside a slice; the run-end cap moves the boundary instead', () => {
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

    // Hours 6..9: GeoSphere's run ended; without a cap its slice stays empty.
    for (let i = 6; i < 10; i++) {
      const ts = new Date(baseDate.getTime() + i * 3600 * 1000).toISOString();
      const tempPt = merged.find((p) => p.timestamp === ts && p.variable === 'temperature');
      expect(tempPt?.model).toBe('GeoSphere AROME Austria');
      expect(tempPt?.value).toBeNull();
    }

    // Meteogram View caps GeoSphere to the 6 delivered hours: ICON-EU starts at 6h.
    const capped = capChainToAvailability(chain, {
      'GeoSphere AROME Austria': {
        model: 'GeoSphere AROME Austria',
        chain: 'main',
        available_hours: 6,
      },
    });
    expect(capped.map((m) => m.max_forecast_horizon_hours)).toEqual([6, 20]);
    const cappedMerged = mergeForecastSegments(capped, modelForecasts, targetVariables);
    for (let i = 6; i <= 10; i++) {
      const ts = new Date(baseDate.getTime() + i * 3600 * 1000).toISOString();
      const tempPt = cappedMerged.find((p) => p.timestamp === ts && p.variable === 'temperature');
      const probPt = cappedMerged.find((p) => p.timestamp === ts && p.variable === 'precipitation_probability');

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


describe('mergeForecastSegments handover direction', () => {
  it('never fills a later slice with an earlier model beyond its boundary', () => {
    const start = Date.parse('2026-09-11T00:00:00Z');
    const ts = (h: number) => new Date(start + h * 3600_000).toISOString();
    const series = (model: string, hours: number[], offset: number) =>
      hours.map((h) => ({
        timestamp: ts(h),
        variable: 'temperature',
        value: offset + h,
        unit: '°C',
        model,
      }));
    // ICON-D2 holds data up to 6h (fetched for dragging) but is shown until 2h.
    const merged = mergeForecastSegments(
      [
        { name: 'ICON-D2', max_forecast_horizon_hours: 2 },
        { name: 'ICON-EU', max_forecast_horizon_hours: 6 },
      ],
      {
        'ICON-D2': series('ICON-D2', [0, 1, 2, 3, 4, 5], 0),
        'ICON-EU': series('ICON-EU', [0, 1, 2, 3, 5], 100),
      },
      ['temperature'],
      ts(0),
      ts(0),
      ts(6),
    );
    const at = (h: number) => merged.find((p) => p.timestamp === ts(h))!;
    expect(at(1).model).toBe('ICON-D2');
    expect(at(3).model).toBe('ICON-EU');
    // ICON-EU misses hour 4: the gap stays empty instead of using ICON-D2.
    expect(at(4).value).toBeNull();
    expect(at(4).model).toBe('ICON-EU');
  });
});

describe('mergeVerticalCloudSegments run-end cap', () => {
  it('leaves null run-end hours empty and starts the next model at the capped boundary', async () => {
    const { mergeVerticalCloudSegments } = await import('./apiService');
    const start = Date.parse('2026-09-11T00:00:00Z');
    const ts = (h: number) => new Date(start + h * 3600_000).toISOString();
    const profiles = (model: string, hours: number[], value: number | null) => ({
      location: { name: 'T', latitude: 0, longitude: 0 },
      profiles: hours.map((h) => ({
        timestamp: ts(h),
        source_model_id: model,
        source_model_name: model,
        levels: [{ pressure_hpa: 850, altitude_m_asl: 1500, cloud_cover_percent: value }],
      })),
    });
    const iconEu = profiles('icon_eu', [0, 1, 2], 40);
    // Null rows after the run end, as returned by Open-Meteo.
    iconEu.profiles.push(...profiles('icon_eu', [3, 4], null).profiles);
    const chain = [
      { name: 'ICON-EU', id: 'icon_eu', max_forecast_horizon_hours: 5 },
      { name: 'ECMWF', id: 'ecmwf_ifs025', max_forecast_horizon_hours: 8 },
    ];
    const forecasts = {
      'ICON-EU': iconEu,
      ECMWF: profiles('ecmwf_ifs025', [0, 1, 2, 3, 4, 5, 6, 7], 60),
    };
    const uncapped = mergeVerticalCloudSegments(
      chain,
      forecasts,
      [0, 1, 2, 3, 4, 5, 6, 7].map(ts),
      ts(0),
    );
    // No handover inside ICON-EU's slice: hours 3 and 4 have no profile.
    expect(
      uncapped.verticalCloudForecast!.profiles.map((p) => p.timestamp),
    ).toEqual([0, 1, 2, 5, 6, 7].map(ts));

    const result = mergeVerticalCloudSegments(
      capChainToAvailability(chain, {
        'ICON-EU': { model: 'ICON-EU', chain: 'cloud', available_hours: 3 },
      }),
      forecasts,
      [0, 1, 2, 3, 4, 5, 6, 7].map(ts),
      ts(0),
    );
    const sources = result.verticalCloudForecast!.profiles.map((p) => p.source_model_name);
    expect(sources).toEqual([
      'ICON-EU', 'ICON-EU', 'ICON-EU', 'ECMWF', 'ECMWF', 'ECMWF', 'ECMWF', 'ECMWF',
    ]);
    expect(result.verticalCloudTransitions).toEqual([
      { timestamp: new Date(start + 3 * 3600_000).toISOString(), from_model: 'icon_eu', to_model: 'ecmwf_ifs025' },
    ]);
  });
});
