/* Service worker for 速読 — makes the app installable and reliably offline.

   Strategy: STALE-WHILE-REVALIDATE for same-origin requests. Every launch we
   serve the cached response immediately (instant, works with no signal, and
   never hangs on weak "lie-fi" connections), then fetch a fresh copy in the
   background and update the cache so the NEXT launch is up to date. Navigations
   fall back to the cached app shell. Cross-origin requests (Firebase, gstatic,
   any CDN) are never intercepted, so cloud sync goes straight to the network.

   Both the install pre-cache and the background revalidate use cache:'reload'
   to BYPASS the browser HTTP cache — GitHub Pages serves the shell with
   max-age=600, which would otherwise keep handing us stale bytes and stop the
   cache from ever catching up to a new deploy. */
const CACHE = 'sokudoku-v7';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  // Fetch each shell file fresh (reload) and cache it. Done per-file rather than
  // addAll so one missing file can't reject the whole batch and leave us empty.
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(SHELL.map(u =>
      fetch(new Request(u, { cache: 'reload' }))
        .then(res => { if (res && res.ok) return c.put(u, res); })
        .catch(() => {})
    ))
  ));
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

    // Background refresh that bypasses the browser HTTP cache. Built from the URL
    // (a plain GET) so a navigation request can safely take a reload init.
    const revalidate = fetch(new Request(req.url, { cache: 'reload' })).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) {
      e.waitUntil(revalidate);   // serve cache now (instant/offline), update for next launch
      return cached;
    }

    // Nothing cached yet for this URL: try the network, then fall back to the shell.
    const fresh = await revalidate;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html', { ignoreSearch: true }))
          || (await cache.match('./', { ignoreSearch: true }))
          || Response.error();
    }
    return Response.error();
  })());
});
