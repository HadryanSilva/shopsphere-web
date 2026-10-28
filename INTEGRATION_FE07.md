# FE-07 — validação integrada local

Estado: **concluída com validação manual relatada**, em 2026-10-28. Login e
funcionamento do carrinho confirmados pelo utilizador após a correção da audiência.
As limitações de observação e os testes complementares estão discriminados abaixo.

## Ambiente preparado

- Frontend: http://localhost:4200 (npm start).
- Gateway: http://localhost:8080, Catalog: 8081 e Cart: 8082, perfil dev.
- PostgreSQL: localhost:5432; Keycloak: http://localhost:8180, realm shopsphere.
- Os três serviços Java foram iniciados com os seus wrappers Gradle,
  `bootRun --offline --no-daemon --args='--spring.profiles.active=dev'`.
- Durante o arranque, o Flyway aplicou as migrations V3 já existentes em
  catalog_db/public e cart_db/public. Nenhum ficheiro de migration foi alterado.

## Evidência recolhida por HTTP

| Verificação                                                              | Resultado observado                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| GET frontend `/`                                                         | 200, HTML                                                        |
| GET frontend `/auth-config.json`                                         | 200, JSON                                                        |
| GET frontend `/silent-check-sso.html`                                    | 200, HTML                                                        |
| GET frontend `/api/v1/products?page=0&size=2&status=ACTIVE`              | 200 pelo proxy; totalElements=0                                  |
| GET frontend `/api/v1/carts/me`, sem token                               | 401                                                              |
| GET frontend `/products/20000000-0000-0000-0000-000000000001?minPrice=1` | 200 com app-root; confirma fallback da SPA, não execução da tela |
| GET frontend `/api/v1/categories/10000000-0000-0000-0000-000000000001`   | 200; Electronics                                                 |
| Descoberta OIDC do realm shopsphere                                      | Emissor local esperado; S256 suportado                           |

Estas requisições verificam a conectividade real entre o servidor Angular,
Gateway e Catalog e a rejeição do carrinho anónimo. Não verificam execução de
JavaScript, troca de código OIDC por tokens ou renderização no navegador.

A automação do navegador falhou antes de obter uma janela, inclusive após reset:
`windows sandbox failed: helper_unknown_error: setup refresh had errors`.
A alternativa nativa apresentou a mesma falha. A operação de login fica a cargo
do utilizador; não é necessário enviar passwords ou tokens nesta conversa.

## Preparação e dados de teste

Login: o utilizador confirmou que conseguiu autenticar-se após corrigir o realm
em que a conta de teste foi criada. Os logs locais mostravam LOGIN_ERROR com
user_not_found no realm shopsphere e cliente shopsphere-web. Nenhuma password,
conta ou regra de autenticação foi alterada pelo agente. Esta é evidência relatada
pelo utilizador, sem observação do navegador pela automação.

1. Abrir http://localhost:4200, clicar em Entrar e usar uma conta de teste.
   Confirmar que regressa à loja e que o cabeçalho apresenta o utilizador/Sair.
2. Disponibilizar pelo menos um produto ACTIVE no Catalog local. A consulta
   inicial não devolveu produtos ativos. Após autorização explícita do utilizador,
   foi criada a fixture abaixo em catalog_db, sem criar contas ou alterar permissões.

Fixture criada e verificada pelo Gateway:

- ID: `70000000-0000-0000-0000-000000000007`.
- Nome: ShopSphere FE-07 — Produto de teste.
- Categoria: Electronics, `10000000-0000-0000-0000-000000000001`.
- Preço/moeda/estado: 12,50 EUR, ACTIVE; imagem ausente intencionalmente.
- Preparação por INSERT no banco local, respeitando o schema existente, com
  proteção contra duplicação por nome/ID. Nenhum registo anterior foi substituído.
- GET público por ID confirmou nome, preço, moeda e estado; busca pelo nome
  devolveu exatamente uma ocorrência ativa. A resposta foi lida como UTF-8 para
  evitar uma diferença de decodificação do cliente PowerShell.
- Esta preparação não valida o endpoint administrativo de criação de produtos.

Para referência, este é o payload equivalente para o DTO atual e a categoria
local confirmada. O cadastro pela API exigiria token de ADMIN no cliente HTTP
local; não o envie no chat. O exemplo **não foi submetido à API de criação**,
pois a fixture foi preparada diretamente no banco de desenvolvimento:

