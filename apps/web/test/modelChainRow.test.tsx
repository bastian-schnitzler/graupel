// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * One model chain card (REQ-482, REQ-435). Texts are translated (English here). The website cannot add or
 * remove models (REQ-480); the boundaries are moved with pointer and keys and handed on once per move (REQ-481).
 */
import type { WeatherModel } from "@graupel/download";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/index.ts";
import type { AvailableModels } from "../src/regions/ModelChain/chain/chainUtils.ts";
import { ModelChainRow, type ModelChainRowProps } from "../src/regions/ModelChain/chain/ModelChainRow.tsx";
import { ModelSegment } from "../src/regions/ModelChain/chain/ModelSegment.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Catalogue entries of a few models.
const MODELS: AvailableModels = {
  icon_d2: { id: "icon_d2", name: "ICON-D2", max_forecast_horizon_hours: 48, provider: "DWD", region: "Central Europe" },
  icon_eu: { id: "icon_eu", name: "ICON-EU", max_forecast_horizon_hours: 120, provider: "DWD", region: "Europe" },
  ncep_gfs_seamless: { id: "ncep_gfs_seamless", name: "GFS Seamless", max_forecast_horizon_hours: 384 },
};

function wrap(ui: ReactElement) {
  return <I18nProvider browserLanguages={["en"]}>{ui}</I18nProvider>;
}

function renderRow(props: Partial<ModelChainRowProps> & Pick<ModelChainRowProps, "modelChain">) {
  const all: ModelChainRowProps = { availableModels: MODELS, ...props };
  const result = render(wrap(<ModelChainRow {...all} />));
  return {
    ...result,
    rerender: (next: Partial<ModelChainRowProps>) => result.rerender(wrap(<ModelChainRow {...all} {...next} />)),
  };
}

const width = (testId: string) => parseFloat(screen.getByTestId(testId).parentElement!.style.width);
const range = (name: string) => screen.getByTestId(`model-range-${name}`).textContent;

