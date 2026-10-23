import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ModelSegment } from "./ModelSegment";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderSegment = (extra: Record<string, unknown> = {}) => {
  const model = { name: "ECMWF IFS", max_forecast_horizon_hours: 240 };
  render(
    <ModelSegment
      segment={{ model, index: 0, startHour: 0, endHour: 240, duration: 240 } as never}
      meta={{
        ...model,
        horizon_info: {
          catalogue_hours: 360,
          available_hours: 240,
          limited_by_run: true,
          forecast_start_time: "2026-10-06T12:00:00Z",
          run_segments: [],
          ...extra,
        },
        provider: "ECMWF",
        region: "Global",
      }}
      color="#000"
      activeTooltip="ECMWF IFS"
      onToggleTooltip={() => {}}
    />,
  );
  return screen.getByTestId("model-info-popover");
};

describe("ModelSegment info popover", () => {
  it("shows catalogue vs. available horizon with an explanation", () => {
    renderSegment();
    expect(screen.getByText("Catalogue horizon:")).toBeTruthy();
    expect(screen.getByText("360h")).toBeTruthy();
    expect(screen.getByTestId("model-horizon-info").textContent).toContain(
      "240h of it are left",
    );
  });

  it("shifts left to stay inside the window", () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 900,
      right: 1220,
      width: 320,
    } as DOMRect);
    const popover = renderSegment();
    expect(popover.style.transform).toBe("translateX(calc(-50% + -228px))");
  });

  it("prefers the left edge when the window is too narrow", () => {
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 300,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 420,
      width: 320,
    } as DOMRect);
    const popover = renderSegment();
    expect(popover.style.transform).toBe("translateX(calc(-50% + -92px))");
  });

  it("lists name, main and ensemble runs before the specs", () => {
    renderSegment({
      run_segments: [
        { run_init_time: "2026-10-06T06:00:00Z", run_length_hours: 144 },
      ],
      slice_start_hours: 0,
      slice_end_hours: 240,
      ensemble: {
        model_id: "ecmwf_ifs025_ensemble",
        run_init_time: "2026-10-06T06:00:00Z",
        data_end_time: "2026-10-12T09:00:00Z",
      },
      probability_valid_until: "2026-10-16T00:00:00Z",
    });
    const popover = screen.getByTestId("model-info-popover");
    expect(popover.textContent).toContain("ECMWF IFS (ECMWF, Global)");
    expect(screen.getByTestId("model-main-runs").textContent).toContain(
      "144h run",
    );
    const ensemble = screen.getByTestId("model-ensemble-runs").textContent;
    expect(ensemble).toContain("Ensemble run (ecmwf_ifs025_ensemble)");
    expect(ensemble).toContain("+ earlier run(s)");
    expect(screen.getByText("Probability until:")).toBeTruthy();
  });
});

describe("ModelSegment card", () => {
  const model = { name: "ICON-EU", max_forecast_horizon_hours: 120 };
  const runs = [
    {
      run_init_time: "2026-10-06T09:00:00Z",
      valid_until: "2026-10-07T15:00:00Z",
      run_length_hours: 30,
    },
    { run_init_time: "2026-10-06T06:00:00Z", run_length_hours: 120 },
  ];
  const renderCard = (horizon: Record<string, unknown> | null) =>
    render(
      <ModelSegment
        segment={{ model, index: 0, startHour: 0, endHour: 100, duration: 100 } as never}
        meta={{
          ...model,
          max_forecast_horizon_hours: 114,
          last_run_init_time: "2026-10-06T09:00:00Z",
          data_end_run_init_time: "2026-10-06T06:00:00Z",
          ...(horizon && {
            horizon_info: {
              catalogue_hours: 120,
              available_hours: 114,
              limited_by_run: true,
              forecast_start_time: "2026-10-06T12:00:00Z",
              run_segments: runs,
              ...horizon,
            },
          }),
        }}
        color="#000"
        activeTooltip={null}
        onToggleTooltip={() => {}}
      />,
    );
  const runLine = () =>
    document.querySelector(".model-run-time")?.textContent ?? "";

  it("lists the older run when its part lies inside the slice", () => {
    renderCard({ slice_start_hours: 0, slice_end_hours: 100 });
    expect(runLine()).toMatch(/^Run: 06\.10\. \d\d:00 \+ 06\.10\. \d\d:00$/);
  });

  it("shows only the newest run when the slice ends before the older run", () => {
    renderCard({ slice_start_hours: 0, slice_end_hours: 20 });
    expect(runLine()).toMatch(/^Run: 06\.10\. \d\d:00$/);
  });

  it("shows only the older run when the slice starts after the newest run", () => {
    renderCard({ slice_start_hours: 48, slice_end_hours: 100 });
    expect(runLine()).toMatch(/^Run: 06\.10\. \d\d:00$/);
    const older = new Date("2026-10-06T06:00:00Z").getHours();
    expect(runLine()).toContain(`${String(older).padStart(2, "0")}:00`);
  });

  it("shows usable and total hours in Meteogram View", () => {
    renderCard({ slice_start_hours: 0, slice_end_hours: 100 });
    expect(screen.getByTestId("model-card-max").textContent).toBe(
      "Max: 114/120h",
    );
  });

  it("keeps the Config View run line and Max", () => {
    renderCard(null);
    expect(runLine()).toMatch(/ \+ /);
    expect(screen.getByTestId("model-card-max").textContent).toBe("Max: 114h");
  });
});
