# PopPerson

Aplicativo interativo para visualizar pessoas públicas e executar ações de ataque ou defesa com níveis de intensidade.

## Run & Operate

- Workflow `PopPerson API` — `PORT=5000 pnpm --filter @workspace/api-server run dev`
- Workflow `PopPerson Web` — `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/pop-person run dev`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/pop-person` — interface principal e fluxo de seleção de ações
- `artifacts/api-server` — API e cálculo dos valores das ações
- `lib/db/src/schema` — tabelas de pessoas, itens, níveis e regras
- `lib/api-spec/openapi.yaml` — contrato da API

## Architecture decisions

- O preço base do item é unitário; o custo total usa a quantidade de projéteis do nível selecionado.
- Um `price_override` ativo pode substituir o total calculado para um par item/nível específico.
- A API é a fonte de verdade para níveis, regras de preço, fila e execução das ações.

## Product

- Visualiza pessoas públicas em círculos e permite filtrar por localização e categoria.
- Permite escolher elemento, intensidade e ação de ataque ou defesa.
- Exibe o custo total correspondente à intensidade antes do envio.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
