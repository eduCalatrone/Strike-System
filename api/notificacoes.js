// Notificações no celular (Web Push). Precisa de login.
//   GET  /api/notificacoes            chave pública (para o navegador assinar) e, para o Controle, a configuração,
//                                     quem da equipe tem aparelho ativo e os últimos envios.
//   POST /api/notificacoes { acao }
//     inscrever { inscricao: { endpoint, keys: { p256dh, auth } }, aparelho }  este aparelho passa a receber (da pessoa logada)
//     sair      { endpoint }          este aparelho para de receber (desativar ou sair do sistema)
//     testar                          manda um aviso de teste para os aparelhos da própria pessoa
//     enviar    { titulo, texto, para }  (Controle) aviso personalizado; para = 'todos' | 'controle' | 'funcionarios' | [ids]
//     config    { config }            (Controle) liga/desliga tudo e o aviso automático de estoque baixo
//     trocar    { antigo, inscricao } SEM login: o navegador renovou a inscrição sozinho (service worker, evento
//                                     pushsubscriptionchange). Quem prova é o endereço antigo (secreto, só o aparelho e o
//                                     banco conhecem): a inscrição nova fica com a mesma pessoa e a antiga é desativada.
// Com as notificações desligadas em Ajustes, nada é enviado (só o teste).

const crypto = require('crypto');
const { config, send, readJsonBody, rest, restAll, ms, usuarioDaSessao } = require('./_supabase.js');
const push = require('./_push.js');

const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Só endereços dos serviços de notificação dos navegadores (Google/Chrome, Apple, Mozilla, Microsoft).
const HOSTS_PUSH = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const APARELHOS_POR_PESSOA = 5;
const bytes = s => { try { return Buffer.from(String(s), 'base64url').length; } catch { return 0; } };
const idDe = endpoint => crypto.createHash('sha256').update(String(endpoint)).digest('base64url').slice(0, 40);
// Inscrição vinda do navegador: só endereço https de um serviço conhecido e chaves do tamanho certo.
function inscricaoValida(i) {
  const k = (i && i.keys) || {}, endpoint = String((i && i.endpoint) || '');
  let host = '';
  try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch {}
  if (!host || !HOSTS_PUSH.test(host) || endpoint.length > 1000 || bytes(k.p256dh) !== 65 || bytes(k.auth) !== 16) return null;
  return { endpoint, p256dh: txt(k.p256dh, 200), auth: txt(k.auth, 100) };
}
// Situação das notificações no aparelho de cada pessoa (vem do aviso de presença, api/presenca).
const SITUACOES = ['ativo', 'inativo', 'bloqueado', 'iphone', 'sem'];

// Renovação feita pelo próprio navegador (service worker): a inscrição nova herda a pessoa da antiga.
async function trocar(c, b) {
  const antigo = String(b.antigo || ''), ins = inscricaoValida(b.inscricao);
  if (!antigo || !ins || antigo === ins.endpoint) throw Object.assign(new Error('invalido'), { status: 400, code: 'invalido' });
  const [velha] = await rest(c, `sd_push_inscricoes?select=funcionario_id,aparelho,endpoint&id=eq.${encodeURIComponent(idDe(antigo))}`) || [];
  if (!velha || velha.endpoint !== antigo) throw Object.assign(new Error('nao_encontrada'), { status: 404, code: 'nao_encontrada' });
  const [pessoa] = await rest(c, `sd_funcionarios?select=id&ativo=eq.true&id=eq.${encodeURIComponent(velha.funcionario_id)}`) || [];
  if (!pessoa) throw Object.assign(new Error('nao_encontrada'), { status: 404, code: 'nao_encontrada' });
  const agora = new Date().toISOString();
  await rest(c, 'sd_push_inscricoes?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
    id: idDe(ins.endpoint), funcionario_id: velha.funcionario_id, ...ins, aparelho: velha.aparelho, ativo: true, falhas: 0, ultimo_erro: null, atualizado_em: agora,
  } });
  await rest(c, `sd_push_inscricoes?id=eq.${encodeURIComponent(idDe(antigo))}`, { method: 'PATCH', prefer: 'return=minimal', body: { ativo: false, ultimo_erro: 'renovado pelo navegador', atualizado_em: agora } });
  return { ok: true };
}

