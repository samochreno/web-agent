const CACHE_VERSION = "v1";
const CACHE_NAME = `web-agent-cache-${CACHE_VERSION}`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/pwa-icon.svg",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request)
        .then((response) => {
          if (response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(
          () => new Response("Offline", { status: 503, statusText: "Offline" })
        );
    })
  );
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {
    title: "Cortana",
    body: "You have a new update.",
  };
  const title = data.title;
  const options = {
    body: data.body,
    icon: "/pwa-icon.svg",
    badge: "/pwa-icon.svg",
    data: data.url ? { url: data.url } : undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => client.url === url);
        if (existing) {
          existing.focus();
          return;
        }
        self.clients.openWindow(url);
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
