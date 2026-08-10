const CACHE_NAME = "flood-dms-v2"; // bumped so old browsers discard the stale/bad cache from the buggy version
const APP_SHELL = ["/", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls (always want fresh data), cache-first for the app shell.
//
// IMPORTANT: the previous version of this check only caught calls to
// localhost:5000 (local dev) or paths starting with "/predict" or "/alerts".
// In production, the backend lives on a completely different origin
// (onrender.com) — every OTHER endpoint (rescue-operations, equipment,
// teams, volunteers, community-reports, shift-handover, users,
// nearest-facilities, etc.) was slipping through un-caught and being treated
// as cacheable static content. That's why the dashboard would randomly show
// stale or empty data: this service worker was quietly serving old cached
// API responses (or crashing outright when nothing was cached and the
// network call failed) instead of always hitting the real, current data.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isCrossOrigin = url.origin !== self.location.origin;

  if (isCrossOrigin || event.request.method !== "GET") {
    return; // any backend/API call (any origin other than our own) goes straight to the network, un-cached
  }

  event.respondWith(
    caches.match(event.request).then((cached) =>
      fetch(event.request)
        .then((response) => response)
        .catch(() => cached || new Response("", { status: 503, statusText: "Offline" }))
    )
  );
});
