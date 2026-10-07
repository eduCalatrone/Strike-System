// Service worker do app instalado (acesso interno).
// Só guarda a página e as imagens da marca para o app abrir mesmo com a internet ruim.
// Os dados (/api) nunca passam pelo cache: sempre vêm do banco.
const CACHE = 'sd-app-v3';
const ARQUIVOS = ['/', '/logo-letras.png', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

/* Telas abertas com o site antigo (sem o aviso de versão nova): recarrega uma vez, sozinho, quando é seguro.
   O site avisa a presença a cada 20 s com a tela aberta; o site novo manda "app" junto e fica de fora.
   Só recarrega numa tela de lista, visível e sem nada sendo salvo (nenhum envio de dados ou foto nos
   últimos 90 s). Nunca com entrada de veículo, câmera, veículo aberto, estoque, agenda ou ajustes. */
const TELAS_LISTA = new Set(['Início', 'Relatórios', 'Histórico', 'Status da equipe', 'Histórico da equipe']);
const QUIETO_MS = 90e3;
const iniciado = Date.now();       // envios de antes disso não foram vistos: espera 90 s
const ultimoEnvio = new Map();     // tela aberta (clientId) -> último envio de dados ou foto
async function talvezAtualizar(id, req) {
  if (Date.now() - iniciado < QUIETO_MS || Date.now() - (ultimoEnvio.get(id) || 0) < QUIETO_MS) return;
  let b = null;
  try { b = await req.json(); } catch { return; }
  if (!b || b.app || b.saiu || !TELAS_LISTA.has(b.tela)) return;
  const c = await self.clients.get(id);
  if (!c || c.visibilityState === 'hidden' || new URL(c.url).pathname !== '/') return;
  ultimoEnvio.set(id, Date.now()); // uma vez só
  // Endereço sem "#": abre a página de novo (com "#" seria só troca de tela) e cai no Início.
  try { await c.navigate('/'); } catch {}
}

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
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === 'POST' && e.clientId) {
    if (url.pathname === '/api/dados' || url.pathname === '/api/foto') ultimoEnvio.set(e.clientId, Date.now());
    else if (url.pathname === '/api/presenca') e.waitUntil(talvezAtualizar(e.clientId, req.clone()));
    return; // o pedido segue normal para a internet
  }
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;

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

// Notificações (api/notificacoes): mostra o aviso e, ao tocar, abre o sistema na tela certa.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Strike Details', {
    body: d.texto || '', icon: '/icons/icon-192.png', lang: 'pt-BR',
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/#/inicio' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || '/#/inicio', self.location.origin).href;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const j = janelas.find(c => new URL(c.url).pathname === '/');
    if (j) { await j.focus(); try { await j.navigate(alvo); } catch {} return; }
    await self.clients.openWindow(alvo);
  })());
});
