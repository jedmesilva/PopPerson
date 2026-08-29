---
name: Supabase data path verification
description: How to distinguish a Supabase-backed PostgreSQL connection from a merely healthy API in imported PopPerson workspaces.
---

The PopPerson backend uses Drizzle over the PostgreSQL connection string, while the Supabase URL and service key can independently verify the same schema through PostgREST. Presence of Supabase secrets alone does not prove that application queries use Supabase; compare sanitized table availability and stable row digests across both paths. The health endpoint should probe the shared database client, not only the HTTP server.

**Why:** Imported workspaces may have a healthy API backed by a different PostgreSQL instance, and an HTTP-only health route cannot detect a broken or divergent database connection.

**How to apply:** Never print connection strings or keys. Verify the Supabase REST schema, the backend SQL connection, and an API response using counts or hashes only; treat matching rows plus a Supabase host in the SQL connection as confirmation. Keep the health probe lightweight and return a generic `503` on database failure.

Cross-layer checks must also verify semantic field mappings, not only payload shape or row counts. A typed API response can still map a code column into a human-readable field and pass validation; compare representative derived projections against their intended source columns.

**Why:** The database, REST payload, and API contract can all be structurally valid while a server transformation assigns the wrong source column to a response field.

**How to apply:** For every renamed or localized API field, assert the intended source-column mapping with a small deterministic projection test in addition to schema and count checks.