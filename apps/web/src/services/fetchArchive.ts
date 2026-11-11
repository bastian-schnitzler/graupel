// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Archive of the installed app (REQ-684): every successful fetch of the forecast is kept per place with the time it was
 * fetched, in the browser's IndexedDB (no library). The page reads it through the small `FetchArchive` interface, so
 * that the grouping and the cleanup can be tested with the in-memory variant (jsdom has no IndexedDB). How long the
 * fetches are kept follows the setting of REQ-686 (default unlimited): older ones are deleted.
 */
import type { ForecastResult } from "@graupel/download";

/** One archived fetch without its forecast: what the history lists. */
export interface ArchivedFetchInfo {
  /** `<place key>@<fetchedAt>`: one entry per place and fetch. */
  id: string;
  /** The place (`placeKey`). */
  point: string;
  /** When it was fetched (epoch ms). */
  fetchedAt: number;
}

/** One archived fetch with its forecast. */
export interface ArchivedFetch extends ArchivedFetchInfo {
  result: ForecastResult;
}

/** Storage of the archive. */
export interface FetchArchive {
  /** Stores a fetch; one with the same id is replaced (a chain rebuilt from the same fetch). */
  put: (entry: ArchivedFetch) => Promise<void>;
  /** The fetches of a place, newest first. */
  list: (point: string) => Promise<ArchivedFetchInfo[]>;
  /** One fetch with its forecast, if it is still there. */
  get: (id: string) => Promise<ArchivedFetch | undefined>;
  /** Deletes every fetch made before `time`. */
  removeBefore: (time: number) => Promise<void>;
}

/** Id of a place's fetch. */
export const archiveId = (point: string, fetchedAt: number) => `${point}@${fetchedAt}`;

const DAY_MS = 86_400_000;

/** Earliest fetch time the archive keeps at `now` with `days` (REQ-686); `null` keeps every one. */
export function archiveCutoff(days: number | "unlimited", now: number): number | null {
  return days === "unlimited" ? null : now - days * DAY_MS;
}

/**
 * The forecast as the archive keeps it: without the raw series (the page does not show them, and they are the biggest
 * part) and with the models' errors as text, so that it can be stored as it is (structured clone).
 */
export function archivedResult(result: ForecastResult): ForecastResult {
  const errors = Object.fromEntries(Object.entries(result.errors).map(([model, error]) => [model, String(error)]));
  return { ...result, raw: [], errors };
}

const newestFirst = (a: ArchivedFetchInfo, b: ArchivedFetchInfo) => b.fetchedAt - a.fetchedAt;
const info = ({ id, point, fetchedAt }: ArchivedFetchInfo): ArchivedFetchInfo => ({ id, point, fetchedAt });

/** The archive in memory: for tests and for browsers without IndexedDB (kept for this visit only). */
export function createMemoryArchive(initial: readonly ArchivedFetch[] = []): FetchArchive {
  const entries = new Map(initial.map((entry) => [entry.id, entry]));
  return {
    put: async (entry) => {
      entries.set(entry.id, entry);
    },
    list: async (point) => [...entries.values()].filter((entry) => entry.point === point).map(info).sort(newestFirst),
    get: async (id) => entries.get(id),
    removeBefore: async (time) => {
      for (const [id, entry] of entries) if (entry.fetchedAt < time) entries.delete(id);
    },
  };
}

const DB_VERSION = 1;
/** Small records (id, place, time) that the history lists, indexed by place and by time. */
const FETCHES = "fetches";
/** The forecasts by id, read only when a fetch is shown. */
const RESULTS = "results";

/** Promise of an IndexedDB request. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Promise of a transaction's end. */
function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException("Aborted", "AbortError"));
  });
}

/** The archive in IndexedDB (database `name`), opened on first use. */
export function createIndexedDbArchive(factory: IDBFactory, name = "graupel-archive"): FetchArchive {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const fetches = db.createObjectStore(FETCHES, { keyPath: "id" });
        fetches.createIndex("point", "point");
        fetches.createIndex("fetchedAt", "fetchedAt");
        db.createObjectStore(RESULTS);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opened = null;
        reject(request.error);
      };
    }));

  return {
    put: async (entry) => {
      const db = await open();
      const transaction = db.transaction([FETCHES, RESULTS], "readwrite");
      transaction.objectStore(FETCHES).put(info(entry));
      transaction.objectStore(RESULTS).put(entry.result, entry.id);
      await finished(transaction);
    },
    list: async (point) => {
      const db = await open();
      const index = db.transaction(FETCHES).objectStore(FETCHES).index("point");
      const rows = await done(index.getAll(IDBKeyRange.only(point)) as IDBRequest<ArchivedFetchInfo[]>);
      return rows.map(info).sort(newestFirst);
    },
    get: async (id) => {
      const db = await open();
      const transaction = db.transaction([FETCHES, RESULTS]);
      const [row, result] = await Promise.all([
        done(transaction.objectStore(FETCHES).get(id) as IDBRequest<ArchivedFetchInfo | undefined>),
        done(transaction.objectStore(RESULTS).get(id) as IDBRequest<ForecastResult | undefined>),
      ]);
      return row && result ? { ...info(row), result } : undefined;
    },
    removeBefore: async (time) => {
      const db = await open();
      const transaction = db.transaction([FETCHES, RESULTS], "readwrite");
      const fetches = transaction.objectStore(FETCHES);
      const results = transaction.objectStore(RESULTS);
      const ids = await done(fetches.index("fetchedAt").getAllKeys(IDBKeyRange.upperBound(time, true)));
      for (const id of ids) {
        fetches.delete(id);
        results.delete(id);
      }
      await finished(transaction);
    },
  };
}

/**
 * Stores a fetch and deletes those older than the archive keeps (REQ-686); `days` and `now` give the cutoff. A full or
 * blocked storage loses the fetch, the page goes on.
 */
export async function archiveFetch(
  archive: FetchArchive,
  entry: ArchivedFetch,
  days: number | "unlimited",
  now: number,
): Promise<void> {
  await archive.put(entry);
  const cutoff = archiveCutoff(days, now);
  if (cutoff !== null) await archive.removeBefore(cutoff);
}

let pageArchive: FetchArchive | null = null;

/** The page's archive: IndexedDB where the browser has it, else in memory. */
export function defaultFetchArchive(): FetchArchive {
  if (!pageArchive) {
    const factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
    pageArchive = factory ? createIndexedDbArchive(factory) : createMemoryArchive();
  }
  return pageArchive;
}
