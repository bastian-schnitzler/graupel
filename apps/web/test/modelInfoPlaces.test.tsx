// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * REQ-820: on a phone or a tablet the weather chain's info button stands in the model headers while they are shown, and
 * on the chain's cards only while the headers are hidden. On the desktop nothing changes: the cards always have it, the
 * headers while the weather chain card is hidden (REQ-643). The cloud chain's cards keep theirs.
 */
import type { ForecastResult, WeatherModel } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/index.ts";
import { ModelHeaderInfo } from "../src/regions/MeteogramPanel/ModelHeaderInfo.tsx";
import { modelInfoPlaces } from "../src/regions/ModelChain/chain/ModelInfo.tsx";
import { ModelSegment } from "../src/regions/ModelChain/chain/ModelSegment.tsx";
import type { ChainKind } from "../src/state/chainColors.ts";
import { modelHeadersChoice } from "../src/state/displaySettings.ts";
import { COARSE_POINTER_QUERY, PHONE_QUERY, resetModelChainView, weatherChainChoice } from "../src/state/index.ts";

type Device = "phone" | "tablet" | "desktop";

/** Makes this page a phone (the phone's query), a tablet (coarse pointer, iPad Pro 11 screen) or a desktop. */
function useDevice(device: Device) {
  vi.stubGlobal("screen", device === "tablet" ? { width: 834, height: 1194 } : { width: 1920, height: 1080 });
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        media: query,
        matches: (query === PHONE_QUERY && device === "phone") || (query === COARSE_POINTER_QUERY && device === "tablet"),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  resetModelChainView();
  modelHeadersChoice.set(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetModelChainView();
  modelHeadersChoice.set(null);
});

describe("modelInfoPlaces (REQ-820)", () => {
  it("puts the button on a phone or tablet in the headers while shown, else on the cards", () => {
    for (const chainShown of [true, false]) {
      expect(modelInfoPlaces(true, true, chainShown)).toEqual({ header: true, chain: false });
      expect(modelInfoPlaces(true, false, chainShown)).toEqual({ header: false, chain: true });
    }
  });

  it("leaves the desktop as it was: cards always, headers while the weather chain is hidden (REQ-643)", () => {
    for (const headers of [true, false]) {
      expect(modelInfoPlaces(false, headers, true)).toEqual({ header: false, chain: true });
      expect(modelInfoPlaces(false, headers, false)).toEqual({ header: true, chain: true });
    }
  });
});

const MODEL: WeatherModel = { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120 };

function Card({ kind = "main" }: { kind?: ChainKind }) {
  return (
    <I18nProvider browserLanguages={["en"]}>
      <ModelSegment
        segment={{
          model: MODEL,
          index: 0,
          startHour: 0,
          endHour: 120,
          duration: 120,
          widthPct: 100,
          minWidthPct: 100,
          maxCapableHorizon: 120,
          minAllowedHorizon: 0,
          maxAllowedHorizon: 120,
        }}
        meta={{ ...MODEL, provider: "DWD", region: "Europe" }}
        shade={{ color: "#000000", text: "#ffffff" }}
        testIdPrefix={kind === "cloud" ? "cloud-" : ""}
        activeTooltip={null}
        onToggleTooltip={() => {}}
        kind={kind}
      />
    </I18nProvider>
  );
}

const cardButton = () => screen.queryByRole("button", { name: "Details for ICON-EU" });

describe("info button on a chain card (REQ-820)", () => {
  for (const device of ["phone", "tablet"] as const) {
    it(`on a ${device}: none with model headers, there without them`, () => {
      useDevice(device);
      weatherChainChoice.set(true);
      render(<Card />);
      expect(cardButton()).toBeNull();
      act(() => modelHeadersChoice.set(false));
      expect(cardButton()).not.toBeNull();
      act(() => modelHeadersChoice.set(true));
      expect(cardButton()).toBeNull();
    });

    it(`on a ${device}: the cloud chain's card keeps its button with model headers`, () => {
      useDevice(device);
      render(<Card kind="cloud" />);
      expect(cardButton()).not.toBeNull();
    });
  }

  it("on the desktop: there with and without model headers, as before", () => {
    useDevice("desktop");
    weatherChainChoice.set(true);
    render(<Card />);
    expect(cardButton()).not.toBeNull();
    act(() => modelHeadersChoice.set(false));
    expect(cardButton()).not.toBeNull();
  });
});

const CHAIN: ForecastResult["chain"] = [
  { model: "ICON-D2", id: "icon_d2", sliceEndHours: 48, configuredHours: 48 },
  { model: "ICON-EU", id: "icon_eu", sliceEndHours: 120, configuredHours: 120 },
];

type Box = { left: number; right: number; top: number; bottom: number };
const box = (left: number, right: number, top = 10, bottom = 30): Box => ({ left, right, top, bottom });

/** A fake chart with two header segments, as in modelHeaderInfo.test.tsx. */
function Chart() {
  const ref = useRef<HTMLDivElement | null>(null);
  const segments = [
    { model: "ICON-D2", startX: 0, endX: 300, shape: box(0, 300), label: box(180, 220, 13, 27) },
    { model: "ICON-EU", startX: 300, endX: 700, shape: box(300, 700), label: box(480, 520, 13, 27) },
  ];
  return (
    <I18nProvider browserLanguages={["en"]}>
      <div ref={ref}>
        <svg>
          {segments.map((item) => (
            <g
              key={item.model}
              data-testid="model-label-segment"
              data-model={item.model}
              data-start-x={item.startX}
              data-end-x={item.endX}
            >
              <path data-testid="model-header-shape" data-box={JSON.stringify(item.shape)} />
              <text data-testid="model-header-label" fill="#000000" data-box={JSON.stringify(item.label)}>
                {item.model}
              </text>
            </g>
          ))}
        </svg>
        <ModelHeaderInfo containerRef={ref} chain={CHAIN} />
      </div>
    </I18nProvider>
  );
}

const headerButtons = () => screen.queryAllByTestId("model-header-info-button");

describe("info buttons in the model headers (REQ-820)", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const data = this.getAttribute("data-box");
      const { left, right, top, bottom } = data ? (JSON.parse(data) as Box) : box(0, 0, 0, 0);
      return { left, right, top, bottom, x: left, y: top, width: right - left, height: bottom - top } as DOMRect;
    });
  });

  for (const device of ["phone", "tablet"] as const) {
    it(`on a ${device}: there with model headers, also while the weather chain card is shown`, () => {
      useDevice(device);
      weatherChainChoice.set(true);
      render(<Chart />);
      expect(headerButtons()).toHaveLength(2);
      // It opens the model's details (on a phone as a dialog, REQ-719).
      fireEvent.click(headerButtons()[1]!);
      expect(screen.getByTestId("model-info-popover").textContent).toContain("ICON-EU");
      act(() => weatherChainChoice.set(false));
      expect(headerButtons()).toHaveLength(2);
      // Without model headers the layer is gone; the cards have the button.
      act(() => modelHeadersChoice.set(false));
      expect(screen.queryByTestId("model-header-info")).toBeNull();
    });
  }

  it("on the desktop: only while the weather chain card is hidden, as before (REQ-643)", () => {
    useDevice("desktop");
    weatherChainChoice.set(true);
    render(<Chart />);
    expect(headerButtons()).toHaveLength(0);
    act(() => weatherChainChoice.set(false));
    expect(headerButtons()).toHaveLength(2);
  });
});
