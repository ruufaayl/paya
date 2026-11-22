// Minimal service worker: caches the app shell so the PWA opens instantly from the home screen.
// It caches ONLY static files (built assets, icons, manifest). The API shares this origin on Vercel, so anything
// else (/v1/*, /healthz, /docs, ...) goes straight to the network: payment status must always come from the server.
const CACHE = "paya-shell-v3";   // v3: drops v2, which could hold API responses
const STATIC = /^\/(assets\/|icon|apple-touch-icon|manifest\.webmanifest|favicon)/;
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
    return;
  }
  if (!STATIC.test(url.pathname)) return;               // API and everything dynamic: network only, never cached
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
