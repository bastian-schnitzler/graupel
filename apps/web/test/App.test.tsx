// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";
import { AppLayout } from "../src/layout/index.ts";
import { resetModelChainView, setModelChainVisible } from "../src/state/index.ts";

const REGIONS = ["location", "header", "model-chain", "day-slider", "meteogram", "footer"];

// The model chain shown, as after switching it on in the settings (hidden by default, REQ-445).
beforeEach(() => setModelChainVisible(true));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetModelChainView();
});

describe("App", () => {
  it("renders all regions in page order", () => {
    const { container } = render(<App />);
    const order = [...container.querySelectorAll("[data-region]")].map((el) => el.getAttribute("data-region"));
    expect(order).toEqual(REGIONS);
  });

  it("has no model chain card while the chain is switched off (REQ-471)", () => {
    setModelChainVisible(false);
    const { container } = render(<App />);
    const order = [...container.querySelectorAll("[data-region]")].map((el) => el.getAttribute("data-region"));
    expect(order).toEqual(REGIONS.filter((region) => region !== "model-chain"));
    expect(container.querySelector(".model-chain")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Model chain" })).toBeNull();
  });

  it("exposes landmarks and a page heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Graupel" })).toBeTruthy();
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Location" })).toBeTruthy();
  });

  it("places model chain, day slider and meteogram inside main", () => {
    render(<App />);
    const main = screen.getByRole("main");
    const inMain = [...main.querySelectorAll("[data-region]")].map((el) => el.getAttribute("data-region"));
    expect(inMain).toEqual(["model-chain", "day-slider", "meteogram"]);
  });
});

describe("AppLayout", () => {
  it("leaves out empty slots", () => {
    const { container } = render(<AppLayout location={<p>loc</p>} meteogram={<p>chart</p>} />);
    expect(container.querySelector(".app__location")?.textContent).toBe("loc");
    expect(container.querySelector(".app__header")).toBeNull();
    expect(container.querySelector(".app__footer")).toBeNull();
    expect(container.querySelector(".app__main")?.textContent).toBe("chart");
  });

  it("puts location and header into one top card (REQ-450), left out when both are empty", () => {
    const { container, rerender } = render(<AppLayout location={<p>loc</p>} header={<p>head</p>} />);
    const top = container.querySelector(".app__top");
    expect([...(top?.children ?? [])].map((child) => child.className)).toEqual(["app__location", "app__header"]);
    rerender(<AppLayout meteogram={<p>chart</p>} />);
    expect(container.querySelector(".app__top")).toBeNull();
  });

  it("drops the page's top margin only when asked to, as on a phone in the browser (REQ-586)", () => {
    const flush = (element: Element | null) => element?.classList.contains("app__inner--flush-top");
    const { container, rerender } = render(<AppLayout location={<p>loc</p>} />);
    expect(flush(container.querySelector(".app__inner"))).toBe(false);
    rerender(<AppLayout location={<p>loc</p>} flushTop />);
    expect(flush(container.querySelector(".app__inner"))).toBe(true);
  });
});
