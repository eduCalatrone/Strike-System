// Service worker do app instalado (acesso interno).
// Só guarda a página e as imagens da marca para o app abrir mesmo com a internet ruim.
// Os dados (/api) nunca passam pelo cache: sempre vêm do banco.
const CACHE = 'sd-app-v1';
const ARQUIVOS = ['/', '/logo-letras.png', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Página: sempre a versão nova da internet; sem internet, a última guardada.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(r => {
        if (r.ok && url.pathname === '/') { const copia = r.clone(); caches.open(CACHE).then(c => c.put('/', copia)); }
        return r;
      })
      .catch(() => caches.match('/')));
    return;
  }

  // Imagens da marca: do cache, se tiver.
  if (ARQUIVOS.includes(url.pathname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
  }
});
