import { describe, it, expect } from "vitest";
import {
  describeModelHorizon,
  describeModelRuns,
  displayedRunInitTimes,
  isEnsembleMetadataStale,
} from "./modelInfo.logic";

const TZ = "UTC";

describe("describeModelHorizon", () => {
  it("explains a run that started before now", () => {
    const text = describeModelHorizon(
      {
        catalogue_hours: 120,
        available_hours: 114,
        limited_by_run: true,
        forecast_start_time: "2026-10-06T12:00:00Z",
        run_segments: [
          { run_init_time: "2026-10-06T06:00:00Z", run_length_hours: 120 },
        ],
      },
      TZ,
    );
    expect(text[0]).toContain("Catalogue horizon 120h");
    expect(text[1]).toContain("started 06.10. 06:00");
    expect(text[1]).toContain("6h before the current hour");
    expect(text[1]).toContain("only 114h are left");
  });

  it("explains two combined runs", () => {
    const text = describeModelHorizon(
      {
        catalogue_hours: 360,
        available_hours: 340,
        limited_by_run: true,
        forecast_start_time: "2026-10-06T12:00:00Z",
        run_segments: [
          {
            run_init_time: "2026-10-06T06:00:00Z",
            run_length_hours: 144,
            valid_until: "2026-10-12T07:00:00Z",
          },
          {
            run_init_time: "2026-10-06T00:00:00Z",
            run_length_hours: 360,
            valid_from: "2026-10-12T07:00:00Z",
          },
        ],
      },
      TZ,
    );
    expect(text[1]).toContain("latest run (06.10. 06:00, 144h long)");
    expect(text[1]).toContain("until 12.10. 07:00 (139h from now)");
    expect(text[2]).toContain("earlier run 06.10. 00:00 (360h long)");
    expect(text[2]).toContain("from 12.10. 07:00 until 20.10. 16:00");
    expect(text[3]).toContain("340h from now");
  });

  it("states when the run does not limit the horizon", () => {
    const text = describeModelHorizon({
      catalogue_hours: 360,
      available_hours: 360,
      limited_by_run: false,
      forecast_start_time: "2026-10-06T12:00:00Z",
      run_segments: [],
    });
    expect(text[1]).toContain("full catalogue horizon");
  });

  // The CH2 case: main run 18Z is published, its ensemble is not yet.
  const ch2 = {
    catalogue_hours: 120,
    available_hours: 117,
    limited_by_run: true,
    forecast_start_time: "2026-10-06T22:00:00Z",
    run_segments: [
      { run_init_time: "2026-10-06T18:00:00Z", run_length_hours: 120 },
    ],
    run_init_time: "2026-10-06T18:00:00Z",
    slice_start_hours: 30,
    slice_end_hours: 117,
    ensemble: {
      model_id: "meteoswiss_icon_ch2_ensemble",
      run_init_time: "2026-10-06T12:00:00Z",
      run_availability_time: "2026-10-06T15:30:00Z",
      data_end_time: "2026-10-11T13:00:00Z",
    },
    probability_valid_until: "2026-10-11T13:00:00Z",
  };

  it("explains a probability stop from a lagging ensemble", () => {
    const text = describeModelHorizon(ch2, TZ);
    expect(text).toContainEqual(
      expect.stringContaining(
        'ends 11.10. 13:00, 6h before the end of this model\'s slice, so its curve stops there with "|"',
      ),
    );
    expect(text).toContainEqual(
      expect.stringContaining(
        "ensemble of the latest main run (06.10. 18:00) is not published yet",
      ),
    );
  });

  it("says nothing about the probability when it reaches the slice end", () => {
    const text = describeModelHorizon(
      { ...ch2, probability_valid_until: "2026-10-11T19:00:00Z" },
      TZ,
    );
    expect(text.some((p) => p.includes("Precipitation probability"))).toBe(
      false,
    );
  });

  it("lists main and ensemble run lines", () => {
    const runs = describeModelRuns(ch2, TZ);
    expect(runs.main).toEqual([
      { run: "06.10. 18:00", detail: "120h run, until 11.10. 19:00" },
    ]);
    expect(runs.ensemble).toEqual({
      modelId: "meteoswiss_icon_ch2_ensemble",
      lines: [
        {
          run: "06.10. 12:00",
          detail: "available 06.10. 15:30, until 11.10. 13:00",
        },
      ],
    });
  });

  it("adds earlier ensemble runs when the probability goes past the newest run", () => {
    const runs = describeModelRuns(
      {
        ...ch2,
        ensemble: { ...ch2.ensemble, data_end_time: "2026-10-09T00:00:00Z" },
      },
      TZ,
    );
    expect(runs.ensemble?.lines[1]).toEqual({
      run: "earlier run(s)",
      detail: "09.10. 00:00 – 11.10. 13:00",
    });
  });

  it("does not trust ensemble metadata stuck days before the main run", () => {
    // DWD EPS metadata stayed at 06.10. while 19.10. data was served.
    const icon = {
      catalogue_hours: 120,
      available_hours: 113,
      limited_by_run: true,
      forecast_start_time: "2026-10-19T20:00:00Z",
      probability_valid_until: "2026-10-24T13:00:00Z",
      run_segments: [
        { run_init_time: "2026-10-19T15:00:00Z", run_length_hours: 30 },
      ],
      ensemble: {
        model_id: "dwd_icon_eu_eps",
        run_init_time: "2026-10-06T00:00:00Z",
        run_availability_time: "2026-10-06T03:12:00Z",
        data_end_time: "2026-10-11T01:00:00Z",
      },
    };
    expect(isEnsembleMetadataStale(icon)).toBe(true);
    expect(describeModelRuns(icon, TZ).ensemble).toEqual({
      modelId: "dwd_icon_eu_eps",
      lines: [
        {
          run: "run unknown",
          detail:
            "until 24.10. 13:00; Open-Meteo's run metadata is outdated (last 06.10. 00:00)",
        },
      ],
    });
    expect(isEnsembleMetadataStale(ch2)).toBe(false);
  });
});

describe("displayedRunInitTimes", () => {
  const base = {
    catalogue_hours: 120,
    available_hours: 114,
    limited_by_run: true,
    forecast_start_time: "2026-10-06T12:00:00Z",
    run_segments: [
      { run_init_time: "2026-10-06T09:00:00Z", valid_until: "2026-10-07T15:00:00Z" },
      { run_init_time: "2026-10-06T06:00:00Z" },
    ],
  };

  it("keeps runs overlapping the slice, newest first", () => {
    expect(
      displayedRunInitTimes({ ...base, slice_start_hours: 0, slice_end_hours: 100 }),
    ).toEqual(["2026-10-06T09:00:00Z", "2026-10-06T06:00:00Z"]);
  });

  it("drops a run whose part lies outside the slice", () => {
    // The newest run ends 27h after the forecast start.
    expect(
      displayedRunInitTimes({ ...base, slice_start_hours: 0, slice_end_hours: 27 }),
    ).toEqual(["2026-10-06T09:00:00Z"]);
    expect(
      displayedRunInitTimes({ ...base, slice_start_hours: 27, slice_end_hours: 100 }),
    ).toEqual(["2026-10-06T06:00:00Z"]);
  });

  it("keeps every run without slice bounds", () => {
    expect(displayedRunInitTimes(base)).toHaveLength(2);
  });
});
