// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A map module that cannot be loaded (offline, an outdated chunk) is a map that does not load (REQ-771): the map dialog
 * shows its error card as before (REQ-492). Both map modules fail to load here.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { ConfigProvider, DEFAULT_CONFIG } from "../src/config/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { MapDialog } from "../src/regions/LocationPicker/MapDialog.tsx";
import { setMapProvider } from "../src/state/index.ts";

vi.mock("../src/regions/LocationPicker/map/MaptoolkitMap.tsx", () => {
  throw new Error("Failed to fetch dynamically imported module");
});
vi.mock("../src/regions/LocationPicker/map/LeafletMap.tsx", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
  cleanup();
  setMapProvider(null);
  vi.restoreAllMocks();
});

for (const map of ["maptoolkit", "opentopomap"] as const) {
  it(`${map}: shows the card when the map module cannot be loaded (REQ-771)`, async () => {
    // React reports the error the boundary caught.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ConfigProvider config={{ ...DEFAULT_CONFIG, map }}>
        <I18nProvider browserLanguages={["en"]}>
          <NoticesProvider>
            <MapDialog place={{ name: "Ortler", lat: 46.5086, lon: 10.5447 }} onClose={() => {}} onAccept={() => {}} />
          </NoticesProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("error-card").textContent).toBe("The map could not be loaded. Check your connection."),
    );
  });
}
