// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Try again" when the forecast could not be loaded: without a card of its own, right below the box "No forecast
 * available.", on phones, tablets and desktops (REQ-739); on a phone, also in landscape, the message without the day
 * slider's card and its label "Horizon" (REQ-740). The positions are checked in e2e/retry-button.spec.ts.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  PHONE_LANDSCAPE_QUERY,
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

type Device = "desktop" | "phone" | "phone-landscape";

/** matchMedia stand-in: the phone's query on a phone, the phone's landscape query too when turned. */
function fakeDevice(device: Device) {
  const matching = new Set<string>(
    device === "desktop" ? [] : device === "phone" ? [PHONE_QUERY] : [PHONE_QUERY, PHONE_LANDSCAPE_QUERY],
  );
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: matching.has(query),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function renderPage(loader: ForecastLoader) {
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

const failing = () => vi.fn<ForecastLoader>(async () => Promise.reject(new Error("Too many concurrent requests")));
const daySlider = () => document.querySelector<HTMLElement>('[data-region="day-slider"]')!;
const card = () => screen.getByTestId("meteogram-card");

const css = (path: string) => readFileSync(join(dirname(dirname(fileURLToPath(import.meta.url))), path), "utf8");

describe('"Try again" without a forecast (REQ-739, REQ-740)', () => {
  it.each<Device>(["desktop", "phone", "phone-landscape"])(
    "stands without a card of its own on a %s",
    async (device) => {
      fakeDevice(device);
      renderPage(failing());
      const button = await within(await screen.findByTestId("forecast-error")).findByRole("button", {
        name: "Try again",
      });
      expect(button).toBeTruthy();
      expect(screen.getByTestId("day-slider-empty").textContent).toBe("No forecast available.");
      expect(card().classList.contains("meteogram-card--bare")).toBe(true);
    },
  );

  it.each<[Device, boolean]>([
    ["desktop", false],
    ["phone", true],
    ["phone-landscape", true],
  ])("the message on a %s without the day slider's card: %s", async (device, bare) => {
    fakeDevice(device);
    renderPage(failing());
    await screen.findByTestId("forecast-error");
    expect(daySlider().classList.contains("day-slider-card--bare")).toBe(bare);
  });

  it("the cards come back once the forecast loads", async () => {
    fakeDevice("phone-landscape");
    let fail = true;
    const loader = vi.fn<ForecastLoader>(async () => {
      if (fail) throw new Error("Too many concurrent requests");
      return forecastFixture();
    });
    renderPage(loader);
    const error = await screen.findByTestId("forecast-error");
    fail = false;
    fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    await screen.findByTestId("meteogram-scroll");
    expect(screen.queryByTestId("forecast-error")).toBeNull();
    expect(card().classList.contains("meteogram-card--bare")).toBe(false);
    expect(daySlider().classList.contains("day-slider-card--bare")).toBe(false);
  });

  it("the stylesheets take the card's look, margins and the label away", () => {
    const meteogram = css("src/regions/MeteogramPanel/MeteogramPanel.css");
    const rule = /\.meteogram-card\.meteogram-card--bare\.region \{([^}]*)\}/.exec(meteogram)?.[1] ?? "";
    // Over the phone's rule `.meteogram-card.region`, which reaches over the page's side margins.
    expect(rule).toMatch(/margin-inline: 0;/);
    expect(rule).toMatch(/padding: 0;/);
    expect(rule).toMatch(/border: 0;/);
    expect(rule).toMatch(/background: none;/);
    const slider = css("src/regions/DaySlider/DaySlider.css");
    expect(slider).toMatch(/\.day-slider-card--bare \{[^}]*padding-left: 0;[^}]*border: 0;/);
    expect(slider).toMatch(/\.day-slider-card--bare \.day-slider-card__label \{\s*display: none;/);
  });
});
