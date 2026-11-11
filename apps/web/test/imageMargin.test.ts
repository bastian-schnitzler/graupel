// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Band above and below the copied, shared or saved picture (REQ-714): in the picture's background colour (the page's,
 * light or dark), of `IMAGE_MARGIN_PX` CSS pixels at the picture's scale. jsdom has no canvas and no
 * `createImageBitmap`: both are stand-ins that record what is drawn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_MARGIN_PX,
  pictureBackground,
  pictureScale,
  withImageMargin,
  type ImageMarginWindow,
} from "../src/regions/MeteogramPanel/imageMargin.ts";

const PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const BANDED = new Blob([new Uint8Array([137, 80, 78, 71, 2])], { type: "image/png" });

/** A window whose canvas records size and drawing calls; `context: false` gives no 2D context. */
function fakeWindow({ context = true, blob = BANDED as Blob | null } = {}) {
  const bitmap = { width: 1000, height: 400, close: vi.fn() };
  const calls: unknown[][] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => {
      if (!context) return null;
      const ctx = {
        fillStyle: "",
        fillRect: (...args: unknown[]) => calls.push(["fillRect", ctx.fillStyle, ...args]),
        drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
      };
      return ctx;
    },
    toBlob: (callback: (blob: Blob | null) => void, type: string) => {
      calls.push(["toBlob", type]);
      callback(blob);
    },
  };
  const createImageBitmap = vi.fn(async () => bitmap as unknown as ImageBitmap);
  const win = {
    document: { createElement: () => canvas } as unknown as Document,
    createImageBitmap,
  } satisfies ImageMarginWindow;
  return { win, canvas, calls, bitmap, createImageBitmap };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.backgroundColor = "";
});

describe("band above and below the picture (REQ-714)", () => {
  it.each([
    ["light", "rgb(244, 246, 248)"],
    ["dark", "rgb(17, 22, 28)"],
  ])("puts the PNG between two bands in the background colour (%s)", async (_scheme, background) => {
    const { win, canvas, calls, bitmap, createImageBitmap } = fakeWindow();
    await expect(withImageMargin(PNG, { background, margin: 24 }, win)).resolves.toBe(BANDED);
    expect(createImageBitmap).toHaveBeenCalledWith(PNG);
    // As wide as the picture, a band of 24 px above and below.
    expect([canvas.width, canvas.height]).toEqual([1000, 448]);
    expect(calls).toEqual([
      ["fillRect", background, 0, 0, 1000, 448],
      ["drawImage", bitmap, 0, 24],
      ["toBlob", "image/png"],
    ]);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("leaves the picture as it is without createImageBitmap or without a band", async () => {
    const { win, calls } = fakeWindow();
    await expect(withImageMargin(PNG, { background: "#fff", margin: 0 }, win)).resolves.toBe(PNG);
    await expect(
      withImageMargin(PNG, { background: "#fff", margin: 24 }, { document: win.document }),
    ).resolves.toBe(PNG);
    expect(calls).toEqual([]);
  });

  it("fails without a 2D context or when the PNG cannot be encoded, and frees the bitmap", async () => {
    const noContext = fakeWindow({ context: false });
    await expect(withImageMargin(PNG, { background: "#fff", margin: 24 }, noContext.win)).rejects.toThrow(
      "Canvas 2D context unavailable",
    );
    expect(noContext.bitmap.close).toHaveBeenCalledTimes(1);
    const noBlob = fakeWindow({ blob: null });
    await expect(withImageMargin(PNG, { background: "#fff", margin: 24 }, noBlob.win)).rejects.toThrow(
      "PNG encoding failed",
    );
    expect(noBlob.bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("takes the background of the chart or its nearest painted ancestor, else white", () => {
    const page = document.createElement("div");
    const card = document.createElement("div");
    const chart = document.createElement("div");
    page.append(card);
    card.append(chart);
    document.body.append(page);
    expect(pictureBackground(chart)).toBe("#ffffff");
    document.body.style.backgroundColor = "rgb(17, 22, 28)";
    expect(pictureBackground(chart)).toBe("rgb(17, 22, 28)");
    card.style.backgroundColor = "rgba(0, 0, 0, 0)";
    page.style.backgroundColor = "rgb(244, 246, 248)";
    expect(pictureBackground(chart)).toBe("rgb(244, 246, 248)");
    chart.style.backgroundColor = "rgb(255, 255, 255)";
    expect(pictureBackground(chart)).toBe("rgb(255, 255, 255)");
  });

  it("scales the band with the picture: 12 CSS px at a scale of at least 2", () => {
    expect(IMAGE_MARGIN_PX).toBe(12);
    expect(pictureScale({ devicePixelRatio: 1 })).toBe(2);
    expect(pictureScale({ devicePixelRatio: 0 })).toBe(2);
    expect(pictureScale({ devicePixelRatio: 3 })).toBe(3);
  });
});
