# ShopsphereWeb

## Loja local

Execute `npm start` e abra `http://localhost:4200`. O servidor Angular encaminha
`/api/**` para o Gateway em `http://localhost:8080`, conforme `proxy.conf.json`.
Gateway e Catalog (8081), com as suas dependências, precisam estar disponíveis;
o frontend não os inicia. Não é necessário login para consultar produtos.

A vitrine apresenta produtos ACTIVE em páginas de 20, com preços e imagens
recebidos da API. A busca é enviada pelo cabeçalho, por Enter ou pelo botão
de pesquisa. É possível filtrar por preço e ordenar por nome, preço ou data de
criação. Preços aceitam vírgula ou ponto e até duas casas decimais.

Busca, preços, ordenação e página são guardados na URL; ligações partilhadas,
recarregamento e histórico do navegador restauram a consulta. Alterar busca,
preços ou ordenação volta à primeira página. Exemplo:
`/?name=Livro&minPrice=10&maxPrice=50&sort=price,asc&page=1` (página 2).
No telemóvel, o botão "Filtrar por preço" expande o painel na própria página.
Categorias aguardam uma API de listagem; não há categorias fixas no frontend.

As chamadas têm timeout de 10 segundos; falhas permitem nova tentativa manual
com os filtros atuais. Nenhum produto de demonstração é carregado pela aplicação.

Os cards abrem `/products/<uuid>`, que também pode ser acessado diretamente.
O detalhe apresenta imagem, descrição e preço, com alternativas para conteúdo
ausente, estado de produto inexistente e nova tentativa em falhas temporárias.
O retorno ao catálogo preserva a busca, os preços, a ordenação e a página.
A quantidade aceita inteiros positivos até o limite do Cart; utilizadores com
sessão podem adicionar o produto. Sem sessão, Entrar preserva a quantidade na
URL de retorno e exige confirmar a adição depois do login. Não há consulta de
estoque nem cálculo de frete.

Em produção, `/api` deve ser encaminhado ao Gateway pela infraestrutura que
serve o frontend. O proxy do Angular atua apenas no servidor de desenvolvimento.
Não foram alteradas regras de CORS ou segurança no backend.
O servidor de produção também deve devolver `index.html` nas rotas do frontend
(fallback de SPA), para permitir abrir ou recarregar `/products/<uuid>` diretamente.

Validação: `npm run build` e `npm test -- --watch=false`.

## Autenticação (FE-05)

O cabeçalho permite entrar e sair pelo Keycloak. O fluxo usa Authorization Code
com PKCE S256 e nonce, pelo adaptador oficial `keycloak-js` 26.2.5, inicializado
antes do Router. Login e logout regressam à URL atual da loja, incluindo filtros
e fragmento. A aplicação não aceita um destino externo fornecido por `returnUrl`.

A configuração pública está em `public/auth-config.json`: servidor, realm e
clientId. Não coloque passwords, tokens ou client secrets neste ficheiro.
Em produção, substitua estes valores pelo servidor HTTPS e cliente público do
ambiente; HTTP só é aceite para localhost/loopback. Sirva o ficheiro sem cache
persistente e mantenha o fallback de SPA nas rotas do frontend.

Configuração local consultada em 2026-10-27, sem alterações no Keycloak:

- servidor `http://localhost:8180`, realm `shopsphere`, cliente `shopsphere-web`;
- cliente público, Standard Flow ativo, Direct Access Grants inativo e PKCE S256;
- Redirect URIs: `http://localhost:4200/*`; Web Origins: `http://localhost:4200`.

Gateway e Cart validam `aud=shopsphere-api`. O cliente web precisa incluir essa
audiência no access token; apenas conseguir iniciar sessão não garante acesso
às APIs. Durante a FE-07, a avaliação do cliente emitia somente `aud=account`,
provocando 401 nas operações de carrinho mesmo após repetir o login.

A correção local adicionou ao cliente `shopsphere-web` o mapeador versionado em
`keycloak/shopsphere-web-audience-mapper.json`. Para reproduzir na consola do
Keycloak: no realm shopsphere, abrir Clients → shopsphere-web → Client scopes →
scope dedicado → configurar mapper Audience; definir Included Custom Audience
como shopsphere-api, Add to access token ativo e Add to ID token inativo.
O JSON também pode ser enviado ao endpoint administrativo de protocol mappers
do UUID desse cliente, por um operador autorizado. Não importar substituindo
o cliente inteiro nem duplicar um mapper existente com o mesmo nome.

