// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Full screen without title bar (REQ-460); copying the meteogram as a picture and saving it, on touch devices through
 * the share sheet (REQ-461), elsewhere as a PNG file through the "Save as" dialog or a download (REQ-597): clipboard,
 * share sheet, dialog and download are stand-ins, the PNG export of the core is mocked (jsdom has no canvas). On a
 * phone the buttons stand in the page footer's row (REQ-541) and the full-screen view has none (REQ-537). Copying and
 * saving leave the page where it is (REQ-574). Where a touch device can share files, the button shares the picture with
 * the share symbol (REQ-680); the file is named after the date of the data and the place (REQ-683).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meteogramToPng } from "@graupel/meteogram/png";
import { ConfigProvider, DEFAULT_CONFIG, type GraupelConfig } from "../src/config/index.ts";
import { NoticesProvider } from "../src/components/ErrorCards.tsx";
import { DialogsProvider } from "../src/dialogs/index.ts";
import { I18nProvider } from "../src/i18n/index.ts";
import { Footer } from "../src/regions/Footer/index.ts";
import { MeteogramPanel } from "../src/regions/MeteogramPanel/index.ts";
import {
  TOUCH_QUERY,
  EXPORT_CLASS,
  canShareFiles,
  copyImage,
  fileNamePlace,
  imageFileName,
  keepScrollPosition,
  saveImage,
  withChartLabelRow,
  type ImageActionWindow,
  type ScrollWindow,
} from "../src/regions/MeteogramPanel/imageActions.ts";
import {
  ChainProvider,
  DaySelectionProvider,
  ForecastProvider,
  LocationProvider,
  PHONE_LANDSCAPE_QUERY,
  PHONE_QUERY,
  type ForecastLoader,
} from "../src/state/index.ts";
import { modelHeadersChoice } from "../src/state/displaySettings.ts";
import { FooterSlotProvider } from "../src/state/footerSlot.tsx";
import { IMAGE_MARGIN_PX } from "../src/regions/MeteogramPanel/imageMargin.ts";
import { WEB_LAYOUT, WEB_LAYOUT_WITHOUT_HEADERS } from "../src/regions/MeteogramPanel/layout.ts";
import { forecastFixture } from "./forecastFixture.ts";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

vi.mock("@graupel/meteogram/png", () => ({
  meteogramToPng: vi.fn(() => Promise.resolve(PNG)),
}));

/** ClipboardItem stand-in that keeps what it was given. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob> | Blob>) {}
}

/** A "Save as" dialog stand-in: returns a file handle whose writes it records, or fails with `error`. */
function fakeSavePicker(error?: string) {
  const written: Blob[] = [];
  const closed = vi.fn();
  const showSaveFilePicker = vi.fn<NonNullable<ImageActionWindow["showSaveFilePicker"]>>(async () => {
    if (error) throw new DOMException("refused", error);
    return {
      createWritable: async () => ({
        write: async (data: Blob) => {
          written.push(data);
        },
        close: closed,
        abort: async () => undefined,
      }),
    } as unknown as FileSystemFileHandle;
  });
  return { showSaveFilePicker, written, closed };
}

/** A window with a clipboard, share sheet and object URLs that record their calls. */
function fakeWindow(options: { canShare?: boolean; shareError?: string; clipboard?: boolean } = {}) {
  const write = vi.fn<(items: FakeClipboardItem[]) => Promise<void>>(async () => undefined);
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {
    if (options.shareError) throw new DOMException("refused", options.shareError);
  });
  const canShare = vi.fn<(data: ShareData) => boolean>(() => options.canShare ?? false);
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:meteogram");
  const revokeObjectURL = vi.fn();
  const clicks: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this);
  });
  const navigator = {
    ...(options.clipboard === false ? {} : { clipboard: { write } }),
    share,
    canShare,
  } as unknown as Navigator;
  const win = {
    navigator,
    document,
    ClipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem,
    URL: { createObjectURL, revokeObjectURL } as unknown as typeof URL,
  } satisfies ImageActionWindow;
  return { win, write, share, canShare, createObjectURL, clicks };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copying the picture", () => {
  it("writes a PNG ClipboardItem to the clipboard", async () => {
    const { win, write } = fakeWindow();
    await copyImage(Promise.resolve(PNG), win);
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]![0][0]!;
    expect(Object.keys(item.items)).toEqual(["image/png"]);
    expect(await item.items["image/png"]).toBe(PNG);
  });

  it("fails without the async clipboard and when the PNG fails", async () => {
    await expect(copyImage(Promise.resolve(PNG), fakeWindow({ clipboard: false }).win)).rejects.toThrow();
    const { win } = fakeWindow();
    win.navigator.clipboard.write = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    await expect(copyImage(Promise.resolve(PNG), win)).rejects.toThrow();
  });
});

