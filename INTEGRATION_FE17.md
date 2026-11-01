# FE-17 — ambiente local de checkout

Estado: **concluída e validada operacionalmente em 2026-11-01**. Os cinco
serviços e o frontend foram iniciados e deixados ativos nesta sessão. Esta
verificação habilita a dependência operacional da FE-18; não habilita o botão
de criação no frontend nem substitui as validações ponta a ponta das FE-19–20.

## Estado inicial e preparação

PostgreSQL e Keycloak estavam ativos nos containers existentes, em 5432 e 8180.
Frontend, Gateway, Catalog, Cart, Order e Inventory estavam parados. As variáveis
de snapshot/token-uri/secret não estavam definidas na sessão de trabalho.

Usados os JARs existentes em `../<módulo>/build/libs/`, com Java 25.0.4 e perfil
dev. Nenhum arquivo de src/main tinha timestamp posterior ao respectivo JAR;
isso é conferência de atualidade, não comprovação de build reprodutível. Não
houve recompilação, atualização de dependências ou edição de backend nesta FE.

| Processo | Porta | PID desta sessão |
| --- | --- | --- |
| Frontend Angular | 4200 | 14512 (Node; launcher 5784) |
| API Gateway | 8080 | 24388 |
| Catalog | 8081 | 10684 |
| Cart | 8082 | 13336 |
| Order | 8083 | 26540 |
| Inventory | 8084 | 10556 |

PIDs são evidência desta execução, não identificadores permanentes. Antes de
parar um processo, reconfirmar seu executável, serviço e porta; não encerrar
processos de outras sessões por nome. O frontend usa `npm start -- --host
localhost --port 4200`, com o proxy existente para o Gateway.

Todos os serviços receberam audiência `shopsphere-api` por argumento local,
preservando a validação de issuer/JWT. SQL no console foi desativado nesta
execução com `--spring.jpa.show-sql=false`. Os defaults dos arquivos permaneceram
intactos. Logs estão em `tmp/fe17-runtime/`, diretório ignorado pelo Git.

## Configuração efetiva do Order

| Opção | Valor usado nesta sessão |
| --- | --- |
| SHOPSPHERE_CHECKOUT_SNAPSHOT_ENABLED | true |
| SHOPSPHERE_ORDER_TOKEN_URI | http://localhost:8180/realms/shopsphere/protocol/openid-connect/token |
| checkout.snapshot.client-id | shopsphere-order |
| SHOPSPHERE_ORDER_CLIENT_SECRET | Fornecido somente no ambiente do processo; valor omitido |
| checkout.snapshot.recovery.enabled | true |
| stock.recovery.enabled | true |
| services.cart.url | http://localhost:8082 (perfil dev existente) |
| services.catalog.url | http://localhost:8081 (perfil dev existente) |
| services.inventory.url | http://localhost:8084 (default existente) |
| Cadência dos dois jobs Order | PT60S, defaults existentes |

O secret existente foi consultado via administração local do Keycloak e usado
em memória, sem provisioning, alteração de roles/clientes ou gravação em arquivo,
Git ou argumentos da JVM. As variáveis temporárias foram removidas do processo
lançador após o arranque; o Order mantém seu ambiente para renovar tokens.

Foi ativado somente no processo Order o nível DEBUG do
`ConditionEvaluationReportLogger`, para registrar condições de criação dos beans.
O relatório mostra `SnapshotCheckoutUseCase`, `CheckoutRecoveryJob` e
`StockRecoveryJob` com condições atendidas. O caso de uso anterior não foi
selecionado. `jcmd <pid> Thread.print`, com saída filtrada, confirmou as threads
`checkout-recovery-1` e `checkout-recovery-2`.

O Inventory mantém o job existente de expiração com período padrão PT60S.
Confirmados a thread `scheduling-1` e dois registros de varredura, às 15:35:03Z e
15:36:03Z, com candidates=0, expired=0, skipped=0, failed=0 e completed=true.
No Order, beans/threads/configuração foram verificados; não havia trabalho de
negócio pendente para demonstrar recuperação ou transição de pedido.

Para repetir o arranque, seguir [STOCK_OPERATION.md](../order-service/STOCK_OPERATION.md),
fornecendo o secret por ambiente seguro somente ao processo Order. Executar os
JARs com `--spring.profiles.active=dev`, configurar as opções da tabela e manter
as portas livres. Não gravar o secret em scripts/README/linha de comando. A
configuração por processo desta sessão não constitui instalação persistente:
após reinício do computador ou dos serviços, é necessário fornecê-la novamente.

