# Checkout e pedido no frontend — FE-09

Definição documental preparada em 2026-10-31 e aprovada explicitamente pelo
utilizador nesta data, incluindo as cinco decisões e a sequência FE-10–21.
A FE-09 está concluída e aprovada; executar uma microtarefa de implementação por vez.
Não há nova tela, chamada HTTP, alteração de backend ou ativação de serviços nesta entrega.

## Base verificada

| Área | Comportamento existente |
| --- | --- |
| Frontend | Angular com rotas `/`, `/products/:id` e `/cart`; checkout desativado no carrinho. AuthService mantém tokens em memória; CartApi obtém token renovado por operação. |
| Gateway | Encaminha `/api/v1/orders/**` para Order e exige autenticação. As operações internas Cart/Inventory não são chamadas pelo navegador. |
| Criação | `POST /api/v1/orders`, Bearer e `Idempotency-Key` UUID obrigatórios; corpo com `shippingAddress`. Retorna 201, `Location: /api/v1/orders/{id}` e OrderResponse, inclusive no replay de pedido existente. |
| Identidade | O servidor deriva customerId do `sub` JWT. GET `/api/v1/orders/{id}` consulta somente o proprietário; inexistente ou de outra conta retorna 404, inclusive para ADMIN. |
| Idempotência | Cliente/chave identifica a intenção. Endereço diferente na mesma chave retorna 409; replay compara os campos exatamente, sem normalização do servidor. |
| Snapshot | Prepara Cart, revalida Catalog, persiste pedido e conclui Cart com recuperação durável. Até 100 produtos distintos; exceder retorna 409. Cart concluído não é reaberto por cancelamento posterior do pedido. |
| Estoque | Worker após conclusão do Cart pode avançar PENDING_STOCK para PENDING_PAYMENT ou CANCELLED. Criar pedido não confirma estoque, pagamento ou compra. |
| Configuração | `checkout.snapshot.enabled` usa SHOPSPHERE_CHECKOUT_SNAPSHOT_ENABLED, false por padrão. O modo anterior continua disponível; a UI não consegue descobrir o modo pela API atual. |
| Limites públicos | Sem listagem de pedidos, consulta por chave de idempotência, cancelamento ou pagamento público nesta entrega. OrderResponse não inclui endereço, prazo da reserva ou motivo de cancelamento. |

Fontes conferidas: [controller](../order-service/src/main/java/br/com/hadryan/shosphere/order/controller/OrderController.java),
[DTOs](../order-service/src/main/java/br/com/hadryan/shosphere/order/mapper/response/OrderResponse.java),
[endereço](../order-service/src/main/java/br/com/hadryan/shosphere/order/mapper/request/ShippingAddressRequest.java),
[idempotência](../order-service/src/main/java/br/com/hadryan/shosphere/order/service/impl/OrderIdempotency.java),
[snapshot](../order-service/src/main/java/br/com/hadryan/shosphere/order/service/impl/SnapshotCheckoutUseCase.java),
[consulta por proprietário](../order-service/src/main/java/br/com/hadryan/shosphere/order/service/impl/GetOrderByIdUseCaseImpl.java),
[configuração](../order-service/src/main/resources/application.yaml),
[operação Order–Inventory](../order-service/STOCK_OPERATION.md),
[rotas frontend](src/app/app.routes.ts) e [CartApi](src/app/cart/cart-api.ts).
O levantamento foi estático; não verifica serviços em execução.

## Contrato que o navegador usará

```json
{
  "shippingAddress": {
    "recipient": "Nome do destinatário",
    "addressLine": "Rua e número",
    "addressLine2": null,
    "city": "Lisboa",
    "postalCode": "1000-001",
    "countryCode": "PT"
  }
}
```

Não enviar items, customerId, cartId, preços, descontos ou totais. O record
CreateOrderRequest também declara items, mas o fluxo snapshot usa os itens do Cart.
O exemplo contém dados ilustrativos, não valores predefinidos do formulário.

| Campo de endereço | Regra existente no servidor |
| --- | --- |
| recipient | Obrigatório, não branco, máximo 150 caracteres |
| addressLine | Obrigatório, não branco, máximo 200 |
| addressLine2 | Opcional/null, máximo 200 |
| city | Obrigatório, não branco, máximo 100 |
| postalCode | Obrigatório, não branco, máximo 20; sem expressão específica por país |
| countryCode | Obrigatório, duas letras maiúsculas `[A-Z]{2}`; o backend não valida pertença a uma lista de países |

