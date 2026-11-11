// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Start with the start place "Current position (GPS)" (REQ-760): the page always asks for a forecast and never stays at
 * "Loading forecast…". It asks for the position at start only where the browser does not give it without a question
 * (DEC-107): granted, read at once; "prompt", the browser asks the user now, until the answer the fallback place (first
 * favourite) stands; denied, no request, only the card. With the permission the position's forecast loads; when
 * the permission is denied, the position fails, runs into the timeout or no answer comes at all (as possible in the
 * installed app on iOS, whose permission query may not answer either), the fallback place's forecast loads, at the
 * latest after the timeout, with the GPS button's card. A load that fails with an abort the page did not ask for ends
 * in the error state, not in a load that never ends.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG, DEFAULT_PLACE, type Place } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { LocationPicker } from "../src/regions/LocationPicker/index.ts";
import {
  ForecastProvider,
  LocationProvider,
  PERMISSION_QUERY_WAIT_MS,
  START_GPS_TIMEOUT_MS,
  resetDisplaySettings,
  startLocationChoice,
  useForecast,
  useLocation,
  type ForecastLoader,
  type ForecastState,
} from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const GROSSGLOCKNER: Place = { name: "Großglockner", lat: 47.0742, lon: 12.6947, elevation: 3798 };
const MATTERHORN: Place = { name: "Matterhorn", lat: 45.9763, lon: 7.6586, elevation: 4478 };
/** The device's position, as the browser reports it (rounded to four decimals by the page). */
const HOME = { latitude: 51.180634, longitude: 7.509271 };

beforeEach(() => {
  window.localStorage.clear();
  resetDisplaySettings();
  startLocationChoice.set("gps");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  resetDisplaySettings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Deferred {
  resolve: (result: ForecastResult) => void;
  reject: (error: unknown) => void;
}

/** A loader whose calls stay pending until the test settles them. */
function pendingLoader() {
  const pending: Deferred[] = [];
  const loader = vi.fn<ForecastLoader>(
    () => new Promise<ForecastResult>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return { loader, pending };
}

/** A loader that answers every request at once with a forecast of its place. */
function answeringLoader() {
  return vi.fn<ForecastLoader>(async (request) =>
    forecastFixture({
      name: request.location.name,
      latitude: request.location.latitude,
      longitude: request.location.longitude,
    }),
  );
}

type Permission = PermissionState | "never";

interface Browser {
  /** What the permission query answers; "never": it does not answer at all. */
  permission: Permission;
  /** What `getCurrentPosition` does: report the position, fail with a code, or never answer. */
  position: "found" | 1 | 2 | 3 | "never";
}

/** Stubs the browser's geolocation and permission query; returns the stub of `getCurrentPosition`. */
function stubBrowser({ permission, position }: Browser) {
  type Locate = (success: PositionCallback, failure?: PositionErrorCallback | null, options?: PositionOptions) => void;
  const getCurrentPosition = vi.fn<Locate>((success, failure) => {
    if (position === "never") return;
    if (position === "found") success({ coords: HOME } as GeolocationPosition);
    else failure?.({ code: position, message: "" } as GeolocationPositionError);
  });
  const query = vi.fn(() =>
    permission === "never" ? new Promise<PermissionStatus>(() => {}) : Promise.resolve({ state: permission }),
  );
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition }, permissions: { query } });
  return getCurrentPosition;
}

/** Where to allow the position again: the generic hint, the same in every test environment (REQ-509). */
const GENERIC_HINT = () => ({ key: "location.gps.hint.generic" as const });

let forecast: ForecastState;

function Probe() {
  const state = useForecast();
  const { place } = useLocation();
  useEffect(() => {
    forecast = state;
  });
  return (
    <output data-testid="probe">
      {state.status} {place.name}
    </output>
  );
}

/** A page start with the start place GPS, the given favourites and loader. */
function start(loader: ForecastLoader, presets: Place[] = [GROSSGLOCKNER, MATTERHORN]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ elevation: [327] }))),
  );
  return render(
    <ConfigProvider config={{ ...DEFAULT_CONFIG, favorites: { enabled: true, presets } }}>
      <I18nProvider browserLanguages={["en"]}>
        <NoticesProvider>
          <LocationProvider>
            <ForecastProvider loader={loader}>
              <LocationPicker searchDelay={0} services={{ locationHint: GENERIC_HINT }} />
              <Probe />
            </ForecastProvider>
          </LocationProvider>
        </NoticesProvider>
      </I18nProvider>
    </ConfigProvider>,
  );
}

const probe = () => screen.getByTestId("probe").textContent;
const requested = (loader: ReturnType<typeof answeringLoader>) =>
  loader.mock.calls.map(([request]) => [request.location.latitude, request.location.longitude]);
