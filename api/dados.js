// Dados da equipe (Funcionário e Controle).
//   GET  /api/dados  devolve tudo que o site usa, no mesmo formato de antes (funcionarios, tipos, veiculos, atendimentos, estoque).
//   POST /api/dados  { ops: [...], por: {id, nome} } grava as mudanças, uma por uma, na ordem.
//
// Cada op: { col, acao: 'salvar' | 'remover', item?, id?, versao? }
//   col: funcionarios | tipos | veiculos | itens | movimentos | atendimentos | fotos | agenda
//   Só do Controle: ajustes, senha, agenda (o Funcionário só vê a agenda, com valores,
//   e pode usar 'agenda:entrada', que só marca o agendamento como "em serviço" ao dar entrada no veículo;
//   quando esse serviço é concluído, o agendamento vira "concluído" aqui mesmo)
// Nada é apagado: 'remover' só marca o registro (ativo = false, excluido_em, removida_em).
// Atendimentos têm versão: se outro aparelho mudou antes, responde 409 'conflito' e o site recarrega.
// Precisa de login (token). O que é só do Controle é conferido aqui também, não só na tela.
// O Funcionário não recebe valores dos serviços.

const { config, send, erro, readJsonBody, rest, restAll, fotoBase, ms, iso, hashSenha, usuarioDaSessao } = require('./_supabase.js');

