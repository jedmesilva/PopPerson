# PopPerson

Aplicativo interativo para visualizar pessoas públicas em círculos e executar ações sobre elas.

## Run & Operate

- `pnpm install --frozen-lockfile` — install all workspace dependencies
- Use the `PopPerson Web` and `PopPerson API` workflows to start the frontend and backend in parallel
- `PopPerson Web` listens on port 3000 and `PopPerson API` listens on port 8080
- `pnpm --filter @workspace/pop-person run dev` — run the main Vite app locally when `PORT` and `BASE_PATH` are set
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run the API service at `/api`
- `GET /api/healthz` — verifies the API process and the Supabase-backed PostgreSQL connection with a lightweight `SELECT 1`; returns `503` if the database is unavailable
- `GET /api/access/location` — returns the approximate city, region, and country for the current access using the request IP; local development is labeled as `Local`
- `GET /api/access/location` also records the resolved location, anonymous session, approximate IP, user agent, request path, and access time in `access_events`
- API requests receive an anonymous `HttpOnly` cookie signed with `SESSION_SECRET`; it is an opaque identifier and is intentionally not bound to IP, network, or location
- The web app resolves the access location before bootstrapping the canvas, then applies country → state → city defaults when the catalog has a matching location

## Stack

- pnpm workspaces, Node.js, TypeScript
- Frontend: React + Vite + Tailwind CSS
- Main artifact: `artifacts/pop-person`
- Backend: Express 5 API with typed OpenAPI contracts; PopPerson domain state is persisted in PostgreSQL
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
- The PopPerson API is the source of truth for the people dataset, action catalog, validation, scheduling, and value changes. PostgreSQL persists room state and actions across API restarts.
- Access location is approximate IP geolocation, not GPS. The server does not return the raw IP to the frontend, and the external lookup can return `Indisponível` when unavailable.
- The API has in-memory rate limits of 180 requests/minute per IP or anonymous identity, and 20 action requests/minute. Limits reset when the API restarts and should move to shared storage before running multiple instances.

## External hosting

- Vercel uses the root `vercel.json`: install with `pnpm install --frozen-lockfile`, build with the PopPerson filter, and serve `artifacts/pop-person/dist/public`.
- Railway uses the root `railway.json`: build the API bundle and start `artifacts/api-server/dist/index.mjs`. Railway supplies `PORT`; the API health check is `/api/healthz`.
- Set `VITE_API_URL` in Vercel to the public Railway URL without `/api`. Optionally set `VITE_WS_URL` to its `wss://` URL; otherwise the front derives it from `VITE_API_URL`.
- Set `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, and `CORS_ORIGIN` in Railway. `CORS_ORIGIN` accepts comma-separated exact Vercel origins.
- Cross-origin sessions require HTTPS on both services. The API uses `SameSite=None; Secure` cookies in production and CORS credentials.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
