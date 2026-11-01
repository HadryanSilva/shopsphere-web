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
abaixo têm escopo aprovado. FE-10–17 foram concluídas conforme os registros
de validação ao final; FE-18–21 permanecem planejadas.

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
e testes de isolamento foram antecipados da FE-12. A FE-12 consolidou essa
implementação e os cenários de ciclo de sessão, sem duplicar o accessor;
nenhuma persistência de intenção foi antecipada.

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
decisões. A próxima microtarefa é FE-18 — Conectar confirmação e recuperação à tela. Este registro
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

## Validação da FE-12 — Identidade estável no frontend

Concluída em 2026-10-31. O accessor readonly `AuthService.subject` passa a usar
um snapshot reativo próprio, sincronizado com os eventos do adaptador. Não lê
diretamente o objeto mutável do Keycloak no computed. Sub ausente, vazio ou de
tipo inválido não é substituído pelo nome; logout informado pelo adaptador e
descarte limpam a identidade. Falha no logout preserva a sessão existente.

`getAccessToken` verifica se o sub permaneceu igual durante a renovação antes
de devolver um token. Falha de renovação iniciada sob uma conta anterior não
limpa credenciais de outra conta que tenha entrado enquanto ela estava pendente.
Callbacks e renovações de cliente descartado não restauram a identidade.

Dois testes novos reproduziram falhas antes da correção: identidade em cache
após descarte e devolução do token da nova conta para uma operação da antiga.
A cobertura adicional verifica nome/token alterados na mesma conta, claims
inválidos, expiração/reautenticação com retorno ao pedido, logout falho/sucesso,
troca de conta, falha tardia de refresh e descarte com callbacks pendentes.

- `npm test -- --watch=false --include=src/app/auth/auth.service.spec.ts --include=src/app/order/order-page.spec.ts`: 62 testes aprovados (25 de autenticação e 37 de pedido).
- `npm test -- --watch=false`: 136 testes aprovados, oito arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Adaptador e HTTP simulados; não houve login/refresh/logout reais no Keycloak
nesta microtarefa. Navegação e PKCE existentes preservados na suíte. Tokens
continuam privados e em memória, sem persistência de endereço ou intenção,
alteração de backend, permissões, configuração do Keycloak ou dependências.

## Validação da FE-13 — Persistência da intenção por conta

Concluída em 2026-11-01. `CheckoutIntentStore` mantém um único registro por aba
na chave sessionStorage `shopsphere.checkout-intent`, com versão 1 e sub do dono.
O vínculo à conta está no registro, sem usar username como identidade. Não há
token, preço, item, total ou escrita em localStorage.

- `begin(address)` valida e normaliza uma vez os seis campos permitidos, gera
  UUID seguro e só devolve a intenção após a escrita. Objetos de chave/corpo
  retornados são congelados, incluindo o endereço, sem referências ao formulário.
- `read()` valida versão, proprietário, UUID, campos e limites antes de devolver
  uma cópia congelada. Não normaliza novamente nem expira por tempo a intenção.
  Registro inválido bloqueia criação/substituição; não é apagado automaticamente.
- Intenção pendente bloqueia outra chave/endereço. Uma referência de pedido já
  conhecido permite iniciar uma nova intenção explícita.
- `recordOrder(key, id)` verifica a chave e grava referência/remoção de endereço
  numa única escrita atômica. Se a escrita falhar, o registro anterior permanece
  com a chave e o corpo exatos para replay. Não sobrescreve outro ID já conhecido.

O serviço é instanciado no inicializador da aplicação, mesmo fora do checkout.
O evento `AuthService.explicitLogout` permite remover o registro antes de chamar
o adaptador/redirecionar, inclusive quando o provedor rejeita o logout. Expiração
técnica ou logout não solicitado pelo utilizador não emite esse evento: a leitura
fica bloqueada sem sessão e a mesma conta pode recuperar o registro ao entrar.
Nova conta remove o registro do proprietário anterior; operações verificam isso
sincronamente, além da limpeza antecipada pelo effect da sessão.

