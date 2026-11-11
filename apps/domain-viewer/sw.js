// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later

// Service worker for the model domain viewer: keeps OpenFreeMap tiles,
// fonts and sprites for 90 days (cache first).
//
// Tile URLs carry the planet build (/planet/20261011_080001_pt/z/x/y.pbf)
// and the build changes every few days, which would invalidate the
// browser's HTTP cache. The cache key drops the build, so a cached tile
// survives new builds until it is 90 days old.

const CACHE = "openfreemap-v1";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const STORED_AT = "x-sw-stored-at";
const TILE = /^\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/;

function cacheKey(url) {
  const tile = url.pathname.match(TILE);
  return tile ? `${url.origin}/planet/${tile[1]}` : url.href;
}

const fresh = (response) =>
  Date.now() - Number(response.headers.get(STORED_AT) || 0) < MAX_AGE_MS;

async function store(cache, key, response) {
  const headers = new Headers(response.headers);
  headers.set(STORED_AT, String(Date.now()));
  const body = await response.clone().arrayBuffer();
  await cache.put(key, new Response(body, { status: response.status, headers }));
}

async function cached(request) {
  const url = new URL(request.url);
  const key = cacheKey(url);
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);
  if (hit && fresh(hit)) return hit;
  try {
    const response = await fetch(request);
    if (response.ok) await store(cache, key, response);
    return response;
  } catch (error) {
    if (hit) return hit; // offline: an expired tile beats an empty map
    throw error;
  }
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response || !fresh(response)) await cache.delete(request);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;
  const cacheable = url.hostname === "tiles.openfreemap.org" && event.request.method === "GET"
    && (TILE.test(path) || path.startsWith("/fonts/") || path.startsWith("/sprites/"));
  if (cacheable) event.respondWith(cached(event.request));
});
