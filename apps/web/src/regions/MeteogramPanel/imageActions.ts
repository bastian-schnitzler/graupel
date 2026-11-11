// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Copying and saving the meteogram as a picture (REQ-461, REQ-597). The PNG comes from the core's export
 * (`meteogramToPng` of `@graupel/meteogram/png`); these helpers only hand it to the clipboard, the share sheet, the
 * browser's "Save as" dialog or a download, and keep the page in place while it is drawn (REQ-574). They take the
 * window as a parameter so tests can pass stand-ins.
 */

/** Options of the browser's "Save as" dialog (File System Access API, Chrome and Edge). */
export interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}

/** The parts of `window` the helpers use. */
export interface ImageActionWindow {
  navigator: Navigator;
  document: Document;
  ClipboardItem?: typeof ClipboardItem;
  URL: typeof URL;
  /** The "Save as" dialog; only some desktop browsers have it (not in lib.dom). */
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}

/**
 * Media query of a touch device (phone, tablet): there "save image" goes through the share sheet (REQ-461); on other
 * devices it saves a PNG file (REQ-597).
 */
export const TOUCH_QUERY = "(pointer: coarse)";

/** Whether the browser can put a picture on the clipboard (async Clipboard API with `ClipboardItem`). */
export function canCopyImage(win: ImageActionWindow = window): boolean {
  return typeof win.ClipboardItem === "function" && typeof win.navigator.clipboard?.write === "function";
}

/**
 * Puts the PNG on the clipboard. The `ClipboardItem` is created right away with the PNG still being drawn: Safari
 * accepts a clipboard write only in the click itself, and takes a promise for the data.
 */
export async function copyImage(png: Promise<Blob>, win: ImageActionWindow = window): Promise<void> {
  const Item = win.ClipboardItem;
  if (typeof Item !== "function" || typeof win.navigator.clipboard?.write !== "function") {
    throw new Error("Clipboard images are not supported");
  }
  await win.navigator.clipboard.write([new Item({ "image/png": png })]);
}

/**
 * Whether the browser can share a PNG file through the share sheet (Web Share API with files, REQ-680): on a touch
 * device the save button then shows the share symbol and shares the picture; elsewhere it downloads it.
 */