/* ---------- Leitura ---------- */
async function carregar(c, eu) {
  const ctrl = eu.nivel === 'controle';
  // Lixeira (só Controle): excluídos nas últimas 48 h ainda podem ser restaurados.
  const desde = encodeURIComponent(`"${new Date(Date.now() - LIXEIRA_MS).toISOString()}"`); // entre aspas por causa do ":" no or=()
  // Versão lida antes dos dados: se algo mudar no meio, a próxima conferência vê a versão nova e busca de novo.
  const [ver] = await rest(c, 'sd_versao?select=em&id=eq.1') || [];
  const [funcionarios, tipos, veiculos, todosAts, fotos, itens, movimentos, ajustes, agenda] = await Promise.all([
    restAll(c, 'sd_funcionarios?select=id,nome,nivel,usuario,senha_hash&ativo=eq.true&order=nome,id'),
    restAll(c, 'sd_tipos_servico?select=id,nome,etapas&ativo=eq.true&order=criado_em,id'),
    restAll(c, 'sd_veiculos?select=placa,descricao,criado_em&order=placa'),
    restAll(c, `sd_atendimentos?select=*&${ctrl ? `or=(excluido_em.is.null,excluido_em.gte.${desde})` : 'excluido_em=is.null'}&order=criado_em,id`),
    restAll(c, 'sd_fotos?select=id,atendimento_id,rotulo,caminho,miniatura,etapa,criado_em,apagada_em&removida_em=is.null&order=criado_em,id'),
    restAll(c, 'sd_estoque_itens?select=id,nome,unidade,minimo&ativo=eq.true&order=criado_em,id'),
    restAll(c, 'sd_estoque_movimentos?select=*&descartado_em=is.null&order=em,id'),
    restAll(c, 'sd_ajustes?select=chave,valor'),
    restAll(c, 'sd_agenda?select=id,cliente,tel,servico,data,marca,prazo,valor,obs,status&excluido_em=is.null&order=data,id'),
  ]);
  const fotosPorAt = new Map(), apagadasPorAt = new Map();
  for (const f of fotos) {
    if (f.apagada_em) { apagadasPorAt.set(f.atendimento_id, (apagadasPorAt.get(f.atendimento_id) || 0) + 1); continue; }
    if (!fotosPorAt.has(f.atendimento_id)) fotosPorAt.set(f.atendimento_id, []);
    fotosPorAt.get(f.atendimento_id).push({ id: f.id, rotulo: f.rotulo, em: ms(f.criado_em), caminho: f.caminho, miniatura: f.miniatura || null, ...(f.etapa == null ? {} : { etapa: f.etapa }) });
  }
  const atendimentos = todosAts.filter(a => !a.excluido_em);
  const lixeira = todosAts.filter(a => a.excluido_em).sort((a, b) => ms(b.excluido_em) - ms(a.excluido_em));
  return {
    versaoDados: ver ? ver.em : null,
    lixeira: lixeira.map(a => ({
      id: a.id, placa: a.placa, tipoNome: a.tipo_nome, clienteNome: a.cliente_nome || '', concluido: a.concluido,
      etapa: a.concluido ? 'Concluído' : (a.etapas || [])[a.etapa_index] || '', criadoEm: ms(a.criado_em),
      excluidoEm: ms(a.excluido_em), excluidoPor: a.excluido_por || '', fotos: fotosPorAt.get(a.id) || [],
    })),
    fotoBase: fotoBase(c),
    ajustes: { limpezaDias: Number((ajustes.find(a => a.chave === 'limpeza_fotos_dias') || {}).valor) || 30 },
    // Controle vê o usuário de cada pessoa e se já tem senha; a senha nunca sai daqui.
    funcionarios: funcionarios.map(f => ctrl ? { id: f.id, nome: f.nome, nivel: f.nivel, usuario: f.usuario || '', temSenha: !!f.senha_hash } : { id: f.id, nome: f.nome, nivel: f.nivel }),
    tipos: tipos.map(t => ({ id: t.id, nome: t.nome, etapas: Array.isArray(t.etapas) ? t.etapas : [] })),
    veiculos: Object.fromEntries(veiculos.map(v => [v.placa, { placa: v.placa, descricao: v.descricao || '', criadoEm: ms(v.criado_em) }])),
    atendimentos: atendimentos.map(a => ({
      id: a.id, placa: a.placa, tipoId: a.tipo_id, tipoNome: a.tipo_nome, etapas: a.etapas || [], etapaIndex: a.etapa_index,
      feitas: a.feitas || {}, concluido: a.concluido, concluidoEm: ms(a.concluido_em), criadoEm: ms(a.criado_em),
      criadoPorNome: a.criado_por_nome || '', clienteNome: a.cliente_nome || '', agendaId: a.agenda_id || null, danos: a.danos || '', objetos: a.objetos || '',
      ...(ctrl ? { valor: a.valor == null ? null : Number(a.valor) } : {}),
      fotos: fotosPorAt.get(a.id) || [], fotosApagadas: apagadasPorAt.get(a.id) || 0, historico: ctrl ? a.historico || [] : semValores(a.historico), versao: a.versao,
    })),
    estoque: {
      itens: itens.map(i => ({ id: i.id, nome: i.nome, unidade: i.unidade, minimo: Number(i.minimo) || 0 })),
      movimentos: movimentos.map(m => ({
        id: m.id, itemId: m.item_id, tipo: m.tipo, delta: Number(m.delta), obs: m.obs || '', porId: m.por_id, porNome: m.por_nome || '', em: ms(m.em),
      })),
    },
    agenda: agenda.map(a => ({
      id: a.id, cliente: a.cliente, tel: a.tel || '', servico: a.servico || '', data: String(a.data).slice(0, 10), marca: a.marca || '',
      prazo: a.prazo || 0, valor: a.valor == null ? null : Number(a.valor), obs: a.obs || '', status: a.status,
    })),
  };
}

const LIXEIRA_MS = 48 * 3600e3;

