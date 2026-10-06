# Strike Details | Sistema de controle

Contexto para qualquer sessão que trabalhar neste repositório. Leia antes de mudar código.

## O que é

Sistema interno da **Strike Details Estética Automotiva** (matriz em Jaru/RO) para controlar os veículos em serviço: leitura de placa, entrada do veículo com fotos, etapas do serviço, estoque de materiais e acompanhamento pelo cliente.

- Responsáveis: Eduardo (desenvolvedor) e Petherson (dono). Os dois usam o perfil **Controle**.
- Hoje só a loja principal. Sem prazo para outras lojas (não é multiempresa).
- Idioma de tudo: português do Brasil.
- Deploy: Vercel, projeto `strike-system` (ligado a este repositório, branch `main`). Todo push no `main` publica.

## Regras de marca e texto (obrigatórias)

- O nome é sempre **"Strike Details"** (ou "Strike Details Estética Automotiva"). Nunca "Strike" sozinho: é outra empresa.
- Nunca usar travessão longo (em dash) em textos da interface ou documentos.
- Visual: branco, cinza e preto. Fontes: Archivo Black (marca), Barlow Condensed (títulos e placas), Inter (texto).
- Interface pensada para celular primeiro (os funcionários usam Android e iPhone). Por isso é site, não app de loja, mas o acesso interno pode ser instalado na tela inicial (PWA): cartão "Usar como app" no login e no Início (este com "Agora não", salvo em `localStorage` `sd:instalar:fechado`). Android usa o pedido de instalação do navegador; iPhone mostra o passo a passo do Safari. O manifest só é ligado fora de `/cliente`, então a página do cliente continua como site comum.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | O sistema inteiro: telas, dados, leitor de placa. HTML + CSS + JS num arquivo só, sem build. |
| `api/read-plate.js` | Função da Vercel que chama o Plate Recognizer (Snapshot Cloud, `regions=br`) e esconde a chave. Exige o login da equipe (token da sessão, como as outras funções), para ninguém de fora gastar a cota. Fora isso, não mudar sem motivo: está funcionando em produção. |
| `api/dados.js` | Lê e grava os dados da equipe no Supabase (GET tudo, POST lista de operações). |
| `api/foto.js` | Envia uma foto (e a miniatura) para o Storage do Supabase. |
| `api/cliente.js` | Área do cliente: etapa, andamento, fotos e registro de avarias de uma placa. Sem valores nem nomes. |
| `api/presenca.js` | Presença da equipe: o site avisa enquanto está aberto e na tela; o Controle recebe a lista na resposta. |
| `api/login.js` | Login da equipe com usuário e senha. Devolve o token da sessão. |
| `api/limpeza.js` | Limpeza diária das fotos antigas (agendada em `vercel.json`). |
| `vercel.json` | Região das funções (`pdx1`, perto do banco), agenda da limpeza e a página `/cliente`. |
| `api/_supabase.js` | Peças comuns das funções acima (não vira endereço). |
| `dev-server.js` | Servidor local sem dependências (`node dev-server.js`, porta 3000). Serve o site e roteia `/api/<nome>` para `api/<nome>.js`. A Vercel ignora. |
| `.env.exemplo` | Modelo de variáveis para rodar local. O `.env` real nunca vai para o Git. |
| `manifest.webmanifest`, `sw.js`, `icons/` | App na tela inicial (PWA) do acesso interno. Ícones gerados da logo de setas. O `sw.js` só guarda a página e as imagens; `/api` nunca passa pelo cache. |

Variáveis na Vercel: `PLATE_RECOGNIZER_TOKEN` (secreta), `SUPABASE_URL`, `SUPABASE_KEY` (chave publicável), `SD_CHAVE_BANCO` (secreta), `CRON_SECRET` (secreta, usada pela limpeza) e `ACCESS_CODE` (opcional, só do leitor de placa).

## Perfis de acesso

Duas páginas separadas:
- **Equipe** (`/`): login com usuário e senha. Cada pessoa tem o seu, criado pelo Controle em Ajustes > Equipe. Cada linha mostra iniciais, nome, nível e usuário; o "Editar" abre nome, nível (Funcionário/Controle), usuário, senha e "Remover pessoa".
- **Cliente** (`/cliente`, link `/cliente#/PLACA`): sem login, só digita a placa.

