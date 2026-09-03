import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // API requests and the action worker must fail explicitly instead of
  // holding a connection forever when the database or a transaction stalls.
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 15_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
