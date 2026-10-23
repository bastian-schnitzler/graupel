import { afterEach, describe, expect, it, vi } from "vitest";
import { apiService } from "./apiService";

const png = () =>
  Promise.resolve(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));

class FakeClipboardItem {
  items: Record<string, Promise<Blob>>;
  constructor(items: Record<string, Promise<Blob>>) {
    this.items = items;
  }
}

describe("apiService.copyPngToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as any).pywebview;
  });

  it("uses the browser Clipboard API with a pending PNG", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const bridge = vi.fn();
    (window as any).pywebview = { api: { copy_png_to_clipboard: bridge } };

    await expect(apiService.copyPngToClipboard(png())).resolves.toBe(true);
    const [items] = write.mock.calls[0];
    expect(await (items[0] as FakeClipboardItem).items["image/png"]).toBeInstanceOf(Blob);
    expect(bridge).not.toHaveBeenCalled();
  });

  it("falls back to the Python bridge with base64 PNG when the Clipboard API rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("navigator", {
      clipboard: { write: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const bridge = vi.fn().mockResolvedValue(true);
    (window as any).pywebview = { api: { copy_png_to_clipboard: bridge } };

    await expect(apiService.copyPngToClipboard(png())).resolves.toBe(true);
    expect(bridge).toHaveBeenCalledWith("iVBORw==");
  });

  it("reports failure without Clipboard API and bridge", async () => {
    vi.stubGlobal("navigator", {});
    await expect(apiService.copyPngToClipboard(png())).resolves.toBe(false);
  });
});
