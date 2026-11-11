const SHELL = "edisi-shell-v4";
const DATA = "edisi-data-v4";
const ASSETS = "edisi-assets-v1";

/** Shell minimal agar edisi terakhir tetap terbaca saat offline. */
const SHELL_FILES = [
  "./",
  "app.js",
  "style.css",
  "manifest.webmanifest",
  "config.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      // Satu berkas hilang tidak boleh menggagalkan seluruh instalasi.
      .then((c) => Promise.allSettled(SHELL_FILES.map((f) => c.add(f))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, ASSETS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Data edisi berubah saat pipeline berjalan: jaringan dulu, cache sebagai cadangan offline. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
      return res;
    }
    // 502 dari proxy/hosting bukan data edisi; pakai salinan terakhir.
    return cached ?? res;
  } catch {
    if (cached) return cached;
    throw new Error("offline");
  }
}

/** Aset berversi (?v=hash) dan gambar content-addressed: aman cache-first. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
      return res;
    }
  } catch {
    /* offline */
  }
  // HTML memakai app.js?v=<hash>. Saat offline, hash itu mungkin belum
  // tersimpan; salinan tanpa query dari instalasi tetap bisa dipakai.
  const name = new URL(request.url).pathname.split("/").pop() ?? "";
  return (await cache.match(name)) ?? (await cache.match(request)) ?? Response.error();
}

/** Navigasi offline: sajikan shell terakhir, bukan halaman error browser. */
async function shellFallback(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    // Proxy/hosting yang mati bisa menjawab 502; itu bukan halaman aplikasi.
    if (res.ok) return res;
  } catch {
    /* offline */
  }
  return (
    (await cache.match("./")) ??
    (await cache.match("index.html")) ??
    new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })
  );
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (e.request.mode === "navigate") {
    e.respondWith(shellFallback(e.request));
    return;
  }
  if (url.pathname.endsWith("manifest.json") || url.pathname.includes("/data/")) {
    e.respondWith(networkFirst(e.request, DATA));
    return;
  }
  if (url.pathname.endsWith("app.js") || url.pathname.endsWith("style.css") || url.pathname.endsWith("config.json")) {
    e.respondWith(cacheFirst(e.request, SHELL));
    return;
  }
  if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    e.respondWith(cacheFirst(e.request, ASSETS));
  }
});

self.addEventListener("push", (e) => {
  const data = e.data?.json?.() ?? {};
  // URL dari server relatif terhadap scope, bukan akar domain: situs ini
  // dilayani dari /edisi-pagi/, jadi "/" akan membuka halaman yang salah.
  const target = new URL(data.url ?? "./", self.registration.scope).href;

  e.waitUntil(
    self.registration.showNotification(data.title ?? "Edisi Pagi", {
      body: data.body ?? "Edisi baru siap.",
      icon: new URL("icons/icon-192.png", self.registration.scope).href,
      badge: new URL("icons/icon-192.png", self.registration.scope).href,
      data: { url: target },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.url ?? self.registration.scope;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open) {
        open.navigate(target);
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
