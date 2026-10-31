# Checkout e pedido no frontend — FE-09

Definição documental preparada em 2026-10-31. A FE-09 conclui o levantamento e
a proposta incremental; as decisões abaixo aguardam aprovação antes de implementar.
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
Isso inclui endereço pessoal: esta escolha exige aprovação explícita na definição.
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

| ID | Entrega | Critério de conclusão |
| --- | --- | --- |
| FE-10 | Cliente Order e consulta do pedido | DTOs reais, token escopado, GET e rota `/orders/:id`; estados/valores, acesso direto, 401/403/404/retry e isolamento entre sessões testados. Sem criar pedido. |
| FE-11 | Intenção recuperável de checkout | Identidade estável no AuthService, storage por conta, UUID/corpo imutáveis e POST autenticado; testes de recarga, troca de conta, storage indisponível, resposta perdida, replay e ausência de envio automático. Sem ativar botão do carrinho. |
| FE-12 | Tela de checkout | `/checkout`, leitura do carrinho, endereço, validação, confirmação explícita, integração da intenção e navegação ao pedido; habilitar entrada pelo carrinho após validar o pré-requisito operacional. |
| FE-13 | Integração real e revisão de experiência | Preparar ambiente local snapshot e credencial de serviço fora do frontend; testar login, criação, replay após perda de resposta, consulta por proprietário, progressão de estoque e expiração/cancelamento; desktop/telemóvel, teclado/foco e mensagens. Documentar limitações reais. |

Cada entrega de código exige testes focados, suíte frontend sem watch, build,
diff revisado e commit local. A FE-09 documental exige conferência das fontes,
links e diff; não altera execução e não requer repetir testes Angular.

## Decisões para aprovação

1. Implementar somente criação de pedido e consulta individual, na sequência FE-10–13.
2. Usar a criação com revalidação de preços sem uma segunda confirmação vinculante,
   explicitando que o resumo do Cart é estimado; pagamento permanece indisponível.
3. Aprovar sessionStorage com endereço/chave por conta na mesma aba e a exposição
   mínima do sub pelo AuthService, com as regras e limites de recuperação acima.
4. Usar atualização manual do pedido, sem polling, cronômetro de reserva ou motivo
   de cancelamento inferido; reavaliar depois se houver contrato para esses dados.
5. Exigir ambiente local com snapshot, identidade de serviço e workers configurados
   antes de validar/habilitar o checkout; não ativar backend nesta definição.

Nenhuma aprovação foi presumida. Se for necessária recuperação entre abas,
logout ou dispositivos, ou resolução autônoma de intenções com 409 sem ID,
definir um contrato adicional antes de prometer essa capacidade no frontend.
