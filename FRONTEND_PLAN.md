# Frontend — plano incremental

Direção aprovada: loja mult categoria, administração centralizada e visual
sóbrio, minimalista e moderno. A página inicial é o catálogo.
Cada microtarefa termina com revisão do diff, validação pertinente e commit local.

| ID    | Microtarefa                | Critério de conclusão                                                                                                                                                                           | Estado    |
| ----- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| FE-01 | Base visual da loja        | Cabeçalho, introdução curta, área reservada ao catálogo e rodapé responsivos; idioma português, foco visível e salto para o conteúdo. Recursos sem integração identificados como indisponíveis. | Concluída |
| FE-02 | Catálogo real              | Confirmar DTO/paginação e ligar a listagem ao Gateway; cards com preço/moeda e imagem; carregamento, vazio, erro e nova tentativa. Sem produtos fictícios.                                      | Concluída |
| FE-03 | Busca, filtros e paginação | Confirmar parâmetros e ordenações aceites; estado na URL, navegação entre páginas e filtros num painel no telemóvel. Validar como obter categorias antes de incluir esse filtro.                | Concluída |
| FE-04 | Detalhe do produto         | Rota por ID, imagem, descrição, preço, quantidade e estados de carregamento/404/erro. Ação de compra depende de FE-05/06.                                                                       | Concluída |
| FE-05 | Autenticação               | Verificar cliente Keycloak e configurar Authorization Code + PKCE, login/logout e retorno à navegação; definir dependências antes de adicionar bibliotecas.                                     | Concluída |
| FE-06 | Carrinho                   | Integrar APIs autenticadas, adição, alteração e remoção; tratar 401/404/409 e falhas de integração, com valores vindos do backend.                                                              | Concluída |

## Limites desta fase

- FE-01 não consulta APIs: a área reservada não representa catálogo vazio nem falha de rede.
- Carrinho integrado em FE-06; checkout continua fora desta fase.
- A listagem de categorias não foi identificada na API; não fixar categorias ou IDs no frontend.
- FE-02 usa /api relativo e proxy local para o Gateway; em produção o encaminhamento precisa ser configurado pela infraestrutura.
- Checkout/detalhe do pedido e administração serão divididos em microtarefas próprias.
- Checkout depende da evolução Cart–Order; criação de pedido não significa compra confirmada.
- Histórico de pedidos, vendedores, pagamentos e promoções não fazem parte desta fase.

## Validação de FE-01

Testes do componente verificam criação, salto para o conteúdo e indisponibilidade
explícita de ações ainda sem integração. Executar build de produção e testes
Angular sem watch antes de concluir. Registar limitações reais, inclusive QA visual.

Validação executada: build de produção e 3 testes Angular aprovados. A revisão visual
em navegador e a verificação manual em dispositivos permanecem pendentes.

## Validação de FE-02

- Implementada listagem pública GET /api/v1/products com page=0, size=20,
  sort=name,asc e status=ACTIVE; contrato content e metadados conferidos no Catalog.
- Componente próprio, preços em pt-PT com moeda recebida da API e fallback textual
  para imagens ausentes ou com falha. Não indica disponibilidade de estoque.
- Carregamento, vazio e erro distintos; timeout de 10 segundos e nova tentativa
  manual. Requisições são canceladas ao destruir o componente.
- npm run build: aprovado sem avisos. npm test -- --watch=false: 9 testes aprovados.
- GET direto ao Gateway localhost:8080 não conectou; integração com backend em
  execução e inspeção visual em navegador permanecem pendentes.
- Busca, filtros, paginação interativa, detalhe, autenticação e carrinho não foram
  antecipados. Nenhuma alteração de backend, contrato ou dependência.

## Validação de FE-03

- Busca por nome no cabeçalho, filtros mínimo/máximo de preço, ordenação por
  nome/preço/data de criação e navegação entre páginas de 20 produtos ACTIVE.
- Estado em name, minPrice, maxPrice, sort e page na URL (page começa em zero).
  Alterar busca, preços ou ordenação reinicia a página; histórico e ligações
  diretas restauram os controles e a consulta.
- Filtros ativos removíveis, limpeza de rascunhos inválidos, validação de preços
  não negativos com até duas casas decimais e comparação exata dos limites.
  Parâmetros de página/ordenação inválidos usam os valores padrão; preços inválidos
  na URL mostram erro sem enviar uma consulta inválida ao backend.
- Painel de preços expansível no telemóvel, lateral no computador, com rótulos,
  mensagens de validação e aria-expanded. Categorias aguardam API de listagem.
- Consultas anteriores canceladas ao mudar filtros; nova tentativa preserva a
  consulta atual. Página vazia oferece regresso à primeira sem perder filtros.
- npm test -- --watch=false: 21 testes aprovados. npm run build: aprovado sem avisos.
- A inspeção visual foi tentada, mas o navegador de automação falhou na inicialização
  com helper_unknown_error: setup refresh had errors. QA visual e integração com
  backend em execução permanecem pendentes; não foram iniciados serviços backend.
- Nenhuma alteração de dependências, contratos, segurança, banco ou backend.

## Validação de FE-04

- Criadas rotas / para CatalogPage e /products/:id para ProductDetail com
  carregamento sob demanda. Cabeçalho/rodapé permanecem partilhados; conteúdo e
  estilos da página inicial foram movidos para permitir telas independentes.
- GET público /api/v1/products/{id} pelo Gateway, com timeout de 10 segundos,
  estados de carregamento/404/erro, nova tentativa e cancelamento ao trocar de
  produto ou sair. UUID inválido não gera chamada ao endpoint.