OrderResponse contém id, status, items, subtotal, discountAmount, shippingAmount,
totalAmount, currency, paymentStatus e updatedAt. Cada item contém productId,
productName, quantity, unitPrice e lineTotal. paymentStatus é atualmente null.
Exibir valores do servidor com a moeda recebida e formatação pt-PT; não calcular
um total definitivo a partir do carrinho nem inventar frete/desconto/pagamento.

## Experiência proposta

`/checkout` apresenta autenticação, leitura atual do carrinho, resumo estimado
e formulário de endereço. Carrinho vazio/inativo ou acima de 100 produtos
distintos impede uma nova submissão e oferece retorno ao carrinho. A leitura
é uma prévia: o servidor decide itens e preços no snapshot; não existe cotação
vinculante nem confirmação posterior de alteração de preço nesta API.

O botão final será “Criar pedido”, com aviso de que os preços serão revalidados
e o estoque ainda será verificado. O utilizador confirma explicitamente o envio;
entrar na conta, abrir a rota ou voltar do login nunca envia POST.
Bloquear cliques duplicados enquanto a operação estiver pendente.

Com 201 válido, navegar para `/orders/:id` usando o ID validado do corpo,
sem seguir um Location arbitrário externo. A página consulta GET, permite
atualização manual e apresenta snapshots, totais, estado e updatedAt. Não terá
polling nesta primeira entrega. UUID inválido não gera requisição; 404 informa
“Pedido não encontrado” sem distinguir outra conta. Acesso direto exige login,
sem mostrar dados anteriores durante a troca de sessão.

| Estado recebido | Apresentação proposta |
| --- | --- |
| PENDING_STOCK | Pedido criado; a aguardar verificação de estoque |
| PENDING_PAYMENT | A aguardar pagamento; pagamento indisponível nesta fase |
| CANCELLED | Pedido cancelado; sem atribuir motivo ausente do contrato |
| CONFIRMED | Pedido confirmado, conforme estado informado pelo servidor |
| PROCESSING / SHIPPED / DELIVERED | Em processamento / Enviado / Entregue |
| PAYMENT_FAILED | Falha no pagamento, sem oferecer operação inexistente |
| PENDING / COMPLETED | Pendente / Concluído, sem inferir pagamento a partir do estado |
| Estado desconhecido | Estado indisponível, preservando consulta e totais válidos |

Estados conhecidos não autorizam ações de pagamento, cancelamento ou alterações
de pedido. Após sucesso, atualizar a leitura do carrinho quando ele for aberto;
não remover seus itens por DELETE no frontend.

## Intenção de compra e respostas perdidas

Proposta: gerar UUID com crypto.randomUUID somente na confirmação inicial e
congelar o endereço normalizado uma única vez (trim, país em maiúsculas e linha
opcional vazia como null). Toda repetição explícita usa a mesma chave e o mesmo
corpo congelado; nunca normalizar novamente a partir de campos editados.

Persistir antes do POST, em sessionStorage por utilizador autenticado, uma única
intenção com versão de formato, chave, corpo exato e orderId quando conhecido.
Isso inclui endereço pessoal: esta escolha foi aprovada explicitamente pelo utilizador.
Não guardar token, endereço ou chave na URL, logs ou localStorage. Indisponibilidade
de storage impede iniciar o POST, com mensagem recuperável; não enviar primeiro
e descobrir depois que a intenção não foi guardada.

AuthService precisará expor o identificador estável do utilizador autenticado
para vincular a intenção; username não basta. Esta extensão é local ao frontend,
sem mudança na autenticação do backend. Validar o registro ao ler storage e
não apresentá-lo nem repeti-lo sob outra identidade.

Timeout, rede interrompida, cancelamento da requisição, resposta inválida ou 5xx
não provam ausência de pedido. Manter a intenção e oferecer “Verificar tentativa”:
GET se há orderId conhecido; caso contrário, POST explícito com chave/corpo
originais. Não exigir carrinho ainda ativo para esse replay, pois o pedido pode
já ter concluído o Cart. Não repetir POST automaticamente ao recarregar ou entrar.

