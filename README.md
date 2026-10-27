# ShopsphereWeb

## Catálogo local (FE-02)

Execute `npm start` e abra `http://localhost:4200`. O servidor Angular encaminha
`/api/**` para o Gateway em `http://localhost:8080`, conforme `proxy.conf.json`.
Gateway e Catalog (8081), com as suas dependências, precisam estar disponíveis;
o frontend não os inicia. Não é necessário login para consultar produtos.

A vitrine apresenta a primeira página (até 20 produtos ACTIVE, por nome), com
preços e imagens recebidos da API. Paginação e filtros interativos ficam para
FE-03. As chamadas têm timeout de 10 segundos; falhas permitem nova tentativa
manual. Nenhum produto de demonstração é carregado pela aplicação.

Em produção, `/api` deve ser encaminhado ao Gateway pela infraestrutura que
serve o frontend. O proxy do Angular atua apenas no servidor de desenvolvimento.
Não foram alteradas regras de CORS ou segurança no backend.

Validação: `npm run build` e `npm test -- --watch=false`.

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