Não foram alteradas roles ou validações JWT das APIs. Depois de configurar o
mapper, sair e entrar novamente para emitir tokens novos. A avaliação local
passou a apresentar shopsphere-api e account; o reteste autenticado no navegador
continua necessário. Referência: [audiências no Keycloak](https://www.keycloak.org/docs/26.7.5/server_admin/index.html#_audience).

O cliente precisa permitir os redirects da loja e de
`http://localhost:4200/silent-check-sso.html`, além do retorno após logout.
O ficheiro `public/silent-check-sso.html` participa apenas da verificação silenciosa.
Ao mudar o domínio/porta, confirme essas configurações no ambiente correspondente.

Access/refresh tokens ficam em memória no adaptador. Não são guardados pela
aplicação em localStorage/sessionStorage; o adaptador gere os dados temporários
do protocolo. O token expirado é renovado; se a renovação falhar, as credenciais
locais são limpas e o utilizador pode entrar novamente. O catálogo público
continua sem Bearer token. As operações do carrinho obtêm um token renovado
apenas para os seus próprios endpoints, sem interceptor global.

A verificação silenciosa de sessão depende das políticas de cookies do navegador.
Se estiver bloqueada, o frontend permanece anónimo até clicar em Entrar, sem
redirecionamento automático alternativo. O iframe de estado de sessão está
desativado; logout noutra janela é detetado na próxima renovação do token.
Falhas de configuração/inicialização mostram uma mensagem e permitem repetir,
preservando a navegação pública.

Teste manual pendente: abrir o catálogo ou detalhe com filtros, clicar em Entrar,
autenticar no Keycloak, confirmar utilizador e retorno, recarregar e clicar em
Sair. Repetir com cookies restritos e Keycloak indisponível. A configuração OIDC
local foi consultada, mas não foi efetuado login real de um utilizador.

Referência: [adaptador JavaScript do Keycloak](https://www.keycloak.org/securing-apps/javascript-adapter).

## Carrinho (FE-06)

O cabeçalho abre `/cart`; a página permite entrar quando não há sessão e, com
sessão, consultar itens, guardar quantidades e remover produtos. Os dados não
são persistidos no armazenamento do navegador: ao terminar a sessão, as consultas são canceladas e
os itens deixam de ser apresentados. Uma nova sessão consulta o backend novamente.

| Operação  | API pelo Gateway                            | Payload/resposta                                      |
| --------- | ------------------------------------------- | ----------------------------------------------------- |
| Consultar | GET `/api/v1/carts/me`                      | Carrinho com itens, subtotais, total estimado e moeda |
| Adicionar | POST `/api/v1/carts/me/items`               | `{productId, quantity}`; sucesso 200                  |
| Alterar   | PATCH `/api/v1/carts/me/items/{productId}`  | `{quantity}`; sucesso 204                             |
| Remover   | DELETE `/api/v1/carts/me/items/{productId}` | Sem body; sucesso 204                                 |

A identidade vem do JWT; o frontend não envia customerId, preços ou totais. A
adição sem cartId usa o comportamento existente de obter/criar o carrinho ativo.
Quantidade, preço unitário, subtotal, total estimado e moeda apresentados vêm
da leitura do Cart. `totalItems` representa produtos distintos, não a soma de
quantidades. PATCH/DELETE bem-sucedidos são seguidos por uma nova leitura.

401 permite entrar novamente; 403, 404, 409 e falhas de integração têm mensagens
próprias, sem mostrar detalhes internos. O 409 inclui conflitos de produto,
quantidade ou checkout em curso; a leitura pública não expõe o bloqueio de checkout.
O GET 404 só é considerado vazio quando Problem Details contém `detail` igual
a `Cart not found`, conforme o contrato atual. Um produto ausente também pode
causar 404 e é apresentado como erro. Não existe código de erro estruturado para
distinguir estes casos; se a leitura enriquecida falhar, não há lista parcial de itens.

As escritas não têm repetição automática. A interface bloqueia cliques concorrentes;
após falha exige consultar o carrinho antes de uma nova tentativa. Um timeout ou
cancelamento não garante que o servidor deixou de aplicar a alteração. No detalhe,
use Consultar carrinho antes de repetir uma adição cujo resultado não foi confirmado.
Login nunca submete uma adição automaticamente.

Checkout continua desativado nesta fase. A FE-07 iniciou os serviços locais, validou a conectividade e corrigiu a audiência do cliente web no Keycloak. O utilizador confirmou o funcionamento do carrinho. Evidências e limites da confirmação manual estão em [INTEGRATION_FE07.md](INTEGRATION_FE07.md); a revisão visual e de acessibilidade continua para FE-08.

O `npm audit` desta entrega identificou dois avisos preexistentes na cadeia de
build: `vite` 8.3.0 interno ao `@angular/build` (high) e `@angular/build` (low). As versões desses pacotes não foram
alteradas. A correção exige análise e autorização próprias; não foi executado
`npm audit fix --force`.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.4.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
