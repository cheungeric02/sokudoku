/* Service worker for 速読 — makes the app installable and reliably offline.

   Strategy: STALE-WHILE-REVALIDATE for same-origin requests. Every launch we
   serve the cached response immediately (instant, works with no signal, and
   never hangs on weak "lie-fi" connections), then fetch a fresh copy in the
   background and update the cache so the NEXT launch is up to date. Navigations
   fall back to the cached app shell. Cross-origin requests (Firebase, gstatic,
   any CDN) are never intercepted, so cloud sync goes straight to the network. */
const CACHE = 'sokudoku-v7';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  // addAll is atomic — every file listed must exist or nothing caches. All do.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // leave Firebase/gstatic/CDNs to the network

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ignoreSearch so "/", "/index.html" and "/?v=9" all match the cached shell.
    const cached = await cache.match(req, { ignoreSearch: true });

    // Kick off a background refresh; update the cache only on a genuine 200.
    const refresh = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      e.waitUntil(refresh);   // serve cache now, update for next time
      return cached;
    }

    // Nothing cached yet for this URL: try the network, then fall back to the shell.
    const fresh = await refresh;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html', { ignoreSearch: true }))
          || (await cache.match('./', { ignoreSearch: true }))
          || Response.error();
    }
    return Response.error();
  })());
});
