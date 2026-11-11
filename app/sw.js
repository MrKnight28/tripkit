// TripKit service worker (web/PWA mode) — app shell + OpenFreeMap map cache
const SHELL = 'tripkit-shell-v3';
const MAPC = 'tripkit-map-v2';
const ASSETS = ['./', './index.html', './demo-trip.js', './app.js', './styles.css', './themes.css', './manifest.webmanifest',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== MAPC).map(k => caches.delete(k)))).then(() => self.clients.claim())));

// Vector tiles live under a dated folder (/planet/2026..._pt/z/x/y.pbf) that changes weekly;
// store them under a stable key so saved areas survive data updates.
const keyFor = u => /\.pbf$/.test(u.pathname) && /^\/planet\//.test(u.pathname)
  ? u.origin + '/planet/_/' + u.pathname.split('/').slice(-3).join('/') : u.href;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname === 'tiles.openfreemap.org') {
    const key = keyFor(url);
    const isData = /\.(pbf|png|json)$/.test(url.pathname) && !/^\/styles\//.test(url.pathname) && url.pathname.split('/').length > 2;
    e.respondWith(caches.open(MAPC).then(async c => {
      const hit = await c.match(key);
      if (hit && isData) return hit;                       // tiles, fonts, sprites: cache-first
      try { const r = await fetch(e.request); if (r.ok) c.put(key, r.clone()); return r; } // style/tilejson: network-first
      catch { return hit || new Response('', { status: 504 }); }
    }));
    return;
  }
  if (url.hostname === 'upload.wikimedia.org') {
    e.respondWith(caches.open(MAPC).then(async c => { const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; } catch { return new Response('', { status: 504 }); } }));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || c.match('./index.html');
    }));
  }
});
