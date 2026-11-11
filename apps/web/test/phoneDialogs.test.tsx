// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Dialogs on a phone: the model info opens as a dialog as big as the settings, its title in the heading row and the
 * close button at the top right (REQ-719); while any dialog is open the page behind does not scroll (REQ-730).
 */
import type { WeatherModel } from "@graupel/download";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dialog } from "../src/dialogs/Dialog.tsx";
import { I18nProvider } from "../src/i18n/index.ts";
import { ModelInfoButton } from "../src/regions/ModelChain/chain/ModelInfo.tsx";
import {
  DIALOG_GUTTER_CLASS,
  DIALOG_OPEN_CLASS,
  PHONE_QUERY,
  isPageScrollLocked,
  lockPageScroll,
  type ModelMeta,
} from "../src/state/index.ts";

let phone = true;
const original = window.matchMedia;

beforeEach(() => {
  phone = true;
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: query === PHONE_QUERY && phone,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.matchMedia = original;
  document.documentElement.className = "";
});

const ICON_EU: ModelMeta = {
  id: "icon_eu",
  name: "ICON-EU",
  max_forecast_horizon_hours: 120,
  provider: "DWD",
  region: "Europe",
  spatial_resolution_km: 7,
  documentation_url: "https://www.dwd.de/icon",
  provider_url: "https://www.dwd.de",
};
const MODEL: WeatherModel = { name: "icon_eu", max_forecast_horizon_hours: 120 };

function wrap(ui: ReactElement) {
  return <I18nProvider browserLanguages={["en"]}>{ui}</I18nProvider>;
}

/** An info button as the chain card has it, opening and closing by itself. */
function InfoButton() {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="card">
      <ModelInfoButton
        className="model-card__info"
        meta={ICON_EU}
        model={MODEL}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      />
    </div>
  );
}

describe("model info on a phone (REQ-719)", () => {
  it("opens a dialog as tall as the settings, outside the card, with the title in the heading row", () => {
    render(wrap(<InfoButton />));
    const button = screen.getByRole("button", { name: "Details for ICON-EU" });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(button);
    const dialog = screen.getByTestId("model-info-popover");
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog.classList.contains("dialog--tall")).toBe(true);
    expect(dialog.classList.contains("model-info-dialog")).toBe(true);
    // Placed in the body, not inside the card.
    expect(screen.getByTestId("card").contains(dialog)).toBe(false);
    // The title "model (publisher, coverage)" with its links is the heading; the body has it no second time.
    const heading = within(dialog).getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("ICON-EU (DWD, Europe)");
    expect(within(heading).getAllByRole("link")).toHaveLength(2);
    expect(within(dialog).getAllByTestId("model-info-title")).toHaveLength(1);
    expect(within(dialog).getByTestId("model-info-specs")).toBeTruthy();
    // The dialog is named by its heading.
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("has the close button in the heading row after the title, which closes it and gives the focus back", () => {
    render(wrap(<InfoButton />));
    const button = screen.getByRole("button", { name: "Details for ICON-EU" });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByTestId("model-info-popover");
    const header = dialog.querySelector(".dialog__header")!;
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(header.lastElementChild).toBe(close);
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape, and a press inside does not close it", () => {
    render(wrap(<InfoButton />));
    fireEvent.click(screen.getByRole("button", { name: "Details for ICON-EU" }));
    const dialog = screen.getByTestId("model-info-popover");
    fireEvent.pointerDown(within(dialog).getByTestId("model-info-specs"));
    expect(screen.getByTestId("model-info-popover")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("model-info-popover")).toBeNull();
  });

  it("stays the popover below the button on a larger screen", () => {
    phone = false;
    render(wrap(<InfoButton />));
    const button = screen.getByRole("button", { name: "Details for ICON-EU" });
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    fireEvent.click(button);
    const popover = screen.getByTestId("model-info-popover");
    expect(popover.tagName).toBe("DIV");
    expect(popover.classList.contains("model-info")).toBe(true);
    expect(screen.getByTestId("card").contains(popover)).toBe(true);
    expect(within(popover).getByTestId("model-info-title").textContent).toBe("ICON-EU (DWD, Europe)");
  });
});

describe("scroll lock behind a dialog (REQ-730)", () => {
  it("marks the root element while locked and lets go with the last lock", () => {
    expect(isPageScrollLocked()).toBe(false);
    const first = lockPageScroll();
    const second = lockPageScroll();
    expect(document.documentElement.classList.contains(DIALOG_OPEN_CLASS)).toBe(true);
    first();
    // Releasing the same lock twice does not end the other one.
    first();
    expect(isPageScrollLocked()).toBe(true);
    second();
    expect(isPageScrollLocked()).toBe(false);
  });

  it("keeps the room of a scroll bar the page showed", () => {
    const width = Object.getOwnPropertyDescriptor(window, "innerWidth")!;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1265 });
      const release = lockPageScroll();
      expect(document.documentElement.classList.contains(DIALOG_GUTTER_CLASS)).toBe(true);
      release();
      expect(document.documentElement.classList.contains(DIALOG_GUTTER_CLASS)).toBe(false);
      Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1280 });
      const again = lockPageScroll();
      expect(document.documentElement.classList.contains(DIALOG_GUTTER_CLASS)).toBe(false);
      again();
    } finally {
      Object.defineProperty(window, "innerWidth", width);
      delete (document.documentElement as unknown as { clientWidth?: number }).clientWidth;
    }
  });

  it("locks the page while any dialog is open, also one opened from inside another", () => {
    function Dialogs() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return outer ? (
        <Dialog title="Settings" onClose={() => setOuter(false)}>
          <button type="button" onClick={() => setInner(true)}>
            More
          </button>
          {inner && (
            <Dialog title="Licences" onClose={() => setInner(false)}>
              text
            </Dialog>
          )}
        </Dialog>
      ) : null;
    }
    render(wrap(<Dialogs />));
    expect(isPageScrollLocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const closes = screen.getAllByRole("button", { name: "Close" });
    expect(closes).toHaveLength(2);
    // Closing the inner one keeps the lock of the outer one.
    fireEvent.click(closes[1]!);
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    expect(isPageScrollLocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(isPageScrollLocked()).toBe(false);
  });
});