Falhas de leitura, acesso ou escrita resultam em erros tipados sem dados pessoais
ou detalhe bruto. Falha de remoção deixa a limpeza marcada para nova tentativa
antes de reutilizar o registro, sem impedir o arranque público ou lançar erro no
fluxo de logout. Enquanto o navegador recusar a remoção, não há garantia de
eliminação física. A marca de limpeza pendente é em memória; recarregar após
falha de remoção não preserva essa marca, embora o vínculo por conta continue
validado. Recuperação entre abas/dispositivos e depois de fechar a aba continua
fora do contrato aprovado.

- `npm test -- --watch=false --include=src/app/order/checkout-intent-store.spec.ts --include=src/app/auth/auth.service.spec.ts`: 66 testes aprovados (39 de armazenamento e 27 de autenticação).
- `npm test -- --watch=false`: 177 testes aprovados, nove arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Testes usam sessionStorage/adaptador simulados e recriação do serviço para testar
recarga, além dos inicializadores reais da configuração Angular com AuthService
simulado. A primeira compilação apontou uso de método não público no teste do
inicializador; o teste foi corrigido para aguardar a inicialização pelo TestBed.
Não houve POST, integração backend/Keycloak real, nova rota, tela, dependência,
schema ou ativação de checkout. O coordenador de envio/replay é a FE-14.

## Validação da FE-14 — Envio e recuperação da intenção

Concluída em 2026-11-01. `CheckoutCoordinator` coordena Store e OrderApi sem
alterar rotas, templates ou habilitar checkout no carrinho. A construção do
serviço e as mudanças de sessão restauram somente o estado local, sem HTTP.

- `restore()` consulta o registro local e apresenta vazio, intenção pendente ou
  referência conhecida. Não cria chave nem envia pedido.
- `submit(address)` exige sessão válida e ação explícita; salva a intenção antes
  de subscrever o POST. A operação em andamento bloqueia submit/recover duplicados,
  inclusive enquanto aguarda renovação do token. O Store impede substituir uma
  intenção já pendente por outra chave/endereço.
- `recover()` é explícito: GET para um ID conhecido e POST com a chave/corpo
  originais para resultado incerto. Não consulta Cart nem depende de ele continuar
  ativo para fazer replay. Ausência de intenção não cria uma nova.
- `cancel()` interrompe a subscrição preservando a intenção e o resultado incerto
  da escrita. A futura tela deverá chamá-lo ao sair. Destruição do serviço, logout
  explícito e troca/expiração da sessão também cancelam operações, sem prometer
  rollback no servidor. Respostas de contexto anterior não alteram estado/storage.

O OrderApi ganhou `createOrderResponse` para observar status/corpo, mantendo
`createOrder` com seu retorno anterior. O coordenador exige 201 e pedido válido
antes de gravar a referência. A validação já usada pela página do pedido foi
partilhada em `order-response.ts`, acrescentando verificação do UUID do ID para
criação sem ID esperado. A consulta continua verificando o ID solicitado.

Erros 400/401/403/404/409 e 5xx recebem mensagens seguras; falha no POST mantém
a tentativa sem gerar outra chave ou deduzir aborto por texto do backend.
POST 404 refere-se ao carrinho; GET 404 é pedido não encontrado. Timeout geral
de dez segundos cobre também espera pelo token; resposta vazia/incompatível,
status 2xx diferente de 201 e rede interrompida não são sucesso de criação.
Não há retry automático, polling, login automático ou envio ao recarregar/entrar.

Depois de uma resposta válida, a falha ao gravar a referência produz sucesso com
`persisted: false`, preserva o registro anterior e mantém ID/chave por conta em
memória. A próxima recuperação usa GET e tenta persistir novamente, mesmo com
falha de leitura do storage. O ID em memória é ocultado na expiração e preservado
para reautenticação da mesma conta; logout explícito/outra conta o descartam.
Recarregar após falha de gravação perde esse ID em memória, mas preserva a
recuperação pelo POST da intenção original no sessionStorage.

