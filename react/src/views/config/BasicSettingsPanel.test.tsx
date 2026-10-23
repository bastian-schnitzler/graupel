import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../types";
import { BasicSettingsPanel } from "./BasicSettingsPanel";

function installBridge(initial: Partial<AppSettings> = {}) {
  let settings: AppSettings = {
    mode: "power",
    archive_enabled: true,
    archive_retention_days: 30,
    ...initial,
  };
  let dataDir = "/home/me/.graupel";
  const api = {
    get_settings: vi.fn(async () => settings),
    update_settings: vi.fn(async (changes: Partial<AppSettings>) => {
      settings = { ...settings, ...changes };
      return settings;
    }),
    get_data_dir: vi.fn(async () => ({
      data_dir: dataDir,
      default_data_dir: "/home/me/.graupel",
      is_default: dataDir === "/home/me/.graupel",
    })),
    choose_data_dir: vi.fn(async () => "/mnt/usb/graupel"),
    change_data_dir: vi.fn(async (path: string) => {
      const previous = dataDir;
      dataDir = path;
      return { data_dir: path, previous_data_dir: previous };
    }),
    get_archive_stats: vi.fn(async () => ({ fetches: 3, bytes: 3 * 1024 })),
    delete_archive: vi.fn(async () => ({ success: true })),
    open_data_dir: vi.fn(
      async (): Promise<{ ok: boolean; error: string | null }> => ({
        ok: true,
        error: null,
      }),
    ),
  };
  window.pywebview = { api } as unknown as typeof window.pywebview;
  return api;
}

async function renderPanel(onDataDirChanged = vi.fn()) {
  render(<BasicSettingsPanel onDataDirChanged={onDataDirChanged} />);
  await waitFor(() => {
    expect(screen.getByTestId("data-dir-path").textContent).toBe(
      "/home/me/.graupel",
    );
  });
  return onDataDirChanged;
}

const retentionSelect = () =>
  screen.getByLabelText("Keep archived forecasts") as HTMLSelectElement;

describe("BasicSettingsPanel (spec §8.2, §9.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    delete window.pywebview;
  });

  it("shows the data folder, retention and archive size", async () => {
    installBridge();
    await renderPanel();
    expect(retentionSelect().value).toBe("30");
    expect(screen.getByTestId("archive-size").textContent).toBe(
      "3 archived forecasts, about 3.0 KB",
    );
  });

  it("copies the chosen parts into a new folder and reports the switch", async () => {
    const api = installBridge();
    const onDataDirChanged = await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    const dialog = await screen.findByTestId("data-dir-dialog");
    expect(dialog.textContent).toContain("/mnt/usb/graupel");

    const configuration = screen.getByRole("switch", {
      name: "Configuration data",
    });
    const meteogram = screen.getByRole("switch", { name: "Meteogram data" });
    expect(configuration.getAttribute("aria-checked")).toBe("true");
    expect(meteogram.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(meteogram);
    expect(meteogram.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Use folder" }));
    await waitFor(() => {
      expect(onDataDirChanged).toHaveBeenCalledTimes(1);
    });
    expect(api.change_data_dir).toHaveBeenCalledWith(
      "/mnt/usb/graupel",
      true,
      false,
    );
    expect(screen.queryByTestId("data-dir-dialog")).toBeNull();
    expect(screen.getByTestId("data-dir-path").textContent).toBe(
      "/mnt/usb/graupel",
    );
  });

  it("cancels the folder change and shows a failed switch", async () => {
    const api = installBridge();
    const onDataDirChanged = await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await screen.findByTestId("data-dir-dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("data-dir-dialog")).toBeNull();
    expect(api.change_data_dir).not.toHaveBeenCalled();

    api.change_data_dir.mockRejectedValueOnce(
      new Error("/mnt/usb/graupel already contains a meteogram.db"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await screen.findByTestId("data-dir-dialog");
    fireEvent.click(screen.getByRole("button", { name: "Use folder" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already contains",
    );
    expect(onDataDirChanged).not.toHaveBeenCalled();
  });

  it("does nothing when the folder dialog is cancelled", async () => {
    const api = installBridge();
    api.choose_data_dir.mockResolvedValueOnce(null as unknown as string);
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await waitFor(() => expect(api.choose_data_dir).toHaveBeenCalled());
    expect(screen.queryByTestId("data-dir-dialog")).toBeNull();
  });

  it("enables and changes the retention without asking", async () => {
    const api = installBridge({ archive_enabled: false });
    await renderPanel();
    expect(retentionSelect().value).toBe("off");
    fireEvent.change(retentionSelect(), { target: { value: "forever" } });
    await waitFor(() => expect(retentionSelect().value).toBe("forever"));
    expect(api.update_settings).toHaveBeenLastCalledWith({
      archive_enabled: true,
      archive_retention_days: null,
    });
    expect(screen.queryByTestId("archive-disable-dialog")).toBeNull();
  });

  it("asks before switching off and keeps the data by default", async () => {
    const api = installBridge();
    await renderPanel();
    fireEvent.change(retentionSelect(), { target: { value: "off" } });
    await screen.findByTestId("archive-disable-dialog");
    const remove = screen.getByRole("switch", { name: "Delete archived data" });
    expect(remove.getAttribute("aria-checked")).toBe("false");
    // Escape cancels and leaves the retention as it was.
    fireEvent.keyDown(remove, { key: "Escape" });
    expect(screen.queryByTestId("archive-disable-dialog")).toBeNull();
    expect(retentionSelect().value).toBe("30");
    expect(api.update_settings).not.toHaveBeenCalled();

    fireEvent.change(retentionSelect(), { target: { value: "off" } });
    await screen.findByTestId("archive-disable-dialog");
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(retentionSelect().value).toBe("off"));
    expect(api.update_settings).toHaveBeenCalledWith({
      archive_enabled: false,
    });
    expect(api.delete_archive).not.toHaveBeenCalled();
  });

  it("deletes the archive when the switch is on", async () => {
    const api = installBridge();
    await renderPanel();
    fireEvent.change(retentionSelect(), { target: { value: "off" } });
    await screen.findByTestId("archive-disable-dialog");
    fireEvent.click(
      screen.getByRole("switch", { name: "Delete archived data" }),
    );
    api.get_archive_stats.mockResolvedValue({ fetches: 0, bytes: 0 });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(retentionSelect().value).toBe("off"));
    expect(api.delete_archive).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("archive-size").textContent).toBe(
      "Archive is empty",
    );
  });

  it("opens the data folder in the file manager (#197)", async () => {
    const api = installBridge();
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    await waitFor(() => expect(api.open_data_dir).toHaveBeenCalledTimes(1));
    // No path is passed: the bridge opens the folder it reports.
    expect(api.open_data_dir.mock.calls[0]).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();

    api.open_data_dir.mockResolvedValueOnce({
      ok: false,
      error: "No file manager found (xdg-open is missing)",
    });
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No file manager found (xdg-open is missing)",
    );
  });

  it("hides Open folder when the bridge cannot open it", async () => {
    const api = installBridge();
    delete (api as Partial<typeof api>).open_data_dir;
    await renderPanel();
    expect(screen.getByRole("button", { name: /Choose folder/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open folder/ })).toBeNull();
  });

  it("has no data folder without the desktop bridge", async () => {
    render(<BasicSettingsPanel />);
    expect(
      await screen.findByText(
        "The data folder can only be changed in the desktop app.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("archive-size")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open folder/ })).toBeNull();
  });
});
