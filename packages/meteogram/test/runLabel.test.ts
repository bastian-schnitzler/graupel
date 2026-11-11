// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was
// not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
/**
 * Run of a split model in the model header without the month (REQ-695, DEC-072: "07 Z06") and with the date
 * when the runs lie on different days (REQ-697).
 */
import { describe, expect, it } from "vitest";
import {
  calculateModelSegments,
  chooseModelHeaderLabel,
  createTimelineScale,
  estimateModelHeaderLabelWidth,
  formatRunLabel,
  formatRunLabels,
  type RunSegment,
  type WeatherModel,
} from "../src";
import { meteogramToSvgString, renderStaticLayer } from "../src/render/meteogram";
import { createMeteogramScene } from "../src/render/scene";
import { findAll, textContent } from "../src/render/vnode";
import type { MeteogramInput } from "../src/core/input";
import { powerInput, powerOptions } from "./fixtures/meteogramFixtures";

describe("formatRunLabel (REQ-695)", () => {
  it("writes day, a space, Z and hour in UTC for the runs at 00, 06, 12 and 18 UTC", () => {
    expect(formatRunLabel("2026-11-07T00:00:00Z")).toBe("07 Z00");
    expect(formatRunLabel("2026-11-07T06:00:00Z")).toBe("07 Z06");
    expect(formatRunLabel("2026-11-07T12:00:00Z")).toBe("07 Z12");
    expect(formatRunLabel("2026-11-07T18:00:00Z")).toBe("07 Z18");
  });

  it("drops the month at the turn of the month", () => {
    expect(formatRunLabel("2026-10-31T18:00:00Z")).toBe("31 Z18");
    expect(formatRunLabel("2026-11-01T00:00:00Z")).toBe("01 Z00");
    expect(formatRunLabel("2026-12-31T18:00:00Z")).toBe("31 Z18");
    expect(formatRunLabel("2027-01-01T00:00:00Z")).toBe("01 Z00");
  });

  it("takes day and hour in UTC, also for a time with offset or without zone", () => {
    expect(formatRunLabel("2026-11-01T01:00:00+02:00")).toBe("31 Z23");
    expect(formatRunLabel("2026-11-07T06:00")).toBe("07 Z06");
  });

  it("gives null for an unreadable time", () => {
    expect(formatRunLabel("not a time")).toBeNull();
  });
});

describe("formatRunLabels (REQ-697)", () => {
  it("keeps the basic form for runs on one day", () => {
    const runs = ["2026-11-07T00:00:00Z", "2026-11-07T06:00:00Z"];
    expect(formatRunLabels(runs, "de")).toEqual(["07 Z00", "07 Z06"]);
    expect(formatRunLabels(runs, "en-US")).toEqual(["07 Z00", "07 Z06"]);
  });

  it("shows only the date when every run lies on a day of its own, in the order of the locale", () => {
    const runs = ["2026-10-31T18:00:00Z", "2026-11-01T00:00:00Z"];
    expect(formatRunLabels(runs, "de")).toEqual(["31/10", "01/11"]);
    expect(formatRunLabels(runs, "fr")).toEqual(["31/10", "01/11"]);
    expect(formatRunLabels(runs, "it")).toEqual(["31/10", "01/11"]);
    expect(formatRunLabels(runs, "en-GB")).toEqual(["31/10", "01/11"]);
    expect(formatRunLabels(runs, "en-US")).toEqual(["10/31", "11/01"]);
    // Within one month the same.
    expect(formatRunLabels(["2026-11-06T18:00:00Z", "2026-11-07T00:00:00Z"], "de")).toEqual(["06/11", "07/11"]);
  });

  it("orders month first without a locale (default en-US) and for an invalid locale tag", () => {
    const runs = ["2026-10-31T18:00:00Z", "2026-11-01T00:00:00Z"];
    expect(formatRunLabels(runs)).toEqual(["10/31", "11/01"]);
    expect(formatRunLabels(runs, "not a locale")).toEqual(["10/31", "11/01"]);
  });

  it("dates the older day and keeps the basic form for several runs on the newer day across months", () => {
    const runs = ["2026-10-31T18:00:00Z", "2026-11-01T06:00:00Z", "2026-11-01T12:00:00Z"];
    expect(formatRunLabels(runs, "de")).toEqual(["31/10", "01 Z06", "01 Z12"]);
    expect(formatRunLabels(runs, "en-US")).toEqual(["10/31", "01 Z06", "01 Z12"]);
  });

  it("dates every day with a single run across months, also over more than two days", () => {
    expect(
      formatRunLabels(["2026-10-30T12:00:00Z", "2026-11-01T00:00:00Z", "2026-11-01T06:00:00Z"], "de"),
    ).toEqual(["30/10", "01 Z00", "01 Z06"]);
    // Several runs on the older day: those keep the basic form, the single run of the newer day is dated.
    expect(
      formatRunLabels(["2026-10-31T06:00:00Z", "2026-10-31T12:00:00Z", "2026-11-01T00:00:00Z"], "de"),
    ).toEqual(["31 Z06", "31 Z12", "01/11"]);
  });

  it("keeps the basic form for several runs on one day within a month", () => {
    expect(
      formatRunLabels(["2026-11-06T18:00:00Z", "2026-11-07T00:00:00Z", "2026-11-07T06:00:00Z"], "de"),
    ).toEqual(["06 Z18", "07 Z00", "07 Z06"]);
  });

  it("keeps the basic form for a single run and null for an unreadable one", () => {
    expect(formatRunLabels(["2026-11-07T06:00:00Z"], "de")).toEqual(["07 Z06"]);
    expect(formatRunLabels(["2026-11-07T06:00:00Z", "?"], "de")).toEqual(["07 Z06", null]);
    expect(formatRunLabels([], "de")).toEqual([]);
  });
});

