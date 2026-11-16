#!/usr/bin/env node
// Gera protocolos (PNG de 2048 px) com o MESMO gerador do sistema (index.html: protoCalc, protoDoc, protoPNG)
// e escreve o SQL para lançar na tabela sd_protocolos. Usado pelo Claude (ver modelo-protocolo/CLAUDE.md).
//
//   node modelo-protocolo/lancar.js pedidos.json [pasta-de-saida]
//
// pedidos.json: um pedido ou uma lista. Cada pedido tem os campos do protocolo (formato do gerador) e, se quiser:
//   catalogo: 'cabine-strada' | 'cabine-toro' | 'basic' | ... (ver PROTO_CATALOGO no index.html; padrão cabine-strada)
//   atendimentoId: id do veículo já em serviço (liga o protocolo ao veículo)
//   id: para ATUALIZAR um protocolo que já existe (sem id, cria um novo)
// Saída: <pasta>/<Nome do Cliente>.png, <pasta>/lancar.sql e um resumo no terminal. Não grava nada no banco.
// Precisa do Playwright (Chromium). Sai com código 1 se algum pedido tiver bloqueio (ex.: sem data).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const [, , arqPedidos, saidaArg] = process.argv;
if (!arqPedidos) { console.error('Uso: node modelo-protocolo/lancar.js pedidos.json [pasta-de-saida]'); process.exit(2); }
const SAIDA = path.resolve(saidaArg || 'protocolos-gerados');
fs.mkdirSync(SAIDA, { recursive: true });
let pedidos = JSON.parse(fs.readFileSync(arqPedidos, 'utf8'));
if (!Array.isArray(pedidos)) pedidos = [pedidos];

let chromium;
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); } catch {
    console.error('Playwright não encontrado. Instale com: npm i -g playwright && npx playwright install chromium'); process.exit(2);
  }
}

const PORTA = 3000 + Math.floor(Math.random() * 900) + 100;
const sq = v => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const nomeProprio = t => String(t || '').trim().replace(/\s+/g, ' ');
const placaDe = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

