/* ── Service Worker — Bodega Guaripola ── */
const CACHE_NAME = 'guaripola-v1';

// Archivos que se cachean al instalar
const PRECACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/@zxing/library@latest'
];

/* ── INSTALL: precachear recursos principales ── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Precacheando recursos...');
      // Cachear de a uno para que un fallo no rompa todo
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(err => {
          console.warn('[SW] No se pudo cachear:', url, err);
        }))
      );
    }).then(function() {
      console.log('[SW] Instalación completa');
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE: limpiar cachés viejas ── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Eliminando caché vieja:', k);
          return caches.delete(k);
        })
      );
    }).then(function() {
      console.log('[SW] Activado, tomando control de todas las tabs');
      return self.clients.claim();
    })
  );
});

/* ── FETCH: estrategia Network-first para API de Supabase,
            Cache-first para recursos estáticos ── */
self.addEventListener('fetch', function(event) {
  const url = event.request.url;

  // Supabase y APIs externas: siempre ir a la red (no cachear datos)
  if (url.includes('supabase.co') || url.includes('supabase.io')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Recursos estáticos: Cache-first con fallback a red
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) {
        // Actualizar en background para la próxima vez
        fetch(event.request).then(function(fresh) {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE_NAME).then(c => c.put(event.request, fresh.clone()));
          }
        }).catch(() => {});
        return cached;
      }

      // No está en caché: ir a la red
      return fetch(event.request).then(function(response) {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        // Guardar en caché para la próxima
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(function() {
        // Sin red y sin caché: devolver página principal como fallback
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return new Response('Sin conexión', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