- `npm test -- --watch=false --include=src/app/order/checkout-coordinator.spec.ts --include=src/app/order/order-api.spec.ts --include=src/app/order/order-page.spec.ts`: 95 testes aprovados (42 do coordenador, 16 do cliente e 37 da página).
- `npm test -- --watch=false`: 219 testes aprovados, dez arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Testes usam OrderApi e Store reais com HttpTestingController, storage e sessão
simulados; cobrem recarga, perda de resposta, timeout, cancelamento, bloqueio de
duplicação, chave/corpo imutáveis, status/JSON inválidos, falha de persistência,
GET por ID conhecido e isolamento de sessão. Não houve POST real, integração
com backend/Keycloak, nova tela, ativação de serviços, migration ou dependência.
O coordenador ainda não é chamado pela UI; a ligação à tela pertence à FE-18.

## Validação da FE-15 — Formulário de endereço

Concluída em 2026-11-01. Componente standalone `ShippingAddressForm`, seletor
`app-shipping-address-form`, com os seis campos de ShippingAddressRequest e os
limites reconfirmados no DTO Java. Campos começam vazios; complemento é opcional.
Código postal aceita texto até 20 caracteres sem regra por país. O código de
país é normalizado para duas letras maiúsculas, sem lista fixa de países.

Rótulos explícitos, required/maxlength e tokens autocomplete de entrega por campo.
O formulário usa novalidate para apresentar mensagens consistentes da aplicação:
erro ao sair de um campo ou após confirmação inválida, aria-invalid e associação
de dicas/erros via aria-describedby. O resumo tem links que focam o campo sem
alterar a URL e recebe foco após confirmação inválida. Editar não desloca foco
para o resumo; corrigir um valor limpa seu erro. IDs são únicos por instância.

Na confirmação válida, `addressConfirmed` emite uma cópia dos seis campos com
trim, país em maiúsculas e complemento vazio como null, sem alterar o rascunho
digitado. O Store continua responsável por validar/congelar o corpo persistido;
o formulário não recebe nem renormaliza intenções salvas. Inputs `disabled` e
`submitLabel` permitem ao pai bloquear a edição/confirmação e definir o rótulo
da ação. A confirmação só emite endereço; não grava storage, não gera UUID e
não acessa AuthService, coordenador ou HTTP.

- `npm test -- --watch=false --include=src/app/order/shipping-address-form.spec.ts`: 28 testes aprovados após corrigir a tipagem do observador usado no teste.
- `npm test -- --watch=false`: 247 testes aprovados, onze arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Testes DOM cobrem obrigatoriedade, espaços em branco, limites exatos/excedidos,
país, código postal estrangeiro, complemento null, normalização, erro associado,
foco no resumo/campo, ausência de desvio de foco ao editar, bloqueio do formulário
e isolamento de IDs/cópias emitidas. CSS prevê uma coluna abaixo de 600 px,
quebra de textos longos e controles com altura mínima de 44 px. Não houve revisão
visual em navegador, navegação manual por teclado ou leitor de ecrã; seguem na
FE-21. Ainda sem rota/tela de checkout ou envio de pedido. Nenhuma alteração de
backend, contrato, schema, autenticação ou dependência.

## Validação da FE-16 — Prévia do checkout

Concluída em 2026-11-01. Rota lazy `/checkout`, título próprio e foco no h1,
com convite para login e leitura autenticada por CartApi. Abertura/login só
consultam o carrinho; nenhum POST ou criação implícita foi introduzido.

Carrinho ACTIVE não vazio com até cem produtos distintos apresenta resumo com
nomes, quantidades, preço por unidade, subtotal e total estimado recebidos do
servidor, formatados com a moeda informada. O texto explicita revalidação de
preços e verificação posterior de estoque. Não há cálculo de total definitivo,
frete, desconto ou disponibilidade de estoque no frontend.

