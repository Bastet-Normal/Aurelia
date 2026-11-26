'use strict';

const scope = new URL(self.registration.scope);
const cachePrefix = 'aurelia-shell-' + scope.pathname + '-';
const cacheName = cachePrefix + 'v11';
const shell = [
  './index.html', './manifest.webmanifest', './styles.css?v=11', './market.js?v=11', './model.js?v=11',
  './plans.js?v=11', './quotes.js?v=11', './planner.js?v=11', './app.js?v=11', './favicon.png', './icon-192.png', './icon-512.png',
];
const shellUrls = new Set(shell.map((asset) => new URL(asset, scope).href));
const entry = new URL('./index.html', scope);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(cachePrefix) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate' && (url.pathname === entry.pathname || url.pathname === scope.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.status < 500) return response;
        return await caches.match(entry.href, { cacheName }) ?? response;
      } catch {
        return await caches.match(entry.href, { cacheName }) ?? Response.error();
      }
    })());
  } else if (shellUrls.has(url.href)) {
    event.respondWith(caches.match(event.request, { cacheName }).then((hit) => hit ?? fetch(event.request)));
  }
});
