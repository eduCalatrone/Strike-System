// Função de servidor (roda na Vercel). Recebe uma foto do navegador, chama o
// Plate Recognizer (https://platerecognizer.com) com a chave secreta guardada
// no servidor, e devolve só o que o site precisa: { plate, score, alternatives }.
//
// Precisa do login da equipe (cabeçalho Authorization com o token da sessão).
// Variáveis de ambiente (configurar no painel da Vercel, em Project Settings > Environment Variables):
//   PLATE_RECOGNIZER_TOKEN  (obrigatória) — chave da conta em https://app.platerecognizer.com
//   ACCESS_CODE             (opcional)    — uma senha simples para travar o uso do leitor
//
// Troca de serviço de leitura: essa é a única peça que fala com o Plate Recognizer.
// Para usar outro serviço, troque só a função callPlateRecognizer() abaixo.

// Só para a equipe logada (token da sessão, igual às outras funções): sem isso, qualquer pessoa
// poderia chamar este endereço direto e gastar a cota do Plate Recognizer.
const { config, usuarioDaSessao } = require('./_supabase.js');

const UPSTREAM_URL = 'https://api.platerecognizer.com/v1/plate-reader/';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // limite do próprio Plate Recognizer

function send(res, status, body) {
  res.status(status).json(body);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel já decodifica JSON
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  return Buffer.from(m[2], 'base64');
}

async function callPlateRecognizer(buffer, token) {
  const form = new FormData();
  form.append('upload', new Blob([buffer], { type: 'image/jpeg' }), 'placa.jpg');
  form.append('regions', 'br');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  let res;
  try {
    res = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${token}` },
      body: form,
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });
  try { await usuarioDaSessao(c, req); }
  catch (e) { return send(res, e.status || 401, { error: e.code || 'sessao' }); }

  const token = process.env.PLATE_RECOGNIZER_TOKEN;
  if (!token) return send(res, 501, { error: 'not_configured' });

  const accessCode = process.env.ACCESS_CODE;
  if (accessCode && req.headers['x-access-code'] !== accessCode) {
    return send(res, 401, { error: 'unauthorized' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return send(res, 400, { error: 'bad_request' });
  }

  const buffer = dataUrlToBuffer(body.image);
  if (!buffer) return send(res, 400, { error: 'bad_request' });
  if (buffer.length > MAX_IMAGE_BYTES) return send(res, 413, { error: 'too_large' });

  let upstream;
  try {
    upstream = await callPlateRecognizer(buffer, token);
  } catch {
    return send(res, 502, { error: 'upstream' });
  }

  if (upstream.status === 429) return send(res, 429, { error: 'rate_limited' });
  if (upstream.status === 401 || upstream.status === 403) {
    return send(res, 502, { error: 'upstream', detail: 'token_invalid' });
  }
  if (upstream.status >= 400) {
    return send(res, 502, { error: 'upstream', detail: upstream.data && upstream.data.error });
  }

  const best = (upstream.data.results || [])[0];
  if (!best) return send(res, 200, { plate: null, alternatives: [] });

  const alternatives = (best.candidates || [])
    .map((c) => c.plate)
    .filter((p) => p && p.toUpperCase() !== String(best.plate).toUpperCase());

  return send(res, 200, { plate: best.plate, score: best.score, alternatives });
};