Carrinho vazio/ausente, inativo ou com mais de cem productIds distintos não
monta o formulário; apresenta estado próprio e links para explorar/voltar ao
carrinho. O limite usa os itens distintos, sem depender de totalItems ou soma
de quantidades. Resposta incompatível ou produtos duplicados gera erro seguro
recuperável. O 404 só é vazio para o detail existente `Cart not found`, mantendo
a distinção de produto ausente ou outro 404. Tratados 401/reautenticação explícita,
403/409/rede/integração e nova tentativa manual, sem detalhes internos.

O formulário FE-15 permite editar o rascunho, mas a nova opção `submitDisabled`
bloqueia somente o botão e a confirmação sintética. O botão informa criação
indisponível, com explicação visível na página. Nenhum listener conecta o output
a OrderApi/CheckoutCoordinator/Store. Não grava endereço, não gera chave e não
chama endpoints de pedido. A entrada pelo botão do carrinho permanece desativada
até FE-18; a prévia é acessível pela URL direta.

Consultas são canceladas ao sair ou mudar/terminar a sessão. O contexto usa
status/sub e oculta carrinho/formulário antigos antes de aceitar nova resposta,
inclusive em contas com o mesmo nome. Renovar token ou mudar nome na mesma
conta não recarrega a página nem perde rascunho. Atualizar o carrinho, trocar de
conta, terminar sessão ou sair desmonta o formulário e descarta o rascunho
não persistido; preservar endereço durante refresh manual não faz parte desta
prévia. Links de retorno preservam a consulta sem incluir endereço na URL.

- `npm test -- --watch=false --include=src/app/order/checkout-page.spec.ts --include=src/app/order/shipping-address-form.spec.ts`: 58 testes aprovados (29 da página e 29 do formulário).
- `npm test -- --watch=false`: 277 testes aprovados, doze arquivos, sem falhas.
- `npm run build`: aprovado sem avisos.
- `git diff --check`: aprovado.

Testes com RouterTestingHarness e HTTP/sessão simulados cobrem acesso direto,
totais/moeda, formulário editável sem envio/persistência, vazio/404 ambíguo,
inativo, cem/101 itens, erros/retry, sessão, foco programático e cancelamento.
CSS prevê uma coluna abaixo de 900 px e quebra de textos longos. Não houve
integração real, inspeção visual em navegador, teclado ou leitor de ecrã manual;
seguem nas FE-19–21. Nenhuma alteração de backend, contrato, schema, Keycloak,
dependências ou ativação do checkout por snapshot nesta entrega.

## Validação da FE-17 — Ambiente local de checkout

Concluída e validada operacionalmente em 2026-11-01. Serviços/frontend iniciados
com perfil dev e Order em modo snapshot, identidade de serviço existente e jobs
de recuperação ativos. Emissão client_credentials real e GETs internos com JWT,
bloqueio no Gateway, conectividade frontend/Catalog e rejeição anônima conferidos.
Inventory registrou varreduras concluídas sem candidatos. O ambiente foi deixado
ativo, sem modificar defaults de backend ou habilitar criação na UI.

Order/Inventory tinham bancos dev vazios; Flyway aplicou migrations existentes
V1–V7/V1–V5, respectivamente. A V7 de handoff de Payment já estava no JAR atual;
nenhuma migration foi criada/editada pela FE-17. Sem pedido, intenção, reserva
ou posição de estoque criada. Catalog/Cart mantiveram V3 e dados existentes.

Evidências, opções de arranque, limites e procedimentos em
[INTEGRATION_FE17.md](INTEGRATION_FE17.md). Secret/tokens usados só em memória
e ambiente do processo, sem conteúdo no Git ou logs observados. Testes Angular
e build de produção não foram repetidos nesta entrega operacional/documental;
fontes, links e diff foram validados. Login PKCE, fluxo de compra, recuperação
real e QA visual/manual continuam nas FE-19–21. Pré-requisito operacional da
FE-18 validado nesta sessão, a reconfirmar se os serviços forem reiniciados.