## Banco e migrations

Catalog e Cart já estavam na V3, com histórico bem-sucedido. Order e Inventory
não tinham tabelas no schema public. O arranque executou Flyway e JPA validate:

- Order: aplicadas as migrations **existentes V1–V7**, todas com success=true.
- Inventory: aplicadas as migrations **existentes V1–V5**, todas com success=true.
- Catalog/Cart: permanecem na V3; nenhum reset, backfill ou edição de migration.

A V7 do Order (`persist_payment_handoff`) já fazia parte do código/JAR atual:
é evolução de backend posterior ao levantamento inicial da FE-09, não uma
migration criada pela FE-17. Foi aplicada normalmente ao banco dev vazio.
Isso não habilita pagamento no frontend nem comprova fluxo de Payment.

Leituras após o arranque confirmaram orders=0, checkout_intents=0 e stock_work=0
no Order; inventory_stock=0 e inventory_reservations=0 no Inventory. Nenhum
pedido, endereço, preparação de Cart, reserva ou ajuste de estoque foi criado
pela verificação. A inicialização dos schemas é o efeito persistente desta FE.
Dados de Catalog/Cart existentes foram preservados.

## Evidência HTTP real

Usado UUID aleatório de diagnóstico para GET de recursos inexistentes, sem
submeter PUT/POST/DELETE de negócio. Respostas e headers sensíveis não foram
registrados. A emissão OIDC requer POST de token, mantido somente em memória.

| Verificação | Resultado |
| --- | --- |
| Descoberta OIDC do realm shopsphere | 200 |
| GET frontend `/checkout` | 200, fallback HTML da SPA |
| GET frontend `/auth-config.json` | 200 |
| GET frontend `/api/v1/products?page=0&size=1&status=ACTIVE` | 200, proxy/Gateway/Catalog conectados |
| GET frontend `/api/v1/carts/me`, anônimo | 401 |
| GET frontend `/api/v1/orders/{uuid}`, anônimo | 401 |
| GET Order direto `/api/v1/orders/{uuid}`, anônimo | 401 |
| GET Cart interno `/internal/api/v1/cart-checkouts/{uuid}`, anônimo | 401 |
| GET Inventory interno `/internal/api/v1/inventory/reservations/{uuid}`, anônimo | 401 |
| GET Cart interno com token de serviço | 404, recurso inexistente após autenticação/autorização |
| GET Inventory interno com token de serviço | 404, recurso inexistente após autenticação/autorização |
| GET dos dois caminhos internos pelo Gateway com token de serviço | 403, sem exposição externa |

Cliente `shopsphere-order` existente: enabled=true, publicClient=false e
serviceAccountsEnabled=true. Emissão **client_credentials real com 200**;
conferidos issuer local esperado, azp=shopsphere-order, aud contendo
shopsphere-api e realm roles CART_CHECKOUT_SERVICE/INVENTORY_SERVICE. As claims
foram inspecionadas em memória; os GET internos também passaram pelos filtros
JWT reais de Cart/Inventory, sem desabilitar segurança ou simular decoder.

Uma leitura dos logs com compartilhamento de arquivo conferiu ausência do valor
do secret existente e de texto com formato JWT. Não é uma auditoria geral de
logs; é a verificação desses conteúdos na execução observada. Logs não foram
adicionados ao commit.

## Limites e próxima etapa

- HTTP 200 da SPA confirma servidor/fallback, não execução do JavaScript,
  renderização da página, login Authorization Code/PKCE ou navegação manual.
- Nenhum POST de pedido, replay de checkout, reserva efetiva, cancelamento,
  recuperação após falha ou isolamento entre compradores foi exercitado aqui.
  Esses cenários continuam nas FE-19–20.
- O estoque local está vazio. Para testar reserva bem-sucedida depois, preparar
  fixture de produto/estoque por operação administrativa autorizada; não assumir
  disponibilidade a partir do catálogo ou desta verificação de arranque.
- A FE-18 pode conectar a confirmação e a recuperação à tela, mantendo as regras
  de intenção/idempotência já aprovadas. A criação continua indisponível hoje.
- Não foram executados novamente testes/build de produção Angular, pois só houve
  preparação operacional e documentação. A suíte/build anteriores da FE-16
  permanecem evidência daquela entrega, não testes novos da FE-17.
- Validação documental: fontes, links locais e `git diff --check` conferidos
  antes do commit. Não houve publicação, push ou alteração de defaults do backend.
