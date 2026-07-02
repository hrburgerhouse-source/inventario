// SW sin caché — borra todo lo anterior y deja pasar al navegador
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// No interceptamos fetch — el navegador pide directo a GitHub Pages
