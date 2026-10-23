import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeteogramConfig } from "../../types";
import { apiService } from "../../services/apiService";
import {
  chooseChartLayout,
  DEFAULT_LAYOUT_ID,
} from "../../layouts/layoutLibrary.logic";
import type { ChartLayout } from "../../layouts/types";
import { MeteogramLayoutsPanel } from "./MeteogramLayoutsPanel";

const configs: MeteogramConfig[] = [
  {
    id: "cfg-1",
    name: "Alpen",
    location: { name: "Innsbruck", latitude: 47.26, longitude: 11.39 },
    model_chain: [],
    layout_id: null,
  },
];

async function renderPanel(
  props: Partial<React.ComponentProps<typeof MeteogramLayoutsPanel>> = {},
) {
  const onLayoutsUpdated = vi.fn();
  render(
    <MeteogramLayoutsPanel
      configs={configs}
      onLayoutsUpdated={onLayoutsUpdated}
      {...props}
    />,
  );
  await waitFor(() => {
    expect(screen.getByTestId("layout-list")).toBeTruthy();
  });
  return { onLayoutsUpdated };
}

const titles = () =>
  Array.from(document.querySelectorAll(".config-item-title")).map(
    (el) => el.textContent,
  );

describe("MeteogramLayoutsPanel (spec §4.3)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.pywebview;
    vi.restoreAllMocks();
  });

  it("lists Default first and protects it", async () => {
    await renderPanel();
    expect(titles()).toEqual(["Default", "Power default"]);
    const del = screen.getByRole("button", {
      name: "Delete selected meteogram configuration",
    }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    const name = screen.getByLabelText(
      "Meteogram configuration name",
    ) as HTMLInputElement;
    expect(name.disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: /Reset to default/ }),
    ).toBeTruthy();
  });

  it("creates, renames and deletes layouts", async () => {
    const { onLayoutsUpdated } = await renderPanel();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create new meteogram configuration",
      }),
    );
    await waitFor(() => {
      expect(titles()).toEqual([
        "Default",
        "New layout 1",
        "Power default",
      ]);
    });
    expect(onLayoutsUpdated).toHaveBeenCalled();

    const name = screen.getByLabelText("Meteogram configuration name");
    fireEvent.change(name, { target: { value: "Winter" } });
    fireEvent.blur(name);
    await waitFor(() => {
      expect(titles()).toContain("Winter");
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete selected meteogram configuration",
      }),
    );
    await waitFor(() => {
      expect(titles()).toEqual(["Default", "Power default"]);
    });
  });

  it("has no global layout and no per-configuration list (#199, #203)", async () => {
    await renderPanel();
    expect(screen.queryByTestId("layout-config-table")).toBeNull();
    expect(
      screen.queryByLabelText("Meteogram configuration for Alpen"),
    ).toBeNull();
    for (const id of [DEFAULT_LAYOUT_ID, "power-default"]) {
      fireEvent.click(screen.getByTestId(`layout-item-${id}`));
      expect(
        screen.queryByRole("button", { name: /global layout/ }),
      ).toBeNull();
    }
    expect(
      screen.getByTestId(`layout-item-${DEFAULT_LAYOUT_ID}`).textContent,
    ).toContain("configurations without a layout");
  });

  it("shows a warning for an invalid stored layout", async () => {
    const [normal, power] = await apiService.getLayouts();
    vi.spyOn(apiService, "getLayouts").mockResolvedValue([
      { ...normal, error: "invalid layout: areas" },
      power,
    ]);
    await renderPanel();
    expect(screen.getByRole("alert").textContent).toContain(
      "invalid layout: areas",
    );
  });

  describe("layout editor (#142)", () => {
    const storedLayout = async (id: string) =>
      (await apiService.getLayouts()).find((entry) => entry.id === id)
        ?.layout as ChartLayout;

    it("saves edits after the debounce and reports the save", async () => {
      const onSaveStatusChange = vi.fn();
      const { onLayoutsUpdated } = await renderPanel({ onSaveStatusChange });
      fireEvent.click(screen.getByTestId("layout-item-power-default"));
      fireEvent.change(screen.getByLabelText("wind height"), {
        target: { value: "2" },
      });
      expect(onSaveStatusChange).toHaveBeenLastCalledWith("saving", null);
      await waitFor(async () => {
        const layout = await storedLayout("power-default");
        expect(layout.areas.find((a) => a.id === "wind")?.heightWeight).toBe(2);
      });
      expect(onSaveStatusChange).toHaveBeenLastCalledWith("saved", null);
      expect(onLayoutsUpdated).toHaveBeenCalled();
    });

    it("adds, moves and removes areas and series", async () => {
      await renderPanel();
      fireEvent.click(screen.getByTestId("layout-item-power-default"));
      fireEvent.click(screen.getByRole("button", { name: /Add area/ }));
      fireEvent.click(
        screen.getByRole("button", { name: "Move area area-1 up" }),
      );
      fireEvent.change(screen.getByLabelText("area-1 series 1 quantity"), {
        target: { value: "wind_direction" },
      });
      expect(
        (screen.getByLabelText("area-1 series 1 style") as HTMLSelectElement)
          .value,
      ).toBe("arrows");
      fireEvent.click(screen.getByRole("button", { name: "Remove area temp" }));
      await waitFor(async () => {
        const layout = await storedLayout("power-default");
        expect(layout.areas.map((a) => a.id)).toEqual([
          "precip",
          "wind",
          "area-1",
          "convective",
        ]);
        expect(layout.areas[2].series?.[0]).toMatchObject({
          quantity: "wind_direction",
          style: "arrows",
        });
      });
    });

    it("rejects an invalid edit with a message and keeps the stored layout", async () => {
      const onSaveStatusChange = vi.fn();
      await renderPanel({ onSaveStatusChange });
      fireEvent.click(screen.getByTestId("layout-item-power-default"));
      fireEvent.change(screen.getByLabelText("temp left axis range"), {
        target: { value: "fixed" },
      });
      fireEvent.change(screen.getByLabelText("temp left axis maximum"), {
        target: { value: "-5" },
      });
      expect(screen.getByTestId("layout-edit-error").textContent).toContain(
        "fixed axis range needs min < max",
      );
      await new Promise((resolve) => setTimeout(resolve, 800));
      const layout = await storedLayout("power-default");
      expect(layout.areas[0].axes?.left?.range).toBe("auto");
      expect(onSaveStatusChange).not.toHaveBeenCalledWith("saved", null);
    });

    it("shows a backend rejection", async () => {
      vi.spyOn(apiService, "updateLayout").mockRejectedValue(
        new Error("invalid layout at areas: nope"),
      );
      const onSaveStatusChange = vi.fn();
      await renderPanel({ onSaveStatusChange });
      fireEvent.click(screen.getByLabelText("Day header"));
      await waitFor(() => {
        expect(screen.getByTestId("layout-edit-error").textContent).toContain(
          "nope",
        );
      });
      expect(onSaveStatusChange).toHaveBeenLastCalledWith(
        "error",
        "Could not save meteogram configuration.",
      );
    });

    it("updates the preview with every edit", async () => {
      const renderPreview = vi.fn((layout: ChartLayout, fallback: string) => (
        <div data-testid="preview-probe">
          {fallback}:{layout.areas.map((a) => a.id).join(",")}
        </div>
      ));
      await renderPanel({ renderPreview });
      expect(screen.getByTestId("preview-probe").textContent).toBe(
        "normal-default:temp,precip,wind",
      );
      fireEvent.click(screen.getByRole("button", { name: "Remove area wind" }));
      expect(screen.getByTestId("preview-probe").textContent).toBe(
        "normal-default:temp,precip",
      );
    });

    it("edits of the Default entry reach normal mode", async () => {
      await renderPanel();
      fireEvent.click(screen.getByLabelText(/Model headers and boundaries/));
      await waitFor(async () => {
        const layout = await storedLayout(DEFAULT_LAYOUT_ID);
        expect(layout.showModelHeaders).toBe(true);
      });
      const choice = chooseChartLayout(
        await apiService.getLayouts(),
        "normal",
        null,
      );
      expect((choice.chartLayout as ChartLayout).showModelHeaders).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: /Reset to default/ }));
      await waitFor(async () => {
        const layout = await storedLayout(DEFAULT_LAYOUT_ID);
        expect(layout.showModelHeaders).toBe(false);
      });
      expect(
        (
          screen.getByLabelText(
            /Model headers and boundaries/,
          ) as HTMLInputElement
        ).checked,
      ).toBe(false);
    });
  });
});
