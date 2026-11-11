// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
import { describe, it, expect } from 'vitest';
import {
  calculateMeteogramMaximumRange,
  groupTimestampsByDay,
  filterVisibleDayGroups,
  calculateZeroSpanModelNames,
  calculateModelSegments,
  calculateCloudTransitionCoordinates,
} from "../src";
import { createTimelineScale } from "../src";
import type { WeatherModel } from "../src";

describe('meteogramTimelineUtils', () => {
  it('calculateMeteogramMaximumRange returns null for missing inputs', () => {
    expect(
      calculateMeteogramMaximumRange({
        resolvedTimelineStart: undefined,
        resolvedTimelineEnd: 1000,
        effectiveNow: 500,
        resolvedTimezone: 'UTC',
      }),
    ).toBeNull();
  });

  it('groupTimestampsByDay groups indices into day buckets', () => {
    const ts1 = Date.parse('2026-09-16T10:00:00Z');
    const ts2 = Date.parse('2026-09-16T14:00:00Z');
    const ts3 = Date.parse('2026-09-17T02:00:00Z');

    const groups = groupTimestampsByDay([ts1, ts2, ts3], 'UTC');
    expect(groups.length).toBe(2);
    expect(groups[0].dayKey).toBe('2026-09-16');
    expect(groups[0].indices).toEqual([0, 1]);
    expect(groups[1].dayKey).toBe('2026-09-17');
    expect(groups[1].indices).toEqual([2]);
  });

  it('calculateZeroSpanModelNames identifies models with 0h horizon difference', () => {
    const chain: WeatherModel[] = [
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { name: 'ICON-EU', max_forecast_horizon_hours: 48 },
      { name: 'GFS', max_forecast_horizon_hours: 120 },
    ];
    const zeroSpan = calculateZeroSpanModelNames(chain);
    expect(zeroSpan.has('icon-eu')).toBe(true);
    expect(zeroSpan.has('icon-d2')).toBe(false);
  });

  it('calculateModelSegments computes pixel ranges for active models', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const endMs = startMs + 120 * 3600 * 1000;
    const timeline = createTimelineScale(startMs, endMs, 0, 1000);
    const chain: WeatherModel[] = [
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      { name: 'GFS', max_forecast_horizon_hours: 120 },
    ];

    const segments = calculateModelSegments(chain, '2026-09-16T00:00:00Z', timeline);
    expect(segments.length).toBe(2);
    expect(segments[0].modelName).toBe('ICON-D2');
    expect(segments[1].modelName).toBe('GFS');
    expect(segments[0].startX).toBe(0);
    expect(segments[0].endX).toBe(segments[1].startX);
  });

  it('calculateModelSegments extends the last segment to the right edge (REQ-466)', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const timeline = createTimelineScale(startMs, startMs + 120 * 3600 * 1000, 0, 1000);
    const chain: WeatherModel[] = [
      { name: 'ICON-D2', max_forecast_horizon_hours: 48 },
      // The last model's series ends 18 h before the edge of the timeline.
      { name: 'GFS', max_forecast_horizon_hours: 102 },
    ];

    const segments = calculateModelSegments(chain, '2026-09-16T00:00:00Z', timeline);
    expect(segments.map((s) => [s.modelName, s.startX, s.endX])).toEqual([
      ['ICON-D2', 0, 400],
      ['GFS', 400, 1000],
    ]);
  });

  it('calculateModelSegments extends only the last split run piece', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const timeline = createTimelineScale(startMs, startMs + 100 * 3600 * 1000, 0, 1000);
    const chain: WeatherModel[] = [{ name: 'ICON-EU', max_forecast_horizon_hours: 80 }];
    const runs = {
      'ICON-EU': [
        { run_init_time: '2026-09-15T18:00:00Z', valid_from: null, valid_until: '2026-09-16T20:00:00Z' },
        { run_init_time: '2026-09-16T00:00:00Z', valid_from: '2026-09-16T20:00:00Z', valid_until: null },
      ],
    };

    const segments = calculateModelSegments(chain, '2026-09-16T00:00:00Z', timeline, runs);
    expect(segments.map((s) => [s.startX, s.endX])).toEqual([
      [0, 200],
      [200, 1000],
    ]);
  });

  it('calculateModelSegments names the run of each split piece separately (REQ-515)', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const timeline = createTimelineScale(startMs, startMs + 100 * 3600 * 1000, 0, 1000);
    const chain: WeatherModel[] = [
      { name: 'ICON-EU', max_forecast_horizon_hours: 80 },
      { name: 'GFS', max_forecast_horizon_hours: 100 },
    ];
    const runs = {
      'ICON-EU': [
        { run_init_time: '2026-09-15T18:00:00Z', valid_from: null, valid_until: '2026-09-16T20:00:00Z' },
        { run_init_time: '2026-09-16T00:00:00Z', valid_from: '2026-09-16T20:00:00Z', valid_until: null },
      ],
      GFS: [{ run_init_time: '2026-09-16T00:00:00Z', valid_from: null, valid_until: null }],
    };

    const segments = calculateModelSegments(chain, '2026-09-16T00:00:00Z', timeline, runs);
    // Both runs on days of their own: the date alone, month first in the default locale en-US (REQ-697).
    expect(segments.map((s) => [s.label, s.runLabel])).toEqual([
      ['ICON-EU (09/15)', '09/15'],
      ['ICON-EU (09/16)', '09/16'],
      ['GFS', undefined],
    ]);
  });

  it('calculateModelSegments keeps segments that already reach the edge', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const timeline = createTimelineScale(startMs, startMs + 48 * 3600 * 1000, 0, 1000);
    const chain: WeatherModel[] = [
      { name: 'ICON-D2', max_forecast_horizon_hours: 24 },
      { name: 'GFS', max_forecast_horizon_hours: 120 },
    ];

    const segments = calculateModelSegments(chain, '2026-09-16T00:00:00Z', timeline);
    expect(segments.map((s) => [s.startX, s.endX])).toEqual([
      [0, 500],
      [500, 1000],
    ]);
  });

  it('calculateModelSegments adds the catalogue nickname as short label', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const timeline = createTimelineScale(startMs, startMs + 120 * 3600 * 1000, 0, 1000);
    const chain: WeatherModel[] = [
      { name: 'GeoSphere AROME Austria', max_forecast_horizon_hours: 48 },
      { name: 'ICON-EU', max_forecast_horizon_hours: 120 },
    ];
    const catalogue = {
      geosphere_arome_austria: {
        id: 'geosphere_arome_austria',
        name: 'GeoSphere AROME Austria',
        short_name: 'AROME AT',
        max_forecast_horizon_hours: 60,
      },
    };

    const segments = calculateModelSegments(
      chain,
      '2026-09-16T00:00:00Z',
      timeline,
      undefined,
      catalogue,
    );
    expect(segments[0].shortLabel).toBe('AROME AT');
    expect(segments[1].shortLabel).toBeNull();
  });

  it('filterVisibleDayGroups filters out day groups outside timeline', () => {
    const dayGroups = [
      { dayKey: '2026-09-15', dateLabel: '15.09', weekdayLabel: 'Tue', indices: [0] },
      { dayKey: '2026-09-16', dateLabel: '16.09', weekdayLabel: 'Wed', indices: [1] },
    ];
    const timestamps = [Date.parse('2026-09-15T00:00:00Z'), Date.parse('2026-09-16T00:00:00Z')];
    const timeline = createTimelineScale(
      Date.parse('2026-09-16T00:00:00Z'),
      Date.parse('2026-09-17T00:00:00Z'),
      0,
      100,
    );

    const visible = filterVisibleDayGroups(dayGroups, timestamps, timeline);
    expect(visible.length).toBe(1);
    expect(visible[0].dayKey).toBe('2026-09-16');
  });

  it('calculateCloudTransitionCoordinates maps transitions to timeline coordinates', () => {
    const startMs = Date.parse('2026-09-16T00:00:00Z');
    const endMs = Date.parse('2026-09-17T00:00:00Z');
    const timeline = createTimelineScale(startMs, endMs, 0, 100);
    const transitions = [
      {
        timestamp: '2026-09-16T12:00:00Z',
        from_model: 'icon-d2',
        from_model_id: 'icon-d2',
        from_model_name: 'ICON-D2',
        to_model: 'gfs',
        to_model_id: 'gfs',
        to_model_name: 'GFS',
        horizon_hours: 12,
      },
    ];

    const res = calculateCloudTransitionCoordinates(transitions, timeline);
    expect(res.length).toBe(1);
    expect(res[0].x).toBe(50);
  });
});

