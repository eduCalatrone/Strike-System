// Service worker da galeria de protocolos (/protocolos/).
// Escopo só de /protocolos/: não mexe no app do Controle (o /sw.js da raiz continua cuidando do resto do site).
// Guarda a página, os ícones e as fontes para o app abrir mesmo sem internet.
// Os protocolos não passam por aqui: ficam na pasta do computador e são lidos direto pelo navegador.
// Ao mudar este arquivo, trocar o número de CACHE.
const CACHE = 'sd-protocolos-v1';
const FONTES = 'sd-protocolos-fontes-v1';
const ARQUIVOS = [
  '/protocolos/',
  '/protocolos/manifest.webmanifest',
  '/protocolos/icons/icon-192.png',
  '/protocolos/icons/favicon-32.png',
  '/logo-letras.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // Só apaga caches antigos desta galeria (os do Controle, sd-app-* e sd-fotos-*, ficam).
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('sd-protocolos-') && k !== CACHE && k !== FONTES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const eFonte = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fontes do Google: do cache, e atualiza por trás.
  if (eFonte(url)) {
    e.respondWith(caches.open(FONTES).then(async c => {
      const guardada = await c.match(req);
      const rede = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()).catch(() => {}); return r; }).catch(() => guardada);
      return guardada || rede;
    }));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Página: sempre a versão nova da internet (atualiza sozinho); sem internet, a última guardada.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(r => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put('/protocolos/', copia)).catch(() => {}); }
        return r;
      })
      .catch(async () => (await caches.match('/protocolos/')) || Response.error()));
    return;
  }

  // Ícones, manifest e logo: da internet quando der (guarda a cópia); sem internet, do cache.
  if (ARQUIVOS.includes(url.pathname) || url.pathname.startsWith('/protocolos/icons/')) {
    e.respondWith(fetch(req)
      .then(r => { if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)).catch(() => {}); } return r; })
      .catch(async () => (await caches.match(req)) || Response.error()));
  }
});

// Aviso de imagem nova na pasta: tocar abre a galeria já na tela de cadastrar.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const j = janelas.find(c => new URL(c.url).pathname.startsWith('/protocolos'));
    if (j) {
      try { await j.focus(); } catch {}
      j.postMessage({ tipo: 'organizar' });
      return;
    }
    await self.clients.openWindow('/protocolos/#organizar');
  })());
});