/* ---------- Validação ---------- */
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const RE_CAMINHO = /^(fotos|miniaturas)\/[a-z0-9]{8,64}\.jpg$/;
const RE_USUARIO = /^[a-z0-9._-]{2,40}$/;
const SO_CONTROLE = new Set(['funcionarios:salvar', 'funcionarios:remover', 'tipos:salvar', 'tipos:remover', 'itens:salvar', 'itens:remover',
  'atendimentos:remover', 'atendimentos:restaurar', 'fotos:remover', 'fotos:etapa', 'ajustes:salvar', 'senha:salvar', 'agenda:salvar', 'agenda:remover', 'movimentos:zerar']);
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const invalido = campo => erro(400, 'invalido', campo);
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
function id(v, campo = 'id') { const s = String(v == null ? '' : v); if (!RE_ID.test(s)) throw invalido(campo); return s; }
function idOuNulo(v, campo) { return v == null || v === '' ? null : id(v, campo); }
function num(v, campo) { const n = Number(v); if (v === null || v === '' || !Number.isFinite(n) || Math.abs(n) > 1e9) throw invalido(campo); return Math.round(n * 100) / 100; }
function quando(v, campo) { if (v == null) return null; const s = iso(v); if (!s) throw invalido(campo); return s; }
function etapas(v) {
  if (!Array.isArray(v) || v.length > 60) throw invalido('etapas');
  return v.map(e => txt(e, 80)).filter(Boolean);
}
function historico(v) {
  if (!Array.isArray(v)) throw invalido('historico');
  return v.slice(-1000).map(h => ({
    texto: txt(h && h.texto, 300), em: Number(h && h.em) || null, porId: h && h.porId ? String(h.porId).slice(0, 64) : null, porNome: txt(h && h.porNome, 80),
  }));
}
// O histórico guarda textos com valores ("Valor definido: R$ ..."). O Funcionário não recebe essas linhas.
const RE_HIST_VALOR = /^Valor (definido|removido)/;
function semValores(h) { return (Array.isArray(h) ? h : []).filter(x => !RE_HIST_VALOR.test(String(x && x.texto || ''))); }
function feitas(v) {
  const out = {};
  if (v && typeof v === 'object') for (const [k, t] of Object.entries(v)) if (/^\d{1,3}$/.test(k) && Number.isFinite(Number(t))) out[k] = Number(t);
  return out;
}

/* ---------- Gravação ---------- */
const agora = () => new Date().toISOString();
const q = encodeURIComponent;

async function upsert(c, tabela, linha, conflito = 'id') {
  await rest(c, `${tabela}?on_conflict=${conflito}`, { method: 'POST', body: linha, prefer: 'resolution=merge-duplicates,return=minimal' });
}
async function inserirSeNovo(c, tabela, linha) {
  await rest(c, `${tabela}?on_conflict=id`, { method: 'POST', body: linha, prefer: 'resolution=ignore-duplicates,return=minimal' });
}
async function marcar(c, tabela, filtro, campos) {
  await rest(c, `${tabela}?${filtro}`, { method: 'PATCH', body: campos, prefer: 'return=minimal' });
}