describe("model header with run (REQ-695, REQ-697)", () => {
  const startMs = Date.parse("2026-11-01T00:00:00Z");
  const timeline = createTimelineScale(startMs, startMs + 100 * 3_600_000, 0, 1000);
  const chain: WeatherModel[] = [
    { name: "ECMWF IFS HRES", short_name: "IFS HRES", max_forecast_horizon_hours: 80 },
    { name: "GFS", max_forecast_horizon_hours: 100 },
  ];
  const run = (time: string, from: string | null, until: string | null): RunSegment => ({
    run_init_time: time,
    valid_from: from,
    valid_until: until,
  });
  const labels = (runs: RunSegment[], locale?: string) =>
    calculateModelSegments(chain, "2026-11-01T00:00:00Z", timeline, { "ECMWF IFS HRES": runs }, undefined, locale).map(
      (segment) => [segment.label, segment.shortLabel, segment.runLabel],
    );

  it("names the run in the long and the short form", () => {
    const runs = [
      run("2026-11-01T00:00:00Z", null, "2026-11-01T20:00:00Z"),
      run("2026-11-01T06:00:00Z", "2026-11-01T20:00:00Z", null),
    ];
    expect(labels(runs, "de")).toEqual([
      ["ECMWF IFS HRES (01 Z00)", "IFS HRES (01 Z00)", "01 Z00"],
      ["ECMWF IFS HRES (01 Z06)", "IFS HRES (01 Z06)", "01 Z06"],
      ["GFS", null, undefined],
    ]);
  });

  it("shows only the dates for runs on different days, in the order of the locale", () => {
    const runs = [
      run("2026-10-31T18:00:00Z", null, "2026-11-01T20:00:00Z"),
      run("2026-11-01T00:00:00Z", "2026-11-01T20:00:00Z", null),
    ];
    expect(labels(runs, "de").slice(0, 2)).toEqual([
      ["ECMWF IFS HRES (31/10)", "IFS HRES (31/10)", "31/10"],
      ["ECMWF IFS HRES (01/11)", "IFS HRES (01/11)", "01/11"],
    ]);
    expect(labels(runs, "en-US").slice(0, 2)).toEqual([
      ["ECMWF IFS HRES (10/31)", "IFS HRES (10/31)", "10/31"],
      ["ECMWF IFS HRES (11/01)", "IFS HRES (11/01)", "11/01"],
    ]);
  });

  it("dates the older day across months and names the hours of the newer day", () => {
    const runs = [
      run("2026-10-31T18:00:00Z", null, "2026-11-01T12:00:00Z"),
      run("2026-11-01T06:00:00Z", "2026-11-01T12:00:00Z", "2026-11-02T00:00:00Z"),
      run("2026-11-01T12:00:00Z", "2026-11-02T00:00:00Z", null),
    ];
    expect(labels(runs, "de").map(([, short]) => short)).toEqual([
      "IFS HRES (31/10)",
      "IFS HRES (01 Z06)",
      "IFS HRES (01 Z12)",
      null,
    ]);
  });

  it("decides on the runs the header shows, not on runs outside the range", () => {
    // The first run ends before the timeline starts: the header shows two runs on one day.
    const runs = [
      run("2026-10-30T18:00:00Z", null, "2026-10-31T12:00:00Z"),
      run("2026-11-01T00:00:00Z", "2026-10-31T12:00:00Z", "2026-11-01T20:00:00Z"),
      run("2026-11-01T06:00:00Z", "2026-11-01T20:00:00Z", null),
    ];
    expect(labels(runs, "de").map(([, , runLabel]) => runLabel)).toEqual(["01 Z00", "01 Z06", undefined]);
  });
});