const TOUCH = { touch: true };
const DESKTOP = { touch: false };

describe("saving the picture on a touch device (REQ-461)", () => {
  it("opens the share sheet with the PNG file where files can be shared", async () => {
    const { win, share, clicks } = fakeWindow({ canShare: true });
    await expect(saveImage(Promise.resolve(PNG), "meteogram.png", TOUCH, win)).resolves.toBe("shared");
    const file = share.mock.calls[0]![0].files![0]!;
    expect(file.name).toBe("meteogram.png");
    expect(file.type).toBe("image/png");
    expect(clicks).toHaveLength(0);
  });

  it("does nothing more when the share sheet is closed", async () => {
    const { win, clicks } = fakeWindow({ canShare: true, shareError: "AbortError" });
    await expect(saveImage(Promise.resolve(PNG), "meteogram.png", TOUCH, win)).resolves.toBe("cancelled");
    expect(clicks).toHaveLength(0);
  });

  it("downloads the PNG where files cannot be shared or sharing is refused", async () => {
    for (const options of [{ canShare: false }, { canShare: true, shareError: "NotAllowedError" }]) {
      const { win, createObjectURL, clicks } = fakeWindow(options);
      await expect(saveImage(Promise.resolve(PNG), "meteogram.png", TOUCH, win)).resolves.toBe("downloaded");
      expect(createObjectURL).toHaveBeenCalledWith(PNG);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]!.download).toBe("meteogram.png");
      expect(clicks[0]!.href).toBe("blob:meteogram");
      expect(clicks[0]!.isConnected).toBe(false);
    }
  });

  it("fails on other share errors", async () => {
    const { win } = fakeWindow({ canShare: true, shareError: "DataError" });
    await expect(saveImage(Promise.resolve(PNG), "meteogram.png", TOUCH, win)).rejects.toThrow();
  });

});

describe("file name of the picture (REQ-683, REQ-766)", () => {
  const fetched = new Date("2026-11-07T20:57:00Z");

  it("is YYMMDD_<place>.png with the date of the data", () => {
    expect(imageFileName("Grossglockner", fetched)).toBe("261107_Grossglockner.png");
    // The date in the chart's time zone: 20:57 UTC is already the next day in Tokyo.
    expect(imageFileName("Mont Blanc", fetched, "Europe/Paris")).toBe("261107_Mont_Blanc.png");
    expect(imageFileName("Tokyo", fetched, "Asia/Tokyo")).toBe("261108_Tokyo.png");
    expect(imageFileName("Hilo", new Date("2027-01-01T05:00:00Z"), "Pacific/Honolulu")).toBe("261231_Hilo.png");
    // An unknown time zone counts as UTC.
    expect(imageFileName("Innsbruck", fetched, "Nowhere/Nothing")).toBe("261107_Innsbruck.png");
  });

  it("replaces umlauts and ß, drops accents, keeps upper and lower case", () => {
    expect(imageFileName("Großglockner", fetched)).toBe("261107_Grossglockner.png");
    expect(imageFileName("Zürich", fetched)).toBe("261107_Zuerich.png");
    expect(imageFileName("Ötztal Ärgernis Übelbach", fetched)).toBe("261107_Oetztal_Aergernis_Uebelbach.png");
    expect(imageFileName("Göß", fetched)).toBe("261107_Goess.png");
    expect(imageFileName("Bréda Champéry Llançà", fetched)).toBe("261107_Breda_Champery_Llanca.png");
    expect(imageFileName("Škofja Loka", fetched)).toBe("261107_Skofja_Loka.png");
    expect(imageFileName("Tromsø Łódź", fetched)).toBe("261107_Tromso_Lodz.png");
    // Decomposed letters (a and a combining diaeresis) as composed ones.
    expect(imageFileName("Mu\u0308nchen", fetched)).toBe("261107_Muenchen.png");
  });

  it("writes spaces as _ and leaves other characters out", () => {
    expect(imageFileName("Piz Bernina", fetched)).toBe("261107_Piz_Bernina.png");
    expect(imageFileName("  St. Moritz  (Engadin)!  ", fetched)).toBe("261107_St_Moritz_Engadin.png");
    expect(imageFileName("Hütte / Gipfel: 3.000 m?", fetched)).toBe("261107_Huette_Gipfel_3.000_m.png");
    expect(imageFileName("L'Aiguille du Midi", fetched)).toBe("261107_LAiguille_du_Midi.png");
    // A hyphen stays.
    expect(imageFileName("Saint-Gervais-les-Bains", fetched)).toBe("261107_Saint-Gervais-les-Bains.png");
  });

  it("keeps the numbers of coordinates", () => {
    expect(imageFileName("45.8326° N · 6.8652° E", fetched)).toBe("261107_45.8326_N_6.8652_E.png");
    // German writes a decimal comma: it becomes a point, too.
    expect(imageFileName("47,0742° N · 12,6947° O", fetched)).toBe("261107_47.0742_N_12.6947_O.png");
    expect(imageFileName("33.8688° S · 151.2093° E", fetched)).toBe("261107_33.8688_S_151.2093_E.png");
  });

  it("is YYMMDD.png without a name or where nothing of it is left", () => {
    expect(imageFileName(undefined, fetched)).toBe("261107.png");
    expect(imageFileName("", fetched)).toBe("261107.png");
    expect(imageFileName("東京", fetched)).toBe("261107.png");
    expect(fileNamePlace("?!")).toBe("");
  });
});

