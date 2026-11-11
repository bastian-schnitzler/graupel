// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * A sunrise time that would stand over the left axis' maximum moves right of its line (REQ-734).
 */
import { describe, expect, it } from "vitest";
import { sunTimeLabelWidth, type SunTimeLabel } from "../src/core/sunTimes";
import { moveSunriseOffAxisLabel, sunTimeLabelSpan } from "../src/render/chartArea";

const sunrise = (x: number, lineX = x, dayEndX = 200): SunTimeLabel => ({
  kind: "sunrise",
  dayKey: "2026-11-10",
  x,
  y: 8,
  text: "07:35",
  lineX,
  dayEndX,
});
const WIDTH = sunTimeLabelWidth("07:35");

describe("sunrise time next to its line (REQ-734)", () => {
  it("stays centred without an axis label or without overlap", () => {
    const label = sunrise(100);
    expect(moveSunriseOffAxisLabel([label], null)).toEqual([label]);
    expect(moveSunriseOffAxisLabel([label], [1, 20])).toEqual([label]);
  });

  it("moves an overlapping sunrise to start at its line when the line is right of the label", () => {
    // Centred at 30 it reaches back to 30 - WIDTH / 2, over a label up to 20.
    const [moved] = moveSunriseOffAxisLabel([sunrise(30)], [1, 20]);
    expect(moved!.anchor).toBe("start");
    expect(moved!.x).toBe(30);
    const [from] = sunTimeLabelSpan(moved!);
    expect(from).toBeGreaterThan(20);
  });

  it("starts just after the label when the line lies under it", () => {
    const [moved] = moveSunriseOffAxisLabel([sunrise(14, 10)], [1, 20]);
    expect(moved!.anchor).toBe("start");
    expect(moved!.x).toBe(22);
  });

  it("keeps a moved label inside its day", () => {
    const [moved] = moveSunriseOffAxisLabel([sunrise(14, 10, 30)], [1, 20]);
    expect(moved!.x).toBeCloseTo(30 - WIDTH, 2);
  });

  it("leaves sunset times alone", () => {
    const sunset: SunTimeLabel = { ...sunrise(10), kind: "sunset" };
    expect(moveSunriseOffAxisLabel([sunset], [1, 20])).toEqual([sunset]);
  });

  it("spans a centred label around x and a moved one from x", () => {
    expect(sunTimeLabelSpan(sunrise(100))).toEqual([100 - WIDTH / 2, 100 + WIDTH / 2]);
    expect(sunTimeLabelSpan({ ...sunrise(100), anchor: "start" })).toEqual([100, 100 + WIDTH]);
  });
});
