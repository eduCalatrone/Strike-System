// Servidor para rodar o sistema no computador, sem instalar nada além do Node.js (18 ou mais novo).
//
//   node dev-server.js
//
// Abre em http://localhost:3000 e responde /api/... com os mesmos arquivos usados
// na Vercel (pasta api/). As chaves vêm do arquivo .env nesta pasta (veja .env.exemplo).
// Sem a chave do Plate Recognizer, o leitor usa a leitura do aparelho.
//
// Na Vercel este arquivo é ignorado: lá o site e a pasta api/ funcionam sozinhos.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

// Lê .env simples (CHAVE=valor por linha), sem sobrescrever variáveis já definidas.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* sem .env: tudo bem */ }

// Funções da pasta api/ (as que começam com "_" são peças internas, não endereços).
const API = {};
for (const f of fs.readdirSync(path.join(ROOT, 'api'))) {
  if (f.endsWith('.js') && !f.startsWith('_')) API[f.slice(0, -3)] = require(path.join(ROOT, 'api', f));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  const api = /^\/api\/([a-z0-9-]+)$/.exec(url.pathname);
  if (api) {
    const handler = API[api[1]];
    if (!handler) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"not_found"}'); return; }
    // Adapta a resposta ao formato das funções da Vercel: res.status(...).json(...)
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
    try { await handler(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); }
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (/^\/cliente\/?$/.test(rel)) rel = '/index.html'; // página do cliente (igual ao vercel.json)
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith('.')) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`\nStrike Details rodando em http://localhost:${PORT}`);
  for (const ip of ips) console.log(`No celular (mesma rede Wi-Fi): http://${ip}:${PORT}`);
  console.log(process.env.PLATE_RECOGNIZER_TOKEN
    ? 'Leitura de placa: Plate Recognizer ligado.'
    : 'Leitura de placa: sem PLATE_RECOGNIZER_TOKEN no .env, usando a leitura do aparelho.');
  console.log(process.env.SUPABASE_URL && process.env.SUPABASE_KEY && process.env.SD_CHAVE_BANCO
    ? `Banco: ${process.env.SUPABASE_URL}`
    : 'Banco: falta SUPABASE_URL, SUPABASE_KEY ou SD_CHAVE_BANCO no .env. O sistema não abre sem o banco.');
  console.log('Obs.: no celular pelo IP da rede, a câmera ao vivo fica bloqueada (exige HTTPS). Use "Usar foto do aparelho".\n');
});