async function aplicar(c, op, eu, versoes) {
  const it = op.item || {};
  const quem = eu.nome;
  const ctrl = eu.nivel === 'controle';
  const tipoOp = `${op.col}:${op.acao}`;
  // Foto de etapa tirada errada: qualquer pessoa da equipe pode trocar (remove a antiga e manda outra).
  let fotoDeEtapa = false;
  if (!ctrl && tipoOp === 'fotos:remover') {
    const [f] = await rest(c, `sd_fotos?select=etapa&id=eq.${q(id(op.id))}`) || [];
    fotoDeEtapa = !!f && f.etapa != null;
  }
  if (!ctrl && SO_CONTROLE.has(tipoOp) && !fotoDeEtapa) throw erro(403, 'proibido', tipoOp);
  switch (tipoOp) {
    case 'funcionarios:salvar': {
      const fid = id(it.id);
      const nivel = it.nivel === 'controle' ? 'controle' : 'funcionario';
      if (fid === eu.id && nivel !== 'controle') throw erro(400, 'invalido', 'proprio_nivel');
      const nome = txt(it.nome, 60); if (!nome) throw invalido('nome');
      const linha = { id: fid, nome, nivel, ativo: true, atualizado_em: agora() };
      if (it.usuario !== undefined) {
        const usuario = txt(it.usuario, 40).toLowerCase();
        if (usuario && !RE_USUARIO.test(usuario)) throw invalido('usuario');
        linha.usuario = usuario || null;
      }
      return upsert(c, 'sd_funcionarios', linha).catch(e => { throw e.code === 'duplicado' ? erro(409, 'usuario_em_uso') : e; });
    }
    case 'funcionarios:remover': {
      const fid = id(op.id); if (fid === eu.id) throw erro(400, 'invalido', 'remover_a_si');
      return marcar(c, 'sd_funcionarios', `id=eq.${q(fid)}`, { ativo: false, atualizado_em: agora() });
    }
    // Nova senha. Se for de outra pessoa, as sessões abertas dela terminam.
    case 'senha:salvar': {
      const fid = id(it.id);
      const senha = String(it.senha || '');
      if (senha.length < 6 || senha.length > 200) throw invalido('senha');
      const [f] = await rest(c, `sd_funcionarios?select=sessao_versao&id=eq.${q(fid)}`) || [];
      if (!f) throw invalido('id');
      return marcar(c, 'sd_funcionarios', `id=eq.${q(fid)}`, {
        senha_hash: hashSenha(senha), sessao_versao: fid === eu.id ? f.sessao_versao : f.sessao_versao + 1,
        login_falhas: 0, login_bloqueado_ate: null, atualizado_em: agora(),
      });
    }
    case 'ajustes:salvar': {
      if (it.chave !== 'limpeza_fotos_dias') throw invalido('chave');
      const dias = Number(it.valor); if (!Number.isInteger(dias) || dias < 30 || dias > 40) throw invalido('valor');
      return upsert(c, 'sd_ajustes', { chave: it.chave, valor: dias, atualizado_em: agora() }, 'chave');
    }

    case 'tipos:salvar': {
      const nome = txt(it.nome, 60); if (!nome) throw invalido('nome');
      return upsert(c, 'sd_tipos_servico', { id: id(it.id), nome, etapas: etapas(it.etapas), ativo: true, atualizado_em: agora() });
    }
    case 'tipos:remover':
      return marcar(c, 'sd_tipos_servico', `id=eq.${q(id(op.id))}`, { ativo: false, atualizado_em: agora() });

    case 'veiculos:salvar': {
      const placa = String(it.placa || ''); if (!RE_PLACA.test(placa)) throw invalido('placa');
      return upsert(c, 'sd_veiculos', { placa, descricao: txt(it.descricao, 80), atualizado_em: agora() }, 'placa');
    }

    case 'itens:salvar': {
      const nome = txt(it.nome, 60); if (!nome) throw invalido('nome');
      return upsert(c, 'sd_estoque_itens', { id: id(it.id), nome, unidade: txt(it.unidade, 20) || 'un', minimo: num(it.minimo || 0, 'minimo'), ativo: true, atualizado_em: agora() });
    }
    case 'itens:remover':
      return marcar(c, 'sd_estoque_itens', `id=eq.${q(id(op.id))}`, { ativo: false, atualizado_em: agora() });

    case 'movimentos:salvar': {
      const tipo = ['entrada', 'saida', 'ajuste'].includes(it.tipo) ? it.tipo : null; if (!tipo) throw invalido('tipo');
      if (!ctrl && tipo !== 'saida') throw erro(403, 'proibido', 'movimento');
      return inserirSeNovo(c, 'sd_estoque_movimentos', {
        id: id(it.id), item_id: id(it.itemId, 'itemId'), tipo, delta: num(it.delta, 'delta'), obs: txt(it.obs, 120),
        por_id: it.porId ? String(it.porId).slice(0, 64) : null, por_nome: txt(it.porNome, 80), em: quando(it.em, 'em') || agora(),
      });
    }

    case 'atendimentos:salvar': {
      const placa = String(it.placa || ''); if (!RE_PLACA.test(placa)) throw invalido('placa');
      const lista = etapas(it.etapas); if (!lista.length) throw invalido('etapas');
      const idx = Number(it.etapaIndex); if (!Number.isInteger(idx) || idx < 0 || idx >= lista.length) throw invalido('etapaIndex');
      const linha = {
        cliente_nome: txt(it.clienteNome, 80),
        tipo_id: idOuNulo(it.tipoId, 'tipoId'), tipo_nome: txt(it.tipoNome, 60), etapas: lista, etapa_index: idx, feitas: feitas(it.feitas),
        concluido: !!it.concluido, concluido_em: it.concluido ? quando(it.concluidoEm, 'concluidoEm') || agora() : null,
        danos: txt(it.danos, 1000), objetos: txt(it.objetos, 600),
        historico: historico(it.historico || []), atualizado_em: agora(),
      };
      // Valor só o Controle define. O Funcionário não recebe o valor, então não mexe nele.
      if (ctrl) linha.valor = it.valor == null || it.valor === '' ? null : num(it.valor, 'valor');
      const atId = id(it.id);
      if (op.versao == null) {
        await rest(c, 'sd_atendimentos', {
          method: 'POST', prefer: 'return=minimal',
          body: { id: atId, placa, criado_em: quando(it.criadoEm, 'criadoEm') || agora(), criado_por_nome: txt(it.criadoPorNome, 80), versao: 1,
          agenda_id: idOuNulo(it.agendaId, 'agendaId'), ...linha },
        }).catch(e => { throw e.code === 'duplicado' ? erro(409, 'placa_em_andamento', e.detail) : e; });
        versoes[atId] = 1;
        return;
      }
      const v = Number(op.versao); if (!Number.isInteger(v)) throw invalido('versao');
      // O Funcionário recebeu o histórico sem as linhas de valor: mantém o que está no banco e só acrescenta as linhas novas.
      if (!ctrl) {
        const [atual] = await rest(c, `sd_atendimentos?select=historico&id=eq.${q(atId)}&versao=eq.${v}`) || [];
        if (!atual) throw erro(409, 'conflito', atId);
        const salvo = Array.isArray(atual.historico) ? atual.historico : [];
        const novas = linha.historico.slice(semValores(salvo).length).filter(h => !RE_HIST_VALOR.test(h.texto));
        linha.historico = historico([...salvo, ...novas]);
      }
      // Correção de placa: só o Controle (o veículo novo é gravado antes, na mesma lista de operações).
      if (ctrl) linha.placa = placa;
      const r = await rest(c, `sd_atendimentos?id=eq.${q(atId)}&versao=eq.${v}&excluido_em=is.null&select=versao,agenda_id,concluido`, {
        method: 'PATCH', body: { ...linha, versao: v + 1 }, prefer: 'return=representation',
      }).catch(e => { throw e.code === 'duplicado' ? erro(409, 'placa_em_andamento', e.detail) : e; });
      if (!r || !r.length) throw erro(409, 'conflito', atId);
      versoes[atId] = r[0].versao;
      // Serviço que veio da agenda terminou: o agendamento "em serviço" vira "concluído".
      if (r[0].concluido && r[0].agenda_id) {
        await marcar(c, 'sd_agenda', `id=eq.${q(r[0].agenda_id)}&status=eq.em_servico`, { status: 'concluido', atualizado_em: agora() });
      }
      return;
    }
    case 'atendimentos:remover':
      return marcar(c, 'sd_atendimentos', `id=eq.${q(id(op.id))}&excluido_em=is.null`, { excluido_em: agora(), excluido_por: quem, atualizado_em: agora() });
    // Lixeira: volta o atendimento excluído há menos de 48 h. Se a placa já tem outro serviço em andamento, não volta.
    case 'atendimentos:restaurar': {
      const atId = id(op.id);
      const desde = new Date(Date.now() - LIXEIRA_MS).toISOString();
      const r = await rest(c, `sd_atendimentos?id=eq.${q(atId)}&excluido_em=gte.${q(desde)}&select=id,versao`, {
        method: 'PATCH', body: { excluido_em: null, excluido_por: null, atualizado_em: agora() }, prefer: 'return=representation',
      }).catch(e => { throw e.code === 'duplicado' ? erro(409, 'placa_em_andamento', e.detail) : e; });
      if (!r || !r.length) throw erro(409, 'lixeira_vencida', atId);
      versoes[atId] = r[0].versao;
      return;
    }

    case 'fotos:salvar': {
      const caminho = String(it.caminho || ''); if (!RE_CAMINHO.test(caminho)) throw invalido('caminho');
      const miniatura = it.miniatura && RE_CAMINHO.test(String(it.miniatura)) ? String(it.miniatura) : null;
      return inserirSeNovo(c, 'sd_fotos', {
        id: id(it.id), atendimento_id: id(it.atendimentoId, 'atendimentoId'), rotulo: txt(it.rotulo, 40) || 'Outra',
        caminho, miniatura, criado_em: quando(it.em, 'em') || agora(),
        etapa: Number.isInteger(it.etapa) && it.etapa >= 0 && it.etapa < 1000 ? it.etapa : null,
      });
    }
    case 'fotos:remover':
      return marcar(c, 'sd_fotos', `id=eq.${q(id(op.id))}&removida_em=is.null`, { removida_em: agora(), removida_por: quem });
    // Etapas do tipo atualizadas em Ajustes: a foto acompanha a etapa na lista nova (null = virou foto comum).
    case 'fotos:etapa': {
      const etapa = op.etapa == null ? null : Number(op.etapa);
      if (etapa !== null && !(Number.isInteger(etapa) && etapa >= 0 && etapa < 1000)) throw invalido('etapa');
      return marcar(c, 'sd_fotos', `id=eq.${q(id(op.id))}`, { etapa });
    }

    // Zerar o estoque (Controle): todos os movimentos atuais ficam descartados (não são apagados).
    // O saldo de cada material volta a 0; depois é só lançar entradas ou fazer contagem.
    case 'movimentos:zerar':
      return marcar(c, 'sd_estoque_movimentos', 'descartado_em=is.null', { descartado_em: agora(), descartado_por: quem });

    case 'agenda:salvar': {
      const cliente = txt(it.cliente, 80); if (!cliente) throw invalido('cliente');
      const data = String(it.data || ''); if (!RE_DATA.test(data) || isNaN(Date.parse(data))) throw invalido('data');
      const prazo = Number(it.prazo || 0); if (!Number.isInteger(prazo) || prazo < 0 || prazo > 90) throw invalido('prazo');
      const status = ['agendado', 'em_servico', 'concluido', 'cancelado'].includes(it.status) ? it.status : null; if (!status) throw invalido('status');
      return upsert(c, 'sd_agenda', {
        id: id(it.id), cliente, tel: txt(it.tel, 30), servico: txt(it.servico, 120), data, marca: txt(it.marca, 40), prazo,
        valor: it.valor == null || it.valor === '' ? null : num(it.valor, 'valor'), obs: txt(it.obs, 600), status, atualizado_em: agora(),
      });
    }
    // Entrada do veículo feita a partir do agendamento: qualquer pessoa da equipe pode marcar como concluído.
    case 'agenda:entrada':
      return marcar(c, 'sd_agenda', `id=eq.${q(id(op.id))}&excluido_em=is.null`, { status: 'em_servico', atualizado_em: agora() });
    case 'agenda:remover':
      return marcar(c, 'sd_agenda', `id=eq.${q(id(op.id))}&excluido_em=is.null`, { excluido_em: agora(), excluido_por: quem, atualizado_em: agora() });

    default:
      throw invalido('op');
  }
}

module.exports = async (req, res) => {
  const c = config();
  if (!c) return send(res, 501, { error: 'not_configured' });

  try {
    const eu = await usuarioDaSessao(c, req);
    if (req.method === 'GET') return send(res, 200, await carregar(c, eu));
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

    let body;
    try { body = await readJsonBody(req); } catch { return send(res, 400, { error: 'bad_request' }); }
    const ops = Array.isArray(body.ops) ? body.ops : null;
    if (!ops || ops.length > 2000) return send(res, 400, { error: 'bad_request' });

    const versoes = {};
    for (let i = 0; i < ops.length; i++) {
      try { await aplicar(c, ops[i] || {}, eu, versoes); }
      catch (e) { e.index = i; e.versoes = versoes; throw e; }
    }
    return send(res, 200, { ok: true, versoes });
  } catch (e) {
    if (!e.status) console.error(e);
    return send(res, e.status || 500, { error: e.code || 'server_error', detail: e.detail, index: e.index, versoes: e.versoes });
  }
};
