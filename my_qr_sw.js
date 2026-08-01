const CACHE_NAME = 'step-my-qr-v8-no-attendance-panel';
const APP_ASSETS = [
  './my_qr.html',
  './my_qr_runtime.js',
  './vendor/qrcode.min.js',
  './my-qr-icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.includes('/student-QR/')) return;

  const isQrPage = event.request.mode === 'navigate' || url.pathname.endsWith('/my_qr.html');
  if (isQrPage) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./my_qr.html', response.clone()));
        return response;
      }).catch(() => caches.match('./my_qr.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      });
    })
  );
});