Depois de um envio incerto, não permitir editar o endereço ou gerar nova chave
na mesma intenção. 400/404/409 exibem mensagem segura e orientação; 409 sozinho
não prova aborto concluído e não autoriza descartar a chave. A definição não
introduz heurística baseada em textos de erro para declarar uma intenção terminal.
Sem resolução pela API, informar a limitação e preservar a recuperação.

Em 201 válido, guardar primeiro orderId para recuperação e abrir a consulta;
depois remover o endereço da intenção local. Manter referência ao pedido para
acesso por link. Falha ao gravar o resultado deve preservar o registro anterior,
que ainda permite replay da mesma intenção.

sessionStorage cobre recarga e navegação na mesma aba, não sincroniza abas nem
dispositivos. Logout explícito limpa dados pessoais locais; após esse descarte
ou fechar a aba, não há recuperação garantida de intenção sem ID conhecido.
Expiração técnica do token deve ocultar os dados e permitir reautenticação da
mesma conta, preservando a intenção. Troca de conta deve limpar os dados antigos.
Não prometer deduplicação global pela UI: a unicidade por carrinho depende do
modo snapshot no servidor. Não eliminar automaticamente uma intenção incerta por tempo.

## Erros, acessibilidade e limites

- 401: reautenticação explícita e retorno à rota, sem replay de escrita automático.
- 403: acesso indisponível; sem contornar permissões.
- POST 404: não foi possível obter o carrinho necessário; não tratar como GET de pedido vazio.
- 400/409: mensagem de validação/conflito e retorno orientado ao carrinho; preservar a intenção já enviada até resolução.
- 502/503/timeout/rede: resultado incerto na escrita; na leitura, nova tentativa manual.
- Erros não mostram detalhes internos, JWT ou conteúdo bruto de Problem Details.
- Campos com label, autocomplete apropriado, limites e erros associados por aria-describedby/aria-invalid; resumo de erros com foco após submissão inválida.
- Estados de carregamento/sucesso anunciados, foco no título após navegação, teclado e layout responsivo conforme FE-08.

Sem nova dependência, endpoint, migration, alteração de Keycloak, pagamento,
cancelamento público, histórico de pedidos, promoção, lista fixa de categorias
ou consulta de reserva interna pelo navegador.

## Sequência proposta

Executar uma microtarefa por vez, reconfirmando código e numeração ao começar.

As quatro entregas iniciais foram desdobradas em FE-10–21 antes de qualquer
implementação. A numeração abaixo substitui a proposta anterior FE-10–13;
nenhuma tarefa dessa proposta anterior chegou a ser executada. Todas as tarefas
abaixo têm escopo aprovado. FE-10 e FE-11 foram concluídas conforme os registros
de validação ao final; FE-12–21 permanecem planejadas.