describe("whether files can be shared (REQ-680)", () => {
  it("asks the browser about a PNG file", () => {
    const { win, canShare } = fakeWindow({ canShare: true });
    expect(canShareFiles(win)).toBe(true);
    const file = canShare.mock.calls[0]![0].files![0]!;
    expect(file.type).toBe("image/png");
    expect(canShareFiles(fakeWindow({ canShare: false }).win)).toBe(false);
  });

  it("is false without the Web Share API or where the browser refuses the question", () => {
    const { win } = fakeWindow({ canShare: true });
    expect(canShareFiles({ ...win, navigator: {} as Navigator })).toBe(false);
    const throwing = {
      share: async () => undefined,
      canShare: () => {
        throw new TypeError("no files");
      },
    } as unknown as Navigator;
    expect(canShareFiles({ ...win, navigator: throwing })).toBe(false);
  });
});

describe("saving the picture on a desktop (REQ-597)", () => {
  /** `saveImage` on a desktop whose browser has the "Save as" dialog stand-in `picker`. */
  const saveWithPicker = (png: Promise<Blob>, win: ImageActionWindow, picker: ReturnType<typeof fakeSavePicker>) =>
    saveImage(png, "meteogram.png", DESKTOP, { ...win, showSaveFilePicker: picker.showSaveFilePicker });

  it("opens the “Save as” dialog with the suggested name and a PNG filter and writes the PNG there", async () => {
    const { win, share, clicks } = fakeWindow({ canShare: true });
    const picker = fakeSavePicker();
    await expect(saveWithPicker(Promise.resolve(PNG), win, picker)).resolves.toBe("saved");
    expect(picker.showSaveFilePicker).toHaveBeenCalledExactlyOnceWith({
      suggestedName: "meteogram.png",
      types: [{ accept: { "image/png": [".png"] } }],
    });
    expect(picker.written).toEqual([PNG]);
    expect(picker.closed).toHaveBeenCalledTimes(1);
    expect(share).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
  });

  it("opens the dialog at once, before the picture is drawn", async () => {
    const { win } = fakeWindow();
    const picker = fakeSavePicker();
    let draw: (blob: Blob) => void = () => undefined;
    const png = new Promise<Blob>((resolve) => (draw = resolve));
    const saving = saveWithPicker(png, win, picker);
    expect(picker.showSaveFilePicker).toHaveBeenCalledTimes(1);
    draw(PNG);
    await expect(saving).resolves.toBe("saved");
    expect(picker.written).toEqual([PNG]);
  });

  it("does nothing more when the dialog is closed", async () => {
    const { win, clicks } = fakeWindow();
    const picker = fakeSavePicker("AbortError");
    await expect(saveWithPicker(Promise.resolve(PNG), win, picker)).resolves.toBe("cancelled");
    expect(picker.written).toHaveLength(0);
    expect(clicks).toHaveLength(0);
  });

  it("downloads the PNG where the browser refuses the dialog (frame of another origin, no activation)", async () => {
    for (const error of ["SecurityError", "NotAllowedError"]) {
      const { win, createObjectURL, clicks } = fakeWindow();
      const picker = fakeSavePicker(error);
      await expect(saveWithPicker(Promise.resolve(PNG), win, picker)).resolves.toBe("downloaded");
      expect(createObjectURL).toHaveBeenCalledWith(PNG);
      expect(clicks).toHaveLength(1);
      expect(clicks[0]!.download).toBe("meteogram.png");
    }
  });

  it("downloads the PNG without a “Save as” dialog, also where files could be shared", async () => {
    const { win, share, createObjectURL, clicks } = fakeWindow({ canShare: true });
    await expect(saveImage(Promise.resolve(PNG), "meteogram.png", DESKTOP, win)).resolves.toBe("downloaded");
    expect(share).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledWith(PNG);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toBe("meteogram.png");
    expect(clicks[0]!.isConnected).toBe(false);
  });

  it("fails when the picture cannot be drawn, without writing", async () => {
    const { win, clicks } = fakeWindow();
    const picker = fakeSavePicker();
    const failed = Promise.reject(new Error("no chart"));
    await expect(saveWithPicker(failed, win, picker)).rejects.toThrow("no chart");
    expect(picker.written).toHaveLength(0);
    await expect(saveImage(failed, "meteogram.png", DESKTOP, win)).rejects.toThrow("no chart");
    expect(clicks).toHaveLength(0);
  });
});

