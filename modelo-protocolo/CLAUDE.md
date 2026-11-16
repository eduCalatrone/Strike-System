# Protocolos da Strike Details pelo Claude

Quando o Eduardo mandar os dados de um cliente (texto, print do WhatsApp ou imagem de protocolo antigo) e pedir um protocolo, o Claude faz tudo sozinho: **gera a imagem (PNG de 2048 px) e lança o protocolo no sistema** (tabela `sd_protocolos`, a mesma da Galeria de protocolos em Mais > Protocolos).

A imagem sai do **mesmo gerador do sistema** (`index.html`: `protoCalc`, `protoDoc`, `protoPNG`), pelo script `modelo-protocolo/lancar.js`. Nunca montar o protocolo à mão em HTML, nem com outra ferramenta: o layout, as contas e as regras ficam iguais às do sistema só assim.

## Passo a passo

1. **Repositório**: trabalhar no clone de `eduCalatrone/Strike-System` (o `CLAUDE.md` da raiz vale também). Precisa de Node e do Playwright com o Chromium (`npm i -g playwright && npx playwright install chromium`, se faltar).
2. **Ler os dados** do pedido. Faltando a **data de entrada ou de entrega**, perguntar antes (sem data não gera; só gera "A definir" se o Eduardo disser que é sem data).
3. **Conferir no banco** (Supabase `afngfcclipuuptskoowh`, só `select`), em uma consulta:
   ```sql
   -- agendamento do cliente (para ligar o protocolo e conferir valores)
   select 'ag' k, id, cliente, servico, data::text, prazo, valor, valor_entrada, status from sd_agenda
    where excluido_em is null and status <> 'cancelado' and cliente ilike '%PRIMEIRO_NOME%';
   -- veículo já em serviço com essa placa ou esse cliente
   select 'at' k, id, cliente_nome, placa, tipo_nome, valor, valor_entrada, protocolo_id from sd_atendimentos
    where excluido_em is null and concluido = false and (placa = 'PLACA' or cliente_nome ilike '%PRIMEIRO_NOME%');
   -- protocolo que já existe (não duplicar: se já tem, atualizar com "id")
   select 'pr' k, id, cliente, placa, data::text, atendimento_id from sd_protocolos
    where excluido_em is null and (cliente ilike '%PRIMEIRO_NOME%' or placa = 'PLACA');
   ```
   - Achou o agendamento: põe o `id` dele em `agId`.
   - Achou o veículo em serviço: põe o `id` em `atendimentoId`.
   - Já existe protocolo desse cliente para essa data: usar o `id` dele (atualiza em vez de criar outro).
   - Valor ou entrada do agendamento diferente do protocolo: avisar o Eduardo na resposta (não corrigir a agenda sem ele pedir).
4. **Escrever o pedido** num arquivo JSON fora do repositório (ex.: `/tmp/proto/pedidos.json`), no formato abaixo. Pode ser uma lista com vários.
5. **Gerar**: `node modelo-protocolo/lancar.js /tmp/proto/pedidos.json /tmp/proto/saida`
   - Mostra o resumo de cada um (total, entrada, saldo, dias da semana, avisos) e cria `<Nome do Cliente>.png` e `lancar.sql`.
   - Saiu com `✗` (bloqueio): corrigir o pedido e gerar de novo.
   - **Conferir o resumo** com o que o Eduardo mandou (valores, datas, dia da semana) e **abrir o PNG** para olhar antes de lançar.
6. **Lançar**: rodar o conteúdo de `lancar.sql` no Supabase (`execute_sql`). Ele só faz `insert`/`update` em `sd_protocolos` e, com `atendimentoId`, liga o veículo (`sd_atendimentos.protocolo_id`). O sistema atualiza sozinho nos aparelhos.
7. **Entregar**: mandar o PNG para o Eduardo (SendUserFile) e responder curto: o que foi lançado, ligado a qual agendamento ou veículo, e as diferenças encontradas.