(async () => {
  const srv = spawn(process.execPath, [path.join(RAIZ, 'dev-server.js')], { cwd: RAIZ, env: { ...process.env, PORT: String(PORTA) }, stdio: 'ignore' });
  const sair = code => { try { srv.kill(); } catch {} process.exit(code); };
  await new Promise(r => setTimeout(r, 1200));
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
    const erros = [];
    pg.on('pageerror', e => erros.push(e.message));
    // O site é carregado sem login (as /api respondem 401); só as funções do gerador são usadas.
    await pg.route('**/api/**', r => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    const linhas = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').split('\n');
    const fim = linhas.findIndex((l, i) => i > 1000 && l === '})();');
    if (fim < 0) throw new Error('Não achei o fim do script principal do index.html.');
    linhas[fim] = 'window.__proto = { protoNovo, protoPreset, protoCalc, protoPNG, protoArquivo, protoDadosAgenda, fmtQ, uid };\n' + linhas[fim];
    await pg.route(`http://localhost:${PORTA}/`, r => r.fulfill({ status: 200, contentType: 'text/html', body: linhas.join('\n') }));
    await pg.goto(`http://localhost:${PORTA}/`);
    await pg.waitForFunction(() => window.__proto, null, { timeout: 15000 });

    const sql = [], usados = new Set();
    let bloqueado = false;
    for (const ped of pedidos) {
      const r = await pg.evaluate(async ped => {
        const P = window.__proto;
        const e = P.protoNovo();
        P.protoPreset(e, ped.catalogo || 'cabine-strada');
        if (ped.id) e.id = ped.id;
        for (const k of ['tipo', 'agId', 'nota', 'leg', 'obs']) if (ped[k] != null) e[k] = ped[k];
        for (const k of ['cliente', 'veiculo', 'datas', 'os', 'pag']) if (ped[k]) Object.assign(e[k], ped[k]);
        if (ped.serv) Object.assign(e.serv, ped.serv);
        if (typeof e.serv.valor === 'number') e.serv.valor = P.fmtQ(e.serv.valor);
        if (Array.isArray(ped.extras)) e.extras = ped.extras.map(x => ({ n: x.n || '', d: x.d || '', v: x.v == null ? '' : String(x.v), tipo: x.tipo || 'valor' }));
        for (const k of ['ent', 'pct']) if (typeof e.pag[k] === 'number') e.pag[k] = String(e.pag[k]);
        for (const k of ['km']) if (typeof e.veiculo[k] === 'number') e.veiculo[k] = String(e.veiculo[k]);
        const c = P.protoCalc(e);
        const resumo = { id: e.id, nome: c.nome, arquivo: P.protoArquivo(e), total: c.total, entrada: c.entrada, saldo: c.saldo, legenda: c.legenda,
          entrada_dia: c.entTxt, entrega_dia: c.saiTxt, execucao: c.execTxt, os_dia: c.osTxt, tel: c.tel, cidade: c.cidade, veiculo: c.modelo, placa: c.placa,
          avisos: c.avisos, bloqueio: c.bloqueio };
        if (c.bloqueio) return { resumo, estado: e };
        // Agenda (16/11/2026): os dados que o protocolo manda no agendamento ligado (ou no novo).
        if (e.tipo === 'agendamento' && !e.datas.semData && e.datas.ent) {
          resumo.agenda = P.protoDadosAgenda(e);
          if (!e.agId && ped.criarAgenda !== false && e.datas.ent >= new Date(Date.now() - 7 * 864e5 - 4 * 3600e3).toISOString().slice(0, 10)) { e.agId = 'ag' + P.uid(); resumo.agendaNova = e.agId; }
        }
        const blob = await P.protoPNG(e);
        return { resumo, estado: e, png: Array.from(new Uint8Array(await blob.arrayBuffer())) };
      }, ped);
      const { resumo, estado, png } = r;
      if (resumo.bloqueio) { bloqueado = true; console.log(`\n✗ ${resumo.nome || '(sem nome)'}: ${resumo.bloqueio}`); continue; }
      let arq = resumo.arquivo, n = 2;
      while (usados.has(arq)) arq = resumo.arquivo.replace(/\.png$/, ` (${n++}).png`);
      usados.add(arq);
      fs.writeFileSync(path.join(SAIDA, arq), Buffer.from(png));
      console.log(`\n✓ ${arq}\n${JSON.stringify(resumo, null, 1)}`);
      // Mesmas colunas que a op protocolos:salvar do api/dados grava.
      const os = estado.tipo === 'os';
      const dia = String((os ? estado.os.data : estado.datas.ent) || '');
      const data = /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : null;
      const atId = ped.atendimentoId || null;
      const cols = { dados: JSON.stringify(estado), tipo: os ? 'os' : 'agendamento', cliente: (resumo.nome || nomeProprio(estado.cliente.nome)).slice(0, 80), placa: placaDe(estado.veiculo.placa), data };
      if (ped.id) {
        sql.push(`update sd_protocolos set dados = ${sq(cols.dados)}::jsonb, tipo = ${sq(cols.tipo)}, cliente = ${sq(cols.cliente)}, placa = ${sq(cols.placa)}, data = ${sq(cols.data)}${atId ? `, atendimento_id = ${sq(atId)}` : ''}, atualizado_em = now(), atualizado_por = 'Eduardo' where id = ${sq(estado.id)} and excluido_em is null;`);
      } else {
        sql.push(`insert into sd_protocolos (id, dados, tipo, cliente, placa, data, atendimento_id, criado_em, criado_por, atualizado_em, atualizado_por) values (${sq(estado.id)}, ${sq(cols.dados)}::jsonb, ${sq(cols.tipo)}, ${sq(cols.cliente)}, ${sq(cols.placa)}, ${sq(cols.data)}, ${sq(atId)}, now(), 'Eduardo', now(), 'Eduardo');`);
      }
      // Agenda sincronizada (16/11/2026): o protocolo manda nos dados do agendamento; a situação vem do veículo.
      const ag = resumo.agenda;
      if (ag && estado.agId) {
        const campos = { cliente: ag.cliente, tel: ag.tel, servico: ag.servico, marca: ag.marca, data: ag.data, prazo: ag.prazo == null ? 0 : ag.prazo, valor: ag.valor, valor_entrada: ag.entrada };
        const v = k => (campos[k] == null ? 'null' : typeof campos[k] === 'number' ? String(campos[k]) : sq(campos[k]));
        if (resumo.agendaNova) {
          sql.push(`insert into sd_agenda (id, cliente, tel, servico, marca, data, prazo, valor, valor_entrada, obs, status, origem, criado_em, atualizado_em) values (${sq(estado.agId)}, ${v('cliente')}, ${v('tel')}, ${v('servico')}, ${v('marca')}, ${v('data')}, ${v('prazo')}, ${v('valor')}, ${v('valor_entrada')}, '', 'agendado', 'protocolo', now(), now());`);
        } else {
          sql.push(`update sd_agenda set ${Object.keys(campos).filter(k => campos[k] != null && campos[k] !== '').map(k => `${k} = ${v(k)}`).join(', ')}, atualizado_em = now() where id = ${sq(estado.agId)} and excluido_em is null;`);
        }
      }
      if (atId && estado.agId) {
        sql.push(`update sd_atendimentos set agenda_id = ${sq(estado.agId)} where id = ${sq(atId)} and excluido_em is null;`);
        sql.push(`update sd_agenda a set status = case when t.concluido then 'concluido' else 'em_servico' end, atualizado_em = now() from sd_atendimentos t where t.agenda_id = a.id and t.excluido_em is null and a.id = ${sq(estado.agId)};`);
      }
      // Veículo já em serviço: liga o protocolo nele também (versao + 1 para outro aparelho não gravar por cima).
      if (atId) sql.push(`update sd_atendimentos set protocolo_id = ${sq(estado.id)}, versao = versao + 1, atualizado_em = now() where id = ${sq(atId)} and excluido_em is null and (protocolo_id is null or protocolo_id = ${sq(estado.id)});`);
    }
    if (sql.length) {
      sql.push("select id, cliente, placa, data, atendimento_id from sd_protocolos where criado_em > now() - interval '10 minutes' or atualizado_em > now() - interval '10 minutes' order by atualizado_em desc;");
      fs.writeFileSync(path.join(SAIDA, 'lancar.sql'), sql.join('\n') + '\n');
      console.log(`\nSQL: ${path.join(SAIDA, 'lancar.sql')}`);
    }
    if (erros.length) console.log('\nErros na página:', erros.join(' | '));
    await b.close();
    sair(bloqueado ? 1 : 0);
  } catch (err) {
    console.error(err);
    await b.close();
    sair(1);
  }
})();
