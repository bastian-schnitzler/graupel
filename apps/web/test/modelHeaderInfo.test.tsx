// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Info buttons in the meteogram's model header (REQ-643): one per model in its widest part, right of the name and
 * inside the header, none where it does not fit; only while the weather chain card is hidden; the same popover as on
 * a chain card. A model that took the slice of a model without current data (REQ-767) has the note on it in the popover
 * only: neither the header nor its button shows it.
 */
import type { ForecastResult } from "@graupel/download";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/index.ts";
import {
  ModelHeaderInfo,
  placeInfoButtons,
  type MeasuredSegment,
} from "../src/regions/MeteogramPanel/ModelHeaderInfo.tsx";
import { ForecastOverride, resetModelChainView, weatherChainChoice } from "../src/state/index.ts";
import { forecastFixture } from "./forecastFixture.ts";

const box = (left: number, right: number, top = 10, bottom = 30) => ({ left, right, top, bottom });

function segment(model: string, startX: number, endX: number, labelRight: number): MeasuredSegment {
  return {
    model,
    startX,
    endX,
    shape: box(startX, endX),
    label: box(labelRight - 40, labelRight, 13, 27),
    color: "#000000",
  };
}

describe("placeInfoButtons", () => {
  it("puts one button per model right of the name, centred in the header", () => {
    const placements = placeInfoButtons([segment("ICON-D2", 0, 200, 120), segment("ICON-EU", 200, 600, 420)], {
      left: 0,
      top: 0,
    });
    expect(placements).toEqual([
      { model: "ICON-D2", left: 124, top: 12, size: 16, color: "#000000" },
      { model: "ICON-EU", left: 424, top: 12, size: 16, color: "#000000" },
    ]);
  });

  it("takes only the widest part of a model split into runs", () => {
    const placements = placeInfoButtons(
      [segment("ICON-D2", 0, 100, 70), segment("ICON-D2", 100, 400, 270), segment("ICON-D2", 400, 500, 470)],
      { left: 0, top: 0 },
    );
    expect(placements).toHaveLength(1);
    expect(placements[0]!.left).toBe(274);
  });

  it("leaves out a model whose widest part has no room beside the name", () => {
    // Name ends 10 px before the header's end: no room for 16 px with gaps.
    const placements = placeInfoButtons([segment("ICON-D2", 0, 100, 90), segment("ICON-EU", 100, 400, 270)], {
      left: 0,
      top: 0,
    });
    expect(placements.map((placement) => placement.model)).toEqual(["ICON-EU"]);
    // It does not move to a narrower part either.
    expect(
      placeInfoButtons([segment("ICON-D2", 0, 300, 295), segment("ICON-D2", 300, 400, 330)], { left: 0, top: 0 }),
    ).toEqual([]);
  });

  it("gets smaller in a lower header and is placed relative to the layer", () => {
    const low: MeasuredSegment = { ...segment("ICON-D2", 100, 400, 250), shape: box(100, 400, 50, 64) };
    const [placement] = placeInfoButtons([low], { left: 100, top: 40 });
    expect(placement).toEqual({ model: "ICON-D2", left: 152.8, top: 11.5, size: 11, color: "#000000" });
  });
});

const DEFAULT_CHAIN: ForecastResult["chain"] = [
  { model: "ICON-D2", id: "icon_d2", sliceEndHours: 48, configuredHours: 48 },
  { model: "ICON-EU", id: "icon_eu", sliceEndHours: 120, configuredHours: 120 },
];

/** A fake chart: the core's header segments, each measured as `segment` says. */
function Chart({ segments, chain = DEFAULT_CHAIN }: { segments: MeasuredSegment[]; chain?: ForecastResult["chain"] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} data-testid="container">
      <svg>
        {segments.map((item, index) => (
          <g
            key={index}
            data-testid="model-label-segment"
            data-model={item.model}
            data-start-x={item.startX}
            data-end-x={item.endX}
          >
            <path data-testid="model-header-shape" data-box={JSON.stringify(item.shape)} />
            <text data-testid="model-header-label" fill={item.color ?? undefined} data-box={JSON.stringify(item.label)}>
              {item.model}
            </text>
          </g>
        ))}
      </svg>
      <ModelHeaderInfo containerRef={ref} chain={chain} />
    </div>
  );
}