Login próprio (tabela `sd_funcionarios`: `usuario`, `senha_hash` com scrypt), sem o Auth do Supabase, de propósito: usuários do Auth teriam acesso às tabelas `leads`, `autorizados` e `historico` do outro sistema pelas políticas de lá. O token dura 60 dias; trocar a senha de alguém ou remover a pessoa derruba as sessões dela. 5 senhas erradas bloqueiam o usuário por 5 minutos. As regras abaixo são conferidas também no servidor (`api/dados`), e o Funcionário não recebe valores. O Funcionário também só recebe os atendimentos em andamento e os concluídos dos últimos 7 dias (fotos só desses); os antigos chegam resumidos por placa em `anteriores` (quantas vezes veio, última vez, nome do cliente), usados por `passagensDaPlaca` na leitura da placa e na entrada. O Controle recebe tudo.

- **Funcionário**: lê a placa, registra a entrada do veículo com fotos, conclui etapas, registra retiradas do estoque.
- **Controle** (nível máximo): tudo do funcionário + ajustar etapa, valor do serviço, entradas/contagem/mínimo do estoque, histórico, tipos de serviço e equipe.
- **Cliente**: só digita a placa e vê etapa atual, andamento (datas) e fotos, em duas abas: **Andamento** (etapas e fotos da entrada, sem as de "Danos") e **Observações** (texto de "Danos ou problemas", "Objetos pessoais" e, no bloco "Fotos", as fotos de "Danos"). No Andamento, a foto de cada etapa concluída aparece embaixo do nome da etapa (até 300 px de largura) (toque abre a foto inteira). Nunca mostrar valores, nome do cliente nem nomes da equipe.

## Telas (roteamento por hash)

- `#/` login da equipe (usuário e senha) · página do cliente em `/cliente` (hash `#/PLACA`)
- `#/inicio` galeria dos veículos em serviço. Card: foto de capa (Frente), **modelo** (só as 2 primeiras palavras da descrição, em maiúsculas, `modeloCurto`), **placa** (mini placa estilo Mercosul, `miniPlaca`: faixa azul com "BRASIL" no centro e a bandeira do Brasil em SVG no canto direito) com o **nome do cliente** ao lado (desce de linha se não couber; ou "(NOME PENDENTE)"), **serviço**, situação e barra de progresso. Sem modelo cadastrado, a placa vira o título.
- `#/placa` "Adicionar veículo": câmera ao vivo com moldura, foto da galeria ou digitar
- `#/novo/PLACA` entrada do veículo (campo "Veículo (marca e modelo primeiro)", porque o Início usa as 2 primeiras palavras): nome do cliente (opcional, vem preenchido com o do último serviço da placa; vazio aparece "(NOME PENDENTE)"), tipo de serviço (obrigatório, começa sem escolha; só vem pronto se o agendamento bater), descrição, fotos, danos, objetos pessoais (valor só para Controle)
- `#/veiculo/ID` topo no padrão do card do Início (`topoVeiculo`: foto da Frente de fundo com degradê, modelo curto, mini placa e cliente; embaixo serviço, entrada e a descrição completa; sem foto, fundo escuro; tocar abre a foto), etapas com botão "Concluir: etapa", fotos, estado na entrada, histórico; bloco extra do Controle
- `#/estoque`, `#/historico` (Controle), `#/ajustes` (Controle, pela engrenagem no topo; tem a Lixeira)
- Botão de recarregar (seta circular) no topo só aparece no app instalado (no iPhone não há botão do navegador). Espera os envios pendentes antes de recarregar.
- `#/agenda` calendário (mês/ano, feriados de Jaru/RO, faixa até a entrega, dia escolhido com entradas e entregas) · `#/agenda/ID` agendamento (Controle edita; Funcionário só vê) · `#/agenda/novo`
- `#/equipe` (Controle): **Status da equipe**, aberto pelo botão em Relatórios (cartão escuro `#equipe-cta` com "Ao vivo", resumo online/parados/fora e as iniciais de quem está no sistema, atualizado a cada aviso). Resumo Online/Parados/Fora e lista com a tela de cada um; cada pessoa é clicável. Atualiza sozinho a cada 3 s e abre com o último dado já buscado (Relatórios já pede a presença).
- `#/equipe/ID` (Controle): **histórico do funcionário** (`renderFuncionario`): status ao vivo, período (Hoje, 7 dias, 30 dias, Tudo), quadros (tempo no sistema, etapas concluídas, veículos recebidos, fotos e retiradas) e linha do tempo por dia. Junta as linhas do histórico dos atendimentos com `porId` da pessoa (com link para o veículo), os movimentos de estoque dela e as entradas/saídas do sistema (`GET api/presenca?id=`, tabela `sd_presenca_eventos`, últimos 60 dias).
- `#/relatorios` (Controle): cartões "Histórico de serviços" (claro) e "Status da equipe" (escuro) no topo; período em grade (este mês, mês passado, este ano ou escolher), faturamento e estoque na tela e "Baixar PDF"
- Menu inferior: Início, Agenda, Adicionar (botão preto no meio), Estoque; Controle também tem Relatórios. Ajustes do Controle ficam na engrenagem do topo. A aba aberta tem fundo cinza atrás do ícone.

