// Peças comuns das funções que falam com o Supabase (projeto "Strike Details DATABASE").
// Arquivos da pasta api/ que começam com "_" não viram endereço na Vercel.
//
// Variáveis de ambiente (Vercel > Project Settings > Environment Variables):
//   SUPABASE_URL    endereço do projeto (https://....supabase.co)
//   SUPABASE_KEY    chave publicável do Supabase (sb_publishable_...). Não é secreta.
//   SD_CHAVE_BANCO  chave secreta que libera as tabelas sd_ (vai no cabeçalho x-sd-chave).
//                   O mesmo valor fica na tabela privado.sd_config do banco.
//   CRON_SECRET     chave que a Vercel manda na limpeza diária das fotos (api/limpeza).
//
// Regra do banco: registros não são apagados. As tabelas sd_ não têm permissão de DELETE;
// "excluir" no sistema só marca o registro (excluido_em, ativo = false, removida_em).
// A única exclusão é a dos arquivos de foto antigos, feita pela limpeza diária.
//
// Login: usuário e senha próprios em sd_funcionarios (senha com scrypt). O login devolve
// um token assinado; cada chamada confere o token e se a pessoa continua ativa.

const crypto = require('crypto');
const BUCKET = 'sd-fotos';

function config() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_KEY || '';
  const chave = process.env.SD_CHAVE_BANCO || '';
  if (!url || !key || !chave) return null;
  return { url, key, chave };
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

const erro = (status, code, detail) => Object.assign(new Error(code), { status, code, detail });

/* ---------- Senhas e sessão ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function confereSenha(senha, hash) {
  const [alg, N, r, p, salt, h] = String(hash || '').split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  try {
    const esperado = Buffer.from(h, 'base64');
    const calc = crypto.scryptSync(String(senha), Buffer.from(salt, 'base64'), esperado.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(calc, esperado);
  } catch { return false; }
}
const DIAS_SESSAO = 60;
const segredo = c => crypto.createHmac('sha256', c.chave).update('sd-sessao-v1').digest();
function criarToken(c, u) {
  const corpo = Buffer.from(JSON.stringify({ id: u.id, v: u.sessao_versao, exp: Date.now() + DIAS_SESSAO * 864e5 })).toString('base64url');
  return `${corpo}.${crypto.createHmac('sha256', segredo(c)).update(corpo).digest('base64url')}`;
}
function lerToken(c, token) {
  const [corpo, ass] = String(token || '').split('.');
  if (!corpo || !ass) return null;
  const certo = crypto.createHmac('sha256', segredo(c)).update(corpo).digest();
  const veio = Buffer.from(ass, 'base64url');
  if (veio.length !== certo.length || !crypto.timingSafeEqual(veio, certo)) return null;
  try { const p = JSON.parse(Buffer.from(corpo, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
// Confere o token e devolve a pessoa (id, nome, nivel). Guarda por 30 s para não consultar o banco a cada chamada.
const cacheSessao = new Map();
async function usuarioDaSessao(c, req) {
  const auth = String(req.headers.authorization || '');
  const p = lerToken(c, auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!p || typeof p.id !== 'string') throw erro(401, 'sessao');
  const k = `${p.id}:${p.v}`, hit = cacheSessao.get(k);
  if (hit && Date.now() - hit.em < 30000) return hit.u;
  const [u] = await rest(c, `sd_funcionarios?select=id,nome,nivel,ativo,sessao_versao&id=eq.${encodeURIComponent(p.id)}`) || [];
  if (!u || !u.ativo || u.sessao_versao !== p.v) { cacheSessao.delete(k); throw erro(401, 'sessao'); }
  cacheSessao.set(k, { u, em: Date.now() });
  return u;
}

// Modo funcionário (Controle testando ou apresentando): com o cabeçalho x-sd-modo: funcionario, a pessoa do Controle
// passa a valer como Funcionário nesta chamada (recebe e grava com as regras do Funcionário). Só rebaixa, nunca eleva.
function verComo(eu, req) {
  return eu && eu.nivel === 'controle' && String(req.headers['x-sd-modo'] || '') === 'funcionario' ? { ...eu, nivel: 'funcionario', simulado: true } : eu;
}
async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body; // Vercel já decodifica JSON
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req, limit) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw erro(413, 'too_large');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

// Chamada à API REST do banco (PostgREST).
async function rest(c, path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: c.key, 'x-sd-chave': c.chave, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  let res;
  try {
    res = await fetch(`${c.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw erro(502, 'banco_indisponivel');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const code = data && data.code;
    if (code === '23505') throw erro(409, 'duplicado', data.details || data.message);
    throw erro(res.status >= 500 ? 502 : 400, 'banco', (data && (data.message || data.hint)) || `HTTP ${res.status}`);
  }
  return data;
}

// Lê todas as linhas, de 1000 em 1000 (limite padrão do Supabase por consulta).
async function restAll(c, path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest(c, `${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${offset}`);
    out.push(...(page || []));
    if (!page || page.length < 1000) return out;
  }
}

// Envia uma foto para o Storage. Nunca sobrescreve nem apaga.
async function uploadFoto(c, caminho, buffer) {
  let res;
  try {
    res = await fetch(`${c.url}/storage/v1/object/${BUCKET}/${caminho}`, {
      method: 'POST',
      headers: {
        apikey: c.key,
        'x-sd-chave': c.chave,
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'max-age=31536000',
        'x-upsert': 'false',
      },
      body: buffer,
    });
  } catch {
    throw erro(502, 'banco_indisponivel');
  }
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  // Mesmo arquivo já enviado (nova tentativa depois de falha na rede): tudo certo.
  if (res.status === 409 || String(data.statusCode) === '409' || /exist|duplicate/i.test(data.error || data.message || '')) return;
  throw erro(502, 'storage', data.message || data.error || `HTTP ${res.status}`);
}

// Apaga arquivos de foto (só a limpeza diária usa). Até 100 por chamada.
async function apagarArquivos(c, caminhos) {
  const res = await fetch(`${c.url}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: { apikey: c.key, 'x-sd-chave': c.chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: caminhos }),
  });
  if (!res.ok) throw erro(502, 'storage', `HTTP ${res.status} ${await res.text().catch(() => '')}`);
  return res.json().catch(() => []);
}

const fotoBase = c => `${c.url}/storage/v1/object/public/${BUCKET}/`;
const ms = v => (v ? new Date(v).getTime() : null);
const iso = v => {
  const n = Number(v);
  return v == null || v === '' || !Number.isFinite(n) ? null : new Date(n).toISOString();
};

module.exports = { verComo,
  config, send, erro, readJsonBody, readRawBody, rest, restAll, uploadFoto, apagarArquivos, fotoBase, ms, iso,
  hashSenha, confereSenha, criarToken, usuarioDaSessao,
};