| ID | Microtarefa | Depende de | Escopo e critério de conclusão |
| --- | --- | --- | --- |
| FE-10 | Cliente HTTP de pedidos | Aprovação da definição | Criar DTOs e OrderApi com GET por ID e POST com endereço/chave, token renovado somente nessas chamadas e timeout. Testar URL, headers, corpo sem itens/preços/identidade, ausência de envio sem token e ausência de retry automático. Sem rota ou submissão pela UI. |
| FE-11 | Página de consulta do pedido | FE-10 | Criar `/orders/:id` com acesso direto, snapshots, totais, estados e atualização manual. Cobrir UUID inválido, carregamento, 401/403/404, falha/retry e limpeza dos dados ao sair ou mudar sessão; requisições antigas não atualizam a página. Sem criação de pedido. |
| FE-12 | Identidade estável no frontend | Aprovação da definição | Expor o sub autenticado no AuthService, sem expor token em estado público/storage. Testar renovação da mesma conta, expiração, reautenticação, logout e troca de conta; preservar login/logout e navegação existentes. Sem persistir endereço. |
| FE-13 | Persistência da intenção por conta | FE-12 | Criar armazenamento versionado em sessionStorage para chave/corpo congelados e orderId, com normalização única. Testar recarga, registro inválido, falha de leitura/escrita, isolamento por sub, logout/troca de conta e preservação durante expiração técnica. Nenhum POST nesta tarefa. |
| FE-14 | Envio e recuperação da intenção | FE-10, FE-13 | Coordenar gravação antes do POST, bloqueio de duplicação, resultado incerto, replay explícito com chave/corpo originais e resolução por GET quando há ID. Testar timeout, resposta inválida, 400/401/403/404/409/5xx, falha ao guardar resultado e ausência de replay ao iniciar/login/recarregar. Sem ativar checkout no carrinho. |
| FE-15 | Formulário de endereço | Aprovação da definição | Criar formulário com campos/limites reais, labels, autocomplete, normalização e erros associados; focar resumo de erros na confirmação inválida. Testar campos obrigatórios, limites, país e linha opcional. Sem envio de pedido ou dependência nova. |
| FE-16 | Prévia do checkout | FE-15 | Criar `/checkout` com convite para login, leitura do carrinho, resumo estimado e formulário. Cobrir vazio/inativo, mais de 100 produtos, erros/retry, sessão e cancelamento de leituras. Ação final permanece indisponível e abrir/login nunca envia POST. |
| FE-17 | Verificar ambiente local de checkout | Aprovação da definição | Conferir arranque snapshot, token de serviço e workers Order/Inventory segundo a operação existente; documentar configuração e evidência HTTP segura. Configuração somente local, sem secrets no repo ou alteração dos defaults do backend. Indisponibilidade deve ser registrada como pendência, sem declarar integração validada. |
| FE-18 | Conectar confirmação e recuperação à tela | FE-11, FE-14, FE-16, FE-17 validada | Ligar “Criar pedido” à confirmação explícita e navegar ao pedido em 201 válido. Integrar retomada após recarga antes de exigir Cart ativo, mensagens de resultado incerto e bloqueio de endereço/chave após envio. Habilitar entrada pelo carrinho e testar duplo clique, login sem envio, replay, retorno e atualização posterior do Cart. |
| FE-19 | Validar criação e consulta reais | FE-18 | Com serviços e Keycloak reais, validar login, criação, acesso direto, replay conhecido, consulta por proprietário e progressão PENDING_STOCK/PENDING_PAYMENT. Registrar resultados e limites, sem simulação apresentada como evidência real. |
| FE-20 | Validar recuperação e cancelamento reais | FE-19 | Validar resposta perdida, recarga e retomada com a mesma chave, indisponibilidade/restauração e expiração/cancelamento por estoque. Confirmar ausência de novo pedido/débito duplicado e que a UI não promete reabertura do Cart. Injeções de falha somente em ambiente local isolado, sem mudar dados compartilhados. |
| FE-21 | Revisar experiência e acessibilidade | FE-18; FE-19/20 para encerrar a fase | Rever checkout e pedido em desktop/telemóvel, teclado, foco, zoom, nomes acessíveis e anúncios de erro/estado. Corrigir problemas observados, executar regressão de catálogo/detalhe/carrinho e registrar cobertura manual/automatizada e pendências. |

As tarefas intermediárias podem entregar componentes/serviços testáveis sem
habilitar uma compra incompleta. FE-18 é o ponto de habilitação da UI; FE-19–21
encerram a validação da fase. Concluir código não substitui a evidência de
integração real. Os testes de cada tarefa acompanham a implementação; as últimas
etapas não adiam a validação unitária ou de componente das anteriores.

Dependência identificada na FE-11: a página precisa distinguir contas pelo sub,
inclusive quando possuem o mesmo nome. O accessor mínimo `AuthService.subject`
e testes de isolamento foram antecipados da FE-12. A FE-12 deve partir dessa
implementação, consolidar os cenários de ciclo de sessão e atualizar seu estado
sem duplicar o accessor; nenhuma persistência de intenção foi antecipada.

Cada entrega de código exige testes focados, suíte frontend sem watch, build,
diff revisado e commit local. A FE-09 documental exige conferência das fontes,
links e diff; não altera execução e não requer repetir testes Angular.

## Decisões aprovadas em 2026-10-31

1. Implementar somente criação de pedido e consulta individual, na sequência FE-10–21.
2. Usar a criação com revalidação de preços sem uma segunda confirmação vinculante,
   explicitando que o resumo do Cart é estimado; pagamento permanece indisponível.
