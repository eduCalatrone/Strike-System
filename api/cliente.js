// Área do cliente: só a placa. Não precisa de login.
//   GET /api/cliente?placa=ABC1D23
// Devolve só o que o cliente pode ver: etapa atual, andamento (datas), fotos e o registro de avarias
// da entrada (texto de danos ou problemas, objetos pessoais e fotos de "Danos").
// Nunca devolve valores, nome do cliente nem nomes da equipe.
// Fotos das etapas vêm com o número da etapa (etapa), para aparecer no andamento.

const { config, send, rest, fotoBase, ms } = require('./_supabase.js');


module.exports = async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });

  const placa = String(new URL(req.url, 'http://localhost').searchParams.get('placa') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) return send(res, 400, { error: 'bad_request' });

  try {
    // O em andamento vem primeiro; se não houver, o mais recente.
    const ats = await rest(c, `sd_atendimentos?select=id,placa,tipo_nome,etapas,etapa_index,feitas,concluido,concluido_em,criado_em,danos,objetos&placa=eq.${placa}&excluido_em=is.null&order=concluido.asc,criado_em.desc&limit=1`);
    const at = ats && ats[0];
    if (!at) return send(res, 200, { atendimento: null });
    const [veiculo] = await rest(c, `sd_veiculos?select=descricao&placa=eq.${placa}`) || [];
    const fotos = await rest(c, `sd_fotos?select=rotulo,caminho,miniatura,etapa&atendimento_id=eq.${encodeURIComponent(at.id)}&removida_em=is.null&apagada_em=is.null&order=criado_em,id`) || [];
    const base = fotoBase(c);
    return send(res, 200, {
      atendimento: {
        placa: at.placa,
        descricao: (veiculo && veiculo.descricao) || '',
        tipoNome: at.tipo_nome,
        etapas: at.etapas || [],
        etapaIndex: at.etapa_index,
        feitas: at.feitas || {},
        concluido: at.concluido,
        concluidoEm: ms(at.concluido_em),
        criadoEm: ms(at.criado_em),
        danos: at.danos || '',
        objetos: at.objetos || '',
        fotos: fotos.map(f => ({ rotulo: f.rotulo, etapa: f.etapa, url: base + f.caminho, mini: f.miniatura ? base + f.miniatura : null })),
      },
    });
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.code || 'server_error' });
  }
};
