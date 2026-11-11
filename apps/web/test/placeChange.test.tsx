// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A change of place on a phone and a tablet (REQ-751): the place field's GPS symbol turns into a turning refresh symbol
 * until the new place's forecast is there; no message over the meteogram, the previous place's chart stands meanwhile.
 * The desktop keeps "Updating forecast…" over the chart (REQ-497). The first load keeps the day slider's box (REQ-737).
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { LocationPicker } from "../src/regions/LocationPicker/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import { UPDATING_DELAY_MS } from "../src/regions/MeteogramPanel/MeteogramPanel.tsx";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  PHONE_QUERY,
  useForecast,
  useLocation,
  type ForecastLoader,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const original = window.matchMedia;

afterEach(() => {
  cleanup();
  window.matchMedia = original;
  window.localStorage.clear();
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

/** A loader whose loads stay pending until the test settles them. */
function pendingLoader() {
  const pending: ((result: ForecastResult) => void)[] = [];
  const loader = vi.fn<ForecastLoader>(() => new Promise<ForecastResult>((resolve) => pending.push(resolve)));
  return { loader, pending };
}

const INNSBRUCK = { name: "Innsbruck", lat: 47.2627, lon: 11.3945, elevation: 574 };

/** Chooses Innsbruck, as a search hit or a favourite would. */
function ChooseInnsbruck() {
  const { setLocation } = useLocation();
  return (
    <button type="button" onClick={() => setLocation(INNSBRUCK)}>
      Innsbruck
    </button>
  );
}

/** Loads the forecast anew, as the pull to refresh does (REQ-638). */
function Reload() {
  const { reload } = useForecast();
  return (
    <button type="button" onClick={reload}>
      Reload
    </button>
  );
}

function renderPage(loader: ForecastLoader) {
  return render(
    <ConfigProvider config={DEFAULT_CONFIG}>
      <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
        <NoticesProvider>
          <LocationProvider>
            <ChainProvider>
              <ForecastProvider loader={loader}>
                <DaySelectionProvider>
                  <LocationPicker searchDelay={0} services={{ fetchElevation: async () => undefined }} />
                  <ChooseInnsbruck />
                  <Reload />
                  <DaySlider />
                  <MeteogramPanel />
                </DaySelectionProvider>
              </ForecastProvider>
            </ChainProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const gpsButton = () => screen.getByRole("button", { name: "Current location" });
const fieldIcon = () => gpsButton().querySelector("svg")!.getAttribute("data-icon");
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe("change of place (REQ-751)", () => {
  it("on a phone the field's symbol turns while the new place loads; no message over the chart", async () => {
    fakeDevice(true);
    const { loader, pending } = pendingLoader();
    renderPage(loader);
    // The first load: the day slider's box (REQ-737), the GPS symbol in the field.
    expect(screen.getByTestId("forecast-loading").closest('[data-region="day-slider"]')).not.toBeNull();
    expect(fieldIcon()).toBe("gps");
    await act(async () => pending[0]!(forecastFixture()));
    await screen.findByTestId("meteogram-scroll");
    const chart = document.querySelector("svg.meteogram-svg-integrated");
    expect(chart).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Innsbruck" }));
    expect(fieldIcon()).toBe("refresh");
    expect(gpsButton().hasAttribute("data-loading")).toBe(true);
    expect(gpsButton().querySelector("svg")!.classList.contains("location__loading-icon")).toBe(true);
    // Also once the load takes a while: no message anywhere, the previous chart and days stay.
    await wait(UPDATING_DELAY_MS + 50);
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
    expect(document.querySelector(".meteogram__status")).toBeNull();
    expect(screen.getByTestId("day-slider-loading").hasAttribute("data-loading")).toBe(false);
    expect(document.querySelector("svg.meteogram-svg-integrated")).not.toBeNull();
    expect(screen.getAllByTestId("day-card").length).toBeGreaterThan(0);
    // The button keeps its name and function.
    expect((gpsButton() as HTMLButtonElement).disabled).toBe(false);

    await act(async () => pending[1]!(forecastFixture({ name: "Innsbruck" })));
    expect(fieldIcon()).toBe("gps");
    expect(gpsButton().hasAttribute("data-loading")).toBe(false);
  });

  it("a pull to refresh on a phone keeps the GPS symbol and shows the box over the days (REQ-737)", async () => {
    fakeDevice(true);
    const { loader, pending } = pendingLoader();
    renderPage(loader);
    await act(async () => pending[0]!(forecastFixture()));
    await screen.findByTestId("meteogram-scroll");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByTestId("day-slider-loading").hasAttribute("data-loading")).toBe(true);
    expect(fieldIcon()).toBe("gps");
    await act(async () => pending[1]!(forecastFixture()));
  });

  it("the desktop keeps the GPS symbol and shows \"Updating forecast…\" over the chart (REQ-497)", async () => {
    fakeDevice(false);
    const { loader, pending } = pendingLoader();
    renderPage(loader);
    await act(async () => pending[0]!(forecastFixture()));
    await screen.findByTestId("meteogram-scroll");

    fireEvent.click(screen.getByRole("button", { name: "Innsbruck" }));
    expect(fieldIcon()).toBe("gps");
    await wait(UPDATING_DELAY_MS + 50);
    const message = screen.getByTestId("forecast-loading");
    expect(message.textContent).toBe("Updating forecast…");
    expect(message.closest('[data-region="meteogram"]')).not.toBeNull();

    await act(async () => pending[1]!(forecastFixture({ name: "Innsbruck" })));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
  });

  it("turns the symbol, and not with prefers-reduced-motion (LocationPicker.css)", () => {
    const css = readFileSync(
      join(dirname(dirname(fileURLToPath(import.meta.url))), "src/regions/LocationPicker/LocationPicker.css"),
      "utf8",
    );
    expect(css).toMatch(/\.location__loading-icon \{[^}]*animation: location-loading-turn/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.location__loading-icon \{[^}]*animation: none/);
  });
});