describe("keeping the page in place (REQ-574)", () => {
  /** A page scrolled to `y` whose `scrollTo` moves it. */
  function scrolledWindow(y: number) {
    const win = {
      scrollX: 0,
      scrollY: y,
      scrollTo: vi.fn((left: number, top: number) => Object.assign(win, { scrollX: left, scrollY: top })),
    };
    return win;
  }

  it("puts the page back where it was when the export pulled it back", () => {
    const win = scrolledWindow(118);
    const result = keepScrollPosition(() => {
      win.scrollY = 86;
      return "png";
    }, win as unknown as ScrollWindow);
    expect(result).toBe("png");
    expect(win.scrollTo).toHaveBeenCalledExactlyOnceWith(0, 118);
    expect(win.scrollY).toBe(118);
  });

  it("does not scroll when the page stayed, and puts it back when the export throws", () => {
    const still = scrolledWindow(118);
    keepScrollPosition(() => "png", still as unknown as ScrollWindow);
    expect(still.scrollTo).not.toHaveBeenCalled();

    const moved = scrolledWindow(118);
    expect(() =>
      keepScrollPosition(() => {
        moved.scrollY = 86;
        throw new Error("no chart");
      }, moved as unknown as ScrollWindow),
    ).toThrow("no chart");
    expect(moved.scrollY).toBe(118);
  });

  it("shows the chart's own label row only while the picture reads the page (REQ-616)", () => {
    const scroll = document.createElement("div");
    scroll.className = "meteogram__scroll meteogram__scroll--portrait";
    const chart = document.createElement("div");
    scroll.append(chart);
    const during = withChartLabelRow(chart, () => scroll.classList.contains(EXPORT_CLASS));
    expect(during).toBe(true);
    expect(scroll.classList.contains(EXPORT_CLASS)).toBe(false);
    // Also when the export throws, and without a scroll area around the chart (full-screen view).
    expect(() =>
      withChartLabelRow(chart, () => {
        throw new Error("no chart");
      }),
    ).toThrow("no chart");
    expect(scroll.classList.contains(EXPORT_CLASS)).toBe(false);
    expect(withChartLabelRow(document.createElement("div"), () => "png")).toBe("png");
  });
});

