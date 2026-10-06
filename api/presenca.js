// Presença da equipe no sistema.
//   POST /api/presenca  { tela, mexeuEm, saiu }
// O site manda a cada 45 s enquanto está aberto e na tela, e manda "saiu" quando some da tela
// (trocou de app, bloqueou o celular, fechou). Só registra o que acontece dentro do sistema:
// não dá para saber o que a pessoa faz em outros apps.
// Para o Controle, a resposta traz a presença de toda a equipe (cartão "Equipe agora" no Início).
// Colunas em sd_funcionarios: visto_em, mexeu_em, tela (null = fora do sistema).

const { config, send, readJsonBody, rest, iso, ms, usuarioDaSessao } = require('./_supabase.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });
  try {
    const eu = await usuarioDaSessao(c, req);
    let body = {};
    try { body = await readJsonBody(req); } catch {}
    const agora = Date.now();
    // Último toque: não pode ser no futuro nem muito antigo (relógio do celular errado).
    const mexeu = Math.min(agora, Math.max(agora - 864e5, Number(body.mexeuEm) || agora));
    const tela = body.saiu ? null : String(body.tela || '').trim().slice(0, 40) || 'Sistema';
    await rest(c, `sd_funcionarios?id=eq.${encodeURIComponent(eu.id)}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { visto_em: iso(agora), mexeu_em: iso(mexeu), tela },
    });
    if (eu.nivel !== 'controle') return send(res, 200, { ok: true });
    const lista = await rest(c, 'sd_funcionarios?select=id,nome,nivel,visto_em,mexeu_em,tela&ativo=eq.true&order=nome,id') || [];
    return send(res, 200, {
      ok: true, agora,
      equipe: lista.map(f => ({ id: f.id, nome: f.nome, nivel: f.nivel, vistoEm: ms(f.visto_em), mexeuEm: ms(f.mexeu_em), tela: f.tela || null })),
    });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.code || 'server_error' });
  }
};