`POST http://localhost:8080/api/v1/products`

```json
{
  "name": "ShopSphere FE-07 — Produto de teste",
  "description": "Produto local para validar o percurso de catálogo e carrinho.",
  "categoryId": "10000000-0000-0000-0000-000000000001",
  "price": 12.5,
  "currency": "EUR",
  "imageUrl": null
}
```

## Roteiro e origem da evidência

Foi proposto o roteiro abaixo para uma conta/carrinho de teste. Após corrigir a
audiência, o utilizador confirmou o funcionamento do carrinho e respondeu sim à
solicitação de validação das operações. A confirmação é global: os valores e
códigos HTTP abaixo são critérios esperados, não capturas individuais feitas pelo
agente. Não foram recolhidos tokens, passwords ou dados de itens pessoais.

| Passo                                            | Resultado a confirmar                                                  | Estado                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Login                                            | Utilizador confirmou sucesso após corrigir realm da conta              | Confirmado pelo utilizador; preservação de filtros ainda pendente |
| Recarregar a página                              | Sessão recuperada, ou comportamento documentado de cookies restritos   | Não detalhado; reteste de cookies pendente                        |
| Abrir detalhe, escolher quantidade 2 e adicionar | Uma adição; confirmação; sem repetição automática                      | Confirmação manual geral; sem captura individual                  |
| Consultar carrinho                               | Produto e quantidade corretos; valores iguais aos devolvidos pelo Cart | Confirmação manual geral; sem captura individual                  |
| Guardar quantidade 3                             | PATCH 204 seguido de GET; totais novamente fornecidos pelo servidor    | Confirmação manual geral; sem captura individual                  |
| Remover apenas o item de teste                   | DELETE 204 seguido de GET; lista/estado vazio coerente                 | Confirmação manual geral; sem captura individual                  |
| Logout                                           | Retorno à aplicação; dados do carrinho ocultos; convite para entrar    | Confirmação manual geral; sem captura individual                  |

A inspeção do Network no percurso autenticado não foi executada pela automação.
O envio restrito de Bearer ao Cart permanece coberto pelos testes da FE-06;
esta evidência não substitui captura real de tráfego. Não há checkout nesta microtarefa.

## Limites da entrega

### Correção de audiência durante a validação

O utilizador relatou pedidos repetidos de login em todas as operações do carrinho.
Gateway e Cart exigem shopsphere-api em aud. O cliente web não tinha mapeadores
próprios e o scope roles apenas resolvia audiências por client roles. A avaliação
administrativa de exemplo para a sessão ativa apresentou somente aud=account.
Foram consultadas apenas as audiências do exemplo não assinado; nenhum token
real do utilizador foi obtido, impresso ou persistido.

Foi adicionado ao cliente shopsphere-web o mapper shopsphere-api-audience,
conforme `keycloak/shopsphere-web-audience-mapper.json`, usando o mesmo padrão
de audiência customizada já existente no projeto. Configuração gravada e relida:
included.custom.audience=shopsphere-api, access.token.claim=true e id.token.claim=false.
A avaliação posterior apresentou aud=[shopsphere-api, account]. Não foram
concedidas roles nem removidas verificações JWT. Esta etapa alterou apenas a
emissão de audiência do cliente web no Keycloak local.

O utilizador foi orientado a sair e entrar novamente para obter um access token
novo e confirmou em seguida que o carrinho passou a funcionar. A correção está
validada por leitura/avaliação no Keycloak e pela confirmação do utilizador no
navegador. Após receber o roteiro de adição, alteração de quantidade, remoção e
logout, o utilizador reiterou que o carrinho está funcionando. O encerramento
baseia-se nessa confirmação manual geral, sem atribuir ao agente observação
individual de cada passo ou dos respetivos códigos HTTP.

### Pendências operacionais

- O código da aplicação não foi alterado nesta fase de preparação.
- Os 70 testes e o build aprovados na FE-06 não foram reexecutados nesta entrega,
  que não alterou código da aplicação. A correção de configuração foi validada
  diretamente no Keycloak e confirmada manualmente pelo utilizador.
- Os serviços foram deixados ativos nesta sessão para permitir a continuação.
- Permanecem sem evidência individual: restauração dos filtros/recarregamento,
  políticas de cookies, captura de Network e observação visual/responsiva.
  A revisão visual e de acessibilidade proposta para FE-08 continua pendente.