## Regras de negócio decididas

- **Status do serviço = a etapa atual** (não existe campo de status separado).
- Cada tipo de serviço tem sua lista de etapas, editável em Ajustes. Padrão (Cabine Blindada): Inspeção, Desmontagem, Limpeza externa, Limpeza interna, Limpeza de peças desmontadas, Montagem. O atendimento guarda uma cópia das etapas, mas mudar as etapas de um tipo em Ajustes atualiza também os atendimentos em andamento desse tipo (`sincronizarEtapas`): o que já foi feito continua feito (ligado pelo nome), com data e foto (op `fotos:etapa` muda o número da etapa da foto; foto de etapa removida vira foto comum). Etapa nova no meio fica pendente mesmo com as seguintes feitas (`etapaFeita`: antes da atual ou com data em `feitas`); ao concluir, pula as já feitas. Concluídos não mudam. Se algum em andamento estiver com a lista antiga, Ajustes mostra "Atualizar etapas".
- **Ordem das etapas é por etapa** (`sd_tipos_servico.etapas_livres` e `sd_atendimentos.etapas_livres`: lista de verdadeiro/falso alinhada às etapas; no site `livres`). Em Ajustes, cada etapa tem o lápis "Editar": nome, "Seguir a ordem" ou "Ordem livre" e "Remover etapa"; etapa livre aparece com a marca "Livre". Etapas livres vizinhas formam um bloco: dentro dele, qualquer ordem; a etapa seguinte que segue a ordem só libera quando o bloco inteiro estiver feito (`etapaLiberada`). Ex.: Limpeza Geral = Inspeção (ordem), Limpeza Interna e Externa (livres). Uma etapa liberada: botão grande "Concluir: etapa"; bloco com várias liberadas: botão "Concluir" em cada uma, e o status mostra "Em interna / externa". `etapaIndex` continua sendo a primeira pendente; `concluirEtapa(at, idx)` marca a data em `feitas` e, se for a atual, pula as já feitas. Os em andamento acompanham o tipo (`sincronizarEtapas`). **Renomear** uma etapa (`renomearEtapaNosVeiculos`) troca o nome nos veículos em serviço antes de sincronizar, então o que já foi feito, a data e a foto continuam (o rótulo das fotos da etapa também muda, op `fotos:rotulo`). Não deixa dois nomes iguais no mesmo tipo. O servidor só grava `etapas_livres` quando vem (site antigo não apaga). As colunas antigas `ordem_livre` ficaram sem uso.
- Uma placa só pode ter um atendimento em andamento. Ler a placa de um veículo em serviço abre o veículo direto.
- **Nome do cliente** fica em cada atendimento (`sd_atendimentos.cliente_nome`), porque o carro pode trocar de dono. Aparece no card do Início, no veículo e no Histórico, e entra na busca. É opcional: sem nome, aparece "(NOME PENDENTE)" no card, no veículo e na busca. O Controle preenche ou corrige em "Opções do Controle". Não vai para a página do cliente (`api/cliente` não devolve), para quem só sabe a placa não ver o nome.
- Fotos de entrada com espaços fixos: Frente, Traseira, Lateral esquerda, Lateral direita, Placa, Acessórios (+ extras: Danos, Interior, Objetos pessoais, Outra). A foto usada na leitura da placa entra como "Placa".
- **Adicionar foto** (entrada e veículo): os espaços fixos e o "+ Adicionar foto" abrem uma janela (`janelaFoto`) com o tipo da foto (espaço fixo já vem marcado; "Adicionar foto" obriga a escolher) e os botões "Tirar foto" e "Galeria". Não existe mais a escolha fixa Tirar foto/Galeria acima da grade nem a preferência salva no aparelho. A galeria abre no mesmo toque (necessário no iPhone).
- "Tirar foto" abre a **câmera própria do sistema** (`fotoPelaCamera`, tela cheia, pede a câmera traseira com `facingMode: environment`), porque no Android o app de câmera às vezes abria a frontal. Tem "Cancelar" e "Galeria". Se o navegador não liberar a câmera, cai no app de câmera do aparelho (`capture="environment"`). "Galeria" continua como opção secundária.
- **Mudar tipo da foto** (Controle): tocar numa foto da entrada abre a foto com "Mudar tipo"; os tipos aparecem embaixo da foto aberta e escolher troca o rótulo (op `fotos:rotulo`, só fotos da entrada, nunca de etapa) e registra no histórico. Corrige, por exemplo, objeto pessoal marcado como Danos (o que muda o que o cliente vê em Andamento e Observações).
- **Editar estado na entrada** (Controle): no veículo, o cartão "Estado na entrada" tem "Editar" (ou "Adicionar", quando vazio; para o Controle o cartão aparece mesmo vazio) com os textos de danos ou problemas e objetos pessoais. Salvar registra no histórico. É o que o cliente vê em Observações. A atualização automática não redesenha a tela com a edição aberta (`S.entradaEdit`).
- **Link do cliente** (Controle): em "Opções do Controle", "Copiar link do cliente" copia `/cliente#/PLACA` daquele veículo (se o navegador bloquear a cópia, mostra o link para copiar).
- **Corrigir placa** (Controle): em "Opções do Controle", campo Placa + "Corrigir". Troca a placa do atendimento, cria o veículo novo se não existir (o da placa errada continua no banco) e registra no histórico. Não deixa usar placa que já tem serviço em andamento.
- **Concluir etapa exige foto**: o botão "Concluir: etapa" abre a câmera, e sem foto a etapa não é concluída. A foto fica em `sd_fotos` com `etapa` (número da etapa) e aparece ao lado da etapa, para a equipe e para o cliente. O "Ajustar etapa" do Controle não pede foto. Tocar na foto da etapa abre a foto grande com "Trocar foto" (qualquer pessoa da equipe; a antiga fica marcada como removida) e "Remover" (só Controle). Etapa concluída sem foto mostra um espaço com câmera para adicionar depois.
- **Histórico do veículo só para o Controle** (tem "Valor definido: R$ ..."). O `api/dados` não manda ao Funcionário as linhas de valor do histórico e, quando o Funcionário salva, mantém o histórico do banco e só acrescenta as linhas novas.
- Interface enxuta: no veículo, "Fotos da entrada" mostra só as fotos tiradas (os espaços vazios ficam só no cadastro), "Estado na entrada" só aparece se tiver algo escrito, e "Opções do Controle" começa fechado. Em Ajustes, cada tipo de serviço começa fechado. Históricos e movimentos mostram 3 itens com "Mostrar mais".
- Material recém-cadastrado (sem nenhum movimento) não gera aviso de "Sem estoque".
- **Zerar estoque** (Controle, em Relatórios > Estoque): pede para digitar ZERAR e marca todos os movimentos com `descartado_em` (não apaga). Movimento descartado não entra em saldo, listas nem relatórios; o saldo de todos os materiais volta a 0.
- **Estoque**: Controle registra entradas, contagens e mínimo; funcionário registra retiradas (sem ligar a um serviço). O saldo é sempre a soma dos movimentos. Retirada acima do saldo é aceita e aparece como "Saldo negativo" para o Controle. Avisos: Sem estoque, Acabando (chegou no mínimo). Materiais iniciais: Espuma expansiva (lata) e Manta asfáltica (rolo).
- Financeiro: só valores lançados no próprio sistema. **Valor do serviço** é um valor só por atendimento, lançado pelo Controle no cartão "Valor do serviço" logo abaixo das etapas ("Lançar valor" / "Alterar").
- **Relatórios** (Controle): faturamento = serviços concluídos no período (pela data de conclusão) que têm valor; mostra também concluídos sem valor, ticket médio, por tipo e o previsto dos que estão em andamento. Estoque = entradas, saídas e contagens do período por material, saldo de hoje e retiradas por pessoa. O PDF usa jsPDF + autoTable (cdnjs), carregados só ao gerar.
- **Agenda** (tabela `sd_agenda`): cliente, WhatsApp, serviço, marca, data de entrada, prazo em dias (entrega = entrada + prazo), valor, observações e situação (agendado, em serviço, concluído, cancelado). Funcionário vê tudo, inclusive valores; só o Controle cria, altera e exclui (excluir só marca `excluido_em`). No agendamento, "Registrar entrada" (Funcionário e Controle) leva ao "Adicionar" com o agendamento escolhido (`S.entradaAg`): depois da placa, a entrada já vem com cliente, tipo de serviço (se o nome bater), veículo (marca) e valor; falta só placa, fotos e estado na entrada. Ao iniciar o serviço, o agendamento vira "em serviço" (op `agenda:entrada`, liberada para o Funcionário) e o atendimento guarda `agenda_id`; quando esse serviço é concluído, o servidor muda o agendamento para "concluído". "Não usar" no aviso segue sem o agendamento. Na agenda, dia com agendamento tem fundo verde claro e bolinha verde; feriado tem fundo e número em vermelho. Os 12 agendamentos da agenda antiga (arquivo separado) foram importados.
- **Presença da equipe** (colunas `visto_em`, `mexeu_em`, `tela` em `sd_funcionarios`): o site chama `api/presenca` a cada 20 s enquanto está aberto e visível (3 s com a tela Status da equipe aberta), ao trocar de tela (no máximo a cada 3 s) e manda "saiu" ao sumir da tela (trocou de app, bloqueou, fechou ou saiu). Estados na tela "Status da equipe": **Online** (aviso há menos de 50 s) com a tela aberta, **Parado** (sem tocar no sistema há mais de 5 min), **Fora do sistema** (visto há X) e "Ainda não entrou". Entradas e saídas ficam em `sd_presenca_eventos` (gatilho `sd_presenca_evento` em `sd_funcionarios`: "entrou" quando a tela passa a ter valor depois de estar fora ou de mais de 60 s sem aviso; "saiu" quando vira nula ou, se ficou mais de 60 s sem aviso, no último aviso). Não dá para ver outros apps do celular. A equipe deve ser avisada desse acompanhamento.
- Fora do escopo por enquanto: cadastro de clientes (já existe no Supabase), site de registro de autorizados (outro projeto).

