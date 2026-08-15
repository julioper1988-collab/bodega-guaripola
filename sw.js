/* ── Service Worker — Bodega Guaripola v4 ── */
const CACHE_NAME = 'guaripola-v4';
const DB_NAME = 'guaripola-offline';
const DB_VERSION = 1;
const SYNC_STORE = 'sync_queue';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './precio-venta-compras-fix.js'
];

/* ── IndexedDB helpers ── */
function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(SYNC_STORE)){
        const store = db.createObjectStore(SYNC_STORE, {keyPath:'id', autoIncrement:true});
        store.createIndex('ts', 'ts', {unique:false});
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbAdd(data){
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).add({...data, ts: Date.now()});
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  }));
}

function dbGetAll(){
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly');
    const req = tx.objectStore(SYNC_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result||[]);
    req.onerror   = e => reject(e.target.error);
  }));
}

function dbDelete(id){
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite');
    tx.objectStore(SYNC_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  }));
}

/* Inyecta el hotfix en documentos HTML sin tener que alterar el index gigante. */
async function injectCompraPrecioFix(response){
  try{
    if(!response || response.status !== 200) return response;
    const type = response.headers.get('content-type') || '';
    if(!type.includes('text/html')) return response;
    let html = await response.text();
    if(html.includes('precio-venta-compras-fix.js')) return new Response(html,{status:response.status,statusText:response.statusText,headers:response.headers});
    const tag = '<script src="./precio-venta-compras-fix.js"></script>';
    html = html.includes('</body>') ? html.replace('</body>', tag+'\n</body>') : html + tag;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  }catch(e){
    console.warn('[SW] No se pudo inyectar fix de precios:', e);
    return response;
  }
}

/* ── INSTALL ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        PRECACHE.map(url => cache.add(url).catch(err =>
          console.warn('[SW] No se pudo cachear:', url, err)
        ))
      );
    }).then(() => {
      console.log('[SW] v4 instalado');
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => {
      console.log('[SW] v4 activado');
      return self.clients.claim();
    })
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const method = event.request.method;

  // Supabase POST/PATCH/DELETE offline: encolar para sync posterior
  if((url.includes('supabase.co') || url.includes('supabase.io')) &&
     (method === 'POST' || method === 'PATCH' || method === 'DELETE')){
    event.respondWith(
      fetch(event.request.clone()).catch(async () => {
        try{
          const body = await event.request.clone().text();
          await dbAdd({
            url,
            method,
            headers: Object.fromEntries(event.request.headers.entries()),
            body,
            ts: Date.now()
          });
          console.log('[SW] Request encolada offline:', method, url);
        }catch(e){
          console.error('[SW] Error encolando:', e);
        }
        return new Response(JSON.stringify({offline:true, queued:true}), {
          status: 202,
          headers: {'Content-Type':'application/json'}
        });
      })
    );
    return;
  }

  // Supabase GET: network-first, sin cachear datos
  if(url.includes('supabase.co') || url.includes('supabase.io')){
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({data:[], error:{message:'Sin conexión'}}), {
          status: 503,
          headers: {'Content-Type':'application/json'}
        })
      )
    );
    return;
  }

  // CDN externas (supabase-js, zxing): cache-first
  if(url.includes('cdn.jsdelivr.net') || url.includes('unpkg.com') ||
     url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')){
    event.respondWith(
      caches.match(event.request).then(cached => {
        if(cached) return cached;
        return fetch(event.request).then(response => {
          if(response && response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', {status: 503}));
      })
    );
    return;
  }

  // Navegaciones: usar caché/red y siempre inyectar el fix en el HTML servido.
  if(event.request.mode === 'navigate' || event.request.destination === 'document'){
    event.respondWith(
      caches.match(event.request).then(async cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if(response && response.status === 200 && response.type !== 'opaque'){
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => null);

        const base = cached || await fetchPromise || await caches.match('./index.html');
        if(!base) return new Response('Sin conexión', {status:503});
        return injectCompraPrecioFix(base.clone());
      })
    );
    return;
  }

  // Assets propios: cache-first + background update
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if(response && response.status === 200 && response.type !== 'opaque'){
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => null);

      return cached || fetchPromise.then(r => r || new Response('Sin conexión', {status:503}));
    })
  );
});

/* ── BACKGROUND SYNC: reenviar queue cuando vuelve la red ── */
self.addEventListener('sync', event => {
  if(event.tag === 'bg-sync-queue'){
    event.waitUntil(flushQueue());
  }
});

async function flushQueue(){
  const items = await dbGetAll();
  if(!items.length) return;
  console.log('[SW] Sincronizando', items.length, 'operaciones offline...');

  for(const item of items){
    try{
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body
      });
      if(res.ok || res.status < 500){
        await dbDelete(item.id);
        console.log('[SW] Sync OK:', item.method, item.url);
      }
    }catch(e){
      console.warn('[SW] Sync falló, se reintentará:', e.message);
      break;
    }
  }

  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({type:'SYNC_COMPLETE'}));
}

/* ── Mensaje manual de flush (para botón "Sincronizar" en la app) ── */
self.addEventListener('message', event => {
  if(event.data?.type === 'FLUSH_QUEUE'){
    flushQueue();
  }
  if(event.data?.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
});