- Imagem e descrição têm alternativas para conteúdo ausente; descrição é texto,
  sem HTML executável. Preço usa a moeda recebida e formatação pt-PT.
- Quantidade inteira de 1 a 2147483647 (Integer positivo confirmado no Cart).
  Adicionar ao carrinho continua desativado até FE-05/06; estados INACTIVE e
  OUT_OF_STOCK impedem seleção de quantidade. Não há consulta de estoque.
- Cards e retorno preservam filtros/página; a busca no cabeçalho abre o catálogo
  também a partir do detalhe. Âncoras preservam rota e consulta, com restauração
  de scroll e suporte a fragmentos pelo Router.
- npm test -- --watch=false: 34 testes aprovados. npm run build: aprovado sem avisos.
  Inclui acesso direto, transição catálogo/detalhe, retorno filtrado, 404/retry,
  conteúdo seguro, quantidade e cancelamento de requisições.
- GET de verificação ao Gateway localhost:8080 não conectou. Integração com backend
  em execução e QA visual em navegador permanecem pendentes. A automação visual
  apresentou falha de inicialização na FE-03 e não foi executada nesta entrega.
- Nenhuma alteração de backend, contratos, segurança, schema ou dependências.
  Produção precisa de fallback de SPA para acesso direto às rotas do frontend.

## Validação de FE-05

- Verificados descoberta OIDC local e cliente shopsphere-web em modo somente leitura:
  público, Standard Flow ativo, Direct Grants inativo, PKCE S256, redirect
  http://localhost:4200/* e origem http://localhost:4200. Sem alteração no Keycloak.
- Adicionada apenas a dependência oficial keycloak-js 26.2.5, sem wrapper Angular.
  Configuração pública em auth-config.json; nenhum secret ou token no frontend.
- Inicialização antes do Router; Authorization Code/PKCE/nonce; check-sso silencioso
  sem fallback de redirecionamento. Navegadores com cookies restritos podem exigir
  clicar em Entrar após recarregar. Ficheiro silent-check-sso.html incluído no build.
- Login/logout com retorno à URL atual da própria origem; filtros e fragmento
  preservados, sem aceitar returnUrl externo. Nome da conta e botão Sair no cabeçalho.
- Tokens apenas em memória, renovação na expiração e limpeza em caso de falha;
  callbacks de clientes descartados não atualizam a sessão. Não há interceptor ou
  envio de token nas consultas públicas. Carrinho não foi antecipado.
- Falhas de autenticação não expõem detalhes internos; falha na inicialização
  permite a navegação pública e nova tentativa, removendo dados OAuth da URL.
- npm test -- --watch=false: 47 testes aprovados. npm run build: aprovado sem avisos.
  Verificados ficheiros públicos no artefacto gerado e diff de dependências restrito.
- npm audit: 2 avisos preexistentes em vite (high) e @angular/build (low), cujas
  versões não mudaram; correção fora de escopo, sem upgrades ou audit fix automático.
  npm também informou scripts de instalação bloqueados pela política local;
  a política foi preservada e o build/testes passaram com as dependências existentes.
- Pendente login/logout real num navegador, SSO sob políticas de cookies, revisão
  visual e comportamento com indisponibilidade real do provedor. Os testes do
  serviço usam o adaptador simulado; não substituem validação OIDC ponta a ponta.
- Nenhuma alteração de backend, contratos HTTP, schema, permissões do Keycloak
  ou credenciais. Documentados pré-requisitos e teste manual no README.

## Validação de FE-06

- Rota /cart com consulta autenticada, itens, quantidades, remoção e resumo.
  Visitantes veem convite para entrar, sem requisição ao Cart ou criação implícita.
- CartApi obtém token renovado do AuthService apenas para /api/v1/carts/me e seus
  itens. Sem interceptor global, tokens em logs/storage ou envio ao Catalog.
- POST envia productId/quantity, sem cartId para usar a criação/seleção existente
  no servidor. PATCH envia quantity; DELETE não envia body. Sem identidade, preço
  ou total no payload. Valores monetários e contagem distinta vêm do backend.
- Adição no detalhe com estados pendente/sucesso/erro e bloqueio de duplicação
  enquanto pendente. Login preserva a quantidade no parâmetro quantity da URL;
  após autenticar é necessária confirmação explícita, sem replay de POST.
- Alterar/remover usa nova leitura após 204; não há atualização otimista de totais.
  Falhas de escrita bloqueiam novas alterações até consultar o estado atual.
  Cancelamento/timeout não implica rollback no backend; não há retry automático.
- 401 oferece reautenticação explícita; 403/404/409/falhas de rede ou integração
  exibem mensagens seguras. GET 404 só é vazio para detail Cart not found; produto
  ausente não é disfarçado de carrinho vazio. Dependência desse texto documentada.
- Consultas/escritas são canceladas ao sair ou terminar a sessão, e os dados do
  carrinho deixam de ser apresentados. Nova sessão exige nova leitura, sem cache
  persistente. Renovação de token não provoca ciclos de consulta.
- npm test -- --watch=false: 70 testes aprovados. npm run build: aprovado sem avisos.
  Cobertos contratos/payloads, token escopado, sessão, quantidades, 404 ambíguo,
  401/403/409/503, falha de rede, ausência de replay e releitura dos totais.
- Gateway localhost:8080 indisponível na verificação por GET. Integração autenticada
  ponta a ponta, login real e revisão visual responsiva permanecem pendentes.
- Checkout permanece desativado. Nenhuma alteração de backend, contratos, schema,
  Keycloak ou dependências; avisos de audit já registrados na FE-05 não foram tratados.
