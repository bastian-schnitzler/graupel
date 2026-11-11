// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Refresh button of the meteogram (REQ-637): on the desktop it stands in the card's button column between "save as"
 * and full screen, named in every language; a click loads the place's forecast anew past the cache, with the message
 * of the first load over the chart until the new forecast is there. Not on a phone, where pulling the chart down
 * reloads (REQ-638).
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, translate } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  PHONE_QUERY,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const original = window.matchMedia;

afterEach(() => {
  cleanup();
  window.matchMedia = original;
  vi.restoreAllMocks();
});

/** matchMedia stand-in: only the phone query matches, and only with `phone`. */
function fakeDevice(phone: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: phone && query === PHONE_QUERY,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

/** A loader whose second and later calls stay pending until the test settles them. */
function loaderWithPending() {
  const pending: ((result: ForecastResult) => void)[] = [];
  const loader = vi.fn<ForecastLoader>((request) =>
    request.refresh ? new Promise<ForecastResult>((resolve) => pending.push(resolve)) : Promise.resolve(forecastFixture()),
  );
  return { loader, pending };
}

function renderPanel(loader: ForecastLoader) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <DaySlider />
                <MeteogramPanel />
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

describe("refresh button of the meteogram (REQ-637)", () => {
  it("stands between save and full screen and reloads past the cache with the first load's message", async () => {
    fakeDevice(false);
    const { loader, pending } = loaderWithPending();
    renderPanel(loader);
    await screen.findByTestId("meteogram-attribution");
    const tools = screen.getByTestId("meteogram-tools");
    const names = within(tools)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    // jsdom cannot copy pictures: there the copy button is missing, the rest keeps its order.
    expect(names.slice(-3)).toEqual(["Save the picture to the photos", "Reload the forecast", "Show the meteogram full screen"]);
    const refresh = screen.getByRole("button", { name: "Reload the forecast" });
    expect(refresh.getAttribute("title")).toBe("Reload the forecast");
    expect(screen.queryByTestId("forecast-loading")).toBeNull();

    fireEvent.click(refresh);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls[1]![0].refresh).toBe(true);
    // At once, in the day slider's box over the days, the chart stays: the first load's message (REQ-737).
    const message = screen.getByTestId("forecast-loading");
    expect(message.textContent).toBe(translate("en", "forecast.loading"));
    expect(message.closest('[data-region="day-slider"]')).not.toBeNull();
    expect(screen.getByTestId("meteogram-scroll")).toBeTruthy();

    await act(async () => pending[0]!(forecastFixture()));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
    expect(screen.getByTestId("meteogram-scroll")).toBeTruthy();
  });

  it("is named in every language", () => {
    const names = new Set<string>();
    for (const language of LANGUAGES) {
      const name = translate(language, "meteogram.refresh");
      expect(name, language).not.toBe("");
      if (language !== "en") expect(name, language).not.toBe(translate("en", "meteogram.refresh"));
      names.add(name);
    }
    expect(names.size).toBe(LANGUAGES.length);
  });

  it("is not there on a phone", async () => {
    fakeDevice(true);
    const { loader } = loaderWithPending();
    renderPanel(loader);
    await screen.findByTestId("meteogram-scroll");
    expect(screen.queryByRole("button", { name: "Reload the forecast" })).toBeNull();
  });
});