describe("width estimate of the header follows the shorter run (REQ-695)", () => {
  it("is shorter than with the month", () => {
    expect(estimateModelHeaderLabelWidth("07 Z06", 10)).toBeCloseTo(37.2);
    expect(estimateModelHeaderLabelWidth("31/10", 10)).toBeCloseTo(31);
    expect(estimateModelHeaderLabelWidth("07 Z06", 10)).toBeLessThan(estimateModelHeaderLabelWidth("11/07Z06", 10));
  });

  it("lets name and run fit where the form with the month did not", () => {
    // 110 units leave 106 for the text: "IFS HRES (07 Z06)" needs 105.4, "IFS HRES (11/07Z06)" 117.8.
    expect(
      chooseModelHeaderLabel("ECMWF IFS HRES (07 Z06)", "IFS HRES (07 Z06)", 110, { runLabel: "07 Z06" }),
    ).toEqual({ text: "IFS HRES (07 Z06)", fontSize: 10, shortened: true });
    expect(
      chooseModelHeaderLabel("ECMWF IFS HRES (11/07Z06)", "IFS HRES (11/07Z06)", 110, { runLabel: "11/07Z06" }),
    ).toMatchObject({ text: "11/07Z06", runOnly: true });
  });
});

describe("run in the drawn header and in the image (REQ-695, REQ-697)", () => {
  const headerTexts = (input: MeteogramInput, options = powerOptions) =>
    findAll(
      renderStaticLayer(createMeteogramScene(input, options)),
      (node) => node.attrs["data-testid"] === "model-header-label",
    ).map((node) => [textContent(node), node.attrs["data-run-only"]]);

  /** The power fixture with the two runs of ICON-D2 on different days. */
  const onTwoDays: MeteogramInput = {
    ...powerInput,
    chain: powerInput.chain.map((entry) =>
      entry.runSegments
        ? {
            ...entry,
            runSegments: entry.runSegments.map((segment, index) => ({
              ...segment,
              run_init_time: index === 0 ? "2026-10-14T18:00:00Z" : "2026-10-15T00:00:00Z",
            })),
          }
        : entry,
    ),
  };

  it("draws the basic form for runs on one day", () => {
    expect(headerTexts(powerInput)).toEqual([
      ["D2 (15 Z00)", undefined],
      ["D2 (15 Z03)", undefined],
      ["EU", undefined],
    ]);
  });

  it("draws only the dates for runs on different days, also as run alone (REQ-522)", () => {
    expect(headerTexts(onTwoDays, { ...powerOptions, locale: "de" })).toEqual([
      ["D2 (14/10)", undefined],
      ["D2 (15/10)", undefined],
      ["EU", undefined],
    ]);
    expect(headerTexts(onTwoDays, { ...powerOptions, locale: "en-US" }).map(([text]) => text)).toEqual([
      "D2 (10/14)",
      "D2 (10/15)",
      "EU",
    ]);
    const narrow = { ...powerOptions, locale: "de", size: { width: 160, height: 400 } };
    expect(headerTexts(onTwoDays, narrow)).toEqual([
      ["14/10", "true"],
      ["15/10", "true"],
      ["EU", undefined],
    ]);
    expect(headerTexts(powerInput, { ...narrow, locale: "en-US" })).toEqual([
      ["15 Z00", "true"],
      ["15 Z03", "true"],
      ["EU", undefined],
    ]);
  });

  it("writes the same runs into the SVG of the image", () => {
    const markup = meteogramToSvgString(onTwoDays, { ...powerOptions, locale: "de" });
    expect(markup).toContain(">D2 (14/10)<");
    expect(markup).toContain(">D2 (15/10)<");
    expect(meteogramToSvgString(powerInput, powerOptions)).toContain(">D2 (15 Z03)<");
  });
});
