/*
 * Offline cache.
 *
 * Only same-origin GETs are handled, and only ever from this origin's own
 * files — the worker has no route that would let it send a document anywhere.
 * The shell is cached on install; everything else (tool modules, the PDF
 * engine, fonts, OCR data) is cached the first time it is asked for, so the
 * app keeps working with the network switched off.
 */

const VERSION = 'quire-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/icon.svg',
  './assets/fonts/ui/archivo-latin-standard-normal.woff2',
  './assets/fonts/ui/ibm-plex-mono-latin-400-normal.woff2',
  './assets/fonts/ui/ibm-plex-mono-latin-600-normal.woff2',
  './src/main.js',
  './src/ui/kit.js',
  './src/ui/dom.js',
  './src/ui/icons.js',
  './src/ui/toast.js',
  './src/ui/workbench.js',
  './src/ui/fields.js',
  './src/core/monitor.js',
  './src/core/lib.js',
  './src/tools/registry.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One failed asset should not fail the whole install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) {
      // Refresh in the background so an update lands on the next visit.
      event.waitUntil(refresh(request));
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(VERSION);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      // Offline and not cached: fall back to the shell for navigations.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline');
    }
  })());
});

async function refresh(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(VERSION);
      await cache.put(request, response);
    }
  } catch { /* still offline */ }
}
