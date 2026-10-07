// Notificações (Web Push) sem dependências: assinatura VAPID (ES256) e conteúdo cifrado (aes128gcm, RFC 8291).
// Arquivo com "_" não vira endereço na Vercel.
//
// Chaves VAPID: criadas sozinhas no primeiro uso e guardadas em sd_ajustes (chave 'vapid'), que só as funções leem.
// A pública vai para o navegador (applicationServerKey); a privada nunca sai do servidor.
// Aparelhos: tabela sd_push_inscricoes (um por navegador; ativo = false quando a pessoa desativa ou o navegador cancela).
// Envios: tabela sd_push_envios (registro do que foi mandado). Nada é apagado.
// Configuração (Ajustes > Notificações, só Controle): sd_ajustes chave 'notificacoes'.

const crypto = require('crypto');
const { rest, restAll } = require('./_supabase.js');

const CONFIG_PADRAO = { ativo: true, estoque: { ativo: true, para: 'controle' } };
const b64u = b => Buffer.from(b).toString('base64url');

/* ---------- Configuração ---------- */
async function lerConfig(c) {
  const [r] = await rest(c, 'sd_ajustes?select=valor&chave=eq.notificacoes') || [];
  const v = r && r.valor && typeof r.valor === 'object' ? r.valor : {};
  const est = v.estoque && typeof v.estoque === 'object' ? v.estoque : {};
  return {
    ativo: v.ativo !== false,
    estoque: { ativo: est.ativo !== false, para: ['controle', 'todos'].includes(est.para) ? est.para : 'controle' },
  };
}
async function salvarConfig(c, cfg) {
  const valor = {
    ativo: cfg.ativo !== false,
    estoque: { ativo: !!(cfg.estoque && cfg.estoque.ativo !== false), para: cfg.estoque && cfg.estoque.para === 'todos' ? 'todos' : 'controle' },
  };
  await rest(c, 'sd_ajustes?on_conflict=chave', { method: 'POST', body: { chave: 'notificacoes', valor, atualizado_em: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
  return valor;
}

/* ---------- Chaves VAPID ---------- */
let vapidCache = null;
async function chaves(c) {
  if (vapidCache) return vapidCache;
  const ler = async () => { const [r] = await rest(c, 'sd_ajustes?select=valor&chave=eq.vapid') || []; return r && r.valor && r.valor.publica ? r.valor : null; };
  let v = await ler();
  if (!v) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const nova = { publica: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])), x: jwk.x, y: jwk.y, d: jwk.d };
    // Se outra chamada criou ao mesmo tempo, fica a primeira (não sobrescreve).
    await rest(c, 'sd_ajustes?on_conflict=chave', { method: 'POST', body: { chave: 'vapid', valor: nova, atualizado_em: new Date().toISOString() }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    v = await ler();
  }
  vapidCache = { publica: v.publica, chave: crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: v.x, y: v.y, d: v.d }, format: 'jwk' }) };
  return vapidCache;
}
function jwtVapid(chave, aud, sub) {
  const corpo = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }))}`;
  const ass = crypto.sign('sha256', Buffer.from(corpo), { key: chave, dsaEncoding: 'ieee-p1363' });
  return `${corpo}.${b64u(ass)}`;
}

/* ---------- Conteúdo cifrado (RFC 8291 / 8188, aes128gcm, um registro só) ---------- */
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function cifrar(texto, p256dh, authSecret) {
  const uaPub = Buffer.from(p256dh, 'base64url'), auth = Buffer.from(authSecret, 'base64url');
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), segredoEcdh = ecdh.computeSecret(uaPub);
  const ikm = hmac(hmac(auth, segredoEcdh), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])]));
  const salt = crypto.randomBytes(16), prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cif = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const corpo = Buffer.concat([cif.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), cif.final(), cif.getAuthTag()]);
  const cab = Buffer.alloc(21); salt.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab[20] = asPub.length;
  return Buffer.concat([cab, asPub, corpo]);
}

// Manda para um aparelho. Devolve 'ok', 'sumiu' (navegador cancelou: desativar) ou o erro.
async function enviarUm(v, insc, mensagem, sub) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url = new URL(insc.endpoint);
    const r = await fetch(insc.endpoint, {
      method: 'POST', signal: ctrl.signal,
      headers: {
        Authorization: `vapid t=${jwtVapid(v.chave, url.origin, sub)}, k=${v.publica}`,
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal',
      },
      body: cifrar(JSON.stringify(mensagem), insc.p256dh, insc.auth),
    });
    if (r.status === 404 || r.status === 410) return 'sumiu';
    return r.ok ? 'ok' : `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 120)}`;
  } catch (e) { return e && e.name === 'AbortError' ? 'tempo esgotado' : e instanceof TypeError && /URL/i.test(e.message) ? 'sumiu' : 'falha de rede'; }
  finally { clearTimeout(t); }
}

// Quem recebe: 'todos', 'controle', 'funcionarios' ou lista de ids.
async function idsDe(c, para) {
  const equipe = await restAll(c, 'sd_funcionarios?select=id,nivel&ativo=eq.true');
  if (Array.isArray(para)) return equipe.filter(f => para.includes(f.id)).map(f => f.id);
  if (para === 'controle') return equipe.filter(f => f.nivel === 'controle').map(f => f.id);
  if (para === 'funcionarios') return equipe.filter(f => f.nivel !== 'controle').map(f => f.id);
  return equipe.map(f => f.id);
}

// Envia para as pessoas e registra o envio. mensagem: { titulo, texto, url }.
async function enviar(c, { para, mensagem, tipo, por, origem, registrar = true }) {
  const ids = await idsDe(c, para);
  const v = await chaves(c);
  const inscs = ids.length ? await restAll(c, `sd_push_inscricoes?select=id,endpoint,p256dh,auth,falhas&ativo=eq.true&funcionario_id=in.(${ids.map(encodeURIComponent).join(',')})`) : [];
  const sub = /^https:\/\//.test(origem || '') ? origem : 'https://example.com'; // "sub" do VAPID: o endereço do site
  const corpo = { titulo: String(mensagem.titulo || '').slice(0, 80), texto: String(mensagem.texto || '').slice(0, 300), url: mensagem.url || '/#/inicio', tag: mensagem.tag || undefined };
  const res = await Promise.all(inscs.map(i => enviarUm(v, i, corpo, sub)));
  const agora = new Date().toISOString();
  await Promise.all(inscs.map((i, k) => {
    const r = res[k];
    if (r === 'ok') return i.falhas ? rest(c, `sd_push_inscricoes?id=eq.${encodeURIComponent(i.id)}`, { method: 'PATCH', body: { falhas: 0, ultimo_erro: null }, prefer: 'return=minimal' }) : null;
    const falhas = (i.falhas || 0) + 1;
    return rest(c, `sd_push_inscricoes?id=eq.${encodeURIComponent(i.id)}`, { method: 'PATCH', prefer: 'return=minimal',
      body: { falhas, ultimo_erro: r === 'sumiu' ? 'cancelado pelo navegador' : r, atualizado_em: agora, ...(r === 'sumiu' || falhas >= 10 ? { ativo: false } : {}) } });
  }).filter(Boolean)).catch(() => {});
  const entregues = res.filter(r => r === 'ok').length;
  if (registrar) {
    await rest(c, 'sd_push_envios', { method: 'POST', prefer: 'return=minimal', body: {
      id: crypto.randomBytes(9).toString('base64url'), tipo, titulo: corpo.titulo, texto: corpo.texto, para: ids,
      aparelhos: inscs.length, entregues, por_id: por ? por.id : null, por_nome: por ? por.nome : null, em: agora,
    } }).catch(() => {});
  }
  return { pessoas: ids.length, aparelhos: inscs.length, entregues };
}

const origemDe = req => {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host && !/^(localhost|127\.)/.test(host) ? `https://${host}` : '';
};

module.exports = { CONFIG_PADRAO, lerConfig, salvarConfig, chaves, cifrar, jwtVapid, enviar, origemDe };
