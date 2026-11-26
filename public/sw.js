// Service worker: makes the app installable and lets the app itself (HTML, JS, CSS, icons)
// load from the phone instead of the network. It deliberately does NOT touch anything
// cross-origin (Firestore, Auth, App Check, MazeMap) or Firebase Hosting's reserved /__/ URLs
// (the Google sign-in handler), so data always comes from the network or from src/cache.js.
//
// Strategies:
//   page navigations   network first, falling back to the last copy (so the app opens offline)
//   /assets/*          cache first (file names contain a content hash, so they never change)
//   other same-origin  stale-while-revalidate (manifest, icons)
//
// Bump VERSION when this file's caching logic or SHELL_FILES change (it clears the old cache).

const VERSION = "v2";
const SHELL = `throneadvisor-shell-${VERSION}`;
const SHELL_FILES = ["/", "/manifest.webmanifest", "/android-chrome-192x192.png", "/android-chrome-512x512.png"];
const MAX_ASSETS = 60; // each deploy adds a handful of hashed files; keep the newest ~10 deploys

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("throneadvisor-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase, MazeMap, Google: straight to the network
  if (url.pathname.startsWith("/__/") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") event.respondWith(networkFirstPage(request));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(request));
});

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("/", response.clone()); // single-page app: every route is index.html
    return response;
  } catch {
    return (await cache.match("/")) ?? new Response("You're offline and the app hasn't been opened here before.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
    trimAssets(cache);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit ?? network;
}

// Cache keys come back in insertion order, so the oldest hashed assets go first.
async function trimAssets(cache) {
  const assets = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith("/assets/"));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((r) => cache.delete(r)));
}