module.exports = async (req, res) => {
  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });
  try {
    let b = {};
    if (req.method === 'POST') { try { b = await readJsonBody(req); } catch { return send(res, 400, { error: 'bad_request' }); } }
    if (req.method === 'POST' && b && b.acao === 'trocar') return send(res, 200, await trocar(c, b));
    const eu = await usuarioDaSessao(c, req);
    const ctrl = eu.nivel === 'controle';
    if (req.method === 'GET') {
      const v = await push.chaves(c);
      if (!ctrl) return send(res, 200, { chave: v.publica });
      const [cfg, equipe, inscs, envios] = await Promise.all([
        push.lerConfig(c),
        restAll(c, 'sd_funcionarios?select=id,nome,nivel,notif_situacao,notif_aparelho,visto_em&ativo=eq.true&order=nome,id'),
        restAll(c, 'sd_push_inscricoes?select=funcionario_id,aparelho&ativo=eq.true'),
        rest(c, 'sd_push_envios?select=tipo,titulo,texto,aparelhos,entregues,por_nome,em&tipo=neq.teste&order=em.desc&limit=10'),
      ]);
      return send(res, 200, {
        chave: v.publica, config: cfg,
        equipe: equipe.map(f => ({ id: f.id, nome: f.nome, nivel: f.nivel, aparelhos: inscs.filter(i => i.funcionario_id === f.id).map(i => i.aparelho || 'Aparelho'),
          situacao: SITUACOES.includes(f.notif_situacao) ? f.notif_situacao : null, ultimoAparelho: f.notif_aparelho || '', vistoEm: ms(f.visto_em) })),
        envios: (envios || []).map(e => ({ tipo: e.tipo, titulo: e.titulo, texto: e.texto || '', aparelhos: e.aparelhos, entregues: e.entregues, porNome: e.por_nome || '', em: ms(e.em) })),
      });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    const agora = new Date().toISOString();

    switch (b.acao) {
      case 'inscrever': {
        const ins = inscricaoValida(b.inscricao);
        if (!ins) return send(res, 400, { error: 'invalido' });
        // Mesmo aparelho com outra pessoa logada: passa a ser dela.
        await rest(c, 'sd_push_inscricoes?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: {
          id: idDe(ins.endpoint), funcionario_id: eu.id, ...ins, aparelho: txt(b.aparelho, 60) || null,
          ativo: true, falhas: 0, ultimo_erro: null, atualizado_em: agora,
        } });
        // O navegador trocou o endereço (renovou a inscrição): o endereço antigo deste aparelho deixa de valer.
        if (b.antigo && b.antigo !== ins.endpoint) await rest(c, `sd_push_inscricoes?id=eq.${encodeURIComponent(idDe(b.antigo))}&funcionario_id=eq.${encodeURIComponent(eu.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { ativo: false, ultimo_erro: 'trocado por outro endereço', atualizado_em: agora } });
        // No máximo 5 aparelhos ativos por pessoa: os mais antigos saem.
        const meus = await restAll(c, `sd_push_inscricoes?select=id&ativo=eq.true&funcionario_id=eq.${encodeURIComponent(eu.id)}&order=atualizado_em.desc,id`);
        const sobra = meus.slice(APARELHOS_POR_PESSOA).map(x => x.id);
        if (sobra.length) await rest(c, `sd_push_inscricoes?id=in.(${sobra.map(encodeURIComponent).join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { ativo: false, atualizado_em: agora } });
        return send(res, 200, { ok: true });
      }
      case 'sair': {
        const endpoint = String(b.endpoint || '');
        if (!endpoint) return send(res, 400, { error: 'invalido' });
        // Só desativa o aparelho da própria pessoa.
        await rest(c, `sd_push_inscricoes?id=eq.${encodeURIComponent(idDe(endpoint))}&funcionario_id=eq.${encodeURIComponent(eu.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { ativo: false, atualizado_em: agora } });
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
