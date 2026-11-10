const SHELL = "edisi-shell-v3";
const DATA = "edisi-data-v3";
const ASSETS = "edisi-assets-v1";
const SHELL_FILES = ["./", "app.js", "style.css", "manifest.json", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, ASSETS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Data edisi berubah saat pipeline berjalan: jaringan dulu, cache sebagai cadangan offline. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw new Error("offline");
  }
}

/** Gambar content-addressed: tidak pernah berubah, aman cache-first. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.endsWith("manifest.json") || url.pathname.includes("/data/")) {
    e.respondWith(networkFirst(e.request, DATA));
    return;
  }
  if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    e.respondWith(cacheFirst(e.request, ASSETS));
  }
});

self.addEventListener("push", (e) => {
  const data = e.data?.json?.() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? "Edisi Pagi", {
      body: data.body ?? "Edisi baru siap.",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url ?? "/"));
});