## Formato do pedido

```json
{
  "catalogo": "cabine-strada",
  "agId": "id do agendamento ou null",
  "atendimentoId": "id do veículo em serviço (opcional)",
  "id": "só para atualizar um protocolo que já existe",
  "tipo": "agendamento",
  "cliente": { "nome": "Thierry Braga da Silva", "tel": "69993091399", "cidade": "Nova Mamoré - RO", "end": "Av. Severino Inácio da Rocha, 6770", "email": "" },
  "veiculo": { "modelo": "Fiat Strada Ranch 2026/2026", "placa": "SQQ6B77", "cor": "", "km": "7500" },
  "serv": { "valor": 3100 },
  "extras": [
    { "n": "Carpete", "d": "Revestimento de carpete do veículo.", "v": 900, "tipo": "valor" },
    { "n": "Tratamento de Motor", "d": "Detalhamento completo do cofre do motor com aplicação de verniz protetivo contra oxidação.", "tipo": "brinde" },
    { "n": "Desconto", "d": "Desconto no pacote.", "v": 60, "tipo": "desconto" }
  ],
  "datas": { "ent": "2027-01-07", "entH": "08:00", "sai": "2027-01-09", "saiH": "13:00", "semData": false },
  "pag": { "modo": "pct", "pct": "30" },
  "leg": "",
  "nota": "",
  "obs": ""
}
```

- Só precisa mandar o que muda; o resto vem do serviço do catálogo e fica `---` no documento.
- `catalogo` (serviço principal, já com título, descrição, checklist e valor de tabela): `cabine-strada` (3.100), `cabine-toro` (3.600), `basic` (375), `interior-detail` (750), `interior-care` (1.180), `interior-premium` (1.600), `polimento` (1.400), `vitrificacao` (3.900), `motor` (480), `enceramento` (520), `carpete`. Valor diferente do de tabela (ex.: Argo 2.800, Strada 2.900): `"serv": { "valor": 2800 }`. Serviço fora do catálogo: `"catalogo": "livre"` e `"serv": { "titulo": "...", "desc": "...", "item": "...", "valor": ... }`.
- `extras.tipo`: `valor` (soma no total), `brinde` (sai "Brinde" em verde, sem valor) ou `desconto` (abate do total).
- `pag.modo`: `pct` (30% de entrada, padrão), `valor` (entrada fixa: `"ent": "930"`), `zero` (sem entrada: tira a 1ª cláusula) ou `none` (à vista). Entrada que não é 30% do total vai como `valor`.
- `leg`: legenda do total; vazio = automática (ex.: "Cabine Blindada R$ 3.100,00 + carpete R$ 900,00", "Cabine Blindada + tratamento de motor de brinde", "Serviços R$ 2.560,00 com desconto de R$ 60,00").
- `nota`: observação dentro do cartão do serviço. `obs`: vira mais um item da lista de cláusulas.
- Ordem de serviço (serviço já feito): `"tipo": "os"`, `"os": { "data": "2026-11-10", "status": "feito" }` (ou `"andamento"`) e `"pag": { "modo": "valor", "ent": "..." }` se teve entrada (senão `"none"`).

## Regras (o gerador já aplica; só não atrapalhar)

- Nome com iniciais maiúsculas ("da", "de", "dos" minúsculos); o arquivo é o nome do cliente (`Thierry Braga da Silva.png`).
- Dia da semana sempre do calendário (nunca escrever à mão).
- Campo vazio sai `---`. Telefone sai `(69) 99999-9999`; com 8 dígitos depois do DDD sai assim mesmo, com aviso: conferir com o Eduardo.
- Cidade sem travessão ("Nova Mamoré - RO").
- Sempre "Strike Details", nunca "Strike" sozinho. Nunca travessão longo (em dash).
- Não apagar nada no banco: nada de `delete`. Protocolo errado se corrige com `id` (update) ou é excluído pelo próprio sistema (vai para a Lixeira).
