// Limpeza diária das fotos (agendada em vercel.json, 1 vez por dia).
//   GET /api/limpeza   (a Vercel manda "Authorization: Bearer <CRON_SECRET>")
//
// Apaga do Storage os arquivos das fotos (e miniaturas) de:
//   - serviços concluídos há mais de X dias (Ajustes > Limpeza de fotos, 30 a 40 dias);
//   - atendimentos excluídos e fotos removidas há mais de X dias.
// Serviços em andamento nunca são mexidos. O registro da foto fica no banco (apagada_em),
// e o atendimento, as etapas e o histórico continuam guardados.

const { config, send, rest, restAll, apagarArquivos } = require('./_supabase.js');

const POR_VEZ = 100;
const MAX_POR_DIA = 2000;

module.exports = async (req, res) => {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || req.headers.authorization !== `Bearer ${segredo}`) return send(res, 401, { error: 'unauthorized' });
  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });

  try {
    const [ajuste] = await rest(c, 'sd_ajustes?select=valor&chave=eq.limpeza_fotos_dias') || [];
    const dias = Math.min(40, Math.max(30, Number(ajuste && ajuste.valor) || 30));
    const limite = Date.now() - dias * 864e5;
    const antes = v => v && new Date(v).getTime() < limite;

    const [ats, fotos] = await Promise.all([
      restAll(c, 'sd_atendimentos?select=id,concluido,concluido_em,excluido_em&order=id'),
      restAll(c, 'sd_fotos?select=id,atendimento_id,caminho,miniatura,removida_em&apagada_em=is.null&order=criado_em,id'),
    ]);
    const vencidos = new Set(ats.filter(a => (a.concluido && antes(a.concluido_em)) || antes(a.excluido_em)).map(a => a.id));
    const alvo = fotos.filter(f => vencidos.has(f.atendimento_id) || antes(f.removida_em)).slice(0, MAX_POR_DIA);

    let apagadas = 0;
    for (let i = 0; i < alvo.length; i += POR_VEZ) {
      const lote = alvo.slice(i, i + POR_VEZ);
      await apagarArquivos(c, lote.flatMap(f => [f.caminho, f.miniatura].filter(Boolean)));
      await rest(c, `sd_fotos?id=in.(${lote.map(f => encodeURIComponent(f.id)).join(',')})`, {
        method: 'PATCH', prefer: 'return=minimal', body: { apagada_em: new Date().toISOString() },
      });
      apagadas += lote.length;
    }
    console.log(`Limpeza: ${apagadas} fotos apagadas (serviços concluídos há mais de ${dias} dias).`);
    return send(res, 200, { ok: true, dias, apagadas, restantes: Math.max(0, fotos.filter(f => vencidos.has(f.atendimento_id) || antes(f.removida_em)).length - apagadas) });
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.code || 'server_error', detail: e.detail });
  }
};
