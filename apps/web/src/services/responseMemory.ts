// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Memory of Open-Meteo answers (REQ-497, REQ-504): a `fetch` for the download client that keeps the body of every
 * successful GET by its URL. `downloadChain` asks each model of a chain with its own URL, and moving a boundary leaves
 * those URLs alone (the requested hours follow the model's capability and the chain end, not its slice, and the
 * page keeps the "now" of a place), so a moved boundary rebuilds the chain from memory without a new download. The
 * answers do not expire by default; the page forgets them when another place loads or on a reload.
 */
import type { FetchLike } from "@graupel/download";

export interface ResponseMemoryOptions {
  /** Network access (default the global `fetch`). */
  fetch?: FetchLike;
  /** How long an answer is kept, in milliseconds (default: until cleared). */
  ttlMs?: number;
  /** Most answers kept; the oldest goes first (default 128). */
  maxEntries?: number;
  /** Clock (tests). */
  now?: () => number;
}

export interface ResponseMemory {
  /** `fetch` that answers a known GET from memory and remembers new successful ones. */
  fetch: FetchLike;
  /** Forgets every answer (a reload bypasses the memory this way). */
  clear: () => void;
  /** Number of answers kept. */
  readonly size: number;
}

interface Entry {
  expires: number;
  status: number;
  statusText: string;
  contentType: string | null;
  body: string;
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

/**
 * Whether an answer is kept: successful ones, and a 404 (a `meta.json` some models do not have, which the client reads
 * as "no run information"), so a rebuilt chain does not ask again. Other errors always go to the network again.
 */
const keep = (url: string, response: Response) =>
  response.ok || (response.status === 404 && /\/meta\.json(?:[?#]|$)/.test(url));

/** A `fetch` that memoizes GET answers by URL (see `keep`); other methods always go to the network. */
export function createResponseMemory(options: ResponseMemoryOptions = {}): ResponseMemory {
  const network: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const ttlMs = options.ttlMs ?? Number.POSITIVE_INFINITY;
  const maxEntries = Math.max(1, options.maxEntries ?? 128);
  const now = options.now ?? Date.now;
  // Insertion order is age: a stored answer is re-inserted, so the first key is the oldest.
  const entries = new Map<string, Entry>();

  const answer = (entry: Entry) => {
    const headers: Record<string, string> = {};
    if (entry.contentType) headers["content-type"] = entry.contentType;
    // A fresh Response each time: a body can only be read once.
    return new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers });
  };

  const memoFetch: FetchLike = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") return network(input, init);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError(signal);
    const known = entries.get(input);
    if (known) {
      if (known.expires > now()) return answer(known);
      entries.delete(input);
    }
    const response = await network(input, init);
    if (!keep(input, response)) return response;
    const body = await response.text();
    const entry: Entry = {
      expires: now() + ttlMs,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      body,
    };
    entries.delete(input);
    entries.set(input, entry);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    return answer(entry);
  };

  return {
    fetch: memoFetch,
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}
