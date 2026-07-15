const CACHE_NAME = "flood-dms-v1";
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

// Network-first for API calls (always want fresh data), cache-first for the app shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isApiCall = url.port === "5000" || url.pathname.startsWith("/predict") || url.pathname.startsWith("/alerts");

  if (isApiCall || event.request.method !== "GET") {
    return; // let these go straight to the network, un-cached
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => cached))
  );
});