export function canShareFiles(win: ImageActionWindow = window): boolean {
  const nav = win.navigator;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function" || typeof File !== "function") return false;
  try {
    return nav.canShare({ files: [new File([], "meteogram.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

/**
 * How a save ended: the share sheet took the file, the "Save as" dialog wrote it, it was downloaded, or the user closed
 * the share sheet or the dialog.
 */
export type SaveOutcome = "shared" | "saved" | "downloaded" | "cancelled";

/** Downloads `blob` as `fileName` through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string, win: ImageActionWindow = window): void {
  const url = win.URL.createObjectURL(blob);
  const link = win.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  win.document.body.append(link);
  link.click();
  link.remove();
  // Revoked a little later: some browsers start reading the file only after the click returned.
  setTimeout(() => win.URL.revokeObjectURL(url), 10_000);
}

const errorName = (error: unknown) => (error instanceof Error || error instanceof DOMException ? error.name : "");

/** How the PNG is saved: `touch` (phone, tablet) through the share sheet, otherwise as a file (REQ-597). */
export interface SaveImageOptions {
  touch: boolean;
}

/**
 * Saves the PNG on the device. On a touch device (phone, tablet) the share sheet opens where the browser can share
 * files (iOS and Android offer "Save image" there, REQ-461); elsewhere the PNG is saved as a file without the share
 * sheet (REQ-597): through the "Save as" dialog with the suggested file name where the browser has one (Chrome, Edge),
 * otherwise as a download.
 */
export function saveImage(
  png: Promise<Blob>,
  fileName: string,
  { touch }: SaveImageOptions,
  win: ImageActionWindow = window,
): Promise<SaveOutcome> {
  return touch ? shareImage(png, fileName, win) : saveImageFile(png, fileName, win);
}

/**
 * Touch devices: the share sheet where the browser can share files; otherwise, or when the browser refuses to share
 * (e.g. the click's activation ran out while the picture was drawn), the PNG is downloaded.
 */
async function shareImage(png: Promise<Blob>, fileName: string, win: ImageActionWindow): Promise<SaveOutcome> {
  const blob = await png;
  const nav = win.navigator;
  if (typeof nav.share === "function" && typeof nav.canShare === "function" && typeof File === "function") {
    const file = new File([blob], fileName, { type: "image/png" });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
        return "shared";
      } catch (error) {
        if (errorName(error) === "AbortError") return "cancelled";
        if (errorName(error) !== "NotAllowedError") throw error;
      }
    }
  }
  downloadBlob(blob, fileName, win);
  return "downloaded";
}

/** The file type the "Save as" dialog offers. */
const PNG_FILE_TYPE = { accept: { "image/png": [".png"] } };

/**
 * Other devices (REQ-597): the "Save as" dialog with the suggested file name where the browser has one, otherwise a
 * download. The dialog opens at once, while the click still counts as the user's, and the picture is drawn meanwhile.
 * Where the browser refuses the dialog (a cross-origin frame, no user activation: `SecurityError`, `NotAllowedError`)
 * the PNG is downloaded too.
 */
async function saveImageFile(png: Promise<Blob>, fileName: string, win: ImageActionWindow): Promise<SaveOutcome> {
  // While the dialog is open nobody waits for the picture yet: a failed export is reported once it is needed.
  png.catch(() => undefined);
  if (typeof win.showSaveFilePicker === "function") {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await win.showSaveFilePicker({ suggestedName: fileName, types: [PNG_FILE_TYPE] });
    } catch (error) {
      if (errorName(error) === "AbortError") return "cancelled";
    }
    if (handle) {
      const blob = await png;
      const file = await handle.createWritable();
      try {
        await file.write(blob);
        await file.close();
      } catch (error) {
        await file.abort().catch(() => undefined);
        throw error;
      }
      return "saved";
    }
  }
  downloadBlob(await png, fileName, win);
  return "downloaded";
}

/** The parts of `window` `keepScrollPosition` uses. */
export type ScrollWindow = Pick<Window, "scrollX" | "scrollY" | "scrollTo">;

/**
 * Runs `run` (the PNG export) and puts the page back where it was (REQ-574). For a picture with other render options
 * the export puts a second chart of another height in the chart's place for a moment and measures it (e.g. without
 * model headers, REQ-539): the page is shorter then, and scrolled to the footer the browser pulls the scroll position
 * back; Safari, without scroll anchoring, keeps it there. The export reads the page before it returns, so putting it
 * back right after is enough.
 */
export function keepScrollPosition<T>(run: () => T, win: ScrollWindow = window): T {
  const { scrollX, scrollY } = win;
  try {
    return run();
  } finally {
    if (win.scrollX !== scrollX || win.scrollY !== scrollY) win.scrollTo(scrollX, scrollY);
  }
}

/** Class of the chart's scroll area while the picture is read from the page (REQ-616). */
export const EXPORT_CLASS = "meteogram__scroll--export";

/**
 * Runs `run` (which reads the page for the picture) with the chart's own label row shown: on a phone in portrait the
 * page hides it below the chart and shows only the data source (REQ-616), but the copied or saved image keeps place,
 * domain and source. The row is hidden again before the page is drawn, so nothing flickers.
 */
export function withChartLabelRow<T>(chart: Element, run: () => T): T {
  const scroll = chart.closest(".meteogram__scroll");
  if (!scroll || scroll.classList.contains(EXPORT_CLASS)) return run();
  scroll.classList.add(EXPORT_CLASS);
  try {
    return run();
  } finally {
    scroll.classList.remove(EXPORT_CLASS);
  }
}

/** Letters that lose more than an accent in the file name (REQ-683): umlauts and ß as in German, a few others. */
const FILE_NAME_LETTERS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "Ae",
  œ: "oe",
  Œ: "Oe",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  ı: "i",
};
const FILE_NAME_LETTER = new RegExp(`[${Object.keys(FILE_NAME_LETTERS).join("")}]`, "g");
/** Stands for a decimal separator while the other characters are dropped. */
const DECIMAL_MARK = "\u0001";

/**
 * The place's name as part of the file name (REQ-683): umlauts and ß replaced (ä → ae, ö → oe, ü → ue, ß → ss), other
 * accents dropped from their letters (é → e), spaces as `_`, other characters left out; upper and lower case stay. A
 * hyphen stays as well (Saint-Gervais), and a decimal point between digits, so coordinates keep their numbers
 * ("45.8326° N · 6.8652° E" → `45.8326_N_6.8652_E`). Empty where nothing is left (e.g. a name in another script).
 */
export function fileNamePlace(name: string): string {
  return name
    .normalize("NFC")
    .replace(FILE_NAME_LETTER, (letter) => FILE_NAME_LETTERS[letter] ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/(\d)[.,](?=\d)/g, `$1${DECIMAL_MARK}`)
    .replace(new RegExp(`[^A-Za-z0-9\\s_${DECIMAL_MARK}-]`, "g"), "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .replaceAll(DECIMAL_MARK, ".");
}

/** Year, month and day of `date` with two digits each, in `timeZone` (UTC where the browser does not know it). */
function shortDate(date: Date, timeZone: string): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-GB", { year: "2-digit", month: "2-digit", day: "2-digit", timeZone });
  } catch {
    format = new Intl.DateTimeFormat("en-GB", { year: "2-digit", month: "2-digit", day: "2-digit", timeZone: "UTC" });
  }
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}`;
}

/**
 * File name of the picture (REQ-683, REQ-766), when saved and shared: `YYMMDD_<place>.png`, e.g.
 * `261107_Grossglockner.png`, with the date the forecast was fetched in `timeZone` (the chart's, as its footer writes
 * the time of the data) and the place's name as `fileNamePlace` writes it; without a name `YYMMDD.png`.
 */
export function imageFileName(place: string | null | undefined, fetched: Date, timeZone = "UTC"): string {
  const name = place ? fileNamePlace(place) : "";
  return `${shortDate(fetched, timeZone)}${name ? `_${name}` : ""}.png`;
}
