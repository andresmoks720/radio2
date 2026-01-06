const CACHE_VERSION = "v1";
const CACHE_NAMES = [`payload-cache-${CACHE_VERSION}`];
const CACHE_NAME = CACHE_NAMES[0];
const DATA_EXTENSION = ".md.data";

function isPayloadRequest(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith(DATA_EXTENSION);
}

function isPlaintextMarkdownRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  return pathname.endsWith(".md") || pathname.endsWith(".markdown");
}

async function purgePlaintextMarkdown() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.map(async (cacheName) => {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      await Promise.all(
        requests.map((request) => {
          if (isPlaintextMarkdownRequest(request)) {
            return cache.delete(request);
          }
          return Promise.resolve(false);
        })
      );
    })
  );
}

async function cleanupCaches() {
  await purgePlaintextMarkdown();
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => !CACHE_NAMES.includes(name))
      .map((name) => caches.delete(name))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await cleanupCaches();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "cleanup") {
    event.waitUntil(cleanupCaches());
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (!isPayloadRequest(event.request)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }
      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })()
  );
});
