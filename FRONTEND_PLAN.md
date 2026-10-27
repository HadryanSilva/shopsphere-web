# Frontend — plano incremental

Direção aprovada: loja mult categoria, administração centralizada e visual
sóbrio, minimalista e moderno. A página inicial é o catálogo.
Cada microtarefa termina com revisão do diff, validação pertinente e commit local.

| ID    | Microtarefa                | Critério de conclusão                                                                                                                                                                           | Estado    |
| ----- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| FE-01 | Base visual da loja        | Cabeçalho, introdução curta, área reservada ao catálogo e rodapé responsivos; idioma português, foco visível e salto para o conteúdo. Recursos sem integração identificados como indisponíveis. | Concluída |
| FE-02 | Catálogo real              | Confirmar DTO/paginação e ligar a listagem ao Gateway; cards com preço/moeda e imagem; carregamento, vazio, erro e nova tentativa. Sem produtos fictícios.                                      | Pendente  |
| FE-03 | Busca, filtros e paginação | Confirmar parâmetros e ordenações aceites; estado na URL, navegação entre páginas e filtros num painel no telemóvel. Validar como obter categorias antes de incluir esse filtro.                | Pendente  |
| FE-04 | Detalhe do produto         | Rota por ID, imagem, descrição, preço, quantidade e estados de carregamento/404/erro. Ação de compra depende de FE-05/06.                                                                       | Pendente  |
| FE-05 | Autenticação               | Verificar cliente Keycloak e configurar Authorization Code + PKCE, login/logout e retorno à navegação; definir dependências antes de adicionar bibliotecas.                                     | Pendente  |
| FE-06 | Carrinho                   | Integrar APIs autenticadas, adição, alteração e remoção; tratar 401/404/409 e falhas de integração, com valores vindos do backend.                                                              | Pendente  |

## Limites desta fase

- FE-01 não consulta APIs: a área reservada não representa catálogo vazio nem falha de rede.
- Busca, conta e carrinho permanecem desativados até as respetivas integrações.
- A listagem de categorias não foi identificada na API; não fixar categorias ou IDs no frontend.
- Antes de FE-02, confirmar configuração de acesso ao Gateway (por exemplo, proxy local), sem alterar CORS/segurança do backend por suposição.
- Checkout/detalhe do pedido e administração serão divididos em microtarefas próprias.
- Checkout depende da evolução Cart–Order; criação de pedido não significa compra confirmada.
- Histórico de pedidos, vendedores, pagamentos e promoções não fazem parte desta fase.

## Validação de FE-01

Testes do componente verificam criação, salto para o conteúdo e indisponibilidade
explícita de ações ainda sem integração. Executar build de produção e testes
Angular sem watch antes de concluir. Registar limitações reais, inclusive QA visual.

Validação executada: build de produção e 3 testes Angular aprovados. A revisão visual
em navegador e a verificação manual em dispositivos permanecem pendentes.
