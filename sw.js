const CACHE_NAME = "negocios-inteligentes-v2";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=20260613-1",
  "/app.js?v=20260613-1",
  "/manifest.webmanifest",
  "/data/bi-data.json",
  "/data/rondonia-municipios.geojson",
  "/assets/ni-logo.svg",
  "/assets/app-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