describe("buttons in the card and the full-screen view", () => {
  let touch = false;
  let phone = false;
  let landscape = false;
  let write: ReturnType<typeof vi.fn>;
  let share: ReturnType<typeof vi.fn>;
  const original = { matchMedia: window.matchMedia, ClipboardItem: (window as { ClipboardItem?: unknown }).ClipboardItem };

  beforeEach(() => {
    touch = false;
    phone = false;
    landscape = false;
    write = vi.fn(async () => undefined);
    share = vi.fn(async () => undefined);
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches:
          (query === TOUCH_QUERY && touch) ||
          (query === PHONE_QUERY && phone) ||
          (query === PHONE_LANDSCAPE_QUERY && phone && landscape),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    Object.assign(window, { ClipboardItem: FakeClipboardItem });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    Object.assign(navigator, { share, canShare: () => true });
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = original.matchMedia;
    Object.assign(window, { ClipboardItem: original.ClipboardItem });
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "canShare");
  });

  /** The panel; with `footer` inside the slot provider and followed by the page footer, as on the page. */
  async function ready({ footer = false, config = DEFAULT_CONFIG }: { footer?: boolean; config?: GraupelConfig } = {}) {
    const loader = vi.fn<ForecastLoader>(async () => forecastFixture());
    const panel = footer ? (
      <DialogsProvider>
        <FooterSlotProvider>
          <MeteogramPanel />
          <Footer />
        </FooterSlotProvider>
      </DialogsProvider>
    ) : (
      <MeteogramPanel />
    );
    render(
      <ConfigProvider config={config}>
        <I18nProvider languages={["en"]} fallbackLanguage="en" browserLanguages={[]}>
          <NoticesProvider>
            <LocationProvider>
              <ChainProvider>
                <ForecastProvider loader={loader}>
                  <DaySelectionProvider>{panel}</DaySelectionProvider>
                </ForecastProvider>
              </ChainProvider>
            </LocationProvider>
          </NoticesProvider>
        </I18nProvider>
      </ConfigProvider>,
    );
    // The full-screen view, open at once in a phone's landscape, has a chart of its own.
    await screen.findAllByTestId("meteogram-attribution");
  }

  it("copies the card's meteogram and says so", async () => {
    await ready();
    const card = screen.getByTestId("meteogram-card");
    const copy = within(card).getByRole("button", { name: "Copy the meteogram as a picture" });
    expect(copy.getAttribute("title")).toBe("Copy the meteogram as a picture");
    fireEvent.click(copy);
    await waitFor(() => expect(within(card).getByRole("status").textContent).toBe("Meteogram copied"));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("on a desktop saves the picture as a PNG file through the “Save as” dialog (REQ-597)", async () => {
    const picker = fakeSavePicker();
    Object.assign(window, { showSaveFilePicker: picker.showSaveFilePicker });
    try {
      await ready();
      const card = screen.getByTestId("meteogram-card");
      // Copy, save, reload (REQ-637), then full screen in the card's column.
      const column = within(screen.getByTestId("meteogram-tools")).getAllByRole("button");
      expect(column.map((button) => button.title)).toEqual([
        "Copy the meteogram as a picture",
        "Save the picture to the photos",
        "Reload the forecast",
        "Show the meteogram full screen",
      ]);
      fireEvent.click(within(card).getByRole("button", { name: "Save the picture to the photos" }));
      await waitFor(() => expect(within(card).getByRole("status").textContent).toBe("Picture saved"));
      expect(picker.showSaveFilePicker).toHaveBeenCalledExactlyOnceWith({
        // The date of the data and the place (REQ-683).
        suggestedName: "261027_Innsbruck.png",
        types: [{ accept: { "image/png": [".png"] } }],
      });
      expect(picker.written).toEqual([PNG]);
      expect(share).not.toHaveBeenCalled();

      // Closing the dialog shows no message.
      picker.showSaveFilePicker.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
      fireEvent.click(within(card).getByRole("button", { name: "Save the picture to the photos" }));
      await waitFor(() => expect(picker.showSaveFilePicker).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(within(card).getByRole("status").textContent).toBe(""));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(picker.written).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(window, "showSaveFilePicker");
    }
  });

  it("on a desktop without “Save as” dialog downloads the picture, also in full screen (REQ-597)", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:meteogram");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    await ready();
    const card = screen.getByTestId("meteogram-card");
    fireEvent.click(within(card).getByRole("button", { name: "Save the picture to the photos" }));
    await waitFor(() => expect(within(card).getByRole("status").textContent).toBe("Picture saved"));
    expect(createObjectURL).toHaveBeenCalledWith(PNG);
    expect(clicks.map((link) => link.download)).toEqual(["261027_Innsbruck.png"]);

    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Meteogram (full screen)" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the picture to the photos" }));
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Picture saved"));
    expect(clicks).toHaveLength(2);
    expect(clicks[1]!.download).toBe("261027_Innsbruck.png");
    expect(share).not.toHaveBeenCalled();
  });

  it("draws the picture with the model headers exactly when the chart on screen shows them (REQ-539, DEC-094)", async () => {
    const toPng = vi.mocked(meteogramToPng);
    toPng.mockClear();
    // By default the chart on screen shows its model headers (modelHeaders: true), and so does the picture.
    expect(DEFAULT_CONFIG.modelHeaders).toBe(true);
    await ready();
    expect(screen.getByTestId("meteogram-card").querySelector('[data-testid="model-header-label"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy the meteogram as a picture" }));
    await screen.findByText("Meteogram copied");
    // The picture keeps its legend beside the plot (default padding and axis labels), also on a narrow page (REQ-547),
    // and its own height for its width, also where the chart on a phone keeps the height of all days (REQ-585).
    expect(toPng).toHaveBeenLastCalledWith(expect.anything(), {
      render: {
        layout: WEB_LAYOUT,
        forceModelHeaders: true,
        padding: null,
        axisLabels: null,
        viewBoxWidth: null,
        // The dew point and the relative humidity as chosen in the settings, Off by default (REQ-593, REQ-621,
        // REQ-650); the precipitation and wind axes follow the visible range unless the settings turn it off (REQ-656).
        // All three are values of the layout's switches (REQ-661).
        toggles: { dewPoint: "off", relativeHumidity: "off", scaleToVisibleRange: "on" },
      },
      // Background and scale are passed on, so the band above and below matches the picture (REQ-714); jsdom paints
      // no background (white) and has a device pixel ratio of 1 (at least 2).
      background: "#ffffff",
      scale: 2,
    });
    cleanup();

    // Without model headers on screen the picture has none either; imageModelHeaders has no effect for now (DEC-094).
    await ready({ config: { ...DEFAULT_CONFIG, modelHeaders: false, imageModelHeaders: true } });
    fireEvent.click(screen.getByRole("button", { name: "Copy the meteogram as a picture" }));
    await screen.findByText("Meteogram copied");
    expect(toPng).toHaveBeenLastCalledWith(expect.anything(), {
      render: {
        layout: WEB_LAYOUT_WITHOUT_HEADERS,
        forceModelHeaders: false,
        padding: null,
        axisLabels: null,
        viewBoxWidth: null,
        toggles: { dewPoint: "off", relativeHumidity: "off", scaleToVisibleRange: "on" },
      },
      background: "#ffffff",
      scale: 2,
    });
  });

  /** Copies the picture of the card's chart; returns whether the chart on screen and the picture show model headers. */
  async function copyAndCompare(config: GraupelConfig) {
    // The core draws the picture's chart with the render options of the image (layout schema v2, TASK-298): the
    // stand-in reads the picture's SVG from the real export sources instead of rasterising it.
    const pictures: SVGSVGElement[] = [];
    vi.mocked(meteogramToPng).mockImplementationOnce(async (controller, options) => {
      const sources = controller.getExportSources({ ...(options?.render ? { render: options.render } : {}) });
      try {
        if (sources.svg) pictures.push(sources.svg.cloneNode(true) as SVGSVGElement);
      } finally {
        sources.release?.();
      }
      return PNG;
    });
    await ready({ config });
    const card = screen.getByTestId("meteogram-card");
    const onScreen = () => card.querySelectorAll('[data-testid="model-header-label"]').length > 0;
    const before = onScreen();
    fireEvent.click(within(card).getByRole("button", { name: "Copy the meteogram as a picture" }));
    await screen.findByText("Meteogram copied");
    expect(pictures).toHaveLength(1);
    // The chart on screen keeps what it showed.
    expect(onScreen()).toBe(before);
    return { screen: before, picture: pictures[0]!.querySelectorAll('[data-testid="model-header-label"]').length > 0 };
  }

  it.each([
    { modelHeaders: true, imageModelHeaders: true },
    { modelHeaders: false, imageModelHeaders: true },
    { modelHeaders: true, imageModelHeaders: false },
    { modelHeaders: false, imageModelHeaders: false },
  ])(
    "the picture has model headers exactly when the screen shows them, imageModelHeaders changes nothing: %o (REQ-539, REQ-714, DEC-094)",
    async ({ modelHeaders, imageModelHeaders }) => {
      const shown = await copyAndCompare({ ...DEFAULT_CONFIG, modelHeaders, imageModelHeaders });
      expect(shown).toEqual({ screen: modelHeaders, picture: modelHeaders });
    },
  );

  describe("with an own choice of the model headers in the settings (REQ-472)", () => {
    afterEach(() => modelHeadersChoice.set(null));

    it.each([
      { choice: false, modelHeaders: true, imageModelHeaders: true },
      { choice: true, modelHeaders: false, imageModelHeaders: false },
    ])(
      "the picture follows the own choice over modelHeaders of config.json: %o (REQ-539, DEC-094)",
      async ({ choice, modelHeaders, imageModelHeaders }) => {
        modelHeadersChoice.set(choice);
        const shown = await copyAndCompare({ ...DEFAULT_CONFIG, modelHeaders, imageModelHeaders });
        expect(shown).toEqual({ screen: choice, picture: choice });
      },
    );
  });

  describe.each([
    { scheme: "light", background: "rgb(244, 246, 248)" },
    { scheme: "dark", background: "rgb(17, 22, 28)" },
  ])("band above and below the picture, $scheme (REQ-714)", ({ background }) => {
    const bitmap = { width: 2048, height: 820, close: vi.fn() };
    let drawn: { canvas: HTMLCanvasElement; calls: unknown[][] } | null = null;
    const banded = new Blob([new Uint8Array([137, 80, 78, 71, 1])], { type: "image/png" });

    beforeEach(() => {
      drawn = null;
      // The page background of the colour mode (--color-bg in styles/tokens.css), which jsdom does not load.
      document.body.style.backgroundColor = background;
      Object.assign(window, { createImageBitmap: vi.fn(async () => bitmap) });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        const calls: unknown[][] = [];
        drawn = { canvas: this, calls };
        const context = {
          fillStyle: "",
          fillRect: (...args: unknown[]) => calls.push(["fillRect", context.fillStyle, ...args]),
          drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
        };
        return context as unknown as CanvasRenderingContext2D;
      } as unknown as HTMLCanvasElement["getContext"]);
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(banded));
    });

    afterEach(() => {
      document.body.style.backgroundColor = "";
      Reflect.deleteProperty(window, "createImageBitmap");
    });

    it("copies the picture with a band of 12 CSS px in the background colour above and below", async () => {
      const toPng = vi.mocked(meteogramToPng);
      toPng.mockClear();
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Copy the meteogram as a picture" }));
      await screen.findByText("Meteogram copied");
      // The core draws the picture on the same background at scale 2 (jsdom's device pixel ratio is 1).
      expect(toPng).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ background, scale: 2 }));
      expect(IMAGE_MARGIN_PX).toBe(12);
      const margin = IMAGE_MARGIN_PX * 2;
      expect(drawn!.canvas.width).toBe(bitmap.width);
      expect(drawn!.canvas.height).toBe(bitmap.height + 2 * margin);
      expect(drawn!.calls).toEqual([
        ["fillRect", background, 0, 0, bitmap.width, bitmap.height + 2 * margin],
        ["drawImage", bitmap, 0, margin],
      ]);
      expect(bitmap.close).toHaveBeenCalled();
      const item = write.mock.calls[0]![0][0] as FakeClipboardItem;
      expect(await item.items["image/png"]).toBe(banded);
    });

    it("saves the picture with the band", async () => {
      const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:meteogram");
      vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      await ready();
      fireEvent.click(screen.getByRole("button", { name: "Save the picture to the photos" }));
      await screen.findByText("Picture saved");
      expect(createObjectURL).toHaveBeenCalledWith(banded);
      expect(drawn!.calls[0]).toEqual(["fillRect", background, 0, 0, bitmap.width, bitmap.height + 4 * IMAGE_MARGIN_PX]);
    });
  });

  it("reports a failed copy", async () => {
    write.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Copy the meteogram as a picture" }));
    // A failure is an error card (REQ-492), not the short feedback next to the button.
    const card = await screen.findByRole("alert");
    expect(card.textContent).toBe("Could not copy the meteogram");
    expect(screen.getByTestId("meteogram-image-feedback").textContent).toBe("");
  });

  it("on a touch device shares the picture with the share symbol, named after date and place (REQ-680, REQ-683)", async () => {
    touch = true;
    await ready();
    const button = screen.getByRole("button", { name: "Share the picture" });
    expect(button.title).toBe("Share the picture");
    expect(button.dataset.action).toBe("share");
    expect(screen.queryByRole("button", { name: "Save the picture to the photos" })).toBeNull();
    fireEvent.click(button);
    await screen.findByText("Picture shared");
    expect(share).toHaveBeenCalledTimes(1);
    const file = (share.mock.calls[0]![0] as ShareData).files![0]!;
    expect(file.name).toBe("261027_Innsbruck.png");
    expect(file.type).toBe("image/png");
  });

  it("on a touch device without file sharing keeps the save symbol and downloads the picture (REQ-680)", async () => {
    touch = true;
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "canShare");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:meteogram");
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    await ready();
    const button = screen.getByRole("button", { name: "Save the picture to the photos" });
    expect(button.dataset.action).toBe("save");
    fireEvent.click(button);
    await screen.findByText("Picture saved");
    expect(clicks.map((link) => link.download)).toEqual(["261027_Innsbruck.png"]);
  });

  it("on a desktop keeps the save symbol where files could be shared (REQ-680)", async () => {
    await ready();
    const button = screen.getByRole("button", { name: "Save the picture to the photos" });
    expect(button.dataset.action).toBe("save");
    expect(screen.queryByRole("button", { name: "Share the picture" })).toBeNull();
  });

  it("reports a failed share", async () => {
    touch = true;
    share.mockRejectedValueOnce(new DOMException("broken", "DataError"));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Share the picture" }));
    const card = await screen.findByRole("alert");
    expect(card.textContent).toBe("Could not share the picture");
  });

  it("shows the full-screen view without title bar, named, with close, copy and save", async () => {
    touch = true;
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Show the meteogram full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Meteogram (full screen)" });
    expect(dialog.querySelector("h2, .dialog__header")).toBeNull();
    expect(within(dialog).queryByText("Meteogram (full screen)")).toBeNull();
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(close);
    within(dialog).getByRole("button", { name: "Share the picture" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy the meteogram as a picture" }));
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe("Meteogram copied"));
  });

  it("on a desktop the buttons stay in the card's column, also with the page footer", async () => {
    touch = true;
    await ready({ footer: true });
    const card = screen.getByTestId("meteogram-card");
    within(card).getByRole("button", { name: "Copy the meteogram as a picture" });
    within(card).getByRole("button", { name: "Share the picture" });
    expect(screen.getByTestId("footer-slot").childElementCount).toBe(0);
    // On a desktop the footer keeps "Info" (REQ-546 drops it on a phone only).
    expect(
      within(screen.getByRole("navigation", { name: "Information" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Info", "Legal notice", "Privacy"]);
  });

  it("on a phone the copy and save buttons stand alone in the page footer's row (REQ-541, REQ-550, REQ-582)", async () => {
    touch = true;
    phone = true;
    await ready({ footer: true });
    const card = screen.getByTestId("meteogram-card");
    // No button column beside the chart: the chart takes the whole width.
    expect(screen.queryByTestId("meteogram-tools")).toBeNull();
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    const footer = screen.getByRole("contentinfo");
    const slot = screen.getByTestId("footer-slot");
    const copy = within(slot).getByRole("button", { name: "Copy the meteogram as a picture" });
    const save = within(slot).getByRole("button", { name: "Share the picture" });
    // Only copy and save (REQ-550): info, imprint and privacy are in the menu of the place row (REQ-580, REQ-582).
    expect(within(footer).getAllByRole("button")).toEqual([copy, save]);
    fireEvent.click(copy);
    await waitFor(() => expect(within(slot).getByRole("status").textContent).toBe("Meteogram copied"));
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(save);
    await waitFor(() => expect(within(slot).getByRole("status").textContent).toBe("Picture shared"));
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("on a phone copy and save in the footer row leave the page where it is (REQ-574)", async () => {
    touch = true;
    phone = true;
    await ready({ footer: true });
    // Scrolled to the footer; the export makes the page shorter for a moment and the browser pulls the page back.
    let scrollY = 118;
    vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(((_left: number, top: number) => {
      scrollY = top;
    }) as typeof window.scrollTo);
    const pullBack = () => {
      scrollY = 86;
      return Promise.resolve(PNG);
    };
    vi.mocked(meteogramToPng).mockImplementationOnce(pullBack).mockImplementationOnce(pullBack);
    const slot = screen.getByTestId("footer-slot");
    fireEvent.click(within(slot).getByRole("button", { name: "Copy the meteogram as a picture" }));
    await waitFor(() => expect(within(slot).getByRole("status").textContent).toBe("Meteogram copied"));
    expect(scrollY).toBe(118);
    fireEvent.click(within(slot).getByRole("button", { name: "Share the picture" }));
    await waitFor(() => expect(within(slot).getByRole("status").textContent).toBe("Picture shared"));
    expect(scrollY).toBe(118);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("on a phone in portrait the data source stands in the footer's row after copy and save (REQ-729)", async () => {
    touch = true;
    phone = true;
    await ready({ footer: true });
    const slot = screen.getByTestId("footer-slot");
    const source = screen.getByTestId("meteogram-source");
    expect(slot.contains(source)).toBe(true);
    expect(within(screen.getByTestId("meteogram-card")).queryByTestId("meteogram-source")).toBeNull();
    expect(source.textContent).toMatch(/^Weather data by Open-Meteo\.com/);
    // The buttons first, the source after them: on a phone it stands right-aligned at the row's end.
    expect([...slot.children].map((child) => child.getAttribute("data-testid") ?? child.className)).toEqual([
      "meteogram-actions meteogram-actions--footer",
      "meteogram-source",
    ]);
  });

  it("on a phone without the page footer the buttons stay in the card", async () => {
    touch = true;
    phone = true;
    await ready();
    within(screen.getByTestId("meteogram-tools")).getByRole("button", { name: "Copy the meteogram as a picture" });
    // The data source stays below the chart (REQ-616, REQ-729).
    within(screen.getByTestId("meteogram-card")).getByTestId("meteogram-source");
  });

  it("on a phone the full-screen view has no close, copy or save buttons (REQ-537)", async () => {
    touch = true;
    phone = true;
    landscape = true;
    await ready({ footer: true });
    const dialog = screen.getByRole("dialog", { name: "Meteogram (full screen)" });
    expect(within(dialog).queryAllByRole("button")).toHaveLength(0);
    expect(dialog.querySelector(".dialog__tools")).toBeNull();
    // The view still closes on Escape (a keyboard on a phone); turning back closes it on the page.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Meteogram (full screen)" })).toBeNull();
  });
});