3. Aprovar sessionStorage com endereço/chave por conta na mesma aba e a exposição
   mínima do sub pelo AuthService, com as regras e limites de recuperação acima.
4. Usar atualização manual do pedido, sem polling, cronômetro de reserva ou motivo
   de cancelamento inferido; reavaliar depois se houver contrato para esses dados.
5. Exigir ambiente local com snapshot, identidade de serviço e workers configurados
   antes de validar/habilitar o checkout; não ativar backend nesta definição.

O utilizador aprovou explicitamente o plano após a apresentação destas cinco
decisões. A próxima microtarefa é FE-12 — Identidade estável no frontend. Este registro
não executa a implementação nem altera configuração de serviços.

Se for necessária recuperação entre abas,
logout ou dispositivos, ou resolução autônoma de intenções com 409 sem ID,
definir um contrato adicional antes de prometer essa capacidade no frontend.

## Validação da FE-10 — Cliente HTTP de pedidos

Concluída em 2026-10-31. OrderApi e DTOs conferidos com controller, records e
enum atuais do Order. GET por ID usa segmento codificado; POST envia somente
os seis campos de endereço e a chave recebida do chamador, sem normalização,
geração de chave, itens, preços, totais ou identidade fornecida pelo cliente.

Token obtido pelo AuthService a cada subscrição, restrito às chamadas Order,
com timeout HTTP de 10 segundos e erro local 401 sem token. Sem retry automático;
erros HTTP/rede são propagados para o futuro coordenador. Sem interceptor,
storage, rota, tela ou habilitação de checkout nesta microtarefa.

- `npm test -- --watch=false --include=src/app/order/order-api.spec.ts`: 16 testes aprovados.
- `npm test -- --watch=false`: 87 testes aprovados, sete arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Testes HTTP usam HttpTestingController e autenticação simulada; não houve POST
real, login real ou validação ponta a ponta. Validação de conteúdo recebido e
estados da tela pertencem às próximas microtarefas; os tipos TypeScript não
validam JSON em execução. Nenhuma mudança de backend, contrato ou dependência.

## Validação da FE-11 — Página de consulta do pedido

Concluída em 2026-10-31. Rota lazy `/orders/:id` com título próprio, foco no h1,
autenticação explícita e leitura por OrderApi. Exibe referência, nomes/quantidades
do snapshot, preços, subtotal, desconto, envio, total, moeda e updatedAt recebidos.
Traduções dos estados conhecidos, fallback para desconhecido e aviso de pagamento
indisponível; não infere causa de cancelamento nem pagamento a partir de estado.

Atualização somente manual, com bloqueio de cliques durante a leitura. UUID
inválido não chama Order; 404 é genérico para inexistente/outra conta; 401 oferece
reautenticação, 403 informa restrição e erros temporários oferecem nova tentativa.
JSON incompatível gera erro recuperável, sem renderizar totais inválidos. Conteúdo
textual é interpolado com escape; não há POST ou operação de pagamento/cancelamento.

O contexto usa ID da rota, estado da sessão e sub. O accessor readonly de sub foi
antecipado da FE-12 por necessidade de isolamento; não altera JWT, login, permissões
ou storage. Dados do contexto anterior são ocultados sincronamente na renderização,
e a troca de contexto/saída cancela a subscrição anterior. Renovação do token e
mudança do nome na mesma conta não provocam ciclos de consulta.

- `npm test -- --watch=false --include=src/app/order/order-page.spec.ts --include=src/app/auth/auth.service.spec.ts`: 52 testes aprovados, após correção de tipagem apontada na primeira compilação.
- `npm test -- --watch=false`: 126 testes aprovados, oito arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Os testes usam RouterTestingHarness, DOM de teste e HTTP/autenticação simulados;
cobrem acesso direto, moeda/totais, estados, foco programático, 401/403/404/rede,
retry manual, sessão, contas com mesmo nome, requisições obsoletas e JSON inválido.
Não houve integração com backend/Keycloak reais, inspeção visual em navegador,
teste manual de teclado ou leitor de ecrã nesta entrega; seguem nas FE-19–21.
CSS prevê uma coluna abaixo de 850 px e quebra de textos longos, sem alegar
validação visual real. Nenhuma alteração de backend, contrato, schema ou dependência.
