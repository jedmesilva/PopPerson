# InstaPop

InstaPop — popularidade em movimento. Um aplicativo interativo para descobrir quem está em alta e executar ações sobre pessoas públicas, criadores e marcas.

## Run & Operate

- Workflow `artifacts/api-server: API Server` — `pnpm --filter @workspace/api-server run dev`
- Workflow `artifacts/pop-person: web` — `pnpm --filter @workspace/pop-person run dev`
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
- `lib/db/src/schema` — tabelas de pessoas, tipos de ação, níveis e histórico de ações
- `lib/api-spec/openapi.yaml` — contrato da API

## Deploy externo

- Vercel usa o `vercel.json` da raiz para instalar o workspace e publicar `artifacts/pop-person/dist/public`.
- Railway usa o `railway.json` da raiz para compilar e iniciar `artifacts/api-server/dist/index.mjs`.
- No Vercel, defina `VITE_API_URL` como a URL pública do Railway sem `/api`; `VITE_WS_URL` é opcional e deve apontar para a mesma URL com `wss://`.
- No Railway, defina `NODE_ENV=production`, `PORT` (fornecida pelo Railway), `DATABASE_URL`, `SESSION_SECRET` e `CORS_ORIGIN` com as origens exatas da Vercel.

## Architecture decisions

- Os tipos `hate` e `fan`, seus preços base atual/mínimo e os níveis ativos são a fonte de verdade no banco.
- O custo total é calculado no backend com o preço base efetivo e o multiplicador do nível, e o resultado fica registrado em `actions`.
- A API é a fonte de verdade para níveis, preço, fila, idempotência e execução das ações.

## Product

- Visualiza pessoas públicas em círculos e permite filtrar por localização e categoria.
- Permite escolher intensidade e ação de apoio ou hate.
- Exibe o custo total correspondente à intensidade antes do envio.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
