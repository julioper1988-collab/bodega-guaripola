/* Service Worker — Bodega Guaripola v4
   Objetivos:
   - Nunca servir un index.html viejo cuando hay Internet.
   - Nunca simular éxito (202) para escrituras Supabase que fallaron offline.
   - Mantener soporte offline solo para la interfaz estática.
*/
const CACHE_NAME = 'guaripola-v4';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;
  const method = req.method;

  // SUPABASE: siempre red directa. Si falla, debe fallar de verdad para que
  // el sistema conserve la compra/precio en pantalla y permita reintentar.
  if(url.includes('supabase.co') || url.includes('supabase.io')){
    event.respondWith(fetch(req));
    return;
  }

  // Navegación / index.html: NETWORK FIRST.
  // Así una publicación nueva en GitHub se ve inmediatamente cuando hay red.
  if(req.mode === 'navigate' || /\/index\.html(?:\?|$)/i.test(url)){
    event.respondWith(
      fetch(req).then(response => {
        if(response && response.ok){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', clone));
        }
        return response;
      }).catch(async () => {
        return (await caches.match('./index.html')) || new Response('Sin conexión', {status:503});
      })
    );
    return;
  }

  // Librerías externas: cache-first, porque son recursos estáticos.
  if(url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com') ||
     url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')){
    event.respondWith(
      caches.match(req).then(cached => {
        if(cached) return cached;
        return fetch(req).then(response => {
          if(response && response.ok){
            const clone=response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req,clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Demás assets propios: network-first con fallback a caché.
  event.respondWith(
    fetch(req).then(response => {
      if(response && response.ok && response.type !== 'opaque'){
        const clone=response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req,clone));
      }
      return response;
    }).catch(async () => {
      return (await caches.match(req)) || new Response('Sin conexión', {status:503});
    })
  );
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