describe("ModelHeaderInfo", () => {
  beforeEach(() => {
    resetModelChainView();
    // Each element measures as its `data-box` says; everything else (the layer) at the origin.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const data = this.getAttribute("data-box");
      const { left, right, top, bottom } = data ? (JSON.parse(data) as ReturnType<typeof box>) : box(0, 0, 0, 0);
      return { left, right, top, bottom, x: left, y: top, width: right - left, height: bottom - top } as DOMRect;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetModelChainView();
  });

  const segments = [segment("ICON-D2", 0, 100, 60), segment("ICON-D2", 100, 300, 220), segment("ICON-EU", 300, 700, 520)];
  const renderChart = () =>
    render(
      <I18nProvider browserLanguages={["en"]}>
        <Chart segments={segments} />
      </I18nProvider>,
    );

  it("shows one button per model while the weather chain is hidden, opening the model's popover", () => {
    renderChart();
    const buttons = screen.getAllByTestId("model-header-info-button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Details for ICON-D2",
      "Details for ICON-EU",
    ]);
    // In the widest part of ICON-D2, right of its name.
    const item = buttons[0]!.parentElement!;
    expect(item.style.left).toBe("224px");
    expect(item.style.width).toBe("16px");
    expect(item.style.color).toBe("rgb(0, 0, 0)");

    fireEvent.click(buttons[1]!);
    const popover = screen.getByTestId("model-info-popover");
    expect(popover.textContent).toContain("ICON-EU");
    expect(buttons[1]!.getAttribute("aria-expanded")).toBe("true");
    // A press elsewhere closes it, as on a chain card.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
  });

  it("keeps a click or double-click on a button away from the chart's container", () => {
    const onClick = vi.fn();
    const onDoubleClick = vi.fn();
    render(
      <I18nProvider browserLanguages={["en"]}>
        <div onClick={onClick} onDoubleClick={onDoubleClick}>
          <Chart segments={segments} />
        </div>
      </I18nProvider>,
    );
    const button = screen.getAllByTestId("model-header-info-button")[0]!;
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onDoubleClick).not.toHaveBeenCalled();
  });

  it("closes the popover on Escape before a dialog around it sees the key", () => {
    const onKeyDown = vi.fn();
    render(
      <I18nProvider browserLanguages={["en"]}>
        <div onKeyDown={onKeyDown}>
          <Chart segments={segments} />
        </div>
      </I18nProvider>,
    );
    const button = screen.getAllByTestId("model-header-info-button")[0]!;
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    // Closed, Escape goes on to the dialog.
    fireEvent.keyDown(button, { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  // REQ-767: ICON-D2 took the slice of AROME AT, which delivers no current data.
  const replacedChain: ForecastResult["chain"] = [
    {
      ...DEFAULT_CHAIN[0]!,
      replaces: { model: "GeoSphere AROME Austria", id: "geosphere_arome_austria", shortName: "AROME AT" },
    },
    DEFAULT_CHAIN[1]!,
  ];
  const renderReplaced = (language: string) => {
    const result: ForecastResult = { ...forecastFixture(), chain: replacedChain };
    render(
      <I18nProvider browserLanguages={[language]}>
        <ForecastOverride value={{ status: "ready", result, reload: () => {}, setPreview: () => {} }}>
          <Chart segments={segments} chain={replacedChain} />
        </ForecastOverride>
      </I18nProvider>,
    );
  };

  it("names the replaced model in the replacement's popover only, not in the header (REQ-767)", () => {
    renderReplaced("en");
    const note = "AROME AT delivers no data at the moment; replaced by ICON-D2.";
    // The header and its buttons stay as they are: one plain info button per model, nothing beside or behind it.
    const layer = screen.getByTestId("model-header-info");
    expect(layer.textContent).toBe("");
    expect(layer.children).toHaveLength(2);
    const buttons = screen.getAllByTestId("model-header-info-button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Details for ICON-D2",
      "Details for ICON-EU",
    ]);
    for (const button of buttons) {
      expect(button.parentElement!.children).toHaveLength(1);
      expect(button.getAttribute("title")).toBeNull();
    }
    expect(screen.getByTestId("container").textContent).not.toContain("AROME");
    expect(screen.queryByTestId("model-info-replaced")).toBeNull();

    // The note is part of the text in the popover of ICON-D2.
    fireEvent.click(buttons[0]!);
    const popover = screen.getByTestId("model-info-popover");
    expect(within(popover).getByTestId("model-info-replaced").textContent).toBe(note);
    expect(popover.textContent).toContain(note);
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId("container").textContent).not.toContain("AROME");

    // ICON-EU replaced nothing: no note.
    fireEvent.click(buttons[1]!);
    expect(screen.getByTestId("model-info-popover").textContent).not.toContain("AROME");
    expect(screen.queryByTestId("model-info-replaced")).toBeNull();
  });

  it("writes the note in the page's language (REQ-767)", () => {
    renderReplaced("de");
    fireEvent.click(screen.getAllByTestId("model-header-info-button")[0]!);
    expect(screen.getByTestId("model-info-replaced").textContent).toBe(
      "AROME AT liefert derzeit keine Daten; ersetzt durch ICON-D2.",
    );
  });

  it("has no buttons while the weather chain card is shown", () => {
    weatherChainChoice.set(true);
    renderChart();
    expect(screen.queryByTestId("model-header-info")).toBeNull();
    expect(screen.queryByTestId("model-header-info-button")).toBeNull();
    // Hiding the card brings them back.
    act(() => weatherChainChoice.set(false));
    expect(screen.getAllByTestId("model-header-info-button")).toHaveLength(2);
  });
});
