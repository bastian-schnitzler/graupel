// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { Dialog } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { createNoticeStore, useErrorNotice, type NoticeStore } from "../src/state/index.ts";

afterEach(cleanup);

describe("notice store (REQ-492)", () => {
  it("adds, replaces by id and dismisses", () => {
    const store = createNoticeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.notify({ id: "a", message: "forecast.error" });
    store.notify({ id: "b", message: "modelChain.error" });
    expect(store.getNotices().map((notice) => notice.id)).toEqual(["a", "b"]);
    store.notify({ id: "a", message: "location.gps.denied" });
    expect(store.getNotices()).toEqual([
      { id: "a", message: "location.gps.denied" },
      { id: "b", message: "modelChain.error" },
    ]);
    store.dismiss("a");
    store.dismiss("unknown");
    expect(store.getNotices()).toEqual([{ id: "b", message: "modelChain.error" }]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("does not show the same message twice", () => {
    const store = createNoticeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.notify({ id: "a", message: "forecast.error" });
    store.notify({ id: "a", message: "forecast.error" });
    store.notify({ id: "b", message: "forecast.error" });
    expect(store.getNotices()).toEqual([{ id: "a", message: "forecast.error" }]);
    expect(listener).toHaveBeenCalledTimes(1);
    store.notify({ id: "b", message: "forecast.error", params: { n: 1 } });
    expect(store.getNotices()).toHaveLength(2);
  });

  it("uses the topmost registered dialog as host", () => {
    const store = createNoticeStore();
    const first = document.createElement("dialog");
    const second = document.createElement("dialog");
    expect(store.getHost()).toBeNull();
    const removeFirst = store.addHost(first);
    const removeSecond = store.addHost(second);
    expect(store.getHost()).toBe(second);
    removeSecond();
    expect(store.getHost()).toBe(first);
    removeFirst();
    removeFirst();
    expect(store.getHost()).toBeNull();
  });
});

describe("error cards (REQ-492)", () => {
  function renderCards(store: NoticeStore, language = "en", children?: ReactNode) {
    return render(
      <I18nProvider browserLanguages={[language]}>
        <NoticesProvider store={store}>{children}</NoticesProvider>
      </I18nProvider>,
    );
  }

  it("renders nothing without messages", () => {
    renderCards(createNoticeStore());
    expect(screen.queryByTestId("error-cards")).toBeNull();
  });

  it("stacks the messages as alerts, each closed by its button", () => {
    const store = createNoticeStore();
    renderCards(store, "de");
    act(() => {
      store.notify({ id: "a", message: "forecast.error" });
      store.notify({ id: "b", message: "location.gps.unavailable" });
    });
    const region = screen.getByRole("region", { name: "Meldungen" });
    const cards = within(region).getAllByRole("alert");
    expect(cards.map((card) => card.textContent)).toEqual([
      "Die Vorhersage konnte nicht geladen werden.",
      "Der Standort konnte nicht ermittelt werden.",
    ]);
    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Meldung schließen" }));
    expect(screen.getAllByRole("alert").map((card) => card.textContent)).toEqual([
      "Der Standort konnte nicht ermittelt werden.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Meldung schließen" }));
    expect(screen.queryByTestId("error-cards")).toBeNull();
  });

  it("shows a hook's message while it is set and takes it back when cleared or unmounted", () => {
    let setFailed: (failed: boolean) => void = () => {};
    function Reporter() {
      const [failed, set] = useState(true);
      setFailed = set;
      useErrorNotice("test", failed ? "forecast.error" : null);
      return null;
    }
    const store = createNoticeStore();
    const view = renderCards(store, "en", <Reporter />);
    expect(screen.getByRole("alert").textContent).toBe("The forecast could not be loaded.");
    act(() => setFailed(false));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => setFailed(true));
    expect(screen.getByRole("alert")).toBeTruthy();
    view.rerender(
      <I18nProvider browserLanguages={["en"]}>
        <NoticesProvider store={store} />
      </I18nProvider>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders inside an open modal dialog and back in the page when it closes", () => {
    const store = createNoticeStore();
    let setOpen: (open: boolean) => void = () => {};
    function Host() {
      const [open, set] = useState(true);
      setOpen = set;
      return open ? <Dialog title="Box" onClose={() => set(false)} /> : null;
    }
    renderCards(store, "en", <Host />);
    act(() => store.notify({ id: "a", message: "forecast.error" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
    act(() => setOpen(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("The forecast could not be loaded.");
  });
});
