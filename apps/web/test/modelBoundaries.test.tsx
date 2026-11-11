// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Model boundaries in the website's meteogram (REQ-523): thin lines in the chain colours; the weather chain's with the
 * model headers, the cloud chain's only while a boundary of the cloud chain is moved.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  BOUNDARY_STYLES,
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  useChainSelection,
  useForecast,
  type ForecastLoader,
  type ForecastState,
} from "../src/state/index.ts";
import { FIXTURE_START, HOUR, forecastFixture } from "./forecastFixture.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const startMs = Date.parse(FIXTURE_START);
const iso = (hours: number) => new Date(startMs + hours * HOUR).toISOString().replace(".000Z", "Z");

/** Two models in the weather chain (switch after 48 h) and a cloud-chain switch after 40 h. */
function twoModelFixture() {
  const result = forecastFixture();
  const hours = result.chain[0]!.sliceEndHours;
  result.chain = [
    { model: "ICON", sliceEndHours: 48, configuredHours: 48 },
    { model: "IFS", sliceEndHours: hours, configuredHours: hours },
  ];
  result.combined = result.combined.map((point) =>
    Date.parse(point.timestamp) >= startMs + 48 * HOUR ? { ...point, model: "IFS" } : point,
  );
  result.cloudTransitions = [{ timestamp: iso(40), from_model: "ICON", to_model: "IFS" }];
  return result;
}

let forecast: ForecastState;
let chain: ReturnType<typeof useChainSelection>;
function Probe() {
  const current = useForecast();
  const selection = useChainSelection();
  useLayoutEffect(() => {
    forecast = current;
    chain = selection;
  });
  return null;
}

function renderPanel(config: GraupelConfig) {
  const loader = vi.fn<ForecastLoader>(async () => twoModelFixture());
  return render(
    <ConfigProvider config={config}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <Probe />
                <MeteogramPanel />
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const lines = (container: HTMLElement, testId: string) => [
  ...container.querySelectorAll(`svg.meteogram-svg-integrated [data-testid="${testId}"]`),
];

describe("model boundaries in the meteogram (REQ-523)", () => {
  it("draws the weather chain's boundaries as thin lines in the chain colour, the cloud chain's not at rest", async () => {
    const { container } = renderPanel({ ...DEFAULT_CONFIG, modelHeaders: true });
    await screen.findByTestId("meteogram-attribution");
    const [line] = lines(container, "model-boundary-line");
    expect(line).toBeDefined();
    expect(line!.getAttribute("stroke")).toBe(BOUNDARY_STYLES.light.main.color);
    expect(line!.getAttribute("opacity")).toBe(String(BOUNDARY_STYLES.light.main.opacity));
    expect(line!.getAttribute("stroke-width")).toBe("1");
    expect(line!.getAttribute("stroke-dasharray")).toBeNull();
    expect(lines(container, "cloud-model-boundary-line")).toHaveLength(0);
  });

  it("has no weather chain boundaries without model headers", async () => {
    const { container } = renderPanel({ ...DEFAULT_CONFIG, modelHeaders: false });
    await screen.findByTestId("meteogram-attribution");
    expect(lines(container, "model-boundary-line")).toHaveLength(0);
  });

  it("shows the cloud chain's boundaries only while the cloud chain is moved", async () => {
    const { container } = renderPanel({ ...DEFAULT_CONFIG, modelHeaders: true });
    await screen.findByTestId("meteogram-attribution");
    const { models, cloudModels } = chain;

    await act(async () => forecast.setPreview({ models, cloudModels, moving: "main" }));
    expect(lines(container, "cloud-model-boundary-line")).toHaveLength(0);

    await act(async () => forecast.setPreview({ models, cloudModels, moving: "cloud" }));
    const [line] = lines(container, "cloud-model-boundary-line");
    expect(line).toBeDefined();
    expect(line!.getAttribute("stroke")).toBe(BOUNDARY_STYLES.light.cloud.color);
    expect(line!.getAttribute("opacity")).toBe(String(BOUNDARY_STYLES.light.cloud.opacity));

    await act(async () => forecast.setPreview(null));
    expect(lines(container, "cloud-model-boundary-line")).toHaveLength(0);
  });
});