describe("ModelChainRow", () => {
  const sampleChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 36 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { name: "GFS", max_forecast_horizon_hours: 384 },
  ];
  const fullChain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
    { name: "GFS", max_forecast_horizon_hours: 384 },
  ];

  it("renders weather models in horizontal chain sequence, without buttons to remove or collapse", () => {
    renderRow({ modelChain: sampleChain });
    expect(screen.getByText("ICON-D2")).toBeTruthy();
    expect(screen.getByText("ICON-EU")).toBeTruthy();
    expect(screen.getByText("GFS")).toBeTruthy();
    // Only the info buttons: no models are added, removed or collapsed on the website (REQ-480, REQ-482).
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Details for ICON-D2",
      "Details for ICON-EU",
      "Details for GFS Seamless",
    ]);
  });

  it("initially distributes full model boxes equally (33.33% baseline for 3 models)", () => {
    renderRow({ modelChain: fullChain });
    for (const name of ["ICON-D2", "ICON-EU", "GFS"]) {
      expect(screen.getByTestId(`model-card-${name}`).parentElement!.style.width).toBe("33.333333333333336%");
    }
  });

  it("proportionally scales box width down when time span is reduced", () => {
    renderRow({ modelChain: sampleChain });
    // ICON-D2 at 36h out of 48h (75% span) scales from 33.33% down towards 11.11%: 27.78%
    expect(width("model-card-ICON-D2")).toBeCloseTo(27.778, 1);
    // Freed width transferred to adjacent model on right
    expect(width("model-card-ICON-EU")).toBeCloseTo(38.889, 1);
    expect(width("model-card-GFS")).toBeCloseTo(33.333, 1);
  });

  it("offers each boundary as a slider over the hour the next model takes over", () => {
    renderRow({ modelChain: sampleChain });
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(2);
    const first = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    expect(first.getAttribute("aria-valuenow")).toBe("36");
    expect(first.getAttribute("aria-valuemin")).toBe("0");
    expect(first.getAttribute("aria-valuemax")).toBe("48");
    expect(first.getAttribute("aria-valuetext")).toBe("ICON-D2 until 36 h, then ICON-EU");
    expect(first.getAttribute("tabindex")).toBe("0");
  });

  it("moves a boundary with the keys and hands the chain on when the key is let go", () => {
    const onCommit = vi.fn();
    renderRow({ modelChain: sampleChain, onCommit });
    const [first, second] = screen.getAllByRole("slider");
    fireEvent.keyDown(first!, { key: "ArrowLeft" });
    fireEvent.keyDown(first!, { key: "ArrowLeft" });
    // The cards follow at once, the chain is handed on only once.
    expect(range("ICON-D2")).toBe("0–34 h (34 h)");
    expect(first!.getAttribute("aria-valuenow")).toBe("34");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(first!, { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith([
      { name: "ICON-D2", max_forecast_horizon_hours: 34 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ]);

    // With Shift by 12 hours; leaving the boundary hands it on too.
    onCommit.mockClear();
    fireEvent.keyDown(second!, { key: "ArrowLeft", shiftKey: true });
    fireEvent.blur(second!);
    expect(onCommit).toHaveBeenLastCalledWith([
      { name: "ICON-D2", max_forecast_horizon_hours: 34 },
      { name: "ICON-EU", max_forecast_horizon_hours: 108 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ]);
  });

  it("goes to the limits with Home and End and stays within them", () => {
    const onCommit = vi.fn();
    renderRow({ modelChain: sampleChain, onCommit });
    const first = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    fireEvent.keyDown(first, { key: "End" });
    expect(first.getAttribute("aria-valuenow")).toBe("48");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(first.getAttribute("aria-valuenow")).toBe("48");
    fireEvent.keyDown(first, { key: "Home" });
    expect(first.getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(first, { key: "PageUp" });
    expect(first.getAttribute("aria-valuenow")).toBe("12");
    // Other keys are left alone.
    fireEvent.keyDown(first, { key: "a" });
    expect(first.getAttribute("aria-valuenow")).toBe("12");
    fireEvent.keyUp(first, { key: "PageUp" });
    expect(onCommit).toHaveBeenLastCalledWith([
      { name: "ICON-D2", max_forecast_horizon_hours: 12 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ]);
  });

  it("hands nothing on when the boundary ends where it started", () => {
    const onCommit = vi.fn();
    renderRow({ modelChain: sampleChain, onCommit });
    const first = screen.getAllByRole("slider")[0]!;
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    fireEvent.keyDown(first, { key: "ArrowRight" });
    fireEvent.keyUp(first, { key: "ArrowRight" });
    fireEvent.pointerDown(first, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerUp(first, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(first.getAttribute("aria-valuenow")).toBe("36");
  });

  it("a double-click or a double-tap asks to reset that boundary; a drag or slow taps do not (REQ-498)", () => {
    const onReset = vi.fn();
    const onCommit = vi.fn();
    renderRow({ modelChain: sampleChain, onCommit, onReset });
    const [first, second] = screen.getAllByRole("slider") as [HTMLElement, HTMLElement];
    expect(first.getAttribute("title")).toMatch(/Double-click/);
    fireEvent.doubleClick(second);
    expect(onReset).toHaveBeenLastCalledWith(1);

    // A mouse double-click comes as dblclick only; its pointer events do not count as taps.
    onReset.mockClear();
    const mouse = { pointerId: 1, clientX: 300, button: 0, pointerType: "mouse" };
    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(first, mouse);
      fireEvent.pointerUp(first, mouse);
    }
    expect(onReset).not.toHaveBeenCalled();

    // Two taps of a finger in a row on the same boundary.
    const touch = { pointerId: 2, clientX: 300, button: 0, pointerType: "touch" };
    const now = vi.spyOn(Date, "now");
    const tap = (handle: HTMLElement, at: number, clientX = 300) => {
      now.mockReturnValue(at);
      fireEvent.pointerDown(handle, touch);
      fireEvent.pointerMove(handle, { ...touch, clientX });
      fireEvent.pointerUp(handle, { ...touch, clientX });
    };
    tap(first, 1000);
    tap(first, 1200);
    expect(onReset).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenLastCalledWith(0);
    // The browser's own dblclick for that double-tap does not reset again.
    fireEvent.doubleClick(first);
    expect(onReset).toHaveBeenCalledOnce();

    // Too slow, on two boundaries, or a drag in between: no double-tap.
    onReset.mockClear();
    tap(first, 5000);
    tap(first, 5400);
    tap(first, 9000);
    tap(second, 9100);
    tap(second, 20000, 260);
    tap(second, 20100);
    expect(onReset).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("drags a boundary: the cards follow the pointer, the chain is handed on when it is released", () => {
    const onCommit = vi.fn();
    renderRow({ modelChain: sampleChain, onCommit });
    const handle = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 300, button: 0 });
    expect(handle.classList.contains("active-resizing")).toBe(true);
    // Drag boundary right by shifting clientX by +31px (+12h change on 1000 px over 384 h), capped at 48 h.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 331 });
    expect(range("ICON-D2")).toBe("0–48 h (48 h)");
    expect(range("ICON-EU")).toBe("48–120 h (72 h)");
    // Back a bit: from the start of the drag, not from the last position.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 290 });
    expect(range("ICON-D2")).toBe("0–32 h (32 h)");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle.classList.contains("active-resizing")).toBe(false);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith([
      { name: "ICON-D2", max_forecast_horizon_hours: 32 },
      { name: "ICON-EU", max_forecast_horizon_hours: 120 },
      { name: "GFS", max_forecast_horizon_hours: 384 },
    ]);
    // Moves of a pointer that is not dragging change nothing.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    expect(range("ICON-D2")).toBe("0–32 h (32 h)");
  });

  it("hands the dragged chain to onPreview at hour steps, once per frame, and null on release (REQ-504)", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const runFrames = () => frames.splice(0).forEach((callback) => callback(0));
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    renderRow({ modelChain: sampleChain, onCommit, onPreview });
    const handle = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    const first = (call: number) => (onPreview.mock.calls[call]![0] as WeatherModel[])[0]!.max_forecast_horizon_hours;

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 300, button: 0 });
    // Less than an hour: no step, nothing to hand on.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 301 });
    runFrames();
    expect(onPreview).not.toHaveBeenCalled();
    // Two steps in one frame: only the latest goes on.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 295 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 290 });
    expect(frames).toHaveLength(1);
    runFrames();
    expect(onPreview).toHaveBeenCalledOnce();
    expect(first(0)).toBe(32);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 280 });
    runFrames();
    expect(first(1)).toBe(28);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onPreview).toHaveBeenCalledTimes(3);
  });

  it("previews nothing for keys, which hand the chain on themselves", () => {
    const onPreview = vi.fn();
    renderRow({ modelChain: sampleChain, onPreview, onCommit: vi.fn() });
    const handle = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyUp(handle, { key: "ArrowLeft" });
    expect(onPreview).not.toHaveBeenCalled();
  });

  describe("keys for the boundary under the mouse (REQ-657)", () => {
    /** A key pressed and let go with the focus on `target` (the page when nothing has it). */
    function press(target: Element, key: string, init: Partial<KeyboardEventInit> = {}) {
      const down = fireEvent.keyDown(target, { key, ...init });
      fireEvent.keyUp(target, { key, ...init });
      // fireEvent returns false when the default was prevented.
      return !down;
    }

    it("moves the boundary under the mouse without the focus and hands it on when the key is let go", () => {
      const onCommit = vi.fn();
      renderRow({ modelChain: sampleChain, onCommit });
      const first = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
      fireEvent.pointerEnter(first, { pointerType: "mouse" });
      expect(document.activeElement).toBe(document.body);
      const down = fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(down).toBe(false);
      expect(first.getAttribute("aria-valuenow")).toBe("35");
      expect(onCommit).not.toHaveBeenCalled();
      fireEvent.keyUp(document.body, { key: "ArrowLeft" });
      expect(onCommit).toHaveBeenCalledOnce();
      expect(onCommit).toHaveBeenLastCalledWith([
        { name: "ICON-D2", max_forecast_horizon_hours: 35 },
        { name: "ICON-EU", max_forecast_horizon_hours: 120 },
        { name: "GFS", max_forecast_horizon_hours: 384 },
      ]);
      // With Shift by 12 hours, Page Down by 12, Home and End to the limits.
      expect(press(document.body, "ArrowLeft", { shiftKey: true })).toBe(true);
      expect(first.getAttribute("aria-valuenow")).toBe("23");
      expect(press(document.body, "PageDown")).toBe(true);
      expect(first.getAttribute("aria-valuenow")).toBe("11");
      expect(press(document.body, "End")).toBe(true);
      expect(first.getAttribute("aria-valuenow")).toBe("48");
      expect(press(document.body, "Home")).toBe(true);
      expect(first.getAttribute("aria-valuenow")).toBe("0");
      // Other keys and shortcuts are left alone.
      expect(press(document.body, "a")).toBe(false);
      expect(press(document.body, "ArrowRight", { altKey: true })).toBe(false);
      expect(press(document.body, "ArrowRight", { ctrlKey: true })).toBe(false);
      expect(first.getAttribute("aria-valuenow")).toBe("0");
    });

    it("forgets the boundary when the mouse leaves it; a finger or pen over it does not take the keys", () => {
      const onCommit = vi.fn();
      renderRow({ modelChain: sampleChain, onCommit });
      const [first, second] = screen.getAllByRole("slider");
      fireEvent.pointerEnter(second!, { pointerType: "mouse" });
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(second!.getAttribute("aria-valuenow")).toBe("119");
      // Leaving it while the key is still down hands the move on.
      fireEvent.pointerLeave(second!, { pointerType: "mouse" });
      expect(onCommit).toHaveBeenCalledOnce();
      fireEvent.keyUp(document.body, { key: "ArrowLeft" });
      expect(onCommit).toHaveBeenCalledOnce();
      expect(press(document.body, "ArrowLeft")).toBe(false);
      expect(second!.getAttribute("aria-valuenow")).toBe("119");
      fireEvent.pointerEnter(first!, { pointerType: "touch" });
      expect(press(document.body, "ArrowLeft")).toBe(false);
      fireEvent.pointerEnter(first!, { pointerType: "pen" });
      expect(press(document.body, "ArrowLeft")).toBe(false);
      expect(first!.getAttribute("aria-valuenow")).toBe("36");
    });

    it("leaves the keys to an input field, a control with keys of its own, an open popup or a dialog", () => {
      const onCommit = vi.fn();
      renderRow({ modelChain: sampleChain, onCommit });
      const first = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
      fireEvent.pointerEnter(first, { pointerType: "mouse" });
      const outside = document.createElement("div");
      document.body.append(outside);
      try {
        for (const html of [
          '<input type="search" id="focus">',
          '<textarea id="focus"></textarea>',
          '<select id="focus"><option>a</option></select>',
          '<div contenteditable="true" id="focus" tabindex="0"></div>',
          '<div role="slider" tabindex="0" id="focus"></div>',
          '<ul role="listbox"><li role="option" tabindex="0" id="focus">a</li></ul>',
          '<button aria-expanded="true" id="focus">Open</button>',
          '<div role="dialog"><button id="focus">In a popup</button></div>',
        ]) {
          outside.innerHTML = html;
          const field = outside.querySelector<HTMLElement>("#focus")!;
          field.focus();
          expect(document.activeElement, html).toBe(field);
          expect(press(field, "ArrowLeft"), html).toBe(false);
          expect(first.getAttribute("aria-valuenow"), html).toBe("36");
        }
        // An open modal dialog keeps them although the focus is elsewhere.
        outside.innerHTML = '<div aria-modal="true" role="dialog"></div><button id="focus">Behind</button>';
        outside.querySelector<HTMLElement>("#focus")!.focus();
        expect(press(document.activeElement!, "ArrowLeft")).toBe(false);
        expect(first.getAttribute("aria-valuenow")).toBe("36");
        // A plain button with the focus (e.g. clicked before) leaves them to the boundary.
        outside.innerHTML = '<button id="focus">Plain</button>';
        const plain = outside.querySelector<HTMLElement>("#focus")!;
        plain.focus();
        expect(press(plain, "ArrowLeft")).toBe(true);
        expect(first.getAttribute("aria-valuenow")).toBe("35");
        expect(onCommit).toHaveBeenCalledOnce();
      } finally {
        outside.remove();
      }
    });

    it("with the focus on a boundary the keys move only that one, as before", () => {
      const onCommit = vi.fn();
      renderRow({ modelChain: sampleChain, onCommit });
      const [first, second] = screen.getAllByRole("slider");
      fireEvent.pointerEnter(second!, { pointerType: "mouse" });
      first!.focus();
      expect(press(first!, "ArrowLeft")).toBe(true);
      expect(first!.getAttribute("aria-valuenow")).toBe("35");
      expect(second!.getAttribute("aria-valuenow")).toBe("120");
      expect(onCommit).toHaveBeenCalledOnce();
    });
  });

  it("keeps the moved chain until a new chain comes; a new chain from outside replaces it", () => {
    let current: WeatherModel[] = [...fullChain];
    const { rerender } = renderRow({ modelChain: current, onCommit: (chain) => (current = chain) });
    const handle = screen.getByRole("slider", { name: "Boundary between ICON-EU and GFS" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(current[1]!.max_forecast_horizon_hours).toBe(82);
    expect(range("ICON-EU")).toBe("48–82 h (34 h)");

    rerender({ modelChain: current });
    expect(range("ICON-EU")).toBe("48–82 h (34 h)");
    // E.g. another place: its chain, the move is gone.
    rerender({ modelChain: fullChain.map((m) => ({ ...m })) });
    expect(range("ICON-EU")).toBe("48–120 h (72 h)");
  });

  it("dragging the rear boundary leaves the front card and boundary where they are, also afterwards (REQ-610)", () => {
    const chain: WeatherModel[] = [
      { name: "ICON-D2", max_forecast_horizon_hours: 12 },
      { name: "ICON-EU", max_forecast_horizon_hours: 27 },
      { name: "GFS", max_forecast_horizon_hours: 240 },
    ];
    let current = chain;
    const { rerender } = renderRow({ modelChain: current, onCommit: (next) => (current = next) });
    const front = width("model-card-ICON-D2");
    const total = () => ["ICON-D2", "ICON-EU", "GFS"].reduce((sum, name) => sum + width(`model-card-${name}`), 0);
    const handle = screen.getByRole("slider", { name: "Boundary between ICON-EU and GFS" });
    const euBefore = width("model-card-ICON-EU");

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400, button: 0 });
    for (const x of [420, 450, 500]) {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: x });
      expect(width("model-card-ICON-D2")).toBe(front);
      expect(total()).toBeCloseTo(100, 6);
      // While the meteogram follows the drag the website hands in the same chain as a new object: nothing changes.
      rerender({ modelChain: current.map((model) => ({ ...model })), onCommit: (next) => (current = next) });
      expect(width("model-card-ICON-D2")).toBe(front);
    }
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(current[1]!.max_forecast_horizon_hours).toBeGreaterThan(27);
    expect(width("model-card-ICON-EU")).toBeGreaterThan(euBefore);
    // The chain handed on comes back from outside (with a new catalogue object, as on the website): still in place.
    rerender({ modelChain: current, onCommit: (next) => (current = next), availableModels: { ...MODELS } });
    expect(width("model-card-ICON-D2")).toBe(front);
    // With the keys too.
    const moved = width("model-card-ICON-EU");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyUp(handle, { key: "ArrowRight" });
    rerender({ modelChain: current, onCommit: (next) => (current = next) });
    expect(width("model-card-ICON-D2")).toBe(front);
    expect(width("model-card-ICON-EU")).toBeGreaterThan(moved);
    // The same chain again as a new object (as while the meteogram follows a drag of the other chain): no change.
    const shown = ["ICON-D2", "ICON-EU", "GFS"].map((name) => width(`model-card-${name}`));
    rerender({ modelChain: current.map((model) => ({ ...model })), availableModels: { ...MODELS } });
    expect(["ICON-D2", "ICON-EU", "GFS"].map((name) => width(`model-card-${name}`))).toEqual(shown);

    // Another chain from outside (e.g. another place) gets the default layout again.
    rerender({ modelChain: fullChain.map((model) => ({ ...model })) });
    for (const name of ["ICON-D2", "ICON-EU", "GFS"]) expect(width(`model-card-${name}`)).toBeCloseTo(100 / 3, 6);
  });

  it("resizes two adjacent models to 0h and leaves both at 1/3 size with remainder given to third model", () => {
    let currentChain: WeatherModel[] = [...fullChain];
    const onCommit = (newChain: WeatherModel[]) => {
      currentChain = newChain;
    };
    const { rerender } = renderRow({ modelChain: currentChain, onCommit });

    // 1. Drag boundary between ICON-D2 and ICON-EU to 0h
    const handle0 = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    fireEvent.pointerDown(handle0, { pointerId: 1, clientX: 300, button: 0 });
    fireEvent.pointerMove(handle0, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(handle0, { pointerId: 1 });
    rerender({ modelChain: currentChain, onCommit });
    expect(currentChain[0]!.max_forecast_horizon_hours).toBe(0);

    // 2. Drag boundary between ICON-EU and GFS to 0h
    const handle1 = screen.getByRole("slider", { name: "Boundary between ICON-EU and GFS" });
    fireEvent.pointerDown(handle1, { pointerId: 2, clientX: 600, button: 0 });
    fireEvent.pointerMove(handle1, { pointerId: 2, clientX: 100 });
    fireEvent.pointerUp(handle1, { pointerId: 2 });
    rerender({ modelChain: currentChain, onCommit });

    expect(currentChain[0]!.max_forecast_horizon_hours).toBe(0);
    expect(currentChain[1]!.max_forecast_horizon_hours).toBe(0);
    // Both 0-hour models must be at 1/3 baseline size (11.11%)
    expect(width("model-card-ICON-D2")).toBeCloseTo(11.111, 1);
    expect(width("model-card-ICON-EU")).toBeCloseTo(11.111, 1);
    // GFS receives all freed width (77.78%)
    expect(width("model-card-GFS")).toBeCloseTo(77.778, 1);
  });

  it("limits a boundary to the hours given in limits", () => {
    renderRow({
      modelChain: fullChain,
      limits: { ...MODELS, icon_d2: { ...MODELS.icon_d2!, max_forecast_horizon_hours: 40 } },
    });
    const first = screen.getByRole("slider", { name: "Boundary between ICON-D2 and ICON-EU" });
    expect(first.getAttribute("aria-valuemax")).toBe("40");
  });

  it("shows the delivered spans, and the planned ones while a boundary moves", () => {
    renderRow({
      modelChain: fullChain,
      spans: { "ICON-D2": { start: 0, end: 30 }, "ICON-EU": { start: 30, end: 120 } },
      showTotalHours: false,
    });
    expect(range("ICON-D2")).toBe("0–30 h");
    expect(screen.getByTestId("model-range-GFS").textContent).toBe("No data");
    fireEvent.keyDown(screen.getAllByRole("slider")[0]!, { key: "ArrowLeft" });
    expect(range("ICON-D2")).toBe("0–47 h");
    expect(screen.getByTestId("model-range-ICON-D2").getAttribute("data-span")).toBe("planned");
  });

  it("says 0 h instead of No data on a phone, the title still names the planned slice (REQ-609)", () => {
    const phone = "(pointer: coarse) and (max-width: 30rem)";
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: query.includes(phone),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      renderRow({
        modelChain: fullChain,
        spans: { "ICON-D2": { start: 0, end: 30 }, "ICON-EU": { start: 30, end: 120 } },
        showTotalHours: false,
      });
      const empty = screen.getByTestId("model-range-GFS");
      expect(empty.textContent).toBe("0 h");
      expect(empty.getAttribute("data-span")).toBe("none");
      const title = screen.getByTestId("model-card-GFS").getAttribute("title");
      expect(title).toMatch(/^GFS.*: no data \(planned \d+–\d+ h\)$/);
      expect(range("ICON-D2")).toBe("0–30 h");
    } finally {
      window.matchMedia = original;
    }
  });

  it("renders total hours in brackets when showTotalHours is true (default)", () => {
    renderRow({ modelChain: sampleChain });
    expect(screen.getByText("0–36 h (36 h)")).toBeTruthy();
    expect(screen.getByText("36–120 h (84 h)")).toBeTruthy();
    expect(screen.getByText("120–384 h (264 h)")).toBeTruthy();
  });

  it("omits total hours in brackets when showTotalHours is false", () => {
    renderRow({ modelChain: sampleChain, showTotalHours: false });
    expect(screen.getByText("0–36 h")).toBeTruthy();
    expect(screen.getByText("36–120 h")).toBeTruthy();
    expect(screen.getByText("120–384 h")).toBeTruthy();
  });

  it("renders vertical border label and adds the labelled class when borderLabel is provided", () => {
    const { container } = renderRow({ modelChain: sampleChain, borderLabel: "Weather" });
    expect(screen.getByTestId("border-label").textContent).toBe("Weather");
    expect(container.querySelector(".model-chain-row")?.classList.contains("model-chain-row--labelled")).toBe(true);
    expect(screen.getByRole("group", { name: "Weather" })).toBeTruthy();
  });

  it("shows a message for an empty chain", () => {
    renderRow({ modelChain: [], borderLabel: "Clouds", emptyMessage: "No cloud chain." });
    expect(screen.getByTestId("empty-model-chain").textContent).toBe("No cloud chain.");
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

describe("ModelSegment info popover", () => {
  const renderSegment = () => {
    const model: WeatherModel = { id: "ecmwf_ifs", name: "ECMWF IFS", max_forecast_horizon_hours: 240 };
    render(
      wrap(
        <ModelSegment
          segment={{
            model,
            index: 0,
            startHour: 0,
            endHour: 240,
            duration: 240,
            widthPct: 100,
            minWidthPct: 100,
            maxCapableHorizon: 360,
            minAllowedHorizon: 0,
            maxAllowedHorizon: 360,
          }}
          meta={{
            ...model,
            max_forecast_horizon_hours: 360,
            provider: "ECMWF",
            region: "Global",
            spatial_resolution_km: 9,
            temporal_resolution_hours: 1,
          }}
          shade={{ color: "#000000", text: "#ffffff" }}
          activeTooltip="ecmwf_ifs"
          onToggleTooltip={() => {}}
        />,
      ),
    );
    return screen.getByTestId("model-info-popover");
  };

  it("shows name, provider, coverage and the catalogue specs, without a time step (REQ-687)", () => {
    const popover = renderSegment();
    expect(popover.textContent).toContain("ECMWF IFS (ECMWF, Global)");
    expect(within(popover).getByText("Grid spacing").nextElementSibling?.textContent).toBe("9 km");
    // All models deliver hourly values: no time step (REQ-687).
    expect(within(popover).queryByText("Time step")).toBeNull();
    // Without a loaded forecast: the forecast length of the catalogue, no runs, no explanation.
    expect(within(popover).getByText("Forecast length").nextElementSibling?.textContent).toBe("360 h");
    expect(within(popover).queryByTestId("model-info-main-runs")).toBeNull();
    expect(within(popover).queryByTestId("model-info-explanation")).toBeNull();
    expect(screen.getByRole("button", { name: "Details for ECMWF IFS" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shifts left to stay inside the window", () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1000 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 900,
      right: 1220,
      width: 320,
    } as DOMRect);
    const popover = renderSegment();
    expect(popover.style.transform).toBe("translateX(calc(-50% + -228px))");
  });

  it("prefers the left edge when the window is too narrow", () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 300 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 420,
      width: 320,
    } as DOMRect);
    const popover = renderSegment();
    expect(popover.style.transform).toBe("translateX(calc(-50% + -92px))");
  });
});