const cards = () => screen.queryAllByTestId("error-card").map((card) => card.textContent);
/** Lets the permission query and the loads settle. */
const settle = () => act(async () => {});

describe("start with GPS (REQ-760)", () => {
  it("with the permission loads the forecast of the position, 'My location'", async () => {
    const getCurrentPosition = stubBrowser({ permission: "granted", position: "found" });
    const loader = answeringLoader();
    start(loader);
    await settle();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(probe()).toBe("ready My location");
    expect(requested(loader).at(-1)).toEqual([51.1806, 7.5093]);
    expect(forecast.result?.location).toMatchObject({ latitude: 51.1806, longitude: 7.5093 });
    expect(cards()).toEqual([]);
  });

  it("with the position while the fallback place loads: that load gives way, the position's ends ready", async () => {
    let answer: PositionCallback | undefined;
    stubBrowser({ permission: "granted", position: "never" });
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((success) => (answer = success));
    const { loader, pending } = pendingLoader();
    start(loader);
    await settle();
    expect(loader.mock.calls[0]![0].location).toMatchObject({ name: "Großglockner" });
    act(() => answer!({ coords: HOME } as GeolocationPosition));
    expect(loader.mock.calls[0]![0].signal!.aborted).toBe(true);
    const position = loader.mock.calls.at(-1)![0];
    expect(position.location).toMatchObject({ name: "My location", latitude: 51.1806, longitude: 7.5093 });
    await act(async () => pending.at(-1)!.resolve(forecastFixture({ name: "My location" })));
    expect(probe()).toBe("ready My location");
  });

  it("with a denied permission loads the fallback place at once, with the card and where to allow it", async () => {
    const getCurrentPosition = stubBrowser({ permission: "denied", position: 1 });
    const loader = answeringLoader();
    start(loader);
    await settle();
    // Denied for good: the page does not ask again (DEC-107), only the card shows.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(probe()).toBe("ready Großglockner");
    expect(requested(loader)).toEqual([[GROSSGLOCKNER.lat, GROSSGLOCKNER.lon]]);
    expect(cards()).toEqual(["Access to your location was denied.You can allow it in the browser settings."]);
  });

  it.each([
    [1, "Access to your location was denied."],
    [2, "Your location could not be determined."],
    [3, "Determining your location took too long. Please try again."],
  ] as const)("with error %i of the position loads the fallback place, with the card", async (code, message) => {
    stubBrowser({ permission: "granted", position: code });
    const loader = answeringLoader();
    start(loader);
    await settle();
    expect(probe()).toBe("ready Großglockner");
    expect(requested(loader)).toEqual([[GROSSGLOCKNER.lat, GROSSGLOCKNER.lon]]);
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toContain(message);
  });

  it.each([
    ["the position", { permission: "granted", position: "never" }],
    ["the prompt", { permission: "prompt", position: "never" }],
    ["the prompt and the permission query (installed app on iOS)", { permission: "never", position: "never" }],
  ] as const)("without an answer from %s: the fallback place, the timeout's card after it", async (_, browser) => {
    vi.useFakeTimers();
    stubBrowser(browser);
    const loader = answeringLoader();
    start(loader);
    await settle();
    // The fallback place's forecast does not wait for the position.
    expect(probe()).toBe("ready Großglockner");
    expect(cards()).toEqual([]);
    await act(async () => vi.advanceTimersByTime(START_GPS_TIMEOUT_MS - 1));
    expect(cards()).toEqual([]);
    await act(async () => vi.advanceTimersByTime(1));
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toContain("Determining your location took too long. Please try again.");
    expect(probe()).toBe("ready Großglockner");
    expect(requested(loader)).toEqual([[GROSSGLOCKNER.lat, GROSSGLOCKNER.lon]]);
  });

  it("takes a position that comes after the timeout, and its card goes", async () => {
    vi.useFakeTimers();
    let answer: PositionCallback | undefined;
    stubBrowser({ permission: "granted", position: "never" });
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((success) => (answer = success));
    const loader = answeringLoader();
    start(loader);
    await settle();
    await act(async () => vi.advanceTimersByTime(START_GPS_TIMEOUT_MS));
    expect(cards()).toHaveLength(1);
    await act(async () => answer!({ coords: HOME } as GeolocationPosition));
    expect(probe()).toBe("ready My location");
    expect(cards()).toEqual([]);
  });

  /** A browser that has yet to ask the user (state "prompt"): the answer comes when the test gives it. */
  function promptingBrowser() {
    const answers: { allow: PositionCallback; deny: PositionErrorCallback }[] = [];
    const getCurrentPosition = stubBrowser({ permission: "prompt", position: "never" });
    getCurrentPosition.mockImplementation((allow, deny) => {
      answers.push({ allow, deny: deny! });
    });
    return { getCurrentPosition, answers };
  }

  it("without the permission yet asks for the position at start; allowed: 'My location' (DEC-107)", async () => {
    const { getCurrentPosition, answers } = promptingBrowser();
    const loader = answeringLoader();
    start(loader);
    await settle();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0]![2]).toMatchObject({ timeout: START_GPS_TIMEOUT_MS });
    // While the browser asks, the fallback place stands with its forecast.
    expect(probe()).toBe("ready Großglockner");
    await act(async () => answers[0]!.allow({ coords: HOME } as GeolocationPosition));
    expect(probe()).toBe("ready My location");
    expect(requested(loader).at(-1)).toEqual([51.1806, 7.5093]);
    expect(cards()).toEqual([]);
  });

  it("without the permission yet asks for the position at start; denied: the fallback place and the card", async () => {
    const { answers } = promptingBrowser();
    const loader = answeringLoader();
    start(loader);
    await settle();
    await act(async () => answers[0]!.deny({ code: 1, message: "" } as GeolocationPositionError));
    expect(probe()).toBe("ready Großglockner");
    expect(requested(loader)).toEqual([[GROSSGLOCKNER.lat, GROSSGLOCKNER.lon]]);
    expect(cards()).toEqual(["Access to your location was denied.You can allow it in the browser settings."]);
  });

  it("with a permission query that never answers (installed app on iOS) asks after a moment", async () => {
    vi.useFakeTimers();
    const getCurrentPosition = stubBrowser({ permission: "never", position: "found" });
    const loader = answeringLoader();
    start(loader);
    await settle();
    await act(async () => vi.advanceTimersByTime(PERMISSION_QUERY_WAIT_MS - 1));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(probe()).toBe("ready Großglockner");
    await act(async () => vi.advanceTimersByTime(1));
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(probe()).toBe("ready My location");
  });

  it("without favourites the fallback is the configured default place", async () => {
    stubBrowser({ permission: "denied", position: 1 });
    const loader = answeringLoader();
    start(loader, []);
    await settle();
    expect(probe()).toBe(`ready ${DEFAULT_PLACE.name}`);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("the elevation fetched for a fallback place without one does not keep the position away", async () => {
    let answer: PositionCallback | undefined;
    stubBrowser({ permission: "granted", position: "never" });
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((success) => (answer = success));
    const loader = answeringLoader();
    // A map point stored as favourite, without elevation: the picker fetches it (327 m) and completes the place.
    start(loader, [{ name: "", lat: 47.1, lon: 12.7 }]);
    await settle();
    await settle();
    expect(forecast.result?.location).toMatchObject({ latitude: 47.1, longitude: 12.7 });
    await act(async () => answer!({ coords: HOME } as GeolocationPosition));
    expect(probe()).toBe("ready My location");
  });

  it("stops looking for the position when the user picks a place: no card after the timeout", async () => {
    vi.useFakeTimers();
    stubBrowser({ permission: "granted", position: "never" });
    const loader = answeringLoader();
    let pick: ((place: Place) => void) | undefined;
    function Picker() {
      const { setLocation } = useLocation();
      useEffect(() => {
        pick = setLocation;
      });
      return null;
    }
    render(
      <ConfigProvider config={{ ...DEFAULT_CONFIG, favorites: { enabled: true, presets: [GROSSGLOCKNER] } }}>
        <I18nProvider browserLanguages={["en"]}>
          <NoticesProvider>
            <LocationProvider>
              <ForecastProvider loader={loader}>
                <LocationPicker searchDelay={0} />
                <Picker />
                <Probe />
              </ForecastProvider>
            </LocationProvider>
          </NoticesProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    await settle();
    act(() => pick!(MATTERHORN));
    await act(async () => vi.advanceTimersByTime(START_GPS_TIMEOUT_MS));
    expect(probe()).toBe("ready Matterhorn");
    expect(cards()).toEqual([]);
  });
});

describe("a load that never ends (REQ-760)", () => {
  it("ends in the error state when the load fails with an abort the page did not ask for", async () => {
    stubBrowser({ permission: "prompt", position: "never" });
    const { loader, pending } = pendingLoader();
    start(loader);
    await settle();
    expect(probe()).toBe("loading Großglockner");
    // E.g. the browser cancelled a request of the load itself (WebKit reports that as an AbortError).
    await act(async () => pending[0]!.reject(new DOMException("Fetch is aborted", "AbortError")));
    expect(probe()).toBe("error Großglockner");
    expect(forecast.error).toBeInstanceOf(DOMException);
  });
});
