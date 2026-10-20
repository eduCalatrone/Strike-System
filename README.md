# Strike Details | Sistema de controle

Controle interno dos veículos em serviço: leitura de placa, etapas, fotos de entrada, estoque e área do cliente.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `index.html` | O sistema inteiro (telas, dados e leitor de placa) |
| `api/read-plate.js` | Função que chama o Plate Recognizer e esconde a chave (a mesma usada na Vercel) |
| `api/dados.js`, `api/foto.js`, `api/cliente.js` | Funções que leem e gravam no banco (Supabase) e enviam as fotos |
| `api/login.js` | Login da equipe (usuário e senha) |
| `api/limpeza.js` | Limpeza diária das fotos de serviços concluídos há mais de 30 a 40 dias |
| `vercel.json` | Região das funções, agenda da limpeza e página do cliente |
| `dev-server.js` | Servidor para rodar no computador. A Vercel ignora este arquivo |
| `protocolos/` | Galeria de protocolos (`/protocolos/`): app à parte que lê a pasta `protocolos` do computador. Não usa o banco |
| `.env.exemplo` | Modelo das chaves para rodar localmente |

## Rodar no computador

1. Instale o [Node.js](https://nodejs.org) 18 ou mais novo.
2. Copie `.env.exemplo` para `.env`, cole o token do Plate Recognizer em `PLATE_RECOGNIZER_TOKEN` e a chave do banco em `SD_CHAVE_BANCO` (o mesmo valor da Vercel).
3. Na pasta do projeto, rode `node dev-server.js`.
4. Abra `http://localhost:3000`.

No computador a câmera ao vivo funciona em `localhost`. No celular pelo IP da rede (o endereço aparece no terminal), o navegador bloqueia a câmera ao vivo porque não é HTTPS. Use "Usar foto do aparelho", que abre a câmera do celular do mesmo jeito.

Sem o token, o leitor usa a leitura do próprio aparelho, que é bem menos precisa.

## Publicar na Vercel

Todo push no `main` publica. Variáveis na Vercel: `PLATE_RECOGNIZER_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, `SD_CHAVE_BANCO`, `CRON_SECRET` e, se quiser, `ACCESS_CODE` (só do leitor de placa).

## Páginas e acesso

- Equipe: endereço principal. Cada pessoa entra com o próprio usuário e senha. O Controle cria as pessoas e troca senhas em Ajustes > Equipe.
- Cliente: `/cliente` (ou `/cliente#/ABC1D23` já com a placa). Não tem login.

| Perfil | O que faz |
| --- | --- |
| Funcionário | Lê a placa, registra entrada do veículo com fotos, conclui etapas e registra retiradas do estoque |
| Controle | Tudo do funcionário, mais: ajustar etapas, valores, entradas e contagem de estoque, histórico, tipos de serviço e equipe |
| Cliente | Digita a placa e vê o andamento e as fotos. Não vê valores, danos, objetos nem nomes da equipe |

O servidor também confere o que é só do Controle, e o Funcionário não recebe os valores dos serviços.

## Onde ficam os dados

No banco online (Supabase, projeto "Strike Details DATABASE"): os dados aparecem em todos os aparelhos e é preciso internet para usar. Fotos ficam no Storage do mesmo projeto, com miniatura para as listas.

Registros não são apagados do banco: excluir um atendimento, foto, pessoa, tipo de serviço ou material só tira da lista. A exceção são os arquivos das fotos: uma vez por dia, as fotos de serviços concluídos há mais de 30 a 40 dias (prazo em Ajustes) são apagadas para não encher o plano grátis. O serviço, as etapas e o histórico continuam.

Os dados que ficaram salvos no aparelho antes do banco continuam lá. Em Ajustes, o Controle toca em "Enviar para o banco" para levá-los.