## Leitor de placa

- Principal: Plate Recognizer via `api/read-plate` (retorna `{plate, score, alternatives}`). Reserva: Tesseract.js no navegador (bem menos preciso), usado quando a API não responde. Só é baixado nessa hora (`getWorker` carrega o script), não ao abrir o site.
- Câmera ao vivo: usa a câmera traseira padrão do navegador (sem troca de câmera; foi testado e removido a pedido). Tem **zoom** (salvo em `localStorage` `sd:zoom`) quando o aparelho suporta.
- Quadro da câmera fixo em **3:4**, altura limitada para o botão "Capturar placa" caber na tela sem rolar. A imagem enviada à API é só a área visível do quadro.
- Aparelho de teste do Eduardo: Galaxy A54.

## Dados: Supabase

- Projeto **"Strike Details DATABASE"** (`afngfcclipuuptskoowh`). As tabelas `leads`, `historico` e `autorizados` são de outro sistema: **não alterar**.
- **Regra do dono: não apagar registros.** O principal é nunca afetar os dados dos clientes (tabelas do outro sistema). As tabelas do controle não têm permissão de DELETE. "Excluir" no sistema só marca: `excluido_em` (atendimentos; ficam 48 h na **Lixeira** de Ajustes, que o `api/dados` manda só ao Controle, e podem ser restaurados com a op `atendimentos:restaurar`; depois somem da lista mas continuam no banco), `ativo = false` (funcionários, tipos, materiais), `removida_em` (fotos).
- **Única exclusão permitida: arquivos de foto antigos**, para não encher o plano grátis. `api/limpeza` roda 1x por dia (09:00 UTC) e apaga do Storage as fotos e miniaturas de serviços concluídos há mais de X dias (30 a 40, em Ajustes, tabela `sd_ajustes` chave `limpeza_fotos_dias`), de atendimentos excluídos e de fotos removidas há mais de X dias. O registro em `sd_fotos` fica, com `apagada_em`. Serviços em andamento nunca são mexidos.
- Tabelas do controle (prefixo `sd_`, com RLS): `sd_funcionarios`, `sd_tipos_servico`, `sd_veiculos`, `sd_atendimentos`, `sd_fotos`, `sd_estoque_itens`, `sd_estoque_movimentos`, `sd_ajustes`, `sd_agenda`, `sd_versao`, `sd_presenca_eventos`. Etapas, datas das etapas (`feitas`) e histórico do atendimento ficam em `jsonb` no próprio atendimento.
- Uma placa só tem um atendimento em andamento (índice único `sd_atendimentos_placa_em_andamento`).
- Acesso: só as funções da Vercel falam com o banco. Elas mandam o cabeçalho `x-sd-chave` (variável `SD_CHAVE_BANCO`), que as políticas conferem com `privado.sd_config` pela função `privado.sd_acesso_ok()`. O navegador nunca vê essa chave.
- Atendimentos têm `versao`: se outro aparelho mudou antes, a gravação é recusada e o site recarrega e avisa.
- O site guarda os dados em memória no mesmo formato de antes; cada `commit()` compara antes e depois e manda as operações para `api/dados`.
- **Só baixa tudo de novo quando algo mudou**: a tabela `sd_versao` (1 linha) muda sozinha a cada gravação nas tabelas `sd_` (gatilhos `sd_versao` chamando `privado.sd_mudou_dados()`; em `sd_funcionarios` só conta mudança de nome, nível, usuário, ativo ou senha, nunca presença ou login). O `api/presenca` devolve `versaoDados` a cada aviso (20 s); se for diferente da carregada, o site chama `api/dados` (que também devolve `versaoDados`). Reserva: busca tudo se os dados tiverem mais de 5 min. Em tela que não pode ser redesenhada (Relatórios, Ajustes, formulário aberto, digitando) nem baixa (`atualizarSeVelho` confere `podeRedesenhar` antes); ao sair dela, o próximo aviso busca.
- Fotos no bucket público `sd-fotos` com nomes aleatórios: `fotos/<id>.jpg` (até 1280 px, JPEG 0,8, uns 200 KB; antes de 06/10/2026 eram 1600 px) e `miniaturas/<id>.jpg` (480 px, usada nas listas). Plano grátis: 1 GB de arquivos, 5 GB/mês de tráfego, projeto pausa após 1 semana sem uso.
- Dados antigos do aparelho (`localStorage` `sd:dados:v1` e fotos no IndexedDB `sd-fotos`) continuam guardados no navegador. Em Ajustes, o Controle pode enviá-los ao banco (funcionários, tipos e materiais são ligados pelo nome).
- As funções rodam em `pdx1` (Oregon), a mesma região do banco (`us-west-2`), para cada consulta ser rápida.

## Como trabalhar neste repositório

- Mudanças pontuais, sem reestruturar o que já funciona. Respostas curtas e diretas.
- Testar antes de publicar: rodar `node dev-server.js` e conferir os fluxos (login, adicionar veículo, etapas, fotos, estoque, cliente) no tamanho de celular.
- Nunca rodar DELETE, TRUNCATE ou DROP no banco (a limpeza das fotos é a única exceção, e só no Storage). Mudança de estrutura só com migração nova, sem apagar dados. Nunca mexer em `leads`, `historico`, `autorizados` nem no Auth do Supabase.
- Não commitar `.env` nem chaves.