// REQ-463: the info popover closes on a press outside it and on Escape (focus back to its button).
describe("ModelSegment info popover closing", () => {
  const chain: WeatherModel[] = [
    { name: "ICON-D2", max_forecast_horizon_hours: 48 },
    { name: "ICON-EU", max_forecast_horizon_hours: 120 },
  ];
  const infoButton = (name: string) => screen.getByRole("button", { name: `Details for ${name}` });

  it("closes when the user presses outside the popover", () => {
    renderRow({ modelChain: chain });
    fireEvent.click(infoButton("ICON-D2"));
    const popover = screen.getByTestId("model-info-popover");
    // A press inside the popover keeps it open.
    fireEvent.pointerDown(popover);
    expect(screen.getByTestId("model-info-popover")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
    expect(infoButton("ICON-D2").getAttribute("aria-expanded")).toBe("false");
  });

  it("switches to another card's popover with one click", () => {
    renderRow({ modelChain: chain });
    fireEvent.click(infoButton("ICON-D2"));
    const other = infoButton("ICON-EU");
    fireEvent.pointerDown(other);
    fireEvent.click(other);
    const popovers = screen.getAllByTestId("model-info-popover");
    expect(popovers).toHaveLength(1);
    expect(popovers[0]!.textContent).toContain("ICON-EU");
  });

  it("still toggles closed with its own button", () => {
    renderRow({ modelChain: chain });
    const button = infoButton("ICON-D2");
    fireEvent.click(button);
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
  });

  it("closes on Escape and returns the focus to its button", () => {
    renderRow({ modelChain: chain });
    fireEvent.click(infoButton("ICON-D2"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
    expect(document.activeElement).toBe(infoButton("ICON-D2"));
  });
});
