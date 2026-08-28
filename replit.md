# PopPerson

Aplicativo interativo para visualizar pessoas públicas em círculos e executar ações sobre elas.

## Run & Operate

- `pnpm install --frozen-lockfile` — install all workspace dependencies
- Use the Replit Run button to start `PopPerson Web` (frontend) and `PopPerson API` (backend)
- `pnpm --filter @workspace/pop-person run dev` — run the main Vite app locally when `PORT` and `BASE_PATH` are set
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run the API service at `/api`
- `GET /api/access/location` — returns the approximate city, region, and country for the current access using the request IP; local development is labeled as `Local`
- API requests receive an anonymous `HttpOnly` cookie signed with `SESSION_SECRET`; it is an opaque identifier and is intentionally not bound to IP, network, or location

## Stack

- pnpm workspaces, Node.js, TypeScript
- Frontend: React + Vite + Tailwind CSS
- Main artifact: `artifacts/pop-person`
- Backend: Express 5 API with typed OpenAPI contracts; PopPerson domain state is currently kept in memory
- Shared API contracts: OpenAPI, generated React Query and Zod helpers

## Where things live

- `artifacts/pop-person` — main PopPerson web application
- `artifacts/api-server` — shared PopPerson API server
- `artifacts/mockup-sandbox` — component preview sandbox
- `lib/api-spec/openapi.yaml` — API contract source
- `lib/db/src/schema` — database schema source

## Architecture decisions

- The root preview is served by the PopPerson web artifact.
- Workspace dependencies are locked and installed with pnpm.
- Artifact service routing is managed through `.replit-artifact/artifact.toml`.

## Product

- Visualizes public figures as colored circles with labels.
- Provides a filters control for narrowing the visible set.
- Supports interactive selection and action flows from the canvas.

## User preferences

_Nenhuma preferência registrada._

## Gotchas

- The main Vite app requires `PORT` and `BASE_PATH` from its workflow environment.
- Run the main web artifact rather than starting a root-level `pnpm dev`; the workspace root has no dev script.
- The PopPerson API is the source of truth for the people dataset, action catalog, validation, scheduling, and value changes. Restarting the API resets its in-memory state.
- Access location is approximate IP geolocation, not GPS. The server does not return the raw IP to the frontend, and the external lookup can return `Indisponível` when unavailable.
- The API has in-memory rate limits of 180 requests/minute per IP or anonymous identity, and 20 action requests/minute. Limits reset when the API restarts and should move to shared storage before running multiple instances.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
