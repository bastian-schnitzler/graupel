// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Helpers of the component tests: the chart props
 * (`data`, `modelChain`, `timelineStart`, …) become a `MeteogramInput`,
 * so the taken-over tests read like the originals.
 */
import { fireEvent } from "@testing-library/react";
import type {
  DataPoint,
  DetailedCloudForecast,
  Location,
  MeteogramInput,
  SunPeriod,
  VerticalCloudTransition,
} from "@graupel/meteogram";
import { vi } from "vitest";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Model of the old `modelChain` prop. */
export interface OldModel {
  name: string;
  max_forecast_horizon_hours: number;
}

/** The data props of a chart component. */
export interface OldChartProps {
  data: DataPoint[];
  modelChain: OldModel[];
  location?: Location;
  verticalCloudForecast?: DetailedCloudForecast | null;
  verticalCloudTransitions?: VerticalCloudTransition[];
  modelForecasts?: Record<string, DataPoint[]>;
  sunPhases?: SunPeriod[];
  forecastStartTime?: string;
  timelineStart?: string;
  timelineEnd?: string;
  userTimezone?: string;
  generatedAt?: string;
}

/** Old props to the new input format. */
export function toInput(props: OldChartProps): MeteogramInput {
  const timeline: NonNullable<MeteogramInput["timeline"]> = {};
  if (props.timelineStart) timeline.start = props.timelineStart;
  if (props.timelineEnd) timeline.end = props.timelineEnd;
  if (props.forecastStartTime) timeline.now = props.forecastStartTime;
  const input: MeteogramInput = {
    chain: props.modelChain.map((model) => ({
      model: model.name,
      sliceEndHours: model.max_forecast_horizon_hours,
    })),
    series: props.data,
    timeline,
  };
  if (props.location) input.location = props.location;
  if (props.userTimezone) input.timezone = props.userTimezone;
  if (props.verticalCloudForecast) input.cloudProfile = props.verticalCloudForecast;
  if (props.verticalCloudTransitions) input.cloudTransitions = props.verticalCloudTransitions;
  if (props.modelForecasts) input.modelSeries = props.modelForecasts;
  if (props.sunPhases) input.sunPhases = props.sunPhases;
  if (props.generatedAt) input.generatedAt = props.generatedAt;
  return input;
}

/** Mock chain of the old redesign tests. */
export const mockModelChain: OldModel[] = [
  { name: "ICON-D2", max_forecast_horizon_hours: 48 },
  { name: "ICON-EU", max_forecast_horizon_hours: 120 },
  { name: "GFS", max_forecast_horizon_hours: 384 },
];

/** Hourly mock data of the old redesign tests, from 2026-09-11 00Z. */
export function generateMockData(hours: number): DataPoint[] {
  const points: DataPoint[] = [];
  const startTime = Date.parse("2026-09-11T00:00:00Z");
  for (let h = 0; h < hours; h++) {
    const timestamp = new Date(startTime + h * HOUR).toISOString();
    const model = h < 48 ? "ICON-D2" : h < 120 ? "ICON-EU" : "GFS";
    const add = (variable: string, value: number, unit: string) =>
      points.push({ timestamp, variable, value, unit, model });
    add("temperature", 12 + Math.sin(h / 4) * 5, "°C");
    add("wind_speed", 15 + Math.cos(h / 3) * 8, "km/h");
    add("wind_gusts", 28 + Math.cos(h / 3) * 10, "km/h");
    add("wind_direction", (h * 30) % 360, "°");
    add("cloud_cover", Math.min(100, Math.max(0, 50 + Math.sin(h / 2) * 40)), "%");
    add("precipitation", h % 6 === 0 ? 1.5 : 0, "mm");
    add("precipitation_probability", (h * 8) % 100, "%");
  }
  return points;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function domRect({ left, top, width, height }: Rect): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Gives `element` a measured box, as the old tests did with spyOn. */
export function mockRect(element: Element, rect: Rect) {
  return vi.spyOn(element, "getBoundingClientRect").mockReturnValue(domRect(rect));
}

/** The chart's SVG (the core mounts it inside the component's host). */
export function chartSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>("svg.meteogram-svg-integrated");
  if (!svg) throw new Error("no meteogram SVG");
  return svg;
}

/** The tooltip element of the core (hidden with display: none). */
export function tooltipElement(container: HTMLElement): HTMLElement {
  const tooltip = container.querySelector<HTMLElement>(".hover-unified-tooltip");
  if (!tooltip) throw new Error("no tooltip element");
  return tooltip;
}

export const tooltipShown = (container: HTMLElement) =>
  tooltipElement(container).style.display === "block";

/** Pointer move over the SVG (the core listens to pointer events). */
export function hoverAt(svg: Element, clientX: number, clientY = 100) {
  fireEvent.pointerMove(svg, { clientX, clientY });
}

export function leave(svg: Element) {
  fireEvent.pointerLeave(svg);
}

/** Visible range written on the SVG. */
export function visibleRangeOf(container: HTMLElement): [number, number] {
  const svg = chartSvg(container);
  return [
    Date.parse(svg.getAttribute("data-visible-start-time")!),
    Date.parse(svg.getAttribute("data-visible-end-time")!),
  ];
}
