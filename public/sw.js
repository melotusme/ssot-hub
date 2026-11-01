const CACHE = "ssot-shell-v0.2.0";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const assets = await (
        await fetch("./precache.json", { cache: "no-store" })
      ).json();
      const cache = await caches.open(CACHE);
      await cache.addAll([
        "./",
        "./manifest.webmanifest",
        "./icon.svg",
        ...assets,
      ]);
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !(
      event.request.mode === "navigate" ||
      /\/(assets\/|icon\.svg|manifest\.webmanifest)/.test(url.pathname)
    )
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)),
          );
        }
        return response;
      })
      .catch(
        async () =>
          (await caches.match(event.request)) ||
          (event.request.mode === "navigate"
            ? await caches.match("./")
            : undefined) ||
          Response.error(),
      ),
  );
});
