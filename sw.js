const CACHE_NAME = "encrypted-content-v1";
const ENCRYPTED_EXTENSION = ".md.data";

function isEncryptedRequest(request) {
  const url = new URL(request.url);
  return url.pathname.endsWith(ENCRYPTED_EXTENSION);
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

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await purgePlaintextMarkdown();
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (!isEncryptedRequest(event.request)) {
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
