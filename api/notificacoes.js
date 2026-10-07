// Notificações no celular (Web Push). Precisa de login.
//   GET  /api/notificacoes            chave pública (para o navegador assinar) e, para o Controle, a configuração,
//                                     quem da equipe tem aparelho ativo e os últimos envios.
//   POST /api/notificacoes { acao }
//     inscrever { inscricao: { endpoint, keys: { p256dh, auth } }, aparelho }  este aparelho passa a receber (da pessoa logada)
//     sair      { endpoint }          este aparelho para de receber (desativar ou sair do sistema)
//     testar                          manda um aviso de teste para os aparelhos da própria pessoa
//     enviar    { titulo, texto, para }  (Controle) aviso personalizado; para = 'todos' | 'controle' | 'funcionarios' | [ids]
//     config    { config }            (Controle) liga/desliga tudo e o aviso automático de estoque baixo
// Com as notificações desligadas em Ajustes, nada é enviado (só o teste).

const crypto = require('crypto');
const { config, send, readJsonBody, rest, restAll, ms, usuarioDaSessao } = require('./_supabase.js');
const push = require('./_push.js');

const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;

module.exports = async (req, res) => {
  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });
  try {
    const eu = await usuarioDaSessao(c, req);
    const ctrl = eu.nivel === 'controle';
    if (req.method === 'GET') {
      const v = await push.chaves(c);
      if (!ctrl) return send(res, 200, { chave: v.publica });
      const [cfg, equipe, inscs, envios] = await Promise.all([
        push.lerConfig(c),
        restAll(c, 'sd_funcionarios?select=id,nome,nivel&ativo=eq.true&order=nome,id'),
        restAll(c, 'sd_push_inscricoes?select=funcionario_id,aparelho&ativo=eq.true'),
        rest(c, 'sd_push_envios?select=tipo,titulo,texto,aparelhos,entregues,por_nome,em&tipo=neq.teste&order=em.desc&limit=10'),
      ]);
      return send(res, 200, {
        chave: v.publica, config: cfg,
        equipe: equipe.map(f => ({ id: f.id, nome: f.nome, nivel: f.nivel, aparelhos: inscs.filter(i => i.funcionario_id === f.id).map(i => i.aparelho || 'Aparelho') })),
        envios: (envios || []).map(e => ({ tipo: e.tipo, titulo: e.titulo, texto: e.texto || '', aparelhos: e.aparelhos, entregues: e.entregues, porNome: e.por_nome || '', em: ms(e.em) })),
      });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    let b = {};
    try { b = await readJsonBody(req); } catch { return send(res, 400, { error: 'bad_request' }); }
    const agora = new Date().toISOString();

    switch (b.acao) {
      case 'inscrever': {
        const i = b.inscricao || {}, k = i.keys || {};
        const endpoint = String(i.endpoint || '');
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !k.p256dh || !k.auth) return send(res, 400, { error: 'invalido' });
        const idInsc = crypto.createHash('sha256').update(endpoint).digest('base64url').slice(0, 40);
        // Mesmo aparelho com outra pessoa logada: passa a ser dela.
        await rest(c, 'sd_push_inscricoes?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
          id: idInsc, funcionario_id: eu.id, endpoint, p256dh: txt(k.p256dh, 200), auth: txt(k.auth, 100), aparelho: txt(b.aparelho, 60) || null,
          ativo: true, falhas: 0, ultimo_erro: null, atualizado_em: agora,
        } });
        return send(res, 200, { ok: true });
      }
      case 'sair': {
        const endpoint = String(b.endpoint || '');
        if (!endpoint) return send(res, 400, { error: 'invalido' });
        const idInsc = crypto.createHash('sha256').update(endpoint).digest('base64url').slice(0, 40);
        await rest(c, `sd_push_inscricoes?id=eq.${encodeURIComponent(idInsc)}`, { method: 'PATCH', prefer: 'return=minimal', body: { ativo: false, atualizado_em: agora } });
        return send(res, 200, { ok: true });
      }
      case 'testar': {
        const r = await push.enviar(c, { para: [eu.id], tipo: 'teste', por: eu, origem: push.origemDe(req), registrar: false,
          mensagem: { titulo: 'Strike Details', texto: 'Notificações ativadas neste aparelho.', url: '/#/inicio', tag: 'teste' } });
        return send(res, 200, r);
      }
      case 'enviar': {
        if (!ctrl) return send(res, 403, { error: 'proibido' });
        const cfg = await push.lerConfig(c);
        if (!cfg.ativo) return send(res, 409, { error: 'desligadas' });
        const titulo = txt(b.titulo, 80), texto = txt(b.texto, 300);
        if (!titulo && !texto) return send(res, 400, { error: 'invalido' });
        const para = Array.isArray(b.para) ? b.para.filter(x => RE_ID.test(String(x))).slice(0, 200)
          : ['todos', 'controle', 'funcionarios'].includes(b.para) ? b.para : null;
        if (!para || (Array.isArray(para) && !para.length)) return send(res, 400, { error: 'invalido' });
        const r = await push.enviar(c, { para, tipo: 'personalizado', por: eu, origem: push.origemDe(req),
          mensagem: { titulo: titulo || 'Strike Details', texto, url: '/#/inicio' } });
        return send(res, 200, r);
      }
      case 'config': {
        if (!ctrl) return send(res, 403, { error: 'proibido' });
        return send(res, 200, { ok: true, config: await push.salvarConfig(c, b.config || {}) });
      }
      default:
        return send(res, 400, { error: 'invalido' });
    }
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.code || 'server_error' });
  }
};
