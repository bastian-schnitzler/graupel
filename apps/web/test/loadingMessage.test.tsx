// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * "Loading forecast…" stands once (REQ-737): in the day slider's box, with a turning refresh symbol before it, at the
 * first load and while a reload runs (refresh button, REQ-637; pull to refresh, REQ-638); the meteogram has no second
 * message. Only while the day slider is switched off the meteogram says it itself.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { I18nProvider, LANGUAGES, translate, type Language } from "../src/i18n/index.ts";
import { DaySlider } from "../src/regions/DaySlider/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import { UPDATING_DELAY_MS } from "../src/regions/MeteogramPanel/MeteogramPanel.tsx";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  PHONE_QUERY,
  useDaySlider,
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

/** A loader whose first load and reloads stay pending until the test settles them. */
function pendingLoader() {
  const pending: ((result: ForecastResult) => void)[] = [];
  const loader = vi.fn<ForecastLoader>(() => new Promise<ForecastResult>((resolve) => pending.push(resolve)));
  return { loader, pending };
}

/** The day slider as the page has it (App.tsx): left out while switched off (REQ-473). */
function DaySliderCard() {
  return useDaySlider().enabled ? <DaySlider /> : null;
}

function renderPage(loader: ForecastLoader, options: { config?: GraupelConfig; language?: Language } = {}) {
  const language = options.language ?? "en";
  return render(
    <ConfigProvider config={options.config ?? DEFAULT_CONFIG}>
      <I18nProvider languages={[language]} fallbackLanguage={language} browserLanguages={[]}>
        <LocationProvider>
          <ChainProvider>
            <ForecastProvider loader={loader}>
              <DaySelectionProvider>
                <DaySliderCard />
                <MeteogramPanel />
              </DaySelectionProvider>
            </ForecastProvider>
          </ChainProvider>
        </LocationProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

/** The one message: in the day slider, the turning symbol right before its text. */
function expectOneMessage(language: Language = "en") {
  const text = translate(language, "forecast.loading");
  const messages = screen.getAllByText(text);
  expect(messages).toHaveLength(1);
  const message = messages[0]!;
  expect(message.dataset.testid).toBe("forecast-loading");
  expect(message.getAttribute("role")).toBe("status");
  expect(message.closest('[data-region="day-slider"]')).not.toBeNull();
  expect(message.closest('[data-region="meteogram"]')).toBeNull();
  const icon = message.firstElementChild!;
  expect(icon.tagName.toLowerCase()).toBe("svg");
  expect(icon.classList.contains("day-slider__loading-icon")).toBe(true);
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  // The symbol comes before the text.
  expect(icon.nextSibling?.textContent).toBe(text);
  return message;
}

describe("loading message (REQ-737)", () => {
  it("stands once at the first load, in the day slider's box with the turning symbol before it", async () => {
    fakeDevice(false);
    const { loader, pending } = pendingLoader();
    renderPage(loader);
    const message = expectOneMessage();
    expect(message.closest('[data-testid="day-slider-empty"]')).not.toBeNull();
    expect(screen.getAllByTestId("forecast-loading")).toHaveLength(1);

    await act(async () => pending[0]!(forecastFixture()));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
    expect(screen.queryByText(translate("en", "forecast.loading"))).toBeNull();
  });

  it("stands once on a phone too, and in every language with the unchanged text", () => {
    fakeDevice(true);
    for (const language of LANGUAGES) {
      const { loader } = pendingLoader();
      const view = renderPage(loader, { language });
      expectOneMessage(language);
      view.unmount();
    }
  });

  it("a reload from the refresh button shows it over the days, not over the chart (REQ-637)", async () => {
    fakeDevice(false);
    const { loader, pending } = pendingLoader();
    renderPage(loader);
    await act(async () => pending[0]!(forecastFixture()));
    await screen.findByTestId("meteogram-scroll");
    const box = screen.getByTestId("day-slider-loading");
    expect(box.hasAttribute("data-loading")).toBe(false);
    // Only the symbol, hidden, no text while nothing loads.
    expect(box.textContent).toBe("");
    expect(box.querySelector("svg.day-slider__loading-icon")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reload the forecast" }));
    expect(box.hasAttribute("data-loading")).toBe(true);
    const message = expectOneMessage();
    expect(box.contains(message)).toBe(true);
    // The days stay below it, so the slider keeps its size.
    expect(screen.getAllByTestId("day-card").length).toBeGreaterThan(0);
    // Still the one message once the reload takes a while: no "Updating" or second message over the chart (REQ-497).
    await act(() => new Promise((resolve) => setTimeout(resolve, UPDATING_DELAY_MS + 50)));
    expectOneMessage();
    expect(document.querySelector(".meteogram__status")).toBeNull();

    await act(async () => pending[1]!(forecastFixture()));
    expect(box.hasAttribute("data-loading")).toBe(false);
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
  });

  it("a pull to refresh shows the same box; the chart goes straight back (REQ-638)", async () => {
    fakeDevice(true);
    const { loader, pending } = pendingLoader();
    renderPage(loader);
    await act(async () => pending[0]!(forecastFixture()));
    const scroll = await screen.findByTestId("meteogram-scroll");
    const card = screen.getByTestId("meteogram-card");
    const root = document.documentElement;
    expect(screen.queryByTestId("meteogram-pull")).toBeNull();

    fireEvent.touchStart(scroll, { touches: [{ clientX: 100, clientY: 100, identifier: 0 }] });
    for (let y = 110; y <= 200; y += 10) {
      fireEvent.touchMove(scroll, { touches: [{ clientX: 100, clientY: y, identifier: 0 }], cancelable: true });
    }
    // While pulling the box shows the symbol, as far as the pull has come.
    expect(root.dataset.meteogramPull).toBe("ready");
    expect(root.style.getPropertyValue("--meteogram-pull-progress")).toBe("1");
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
    act(() => {
      fireEvent.touchEnd(scroll, { touches: [] });
    });

    expect(root.dataset.meteogramPull).toBeUndefined();
    expect(card.style.getPropertyValue("--meteogram-pull")).toBe("");
    expect(card.hasAttribute("data-pull-loading")).toBe(false);
    expect(screen.getByTestId("day-slider-loading").hasAttribute("data-loading")).toBe(true);
    expectOneMessage();
    await act(() => new Promise((resolve) => setTimeout(resolve, UPDATING_DELAY_MS + 50)));
    expectOneMessage();

    await act(async () => pending[1]!(forecastFixture()));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
  });

  it("stands in the meteogram while the day slider is switched off", async () => {
    fakeDevice(false);
    const { loader, pending } = pendingLoader();
    renderPage(loader, { config: { ...DEFAULT_CONFIG, daySlider: { enabled: false, days: 7 } } });
    expect(screen.queryByTestId("day-slider-empty")).toBeNull();
    const messages = screen.getAllByText(translate("en", "forecast.loading"));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.closest('[data-region="meteogram"]')).not.toBeNull();

    await act(async () => pending[0]!(forecastFixture()));
    fireEvent.click(await screen.findByRole("button", { name: "Reload the forecast" }));
    expect(screen.getByTestId("forecast-loading").closest('[data-region="meteogram"]')).not.toBeNull();
    await act(async () => pending[1]!(forecastFixture()));
    expect(screen.queryByTestId("forecast-loading")).toBeNull();
  });

  it("turns the symbol, and not with prefers-reduced-motion (DaySlider.css)", () => {
    const css = readFileSync(
      join(dirname(dirname(fileURLToPath(import.meta.url))), "src/regions/DaySlider/DaySlider.css"),
      "utf8",
    );
    expect(css).toMatch(/\.day-slider__loading-icon \{[^}]*animation: day-slider-loading-turn/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.day-slider__loading-icon[^{]*\{[^}]*animation: none/);
  });
});
