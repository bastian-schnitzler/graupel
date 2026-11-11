// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * When a map counts as not loaded (REQ-771): only then does the map dialog show its error card (REQ-492). A slow device
 * may take a while, and single tiles, glyphs or sprites may fail on the way; neither is a map that cannot load. The map
 * fails when it cannot be made at all (no WebGL), when its style cannot be loaded, or when it has not loaded by a
 * generous deadline. A map that loads after its card showed takes the card away again.
 */

/** How long a map may take to load before the error card shows (REQ-771); an iPad Air 2 needs several seconds. */
export const MAP_LOAD_TIMEOUT_MS = 20_000;

export interface MapLoadWatch {
  /** The map has loaded (its first complete picture): no card, and a card shown before goes away (`onLoad`). */
  loaded(): void;
  /** The map cannot load (no WebGL, no style): the card shows (`onError`), unless the map has loaded already. */
  failed(): void;
  /** The map is gone: the deadline stops, nothing is reported any more. */
  stop(): void;
}

/**
 * Watches a map that is being made: `onError` once it fails or misses the deadline, `onLoad` once it has loaded.
 * Errors of single resources are not reported here at all; the maps leave them to the library.
 */
export function watchMapLoad(
  report: { onError: () => void; onLoad: () => void },
  timeout = MAP_LOAD_TIMEOUT_MS,
): MapLoadWatch {
  let state: "loading" | "failed" | "loaded" | "stopped" = "loading";
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => fail(), timeout);
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const fail = () => {
    if (state !== "loading") return;
    state = "failed";
    clear();
    report.onError();
  };
  return {
    loaded() {
      if (state === "loaded" || state === "stopped") return;
      state = "loaded";
      clear();
      report.onLoad();
    },
    failed: fail,
    stop() {
      state = "stopped";
      clear();
    },
  };
}
