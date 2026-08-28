---
name: Supabase data path verification
description: How to distinguish a Supabase-backed PostgreSQL connection from a merely healthy API in imported PopPerson workspaces.
---

The PopPerson backend uses Drizzle over the PostgreSQL connection string, while the Supabase URL and service key can independently verify the same schema through PostgREST. Presence of Supabase secrets alone does not prove that application queries use Supabase; compare sanitized table availability and stable row digests across both paths.

**Why:** Imported workspaces may have a healthy API backed by a different PostgreSQL instance, and the basic health route does not query the database.

**How to apply:** Never print connection strings or keys. Verify the Supabase REST schema, the backend SQL connection, and an API response using counts or hashes only; treat matching rows plus a Supabase host in the SQL connection as confirmation.